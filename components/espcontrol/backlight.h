#ifndef ESPCONTROL_BACKLIGHT_H
#define ESPCONTROL_BACKLIGHT_H

// =============================================================================
// BACKLIGHT - Brightness scheduling, sunrise/sunset, and UI helpers
// =============================================================================
// Shared C++ utilities for backlight schedule logic and screensaver layout.
// Extracted from YAML lambdas so the logic is testable and syntax-highlighted,
// while YAML retains only thin id() wiring.
// =============================================================================
#pragma once
#include <string>
#include <cstdio>
#include <cmath>
#include <cstring>
#include <vector>
#include <algorithm>
#include "esphome/components/lvgl/lvgl_esphome.h"
#include "clock_bar.h"
#include "display_text.h"
#include "backlight_fade.h"
#include "display_mode_controller.h"
#include "sun_calc.h"
#include "temperature_unit.h"

#ifdef USE_ESP32
#include <esp_sleep.h>
#include <esp_system.h>
#endif

using BacklightDisplayTakeoverCallback = void (*)();

inline BacklightDisplayTakeoverCallback &backlight_display_takeover_callback() {
  static BacklightDisplayTakeoverCallback callback = nullptr;
  return callback;
}

inline void set_backlight_display_takeover_callback(BacklightDisplayTakeoverCallback callback) {
  backlight_display_takeover_callback() = callback;
}

inline void backlight_close_modals_for_display_takeover() {
  BacklightDisplayTakeoverCallback callback = backlight_display_takeover_callback();
  if (callback) callback();
}

// ── Sunrise/sunset recalculation ─────────────────────────────────────

struct SunCalcResult {
  int rise_h, rise_m, set_h, set_m;
  bool valid;
  char sunrise_str[32];
  char sunset_str[32];
};

inline SunCalcResult recalc_sunrise_sunset(
    int year, int month, int day,
    const std::string &tz_option, bool use_12h = true) {
  SunCalcResult r = {};

  std::string effective_tz_option = effective_timezone_option(tz_option);
  std::string tz_id = timezone_id_from_option(effective_tz_option);
  float tz_offset = utc_offset_hours_for_date(year, month, day, effective_tz_option);

  float lat, lon;
  if (!lookup_tz_coords(tz_id, lat, lon)) {
    ESP_LOGW("backlight", "No coordinates for timezone %s", tz_id.c_str());
    r.valid = false;
    return r;
  }

  calc_sunrise_sunset(year, month, day, lat, lon, tz_offset,
                      r.rise_h, r.rise_m, r.set_h, r.set_m);
  r.valid = true;

  int rh = r.rise_h, rm = r.rise_m;
  if (use_12h) {
    snprintf(r.sunrise_str, sizeof(r.sunrise_str), "%d:%02d AM",
             (rh == 0) ? 12 : (rh > 12 ? rh - 12 : rh), rm);
    if (rh >= 12)
      snprintf(r.sunrise_str, sizeof(r.sunrise_str), "%d:%02d PM",
               (rh == 12) ? 12 : rh - 12, rm);
  } else {
    snprintf(r.sunrise_str, sizeof(r.sunrise_str), "%02d:%02d", rh, rm);
  }

  int sh = r.set_h, sm = r.set_m;
  if (use_12h) {
    snprintf(r.sunset_str, sizeof(r.sunset_str), "%d:%02d PM",
             (sh == 12) ? 12 : (sh > 12 ? sh - 12 : sh), sm);
    if (sh < 12)
      snprintf(r.sunset_str, sizeof(r.sunset_str), "%d:%02d AM",
               (sh == 0) ? 12 : sh, sm);
  } else {
    snprintf(r.sunset_str, sizeof(r.sunset_str), "%02d:%02d", sh, sm);
  }

  int tz_c = (int)((tz_offset >= 0 ? tz_offset : -tz_offset) * 10.0f + 0.5f);
  ESP_LOGI("backlight",
           "Sunrise %02d:%02d, Sunset %02d:%02d "
           "(tz=%s%d.%d)",
           rh, rm, sh, sm,
           tz_offset < 0 ? "-" : "", tz_c / 10, tz_c % 10);

  return r;
}

// ── Brightness calculation ───────────────────────────────────────────

