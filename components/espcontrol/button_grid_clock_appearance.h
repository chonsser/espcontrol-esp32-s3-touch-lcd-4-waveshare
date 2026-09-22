#pragma once

#include <cstring>
#include "clock_font_measure.h"

// Clock-card-only appearance state. Fonts are supplied once by the common
// screen_clock package; the default family continues using the sensor fonts.
struct ClockCardFontPool {
  const lv_font_t *fonts[6] = {};
};

inline ClockCardFontPool *clock_card_font_pools() {
  static ClockCardFontPool pools[3];
  return pools;
}

inline void set_clock_card_font_pools(const ClockCardFontPool &thin,
                                      const ClockCardFontPool &bold,
                                      const ClockCardFontPool &mono) {
  auto *pools = clock_card_font_pools();
  pools[0] = thin;
  pools[1] = bold;
  pools[2] = mono;
}

struct ClockCardAppearance {
  std::string time_format, date_format, time_shape, date_shape;
  uint8_t family = 0, time_size = 0, date_size = 0;
  bool enabled = false, seconds = false, large = false;
  const lv_font_t *legacy_value = nullptr, *legacy_label = nullptr;
  const lv_font_t *legacy_fonts[3] = {};
  lv_coord_t value_pad_left = 0, value_pad_right = 0, label_pad_left = 0, label_pad_right = 0;
};

inline uint8_t clock_card_size_option(const std::string &value) {
  return value == "small" ? 1 : value == "medium" ? 2 : value == "large" ? 3 : 0;
}

inline void configure_clock_card_appearance(ClockCardAppearance &appearance,
                                           const ParsedCfg &config) {
  appearance.time_format = cfg_option_value(config.options, "time_format");
  appearance.date_format = cfg_option_value(config.options, "date_format");
  auto time = parse_clock_screensaver_format(appearance.time_format);
  auto date = parse_clock_screensaver_format(appearance.date_format);
  if (!time.valid) appearance.time_format.clear();
  if (!date.valid) appearance.date_format.clear();
  appearance.time_shape = appearance.time_format.empty() ? "00:00" : time.shape;
  appearance.date_shape = date.valid ? date.shape : "";
  appearance.seconds = (time.valid && time.seconds) || (date.valid && date.seconds);
  const std::string family = cfg_option_value(config.options, "clock_font");
  appearance.family = family == "thin" ? 1 : family == "bold" ? 2 : family == "mono" ? 3 : 0;
  appearance.time_size = clock_card_size_option(cfg_option_value(config.options, "text_size"));
  appearance.date_size = clock_card_size_option(cfg_option_value(config.options, "date_size"));
  appearance.enabled = appearance.family || !appearance.time_format.empty() || !appearance.date_format.empty();
}

inline void clock_card_set_font(lv_obj_t *label, const lv_font_t *font) {
  if (!label || !font) return;
  lv_style_value_t local;
  if (lv_obj_get_local_style_prop(label, LV_STYLE_TEXT_FONT, &local, LV_PART_MAIN) != LV_STYLE_RES_FOUND ||
      local.ptr != font) lv_obj_set_style_text_font(label, font, LV_PART_MAIN);
}

inline void clock_card_set_padding(lv_obj_t *obj, lv_coord_t left, lv_coord_t right) {
  lv_style_value_t local;
  if (lv_obj_get_local_style_prop(obj, LV_STYLE_PAD_LEFT, &local, LV_PART_MAIN) != LV_STYLE_RES_FOUND ||
      local.num != left) lv_obj_set_style_pad_left(obj, left, LV_PART_MAIN);
  if (lv_obj_get_local_style_prop(obj, LV_STYLE_PAD_RIGHT, &local, LV_PART_MAIN) != LV_STYLE_RES_FOUND ||
      local.num != right) lv_obj_set_style_pad_right(obj, right, LV_PART_MAIN);
}

inline void clock_card_set_hidden(lv_obj_t *obj, bool hidden) {
  if (!obj || lv_obj_has_flag(obj, LV_OBJ_FLAG_HIDDEN) == hidden) return;
  if (hidden) lv_obj_add_flag(obj, LV_OBJ_FLAG_HIDDEN);
  else lv_obj_clear_flag(obj, LV_OBJ_FLAG_HIDDEN);
}

// Reserve the widest digit, independently of the current second (including
// proportional fonts). Individual advances also avoid kerning-dependent growth.
inline lv_point_t measure_clock_card_shape(lv_obj_t *label, const lv_font_t *font,
                                           const std::string &shape) {
  const auto measured = measure_clock_screensaver_shape(font, shape,
    lv_obj_get_style_text_letter_space(label, LV_PART_MAIN));
  return {measured.width, measured.height};
}

