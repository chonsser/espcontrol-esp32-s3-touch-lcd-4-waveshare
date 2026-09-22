// Exercise the production date/time registry and driver with a deterministic LVGL boundary.
#include <cassert>
#include <cctype>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <ctime>
#include <functional>
#include <string>
#include <vector>
#include <cstdlib>
#include <new>
#include <map>
#include "esphome/core/string_ref.h"

static bool track_allocations = false;
static size_t tracked_allocations = 0;
void *operator new(std::size_t n) {
  if (track_allocations) ++tracked_allocations;
  if (void *p = std::malloc(n)) return p;
  throw std::bad_alloc();
}
void operator delete(void *p) noexcept { std::free(p); }
void operator delete(void *p, std::size_t) noexcept { std::free(p); }


using lv_coord_t = long;
using lv_align_t = int;
using lv_style_selector_t = int;
enum { LV_PART_MAIN = 0, LV_STATE_DEFAULT = 0, LV_ALIGN_LEFT_MID = 1,
  LV_ALIGN_CENTER = 2, LV_ALIGN_TOP_LEFT = 3, LV_OBJ_FLAG_HIDDEN = 1,
  LV_OBJ_FLAG_CLICKABLE = 2, LV_COORD_MAX = 32767, LV_TEXT_FLAG_NONE = 0,
  LV_STYLE_TEXT_FONT = 1, LV_STYLE_PAD_LEFT = 2, LV_STYLE_PAD_RIGHT = 3, LV_STYLE_RES_FOUND = 1 };