inline float calc_brightness_pct(
    bool sunrise_valid, int rise_h, int rise_m, int set_h, int set_m,
    int now_h, int now_m, bool *is_daytime,
    float day_pct, float night_pct) {
  if (!sunrise_valid) return day_pct;
  int now_min = now_h * 60 + now_m;
  int rise_min = rise_h * 60 + rise_m;
  int set_min = set_h * 60 + set_m;
  *is_daytime = (now_min >= rise_min && now_min < set_min);
  return *is_daytime ? day_pct : night_pct;
}

// ── Daylight transition detection ────────────────────────────────────

inline bool check_daylight_transition(
    bool sunrise_valid, int rise_h, int rise_m, int set_h, int set_m,
    int now_h, int now_m, bool last_is_day) {
  if (!sunrise_valid) return false;
  int now_min = now_h * 60 + now_m;
  bool is_day = (now_min >= rise_h * 60 + rise_m) &&
                (now_min < set_h * 60 + set_m);
  return is_day != last_is_day;
}

inline bool parse_time_of_day(const std::string &value, int &hour, int &minute) {
  int h = -1;
  int m = -1;
  if (std::sscanf(value.c_str(), " %d:%d", &h, &m) != 2) return false;
  if (h < 0 || h > 23 || m < 0 || m > 59) return false;
  hour = h;
  minute = m;
  return true;
}

inline bool brightness_mode_manual(const std::string &mode) {
  return mode == "Manual" || mode == "manual";
}

inline bool brightness_mode_uses_fixed_times(const std::string &mode) {
  return mode == "Fixed times" || mode == "fixed_times" || mode == "fixed";
}

inline bool brightness_mode_uses_sun(const std::string &mode) {
  return !brightness_mode_manual(mode) && !brightness_mode_uses_fixed_times(mode);
}

inline std::string normalize_brightness_mode(const std::string &mode) {
  if (brightness_mode_manual(mode)) return "Manual";
  if (brightness_mode_uses_fixed_times(mode)) return "Fixed times";
  return "Sunrise and sunset";
}

inline bool brightness_schedule_times(
    const std::string &brightness_mode,
    bool sunrise_valid, int sunrise_h, int sunrise_m, int sunset_h, int sunset_m,
    const std::string &manual_dawn, const std::string &manual_dusk,
    int &rise_h, int &rise_m, int &set_h, int &set_m) {
  if (brightness_mode_manual(brightness_mode)) return false;

  if (brightness_mode_uses_sun(brightness_mode)) {
    rise_h = sunrise_h;
    rise_m = sunrise_m;
    set_h = sunset_h;
    set_m = sunset_m;
    return sunrise_valid;
  }

  int dawn_h = 6;
  int dawn_m = 0;
  int dusk_h = 18;
  int dusk_m = 0;
  bool dawn_valid = parse_time_of_day(manual_dawn, dawn_h, dawn_m);
  bool dusk_valid = parse_time_of_day(manual_dusk, dusk_h, dusk_m);
  rise_h = dawn_h;
  rise_m = dawn_m;
  set_h = dusk_h;
  set_m = dusk_m;
  return dawn_valid && dusk_valid;
}

inline bool brightness_schedule_times(
    const char *brightness_mode,
    bool sunrise_valid, int sunrise_h, int sunrise_m, int sunset_h, int sunset_m,
    const std::string &manual_dawn, const std::string &manual_dusk,
    int &rise_h, int &rise_m, int &set_h, int &set_m) {
  return brightness_schedule_times(
      std::string(brightness_mode ? brightness_mode : ""),
      sunrise_valid, sunrise_h, sunrise_m, sunset_h, sunset_m,
      manual_dawn, manual_dusk, rise_h, rise_m, set_h, set_m);
}

inline bool brightness_schedule_times(
    bool automatic_times_enabled,
    bool sunrise_valid, int sunrise_h, int sunrise_m, int sunset_h, int sunset_m,
    const std::string &manual_dawn, const std::string &manual_dusk,
    int &rise_h, int &rise_m, int &set_h, int &set_m) {
  return brightness_schedule_times(
      std::string(automatic_times_enabled ? "Sunrise and sunset" : "Fixed times"),
      sunrise_valid, sunrise_h, sunrise_m, sunset_h, sunset_m,
      manual_dawn, manual_dusk, rise_h, rise_m, set_h, set_m);
}

// ── Screen schedule helpers ───────────────────────────────────────────

