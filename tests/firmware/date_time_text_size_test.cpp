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
#include "esphome/core/string_ref.h"

using lv_coord_t = int;
using lv_align_t = int;
using lv_style_selector_t = int;
enum { LV_PART_MAIN = 0, LV_STATE_DEFAULT = 0, LV_ALIGN_LEFT_MID = 1,
  LV_ALIGN_CENTER = 2, LV_ALIGN_TOP_LEFT = 3, LV_OBJ_FLAG_HIDDEN = 1,
  LV_OBJ_FLAG_CLICKABLE = 2, LV_COORD_MAX = 32767, LV_TEXT_FLAG_NONE = 0,
  LV_STYLE_TEXT_FONT = 1, LV_STYLE_RES_FOUND = 1 };
struct lv_style_value_t { const void *ptr; };
struct lv_font_t { int line_height; int glyph_width; };
struct lv_point_t { int x; int y; };
struct lv_obj_t {
  lv_obj_t *parent = nullptr;
  const lv_font_t *font = nullptr;
  std::string text;
  int width = 400, height = 180, flags = 0, scale_x = 256, scale_y = 256;
};
inline void lv_label_set_text(lv_obj_t *o, const char *s) { o->text = s; }
inline void lv_label_set_display_text(lv_obj_t *o, const char *s) { o->text = s; }
inline const char *lv_label_get_text(lv_obj_t *o) { return o->text.c_str(); }
inline bool lv_obj_is_valid(lv_obj_t *o) { return o != nullptr; }
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
inline int lv_obj_get_local_style_prop(lv_obj_t *o, int, lv_style_value_t *out, int) { out->ptr = o->font; return LV_STYLE_RES_FOUND; }
inline void lv_obj_set_style_translate_y(lv_obj_t *, int, int) {}
inline void lv_obj_set_style_bg_color(lv_obj_t *, int, int) {}
inline int lv_color_hex(uint32_t c) { return static_cast<int>(c); }
inline void lv_obj_add_flag(lv_obj_t *o, int f) { o->flags |= f; }
inline void lv_obj_clear_flag(lv_obj_t *o, int f) { o->flags &= ~f; }
inline bool lv_obj_has_flag(lv_obj_t *o, int f) { return (o->flags & f) != 0; }
inline void lv_obj_align(lv_obj_t *, int, int, int) {}
inline void lv_txt_get_size(lv_point_t *out, const char *s, const lv_font_t *f, int, int, int, int) {
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
  std::snprintf(out, n, "%02d:%02d", twelve ? (h % 12 ? h % 12 : 12) : h, m);
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
}
