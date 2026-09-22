"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { chromium } = require("playwright");
const { loadBuiltWebSource } = require("../../scripts/web_source");
const { loadTypescriptTest } = require("./unit/helpers/load_typescript_test");
const { encodePanelConfig, decodePanelConfig } = loadTypescriptTest("src/webserver/model/index.ts");

let browser, bundle;
const profile = "waveshare-esp32-s3-touch-lcd-4";
const initialClock = ";;Auto;Auto;;;clock;;large_numbers=off";
test.before(async () => {
  bundle = loadBuiltWebSource();
  browser = await chromium.launch({ headless: true });
});
test.after(async () => { if (browser) await browser.close(); });

// Only panel I/O is faked. The app, editor draft/validation/save controllers,
// native document transport, option codec and preview are the production ones.
async function mount(options = {}) {
  const page = await browser.newPage({ viewport: { width: 1200, height: 1000 } });
  page.setDefaultTimeout(5000);
  const errors = [], writes = [], queries = [];
  const settings = { entity: "input_select.screen", rules: "0\tHome\n3\tMusic", wake: true };
  const panel = { deviceProfile: profile, buttons: { 1: initialClock, 2: ";Rooms;Home;Auto;;;subpage" }, subpages: { 3: "@screen:Music\n~1|CK,Music clock,,,,,,,large_numbers=off", 4: "@screen:Weather\n~1|CK,Weather clock,,,,,,,large_numbers=off" }, settings: { button_order: "1,2" } };
  let document = panel, generation = 1;
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.pathname === "/") return route.fulfill({ contentType: "text/html", body: '<!doctype html><html><body><esp-app></esp-app></body></html>' });
    if (url.pathname === "/api/v1/capabilities") return route.fulfill({ json: { api: { version: 1 }, configuration: { read: true, write: true, document_versions: [1] }, screen_navigation: { version: 2, standalone: true } } });
    if (url.pathname === "/api/v1/config") {
      if (request.method() === "PUT") {
        assert.equal(request.headers()["if-match"], `"${generation}"`);
        document = decodePanelConfig(new Uint8Array(request.postDataBuffer()));
        writes.push(document);
        generation++;
        return route.fulfill({ status: 204, headers: { ETag: `"${generation}"` } });
      }
      return route.fulfill({ contentType: "application/vnd.espcontrol.panel-config", headers: { ETag: `"${generation}"` }, body: Buffer.from(encodePanelConfig(document)) });
    }
    if (url.pathname === "/api/v1/screen-navigation/options") {
      const entity = url.searchParams.get("entity_id"); queries.push(entity);
      const result = options.discover ? await options.discover(entity) : { status: "ready", options: ["Home", "Music", "Weather"] };
      return route.fulfill({ json: { entity_id: entity, ...result } });
    }
    const key = ["entity", "rules", "wake"].find(key => decodeURIComponent(url.pathname).toLowerCase().replace(/[^a-z]+/g, "_").includes("screen_navigation_" + key));
    if (key) {
      if (request.method() === "POST") { settings[key] = key === "wake" ? url.pathname.endsWith("turn_on") : url.searchParams.get("value"); return route.fulfill({ status: 200, json: {} }); }
      return route.fulfill({ json: { value: settings[key] } });
    }
    if (decodeURIComponent(url.pathname).toLowerCase().replace(/[^a-z]+/g, "_").includes("button_order")) return route.fulfill({ json: { id: "text-button_order", state: panel.settings.button_order } });
    if (url.pathname.startsWith("/api/")) return route.fulfill({ status: 404, body: "Not found" });
    return route.fulfill({ status: 204, body: "" });
  });
  await page.addInitScript(() => {
    window.__ESPCONTROL_TEST_HOOKS__ = {};
    window.__sources = [];
    window.EventSource = class {
      constructor() { this.listeners = {}; this.readyState = 0; window.__sources.push(this); setTimeout(() => { this.readyState = 1; this.dispatch("open", {}); }, 0); }
      addEventListener(type, listener) { (this.listeners[type] ||= []).push(listener); }
      close() { this.readyState = 2; }
      dispatch(type, event) { for (const listener of this.listeners[type] || []) listener(event); }
    };
    window.seedClockState = events => { for (const event of events) window.__sources.at(-1).dispatch("state", { data: JSON.stringify(event) }); };
  });
  await page.goto(`http://espcontrol.test/?device=${profile}&events=1`);
  await page.clock.setFixedTime(new Date("2026-12-31T23:59:58Z"));
  await page.evaluate(profile => { window.__ESPCONTROL_DEVICE_PROFILE__ = profile; }, profile);
  await page.addScriptTag({ content: bundle });
  await page.waitForFunction(() => window.__sources.length > 0);
  await page.evaluate(() => window.seedClockState([
    { id: "select-screen__timezone", state: "Europe/Warsaw (GMT+1)", value: "Europe/Warsaw (GMT+1)", option: ["Europe/Warsaw (GMT+1)"] },
    { id: "select-screen__clock_format", state: "24h", value: "24h", option: ["12h", "24h"] },
  ]));
  await page.evaluate(panel => window.seedClockState([
    { id: "text-button_order", state: panel.settings.button_order },
    ...Object.entries(panel.buttons).map(([slot, state]) => ({ id: `text-button_${slot}_config`, state })),
    ...Object.entries(panel.subpages).map(([slot, state]) => ({ id: `text-subpage_${slot}_config`, state })),
  ]), panel);
  await page.getByRole("tab", { name: "Screen", exact: true }).click();
  await page.locator('[data-screen-slot="0"] .sp-main [data-slot="1"]').waitFor();

  return { page, errors, writes, queries, settings, document: () => document };
}
async function edit(page, screen = 0, slot = 1) {
  await page.locator(`[data-screen-slot="${screen}"] .sp-main [data-slot="${slot}"]`).click();
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.locator(".sp-settings-overlay.sp-visible").waitFor();
  // The editor groups secondary fields into its real Card Settings disclosure.
  for (const button of await page.locator(".sp-settings-modal .sp-disclosure-button").all()) {
    if (await button.getAttribute("aria-expanded") === "false") await button.click();
  }
}
async function save(page) {
  await page.locator(".sp-settings-modal .sp-save-btn").click();
  await page.waitForFunction(() => !document.querySelector(".sp-settings-overlay.sp-visible"));
}