inline bool screen_schedule_in_window(int now_h, int on_hour, int off_hour) {
  if (on_hour < 0) on_hour = 0;
  if (on_hour > 23) on_hour = 23;
  if (off_hour < 0) off_hour = 0;
  if (off_hour > 23) off_hour = 23;
  if (on_hour < off_hour) return now_h >= on_hour && now_h < off_hour;
  if (on_hour > off_hour) return now_h >= on_hour || now_h < off_hour;
  return true;
}

inline bool screen_schedule_always_on_mode(const std::string &mode) {
  return mode == "Screen Dimmed" || mode == "screen_dimmed" ||
         mode == "Dimmed" || mode == "dimmed" || mode == "dim" ||
         mode == "Always On" || mode == "always_on" || mode == "always";
}

inline bool screen_schedule_clock_mode(const std::string &mode) {
  return mode == "Clock" || mode == "clock";
}

inline bool screen_schedule_sensor_trigger(const std::string &trigger) {
  return trigger == "Sensor" || trigger == "sensor";
}

inline bool screen_schedule_sensor_activation_on(
    const std::string &activation) {
  return activation == "Sensor On" || activation == "sensor_on" ||
         activation == "On" || activation == "on";
}

inline bool screen_schedule_disabled_trigger(const std::string &trigger) {
  return trigger == "Disabled" || trigger == "disabled" || trigger == "Off" ||
         trigger == "off";
}

inline bool screen_schedule_time_trigger(const std::string &trigger) {
  return !screen_schedule_disabled_trigger(trigger) &&
         !screen_schedule_sensor_trigger(trigger);
}

inline bool screen_schedule_waiting_for_time(const std::string &trigger,
                                             bool enabled,
                                             bool time_valid) {
  return enabled && screen_schedule_time_trigger(trigger) && !time_valid;
}

inline bool screen_schedule_night_active(const std::string &trigger,
                                         bool enabled,
                                         bool presence_detected,
                                         bool time_valid,
                                         int now_h,
                                         int on_hour,
                                         int off_hour,
                                         const std::string &sensor_activation =
                                             "Sensor Off") {
  if (!enabled || screen_schedule_disabled_trigger(trigger)) return false;
  if (screen_schedule_sensor_trigger(trigger)) {
    return screen_schedule_sensor_activation_on(sensor_activation)
               ? presence_detected
               : !presence_detected;
  }
  if (!time_valid) return false;
  return !screen_schedule_in_window(now_h, on_hour, off_hour);
}

inline bool screen_schedule_normal_active(const std::string &trigger,
                                          bool enabled,
                                          bool presence_detected,
                                          bool time_valid,
                                          int now_h,
                                          int on_hour,
                                          int off_hour,
                                          const std::string &sensor_activation =
                                              "Sensor Off") {
  if (!enabled || screen_schedule_disabled_trigger(trigger)) return false;
  if (screen_schedule_sensor_trigger(trigger)) {
    return screen_schedule_sensor_activation_on(sensor_activation)
               ? !presence_detected
               : presence_detected;
  }
  if (!time_valid) return false;
  return screen_schedule_in_window(now_h, on_hour, off_hour);
}

inline bool screen_schedule_blocks_cover_art(const std::string &trigger,
                                             bool enabled,
                                             bool presence_detected,
                                             bool time_valid,
                                             int now_h,
                                             int on_hour,
                                             int off_hour,
                                             const std::string &sensor_activation =
                                                 "Sensor Off") {
  return screen_schedule_waiting_for_time(trigger, enabled, time_valid) ||
         screen_schedule_night_active(trigger, enabled, presence_detected,
                                      time_valid, now_h, on_hour, off_hour,
                                      sensor_activation);
}

// ── Screensaver action helpers ────────────────────────────────────────

inline bool screensaver_action_clock_mode(const std::string &action) {
  return action == "Clock" || action == "clock";
}

inline bool screensaver_action_dimmed_mode(const std::string &action) {
  return action == "Screen Dimmed" || action == "screen_dimmed" ||
         action == "Dimmed" || action == "dimmed" || action == "dim";
}

// ── Screensaver layout helpers ──────────────────────────────────────

inline bool clock_screensaver_local_number_is(lv_obj_t *obj, lv_style_prop_t prop,
                                              lv_coord_t value) {
  lv_style_value_t local;
  return lv_obj_get_local_style_prop(obj, prop, &local, LV_PART_MAIN) == LV_STYLE_RES_FOUND &&
         local.num == value;
}

inline void clock_screensaver_set_pos(lv_obj_t *obj, lv_coord_t x, lv_coord_t y) {
  if (!clock_screensaver_local_number_is(obj, LV_STYLE_X, x) ||
      !clock_screensaver_local_number_is(obj, LV_STYLE_Y, y)) lv_obj_set_pos(obj, x, y);
}

