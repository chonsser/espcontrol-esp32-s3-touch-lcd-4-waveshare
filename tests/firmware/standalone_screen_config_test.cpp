#include <cassert>
#include <string>
#include "standalone_screen_config.h"
#include "esphome/core/string_ref.h"
struct lv_obj_t {};
inline void lv_label_set_text(lv_obj_t *, const char *) {}
inline const char *espcontrol_i18n(const char *text) { return text ? text : ""; }
inline std::string espcontrol_i18n(const std::string &text) { return text; }
#include "button_grid_config_parser.h"
#define ESPCONTROL_SUBPAGE_PARSER_ONLY
#include "button_grid_subpages.h"

int main() {
  using espcontrol::parse_standalone_screen_config;
  auto ordinary = parse_standalone_screen_config("~B,1|,light.kitchen,Kitchen");
  assert(ordinary.valid && !ordinary.standalone && ordinary.payload_offset == 0);
  const std::string raw = "@screen:Salon%20%7C%20%C5%82azienka\n~1,2|,light.one,One|,light.two,Two";
  auto named = parse_standalone_screen_config(raw);
  assert(named.valid && named.standalone);
  assert(named.label == "Salon | łazienka");
  assert(raw.substr(named.payload_offset) == "~1,2|,light.one,One|,light.two,Two");
  auto cards = parse_subpage_config(raw);
  assert(cards.size() == 2 && cards[0].entity == "light.one" && cards[1].label == "Two");
  assert(parse_subpage_config("@screen:Bad%00\n1|light.a:A").empty());
  assert(parse_subpage_config("1|light.a:A")[0].entity == "light.a");
  auto empty = parse_standalone_screen_config("@screen:Empty\n");
  assert(empty.valid && empty.standalone && empty.payload_offset == 14);
  auto max = parse_standalone_screen_config("@screen:" + std::string(64, 'a') + "\n");
  assert(max.valid);
  assert(!parse_standalone_screen_config("@screen:" + std::string(65, 'a') + "\n").valid);
  for (const auto &raw_bad : {
      std::string("@screen:Missing separator"), std::string("@screen:\n"),
      std::string("@screen:%20%09\n"), std::string("@screen:Bad%\n"),
      std::string("@screen:Bad%Q0\n"), std::string("@screen:Bad%00\n"),
      std::string("@screen:Bad%0Aname\n"), std::string("@screen:Bad%7F\n"),
      std::string("@screen:%FF\n"), std::string("@screen:%C0%AF\n"),
      std::string("@screen:%C2%85\n"), std::string("@screen:%ED%A0%80\n")}) {
    const auto bad = parse_standalone_screen_config(raw_bad);
    assert(bad.standalone && !bad.valid);
  }
  auto unicode = parse_standalone_screen_config("@screen:Łazienka\n1|light.a:A");
  assert(unicode.valid && unicode.label == "Łazienka");
}
