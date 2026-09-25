"""Compile actual main-button YAML actions plus the production media press path."""
from pathlib import Path
import os
import re
import subprocess
import tempfile
import ast

ROOT = Path(__file__).resolve().parents[2]
HEADERS = ROOT / "components/espcontrol"
# Parse only the indentation-based automation subset used by this widget.
# This keeps the host suite dependency-free, and rejects unknown action kinds.
widget_text = (ROOT / "common/device/button_widget.yaml").read_text()
class Node:
    def __init__(self, text, indent):
        self.text, self.indent, self.children = text, indent, []
root = Node("", -1)
stack = [root]
for line in widget_text.splitlines():
    if not line.strip() or line.lstrip().startswith("#"):
        continue
    indent = len(line) - len(line.lstrip())
    node = Node(line.strip(), indent)
    while stack[-1].indent >= indent:
        stack.pop()
    stack[-1].children.append(node)
    stack.append(node)

def lines(node):
    return [node.text] + [text for child in node.children for text in lines(child)]

def scalar(node):
    value = node.text.split(":", 1)[1].strip()
    if value == "|-":
        return " ".join(text for child in node.children for text in lines(child))
    return ast.literal_eval(value) if value.startswith(("'", '\"')) else value

def mapping(node):
    result = {}
    for child in node.children:
        key = child.text.split(":", 1)[0].removeprefix("- ")
        if child.text.endswith(":"):
            result[key] = [mapping_action(item) for item in child.children] if key in ("then", "else") else mapping(child)
        else:
            result[key] = scalar(child)
    return result

def mapping_action(node):
    key = node.text.split(":", 1)[0].removeprefix("- ")
    return {key: mapping(node) if node.text.endswith(":") else scalar(node)}

button_node = next(node for node in root.children if node.text == "button:")
widget = {node.text[:-1]: [mapping_action(item) for item in node.children]
          for node in button_node.children if node.text.startswith("on_")}
assert "on_short_click" in widget and "on_click" not in widget

def emit(actions):
    result = []
    for action in actions:
        if "if" in action:
            item = action["if"]
            result.append("if ([&]() { " + item["condition"]["lambda"] + " }()) {\n" + emit(item.get("then", [])) + "\n} else {\n" + emit(item.get("else", [])) + "\n}")
        elif "lambda" in action:
            result.append(action["lambda"])
        elif "globals.set" in action:
            result.append(action["globals.set"]["id"] + " = " + action["globals.set"]["value"] + ";")
        elif "script.execute" in action:
            assert action["script.execute"] == "screensaver_wake"
            result.append("awake = true;")
        else:
            assert action.get("script.stop") == "screensaver_wake_touch_guard_clear"
    return "\n".join(result).replace("${num}", "1")

def function(source, name):
    matches = re.findall(r"^inline [^\n]*\b" + name + r"\([^;]*?\{\n.*?^\}", source, re.M | re.S)
    assert len(matches) == 1, name
    return matches[0] + "\n"

source = (ROOT / "tests/firmware/long_press_runtime_test.cpp").read_text().replace("int main() {", "int runtime_checks() {")
source = source[:source.rfind("}")] + "return 0;\n}" + source[source.rfind("}")+1:]
source += r'''
#include <functional>
#define ESP_LOGD(...) ((void)0)
#define id(x) (x)
constexpr int LV_STATE_PRESSED = 1;
void lv_obj_clear_state(lv_obj_t *, int) {}
bool button_press_opens_modal(const ParsedCfg &, lv_obj_t *) { return false; }
int ha_actions = 0;
void send_media_playback_action(const std::string &, const std::string &) { ++ha_actions; }
'''
actions = (HEADERS / "button_grid_actions.h").read_text()
for name in ("media_card_mode", "media_playback_button_mode", "media_fast_press_mode", "media_fast_press_slots", "handle_button_press"):
    source += function(actions, name)
source += function((HEADERS / "button_grid_media.h").read_text(), "media_control_modal_mode")
source += "void send_media_playlist_action(const ParsedCfg &) { ++ha_actions; }\n"
media = (HEADERS / "button_grid_media_driver.h").read_text()
source += "namespace espcontrol::cards {\n"
for name in ("media_driver_matches", "media_driver_handle_click", "media_driver_subpage_clickable"):
    source += function(media, name)
