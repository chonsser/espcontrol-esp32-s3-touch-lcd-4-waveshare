import { i18n } from "../i18n";
import type { DeviceApi } from "../api/device_api";
import type { CardConfig } from "../contracts/types";
import type { AppState } from "../state/types";
import { firstFreeStandaloneScreenSlot, isStandaloneSubpage, standaloneScreenNameError } from "../model/standalone_screens";
import { createScreenNavigationController, type ScreenNavigationController } from "../features/screen_navigation_controller";
import type { ScreenNavigationRule, ScreenNavigationSettings } from "../model/screen_navigation";
import type { ApplicationApiFeature } from "./api";
import type { EntityStateFeature } from "./entity_state";
import type { ControlsFieldsFeature } from "./controls_fields";
import { createScreenOptionsDiscovery } from "./screen_navigation_options";
import { holdWebLocaleReload } from "./language_state";

export interface ScreenNavigationFeature extends ScreenNavigationController { buildCard(): HTMLElement; buildToolbar(): HTMLElement; buildOverview(home: HTMLElement): HTMLElement; sync(): void }
export interface ScreenNavigationFeatureDependencies {
  document: Document;
  deviceApi: Pick<DeviceApi, "getJson">;
  requestApi: Pick<ApplicationApiFeature, "entityDetailPath" | "postText" | "postSwitch">;
  entityState: Pick<EntityStateFeature, "entityName" | "entityInput">;
  fields: Pick<ControlsFieldsFeature, "makeCollapsibleCard" | "fieldLabel" | "toggleRow">;
  buttons(): readonly Partial<CardConfig>[];
  previews?: { register(slot: number, wrap: HTMLElement): void; remove(slot: number): void; render(): void };
  editor?: {
    state: AppState;
    maxSlots(): number;
    ready(): Promise<boolean>;
    select(slot: number): void;
    create(slot: number): Promise<unknown>;
    replace(slot: number, label: string | null): Promise<unknown>;
    confirm(message: string): boolean;
  };
}

