import { i18n } from "../i18n";
import type { DeviceApi } from "../api/device_api";
import type { CardConfig } from "../contracts/types";
import type { AppState } from "../state/types";
import { firstFreeStandaloneScreenSlot, isStandaloneSubpage, standaloneScreenNameError } from "../model/standalone_screens";
import { createScreenNavigationController, type ScreenNavigationController } from "../features/screen_navigation_controller";
import type { ScreenNavigationDraft } from "../features/screen_navigation_controller";
import type { ScreenNavigationSettings } from "../model/screen_navigation";
import type { ApplicationApiFeature } from "./api";
import type { EntityStateFeature } from "./entity_state";
import type { ControlsFieldsFeature } from "./controls_fields";
import { holdWebLocaleReload } from "./language_state";

export interface ScreenNavigationFeature extends ScreenNavigationController { buildCard(): HTMLElement; buildToolbar(): HTMLElement; sync(): void }
export interface ScreenNavigationFeatureDependencies {
  document: Document;
  deviceApi: Pick<DeviceApi, "getJson">;
  requestApi: Pick<ApplicationApiFeature, "entityDetailPath" | "postText" | "postSwitch">;
  entityState: Pick<EntityStateFeature, "entityName" | "entityInput">;
  fields: Pick<ControlsFieldsFeature, "makeCollapsibleCard" | "fieldLabel" | "toggleRow">;
  buttons(): readonly Partial<CardConfig>[];
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
  const sync = () => { syncLocaleHold(); syncToolbar(); syncCard(); };
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
    toolbar.append(deps.fields.fieldLabel(i18n("Screen"), "sp-screen-picker"));
    const picker = document.createElement("select");
    picker.id = "sp-screen-picker";
    picker.className = "sp-select";
    picker.addEventListener("change", () => {
      if (!busy && !deps.editor?.state.configLocked) deps.editor?.select(Number(picker.value));
      sync();
    });
    const add = button("+", () => { void addScreen(); });
    add.id = "sp-screen-add";
    add.setAttribute("aria-label", i18n("Add screen"));
    add.title = i18n("Add screen");
    const status = document.createElement("span");
    status.className = "sp-hint";
    status.setAttribute("role", "status");
    toolbar.append(picker, add, status);
    let signature = "";
    syncToolbar = () => {
      const options = [...screens()];
      const next = JSON.stringify(options);
      if (signature !== next) {
        signature = next;
        picker.replaceChildren(...options.map(([slot, label]) => {
          const option = document.createElement("option");
          option.value = String(slot); option.textContent = label; return option;
        }));
      }
      picker.value = String(selected());
      picker.disabled = busy || !!deps.editor?.state.configLocked;
      add.disabled = busy || !nativeReady || !!deps.editor?.state.configLocked;
      status.textContent = screenMessage;
    };
    sync();
    void deps.editor?.ready().then(ready => {
      nativeReady = ready;
      if (!ready) screenMessage = i18n("Update the panel firmware to add screens.");
      sync();
    }).catch(() => {
      screenMessage = i18n("Could not load screens. Reload the page to try again."); sync();
    });
    return toolbar;
  }
  function buildCard(): HTMLElement {
    const body = document.createElement("div");
    const editor = document.createElement("fieldset");
    editor.className = "sp-screen-settings";
    const metadata = document.createElement("div");
    metadata.className = "sp-screen-name-row";
    const name = document.createElement("input");
    name.id = "sp-screen-name";
    name.className = "sp-input";
    name.addEventListener("input", () => { nameDrafts.set(selected(), name.value); syncLocaleHold(); });
    const rename = button(i18n("Rename"), () => { void changeScreen(name.value); });
    const remove = button(i18n("Delete screen"), () => {
      const label = screens().get(selected()) || "";
      if (deps.editor?.confirm(i18n('Delete screen "{name}" and its cards?', { name: label }))) void changeScreen(null);
    });
    metadata.append(deps.fields.fieldLabel(i18n("Screen name"), name.id), name, rename, remove);
    body.append(metadata);
    async function changeScreen(label: string | null) {
      const slot = selected();
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
          if (label === null) deps.editor!.select(0);
        } else screenMessage = failure(result);
      } catch { screenMessage = failure("failed"); }
      finally { busy = false; sync(); }
    }
    const entityField = document.createElement("div");
    entityField.className = "sp-field";
    const entityId = "sp-set-screen-navigation-entity";
    entityField.append(deps.fields.fieldLabel(i18n("Entity"), entityId));
    const entity: HTMLInputElement = deps.entityState.entityInput(entityId, "", "input_select.screen");
    entity.classList.add("sp-input");
    entityField.append(entity);
    editor.append(entityField);
    const explanation = document.createElement("p");
    explanation.className = "sp-hint";
    explanation.textContent = i18n("Enter the exact Home Assistant state that opens the selected screen. Leave the entity empty to disable automatic navigation.");
    editor.append(explanation);
    const rows = document.createElement("div");
    editor.append(rows);
    const unavailable = document.createElement("div");
    editor.append(unavailable);
    editor.append(button(i18n("Add state value"), () => {
      controller.edit({ rows: [...controller.view().draft.rows, { target: selected(), state: "" }] });
    }));
    const wake = deps.fields.toggleRow(i18n("Wake the screen when the state changes"), "sp-set-screen-navigation-wake", true);
    editor.append(wake.row);
    const save = button(i18n("Save screen settings"), () => { void controller.save(); });
    save.id = "sp-set-screen-navigation-save";
    editor.append(save);
    body.append(editor);
    const status = document.createElement("p");
    status.id = "sp-set-screen-navigation-status";
    status.className = "sp-hint";
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    body.append(status);
    const retry = button(i18n("Reload settings"), () => { void controller.load(); });
    body.append(retry);
    const draftSignature = (draft: ScreenNavigationDraft) => JSON.stringify([selected(), draft, targets()]);
    let signature = "";
    let metadataSlot = -1;
    const edit = (change: Partial<ScreenNavigationDraft>) => {
      signature = draftSignature({ ...controller.view().draft, ...change });
      controller.edit(change);
    };
    entity.addEventListener("input", () => edit({ entity: entity.value }));
    entity.addEventListener("change", () => edit({ entity: entity.value }));
    wake.input.addEventListener("change", () => edit({ wake: wake.input.checked }));
    const renderDraft = (draft: ScreenNavigationDraft) => {
      signature = draftSignature(draft);
      entity.value = draft.entity;
      wake.input.checked = draft.wake;
      rows.replaceChildren();
      unavailable.replaceChildren();
      draft.rows.filter(row => !targets().includes(row.target)).forEach((row, position) => {
        const wrap = document.createElement("div");
        wrap.className = "sp-field";
        const label = document.createElement("p");
        label.className = "sp-hint";
        label.textContent = i18n("Unavailable screen {number}: {state}", { number: row.target, state: row.state });
        wrap.append(label, button(i18n("Remove unavailable mapping {number}", { number: position + 1 }), () => {
          controller.edit({ rows: controller.view().draft.rows.filter(candidate => candidate.target !== row.target || candidate.state !== row.state) });
        }));
        unavailable.append(wrap);
      });
      const matching = draft.rows.flatMap((row, index) => row.target === selected() ? [{ row, index }] : []);
      if (!matching.length) matching.push({ row: { target: selected(), state: "" }, index: draft.rows.length });
      matching.forEach(({ row, index }, position) => {
        const wrap = document.createElement("div");
        wrap.className = "sp-field sp-screen-state";
        const stateId = `sp-set-screen-navigation-state-${position}`;
        wrap.append(deps.fields.fieldLabel(i18n("State value {number}", { number: position + 1 }), stateId));
        const input = document.createElement("input");
        input.className = "sp-input";
        input.type = "text"; input.id = stateId; input.value = row.state;
        input.addEventListener("input", () => {
          const next = controller.view().draft.rows;
          next[index] = { target: selected(), state: input.value };
          edit({ rows: next });
        });
        wrap.append(input, button(i18n("Remove mapping {number}", { number: position + 1 }), () => {
          controller.edit({ rows: controller.view().draft.rows.filter((_, i) => i !== index) });
        }));
        rows.append(wrap);
      });
    };
    syncCard = () => {
      const view = controller.view();
      const slot = selected();
      if (signature !== draftSignature(view.draft)) renderDraft(view.draft);
      metadata.hidden = !isStandaloneSubpage(deps.editor?.state.subpages[slot]);
      if (metadataSlot !== slot || document.activeElement !== name) {
        name.value = nameDrafts.get(slot) ?? deps.editor?.state.subpages[slot]?.screenLabel ?? "";
        metadataSlot = slot;
      }
      name.disabled = rename.disabled = remove.disabled = busy || !nativeReady || !!deps.editor?.state.configLocked;
      editor.disabled = busy || !!deps.editor?.state.configLocked || !view.supported || ["idle", "loading", "saving", "unsupported"].includes(view.status);
      retry.hidden = view.status !== "error" || view.dirty;
      status.textContent = view.status === "loading" ? i18n("Loading screen navigation…") : view.status === "saving" ? i18n("Saving screen navigation…") : view.message;
    };
    controller.subscribe(sync);
    sync();
    const card: HTMLElement = deps.fields.makeCollapsibleCard(i18n("Screen from Home Assistant"), body, false);
    card.id = "sp-set-screen-navigation";
    card.classList.add("sp-screen-navigation");
    card.querySelector(".card-header")?.addEventListener("click", () => {
      if (!card.classList.contains("collapsed")) { sync(); void controller.load(); }
    });
    void controller.load();
    return card;
  }
  return { ...controller, buildCard, buildToolbar, sync };
}
