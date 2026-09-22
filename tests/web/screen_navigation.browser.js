"use strict";
const assert = require("node:assert/strict");
const { chromium } = require("playwright");
const { buildSync } = require("esbuild");
const path = require("node:path");

const script = buildSync({ stdin: { contents: `
import { createScreenNavigationFeature } from "./src/webserver/application/screen_navigation";
import { createControlsFieldsFeature } from "./src/webserver/application/controls_fields";
window.start = (unsupported = false) => {
  window.saved = { entity: "input_select.screen", rules: "0\\tHome", wake: true };
  window.posts = [];
  window.reads = 0;
  const fields = createControlsFieldsFeature({ definitions: {} }, {}, {
    createDisclosureChevron() { return document.createElement("span"); }
  }, {});
  window.navigation = createScreenNavigationFeature({ document,
    fields, buttons: () => [{ type: "switch", label: "Lights" }, { type: "subpage", label: "Media" }],
    entityState: { entityName: key => key, entityInput: (id, value, placeholder) => {
      const input = document.createElement("input"); input.id = id; input.value = value; input.placeholder = placeholder; return input;
    } },
    deviceApi: { getJson: async url => {
      window.reads++;
      if (window.readDelay) await new Promise(resolve => { window.resumeRead = resolve; });
      if (unsupported) return { ok: false, status: 404, kind: "http-error" };
      const key = url.split("screen_navigation_")[1].split("?")[0];
      return { ok: true, value: { value: window.saved[key] } };
    } },
    requestApi: { entityDetailPath: (domain, name) => "/" + domain + "/" + name,
      postText: async (name, value) => { const key = name.replace("screen_navigation_", ""); window.saved[key] = value; window.posts.push([key, value]); return { ok: true }; },
      postSwitch: async (name, value) => { window.saved.wake = value; window.posts.push(["wake", value]); return { ok: true }; },
    },
  });
  document.body.append(window.navigation.buildCard());
};`, resolveDir: path.resolve(__dirname, "../.."), loader: "ts" }, bundle: true, write: false, format: "iife", platform: "browser" }).outputFiles[0].text;

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent("<!DOCTYPE html><body></body>");
    await page.addScriptTag({ content: script });
    await page.evaluate(() => window.start());
    assert.equal(await page.evaluate(() => window.reads), 0, "no new startup requests");
    await page.getByText("Screen from Home Assistant", { exact: true }).click();
    await page.waitForFunction(() => document.querySelector("#sp-set-screen-navigation-entity")?.value === "input_select.screen");
    await page.locator("#sp-set-screen-navigation-entity").fill("input_select.aktualny_ekran");
    await page.getByRole("button", { name: "Add mapping", exact: true }).click();
    await page.getByLabel("State value 2", { exact: true }).fill("Muzyka");
    await page.getByLabel("Screen 2", { exact: true }).selectOption("2");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await page.getByText("Screen navigation saved.", { exact: true }).waitFor();
    assert.deepEqual(await page.evaluate(() => window.posts), [["entity", ""], ["rules", "0\tHome\n2\tMuzyka"], ["wake", true], ["entity", "input_select.aktualny_ekran"]]);
    await page.evaluate(() => window.navigation.load());
    assert.equal(await page.getByLabel("State value 2", { exact: true }).inputValue(), "Muzyka", "reload retains saved mapping");
    await page.locator("#sp-set-screen-navigation-entity").fill("input_select.BAD NAME");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await page.getByText("Enter a valid Home Assistant entity ID, such as input_select.screen.", { exact: true }).waitFor();
    assert.equal((await page.evaluate(() => window.posts)).length, 4, "invalid entity cannot be saved");
    await page.locator("#sp-set-screen-navigation-entity").fill("input_select.aktualny_ekran");
    await page.getByLabel("State value 2", { exact: true }).fill("Home");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await page.getByText("Each state value can only be mapped once.", { exact: true }).waitFor();
    await page.getByLabel("State value 2", { exact: true }).fill("ą".repeat(130));
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await page.getByText("The screen mappings are too long. Shorten the values or remove a mapping.", { exact: true }).waitFor();
    await page.evaluate(() => window.navigation.load());
    assert.equal(await page.getByLabel("State value 2", { exact: true }).inputValue(), "ą".repeat(130), "a load cannot replace unsaved text");
    const old = await browser.newPage();
    await old.setContent("<!DOCTYPE html><body></body>");
    await old.addScriptTag({ content: script });
    await old.evaluate(() => window.start(true));
    await old.getByText("Screen from Home Assistant", { exact: true }).click();
    await old.getByText("Update the panel firmware to use screen navigation from Home Assistant.", { exact: true }).waitFor();
    assert.equal(await old.getByRole("button", { name: "Save", exact: true }).isDisabled(), true);
    console.log("Screen navigation browser checks passed: explicit save/reload, duplicate and length errors, preserved drafts, old firmware.");
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
