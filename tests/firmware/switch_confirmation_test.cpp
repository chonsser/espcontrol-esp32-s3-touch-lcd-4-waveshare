#include <cassert>
#include <cstdint>
#include <deque>
#include <string>
#include <utility>
#include <vector>

#include "esphome/core/string_ref.h"
#include "i18n_generated.h"
#include "control_modal_service.h"

// Record the UI boundary without a display or a Home Assistant connection.
// The production confirmation header below owns positioning and click actions.
using lv_coord_t = int;
struct lv_font_t {};
struct lv_event_t {};
constexpr int LV_PART_MAIN = 0, LV_ALIGN_CENTER = 1, LV_EVENT_CLICKED = 2;
constexpr int LV_LABEL_LONG_WRAP = 3, LV_TEXT_ALIGN_CENTER = 4, LV_STATE_CHECKED = 1;
constexpr uint32_t DARK_TEXT_PRIMARY = 0xffffff, DARK_BORDER = 0x333333;
struct lv_obj_t {
  int x = 0, y = 0, width = 0, height = 24, state = 0;
  std::string text;
  std::vector<lv_obj_t *> children;
  void (*clicked)(lv_event_t *) = nullptr;
};
std::deque<lv_obj_t> objects;
lv_obj_t *lv_label_create(lv_obj_t *parent) {
  objects.emplace_back();
  auto *object = &objects.back();
  if (parent) parent->children.push_back(object);
  return object;
}
void lv_label_set_text(lv_obj_t *object, const char *text) { object->text = text; }
void lv_label_set_display_text(lv_obj_t *object, const char *text) { lv_label_set_text(object, text); }
void lv_label_set_long_mode(lv_obj_t *, int) {}
void lv_obj_set_width(lv_obj_t *object, int width) { object->width = width; }
void lv_obj_set_style_text_color(lv_obj_t *, uint32_t, int) {}
void lv_obj_set_style_text_align(lv_obj_t *, int, int) {}
void lv_obj_set_style_text_font(lv_obj_t *, const lv_font_t *, int) {}
const lv_font_t *lv_obj_get_style_text_font(lv_obj_t *, int) { return nullptr; }
uint32_t lv_color_hex(uint32_t color) { return color; }
void lv_obj_update_layout(lv_obj_t *) {}
int lv_obj_get_height(lv_obj_t *object) { return object->height; }
int lv_obj_get_width(lv_obj_t *object) { return object->width; }
lv_obj_t *lv_obj_get_child(lv_obj_t *object, int index) { return object->children.at(index); }
void lv_obj_align(lv_obj_t *object, int align, int x, int y) {
  assert(align == LV_ALIGN_CENTER);
  object->x = x;
  object->y = y;
}
void lv_obj_add_event_cb(lv_obj_t *object, void (*callback)(lv_event_t *), int event, void *) {
  assert(event == LV_EVENT_CLICKED);
  object->clicked = callback;
}
void lv_obj_move_foreground(lv_obj_t *) {}
void lv_obj_add_state(lv_obj_t *object, int state) { object->state |= state; }
void lv_obj_clear_state(lv_obj_t *object, int state) { object->state &= ~state; }

#include "button_grid_config_parser.h"

// Supply measured button sizes so asymmetric/custom labels exercise the actual
// placement calculation, rather than copying the production text-size recipe.
int no_width = 68, yes_width = 68;
struct ControlModalLayout {
  int short_side = 480, panel_h = 480, inset = 24, back_size = 48;
};
struct ControlModalShell {
  lv_obj_t *overlay, *panel, *close_btn;
  ControlModalLayout layout;
  int content_w = 424;
};
void (*dismiss_modal)() = nullptr;
ControlModalShell control_modal_open_shell(ControlModalKind kind, lv_obj_t *, int,
                                           const lv_font_t *, void (*close)()) {
  assert(kind == ControlModalKind::SWITCH_CONFIRMATION);
  dismiss_modal = close;
  auto *overlay = lv_label_create(nullptr);
  auto *panel = lv_label_create(overlay);
  return {overlay, panel, lv_label_create(panel), {}, 424};
}
void control_modal_delete_overlay(ControlModalKind kind, lv_obj_t *&overlay) {
  assert(kind == ControlModalKind::SWITCH_CONFIRMATION);
  overlay = nullptr;
  objects.clear();
}
int control_modal_scaled_px(int pixels, int) { return pixels; }
lv_obj_t *control_modal_create_text_button(lv_obj_t *parent, const std::string &text,
    int, int, int height, int, uint32_t color, const lv_font_t *) {
  auto *button = lv_label_create(parent);
  button->width = color == DARK_BORDER ? no_width : yes_width;
  button->height = height;
  lv_label_set_text(lv_label_create(button), text.c_str());
  return button;
}
uint32_t current_button_primary_color() { return 0x0088ff; }
uint32_t readable_text_color_for_bg(uint32_t) { return 0xffffff; }

