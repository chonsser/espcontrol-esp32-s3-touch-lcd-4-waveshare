"""Exercise the real main-loop lifecycle with deterministic worker/LVGL fakes.

Only repository C++ is compiled; no ESPHome, IDF or H.264 decoder is built.
"""
import os
from pathlib import Path
import re
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
component = ROOT / "components/hls_screensaver"
source = (component / "hls_screensaver.cpp").read_text()
header = (component / "hls_screensaver.h").read_text()
header = re.sub(r"^#(?:include|pragma).*\n", "", header, flags=re.M)
# Test access is confined to this temporary translation unit.
header = header.replace(" private:", " public:")
methods = []
for name in ("status_", "stop_", "fail_", "on_shutdown", "loop"):
    start = source.index(f"void HlsScreensaver::{name}(")
    end = source.find("\nvoid HlsScreensaver::", start + 1)
    if end < 0:
        end = source.index("\n}  // namespace", start)
    methods.append(source[start:end])
preamble = r'''
#include "playback_policy.h"
#include <atomic>
#include <cassert>
#include <functional>
#include <string>
#include <vector>
struct lv_image_header_t { int magic{}, cf{}, w{}, h{}, stride{}; };
struct lv_image_dsc_t { lv_image_header_t header; size_t data_size{}; const uint8_t *data{}; };
struct lv_obj_t { const void *src{}; bool hidden{}; };
constexpr int LV_OBJ_FLAG_HIDDEN=1, LV_IMAGE_HEADER_MAGIC=1, LV_COLOR_FORMAT_RGB565=1;
static lv_obj_t image;
static bool cache_dropped = false;
static unsigned destructions = 0;
static void lv_obj_add_flag(lv_obj_t *o, int) { o->hidden = true; }
static void lv_obj_remove_flag(lv_obj_t *o, int) { o->hidden = false; }
static void lv_image_set_src(lv_obj_t *o, const void *src) { o->src = src; }
static void lv_image_cache_drop(const void *) { cache_dropped = true; }
static lv_obj_t *lv_obj_get_parent(lv_obj_t *) { return &image; }
static int lv_obj_get_content_width(const lv_obj_t *) { return 480; }
static int lv_obj_get_content_height(const lv_obj_t *) { return 480; }
static void lv_image_set_scale(lv_obj_t *, int) {}
static void lv_obj_center(lv_obj_t *) {}
static void lv_obj_invalidate(lv_obj_t *) {}
static int xQueueReceive(void *, int *, int) { return 0; }
static int xQueueSend(void *, int *, int) { return 1; }
namespace esphome {
class Component { public: virtual void loop() {} virtual void on_shutdown() {} virtual void dump_config() {} };
namespace text_sensor { struct TextSensor { std::string state; void publish_state(const std::string &s) { state=s; } }; }
}
'''
fakes = r'''
namespace esphome::hls_screensaver {
void HlsScreensaver::dump_config() {}
static uint64_t now_ms() { return 1000; }
struct FaultRead {
  const char *value{nullptr};
  std::function<void()> after_read;
  const char *load() {
    const char *result = value;
    if (after_read) { auto hook = std::move(after_read); after_read = {}; hook(); }
    return result;
  }
};
struct VideoFrame { ByteBuffer pixels; uint16_t width{320}, height{192}, stride{640}; uint64_t due_ms{0}; };
struct PlaybackSession {
  uint64_t token{0};
  std::atomic<bool> cancelled{false}, transport_done{false}, decoder_done{false};
  FaultRead error;
  VideoFrame frames[3];
  void *ready_frames{nullptr}, *free_frames{nullptr};
  ~PlaybackSession() {
    assert(image.src == nullptr && "frame freed while LVGL still references it");
    assert(image.hidden && cache_dropped);
    ++destructions;
  }
};
'''
tests = r'''
}
using namespace esphome::hls_screensaver;
static PlaybackSession *start(HlsScreensaver &player, esphome::text_sensor::TextSensor &sensor) {
  player.set_status_sensor(&sensor);
  assert(player.policy_.request(true, 1, 1) == PlaybackPolicy::Action::START);
  player.policy_.started();
  auto *session = new PlaybackSession();
  session->token = player.policy_.token();
  player.session_ = session;
  player.image_ = &image;
  player.descriptor_.data = reinterpret_cast<const uint8_t *>(session);
  image = {&player.descriptor_, false};
  cache_dropped = false;
  return session;
}
int main() {
  HlsScreensaver player;
  esphome::text_sensor::TextSensor sensor;
  auto *session = start(player, sensor);
  // Failure lands after the first error read, before the cancellation read.
  session->error.after_read = [session] {
    session->error.value = "download failed";
    session->cancelled.store(true);
    session->transport_done.store(true);
    session->decoder_done.store(true);
  };
  const auto token = session->token;
  player.loop();
  assert(destructions == 1 && player.session_ == nullptr);
  assert(player.failed() && sensor.state == "download failed");
  assert(!player.policy_.accepts(token));
  player.failed_ = false;
  session = start(player, sensor);
  player.stop();
  player.loop();
  assert(destructions == 1 && player.session_ == session);
  session->transport_done.store(true);
  player.loop();
  assert(destructions == 1); // decoder still owns the pool
  session->decoder_done.store(true);
  player.loop();
  assert(destructions == 2 && player.session_ == nullptr);
  assert(!player.failed());
}
'''
with tempfile.TemporaryDirectory(prefix="hls-lifecycle-") as temp:
    directory = Path(temp)
    cpp = directory / "lifecycle.cpp"
    cpp.write_text(preamble + header + fakes + "\n".join(methods) + tests)
    binary = directory / "lifecycle"
    subprocess.run([os.environ.get("CXX", "c++"), "-std=c++17", "-Wall", "-Wextra", "-Werror",
                    "-I", str(component), str(cpp), "-o", str(binary)], check=True)
    subprocess.run([str(binary)], check=True)
