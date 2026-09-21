#pragma once

// A read-only view of an entity. The overlay owns its Home Assistant callbacks;
// closing it or rebuilding the grid releases them before any widgets are freed.
struct MoreInfoModalUi {
  lv_obj_t *overlay = nullptr;
  lv_obj_t *title = nullptr;
  lv_obj_t *value = nullptr;
  std::string state = "--";
  std::string unit;
  uint32_t generation = 0;
};

inline MoreInfoModalUi &more_info_modal_ui() {
  static MoreInfoModalUi ui;
  return ui;
}

inline bool more_info_entity_valid(const std::string &entity) {
  const size_t dot = entity.find('.');
  if (dot == std::string::npos || dot == 0 || dot + 1 == entity.size()) return false;
  for (size_t i = 0; i < entity.size(); ++i) {
    if (i == dot) continue;
    const char c = entity[i];
    if ((c >= 'a' && c <= 'z') || c == '_' || (i > dot && c >= '0' && c <= '9')) continue;
    return false;
  }
  return true;
}

inline std::string more_info_entity(const ParsedCfg &config) {
  std::string entity = cfg_option_value(config.options, "long_press_entity");
  if (entity.empty()) {
    entity = config.type == "sensor" || config.type == "presence" || config.type == "door_window"
      ? config.sensor : config.entity;
  }
  return more_info_entity_valid(entity) ? entity : "";
}

inline void more_info_hide_modal() {
  auto &ui = more_info_modal_ui();
  if (ui.overlay) ha_release_callbacks_for_owner(ui.overlay);
  control_modal_delete_overlay(ControlModalKind::MORE_INFO, ui.overlay);
  const uint32_t generation = ui.generation + 1;
  ui = MoreInfoModalUi{};
  ui.generation = generation;
}

inline void more_info_refresh_value() {
  auto &ui = more_info_modal_ui();
  if (!ui.value) return;
  std::string value = ui.state;
  if (!ui.unit.empty() && value != "--" && value != "unknown" && value != "unavailable") {
    value += " " + ui.unit;
  }
  lv_label_set_display_text(ui.value, value.c_str());
}

inline void more_info_open_modal(const ParsedCfg &config, lv_obj_t *button) {
  const lv_font_t *font = switch_confirmation_message_font(
    button ? lv_obj_get_style_text_font(button, LV_PART_MAIN) : nullptr);
  const lv_font_t *icon_font = switch_confirmation_icon_font(font);
  ControlModalShell shell = control_modal_open_shell(
    ControlModalKind::MORE_INFO, button, 100, icon_font, more_info_hide_modal);
  if (!shell.overlay || !shell.panel) return;
  auto &ui = more_info_modal_ui();
  ui.overlay = shell.overlay;
  const uint32_t generation = ++ui.generation;
  ui.state = "--";
  ui.unit.clear();
  const std::string entity = more_info_entity(config);

  lv_obj_t *body = lv_obj_create(shell.panel);
  const lv_coord_t top = shell.layout.inset + shell.layout.back_size + shell.layout.title_gap;
  lv_obj_set_pos(body, shell.layout.inset, top);
  lv_obj_set_size(body, shell.content_w, shell.layout.panel_h - top - shell.layout.inset);
  lv_obj_set_style_bg_opa(body, LV_OPA_TRANSP, LV_PART_MAIN);
  lv_obj_set_style_border_width(body, 0, LV_PART_MAIN);
  lv_obj_set_style_pad_all(body, 0, LV_PART_MAIN);
  lv_obj_set_style_pad_row(body, shell.layout.title_gap, LV_PART_MAIN);
  lv_obj_set_flex_flow(body, LV_FLEX_FLOW_COLUMN);
  lv_obj_set_scroll_dir(body, LV_DIR_VER);
  auto label = [&](const std::string &text, uint32_t color) {
    lv_obj_t *result = lv_label_create(body);
    lv_obj_set_width(result, lv_pct(100));
    lv_label_set_long_mode(result, LV_LABEL_LONG_WRAP);
    lv_obj_set_style_text_color(result, lv_color_hex(color), LV_PART_MAIN);
    if (font) lv_obj_set_style_text_font(result, font, LV_PART_MAIN);
    lv_label_set_display_text(result, text.c_str());
    return result;
  };
  ui.title = label(config.label.empty() ? entity : config.label, DARK_TEXT_PRIMARY);
  if (!entity.empty()) {
    label(entity, DARK_TEXT_MUTED);
    ui.value = label("--", DARK_TEXT_PRIMARY);
  }
  const std::string note = cfg_option_value(config.options, "long_press_text");
  if (!note.empty()) label(note, DARK_TEXT_PRIMARY);
  if (entity.empty()) return;

  HaCallbackOwnerScope owner(ui.overlay);
  ha_subscribe_state(entity, [generation](esphome::StringRef value) {
    auto &current = more_info_modal_ui();
    if (!current.overlay || current.generation != generation) return;
    current.state = value.size() == 0 ? "--" : string_ref_limited(value, 512);
    more_info_refresh_value();
  });
  ha_subscribe_attribute(entity, "unit_of_measurement", [generation](esphome::StringRef value) {
    auto &current = more_info_modal_ui();
    if (!current.overlay || current.generation != generation) return;
    current.unit = string_ref_limited(value, 32);
    more_info_refresh_value();
  });
  if (config.label.empty()) {
    ha_subscribe_attribute(entity, "friendly_name", [generation](esphome::StringRef value) {
      auto &current = more_info_modal_ui();
      if (!current.overlay || current.generation != generation || value.size() == 0) return;
      const std::string title = string_ref_limited(value, 160);
      lv_label_set_display_text(current.title, title.c_str());
    });
  }
  ha_schedule_metadata_refresh(entity, {"", "friendly_name", "unit_of_measurement"},
                               HA_SUBSCRIPTION_SCOPE_DEFAULT);
}
