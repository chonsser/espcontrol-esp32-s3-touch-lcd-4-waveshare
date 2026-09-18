"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { loadTypescriptTest } = require("./helpers/load_typescript_test");
test("screensaver clock appearance capabilities and restore", async () => {
  await loadTypescriptTest("tests/web/screensaver_clock_font.test.ts").runScreensaverClockFontTests();
});
const formatFixtures = require("../../fixtures/screensaver_clock_formats.json");
const { isValidScreensaverClockFormat } = loadTypescriptTest("src/webserver/model/settings.ts");
for (const fixture of formatFixtures.cases) {
  test(`shared firmware/web numeric format validator ${JSON.stringify(fixture.format)}`, () => {
    assert.equal(isValidScreensaverClockFormat(fixture.format), fixture.valid);
  });
}
