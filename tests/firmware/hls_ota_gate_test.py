"""Execute the real YAML admission expression with host display/OTA policies.

No ESPHome runtime, ESP-IDF or H.264 decoder dependency is built by this test.
"""
import os
from pathlib import Path
import re
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
yaml = (ROOT / "common/device/screen_hls.yaml").read_text()
body = yaml.split("  - id: hls_sync\n", 1)[1]
expression = re.search(r"const bool wanted\s*=\s*(.*?);", body, re.S).group(1)
source = r'''
#include "display_mode_controller.h"
#include "reset_interlock.h"
#include "playback_policy.h"
#include <cassert>
namespace espcontrol::reset {
OperationInterlock interlock;
bool update_busy() { return interlock.busy(); }
}
struct WakeScript { bool is_running() const { return false; } } screensaver_wake;
#define id(name) name
using namespace espcontrol;
using namespace esphome::hls_screensaver;
bool wanted(const DisplayModeController &controller) {
  const auto decision = controller.resolve();
  return EXPRESSION;
}
int main() {
  DisplayModeController controller;
  controller.request(DisplayRequestSource::IDLE_TIMER, DisplayMode::HLS);
  controller.complete_transition(controller.resolve());
  PlaybackPolicy player;
  using Action = PlaybackPolicy::Action;
  assert(player.request(wanted(controller), 1, 1) == Action::START);
  player.started();
  const auto token = player.token();
  // Reserve native flash before deferred global OTA notifications arrive.
  assert(reset::interlock.begin_installation(false));
  assert(player.request(wanted(controller), 1, 1) == Action::STOP);
  assert(!player.accepts(token));
  player.cleaned();
  assert(player.request(wanted(controller), 1, 2) == Action::NONE);
  reset::interlock.finish_begin(false, true, 42);
  const int native_source = 1, browser_source = 2;
  reset::interlock.set_ota_source_busy(&native_source, true);
  reset::interlock.set_ota_source_busy(&browser_source, true);
  reset::interlock.finish_native_installation(42);
  // Completion stays busy until reboot; another source's abort cannot unblock it.
  reset::interlock.set_ota_source_busy(&browser_source, false);
  assert(player.request(wanted(controller), 2, 3) == Action::NONE);
  reset::interlock.set_ota_source_busy(&native_source, false);
  assert(player.request(wanted(controller), 2, 3) == Action::START);
  player.started();
  reset::interlock.set_ota_source_busy(&native_source, true);
  assert(player.request(wanted(controller), 2, 3) == Action::STOP);
  reset::interlock.set_ota_source_busy(&native_source, false);
  assert(player.request(wanted(controller), 2, 3) == Action::NONE);
  player.cleaned();
  assert(player.request(wanted(controller), 2, 3) == Action::START);
}
'''.replace("EXPRESSION", expression)
with tempfile.TemporaryDirectory(prefix="hls-ota-gate-") as temporary:
    directory = Path(temporary)
    cpp = directory / "gate.cpp"
    cpp.write_text(source)
    binary = directory / "gate"
    subprocess.run([
        os.environ.get("CXX", "c++"), "-std=c++17", "-Wall", "-Wextra", "-Werror",
        "-I", str(ROOT / "components/espcontrol"),
        "-I", str(ROOT / "components/hls_screensaver"),
        str(cpp), "-o", str(binary),
    ], check=True)
    subprocess.run([str(binary)], check=True)
