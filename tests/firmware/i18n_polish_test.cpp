#include <cassert>
#include <cstddef>
#include <cstring>
#include <string>

// The real generated tables, not an identity stub: this is the only firmware
// test that exercises a runtime language switch and a non-English catalog.
#include "i18n_generated.h"

namespace {

bool same(const char *actual, const char *expected) {
  return actual != nullptr && std::strcmp(actual, expected) == 0;
}

}  // namespace

int main() {
  // Default language is English: value lookups are identity (same pointer,
  // no copy) and key lookups resolve to the English source text.
  assert(espcontrol_language_code() == "en");
  const char *settings = "Settings";
  assert(espcontrol_i18n(settings) == settings);
  assert(same(espcontrol_i18n("Open"), "Open"));
  assert(same(espcontrol_i18n_key("state_open"), "Open"));
  assert(same(espcontrol_i18n_key("month_day_october"), "October"));
  assert(espcontrol_i18n(std::string("Cover Art")) == "Cover Art");
  assert(same(espcontrol_i18n(static_cast<const char *>(nullptr)), ""));
  assert(same(espcontrol_i18n_key(static_cast<const char *>(nullptr)), ""));

  set_espcontrol_language("pl");
  assert(espcontrol_language_code() == "pl");
  assert(same(espcontrol_i18n("Settings"), "Ustawienia"));

  // "Open" is the one English value shared by two keys. The value lookup
  // resolves to the first key (the imperative command used by garage/gate
  // command cards); the state wording is reachable only through its key.
  assert(same(espcontrol_i18n("Open"), "Otwórz"));
  assert(same(espcontrol_i18n_key("open"), "Otwórz"));
  assert(same(espcontrol_i18n_key("state_open"), "Otwarte"));

  // Keys added for the Polish gaps (raw-English display sites).
  assert(same(espcontrol_i18n("Cover Art"), "Okładka"));
  assert(same(espcontrol_i18n("Locked"), "Zablokowany"));
  const char *new_sources[] = {
    "Cover Art", "Connect", "Local Action", "Switch", "Lighting", "Garage",
    "Sensor", "Camera", "Locked", "Unlocked", "Locking", "Unlocking",
    "Jammed", "Line-in",
  };
  for (const char *source : new_sources) {
    assert(!same(espcontrol_i18n(source), source));
  }

  // Former untranslated leftovers must stay translated.
  assert(!same(espcontrol_i18n("Arm Night"), "Arm Night"));
  assert(!same(espcontrol_i18n("Armed Vacation"), "Armed Vacation"));
  assert(!same(espcontrol_i18n("If this persists, check your server for issues"),
               "If this persists, check your server for issues"));
  assert(same(espcontrol_i18n("Confirm"), "Potwierdź"));

  // Calendar months: the value lookup keeps the nominative (month shown on
  // its own), the month_day_* keys carry the genitive used after a day number.
  assert(same(espcontrol_i18n("October"), "październik"));
  assert(same(espcontrol_i18n_key("october"), "październik"));
  assert(same(espcontrol_i18n_key("month_day_october"), "października"));
  assert(same(espcontrol_i18n_key("month_day_may"), "maja"));
  const char *months[] = {
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  };
  const char *month_day_keys[] = {
    "month_day_january", "month_day_february", "month_day_march",
    "month_day_april", "month_day_may", "month_day_june",
    "month_day_july", "month_day_august", "month_day_september",
    "month_day_october", "month_day_november", "month_day_december",
  };
  for (std::size_t i = 0; i < 12; ++i) {
    const char *nominative = espcontrol_i18n(months[i]);
    const char *day_form = espcontrol_i18n_key(month_day_keys[i]);
    assert(!same(nominative, months[i]));
    assert(!same(day_form, months[i]));
    assert(!same(day_form, nominative));
    // "31 " + month must fit the 32-byte calendar label buffer.
    assert(std::strlen(day_form) <= 28);
  }

  // Values that are intentionally identical to English fall through.
  assert(same(espcontrol_i18n("Alarm"), "Alarm"));
  assert(same(espcontrol_i18n_key("home_assistant"), "Home Assistant"));

  // Misses: unknown text and unknown keys come back unchanged. The
  // const char * overloads return the argument itself, which display sites
  // rely on to detect a key miss.
  const char *unknown_text = "Armed Custom Bypass";
  assert(espcontrol_i18n(unknown_text) == unknown_text);
  const char *unknown_key = "no_such_key";
  assert(espcontrol_i18n_key(unknown_key) == unknown_key);
  assert(same(espcontrol_i18n(""), ""));

  // std::string overloads follow the same tables.
  assert(espcontrol_i18n(std::string("Settings")) == "Ustawienia");
  assert(espcontrol_i18n(std::string("Cover Art")) == "Okładka");
  assert(espcontrol_i18n(std::string("Armed Custom Bypass")) == "Armed Custom Bypass");
  assert(espcontrol_i18n_key(std::string("state_open")) == "Otwarte");
  assert(espcontrol_i18n_key(std::string("no_such_key")) == "no_such_key");

  // A language code with a hyphen dispatches to its own table.
  set_espcontrol_language("pt-br");
  assert(!same(espcontrol_i18n("Settings"), "Settings"));
  assert(!same(espcontrol_i18n("Settings"), "Ustawienia"));

  // Unknown language: value lookups are identity, key lookups are English.
  set_espcontrol_language("xx");
  assert(espcontrol_i18n(settings) == settings);
  assert(same(espcontrol_i18n("Open"), "Open"));
  assert(same(espcontrol_i18n_key("state_open"), "Open"));
  assert(same(espcontrol_i18n_key("month_day_october"), "October"));

  // Restoring English returns English.
  set_espcontrol_language("pl");
  assert(same(espcontrol_i18n("Settings"), "Ustawienia"));
  set_espcontrol_language("en");
  assert(espcontrol_language_code() == "en");
  assert(espcontrol_i18n(settings) == settings);
  assert(same(espcontrol_i18n("Cover Art"), "Cover Art"));
  assert(same(espcontrol_i18n_key("state_open"), "Open"));
  assert(espcontrol_i18n(std::string("Locked")) == "Locked");
  return 0;
}
