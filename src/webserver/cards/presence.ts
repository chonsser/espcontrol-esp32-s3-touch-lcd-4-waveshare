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
import type { ConfigSensorOptionsFeature } from "../application/config_sensor_options";
import type { ControlsFieldsFeature } from "../application/controls_fields";
import { i18n, i18nDevice, i18nDynamic } from "../i18n";
export function registerPresenceCardTypes(
    registry: CardRegistry,
    sensorOptions: ConfigSensorOptionsFeature,
    fields: ControlsFieldsFeature,
): void {
    const { cardBadgePreview } = fields;
    const {
        presenceActiveColorEnabled,
        normalizePresenceOptions,
        setPresenceActiveColorEnabled,
    } = sensorOptions;
    // Read-only presence card: shows a sensor where Detected is active and Clear is inactive.
    const PRESENCE_CARD_METADATA: any = {
        entity: {
            label: i18n("Sensor Entity"),
            idSuffix: "sensor",
            placeholder: i18n("e.g. {example}", { example: "binary_sensor.living_room_presence" }),
            domains: function (this: any) { return cardContractDomains("presence"); },
            bindName: "sensor",
            rerender: true,
            requiredMessage: i18n("Add a presence sensor before saving."),
        },
        labelField: {
            label: i18n("Label"),
            idSuffix: "label",
            field: "label",
            placeholder: i18n("e.g. Living Room"),
            rerender: true,
        },
        iconOff: {
            pickerIdSuffix: "clear-icon-picker",
            idSuffix: "icon",
            field: "icon",
            label: i18n("Clear Icon"),
            fallback: "Motion Sensor Off",
        },
        iconOn: {
            pickerIdSuffix: "detected-icon-picker",
            idSuffix: "icon-on",
            field: "icon_on",
            label: i18n("Detected Icon"),
            fallback: "Motion Sensor",
        },
        activeColor: {
            label: i18n("Lit When Detected"),
            idSuffix: "presence-active-color",
            checked: presenceActiveColorEnabled,
        },
    };
    registry.register("presence", {
        label: function (this: any) { return i18nDynamic(cardContractCardLabel("presence")); },
        allowInSubpage: function (this: any) { return cardContractAllowInSubpage("presence"); },
        pickerKey: function (this: any) { return cardContractPickerKey("presence"); },
        hidden: function (this: any) { return cardContractHidden("presence"); },
        hideLabel: true,
        defaultConfig: function (this: any) { return cardContractDefaultConfig("presence"); },
        cardMetadata: PRESENCE_CARD_METADATA,
        onSelect: function (this: any, b?: any) {
            var defaults: any = cardContractDefaultConfig("presence");
            Object.keys(defaults).forEach(function (this: any, key?: any) { b[key] = defaults[key]; });
        },
        renderSettings: function (this: any, panel?: any, b?: any, slot?: any, helpers?: any) {
            b.entity = "";
            b.unit = "";
            b.precision = "";
            b.options = normalizePresenceOptions(b.options);
            if (!b.icon || b.icon === "Auto")
                b.icon = "Motion Sensor Off";
            if (!b.icon_on || b.icon_on === "Auto")
                b.icon_on = "Motion Sensor";
            helpers.renderBasicCardFields(panel, b, helpers, PRESENCE_CARD_METADATA);
            helpers.renderCardActiveColorToggle(panel, b, helpers, PRESENCE_CARD_METADATA.activeColor, setPresenceActiveColorEnabled);
        },
        renderPreview: function (this: any, b?: any, helpers?: any) {
            var label: any = b.label || b.sensor || i18nDevice("Presence");
            return cardBadgePreview(b, helpers, {
                label: label,
                iconFallback: "Motion Sensor Off",
                badge: "motion-sensor",
            });
        },
    });
}
