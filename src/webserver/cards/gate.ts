import { cardContractDomains } from "../generated/card_contract";
import type { CoverLikeCardRegistration } from "./cover_like_card";
import type { ConfigAccessClimateAlarmOptionsFeature } from "../application/config_access_climate_alarm_options";
import { i18n, i18nDevice } from "../i18n";
export function registerGateCardTypes(
    registerCard: CoverLikeCardRegistration["register"],
    accessOptions: ConfigAccessClimateAlarmOptionsFeature,
): void {
    const {
        normalizeGateOptions,
        gateModeOptionValues,
        normalizeGateMode,
        gateLabelDisplayMode,
        setGateLabelDisplayMode,
    } = accessOptions;
    // Gate card: cover toggle or one-tap open/close/stop commands.
    var GATE_MODE_OPTIONS: any = [
        ["", i18n("Toggle")],
        ["open", i18n("Open")],
        ["close", i18n("Close")],
        ["stop", i18n("Stop")],
    ];
    function gateCommandMode(this: any, mode?: any) {
        return mode === "open" || mode === "close" || mode === "stop";
    }
    function gateModeDefaultIcon(this: any, mode?: any) {
        if (mode === "open")
            return "Gate Open";
        if (mode === "stop")
            return "Stop";
        return "Gate";
    }
    // Emulated panel text: the default labels the firmware shows for an unlabelled card.
    function gateModeDefaultLabel(this: any, mode?: any) {
        if (mode === "open")
            return i18nDevice("Open");
        if (mode === "close")
            return i18nDevice("Close");
        if (mode === "stop")
            return i18nDevice("Stop");
        return i18nDevice("Gate");
    }
    function gateCommandPlaceholder(this: any, mode?: any) {
        if (mode === "open")
            return i18n("e.g. Open Gate");
        if (mode === "stop")
            return i18n("e.g. Stop Gate");
        return i18n("e.g. Close Gate");
    }
    function gateUsesDefaultIcon(this: any, icon?: any) {
        return !icon || icon === "Auto" || icon === "Gate" || icon === "Gate Open" || icon === "Stop";
    }
    var GATE_CARD_METADATA: any = {
        mode: {
            label: i18n("Type"),
            idSuffix: "gate-interaction",
            options: GATE_MODE_OPTIONS,
            value: function (this: any, b?: any) {
                return normalizeGateMode(b.sensor);
            },
        },
        display: {
            label: i18n("Display"),
            options: [
                ["label", i18n("Label")],
                ["status", i18n("Status")],
            ],
        },
        entity: {
            label: i18n("Entity"),
            idSuffix: "entity",
            placeholder: i18n("e.g. {example}", { example: "cover.driveway_gate" }),
            domains: function (this: any) { return cardContractDomains("gate"); },
            bindName: "entity",
            rerender: true,
            requiredMessage: i18n("Add an entity before saving."),
        },
        labelField: {
            label: i18n("Label"),
            idSuffix: "label",
            field: "label",
            rerender: true,
        },
        preview: {
            badge: "gate",
        },
    };
    registerCard({
        type: "gate",
        optionName: "gate_mode",
        metadata: GATE_CARD_METADATA,
        commandModes: ["open", "close", "stop"],
        closedIcon: "Gate",
        openIcon: "Gate Open",
        commandPlaceholder: gateCommandPlaceholder,
        defaultCardLabel: i18nDevice("Gate"),
        labelPlaceholder: i18n("e.g. Gate"),
        defaultIcon: gateModeDefaultIcon,
        defaultLabel: gateModeDefaultLabel,
        usesDefaultIcon: gateUsesDefaultIcon,
        normalizeOptions: normalizeGateOptions,
        labelDisplayMode: gateLabelDisplayMode,
        setLabelDisplayMode: setGateLabelDisplayMode,
    });
}