test("shared source stays open above simultaneous independent screen editors", async () => {
 const app = await mount(), { page } = app;
 try {
  const shared = page.locator("#sp-set-screen-navigation");
  assert.equal(await shared.locator(".card-header").count(), 0, "shared source must not collapse");
  assert.equal(await page.locator("#sp-set-screen-navigation-entity").isVisible(), true);
  assert.equal(await page.locator("[data-screen-slot]").count(), 4);
  const home = await page.locator('[data-screen-slot="0"]').boundingBox();
  const music = await page.locator('[data-screen-slot="2"]').boundingBox();
  assert.ok(home && music && music.x > home.x, "previews appear side by side");
  await edit(page, 3);
  await page.locator("#sp-sp-inp-clock-font").selectOption("mono");
  await save(page);
  assert.match(app.document().subpages[3], /clock_font=mono/);
  assert.doesNotMatch(app.document().subpages[4], /clock_font=mono/);
  assert.equal(app.document().buttons[1], initialClock);
  assert.equal(await page.locator("#sp-set-screen-navigation-entity").isVisible(), true);
  await edit(page, 4);
  assert.equal(await page.locator("#sp-sp-inp-clock-font").inputValue(), "");
  await page.locator(".sp-settings-close").click();
  await page.screenshot({ path: "/private/tmp/screen-overview-ui.png", fullPage: true });
  assert.deepEqual(app.errors, []);
 } finally { await page.close(); }
});

