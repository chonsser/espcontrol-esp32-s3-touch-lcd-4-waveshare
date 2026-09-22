"""Execute the authored appearance/setting/tick YAML lambdas with real helpers.

Only ESPHome id(), time, script dispatch and LVGL are doubled. Assert the visible
label changes while CLOCK, not before widget setup or outside CLOCK, and that
setting edits do not call brightness or transition presentation paths.
"""
import yaml
from screensaver_appearance_test import ROOT, helper_source, run_cases


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
seconds_interval = next(item for item in backlight["interval"] if item["interval"] == "1s")
settings = {}
for kind in ("time", "date"):
    name = f"screensaver_clock_{kind}_format"
    item = settings[name] = by_id(display["text"], name)
    assert item["restore_value"] and item["optimistic"]
    assert item["initial_value"] == "" and item["max_length"] == 32
    assert item["update_interval"] == "never"
    assert item["name"] == "${entity_screen_saver_clock_" + kind + "_format}"
    name = f"screensaver_clock_{kind}_size"
    item = settings[name] = by_id(display["select"], name)
    assert item["restore_value"] and item["optimistic"]
    assert item["initial_option"] == "Auto" and item["options"] == ["Auto", "Small", "Medium", "Large"]
    assert item["name"] == "${entity_screen_saver_clock_" + kind + "_size}"
screen_clock = config("common/device/screen_clock.yaml")
clock_obj = next(widget["obj"] for widget in screen_clock["lvgl"]["top_layer"]["widgets"]
                 if widget["obj"]["id"] == "clock_screensaver")
labels = [widget["label"] for widget in clock_obj["widgets"]]
assert by_id(labels, "clock_date_label")["hidden"]
for family in ("", "_bold", "_mono"):
    for size in (24, 40, 64, 96, 128):
        item = by_id(screen_clock["font"], f"font_number_clock{family}_{size}")
        assert item["size"] == size and item["bpp"] == 4
        assert set(item["glyphs"]) == set(" 0123456789:./-")

source = helper_source
source += r'''
#define id(name) name
namespace espcontrol { enum class DisplayMode { ACTIVE, CLOCK }; }
struct Controller {
  espcontrol::DisplayMode mode = espcontrol::DisplayMode::ACTIVE;
  bool current_mode_is(espcontrol::DisplayMode value) const { return mode == value; }
} controller;
struct Application { Controller &display() { return controller; } } espcontrol_app;
struct Select { std::string option = "Roboto Thin"; std::string current_option() const { return option; } } screensaver_clock_font;
struct Text { std::string state; } schedule_clock_text_color{"FFFFFF"}, screensaver_clock_time_format, screensaver_clock_date_format;
Select screensaver_clock_time_size{"Auto"}, screensaver_clock_date_size{"Auto"};
struct Time {
  bool valid = true; int hour = 12, minute = 34, second = 0, day_of_month = 18, month = 9, year = 2026;
  bool is_valid() const { return valid; }
} current_time;
struct TimeSource { Time now() const { return current_time; } } panel_time, homeassistant_time;
Time panel_time_or_fallback(Time first, Time second) { return first.is_valid() ? first : second; }
struct Font {
  lv_font_t font;
  const lv_font_t *get_lv_font() const { return &font; }
} thin{{70,180}}, bold{{90,190}}, mono{{96,200}};
Font *font_number_clock = &thin, *font_number_clock_bold = &bold, *font_number_clock_mono = &mono;
lv_obj_t *clock_label = nullptr, *clock_date_label = nullptr, *clock_screensaver = nullptr;
bool clock_format_12h = false;
int brightness_calls = 0, appearance_calls = 0, stacking_calls = 0, reconcile_calls = 0;
struct StackingScript { void execute() { ++stacking_calls; } } clock_screensaver_keep_on_top;
struct ReconcileScript { void execute() { ++reconcile_calls; } } display_mode_reconcile;
struct BrightnessScript { void execute() { ++brightness_calls; } } clock_screensaver_refresh_brightness;
struct AppearanceScript { void execute(); } clock_screensaver_refresh_appearance;
'''
for family in ("", "_bold", "_mono"):
    for size in (24, 40, 64, 96, 128):
        name = f"font_number_clock{family}_{size}"
        source += f'Font storage{name}{{{{{int(size * .6)}, {int(size * 1.3)}}}}}; Font *{name} = &storage{name};\n'
