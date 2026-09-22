#pragma once

#include "lvgl.h"

constexpr uint32_t DARK_TEXT_DISABLED = 0x707070;

// Labels include the MDI icon glyphs and nested sensor values. Use a separate
// state style so their normal (including custom) colours survive reconnection.
inline void set_card_content_disabled(lv_obj_t *obj, bool disabled) {
  if (!obj) return;
  if (lv_obj_check_type(obj, &lv_label_class)) {
    const lv_style_selector_t selector =
      static_cast<lv_style_selector_t>(LV_PART_MAIN) | LV_STATE_DISABLED;
    const lv_color_t color = lv_color_hex(DARK_TEXT_DISABLED);
    lv_style_value_t current{};
    // Preserve the disabled-only override and the label's custom normal color.
    if (lv_obj_get_local_style_prop(obj, LV_STYLE_TEXT_COLOR, &current,
                                   selector) != LV_STYLE_RES_FOUND ||
        !lv_color_eq(current.color, color)) {
      lv_obj_set_style_text_color(obj, color, selector);
    }
    if (disabled) lv_obj_add_state(obj, LV_STATE_DISABLED);
    else lv_obj_clear_state(obj, LV_STATE_DISABLED);
  }
  for (uint32_t i = 0; i < lv_obj_get_child_cnt(obj); ++i) {
    set_card_content_disabled(lv_obj_get_child(obj, i), disabled);
  }
}

inline void set_card_disabled_state(lv_obj_t *btn, bool disabled) {
  if (!btn) return;
  // LVGL's default disabled recolour overlay also alters the card background.
  const lv_style_selector_t selector =
    static_cast<lv_style_selector_t>(LV_PART_MAIN) | LV_STATE_DISABLED;
  lv_style_value_t current{};
  if (lv_obj_get_local_style_prop(btn, LV_STYLE_RECOLOR_OPA, &current,
                                 selector) != LV_STYLE_RES_FOUND ||
      current.num != LV_OPA_TRANSP) {
    lv_obj_set_style_recolor_opa(btn, LV_OPA_TRANSP, selector);
  }
  if (lv_obj_get_local_style_prop(btn, LV_STYLE_OPA, &current,
                                 LV_PART_MAIN) != LV_STYLE_RES_FOUND ||
      current.num != LV_OPA_COVER) {
    lv_obj_set_style_opa(btn, LV_OPA_COVER, LV_PART_MAIN);
  }
  if (disabled) lv_obj_add_state(btn, LV_STATE_DISABLED);
  else lv_obj_clear_state(btn, LV_STATE_DISABLED);
  set_card_content_disabled(btn, disabled);
}
