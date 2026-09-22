import {
    cardContractAllowInSubpage,
    cardContractCard,
    cardContractCardLabel,
    cardContractDefaultConfig,
    cardContractDomains,
    cardContractHidden,
    cardContractPickerKey,
} from "../generated/card_contract";
import type { CardRegistry } from "../application/card_registry";
import type { ConfigDateTimeOptionsFeature } from "../application/config_date_time_options";
import type { ControlsFieldsFeature } from "../application/controls_fields";
import { i18nDynamic } from "../i18n";
import { configOptionValue } from "../model/config_primitives";

export function registerClockCardTypes(
    registry: CardRegistry,
    dateTimeOptions: ConfigDateTimeOptionsFeature,
    fields: ControlsFieldsFeature,
): void {
    const { cardLargeNumbersHidePreviewLabel, cardSensorPreviewHtml } = fields;
    const { clockCardTimeParts, metadata } = dateTimeOptions;
    // Read-only local clock card: displays the panel's local time only.
    registry.register("clock", {
        label: function (this: any) { return i18nDynamic(cardContractCardLabel("clock")); },
        allowInSubpage: function (this: any) { return cardContractAllowInSubpage("clock"); },
        pickerKey: function (this: any) { return cardContractPickerKey("clock"); },
        hidden: function (this: any) { return cardContractHidden("clock"); },
        hideLabel: true,
        defaultConfig: function (this: any) { return cardContractDefaultConfig("clock"); },
        isAvailable: function (this: any) {
            return false;
        },
        cardMetadata: metadata,
        onSelect: function (this: any, b?: any) {
            var defaults: any = cardContractDefaultConfig("clock");
            Object.keys(defaults).forEach(function (this: any, key?: any) { b[key] = defaults[key]; });
        },
        renderSettings: function (this: any, panel?: any, b?: any, slot?: any, helpers?: any) {
            b.entity = "";
            b.label = "";
            b.icon = "Auto";
            b.icon_on = "Auto";
            b.sensor = "";
            b.unit = "";
            b.precision = "";
            helpers.renderCardModeSelector(panel, b, helpers, metadata);
            dateTimeOptions.renderTextSizeSelector(panel, b, helpers);
            dateTimeOptions.renderClockAppearance(panel, b, helpers);
            helpers.renderCardLargeNumbersToggle(panel, b, helpers, metadata);
        },
        renderPreview: function (this: any, b?: any, helpers?: any) {
            const time = clockCardTimeParts(b);
            const font = dateTimeOptions.clockCardFont(b);
            const sizeClass = dateTimeOptions.textSizePreviewClass(b) || (cardLargeNumbersHidePreviewLabel(b, helpers, metadata)
                ? "sp-clock-wide-large" : "");
            const classes = [sizeClass, font ? "sp-clock-font-" + font : "", time.date ? "sp-clock-with-date" : ""].filter(Boolean);
            const dateSize = dateTimeOptions.clockCardDateSize(b);
            const lines = cardSensorPreviewHtml(b, helpers, time.value, time.unit) + (time.date
                ? '<span class="sp-clock-date' + (dateSize ? ' sp-clock-date-' + dateSize : '') + '">' + helpers.escHtml(time.date) + '</span>' : '');
            return {
                buttonClass: classes.join(" ") || undefined,
                // Keep legacy markup untouched when no custom line is requested.
                iconHtml: time.date || configOptionValue(b.options, "time_format")
                    ? '<span class="sp-clock-custom-lines" style="--clock-time-chars:' + Math.max(1, time.value.length) + ';--clock-date-chars:' + Math.max(1, time.date.length) + '">' + lines + '</span>'
                    : lines,
                labelHtml: "",
            };
        },
    });
}
