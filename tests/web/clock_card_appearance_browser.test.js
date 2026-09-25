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
async function mount() {
  const page = await browser.newPage({ viewport: { width: 1200, height: 1000 } });
  page.setDefaultTimeout(5000);
  const errors = [], writes = [];
  const panel = { deviceProfile: profile, buttons: { 1: initialClock, 2: ";Rooms;Home;Auto;;;subpage" }, subpages: { 2: "~B,1|CK,,,,,,,,large_numbers=off" }, settings: { button_order: "1,2" } };
  let document = panel, generation = 1;
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.pathname === "/") return route.fulfill({ contentType: "text/html", body: '<!doctype html><html><body><esp-app></esp-app></body></html>' });
    if (url.pathname === "/api/v1/capabilities") return route.fulfill({ json: { api: { version: 1 }, configuration: { read: true, write: true, document_versions: [1] } } });
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
  await page.locator('.sp-screen-active .sp-main [data-slot="1"]').waitFor();
  return { page, errors, writes, document: () => document };
}
async function edit(page, slot = 1) {
  await page.locator(`.sp-screen-active .sp-main [data-slot="${slot}"]`).click();
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

for (const subpage of [false, true]) {
  test(`${subpage ? "subpage" : "main"}: real clock editor saves encoded formats and reopens the same native document`, async () => {
    const app = await mount(), { page } = app;
    try {
      if (subpage) await page.locator('.sp-screen-active .sp-main [data-slot="2"] .sp-subpage-badge').click();
      await edit(page);
      const prefix = subpage ? "sp-sp-inp-" : "sp-inp-";
      const font = page.locator(`#${prefix}clock-font`);
      assert.equal(await font.count(), 1, "clock font selector is present in the real editor");
      await font.selectOption("mono");
      await page.locator(`#${prefix}clock-time-format-preset`).selectOption("%H:%M:%S");
      await page.locator(`#${prefix}clock-date-format-preset`).selectOption("%Y-%m-%d");
      await page.locator(`#${prefix}clock-date-size`).selectOption("large");
      await page.locator(`#${prefix}date-time-text-size`).selectOption("medium");
      await save(page);
      assert.equal(app.writes.length, 1, "one accepted save persists the complete native document");
      const saved = await page.evaluate(({ document, subpage }) => {
        const codec = window.__ESPCONTROL_TEST_HOOKS__.config;
        return subpage ? codec.parseSubpageConfig(document.subpages[2]).buttons[0] : codec.parseButtonConfig(document.buttons[1]);
      }, { document: app.document(), subpage });
      assert.equal(saved.options, "large_numbers=off,text_size=medium,clock_font=mono,time_format=%25H%3A%25M%3A%25S,date_format=%25Y-%25m-%25d,date_size=large");
      const preview = page.locator('.sp-screen-active .sp-main [data-slot="1"]');
      assert.equal(await preview.locator(".sp-sensor-value").textContent(), "00:59:58");
      assert.equal(await preview.locator(".sp-clock-date").textContent(), "2027-01-01");
      const styles = await preview.evaluate(el => {
        const time = getComputedStyle(el.querySelector('.sp-sensor-value')), date = getComputedStyle(el.querySelector('.sp-clock-date'));
        return { timeFont: time.fontFamily, dateFont: date.fontFamily, timeWeight: time.fontWeight, dateSize: parseFloat(date.fontSize) };
      });
      assert.match(styles.timeFont, /mono/i);
      assert.equal(styles.dateFont, styles.timeFont);
      assert.ok(styles.dateSize > 0);
      await edit(page);
      assert.equal(await font.inputValue(), "mono");
      assert.equal(await page.locator(`#${prefix}clock-time-format-preset`).inputValue(), "%H:%M:%S");
      assert.equal(await page.locator(`#${prefix}clock-date-size`).inputValue(), "large");
      // Off hides the date but retains its explicit size for later re-enabling.
      await page.locator(`#${prefix}clock-date-format-preset`).selectOption("");
      await font.selectOption("");
      await page.locator(`#${prefix}clock-time-format-preset`).selectOption("");
      await page.locator(`#${prefix}date-time-text-size`).selectOption("");
      await save(page);
      assert.equal(await preview.locator('.sp-clock-date').count(), 0);
      assert.doesNotMatch(await preview.getAttribute('class'), /sp-clock-font-|sp-date-time-text-/);
      await edit(page);
      assert.equal(await page.locator(`#${prefix}clock-date-size`).inputValue(), "large");
      assert.deepEqual(app.errors, []);
    } finally { await page.close(); }
  });
}

test("custom clock drafts do not reset saved values; invalid formats visibly block the real Save path", async () => {
  const app = await mount(), { page } = app;
  try {
    await edit(page);
    const preset = page.locator("#sp-inp-clock-time-format-preset"), input = page.locator("#sp-inp-clock-time-format");
    assert.equal(await preset.count(), 1, "clock formats are editable");
    await preset.selectOption("%H:%M:%S");
    await save(page);
    await edit(page);
    await preset.selectOption("__custom");
    assert.equal(await input.inputValue(), "%H:%M:%S", "Custom opens the current value without clearing it");
    assert.equal(await input.getAttribute("maxlength"), "32");
    await input.fill("%A");
    assert.equal(await input.getAttribute("aria-invalid"), "true");
    const before = app.writes.length;
    await page.locator(".sp-settings-modal .sp-save-btn").click();
    assert.equal(app.writes.length, before, "invalid draft never reaches native persistence");
    assert.equal(await page.locator(".sp-settings-overlay.sp-visible").count(), 1);
    assert.equal(await input.inputValue(), "%A");
    assert.ok(await page.locator(".sp-settings-modal [role=alert]").filter({ hasText: /format|token|32/i }).count());
    // A size change rebuilds the editor; it must not silently drop an invalid draft.
    await page.locator("#sp-inp-date-time-text-size").selectOption("large");
    assert.equal(await input.inputValue(), "%A");
    await page.locator(".sp-settings-modal .sp-save-btn").click();
    assert.equal(app.writes.length, before);
    await preset.selectOption("%I:%M");
    await save(page);
    await edit(page);
    await preset.selectOption("__custom");
    await input.fill(" %H ");
    await save(page);
    assert.match(app.document().buttons[1], /time_format= %25H $/, "last option preserves trailing ASCII space through the full codec");
    await edit(page);
    assert.equal(await input.inputValue(), " %H ");
    assert.deepEqual(app.errors, []);
  } finally { await page.close(); }
});

test("clock seconds refresh without rebuilding the editor or discarding an invalid custom draft", async () => {
  const app = await mount(), { page } = app;
  try {
    await edit(page);
    await page.locator("#sp-inp-clock-time-format-preset").selectOption("%H:%M:%S");
    await page.locator("#sp-inp-clock-date-format-preset").selectOption("%Y-%m-%d");
    await page.locator("#sp-inp-clock-time-format-preset").selectOption("__custom");
    await page.locator("#sp-inp-clock-time-format").fill("%A");
    await page.evaluate(() => { window.clockDraftInput = document.querySelector('#sp-inp-clock-time-format'); });
    await page.clock.setFixedTime(new Date("2027-01-01T00:00:01Z"));
    await page.waitForFunction(() => document.querySelector('.sp-screen-active .sp-main [data-slot="1"] .sp-sensor-value').textContent === '01:00:01');
    assert.equal(await page.evaluate(() => window.clockDraftInput === document.querySelector('#sp-inp-clock-time-format')), true);
    assert.equal(await page.locator("#sp-inp-clock-time-format").inputValue(), "%A");
    assert.equal(await page.locator("#sp-inp-clock-time-format").getAttribute("aria-invalid"), "true");
    assert.equal(app.writes.length, 0);
    assert.deepEqual(app.errors, []);
  } finally { await page.close(); }
});

test("clock custom 32-character lines shrink to fit; font and date-size choices affect both lines", async () => {
  const app = await mount(), { page } = app;
  try {
    await edit(page);
    await page.locator("#sp-inp-clock-date-format-preset").selectOption("%d.%m.%Y");
    const preview = page.locator('.sp-screen-active .sp-main [data-slot="1"]');
    for (const [font, weight] of [["thin", "100"], ["bold", "700"], ["mono", "400"]]) {
      await page.locator("#sp-inp-clock-font").selectOption(font);
      const actual = await preview.evaluate(el => ['.sp-sensor-value', '.sp-clock-date'].map(selector => {
        const style = getComputedStyle(el.querySelector(selector)); return { weight: style.fontWeight, family: style.fontFamily };
      }));
      assert.equal(actual[0].weight, weight);
      assert.equal(actual[1].weight, weight);
      assert.equal(actual[0].family, actual[1].family);
    }
    let previousSize = 0;
    for (const size of ["small", "medium", "large"]) {
      await page.locator("#sp-inp-clock-date-size").selectOption(size);
      const actual = await preview.locator('.sp-clock-date').evaluate(el => parseFloat(getComputedStyle(el).fontSize));
      assert.ok(actual > previousSize, `${size} date is larger than preceding size`);
      previousSize = actual;
    }
    for (const part of ["time", "date"]) {
      await page.locator(`#sp-inp-clock-${part}-format-preset`).selectOption("__custom");
      await page.locator(`#sp-inp-clock-${part}-format`).fill("8".repeat(32));
    }
    const bounds = await preview.evaluate(el => {
      const box = el.getBoundingClientRect();
      return ['.sp-sensor-value', '.sp-clock-date'].map(selector => {
        const text = el.querySelector(selector), range = document.createRange(); range.selectNodeContents(text);
        const content = range.getBoundingClientRect();
        return { fits: content.left >= box.left && content.right <= box.right + 1 && content.bottom <= box.bottom + 1, font: parseFloat(getComputedStyle(text).fontSize) };
      });
    });
    assert.equal(bounds[0].fits, true, "all 32 time digits remain inside the card");
    assert.equal(bounds[1].fits, true, "all 32 date digits remain inside the card");
    assert.ok(bounds[0].font > 0 && bounds[1].font > 0);
    assert.deepEqual(app.errors, []);
  } finally { await page.close(); }
});

test("two valid bounded clock formats cannot bypass the existing 255-byte main-card save limit", async () => {
  const app = await mount(), { page } = app;
  try {
    await edit(page);
    assert.equal(await page.locator("#sp-inp-clock-font").count(), 1);
    await page.locator("#sp-inp-clock-font").selectOption("mono");
    for (const part of ["time", "date"]) {
      await page.locator(`#sp-inp-clock-${part}-format-preset`).selectOption("__custom");
      await page.locator(`#sp-inp-clock-${part}-format`).fill("%H" + ":".repeat(30));
      assert.equal(await page.locator(`#sp-inp-clock-${part}-format`).evaluate(el => el.checkValidity()), true);
    }
    await page.locator(".sp-settings-modal .sp-save-btn").click();
    assert.equal(app.writes.length, 0);
    assert.equal(await page.locator(".sp-settings-overlay.sp-visible").count(), 1);
    assert.equal(await page.getByText("Card settings are too large to save. Shorten confirmation text, labels, or entity IDs.", { exact: true }).isVisible(), true);
    // Independently counted ASCII payloads: 256 rejects; exactly 255 saves.
    await page.locator("#sp-inp-clock-date-format").fill("%H" + ":".repeat(26));
    await page.locator(".sp-settings-modal .sp-save-btn").click();
    assert.equal(app.writes.length, 0, "256 bytes still rejects without truncating");
    await page.locator("#sp-inp-clock-date-format").fill("%H" + ":".repeat(25) + "11");
    await save(page);
    assert.equal(app.writes.length, 1);
    assert.equal(app.document().buttons[1].length, 255);
    await edit(page);
    assert.equal(await page.locator("#sp-inp-clock-time-format").inputValue(), "%H" + ":".repeat(30));
    assert.equal(await page.locator("#sp-inp-clock-date-format").inputValue(), "%H" + ":".repeat(25) + "11");
    assert.deepEqual(app.errors, []);
  } finally { await page.close(); }
});
