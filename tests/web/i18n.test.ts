import {
  i18n,
  i18nDevice,
  i18nDynamic,
  i18nKey,
  i18nMark,
  i18nPlural,
  requestWebLocale,
  resolveWebLocale,
  setWebLocaleForTests,
  webLocale,
} from "../../src/webserver/i18n";
import type { WebI18nTables } from "../../src/webserver/i18n";
import {
  WEB_I18N_DEVICE_SOURCES,
  WEB_I18N_DEVICE_VALUES,
  WEB_I18N_KEY_INDEX,
  WEB_I18N_LOCALES,
  WEB_I18N_SOURCE_COUNT,
  WEB_I18N_SOURCES,
  WEB_I18N_VALUES,
} from "../../src/webserver/generated/i18n";

import { initializeDeviceConfig } from "../../src/webserver/device_config";
import { initializeAppState, state } from "../../src/webserver/state/app_instance";
import { holdWebLocaleReload, webLocaleReloadAllowed } from "../../src/webserver/application/language_state";
import { createApplicationApiFeature } from "../../src/webserver/application/api";
import { createDeviceApi } from "../../src/webserver/api/device_api";
import type { FetchResponseLike } from "../../src/webserver/api/device_api";

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
function equal(actual: unknown, expected: unknown, message: string) {
  if (actual !== expected) throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

// Evaluated while the bundle loads, like the card metadata and picker tables in src/webserver.
const MODULE_SCOPE_LABEL = i18n("Buy me a coffee");
const MODULE_SCOPE_LOCALE = webLocale();

const CARDS = { one: "{count} card selected", other: "{count} cards selected" };

// Self-contained tables so these tests do not depend on the wording of the real catalog.
const TEST_TABLES: WebI18nTables = {
  locales: ["pl"],
  sourceCount: 3,
  sources: [
    "Save", "Media", "Move {name} up",
    "Open", CARDS.one, CARDS.other, CARDS.other, CARDS.other, "{count} items",
  ],
  keyIndex: {
    "open__state": 3,
    "cards_selected.one": 4, "cards_selected.other": 5, "cards_selected.few": 6, "cards_selected.many": 7,
    "items.other": 8,
  },
  values: {
    pl: [
      "Zapisz", 0, "Przenieś {name} w górę",
      "Otwarte", "{count} karta", "{count} karty", "{count} karty", "{count} kart", "{count} elem.",
    ],
  },
  deviceSources: ["Closed", "Alarm"],
  deviceValues: { pl: ["Zamknięte", 0] },
};

function runEnglishTests() {
  setWebLocaleForTests("en", TEST_TABLES);
  equal(webLocale(), "en", "English locale");
  equal(i18n("Save"), "Save", "English is the identity");
  equal(i18n("Not in any catalog"), "Not in any catalog", "English never needs a catalog entry");
  equal(i18n("Move {name} up", { name: "Lamp" }), "Move Lamp up", "English interpolation");
  equal(i18n("{count} of {total}", { count: 2, total: 5 }), "2 of 5", "numeric params");
  equal(i18n("Hi {who}", { name: "x" }), "Hi {who}", "unknown tokens stay verbatim");
  equal(i18n("Hi {who}"), "Hi {who}", "no params leaves the text alone");
  equal(i18nKey("open__state", "Open"), "Open", "English context key returns the inline default");
  equal(i18nPlural("cards_selected", 1, CARDS), "1 card selected", "English singular");
  equal(i18nPlural("cards_selected", 0, CARDS), "0 cards selected", "English zero");
  equal(i18nPlural("cards_selected", 2, CARDS), "2 cards selected", "English plural");
  equal(i18nPlural("cards_selected", 1.5, CARDS), "1.5 cards selected", "English fraction");
  equal(i18nPlural("moved", 3, { one: "{count} card to {name}", other: "{count} cards to {name}" }, { name: "Hall" }),
    "3 cards to Hall", "plural params");
  equal(i18nDevice("Closed"), "Closed", "English device text");
  equal(i18nDynamic("Save"), "Save", "English dynamic lookup");
  equal(i18nMark("Marked"), "Marked", "i18nMark is the identity");
}

function runPolishTests() {
  setWebLocaleForTests("pl", TEST_TABLES);
  equal(webLocale(), "pl", "Polish locale");
  equal(i18n("Save"), "Zapisz", "Polish lookup");
  equal(i18nDynamic("Save"), "Zapisz", "dynamic lookup shares the table");
  equal(i18n("Media"), "Media", "0 means identical to English");
  equal(i18n("Missing from the catalog"), "Missing from the catalog", "a miss falls back to English");
  equal(i18n("Move {name} up", { name: "Lampa" }), "Przenieś Lampa w górę", "Polish interpolation");
  equal(i18n("Open"), "Open", "context entries are not reachable by their English text");
  equal(i18nKey("open__state", "Open"), "Otwarte", "context key lookup");
  equal(i18nKey("unknown_key", "Fallback {n}", { n: 1 }), "Fallback 1", "unknown key returns the inline English");
  equal(i18nKey("constructor", "Safe"), "Safe", "prototype names are not keys");
  equal(i18nMark("Marked"), "Marked", "i18nMark never translates");
  equal(i18nDynamic(undefined as unknown as string), undefined, "dynamic lookup passes non-strings through");
  equal(i18nDevice("Closed"), "Zamknięte", "device text comes from the firmware table");
  equal(i18nDevice("Alarm"), "Alarm", "identical device text");
  equal(i18nDevice("Save"), "Save", "device lookup does not read the web table");
  equal(i18n("Closed"), "Closed", "web lookup does not read the firmware table");
}

const POLISH_PLURALS: [number, string][] = [
  [0, "0 kart"], [1, "1 karta"], [2, "2 karty"], [5, "5 kart"], [12, "12 kart"],
  [22, "22 karty"], [25, "25 kart"], [1.5, "1,5 karty"], [112, "112 kart"], [101, "101 kart"],
];

function runPolishPluralTests(label: string) {
  setWebLocaleForTests("pl", TEST_TABLES);
  for (const [count, expected] of POLISH_PLURALS)
    equal(i18nPlural("cards_selected", count, CARDS).replace(/\s/g, " "), expected, `${label} plural for ${count}`);
  equal(i18nPlural("items", 3, { one: "{count} item", other: "{count} items" }), "3 elem.", `${label} missing category falls back to other`);
  equal(i18nPlural("unknown_family", 1, CARDS), "1 card selected", `${label} unknown family falls back to English one`);
  equal(i18nPlural("unknown_family", 4, CARDS), "4 cards selected", `${label} unknown family falls back to English other`);
}

function runPolishPluralFallbackTests() {
  const intl = Intl as unknown as { PluralRules: unknown; NumberFormat: unknown };
  const pluralRules = intl.PluralRules;
  const numberFormat = intl.NumberFormat;
  try {
    intl.PluralRules = undefined;
    runPolishPluralTests("built-in");
    intl.NumberFormat = undefined;
    setWebLocaleForTests("pl", TEST_TABLES);
    equal(i18nPlural("cards_selected", 1.5, CARDS), "1.5 karty", "count without Intl.NumberFormat");
  } finally {
    intl.PluralRules = pluralRules;
    intl.NumberFormat = numberFormat;
  }
}

function runLocaleResolutionTests() {
  setWebLocaleForTests("en");
  equal(resolveWebLocale("pl"), "pl", "Polish has a catalog");
  equal(resolveWebLocale(" PL "), "pl", "device language is normalized");
  equal(resolveWebLocale("de"), "en", "a language without a web catalog stays English");
  equal(resolveWebLocale(""), "en", "empty language");
  equal(resolveWebLocale(undefined as unknown as string), "en", "missing language");
  setWebLocaleForTests("de");
  equal(webLocale(), "en", "unsupported test locale resolves to English");
}

function runGeneratedCatalogTests() {
  assert(WEB_I18N_LOCALES.indexOf("pl") !== -1, "the Polish catalog is generated");
  assert(WEB_I18N_LOCALES.indexOf("en") === -1, "English is never a generated locale");
  assert(WEB_I18N_SOURCE_COUNT <= WEB_I18N_SOURCES.length, "source count is within the table");
  for (const locale of WEB_I18N_LOCALES) {
    equal(WEB_I18N_VALUES[locale]?.length, WEB_I18N_SOURCES.length, `${locale} values are index-aligned`);
    equal(WEB_I18N_DEVICE_VALUES[locale]?.length, WEB_I18N_DEVICE_SOURCES.length, `${locale} device values are index-aligned`);
  }
  for (const key of Object.keys(WEB_I18N_KEY_INDEX)) {
    const index = WEB_I18N_KEY_INDEX[key];
    assert(index !== undefined && index >= WEB_I18N_SOURCE_COUNT && index < WEB_I18N_SOURCES.length,
      `${key} indexes a keyed entry`);
  }
  setWebLocaleForTests("pl");
  equal(i18n("Buy me a coffee"), "Postaw mi kawę", "the real catalog translates the support link");
  equal(i18n("Settings"), "Ustawienia", "settings navigation label");
  equal(i18n("Save"), "Zapisz", "save action label");
  equal(i18n("Language"), "Język", "language setting label");
  equal(i18n("Configuration imported successfully"), "Konfiguracja została zaimportowana", "backup success label");
  for (const [count, expected] of [
    [0, "Wybrano 0 kart"], [1, "Wybrano 1 kartę"], [2, "Wybrano 2 karty"],
    [5, "Wybrano 5 kart"], [12, "Wybrano 12 kart"], [22, "Wybrano 22 karty"],
    [1.5, "Wybrano 1,5 karty"],
  ] as const) equal(i18nPlural("cards_selected", count, CARDS), expected, `generated Polish plural ${count}`);
  setWebLocaleForTests("en");
  equal(i18n("Buy me a coffee"), "Buy me a coffee", "switching back restores English");
}

// ── Reload logic with injected fakes ─────────────────────────────────────

interface FakeTimer { fn: () => void; ms: number; cleared: boolean; }
interface FakeBrowser {
  timers: FakeTimer[];
  local: Record<string, string>;
  session: Record<string, string>;
  reloads: number;
  replaced: string[];
  runTimers(): number;
  pending(): FakeTimer[];
}

function fakeStorage(data: Record<string, string>, broken: boolean) {
  return {
    getItem(key: string) { if (broken) throw new Error("denied"); return key in data ? data[key] : null; },
    setItem(key: string, value: string) { if (broken) throw new Error("denied"); data[key] = String(value); },
    removeItem(key: string) { if (broken) throw new Error("denied"); delete data[key]; },
  };
}

function withFakeBrowser(options: { brokenStorage?: boolean; noReload?: boolean; session?: Record<string, string> },
  run: (browser: FakeBrowser) => void) {
  const scope = globalThis as unknown as Record<string, unknown>;
  const names = ["location", "localStorage", "sessionStorage", "setTimeout", "clearTimeout"];
  const saved = names.map((name) => Object.getOwnPropertyDescriptor(scope, name));
  const browser: FakeBrowser = {
    timers: [], local: {}, session: options.session || {}, reloads: 0, replaced: [],
    pending() { return browser.timers.filter((timer) => !timer.cleared); },
    runTimers() {
      const due = browser.pending();
      for (const timer of due) { timer.cleared = true; timer.fn(); }
      return due.length;
    },
  };
  const location: Record<string, unknown> = {
    href: "http://panel.test/?tab=settings#top",
    replace(url: string) { browser.replaced.push(url); },
  };
  if (!options.noReload) location.reload = () => { browser.reloads++; };
  const stubs: Record<string, unknown> = {
    location,
    localStorage: fakeStorage(browser.local, !!options.brokenStorage),
    sessionStorage: fakeStorage(browser.session, !!options.brokenStorage),
    setTimeout: (fn: () => void, ms: number) => { const timer = { fn, ms, cleared: false }; browser.timers.push(timer); return timer; },
    clearTimeout: (timer: FakeTimer | null) => { if (timer) timer.cleared = true; },
  };
  try {
    for (const name of names)
      Object.defineProperty(scope, name, { value: stubs[name], configurable: true, writable: true });
    setWebLocaleForTests("en");
    run(browser);
  } finally {
    setWebLocaleForTests("en");
    names.forEach((name, index) => {
      const descriptor = saved[index];
      if (descriptor) Object.defineProperty(scope, name, descriptor);
      else delete scope[name];
    });
  }
}

function runReloadTests() {
  withFakeBrowser({ session: { "espcontrol.web.locale.reload": "en" } }, (browser) => {
    requestWebLocale("en");
    equal(browser.local["espcontrol.web.locale"], "en", "hint is stored when the locale already matches");
    equal(browser.pending().length, 0, "no reload is scheduled for the active locale");
    equal(browser.session["espcontrol.web.locale.reload"], undefined, "a matching locale clears the loop guard");
    requestWebLocale("de");
    equal(browser.local["espcontrol.web.locale"], "en", "a language without a web catalog stores English");
    equal(browser.pending().length, 0, "a language without a web catalog never reloads");
  });

  withFakeBrowser({}, (browser) => {
    requestWebLocale("pl");
    equal(browser.local["espcontrol.web.locale"], "pl", "hint is stored before the reload");
    equal(browser.reloads, 0, "reload is debounced");
    requestWebLocale("pl");
    requestWebLocale("pl");
    equal(browser.pending().length, 1, "repeated requests keep one timer");
    equal(browser.pending()[0]?.ms, 400, "debounce delay");
    browser.runTimers();
    equal(browser.reloads, 1, "one reload");
    equal(browser.session["espcontrol.web.locale.reload"], "pl", "loop guard remembers the target");
    equal(browser.pending().length, 0, "nothing pending after the reload");
    equal(browser.replaced.length, 0, "storage-backed reload keeps the URL");
  });

  withFakeBrowser({}, (browser) => {
    requestWebLocale("pl");
    requestWebLocale("en");
    equal(browser.pending().length, 0, "switching back before the debounce cancels the reload");
    equal(browser.local["espcontrol.web.locale"], "en", "latest hint wins");
    browser.runTimers();
    equal(browser.reloads, 0, "cancelled reload never fires");
  });

  withFakeBrowser({}, (browser) => {
    let safe = false;
    let asked = 0;
    requestWebLocale("pl", () => { asked++; return safe; });
    browser.runTimers();
    browser.runTimers();
    equal(browser.reloads, 0, "a busy guard blocks the reload");
    equal(asked, 2, "the guard is asked on every check");
    equal(browser.pending().length, 1, "a blocked reload is retried");
    safe = true;
    browser.runTimers();
    equal(browser.reloads, 1, "reload happens once the guard allows it");
  });

  withFakeBrowser({}, (browser) => {
    requestWebLocale("pl", () => false);
    let checks = 0;
    while (browser.runTimers() && checks < 1000) checks++;
    equal(checks, 300, "a reload that stays blocked is given up");
    equal(browser.reloads, 0, "a blocked reload never fires");
  });

  withFakeBrowser({}, (browser) => {
    requestWebLocale("pl", () => { throw new Error("guard failed"); });
    browser.runTimers();
    equal(browser.reloads, 0, "a throwing guard blocks the reload");
  });

  withFakeBrowser({ session: { "espcontrol.web.locale.reload": "pl" } }, (browser) => {
    requestWebLocale("pl");
    browser.runTimers();
    equal(browser.reloads, 0, "the loop guard allows one reload per target");
    equal(browser.replaced.length, 0, "the loop guard also blocks the URL fallback");
  });

  withFakeBrowser({ brokenStorage: true }, (browser) => {
    requestWebLocale("pl");
    browser.runTimers();
    equal(browser.reloads, 0, "without storage a plain reload would come back in English");
    equal(browser.replaced.length, 1, "without storage the locale travels in the URL");
    const url = new URL(browser.replaced[0] || "http://invalid/");
    equal(url.searchParams.get("espcontrol_lang"), "pl", "URL locale parameter");
    equal(url.searchParams.get("tab"), "settings", "URL fallback keeps the other parameters");
    equal(url.hash, "#top", "URL fallback keeps the hash");
  });

  withFakeBrowser({ noReload: true }, (browser) => {
    requestWebLocale("pl");
    equal(browser.local["espcontrol.web.locale"], "pl", "hint is stored even when the page cannot reload");
    equal(browser.timers.length, 0, "no timer without location.reload (vm sandbox)");
  });
}

export function runI18nTests() {
  equal(MODULE_SCOPE_LOCALE, "en", "a page without a stored locale starts in English");
  equal(MODULE_SCOPE_LABEL, "Buy me a coffee", "module-scope text is English by default");
  try {
    runEnglishTests();
    runPolishTests();
    runPolishPluralTests("Intl");
    runPolishPluralFallbackTests();
    runLocaleResolutionTests();
    runGeneratedCatalogTests();
    runReloadTests();
  } finally {
    setWebLocaleForTests("en");
  }
}

function initializeLanguageTestState() {
  const scope = globalThis as unknown as Record<string, unknown>;
  const globals: Record<string, unknown> = {
    __ESPCONTROL_DEFAULT_DEVICE_ID__: "test",
    __ESPCONTROL_DEVICE_PROFILES__: { test: { slots: 4, cols: 2, rows: 2 } },
    __ESPCONTROL_TIMEZONE_OPTIONS__: [],
  };
  const saved = Object.keys(globals).map((name) => Object.getOwnPropertyDescriptor(scope, name));
  try {
    Object.assign(scope, globals);
    initializeDeviceConfig();
    initializeAppState();
  } finally {
    Object.keys(globals).forEach((name, index) => {
      if (saved[index]) Object.defineProperty(scope, name, saved[index]!);
      else delete scope[name];
    });
  }
}

export function runLanguageReloadGuardTests() {
  initializeLanguageTestState();
  withFakeBrowser({}, (browser) => {
    equal(webLocaleReloadAllowed(), true, "idle page can reload");
    state.settingsDraft = {
      key: "main:1", slot: 1, homeSlot: null, isSub: false, dirty: true,
      button: { entity: "light.kitchen", label: "Niezapisane", icon: "Auto", icon_on: "Auto", sensor: "", unit: "", type: "light", precision: "", options: "" },
    };
    requestWebLocale("pl", webLocaleReloadAllowed);
    browser.runTimers();
    equal(browser.reloads, 0, "a language SSE event must not discard an unsaved card draft");
    equal(state.settingsDraft.button.label, "Niezapisane", "blocked reload preserves the draft");
    state.settingsDraft.dirty = false;
    state.settingsDraft.isNew = true;
    browser.runTimers();
    equal(browser.reloads, 0, "a new unsaved card also blocks reload before its first edit");
    state.settingsDraft = null;
    const releaseImport = holdWebLocaleReload();
    const releaseRename = holdWebLocaleReload();
    browser.runTimers();
    equal(browser.reloads, 0, "backup import holds locale reload");
    releaseImport();
    releaseImport();
    browser.runTimers();
    equal(browser.reloads, 0, "releasing a hold twice cannot release another operation's hold");
    releaseRename();
    state.configLocked = true;
    browser.runTimers();
    equal(browser.reloads, 0, "reconnection or firmware update still blocks reload");
    state.configLocked = false;
    browser.runTimers();
    equal(browser.reloads, 1, "the deferred locale change applies once all work finishes");
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

export async function runPendingPostLocaleTests() {
  initializeLanguageTestState();
  let response = deferred<FetchResponseLike>();
  const requests: string[] = [];
  const deviceApi = createDeviceApi(async (url) => { requests.push(url); return response.promise; });
  let nativeSave: Promise<string> | null = null;
  const api = createApplicationApiFeature(
    { writeText: () => nativeSave } as any,
    deviceApi,
    { entityPostUrls: (domain, name, _ids, action) => [`/${domain}/${name}/${action}`], entityName: (name) => name, entityObjectIds: () => [] },
    { supported: () => true, syncUi() {} } as any,
    { setConfigLocked() {}, showBanner() {} },
  );
  const ok: FetchResponseLike = { ok: true, status: 200, json: async () => ({}) };
  for (const [label, start] of [
    ["queued POST", () => api.post("/test")],
    ["optional POST", () => api.postOptional("/optional")],
    ["legacy text POST", () => api.postTextLegacy("button_config", "test")],
    ["fallback POST", () => api.postFirstAvailable(["/fallback"])],
    ["quiet POST", () => api.postQuiet("/quiet")],
  ] as const) {
    response = deferred<FetchResponseLike>();
    const pending = start();
    const allowedWhilePending = webLocaleReloadAllowed();
    response.resolve(ok);
    await pending;
    equal(allowedWhilePending, false, `${label} must finish before a locale reload`);
    equal(webLocaleReloadAllowed(), true, `${label} releases its reload hold after completion`);
  }
  assert(requests.includes("/text/button_config/set?value=test"), "legacy test exercised a real device request");
  const first = deferred<FetchResponseLike>();
  const second = deferred<FetchResponseLike>();
  response = first;
  const firstPost = api.postQuiet("/first");
  response = second;
  const secondPost = api.postQuiet("/second");
  first.resolve(ok);
  await firstPost;
  const allowedWithSecondPending = webLocaleReloadAllowed();
  second.resolve(ok);
  await secondPost;
  equal(allowedWithSecondPending, false, "one completed POST cannot release another POST's hold");
  equal(webLocaleReloadAllowed(), true, "concurrent POST holds eventually clear");

  const native = deferred<string>();
  nativeSave = native.promise;
  const nativePost = api.postText("button_config", "test");
  const allowedWithNativePending = webLocaleReloadAllowed();
  native.resolve("saved");
  await nativePost;
  equal(allowedWithNativePending, false, "native configuration writes also block locale reload");
  equal(webLocaleReloadAllowed(), true, "native completion releases the reload hold");

  const queued = deferred<string>();
  api.postQueue = queued.promise;
  const allowedWithExternalQueuePending = webLocaleReloadAllowed();
  queued.reject(new Error("native save failed"));
  await api.postQueue.catch(() => {});
  equal(allowedWithExternalQueuePending, false, "configuration persistence queue assignments block reload");
  equal(webLocaleReloadAllowed(), true, "a rejected native queue does not leak a hold");
}

/** Runs in a bundle evaluated with a stored or URL locale of "pl" (see tests/web/unit/i18n.test.js). */
export function runPolishStartTests() {
  equal(MODULE_SCOPE_LOCALE, "pl", "the stored locale is active before any consumer evaluates");
  equal(webLocale(), "pl", "the locale stays fixed after load");
  assert(MODULE_SCOPE_LABEL && MODULE_SCOPE_LABEL !== "Buy me a coffee", "module-scope text is translated at load");
}

/** Runs in a bundle evaluated with a stored locale that has no web catalog. */
export function runUnsupportedStartTests() {
  equal(MODULE_SCOPE_LOCALE, "en", "an unsupported stored locale starts in English");
  equal(MODULE_SCOPE_LABEL, "Buy me a coffee", "module-scope text stays English");
}
