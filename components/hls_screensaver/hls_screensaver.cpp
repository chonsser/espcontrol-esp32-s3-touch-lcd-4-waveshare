#include "hls_screensaver.h"
#include "hls_playlist.h"
#include "esphome/core/log.h"
#include "esp_crt_bundle.h"
#include "esp_http_client.h"
#include "esp_h264_dec_sw.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/queue.h"
#include <atomic>
#include <cerrno>
#include <cstring>
#include <new>

namespace esphome::hls_screensaver {

static const char *const TAG = "hls_screensaver";
static uint64_t now_ms() { return uint64_t(esp_timer_get_time()) / 1000; }

struct SegmentBuffer {
  ByteBuffer bytes;
  bool reset{false};
  bool flush{false};
};
struct VideoFrame {
  ByteBuffer pixels;
  uint16_t width{0}, height{0}, stride{0};
  uint64_t due_ms{0};
};
struct PlaybackSession {
  std::string url;
  uint64_t token{0};
  std::atomic<bool> cancelled{false}, transport_done{true}, decoder_done{true};
  std::atomic<const char *> error{nullptr};
  SegmentBuffer segments[2];
  VideoFrame frames[3];
  QueueHandle_t free_segments{nullptr}, ready_segments{nullptr}, free_frames{nullptr}, ready_frames{nullptr};
  ~PlaybackSession() {
    if (free_segments) vQueueDelete(free_segments);
    if (ready_segments) vQueueDelete(ready_segments);
    if (free_frames) vQueueDelete(free_frames);
    if (ready_frames) vQueueDelete(ready_frames);
  }
  bool allocate() {
    free_segments = xQueueCreate(2, sizeof(int)); ready_segments = xQueueCreate(2, sizeof(int));
    free_frames = xQueueCreate(3, sizeof(int)); ready_frames = xQueueCreate(3, sizeof(int));
    if (!free_segments || !ready_segments || !free_frames || !ready_frames) return false;
    for (int i = 0; i < 2; ++i) {
      if (!segments[i].bytes.allocate(MAX_SEGMENT)) return false;
      xQueueSend(free_segments, &i, 0);
    }
    for (int i = 0; i < 3; ++i) {
      if (!frames[i].pixels.allocate(320 * 192 * 2)) return false;
      xQueueSend(free_frames, &i, 0);
    }
    return true;
  }
  void fail(const char *message) {
    const char *expected = nullptr;
    error.compare_exchange_strong(expected, message);
    cancelled.store(true);
  }
  bool receive(QueueHandle_t queue, int &index) {
    while (!cancelled.load()) if (xQueueReceive(queue, &index, pdMS_TO_TICKS(50))) return !cancelled.load();
    return false;
  }
  bool send(QueueHandle_t queue, int index) {
    while (!cancelled.load()) if (xQueueSend(queue, &index, pdMS_TO_TICKS(50))) return true;
    return false;
  }
  bool pause(uint32_t milliseconds) {
    const auto until = now_ms() + milliseconds;
    while (!cancelled.load() && now_ms() < until) vTaskDelay(pdMS_TO_TICKS(20));
    return !cancelled.load();
  }
};

struct ResponseHeaders {
  std::string location;
  bool compressed{false};
};
static esp_err_t http_event(esp_http_client_event_t *event) {
  if (event->event_id != HTTP_EVENT_ON_HEADER || !event->header_key || !event->header_value) return ESP_OK;
  auto &headers = *static_cast<ResponseHeaders *>(event->user_data);
  if (strcasecmp(event->header_key, "Location") == 0) {
    const size_t size = strnlen(event->header_value, MAX_URL + 1);
    if (size > MAX_URL) return ESP_FAIL;
    headers.location.assign(event->header_value, size);
  }
  if (strcasecmp(event->header_key, "Content-Encoding") == 0)
    headers.compressed = strcasecmp(event->header_value, "identity") != 0;
  return ESP_OK;
}

// One worker exclusively owns the HTTP handle, including cleanup. Cancellation
// is cooperative with short read timeouts; no other task closes a live socket.
static bool fetch(PlaybackSession &session, const std::string &requested, ByteBuffer &body,
                  size_t limit, std::string &final_url) {
  std::string url = requested;
  const auto deadline = now_ms() + 20000;
  if (!body.allocate(limit)) return false;
  for (unsigned redirect = 0; redirect <= 3 && !session.cancelled.load(); ++redirect) {
    if (!valid_url(url)) return false;
    ResponseHeaders headers;
    esp_http_client_config_t config{};
    config.url = url.c_str(); config.timeout_ms = 1000;
    config.disable_auto_redirect = true;
    config.crt_bundle_attach = esp_crt_bundle_attach;
    config.event_handler = http_event; config.user_data = &headers;
    config.buffer_size = 1024; config.buffer_size_tx = 512;
    auto *client = esp_http_client_init(&config);
    if (!client) return false;
    esp_http_client_set_header(client, "Accept-Encoding", "identity");
    bool ok = esp_http_client_open(client, 0) == ESP_OK;
    int64_t length = ok ? esp_http_client_fetch_headers(client) : -1;
    const int status = esp_http_client_get_status_code(client);
    if (ok && status >= 300 && status < 400 && !headers.location.empty()) {
      auto next = resolve_url(url, headers.location);
      esp_http_client_cleanup(client);
      if (next.empty() || now_ms() >= deadline) return false;
      url = std::move(next);
      continue;
    }
    ok = ok && length >= 0 && status == 200 && !headers.compressed && uint64_t(length) <= limit;
    body.clear();
    uint8_t chunk[1024];
    while (ok && !session.cancelled.load() && now_ms() < deadline) {
      const int read = esp_http_client_read(client, reinterpret_cast<char *>(chunk), sizeof(chunk));
      if (read > 0) {
        if (body.size() + size_t(read) > limit || !body.append(chunk, size_t(read))) { ok = false; break; }
      } else if (read == 0 && esp_http_client_is_complete_data_received(client)) {
        break;
      } else if (read < 0 && errno != EAGAIN && errno != EWOULDBLOCK && errno != ETIMEDOUT) {
        ok = false;
      }
    }
    ok = ok && !session.cancelled.load() && now_ms() < deadline && !body.empty() &&
         esp_http_client_is_complete_data_received(client);
    esp_http_client_cleanup(client);
    if (ok) final_url = url;
    return ok;
  }
  return false;
}

static bool fetch_retry(PlaybackSession &session, const std::string &url, ByteBuffer &body,
                        size_t limit, std::string &final_url) {
  for (unsigned attempt = 0; attempt < 3 && !session.cancelled.load(); ++attempt) {
    if (fetch(session, url, body, limit, final_url)) return true;
    if (!session.pause(500U << attempt)) break;
  }
  return false;
}

static void transport_task(void *argument) {
  auto &session = *static_cast<PlaybackSession *>(argument);
  {
    ByteBuffer playlist_bytes;
    std::string media_url = session.url;
    uint64_t next_sequence = 0;
    bool initialized = false, reset = true;
    unsigned masters = 0;
    while (!session.cancelled.load()) {
      std::string final_url;
      if (!fetch_retry(session, media_url, playlist_bytes, MAX_PLAYLIST, final_url)) {
        if (!session.cancelled.load()) session.fail("HLS download failed");
        break;
      }
      Playlist playlist;
      std::string error;
      if (!parse_playlist(std::string(reinterpret_cast<char *>(playlist_bytes.data()), playlist_bytes.size()), final_url, playlist, error)) {
        session.fail("Unsupported HLS playlist; use unencrypted MPEG-TS and H.264 baseline"); break;
      }
      if (!playlist.variant.empty()) {
        if (++masters > 3) { session.fail("Too many nested HLS playlists"); break; }
        media_url = playlist.variant;
        continue;
      }
      media_url = final_url;
      if (!initialized) {
        next_sequence = playlist.sequence;
        if (!playlist.end_list && playlist.segments.size() > 2) next_sequence += playlist.segments.size() - 2;
        initialized = true;
      }
      if (next_sequence < playlist.sequence) { next_sequence = playlist.sequence; reset = true; }
      for (size_t i = 0; i < playlist.segments.size() && !session.cancelled.load(); ++i) {
        if (playlist.sequence + i < next_sequence) continue;
        int index;
        if (!session.receive(session.free_segments, index)) break;
        auto &segment = session.segments[index];
        if (!fetch_retry(session, playlist.segments[i].url, segment.bytes, MAX_SEGMENT, final_url)) {
          if (!session.cancelled.load()) session.fail("HLS segment download failed or exceeded 256 KiB");
          break;
        }
        segment.reset = reset || playlist.segments[i].discontinuity;
        segment.flush = playlist.end_list && i + 1 == playlist.segments.size();
        reset = false;
        if (!session.send(session.ready_segments, index)) break;
        next_sequence = playlist.sequence + i + 1;
      }
      if (playlist.end_list) { next_sequence = playlist.sequence; reset = true; }
      else if (!session.pause(std::max<uint32_t>(500, playlist.target_ms / 2))) break;
    }
  }
  session.transport_done.store(true);
  vTaskDelete(nullptr);
}

class VideoDecoder {
 public:
  explicit VideoDecoder(PlaybackSession &session) : session_(session) {}
  ~VideoDecoder() { close_(); }
  void reset() { close_(); gate_.reset(); clock_.reset(); }
  bool nal(const uint8_t *data, size_t size, uint64_t pts) {
    const auto decision = gate_.accept(data, size);
    if (decision == VideoGate::Result::REJECT) { session_.fail("Unsupported H.264; maximum 320x192, constrained baseline, one reference frame"); return false; }
    if (decision == VideoGate::Result::SKIP) return true;
    if (decision == VideoGate::Result::RESET) {
      close_();
      esp_h264_dec_cfg_sw_t config{};
      config.pic_type = ESP_H264_RAW_FMT_I420;
      if (esp_h264_dec_sw_new(&config, &handle_) != ESP_H264_ERR_OK || esp_h264_dec_open(handle_) != ESP_H264_ERR_OK) {
        session_.fail("Not enough memory for H.264 decoder"); return false;
      }
    }
    if (!handle_ || !packet_.allocate(AnnexBParser::MAX_NAL + 4)) return false;
    packet_.clear();
    const uint8_t prefix[] = {0, 0, 0, 1};
    if (!packet_.append(prefix, sizeof(prefix)) || !packet_.append(data, size)) return false;
    esp_h264_dec_in_frame_t input{};
    input.raw_data.buffer = packet_.data(); input.raw_data.len = packet_.size();
    input.pts = uint32_t(pts); input.dts = input.pts;
    unsigned empty_steps = 0;
    while (input.raw_data.len && !session_.cancelled.load()) {
      esp_h264_dec_out_frame_t output{};
      input.consume = 0;
      if (esp_h264_dec_process(handle_, &input, &output) != ESP_H264_ERR_OK || input.consume > input.raw_data.len) return false;
      if (output.out_size && !frame_(output, pts)) return false;
      if (!input.consume) { if (++empty_steps > 1) return false; }
      else empty_steps = 0;
      input.raw_data.buffer += input.consume; input.raw_data.len -= input.consume;
    }
    return !session_.cancelled.load();
  }
 private:
  void close_() {
    if (handle_) { esp_h264_dec_close(handle_); esp_h264_dec_del(handle_); handle_ = nullptr; }
  }
  bool frame_(const esp_h264_dec_out_frame_t &output, uint64_t pts) {
    esp_h264_dec_param_sw_handle_t param = nullptr;
    esp_h264_resolution_t resolution{};
    if (esp_h264_dec_sw_get_param_hd(handle_, &param) != ESP_H264_ERR_OK ||
        esp_h264_dec_get_resolution(param, &resolution) != ESP_H264_ERR_OK) return false;
    const auto &expected = gate_.parameters();
    if (resolution.width != expected.coded_width || resolution.height != expected.coded_height) return false;
    uint64_t due;
    if (!clock_.schedule(pts, now_ms(), due)) { session_.fail("Unsupported frame timing; maximum 15 fps"); return false; }
    int index;
    if (!session_.receive(session_.free_frames, index)) return false;
    auto &frame = session_.frames[index];
    if (!i420_to_rgb565(output.outbuf, output.out_size, resolution.width, resolution.height,
                       reinterpret_cast<uint16_t *>(frame.pixels.data()), 320 * 192)) return false;
    frame.width = expected.width; frame.height = expected.height; frame.stride = resolution.width * 2;
    frame.due_ms = due;
    return session_.send(session_.ready_frames, index);
  }
  PlaybackSession &session_;
  VideoGate gate_;
  PlaybackClock clock_;
  ByteBuffer packet_;
  esp_h264_dec_handle_t handle_{nullptr};
};

static void decoder_task(void *argument) {
  auto &session = *static_cast<PlaybackSession *>(argument);
  {
    VideoDecoder decoder(session);
    AnnexBParser annex;
    auto nal = [&](const uint8_t *data, size_t size, uint64_t pts) { return decoder.nal(data, size, pts); };
    MpegTsDemux demux([&](const uint8_t *data, size_t size, uint64_t pts) { return annex.feed_timed(data, size, pts, nal); });
    int index;
    while (session.receive(session.ready_segments, index)) {
      auto &segment = session.segments[index];
      if (segment.reset) { decoder.reset(); annex.reset(); demux.reset(); }
      bool ok = demux.feed(segment.bytes.data(), segment.bytes.size());
      if (ok && segment.flush) ok = demux.finish() && annex.finish_timed(nal);
      if (!ok) {
        if (!session.cancelled.load()) session.fail("Invalid or unsupported MPEG-TS / H.264 video");
        break;
      }
      session.send(session.free_segments, index);
    }
  }
  session.decoder_done.store(true);
  vTaskDelete(nullptr);
}

void HlsScreensaver::status_(const char *value) {
  if (last_status_ == value) return;
  last_status_ = value;
  if (status_sensor_) status_sensor_->publish_state(last_status_);
}
void HlsScreensaver::dump_config() { ESP_LOGCONFIG(TAG, "HLS: MPEG-TS / constrained baseline, 320x192, <=15 fps, video only"); }
void HlsScreensaver::clear_failure() { if (failed_) { failed_ = false; status_("Stopped"); } }
void HlsScreensaver::reconcile(bool wanted, uint32_t generation, const std::string &url, lv_obj_t *parent) {
  if (url_ != url) { url_ = url; ++revision_; clear_failure(); }
  const auto action = policy_.request(wanted && !failed_, generation, revision_);
  if (action == PlaybackPolicy::Action::STOP) stop_();
  if (action == PlaybackPolicy::Action::START) start_(parent);
}
void HlsScreensaver::start_(lv_obj_t *parent) {
  if (!valid_url(url_) || !parent) { policy_.cleaned(); fail_("Enter a valid HTTP(S) HLS URL"); return; }
  auto *session = new (std::nothrow) PlaybackSession();
  if (!session || !session->allocate()) { delete session; policy_.cleaned(); fail_("Not enough free memory for HLS"); return; }
  session_ = session; session_->url = url_; session_->token = policy_.token();
  if (!image_) {
    image_ = lv_image_create(parent);
    lv_obj_remove_flag(image_, LV_OBJ_FLAG_CLICKABLE);
    lv_image_set_antialias(image_, false);
  }
  lv_obj_add_flag(image_, LV_OBJ_FLAG_HIDDEN);
  last_frame_ms_ = now_ms();
  policy_.started();
  session_->decoder_done.store(false);
  if (xTaskCreate(decoder_task, "hls_decode", 12288, session_, 1, nullptr) != pdPASS) {
    session_->decoder_done.store(true); fail_("Not enough memory for decoder task"); return;
  }
  session_->transport_done.store(false);
  if (xTaskCreate(transport_task, "hls_http", 12288, session_, 1, nullptr) != pdPASS) {
    session_->transport_done.store(true); fail_("Not enough memory for download task"); return;
  }
  status_("Starting");
}
void HlsScreensaver::stop_() {
  if (session_) session_->cancelled.store(true);
  if (image_) { lv_obj_add_flag(image_, LV_OBJ_FLAG_HIDDEN); lv_image_set_src(image_, nullptr); }
  lv_image_cache_drop(&descriptor_);
  displayed_ = pending_ = -1;
  if (!failed_) status_("Stopped");
}
void HlsScreensaver::fail_(const char *message) {
  failed_ = true;
  policy_.request(false, 0, revision_);
  stop_(); status_(message);
}
void HlsScreensaver::on_shutdown() {
  policy_.request(false, 0, revision_);
  stop_();
}
void HlsScreensaver::loop() {
  if (!session_) return;
  if (const char *error = session_->error.load(); error && !failed_) fail_(error);
  if (session_->cancelled.load()) {
    if (session_->transport_done.load() && session_->decoder_done.load()) {
      // stop_ detached the LVGL source before either session or frames can die.
      delete session_; session_ = nullptr; policy_.cleaned();
    }
    return;
  }
  if (!policy_.accepts(session_->token)) return;
  if (now_ms() - last_frame_ms_ > 30000) { fail_("HLS produced no video for 30 seconds"); return; }
  for (unsigned count = 0; count < 3; ++count) {
    if (pending_ < 0 && !xQueueReceive(session_->ready_frames, &pending_, 0)) break;
    auto &frame = session_->frames[pending_];
    const auto now = now_ms();
    if (frame.due_ms > now) break;
    if (now - frame.due_ms <= 500 || displayed_ < 0) {
      lv_image_cache_drop(&descriptor_);
      descriptor_ = {};
      descriptor_.header.magic = LV_IMAGE_HEADER_MAGIC;
      descriptor_.header.cf = LV_COLOR_FORMAT_RGB565;
      descriptor_.header.w = frame.width; descriptor_.header.h = frame.height;
      descriptor_.header.stride = frame.stride;
      descriptor_.data_size = frame.stride * frame.height;
      descriptor_.data = frame.pixels.data();
      lv_image_set_src(image_, &descriptor_);
      const auto *parent = lv_obj_get_parent(image_);
      const auto width = lv_obj_get_content_width(parent), height = lv_obj_get_content_height(parent);
      const auto scale = std::min(width * 256 / frame.width, height * 256 / frame.height);
      lv_image_set_scale(image_, scale);
      lv_obj_center(image_);
      lv_obj_remove_flag(image_, LV_OBJ_FLAG_HIDDEN);
      lv_obj_invalidate(image_);
      if (displayed_ >= 0) xQueueSend(session_->free_frames, &displayed_, 0);
      displayed_ = pending_; last_frame_ms_ = now; status_("Playing");
    } else {
      xQueueSend(session_->free_frames, &pending_, 0);
    }
    pending_ = -1;
  }
}

}  // namespace esphome::hls_screensaver
