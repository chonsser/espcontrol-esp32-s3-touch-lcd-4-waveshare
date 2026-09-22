import { initializeDeviceConfig } from "../../src/webserver/device_config";
import { initializeAppState, state } from "../../src/webserver/state/app_instance";
import { createPreviewInteractionsFeature } from "../../src/webserver/application/preview_interactions";
import { createPreviewClipboardFeature } from "../../src/webserver/application/preview_clipboard";
import { createConfigCodecFeature } from "../../src/webserver/application/config_codec";
import { createConfigPersistenceFeature } from "../../src/webserver/application/config_post_api";

function equal(actual: unknown, expected: unknown, message: string): void {
  if (actual !== expected) throw new Error(`${message}: expected ${String(expected)}, received ${String(actual)}`);
}

function empty(type = "") {
  return { entity: "", label: "", icon: "Auto", icon_on: "Auto", sensor: "", unit: "", type, precision: "", options: "" };
}

function standalone(label: string) {
  return { standalone: true as const, screenLabel: label, order: [], buttons: [], grid: [0, 0, 0], sizes: {} };
}

function commonDependencies() {
  const codec = {
    parseSubpageConfig: (value: string) => JSON.parse(value),
    serializeSubpageConfig: (value: unknown) => JSON.stringify(value),
    getSubpage: (slot: number) => state.subpages[slot],
    buildSubpageGrid: () => {},
    serializeSubpageGrid: () => [],
    saveSubpageConfig: () => {},
    subpageFirstFreeSlot: () => 1,
    normalizeButtonConfig: (button: unknown) => ({ ...empty(), ...(button as object) }),
    normalizeCardSizeForConfig: (_button: unknown, size: number) => size,
    serializeButtonConfig: () => "button",
    parseBackOrderToken: (value: string) => ({ token: value, label: "Back" }),
  };
  const ctx = () => ({
    grid: state.grid, sizes: state.sizes, buttons: state.buttons,
    maxSlots: 3, selected: state.selectedSlots, isSub: false,
    setSelected: (value: number[]) => { state.selectedSlots = value; },
    setLastClicked: (value: number) => { state.lastClickedSlot = value; },
    getLastClicked: () => state.lastClickedSlot,
  });
  const placement = {
    findDuplicatePlacement: (grid: number[], start: number, size: number) => ({ pos: grid.indexOf(0, Math.max(0, start)), size }),
    getCellFromEvent: () => null,
    moveSelectedToCell: () => {},
    moveToCell: () => {},
    placeSlotAt: (grid: number[], slot: number, pos: number) => { grid[pos] = slot; },
    placeOrderedGridEntries: () => ({ grid: [], sizes: {}, placed: [] }),
  };
  return { codec, ctx, placement };
}

