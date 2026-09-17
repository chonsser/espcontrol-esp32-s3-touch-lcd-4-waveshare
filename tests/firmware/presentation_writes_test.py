"""Execute production presentation helpers against instrumented LVGL boundaries.

The doubles count setter calls (LVGL 9.5 unconditionally refreshes label text,
long mode and local styles). Local properties are keyed by exact selector;
resolved/inherited values deliberately differ in several regression cases.
No HA dispatch logic is replaced or deduplicated by the production patch.
"""
from pathlib import Path
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[2]
HEADERS = ROOT / "components/espcontrol"


def section(filename, start, end=None):
    source = (HEADERS / filename).read_text()
    first = source.index(start)
    return source[first:source.index(end, first) if end else len(source)]


source = r'''
#include <algorithm>
#include <cassert>
#include <cstdint>
#include <cstring>
#include <iostream>
#include <map>
#include <string>
#include <vector>
using lv_style_selector_t = uint32_t;
using lv_style_prop_t = int;
using lv_color_t = uint32_t;
struct lv_style_value_t { int32_t num = 0; lv_color_t color = 0; };
constexpr int LV_STYLE_RES_FOUND = 1, LV_STYLE_RES_NOT_FOUND = 0;
constexpr int LV_PART_MAIN = 0, LV_STATE_CHECKED = 1, LV_STATE_DISABLED = 2;
constexpr int LV_STYLE_TEXT_COLOR = 1, LV_STYLE_OPA = 2, LV_STYLE_RECOLOR_OPA = 3;
constexpr int LV_LABEL_LONG_WRAP = 0, LV_LABEL_LONG_SCROLL = 1;
constexpr int LV_OPA_TRANSP = 0, LV_OPA_COVER = 255, LV_ALIGN_BOTTOM_LEFT = 0;
const int lv_label_class = 1;
struct lv_obj_t {
  bool label = true;
  int state = 0, long_mode = LV_LABEL_LONG_SCROLL, width = 0;
  std::string text;
  lv_color_t resolved_color = 0;
  std::map<std::pair<int, uint32_t>, lv_style_value_t> local;
  std::vector<lv_obj_t *> children;
};
struct Calls { int text = 0, mode = 0, style = 0, state = 0; } calls;
int lv_obj_get_local_style_prop(lv_obj_t *obj, int prop, lv_style_value_t *value,
                                lv_style_selector_t selector) {
  auto it = obj->local.find({prop, selector});
  if (it == obj->local.end()) return LV_STYLE_RES_NOT_FOUND;
  *value = it->second;
  return LV_STYLE_RES_FOUND;
}
void lv_obj_set_style_text_color(lv_obj_t *obj, lv_color_t color, uint32_t selector) {
  ++calls.style;
  obj->local[{LV_STYLE_TEXT_COLOR, selector}].color = color;
}
void lv_obj_set_style_recolor_opa(lv_obj_t *obj, int value, uint32_t selector) {
  ++calls.style;
  obj->local[{LV_STYLE_RECOLOR_OPA, selector}].num = value;
}
void lv_obj_set_style_opa(lv_obj_t *obj, int value, uint32_t selector) {
  ++calls.style;
  obj->local[{LV_STYLE_OPA, selector}].num = value;
}
lv_color_t lv_obj_get_style_text_color(lv_obj_t *obj, int) { return obj->resolved_color; }
lv_color_t lv_color_hex(uint32_t value) { return value; }
bool lv_color_eq(lv_color_t a, lv_color_t b) { return a == b; }
void lv_label_set_text(lv_obj_t *obj, const char *text) {
  ++calls.text;
  if (text) obj->text = text;
}
const char *lv_label_get_text(lv_obj_t *obj) { return obj->text.c_str(); }
void lv_label_set_long_mode(lv_obj_t *obj, int mode) { ++calls.mode; obj->long_mode = mode; }
int lv_label_get_long_mode(lv_obj_t *obj) { return obj->long_mode; }
int lv_pct(int percent) { return -percent; }
void lv_obj_set_width(lv_obj_t *obj, int width) { obj->width = width; }
void lv_obj_align(lv_obj_t *, int, int, int) {}
uint32_t lv_obj_get_child_cnt(lv_obj_t *obj) { return obj->children.size(); }
lv_obj_t *lv_obj_get_child(lv_obj_t *obj, int index) { return obj->children.at(index); }
bool lv_obj_check_type(lv_obj_t *obj, const int *) { return obj->label; }
void lv_obj_add_state(lv_obj_t *obj, int state) { ++calls.state; obj->state |= state; }
void lv_obj_clear_state(lv_obj_t *obj, int state) { ++calls.state; obj->state &= ~state; }
bool lv_obj_has_state(lv_obj_t *obj, int state) { return (obj->state & state) != 0; }
#define ESPCONTROL_OPTIMISTIC_TOGGLE
struct lv_timer_t { void (*callback)(lv_timer_t *); void *data; };
int live_timers = 0;
lv_timer_t *lv_timer_create(void (*callback)(lv_timer_t *), int, void *data) {
  ++live_timers;
  return new lv_timer_t{callback, data};
}
void lv_timer_delete(lv_timer_t *timer) { --live_timers; delete timer; }
void *lv_timer_get_user_data(lv_timer_t *timer) { return timer->data; }
void lv_timer_set_repeat_count(lv_timer_t *, int) {}
struct lv_event_t { lv_obj_t *target; };
constexpr int LV_EVENT_DELETE = 0;
void *lv_event_get_target(lv_event_t *event) { return event->target; }
void lv_obj_remove_event_cb(lv_obj_t *, void (*)(lv_event_t *)) {}
void lv_obj_add_event_cb(lv_obj_t *, void (*)(lv_event_t *), int, void *) {}
'''
source += section("button_grid_string.h", "inline std::string normalize_display_text(",
                  "inline bool append_html_code_point(")
