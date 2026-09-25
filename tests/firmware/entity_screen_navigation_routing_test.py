"""Run production page-routing actions with the real HA navigation adapter.

Brightness, labels, delays and overlay drawing are omitted. Page replacements,
relevant conditions, and calls between wake/reconnect scripts execute in order.
"""
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

def config(path):
    return yaml.load((ROOT / path).read_text(), Loader=Loader)

def script(document, name):
    return next(item["then"] for item in document["script"] if item["id"] == name)

def actions(items):
    result = ""
    for item in items:
        for key, value in item.items():
            if key == "lvgl.page.show":
                result += f"active_page = {value}->obj;\n"
            elif key == "lambda" and any(token in value for token in
                    ("entity_screen_navigation", "navigation_return_home")):
                result += value + "\n"
            elif key == "script.execute" and value == "navigate_after_api":
                result += "navigate_after_api();\n"
            elif key == "if":
                then = actions(value.get("then", []))
                otherwise = actions(value.get("else", []))
                if then or otherwise:
                    condition = value["condition"]["lambda"]
                    result += f"if ([&]() {{ {condition} }}()) {{\n{then}}} else {{\n{otherwise}}}\n"
            elif key == "wait_until":
                condition = value["condition"]["lambda"]
                result += f"if (!([&]() {{ {condition} }}())) return;\n"
    return result

PRELUDE = r'''
#include <cassert>
#include <cstdint>
#include <functional>
#include <string>
#include "esphome/core/string_ref.h"
#define id(name) name
struct lv_obj_t { int id; } home{0}, subpage{3}, other{4}, off{-1}, setup{-2}, wifi{-3}, ethernet{-4};
struct Page { lv_obj_t *obj; } home_wrapper{&home}, off_wrapper{&off}, setup_wrapper{&setup}, wifi_wrapper{&wifi}, ethernet_wrapper{&ethernet};
Page *main_page=&home_wrapper, *screen_off_page=&off_wrapper, *button_setup_page=&setup_wrapper,
     *wifi_setup_page=&wifi_wrapper, *ethernet_setup_page=&ethernet_wrapper;
lv_obj_t *active_page=&home;
lv_obj_t *lv_scr_act() { return active_page; }
struct NavigationSubpageEntry { lv_obj_t *screen; } entry{&subpage};
bool has_subpage=true;
uint32_t grid_generation=1;
uint32_t ha_subscription_generation() { return grid_generation; }
NavigationSubpageEntry *navigation_find_slot(int slot) { return has_subpage && slot==3 ? &entry : nullptr; }
int navigation_active_subpage_slot() { return has_subpage && active_page==entry.screen ? 3 : 0; }
bool navigation_restore_subpage_slot(int slot) {
  auto *target=navigation_find_slot(slot);
  if (!target) return false;
  active_page=target->screen;
  return true;
}
void navigation_hide_modals() {}
bool navigation_return_home(lv_obj_t *page) { active_page=page; return true; }
void ha_reset_subscription_callbacks(uint32_t) {}
void ha_reannounce_state_subscriptions() {}
void ha_subscribe_state(const std::string &, std::function<void(esphome::StringRef)>, uint32_t) {}
std::string string_ref_limited(esphome::StringRef value, size_t) { return std::string(value.c_str(), value.size()); }
#include "button_grid_entity_screen_navigation.h"
namespace espcontrol {
enum class DisplayMode { ACTIVE, CLOCK, COVER_ART, DISPLAY_OFF };
enum class DisplayTakeoverKind { INTERACTIVE, CRITICAL };
}
using espcontrol::DisplayMode;
bool protected_display=false, locked=false, alarm=false, connectivity_setup_display_active=false;
bool screen_lock_enabled() { return locked; }
bool alarm_display_takeover_active() { return alarm; }
struct Controller {
  DisplayMode mode=DisplayMode::ACTIVE;
  bool target_mode_is(DisplayMode target) const { return mode==target; }
  bool takeover_active(espcontrol::DisplayTakeoverKind) const { return protected_display; }
  bool transition_is_current(uint32_t, DisplayMode target) { return target_mode_is(target); }
} controller;
struct App { Controller &display() { return controller; } } espcontrol_app;
struct Text { std::string state="1,3"; } button_order;
void navigate_after_api();
void selected() {
  entity_screen_navigation() = espcontrol::EntityScreenNavigation{};
  configure_entity_screen_navigation("input_select.screen", "0\tHome\n3\tMusic", true);
  entity_screen_navigation().receive(entity_screen_navigation().generation(), "Music");
  espcontrol::ScreenNavigationConditions conditions;
  conditions.ready=true; conditions.active=true;
  step_entity_screen_navigation(conditions, &home);
  controller.mode=DisplayMode::ACTIVE;
  protected_display=false; button_order.state="1,3";
  assert(active_page==&subpage);
}
'''

