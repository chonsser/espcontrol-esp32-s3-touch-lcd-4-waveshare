import type { AppState } from "../state/types";
import { CARD_SIZE_LARGE, CARD_SIZE_SINGLE, CARD_SIZE_WIDE } from "../model/grid";
import { isValidScreensaverClockFormat, normalizeLanguage, normalizeScreensaverClockFormat } from "../model/settings";
import { cardContractOptionSpec } from "./config_option_core";
import { i18n, i18nDevice } from "../i18n";
import { configOptionValue, setConfigOptionValue } from "../model/config_primitives";

export interface ConfigDateTimeOptionsDependencies {
    readonly state: AppState;
    readonly now: () => Date;
    readonly renderButtonSettings: () => void;
    readonly renderPreview?: () => void;
    readonly effectiveTimezoneOption: (value: string) => string;
    readonly timezoneId: (value: string) => string;
    readonly timezoneOptionsWithFallback: (options: readonly string[], selected: string) => readonly string[];
    readonly appendTimezoneOption: (select: HTMLSelectElement, option: string) => void;
    readonly monthNameForIndex: (index: number) => string;
}

export function createConfigDateTimeOptionsFeature(dependencies: ConfigDateTimeOptionsDependencies) {
    function dateTimeCardMode(this: any, button?: any) {
        if (button && button.type === "clock") return "clock";
        if (button && button.type === "timezone") return "timezone";
        return button && button.precision === "datetime" ? "datetime" : "";
    }

    function dateTimeTextSize(button: any): string {
        const size = configOptionValue(button && button.options, "text_size");
        return size === "small" || size === "medium" || size === "large" ? size : "";
    }

    function renderTextSizeSelector(panel: any, button: any, helpers: any): void {
        const field = helpers.selectField(i18n("Text size"), helpers.idPrefix + "date-time-text-size", [
            { value: "", label: i18n("Auto") },
            { value: "small", label: i18n("Small") },
            { value: "medium", label: i18n("Medium") },
            { value: "large", label: i18n("Large") },
        ], dateTimeTextSize(button), function (this: HTMLSelectElement) {
            button.options = setConfigOptionValue(button.options, "text_size", this.value);
            helpers.saveField("options", button.options);
            dependencies.renderButtonSettings();
        });
        panel.appendChild(field.field);
    }

    // Drafts belong to the existing card-editor draft object, never persisted options.
    // Weak keys retain even invalid input across a size-triggered editor rebuild.
    const clockFormatDrafts = new WeakMap<object, Record<string, { value: string; custom: boolean }>>();

    function renderClockAppearance(panel: HTMLElement, button: any, helpers: any): void {
        const saveOption = (key: string, value: string, preserveWhitespace = false) => {
            button.options = setConfigOptionValue(button.options, key, value, preserveWhitespace);
            helpers.saveField("options", button.options);
            dependencies.renderPreview?.();
        };
        const font = helpers.selectField(i18n("Clock Font"), helpers.idPrefix + "clock-font", [
            { value: "", label: i18n("Default") },
            { value: "thin", label: i18n("Thin") },
            { value: "bold", label: i18n("Bold") },
            { value: "mono", label: i18n("Monospace") },
        ], clockCardFont(button), function (this: HTMLSelectElement) { saveOption("clock_font", this.value); });
        panel.appendChild(font.field);
        const fontHelp = document.createElement("p");
        fontHelp.className = "sp-clock-format-help";
        fontHelp.textContent = i18n("Font preview is approximate; the panel uses its built-in clock fonts.");
        font.field.appendChild(fontHelp);
        let drafts = clockFormatDrafts.get(button);
        if (!drafts) { drafts = {}; clockFormatDrafts.set(button, drafts); }
        const validationMessage = i18n("Enter a numeric date or time format using the supported tokens (maximum 32 characters).");
        for (const key of ["time_format", "date_format"] as const) {
            const isTime = key === "time_format";
            const id = helpers.idPrefix + (isTime ? "clock-time-format" : "clock-date-format");
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
            const saved = configOptionValue(button.options, key);
            const draft = drafts[key] ||= { value: saved, custom: !presets.some(preset => preset.value === saved) };
            const input = helpers.textInput(id, draft.value, isTime ? "%H:%M:%S" : "%d.%m.%Y") as HTMLInputElement;
            input.maxLength = 32;
            input.setAttribute("aria-label", isTime ? i18n("Custom Time Format") : i18n("Custom Date Format"));
            input.autocomplete = "off";
            input.spellcheck = false;
            const customFields = document.createElement("div");
            customFields.hidden = !draft.custom;
            customFields.appendChild(input);
            const help = document.createElement("p");
            help.id = id + "-help";
            help.className = "sp-clock-format-help";
            help.textContent = i18n("Use %H, %I, %M, %S, %d, %m, %Y or %y, digits and spaces, : . / - only. Maximum 32 characters, including the formatted result.");
            customFields.appendChild(help);
            const error = document.createElement("p");
            error.id = id + "-format-error";
            error.className = "sp-clock-format-error";
            error.setAttribute("role", "alert");
            customFields.appendChild(error);
            const validate = () => {
                const valid = !draft.custom || isValidScreensaverClockFormat(input.value);
                input.setCustomValidity(valid ? "" : validationMessage);
                input.setAttribute("aria-invalid", String(!valid));
                input.setAttribute("aria-describedby", help.id + (valid ? "" : " " + error.id));
                error.textContent = valid ? "" : validationMessage;
                error.hidden = valid;
                return valid;
            };
            const preset = helpers.selectField(isTime ? i18n("Time Format") : i18n("Date Format"), id + "-preset", [
                ...presets, { value: "__custom", label: i18n("Custom") },
            ], draft.custom ? "__custom" : draft.value, function (this: HTMLSelectElement) {
                draft.custom = this.value === "__custom";
                customFields.hidden = !draft.custom;
                if (draft.custom) { validate(); input.focus(); return; }
                draft.value = input.value = this.value;
                helpers.clearFieldError?.(input);
                validate();
                saveOption(key, this.value, true);
            });
            preset.field.appendChild(customFields);
            panel.appendChild(preset.field);
            // Register with the real builder validation; blank is a valid Default/Hidden.
            helpers.requireField?.(input, validationMessage, () => draft.custom, (value: unknown) => isValidScreensaverClockFormat(value));
            input.addEventListener("input", () => {
                draft.value = input.value;
                helpers.saveField("options", button.options); // Invalid drafts still mark the editor dirty.
                if (validate()) saveOption(key, input.value, true);
            });
            validate();
        }
        const dateSize = helpers.selectField(i18n("Date Text Size"), helpers.idPrefix + "clock-date-size", [
            { value: "", label: i18n("Auto") },
            { value: "small", label: i18n("Small") },
            { value: "medium", label: i18n("Medium") },
            { value: "large", label: i18n("Large") },
        ], clockCardDateSize(button), function (this: HTMLSelectElement) { saveOption("date_size", this.value); });
        panel.appendChild(dateSize.field);
    }

    function textSizePreviewClass(button: any): string | undefined {
        const size = dateTimeTextSize(button);
        return size ? "sp-date-time-text sp-date-time-text-" + size : undefined;
    }

    function dateTimeLargeNumbersLabel(this: any, button?: any) {
        const mode = dateTimeCardMode(button);
        if (mode === "clock") return i18n("Large Clock");
        if (mode === "datetime") return i18n("Large Time");
        if (mode === "timezone") return i18n("Large World Clock");
        return i18n("Large Date");
    }

    function defaultTimezoneCardEntity(this: any) {
        return dependencies.state.timezone || "UTC (GMT+0)";
    }

    function dateTimeModeOptionValues(this: any) {
        const spec: any = cardContractOptionSpec("calendar", "date_time_mode");
        return spec && spec.values ? spec.values.slice() : [];
    }

    function normalizeDateTimeCardMode(this: any, mode?: any) {
        mode = String(mode || "");
        return dateTimeModeOptionValues().indexOf(mode) >= 0 ? mode : "";
    }

    function setDateTimeCardMode(this: any, button?: any, mode?: any, helpers?: any) {
        mode = normalizeDateTimeCardMode(mode);
        if (button.type !== "timezone" && button.type !== "clock" && mode !== "timezone" && mode !== "clock") {
            button.precision = mode === "datetime" ? "datetime" : "";
            helpers.saveField("precision", button.precision);
            return;
        }
        if (mode === "clock") {
            button.type = "clock";
            helpers.applyCardMetadataFields(button, helpers, {
                type: "clock", entity: "", label: "", icon: "Auto", icon_on: "Auto",
                sensor: "", unit: "", precision: "", options: button.options,
            });
            dependencies.renderButtonSettings();
            return;
        }
        if (mode === "timezone") {
            button.type = "timezone";
            helpers.applyCardMetadataFields(button, helpers, {
                type: "timezone", entity: defaultTimezoneCardEntity, label: "", icon: "Auto", icon_on: "Auto",
                sensor: "", unit: "", precision: "", options: button.options,
            });
            dependencies.renderButtonSettings();
            return;
        }
        button.type = "calendar";
        helpers.applyCardMetadataFields(button, helpers, {
            type: "calendar", entity: "sensor.date", label: "", icon: "Auto", icon_on: "Auto",
            sensor: "", unit: "", precision: mode === "datetime" ? "datetime" : "", options: button.options,
        });
        if (mode !== "datetime") button.precision = "";
        dependencies.renderButtonSettings();
    }

    function dateTimeCardTimeParts(this: any) {
        const now = dependencies.now();
        const use12h = dependencies.state.clockFormat === "12h";
        const hour = now.getUTCHours();
        const minute = String(now.getUTCMinutes()).padStart(2, "0");
        if (use12h) {
            const hour12 = hour % 12 || 12;
            return { value: String(hour12) + ":" + minute, unit: "" };
        }
        return { value: String(hour).padStart(2, "0") + ":" + minute, unit: "" };
    }

    function clockCardFont(button: any): string {
        const font = configOptionValue(button.options, "clock_font");
        return font === "thin" || font === "bold" || font === "mono" ? font : "";
    }

    function clockCardDateSize(button: any): string {
        const size = configOptionValue(button.options, "date_size");
        return size === "small" || size === "medium" || size === "large" ? size : "";
    }

    function clockCardTimeParts(button: any): { value: string; date: string; unit: string } {
        const now = dependencies.now();
        const parts: Record<string, string> = {
            hour: String(now.getUTCHours()).padStart(2, "0"),
            minute: String(now.getUTCMinutes()).padStart(2, "0"),
            second: String(now.getUTCSeconds()).padStart(2, "0"),
            day: String(now.getUTCDate()).padStart(2, "0"),
            month: String(now.getUTCMonth() + 1).padStart(2, "0"),
            year: String(now.getUTCFullYear()),
        };
        try {
            const timeZone = dependencies.timezoneId(dependencies.effectiveTimezoneOption(dependencies.state.timezone || "UTC"));
            // Firmware's numeric glyph set is Gregorian/ASCII, independent of browser locale.
            const formatted = new Intl.DateTimeFormat("en-US-u-ca-gregory-nu-latn", {
                timeZone, hourCycle: "h23", hour: "2-digit", minute: "2-digit", second: "2-digit",
                day: "2-digit", month: "2-digit", year: "numeric",
            }).formatToParts(now);
            for (const part of formatted) if (part.type !== "literal") parts[part.type] = part.value;
        } catch (_error) { /* Match the clock bar's UTC fallback for unknown zones. */ }
        const hour12 = String(Number(parts.hour) % 12 || 12);
        const tokens: Record<string, string> = {
            H: parts.hour!, I: hour12.padStart(2, "0"), M: parts.minute!, S: parts.second!,
            d: parts.day!, m: parts.month!, Y: parts.year!, y: parts.year!.slice(-2),
        };
        const expand = (format: string) => format.replace(/%([HIMSdmYy])/g, (_match, token: string) => tokens[token]!);
        const timeFormat = normalizeScreensaverClockFormat(configOptionValue(button.options, "time_format"));
        const dateFormat = normalizeScreensaverClockFormat(configOptionValue(button.options, "date_format"));
        return {
            value: timeFormat ? expand(timeFormat) : (dependencies.state.clockFormat === "12h" ? hour12 : parts.hour) + ":" + parts.minute,
            date: dateFormat ? expand(dateFormat) : "",
            unit: "",
        };
    }

    function timezoneCardCityLabel(this: any, timezoneOption?: any) {
        const timezoneId = dependencies.timezoneId(dependencies.effectiveTimezoneOption(timezoneOption || ""));
        if (!timezoneId) return i18nDevice("World Clock");
        if (timezoneId === "UTC") return "UTC";
        return timezoneId.substring(timezoneId.lastIndexOf("/") + 1).replace(/_/g, " ");
    }

    // Emulated panel text follows the device language, like monthNameForIndex().
    function timezoneCardTimeLocale(this: any) {
        try {
            return Intl.DateTimeFormat.supportedLocalesOf([normalizeLanguage(dependencies.state.language)])[0] || "en-US";
        }
        catch (_error) {
            return "en-US";
        }
    }

    function timezoneCardTimeParts(this: any, timezoneOption?: any) {
        const use12h = dependencies.state.clockFormat === "12h";
        const timezoneId = dependencies.timezoneId(dependencies.effectiveTimezoneOption(timezoneOption || "UTC"));
        try {
            const options: any = { timeZone: timezoneId, hour: "numeric", minute: "2-digit" };
            if (use12h) options.hour12 = true;
            else options.hourCycle = "h23";
            const parts = new Intl.DateTimeFormat(timezoneCardTimeLocale(), options).formatToParts(dependencies.now());
            let hour = "";
            let minute = "";
            for (const part of parts) {
                if (part.type === "hour") hour = part.value;
                else if (part.type === "minute") minute = part.value;
            }
            if (!hour || !minute) return { value: "--:--", unit: "" };
            return { value: (use12h ? hour : hour.padStart(2, "0")) + ":" + minute, unit: "" };
        }
        catch (_error) {
            return { value: "--:--", unit: "" };
        }
    }

    const metadata: any = {
        mode: {
            label: i18n("Type"),
            idSuffix: "calendar-mode",
            options: [
                { value: "clock", label: i18n("Clock") },
                { value: "datetime", label: i18n("Time & Date") },
                { value: "", label: i18n("Date") },
                { value: "timezone", label: i18n("World Clock") },
            ],
            value: function (button?: any) { return dateTimeCardMode(button); },
            onChange: function (this: any, button?: any, helpers?: any) {
                setDateTimeCardMode(button, this.value, helpers);
            },
        },
        largeNumbers: {
            isVisible: (button: any) => !dateTimeTextSize(button),
            label: function (button?: any) { return dateTimeLargeNumbersLabel(button); },
            idSuffix: "large-date-time-numbers",
            supportedCardSize: function (button?: any, helpers?: any) {
                const cardSize = (helpers && helpers.cardSize) || CARD_SIZE_SINGLE;
                return dateTimeCardMode(button) === "clock"
                    ? cardSize === CARD_SIZE_WIDE || cardSize === CARD_SIZE_LARGE
                    : cardSize === CARD_SIZE_LARGE;
            },
            hideLabel: function (_button?: any, helpers?: any) {
                return ((helpers && helpers.cardSize) || CARD_SIZE_SINGLE) === CARD_SIZE_WIDE;
            },
        },
        preview: { dateBadge: "calendar-month", timezoneBadge: "map-clock" },
    };

    return {
        appendTimezoneOption: dependencies.appendTimezoneOption,
        dateTimeCardMode,
        dateTimeCardTimeParts,
        clockCardTimeParts,
        clockCardFont,
        clockCardDateSize,
        dateTimeLargeNumbersLabel,
        dateTimeModeOptionValues,
        dateTimeTextSize,
        renderTextSizeSelector,
        renderClockAppearance,
        textSizePreviewClass,
        defaultTimezoneCardEntity,
        metadata,
        monthNameForIndex: dependencies.monthNameForIndex,
        now: dependencies.now,
        normalizeDateTimeCardMode,
        setDateTimeCardMode,
        timezoneCardCityLabel,
        timezoneCardTimeParts,
        timezoneOptionsFor(selected: string) {
            return dependencies.timezoneOptionsWithFallback(dependencies.state.timezoneOptions || [], selected);
        },
    };
}

export type ConfigDateTimeOptionsFeature = ReturnType<typeof createConfigDateTimeOptionsFeature>;
