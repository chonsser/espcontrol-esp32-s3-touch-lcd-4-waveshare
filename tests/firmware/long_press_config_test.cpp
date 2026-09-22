#include <cassert>
#include <string>
#include "esphome/core/string_ref.h"
struct lv_obj_t {};
inline void lv_label_set_text(lv_obj_t *, const char *) {}
inline const char *espcontrol_i18n(const char *text) { return text ? text : ""; }
inline std::string espcontrol_i18n(const std::string &text) { return text; }
#include "button_grid_config_parser.h"
#define ESPCONTROL_SUBPAGE_PARSER_ONLY
#include "button_grid_subpages.h"

int main() {
  for (const char *type : {"", "sensor", "action", "push", "media", "clock", "subpage", "light_control"}) {
    const std::string saved = std::string("light.kitchen;Kitchen;Auto;Auto;;;" ) + type +
      ";;long_press=more_info,long_press_entity=sensor.kitchen_power,long_press_text=Power%2C%20today%3B%20details";
    const auto config = parse_cfg(saved);
    assert(cfg_option_value(config.options, "long_press") == "more_info");
    assert(cfg_option_value(config.options, "long_press_entity") == "sensor.kitchen_power");
    assert(cfg_option_value(config.options, "long_press_text") == "Power, today; details");
  }
  for (const char *type : {"slider", "light_brightness", "light_temperature", "fan_speed"}) {
    ParsedCfg config;
    config.type = type;
    config.options = "long_press=more_info";
    assert(card_long_press_action(config).empty());
  }
  for (const char *mode : {"", "tilt"}) {
    ParsedCfg config;
    config.type = "cover";
    config.sensor = mode;
    assert(!card_supports_long_press(config));
  }
  auto legacy = parse_cfg("light.kitchen;Kitchen;Auto;Auto;;;;;");
  assert(card_long_press_action(legacy) == "controls");
  assert(cfg_option_value(legacy.options, "long_press").empty());
  ParsedCfg media;
  media.type = "media";
  media.sensor = "now_playing";
  media.precision = "progress";
  assert(!card_supports_long_press(media));
  media.sensor = "next";
  assert(card_supports_long_press(media));
  assert(card_long_press_action(media) == "controls");
  for (const std::string &saved : {
      std::string("1|light.kitchen:Kitchen:Auto:Auto:::::long_press=more_info,long_press_text=Power%2C today"),
      std::string("~1|,light.kitchen,Kitchen,Auto,Auto,,,,long_press=more_info%2Clong_press_text=Power%252C today")}) {
    const auto cards = parse_subpage_config(saved);
    assert(cards.size() == 1);
    const auto config = parsed_cfg_from_subpage_btn(cards[0]);
    assert(card_long_press_action(config) == "more_info");
    assert(cfg_option_value(config.options, "long_press_text") == "Power, today");
  }
  const auto disabled = parse_cfg("script.goodnight;Sleep;Auto;Auto;script.turn_on;;action;;long_press=none");
  assert(cfg_option_value(disabled.options, "long_press") == "none");
}
