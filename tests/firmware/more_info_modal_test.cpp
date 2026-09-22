#include <algorithm>
#include <cassert>
#include <cstdint>
#include <functional>
#include <string>
#include <vector>
#include "esphome/core/string_ref.h"

struct lv_obj_t { std::string text; };
struct lv_font_t {};
using lv_coord_t = int;
constexpr int LV_PART_MAIN = 0, LV_OPA_TRANSP = 0, LV_FLEX_FLOW_COLUMN = 0,
              LV_DIR_VER = 0, LV_LABEL_LONG_WRAP = 0;
constexpr uint32_t DARK_TEXT_PRIMARY = 0xFFFFFF, DARK_TEXT_MUTED = 0xB0B0B0;
std::vector<lv_obj_t *> widgets;
lv_obj_t *lv_obj_create(lv_obj_t *) { auto *object = new lv_obj_t; widgets.push_back(object); return object; }
lv_obj_t *lv_label_create(lv_obj_t *parent) { return lv_obj_create(parent); }
void lv_label_set_text(lv_obj_t *object, const char *text) { object->text = text; }
void lv_label_set_display_text(lv_obj_t *object, const char *text) { object->text = text; }
void lv_obj_set_pos(lv_obj_t *, int, int) {}
void lv_obj_set_size(lv_obj_t *, int, int) {}
void lv_obj_set_width(lv_obj_t *, int) {}
void lv_obj_set_style_bg_opa(lv_obj_t *, int, int) {}
void lv_obj_set_style_border_width(lv_obj_t *, int, int) {}
void lv_obj_set_style_pad_all(lv_obj_t *, int, int) {}
void lv_obj_set_style_pad_row(lv_obj_t *, int, int) {}
void lv_obj_set_flex_flow(lv_obj_t *, int) {}
void lv_obj_set_scroll_dir(lv_obj_t *, int) {}
void lv_label_set_long_mode(lv_obj_t *, int) {}
void lv_obj_set_style_text_color(lv_obj_t *, uint32_t, int) {}
void lv_obj_set_style_text_font(lv_obj_t *, const lv_font_t *, int) {}
const lv_font_t *lv_obj_get_style_text_font(lv_obj_t *, int) { return nullptr; }
int lv_pct(int value) { return value; }
uint32_t lv_color_hex(uint32_t value) { return value; }
const lv_font_t *switch_confirmation_message_font(const lv_font_t *font) { return font; }
const lv_font_t *switch_confirmation_icon_font(const lv_font_t *font) { return font; }
inline const char *espcontrol_i18n(const char *text) { return text ? text : ""; }
inline std::string espcontrol_i18n(const std::string &text) { return text; }
#include "button_grid_config_parser.h"
#include "control_modal_service.h"
struct ControlModalShell {
  lv_obj_t *overlay;
  lv_obj_t *panel;
  struct { int inset = 16, back_size = 40, title_gap = 16, panel_h = 480; } layout;
  int content_w = 400;
};
ControlModalCloseCallback close_modal = nullptr;
ControlModalShell control_modal_open_shell(ControlModalKind, lv_obj_t *, int,
    const lv_font_t *, ControlModalCloseCallback close) {
  if (close_modal) close_modal();
  close_modal = close;
  return {lv_obj_create(nullptr), lv_obj_create(nullptr), {}, 400};
}
void control_modal_delete_overlay(ControlModalKind, lv_obj_t *&overlay) {
  for (auto *widget : widgets) delete widget;
  widgets.clear();
  overlay = nullptr;
  close_modal = nullptr;
}
using StateCallback = std::function<void(esphome::StringRef)>;
struct Subscription { std::string entity, attribute; StateCallback callback; void *owner; };
std::vector<Subscription> subscriptions;
void *callback_owner = nullptr;
struct HaCallbackOwnerScope {
  void *previous;
  explicit HaCallbackOwnerScope(void *owner) : previous(callback_owner) { callback_owner = owner; }
  ~HaCallbackOwnerScope() { callback_owner = previous; }
};
bool ha_subscribe_attribute(const std::string &entity, const std::string &attribute, StateCallback callback) {
  subscriptions.push_back({entity, attribute, callback, callback_owner});
  return true;
}
bool ha_subscribe_state(const std::string &entity, StateCallback callback) {
  return ha_subscribe_attribute(entity, "", callback);
}
void ha_release_callbacks_for_owner(void *owner) {
  subscriptions.erase(std::remove_if(subscriptions.begin(), subscriptions.end(),
    [owner](const Subscription &item) { return item.owner == owner; }), subscriptions.end());
}
void ha_schedule_metadata_refresh(const std::string &, std::initializer_list<const char *>, uint32_t) {}
#include "button_grid_more_info.h"

void deliver(const std::string &entity, const std::string &attribute, const char *value) {
  bool delivered = false;
  for (const auto &subscription : subscriptions) {
    if (subscription.entity == entity && subscription.attribute == attribute) {
      subscription.callback(esphome::StringRef(value));
      delivered = true;
    }
  }
  assert(delivered);
}
int main() {
  ParsedCfg config = parse_cfg("light.kitchen;Kitchen;Auto;Auto;;;;;long_press=more_info,long_press_entity=sensor.power,long_press_text=Power%2C today");
  more_info_open_modal(config, nullptr);
  auto &ui = more_info_modal_ui();
  assert(ui.overlay && ui.title->text == "Kitchen" && ui.value->text == "--");
  assert(std::any_of(widgets.begin(), widgets.end(), [](const lv_obj_t *widget) { return widget->text == "Power, today"; }));
  deliver("sensor.power", "unit_of_measurement", "W");
  deliver("sensor.power", "", "123.4");
  assert(ui.value->text == "123.4 W");
  deliver("sensor.power", "", "unavailable");
  assert(ui.value->text == "unavailable");
  const auto delayed = subscriptions.front().callback;
  more_info_hide_modal();
  assert(!ui.overlay && subscriptions.empty());
  config = parse_cfg(";Room;Auto;Auto;sensor.temperature;;sensor;;long_press=more_info");
  config.label.clear();
  more_info_open_modal(config, nullptr);
  deliver("sensor.temperature", "friendly_name", "Room temperature");
  deliver("sensor.temperature", "", "21");
  assert(ui.title->text == "Room temperature" && ui.value->text == "21");
  delayed(esphome::StringRef("999"));
  assert(ui.value->text == "21");
  more_info_hide_modal();
  delayed(esphome::StringRef("888")); // No widget survives a close.
  assert(!ui.overlay && subscriptions.empty());
  config.entity = "https://example.com";
  config.type = "webhook";
  config.sensor.clear();
  assert(more_info_entity(config).empty());
}
