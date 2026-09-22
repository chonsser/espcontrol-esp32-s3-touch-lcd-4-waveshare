"""Run temporary light callbacks and teardown against the real HA coordinator."""
from pathlib import Path
import os
import re
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
HEADERS = ROOT / "components/espcontrol"

def function(source, name):
    matches = re.findall(r"^inline [^\n]*\b" + name + r"\([^;]*?\{\n.*?^\}", source, re.M | re.S)
    assert len(matches) == 1, name
    return matches[0] + "\n"

sliders = (HEADERS / "button_grid_sliders.h").read_text()
controls = (HEADERS / "button_grid_long_press_controls.h").read_text()
source = r'''
#include <cassert>
#include <cctype>
#include <cstdlib>
#include <string>
#include <functional>
#include "esphome/core/string_ref.h"
#include "home_assistant_binding_service.h"
struct lv_obj_t { void *data = nullptr; bool checked = false; std::string text; };
struct lv_font_t {};
constexpr int LV_PART_MAIN = 0, DEFAULT_SLIDER_COLOR = 42;
void lv_label_set_text(lv_obj_t *, const char *) {}
void lv_label_set_display_text(lv_obj_t *obj, const char *s) { obj->text = s; }
void set_card_checked_state(lv_obj_t *obj, bool on) { obj->checked = on; }
inline const char *espcontrol_i18n(const char *s) { return s; }
inline std::string espcontrol_i18n(const std::string &s) { return s; }
#include "button_grid_config_parser.h"
struct Transport {
  using State = esphome::StringRef;
  using Callback = std::function<void(State)>;
  struct Subscription { std::string entity, attribute; Callback cb; };
  std::vector<Subscription> subscriptions;
  bool available() const { return true; }
  bool state_connected() const { return true; }
  void subscribe(const std::string &e, const std::string &a, Callback cb) { subscriptions.push_back({e,a,cb}); }
  bool request(const std::string &, const std::string &) { return true; }
  void publish(const std::string &e, const std::string &a, const char *value) {
    for (auto s : subscriptions) if (s.entity == e && s.attribute == a) s.cb(State(value));
  }
};
struct Heap { bool available(const char *, size_t, size_t) { return true; } };
HomeAssistantBindingService<Transport, Heap> binding;
auto &coordinator = binding.read_coordinator();
struct HaCallbackOwnerScope {
  HomeAssistantCallbackOwnerService::Scope scope;
  explicit HaCallbackOwnerScope(void *owner) : scope(binding.callback_owner_scope(owner)) {}
};
void ha_subscribe_attribute(const std::string &e, const std::string &a, Transport::Callback cb) {
  coordinator.subscribe(e, a, cb, 1, binding.callback_owner(), true);
}
void ha_subscribe_state(const std::string &e, Transport::Callback cb) { ha_subscribe_attribute(e, "", cb); }
void ha_release_callbacks_for_owner(void *owner) { coordinator.release_owner(owner); }
void ha_schedule_metadata_refresh(const std::string &, std::initializer_list<const char *>, uint32_t) {}
bool slider_parse_light_brightness_pct(esphome::StringRef s, int &pct) { pct = std::atoi(s.c_str()) * 100 / 255; return true; }
const lv_font_t font;
const lv_font_t *lv_obj_get_style_text_font(lv_obj_t *, int) { return &font; }
const lv_font_t *switch_confirmation_message_font(const lv_font_t *f) { return f; }
const lv_font_t *switch_confirmation_icon_font(const lv_font_t *f) { return f; }
uint32_t current_button_primary_color() { return 0x123456; }
'''
source += re.search(r"struct LightControlCtx \{.*?^\};", sliders, re.M | re.S)[0] + "\n"
source += r'''
struct LightControlModalUi {
  lv_obj_t *overlay = nullptr, *panel = nullptr, *color_grid = nullptr;
  lv_obj_t *temp_slider = nullptr, *temp_slider_fill = nullptr, *temp_slider_handle = nullptr;
  LightControlCtx *active = nullptr;
};
LightControlModalUi ui;
LightControlModalUi &light_control_modal_ui() { return ui; }
enum class ControlModalKind { LIGHT_CONTROL };
void control_modal_delete_overlay(ControlModalKind, lv_obj_t *&overlay) {
  assert(coordinator.subscription_count() == 0); // released before widgets/context deletion
  delete overlay; overlay = nullptr;
}
int updates = 0;
void light_control_set_modal_value(LightControlCtx *, int) { ++updates; }
void light_control_apply_modal_power(LightControlCtx *) {}
void light_control_set_temp_modal_value(LightControlCtx *, int) {}
int light_control_kelvin_to_pct(LightControlCtx *, int) { return 50; }
int kelvin_to_fill_color(int, int, int) { return 0; }
void light_control_update_slider_fill(lv_obj_t *, lv_obj_t *, lv_obj_t *, int, int) {}
void light_control_update_slider_handle(lv_obj_t *, lv_obj_t *, int) {}
void light_control_rebuild_color_grid(LightControlCtx *) {}
void light_control_apply_tab_visibility() {}
'''
for name in ("light_control_title", "light_control_apply_card_visual", "light_control_display_pct", "subscribe_light_control_state", "light_control_hide_modal"):
    source += function(sliders, name)
