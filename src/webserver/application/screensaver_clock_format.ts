import { state } from "../state/app_instance";
import { isValidScreensaverClockFormat, normalizeScreensaverClockFormat, normalizeScreensaverClockSize, SCREENSAVER_CLOCK_SIZES } from "../model/settings";
import { i18n } from "../i18n";
import type { ApplicationApiFeature } from "./api";
import type { UiRuntimeState } from "./state";
import type { EntityStateFeature } from "./entity_state";
import type { ControlsShellFeature } from "./controls_shell";
import type { ControlsFieldsFeature } from "./controls_fields";

const CLOCK_SETTINGS = {
    timeFormat: { entity: "screen_saver_clock_time_format", state: "screensaverClockTimeFormat", domain: "text" },
    dateFormat: { entity: "screen_saver_clock_date_format", state: "screensaverClockDateFormat", domain: "text" },
    timeSize: { entity: "screen_saver_clock_time_size", state: "screensaverClockTimeSize", domain: "select" },
    dateSize: { entity: "screen_saver_clock_date_size", state: "screensaverClockDateSize", domain: "select" },
} as const;
export type ScreensaverClockSetting = keyof typeof CLOCK_SETTINGS;
export type ScreensaverClockFormatFeature = ReturnType<typeof createScreensaverClockFormatFeature>;
type Capability = { loaded: boolean; supported: boolean; options: string[]; revision: number; metadataRevision: number; maxLength: number };

