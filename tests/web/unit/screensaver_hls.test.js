"use strict";
const test = require("node:test");
const { loadTypescriptTest } = require("./helpers/load_typescript_test");
test("HLS capabilities, URL validation, confirmed saves and restore ordering", async () => {
  await loadTypescriptTest("tests/web/screensaver_hls.test.ts").runScreensaverHlsTests();
});
