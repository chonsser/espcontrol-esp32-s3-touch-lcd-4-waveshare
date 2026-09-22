"""Execute common font boot and 1s clock-card YAML against the real registry.

The LVGL boundary is shared with the date/time driver test. Missing wiring is
an empty callback, so the test fails on missing behavior, not source spelling.
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

def config(name):
    return yaml.load((ROOT / name).read_text(), Loader=Loader)

def actions(items):
    return "\n".join("[&]() {" + item["lambda"] + "}();" for item in items)

time = config("common/addon/time.yaml")
clock = config("common/device/screen_clock.yaml")
seconds = next((x for x in time.get("interval", []) if x["interval"] == "1s"), {"then": []})
boot = clock.get("esphome", {}).get("on_boot", [])
if isinstance(boot, dict):
    boot = [boot]
source = r'''
#define main date_time_registry_test_main
#include "date_time_text_size_test.cpp"
#undef main
#define id(name) name
struct Time {
  bool valid = true;
  int hour = 23, minute = 59, second = 58, day_of_month = 31, month = 12, year = 2024;
  bool is_valid() const { return valid; }
};
int source_reads = 0;
struct TimeSource { Time value; Time now() { ++source_reads; return value; } } panel_time, homeassistant_time;
Time panel_time_or_fallback(Time primary, Time fallback) { return primary.is_valid() ? primary : fallback; }
bool clock_format_12h = false;
struct Font {
  lv_font_t font;
  const lv_font_t *get_lv_font() const { return &font; }
};
'''
for family in ("", "_bold", "_mono"):
    for size in (24, 40, 64, 96, 128, ""):
        name = f"font_number_clock{family}" + (f"_{size}" if size else "")
        actual = size or 160
        source += f"Font storage_{name}{{{{{actual}, {actual // 2}}}}}; Font *{name} = &storage_{name};\n"
source += "void boot_fonts() {\n" + "\n".join(actions(x["then"]) for x in boot) + "\n}\n"
source += "void second_tick() {\n" + actions(seconds["then"]) + "\n}\n"
source += r'''
struct Card {
  lv_obj_t button, container, value, unit, label, icon;
  BtnSlot slot{&button, &icon, &container, &value, &unit, &label};
  const lv_font_t small{20,10}, medium{44,22}, large{110,55};
  const DisplayProfile display{&medium,&large};
  Card(const char *type, const char *options) {
    container.parent = &button;
    value.parent = unit.parent = &container; label.parent = &button;
    label.font = &small; value.font = &medium;
    auto cfg = parse_cfg(std::string(";;;;;;") + type + ";;" + options);
    const auto context = card_runtime_context(type);
    espcontrol::cards::date_time_driver_setup_visual(slot, cfg, context, {});
    espcontrol::cards::date_time_driver_refresh_layout(slot, cfg, context, display, 1, 2);
  }
};
int main() {
  reset_timezone_cards(); reset_calendar_cards();
  second_tick();
  assert(source_reads == 0);
  boot_fonts();
  Card legacy("clock", ""), world("timezone", ""), calendar("calendar", "");
  Card invalid("clock", "time_format=%25Sx");
  second_tick();
  assert(source_reads == 0); // No valid seconds directive anywhere.
  Card custom("clock", "clock_font=bold,time_format=%25I%3A%25M%3A%25S,date_format=%25Y-%25m-%25d");
  Card date_seconds("clock", "date_format=%25S");
  legacy.value.text = world.value.text = calendar.value.text = "untouched";
  second_tick();
  assert(custom.value.text == "11:59:58");
  assert(custom.label.text == "2024-12-31");
  assert(date_seconds.value.text == "23:59");
  assert(date_seconds.label.text == "58");
  assert(custom.value.font == font_number_clock_bold_96->get_lv_font());
  assert(legacy.value.text == "untouched" && world.value.text == "untouched" && calendar.value.text == "untouched");
  const int old_writes = font_writes;
  panel_time.value.second = 59;
  second_tick();
  assert(custom.value.text == "11:59:59");
  assert(font_writes == old_writes);
  panel_time.value = {true, 0, 0, 0, 1, 1, 2025};
  second_tick();
  assert(custom.value.text == "12:00:00");
  assert(custom.label.text == "2025-01-01");
  // Selected source supplies already-local time after configured timezone/DST changes.
  panel_time.value.hour = 2;
  second_tick();
  assert(custom.value.text == "02:00:00");
  panel_time.value.valid = false;
  homeassistant_time.value = {true, 12, 34, 56, 9, 7, 2026};
  clock_format_12h = true;
  second_tick();
  assert(custom.value.text == "12:34:56");
  assert(custom.label.text == "2026-07-09");
  assert(date_seconds.value.text == "12:34");
  homeassistant_time.value.valid = false;
  second_tick();
  assert(custom.value.text == "--:--" && custom.label.text.empty());
  assert(lv_obj_has_flag(&custom.label, LV_OBJ_FLAG_HIDDEN));
  Card lengthy("clock", "time_format=%25H%3A%25M%3A%25S %25Y-%25m-%25d %25H%3A%25M%3A%25S");
  lengthy.value.text.reserve(64);
  lengthy.label.text.reserve(64);
  homeassistant_time.value.valid = true;
  tracked_allocations = 0; track_allocations = true;
  second_tick();
  track_allocations = false;
  assert(lengthy.value.text == "12:34:56 2026-07-09 12:34:56");
  assert(tracked_allocations == 0);
  const int before_compaction = timezone_card_count();
  custom.value.valid = false; // Subpage/widget deletion, before the next narrow update.
  homeassistant_time.value.second = 57;
  second_tick();
  assert(timezone_card_count() == before_compaction - 1);
  assert(lengthy.value.text == "12:34:57 2026-07-09 12:34:57");
  assert(date_seconds.label.text == "57");
  assert(legacy.value.text == "untouched" && world.value.text == "untouched" && calendar.value.text == "untouched");
  espcontrol::cards::date_time_driver_cleanup(lengthy.slot, {}, card_runtime_context("sensor"));
  espcontrol::cards::date_time_driver_cleanup(custom.slot, {}, card_runtime_context("sensor"));
  espcontrol::cards::date_time_driver_cleanup(date_seconds.slot, {}, card_runtime_context("sensor"));
  source_reads = 0;
  second_tick();
  assert(source_reads == 0);
}
'''
with tempfile.TemporaryDirectory(prefix="clock-card-wiring-") as directory:
    cpp, binary = Path(directory) / "test.cpp", Path(directory) / "test"
    cpp.write_text(source)
    subprocess.run([sys.argv[1] if len(sys.argv) > 1 else "c++", "-std=c++17", "-Wall", "-Wextra", "-Werror", "-UNDEBUG",
                    "-I", str(ROOT / "tests/firmware"), "-I", str(ROOT / "tests/firmware/stubs"),
                    "-I", str(ROOT / "components/espcontrol"), str(cpp), "-o", str(binary)], check=True)
    subprocess.run([str(binary)], check=True)
print("Clock card common font boot and seconds wiring passed")
