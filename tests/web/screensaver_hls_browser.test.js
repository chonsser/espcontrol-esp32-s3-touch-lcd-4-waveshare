"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { buildSync } = require("esbuild");
const { chromium } = require("playwright");

let browser, bundle;
test.before(async () => {
  bundle = buildSync({
    stdin: { resolveDir: path.resolve(__dirname, "../.."), contents: `
      import { initializeDeviceConfig } from './src/webserver/device_config';
      import { initializeAppState, state } from './src/webserver/state/app_instance';
      import { createScreensaverHlsFeature } from './src/webserver/application/screensaver_hls';
      initializeDeviceConfig();
      let savedUrl = 'http://video.test/old.m3u8';
      window.mountHls = async () => {
        initializeAppState();
        const pending = [], writes = [], banners = [];
        const select = document.createElement('select');
        select.innerHTML = '<option value="off">Off</option><option value="clock">Clock</option>';
        const feature = createScreensaverHlsFeature({ els: { setClockSelect: select } }, {
          entityDetailPaths: domain => [domain],
          getJsonFirst: async paths => paths[0] === 'select'
            ? { value: 'Display Off', option: ['Display Off', 'Clock', 'HLS Stream'] } : { value: savedUrl },
          postTextWithObjectIds: (name, ids, value) => new Promise(resolve => {
            writes.push([name, value]);
            pending.push(ok => { if (ok) savedUrl = value; resolve({ ok }); });
          }),
          postSelect: async () => ({ ok: false }),
        }, { entityName: name => name, entityObjectIds: name => [name] },
        { showBanner: message => banners.push(message) }, () => {});
        document.body.replaceChildren(select, feature.buildControls());
        await feature.load();
        window.hlsWrites = () => writes;
        window.hlsConfirmed = () => state.screensaverHlsUrl;
        window.hlsBanners = () => banners;
        window.hlsStatus = value => feature.applyStatus({ value });
        window.settleHls = (index, ok) => {
          pending[index](ok);
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

test("HLS saves only on confirmation and preserves drafts through failures and status updates", async () => {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  try {
    await page.addScriptTag({ content: bundle });
    await page.evaluate(() => window.mountHls());
    const input = page.locator("#sp-set-hls-url");
    const save = page.getByRole("button", { name: "Save", exact: true });
    assert.equal(await input.inputValue(), "http://video.test/old.m3u8");
    await input.fill("rtsp://camera/live");
    await save.click();
    assert.equal(await input.evaluate(input => input.validity.valid), false);
    assert.deepEqual(await page.evaluate(() => window.hlsWrites()), []);
    await input.fill("http://video.test/first.m3u8");
    await input.blur();
    assert.deepEqual(await page.evaluate(() => window.hlsWrites()), [], "blur never posts a draft");
    await save.click();
    assert(await save.isDisabled());
    await input.fill("http://video.test/newer.m3u8");
    await page.evaluate(() => window.hlsStatus("Playing"));
    assert.equal(await input.inputValue(), "http://video.test/newer.m3u8");
    await page.evaluate(() => window.settleHls(0, false));
    assert.equal(await input.inputValue(), "http://video.test/newer.m3u8", "failed save keeps newer draft");
    assert.equal(await page.evaluate(() => window.hlsConfirmed()), "http://video.test/old.m3u8");
    assert.equal((await page.evaluate(() => window.hlsBanners())).length, 1);
    await save.click();
    await input.fill("http://video.test/unsaved.m3u8");
    await page.evaluate(() => window.settleHls(1, true));
    assert.equal(await input.inputValue(), "http://video.test/unsaved.m3u8", "successful older save also keeps newer draft");
    assert.equal(await page.evaluate(() => window.hlsConfirmed()), "http://video.test/newer.m3u8");
    await page.evaluate(() => window.mountHls());
    assert.equal(await input.inputValue(), "http://video.test/newer.m3u8", "reopening loads saved device state, not unsaved draft");
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});
