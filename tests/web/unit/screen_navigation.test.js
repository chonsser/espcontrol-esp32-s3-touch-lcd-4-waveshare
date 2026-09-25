"use strict";
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { loadTypescriptTest } = require("./helpers/load_typescript_test");

// Regression target: accepting duplicate/unsafe mappings, clobbering drafts, or
// rebinding an old HA source before the complete new mapping reaches the device.
const model = () => loadTypescriptTest("src/webserver/model/screen_navigation.ts");
const controller = () => loadTypescriptTest("src/webserver/features/screen_navigation_controller.ts");
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const defaults = { entity: "input_select.screen", rules: "0\tHome", wake: true };
function setup(options = {}) {
  let saved = { ...defaults };
  const writes = [];
  const value = controller().createScreenNavigationController({
    read: async () => ({ ...saved }),
    write: async (key, value) => { writes.push([key, value]); saved[key] = value; return true; },
    targets: () => [0, 4],
    ...options,
  });
  return { value, writes, saved: () => saved };
}

test("screen navigation module provides explicit mapping validation", () => {
  assert.equal(typeof model().serializeScreenNavigationRules, "function");
});
test("states round-trip exactly with Unicode and reserved characters", () => {
  const rows = [{ target: 0, state: " Dom " }, { target: 4, state: "Pokój %\t\n\r" }];
  const encoded = model().serializeScreenNavigationRules(rows, [0, 4]);
  assert.equal(encoded, "0\t Dom \n4\tPokój %25%09%0A%0D");
  assert.deepEqual(model().parseScreenNavigationRules(encoded, [0, 4]), rows);
});
test("invalid state values, duplicate states, malformed encoding and invalid targets are rejected", () => {
  for (const state of ["", " \t", "unknown", "unavailable"]) {
    assert.throws(() => model().serializeScreenNavigationRules([{ target: 0, state }], [0]));
  }
  for (const rules of ["0\tx\n4\tx", "0\tbad%20", "0\tx\n", "-1\tx", "33\tx", "04\tx", "1\tx", "0\tx\ty"]) {
    assert.throws(() => model().parseScreenNavigationRules(rules, [0, 4]));
  }
  assert.equal(model().serializeScreenNavigationRules([{ target: 0, state: "A" }, { target: 4, state: "a" }], [0, 4]), "0\tA\n4\ta");
});
test("limits measure UTF-8 bytes including escaped characters", () => {
  assert.equal(model().serializeScreenNavigationRules([{ target: 0, state: "ą".repeat(126) + "a" }], [0]).length, 129);
  assert.throws(() => model().serializeScreenNavigationRules([{ target: 0, state: "ą".repeat(127) }], [0]));
  assert.throws(() => model().validateScreenNavigationEntity("ą".repeat(51)));
  assert.throws(() => model().serializeScreenNavigationRules([{ target: 0, state: "%".repeat(85) }], [0]));
});
test("changing the source disables the binding before writing mappings and reenables it last", async () => {
  const { value, writes } = setup();
  await value.load();
  value.edit({ entity: "input_select.new", rows: [{ target: 4, state: "Media" }], wake: false });
  assert.equal(await value.save(), true);
  assert.deepEqual(writes, [["entity", ""], ["rules", "4\tMedia"], ["wake", false], ["entity", "input_select.new"]]);
  assert.equal(value.view().dirty, false);
  await value.load();
  assert.equal(value.view().draft.entity, "input_select.new");
});
test("delayed reads and repeated loads cannot replace unsaved edits", async () => {
  const read = deferred();
  const { value } = setup({ read: () => read.promise });
  const loading = value.load();
  value.edit({ entity: "input_select.draft" });
  read.resolve(defaults);
  await loading;
  assert.equal(value.view().draft.entity, "input_select.draft");
  await value.load();
  assert.equal(value.view().draft.entity, "input_select.draft");
});
test("partial save leaves a retryable error and never activates the new source", async () => {
  const writes = [];
  let fail = true;
  const { value } = setup({ write: async (key, v) => { writes.push([key, v]); return !(key === "rules" && fail); } });
  await value.load();
  value.edit({ entity: "input_select.new", rows: [{ target: 4, state: "Media" }] });
  assert.equal(await value.save(), false);
  assert.deepEqual(writes, [["entity", ""], ["rules", "4\tMedia"]]);
  assert.equal(value.view().dirty, true);
  assert.equal(value.view().status, "error");
  fail = false;
  assert.equal(await value.save(), true);
  assert.equal(writes.at(-1)[1], "input_select.new");
});
test("unsupported firmware cannot save and missing targets cannot become actions", async () => {
  const { value, writes } = setup({ read: async () => null });
  await value.load();
  assert.equal(value.view().status, "unsupported");
  assert.equal(await value.save(), false);
  assert.deepEqual(writes, []);
  const normal = setup();
  await normal.value.load();
  normal.value.edit({ rows: [{ target: 2, state: "Lights" }] });
  assert.equal(await normal.value.save(), false);
  assert.deepEqual(normal.writes, []);
});
test("restore uses the same safe write order and export returns persisted values", async () => {
  const { value, writes } = setup();
  const restored = { screen_navigation_entity: "input_select.restored", screen_navigation_rules: "4\tMedia", screen_navigation_wake: false };
  await value.restore(restored);
  assert.deepEqual(writes, [["entity", ""], ["rules", "4\tMedia"], ["wake", false], ["entity", "input_select.restored"]]);
  assert.deepEqual(await value.backup(), restored);
});

