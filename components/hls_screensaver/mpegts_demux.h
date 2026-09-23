#pragma once

#include <array>
#include <cstddef>
#include <cstdint>
#include <cstring>
#include <functional>
#include <algorithm>

namespace esphome::hls_screensaver {

inline int64_t pts_delta(uint64_t next, uint64_t previous) {
  const uint64_t value = (next - previous) & ((uint64_t(1) << 33) - 1);
  return value & (uint64_t(1) << 32) ? int64_t(value) - (int64_t(1) << 33) : int64_t(value);
}

class MpegTsDemux {
 public:
  using Consumer = std::function<bool(const uint8_t *, size_t, uint64_t)>;
  explicit MpegTsDemux(Consumer consume) : consume_(std::move(consume)) {}
  void reset() {
    packet_size_ = 0; pmt_pid_ = video_pid_ = 0x1fff;
    pat_ = {}; pmt_ = {}; last_video_cc_ = -1;
    pes_header_size_ = pes_header_target_ = 0;
    pes_remaining_ = 0; pes_bounded_ = false; pes_active_ = false;
    have_pts_ = seen_video_ = false; pts_ = 0;
  }
  bool feed(const uint8_t *data, size_t size) {
    while (size) {
      size_t count = std::min(size, packet_.size() - packet_size_);
      std::memcpy(packet_.data() + packet_size_, data, count);
      packet_size_ += count; data += count; size -= count;
      if (packet_size_ == packet_.size()) {
        if (!packet()) return false;
        packet_size_ = 0;
      }
    }
    return true;
  }
  bool finish() const { return packet_size_ == 0 && seen_video_ && (!pes_bounded_ || pes_remaining_ == 0); }
 private:
  struct Section {
    std::array<uint8_t, 1024> bytes{};
    size_t size{0};
    int cc{-1};
  };
  static uint16_t pid(const uint8_t *p) { return uint16_t(((p[0] & 0x1f) << 8) | p[1]); }
  static bool valid_crc(const uint8_t *p, size_t n) {
    uint32_t crc = 0xffffffff;
    while (n--) {
      crc ^= uint32_t(*p++) << 24;
      for (unsigned i = 0; i < 8; ++i) crc = crc & 0x80000000 ? (crc << 1) ^ 0x04c11db7 : crc << 1;
    }
    return crc == 0;
  }
  bool table(Section &section, const uint8_t *data, size_t size, bool start, bool is_pat) {
    if (start) {
      if (!size || size_t(data[0]) + 1 > size) return false;
      const size_t prefix = size_t(data[0]) + 1;
      // Finish a previously split section before the next section begins.
      if (section.size && prefix > 1 && !table(section, data + 1, prefix - 1, false, is_pat)) return false;
      section.size = 0;
      data += prefix; size -= prefix;
    }
    while (size) {
      if (section.size == 0 && *data == 0xff) return true;
      if (section.size == section.bytes.size()) return false;
      section.bytes[section.size++] = *data++; --size;
      if (section.size < 3) continue;
      const size_t total = 3 + ((section.bytes[1] & 15) << 8) + section.bytes[2];
      if (total > section.bytes.size() || total < 12) return false;
      if (section.size < total) continue;
      const auto *s = section.bytes.data();
      if (!valid_crc(s, total) || (s[5] & 1) == 0 || s[6] || s[7]) return false;
      if (is_pat) {
        if (s[0] != 0 || (total - 12) % 4) return false;
        for (size_t i = 8; i + 4 <= total - 4; i += 4) {
          if (s[i] || s[i + 1]) {
            const auto next_pid = pid(s + i + 2);
            if (pmt_pid_ != next_pid) { pmt_pid_ = next_pid; pmt_ = {}; video_pid_ = 0x1fff; }
            break;
          }
        }
      } else {
        if (s[0] != 2 || total < 16) return false;
        size_t i = 12 + ((s[10] & 15) << 8) + s[11];
        if (i > total - 4) return false;
        uint16_t found = 0x1fff;
        while (i < total - 4) {
          if (i + 5 > total - 4) return false;
          const size_t length = ((s[i + 3] & 15) << 8) + s[i + 4];
          if (i + 5 + length > total - 4) return false;
          if (s[i] == 0x1b && found == 0x1fff) found = pid(s + i + 1);
          i += 5 + length;
        }
        if (found == 0x1fff) return false;
        if (video_pid_ != found) { video_pid_ = found; last_video_cc_ = -1; pes_active_ = false; }
      }
      section.size = 0;
    }
    return true;
  }
  bool video(const uint8_t *data, size_t size, bool start) {
    if (start) {
      if (pes_active_ && pes_bounded_ && pes_remaining_) return false;
      pes_active_ = true; pes_header_size_ = 0; pes_header_target_ = 9;
      pes_bounded_ = false; pes_remaining_ = 0; have_pts_ = false;
    }
    if (!pes_active_) return true;
    while (size && pes_header_size_ < pes_header_target_) {
      header_[pes_header_size_++] = *data++; --size;
      if (pes_header_size_ == 9) {
        if (header_[0] || header_[1] || header_[2] != 1 || (header_[3] & 0xf0) != 0xe0 || (header_[6] & 0xc0) != 0x80) return false;
        pes_header_target_ = 9 + header_[8];
        if (pes_header_target_ > header_.size() || header_[8] < 5 || !(header_[7] & 0x80)) return false;
        const size_t length = (size_t(header_[4]) << 8) | header_[5];
        pes_bounded_ = length != 0;
        if (pes_bounded_ && length < 3U + header_[8]) return false;
        pes_remaining_ = pes_bounded_ ? length - 3 - header_[8] : 0;
      }
    }
    if (pes_header_size_ < pes_header_target_) return true;
    if (!have_pts_) {
      const auto *p = header_.data() + 9;
      const auto expected = (header_[7] & 0xc0) == 0xc0 ? 0x30 : 0x20;
      if ((p[0] & 0xf1) != (expected | 1) || !(p[2] & 1) || !(p[4] & 1)) return false;
      pts_ = (uint64_t((p[0] >> 1) & 7) << 30) | (uint64_t(p[1]) << 22) |
             (uint64_t(p[2] >> 1) << 15) | (uint64_t(p[3]) << 7) | (p[4] >> 1);
      have_pts_ = true;
    }
    if (pes_bounded_) size = std::min(size, pes_remaining_);
    if (size) {
      if (!consume_(data, size, pts_)) return false;
      if (pes_bounded_) pes_remaining_ -= size;
      seen_video_ = true;
    }
    return true;
  }
  bool packet() {
    const auto *p = packet_.data();
    if (p[0] != 0x47 || (p[1] & 0x80) || (p[3] & 0xc0)) return false;
    const unsigned control = (p[3] >> 4) & 3;
    if (!control) return false;
    size_t offset = 4;
    bool discontinuity = false;
    if (control & 2) {
      if (p[4] > 183) return false;
      if (p[4]) discontinuity = p[5] & 0x80;
      offset += 1 + p[4];
    }
    if (!(control & 1)) return true;
    if (offset >= packet_.size()) return false;
    const auto packet_pid = pid(p + 1);
    const int cc = p[3] & 15;
    const bool start = p[1] & 0x40;
    int *previous = packet_pid == 0 ? &pat_.cc : packet_pid == pmt_pid_ ? &pmt_.cc : packet_pid == video_pid_ ? &last_video_cc_ : nullptr;
    if (!previous) return true;
    if (!discontinuity && *previous >= 0) {
      if (cc == *previous) return true;  // retransmission
      if (cc != ((*previous + 1) & 15)) return false;
    }
    *previous = cc;
    if (discontinuity && packet_pid == video_pid_) pes_active_ = false;
    if (packet_pid == 0) return table(pat_, p + offset, packet_.size() - offset, start, true);
    if (packet_pid == pmt_pid_) return table(pmt_, p + offset, packet_.size() - offset, start, false);
    return video(p + offset, packet_.size() - offset, start);
  }
  Consumer consume_;
  std::array<uint8_t, 188> packet_{};
  std::array<uint8_t, 264> header_{};
  size_t packet_size_{0}, pes_header_size_{0}, pes_header_target_{0}, pes_remaining_{0};
  Section pat_, pmt_;
  uint16_t pmt_pid_{0x1fff}, video_pid_{0x1fff};
  int last_video_cc_{-1};
  bool pes_active_{false}, pes_bounded_{false}, have_pts_{false}, seen_video_{false};
  uint64_t pts_{0};
};

}  // namespace esphome::hls_screensaver
