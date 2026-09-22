"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");

test("actual Date & Time editors save each requested size and Auto removes only that option", async () => {
  const path = require("node:path");
  const { buildSync } = require("esbuild");
  const { chromium } = require("playwright");
  const root = path.resolve(__dirname, "../..");
  const bundle = buildSync({
    stdin: { resolveDir: root, contents: `
      import { createCardRegistry } from './src/webserver/application/card_registry';
      import { createConfigSensorOptionsFeature } from './src/webserver/application/config_sensor_options';
      import { createConfigDateTimeOptionsFeature } from './src/webserver/application/config_date_time_options';
      import { createControlsFieldsFeature } from './src/webserver/application/controls_fields';
      import { registerCalendarCardTypes } from './src/webserver/cards/calendar';
      import { registerClockCardTypes } from './src/webserver/cards/clock';
      import { registerTimezoneCardTypes } from './src/webserver/cards/timezone';
      import { createWebStyles } from './src/webserver/application/styles';
      const style = document.createElement('style'); style.textContent = createWebStyles(false); document.head.appendChild(style);
      window.mountDateTimeCard = (type) => {
        const registry = createCardRegistry();
        const sizes = createConfigDateTimeOptionsFeature({ state: { clockFormat:'24h' }, now:()=>new Date('2026-12-31T23:59:00Z'), renderButtonSettings(){}, effectiveTimezoneOption:v=>v, timezoneId:()=> 'UTC', timezoneOptionsWithFallback:()=>['UTC'], appendTimezoneOption(){}, monthNameForIndex:()=> 'December' });
        const fields = createControlsFieldsFeature(registry, createConfigSensorOptionsFeature(registry), {}, {});
        registerCalendarCardTypes(registry, sizes, fields);
        registerClockCardTypes(registry, sizes, fields);
        registerTimezoneCardTypes(registry, sizes, document, fields);
        const button = { type, precision:type==='calendar'?'datetime':'', options:'large_numbers=off' };
        const saves = [];
        const helpers = { ...fields, idPrefix:'card-', cardSize:'large', saveField:(name,value)=>saves.push([name,value]), escHtml:v=>String(v) };
        document.body.innerHTML = '<div id="editor"></div>';
        registry.definitions[type].renderSettings(document.getElementById('editor'), button, null, helpers);
        window.readDateTimeCard = () => ({ button, saves, preview:registry.definitions[type].renderPreview(button, helpers) });
        window.measureDateTimeCard = (width = 400, height = 180) => {
          document.getElementById('preview')?.remove();
          const preview = registry.definitions[type].renderPreview(button, helpers);
          const el = document.createElement('div'); el.id = 'preview';
          el.className = 'sp-btn sp-btn-big ' + (preview.buttonClass || '');
          el.style.cssText = 'width:' + width + 'px;height:' + height + 'px;--btn-icon:40px;--btn-label:20px;--btn-pad:0px;--btn-border:0px;--btn-label-max-height:48px;';
          el.innerHTML = preview.iconHtml + preview.labelHtml; document.body.appendChild(el);
          const value = el.querySelector('.sp-sensor-value'); const box = value.getBoundingClientRect();
          const parent = el.getBoundingClientRect(); const caption = el.querySelector('.sp-btn-label');
          return { font:parseFloat(getComputedStyle(value).fontSize), fits:box.right <= parent.right + 1 && box.bottom <= (caption ? caption.getBoundingClientRect().top : parent.bottom) + 1 };
        };
      };
    ` }, bundle: true, write: false, format: "iife", platform: "browser",
  }).outputFiles[0].text;
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.addScriptTag({ content: bundle });
    for (const type of ["calendar", "clock", "timezone"]) {
      await page.evaluate(type => window.mountDateTimeCard(type), type);
      const select = page.locator('#card-date-time-text-size');
      assert.equal(await select.count(), 1, `${type} has its own size selector`);
      assert.equal(await select.inputValue(), "");
      let previousFont = 0;
      for (const size of ["small", "medium", "large"]) {
        await select.selectOption(size);
        const result = await page.evaluate(() => window.readDateTimeCard());
        assert.equal(result.button.options, `large_numbers=off,text_size=${size}`);
        assert.deepEqual(result.saves.at(-1), ["options", `large_numbers=off,text_size=${size}`]);
        assert.match(result.preview.buttonClass, new RegExp(`sp-date-time-text-${size}`));
        const measure = await page.evaluate(() => window.measureDateTimeCard());
        assert.ok(measure.font > previousFont, `${type} ${size} is larger than preceding size`);
        assert.equal(measure.fits, true, `${type} ${size} fits above its caption`);
        previousFont = measure.font;
      }
      assert.equal((await page.evaluate(() => window.measureDateTimeCard(70, 80))).fits, true, `${type} shrinks inside a narrow card`);
      await select.selectOption("");
      const result = await page.evaluate(() => window.readDateTimeCard());
      assert.equal(result.button.options, "large_numbers=off");
      assert.equal(result.preview.buttonClass, undefined);
    }
  } finally { await browser.close(); }
});
