#include <cassert>
#include <string>
#include <vector>
#include "esphome/core/string_ref.h"
struct lv_event_t;
using Callback = void (*)(lv_event_t *);
struct lv_obj_t {
  struct Handler { Callback callback; void *data; int filter; };
  std::vector<Handler> handlers;
  bool clickable = false;
  void *data = nullptr;
};
enum { LV_EVENT_ALL, LV_EVENT_PRESSED, LV_EVENT_LONG_PRESSED,
       LV_EVENT_LONG_PRESSED_REPEAT, LV_EVENT_RELEASED, LV_EVENT_CLICKED, LV_EVENT_DELETE };
constexpr int LV_OBJ_FLAG_CLICKABLE = 1;
struct lv_event_t { lv_obj_t *target; lv_obj_t *current; int code; void *data; bool stopped = false; };
inline void lv_label_set_text(lv_obj_t *, const char *) {}
inline void lv_obj_add_flag(lv_obj_t *button, int) { button->clickable = true; }
inline void lv_obj_add_event_cb(lv_obj_t *button, Callback callback, int filter, void *data) {
  button->handlers.push_back({callback, data, filter});
}
inline void *lv_event_get_user_data(lv_event_t *event) { return event->data; }
inline lv_obj_t *lv_event_get_target(lv_event_t *event) { return event->target; }
inline lv_obj_t *lv_event_get_current_target(lv_event_t *event) { return event->current; }
inline int lv_event_get_code(lv_event_t *event) { return event->code; }
inline void lv_event_stop_processing(lv_event_t *event) { event->stopped = true; }
inline const char *espcontrol_i18n(const char *text) { return text ? text : ""; }
inline std::string espcontrol_i18n(const std::string &text) { return text; }
#include "button_grid_config_parser.h"
#include "button_grid_limits.h"
#include "button_grid_card_runtime.h"
struct lv_font_t {};
constexpr int LV_PART_MAIN = 0;
const lv_font_t *lv_obj_get_style_text_font(lv_obj_t *, int) { return nullptr; }
const lv_font_t *switch_confirmation_message_font(const lv_font_t *f) { return f; }
const lv_font_t *switch_confirmation_icon_font(const lv_font_t *f) { return f; }
uint32_t current_button_primary_color() { return 0x123456; }
void *lv_obj_get_user_data(lv_obj_t *button) { return button->data; }
struct LightControlCtx {
  bool modal_owned = false;
  std::string entity_id, label;
  lv_obj_t *btn = nullptr;
  uint32_t accent_color = 0;
  const lv_font_t *label_font = nullptr, *number_font = nullptr, *icon_font = nullptr;
};
struct FanCardCtx {}; struct ClimateControlCtx {}; struct CoverControlCtx {};
struct AlarmCardCtx {}; struct ImageCardCtx {}; struct MediaVolumeCtx {};
struct MediaControlCtx {}; struct OptionSelectCtx {};
static int taps = 0, info_opens = 0, control_opens = 0;
static std::string info_entity;
inline void handle_button_click(const std::string &, int, lv_obj_t *) { ++taps; }
inline void more_info_open_modal(const ParsedCfg &config, lv_obj_t *) {
  ++info_opens;
  info_entity = cfg_option_value(config.options, "long_press_entity");
}
struct { lv_obj_t *panel = nullptr; LightControlCtx *active = nullptr; } light_ui;
auto &light_control_modal_ui() { return light_ui; }
void light_control_hide_modal() {
  if (light_ui.active && light_ui.active->modal_owned) delete light_ui.active;
  light_ui = {};
}
void light_control_open_modal(LightControlCtx *light) {
  light_control_hide_modal();
  light_ui = {light->btn, light};
  ++control_opens;
}
struct HaCallbackOwnerScope { explicit HaCallbackOwnerScope(void *) {} };
void subscribe_light_control_state(LightControlCtx *) {}
void ha_schedule_metadata_refresh(const std::string &, std::initializer_list<const char *>, uint32_t) {}
#define MENU_STUB(name, type) void name(type *) { ++control_opens; }
MENU_STUB(fan_control_open_modal, FanCardCtx)
MENU_STUB(fan_preset_open, FanCardCtx)
MENU_STUB(climate_control_open_modal, ClimateControlCtx)
MENU_STUB(cover_control_open_modal, CoverControlCtx)
MENU_STUB(alarm_card_open_page, AlarmCardCtx)
MENU_STUB(image_card_open_modal, ImageCardCtx)
MENU_STUB(media_volume_open_modal, MediaVolumeCtx)
MENU_STUB(media_control_open_modal, MediaControlCtx)
MENU_STUB(option_select_open_modal, OptionSelectCtx)
bool alarm_card_context_valid(AlarmCardCtx *ctx) { return ctx != nullptr; }
MediaControlCtx *grid_media_control_runtime_for_owner(lv_obj_t *) { return nullptr; }
namespace espcontrol::cards {
bool wifi_qr_driver_handle_main_click(const Context &, const ParsedCfg &, lv_obj_t *) {
  ++control_opens; return true;
}
}
#include "button_grid_long_press_controls.h"
#include "button_grid_long_press.h"