source += section("display_text.h", "inline void lv_label_set_display_text(")
source += section("card_availability.h", "constexpr uint32_t DARK_TEXT_DISABLED")
source += section("button_grid_layout.h", "inline void apply_card_descendant_text_color(",
                  "// Match the main-page button widget label behavior")
source += section("button_grid_layout.h", "inline void configure_button_label_wrap(",
                  "inline void set_subpage_chevron_visible(")
source += r'''
int main(int argc, char **argv) {
  assert(argc == 2);
  const std::string test = argv[1];
  lv_obj_t card, label, nested;
  card.label = false;
  card.children = {&label};
  label.children = {&nested};
  if (test == "text") {
    lv_label_set_display_text(&label, "Lampy w salonie");
    assert(label.text == "Lampy w salonie" && calls.text == 1);
    lv_label_set_display_text(&label, "Lampy w salonie");
    assert(calls.text == 1); // Repeating user text must not refresh layout.
    lv_label_set_display_text(&label, "Żółta lampa");
    assert(label.text == "Żółta lampa" && calls.text == 2);
    lv_label_set_display_text(&label, "");
    lv_label_set_display_text(&label, "");
    assert(label.text.empty() && calls.text == 3);
  } else if (test == "normalized") {
    lv_label_set_display_text(&label, "Sade");
    lv_label_set_display_text(&label, "\xE1\xB9\xA2" "ade");
    assert(label.text == "Sade" && calls.text == 1);
    lv_label_set_display_text(&label, "\xE1\xB9\xA3" "ade");
    assert(label.text == "sade" && calls.text == 2);
    lv_label_set_display_text(&label, "sade");
    assert(calls.text == 2);
  } else if (test == "null_refresh") {
    label.text = "Keep custom text";
    lv_label_set_display_text(&label, nullptr);
    lv_label_set_display_text(&label, nullptr);
    assert(label.text == "Keep custom text" && calls.text == 2);
  } else if (test == "wrapping") {
    configure_button_label_wrap(&label);
    assert(label.long_mode == LV_LABEL_LONG_WRAP && label.width == lv_pct(100));
    assert(calls.mode == 1);
    configure_button_label_wrap(&label);
    assert(calls.mode == 1);
    label.long_mode = LV_LABEL_LONG_SCROLL;
    configure_button_label_wrap(&label);
    assert(label.long_mode == LV_LABEL_LONG_WRAP && calls.mode == 2);
  } else if (test == "checked_color") {
    card.resolved_color = 0x123456;
    label.resolved_color = nested.resolved_color = card.resolved_color;
    set_card_checked_state(&card, true);
    assert(calls.style == 2); // Establish explicit local overrides even if inherited matches.
    assert((label.local.at({LV_STYLE_TEXT_COLOR, LV_PART_MAIN}).color == 0x123456));
    label.resolved_color = nested.resolved_color = 0x654321; // Higher-priority state style.
    set_card_checked_state(&card, true);
    assert(calls.style == 2 && calls.state == 2); // Don't short-circuit state delivery.
    card.resolved_color = 0xABCDEF;
    set_card_checked_state(&card, false);
    assert(calls.style == 4 && card.state == 0);
    assert((nested.local.at({LV_STYLE_TEXT_COLOR, LV_PART_MAIN}).color == 0xABCDEF));
  } else if (test == "optimistic_report") {
    card.resolved_color = 0x123456;
    optimistic_toggle_apply(&card, true);
    assert(lv_obj_has_state(&card, LV_STATE_CHECKED));
    assert(optimistic_toggle_entries().size() == 1 && live_timers == 1);
    assert(calls.style == 2);
    // HA confirms the already displayed value: still settle the pending timer.
    optimistic_toggle_reported(&card, false);
    set_card_checked_state(&card, true);
    assert(optimistic_toggle_entries().empty() && live_timers == 0);
    assert(calls.style == 2 && lv_obj_has_state(&card, LV_STATE_CHECKED));
    optimistic_toggle_apply(&card, false);
    optimistic_toggle_reported(&card, true);
    set_card_checked_state(&card, false);
    assert(optimistic_toggle_entries().empty() && live_timers == 0);
    assert(optimistic_toggle_card_unavailable(&card));
    optimistic_toggle_apply(&card, true);
    assert(!lv_obj_has_state(&card, LV_STATE_CHECKED) && live_timers == 0);
    optimistic_toggle_forget(&card);
  } else if (test == "disabled_color") {
    label.local[{LV_STYLE_TEXT_COLOR, LV_PART_MAIN}].color = 0x112233;
    label.resolved_color = DARK_TEXT_DISABLED; // Inherited/resolved equality is NOT a local override.
    set_card_content_disabled(&label, true);
    assert(calls.style == 2);
    assert((label.local.at({LV_STYLE_TEXT_COLOR, LV_STATE_DISABLED}).color == 0x707070));
    assert((label.local.at({LV_STYLE_TEXT_COLOR, LV_PART_MAIN}).color == 0x112233));
    set_card_content_disabled(&label, true);
    assert(calls.style == 2);
    set_card_content_disabled(&label, false);
    assert(calls.style == 2 && label.state == 0 && nested.state == 0);
    label.local[{LV_STYLE_TEXT_COLOR, LV_STATE_DISABLED}].color = 0;
    set_card_content_disabled(&label, false); // Must repair inactive selector too.
    assert(calls.style == 3);
    assert((label.local.at({LV_STYLE_TEXT_COLOR, LV_PART_MAIN}).color == 0x112233));
  } else if (test == "disabled_opacity") {
    card.children.clear();
    card.local[{LV_STYLE_RECOLOR_OPA, LV_PART_MAIN}].num = 42;
    set_card_disabled_state(&card, true);
    assert(calls.style == 2);
    assert((card.local.at({LV_STYLE_RECOLOR_OPA, LV_STATE_DISABLED}).num == LV_OPA_TRANSP));
    assert((card.local.at({LV_STYLE_RECOLOR_OPA, LV_PART_MAIN}).num == 42));
    set_card_disabled_state(&card, true);
    set_card_disabled_state(&card, false);
    assert(calls.style == 2 && card.state == 0);
    card.local[{LV_STYLE_OPA, LV_PART_MAIN}].num = 90;
    card.local[{LV_STYLE_RECOLOR_OPA, LV_STATE_DISABLED}].num = 80;
    set_card_disabled_state(&card, false);
    assert(calls.style == 4);
    assert((card.local.at({LV_STYLE_OPA, LV_PART_MAIN}).num == LV_OPA_COVER));
    assert((card.local.at({LV_STYLE_RECOLOR_OPA, LV_STATE_DISABLED}).num == LV_OPA_TRANSP));
  } else {
    return 2;
  }
  std::cout << test << " passed\n";
}
'''
with tempfile.TemporaryDirectory(prefix="presentation-writes-") as directory:
    cpp = Path(directory) / "test.cpp"
    binary = Path(directory) / "test"
    cpp.write_text(source)
    subprocess.run([sys.argv[1] if len(sys.argv) > 1 else "c++", "-std=c++17",
                    "-Wall", "-Wextra", "-Werror", "-UNDEBUG", str(cpp), "-o", str(binary)],
                   check=True)
    failed = []
    for name in ("text", "normalized", "null_refresh", "wrapping", "checked_color",
                 "optimistic_report", "disabled_color", "disabled_opacity"):
        result = subprocess.run([str(binary), name], capture_output=True, text=True)
        print(result.stdout, end="")
        if result.returncode:
            failed.append(name)
            print(f"{name} FAILED: {result.stderr.strip()}")
    if failed:
        raise SystemExit("Failed: " + ", ".join(failed))
print("Presentation-write regressions passed.")