backlight = config("common/addon/backlight.yaml")
cover = config("common/device/screen_cover_art.yaml")
failures = []
for variant in ("connectivity", "connectivity_deployed", "connectivity_ethernet"):
    network = config(f"common/addon/{variant}.yaml")
    source = PRELUDE
    source += "void navigate_after_api() {\n" + actions(script(network, "navigate_after_api")) + "}\n"
    source += "void display_off() {\n" + actions(script(backlight, "display_mode_effect_off")) + "}\n"
    source += "void wake(int previous_mode) {\n" + actions(script(backlight, "display_mode_effect_active")) + "}\n"
    source += "void clock_entry(int generation) {\n" + actions(script(backlight, "show_clock_view")) + "}\n"
    source += "void cover_entry() {\n" + actions(script(cover, "display_mode_effect_cover_art")) + "}\n"
    disconnect_actions = (network["ethernet"]["on_disconnect"][-1]["if"]["then"]
                          if variant == "connectivity_ethernet" else script(network, "wifi_show_reconnecting"))
    source += "void disconnected() {\n" + actions(disconnect_actions) + "}\n"
    source += r'''
int main(int argc, char **argv) {
  assert(argc==2);
  std::string scenario=argv[1];
  selected();
  if (scenario=="brief_reconnect") {
    navigate_after_api(); assert(active_page==&subpage);
  } else if (scenario=="off_wake" || scenario=="off_clock_wake" || scenario=="off_cover_wake") {
    controller.mode=DisplayMode::DISPLAY_OFF;
    display_off(); assert(active_page==&off);
    DisplayMode previous=DisplayMode::DISPLAY_OFF;
    if (scenario=="off_clock_wake") {
      previous=DisplayMode::CLOCK; controller.mode=previous; clock_entry(1);
    } else if (scenario=="off_cover_wake") {
      previous=DisplayMode::COVER_ART; controller.mode=previous; cover_entry();
    }
    controller.mode=DisplayMode::ACTIVE; wake(static_cast<int>(previous));
    assert(active_page==&subpage);
  } else if (scenario=="long_reconnect") {
    disconnected(); assert(active_page!=&subpage);
    navigate_after_api(); assert(active_page==&subpage);
  } else if (scenario=="nested_takeover") {
    display_off(); disconnected(); display_off();
    navigate_after_api(); assert(active_page==&subpage);
  } else if (scenario=="manual_away") {
    active_page=&other; display_off(); navigate_after_api(); assert(active_page==&home);
    selected(); display_off(); active_page=&other;
    navigate_after_api(); assert(active_page==&home);
  } else if (scenario=="disabled" || scenario=="reconfigured" || scenario=="removed" || scenario=="replaced" || scenario=="rebuilt") {
    display_off();
    if (scenario=="disabled") configure_entity_screen_navigation("", "", true);
    if (scenario=="reconfigured") configure_entity_screen_navigation("sensor.other", "3\tMusic", true);
    if (scenario=="removed") has_subpage=false;
    if (scenario=="replaced") entry.screen=&other;
    if (scenario=="rebuilt") ++grid_generation;
    navigate_after_api(); assert(active_page==&home);
  } else if (scenario=="setup") {
    display_off(); button_order.state=""; navigate_after_api(); assert(active_page==&setup);
  } else if (scenario=="locked_disabled" || scenario=="locked_restore" || scenario=="locked_pending") {
    if (scenario=="locked_disabled") {
      configure_entity_screen_navigation("", "", true);
      active_page=&home; // The locked controls page contains the clickable unlock card.
    }
    locked=true; // Already locked before sleep, as when using the Screen Lock card.
    controller.mode=DisplayMode::DISPLAY_OFF;
    display_off(); assert(active_page==&off);
    if (scenario=="locked_pending") {
      entity_screen_navigation().receive(entity_screen_navigation().generation(), "Home");
    }
    controller.mode=DisplayMode::ACTIVE;
    wake(static_cast<int>(DisplayMode::DISPLAY_OFF));
    assert(locked); // Present controls without silently unlocking them.
    assert(active_page==(scenario=="locked_disabled" ? &home : &subpage));
    if (scenario=="locked_pending") {
      espcontrol::ScreenNavigationConditions conditions;
      conditions.ready=true; conditions.active=true; conditions.locked=locked;
      assert(step_entity_screen_navigation(conditions, &home)==espcontrol::ScreenNavigationAction::WAIT);
      assert(active_page==&subpage && entity_screen_navigation().pending_target()==0);
      locked=false; conditions.locked=false;
      assert(step_entity_screen_navigation(conditions, &home)==espcontrol::ScreenNavigationAction::NAVIGATE);
      assert(active_page==&home && !entity_screen_navigation().pending_target());
    } else {
      assert(!entity_screen_navigation().pending_target()); // Restore is not a new HA selection.
    }
  } else if (scenario=="protected" || scenario=="alarm" || scenario=="setup_takeover") {
    display_off();
    protected_display=scenario=="protected";
    alarm=scenario=="alarm"; connectivity_setup_display_active=scenario=="setup_takeover";
    navigate_after_api(); assert(active_page==&off);
    protected_display=false; locked=false; alarm=false; connectivity_setup_display_active=false;
    navigate_after_api(); assert(active_page==&subpage);
  } else { assert(false); }
}
'''
    with tempfile.TemporaryDirectory(prefix="entity-screen-routing-") as directory:
        cpp, binary = Path(directory)/"test.cpp", Path(directory)/"test"
        cpp.write_text(source)
        subprocess.run([sys.argv[1] if len(sys.argv)>1 else "c++", "-std=c++17", "-Wall", "-Wextra", "-Werror",
                        "-UNDEBUG", "-I", str(ROOT/"tests/firmware/stubs"), "-I", str(ROOT/"components/espcontrol"),
                        str(cpp), "-o", str(binary)], check=True)
        for scenario in ("brief_reconnect", "off_wake", "off_clock_wake", "off_cover_wake", "long_reconnect",
                         "nested_takeover", "manual_away", "disabled", "reconfigured", "removed", "replaced", "rebuilt", "setup", "protected", "locked_disabled", "locked_restore", "locked_pending", "alarm", "setup_takeover"):
            result = subprocess.run([str(binary), scenario], capture_output=True, text=True)
            if result.returncode:
                failures.append(f"{variant}/{scenario}: {result.stderr.strip()}")
if failures:
    raise AssertionError("\n".join(failures))
print("All three network variants preserve HA selection through reconnect and off/clock/cover wake routing.")