source += r'''
struct MediaDriverEnvironment { std::function<void(const std::string &)> add_parent_indicator; };
struct BtnSlot { lv_obj_t *btn; };
void media_driver_bind_data(BtnSlot &, const ParsedCfg &, const Context &, const MediaDriverEnvironment &) {}
void media_playback_detach_button(lv_obj_t *) {}
std::vector<ParsedCfg *> saved_configs;
ParsedCfg *grid_delete_with_owner(lv_obj_t *, ParsedCfg *config) { saved_configs.push_back(config); return config; }
'''
source += function(media, "media_driver_bind_subpage") + "}\n"
source = source.replace("inline void handle_button_click(const std::string &, int, lv_obj_t *) { ++taps; }", "void handle_button_click(const std::string &, int, lv_obj_t *);")
source += r'''
void handle_button_click(const std::string &saved, int, lv_obj_t *button) {
  ++taps;
  ParsedCfg config = parse_cfg(saved);
  if (config.type == "media") espcontrol::cards::media_driver_handle_click(card_runtime_context(config), config, button);
}
bool awake = true, screensaver_wake_touch_guard_active = false;
namespace espcontrol { enum class DisplayMode { ACTIVE }; }
struct App {
  App &display() { return *this; }
  bool target_mode_is(espcontrol::DisplayMode) { return awake; }
} espcontrol_app;
lv_obj_t tile;
lv_obj_t *button_1 = &tile;
struct { std::string state; } button_1_config;
'''
for trigger in ("on_press", "on_short_click", "on_long_press"):
    source += "void " + trigger + "() {\n" + emit(widget[trigger]) + "\n}\n"
source += r'''
int main() {
  runtime_checks();
  for (const std::string type : {"", "light_switch"}) {
    taps = info_opens = control_opens = ha_actions = 0;
    button_1_config.state = "light.kitchen;Kitchen;Auto;Auto;;;" + type + ";;";
    on_press(); on_long_press(); on_long_press();
    // LVGL emits CLICKED on release after LONG_PRESSED, never SHORT_CLICKED.
    assert(control_opens == 1 && taps == 0 && ha_actions == 0);
    on_press(); on_short_click();
    assert(taps == 1 && control_opens == 1);
    light_control_hide_modal();
  }
  for (const std::string mode : {"next", "previous"}) {
    taps = info_opens = control_opens = ha_actions = 0;
    button_1_config.state = "media_player.room;Room;Auto;Auto;" + mode + ";;media;;";
    on_press();
    assert(ha_actions == 0);
    on_long_press(); on_long_press();
    assert(ha_actions == 0 && taps == 0 && info_opens == 1);
    on_press(); on_short_click();
    assert(taps == 1 && ha_actions == 1);
    // Actual media subpage binder must wait for CLICKED while hold is enabled.
    lv_obj_t subpage;
    auto config = parse_cfg(button_1_config.state);
    attach_subpage_long_press(&subpage, config);
    espcontrol::cards::BtnSlot slot{&subpage};
    espcontrol::cards::media_driver_bind_subpage(slot, config,
      card_runtime_context(config, espcontrol::cards::Surface::SUBPAGE), {});
    ha_actions = info_opens = 0;
    dispatch(subpage, LV_EVENT_PRESSED);
    assert(ha_actions == 0);
    dispatch(subpage, LV_EVENT_LONG_PRESSED);
    dispatch(subpage, LV_EVENT_LONG_PRESSED);
    dispatch(subpage, LV_EVENT_RELEASED);
    dispatch(subpage, LV_EVENT_CLICKED);
    assert(ha_actions == 0 && info_opens == 1);
    dispatch(subpage, LV_EVENT_PRESSED);
    dispatch(subpage, LV_EVENT_RELEASED);
    dispatch(subpage, LV_EVENT_CLICKED);
    assert(ha_actions == 1);
    dispatch(subpage, LV_EVENT_DELETE);
  }
  for (bool guarded : {false, true}) {
    taps = info_opens = control_opens = ha_actions = 0;
    awake = guarded;
    screensaver_wake_touch_guard_active = guarded;
    on_press(); on_long_press(); on_long_press();
    assert(taps == 0 && info_opens == 0 && control_opens == 0 && ha_actions == 0);
  }
  for (auto *config : espcontrol::cards::saved_configs) delete config;
}
'''
with tempfile.TemporaryDirectory(prefix="long-press-routing-") as temp:
    cpp, binary = Path(temp) / "test.cpp", Path(temp) / "test"
    cpp.write_text(source)
    subprocess.run([os.environ.get("CXX", "c++"), "-std=c++17", "-Wall", "-Wextra", "-Werror", "-I", str(HEADERS), "-I", str(ROOT / "tests/firmware/stubs"), str(cpp), "-o", str(binary)], check=True)
    subprocess.run([str(binary)], check=True)
print("Actual YAML short-click/hold/wake routing and media press suppression passed")