test("backup imports remap subpage targets and drop absent or ordinary-card slots", () => {
  const { createBackupFeature } = loadTypescriptTest("src/webserver/features/backup.ts");
  const { cloneCardConfig } = loadTypescriptTest("src/webserver/model/index.ts");
  const feature = createBackupFeature({ deviceId: "target", gridCols: 2, numSlots: 2,
    normalizeButtonConfig: cloneCardConfig, parseSubpageConfig: () => ({ buttons: [], order: [] }),
    serializeSubpageConfig: () => "", buildSubpageGrid: () => [],
  });
  const plan = feature.planBackupImport({ version: 2, format: "espcontrol.backup", device: "source", button_order: "4,2,1,3",
    buttons: [{ type: "subpage" }, { type: "switch" }, { type: "subpage" }, { type: "subpage", label: "Media" }],
    settings: { screen_navigation_entity: "input_select.screen", screen_navigation_rules: "0\tHome\n4\tMedia\n2\tUnsafe\n3\tGone", screen_navigation_wake: false },
  });
  assert.equal(plan.settings.screen_navigation_rules, "0\tHome\n1\tMedia");
  assert.equal(plan.settings.screen_navigation_entity, "input_select.screen");
  assert.equal(plan.settings.screen_navigation_wake, false);
  assert.ok(plan.warnings.some(value => /screen mappings/i.test(value)));
});

test("backup rejects malformed screen mappings before any restore", () => {
  const { createBackupFeature } = loadTypescriptTest("src/webserver/features/backup.ts");
  const { cloneCardConfig } = loadTypescriptTest("src/webserver/model/index.ts");
  const feature = createBackupFeature({ deviceId: "target", gridCols: 2, numSlots: 2,
    normalizeButtonConfig: cloneCardConfig, parseSubpageConfig: () => ({ buttons: [], order: [] }),
    serializeSubpageConfig: () => "", buildSubpageGrid: () => [],
  });
  assert.throws(() => feature.planBackupImport({ version: 2, format: "espcontrol.backup", buttons: [],
    settings: { screen_navigation_rules: "0\tbad%00" },
  }));
});

test("saving unchanged source still isolates a partial mapping update", async () => {
  const { value, writes } = setup();
  await value.load();
  value.edit({ wake: false });
  await value.save();
  assert.equal(writes[0][0], "entity");
  assert.equal(writes[0][1], "");
  assert.equal(writes.at(-1)[1], defaults.entity);
});

test("suspending navigation before layout replacement prevents stale slot reuse", async () => {
  const { value, writes } = setup();
  await value.suspendForRestore();
  assert.deepEqual(writes, [["entity", ""]]);
  await value.restore({});
  assert.equal(writes.some(([key, value]) => key === "entity" && value), false);
});

