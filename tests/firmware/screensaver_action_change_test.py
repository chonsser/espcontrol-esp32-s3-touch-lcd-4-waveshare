"""Execute real setting callbacks with the production display arbiter.

Only entity state, LVGL visibility and script dispatch are doubled. Removing
live reconciliation must fail the off-to-clock assertion while already asleep.
"""
import json
from pathlib import Path
import re
import subprocess
import sys
import tempfile

import yaml

ROOT = Path(__file__).resolve().parents[2]


class Loader(yaml.SafeLoader):
    pass


for tag in ("!lambda", "!include"):
    Loader.add_constructor(tag, lambda loader, node: loader.construct_scalar(node))
display = yaml.load((ROOT / "common/config/display.yaml").read_text(), Loader=Loader)
select = next(item for item in display["select"] if item.get("id") == "screensaver_action")
switch = next(item for item in display["switch"] if item.get("id") == "clock_screensaver_enabled")
assert select["options"] == ["Display Off", "Screen Dimmed", "Clock"]
assert select["initial_option"] == "Display Off"


def actions(items):
    if isinstance(items, dict):
        items = items.get("then", [items])
    result = ""
    for item in items:
        if "lambda" in item:
            result += "[&]() {\n" + item["lambda"] + "\n}();\n"
        elif "if" in item:
            branch = item["if"]
            result += "if ([&]() {" + branch["condition"]["lambda"] + "}()) {\n"
            result += actions(branch["then"]) + "}\n"
        elif "script.execute" in item:
            result += item["script.execute"] + ".execute();\n"
        elif "switch.turn_on" in item:
            result += "clock_changed(true);\n"
        elif "switch.turn_off" in item:
            result += "clock_changed(false);\n"
        elif "select.set" in item:
            assert item["select.set"]["id"] == "screensaver_action"
            result += "action_changed(" + json.dumps(item["select.set"]["option"]) + ");\n"
        else:
            raise AssertionError(f"Unhandled setting effect: {item}")
    return result


helpers = (ROOT / "components/espcontrol/backlight.h").read_text()
source = r'''
#include <cassert>
#include <string>
#include "display_mode_controller.h"
using namespace espcontrol;
#define id(name) name
DisplayModeController controller;
struct App { DisplayModeController &display() { return controller; } } espcontrol_app;
struct Select { std::string value; std::string current_option() const { return value; } } screensaver_action;
struct Switch { bool state = false; } clock_screensaver_enabled;
bool screensaver_action_clock = false, screensaver_action_dimmed = false;
struct Page { int obj = 1; } page, *main_page = &page;
int lv_scr_act() { return 1; }
struct Script { int calls = 0; void execute() { ++calls; } } screensaver_idle_check, display_mode_reconcile;
void action_changed(const std::string &value);
void clock_changed(bool on);
'''
for name in ("clock", "dimmed"):
    source += re.search(r"inline bool screensaver_action_" + name + r"_mode\([^}]+\}", helpers)[0] + "\n"
