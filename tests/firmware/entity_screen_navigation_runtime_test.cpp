#include <cassert>
#include <cstdint>
#include <functional>
#include <string>
#include <vector>
#include "esphome/core/string_ref.h"
#include "entity_screen_navigation.h"

struct lv_obj_t { int id; };
struct NavigationSubpageEntry { lv_obj_t *screen; };
static lv_obj_t home{0}, subpage{3};
static NavigationSubpageEntry entry{&subpage};
static bool has_subpage = true;
static int shown_page = -1, modal_closes = 0, announce_count = 0;
static uint32_t last_scope = 0;
static std::string bound_entity;
static std::function<void(esphome::StringRef)> callback;
inline void ha_reset_subscription_callbacks(uint32_t scope) { last_scope = scope; callback = {}; }
inline void ha_reannounce_state_subscriptions() { ++announce_count; }
inline void ha_subscribe_state(const std::string &entity, std::function<void(esphome::StringRef)> cb, uint32_t scope) {
  bound_entity = entity; callback = cb; last_scope = scope;
}
inline std::string string_ref_limited(esphome::StringRef value, size_t limit) {
  return std::string(value.c_str(), value.size() < limit ? value.size() : limit);
}
inline NavigationSubpageEntry *navigation_find_slot(int slot) { return has_subpage && slot == 3 ? &entry : nullptr; }
inline bool navigation_restore_subpage_slot(int slot) { shown_page = slot; return navigation_find_slot(slot) != nullptr; }
inline bool navigation_return_home(lv_obj_t *page) { shown_page = page->id; ++modal_closes; return true; }
inline void navigation_hide_modals() { ++modal_closes; }
inline uint32_t ha_subscription_generation() { return 1; }
inline lv_obj_t *lv_scr_act() { return shown_page == 3 ? &subpage : &home; }
inline int navigation_active_subpage_slot() { return shown_page > 0 ? shown_page : 0; }
#include "button_grid_entity_screen_navigation.h"

int main() {
  configure_entity_screen_navigation("input_select.screen", "0\tHome\n3\tKitchen\n5\tNormal card", true);
  assert(callback);
  assert(bound_entity == "input_select.screen");
  assert(last_scope == (1u << 4)); // This binding must outlive default/phase3 grid subscription resets.
  assert(announce_count == 1);
  callback(esphome::StringRef("Kitchen"));
  assert(shown_page == -1); // HA callback only queues; it cannot mutate LVGL during dispatch.
  espcontrol::ScreenNavigationConditions conditions;
  conditions.ready = true;
  conditions.active = true;
  conditions.locked = true;
  assert(step_entity_screen_navigation(conditions, &home) == espcontrol::ScreenNavigationAction::WAIT);
  assert(shown_page == -1);
  conditions.locked = false;
  assert(step_entity_screen_navigation(conditions, &home) == espcontrol::ScreenNavigationAction::NAVIGATE);
  assert(shown_page == 3 && modal_closes == 1);
  callback(esphome::StringRef("Home"));
  step_entity_screen_navigation(conditions, &home);
  assert(shown_page == 0);
  callback(esphome::StringRef("Normal card"));
  assert(step_entity_screen_navigation(conditions, &home) == espcontrol::ScreenNavigationAction::WAIT);
  assert(shown_page == 0); // Mapping a switch slot never activates its normal action.
  callback(esphome::StringRef("Kitchen"));
  has_subpage = false;
  step_entity_screen_navigation(conditions, &home);
  assert(shown_page == 0);
  has_subpage = true;
  step_entity_screen_navigation(conditions, &home);
  assert(shown_page == 0); // Reusing a removed slot cannot replay the discarded selection.
  const auto retired_callback = callback;
  configure_entity_screen_navigation("sensor.other", "3\tHome", false);
  retired_callback(esphome::StringRef("Home"));
  step_entity_screen_navigation(conditions, &home);
  assert(shown_page == 0);
  callback(esphome::StringRef("Home"));
  conditions.active = false;
  assert(step_entity_screen_navigation(conditions, &home) == espcontrol::ScreenNavigationAction::WAIT);
  assert(shown_page == 0);
  conditions.active = true;
  step_entity_screen_navigation(conditions, &home);
  assert(shown_page == 3);
  configure_entity_screen_navigation("", "3\tHome", false);
  assert(!callback);
  return 0;
}
