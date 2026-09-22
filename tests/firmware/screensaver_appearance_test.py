"""Execute screensaver presentation helpers at the LVGL boundary.

Catches redundant local style writes, inherited/state-style confusion, stale
layout after font changes, and drift beyond the current (rotated) overlay.
The layout double defers font/text dimensions until update_layout, as LVGL does.
Real font raster/advance fitting is covered separately by screensaver_font_fit_test.
"""
from pathlib import Path
import subprocess
import json
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[2]
HEADERS = ROOT / "components/espcontrol"


def section(filename, start, end=None):
    text = (HEADERS / filename).read_text()
    first = text.index(start)
    return text[first:text.index(end, first) if end else len(text)]


source = r'''
#include <algorithm>
#include <cassert>
#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <iostream>
#include <map>
#include <string>
// ESP32's int32_t/LVGL coordinate type is long, distinct from int.
using lv_coord_t = long;
using lv_color_t = uint32_t;
using lv_style_prop_t = int;
struct lv_font_glyph_dsc_t { int adv_w = 0, ofs_x = 0, box_w = 0; };
struct lv_font_t {
  int advance, line_height;
  std::map<char, lv_font_glyph_dsc_t> glyphs;
  lv_font_t(int a, int h) : advance(a), line_height(h) {}
};
bool lv_font_get_glyph_dsc(const lv_font_t *font, lv_font_glyph_dsc_t *out, uint32_t c, uint32_t) {
  auto found = font->glyphs.find(c);
  *out = found == font->glyphs.end() ? lv_font_glyph_dsc_t{font->advance, 0, font->advance} : found->second;
  return true;
}
struct lv_style_value_t { const void *ptr = nullptr; lv_color_t color = 0; lv_coord_t num = 0; };
constexpr int LV_PART_MAIN = 0;
[[maybe_unused]] constexpr int LV_STATE_DISABLED = 2;
constexpr int LV_STYLE_TEXT_COLOR = 1, LV_STYLE_TEXT_FONT = 2;
constexpr int LV_STYLE_WIDTH = 3, LV_STYLE_HEIGHT = 4, LV_STYLE_X = 5, LV_STYLE_Y = 6;
constexpr int LV_STYLE_PAD_LEFT = 7, LV_STYLE_PAD_RIGHT = 8;
constexpr int LV_SIZE_CONTENT = -200, LV_OBJ_FLAG_HIDDEN = 1;
constexpr int LV_STYLE_RES_FOUND = 1, LV_STYLE_RES_NOT_FOUND = 0;
struct lv_obj_t {
  lv_obj_t *parent = nullptr;
  int width = 0, height = 0, x = 0, y = 0;
  bool label = false, dirty = false;
  int flags = 0;
  std::string text;
  const lv_font_t *resolved_font = nullptr;
  lv_color_t resolved_color = 0;
  std::map<std::pair<int, int>, lv_style_value_t> local;
};
struct lv_disp_t { int width = 480, height = 480; } display;
struct { int color = 0, font = 0, text = 0, size = 0, pos = 0, pad = 0, flag = 0; } writes;
bool lv_obj_has_flag(lv_obj_t *obj, int flag) { return obj->flags & flag; }
void lv_obj_add_flag(lv_obj_t *obj, int flag) { ++writes.flag; obj->flags |= flag; }
void lv_obj_clear_flag(lv_obj_t *obj, int flag) { ++writes.flag; obj->flags &= ~flag; }
void lv_obj_set_style_pad_left(lv_obj_t *obj, int value, int selector) {
  ++writes.pad; obj->local[{LV_STYLE_PAD_LEFT, selector}].num = value;
}
void lv_obj_set_style_pad_right(lv_obj_t *obj, int value, int selector) {
  ++writes.pad; obj->local[{LV_STYLE_PAD_RIGHT, selector}].num = value;
}
int lv_obj_get_local_style_prop(lv_obj_t *obj, int prop,
                              lv_style_value_t *value, int selector) {
  auto it = obj->local.find({prop, selector});
  if (it == obj->local.end()) return LV_STYLE_RES_NOT_FOUND;
  *value = it->second;
  return LV_STYLE_RES_FOUND;
}
lv_color_t lv_color_hex(uint32_t color) { return color; }
bool lv_color_eq(lv_color_t a, lv_color_t b) { return a == b; }
void lv_obj_set_style_text_color(lv_obj_t *obj, lv_color_t color, int selector) {
  ++writes.color; obj->local[{LV_STYLE_TEXT_COLOR, selector}].color = color;
}
void lv_obj_set_style_text_font(lv_obj_t *obj, const lv_font_t *font, int selector) {
  ++writes.font; obj->local[{LV_STYLE_TEXT_FONT, selector}].ptr = font; obj->dirty = true;
}
void lv_label_set_text(lv_obj_t *obj, const char *text) {
  ++writes.text; if (text) obj->text = text; obj->dirty = true;
}
const char *lv_label_get_text(lv_obj_t *obj) { return obj->text.c_str(); }
lv_obj_t *lv_obj_get_parent(lv_obj_t *obj) { return obj->parent; }
int lv_pct(int value) { return -value; }
void lv_obj_set_pos(lv_obj_t *obj, int x, int y) {
  ++writes.pos; obj->x = x; obj->y = y;
  obj->local[{LV_STYLE_X, LV_PART_MAIN}].num = x;
  obj->local[{LV_STYLE_Y, LV_PART_MAIN}].num = y;
}
void lv_obj_set_size(lv_obj_t *obj, int width, int height) {
  ++writes.size;
  obj->local[{LV_STYLE_WIDTH, LV_PART_MAIN}].num = width;
  obj->local[{LV_STYLE_HEIGHT, LV_PART_MAIN}].num = height;
  obj->dirty = true;
}
void lv_obj_update_layout(lv_obj_t *obj) {
  for (int prop : {LV_STYLE_WIDTH, LV_STYLE_HEIGHT}) {
    auto it = obj->local.find({prop, LV_PART_MAIN});
    if (it == obj->local.end() || it->second.num == LV_SIZE_CONTENT) continue;
    int value = it->second.num;
    if (value < 0 && obj->parent) value = prop == LV_STYLE_WIDTH ? obj->parent->width : obj->parent->height;
    (prop == LV_STYLE_WIDTH ? obj->width : obj->height) = value;
  }
  if (obj->label && obj->dirty) {
    const auto *font = static_cast<const lv_font_t *>(obj->local[{LV_STYLE_TEXT_FONT, LV_PART_MAIN}].ptr);
    if (font) {
      auto content = [&](int prop) {
        auto it = obj->local.find({prop, LV_PART_MAIN});
        return it == obj->local.end() || it->second.num == LV_SIZE_CONTENT;
      };
      if (content(LV_STYLE_WIDTH)) obj->width = obj->text.size() * font->advance;
      if (content(LV_STYLE_HEIGHT)) obj->height = font->line_height;
    }
    obj->dirty = false;
  }
}
int lv_obj_get_width(lv_obj_t *obj) { return obj->width; }
int lv_obj_get_height(lv_obj_t *obj) { return obj->height; }
lv_disp_t *lv_disp_get_default() { return &display; }
int lv_disp_get_hor_res(lv_disp_t *disp) { return disp->width; }
int lv_disp_get_ver_res(lv_disp_t *disp) { return disp->height; }
'''
source += section("button_grid_string.h", "inline std::string normalize_display_text(",
                  "inline bool append_html_code_point(")
