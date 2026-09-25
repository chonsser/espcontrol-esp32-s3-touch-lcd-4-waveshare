import type { AppState } from "../state/types";
import type { ConfigCodecFeature } from "./config_codec";
import type { NativePanelConfigController } from "../controllers/native_panel_config_controller";
import type { ScreenNavigationFeatureDependencies } from "./screen_navigation";
import { decodePanelConfig, isStandaloneSubpage } from "../model";

interface ScreenEditorDependencies {
  state: AppState;
  maxSlots(): number;
  whenComplete(): Promise<void>;
  native: NativePanelConfigController;
  capabilities(): Promise<boolean>;
  readDocument(): Promise<Uint8Array>;
  queueIdle(): Promise<unknown>;
  codec: Pick<ConfigCodecFeature, "parseSubpageConfig" | "buildSubpageGrid" | "serializeSubpageConfig">;
  create(slot: number): Promise<unknown>;
  select(slot: number): void;
  render(): void;
  confirm(message: string): boolean;
}

/** Replace the authority catalog after a complete accepted restore, including empty slots. */
export function resetNativeSubpageAuthority(state: AppState, subpages: Readonly<Record<string, string>> | null, maxSlots: number): void {
  state.subpageSavePending = {};
  state.subpageNativeRaw = {};
  if (subpages) {
    for (let slot = 1; slot <= maxSlots; slot++) state.subpageNativeRaw[slot] = subpages[slot] || "";
  }
}

/** Load the entire storage catalog before allocating; mutate only the selected record. */
export function createScreenNavigationEditor(deps: ScreenEditorDependencies): NonNullable<ScreenNavigationFeatureDependencies["editor"]> {
  const { state, codec } = deps;
  return {
    state, maxSlots: deps.maxSlots, create: deps.create, select: deps.select, confirm: deps.confirm,
    async ready() {
      await deps.whenComplete();
      if (await deps.native.waitForDiscovery() !== true || !await deps.capabilities()) return false;
      const document = decodePanelConfig(await deps.readDocument());
      for (let slot = 1; slot <= deps.maxSlots(); slot++) {
        if (Object.prototype.hasOwnProperty.call(state.subpageSavePending, slot)) continue;
        const raw = document.subpages[slot] || "";
        state.subpageNativeRaw[slot] = raw;
        if (state.editingSubpage === slot) continue;
        if (raw) {
          const screen = codec.parseSubpageConfig(raw);
          codec.buildSubpageGrid(screen);
          state.subpages[slot] = screen;
        } else delete state.subpages[slot];
      }
      return true;
    },
    async replace(slot, label) {
      await deps.queueIdle();
      const screen = state.subpages[slot];
      if (!isStandaloneSubpage(screen)) return "failed";
      const expected = state.subpageNativeRaw[slot] ?? codec.serializeSubpageConfig(screen);
      const next = label === null ? "" : codec.serializeSubpageConfig({ ...screen, screenLabel: label });
      const result = await deps.native.replaceStandaloneScreen(slot, expected, next);
      if (result === "saved" || result === "mirror-failed") {
        state.subpageNativeRaw[slot] = next;
        state.subpageSavePending[slot] = next;
        if (label === null) delete state.subpages[slot];
        else screen.screenLabel = label;
        if (label !== null) deps.render();
      }
      return result;
    },
  };
}
