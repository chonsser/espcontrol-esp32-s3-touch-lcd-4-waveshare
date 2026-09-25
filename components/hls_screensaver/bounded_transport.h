#pragma once

#include "esp_transport.h"
#include "esp_transport_tcp.h"
#include "esp_transport_ssl.h"
#include "esp_crt_bundle.h"
#include <algorithm>
#include <atomic>
#include <cerrno>
#include <cstdint>

namespace esphome::hls_screensaver {

// The HTTP client loops internally while receiving headers. Guard each actual
// transport operation, not just the call surrounding that loop. Both handles
// belong exclusively to the download worker; cleanup never races another task.
class DeadlineTransport {
 public:
  using Clock = uint64_t (*)();
  DeadlineTransport(const std::atomic<bool> &cancelled, uint64_t deadline, Clock clock)
      : cancelled_(cancelled), deadline_(deadline), clock_(clock) {}
  DeadlineTransport(const DeadlineTransport &) = delete;
  DeadlineTransport &operator=(const DeadlineTransport &) = delete;
  ~DeadlineTransport() {
    if (wrapper_) esp_transport_destroy(wrapper_);
    if (inner_) esp_transport_destroy(inner_);
  }
  bool init(bool secure) {
    inner_ = secure ? esp_transport_ssl_init() : esp_transport_tcp_init();
    if (!inner_) return false;
    if (secure) esp_transport_ssl_crt_bundle_attach(inner_, esp_crt_bundle_attach);
    wrapper_ = esp_transport_init();
    if (!wrapper_) return false;
    return esp_transport_set_context_data(wrapper_, this) == ESP_OK &&
        esp_transport_set_func(wrapper_, connect_, read_, write_, close_, poll_read_, poll_write_, nullptr) == ESP_OK;
  }
  esp_transport_handle_t handle() const { return wrapper_; }
 private:
  static DeadlineTransport &self_(esp_transport_handle_t transport) {
    return *static_cast<DeadlineTransport *>(esp_transport_get_context_data(transport));
  }
  bool active_() const {
    if (cancelled_.load()) { errno = ECANCELED; return false; }
    if (clock_() >= deadline_) { errno = ETIMEDOUT; return false; }
    return true;
  }
  template<typename Operation> int run_(int timeout, Operation operation) {
    if (!active_()) return -1;
    const auto now = clock_();
    if (now >= deadline_) { errno = ETIMEDOUT; return -1; }
    int bounded = static_cast<int>(std::min<uint64_t>(1000, deadline_ - now));
    if (timeout >= 0) bounded = std::min(bounded, timeout);
    const int result = operation(inner_, bounded);
    return active_() ? result : -1;
  }
  static int connect_(esp_transport_handle_t t, const char *host, int port, int timeout) {
    return self_(t).run_(timeout, [&](auto inner, int bounded) { return esp_transport_connect(inner, host, port, bounded); });
  }
  static int read_(esp_transport_handle_t t, char *data, int size, int timeout) {
    return self_(t).run_(timeout, [&](auto inner, int bounded) { return esp_transport_read(inner, data, size, bounded); });
  }
  static int write_(esp_transport_handle_t t, const char *data, int size, int timeout) {
    return self_(t).run_(timeout, [&](auto inner, int bounded) { return esp_transport_write(inner, data, size, bounded); });
  }
  static int poll_read_(esp_transport_handle_t t, int timeout) {
    return self_(t).run_(timeout, [&](auto inner, int bounded) { return esp_transport_poll_read(inner, bounded); });
  }
  static int poll_write_(esp_transport_handle_t t, int timeout) {
    return self_(t).run_(timeout, [&](auto inner, int bounded) { return esp_transport_poll_write(inner, bounded); });
  }
  static int close_(esp_transport_handle_t t) { return esp_transport_close(self_(t).inner_); }
  const std::atomic<bool> &cancelled_;
  uint64_t deadline_;
  Clock clock_;
  esp_transport_handle_t inner_{nullptr}, wrapper_{nullptr};
};

}  // namespace esphome::hls_screensaver