inline void clock_screensaver_set_size(lv_obj_t *obj, lv_coord_t w, lv_coord_t h) {
  if (!clock_screensaver_local_number_is(obj, LV_STYLE_WIDTH, w) ||
      !clock_screensaver_local_number_is(obj, LV_STYLE_HEIGHT, h)) lv_obj_set_size(obj, w, h);
}

inline void screensaver_fill_screen(lv_obj_t *obj) {
  if (!obj) return;
  clock_screensaver_set_pos(obj, 0, 0);
  clock_screensaver_set_size(obj, lv_pct(100), lv_pct(100));
}

inline void refresh_screensaver_fullscreen(lv_obj_t *clock_overlay,
                                           lv_obj_t *dim_guard) {
  screensaver_fill_screen(clock_overlay);
  screensaver_fill_screen(dim_guard);
}

#include "clock_numeric_format.h"

inline uint32_t parse_clock_screensaver_text_color(const std::string &hex) {
  if (hex.size() != 6) return 0xFFFFFF;
  for (char ch : hex) {
    bool digit = ch >= '0' && ch <= '9';
    bool upper = ch >= 'A' && ch <= 'F';
    bool lower = ch >= 'a' && ch <= 'f';
    if (!digit && !upper && !lower) return 0xFFFFFF;
  }
  return strtoul(hex.c_str(), nullptr, 16);
}

inline void apply_clock_screensaver_text_color(lv_obj_t *label,
                                               const std::string &hex) {
  if (!label) return;
  const lv_color_t color = lv_color_hex(parse_clock_screensaver_text_color(hex));
  lv_style_value_t local;
  if (lv_obj_get_local_style_prop(label, LV_STYLE_TEXT_COLOR, &local,
                                 LV_PART_MAIN) != LV_STYLE_RES_FOUND ||
      !lv_color_eq(local.color, color)) {
    lv_obj_set_style_text_color(label, color, LV_PART_MAIN);
  }
}

inline void position_clock_screensaver_label(lv_obj_t *overlay, lv_obj_t *label,
                                             int minute) {
  if (!label) return;
  if (!overlay) overlay = lv_obj_get_parent(label);
  screensaver_fill_screen(overlay);
  if (overlay) lv_obj_update_layout(overlay);

  lv_coord_t screen_w = overlay ? lv_obj_get_width(overlay) : 0;
  lv_coord_t screen_h = overlay ? lv_obj_get_height(overlay) : 0;
  lv_disp_t *disp = lv_disp_get_default();
  if (screen_w <= 0 && disp) screen_w = lv_disp_get_hor_res(disp);
  if (screen_h <= 0 && disp) screen_h = lv_disp_get_ver_res(disp);
  if (screen_w <= 0) screen_w = 480;
  if (screen_h <= 0) screen_h = 480;

  lv_obj_update_layout(label);
  lv_coord_t w = lv_obj_get_width(label);
  lv_coord_t h = lv_obj_get_height(label);
  int ox = (minute * 7) % 61 - 30;
  int oy = (minute * 13) % 41 - 20;
  // Preserve the legacy drift where it fits; wide fonts and rotated displays
  // may have less margin. An oversized legacy label has a stable origin rather
  // than an inverted clamp range (its compiled size is intentionally unchanged).
  const lv_coord_t max_x = std::max<lv_coord_t>(0, screen_w - w);
  const lv_coord_t max_y = std::max<lv_coord_t>(0, screen_h - h);
  clock_screensaver_set_pos(label, std::clamp<lv_coord_t>(screen_w / 2 + ox - w / 2, 0, max_x),
                 std::clamp<lv_coord_t>(screen_h / 2 + oy - h / 2, 0, max_y));
}

inline const lv_font_t *clock_screensaver_font(
    const std::string &option, const lv_font_t *thin,
    const lv_font_t *bold, const lv_font_t *mono) {
  if (option == "Roboto Bold") return bold;
  if (option == "Roboto Mono") return mono;
  return thin;  // Includes missing/unknown restored options and legacy default.
}

inline void apply_clock_screensaver_font(lv_obj_t *label, const lv_font_t *font) {
  lv_style_value_t local;
  if (lv_obj_get_local_style_prop(label, LV_STYLE_TEXT_FONT, &local, LV_PART_MAIN) != LV_STYLE_RES_FOUND ||
      local.ptr != font) lv_obj_set_style_text_font(label, font, LV_PART_MAIN);
}

