#pragma once

#include "entity_screen_navigation.h"

// A distinct lifetime from grid cards and phase-3 display sensors. Rebuilding
// either must not remove this binding or replay a consumed screen selection.
constexpr uint32_t ENTITY_SCREEN_NAVIGATION_HA_SCOPE = 1u << 4;

inline espcontrol::EntityScreenNavigation &entity_screen_navigation() {
  static espcontrol::EntityScreenNavigation navigation;
  return navigation;
}

inline void configure_entity_screen_navigation(const std::string &entity,
                                                const std::string &rules,
                                                bool wake) {
  auto &navigation = entity_screen_navigation();
  if (!navigation.configure(entity, rules, wake)) return;
  ha_reset_subscription_callbacks(ENTITY_SCREEN_NAVIGATION_HA_SCOPE);
  if (!navigation.enabled()) return;
  const uint32_t generation = navigation.generation();
  ha_subscribe_state(navigation.entity(), [generation](esphome::StringRef state) {
    entity_screen_navigation().receive(generation, string_ref_limited(state, 256));
  }, ENTITY_SCREEN_NAVIGATION_HA_SCOPE);
  ha_reannounce_state_subscriptions();
}

// Run from the regular ESPHome loop, after subscription dispatch has finished.
// Only registered screens are eligible: never pass these slots to the general
// navigate action, which can activate a home card and operate HA devices.
inline espcontrol::ScreenNavigationAction step_entity_screen_navigation(
    const espcontrol::ScreenNavigationConditions &conditions, lv_obj_t *main_page) {
  auto &navigation = entity_screen_navigation();
  const auto target = navigation.pending_target();
  if (!target) return espcontrol::ScreenNavigationAction::WAIT;
  const NavigationSubpageEntry *subpage = *target > 0 ? navigation_find_slot(*target) : nullptr;
  const bool available = *target == 0 ? main_page != nullptr : subpage != nullptr && subpage->screen != nullptr;
  const auto action = navigation.next_action(conditions, available);
  if (action != espcontrol::ScreenNavigationAction::NAVIGATE) return action;
  if (*target == 0) {
    navigation_return_home(main_page);
  } else {
    navigation_hide_modals();
    navigation_restore_subpage_slot(*target);
  }
  navigation.complete_navigation();
  return action;
}
