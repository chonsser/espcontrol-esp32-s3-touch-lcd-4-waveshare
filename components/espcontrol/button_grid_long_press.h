#pragma once

// Main-grid YAML routes taps through SHORT_CLICKED; only reset on a new press.
inline bool *main_button_long_press_consumed() {
  static bool consumed[MAX_GRID_SLOTS + 1] = {};
  return consumed;
}

inline void reset_main_button_long_press(int slot) {
  if (slot > 0 && slot <= MAX_GRID_SLOTS) main_button_long_press_consumed()[slot] = false;
}

inline void dispatch_card_long_press(const ParsedCfg &config, lv_obj_t *button) {
  const std::string action = card_long_press_action(config);
  if (action == "more_info") more_info_open_modal(config, button);
  else if (action == "controls") card_open_default_controls(config, button);
}

inline void handle_button_long_press(const std::string &saved, int slot, lv_obj_t *button) {
  if (slot <= 0 || slot > MAX_GRID_SLOTS || main_button_long_press_consumed()[slot]) return;
  main_button_long_press_consumed()[slot] = true;
  dispatch_card_long_press(parse_cfg(saved), button);
}

inline void enable_card_long_press(lv_obj_t *button, const ParsedCfg &config) {
  if (!card_long_press_action(config).empty()) lv_obj_add_flag(button, LV_OBJ_FLAG_CLICKABLE);
}

struct SubpageLongPress {
  ParsedCfg config;
  bool consumed = false;
};

// Installed before the card's tap handler. LVGL also emits CLICKED when a long
// press is released, so consume that event while leaving subsequent taps alone.
inline void attach_subpage_long_press(lv_obj_t *button, const ParsedCfg &config) {
  if (card_long_press_action(config).empty()) return;
  enable_card_long_press(button, config);
  auto *gesture = new SubpageLongPress{config, false};
  lv_obj_add_event_cb(button, [](lv_event_t *event) {
    auto *state = static_cast<SubpageLongPress *>(lv_event_get_user_data(event));
    if (lv_event_get_target(event) != lv_event_get_current_target(event)) return;
    switch (lv_event_get_code(event)) {
      case LV_EVENT_PRESSED:
        state->consumed = false;
        break;
      case LV_EVENT_LONG_PRESSED:
        if (!state->consumed) {
          state->consumed = true;
          dispatch_card_long_press(state->config,
            static_cast<lv_obj_t *>(lv_event_get_target(event)));
        }
        break;
      case LV_EVENT_CLICKED:
        if (state->consumed) lv_event_stop_processing(event);
        break;
      case LV_EVENT_DELETE:
        delete state;
        break;
      default:
        break;
    }
  }, LV_EVENT_ALL, gesture);
}
