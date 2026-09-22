import {
    configOptionEnabled,
    configOptionValue,
    setConfigOptionValue,
} from "../model/config_primitives";
import {
    SENSOR_LARGE_NUMBERS_OPTION,
    SUBPAGE_KIND_OPTION,
    copyLargeNumbersOption,
    largeNumbersExplicitlyDisabled,
} from "./config_option_core";
import { i18n } from "../i18n";
    // ── Subpage Card Options ───────────────────────────────────────────
    function normalizeSubpageKind(this: any, value?: any) {
        value = String(value || "").trim();
        return subpagePresetDefaults(value) ? value : "";
    }
    function subpageKind(this: any, b?: any) {
        return normalizeSubpageKind(configOptionValue(b && b.options, SUBPAGE_KIND_OPTION));
    }
    var SUBPAGE_KIND_PRESET_DEFINITIONS: any = [
        { value: "", label: i18n("Generic") },
        { value: "switch", label: i18n("Switch"), preset: { label: "Switch", icon: "Power Plug", entityDomains: ["light", "switch", "input_boolean", "fan"], placeholder: i18n("e.g. {example}", { example: "switch.living_room" }) } },
        { value: "lights", label: i18n("Lights"), preset: { label: "Lighting", icon: "Lightbulb", entityDomains: ["light"], placeholder: i18n("e.g. {example}", { example: "light.living_room" }) } },
        { value: "climate", label: i18n("Climate"), preset: { label: "Climate", icon: "Thermostat", entityDomains: ["climate"], placeholder: i18n("e.g. {example}", { example: "climate.living_room" }) } },
        { value: "presence", label: i18n("Presence"), preset: { label: "Presence", icon: "Account", entityDomains: ["person", "device_tracker", "binary_sensor", "input_boolean"], placeholder: i18n("e.g. {example}", { example: "person.jane" }) } },
        { value: "media", label: i18n("Media"), preset: { label: "Media", icon: "Speaker", entityDomains: ["media_player"], placeholder: i18n("e.g. {example}", { example: "media_player.living_room" }) } },
        { value: "alarm", label: i18n("Alarm"), preset: { label: "Alarm", icon: "Security", entityDomains: ["alarm_control_panel"], placeholder: i18n("e.g. {example}", { example: "alarm_control_panel.home" }) } },
        { value: "cover", label: i18n("Cover"), preset: { label: "Cover", icon: "Blinds", entityDomains: ["cover"], placeholder: i18n("e.g. {example}", { example: "cover.office_blind" }) } },
        { value: "garage", label: i18n("Garage Door"), preset: { label: "Garage", icon: "Garage", entityDomains: ["cover"], placeholder: i18n("e.g. {example}", { example: "cover.garage_door" }) } },
        { value: "gate", label: i18n("Gate"), preset: { label: "Gate", icon: "Gate", entityDomains: ["cover"], placeholder: i18n("e.g. {example}", { example: "cover.driveway_gate" }) } },
        { value: "lock", label: i18n("Lock"), preset: { label: "Lock", icon: "Lock", entityDomains: ["lock"], placeholder: i18n("e.g. {example}", { example: "lock.front_door" }) } },
        { value: "vacuum", label: i18n("Vacuum"), preset: { label: "Vacuum", icon: "Robot Vacuum", entityDomains: ["vacuum"], placeholder: i18n("e.g. {example}", { example: "vacuum.downstairs" }) } },
        { value: "lawn_mower", label: i18n("Lawn Mower"), preset: { label: "Lawn Mower", icon: "Robot Mower", entityDomains: ["lawn_mower"], placeholder: i18n("e.g. {example}", { example: "lawn_mower.backyard" }) } },
        { value: "weather", label: i18n("Weather"), preset: { label: "Weather", icon: "Weather Partly Cloudy", entityDomains: ["weather"], placeholder: i18n("e.g. {example}", { example: "weather.home" }) } },
        { value: "sensor", label: i18n("Sensor"), preset: { label: "Sensor", icon: "Gauge", entityDomains: ["sensor", "binary_sensor", "text_sensor"], placeholder: i18n("e.g. {example}", { example: "sensor.open_windows" }) } },
        { value: "image", label: i18n("Camera/Image"), preset: { label: "Camera", icon: "Camera", entityDomains: ["camera", "image"], placeholder: i18n("e.g. {example}", { example: "camera.front_door" }) } },
    ];
    function subpageKindOptions(this: any) {
        return SUBPAGE_KIND_PRESET_DEFINITIONS.map(function (this: any, definition?: any) {
            return [definition.value, definition.label];
        });
    }
    function subpagePresetDefaults(this: any, kind?: any) {
        kind = String(kind || "").trim();
        for (var i: any = 0; i < SUBPAGE_KIND_PRESET_DEFINITIONS.length; i++) {
            var definition: any = SUBPAGE_KIND_PRESET_DEFINITIONS[i];
            if (definition.value === kind)
                return definition.preset || null;
        }
        return null;
    }
    function applySubpagePresetConfig(this: any, b?: any, forceDisplayDefaults?: any) {
        if (!b)
            return;
        var defaults: any = subpagePresetDefaults(subpageKind(b));
        if (!defaults)
            return;
        if (forceDisplayDefaults || !b.label)
            b.label = defaults.label;
        if (forceDisplayDefaults || !b.icon || b.icon === "Auto")
            b.icon = defaults.icon;
        b.icon_on = "Auto";
        b.sensor = "indicator";
        b.unit = "";
        b.precision = "";
    }
    function normalizeSubpageOptions(this: any, options?: any, sensor?: any, precision?: any) {
        var out: any = "";
        var kind: any = normalizeSubpageKind(configOptionValue(options, SUBPAGE_KIND_OPTION));
        if (kind)
            out = setConfigOptionValue(out, SUBPAGE_KIND_OPTION, kind);
        if (sensor && sensor !== "indicator" && precision !== "text" &&
            (configOptionEnabled(options, SENSOR_LARGE_NUMBERS_OPTION) || largeNumbersExplicitlyDisabled(options))) {
            out = copyLargeNumbersOption(out, options);
        }
        return out;
    }
export {
    normalizeSubpageKind,
    subpageKind,
    SUBPAGE_KIND_PRESET_DEFINITIONS,
    subpageKindOptions,
    subpagePresetDefaults,
    applySubpagePresetConfig,
    normalizeSubpageOptions,
};