export async function runStandaloneScreenSafetyTests(): Promise<void> {
  Object.assign(globalThis, {
    __ESPCONTROL_DEFAULT_DEVICE_ID__: "test",
    __ESPCONTROL_DEVICE_PROFILES__: { test: { slots: 3, cols: 3, rows: 1, screen: {} } },
    __ESPCONTROL_TIMEZONE_OPTIONS__: [],
  });
  await initializeDeviceConfig();
  initializeAppState();
  const { codec, ctx, placement } = commonDependencies();
  const interactions = createPreviewInteractionsFeature({
    cardEditorDraft: { newDraft: () => ({ key: "draft" }) },
    configPersistence: { saveButtonConfig: () => Promise.resolve(), saveSubpageEntity: () => {}, subpageEntityKeys: () => ["subpage"] },
    layout: { numSlots: 3, gridCols: 3 }, window: { getSelection: () => null },
    imageOptions: { isImageCard: () => false, imageCardCountInSubpage: () => 0, canAddImageCards: () => true, showImageCardLimitBanner: () => {} },
    codec, runtime: { els: {} }, entityState: { entityName: (name: string) => name },
    shell: { isConfigLocked: () => false }, requestApi: { postText: () => Promise.resolve() },
    grid: { ctx, serializeGrid: () => "1" }, selection: { hideSettingsOverlay: () => {}, selectClockBarItem: () => {} },
    placement, contextMenu: {}, renderPreview: () => {}, renderButtonSettings: () => {},
  } as any);

  state.grid = [1, 0, 0];
  state.buttons = [empty("static"), empty(), empty()];
  const retainedOnDelete = standalone("Delete-safe");
  state.subpages = { "1": retainedOnDelete };
  interactions.deleteSlot(1);
  equal(state.subpages["1"], retainedOnDelete, "deleting a normal home card preserves its same-ID screen");

  state.grid = [1, 0, 0];
  state.buttons = [empty("static"), empty(), empty()];
  const sourceScreen = standalone("Source");
  const destinationScreen = standalone("Destination");
  state.subpages = { "1": sourceScreen, "2": destinationScreen };
  interactions.duplicateButton(1);
  equal(state.subpages["1"], sourceScreen, "duplicating a normal card preserves its same-ID source screen");
  equal(state.subpages["2"], destinationScreen, "duplicating a normal card preserves its destination screen");

  state.grid = [1, 0, 0];
  state.buttons = [empty("static"), empty(), empty()];
  const creationCollision = standalone("Reserved");
  state.subpages = { "2": creationCollision };
  interactions.addSubpageSlot(1);
  equal(state.grid[1], 3, "ordinary subpage creation skips an independent screen slot");
  equal(state.subpages["2"], creationCollision, "ordinary subpage creation never replaces an independent screen");

  const clipboard = createPreviewClipboardFeature({
    configPersistence: { saveButtonConfig: () => Promise.resolve(), saveSubpageEntity: () => {}, subpageEntityKeys: () => ["subpage"] },
    document: {}, layout: { numSlots: 3, gridCols: 3, deviceId: "test" }, cards: { definitions: { static: {} } },
    imageOptions: { imageSlotCapacityMessage: () => "", imageCardCountInClipboardEntries: () => 0, canAddImageCards: () => true, showImageCardLimitBanner: () => {} },
    sensorOptions: { sensorCardLocalSource: "local" }, codec,
    entityState: { entityName: (name: string) => name },
    shell: { isConfigLocked: () => false, showBanner: () => {}, createActionButton: () => ({}) },
    requestApi: { postText: () => Promise.resolve() }, grid: { ctx, serializeGrid: () => "1,2" },
    preview: { configDisabled: () => false, registryValue: () => true, render: () => {} }, placement,
    deleteSlot: () => {}, deleteButtons: () => {}, emptyButtonConfig: empty,
  } as any);
  state.grid = [1, 0, 0];
  state.buttons = [empty("static"), empty(), empty()];
  const pastedOverScreen = standalone("Paste-safe");
  state.subpages = { "1": standalone("Copy-safe"), "2": pastedOverScreen };
  equal(clipboard.buildEntry(1).subpageConfig, null, "copying a normal card does not copy its same-ID screen");
  state.clipboard = { buttons: [{ ...empty("static"), size: 1, subpageConfig: null }] };
  clipboard.pasteButton(1);
  equal(state.subpages["2"], pastedOverScreen, "pasting a normal card preserves its same-ID screen");

  state.grid = [1, 0, 0];
  state.buttons = [empty("static"), empty(), empty()];
  const protectedScreen = standalone("Subpage paste-safe");
  state.subpages = { "2": protectedScreen };
  state.clipboard = { buttons: [{
    ...empty("subpage"), size: 1,
    subpageConfig: JSON.stringify({ order: [], buttons: [], grid: [0, 0, 0], sizes: {}, backLabel: "Back" }),
  }] };
  clipboard.pasteButton(1);
  equal(state.grid[1], 3, "pasting an ordinary subpage skips an independent screen slot");
  equal(state.subpages["2"], protectedScreen, "pasting an ordinary subpage never replaces an independent screen");

  const migrations: number[] = [];
  const realCodec = createConfigCodecFeature(
    { definitions: {} } as any, {} as any, {} as any, { connectSubpageParser: () => {} } as any,
    {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any,
    { numSlots: 3, gridCols: 3 } as any,
    { saveSubpageEntity: () => {}, scheduleSliderSubpageMigration: (slot: number) => migrations.push(slot) },
    { schedule: () => {} } as any,
    { renderPreview: () => {}, renderButtonSettings: () => {} },
  );
  const malformed = [
    "@screen:Missing separator",
    "@screen:\n",
    `@screen:${"ą".repeat(33)}\n`,
    "@screen:Bad%00name\n",
    "@screen:Bad%ZZname\n",
    "@screen:Bad%C3name\n",
  ];
  for (const raw of malformed) {
    state.subpages = {};
    state.subpageRaw = { "1": { main: raw } };
    realCodec.applySubpageRaw(1);
    equal((state.subpages["1"] as any)?.standaloneInvalid, true,
      `malformed standalone data is quarantined at load: ${raw}`);
    equal(realCodec.serializeSubpageConfig(state.subpages["1"]), raw,
      `quarantined standalone data serializes byte-for-byte: ${raw}`);
  }
  equal(migrations.length, 0, "quarantined standalone data never schedules automatic normalization");
  const quarantined = state.subpages["1"];
  state.grid = [1, 0, 0];
  state.buttons = [empty("static"), empty(), empty()];
  interactions.deleteSlot(1);
  equal(state.subpages["1"], quarantined,
    "deleting a same-ID normal home card preserves quarantined standalone data");
  state.subpages = {};
  state.subpageRaw = { "1": { main: "B" } };
  realCodec.applySubpageRaw(1);
  equal((state.subpages["1"] as any)?.standaloneInvalid, undefined,
    "ordinary legacy subpages retain their existing load behavior");

  async function persistenceOutcome(outcome: string) {
    initializeAppState();
    const candidate = standalone(`Outcome ${outcome}`);
    state.subpages[1] = candidate;
    const banners: string[] = [];
    const api: any = { postQueue: Promise.resolve(), postQueueError: false };
    const persistence = createConfigPersistenceFeature(
      { createStandaloneScreen: () => Promise.resolve(outcome) } as any,
      { pendingSliderSubpageMigrations: {}, sliderMigrationTimer: null } as any,
      { config: { features: { subpageConfigChunks: 1 } } } as any,
      {
        entityName: (name: string) => name,
        entityNameForSlot: (name: string, slot: number) => `${name}_${slot}`,
        hasRememberedPostPath: () => false,
      },
      { showBanner: (message: string) => banners.push(message) },
    );
    persistence.connectCodec({ serializeButtonConfig: () => "", serializeSubpageConfig: (subpage: any) => `@screen:${subpage.screenLabel}\n` });
    persistence.connectRequestApi(api);
    const result = await persistence.createStandaloneScreen(1);
    return { result, candidate, retained: state.subpages[1], pending: state.subpageSavePending[1], api, banners };
  }
  let persisted = await persistenceOutcome("saved");
  equal(persisted.retained, persisted.candidate, "saved standalone creation retains its local candidate");
  equal(persisted.pending, "@screen:Outcome saved\n", "saved creation awaits its matching device echo");
  persisted = await persistenceOutcome("mirror-failed");
  equal(persisted.retained, persisted.candidate, "durably stored mirror-failed creation retains its local candidate");
  equal(persisted.pending, "@screen:Outcome mirror-failed\n",
    "mirror-failed creation remains protected from a stale legacy echo");
  equal(persisted.api.postQueueError, true, "mirror-failed creation preserves the write warning state");
  persisted = await persistenceOutcome("conflict");
  equal(persisted.retained, undefined, "conflicted standalone creation rolls its local candidate back");
  persisted = await persistenceOutcome("failed");
  equal(persisted.retained, undefined, "failed standalone creation rolls its local candidate back");
}
