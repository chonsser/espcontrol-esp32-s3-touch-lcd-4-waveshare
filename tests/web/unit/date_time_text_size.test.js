"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { loadTypescriptTest } = require("./helpers/load_typescript_test");
const { createConfigSensorOptionsFeature } = loadTypescriptTest("src/webserver/application/config_sensor_options.ts");

test("Date & Time sizes survive per-card normalization without changing legacy defaults or other cards", () => {
  const feature = createConfigSensorOptionsFeature({ definitions: {} });
  for (const type of ["calendar", "clock", "timezone"]) {
    for (const size of ["small", "medium", "large"]) {
      assert.equal(feature.normalizeDateTimeOptions(type, `unknown=1,text_size=${size},large_numbers=off`, "datetime"), `large_numbers=off,text_size=${size}`);
    }
    for (const invalid of ["auto", "", "999", "Large", "future"]) {
      assert.equal(feature.normalizeDateTimeOptions(type, `text_size=${invalid},large_numbers`, ""), "large_numbers");
    }
    assert.equal(feature.normalizeDateTimeOptions(type, "", ""), "");
  }
  assert.equal(feature.normalizeSensorOptions("text_size=large", "0"), "");
  assert.equal(feature.normalizeDateTimeOptions("sensor", "text_size=large", "0"), "");
});
