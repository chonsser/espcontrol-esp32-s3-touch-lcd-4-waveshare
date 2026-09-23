#pragma once

#include <cstddef>
#include <cstdlib>
#include <cstring>
#include <cstdint>
#ifdef USE_ESP32
#include "esp_heap_caps.h"
#endif

namespace esphome::hls_screensaver {

// Large media buffers never fall back to scarce internal RAM on the panel.
class ByteBuffer {
 public:
  ByteBuffer() = default;
  ~ByteBuffer() { std::free(data_); }
  ByteBuffer(const ByteBuffer &) = delete;
  ByteBuffer &operator=(const ByteBuffer &) = delete;
  bool allocate(size_t capacity) {
    if (capacity_ >= capacity) return true;
    if (data_) return false;
#ifdef USE_ESP32
    data_ = static_cast<uint8_t *>(heap_caps_malloc(capacity, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT));
#else
    data_ = static_cast<uint8_t *>(std::malloc(capacity));
#endif
    if (!data_) return false;
    capacity_ = capacity;
    return true;
  }
  bool append(const uint8_t *data, size_t size) {
    if (size > capacity_ - size_) return false;
    std::memcpy(data_ + size_, data, size); size_ += size; return true;
  }
  bool zeros(size_t count) {
    if (count > capacity_ - size_) return false;
    std::memset(data_ + size_, 0, count); size_ += count; return true;
  }
  bool push_back(uint8_t byte) { return append(&byte, 1); }
  void clear() { size_ = 0; }
  uint8_t *data() { return data_; }
  const uint8_t *data() const { return data_; }
  size_t size() const { return size_; }
  bool empty() const { return size_ == 0; }
 private:
  uint8_t *data_{nullptr};
  size_t size_{0}, capacity_{0};
};

}  // namespace esphome::hls_screensaver