test("entity entry discovers exact choices without saving and stale responses cannot replace new choices", async () => {
 let releaseOld;
 const app = await mount({ discover: async entity => {
  if (entity === "input_select.old") await new Promise(resolve => { releaseOld = resolve; });
  return { status: "ready", options: entity === "input_select.new" ? ["New", "  Exact, 'value'  "] : ["Old"] };
 }}), { page } = app;
 try {
  const entity = page.locator("#sp-set-screen-navigation-entity");
  await entity.fill("input_select.old");
  await page.waitForFunction(() => document.querySelector("#sp-screen-options-status").textContent.includes("Loading"));
  while (!releaseOld) await new Promise(resolve => setTimeout(resolve, 20));
  await entity.fill("input_select.new");
  const music = page.locator('[data-screen-slot="3"]');
  await music.locator('select option[value="New"]').waitFor({ state: "attached" });
  releaseOld();
  await page.waitForTimeout(100);
  assert.equal(await music.locator('select option[value="Old"]').count(), 0);
  assert.equal(app.settings.entity, "input_select.screen", "discovery is read only");
  assert.equal(await music.locator('select option[value="Music"]').textContent(), "Music (unavailable)");
  await music.locator(".sp-screen-state select").selectOption("  Exact, 'value'  ");
  await page.getByRole("button", { name: "Save screen settings", exact: true }).click();
  await page.getByText("Screen navigation saved.", { exact: true }).waitFor();
  assert.equal(app.settings.rules, "0\tHome\n3\t  Exact, 'value'  ");
  assert.deepEqual(app.errors, []);
 } finally { if (releaseOld) releaseOld(); await page.close(); }
});

test("unavailable and empty choices preserve existing mappings and explicit retry refreshes them", async () => {
 let status = "unavailable";
 const app = await mount({ discover: async () => ({ status, options: [] }) }), { page } = app;
 try {
  const music = page.locator('[data-screen-slot="3"]');
  await page.getByRole("button", { name: "Retry loading values" }).waitFor();
  assert.equal(await music.locator(".sp-screen-state select").inputValue(), "Music");
  assert.equal(app.writes.length, 0);
  status = "ready";
  await page.getByRole("button", { name: "Retry loading values" }).click();
  await page.getByText("This entity has no available values.", { exact: true }).waitFor();
  assert.equal(await music.locator('option[value="Music"]').textContent(), "Music (unavailable)");
  await music.getByRole("button", { name: "Remove mapping 1", exact: true }).click();
  await page.getByRole("button", { name: "Save screen settings", exact: true }).click();
  await page.getByText("Screen navigation saved.", { exact: true }).waitFor();
  assert.equal(app.settings.rules, "0\tHome");
 } finally { await page.close(); }
});

test("dragging routes to its own screen and a cross-screen drop cannot move cards", async () => {
 const app = await mount(), { page } = app;
 try {
  const music = page.locator('[data-screen-slot="3"] .sp-main');
  const weather = page.locator('[data-screen-slot="4"] .sp-main');
  async function drag(source, target) {
   const original = await source.elementHandle();
   const transfer = await page.evaluateHandle(() => new DataTransfer());
   await original.dispatchEvent("dragstart", { dataTransfer: transfer });
   const box = await target.boundingBox();
   await target.dispatchEvent("dragover", { dataTransfer: transfer, clientX: box.x + box.width / 2, clientY: box.y + box.height / 2 });
   await page.waitForTimeout(50);
   await target.dispatchEvent("drop", { dataTransfer: transfer });
   await original.dispatchEvent("dragend", { dataTransfer: transfer });
   await original.dispose();
   await transfer.dispose();
  }
  await drag(music.locator('[data-slot="1"]'), music.locator('[data-pos="1"]'));
  await page.waitForFunction(() => document.querySelector('[data-screen-slot="3"] [data-slot="1"]')?.getAttribute("data-pos") === "1");
  // The original source is detached by redraw; its native dragend cannot bubble to the grid.
  await weather.locator('[data-slot="1"]').click();
  assert.equal(await page.locator('[data-screen-slot="4"]').evaluate(el => el.classList.contains("sp-screen-active")), true);
  assert.equal(await weather.locator('[data-slot="1"]').evaluate(el => el.classList.contains("sp-selected")), true);
  const saved = app.document().subpages[3], other = app.document().subpages[4];
  await drag(music.locator('[data-slot="1"]'), weather.locator('[data-pos="1"]'));
  assert.equal(app.document().subpages[3], saved);
  assert.equal(app.document().subpages[4], other);
  assert.deepEqual(app.errors, []);
 } finally { await page.close(); }
});

