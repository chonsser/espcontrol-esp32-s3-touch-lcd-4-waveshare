"""Exercise standalone alarm parent isolation through production helpers."""
from pathlib import Path
import os
import re
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
HEADERS = ROOT / "components/espcontrol"


def function(source, name):
    match = re.search(r"^inline [^\n]*\b" + name + r"\(", source, re.M)
    assert match, f"missing production function: {name}"
    start = source.index("{", match.start())
    depth = 1
    end = start + 1
    while depth:
        depth += (source[end] == "{") - (source[end] == "}")
        end += 1
    return source[match.start():end] + "\n"


subpages = (HEADERS / "button_grid_subpages.h").read_text()
alarm_driver = (HEADERS / "button_grid_alarm_driver.h").read_text()
action_driver = (HEADERS / "button_grid_basic_action_driver.h").read_text()

source = r'''
#include <cassert>
#include <string>

struct ParsedCfg {
  std::string type;
  std::string entity;
  std::string options;
};
'''
source += function(subpages, "subpage_parent_config_for_screen")
source += r'''
namespace espcontrol::cards {
enum class Surface { MAIN_GRID, SUBPAGE };
struct Context { Surface surface = Surface::MAIN_GRID; };
struct AlarmDriverEnvironment { const ParsedCfg *parent_config = nullptr; };
struct BasicActionSubpageEnvironment { const ParsedCfg *parent_config = nullptr; };
'''
source += function(alarm_driver, "alarm_driver_effective_config")
source += function(action_driver, "basic_action_driver_effective_alarm_action_config")
source += r'''
}  // namespace espcontrol::cards

int main() {
  ParsedCfg conflicting_home;
  conflicting_home.type = "action";
  conflicting_home.entity = "alarm_control_panel.unrelated";
  conflicting_home.options = "arm_home,disarm";
  ParsedCfg unused_home;

  ParsedCfg alarm_child;
  alarm_child.type = "alarm";
  ParsedCfg alarm_action_child;
  alarm_action_child.type = "alarm_action";

  espcontrol::cards::Context subpage;
  subpage.surface = espcontrol::cards::Surface::SUBPAGE;

  espcontrol::cards::AlarmDriverEnvironment standalone_alarm;
  standalone_alarm.parent_config = subpage_parent_config_for_screen(
    conflicting_home, true);
  const ParsedCfg standalone_alarm_effective =
    espcontrol::cards::alarm_driver_effective_config(
      alarm_child, subpage, standalone_alarm);
  assert(standalone_alarm.parent_config == nullptr);
  assert(standalone_alarm_effective.entity.empty());
  assert(standalone_alarm_effective.options.empty());

  espcontrol::cards::BasicActionSubpageEnvironment standalone_action;
  standalone_action.parent_config = subpage_parent_config_for_screen(
    conflicting_home, true);
  const ParsedCfg standalone_action_effective =
    espcontrol::cards::basic_action_driver_effective_alarm_action_config(
      alarm_action_child, standalone_action);
  assert(standalone_action.parent_config == nullptr);
  assert(standalone_action_effective.entity.empty());
  assert(standalone_action_effective.options.empty());

  espcontrol::cards::AlarmDriverEnvironment unused_slot_alarm;
  unused_slot_alarm.parent_config = subpage_parent_config_for_screen(
    unused_home, true);
  const ParsedCfg unused_slot_alarm_effective =
    espcontrol::cards::alarm_driver_effective_config(
      alarm_child, subpage, unused_slot_alarm);
  assert(unused_slot_alarm.parent_config == nullptr);
  assert(unused_slot_alarm_effective.entity.empty());
  assert(unused_slot_alarm_effective.options.empty());

  espcontrol::cards::BasicActionSubpageEnvironment unused_slot_action;
  unused_slot_action.parent_config = subpage_parent_config_for_screen(
    unused_home, true);
  const ParsedCfg unused_slot_action_effective =
    espcontrol::cards::basic_action_driver_effective_alarm_action_config(
      alarm_action_child, unused_slot_action);
  assert(unused_slot_action.parent_config == nullptr);
  assert(unused_slot_action_effective.entity.empty());
  assert(unused_slot_action_effective.options.empty());

  espcontrol::cards::AlarmDriverEnvironment ordinary_alarm;
  ordinary_alarm.parent_config = subpage_parent_config_for_screen(
    conflicting_home, false);
  const ParsedCfg ordinary_alarm_effective =
    espcontrol::cards::alarm_driver_effective_config(
      alarm_child, subpage, ordinary_alarm);
  assert(ordinary_alarm.parent_config == &conflicting_home);
  assert(ordinary_alarm_effective.entity == "alarm_control_panel.unrelated");
  assert(ordinary_alarm_effective.options == "arm_home,disarm");

  espcontrol::cards::BasicActionSubpageEnvironment ordinary_action;
  ordinary_action.parent_config = subpage_parent_config_for_screen(
    conflicting_home, false);
  const ParsedCfg ordinary_action_effective =
    espcontrol::cards::basic_action_driver_effective_alarm_action_config(
      alarm_action_child, ordinary_action);
  assert(ordinary_action.parent_config == &conflicting_home);
  assert(ordinary_action_effective.entity == "alarm_control_panel.unrelated");
  assert(ordinary_action_effective.options == "arm_home,disarm");
}
'''

with tempfile.TemporaryDirectory(prefix="standalone-alarm-parent-") as directory:
    cpp = Path(directory) / "test.cpp"
    cpp.write_text(source)
    binary = Path(directory) / "test"
    subprocess.run([
        os.environ.get("CXX", "c++"), "-std=c++17", "-Wall", "-Wextra",
        "-Werror", str(cpp), "-o", str(binary)
    ], check=True)
    subprocess.run([str(binary)], check=True)

print("Standalone alarm parent isolation passed")