source += r'''
void light_control_open_modal(LightControlCtx *ctx) {
  if (ui.active) light_control_hide_modal();
  ui.active = ctx;
  ui.overlay = ui.panel = new lv_obj_t;
}
'''
source += function(controls, "light_control_open_entity_modal")
source += r'''
int main() {
  ParsedCfg cfg; cfg.entity = "light.kitchen"; cfg.label = "Kitchen";
  lv_obj_t tile, label, icon;
  int original_data = 7;
  tile.data = &original_data; label.text = "Kitchen"; icon.text = "Original";
  light_control_open_entity_modal(cfg, &tile);
  assert(ui.active->modal_owned && ui.active->accent_color == 0x123456);
  assert(ui.active->label_font == &font && ui.active->number_font == &font && ui.active->icon_font == &font);
  assert(binding.callback_owner() == nullptr && coordinator.subscription_count() == 5);
  // Even if given labels accidentally, an owned menu cannot repaint the tile.
  ui.active->label_lbl = &label; ui.active->icon_lbl = &icon;
  coordinator.transport().publish(cfg.entity, "", "on");
  coordinator.transport().publish(cfg.entity, "brightness", "128");
  coordinator.transport().publish(cfg.entity, "friendly_name", "Changed");
  assert(ui.active->on && ui.active->current_pct == 50);
  assert(tile.data == &original_data && !tile.checked && label.text == "Kitchen" && icon.text == "Original");
  light_control_hide_modal();
  int closed_updates = updates;
  coordinator.transport().publish(cfg.entity, "", "off");
  assert(updates == closed_updates && !ui.active && coordinator.subscription_count() == 0);
  // Replacing the menu releases old subscriptions, even on reused channels.
  light_control_open_entity_modal(cfg, &tile);
  ParsedCfg other = cfg; other.entity = "light.bedroom";
  light_control_open_entity_modal(other, &tile);
  closed_updates = updates;
  coordinator.transport().publish(cfg.entity, "", "on");
  assert(updates == closed_updates && ui.active->entity_id == other.entity);
  coordinator.transport().publish(other.entity, "", "on");
  assert(ui.active->on && coordinator.subscription_count() == 5);
  light_control_hide_modal(); // Navigation and grid rebuild call this same teardown.
  closed_updates = updates;
  coordinator.transport().publish(other.entity, "brightness", "255");
  assert(updates == closed_updates);
  // Closing a grid-owned control never deletes it.
  LightControlCtx grid_context;
  light_control_open_modal(&grid_context);
  light_control_hide_modal();
  grid_context.on = true;
  assert(grid_context.on);
}
'''
# Check that all teardown entry points reach the exercised close function.
grid = (HEADERS / "button_grid_grid.h").read_text()
assert grid.count("  more_info_hide_modal();\n  light_control_hide_modal();") == 2
navigation = (HEADERS / "button_grid_navigation.h").read_text()
assert "control_modal_force_close_active();" in function(navigation, "navigation_hide_modals")
with tempfile.TemporaryDirectory(prefix="long-press-lifecycle-") as temp:
    cpp, binary = Path(temp) / "test.cpp", Path(temp) / "test"
    cpp.write_text(source)
    subprocess.run([os.environ.get("CXX", "c++"), "-std=c++17", "-Wall", "-Wextra", "-Werror", "-fsanitize=address,undefined", "-I", str(HEADERS), "-I", str(ROOT / "tests/firmware/stubs"), str(cpp), "-o", str(binary)], check=True)
    subprocess.run([str(binary)], check=True)
print("Temporary light ownership, live state and late callback teardown passed")
