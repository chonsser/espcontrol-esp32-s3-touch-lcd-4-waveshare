"""Execute production screen ordering/registration functions with narrow LVGL doubles."""
from pathlib import Path
import os
import re
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
HEADERS = ROOT / "components/espcontrol"

def function(source, name):
    match = re.search(r"^inline [^\n]*\b" + name + r"\(", source, re.M)
    assert match, name
    start = source.index("{", match.start())
    depth = 1
    end = start + 1
    while depth:
        depth += (source[end] == "{") - (source[end] == "}")
        end += 1
    return source[match.start():end] + "\n"

layout = (HEADERS / "button_grid_layout.h").read_text()
subpages = (HEADERS / "button_grid_subpages.h").read_text()
navigation = (HEADERS / "button_grid_navigation.h").read_text()
config = (HEADERS / "button_grid_config.h").read_text()
source = '''
#include <cassert>
#include <cctype>
#include <string>
#include <vector>
#include "button_grid_limits.h"
'''
source += "\n".join(re.findall(r"^constexpr [^;]+;", layout, re.M)) + "\n"
source += function(config, "bounded_grid_slots")
for name in ("grid_token_spans", "grid_token_has_span_suffix", "parse_positive_int_span", "normalize_grid_span_for_position"):
    source += function(layout, name)
source += re.search(r"struct SubpageOrder \{.*?\n\};", subpages, re.S).group() + "\n"
for name in ("subpage_grid_position", "subpage_back_token_span", "parse_subpage_order", "normalize_subpage_order_spans"):
    source += function(subpages, name)
source += '''
struct lv_obj_t { void *user_data = nullptr; };
struct Entry { int slot; bool standalone = false; std::string label; lv_obj_t *screen; };
std::vector<Entry> entries;
auto &navigation_subpages() { return entries; }
void navigation_register_subpage(int slot, int, const std::string &, lv_obj_t *screen) {
  entries.push_back({slot, false, "", screen});
}
'''
source += function(navigation, "navigation_register_standalone_screen")
source += r'''
int main() {
  for (int slots : {9, 16, 25}) {
    const int cols = slots == 9 ? 3 : slots == 16 ? 4 : 5;
    std::string order;
    for (int i = 1; i <= slots; ++i) { if (i > 1) order += ','; order += std::to_string(i); }
    SubpageOrder independent;
    parse_subpage_order(order, slots, slots, independent, true);
    normalize_subpage_order_spans(independent, slots, cols);
    assert(independent.standalone && !independent.has_back_token);
    for (int i = 0; i < slots; ++i) {
      assert(independent.positions[i] == i + 1);
      assert(subpage_grid_position(independent, i) == i);
    }
  }
  SubpageOrder regular;
  parse_subpage_order("1,2", 9, 2, regular);
  normalize_subpage_order_spans(regular, 9, 3);
  assert(!regular.standalone && subpage_grid_position(regular, 0) == 1);
  SubpageOrder explicit_back;
  parse_subpage_order("1,B,2", 9, 2, explicit_back);
  assert(explicit_back.has_back_token && explicit_back.back_pos == 1);
  assert(subpage_grid_position(explicit_back, 0) == 0);
  SubpageOrder last_wide;
  parse_subpage_order("1,2,3,4,5,6,7,8,9b", 9, 9, last_wide, true);
  normalize_subpage_order_spans(last_wide, 9, 3);
  assert(last_wide.positions[8] == 9 && last_wide.row_span[8] == 1 && last_wide.col_span[8] == 1);
  SubpageOrder empty;
  parse_subpage_order("", 9, 0, empty, true);
  assert(empty.standalone && !empty.has_back_token);
  for (int i = 0; i < 9; ++i) assert(empty.positions[i] == 0);
  SubpageOrder stale_back;
  parse_subpage_order("B,1", 9, 1, stale_back, true);
  assert(!stale_back.has_back_token && stale_back.positions[0] == 0 && stale_back.positions[1] == 1);
  int ordinary_action = 42;
  lv_obj_t home{&ordinary_action}, screen;
  navigation_register_standalone_screen(1, 0, "Salon", &screen);
  assert(entries.size() == 1 && entries[0].slot == 1 && entries[0].standalone);
  assert(entries[0].label == "Salon" && entries[0].screen == &screen);
  assert(home.user_data == &ordinary_action);
  navigation_register_standalone_screen(0, 0, "Invalid", &screen);
  navigation_register_standalone_screen(2, 1, "Missing", nullptr);
  assert(entries.size() == 1);
}
'''
with tempfile.TemporaryDirectory(prefix="standalone-screen-runtime-") as directory:
    cpp = Path(directory) / "test.cpp"
    cpp.write_text(source)
    binary = Path(directory) / "test"
    subprocess.run([os.environ.get("CXX", "c++"), "-std=c++17", "-Wall", "-Wextra", "-Werror", "-I", str(HEADERS), str(cpp), "-o", str(binary)], check=True)
    subprocess.run([str(binary)], check=True)
print("Standalone screen full-grid ordering and independent registration passed")
