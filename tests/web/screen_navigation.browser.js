"use strict";
const assert = require("node:assert/strict");
const { chromium } = require("playwright");
const { buildSync } = require("esbuild");
const path = require("node:path");
const script = buildSync({ stdin: { contents: `
import { createScreenNavigationFeature } from "./src/webserver/application/screen_navigation";
import { createScreenNavigationEditor, resetNativeSubpageAuthority } from "./src/webserver/application/screen_navigation_editor";
import { createControlsFieldsFeature } from "./src/webserver/application/controls_fields";
import { createControlsShellFeature } from "./src/webserver/application/controls_shell";
import { createConfigCodecFeature } from "./src/webserver/application/config_codec";
import { createConfigPersistenceFeature } from "./src/webserver/application/config_post_api";
import { NativePanelConfigController } from "./src/webserver/controllers/native_panel_config_controller";
import { initializeDeviceConfig } from "./src/webserver/device_config";
import { initializeAppState, state } from "./src/webserver/state/app_instance";
import { encodePanelConfig, decodePanelConfig } from "./src/webserver/model";
import { requestWebLocale } from "./src/webserver/i18n";
import { webLocaleReloadAllowed } from "./src/webserver/application/language_state";
import { createWebStyles } from "./src/webserver/application/styles";
window.start = async (options = {}) => {
  Object.assign(window, { __ESPCONTROL_DEFAULT_DEVICE_ID__: "test", __ESPCONTROL_DEVICE_PROFILES__: { test: { slots: 4, cols: 2, rows: 2, screen: {} } }, __ESPCONTROL_TIMEZONE_OPTIONS__: [] });
  await initializeDeviceConfig(); initializeAppState();
  const empty = type => ({ type, label: "Lights", entity: "light.room", icon: "Auto", icon_on: "Auto", sensor: "", unit: "", precision: "", options: "" });
  state.buttons = [empty("switch"), empty("subpage"), empty("switch"), empty("switch")];
  state.grid = [1,2,3,4]; state.sizes = {};
  window.state = state;
  window.requestLocale = () => requestWebLocale("pl", webLocaleReloadAllowed); window.localeAllowed = webLocaleReloadAllowed;
  window.saved = { entity: "input_select.screen", rules: "0\\tHome\\n2\\tMedia\\n2\\tRadio", wake: true };
  window.server = { deviceProfile: "test", buttons: {1:"light.room",2:"|||subpage"}, subpages: {}, settings: { button_order: "1,2,3,4" } };
  if (options.rules) window.saved.rules = options.rules;
  if (options.subpages) window.server.subpages = options.subpages;
  window.posts = []; window.puts = []; window.errors = [];
  let generation = 1;
  const native = new NativePanelConfigController({
    deviceProfile: () => "test", slotCount: () => 4, entityName: x => x, entityNameForSlot: (x,s) => x+s,
    normalizeHexColor: x => x, showBanner: x => window.errors.push(x), delay: setTimeout,
    fetch: async (url, request) => {
      const response = (status, json, bytes) => ({ ok: status < 300, status, headers: { get: () => String(generation) }, json: async () => json, arrayBuffer: async () => bytes.buffer });
      if (url.includes("capabilities")) return response(200, { configuration: { read: true, write: true, document_versions: [1] } });
      if (request?.method === "PUT") {
        if (window.holdPut) await new Promise(resolve => { window.resumePut = resolve; });
        const next = decodePanelConfig(request.body); window.puts.push(next); window.server = next; generation++;
        return response(window.mirrorFailure ? 202 : 204);
      }
      return response(200, null, encodePanelConfig(window.server));
    },
  });
  const api = { postQueue: Promise.resolve(), postQueueError: false };
  const persistence = createConfigPersistenceFeature(native, { pendingSliderSubpageMigrations: {} }, { config: { features: { subpageConfigChunks: 8 } } }, { entityName: x => x, entityNameForSlot: (x,s) => x+s, hasRememberedPostPath: () => false }, { showBanner: x => window.errors.push(x) });
  const runtime = { els: {} };
  let navigation;
  const render = () => {
    navigation?.sync();
    const sp = state.editingSubpage ? codec.getSubpage(state.editingSubpage) : null;
    const grid = sp ? sp.grid : state.grid;
    const target = document.querySelector(".sp-screen-active .sp-main") || runtime.els.previewMain;
    if (target) { target.style.cssText = "display:grid;grid-template-columns:repeat(2,1fr);gap:10px;padding:16px";
      target.replaceChildren(...grid.map(slot => { const cell = document.createElement("div"); cell.className = "fixture-cell"; cell.style.cssText = "background:#2e2e32;border-radius:12px;padding:28px;color:#ddd;text-align:center"; cell.textContent = slot === -1 ? "Back" : slot ? "Card " + slot : "+"; return cell; })); }
    navigation?.sync();
  };
  const codec = createConfigCodecFeature({ definitions: {} }, {}, {}, { connectSubpageParser() {} }, {}, {}, {}, {}, {}, {}, {}, {}, { numSlots: 4, gridCols: 2 }, persistence, { schedule: render }, { renderPreview: render, renderButtonSettings() {} });
  persistence.connectCodec(codec); persistence.connectRequestApi(api);
  window.codec = codec; window.persistence = persistence;
  window.restoreNative = async subpages => {
    const restored = { ...window.server, subpages };
    await native.writeDocument(restored);
    resetNativeSubpageAuthority(state, restored.subpages, 4);
    state.subpages = {};
    for (const [slot, raw] of Object.entries(restored.subpages)) {
      state.subpages[slot] = codec.parseSubpageConfig(raw); codec.buildSubpageGrid(state.subpages[slot]);
    }
    render();
  };
  const fields = createControlsFieldsFeature({ definitions: {} }, {}, { createDisclosureChevron() { return document.createElement("span"); } }, {});
  const completed = options.delayed ? new Promise(resolve => window.completeLoad = resolve) : Promise.resolve();
  const editor = createScreenNavigationEditor({ state, maxSlots: () => 4, native, codec,
    whenComplete: () => completed,
    capabilities: async () => !options.unsupported,
    readDocument: async () => encodePanelConfig(window.server), queueIdle: () => api.postQueue,
    create: slot => persistence.createStandaloneScreen(slot),
    select: slot => slot ? codec.enterSubpage(slot) : codec.exitSubpage(), render,
    confirm: message => { window.confirmation = message; return window.confirmDelete !== false; },
  });
  navigation = createScreenNavigationFeature({ document, fields, editor, buttons: () => state.buttons,
    entityState: { entityName: key => key, entityInput: (id, value, placeholder) => { const input = document.createElement("input"); input.id = id; input.value = value; input.placeholder = placeholder; return input; } },
    deviceApi: { getJson: async url => {
      if (url.includes("/screen-navigation/options")) return { ok: true, value: { entity_id: new URL(url, "http://test").searchParams.get("entity_id"), status: "ready", options: ["Home", "Media", "Radio", "Radio draft", "Music"] } };
      if (window.readDelay) await new Promise(resolve => { window.resumeRead = resolve; });
      if (options.unsupportedMapping) return { ok: false, status: 404 };
      const key = url.split("screen_navigation_")[1].split("?")[0]; return { ok: true, value: { value: window.saved[key] } };
    } },
    requestApi: { entityDetailPath: (domain,name) => "/"+domain+"/"+name,
      postText: async (name,value) => { const key = name.replace("screen_navigation_", ""); window.saved[key] = value; window.posts.push([key,value]); return { ok: true }; },
      postSwitch: async (name,value) => { window.saved.wake=value; window.posts.push(["wake",value]); return { ok: true }; },
    },
  });
  window.navigation = navigation; window.editor = editor;
  const shell = createControlsShellFeature(runtime, { document, state, buildScreenToolbar: navigation.buildToolbar, buildScreenSettings: navigation.buildCard, buildScreenOverview: navigation.buildOverview, closeSettings() {} });
  const root = document.createElement("main"); root.id = "sp-app"; document.body.append(root);
  shell.buildScreenPage(root); runtime.els.screenPage.classList.add("active");
  const settings = document.createElement("div"); settings.id = "sp-settings"; root.append(settings);
  const style = document.createElement("style"); style.textContent = createWebStyles(false) + "#sp-app{padding:20px;max-width:720px}.sp-wrap{max-width:400px;margin:auto}.sp-screen{background:#101014;width:400px;height:280px;position:relative}.sp-main{position:static!important;height:230px!important}.sp-topbar{min-height:32px}"; document.head.append(style);
  render();
};`, resolveDir: path.resolve(__dirname, "../.."), loader: "ts" }, bundle: true, write: false, format: "iife", platform: "browser" }).outputFiles[0].text;

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    async function fixture(options = {}) {
      const page = await browser.newPage({ viewport: { width: 1000, height: 1000 } });
      page.setDefaultTimeout(8000);
      page.on("pageerror", error => { console.error(error); });
      await page.route("http://screen.test/**", route => route.fulfill({ contentType: "text/html", body: "<!DOCTYPE html><body></body>" }));
      await page.goto("http://screen.test/"); await page.addScriptTag({ content: script });
      await page.evaluate(options => window.start(options), options); return page;
    }
    const raw = await fixture({ subpages: { 1: "@screen:Room%20A\n" } });
    await raw.waitForFunction(() => !document.querySelector("#sp-screen-add").disabled);
    await raw.locator('[data-screen-slot="1"]').getByLabel("Screen name", { exact: true }).fill("New name");
    await raw.locator('[data-screen-slot="1"]').getByRole("button", { name: "Rename", exact: true }).click();
    await raw.waitForFunction(() => window.server.subpages[1] === "@screen:New name\n");
    await raw.evaluate(async () => { await window.restoreNative({ 1: "@screen:Restored%20name\n" }); });
    await raw.locator('[data-screen-slot="1"]').getByLabel("Screen name", { exact: true }).fill("After restore");
    await raw.locator('[data-screen-slot="1"]').getByRole("button", { name: "Rename", exact: true }).click();
    await raw.waitForFunction(() => window.server.subpages[1] === "@screen:After restore\n");
    await raw.evaluate(async () => {
      window.state.subpages[1].screenLabel = "Generic save";
      await window.persistence.saveSubpageEntity(1);
      window.navigation.sync();
    });
    await raw.locator('[data-screen-slot="1"]').getByLabel("Screen name", { exact: true }).fill("After generic save");
    await raw.locator('[data-screen-slot="1"]').getByRole("button", { name: "Rename", exact: true }).click();
    await raw.waitForFunction(() => window.server.subpages[1] === "@screen:After generic save\n");
    await raw.locator('[data-screen-slot="1"]').getByRole("button", { name: "Delete screen", exact: true }).click();
    await raw.waitForFunction(() => !window.server.subpages[1]);
    const authority = await fixture({ subpages: { 1: "@screen:Native screen\n" } });
    await authority.waitForFunction(() => !document.querySelector("#sp-screen-add").disabled);
    await authority.evaluate(() => {
      window.state.subpageRaw[1] = { main: "" }; window.codec.applySubpageRaw(1);
      window.state.subpageRaw[3] = { main: "@screen:Deleted screen\n" }; window.codec.applySubpageRaw(3);
    });
    assert.equal(await authority.evaluate(() => window.state.subpages[1]?.screenLabel), "Native screen", "native hydration withstands stale empty echo");
    assert.equal(await authority.evaluate(() => window.state.subpages[3]), undefined, "native empty records withstand stale resurrection");
    await authority.evaluate(() => {
      window.state.subpageRaw[1] = { main: "@screen:Native screen\n" }; window.codec.applySubpageRaw(1);
      window.state.subpageRaw[1] = { main: "@screen:Stale screen\n" }; window.codec.applySubpageRaw(1);
    });
    assert.equal(await authority.evaluate(() => window.state.subpages[1]?.screenLabel), "Native screen", "matching echo does not relinquish native authority");
    const missing = await fixture({ rules: "0\tHome\n4\tGone" });
    await missing.getByText('Unavailable screen 4: Gone', { exact: true }).waitFor();
    assert.equal(await missing.locator('[data-screen-slot="4"]').count(), 0);
    await missing.getByRole("button", { name: "Remove unavailable mapping 1", exact: true }).click();
    await missing.getByRole("button", { name: "Save screen settings", exact: true }).click();
    await missing.getByText("Screen navigation saved.", { exact: true }).waitFor();
    assert.equal(await missing.evaluate(() => window.saved.rules), "0\tHome");
    const locale = await fixture({ subpages: { 1: "@screen:Name\n" } });
    await locale.waitForFunction(() => !document.querySelector("#sp-screen-add").disabled);
    await locale.locator('[data-screen-slot="1"]').getByLabel("Screen name", { exact: true }).fill("Name draft");
    await locale.evaluate(() => window.requestLocale());
    assert.equal(await locale.evaluate(() => window.localeAllowed()), false, "name-only draft holds production language reload");
    await new Promise(resolve => setTimeout(resolve, 600));
    assert.equal(await locale.locator('[data-screen-slot="1"]').getByLabel("Screen name", { exact: true }).inputValue(), "Name draft");
    const reloaded = locale.waitForEvent("framenavigated");
    await locale.locator('[data-screen-slot="1"]').getByRole("button", { name: "Rename", exact: true }).click();
    await reloaded;
    assert.equal(await locale.evaluate(() => typeof window.codec), "undefined", "successful rename releases pending production locale reload");
    const busyLocale = await fixture({ subpages: { 1: "@screen:Name\n" } });
    await busyLocale.waitForFunction(() => !document.querySelector("#sp-screen-add").disabled);
    await busyLocale.evaluate(() => { window.holdPut = true; });
    await busyLocale.locator('[data-screen-slot="1"]').getByRole("button", { name: "Rename", exact: true }).click();
    await busyLocale.waitForFunction(() => typeof window.resumePut === "function");
    await busyLocale.evaluate(() => window.requestLocale());
    assert.equal(await busyLocale.evaluate(() => window.localeAllowed()), false, "pending metadata mutation holds locale reload without dirty name");
    const busyReloaded = busyLocale.waitForEvent("framenavigated");
    await busyLocale.evaluate(() => { window.holdPut = false; window.resumePut(); });
    await busyReloaded;
    const page = await fixture({ delayed: true });
    const add = page.getByRole("button", { name: "Add screen", exact: true });
    assert.equal(await add.isDisabled(), true, "creation waits for full load");
    assert.equal(await page.locator("#sp-screen #sp-set-screen-navigation").count(), 1);
    assert.equal(await page.locator("#sp-settings #sp-set-screen-navigation").count(), 0);
    assert.equal(await add.evaluate(el => el.previousElementSibling), null, "plus leads the toolbar");
    assert.equal(await add.evaluate(el => el.parentElement.className), "sp-screen-toolbar");
    assert.equal(await page.locator("#sp-screen-picker").count(), 0, "no active-screen picker remains");
    await page.evaluate(() => window.completeLoad());
    await page.waitForFunction(() => !document.querySelector("#sp-screen-add").disabled);
    const screen2 = page.locator('[data-screen-slot="2"]');
    assert.equal(await screen2.getByLabel("State value 1", { exact: true }).inputValue(), "Media");
    assert.equal(await screen2.getByLabel("State value 2", { exact: true }).inputValue(), "Radio");
    await screen2.getByLabel("State value 2", { exact: true }).selectOption("Radio draft");
    await page.evaluate(() => window.navigation.sync());
    assert.equal(await screen2.getByLabel("State value 2", { exact: true }).inputValue(), "Radio draft");
    await add.click();
    await page.waitForFunction(() => window.state.editingSubpage === 1);
    assert.equal(await page.locator(".sp-screen-active .fixture-cell").count(), 4, "independent grid uses all home-size cells");
    assert.equal(await page.locator(".sp-screen-active .fixture-cell").filter({ hasText: "Back" }).count(), 0);
    assert.equal(await page.evaluate(() => window.server.subpages[1]), "@screen:Screen 1\n", "empty screen persisted through real native create");
    assert.equal(await page.evaluate(() => window.server.buttons[1]), "light.room", "full home grid is preserved");
    await page.locator(".sp-screen-active").getByLabel("Screen name", { exact: true }).fill("Muzyka");
    await page.locator(".sp-screen-active").getByRole("button", { name: "Rename", exact: true }).click();
    await page.waitForFunction(() => window.server.subpages[1] === "@screen:Muzyka\n");
    await page.evaluate(() => { window.server.subpages[1] = "@screen:Concurrent name\n"; });
    await page.locator(".sp-screen-active").getByLabel("Screen name", { exact: true }).fill("Rename conflict");
    await page.locator(".sp-screen-active").getByRole("button", { name: "Rename", exact: true }).click();
    await page.getByText("Configuration changed in another browser. Reload before saving again.", { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.server.subpages[1]), "@screen:Concurrent name\n", "rename cannot overwrite a concurrent edit to this screen");
    await page.evaluate(() => { window.server.subpages[1] = "@screen:Muzyka\n"; });
    await page.locator(".sp-screen-active").getByLabel("Screen name", { exact: true }).fill("Muzyka");
    await page.locator(".sp-screen-active").getByRole("button", { name: "Rename", exact: true }).click();
    await page.locator(".sp-screen-active").getByLabel("State value 1", { exact: true }).selectOption("Music");
    await page.getByRole("button", { name: "Save screen settings", exact: true }).click();
    await page.getByText("Screen navigation saved.", { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.saved.rules), "0\tHome\n2\tMedia\n2\tRadio draft\n1\tMusic");
    await page.evaluate(async () => { await window.navigation.load(); window.navigation.sync(); });
    const screen1 = page.locator('[data-screen-slot="1"]');
    const screen1Name = screen1.getByLabel("Screen name", { exact: true });
    assert.equal(await screen1Name.inputValue(), "Muzyka");
    await screen1Name.fill("Unsaved name");
    await page.evaluate(() => window.navigation.sync());
    assert.equal(await screen1Name.inputValue(), "Unsaved name", "a redraw keeps the unsaved name");
    await page.evaluate(() => window.navigation.load());
    assert.equal(await screen1Name.inputValue(), "Unsaved name", "a reload keeps the unsaved name");
    await screen1Name.fill("Muzyka");
    await page.evaluate(async () => {
      const backup = await window.navigation.backup();
      window.navigation.edit({ entity: "input_select.unsaved", rows: [] });
      await window.navigation.restore(backup);
    });
    assert.equal(await page.locator(".sp-screen-active").getByLabel("State value 1", { exact: true }).inputValue(), "Music", "restore keeps independent-screen mapping");
    await page.screenshot({ path: "/private/tmp/independent-screen-ui.png", fullPage: true });
    await page.evaluate(() => { window.confirmDelete = false; });
    await page.locator(".sp-screen-active").getByRole("button", { name: "Delete screen", exact: true }).click();
    assert.equal(await page.evaluate(() => window.state.editingSubpage), 1, "a cancelled delete leaves the screen active");
    await page.evaluate(() => { window.confirmDelete = true; window.server.buttons[3] = "concurrent unrelated card"; });
    await page.locator(".sp-screen-active").getByRole("button", { name: "Delete screen", exact: true }).click();
    await page.waitForFunction(() => window.state.editingSubpage === null);
    assert.equal(await page.evaluate(() => window.server.subpages[1]), undefined);
    assert.equal(await page.evaluate(() => window.server.buttons[1]), "light.room");
    assert.equal(await page.evaluate(() => window.server.buttons[3]), "concurrent unrelated card");
    assert.equal(await page.evaluate(() => window.saved.rules.includes("Music")), false);
    assert.equal(await page.evaluate(() => window.confirmation), 'Delete screen "Muzyka" and its cards?');
    await page.evaluate(() => { window.state.subpageRaw[1] = { main: "@screen:Muzyka\n" }; window.codec.applySubpageRaw(1); });
    assert.equal(await page.evaluate(() => window.state.subpages[1]), undefined, "late chunk cannot resurrect deleted screen");
    assert.equal(await page.locator(".sp-screen-active").getByRole("button", { name: "Delete screen", exact: true }).isVisible(), false, "home cannot be deleted");
    // Fresh-server occupancy is checked at the actual native save boundary.
    await page.evaluate(() => { window.server.subpages[1] = "@screen:Other browser\n"; });
    await add.click();
    await page.getByText("Configuration changed in another browser. Reload before saving again.", { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => !window.state.editingSubpage), true, "a refused create leaves the home screen active");
    await page.evaluate(() => { window.state.subpages = { 1: { standaloneInvalid:true, rawConfig:"@screen:bad" }, 3: { standalone:true, screenLabel:"Three" }, 4: { standalone:true, screenLabel:"Four" } }; window.navigation.sync(); });
    await add.click();
    await page.getByText("No free screen storage. Delete an unused screen first.", { exact: true }).waitFor();
    assert.equal(await page.locator('[data-screen-slot="1"]').count(), 0, "quarantine hidden but occupied");
    const old = await fixture({ unsupported: true, unsupportedMapping: true });
    await old.getByText("Update the panel firmware to add screens.", { exact: true }).waitFor();
    assert.equal(await old.getByRole("button", { name: "Add screen", exact: true }).isDisabled(), true);
    assert.equal(await old.locator('[data-screen-slot="2"]').count(), 1, "legacy subpage editing remains available");
    assert.equal(await old.locator('[data-screen-slot="2"]').getByLabel("State value 1", { exact: true }).count(), 1);
    console.log("Screen navigation browser checks passed: placement, readiness, full-grid create/save/reload, multistate drafts, rename/delete, CAS conflicts, stale chunks, capacity and unsupported firmware.");
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
