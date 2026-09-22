"use strict";

const { test } = require("node:test");
const { loadTypescriptTest } = require("./helpers/load_typescript_test");

test("normal home-card operations preserve independent screens", async () => {
  const { runStandaloneScreenSafetyTests } = loadTypescriptTest("tests/web/standalone_screen_safety.test.ts");
  await runStandaloneScreenSafetyTests();
});
