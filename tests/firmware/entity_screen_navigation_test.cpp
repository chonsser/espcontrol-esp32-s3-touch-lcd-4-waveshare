#include <cassert>
#include <string>
#include "entity_screen_navigation.h"

using espcontrol::EntityScreenNavigation;
using espcontrol::ScreenNavigationAction;
using espcontrol::ScreenNavigationConditions;

int main() {
  EntityScreenNavigation navigation;
  assert(navigation.configure("input_select.aktualny_ekran", "0\tDom\n3\tKuchnia\n7\tŁazienka", true));
  assert(navigation.enabled());
  const auto first_generation = navigation.generation();
  navigation.receive(first_generation, "Kuchnia");
  assert(navigation.pending_target() == 3);
  navigation.complete_navigation();
  navigation.receive(first_generation, "Kuchnia");
  assert(!navigation.pending_target()); // Replayed identical states must not hijack manual navigation.
  navigation.receive(first_generation, "Łazienka");
  assert(navigation.pending_target() == 7);
  navigation.receive(first_generation, "unavailable");
  assert(!navigation.pending_target()); // An offline source cancels an older queued selection.
  navigation.receive(first_generation, "Łazienka");
  assert(navigation.pending_target() == 7);
  navigation.receive(first_generation, "łazienka");
  assert(!navigation.pending_target()); // State matching is exact.
  navigation.receive(first_generation, "Dom");
  assert(navigation.pending_target() == 0);
  assert(!navigation.configure("input_select.aktualny_ekran", "0\tDom\n3\tKuchnia\n7\tŁazienka", true));
  assert(navigation.pending_target() == 0);

  // A settings change retires callbacks for the old binding.
  assert(navigation.configure("sensor.next_screen", "2\tDom", true));
  navigation.receive(first_generation, "Dom");
  assert(!navigation.pending_target());
  navigation.receive(navigation.generation(), "Dom");
  assert(navigation.pending_target() == 2);

  ScreenNavigationConditions conditions;
  conditions.ready = true;
  conditions.active = false;
  assert(navigation.next_action(conditions, true) == ScreenNavigationAction::WAKE);
  conditions.waking = true;
  assert(navigation.next_action(conditions, true) == ScreenNavigationAction::WAIT);
  conditions.waking = false;
  conditions.active = true;
  conditions.locked = true;
  assert(navigation.next_action(conditions, true) == ScreenNavigationAction::WAIT);
  conditions.locked = false;
  conditions.protected_display = true;
  assert(navigation.next_action(conditions, true) == ScreenNavigationAction::WAIT);
  conditions.protected_display = false;
  conditions.ready = false;
  assert(navigation.next_action(conditions, false) == ScreenNavigationAction::WAIT);
  assert(navigation.pending_target() == 2); // Wait for grid creation before validating its targets.
  conditions.ready = true;
  assert(navigation.next_action(conditions, true) == ScreenNavigationAction::NAVIGATE);
  assert(navigation.next_action(conditions, false) == ScreenNavigationAction::WAIT);
  assert(!navigation.pending_target()); // Removed targets can never activate another card.

  navigation.configure("sensor.screen", "4\ta%09b%0Ac%0D%25\n0\t Space ", false);
  navigation.receive(navigation.generation(), "a\tb\nc\r%");
  assert(navigation.pending_target() == 4);
  conditions.active = false;
  assert(navigation.next_action(conditions, true) == ScreenNavigationAction::WAIT);
  conditions.active = true;
  assert(navigation.next_action(conditions, true) == ScreenNavigationAction::NAVIGATE);
  navigation.receive(navigation.generation(), " Space ");
  assert(navigation.pending_target() == 0);
  navigation.configure("", "0\tDom", true);
  assert(!navigation.enabled());
  assert(!navigation.pending_target());

  // Treat malformed or ambiguous mappings as disabled, never partially apply them.
  for (const std::string rules : {"1\tDom\n2\tDom", "33\tDom", "-1\tDom", "x\tDom", "1\t", "1\t \t", "1\tunknown", "1\tunavailable", "1\tbad%20escape", "1\ttrailing%", "1\tDom\n", "1\tDom\r", "1\tDom\tX"}) {
    navigation.configure("sensor.screen", rules, true);
    assert(!navigation.enabled());
  }
  navigation.configure("sensor.screen", "1\t" + std::string(253, 'x'), true);
  assert(navigation.enabled());
  navigation.configure("sensor.screen", "1\t" + std::string(254, 'x'), true);
  assert(!navigation.enabled());
  for (const std::string entity : {"sensor", "sensor.bad/name", "sensor.a.b", "bad2.screen", " sensor.screen", "sensor.screen "}) {
    navigation.configure(entity, "1\tDom", true);
    assert(!navigation.enabled());
  }
  navigation.configure("sensor." + std::string(94, 'a'), "1\tDom", true);
  assert(!navigation.enabled()); // Entity IDs longer than the stored setting are rejected.
  return 0;
}
