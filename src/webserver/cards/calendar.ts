import {
    cardContractAllowInSubpage,
    cardContractCardLabel,
    cardContractDefaultConfig,
    cardContractHidden,
    cardContractPickerKey,
} from "../generated/card_contract";
import { state } from "../state/app_instance";
import { normalizeLanguage } from "../model/settings";
import type { CardRegistry } from "../application/card_registry";
import type { ConfigDateTimeOptionsFeature } from "../application/config_date_time_options";
import type { ControlsFieldsFeature } from "../application/controls_fields";
import { i18nDynamic } from "../i18n";

export function registerCalendarCardTypes(
    registry: CardRegistry,
    dateTimeOptions: ConfigDateTimeOptionsFeature,
    fields: ControlsFieldsFeature,
): void {
    const { cardBadgeLabelHtml, cardLargeNumbersHidePreviewLabel, cardSensorPreviewHtml } = fields;
    const {
        dateTimeCardTimeParts,
        metadata,
        monthNameForIndex,
        now,
    } = dateTimeOptions;

    // Emulated panel text: after a day number the panel uses the month's day-of-month
    // form ("31 października"), so format a full date and keep its month part. Some
    // languages put a word between the day and the month ("15 de enero"); the panel
    // keeps it, so keep it here too and drop only the spacing and punctuation.
    function monthNameAfterDay(date: Date, fallback: string): string {
        try {
            const parts = new Intl.DateTimeFormat(normalizeLanguage(state.language), {
                day: "numeric",
                month: "long",
                timeZone: "UTC",
            }).formatToParts(date);
            let dayIndex = -1;
            let monthIndex = -1;
            parts.forEach(function (part, index) {
                if (part.type === "day" && dayIndex < 0) dayIndex = index;
                if (part.type === "month" && monthIndex < 0) monthIndex = index;
            });
            const monthPart = parts[monthIndex];
            if (monthPart && monthPart.value) {
                let joiner = "";
                if (dayIndex >= 0 && dayIndex < monthIndex) {
                    joiner = parts.slice(dayIndex + 1, monthIndex)
                        .map(function (part) { return part.value; })
                        .join("")
                        .replace(/^[\s.,\u200e\u200f]+/, "");
                }
                return joiner + monthPart.value;
            }
        }
        catch (_error) {
            // Fall through to the standalone month name.
        }
        return fallback;
    }

    registry.register("calendar", {
        label: function () { return i18nDynamic(cardContractCardLabel("calendar")); },
        allowInSubpage: function () { return cardContractAllowInSubpage("calendar"); },
        pickerKey: function () { return cardContractPickerKey("calendar"); },
        hidden: function () { return cardContractHidden("calendar"); },
        hideLabel: true,
        defaultConfig: function () { return cardContractDefaultConfig("calendar"); },
        cardMetadata: metadata,
        onSelect: function (button?: any) {
            const defaults: any = cardContractDefaultConfig("calendar");
            Object.keys(defaults).forEach(function (key) { button[key] = defaults[key]; });
            button.precision = button.precision === "datetime" ? "datetime" : "";
        },
        renderSettings: function (panel?: any, button?: any, _slot?: any, helpers?: any) {
            if (!button.entity) button.entity = "sensor.date";
            if (button.precision !== "datetime") button.precision = "";
            helpers.renderCardModeSelector(panel, button, helpers, metadata);
            helpers.renderCardLargeNumbersToggle(panel, button, helpers, metadata);
        },
        renderPreview: function (button?: any, helpers?: any) {
            const current = now();
            const isDateTime = button.precision === "datetime";
            const hideLabel = cardLargeNumbersHidePreviewLabel(button, helpers, metadata);
            const buttonClass = hideLabel
                ? (isDateTime ? "sp-clock-wide-large" : "sp-date-time-wide-large")
                : undefined;
            const day = String(current.getUTCDate());
            const month = monthNameForIndex(current.getUTCMonth());
            if (isDateTime) {
                const time = dateTimeCardTimeParts();
                return {
                    buttonClass,
                    iconHtml: cardSensorPreviewHtml(button, helpers, time.value, time.unit),
                    labelHtml: hideLabel ? "" : cardBadgeLabelHtml(helpers, day + " " + monthNameAfterDay(current, month), metadata.preview.dateBadge),
                };
            }
            return {
                buttonClass,
                iconHtml: cardSensorPreviewHtml(button, helpers, day, null),
                labelHtml: hideLabel ? "" : cardBadgeLabelHtml(helpers, month, metadata.preview.dateBadge),
            };
        },
    });
}