source += "void AppearanceScript::execute() {\n++appearance_calls;\n" + actions(appearance["then"]).replace("${clock_font_size}", "160") + "}\n"
source += "void font_changed() {\n" + actions(font["on_value"]) + "}\n"
source += "void color_changed() {\n" + actions(color["on_value"]) + "}\n"
source += "void tick() {\n" + actions(interval["then"]) + "}\n"
source += "void second_tick() {\n" + actions(seconds_interval["then"]) + "}\n"
for name, item in settings.items():
    source += f"void {name}_changed() {{\n" + actions(item["on_value"]) + "}\n"
source += r'''
int main(int argc, char **) {
  assert(argc == 2);
  // Restored template settings may fire before LVGL widget construction.
  font_changed(); color_changed(); clock_screensaver_refresh_appearance.execute();
  assert(writes.font == 0 && writes.text == 0 && writes.color == 0);
  screensaver_clock_time_format_changed(); screensaver_clock_date_format_changed();
  screensaver_clock_time_size_changed(); screensaver_clock_date_size_changed();
  lv_obj_t root, overlay, label, date;
  root.width = root.height = 480;
  overlay.parent = &root; label.parent = &overlay; label.label = true;
  date.parent = &overlay; date.label = true; date.flags = LV_OBJ_FLAG_HIDDEN;
  clock_label = &label; clock_date_label = &date; clock_screensaver = &overlay;
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
  current_time.valid = true;
  const auto no_seconds = appearance_calls;
  second_tick();
  assert(appearance_calls == no_seconds && brightness_calls == 1);
  screensaver_clock_time_format.state = "%I:%M:%S";
  screensaver_clock_time_format_changed();
  assert(label.text == "01:23:00" && brightness_calls == 1);
  screensaver_clock_date_format.state = "%d.%m.%Y";
  screensaver_clock_date_format_changed();
  assert(date.text == "18.09.2026" && !lv_obj_has_flag(&date, LV_OBJ_FLAG_HIDDEN));
  const auto first = writes;
  current_time.second = 1; second_tick();
  assert(label.text == "01:23:01" && date.text == "18.09.2026");
  assert(writes.text == first.text + 1 && writes.font == first.font && writes.color == first.color);
  assert(writes.size == first.size && writes.pos == first.pos && writes.pad == first.pad && writes.flag == first.flag);
  assert(brightness_calls == 1);
  screensaver_clock_time_size.option = "Small";
  screensaver_clock_time_size_changed();
  assert((label.local.at({LV_STYLE_TEXT_FONT, LV_PART_MAIN}).ptr == font_number_clock_64->get_lv_font()));
  screensaver_clock_date_size.option = "Small";
  screensaver_clock_date_size_changed();
  assert((date.local.at({LV_STYLE_TEXT_FONT, LV_PART_MAIN}).ptr == font_number_clock_24->get_lv_font()));
  screensaver_clock_time_format.state = "bad %S";
  screensaver_clock_time_format_changed();
  assert(label.text == "1:23");
  screensaver_clock_date_format.state = "%S";
  screensaver_clock_date_format_changed();
  current_time.second = 2; second_tick();
  assert(date.text == "02" && label.text == "1:23" && brightness_calls == 1);
  screensaver_clock_date_format.state = "%S%p";
  screensaver_clock_date_format_changed();
  assert(lv_obj_has_flag(&date, LV_OBJ_FLAG_HIDDEN));
  const auto invalid_seconds = appearance_calls;
  second_tick(); assert(appearance_calls == invalid_seconds);
  screensaver_clock_date_format.state = "%S";
  screensaver_clock_date_format_changed();
  current_time.valid = false; second_tick();
  assert(lv_obj_has_flag(&date, LV_OBJ_FLAG_HIDDEN) && label.text == "1:23");
  controller.mode = espcontrol::DisplayMode::ACTIVE;
  const auto inactive = appearance_calls;
  screensaver_clock_time_format_changed(); screensaver_clock_date_format_changed();
  screensaver_clock_time_size_changed(); screensaver_clock_date_size_changed();
  font_changed(); color_changed(); second_tick(); tick();
  assert(appearance_calls == inactive && brightness_calls == 1);
  assert(stacking_calls == 6 && reconcile_calls == 6);
  std::cout << "YAML live appearance, restore guards, entry, seconds and 30s tick passed\n";
}
'''
run_cases(source, ("yaml_wiring",))
