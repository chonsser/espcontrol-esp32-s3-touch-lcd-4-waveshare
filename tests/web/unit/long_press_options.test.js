"use strict";
const { test } = require("node:test");
const { loadTypescriptTest } = require("./helpers/load_typescript_test");
test("long press preserves shared options and excludes slider gestures", () => {
  loadTypescriptTest("tests/web/long_press_options.test.ts").runLongPressOptionsTests();
});
