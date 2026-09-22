"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { buildSync } = require("esbuild");
const { chromium } = require("playwright");

let browser;
let bundle;
test.before(async () => {
  const root = path.resolve(__dirname, "../..");
  bundle = buildSync({
    stdin: { resolveDir: root, contents: `
      import { initializeDeviceConfig } from './src/webserver/device_config';
      import { initializeAppState, state } from './src/webserver/state/app_instance';
      import { createScreensaverClockFormatFeature } from './src/webserver/application/screensaver_clock_format';
      import { createControlsFieldsFeature } from './src/webserver/application/controls_fields';
      import { createCardRegistry } from './src/webserver/application/card_registry';
      import { createConfigSensorOptionsFeature } from './src/webserver/application/config_sensor_options';
      initializeDeviceConfig();
      window.mountClockFormats = () => {
        initializeAppState();
        const pending = [], writes = [];
        const post = (name, value) => new Promise((resolve, reject) => {
          writes.push([name, value]); pending.push({ resolve, reject });
        });
        const feature = createScreensaverClockFormatFeature({ els: {} }, {
          getJsonFirst: async () => null, entityDetailPaths: () => [], postText: post, postSelect: post,
        }, { entityName: name => name }, { showBanner() {} });
        feature.applyState('timeFormat', { value: '%H:%M', max_length: 32 });
        feature.applyState('dateFormat', { value: '%d.%m.%Y', max_length: 32 });
        const registry = createCardRegistry();
        const fields = createControlsFieldsFeature(registry, createConfigSensorOptionsFeature(registry), {}, {});
        document.body.replaceChildren(feature.buildControls(fields));
        window.clockWrites = () => writes;
        window.clockConfirmed = key => state[key === 'time' ? 'screensaverClockTimeFormat' : 'screensaverClockDateFormat'];
        window.settleClockWrite = (index, reject = false) => {
          if (reject) pending[index].reject(new Error('Transport failed'));
          else pending[index].resolve({ ok: true });
          // Cross one task boundary so all promise handlers and unhandled-rejection
          // events have run before checking the real controls and page errors.
          return new Promise(resolve => setTimeout(resolve, 0));
        };
      };
    ` },
    define: {
      __ESPCONTROL_DEFAULT_DEVICE_ID__: '"test"',
      __ESPCONTROL_DEVICE_PROFILES__: '{"test":{"slots":1}}',
      __ESPCONTROL_TIMEZONE_OPTIONS__: '[]',
    },
    bundle: true, write: false, format: "iife", platform: "browser",
  }).outputFiles[0].text;
  browser = await chromium.launch({ headless: true });
});
test.after(async () => { if (browser) await browser.close(); });

for (const key of ["time", "date"]) {
  async function mount() {
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.addScriptTag({ content: bundle });
    await page.evaluate(() => window.mountClockFormats());
    const preset = page.locator(`#sp-set-clock-${key}-format-preset`);
    const input = page.locator(`#sp-set-clock-${key}-format`);
    await preset.selectOption("__custom");
    return { page, preset, input, errors };
  }

  test(`${key}: an older successful save cannot discard a newer custom draft`, async () => {
    const { page, input, errors } = await mount();
    try {
      await input.fill("%H:%M:%S");
      await input.blur();
      assert.equal((await page.evaluate(() => window.clockWrites())).length, 1);
      await input.fill("%I:%M:%S");
      await page.evaluate(() => window.settleClockWrite(0));
      assert.equal(await input.inputValue(), "%I:%M:%S", "pending save keeps the newer unsaved draft");
      await input.blur();
      assert.equal((await page.evaluate(() => window.clockWrites()))[1][1], "%I:%M:%S", "newer draft remains dirty and can be saved");
      await page.evaluate(() => window.settleClockWrite(1));
      assert.equal(await page.evaluate(key => window.clockConfirmed(key), key), "%I:%M:%S");
      assert.deepEqual(errors, []);
    } finally { await page.close(); }
  });

  test(`${key}: choosing a preset while a custom save is pending keeps the new choice`, async () => {
    const { page, preset, input, errors } = await mount();
    const chosen = key === "time" ? "%I:%M" : "%Y-%m-%d";
    try {
      await input.fill("%H:%M:%S");
      await input.blur();
      await preset.selectOption(chosen);
      await page.evaluate(() => window.settleClockWrite(0));
      assert.equal(await preset.inputValue(), chosen, "older save cannot revert a pending preset choice");
      await page.evaluate(() => window.settleClockWrite(1));
      assert.equal(await preset.inputValue(), chosen);
      assert.equal(await input.isVisible(), false);
      assert.equal(await page.evaluate(key => window.clockConfirmed(key), key), chosen);
      assert.deepEqual(errors, []);
    } finally { await page.close(); }
  });

  test(`${key}: rejected saves preserve newer drafts without an unhandled rejection`, async () => {
    const { page, input, errors } = await mount();
    try {
      await input.fill("%H:%M:%S");
      await input.blur();
      await input.fill("%I:%M:%S");
      await page.evaluate(() => window.settleClockWrite(0, true));
      assert.equal(await input.inputValue(), "%I:%M:%S");
      await input.blur();
      assert.equal((await page.evaluate(() => window.clockWrites()))[1][1], "%I:%M:%S");
      await page.evaluate(() => window.settleClockWrite(1));
      assert.deepEqual(errors, [], "UI handles rejected device writes");
    } finally { await page.close(); }
  });
}
