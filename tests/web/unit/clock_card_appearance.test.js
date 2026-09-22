"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { loadTypescriptTest } = require("./helpers/load_typescript_test");
const { createConfigSensorOptionsFeature } = loadTypescriptTest("src/webserver/application/config_sensor_options.ts");
const { configOptionValue, setConfigOptionValue, encodeConfigField, decodeConfigField } = loadTypescriptTest("src/webserver/model/config_primitives.ts");
const { createConfigDateTimeOptionsFeature } = loadTypescriptTest("src/webserver/application/config_date_time_options.ts");
const { createCardRegistry } = loadTypescriptTest("src/webserver/application/card_registry.ts");
const { createControlsFieldsFeature } = loadTypescriptTest("src/webserver/application/controls_fields.ts");
const { registerClockCardTypes } = loadTypescriptTest("src/webserver/cards/clock.ts");
const normalizer = createConfigSensorOptionsFeature({ definitions: {} });
const normalize = options => normalizer.normalizeDateTimeOptions("clock", options, "");

test("clock normalization preserves encoded formats, font and hidden-date size in firmware order", () => {
  assert.equal(normalize("date_size=large,date_format=%25d.%25m.%25Y,time_format=%25H%3A%25M%3A%25S,clock_font=mono,text_size=medium,large_numbers=off,unknown=1"),
    "large_numbers=off,text_size=medium,clock_font=mono,time_format=%25H%3A%25M%3A%25S,date_format=%25d.%25m.%25Y,date_size=large");
  assert.equal(normalize("date_size=medium,date_format=,clock_font=thin"), "clock_font=thin,date_size=medium");
  assert.equal(normalize("clock_font=bold"), "clock_font=bold");
  assert.equal(normalize(""), "");
  for (const type of ["calendar", "timezone"]) {
    assert.equal(normalizer.normalizeDateTimeOptions(type, "text_size=large,clock_font=mono,time_format=%25S,date_format=%25Y,date_size=small", ""), "text_size=large");
  }
});

test("clock formats reuse screensaver grammar and reject invalid decoded data rather than trimming it valid", () => {
  for (const invalid of ["%A", "%p", "%", "%%", "hello", " :.-/ ", "\t%H", "%H\n", " %H", "%H,1", "%H;1", "%H|1", "1".repeat(33), "%Y".repeat(9)]) {
    assert.equal(normalize("time_format=" + encodeConfigField(invalid) + ",date_size=small"), "date_size=small", JSON.stringify(invalid));
  }
  for (const value of [" %H ", "%H %I %M %S %d %m %Y %y", "1".repeat(32), "%Y".repeat(8), "0 :./-"]) {
    const result = normalize("time_format=" + encodeConfigField(value));
    assert.equal(configOptionValue(result, "time_format"), value);
    assert.equal(normalize(result), result, "normalization is idempotent");
    assert.equal(decodeConfigField(encodeConfigField(result)), result, "nested compact field transport keeps option escaping");
  }
  assert.equal(normalize("clock_font=Roboto Mono,date_size=Large,text_size=Auto"), "");
});

test("format option transport can preserve validated ASCII spaces without changing other option trimming", () => {
  assert.equal(setConfigOptionValue("", "time_format", " %H:%M ", true), "time_format= %25H%3A%25M ");
  assert.equal(setConfigOptionValue("", "other", " value "), "other=value");
});

function preview(options, clockFormat = "24h", timezone = "Europe/Warsaw", instant = "2026-12-31T23:59:58Z") {
  const registry = createCardRegistry();
  const dateTime = createConfigDateTimeOptionsFeature({
    state: { clockFormat, timezone, language: "pl" }, now: () => new Date(instant), renderButtonSettings() {},
    effectiveTimezoneOption: value => value === "Auto" ? "Europe/Warsaw" : value,
    timezoneId: value => value, timezoneOptionsWithFallback: () => [], appendTimezoneOption() {}, monthNameForIndex: () => "",
  });
  const fields = createControlsFieldsFeature(registry, createConfigSensorOptionsFeature(registry), {}, {});
  registerClockCardTypes(registry, dateTime, fields);
  return registry.definitions.clock.renderPreview({ type: "clock", options }, { cardSize: 1, escHtml: value => String(value) });
}

test("clock preview formats time and date from one effective panel timezone including midnight rollover", () => {
  const result = preview("time_format=%25H%3A%25M%3A%25S,date_format=%25Y-%25m-%25d,clock_font=mono,date_size=large", "12h", "Auto");
  assert.match(result.iconHtml, />00:59:58</);
  assert.match(result.iconHtml, />2027-01-01</);
  assert.match(result.buttonClass, /sp-clock-font-mono/);
  assert.match(result.iconHtml, /sp-clock-date-large/);
  const allTokens = preview("time_format=%25H%20%25I%20%25M%20%25S,date_format=%25d.%25m.%25Y%20%25y");
  assert.match(allTokens.iconHtml, />00 12 59 58</);
  assert.match(allTokens.iconHtml, />01.01.2027 27</);
});

test("absent clock options preserve legacy markup and global 12/24-hour behavior with date hidden", () => {
  const twelve = preview("", "12h", "UTC", "2026-01-01T13:02:03Z");
  assert.equal(twelve.buttonClass, undefined);
  assert.equal(twelve.iconHtml, '<span class="sp-sensor-preview"><span class="sp-sensor-value">1:02</span><span class="sp-sensor-unit"></span></span>');
  assert.match(preview("", "24h", "UTC", "2026-01-01T01:02:03Z").iconHtml, />01:02</);
  assert.doesNotMatch(preview("date_size=large").iconHtml, /sp-clock-date/);
});