export function createScreenNavigationFeature(deps: ScreenNavigationFeatureDependencies): ScreenNavigationFeature {
  const document = deps.document;
  const screens = () => {
    const values = new Map<number, string>([[0, i18n("Home screen")]]);
    deps.buttons().forEach((button, index) => {
      if (button.type === "subpage" && !deps.editor?.state.subpages[index + 1]?.standaloneInvalid)
        values.set(index + 1, button.label || i18n("Subpage {number}", { number: index + 1 }));
    });
    Object.entries(deps.editor?.state.subpages || {}).forEach(([slot, screen]) => {
      if (isStandaloneSubpage(screen)) values.set(Number(slot), screen.screenLabel || i18n("Screen {number}", { number: slot }));
    });
    return values;
  };
  const targets = () => [...screens().keys()];
  const controller = createScreenNavigationController({
    targets,
    async read() {
      const readSetting = async (key: keyof ScreenNavigationSettings) => {
        const domain = key === "wake" ? "switch" : "text";
        const path = deps.requestApi.entityDetailPath(domain, deps.entityState.entityName("screen_navigation_" + key), "state");
        const result = await deps.deviceApi.getJson<Record<string, unknown>>(path);
        if (!result.ok) {
          if (result.status === 404) return null;
          throw new Error(i18n("Could not load screen navigation. Check the connection and try again."));
        }
        const data = result.value;
        const value = data?.value ?? data?.state;
        if (key === "wake" ? ![true, false, "ON", "OFF"].includes(value as boolean | string) : typeof value !== "string") {
          throw new Error(i18n("Could not load screen navigation. Check the connection and try again."));
        }
        return data;
      };
      const [entity, rules, wake] = await Promise.all([readSetting("entity"), readSetting("rules"), readSetting("wake")]);
      if (!entity || !rules || !wake) return null;
      const textValue = (data: Record<string, unknown>) => String(data.value ?? data.state ?? "");
      return { entity: textValue(entity), rules: textValue(rules), wake: wake.value === true || wake.state === "ON" || wake.value === "ON" };
    },
    async write(key, value) {
      const name = deps.entityState.entityName("screen_navigation_" + key);
      const result = key === "wake" ? await deps.requestApi.postSwitch(name, value === true) : await deps.requestApi.postText(name, value);
      return result?.ok === true;
    },
  });
  let releaseLocaleHold: (() => void) | undefined;
  let syncToolbar = () => {};
  let syncCard = () => {};
  let syncOverview = () => {};
  const discovery = createScreenOptionsDiscovery(deps.deviceApi, () => sync());
  let nativeReady = false;
  let busy = false;
  let screenMessage = "";
  const nameDrafts = new Map<number, string>();
  const selected = () => deps.editor?.state.editingSubpage || 0;
  const syncLocaleHold = () => {
    for (const [slot, label] of nameDrafts) {
      const screen = deps.editor?.state.subpages[slot];
      if (!isStandaloneSubpage(screen) || label === screen.screenLabel) nameDrafts.delete(slot);
    }
    const view = controller.view();
    const held = busy || nameDrafts.size > 0 || view.dirty || view.status === "saving";
    if (held && !releaseLocaleHold) releaseLocaleHold = holdWebLocaleReload();
    else if (!held && releaseLocaleHold) { releaseLocaleHold(); releaseLocaleHold = undefined; }
  };
  controller.subscribe(syncLocaleHold);
  const sync = () => { syncLocaleHold(); syncToolbar(); syncCard(); syncOverview(); };
  function button(label: string, onClick: () => void): HTMLButtonElement {
    const result = document.createElement("button");
    result.type = "button";
    result.className = "sp-fw-btn";
    result.textContent = label;
    result.addEventListener("click", onClick);
    return result;
  }
  const durable = (result: unknown) => result === "saved" || result === "mirror-failed";
  const failure = (result: unknown) => result === "conflict"
    ? i18n("Configuration changed in another browser. Reload before saving again.")
    : i18n("Could not save the configuration. Check the connection and try again.");
  async function addScreen() {
    const editor = deps.editor;
    if (!editor || !nativeReady || busy || editor.state.configLocked) return;
    const slot = firstFreeStandaloneScreenSlot(editor.state.subpages, deps.buttons(), editor.maxSlots());
    if (slot === null) { screenMessage = i18n("No free screen storage. Delete an unused screen first."); sync(); return; }
    busy = true;
    screenMessage = "";
    sync();
    editor.state.subpages[slot] = { standalone: true, screenLabel: i18n("Screen {number}", { number: slot }), order: [], buttons: [], grid: [], sizes: {} };
    try {
      const result = await editor.create(slot);
      if (durable(result)) editor.select(slot);
      else screenMessage = failure(result);
    } catch { screenMessage = failure("failed"); }
    finally { busy = false; sync(); }
  }
  function buildToolbar(): HTMLElement {
    const toolbar = document.createElement("div");
    toolbar.className = "sp-screen-toolbar";
    const add = button("+", () => { void addScreen(); });
    add.id = "sp-screen-add";
    add.setAttribute("aria-label", i18n("Add screen"));
    add.title = i18n("Add screen");
    const status = document.createElement("span");
    status.className = "sp-hint";
    status.setAttribute("role", "status");
    toolbar.append(add, status);
    syncToolbar = () => {
      add.disabled = busy || !nativeReady || !!deps.editor?.state.configLocked;
      status.textContent = screenMessage;
    };
    sync();
    void deps.editor?.ready().then(ready => {
      nativeReady = ready;
      if (!ready) screenMessage = i18n("Update the panel firmware to add screens.");
      sync();
      deps.previews?.render();
    }).catch(() => {
      screenMessage = i18n("Could not load screens. Reload the page to try again."); sync();
    });
    return toolbar;
  }
  async function changeScreen(slot: number, label: string | null) {
    if (!slot || busy || !nativeReady || deps.editor?.state.configLocked || !isStandaloneSubpage(deps.editor?.state.subpages[slot])) return;
    const nameError = label === null ? null : standaloneScreenNameError(label);
    if (nameError) {
      screenMessage = nameError === "required" ? i18n("Enter a screen name.") : nameError === "too-long" ? i18n("Screen name is too long. Shorten it.") : i18n("Screen name contains an unsupported character.");
      sync(); return;
    }
    busy = true; screenMessage = ""; sync();
    try {
      if (label === null && !await controller.removeTarget(slot)) return;
      const result = await deps.editor!.replace(slot, label);
      if (durable(result)) {
        nameDrafts.delete(slot);
        if (label === null && selected() === slot) deps.editor!.select(0);
      } else screenMessage = failure(result);
    } catch { screenMessage = failure("failed"); }
    finally { busy = false; sync(); deps.previews?.render(); }
  }
  // Mapping edits persist on their own: the source card's save button sits far above
  // the screens, and a choice that only lived in the draft was silently lost on reload.
  let autosaveTimer: ReturnType<typeof setTimeout> | undefined;
  let mappingSlot: number | null = null;
  const scheduleAutosave = (delay = 300) => { clearTimeout(autosaveTimer); autosaveTimer = setTimeout(() => { void autosave(); }, delay); };
  async function autosave() {
    const view = controller.view();
    // A differing entity is still being typed; saving now would persist half of it.
    if (!view.dirty || view.draft.entity !== view.savedEntity) return;
    if (view.status === "saving") { scheduleAutosave(); return; }
    const saved = await controller.save();
    if (saved && controller.view().dirty) scheduleAutosave(0);
  }
  function editMappings(slot: number, rows: ScreenNavigationRule[]) {
    mappingSlot = slot;
    controller.edit({ rows });
    scheduleAutosave();
  }
  const settingsDisabled = () => {
    const view = controller.view();
    return busy || !!deps.editor?.state.configLocked || !view.supported || ["idle", "loading", "saving", "unsupported"].includes(view.status);
  };
  function buildScreenSettings(slot: number) {
    const body = document.createElement("div");
    const metadata = document.createElement("fieldset"); metadata.className = "sp-screen-settings sp-screen-name-row";
    const name = document.createElement("input"); name.id = "sp-screen-name-" + slot; name.className = "sp-input";
    name.addEventListener("input", () => { nameDrafts.set(slot, name.value); syncLocaleHold(); });
    metadata.append(deps.fields.fieldLabel(i18n("Screen name"), name.id), name,
      button(i18n("Rename"), () => { void changeScreen(slot, name.value); }),
      button(i18n("Delete screen"), () => {
        if (deps.editor?.confirm(i18n('Delete screen "{name}" and its cards?', { name: screens().get(slot) || "" }))) void changeScreen(slot, null);
      }));
    const mappings = document.createElement("fieldset"); mappings.className = "sp-screen-settings";
    const rows = document.createElement("div");
    const mappingStatus = document.createElement("p"); mappingStatus.className = "sp-hint sp-screen-mapping-status"; mappingStatus.setAttribute("role", "status");
    mappings.append(rows, button(i18n("Add state value"), () => controller.edit({ rows: [...controller.view().draft.rows, { target: slot, state: "" }] })), mappingStatus);
    body.append(metadata, mappings);
    let signature = "";
    const update = () => {
      metadata.hidden = !isStandaloneSubpage(deps.editor?.state.subpages[slot]);
      metadata.disabled = busy || !nativeReady || !!deps.editor?.state.configLocked;
      if (document.activeElement !== name) name.value = nameDrafts.get(slot) ?? deps.editor?.state.subpages[slot]?.screenLabel ?? "";
      mappings.disabled = settingsDisabled();
      const view = controller.view();
      mappingStatus.textContent = mappingSlot !== slot ? "" : view.status === "saving" ? i18n("Saving screen navigation…") : view.message;
      const draft = view.draft;
      const options = discovery.view();
      // All row indices are part of the signature: removing a row on another screen shifts them.
      const nextSignature = JSON.stringify([draft.rows, options]);
      if (signature === nextSignature) return;
      signature = nextSignature;
      rows.replaceChildren();
      const matching = draft.rows.flatMap((row, index) => row.target === slot ? [{ row, index }] : []);
      if (!matching.length) matching.push({ row: { target: slot, state: "" }, index: draft.rows.length });
      matching.forEach(({ row, index }, position) => {
        const wrap = document.createElement("div"); wrap.className = "sp-field sp-screen-state";
        const input = document.createElement("select"); input.className = "sp-select";
        input.id = `sp-set-screen-navigation-state-${slot}-${position}`;
        const choice = (value: string, label: string) => { const option = document.createElement("option"); option.value = value; option.textContent = label; return option; };
        input.append(choice("", i18n("Choose a state value")));
        options.options.forEach(value => input.append(choice(value, value)));
        if (row.state && !options.options.includes(row.state)) input.append(choice(row.state, options.status === "ready" ? i18n("{value} (unavailable)", { value: row.state }) : row.state));
        input.value = row.state;
        input.addEventListener("change", () => {
          const next = controller.view().draft.rows;
          next[index] = { target: slot, state: input.value };
          // A value routes to exactly one screen, so assigning it here takes it off any other row.
          editMappings(slot, next.filter((row, position) => position === index || !input.value || row.state !== input.value));
        });
        wrap.append(deps.fields.fieldLabel(i18n("State value {number}", { number: position + 1 }), input.id), input,
          button(i18n("Remove mapping {number}", { number: position + 1 }), () => editMappings(slot, controller.view().draft.rows.filter((_, i) => i !== index))));
        rows.append(wrap);
      });
    };
    return { body, update };
  }
  function buildOverview(home: HTMLElement): HTMLElement {
    const gallery = document.createElement("div"); gallery.className = "sp-screen-gallery";
    const template = home.cloneNode(true) as HTMLElement;
    const panels = new Map<number, { panel: HTMLElement; heading: HTMLElement; update(): void }>();
    syncOverview = () => {
      const available = screens();
      for (const [slot, entry] of panels) if (!available.has(slot)) {
        entry.panel.remove(); panels.delete(slot); deps.previews?.remove(slot);
      }
      for (const [slot, label] of available) {
        let entry = panels.get(slot);
        if (!entry) {
          const panel = document.createElement("section"); panel.className = "sp-screen-editor"; panel.dataset.screenSlot = String(slot);
          const heading = document.createElement("h2"); heading.id = "sp-screen-title-" + slot;
          panel.setAttribute("aria-labelledby", heading.id);
          const wrap = slot === 0 ? home : template.cloneNode(true) as HTMLElement;
          const settings = buildScreenSettings(slot);
          panel.append(heading, wrap, settings.body); gallery.append(panel);
          entry = { panel, heading, update: settings.update }; panels.set(slot, entry);
          deps.previews?.register(slot, wrap);
        }
        entry.heading.textContent = label;
        entry.panel.classList.toggle("sp-screen-active", selected() === slot);
        entry.update();
      }
    };
    syncOverview();
    return gallery;
  }
  function buildCard(): HTMLElement {
    const card = document.createElement("section"); card.id = "sp-set-screen-navigation"; card.className = "sp-screen-navigation";
    const heading = document.createElement("h2"); heading.textContent = i18n("Screen from Home Assistant");
    const editor = document.createElement("fieldset"); editor.className = "sp-screen-settings";
    const entityId = "sp-set-screen-navigation-entity";
    const entity = deps.entityState.entityInput(entityId, "", "input_select.screen"); entity.classList.add("sp-input");
    const field = document.createElement("div"); field.className = "sp-field";
    field.append(deps.fields.fieldLabel(i18n("Entity"), entityId), entity);
    const explanation = document.createElement("p"); explanation.className = "sp-hint";
    explanation.textContent = i18n("Enter the Home Assistant entity that provides screen values. Leave it empty to disable automatic navigation.");
    const discoveryStatus = document.createElement("p"); discoveryStatus.id = "sp-screen-options-status"; discoveryStatus.className = "sp-hint"; discoveryStatus.setAttribute("role", "status");
    const retryOptions = button(i18n("Retry loading values"), () => discovery.retry());
    const wake = deps.fields.toggleRow(i18n("Wake the screen when the state changes"), "sp-set-screen-navigation-wake", true);
    const save = button(i18n("Save screen settings"), () => { void controller.save(); }); save.id = "sp-set-screen-navigation-save";
    const unavailable = document.createElement("div");
    editor.append(field, explanation, discoveryStatus, retryOptions, wake.row, unavailable, save);
    const status = document.createElement("p"); status.id = "sp-set-screen-navigation-status"; status.className = "sp-hint"; status.setAttribute("role", "status");
    const retry = button(i18n("Reload settings"), () => { void controller.load(); });
    card.append(heading, editor, status, retry);
    entity.addEventListener("input", () => controller.edit({ entity: entity.value }));
    entity.addEventListener("change", () => controller.edit({ entity: entity.value }));
    wake.input.addEventListener("change", () => controller.edit({ wake: wake.input.checked }));
    let missingSignature = "";
    syncCard = () => {
      const view = controller.view();
      if (entity.value !== view.draft.entity) entity.value = view.draft.entity;
      wake.input.checked = view.draft.wake;
      discovery.setEntity(view.draft.entity);
      const options = discovery.view();
      discoveryStatus.textContent = options.status === "idle" ? "" : options.status === "loading" ? i18n("Loading Home Assistant values…") : options.status === "unsupported" ? i18n("Check the entity ID and update the panel firmware if value discovery is not supported.") : options.status === "ready" ? (options.options.length ? i18n("Choose the values that open each screen below.") : i18n("This entity has no available values.")) : i18n("Could not load Home Assistant values. Check the entity and connection, then retry.");
      retryOptions.hidden = !["unavailable", "error", "unsupported"].includes(options.status);
      editor.disabled = settingsDisabled();
      retry.hidden = view.status !== "error" || view.dirty;
      status.textContent = view.status === "loading" ? i18n("Loading screen navigation…") : view.status === "saving" ? i18n("Saving screen navigation…") : view.message;
      const missing = view.draft.rows.filter(row => !targets().includes(row.target));
      const next = JSON.stringify(missing);
      if (next !== missingSignature) {
        missingSignature = next; unavailable.replaceChildren();
        missing.forEach((row, position) => {
          const wrap = document.createElement("div"); wrap.className = "sp-field";
          const label = document.createElement("p"); label.className = "sp-hint";
          label.textContent = i18n("Unavailable screen {number}: {state}", { number: row.target, state: row.state });
          wrap.append(label, button(i18n("Remove unavailable mapping {number}", { number: position + 1 }), () => controller.edit({ rows: controller.view().draft.rows.filter(candidate => candidate.target !== row.target || candidate.state !== row.state) })));
          unavailable.append(wrap);
        });
      }
    };
    controller.subscribe(sync);
    sync(); void controller.load();
    return card;
  }
  return { ...controller, buildCard, buildToolbar, buildOverview, sync };
}
