"""Exercise the real reconciliation tail before allowing HLS playback.

Removing HLS from the display effect dispatch must fail: requesting HLS in the
controller alone does not present the view or make the player eligible to run.
Only the asynchronous ESPHome effect script is replaced by a recording fake.
"""
import os
from pathlib import Path
import re
import subprocess
import tempfile
import textwrap

ROOT = Path(__file__).resolve().parents[2]
backlight = (ROOT / "common/addon/backlight.yaml").read_text()
reconcile = backlight.split("  - id: display_mode_reconcile\n", 1)[1].split("\n  - id:", 1)[0]
reconcile = textwrap.dedent(reconcile[reconcile.index("          auto transition = controller.resolve();"):])
hls = (ROOT / "common/device/screen_hls.yaml").read_text().split("  - id: hls_sync\n", 1)[1]
wanted = re.search(r"const bool wanted\s*=\s*(.*?);", hls, re.S).group(1)
source = r'''
#include "display_mode_controller.h"
#include "playback_policy.h"
#include <cassert>
using namespace espcontrol;
using namespace esphome::hls_screensaver;
uint32_t millis() { return 100; }
template<typename... Args> void log(const Args &...) {}
#define ESP_LOGD(...) log(__VA_ARGS__)
#define ESP_LOGW(...) log(__VA_ARGS__)
#define id(name) name
uint32_t cover_art_transition_generation = 0, cover_art_download_generation = 0;
struct EffectScript {
  int calls = 0;
  uint32_t generation = 0;
  DisplayMode target = DisplayMode::ACTIVE;
  bool running = false;
  bool is_running() const { return running; }
  void execute(int32_t g, int32_t mode, int32_t) {
    ++calls; generation = g; target = static_cast<DisplayMode>(mode); running = true;
  }
} display_mode_apply_transition;
struct WakeScript { bool is_running() const { return false; } } screensaver_wake;
namespace espcontrol::reset { bool update_busy() { return false; } }
void reconcile(DisplayModeController &controller) {
  RECONCILE
}
bool wanted(const DisplayModeController &controller) {
  const auto decision = controller.resolve();
  return WANTED;
}
void finish_effect(DisplayModeController &controller, DisplayMode expected) {
  assert(display_mode_apply_transition.running);
  assert(display_mode_apply_transition.target == expected);
  assert(controller.complete_transition(display_mode_apply_transition.generation, expected, millis()));
  display_mode_apply_transition.running = false;
}
int main() {
  for (const auto source : {DisplayRequestSource::IDLE_TIMER, DisplayRequestSource::PRESENCE_SENSOR}) {
    DisplayModeController controller;
    display_mode_apply_transition = {};
    controller.request(source, DisplayMode::HLS);
    assert(!wanted(controller));
    reconcile(controller);
    // Regression: old YAML returned here without scheduling any HLS effect.
    assert(display_mode_apply_transition.calls == 1);
    assert(controller.has_transition_in_progress());
    assert(!wanted(controller));
    reconcile(controller);
    assert(display_mode_apply_transition.calls == 1);
    finish_effect(controller, DisplayMode::HLS);
    assert(wanted(controller));
    PlaybackPolicy player;
    assert(player.request(wanted(controller), controller.resolve().generation, 1) == PlaybackPolicy::Action::START);
    player.started();
    reconcile(controller);
    assert(display_mode_apply_transition.calls == 1);

    // Touch/user wake preempts HLS immediately, before the active effect ends.
    controller.request(DisplayRequestSource::USER_WAKE, DisplayMode::ACTIVE);
    assert(!wanted(controller));
    assert(player.request(wanted(controller), controller.resolve().generation, 1) == PlaybackPolicy::Action::STOP);
    reconcile(controller);
    finish_effect(controller, DisplayMode::ACTIVE);
    controller.clear(DisplayRequestSource::USER_WAKE);
    reconcile(controller);
    finish_effect(controller, DisplayMode::HLS);
    assert(wanted(controller));

    // Higher-priority display-off and clock fallback retain their normal effects.
    controller.request(DisplayRequestSource::SCREEN_SCHEDULE, DisplayMode::DISPLAY_OFF);
    assert(!wanted(controller));
    reconcile(controller);
    finish_effect(controller, DisplayMode::DISPLAY_OFF);
    controller.clear(DisplayRequestSource::SCREEN_SCHEDULE);
    controller.request(source, DisplayMode::CLOCK);
    reconcile(controller);
    finish_effect(controller, DisplayMode::CLOCK);
    assert(!wanted(controller));

    controller.request(source, DisplayMode::HLS);
    reconcile(controller);
    finish_effect(controller, DisplayMode::HLS);
    assert(wanted(controller));
  }
}
'''.replace("RECONCILE", reconcile).replace("WANTED", wanted)
with tempfile.TemporaryDirectory(prefix="hls-display-transition-") as temporary:
    directory = Path(temporary)
    cpp = directory / "transition.cpp"
    cpp.write_text(source)
    binary = directory / "transition"
    subprocess.run([
        os.environ.get("CXX", "c++"), "-std=c++17", "-Wall", "-Wextra", "-Werror",
        "-I", str(ROOT / "components/espcontrol"),
        "-I", str(ROOT / "components/hls_screensaver"),
        str(cpp), "-o", str(binary),
    ], check=True)
    subprocess.run([str(binary)], check=True)
