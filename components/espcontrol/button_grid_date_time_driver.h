#pragma once

// Shared lifecycle driver for Calendar, Clock, and World Clock runtime types.
// Calendar binds to Home Assistant's date source; the local-time variants use
// the central timezone update registry.

namespace espcontrol::cards {

inline bool date_time_driver_matches(const Context &context) {
  using Type = card_runtime::CardTypeId;
  if (context.runtime.driver != card_runtime::CardDriverId::DATE_TIME) return false;
  return context.runtime.type == Type::CALENDAR ||
         context.runtime.type == Type::CLOCK ||
         context.runtime.type == Type::TIMEZONE;
}

inline bool date_time_driver_setup_visual(
    BtnSlot &slot, const ParsedCfg &config, const Context &context,
    const CardPalette &palette) {
  if (!date_time_driver_matches(context)) return false;

  if (palette.has_sensor_color) {
    lv_obj_set_style_bg_color(
      slot.btn, lv_color_hex(palette.sensor_val),
      static_cast<lv_style_selector_t>(LV_PART_MAIN) |
        static_cast<lv_style_selector_t>(LV_STATE_DEFAULT));
  }
  lv_obj_add_flag(slot.icon_lbl, LV_OBJ_FLAG_HIDDEN);
  lv_obj_clear_flag(slot.sensor_container, LV_OBJ_FLAG_HIDDEN);
  const bool calendar =
    context.runtime.type == card_runtime::CardTypeId::CALENDAR;
  lv_label_set_display_text(slot.sensor_lbl, calendar ? "--" : "--:--");
  lv_label_set_display_text(slot.unit_lbl, "");

  if (calendar) {
    lv_label_set_display_text(slot.text_lbl, espcontrol_i18n("Date"));
    register_calendar_card(
      slot.sensor_lbl, slot.unit_lbl, slot.text_lbl,
      calendar_card_shows_time(config));
  } else if (context.runtime.type == card_runtime::CardTypeId::TIMEZONE) {
    const std::string label = config.label.empty()
      ? timezone_city_label(config.entity)
      : config.label;
    lv_label_set_display_text(slot.text_lbl, label.c_str());
    register_timezone_card(
      slot.sensor_lbl, slot.unit_lbl, slot.text_lbl,
      config.entity, config.label);
  } else {
    lv_label_set_display_text(slot.text_lbl, "");
    register_timezone_card(
      slot.sensor_lbl, slot.unit_lbl, slot.text_lbl,
      config.entity, "", false);
    for (int i = 0; i < timezone_card_count(); ++i) {
      auto &ref = timezone_card_refs()[i];
      if (ref.value_lbl != slot.sensor_lbl) continue;
      ref.clock.legacy_label = lv_obj_get_style_text_font(slot.text_lbl, LV_PART_MAIN);
      ref.clock.legacy_value = lv_obj_get_style_text_font(slot.sensor_lbl, LV_PART_MAIN);
      ref.clock.value_pad_left = lv_obj_get_style_pad_left(slot.sensor_lbl, LV_PART_MAIN);
      ref.clock.value_pad_right = lv_obj_get_style_pad_right(slot.sensor_lbl, LV_PART_MAIN);
      ref.clock.label_pad_left = lv_obj_get_style_pad_left(slot.text_lbl, LV_PART_MAIN);
      ref.clock.label_pad_right = lv_obj_get_style_pad_right(slot.text_lbl, LV_PART_MAIN);
      configure_clock_card_appearance(ref.clock, config);
    }
  }
  return true;
}

inline bool date_time_driver_attach_interaction(
    BtnSlot &slot, const ParsedCfg &, const Context &context) {
  if (!date_time_driver_matches(context)) return false;
  lv_obj_clear_flag(slot.btn, LV_OBJ_FLAG_CLICKABLE);
  return true;
}

inline bool date_time_driver_bind_data(
    BtnSlot &, const ParsedCfg &config, const Context &context) {
  if (!date_time_driver_matches(context)) return false;
  if (context.runtime.type == card_runtime::CardTypeId::CALENDAR) {
    subscribe_calendar_date_source(config.entity);
  }
  // Local-time cards are registered during visual setup and receive updates
  // from update_timezone_cards(). They do not own an HA subscription.
  return date_time_driver_matches(context);
}

inline bool date_time_driver_large_layout(
    const Context &context, int row_span, int col_span) {
  if (context.runtime.type == card_runtime::CardTypeId::CLOCK) {
    return large_number_square_card_layout(row_span, col_span) ||
           card_span_is_wide(row_span, col_span);
  }
  return large_number_square_card_layout(row_span, col_span);
}

inline bool date_time_driver_text_size_layout(
    BtnSlot &slot, const ParsedCfg &config, const DisplayProfile &display) {
  const std::string value = cfg_option_value(config.options, "text_size");
  DateTimeCardTextSize size;
  size.requested = value == "small" ? 1 : value == "medium" ? 2 : value == "large" ? 3 : 0;
  if (size.requested) {
    size.fonts[0] = lv_obj_get_style_text_font(slot.text_lbl, LV_PART_MAIN);
    size.fonts[1] = display_sensor_font(display);
    size.fonts[2] = display_large_sensor_font(display);
    lv_obj_clear_flag(slot.text_lbl, LV_OBJ_FLAG_HIDDEN);
    lv_obj_align(slot.sensor_container, LV_ALIGN_TOP_LEFT, 0, 0);
    if (slot.unit_lbl) lv_obj_set_style_translate_y(slot.unit_lbl, 0, LV_PART_MAIN);
  }
  for (int i = 0; i < calendar_card_count(); ++i) {
    auto &ref = calendar_card_refs()[i];
    if (ref.value_lbl == slot.sensor_lbl) ref.text_size = size;
  }
  for (int i = 0; i < timezone_card_count(); ++i) {
    auto &ref = timezone_card_refs()[i];
    if (ref.value_lbl == slot.sensor_lbl) ref.text_size = size;
  }
  if (!size.requested) lv_obj_clear_flag(slot.sensor_container, LV_OBJ_FLAG_HIDDEN);
  fit_date_time_card_text(slot.sensor_lbl, slot.text_lbl, size);
  return size.requested != 0;
}

inline bool date_time_driver_refresh_layout(
    BtnSlot &slot, const ParsedCfg &config, const Context &context,
    const DisplayProfile &display, int row_span, int col_span) {
  if (!date_time_driver_matches(context)) return false;
  if (context.runtime.type == card_runtime::CardTypeId::CLOCK) {
    for (int i = 0; i < timezone_card_count(); ++i) {
      auto &ref = timezone_card_refs()[i];
      if (ref.value_lbl != slot.sensor_lbl) continue;
      const bool was_custom = ref.clock.enabled;
      const auto previous = ref.clock;
      configure_clock_card_appearance(ref.clock, config);
      if (!ref.clock.enabled && was_custom) {
        auto reset = previous;
        reset_clock_card_appearance(slot.sensor_lbl, slot.text_lbl, reset, slot.unit_lbl);
        lv_label_set_display_text(slot.text_lbl, "");
      }
      if (!ref.clock.enabled) break;
      ref.clock.legacy_fonts[0] = ref.clock.legacy_label;
      ref.clock.legacy_fonts[1] = display_sensor_font(display);
      ref.clock.legacy_fonts[2] = display_large_sensor_font(display);
      ref.clock.large = date_time_driver_large_layout(context, row_span, col_span) &&
        !card_large_numbers_disabled(config);
      lv_obj_align(slot.sensor_container, LV_ALIGN_TOP_LEFT, 0, 0);
      if (slot.unit_lbl) lv_obj_set_style_translate_y(slot.unit_lbl, 0, LV_PART_MAIN);
      clock_card_set_hidden(slot.unit_lbl, true);
      fit_clock_card_text(slot.sensor_lbl, slot.text_lbl, ref.clock);
      return true;
    }
  }
  if (date_time_driver_text_size_layout(slot, config, display)) return true;
  if (context.runtime.type == card_runtime::CardTypeId::CALENDAR) {
    if (large_number_square_card_layout(row_span, col_span) &&
        card_large_numbers_active_for_layout(config, row_span, col_span) &&
        display_large_sensor_font(display)) {
      apply_large_sensor_number_style(
        slot, display_large_sensor_font(display),
        display_large_sensor_unit_offset_percent(display));
      if (wide_large_date_time_card_layout(row_span, col_span)) {
        apply_wide_large_date_time_card_layout(
          slot, calendar_card_shows_time(config)
            ? LV_ALIGN_LEFT_MID
            : LV_ALIGN_CENTER);
      }
    }
    return true;
  }
  const bool large_layout =
    date_time_driver_large_layout(context, row_span, col_span);
  const bool large_numbers = card_large_numbers_supported(config) &&
    !card_large_numbers_disabled(config) &&
    (large_layout || card_large_numbers_enabled(config));
  if (!large_layout || !large_numbers || !display_large_sensor_font(display)) {
    return true;
  }

  apply_large_sensor_number_style(
    slot, display_large_sensor_font(display),
    display_large_sensor_unit_offset_percent(display));
  if (card_span_is_wide(row_span, col_span)) {
    const lv_align_t align =
      context.runtime.type == card_runtime::CardTypeId::CLOCK
        ? LV_ALIGN_LEFT_MID
        : LV_ALIGN_CENTER;
    apply_wide_large_date_time_card_layout(slot, align);
  }
  return true;
}

inline bool date_time_driver_cleanup(
    BtnSlot &slot, const ParsedCfg &, const Context &context) {
  // Setup invokes cleanup with the incoming card type, not the outgoing one.
  // Remove by widget identity so reused cards cannot retain a ticking ref/style.
  auto *refs = timezone_card_refs();
  int &count = timezone_card_count();
  for (int i = 0; i < count;) {
    if (refs[i].value_lbl != slot.sensor_lbl) { ++i; continue; }
    reset_clock_card_appearance(slot.sensor_lbl, slot.text_lbl, refs[i].clock, slot.unit_lbl);
    for (int j = i + 1; j < count; ++j) refs[j - 1] = std::move(refs[j]);
    refs[--count] = {};
  }
  return date_time_driver_matches(context);
}

}  // namespace espcontrol::cards