source += section("display_text.h", "inline void lv_label_set_display_text(")
source += section("clock_bar.h", "inline void format_clock_time_without_suffix(",
                  "inline void format_fixed_decimal(")
source += section("backlight.h", "inline bool clock_screensaver_local_number_is(",
                  "// ── Firmware update interval")
helper_source = source
source += r'''
int main(int argc, char **argv) {
  assert(argc == 2);
  std::string test = argv[1];
  lv_obj_t root, overlay, label;
  root.width = root.height = 480;
  overlay.parent = &root;
  label.parent = &overlay;
  label.label = true;
  if (test == "local_color") {
    label.resolved_color = 0xFFFFFF;
    label.local[{LV_STYLE_TEXT_COLOR, LV_STATE_DISABLED}].color = 0xFFFFFF;
    apply_clock_screensaver_text_color(&label, "FFFFFF");
    assert(writes.color == 1); // Matching inherited/other-selector color is not local.
    apply_clock_screensaver_text_color(&label, "ffffff");
    assert(writes.color == 1); // Repeated tick must not rewrite the style.
    label.resolved_color = 0;
    apply_clock_screensaver_text_color(&label, "FFFFFF");
    assert(writes.color == 1); // A higher-priority style must not cause a write loop.
    label.local[{LV_STYLE_TEXT_COLOR, LV_PART_MAIN}].color = 0;
    apply_clock_screensaver_text_color(&label, "FFFFFF");
    assert(writes.color == 2); // Repair exact local override changed elsewhere.
    apply_clock_screensaver_text_color(&label, "abC123");
    assert((label.local.at({LV_STYLE_TEXT_COLOR, LV_PART_MAIN}).color == 0xABC123));
    apply_clock_screensaver_text_color(&label, "bad");
    apply_clock_screensaver_text_color(&label, "GGGGGG");
    apply_clock_screensaver_text_color(&label, "");
    assert(writes.color == 4); // Invalid input resolves white once.
    apply_clock_screensaver_text_color(nullptr, "000000");
  } else if (test == "live_appearance") {
    const lv_font_t thin{70, 180}, bold{90, 190}, mono{96, 200};
    label.resolved_font = &bold;
    label.local[{LV_STYLE_TEXT_FONT, LV_STATE_DISABLED}].ptr = &bold;
    auto update = [&](const std::string &option, const char *text = "12:34") {
      update_clock_screensaver_appearance(&overlay, &label, option,
          &thin, &bold, &mono, "ABCDEF", text, 0);
    };
    update("Roboto Bold");
    assert(writes.font == 1 && writes.color == 1 && writes.text == 1);
    assert((label.local.at({LV_STYLE_TEXT_FONT, LV_PART_MAIN}).ptr == &bold));
    assert(label.width == 450 && label.height == 190 && label.x == 0 && label.y == 125);
    update("Roboto Bold");
    assert(writes.font == 1 && writes.color == 1 && writes.text == 1);
    label.resolved_font = &thin; // A state override differs, local font still matches.
    update("Roboto Bold");
    assert(writes.font == 1);
    update("Roboto Mono"); // The same visible object changes in place, with new layout.
    assert(writes.font == 2 && writes.text == 1 && writes.color == 1);
    assert((label.local.at({LV_STYLE_TEXT_FONT, LV_PART_MAIN}).ptr == &mono));
    assert(label.width == 480 && label.height == 200 && label.x == 0 && label.y == 120);
    update("Roboto Mono", "1:23");
    assert(writes.text == 2 && label.width == 384 && label.x == 18);
    update("Roboto Thin");
    assert(writes.font == 3 && label.width == 350 && label.x == 35);
    for (const char *unknown : {"", "unknown", "Roboto Mono Regular", "roboto bold"}) update(unknown);
    assert(writes.font == 3); // Missing/unknown protocol option falls back to Thin.
    label.local[{LV_STYLE_TEXT_FONT, LV_PART_MAIN}].ptr = &mono;
    update("Roboto Thin");
    assert(writes.font == 4); // Repair externally changed local font, don't cache it.
    update("Roboto Bold", nullptr); // Missing time must not reset or refresh text.
    assert(label.text == "12:34" && writes.text == 3 && writes.font == 5);
    assert(label.width == 450 && label.x == 0);
    update_clock_screensaver_appearance(nullptr, nullptr, "Roboto Mono",
        &thin, &bold, &mono, "000000", "00:00", 0);
    assert(writes.font == 5 && writes.color == 1 && writes.text == 3);
  } else if (test == "drift") {
    label.width = 470; label.height = 460;
    position_clock_screensaver_label(&overlay, &label, 0);
    assert(label.x == 0 && label.y == 0);
    position_clock_screensaver_label(&overlay, &label, 8);
    assert(label.x == 10 && label.y == 12);
    for (auto dimensions : {std::pair<int,int>{480, 800}, {800,480}, {600,1024}, {1024,600}}) {
      root.width = dimensions.first; root.height = dimensions.second;
      label.width = root.width - 4; label.height = root.height - 6;
      for (int minute = 0; minute < 60; ++minute) {
        position_clock_screensaver_label(nullptr, &label, minute);
        assert(label.x >= 0 && label.x + label.width <= root.width);
        assert(label.y >= 0 && label.y + label.height <= root.height);
      }
    }
    // Pre-existing oversized legacy labels cannot fit: stable origin, never an inverted clamp.
    root.width = 480; root.height = 480; label.width = 500; label.height = 510;
    position_clock_screensaver_label(&overlay, &label, 59);
    assert(label.x == 0 && label.y == 0);
    // Preserve original centering/drift exactly whenever there is space.
    label.width = 300; label.height = 160;
    position_clock_screensaver_label(&overlay, &label, 0);
    assert(label.x == 60 && label.y == 140);
    position_clock_screensaver_label(&overlay, &label, 8);
    assert(label.x == 116 && label.y == 162);
    position_clock_screensaver_label(nullptr, nullptr, 0);
  } else if (test == "rich_layout") {
    lv_font_t f24{14,28}, f40{20,50}, f64{32,80}, f96{48,120}, f128{64,160}, legacy{70,180};
    f24.glyphs['0'] = {7, 0, 7}; // The shape placeholder is not necessarily the widest digit.
    f24.glyphs['1'] = {7, 0, 7}; // Proportional digit must not make size oscillate.
    f24.glyphs['/'] = {9, -1, 10}; // Actual Bold slash has a negative bearing.
    const ClockScreensaverFont pool[] = {{24,&f24},{40,&f40},{64,&f64},{96,&f96},{128,&f128},{160,&legacy}};
    ClockScreensaverSettings settings{"%H:%M:%S", "%d.%m.%Y", "Auto", "Auto", "AABBCC"};
    ClockScreensaverTime now{12,34,0,18,9,2026};
    lv_obj_t date;
    date.parent = &overlay; date.label = true; date.flags = LV_OBJ_FLAG_HIDDEN;
    auto update = [&](bool valid = true, bool use12 = false) {
      update_clock_screensaver_labels(&overlay, &label, &date, pool, 6, settings, now, valid, use12);
    };
    update();
    assert(label.text == "12:34:00" && date.text == "18.09.2026");
    assert(!lv_obj_has_flag(&date, LV_OBJ_FLAG_HIDDEN));
    assert((label.local.at({LV_STYLE_TEXT_FONT, LV_PART_MAIN}).ptr == &f96));
    assert((date.local.at({LV_STYLE_TEXT_FONT, LV_PART_MAIN}).ptr == &f40));
    const auto first = writes;
    const auto old_x = label.x, old_y = label.y;
    now.second = 1; update();
    assert(label.text == "12:34:01" && writes.text == first.text + 1);
    assert(writes.font == first.font && writes.color == first.color && writes.size == first.size);
    assert(writes.pos == first.pos && writes.pad == first.pad && writes.flag == first.flag);
    assert(label.x == old_x && label.y == old_y);
    update();
    assert(writes.text == first.text + 1);
    settings.time_size = "Small"; settings.date_size = "Large"; update();
    assert((label.local.at({LV_STYLE_TEXT_FONT, LV_PART_MAIN}).ptr == &f64));
    assert((date.local.at({LV_STYLE_TEXT_FONT, LV_PART_MAIN}).ptr == &f64));
    settings.time_size = "Medium"; settings.date_size = "Small"; update();
    assert((label.local.at({LV_STYLE_TEXT_FONT, LV_PART_MAIN}).ptr == &f96));
    assert((date.local.at({LV_STYLE_TEXT_FONT, LV_PART_MAIN}).ptr == &f24));
    settings.time_format = settings.date_format = "%Y%Y%Y%Y%Y%Y%Y%Y";
    settings.time_size = settings.date_size = "Large"; update();
    assert(label.width == 448 && date.width == 448 && label.height == 28 && date.height == 28);
    assert(date.y >= label.y + label.height);
    settings.time_format = "";
    update(false); // Losing time while switching back to defaults must not enlarge retained 32 digits.
    assert(label.text.size() == 32 && label.width <= 480 && label.x + label.width <= 480);
    assert(lv_obj_has_flag(&date, LV_OBJ_FLAG_HIDDEN));
    settings.time_format = "/1111111111111111111111111111111"; update();
    assert((label.local.at({LV_STYLE_PAD_LEFT, LV_PART_MAIN}).num == 1));
    assert(label.x >= 0 && label.x + label.width <= 480);
    settings.time_format = "%H:%M:%S"; settings.date_format = "%d.%m.%Y";
    for (auto dimensions : {std::pair<int,int>{480,160}, {160,480}, {480,800}, {800,480}}) {
      root.width = dimensions.first; root.height = dimensions.second;
      for (int minute = 0; minute < 60; ++minute) {
        now.minute = minute; update();
        assert(label.x >= 0 && label.x + label.width <= root.width);
        assert(date.x >= 0 && date.x + date.width <= root.width);
        assert(label.y >= 0 && date.y + date.height <= root.height);
        assert(date.y >= label.y + label.height);
      }
    }
    root.width = root.height = 480; now.hour = 1; now.minute = 23;
    const auto last_time = label.text;
    update(false);
    assert(label.text == last_time && lv_obj_has_flag(&date, LV_OBJ_FLAG_HIDDEN));
    update();
    assert(!lv_obj_has_flag(&date, LV_OBJ_FLAG_HIDDEN));
    settings.time_format = "invalid %S"; settings.date_format = "%A"; settings.time_size = "Auto";
    update(true, true);
    assert(label.text == "1:23" && lv_obj_has_flag(&date, LV_OBJ_FLAG_HIDDEN));
    assert(label.width == 280 && label.height == 180); // Exact legacy content geometry restored.
    assert(label.x == 109 && label.y == 142); // Legacy drift for minute 23.
    assert((label.local.at({LV_STYLE_TEXT_FONT, LV_PART_MAIN}).ptr == &legacy));
    settings.time_format = settings.date_format = ""; update(true, true);
    assert(label.text == "1:23" && label.width == 280);
    update_clock_screensaver_labels(nullptr, nullptr, nullptr, pool, 6, settings, now, true, false);
  } else { return 2; }
  std::cout << test << " passed\n";
}
'''
def run_cases(cpp_source, names):
    with tempfile.TemporaryDirectory(prefix="screensaver-appearance-") as directory:
        cpp, binary = Path(directory) / "test.cpp", Path(directory) / "test"
        cpp.write_text(cpp_source)
        subprocess.run([sys.argv[1] if len(sys.argv) > 1 else "c++", "-std=c++17",
                        "-Wall", "-Wextra", "-Werror", "-UNDEBUG", "-I", str(HEADERS), str(cpp), "-o", str(binary)],
                       check=True)
        failures = []
        for name in names:
            result = subprocess.run([str(binary), name], capture_output=True, text=True)
            print(result.stdout, end="")
            if result.returncode:
                failures.append(name)
                print(f"{name} FAILED: {result.stderr.strip()}")
        if failures:
            raise SystemExit("Failed: " + ", ".join(failures))


