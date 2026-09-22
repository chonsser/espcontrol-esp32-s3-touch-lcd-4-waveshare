import { state } from "../state/app_instance";
import { normalizeScreensaverClockFont, SCREENSAVER_CLOCK_FONTS } from "../model/settings";
import { i18n } from "../i18n";
import type { ApplicationApiFeature } from "./api";
import type { UiRuntimeState } from "./state";
import type { EntityStateFeature } from "./entity_state";
import type { ControlsShellFeature } from "./controls_shell";

export type ScreensaverClockFontFeature = ReturnType<typeof createScreensaverClockFontFeature>;

export function createScreensaverClockFontFeature(
    runtime: UiRuntimeState,
    api: Pick<ApplicationApiFeature, "getJsonFirst" | "entityDetailPaths" | "postSelect">,
    entities: Pick<EntityStateFeature, "entityName">,
    shell: Pick<ControlsShellFeature, "showBanner">,
) {
    const els = runtime.els;
    let loading: Promise<void> | undefined;
    let revision = 0;
    let metadataRevision = 0;
    function supported(value: unknown): value is string {
        return state.screensaverClockFontLoaded && typeof value === "string" && state.screensaverClockFontOptions.includes(value);
    }
    function syncUi() {
        const select = els.setScreensaverClockFont;
        const field = els.setScreensaverClockFontField;
        if (field) field.hidden = !state.screensaverClockFontOptions.length;
        if (!select) return;
        select.innerHTML = "";
        for (const font of state.screensaverClockFontOptions) {
            const option = document.createElement("option");
            option.value = font;
            option.textContent = font;
            select.appendChild(option);
        }
        select.value = supported(state.screensaverClockFont) ? state.screensaverClockFont : "";
        select.disabled = !state.screensaverClockFontLoaded || !state.screensaverClockFontOptions.length;
    }
    function applyState(data: any) {
        if (!data) return;
        // State-only SSE events do not revoke already discovered options.
        const options = data.option ?? data.options;
        if (Array.isArray(options)) {
            metadataRevision++;
            state.screensaverClockFontOptions = SCREENSAVER_CLOCK_FONTS.filter(font => options.includes(font));
            state.screensaverClockFontLoaded = true;
        }
        if (data.value != null || data.state != null) {
            revision++;
            state.screensaverClockFont = normalizeScreensaverClockFont(data.value ?? data.state);
        }
        syncUi();
    }
    function load(): Promise<void> {
        if (loading) return loading;
        if (state.screensaverClockFontLoaded && state.screensaverClockFontOptions.length) return Promise.resolve();
        const before = revision;
        const metadataBefore = metadataRevision;
        loading = api.getJsonFirst(api.entityDetailPaths("select", [
            entities.entityName("screen_saver_clock_font"), "screen_saver_clock_font", "screensaver_clock_font",
        ], "all")).then(data => {
            if (!data) return;
            // Merge metadata independently: a state-only SSE must not discard GET options.
            const merged = { ...data };
            if (revision !== before) { delete merged.value; delete merged.state; }
            if (metadataRevision !== metadataBefore) { delete merged.option; delete merged.options; }
            applyState(merged);
        }).catch(() => {
            // Missing or unreachable metadata is never permission to POST.
        }).finally(() => {
            state.screensaverClockFontLoaded = true;
            loading = undefined;
            syncUi();
        });
        return loading;
    }
    async function setFont(value: unknown): Promise<boolean> {
        if (!supported(value)) { syncUi(); return false; }
        const before = revision;
        try {
            const response = await api.postSelect(entities.entityName("screen_saver_clock_font"), value);
            if (!response?.ok) return false;
            if (revision === before) state.screensaverClockFont = value;
            return true;
        } finally { syncUi(); }
    }
    async function restore(value: unknown): Promise<void> {
        await load();
        const font = normalizeScreensaverClockFont(value);
        const selected = supported(font) ? font : supported("Roboto Thin") ? "Roboto Thin" : null;
        if (!selected) {
            shell.showBanner(i18n("Clock font was skipped because this firmware does not support the requested font or Roboto Thin."), "warning");
            return;
        }
        if (!await setFont(selected)) throw new Error(i18n("Could not restore the clock font."));
    }
    return { load, applyState, syncUi, setFont, restore };
}
