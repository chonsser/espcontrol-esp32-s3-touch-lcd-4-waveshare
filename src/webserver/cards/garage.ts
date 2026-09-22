import { cardContractDomains } from "../generated/card_contract";
import type { CoverLikeCardRegistration } from "./cover_like_card";
import type { ConfigAccessClimateAlarmOptionsFeature } from "../application/config_access_climate_alarm_options";
import type { ConfigConfirmationOptionsFeature } from "../application/config_confirmation_options";
import {
    SWITCH_CONFIRM_DEFAULT_MESSAGE,
    SWITCH_CONFIRM_DEFAULT_NO,
    SWITCH_CONFIRM_DEFAULT_YES,
} from "../application/config_option_core";
import { i18n, i18nDevice, i18nDynamic, i18nKey } from "../i18n";
export function registerGarageCardTypes(
    registerCard: CoverLikeCardRegistration["register"],
    accessOptions: ConfigAccessClimateAlarmOptionsFeature,
    confirmationOptions: ConfigConfirmationOptionsFeature,
): void {
    const {
        normalizeGarageOptions,
        garageModeOptionValues,
        normalizeGarageMode,
        garageLabelDisplayMode,
        setGarageLabelDisplayMode,
    } = accessOptions;
    const {
        garageConfirmationDefaultMessageForMode,
        garageConfirmationEnabled,
        garageConfirmationMessage,
        garageConfirmationMode,
        garageConfirmationNoText,
        garageConfirmationYesText,
        setGarageConfirmationOptions,
    } = confirmationOptions;
    // Garage door card: cover toggle or one-tap open/close commands.
    var GARAGE_MODE_OPTIONS: any = [
        ["", i18n("Toggle")],
        ["open", i18n("Open")],
        ["close", i18n("Close")],
    ];
    function garageCommandMode(this: any, mode?: any) {
        return mode === "open" || mode === "close";
    }
    function garageModeDefaultIcon(this: any, mode?: any) {
        return mode === "open" ? "Garage Open" : "Garage";
    }
    // Emulated panel text: the default labels the firmware shows for an unlabelled card.
    function garageModeDefaultLabel(this: any, mode?: any) {
        if (mode === "open")
            return i18nDevice("Open");
        if (mode === "close")
            return i18nDevice("Close");
        return i18nDevice("Garage Door");
    }
    function garageCommandPlaceholder(this: any, mode?: any) {
        return mode === "open" ? i18n("e.g. Open Garage") : i18n("e.g. Close Garage");
    }
    function garageUsesDefaultIcon(this: any, icon?: any) {
        return !icon || icon === "Auto" || icon === "Garage" || icon === "Garage Open";
    }
    var GARAGE_CARD_METADATA: any = {
        mode: {
            label: i18n("Type"),
            idSuffix: "garage-interaction",
            options: GARAGE_MODE_OPTIONS,
            value: function (this: any, b?: any) {
                return normalizeGarageMode(b.sensor);
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
            placeholder: i18n("e.g. {example}", { example: "cover.garage_door" }),
            domains: function (this: any) { return cardContractDomains("garage"); },
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
        confirmationToggle: {
            label: i18n("Confirmation Required"),
            idSuffix: "garage-confirm-toggle",
            checked: function (this: any, b?: any) { return garageConfirmationEnabled(b); },
        },
        confirmationMode: {
            label: i18n("When"),
            options: [
                ["off", i18nKey("close__confirm_when", "Close")],
                ["on", i18nKey("open__confirm_when", "Open")],
                ["both", i18n("Both")],
            ],
        },
        confirmationMessage: {
            label: i18n("Message"),
            idSuffix: "garage-confirm-message",
            placeholder: i18nDynamic(SWITCH_CONFIRM_DEFAULT_MESSAGE),
            bindName: null,
            value: function (this: any, b?: any) { return garageConfirmationMessage(b); },
        },
        confirmationYes: {
            label: i18n("Confirm Button"),
            idSuffix: "garage-confirm-yes",
            placeholder: i18nDynamic(SWITCH_CONFIRM_DEFAULT_YES),
            bindName: null,
            value: function (this: any, b?: any) { return garageConfirmationYesText(b); },
        },
        confirmationNo: {
            label: i18n("Cancel Button"),
            idSuffix: "garage-confirm-no",
            placeholder: i18nDynamic(SWITCH_CONFIRM_DEFAULT_NO),
            bindName: null,
            value: function (this: any, b?: any) { return garageConfirmationNoText(b); },
        },
        preview: {
            badge: "garage",
        },
    };
    registerCard({
        type: "garage",
        optionName: "garage_mode",
        metadata: GARAGE_CARD_METADATA,
        commandModes: ["open", "close"],
        closedIcon: "Garage",
        openIcon: "Garage Open",
        commandPlaceholder: garageCommandPlaceholder,
        defaultCardLabel: i18nDevice("Garage Door"),
        labelPlaceholder: i18n("e.g. Garage Door"),
        defaultIcon: garageModeDefaultIcon,
        defaultLabel: garageModeDefaultLabel,
        usesDefaultIcon: garageUsesDefaultIcon,
        normalizeOptions: normalizeGarageOptions,
        labelDisplayMode: garageLabelDisplayMode,
        setLabelDisplayMode: setGarageLabelDisplayMode,
        confirmation: {
            metadata: GARAGE_CARD_METADATA,
            enabled: garageConfirmationEnabled,
            mode: garageConfirmationMode,
            defaultMessageForMode: garageConfirmationDefaultMessageForMode,
            setOptions: setGarageConfirmationOptions,
        },
    });
}