test("a screen without a mapping keeps the value assigned to it", async () => {
 const app = await mount({ discover: async () => ({ status: "ready", options: ["Home", "Music", "Weather", "Rooms"] }) }), { page } = app;
 try {
  const weather = page.locator('[data-screen-slot="4"]');
  await weather.locator('select option[value="Weather"]').waitFor({ state: "attached" });
  await weather.locator(".sp-screen-state select").selectOption("Weather");
  await page.getByRole("button", { name: "Save screen settings", exact: true }).click();
  await page.getByText("Screen navigation saved.", { exact: true }).waitFor();
  assert.equal(app.settings.rules, "0\tHome\n3\tMusic\n4\tWeather");
  assert.deepEqual(app.errors, []);
 } finally { await page.close(); }
});

test("two screens without mappings each keep their own value", async () => {
 const app = await mount({ discover: async () => ({ status: "ready", options: ["Home", "Music", "Weather", "Rooms"] }) }), { page } = app;
 try {
  const rooms = page.locator('[data-screen-slot="2"]');
  const weather = page.locator('[data-screen-slot="4"]');
  await weather.locator('select option[value="Weather"]').waitFor({ state: "attached" });
  await weather.locator(".sp-screen-state select").selectOption("Weather");
  await rooms.locator(".sp-screen-state select").selectOption("Rooms");
  assert.equal(await weather.locator(".sp-screen-state select").inputValue(), "Weather", "the first screen keeps its value");
  await page.getByRole("button", { name: "Save screen settings", exact: true }).click();
  await page.getByText("Screen navigation saved.", { exact: true }).waitFor();
  assert.equal(app.settings.rules, "0\tHome\n3\tMusic\n4\tWeather\n2\tRooms");
  assert.deepEqual(app.errors, []);
 } finally { await page.close(); }
});

test("assigning a value that another screen already uses moves it instead of failing to save", async () => {
 const app = await mount(), { page } = app;
 try {
  const music = page.locator('[data-screen-slot="3"]');
  const weather = page.locator('[data-screen-slot="4"]');
  await weather.locator('select option[value="Music"]').waitFor({ state: "attached" });
  await weather.locator(".sp-screen-state select").selectOption("Music");
  assert.equal(await music.locator(".sp-screen-state select").inputValue(), "", "the value leaves the screen that held it");
  await page.getByRole("button", { name: "Save screen settings", exact: true }).click();
  await page.getByText("Screen navigation saved.", { exact: true }).waitFor();
  assert.equal(app.settings.rules, "0\tHome\n4\tMusic");
  assert.deepEqual(app.errors, []);
 } finally { await page.close(); }
});

test("an unfilled mapping row never blocks saving", async () => {
 const app = await mount(), { page } = app;
 try {
  const weather = page.locator('[data-screen-slot="4"]');
  await weather.getByRole("button", { name: "Add state value", exact: true }).click();
  await page.getByRole("button", { name: "Save screen settings", exact: true }).click();
  await page.getByText("Screen navigation saved.", { exact: true }).waitFor();
  assert.equal(app.settings.rules, "0\tHome\n3\tMusic");
  assert.deepEqual(app.errors, []);
 } finally { await page.close(); }
});

test("two screens fit side by side and each preview is wider than the old layout", async () => {
 const app = await mount(), { page } = app;
 try {
  const home = await page.locator('[data-screen-slot="0"]').boundingBox();
  const rooms = await page.locator('[data-screen-slot="2"]').boundingBox();
  assert.ok(home && rooms && rooms.x > home.x, "two screens share a row");
  // The preview used to render at the profile's fixed --screen-w (264px) and left
  // most of its column empty; it now fills the column and scales its cqw contents.
  const preview = await page.locator('[data-screen-slot="0"] .sp-screen').boundingBox();
  assert.ok(preview && preview.width > 400, `the preview fills its column, got ${preview?.width}`);
  assert.ok(preview.width <= home.width, "the preview stays inside its column");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.equal(overflow, 0, "the gallery adds no horizontal overflow");
  assert.deepEqual(app.errors, []);
 } finally { await page.close(); }
});
