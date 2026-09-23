import { state } from "../state/app_instance";
import { normalizeScreensaverAction, screensaverActionOption } from "../model/settings";
import { i18n } from "../i18n";
import type { ApplicationApiFeature } from "./api";
import type { UiRuntimeState } from "./state";
import type { EntityStateFeature } from "./entity_state";
import type { ControlsShellFeature } from "./controls_shell";

export type ScreensaverHlsFeature = ReturnType<typeof createScreensaverHlsFeature>;

export function validHlsUrl(value: unknown): value is string {
    if (typeof value !== "string" || value.length > 255) return false;
    if (value === "") return true;
    const authority = value.match(/^https?:\/\/([^/?]+)/)?.[1];
    if (!authority || /[%@]/.test(authority) || authority.endsWith(":") || /[^\x21-\x7e]|[\\#]/.test(value)) return false;
    try {
        const url = new URL(value);
        return !!url.hostname && url.port !== "0" && !url.username && !url.password && !url.hash;
    } catch { return false; }
}

export function createScreensaverHlsFeature(
    runtime: UiRuntimeState,
    api: Pick<ApplicationApiFeature, "getJsonFirst" | "entityDetailPaths" | "postSelect" | "postTextWithObjectIds">,
    entities: Pick<EntityStateFeature, "entityName" | "entityObjectIds">,
    shell: Pick<ControlsShellFeature, "showBanner">,
    changed: () => void,
) {
    let loading: Promise<void> | undefined;
    let actionRevision = 0, metadataRevision = 0, urlRevision = 0;
    let field: HTMLDivElement | undefined, input: HTMLInputElement | undefined;
    let status: HTMLOutputElement | undefined, save: HTMLButtonElement | undefined;
    let dirty = false, saving = false;
    const els = runtime.els;
    function supported() {
        return state.screensaverHlsUrlAvailable && state.screensaverActionOptions.includes("HLS Stream");
    }
    function syncUi() {
        for (const select of [els.setClockSelect, els.setSensorClockSelect]) {
            if (!select) continue;
            let option = select.querySelector('option[value="hls"]');
            if (supported() && !option) {
                option = document.createElement("option");
                option.value = "hls"; option.textContent = i18n("HLS Stream");
                select.appendChild(option);
            } else if (!supported() && option) option.remove();
            select.value = state.screensaverAction;
        }
        if (field) field.hidden = !supported();
        if (input && !dirty) input.value = state.screensaverHlsUrl;
        if (save) save.disabled = saving || !supported();
        if (status) status.textContent = state.screensaverHlsStatus || i18n("Not playing");
    }
    function notify() { syncUi(); changed(); }
    function applyAction(data: any) {
        if (!data) return;
        const options = data.option ?? data.options;
        if (Array.isArray(options)) {
            metadataRevision++;
            state.screensaverActionOptions = options.filter((value: unknown) => typeof value === "string");
        }
        if (data.value != null || data.state != null) {
            actionRevision++;
            state.screensaverAction = normalizeScreensaverAction(data.value ?? data.state);
            state._screensaverActionReceived = true;
        }
        notify();
    }
    function applyUrl(data: any) {
        const value = data?.value ?? data?.state;
        if (typeof value !== "string") return;
        urlRevision++;
        state.screensaverHlsUrlAvailable = true;
        state.screensaverHlsUrl = value;
        notify();
    }
    function applyStatus(data: any) {
        state.screensaverHlsStatus = String(data?.value ?? data?.state ?? "");
        syncUi();
    }
    function load(): Promise<void> {
        if (loading) return loading;
        const before = actionRevision, metadataBefore = metadataRevision, urlBefore = urlRevision;
        const read = (domain: string, key: string) => api.getJsonFirst(api.entityDetailPaths(domain,
            [entities.entityName(key), ...entities.entityObjectIds(key)], "all"));
        loading = Promise.all([
            read("select", "screen_saver_action").then(data => {
                if (!data) return;
                const merged = { ...data };
                if (before !== actionRevision) { delete merged.value; delete merged.state; }
                if (metadataBefore !== metadataRevision) { delete merged.option; delete merged.options; }
                applyAction(merged);
            }).catch(() => {}),
            read("text", "screen_saver_hls_url").then(data => {
                if (urlBefore === urlRevision) applyUrl(data);
            }).catch(() => {}),
        ]).then(() => {}).finally(() => { loading = undefined; notify(); });
        return loading;
    }
    async function saveUrl(value: unknown): Promise<boolean> {
        if (!supported() || !validHlsUrl(value)) return false;
        const before = urlRevision;
        try {
            const response = await api.postTextWithObjectIds(entities.entityName("screen_saver_hls_url"),
                entities.entityObjectIds("screen_saver_hls_url"), value);
            if (!response?.ok) return false;
            if (before === urlRevision) {
                urlRevision++;
                state.screensaverHlsUrl = value;
            }
            return true;
        } catch { return false; }
        finally { notify(); }
    }
    async function setAction(value: string): Promise<boolean> {
        const action = normalizeScreensaverAction(value);
        if (action === "hls" && (!supported() || !state.screensaverHlsUrl || !validHlsUrl(state.screensaverHlsUrl))) {
            shell.showBanner(i18n("Save a valid HLS URL before enabling the video screensaver."), "warning");
            syncUi(); return false;
        }
        const before = actionRevision;
        try {
            const response = await api.postSelect(entities.entityName("screen_saver_action"), screensaverActionOption(action));
            if (!response?.ok) return false;
            if (before === actionRevision) {
                actionRevision++;
                state.screensaverAction = action;
                state._screensaverActionReceived = true;
            }
            return true;
        } catch { return false; }
        finally { notify(); }
    }
    async function restoreUrl(value: unknown, requestedAction: string): Promise<string> {
        await load();
        const action = normalizeScreensaverAction(requestedAction);
        if (!supported()) {
            if (action === "hls") shell.showBanner(i18n("HLS was skipped because this firmware does not support video screensavers."), "warning");
            return action === "hls" ? "off" : action;
        }
        const url = value == null ? "" : value;
        if (!validHlsUrl(url) || (action === "hls" && !url)) throw new Error(i18n("Invalid HLS URL in backup."));
        if (!await saveUrl(url)) throw new Error(i18n("Could not restore the HLS URL."));
        return action;
    }
    function buildControls() {
        field = document.createElement("div"); field.className = "sp-field";
        const label = document.createElement("label"); label.htmlFor = "sp-set-hls-url";
        label.textContent = i18n("HLS Stream URL"); field.appendChild(label);
        input = document.createElement("input"); input.id = "sp-set-hls-url";
        input.type = "url"; input.className = "sp-input"; input.maxLength = 255;
        input.autocomplete = "off"; input.spellcheck = false;
        input.placeholder = "http://server/live.m3u8";
        input.addEventListener("input", () => { dirty = true; input!.setCustomValidity(""); });
        field.appendChild(input);
        const help = document.createElement("p"); help.className = "sp-help";
        help.textContent = i18n("Save the URL first, then select HLS Stream. Unencrypted MPEG-TS, H.264 constrained baseline, up to 320×192 and 15 fps, one reference frame, no B-frames or audio. Maximum URL length: 255 characters. Playback errors fall back to the clock.");
        field.appendChild(help);
        save = document.createElement("button"); save.type = "button"; save.className = "sp-btn";
        save.textContent = i18n("Save");
        save.addEventListener("click", async () => {
            const value = input!.value.trim();
            if (!validHlsUrl(value)) {
                input!.setCustomValidity(i18n("Enter an HTTP or HTTPS URL without credentials, spaces or a fragment."));
                input!.reportValidity(); return;
            }
            saving = true; syncUi();
            const ok = await saveUrl(value);
            if (ok && input!.value.trim() === value) dirty = false;
            if (!ok) shell.showBanner(i18n("Could not save the HLS URL. Your draft has been kept."), "error");
            saving = false; syncUi();
        });
        field.appendChild(save);
        status = document.createElement("output"); status.setAttribute("aria-live", "polite");
        field.appendChild(status); syncUi(); return field;
    }
    return { supported, load, applyAction, applyUrl, applyStatus, syncUi, saveUrl, setAction, restoreUrl, buildControls };
}
