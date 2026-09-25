"""Run production title selection against real Polish tables, without LVGL."""
from pathlib import Path
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[2]
HEADERS = ROOT / "components/espcontrol"


def section(filename, start, end):
    source = (HEADERS / filename).read_text()
    return source[source.index(start):source.index(end, source.index(start))]


source = r'''
#include <cassert>
#include <string>
#include "i18n_generated.h"
struct ParsedCfg { std::string entity, label, sensor; };
struct NavigationHomeTargetEntry { int slot; std::string label; };
struct NavigationSubpageEntry {
  int slot;
  std::string kind;
  bool standalone = false;
  std::string label{};
};
NavigationHomeTargetEntry parent{3, "Lighting"};
NavigationSubpageEntry subpage{3, "lights"};
int active_slot = 3;
int navigation_active_subpage_slot() { return active_slot; }
NavigationHomeTargetEntry *navigation_find_slot_target(int slot) {
  return slot == parent.slot ? &parent : nullptr;
}
NavigationSubpageEntry *navigation_find_slot(int slot) {
  return slot == subpage.slot ? &subpage : nullptr;
}
'''
source += section("button_grid_access_cards.h", "inline std::string i18n_label_or_default(",
                  "inline const char* garage_closed_icon(")
source += section("button_grid_config_parser.h", "inline const char *saved_config_subpage_default_label(",
                  "inline const char *saved_config_subpage_default_icon(")
source += section("button_grid_navigation.h", "inline std::string navigation_active_subpage_label()",
                  "inline void navigation_refresh_subpage_label()")
source += section("button_grid_alarm.h", "inline const char *alarm_action_label(",
                  "inline const char *alarm_action_icon(")
# Keep the real modal-context label assignment, excluding hardware subscriptions.
binding = section("button_grid_basic_action_driver.h",
                  "  card->label =", "  card->options =")
source += r'''
struct AlarmCardCtx { std::string label; };
std::string alarm_modal_title(const ParsedCfg &config) {
  AlarmCardCtx context;
  AlarmCardCtx *card = &context;
''' + binding + r'''
  return context.label;
}
int main() {
  set_espcontrol_language("pl");
  assert(navigation_active_subpage_label() == "Oświetlenie");
  assert(parent.label == "Lighting");  // Navigation targets remain stable.
  parent.label = "Lampy w salonie";
  assert(navigation_active_subpage_label() == "Lampy w salonie");
  parent.label = "Climate";  // Not the default for this kind: user text.
  assert(navigation_active_subpage_label() == "Climate");
  parent.label = "Lighting";
  subpage.kind = "custom";
  assert(navigation_active_subpage_label() == "Lighting");
  subpage.kind = "lights";
  active_slot = 0;
  assert(navigation_active_subpage_label().empty());
  active_slot = 3;
  set_espcontrol_language("en");
  assert(navigation_active_subpage_label() == "Lighting");
  subpage.standalone = true;
  subpage.label = "Niezależny ekran";
  parent.slot = 9;  // No matching home card is required.
  assert(navigation_active_subpage_label() == "Niezależny ekran");
  set_espcontrol_language("pl");
  assert(navigation_active_subpage_label() == "Niezależny ekran");
  parent.slot = 3;
  assert(navigation_active_subpage_label() == "Niezależny ekran");

  set_espcontrol_language("pl");
  ParsedCfg alarm{"alarm_control_panel.home", "Arm Home", "home"};
  assert(alarm_modal_title(alarm) == "Uzbrój w domu");
  assert(alarm.label == "Arm Home");
  alarm.label.clear();
  assert(alarm_modal_title(alarm) == "Uzbrój w domu");
  alarm.label = "Mój alarm";
  assert(alarm_modal_title(alarm) == "Mój alarm");
  set_espcontrol_language("en");
  alarm.label = "Arm Home";
  assert(alarm_modal_title(alarm) == "Arm Home");
}
'''
with tempfile.TemporaryDirectory(prefix="i18n-display-titles-") as directory:
    cpp = Path(directory) / "test.cpp"
    binary = Path(directory) / "test"
    cpp.write_text(source)
    subprocess.run([sys.argv[1] if len(sys.argv) > 1 else "c++", "-std=c++17",
                    "-Wall", "-Wextra", "-Werror", "-UNDEBUG", "-I", str(HEADERS),
                    str(cpp), "-o", str(binary)], check=True)
    subprocess.run([str(binary)], check=True)
print("Polish display-title regression passed.")
