"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { loadTypescriptTest } = require("./helpers/load_typescript_test");
const { createScreenOptionsDiscovery } = loadTypescriptTest("src/webserver/application/screen_navigation_options.ts");
const settle = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };

test("discovery debounces, bounds loading polls, retries and never sends unsupported IDs", async t => {
 t.mock.timers.enable({ apis: ["setTimeout"] });
 const calls = [];
 let status = "loading";
 const discovery = createScreenOptionsDiscovery({ getJson: async url => {
   calls.push(url); return { ok: true, value: { entity_id: "input_select.screen", status, options: [] } };
 } }, () => {});
 discovery.setEntity("input_select.s"); discovery.setEntity("input_select.screen");
 t.mock.timers.tick(399); assert.equal(calls.length, 0);
 t.mock.timers.tick(1); await settle(); assert.equal(calls.length, 1);
 for (let i = 0; i < 20; i++) { t.mock.timers.tick(1000); await settle(); }
 assert.equal(calls.length, 13); assert.equal(discovery.view().status, "unavailable");
 status = "ready"; discovery.retry(); t.mock.timers.tick(1); await settle();
 assert.equal(discovery.view().status, "ready"); assert.deepEqual(discovery.view().options, []);
 discovery.setEntity("input group.screen"); t.mock.timers.tick(1000); await settle();
 assert.equal(discovery.view().status, "unsupported"); assert.equal(calls.length, 14);
});

test("discovery rejects late responses and malformed metadata without keeping old options", async t => {
 t.mock.timers.enable({ apis: ["setTimeout"] });
 let old;
 let response = { entity_id: "select.new", status: "ready", options: ["  Exact, 'value'  "] };
 const discovery = createScreenOptionsDiscovery({ getJson: async url => {
   if (url.endsWith("select.old")) return new Promise(resolve => { old = resolve; });
   return { ok: true, value: response };
 } }, () => {});
 discovery.setEntity("select.old"); t.mock.timers.tick(400); await settle();
 discovery.setEntity("select.new"); t.mock.timers.tick(400); await settle();
 old({ ok: true, value: { entity_id: "select.old", status: "ready", options: ["Old"] } }); await settle();
 assert.deepEqual(discovery.view().options, ["  Exact, 'value'  "]);
 response = { entity_id: "select.new", status: "ready", options: ["a".repeat(256)] };
 discovery.retry(); t.mock.timers.tick(1); await settle();
 assert.equal(discovery.view().status, "error"); assert.deepEqual(discovery.view().options, []);
 response = { entity_id: "select.new", status: "unavailable", options: [] };
 discovery.retry(); t.mock.timers.tick(1); await settle();
 assert.equal(discovery.view().status, "unavailable");
});

test("a connection that never replies becomes retryable and custom entity domains are sent unchanged", async t => {
 t.mock.timers.enable({ apis: ["setTimeout"] });
 const calls = [];
 const discovery = createScreenOptionsDiscovery({ getJson: url => { calls.push(url); return new Promise(() => {}); } }, () => {});
 discovery.setEntity("input_group.biuro_wyswietlacz_biurko_ekran");
 t.mock.timers.tick(400); await settle();
 assert.ok(calls[0].endsWith("input_group.biuro_wyswietlacz_biurko_ekran"));
 t.mock.timers.tick(8000); await settle();
 assert.equal(discovery.view().status, "error");
});
