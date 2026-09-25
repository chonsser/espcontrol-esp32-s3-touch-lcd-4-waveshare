#pragma once

#include "esphome/core/component.h"
#include "esphome/components/text_sensor/text_sensor.h"
#include "esphome/components/lvgl/lvgl_esphome.h"
#include "playback_policy.h"
#include <string>

namespace esphome::hls_screensaver {

struct PlaybackSession;

class HlsScreensaver : public Component {
 public:
  void set_status_sensor(text_sensor::TextSensor *sensor) { status_sensor_ = sensor; }
  void reconcile(bool wanted, uint32_t generation, const std::string &url, lv_obj_t *parent);
  void stop() { policy_.request(false, 0, revision_); stop_(); }
  bool failed() const { return failed_; }
  void clear_failure();
  void loop() override;
  void on_shutdown() override;
  void dump_config() override;
 private:
  void start_(lv_obj_t *parent);
  void stop_();
  void status_(const char *value);
  void fail_(const char *value);
  PlaybackPolicy policy_;
  PlaybackSession *session_{nullptr};
  text_sensor::TextSensor *status_sensor_{nullptr};
  lv_obj_t *image_{nullptr};
  lv_image_dsc_t descriptor_{};
  std::string url_, last_status_;
  uint32_t revision_{0};
  int displayed_{-1}, pending_{-1};
  uint64_t last_frame_ms_{0};
  bool failed_{false};
};

}  // namespace esphome::hls_screensaver
