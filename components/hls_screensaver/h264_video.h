#pragma once

#include <algorithm>
#include <cstddef>
#include <cstdint>
#include <functional>
#include "byte_buffer.h"

namespace esphome::hls_screensaver {

struct VideoParameters {
  uint16_t width{0};
  uint16_t height{0};
  uint16_t coded_width{0};
  uint16_t coded_height{0};
  uint32_t sps_id{0};
};

// A bounded RBSP reader also removes emulation-prevention bytes.
class BitReader {
 public:
  BitReader(const uint8_t *data, size_t size) : data_(data), size_(size) {}
  uint32_t bits(unsigned count) {
    if (count > 32) { valid_ = false; return 0; }
    uint32_t result = 0;
    while (count--) {
      if (remaining_ == 0) {
        if (index_ >= size_) { valid_ = false; return 0; }
        uint8_t byte = data_[index_++];
        if (zeros_ >= 2 && byte == 3) {
          if (index_ >= size_ || data_[index_] > 3) { valid_ = false; return 0; }
          byte = data_[index_++];
          zeros_ = 0;
        }
        zeros_ = byte == 0 ? zeros_ + 1 : 0;
        current_ = byte;
        remaining_ = 8;
      }
      result = (result << 1) | ((current_ >> --remaining_) & 1);
    }
    return result;
  }
  uint32_t ue() {
    unsigned zeros = 0;
    while (valid_ && bits(1) == 0) {
      if (++zeros >= 31) { valid_ = false; return 0; }
    }
    return valid_ ? ((1U << zeros) - 1U + bits(zeros)) : 0;
  }
  int32_t se() { auto value = ue(); return value & 1 ? int32_t((value + 1) / 2) : -int32_t(value / 2); }
  bool valid() const { return valid_; }
 private:
  const uint8_t *data_;
  size_t size_, index_{0};
  unsigned remaining_{0}, zeros_{0};
  uint8_t current_{0};
  bool valid_{true};
};

inline bool parse_sps(const uint8_t *nal, size_t size, VideoParameters &out) {
  if (size < 5 || nal[0] != 0x67) return false;
  BitReader b(nal + 1, size - 1);
  const auto profile = b.bits(8), constraints = b.bits(8), level = b.bits(8);
  if (profile != 66 || !(constraints & 0x40) || (constraints & 3) || level > 30) return false;
  const auto id = b.ue();
  if (id > 31 || b.ue() > 12) return false;
  const auto poc_type = b.ue();
  if (poc_type == 0) { if (b.ue() > 12) return false; }
  else if (poc_type == 1) {
    b.bits(1); b.se(); b.se();
    auto count = b.ue();
    if (count > 16) return false;
    while (count--) b.se();
  } else if (poc_type != 2) return false;
  if (b.ue() > 1) return false;
  b.bits(1);
  const auto width_mbs = b.ue(), height_mbs = b.ue();
  if (width_mbs >= 20 || height_mbs >= 12 || b.bits(1) != 1) return false;
  b.bits(1);
  uint32_t left = 0, right = 0, top = 0, bottom = 0;
  if (b.bits(1)) { left = b.ue(); right = b.ue(); top = b.ue(); bottom = b.ue(); }
  const uint32_t width = (width_mbs + 1) * 16, height = (height_mbs + 1) * 16;
  if (!b.valid() || left || top || right >= width / 2 || bottom >= height / 2) return false;
  out = {static_cast<uint16_t>(width - right * 2), static_cast<uint16_t>(height - bottom * 2),
         static_cast<uint16_t>(width), static_cast<uint16_t>(height), id};
  return true;
}

inline bool parse_pps(const uint8_t *nal, size_t size, uint32_t sps_id, uint32_t &pps_id) {
  if (size < 2 || (nal[0] & 0x9f) != 8) return false;
  BitReader b(nal + 1, size - 1);
  const auto id = b.ue();
  if (id > 255 || b.ue() != sps_id || b.bits(1)) return false;  // no CABAC
  b.bits(1);
  if (b.ue() != 0 || b.ue() != 0 || b.ue() != 0) return false;  // one slice group/reference
  if (!b.valid()) return false;
  pps_id = id;
  return true;
}

inline bool i420_to_rgb565(const uint8_t *input, size_t size, unsigned width, unsigned height,
                          uint16_t *output, size_t capacity) {
  if (!input || !output || !width || !height || width > 320 || height > 192 ||
      (width & 1) || (height & 1)) return false;
  const size_t pixels = width * height;
  if (size < pixels + pixels / 2 || capacity < pixels) return false;
  const auto *u = input + pixels, *v = u + pixels / 4;
  auto clamp = [](int value) { return std::clamp(value, 0, 255); };
  for (unsigned y = 0; y < height; ++y) {
    for (unsigned x = 0; x < width; ++x) {
      const int c = int(input[y * width + x]) - 16;
      const int d = int(u[(y / 2) * (width / 2) + x / 2]) - 128;
      const int e = int(v[(y / 2) * (width / 2) + x / 2]) - 128;
      const int r = clamp((298 * c + 409 * e + 128) >> 8);
      const int g = clamp((298 * c - 100 * d - 208 * e + 128) >> 8);
      const int b = clamp((298 * c + 516 * d + 128) >> 8);
      output[y * width + x] = uint16_t(((r >> 3) << 11) | ((g >> 2) << 5) | (b >> 3));
    }
  }
  return true;
}

class AnnexBParser {
 public:
  using Consumer = std::function<bool(const uint8_t *, size_t)>;
  using TimedConsumer = std::function<bool(const uint8_t *, size_t, uint64_t)>;
  static constexpr size_t MAX_NAL = 128 * 1024;
  bool feed(const uint8_t *data, size_t size, const Consumer &consume) {
    return feed_timed(data, size, 0, [&](const uint8_t *p, size_t n, uint64_t) { return consume(p, n); });
  }
  bool feed_timed(const uint8_t *data, size_t size, uint64_t pts, const TimedConsumer &consume) {
    if (!nal_.allocate(MAX_NAL)) return false;
    for (size_t i = 0; i < size; ++i) {
      const auto byte = data[i];
      if (byte == 0) {
        if (++zeros_ > MAX_NAL) return false;
        continue;
      }
      if (byte == 1 && zeros_ >= 2) {
        if (started_ && !nal_.empty() && !consume(nal_.data(), nal_.size(), pts_)) return false;
        nal_.clear(); started_ = true; zeros_ = 0; pts_ = pts;
        continue;
      }
      if (started_) {
        if (nal_.size() + zeros_ + 1 > MAX_NAL) return false;
        if (!nal_.zeros(zeros_) || !nal_.push_back(byte)) return false;
      } else if (byte != 0) return false;
      zeros_ = 0;
    }
    return true;
  }
  bool finish(const Consumer &consume) {
    return finish_timed([&](const uint8_t *p, size_t n, uint64_t) { return consume(p, n); });
  }
  bool finish_timed(const TimedConsumer &consume) {
    // trailing_zero_8bits are not part of an RBSP.
    const bool ok = started_ && (nal_.empty() || consume(nal_.data(), nal_.size(), pts_));
    reset();
    return ok;
  }
  void reset() { nal_.clear(); zeros_ = 0; started_ = false; pts_ = 0; }
 private:
  ByteBuffer nal_;
  size_t zeros_{0};
  uint64_t pts_{0};
  bool started_{false};
};

}  // namespace esphome::hls_screensaver
