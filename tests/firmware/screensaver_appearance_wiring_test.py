"""Execute the authored appearance/setting/tick YAML lambdas with real helpers.

Only ESPHome id(), time, script dispatch and LVGL are doubled. Assert the visible
label changes while CLOCK, not before widget setup or outside CLOCK, and that
setting edits do not call brightness or transition presentation paths.
"""
import yaml
from screensaver_appearance_test import ROOT, helper_source, section, run_cases


class Loader(yaml.SafeLoader):
    pass


Loader.add_constructor("!lambda", lambda loader, node: loader.construct_scalar(node))


def config(path):
    return yaml.load((ROOT / path).read_text(), Loader=Loader)


def by_id(items, name):
    result = next((item for item in items if item.get("id") == name), None)
    assert result is not None, f"Missing firmware setting/script {name}"
    return result


def actions(items):
    if isinstance(items, dict):
        items = items.get("then", [items])
    result = ""
    for item in items:
        if "lambda" in item:
            result += "[&]() {\n" + item["lambda"] + "\n}();\n"
        elif "script.execute" in item:
            result += item["script.execute"] + ".execute();\n"
        elif "if" in item:
            condition = item["if"]["condition"]["lambda"]
            result += "if ([&]() {" + condition + "}()) {\n" + actions(item["if"]["then"]) + "}\n"
        else:
            raise AssertionError(f"Unexpected effect in appearance path: {item}")
    return result


def script_calls(value):
    if isinstance(value, list):
        return [call for item in value for call in script_calls(item)]
    if isinstance(value, dict):
        return [value["script.execute"]] if "script.execute" in value else [
            call for item in value.values() for call in script_calls(item)]
    return []


display = config("common/config/display.yaml")
backlight = config("common/addon/backlight.yaml")
schedule = config("common/addon/backlight_schedule.yaml")
font = by_id(display["select"], "screensaver_clock_font")
assert font["restore_value"] and font["optimistic"]
assert font["initial_option"] == "Roboto Thin"
assert font["options"] == ["Roboto Thin", "Roboto Bold", "Roboto Mono"]
assert font["name"] == "${entity_screen_saver_clock_font}"
assert by_id(display["select"], "screensaver_action")["initial_option"] == "Display Off"
appearance = by_id(backlight["script"], "clock_screensaver_refresh_appearance")
color = by_id(schedule["text"], "schedule_clock_text_color")
entry = by_id(backlight["script"], "show_clock_view")
assert script_calls(entry).count("clock_screensaver_refresh_appearance") == 1
interval = next(item for item in backlight["interval"] if item["interval"] == "30s")

source = helper_source + section("clock_bar.h", "inline void format_clock_time_without_suffix(",
                                 "inline void format_fixed_decimal(")
source += r'''
#define id(name) name
namespace espcontrol { enum class DisplayMode { ACTIVE, CLOCK }; }
struct Controller {
  espcontrol::DisplayMode mode = espcontrol::DisplayMode::ACTIVE;
  bool current_mode_is(espcontrol::DisplayMode value) const { return mode == value; }
} controller;
struct Application { Controller &display() { return controller; } } espcontrol_app;
struct Select { std::string option = "Roboto Thin"; std::string current_option() const { return option; } } screensaver_clock_font;
struct Text { std::string state = "FFFFFF"; } schedule_clock_text_color;
struct Time {
  bool valid = true; int hour = 12, minute = 34;
  bool is_valid() const { return valid; }
} current_time;
struct TimeSource { Time now() const { return current_time; } } panel_time, homeassistant_time;
Time panel_time_or_fallback(Time first, Time second) { return first.is_valid() ? first : second; }
struct Font {
  lv_font_t font;
  const lv_font_t *get_lv_font() const { return &font; }
} thin{{70,180}}, bold{{90,190}}, mono{{96,200}};
Font *font_number_clock = &thin, *font_number_clock_bold = &bold, *font_number_clock_mono = &mono;
lv_obj_t *clock_label = nullptr, *clock_screensaver = nullptr;
bool clock_format_12h = false;
int brightness_calls = 0;
struct BrightnessScript { void execute() { ++brightness_calls; } } clock_screensaver_refresh_brightness;
struct AppearanceScript { void execute(); } clock_screensaver_refresh_appearance;
'''
source += "void AppearanceScript::execute() {\n" + actions(appearance["then"]) + "}\n"
source += "void font_changed() {\n" + actions(font["on_value"]) + "}\n"
source += "void color_changed() {\n" + actions(color["on_value"]) + "}\n"
source += "void tick() {\n" + actions(interval["then"]) + "}\n"
source += r'''
int main(int argc, char **) {
  assert(argc == 2);
  // Restored template settings may fire before LVGL widget construction.
  font_changed(); color_changed(); clock_screensaver_refresh_appearance.execute();
  assert(writes.font == 0 && writes.text == 0 && writes.color == 0);
  lv_obj_t root, overlay, label;
  root.width = root.height = 480;
  overlay.parent = &root; label.parent = &overlay; label.label = true;
  clock_label = &label; clock_screensaver = &overlay;
  screensaver_clock_font.option = "Roboto Bold";
  font_changed(); color_changed(); tick();
  assert(writes.font == 0 && writes.text == 0 && writes.color == 0 && brightness_calls == 0);
  // Entry invokes appearance before the controller completes CLOCK transition.
  clock_screensaver_refresh_appearance.execute();
  assert((label.local.at({LV_STYLE_TEXT_FONT, LV_PART_MAIN}).ptr == bold.get_lv_font()));
  assert(label.text == "12:34" && brightness_calls == 0);
  controller.mode = espcontrol::DisplayMode::CLOCK;
  screensaver_clock_font.option = "Roboto Mono";
  font_changed();
  assert((label.local.at({LV_STYLE_TEXT_FONT, LV_PART_MAIN}).ptr == mono.get_lv_font()));
  assert(label.width == 480 && label.x == 0 && brightness_calls == 0);
  schedule_clock_text_color.state = "123456";
  color_changed();
  assert((label.local.at({LV_STYLE_TEXT_COLOR, LV_PART_MAIN}).color == 0x123456));
  assert(writes.font == 2 && writes.text == 1 && writes.color == 2 && brightness_calls == 0);
  font_changed(); color_changed();
  assert(writes.font == 2 && writes.text == 1 && writes.color == 2 && brightness_calls == 0);
  current_time.hour = 1; current_time.minute = 23; clock_format_12h = true;
  tick();
  assert(label.text == "1:23" && label.width == 384 && writes.text == 2 && brightness_calls == 1);
  current_time.valid = false;
  screensaver_clock_font.option = "unsupported";
  font_changed();
  assert((label.local.at({LV_STYLE_TEXT_FONT, LV_PART_MAIN}).ptr == thin.get_lv_font()));
  assert(label.text == "1:23" && writes.text == 2 && brightness_calls == 1);
  std::cout << "YAML live appearance, restore guards, entry and tick passed\n";
}
'''
run_cases(source, ("yaml_wiring",))