export function createScreensaverClockFormatFeature(
    runtime: UiRuntimeState,
    api: Pick<ApplicationApiFeature, "getJsonFirst" | "entityDetailPaths" | "postSelect" | "postText">,
    entities: Pick<EntityStateFeature, "entityName">,
    shell: Pick<ControlsShellFeature, "showBanner">,
) {
    const els = runtime.els;
    const keys = Object.keys(CLOCK_SETTINGS) as ScreensaverClockSetting[];
    const capabilities = {} as Record<ScreensaverClockSetting, Capability>;
    for (const key of keys) capabilities[key] = { loaded: false, supported: false, options: [], revision: 0, metadataRevision: 0, maxLength: 32 };
    let loading: Promise<void> | undefined;
    function syncUi() {
        for (const key of keys) {
            const controls = els.clockAppearanceControls?.[key];
            if (!controls) continue;
            const capability = capabilities[key];
            controls.field.hidden = !capability.supported;
            controls.sync(state[CLOCK_SETTINGS[key].state], capability.options);
        }
    }
    function applyState(key: ScreensaverClockSetting, data: any) {
        if (!data) return;
        const setting = CLOCK_SETTINGS[key];
        const capability = capabilities[key];
        if (setting.domain === "text") {
            capability.loaded = true;
            capability.supported = true;
            if (typeof data.max_length === "number") {
                capability.metadataRevision++;
                capability.maxLength = Math.min(32, Math.max(0, data.max_length));
            }
        } else {
            const advertised = data.option ?? data.options;
            if (Array.isArray(advertised)) {
                capability.metadataRevision++;
                capability.loaded = true;
                capability.options = SCREENSAVER_CLOCK_SIZES.filter(size => advertised.includes(size));
                capability.supported = capability.options.length > 0;
            }
        }
        if (data.value != null || data.state != null) {
            capability.revision++;
            state[setting.state] = setting.domain === "text"
                ? normalizeScreensaverClockFormat(data.value ?? data.state)
                : normalizeScreensaverClockSize(data.value ?? data.state);
        }
        syncUi();
    }
    function load(): Promise<void> {
        if (loading) return loading;
        loading = Promise.all(keys.filter(key => !capabilities[key].loaded || !capabilities[key].supported).map(async key => {
            const setting = CLOCK_SETTINGS[key];
            const capability = capabilities[key];
            const before = capability.revision;
            const metadataBefore = capability.metadataRevision;
            try {
                const data = await api.getJsonFirst(api.entityDetailPaths(setting.domain, [entities.entityName(setting.entity), setting.entity, setting.entity.replace("screen_saver", "screensaver")], "all"));
                if (data) {
                    const merged = { ...data };
                    if (before !== capability.revision) { delete merged.value; delete merged.state; }
                    if (metadataBefore !== capability.metadataRevision) { delete merged.option; delete merged.options; delete merged.max_length; }
                    applyState(key, merged);
                }
            } catch { /* No metadata means no permission to write. */ }
            capability.loaded = true;
        })).then(() => { syncUi(); }).finally(() => { loading = undefined; });
        return loading;
    }
    function supported(key: ScreensaverClockSetting, value: unknown): value is string {
        const capability = capabilities[key];
        if (!capability.loaded || !capability.supported) return false;
        return CLOCK_SETTINGS[key].domain === "text"
            ? isValidScreensaverClockFormat(value) && value.length <= capability.maxLength
            : typeof value === "string" && capability.options.includes(value);
    }
    async function set(key: ScreensaverClockSetting, value: unknown): Promise<boolean> {
        if (!supported(key, value)) return false;
        const setting = CLOCK_SETTINGS[key];
        const before = capabilities[key].revision;
        try {
            const response = setting.domain === "text"
                ? await api.postText(entities.entityName(setting.entity), value)
                : await api.postSelect(entities.entityName(setting.entity), value);
            if (!response?.ok) return false;
            if (before === capabilities[key].revision) state[setting.state] = value;
            return true;
        } finally { syncUi(); }
    }
    async function restore(settings: Partial<Record<typeof CLOCK_SETTINGS[ScreensaverClockSetting]["state"], unknown>>): Promise<void> {
        await load();
        for (const key of keys) {
            const setting = CLOCK_SETTINGS[key];
            const value = settings[setting.state];
            const normalized = setting.domain === "text" ? normalizeScreensaverClockFormat(value) : normalizeScreensaverClockSize(value);
            const fallback = setting.domain === "text" ? "" : "Auto";
            const selected = supported(key, normalized) ? normalized : supported(key, fallback) ? fallback : null;
            if (selected === null) {
                shell.showBanner(i18n("Clock format or text size was skipped because this firmware does not support it."), "warning");
                continue;
            }
            if (!await set(key, selected)) throw new Error(i18n("Could not restore the clock format or text size."));
        }
    }
    function buildControls(fields: Pick<ControlsFieldsFeature, "selectField" | "textInput">): HTMLElement {
        const body = document.createElement("div");
        els.clockAppearanceControls = {};
        const formatHelp = i18n("Use %H, %I, %M, %S, %d, %m, %Y or %y, digits and spaces, : . / - only. Maximum 32 characters, including the formatted result.");
        const validationMessage = i18n("Enter a numeric date or time format using the supported tokens (maximum 32 characters)." );
        for (const key of ["timeFormat", "dateFormat"] as const) {
            const isTime = key === "timeFormat";
            const id = isTime ? "sp-set-clock-time-format" : "sp-set-clock-date-format";
            const label = isTime ? i18n("Time Format") : i18n("Date Format");
            const presets = isTime ? [
                { value: "", label: i18n("Default (global 12/24-hour setting)") },
                { value: "%H:%M", label: i18n("24-hour") },
                { value: "%H:%M:%S", label: i18n("24-hour with seconds") },
                { value: "%I:%M", label: i18n("12-hour") },
                { value: "%I:%M:%S", label: i18n("12-hour with seconds") },
            ] : [
                { value: "", label: i18n("Hidden") },
                { value: "%d.%m.%Y", label: "DD.MM.YYYY" },
                { value: "%Y-%m-%d", label: "YYYY-MM-DD" },
            ];
            let custom = false;
            let dirty = false;
            let draftRevision = 0;
            let pendingRevision: number | undefined;
            function saveDraft(value: string) {
                const revision = draftRevision;
                pendingRevision = revision;
                void set(key, value).catch(() => false).finally(() => {
                    if (pendingRevision === revision) pendingRevision = undefined;
                    if (draftRevision === revision) dirty = false;
                    syncUi();
                });
            }
            const input = fields.textInput(id, state[CLOCK_SETTINGS[key].state], isTime ? "%H:%M:%S" : "%d.%m.%Y") as HTMLInputElement;
            input.maxLength = 32;
            input.setAttribute("aria-label", isTime ? i18n("Custom Time Format") : i18n("Custom Date Format"));
            const error = document.createElement("p");
            error.id = id + "-error";
            error.setAttribute("role", "alert");
            error.hidden = true;
            input.setAttribute("aria-describedby", error.id);
            const customFields = document.createElement("div");
            customFields.appendChild(input);
            const help = document.createElement("p");
            help.textContent = formatHelp;
            customFields.appendChild(help);
            customFields.appendChild(error);
            const preset = fields.selectField(label, id + "-preset", [...presets, { value: "__custom", label: i18n("Custom") }], "", function (this: HTMLSelectElement) {
                draftRevision++;
                custom = this.value === "__custom";
                customFields.hidden = !custom;
                if (custom) { input.focus(); return; }
                dirty = false;
                input.setCustomValidity("");
                input.setAttribute("aria-invalid", "false");
                error.hidden = true;
                saveDraft(this.value);
            });
            preset.field.appendChild(customFields);
            input.addEventListener("input", () => {
                draftRevision++;
                dirty = true;
                const valid = isValidScreensaverClockFormat(input.value) && input.value.length <= capabilities[key].maxLength;
                input.setCustomValidity(valid ? "" : validationMessage);
                input.setAttribute("aria-invalid", String(!valid));
                error.textContent = valid ? "" : validationMessage;
                error.hidden = valid;
            });
            input.addEventListener("blur", () => {
                if (!dirty || !input.validity.valid || pendingRevision === draftRevision) return;
                saveDraft(input.value);
            });
            input.addEventListener("keydown", event => { if (event.key === "Enter") input.blur(); });
            els.clockAppearanceControls[key] = { field: preset.field, sync(value: string) {
                if (dirty || pendingRevision !== undefined) return;
                input.value = value;
                const known = presets.some(preset => preset.value === value);
                preset.select.value = custom || !known ? "__custom" : value;
                customFields.hidden = preset.select.value !== "__custom";
            } };
            body.appendChild(preset.field);
        }
        const sizeLabels: Record<string, string> = { Auto: i18n("Auto"), Small: i18n("Small"), Medium: i18n("Medium"), Large: i18n("Large") };
        for (const key of ["timeSize", "dateSize"] as const) {
            const size = fields.selectField(key === "timeSize" ? i18n("Time Text Size") : i18n("Date Text Size"), key === "timeSize" ? "sp-set-clock-time-size" : "sp-set-clock-date-size", [], "", function (this: HTMLSelectElement) { void set(key, this.value); });
            els.clockAppearanceControls[key] = { field: size.field, sync(value: string, options: string[]) {
                size.select.innerHTML = "";
                for (const option of options) {
                    const element = document.createElement("option");
                    element.value = option;
                    element.textContent = sizeLabels[option] || option;
                    size.select.appendChild(element);
                }
                size.select.value = options.includes(value) ? value : "";
            } };
            body.appendChild(size.field);
        }
        const sizeHelp = document.createElement("p");
        sizeHelp.textContent = i18n("Larger text is reduced automatically when needed to fit the screen without clipping.");
        body.appendChild(sizeHelp);
        syncUi();
        return body;
    }
    return { load, applyState, syncUi, set, restore, buildControls };
}