def cpp_string(value):
    # Explicit byte length preserves embedded NUL, UTF-8 and control characters.
    data = value.encode("utf-8")
    escaped = ''.join(f'\\{byte:03o}' for byte in data)
    return f'std::string("{escaped}", {len(data)})'


def format_cases():
    fixtures = json.loads((ROOT / "tests/fixtures/screensaver_clock_formats.json").read_text())
    sample = fixtures["sample"]
    cases = helper_source + '\nint main(int, char **) {\n'
    cases += 'ClockScreensaverTime now{' + ','.join(str(sample[k]) for k in
              ("hour", "minute", "second", "day", "month", "year")) + '};\n'
    for i, case in enumerate(fixtures["cases"]):
        cases += f'{{ // Shared firmware/web vector {i}\nconst auto format = {cpp_string(case["format"])};\n'
        cases += f'const auto parsed = parse_clock_screensaver_format(format);\nassert(parsed.valid == {str(case["valid"]).lower()});\n'
        cases += 'std::string out = "stale";\n'
        cases += f'assert(format_clock_screensaver_numeric(format, now, out) == {str(case["valid"]).lower()});\n'
        if case["valid"]:
            cases += f'assert(parsed.shape.size() == {case["length"]});\n'
            cases += f'assert(out == {cpp_string(case["sample"])});\n'
        else:
            cases += 'assert(out.empty());\n'
        seconds = str(case.get("seconds", False)).lower()
        cases += f'assert(clock_screensaver_needs_seconds(format, "") == {seconds});\n'
        cases += f'assert(clock_screensaver_needs_seconds("", format) == {seconds});\n}}\n'
    cases += r'''
    for (auto hour : {0, 1, 12, 13, 23}) {
      now.hour = hour;
      std::string out;
      assert(format_clock_screensaver_numeric("%I", now, out));
      const char *expected = hour == 0 || hour == 12 ? "12" : hour == 23 ? "11" : "01";
      assert(out == expected);
    }
    assert(!clock_screensaver_needs_seconds("%S bad", "%%S"));
    assert(clock_screensaver_needs_seconds("invalid", "%S"));
    std::cout << "Bounded numeric formats and shared vectors passed\n";
    }
    '''
    return cases


if __name__ == "__main__":
    run_cases(source, ("local_color", "live_appearance", "drift", "rich_layout"))
    run_cases(format_cases(), ("formats",))
    print("Screensaver appearance regressions passed.")
