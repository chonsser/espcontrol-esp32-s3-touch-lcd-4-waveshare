#include <cassert>
#include <string>
#include <vector>
#include "esphome/core/string_ref.h"
struct lv_event_t;
using Callback = void (*)(lv_event_t *);
struct lv_obj_t {
  struct Handler { Callback callback; void *data; };
  std::vector<Handler> handlers;
  bool clickable = false;
};
enum { LV_EVENT_ALL, LV_EVENT_PRESSED, LV_EVENT_LONG_PRESSED,
       LV_EVENT_LONG_PRESSED_REPEAT, LV_EVENT_RELEASED, LV_EVENT_CLICKED, LV_EVENT_DELETE };
constexpr int LV_OBJ_FLAG_CLICKABLE = 1;
struct lv_event_t { lv_obj_t *target; lv_obj_t *current; int code; void *data; bool stopped = false; };
inline void lv_label_set_text(lv_obj_t *, const char *) {}
inline void lv_obj_add_flag(lv_obj_t *button, int) { button->clickable = true; }
inline void lv_obj_add_event_cb(lv_obj_t *button, Callback callback, int, void *data) {
  button->handlers.push_back({callback, data});
}
inline void *lv_event_get_user_data(lv_event_t *event) { return event->data; }
inline lv_obj_t *lv_event_get_target(lv_event_t *event) { return event->target; }
inline lv_obj_t *lv_event_get_current_target(lv_event_t *event) { return event->current; }
inline int lv_event_get_code(lv_event_t *event) { return event->code; }
inline void lv_event_stop_processing(lv_event_t *event) { event->stopped = true; }
inline const char *espcontrol_i18n(const char *text) { return text ? text : ""; }
inline std::string espcontrol_i18n(const std::string &text) { return text; }
#include "button_grid_config_parser.h"
static int taps = 0, info_opens = 0;
static std::string info_entity;
inline void handle_button_click(const std::string &, int, lv_obj_t *) { ++taps; }
inline void more_info_open_modal(const ParsedCfg &config, lv_obj_t *) {
  ++info_opens;
  info_entity = cfg_option_value(config.options, "long_press_entity");
}
#include "button_grid_long_press.h"

static void dispatch(lv_obj_t &button, int code, lv_obj_t *target = nullptr) {
  for (const auto &handler : button.handlers) {
    lv_event_t event{target ? target : &button, &button, code, handler.data, false};
    handler.callback(&event);
    if (event.stopped) break;
  }
}
int main() {
  const std::string base = "light.kitchen;Kitchen;Auto;Auto;;;;;";
  lv_obj_t main;
  handle_button_long_press(base, 1, &main);
  assert(taps == 1 && info_opens == 0); // Older configs keep their action.
  handle_button_long_press(base + "long_press=none", 1, &main);
  assert(taps == 1 && info_opens == 0);
  handle_button_long_press(base + "long_press=more_info,long_press_entity=sensor.power", 1, &main);
  assert(taps == 1 && info_opens == 1 && info_entity == "sensor.power");
  for (const std::string action : {"more_info", "none"}) {
    taps = info_opens = 0;
    lv_obj_t button;
    attach_subpage_long_press(&button, parse_cfg(base + "long_press=" + action));
    assert(button.clickable);
    lv_obj_add_event_cb(&button, [](lv_event_t *event) {
      if (event->code == LV_EVENT_CLICKED) ++taps;
    }, LV_EVENT_ALL, nullptr);
    dispatch(button, LV_EVENT_PRESSED);
    dispatch(button, LV_EVENT_RELEASED);
    dispatch(button, LV_EVENT_CLICKED);
    assert(taps == 1 && info_opens == 0);
    dispatch(button, LV_EVENT_PRESSED);
    dispatch(button, LV_EVENT_LONG_PRESSED);
    dispatch(button, LV_EVENT_LONG_PRESSED_REPEAT);
    dispatch(button, LV_EVENT_LONG_PRESSED); // Duplicate callback cannot retrigger.
    dispatch(button, LV_EVENT_RELEASED);
    dispatch(button, LV_EVENT_CLICKED);
    assert(taps == 1 && info_opens == (action == "more_info" ? 1 : 0));
    dispatch(button, LV_EVENT_PRESSED);
    dispatch(button, LV_EVENT_RELEASED);
    dispatch(button, LV_EVENT_CLICKED);
    assert(taps == 2); // A consumed hold must not eat the next tap.
    lv_obj_t child;
    dispatch(button, LV_EVENT_LONG_PRESSED, &child);
    assert(info_opens == (action == "more_info" ? 1 : 0));
    dispatch(button, LV_EVENT_DELETE);
  }
}