test("export uses saved device values without replacing an editor draft", async () => {
  const { value } = setup();
  await value.load();
  value.edit({ entity: "input_select.unsaved" });
  assert.equal((await value.backup()).screen_navigation_entity, defaults.entity);
  assert.equal(value.view().draft.entity, "input_select.unsaved");
});

test("loading errors remain distinguishable from unsupported firmware", async () => {
  const { value } = setup({ read: async () => { throw new Error("Connection interrupted"); } });
  await value.load();
  assert.equal(value.view().status, "error");
  assert.equal(value.view().supported, false);
  assert.equal(value.view().message, "Connection interrupted");
});

test("malformed device replies cannot masquerade as an empty saved configuration", async () => {
  const { createScreenNavigationFeature } = loadTypescriptTest("src/webserver/application/screen_navigation.ts");
  const feature = createScreenNavigationFeature({ document: {}, fields: {}, buttons: () => [],
    deviceApi: { getJson: async () => ({ ok: true, value: {} }) },
    requestApi: { entityDetailPath: () => "/example" }, entityState: { entityName: key => key },
  });
  await assert.rejects(() => feature.backup());
});

test("entity IDs match firmware syntax while an empty entity disables navigation", () => {
  for (const entity of ["Home", "input_select.UPPERCASE", "input-select.screen", "input_select.", "input_select.nazwa ekranu", "input_select.żółty", "input_select.screen\nother.value"]) {
    assert.throws(() => model().validateScreenNavigationEntity(entity));
  }
  assert.equal(model().validateScreenNavigationEntity("  input_select.screen_2 "), "input_select.screen_2");
  assert.equal(model().validateScreenNavigationEntity(" \t "), "");
});

test("unsupported restore is rejected before the imported layout can replace slots", async () => {
  const { value, writes } = setup({ read: async () => null });
  await assert.rejects(() => value.suspendForRestore({ screen_navigation_entity: "input_select.screen" }));
  assert.deepEqual(writes, []);
});

test("deleting a screen removes saved and draft mappings without saving other draft changes", async () => {
  const { value, writes, saved } = setup({ targets: () => [0, 4, 5] });
  await value.load();
  value.edit({ rows: [{ target: 4, state: "Media" }, { target: 5, state: "Other draft" }], entity: "input_select.draft" });
  assert.equal(await value.removeTarget(4), true);
  assert.equal(saved().entity, "input_select.screen");
  assert.deepEqual(value.view().draft.rows, [{ target: 5, state: "Other draft" }]);
  assert.equal(value.view().draft.entity, "input_select.draft");
  assert.equal(value.view().dirty, true);
  assert.deepEqual(writes, [["entity", ""], ["rules", "0\tHome"], ["wake", true], ["entity", "input_select.screen"]]);
});

test("deleting a screen removes every persisted matching state and retains other screens", async () => {
  const writes = [];
  const { value } = setup({
    read: async () => ({ ...defaults, rules: "0\tHome\n4\tMusic\n4\tRadio" }),
    write: async (key, value) => { writes.push([key, value]); return true; },
  });
  await value.load();
  assert.equal(await value.removeTarget(4), true);
  assert.deepEqual(writes, [["entity", ""], ["rules", "0\tHome"], ["wake", true], ["entity", defaults.entity]]);
  assert.deepEqual(value.view().draft.rows, [{ target: 0, state: "Home" }]);
  assert.equal(await value.removeTarget(0), false, "home cannot be removed");
});

test("failed mapping cleanup never reenables the source or discards its draft", async () => {
  const writes = [];
  const { value } = setup({
    read: async () => ({ ...defaults, rules: "4\tMusic" }),
    write: async (key, value) => { writes.push([key, value]); return key !== "rules"; },
  });
  await value.load();
  value.edit({ rows: [{ target: 4, state: "Draft" }] });
  assert.equal(await value.removeTarget(4), false);
  assert.deepEqual(writes, [["entity", ""], ["rules", ""]]);
  assert.deepEqual(value.view().draft.rows, [{ target: 4, state: "Draft" }]);
  assert.equal(value.view().dirty, true);
});