source += "void action_changed(const std::string &value) { screensaver_action.value = value;\n" + actions(select["on_value"]) + "}\n"
source += "void clock_changed(bool on) { clock_screensaver_enabled.state = on; if (on) {\n" + actions(switch["on_turn_on"]) + "} else {\n" + actions(switch["on_turn_off"]) + "}}\n"
source += r'''
void reset() {
  controller = DisplayModeController{};
  screensaver_action_clock = screensaver_action_dimmed = clock_screensaver_enabled.state = false;
  screensaver_idle_check.calls = display_mode_reconcile.calls = 0;
}
int main() {
  const DisplayMode modes[] = {DisplayMode::DISPLAY_OFF, DisplayMode::DIMMED, DisplayMode::CLOCK};
  const char *actions[] = {"Display Off", "Screen Dimmed", "Clock"};
  for (auto owner : {DisplayRequestSource::IDLE_TIMER, DisplayRequestSource::PRESENCE_SENSOR}) {
    for (auto initial : modes) {
      for (int next : {2, 1, 0}) {
        reset();
        assert(controller.request(owner, initial));
        assert(controller.complete_transition(controller.resolve()));
        action_changed(actions[next]);
        assert(controller.resolve().target_mode == modes[next]);
        assert(controller.resolve().winning_source == owner);
        assert(display_mode_reconcile.calls == 1 && screensaver_idle_check.calls == 0);
      }
    }
    reset();
    controller.request(owner, DisplayMode::DISPLAY_OFF);
    controller.complete_transition(controller.resolve());
    clock_changed(true);
    assert(controller.resolve().target_mode == DisplayMode::CLOCK);
    clock_changed(false);
    assert(controller.resolve().target_mode == DisplayMode::DISPLAY_OFF);
  }
  // No automatic sleep request may be introduced while awake or at boot.
  reset();
  action_changed("Clock");
  assert(controller.resolve().target_mode == DisplayMode::ACTIVE);
  assert(display_mode_reconcile.calls == 0 && screensaver_idle_check.calls > 0);
  assert(!controller.request_active(DisplayRequestSource::IDLE_TIMER));
  assert(!controller.request_active(DisplayRequestSource::PRESENCE_SENSOR));
  // Retarget an in-flight automatic transition; its stale completion is rejected.
  reset();
  controller.request(DisplayRequestSource::IDLE_TIMER, DisplayMode::DISPLAY_OFF);
  auto stale = controller.resolve();
  assert(controller.start_transition(stale, 1));
  action_changed("Clock");
  assert(controller.resolve().target_mode == DisplayMode::CLOCK);
  assert(!controller.complete_transition(stale));
  // Higher-priority requests must keep ownership and the hidden automatic mode.
  for (auto source : {DisplayRequestSource::SCREEN_SCHEDULE, DisplayRequestSource::MANUAL_SLEEP,
                     DisplayRequestSource::BOOT_GUARD, DisplayRequestSource::ONBOARDING,
                     DisplayRequestSource::USER_WAKE, DisplayRequestSource::MEDIA_PLAYBACK}) {
    reset();
    controller.request(DisplayRequestSource::IDLE_TIMER, DisplayMode::DISPLAY_OFF);
    auto mode = source == DisplayRequestSource::MEDIA_PLAYBACK ? DisplayMode::COVER_ART :
      (source == DisplayRequestSource::ONBOARDING || source == DisplayRequestSource::USER_WAKE ?
       DisplayMode::ACTIVE : DisplayMode::DISPLAY_OFF);
    assert(controller.request(source, mode));
    const auto before = controller.resolve();
    action_changed("Clock");
    assert(controller.resolve().generation == before.generation);
    assert(controller.resolve().winning_source == source);
    assert(controller.resolve().target_mode == mode && display_mode_reconcile.calls == 0);
    controller.clear(source);
    assert(controller.resolve().target_mode == DisplayMode::DISPLAY_OFF);
  }
  for (auto kind : {DisplayTakeoverKind::CRITICAL, DisplayTakeoverKind::INTERACTIVE}) {
    reset();
    controller.request(DisplayRequestSource::PRESENCE_SENSOR, DisplayMode::DIMMED);
    controller.begin_takeover(kind);
    action_changed("Clock");
    assert(controller.resolve().winning_takeover == kind && display_mode_reconcile.calls == 0);
    controller.end_takeover(kind);
    assert(controller.resolve().target_mode == DisplayMode::DIMMED);
  }
}
'''
with tempfile.TemporaryDirectory() as temporary:
    path = Path(temporary)
    (path / "test.cpp").write_text(source)
    subprocess.run([sys.argv[1] if len(sys.argv) > 1 else "c++", "-std=c++17", "-Wall", "-Wextra", "-Werror",
                    "-I", str(ROOT / "components/espcontrol"), str(path / "test.cpp"), "-o", str(path / "test")], check=True)
    subprocess.run([str(path / "test")], check=True)
print("Screensaver live-action callbacks and priority guards passed.")
