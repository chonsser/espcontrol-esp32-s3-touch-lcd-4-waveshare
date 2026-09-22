import { cardContractOptionSpec } from "./config_option_core";
import { i18n } from "../i18n";

export function coverCommandMode(mode?: unknown): boolean {
    return mode === "open" || mode === "close" || mode === "stop" || mode === "set_position";
}

export function coverModeOptionValues(allowCommands?: unknown): string[] {
    const spec: any = cardContractOptionSpec("cover", "cover_mode");
    const values: string[] = spec && spec.values
        ? spec.values.slice()
        : ["modal", "", "tilt", "toggle", "open", "close", "stop", "set_position"];
    return values.filter((value) => !!allowCommands || !coverCommandMode(value));
}

export function normalizeCoverMode(mode?: unknown, allowCommands?: unknown): string {
    const value = String(mode || "");
    return coverModeOptionValues(allowCommands).indexOf(value) >= 0 ? value : "";
}

export function coverModeOptionsForSettings(_currentMode?: unknown): string[][] {
    return [
        ["modal", i18n("All Controls")],
        ["", i18n("Slider: Position")],
        ["tilt", i18n("Slider: Tilt")],
        ["toggle", i18n("Toggle")],
        ["open", i18n("Open")],
        ["close", i18n("Close")],
        ["stop", i18n("Stop")],
        ["set_position", i18n("Set Position")],
    ];
}

export function normalizeCoverPosition(value?: unknown): string {
    let parsed = parseInt(String(value), 10);
    const spec: any = cardContractOptionSpec("cover", "cover_position") || {};
    let fallback = parseInt(spec.defaultValue, 10);
    const min = typeof spec.min === "number" ? spec.min : 0;
    const max = typeof spec.max === "number" ? spec.max : 100;
    if (!isFinite(fallback)) fallback = 50;
    if (!isFinite(parsed)) parsed = fallback;
    if (parsed < min) parsed = min;
    if (parsed > max) parsed = max;
    return String(parsed);
}
