#include <cassert>
#include <functional>
#include <string>
#include "esphome/core/string_ref.h"
#include "screen_navigation_options.h"
namespace esphome { static uint32_t now = 0; inline uint32_t millis() { return now; } }
static bool connected = true;
static bool heap_available = true;
static int releases = 0, announces = 0, subscriptions = 0, requests = 0;
static std::function<void(esphome::StringRef)> callback;
inline bool ha_api_state_connected() { return connected; }
inline bool ha_internal_heap_available(const char *) { return heap_available; }
inline void ha_release_callbacks_for_owner(void *) { ++releases; callback = {}; }
inline void ha_reannounce_state_subscriptions() { ++announces; }
struct Coordinator {
  bool subscribe(const std::string &, const std::string &attribute,
                 std::function<void(esphome::StringRef)> cb, uint32_t scope, void *owner,
                 bool retain, bool replay) {
    assert(attribute == "options" && scope == (1u << 5) && owner && !retain && !replay);
    ++subscriptions;
    callback = std::move(cb);
    callback(esphome::StringRef("['Cached stale']"));
    return true;
  }
  bool request_fresh(const std::string &, const std::string &) { ++requests; return true; }
};
inline Coordinator &ha_read_coordinator() { static Coordinator c; return c; }
#include "button_grid_screen_navigation_options.h"
int main() {
  auto &service = espcontrol::screen_navigation_options();
  service.request("input_select.screen", 0);
  pump_screen_navigation_options();
  assert(callback && subscriptions == 1 && requests == 1 && announces == 1 && releases == 1);
  assert(service.request("input_select.screen", 1).status == espcontrol::ScreenOptionsStatus::LOADING);
  callback(esphome::StringRef("['Home','Music']"));
  assert(service.request("input_select.screen", 2).options[0] == "Home");
  const auto retired = callback;
  esphome::now = 3;
  connected = false;
  pump_screen_navigation_options();
  connected = true;
  esphome::now = 4;
  pump_screen_navigation_options();
  assert(subscriptions == 2 && requests == 2 && releases == 2);
  retired(esphome::StringRef("['Stale reply']"));
  assert(service.request("input_select.screen", 5).status == espcontrol::ScreenOptionsStatus::LOADING);
  callback(esphome::StringRef("['Fresh']"));
  assert(service.request("input_select.screen", 6).options[0] == "Fresh");
  esphome::now = 6000;
  service.request("input_select.screen", 6000);
  pump_screen_navigation_options();
  const std::string oversized(8193, 'x');
  callback(esphome::StringRef(oversized));
  assert(service.request("input_select.screen", 6001).status == espcontrol::ScreenOptionsStatus::ERROR);
  esphome::now = 8000;
  service.request("input_select.screen", 8000);
  heap_available = false;
  pump_screen_navigation_options();
  assert(service.request("input_select.screen", 8001).status == espcontrol::ScreenOptionsStatus::UNAVAILABLE);
  return 0;
}
