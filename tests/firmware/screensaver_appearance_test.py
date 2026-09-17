"""Execute screensaver presentation helpers at the LVGL boundary.

Catches redundant local style writes, inherited/state-style confusion, stale
layout after font changes, and drift beyond the current (rotated) overlay.
The layout double defers font/text dimensions until update_layout, as LVGL does.
Real font raster/advance fitting is covered separately by screensaver_font_fit_test.
"""
from pathlib import Path
import subprocess
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
struct lv_font_t { int advance, height; };
struct lv_style_value_t { const void *ptr = nullptr; lv_color_t color = 0; };
constexpr int LV_PART_MAIN = 0;
[[maybe_unused]] constexpr int LV_STATE_DISABLED = 2;
constexpr int LV_STYLE_TEXT_COLOR = 1, LV_STYLE_TEXT_FONT = 2;
constexpr int LV_STYLE_RES_FOUND = 1, LV_STYLE_RES_NOT_FOUND = 0;
struct lv_obj_t {
  lv_obj_t *parent = nullptr;
  int width = 0, height = 0, x = 0, y = 0;
  bool label = false, dirty = false;
  std::string text;
  const lv_font_t *resolved_font = nullptr;
  lv_color_t resolved_color = 0;
  std::map<std::pair<int, int>, lv_style_value_t> local;
};
struct lv_disp_t { int width = 480, height = 480; } display;
struct { int color = 0, font = 0, text = 0; } writes;
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
void lv_obj_set_pos(lv_obj_t *obj, int x, int y) { obj->x = x; obj->y = y; }
void lv_obj_set_size(lv_obj_t *obj, int width, int height) {
  obj->width = width < 0 && obj->parent ? obj->parent->width : width;
  obj->height = height < 0 && obj->parent ? obj->parent->height : height;
}
void lv_obj_update_layout(lv_obj_t *obj) {
  if (obj->label && obj->dirty) {
    const auto *font = static_cast<const lv_font_t *>(obj->local[{LV_STYLE_TEXT_FONT, LV_PART_MAIN}].ptr);
    if (font) { obj->width = obj->text.size() * font->advance; obj->height = font->height; }
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
source += section("backlight.h", "inline void screensaver_fill_screen(",
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
  } else { return 2; }
  std::cout << test << " passed\n";
}
'''
def run_cases(cpp_source, names):
    with tempfile.TemporaryDirectory(prefix="screensaver-appearance-") as directory:
        cpp, binary = Path(directory) / "test.cpp", Path(directory) / "test"
        cpp.write_text(cpp_source)
        subprocess.run([sys.argv[1] if len(sys.argv) > 1 else "c++", "-std=c++17",
                        "-Wall", "-Wextra", "-Werror", "-UNDEBUG", str(cpp), "-o", str(binary)],
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


if __name__ == "__main__":
    run_cases(source, ("local_color", "live_appearance", "drift"))
    print("Screensaver appearance regressions passed.")