inline bool clock_card_shape_fits(lv_obj_t *label, lv_obj_t *transform,
                                  const lv_font_t *font, const std::string &shape,
                                  lv_coord_t width, lv_coord_t &height) {
  const auto measured = measure_clock_card_shape(label, font, shape);
  height = (measured.y * lv_obj_get_style_transform_scale_y(transform, LV_PART_MAIN) + 255) / 256;
  return (measured.x * lv_obj_get_style_transform_scale_x(transform, LV_PART_MAIN) + 255) / 256 <= width;
}

inline void fit_clock_card_text(lv_obj_t *value, lv_obj_t *label,
                                const ClockCardAppearance &appearance) {
  if (!appearance.enabled || !value || !label) return;
  lv_obj_t *container = lv_obj_get_parent(value);
  lv_obj_t *button = lv_obj_get_parent(label);
  if (!container || !button) return;
  lv_obj_update_layout(button);
  const lv_coord_t width = lv_obj_get_content_width(button);
  const lv_coord_t height = lv_obj_get_content_height(button);
  const bool date_visible = !appearance.date_shape.empty() && *lv_label_get_text(label);
  static const std::string invalid_shape = "--:--";
  const std::string &time_shape = std::strcmp(lv_label_get_text(value), "--:--") == 0
    ? invalid_shape : appearance.time_shape;
  const lv_font_t *const *pool = appearance.legacy_fonts;
  int count = 3;
  if (appearance.family && clock_card_font_pools()[appearance.family - 1].fonts[0]) {
    pool = clock_card_font_pools()[appearance.family - 1].fonts;
    count = 6;
  }
  const int time_index = appearance.time_size ? appearance.time_size - 1 : appearance.large ? 2 : 1;
  const int date_index = appearance.date_size ? appearance.date_size - 1 : 0;
  const int time_upper = appearance.legacy_fonts[time_index] ? appearance.legacy_fonts[time_index]->line_height : 0;
  const int date_upper = appearance.legacy_fonts[date_index] ? appearance.legacy_fonts[date_index]->line_height : 0;
  const lv_font_t *time_font = nullptr, *date_font = nullptr, *time_only_font = nullptr;
  for (int t = count - 1; t >= 0 && !time_font; --t) {
    if (!pool[t] || (t && pool[t]->line_height > time_upper)) continue;
    lv_coord_t time_height;
    if (!clock_card_shape_fits(value, container, pool[t], time_shape, width, time_height) ||
        time_height > height) continue;
    if (!time_only_font) time_only_font = pool[t];
    if (!date_visible) { time_font = pool[t]; break; }
    for (int d = count - 1; d >= 0; --d) {
      if (!pool[d] || (d && pool[d]->line_height > date_upper)) continue;
      lv_coord_t date_height;
      if (clock_card_shape_fits(label, label, pool[d], appearance.date_shape, width, date_height) &&
          time_height + 4 + date_height <= height) {
        time_font = pool[t]; date_font = pool[d]; break;
      }
    }
  }
  // A bounded but unusually long date must not blank an otherwise fitting time.
  if (!time_font) time_font = time_only_font;
  clock_card_set_hidden(container, !time_font);
  clock_card_set_hidden(label, !date_font);
  clock_card_set_font(value, time_font);
  clock_card_set_font(label, date_font);
  if (time_font) {
    const auto pad = measure_clock_screensaver_shape(time_font, time_shape).pad;
    clock_card_set_padding(value, pad, pad);
  }
  if (date_font) {
    const auto pad = measure_clock_screensaver_shape(date_font, appearance.date_shape).pad;
    clock_card_set_padding(label, pad, pad);
  }
}

inline void reset_clock_card_appearance(lv_obj_t *value, lv_obj_t *label,
                                       ClockCardAppearance &appearance, lv_obj_t *unit = nullptr) {
  if (!appearance.enabled) return;
  clock_card_set_font(value, appearance.legacy_value);
  clock_card_set_font(label, appearance.legacy_label);
  clock_card_set_padding(value, appearance.value_pad_left, appearance.value_pad_right);
  clock_card_set_padding(label, appearance.label_pad_left, appearance.label_pad_right);
  clock_card_set_hidden(lv_obj_get_parent(value), false);
  clock_card_set_hidden(label, false);
  clock_card_set_hidden(unit, false);
  appearance.enabled = false;
}