using Action = std::pair<std::string, std::string>;
std::vector<Action> actions;
void send_turn_on_action(const std::string &entity) { actions.emplace_back("turn_on", entity); }
void send_turn_off_action(const std::string &entity) { actions.emplace_back("turn_off", entity); }
void send_action_card_action(const ParsedCfg &cfg) { actions.emplace_back(cfg.sensor, cfg.entity); }
// A switch confirmation must never route through the garage command path.
bool garage_command_mode(const std::string &) { assert(false); return false; }
void send_cover_command_action(const ParsedCfg &) { assert(false); }

#include "button_grid_confirm.h"

void click(lv_obj_t *button) {
  assert(button && button->clicked);
  auto callback = button->clicked;
  lv_event_t event;
  callback(&event);
}

void yes_is_left_and_no_is_right_without_changing_power_off_actions() {
  struct Case {
    const char *language, *options, *yes, *no;
    int yes_width, no_width, yes_x, no_x;
  };
  const Case cases[] = {
    {"en", "confirm_off", "Yes", "No", 68, 68, -40, 40},
    {"pl", "confirm_off", "Tak", "Nie", 68, 68, -40, 40},
    {"pl", "confirm_off,confirm_yes=Tak%20wylacz,confirm_no=Zostaw%20wlaczone",
     "Tak wylacz", "Zostaw wlaczone", 84, 124, -68, 48},
    {"en", "confirm_off,confirm_yes=Power%20off%20now,confirm_no=No",
     "Power off now", "No", 144, 68, -40, 78},
  };
  for (const auto &test : cases) {
    set_espcontrol_language(test.language);
    yes_width = test.yes_width;
    no_width = test.no_width;
    ParsedCfg config;
    config.entity = "switch.desk";
    config.options = test.options;
    lv_obj_t card;
    card.state = LV_STATE_CHECKED;
    assert(switch_confirmation_required(config, true));
    actions.clear();

    switch_confirmation_open_modal(config, &card, false);
    auto &ui = switch_confirmation_modal_ui();
    assert(actions.empty());
    assert(ui.confirm_btn->children[0]->text == test.yes);
    assert(ui.no_btn->children[0]->text == test.no);
    assert(ui.confirm_btn->x == test.yes_x && "Yes must be on the left");
    assert(ui.no_btn->x == test.no_x && "No must be on the right");
    assert(ui.confirm_btn->y == ui.no_btn->y);
    assert(ui.no_btn->x - no_width / 2 - (ui.confirm_btn->x + yes_width / 2) == 12);
    click(ui.no_btn);
    assert(actions.empty());
    assert(card.state == LV_STATE_CHECKED);
    assert(ui.overlay == nullptr);

    switch_confirmation_open_modal(config, &card, false);
    click(ui.confirm_btn);
    assert((actions == std::vector<Action>{{"turn_off", "switch.desk"}}));
    assert(card.state == 0);
    assert(ui.overlay == nullptr);

    actions.clear();
    card.state = LV_STATE_CHECKED;
    switch_confirmation_open_modal(config, &card, false);
    assert(dismiss_modal);
    dismiss_modal();
    assert(actions.empty());
    assert(card.state == LV_STATE_CHECKED);
    assert(ui.overlay == nullptr);
  }
}

void shared_confirmation_retains_turn_on_and_script_actions() {
  ParsedCfg config;
  config.entity = "switch.desk";
  config.options = "confirm_on";
  lv_obj_t card;
  actions.clear();
  switch_confirmation_open_modal(config, &card, true);
  click(switch_confirmation_modal_ui().confirm_btn);
  assert((actions == std::vector<Action>{{"turn_on", "switch.desk"}}));
  assert(card.state == LV_STATE_CHECKED);

  config.entity = "script.evening";
  config.type = "action";
  config.sensor = "script.turn_on";
  card.state = 0;
  actions.clear();
  switch_confirmation_open_modal(config, &card, false);
  click(switch_confirmation_modal_ui().confirm_btn);
  assert((actions == std::vector<Action>{{"script.turn_on", "script.evening"}}));
  assert(card.state == 0);
}

int main() {
  yes_is_left_and_no_is_right_without_changing_power_off_actions();
  shared_confirmation_retains_turn_on_and_script_actions();
}
