"""Execute production idle/screensaver lambdas against the real HA selection latch."""
from pathlib import Path
import subprocess
import sys
import tempfile
import yaml

ROOT = Path(__file__).resolve().parents[2]


class Loader(yaml.SafeLoader):
    pass


Loader.add_constructor("!lambda", lambda loader, node: loader.construct_scalar(node))
Loader.add_constructor("!include", lambda loader, node: loader.construct_scalar(node))


def script(path, name):
    config = yaml.load((ROOT / path).read_text(), Loader=Loader)
    return next(item for item in config["script"] if item["id"] == name)


def lambdas(value):
    if isinstance(value, list):
        for child in value:
            yield from lambdas(child)
    elif isinstance(value, dict):
        for key, child in value.items():
            if key == "lambda":
                yield child
            else:
                yield from lambdas(child)


backlight = "common/addon/backlight.yaml"
idle = script(backlight, "home_screen_idle_check")["then"][0]["if"]
restore = script(backlight, "home_screen_idle_restore")["then"][0]["if"]
source = r'''
#include <cassert>
#include <cmath>
#include <cstdint>
#include <string>
#include "entity_screen_navigation.h"
#define id(name) name
espcontrol::EntityScreenNavigation navigation;
int active_slot = 3, home_returns = 0;
bool entity_screen_navigation_holds_screen() { return navigation.holds_screen(active_slot); }
bool entity_screen_navigation_preserves_screen() { return entity_screen_navigation_holds_screen(); }
struct Number { float state; } home_screen_timeout{1};
struct Text { std::string state; } button_order{"1,2,3"};
bool connectivity_setup_display_active = false;
bool alarm_display_takeover_active() { return false; }
uint32_t lv_disp_get_inactive_time(void *) { return 10000; }
struct Page { void *obj = nullptr; } page;
Page *main_page = &page;
void navigation_return_home(void *) { ++home_returns; active_slot = 0; }
namespace espcontrol { enum class DisplayTakeoverKind { INTERACTIVE, CRITICAL }; }
struct Controller { bool takeover_active(espcontrol::DisplayTakeoverKind) const { return false; } } controller;
struct App { Controller &display() { return controller; } } espcontrol_app;
'''
source += "bool idle_started() {" + idle["condition"]["lambda"] + "}\n"
source += "bool restore_due() {" + restore["condition"]["lambda"] + "}\n"
functions = []
for name, item in [
    ("idle_elapsed", idle["then"]),
    ("restore", restore["then"]),
    ("sleep", script(backlight, "screensaver_sleep_timer")),
    ("clock_entry", script(backlight, "show_clock_view")),
    ("cover_art", script("common/device/screen_cover_art.yaml", "display_mode_effect_cover_art")),
]:
    bodies = [body for body in lambdas(item) if "navigation_return_home(" in body]
    assert len(bodies) == 1, (name, len(bodies))
    source += f"void {name}() {{\n{bodies[0]}\n}}\n"
    functions.append(name)
source += r'''
int main() {
  navigation.configure("input_select.screen", "3\tMusic\n4\tWork", true);
  assert(idle_started() && restore_due());
  navigation.receive(navigation.generation(), "Music");
  navigation.complete_navigation();
  assert(!idle_started() && !restore_due());
'''
for name in functions:
    source += f"{name}(); assert(active_slot == 3 && home_returns == 0);\n"
source += r'''
  // A later unmatched/offline state must not kick the displayed screen home.
  navigation.receive(navigation.generation(), "unavailable");
  idle_elapsed(); assert(active_slot == 3 && home_returns == 0);
  // Selection may arrive after the home timer started: the delayed action rechecks.
  active_slot = 4;
  assert(idle_started() && restore_due());
  navigation.receive(navigation.generation(), "Work");
  navigation.complete_navigation();
  idle_elapsed(); assert(active_slot == 4 && home_returns == 0);
  // Explicit manual navigation away retains the ordinary timeout behavior.
  active_slot = 5;
  assert(idle_started() && restore_due());
  idle_elapsed(); assert(active_slot == 0 && home_returns == 1);
  navigation.configure("", "", true);
'''
for index, name in enumerate(functions, start=2):
    source += f"active_slot = 3; {name}(); assert(active_slot == 0 && home_returns == {index});\n"
source += "}\n"

with tempfile.TemporaryDirectory(prefix="entity-screen-idle-") as directory:
    cpp, binary = Path(directory) / "test.cpp", Path(directory) / "test"
    cpp.write_text(source)
    subprocess.run([sys.argv[1] if len(sys.argv) > 1 else "c++", "-std=c++17",
                    "-Wall", "-Wextra", "-Werror", "-UNDEBUG",
                    "-I", str(ROOT / "components/espcontrol"), str(cpp), "-o", str(binary)], check=True)
    subprocess.run([str(binary)], check=True)
print("HA screen selection survives idle timers and screensaver entry.")