static void dispatch(lv_obj_t &button, int code, lv_obj_t *target = nullptr) {
  for (const auto &handler : button.handlers) {
    if (handler.filter != LV_EVENT_ALL && handler.filter != code) continue;
    lv_event_t event{target ? target : &button, &button, code, handler.data, false};
    handler.callback(&event);
    if (event.stopped) break;
  }
}
int main() {
  const std::string base = "light.kitchen;Kitchen;Auto;Auto;;;;;";
  lv_obj_t main;
  int toggle_context = 123;
  main.data = &toggle_context;
  reset_main_button_long_press(1);
  handle_button_long_press(base, 1, &main);
  handle_button_long_press(base, 1, &main);
  assert(taps == 0 && info_opens == 0 && control_opens == 1);
  assert(main.data == &toggle_context && toggle_context == 123);
  assert(light_ui.active->modal_owned && light_ui.active->entity_id == "light.kitchen");
  reset_main_button_long_press(1);
  handle_button_click(base, 1, &main);
  assert(taps == 1);
  reset_main_button_long_press(1);
  handle_button_long_press(base + "long_press=none", 1, &main);
  assert(taps == 1 && info_opens == 0 && control_opens == 1);
  reset_main_button_long_press(1);
  handle_button_long_press(base + "long_press=more_info,long_press_entity=sensor.power", 1, &main);
  assert(taps == 1 && info_opens == 1 && info_entity == "sensor.power");
  light_control_hide_modal();
  for (const std::string action : {"", "more_info", "none"}) {
    taps = info_opens = control_opens = 0;
    lv_obj_t button;
    attach_subpage_long_press(&button, parse_cfg(base + (action.empty() ? "" : "long_press=" + action)));
    assert(button.clickable);
    lv_obj_add_event_cb(&button, [](lv_event_t *event) {
      if (event->code == LV_EVENT_CLICKED) ++taps;
    }, LV_EVENT_ALL, nullptr);
    dispatch(button, LV_EVENT_PRESSED);
    dispatch(button, LV_EVENT_RELEASED);
    dispatch(button, LV_EVENT_CLICKED);
    assert(taps == 1 && info_opens == 0 && control_opens == 0);
    dispatch(button, LV_EVENT_PRESSED);
    dispatch(button, LV_EVENT_LONG_PRESSED);
    dispatch(button, LV_EVENT_LONG_PRESSED_REPEAT);
    dispatch(button, LV_EVENT_LONG_PRESSED);
    dispatch(button, LV_EVENT_RELEASED);
    dispatch(button, LV_EVENT_CLICKED);
    assert(taps == 1 && info_opens == (action == "more_info" ? 1 : 0));
    assert(control_opens == (action.empty() ? 1 : 0));
    dispatch(button, LV_EVENT_PRESSED);
    dispatch(button, LV_EVENT_RELEASED);
    dispatch(button, LV_EVENT_CLICKED);
    assert(taps == 2);
    lv_obj_t child;
    dispatch(button, LV_EVENT_LONG_PRESSED, &child);
    assert(info_opens == (action == "more_info" ? 1 : 0));
    assert(control_opens == (action.empty() ? 1 : 0));
    light_control_hide_modal();
    dispatch(button, LV_EVENT_DELETE);
  }
  // Even with userdata, action/transport/navigation holds are read-only.
  for (const std::string type : {"action", "push", "subpage", "media", "fan_switch", "fan_oscillate"}) {
    ParsedCfg config;
    config.type = type; config.entity = "light.kitchen"; config.sensor = "next";
    const int previous_controls = control_opens, previous_info = info_opens;
    card_open_default_controls(config, &main);
    assert(control_opens == previous_controls && info_opens == previous_info + 1);
  }
  // Dedicated modal routes stay menu-only; transport/action types above never
  // enter these casts even when the tile contains unrelated userdata.
  for (const auto &entry : std::vector<std::pair<std::string, std::string>>{
      {"fan_control", ""}, {"fan_preset", ""}, {"climate", ""},
      {"cover", "modal"}, {"alarm", ""}, {"image", ""},
      {"wifi_qr", ""}, {"option_select", ""},
      {"media", "volume"}, {"media", "control_modal"},
      {"media", "speaker_group"}, {"media", "cover_art"}}) {
    ParsedCfg modal; modal.type = entry.first; modal.sensor = entry.second;
    const int previous = control_opens;
    card_open_default_controls(modal, &main);
    assert(control_opens == previous + 1);
  }
  // Existing light controls reuse their grid-owned context.
  LightControlCtx existing;
  main.data = &existing;
  ParsedCfg config; config.type = "light_control"; config.entity = "light.kitchen";
  const int previous_controls = control_opens;
  reset_main_button_long_press(1);
  handle_button_long_press("light.kitchen;Kitchen;Auto;Auto;;;light_control;;", 1, &main);
  handle_button_long_press("light.kitchen;Kitchen;Auto;Auto;;;light_control;;", 1, &main);
  assert(control_opens == previous_controls + 1 && light_ui.active == &existing);
  light_control_hide_modal();
  assert(!existing.modal_owned);
  for (const std::string type : {"slider", "light_brightness", "light_temperature", "fan_speed", "cover"}) {
    lv_obj_t slider;
    config.type = type;
    attach_subpage_long_press(&slider, config);
    assert(slider.handlers.empty());
  }
}