struct lv_style_value_t { const void *ptr = nullptr; lv_coord_t num = 0; };
struct lv_font_glyph_dsc_t { int adv_w = 0, ofs_x = 0, box_w = 0; };
struct lv_font_t {
  int line_height; int glyph_width; int overhang = 0;
  std::map<char, lv_font_glyph_dsc_t> glyphs{};
};
inline bool lv_font_get_glyph_dsc(const lv_font_t *font, lv_font_glyph_dsc_t *glyph, uint32_t ch, uint32_t) {
  const auto found = font->glyphs.find(static_cast<char>(ch));
  if (found != font->glyphs.end()) { *glyph = found->second; return true; }
  glyph->adv_w = font->glyph_width;
  glyph->ofs_x = ch == '/' ? -font->overhang : 0;
  glyph->box_w = font->glyph_width + (ch == '/' ? 2 * font->overhang : 0);
  return true;
}
struct lv_point_t { lv_coord_t x; lv_coord_t y; };
struct lv_obj_t {
  lv_obj_t *parent = nullptr;
  const lv_font_t *font = nullptr;
  std::string text;
  int width = 400, height = 180, flags = 0, scale_x = 256, scale_y = 256;
  lv_coord_t pad_left = 0, pad_right = 0;
  bool valid = true;
};
inline void lv_label_set_text(lv_obj_t *o, const char *s) { o->text = s; }
inline void lv_label_set_display_text(lv_obj_t *o, const char *s) { o->text = s; }
inline const char *lv_label_get_text(lv_obj_t *o) { return o->text.c_str(); }
inline bool lv_obj_is_valid(lv_obj_t *o) { return o != nullptr && o->valid; }
inline lv_obj_t *lv_obj_get_parent(lv_obj_t *o) { return o->parent; }
inline void lv_obj_update_layout(lv_obj_t *) {}
inline int lv_obj_get_content_width(lv_obj_t *o) { return o->width; }
inline int lv_obj_get_content_height(lv_obj_t *o) { return o->height; }
inline int lv_obj_get_height(lv_obj_t *o) { return o->font->line_height; }
inline const lv_font_t *lv_obj_get_style_text_font(lv_obj_t *o, int) { return o->font; }
inline int lv_obj_get_style_text_letter_space(lv_obj_t *, int) { return 0; }
inline int lv_obj_get_style_text_line_space(lv_obj_t *, int) { return 0; }
inline int lv_obj_get_style_transform_scale_x(lv_obj_t *o, int) { return o->scale_x; }
inline int lv_obj_get_style_transform_scale_y(lv_obj_t *o, int) { return o->scale_y; }
int font_writes = 0;
inline void lv_obj_set_style_text_font(lv_obj_t *o, const lv_font_t *f, int) { o->font = f; ++font_writes; }
inline int lv_obj_get_local_style_prop(lv_obj_t *o, int prop, lv_style_value_t *out, int) {
  if (prop == LV_STYLE_TEXT_FONT) out->ptr = o->font;
  else out->num = prop == LV_STYLE_PAD_LEFT ? o->pad_left : o->pad_right;
  return LV_STYLE_RES_FOUND;
}
int pad_writes = 0;
inline lv_coord_t lv_obj_get_style_pad_left(lv_obj_t *o, int) { return o->pad_left; }
inline lv_coord_t lv_obj_get_style_pad_right(lv_obj_t *o, int) { return o->pad_right; }
inline void lv_obj_set_style_pad_left(lv_obj_t *o, lv_coord_t value, int) { o->pad_left = value; ++pad_writes; }
inline void lv_obj_set_style_pad_right(lv_obj_t *o, lv_coord_t value, int) { o->pad_right = value; ++pad_writes; }
inline void lv_obj_set_style_translate_y(lv_obj_t *, int, int) {}
inline void lv_obj_set_style_bg_color(lv_obj_t *, int, int) {}
inline int lv_color_hex(uint32_t c) { return static_cast<int>(c); }
inline void lv_obj_add_flag(lv_obj_t *o, int f) { o->flags |= f; }
inline void lv_obj_clear_flag(lv_obj_t *o, int f) { o->flags &= ~f; }
inline bool lv_obj_has_flag(lv_obj_t *o, int f) { return (o->flags & f) != 0; }
inline void lv_obj_align(lv_obj_t *, int, int, int) {}
inline void lv_text_get_size(lv_point_t *out, const char *s, const lv_font_t *f, int, int, int, int) {
  out->x = static_cast<int>(std::strlen(s)) * f->glyph_width;
  out->y = f->line_height;
}
inline const char *espcontrol_i18n(const char *s) { return s; }
inline std::string espcontrol_i18n(const std::string &s) { return s; }
inline const char *espcontrol_i18n_key(const char *s) { return s; }
#define ESP_LOGW(...) ((void)0)
#include "button_grid_config_parser.h"
#include "button_grid_limits.h"
#include "button_grid_card_runtime.h"
inline void format_clock_time_without_suffix(char *out, size_t n, int h, int m, bool twelve) {
  if (twelve) std::snprintf(out, n, "%d:%02d", h % 12 ? h % 12 : 12, m);
  else std::snprintf(out, n, "%02d:%02d", h, m);
}
inline void ha_subscribe_state(const std::string &, std::function<void(esphome::StringRef)>) {}
inline std::string effective_timezone_option(const std::string &s) { return s; }
inline std::string timezone_id_from_option(const std::string &s) { return s; }
inline bool timezone_offset_minutes_at_utc(const std::string &, time_t, int &offset) { offset = 0; return true; }
#include "button_grid_datetime_cards.h"
struct BtnSlot { lv_obj_t *btn, *icon_lbl, *sensor_container, *sensor_lbl, *unit_lbl, *text_lbl; };
struct CardPalette { bool has_sensor_color = false; uint32_t sensor_val = 0; };
struct DisplayProfile { const lv_font_t *sensor, *large; };
inline const lv_font_t *display_sensor_font(const DisplayProfile &d) { return d.sensor; }
inline const lv_font_t *display_large_sensor_font(const DisplayProfile &d) { return d.large; }
inline int display_large_sensor_unit_offset_percent(const DisplayProfile &) { return -10; }
inline bool large_number_square_card_layout(int rows, int cols) { return rows == 2 && cols == 2; }
inline bool card_span_is_wide(int rows, int cols) { return rows == 1 && cols == 2; }
inline bool wide_large_date_time_card_layout(int rows, int cols) { return card_span_is_wide(rows, cols); }
inline bool card_large_numbers_active_for_layout(const ParsedCfg &p, int rows, int cols) {
  return !card_large_numbers_disabled(p) && (large_number_square_card_layout(rows, cols) || card_large_numbers_enabled(p));
}
inline void apply_large_sensor_number_style(const BtnSlot &s, const lv_font_t *f, int) { s.sensor_lbl->font = f; }
inline void apply_wide_large_date_time_card_layout(const BtnSlot &s, int = LV_ALIGN_CENTER) { lv_obj_add_flag(s.text_lbl, LV_OBJ_FLAG_HIDDEN); }
#include "button_grid_date_time_driver.h"

