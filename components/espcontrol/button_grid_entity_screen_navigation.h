#pragma once

#include "entity_screen_navigation.h"

// A distinct lifetime from grid cards and phase-3 display sensors. Rebuilding
// either must not remove this binding or replay a consumed screen selection.
constexpr uint32_t ENTITY_SCREEN_NAVIGATION_HA_SCOPE = 1u << 4;

inline espcontrol::EntityScreenNavigation &entity_screen_navigation() {
  static espcontrol::EntityScreenNavigation navigation;
  return navigation;
}

inline bool entity_screen_navigation_holds_screen() {
  return entity_screen_navigation().holds_screen(navigation_active_subpage_slot());
}

// A temporary page may replace the held screen (display off or network setup).
// The grid generation also invalidates a rebuilt screen whose pointer is reused.
// Remember only that exact takeover, never a general "last HA screen": otherwise
// a later wake/reconnect could undo the user's manual navigation away.
struct EntityScreenNavigationReturn {
  uint32_t generation = 0;
  uint32_t grid_generation = 0;
  int slot = 0;
  lv_obj_t *screen = nullptr;
  lv_obj_t *temporary_page = nullptr;
};

inline EntityScreenNavigationReturn &entity_screen_navigation_return() {
  static EntityScreenNavigationReturn saved;
  return saved;
}

inline bool entity_screen_navigation_has_return() {
  auto &saved = entity_screen_navigation_return();
  const auto &navigation = entity_screen_navigation();
  const auto *entry = navigation_find_slot(saved.slot);
  const bool valid = saved.temporary_page != nullptr &&
      lv_scr_act() == saved.temporary_page &&
      saved.generation == navigation.generation() &&
      saved.grid_generation == ha_subscription_generation() &&
      navigation.holds_screen(saved.slot) && entry != nullptr &&
      entry->screen == saved.screen;
  if (!valid) saved = {};
  return valid;
}

inline bool entity_screen_navigation_preserves_screen() {
  return entity_screen_navigation_holds_screen() || entity_screen_navigation_has_return();
}

// Call immediately before showing the temporary page. Chained takeovers retain
// the original slot only while the previous temporary page is still active.
inline void entity_screen_navigation_capture_return(lv_obj_t *temporary_page) {
  auto &saved = entity_screen_navigation_return();
  if (entity_screen_navigation_holds_screen()) {
    saved = {entity_screen_navigation().generation(), ha_subscription_generation(),
             navigation_active_subpage_slot(),
             lv_scr_act(), temporary_page};
  } else if (entity_screen_navigation_has_return()) {
    saved.temporary_page = temporary_page;
  }
}

inline bool entity_screen_navigation_restore_return() {
  if (!entity_screen_navigation_has_return()) return false;
  auto &saved = entity_screen_navigation_return();
  const int slot = saved.slot;
  saved = {};
  navigation_hide_modals();
  return navigation_restore_subpage_slot(slot);
}

inline void configure_entity_screen_navigation(const std::string &entity,
                                                const std::string &rules,
                                                bool wake) {
  auto &navigation = entity_screen_navigation();
  if (!navigation.configure(entity, rules, wake)) return;
  entity_screen_navigation_return() = {};
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