// Legacy presentation used when custom time/date/size settings are neutral.
// This updates the existing label only: no navigation, reveal, refresh or PWM.
inline void update_clock_screensaver_appearance(
    lv_obj_t *overlay, lv_obj_t *label, const std::string &option,
    const lv_font_t *thin, const lv_font_t *bold, const lv_font_t *mono,
    const std::string &hex, const char *text, int minute) {
  if (!label) return;  // Restored settings can arrive before LVGL setup.
  const lv_font_t *font = clock_screensaver_font(option, thin, bold, mono);
  apply_clock_screensaver_font(label, font);
  apply_clock_screensaver_text_color(label, hex);
  // Invalid time keeps the last label text, not LVGL's explicit nullptr refresh.
  if (text) lv_label_set_display_text(label, text);
  // Flush pending font/text geometry before measuring and clamping drift.
  position_clock_screensaver_label(overlay, label, minute);
}

struct ClockScreensaverFont {
  int size;
  const lv_font_t *font;
};

struct ClockScreensaverSettings {
  std::string time_format, date_format, time_size, date_size, color;
};

#include "clock_font_measure.h"

struct ClockScreensaverLayout {
  const lv_font_t *time_font = nullptr, *date_font = nullptr;
  ClockScreensaverMeasure time, date;
};

// Pool is ordered smallest to largest, with the unchanged profile font last.
// Prefer the largest fitting time, then the largest date within its own bound.
inline ClockScreensaverLayout choose_clock_screensaver_layout(
    const ClockScreensaverFont *pool, size_t count, const std::string &time_shape,
    const std::string &date_shape, int time_upper, int date_upper,
    lv_coord_t screen_w, lv_coord_t screen_h) {
  ClockScreensaverLayout result;
  for (size_t t = count; t-- > 0;) {
    if (pool[t].size > time_upper) continue;
    const auto time = measure_clock_screensaver_shape(pool[t].font, time_shape);
    if (time.width > screen_w || time.height > screen_h) continue;
    if (date_shape.empty()) return {pool[t].font, nullptr, time, {}};
    for (size_t d = count; d-- > 0;) {
      if (pool[d].size > date_upper) continue;
      const auto date = measure_clock_screensaver_shape(pool[d].font, date_shape);
      if (date.width <= screen_w && time.height + 8 + date.height <= screen_h)
        return {pool[t].font, pool[d].font, time, date};
    }
  }
  // All supported profiles fit the bounded 32-character outputs at 24px.
  // A future smaller display must provide a smaller compiled pool, not scale.
  return result;
}

inline void clock_screensaver_set_pad(lv_obj_t *label, lv_coord_t pad) {
  if (!clock_screensaver_local_number_is(label, LV_STYLE_PAD_LEFT, pad))
    lv_obj_set_style_pad_left(label, pad, LV_PART_MAIN);
  if (!clock_screensaver_local_number_is(label, LV_STYLE_PAD_RIGHT, pad))
    lv_obj_set_style_pad_right(label, pad, LV_PART_MAIN);
}

inline void clock_screensaver_set_hidden(lv_obj_t *label, bool hidden) {
  if (!label || lv_obj_has_flag(label, LV_OBJ_FLAG_HIDDEN) == hidden) return;
  if (hidden) lv_obj_add_flag(label, LV_OBJ_FLAG_HIDDEN);
  else lv_obj_clear_flag(label, LV_OBJ_FLAG_HIDDEN);
}

