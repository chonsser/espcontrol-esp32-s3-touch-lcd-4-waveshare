import { i18n } from "../i18n";
import type { DeviceApi } from "../api/device_api";
import type { CardConfig } from "../contracts/types";
import { createScreenNavigationController, type ScreenNavigationController } from "../features/screen_navigation_controller";
import type { ScreenNavigationDraft } from "../features/screen_navigation_controller";
import type { ScreenNavigationSettings } from "../model/screen_navigation";
import type { ApplicationApiFeature } from "./api";
import type { EntityStateFeature } from "./entity_state";
import type { ControlsFieldsFeature } from "./controls_fields";
import { holdWebLocaleReload } from "./language_state";

export interface ScreenNavigationFeature extends ScreenNavigationController { buildCard(): HTMLElement }
export interface ScreenNavigationFeatureDependencies {
  document: Document;
  deviceApi: Pick<DeviceApi, "getJson">;
  requestApi: Pick<ApplicationApiFeature, "entityDetailPath" | "postText" | "postSwitch">;
  entityState: Pick<EntityStateFeature, "entityName" | "entityInput">;
  fields: Pick<ControlsFieldsFeature, "makeCollapsibleCard" | "fieldLabel" | "toggleRow">;
  buttons(): readonly Partial<CardConfig>[];
}

export function createScreenNavigationFeature(deps: ScreenNavigationFeatureDependencies): ScreenNavigationFeature {
  const document = deps.document;
  const targets = () => [0, ...deps.buttons().flatMap((button, index) => button.type === "subpage" ? [index + 1] : [])];
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
  controller.subscribe(() => {
    const view = controller.view();
    if ((view.dirty || view.status === "saving") && !releaseLocaleHold) releaseLocaleHold = holdWebLocaleReload();
    else if (!view.dirty && view.status !== "saving" && releaseLocaleHold) { releaseLocaleHold(); releaseLocaleHold = undefined; }
  });
  function buildCard(): HTMLElement {
    const body = document.createElement("div");
    const explanation = document.createElement("p");
    explanation.className = "sp-hint";
    explanation.textContent = i18n("Match exact Home Assistant state values to the home screen or a subpage. Leave the entity empty to disable automatic navigation.");
    body.append(explanation);
    const editor = document.createElement("fieldset");
    editor.style.border = "0";
    editor.style.padding = "0";
    editor.style.margin = "0";
    editor.style.minWidth = "0";
    const entityField = document.createElement("div");
    entityField.className = "sp-field";
    const entityId = "sp-set-screen-navigation-entity";
    entityField.append(deps.fields.fieldLabel(i18n("Entity"), entityId));
    const entity: HTMLInputElement = deps.entityState.entityInput(entityId, "", "input_select.aktualny_ekran");
    entityField.append(entity);
    editor.append(entityField);
    const rows = document.createElement("div");
    editor.append(rows);
    const button = (label: string, onClick: () => void): HTMLButtonElement => {
      const result = document.createElement("button");
      result.type = "button";
      result.className = "sp-fw-btn";
      result.textContent = label;
      result.addEventListener("click", onClick);
      return result;
    };
    const add = button(i18n("Add mapping"), () => {
      const draft = controller.view().draft;
      controller.edit({ rows: [...draft.rows, { target: 0, state: "" }] });
    });
    editor.append(add);
    const wake = deps.fields.toggleRow(i18n("Wake the screen when the state changes"), "sp-set-screen-navigation-wake", true);
    editor.append(wake.row);
    const save = button(i18n("Save"), () => { void controller.save(); });
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
    let signature = "";
    const edit = (change: Partial<ScreenNavigationDraft>) => {
      signature = JSON.stringify({ ...controller.view().draft, ...change });
      controller.edit(change);
    };
    entity.addEventListener("input", () => edit({ entity: entity.value }));
    entity.addEventListener("change", () => edit({ entity: entity.value }));
    wake.input.addEventListener("change", () => edit({ wake: wake.input.checked }));
    const renderDraft = (draft: ScreenNavigationDraft) => {
      signature = JSON.stringify(draft);
      entity.value = draft.entity;
      wake.input.checked = draft.wake;
      rows.replaceChildren();
      draft.rows.forEach((row, index) => {
        const wrap = document.createElement("div");
        wrap.className = "sp-field";
        const stateId = `sp-set-screen-navigation-state-${index}`;
        wrap.append(deps.fields.fieldLabel(i18n("State value {number}", { number: index + 1 }), stateId));
        const input = document.createElement("input");
        input.className = "sp-input";
        input.type = "text";
        input.id = stateId;
        input.value = row.state;
        input.addEventListener("input", () => {
          const next = controller.view().draft.rows;
          next[index]!.state = input.value;
          edit({ rows: next });
        });
        wrap.append(input);
        const selectId = `sp-set-screen-navigation-target-${index}`;
        wrap.append(deps.fields.fieldLabel(i18n("Screen {number}", { number: index + 1 }), selectId));
        const select = document.createElement("select");
        select.id = selectId;
        select.className = "sp-select";
        const addOption = (value: number, label: string) => {
          const option = document.createElement("option");
          option.value = String(value);
          option.textContent = label;
          select.append(option);
        };
        addOption(0, i18n("Home screen"));
        deps.buttons().forEach((target, slot) => {
          if (target.type === "subpage") addOption(slot + 1, target.label || i18n("Subpage {number}", { number: slot + 1 }));
        });
        if (!targets().includes(row.target)) addOption(row.target, i18n("Removed subpage — choose another screen"));
        select.value = String(row.target);
        select.addEventListener("change", () => {
          const next = controller.view().draft.rows;
          next[index]!.target = Number(select.value);
          edit({ rows: next });
        });
        wrap.append(select, button(i18n("Remove mapping {number}", { number: index + 1 }), () => {
          controller.edit({ rows: controller.view().draft.rows.filter((_, position) => position !== index) });
        }));
        rows.append(wrap);
      });
    };
    const sync = () => {
      const view = controller.view();
      if (signature !== JSON.stringify(view.draft)) renderDraft(view.draft);
      editor.disabled = !view.supported || ["idle", "loading", "saving", "unsupported"].includes(view.status);
      retry.hidden = view.status !== "error" || view.dirty;
      status.textContent = view.status === "loading" ? i18n("Loading screen navigation…") : view.status === "saving" ? i18n("Saving screen navigation…") : view.message;
    };
    controller.subscribe(sync);
    sync();
    const card: HTMLElement = deps.fields.makeCollapsibleCard(i18n("Screen from Home Assistant"), body, true);
    card.id = "sp-set-screen-navigation";
    card.querySelector(".card-header")?.addEventListener("click", () => {
      if (!card.classList.contains("collapsed")) {
        // Refresh available subpage labels even when the mapping has a draft.
        renderDraft(controller.view().draft);
        void controller.load();
      }
    });
    return card;
  }
  return { ...controller, buildCard };
}