int main() {
  const auto custom = parse_cfg(";;;;;;clock;;date_size=large,date_format=%25Y-%25m-%25d,time_format= %25H%3A%25M%3A%25S ,clock_font=mono,text_size=medium,large_numbers");
  assert(custom.options == "large_numbers,text_size=medium,clock_font=mono,time_format= %25H%3A%25M%3A%25S ,date_format=%25Y-%25m-%25d,date_size=large");
  assert(cfg_option_value(custom.options, "time_format") == " %H:%M:%S ");
  assert(parse_cfg(";;;;;;clock;;clock_font=bad,time_format=%25p,date_format=   ,date_size=large").options == "date_size=large");
  assert(parse_cfg(";;;;;;calendar;;clock_font=mono,time_format=%25S,date_format=%25Y,date_size=large,text_size=small").options == "text_size=small");
  assert(parse_cfg(";;;;;;timezone;;clock_font=mono,time_format=%25S,date_format=%25Y,date_size=large,text_size=small").options == "text_size=small");
  const lv_font_t small{20, 10}, medium{40, 20}, large{80, 40};
  const DisplayProfile display{&medium, &large};
  lv_obj_t btn, container, value, unit, label, icon;
  container.parent = &btn;
  value.parent = unit.parent = &container;
  label.parent = &btn;
  label.font = &small;
  label.text = "December";
  value.font = &medium;
  value.text = "23:59";
  BtnSlot slot{&btn, &icon, &container, &value, &unit, &label};
  const auto context = card_runtime_context("calendar");
  auto config = parse_cfg(";;;;;;calendar;datetime;text_size=small");
  register_calendar_card(&value, &unit, &label, true);
  update_calendar_cards_time(true, 31, 12, 23, 59, false);
  espcontrol::cards::date_time_driver_refresh_layout(slot, config, context, display, 2, 2);
  assert(value.font == &small);  // Explicit Small wins even on an automatically large card.
  config.options = "text_size=medium,large_numbers";
  espcontrol::cards::date_time_driver_refresh_layout(slot, config, context, display, 2, 2);
  assert(value.font == &medium);
  config.options = "text_size=large,large_numbers=off";
  espcontrol::cards::date_time_driver_refresh_layout(slot, config, context, display, 2, 2);
  assert(value.font == &large);
  btn.width = 120;
  update_calendar_cards_time(true, 1, 1, 10, 58, false);
  assert(value.font == &medium);  // Clock update re-fits to the live card bounds.
  btn.width = 70;
  update_calendar_cards_time(true, 1, 1, 11, 59, false);
  assert(value.font == &small);
  btn.width = 400;
  btn.height = 60;
  update_calendar_cards_time(true, 1, 1, 12, 0, false);
  assert(value.font == &small);  // Leave room for the date label, not just the digits.
  btn.height = 180;
  update_calendar_cards_time(true, 1, 1, 12, 1, false);
  assert(value.font == &large);  // Fit can grow back after the card grows.
  const int writes = font_writes;
  update_calendar_cards_time(true, 1, 1, 12, 1, false);
  assert(font_writes == writes);  // No redundant local-style write on routine ticks.
  btn.width = 120;
  container.scale_x = 384;
  update_calendar_cards_time(true, 1, 1, 12, 2, false);
  assert(value.font == &small);  // Width compensation is part of the visible bounds.
  container.scale_x = 256;
  config.options = "";
  value.font = &medium;
  espcontrol::cards::date_time_driver_refresh_layout(slot, config, context, display, 1, 1);
  assert(value.font == &medium);  // Absent option is unchanged legacy layout.
  config.options = "text_size=large";
  btn.width = 10;
  espcontrol::cards::date_time_driver_refresh_layout(slot, config, context, display, 1, 1);
  assert(lv_obj_has_flag(&container, LV_OBJ_FLAG_HIDDEN));
  config.options = "text_size=invalid";
  btn.width = 400;
  espcontrol::cards::date_time_driver_refresh_layout(slot, config, context, display, 1, 1);
  assert(!lv_obj_has_flag(&container, LV_OBJ_FLAG_HIDDEN));  // Auto undoes explicit no-fit hiding.

  for (const char *type : {"clock", "timezone"}) {
    reset_calendar_cards();
    reset_timezone_cards();
    config = parse_cfg(std::string(";;;;;;") + type + ";;text_size=large");
    const auto clock_context = card_runtime_context(type);
    espcontrol::cards::date_time_driver_setup_visual(slot, config, clock_context, {});
    espcontrol::cards::date_time_driver_refresh_layout(slot, config, clock_context, display, 1, 1);
    update_timezone_cards(true, 0, "UTC", false);
    assert(value.text == "00:00");
    assert(value.font == &large);
    btn.width = 120;
    update_timezone_cards(true, 60, "UTC", false);
    assert(value.font == &medium);  // Both local/world clocks refit live time, too.
    btn.width = 400;
  }

  reset_calendar_cards();
  reset_timezone_cards();
  label.font = &small;
  value.font = &medium;
  config = parse_cfg(";;;;;;clock;;time_format=%25I%3A%25M%3A%25S,date_format=%25Y-%25m-%25d");
  const auto local_clock = card_runtime_context("clock");
  espcontrol::cards::date_time_driver_setup_visual(slot, config, local_clock, {});
  espcontrol::cards::date_time_driver_refresh_layout(slot, config, local_clock, display, 1, 2);
  update_timezone_cards(true, 1735689599, "UTC", false);
  assert(value.text == "11:59:59");
  assert(label.text == "2024-12-31");
  assert(!lv_obj_has_flag(&label, LV_OBJ_FLAG_HIDDEN));
  btn.width = 180;
  update_timezone_cards(true, 1735689599, "UTC", false);
  assert(value.font == &medium);  // Joint fitting must override the wide-card large font.
  btn.height = 55;
  update_timezone_cards(true, 1735689599, "UTC", false);
  assert(value.font == &small);  // Both lines, not only time, must fit vertically.
  const int fitted_writes = font_writes;
  update_timezone_cards(true, 1735689599, "UTC", false);
  assert(font_writes == fitted_writes);
  btn.height = 180;
  btn.width = 400;
  update_timezone_cards(true, 1735689600, "UTC", false);
  assert(value.text == "12:00:00");
  assert(label.text == "2025-01-01");
  update_timezone_cards(false, 0, "UTC", false);
  assert(value.text == "--:--");
  assert(label.text.empty());

  config = parse_cfg(";;;;;;clock;;time_format=%25H%3A%25M%3A%25S %25Y-%25m-%25d %25H%3A%25M%3A%25S,date_format=%25d/%25m/%25Y");
  espcontrol::cards::date_time_driver_refresh_layout(slot, config, local_clock, display, 1, 2);
  value.text.reserve(64);
  label.text.reserve(64);
  tracked_allocations = 0;
  track_allocations = true;
  update_timezone_cards(true, 1735689601, "UTC", false);
  track_allocations = false;
  assert(value.text == "00:00:01 2025-01-01 00:00:01");
  assert(tracked_allocations == 0);  // Bounded formats need no per-tick C++ allocation.

  // Cleanup is also called with the incoming (possibly non-clock) context.
  espcontrol::cards::date_time_driver_cleanup(slot, {}, card_runtime_context("sensor"));
  assert(timezone_card_count() == 0);
  assert(label.font == &small);
  assert(value.font == &medium);
  assert(!lv_obj_has_flag(&container, LV_OBJ_FLAG_HIDDEN));
  const lv_font_t overhanging{40, 20, 3};
  const auto ink = measure_clock_card_shape(&value, &overhanging, "/00/");
  assert(ink.x == 86);  // Both raster overhangs must be reserved, not just advances.
  set_clock_card_font_pools({}, {{&overhanging}}, {});
  config = parse_cfg(";;;;;;clock;;clock_font=bold,time_format=/%25H/");
  espcontrol::cards::date_time_driver_setup_visual(slot, config, local_clock, {});
  espcontrol::cards::date_time_driver_refresh_layout(slot, config, local_clock, display, 1, 2);
  update_clock_cards_seconds(true, {1,2,3,4,5,2026}, false);
  update_timezone_cards(true, 1735689600, "UTC", false);
  assert(value.pad_left == 3 && value.pad_right == 3);
  assert(lv_obj_has_flag(&unit, LV_OBJ_FLAG_HIDDEN));  // Empty unit still has font height/padding in flex.
  const int pads_before = pad_writes;
  update_timezone_cards(true, 1735689660, "UTC", false);
  assert(pad_writes == pads_before);
  reset_timezone_cards();  // Grid rebuild must restore even before slot cleanup runs.
  assert(value.font == &medium && label.font == &small);
  assert(value.pad_left == 0 && value.pad_right == 0);
  assert(!lv_obj_has_flag(&label, LV_OBJ_FLAG_HIDDEN));
  assert(!lv_obj_has_flag(&unit, LV_OBJ_FLAG_HIDDEN));

  config = parse_cfg(";;;;;;clock;;clock_font=bold,time_format=%25S,date_format=%25Y");
  espcontrol::cards::date_time_driver_setup_visual(slot, config, local_clock, {});
  espcontrol::cards::date_time_driver_refresh_layout(slot, config, local_clock, display, 1, 2);
  update_timezone_cards(true, 1735689600, "UTC", false);
  config = parse_cfg(";;;;;;clock;;date_size=large");
  espcontrol::cards::date_time_driver_refresh_layout(slot, config, local_clock, display, 1, 2);
  update_timezone_cards(true, 1735693320, "UTC", true);
  assert(value.text == "1:02" && label.text.empty());
  assert(value.font == &large && label.font == &small);
  assert(lv_obj_has_flag(&label, LV_OBJ_FLAG_HIDDEN)); // Legacy wide-card layout restored.
  assert(!lv_obj_has_flag(&unit, LV_OBJ_FLAG_HIDDEN));
  assert(!clock_cards_need_seconds());
  reset_timezone_cards();

  btn.width = 30;
  config = parse_cfg(";;;;;;clock;;time_format=%25S");
  espcontrol::cards::date_time_driver_setup_visual(slot, config, local_clock, {});
  espcontrol::cards::date_time_driver_refresh_layout(slot, config, local_clock, display, 1, 1);
  update_clock_cards_seconds(true, {0,0,1,1,1,2025}, false);
  assert(!lv_obj_has_flag(&container, LV_OBJ_FLAG_HIDDEN));
  update_clock_cards_seconds(false, {}, false);
  assert(value.text == "--:--");
  assert(lv_obj_has_flag(&container, LV_OBJ_FLAG_HIDDEN)); // Invalid placeholder must fit too.
  config = parse_cfg(";;;;;;clock;;time_format=%25S,date_format=01234567890123456789012345678901");
  espcontrol::cards::date_time_driver_refresh_layout(slot, config, local_clock, display, 1, 1);
  update_clock_cards_seconds(true, {0,0,1,1,1,2025}, false);
  assert(!lv_obj_has_flag(&container, LV_OBJ_FLAG_HIDDEN)); // Date cannot fit, but keep the fitting time.
  assert(lv_obj_has_flag(&label, LV_OBJ_FLAG_HIDDEN));
  reset_timezone_cards();
  return 0;
}
