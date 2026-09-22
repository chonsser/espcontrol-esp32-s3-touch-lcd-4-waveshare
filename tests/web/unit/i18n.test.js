"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { loadTypeScriptModule } = require("../../../scripts/load_typescript_module");
const { loadTypescriptTest } = require("./helpers/load_typescript_test");

const ENTRY = path.resolve(__dirname, "../i18n.test.ts");

// The web locale is fixed when the i18n module evaluates, so each start-up
// scenario stubs the browser globals first and then evaluates a fresh bundle.
function loadWithGlobals(globals) {
  const names = Object.keys(globals);
  const saved = names.map((name) => Object.getOwnPropertyDescriptor(globalThis, name));
  try {
    for (const name of names)
      Object.defineProperty(globalThis, name, { value: globals[name], configurable: true, writable: true });
    return loadTypeScriptModule(ENTRY);
  } finally {
    names.forEach((name, index) => {
      if (saved[index]) Object.defineProperty(globalThis, name, saved[index]);
      else delete globalThis[name];
    });
  }
}

function storedLocale(locale) {
  return {
    getItem(key) { return key === "espcontrol.web.locale" ? locale : null; },
    setItem() {},
    removeItem() {},
  };
}

test("web i18n runtime", () => {
  loadTypescriptTest("tests/web/i18n.test.ts").runI18nTests();
});

test("language reload waits for unsaved drafts, imports and config locks", () => {
  loadTypescriptTest("tests/web/i18n.test.ts").runLanguageReloadGuardTests();
});

test("language reload waits for queued, direct and native POSTs", async () => {
  await loadTypescriptTest("tests/web/i18n.test.ts").runPendingPostLocaleTests();
});

test("stored locale is active before module-scope tables are built", () => {
  loadWithGlobals({ localStorage: storedLocale("pl") }).runPolishStartTests();
});

test("stored locale without a web catalog starts in English", () => {
  loadWithGlobals({ localStorage: storedLocale("de") }).runUnsupportedStartTests();
});

test("unreadable storage starts in English", () => {
  loadWithGlobals({
    localStorage: { getItem() { throw new Error("denied"); } },
  }).runUnsupportedStartTests();
});

test("URL locale parameter wins over storage and is stripped", () => {
  const replaced = [];
  loadWithGlobals({
    localStorage: storedLocale("en"),
    location: { href: "http://panel.test/config?espcontrol_lang=pl&tab=settings#top" },
    history: { replaceState(state, title, url) { replaced.push(url); } },
  }).runPolishStartTests();
  assert.deepEqual(replaced, ["/config?tab=settings#top"]);
});

test("URL locale parameter works without the history API", () => {
  loadWithGlobals({
    location: { href: "http://panel.test/?espcontrol_lang=pl" },
  }).runPolishStartTests();
});
