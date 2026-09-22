import { i18n } from "../i18n";
import {
  parseScreenNavigationRules, serializeScreenNavigationRules, validateScreenNavigationEntity,
  screenNavigationSettingsFromBackup, screenNavigationBackupSettings,
  type ScreenNavigationRule, type ScreenNavigationSettings,
} from "../model/screen_navigation";

export interface ScreenNavigationDraft { entity: string; rows: ScreenNavigationRule[]; wake: boolean }
export interface ScreenNavigationView {
  status: "idle" | "loading" | "ready" | "saving" | "saved" | "error" | "unsupported";
  draft: ScreenNavigationDraft;
  dirty: boolean;
  supported: boolean;
  message: string;
}
export interface ScreenNavigationController {
  view(): ScreenNavigationView;
  subscribe(listener: () => void): () => void;
  load(): Promise<void>;
  edit(change: Partial<ScreenNavigationDraft>): void;
  save(): Promise<boolean>;
  backup(): Promise<Record<string, unknown>>;
  suspendForRestore(settings?: Record<string, unknown>): Promise<void>;
  restore(settings: Record<string, unknown>): Promise<void>;
}
export interface ScreenNavigationDependencies {
  read(): Promise<ScreenNavigationSettings | null>;
  write(key: keyof ScreenNavigationSettings, value: string | boolean): Promise<boolean>;
  targets(): readonly number[];
}

export function createScreenNavigationController(dependencies: ScreenNavigationDependencies): ScreenNavigationController {
  let state: Omit<ScreenNavigationView, "supported"> = { status: "idle", draft: { entity: "", rows: [], wake: true }, dirty: false, message: "" };
  let supported = false;
  let revision = 0;
  let reading: Promise<void> | null = null;
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach(listener => listener());
  const errorMessage = () => i18n("Screen navigation could not be saved and may be disabled. Check the connection, then save again.");
  const checkedWrite = async (key: keyof ScreenNavigationSettings, value: string | boolean) => {
    if (!await dependencies.write(key, value)) throw new Error(errorMessage());
  };
  const writeSettings = async (settings: ScreenNavigationSettings) => {
    // Keep the old HA source from seeing any part of the new mapping, including
    // when a request fails or the source has changed outside this browser.
    await checkedWrite("entity", "");
    await checkedWrite("rules", settings.rules);
    await checkedWrite("wake", settings.wake);
    if (settings.entity) await checkedWrite("entity", settings.entity);
  };
  const controller: ScreenNavigationController = {
    view: () => ({ ...state, supported, draft: { ...state.draft, rows: state.draft.rows.map(row => ({ ...row })) } }),
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    async load() {
      if (reading) return reading;
      if (state.dirty || state.status === "saving") return;
      const startedRevision = revision;
      state.status = "loading";
      state.message = "";
      notify();
      reading = (async () => {
        try {
          const saved = await dependencies.read();
          supported = saved !== null;
          if (startedRevision !== revision) return;
          if (!saved) {
            state.status = "unsupported";
            state.message = i18n("Update the panel firmware to use screen navigation from Home Assistant.");
          } else {
            // Deleted targets remain visible for correction, but cannot be saved.
            state.draft = { entity: saved.entity, rows: parseScreenNavigationRules(saved.rules), wake: saved.wake };
            state.status = "ready";
          }
        } catch (error) {
          if (startedRevision === revision) {
            state.status = "error";
            state.message = error instanceof Error ? error.message : i18n("Could not load screen navigation. Check the connection and try again.");
          }
        } finally { reading = null; notify(); }
      })();
      return reading;
    },
    edit(change) {
      revision += 1;
      state.draft = { ...state.draft, ...change };
      state.dirty = true;
      if (state.status !== "saving") state.status = "ready";
      state.message = "";
      notify();
    },
    async save() {
      if (!supported || state.status === "saving") return false;
      let saved: ScreenNavigationSettings;
      try {
        saved = { entity: validateScreenNavigationEntity(state.draft.entity), rules: serializeScreenNavigationRules(state.draft.rows, dependencies.targets()), wake: state.draft.wake };
      } catch (error) {
        state.status = "error";
        state.message = (error as Error).message;
        notify();
        return false;
      }
      const savingRevision = ++revision;
      state.status = "saving";
      state.message = "";
      notify();
      try {
        await writeSettings(saved);
        if (savingRevision === revision) {
          state.dirty = false;
          state.status = "saved";
          state.message = i18n("Screen navigation saved.");
        } else state.status = "ready";
        return true;
      } catch {
        state.status = "error";
        state.message = errorMessage();
        state.dirty = true;
        return false;
      } finally { notify(); }
    },
    async backup() {
      const saved = await dependencies.read();
      return saved ? screenNavigationBackupSettings(saved) : {};
    },
    async suspendForRestore(settings = {}) {
      const saved = await dependencies.read();
      if (!saved && settings.screen_navigation_entity) {
        throw new Error(i18n("Update the panel firmware to use screen navigation from Home Assistant."));
      }
      if (saved) await checkedWrite("entity", "");
    },
    async restore(settings) {
      const saved = await dependencies.read();
      if (!saved) {
        if (settings.screen_navigation_entity) throw new Error(i18n("Update the panel firmware to use screen navigation from Home Assistant."));
        return;
      }
      const restored = screenNavigationSettingsFromBackup(settings);
      parseScreenNavigationRules(restored.rules, dependencies.targets());
      await writeSettings(restored);
      revision += 1;
      state = { status: "ready", draft: { entity: restored.entity, rows: parseScreenNavigationRules(restored.rules), wake: restored.wake }, dirty: false, message: "" };
      supported = true;
      notify();
    },
  };
  return controller;
}