// One appearance path for entry, settings, 30s and conditional 1s updates.
// No recreation, display refresh, fullscreen invalidation, navigation or PWM.
inline void update_clock_screensaver_labels(
    lv_obj_t *overlay, lv_obj_t *label, lv_obj_t *date_label,
    const ClockScreensaverFont *pool, size_t count,
    const ClockScreensaverSettings &settings, const ClockScreensaverTime &now,
    bool valid_time, bool use_12h) {
  if (!label || !date_label || !pool || count == 0) return;
  if (!overlay) overlay = lv_obj_get_parent(label);
  const auto time_format = parse_clock_screensaver_format(settings.time_format);
  const auto date_format = parse_clock_screensaver_format(settings.date_format);
  const bool default_time = !time_format.valid || settings.time_format.empty();
  std::string time_text, date_text;
  if (valid_time) {
    if (default_time) {
      char buf[8];
      format_clock_time_without_suffix(buf, sizeof(buf), now.hour, now.minute, use_12h);
      time_text = buf;
    } else {
      format_clock_screensaver_numeric(settings.time_format, now, time_text);
    }
    if (date_format.valid) format_clock_screensaver_numeric(settings.date_format, now, date_text);
  }
  const bool show_date = !date_text.empty();
  clock_screensaver_set_hidden(date_label, !show_date);
  // An invalid clock retains the last time, but never displays a stale date or
  // a startup placeholder. Its previous text is also used for safe size fitting.
  const char *text = valid_time && !time_text.empty() ? time_text.c_str() : nullptr;
  const int minute = valid_time ? now.minute : 0;
  const int legacy_size = pool[count - 1].size;
  const int time_upper = settings.time_size == "Small" ? std::min(64, legacy_size) :
                         settings.time_size == "Medium" ? std::min(96, legacy_size) : legacy_size;
  const int date_upper = settings.date_size == "Small" ? 24 : settings.date_size == "Large" ? 64 : 40;
  if (valid_time && default_time && !show_date && time_upper == legacy_size) {
    // Restore content sizing after leaving a custom layout, preserving the
    // original unpadded 12h string and its exact centering/drift.
    clock_screensaver_set_size(label, LV_SIZE_CONTENT, LV_SIZE_CONTENT);
    clock_screensaver_set_pad(label, 0);
    const auto *font = pool[count - 1].font;
    update_clock_screensaver_appearance(overlay, label, "", font, font, font,
                                        settings.color, text, minute);
    return;
  }
  screensaver_fill_screen(overlay);
  if (overlay) lv_obj_update_layout(overlay);
  lv_coord_t screen_w = overlay ? lv_obj_get_width(overlay) : 0;
  lv_coord_t screen_h = overlay ? lv_obj_get_height(overlay) : 0;
  lv_disp_t *disp = lv_disp_get_default();
  if (screen_w <= 0) screen_w = disp ? lv_disp_get_hor_res(disp) : 480;
  if (screen_h <= 0) screen_h = disp ? lv_disp_get_ver_res(disp) : 480;
  const std::string time_shape = !valid_time ? lv_label_get_text(label) :
                                 default_time ? "00:00" : time_format.shape;
  const auto layout = choose_clock_screensaver_layout(pool, count, time_shape,
      show_date ? date_format.shape : "", time_upper, date_upper, screen_w, screen_h);
  if (!layout.time_font) { clock_screensaver_set_hidden(date_label, true); return; }
  apply_clock_screensaver_font(label, layout.time_font);
  apply_clock_screensaver_text_color(label, settings.color);
  clock_screensaver_set_pad(label, layout.time.pad);
  clock_screensaver_set_size(label, layout.time.width, layout.time.height);
  if (text) lv_label_set_display_text(label, text);
  const lv_coord_t total_h = layout.time.height + (show_date ? 8 + layout.date.height : 0);
  const lv_coord_t y = std::clamp<lv_coord_t>(screen_h / 2 + (minute * 13) % 41 - 20 - total_h / 2,
                                            0, std::max<lv_coord_t>(0, screen_h - total_h));
  auto x = [&](lv_coord_t width) {
    return std::clamp<lv_coord_t>(screen_w / 2 + (minute * 7) % 61 - 30 - width / 2,
                                  0, std::max<lv_coord_t>(0, screen_w - width));
  };
  clock_screensaver_set_pos(label, x(layout.time.width), y);
  if (show_date) {
    apply_clock_screensaver_font(date_label, layout.date_font);
    apply_clock_screensaver_text_color(date_label, settings.color);
    clock_screensaver_set_pad(date_label, layout.date.pad);
    clock_screensaver_set_size(date_label, layout.date.width, layout.date.height);
    lv_label_set_display_text(date_label, date_text.c_str());
    clock_screensaver_set_pos(date_label, x(layout.date.width), y + layout.time.height + 8);
    lv_obj_update_layout(date_label);
  }
  lv_obj_update_layout(label);
}

// ── Firmware update interval ─────────────────────────────────────────

inline bool should_check_update(int counter, const std::string &freq) {
  int threshold = 24;
  if (freq == "Hourly") threshold = 1;
  else if (freq == "Weekly") threshold = 168;
  else if (freq == "Monthly") threshold = 720;
  return counter % threshold == 0;
}

#endif  // ESPCONTROL_BACKLIGHT_H
