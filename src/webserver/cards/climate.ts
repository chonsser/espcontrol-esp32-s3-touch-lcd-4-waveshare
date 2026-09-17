import {
    cardContractAllowInSubpage,
    cardContractCard,
    cardContractCardLabel,
    cardContractDefaultConfig,
    cardContractDomains,
    cardContractHidden,
    cardContractPickerKey,
} from "../generated/card_contract";
import { iconSlug } from "../application/ui_primitives";
import type { CardRegistry } from "../application/card_registry";
import type { ConfigModalTabOptionsFeature } from "../application/config_modal_tab_options";
import type { ConfigAccessClimateAlarmOptionsFeature } from "../application/config_access_climate_alarm_options";
import type { ClockBarFeature } from "../application/clock_bar_state";
import type { ButtonSettingsRenderQueueFeature } from "../application/button_settings_render_queue";
import type { ControlsFieldsFeature } from "../application/controls_fields";
import { i18n, i18nDevice, i18nDynamic } from "../i18n";
export function registerClimateCardTypes(
    registry: CardRegistry,
    modalTabs: ConfigModalTabOptionsFeature,
    accessOptions: ConfigAccessClimateAlarmOptionsFeature,
    clockBar: Pick<ClockBarFeature, "temperatureUnitSymbol">,
    renderQueue: ButtonSettingsRenderQueueFeature,
    fields: ControlsFieldsFeature,
): void {
    const { cardBadgeLabelHtml, cardSensorPreviewHtml, condField } = fields;
    const { temperatureUnitSymbol } = clockBar;
    const {
        climateControlTabDefinitions,
        climateControlTabs,
        setClimateControlTabs,
        renderModalTabSettings,
    } = modalTabs;
    const {
        normalizeClimateOptions,
        climateLabelDisplayMode,
        setClimateLabelDisplayMode,
        climateNumberDisplayMode,
        setClimateNumberDisplayMode,
        climateTemperatureStep,
        setClimateTemperatureStep,
        parseClimatePrecisionConfig,
        climatePrecisionConfig,
    } = accessOptions;
    // Climate card: thermostat status plus full-screen climate controls.
    const CLIMATE_CARD_METADATA: any = {
        entity: {
            label: i18n("Climate Entity"),
            idSuffix: "entity",
            placeholder: i18n("e.g. {example}", { example: "climate.living_room" }),
            domains: function (this: any) { return cardContractDomains("climate"); },
            bindName: "entity",
            rerender: true,
            requiredMessage: i18n("Add a climate entity before saving."),
        },
        labelDisplay: {
            label: i18n("Label Display"),
            options: [
                ["label", i18n("Label")],
                ["status", i18n("Status")],
                ["actual", i18n("Actual")],
                ["target", i18n("Target")],
            ],
        },
        numberDisplay: {
            label: i18n("Icon & Temperatures"),
            options: [
                ["icon", i18n("Icon")],
                ["actual", i18n("Actual")],
                ["target", i18n("Target")],
            ],
        },
        temperatureStep: {
            label: i18n("Temperature Step"),
            options: [
                ["1", i18n("1 degree")],
                ["0.5", i18n("0.5 degree")],
            ],
        },
        largeNumbers: {
            label: i18n("Large Temperature Numbers"),
            idSuffix: "large-temperature-numbers",
            supported: function (this: any, b?: any) {
                return climateNumberDisplayMode(b) !== "icon";
            },
        },
        preview: {
            badge: "thermostat",
        },
    };
    registry.register("climate", {
        label: function (this: any) { return i18nDynamic(cardContractCardLabel("climate")); },
        allowInSubpage: function (this: any) { return cardContractAllowInSubpage("climate"); },
        pickerKey: function (this: any) { return cardContractPickerKey("climate"); },
        hidden: function (this: any) { return cardContractHidden("climate"); },
        hideLabel: true,
        labelPlaceholder: i18n("e.g. Living Room"),
        defaultConfig: function (this: any) { return cardContractDefaultConfig("climate"); },
        cardMetadata: CLIMATE_CARD_METADATA,
        onSelect: function (this: any, b?: any) {
            b.entity = "";
            b.label = "Climate";
            b.sensor = "";
            b.unit = "";
            b.type = "climate_control";
            b.precision = "";
            b.icon = "Thermostat";
            b.icon_on = "Auto";
            b.options = "";
        },
        renderSettings: function (this: any, panel?: any, b?: any, slot?: any, helpers?: any) {
            if (b.type !== "climate_control") {
                b.type = "climate_control";
                helpers.saveField("type", b.type);
            }
            b.sensor = "";
            b.unit = "";
            if (!b.icon)
                b.icon = "Thermostat";
            if (!b.icon_on)
                b.icon_on = "Auto";
            var climateConfig: any = parseClimatePrecisionConfig(b.precision);
            var normalizedPrecision: any = climatePrecisionConfig(climateConfig.precision, climateConfig.min, climateConfig.max);
            if (b.precision !== normalizedPrecision) {
                b.precision = normalizedPrecision;
                helpers.saveField("precision", normalizedPrecision);
            }
            helpers.renderCardEntityField(panel, b, helpers, CLIMATE_CARD_METADATA);
            var modalTabsDisclosure: any = helpers.disclosureSection(i18n("Modal Settings"), helpers.idPrefix + "climate-modal-tabs", b._modalSettingsOpen === true);
            renderModalTabSettings(modalTabsDisclosure.section, b, helpers, {
                definitions: climateControlTabDefinitions,
                tabs: climateControlTabs,
                normalizeOptions: function (this: any, options?: any) { return normalizeClimateOptions(options, true); },
                setTabs: setClimateControlTabs,
                idPrefix: "climate-tab-",
                hideHeading: true,
            });
            var labelField: any = condField();
            labelField.classList.add("sp-climate-settings-gap");
            helpers.renderCardTextField(labelField, b, helpers, {
                label: i18n("Label"),
                idSuffix: "label",
                field: "label",
                placeholder: i18n("Climate"),
                rerender: true,
            });
            function syncLabelField(this: any) {
                labelField.classList.toggle("sp-visible", climateLabelDisplayMode(b) === "label");
            }
            var cardSettingsDisclosure: any = helpers.disclosureSection(i18n("Card Settings"), helpers.idPrefix + "climate-card-settings", false);
            var cardSettings: any = cardSettingsDisclosure.section;
            helpers.renderCardSegmentControl(cardSettings, b, helpers, {
                segment: Object.assign({}, CLIMATE_CARD_METADATA.numberDisplay, {
                    value: function (this: any) { return climateNumberDisplayMode(b); },
                    onSelect: function (this: any, button?: any, cardHelpers?: any, value?: any) {
                        setClimateNumberDisplayMode(button, value);
                        cardHelpers.saveField("options", button.options);
                        syncIconFields();
                        renderQueue.schedule();
                    },
                }),
            });
            var iconFields: any = condField();
            iconFields.classList.add("sp-climate-settings-gap");
            helpers.renderCardIconPicker(iconFields, b, helpers, {
                pickerIdSuffix: "climate-icon-picker",
                idSuffix: "climate-icon",
                field: "icon",
                fallback: "Thermostat",
                label: i18n("Off Icon"),
                onChange: function (this: any) { renderQueue.schedule(); },
            });
            helpers.renderCardIconPicker(iconFields, b, helpers, {
                pickerIdSuffix: "climate-icon-on-picker",
                idSuffix: "climate-icon-on",
                field: "icon_on",
                fallback: "Auto",
                label: i18n("On Icon"),
                onChange: function (this: any) { renderQueue.schedule(); },
            });
            function syncIconFields(this: any) {
                iconFields.classList.toggle("sp-visible", climateNumberDisplayMode(b) === "icon");
            }
            syncIconFields();
            cardSettings.appendChild(iconFields);
            helpers.renderCardSegmentControl(cardSettings, b, helpers, {
                segment: Object.assign({}, CLIMATE_CARD_METADATA.labelDisplay, {
                    value: function (this: any) { return climateLabelDisplayMode(b); },
                    onSelect: function (this: any, button?: any, cardHelpers?: any, value?: any) {
                        setClimateLabelDisplayMode(button, value);
                        cardHelpers.saveField("options", button.options);
                        syncLabelField();
                        renderQueue.schedule();
                    },
                }),
            });
            syncLabelField();
            cardSettings.appendChild(labelField);
            var precisionField: any = helpers.selectField(i18n("Temperature Settings"), helpers.idPrefix + "climate-precision", [
                ["", "10"],
                ["1", "10.2"],
            ], climateConfig.precision);
            var precision: any = precisionField.select;
            function saveClimateAdvancedSettings(this: any) {
                b.precision = climatePrecisionConfig(precision.value, minInp.value, maxInp.value);
                helpers.saveField("precision", b.precision);
                renderQueue.schedule();
            }
            precision.addEventListener("change", saveClimateAdvancedSettings);
            var stepField: any = helpers.selectField(CLIMATE_CARD_METADATA.temperatureStep.label, helpers.idPrefix + "climate-temperature-step", CLIMATE_CARD_METADATA.temperatureStep.options, climateTemperatureStep(b));
            stepField.select.addEventListener("change", function (this: any) {
                setClimateTemperatureStep(b, stepField.select.value);
                helpers.saveField("options", b.options);
                renderQueue.schedule();
            });
            helpers.renderCardLargeNumbersToggle(cardSettings, b, helpers, CLIMATE_CARD_METADATA);
            panel.appendChild(cardSettingsDisclosure.panel);
            panel.appendChild(modalTabsDisclosure.panel);
            var advancedDisclosure: any = helpers.disclosureSection(i18n("Advanced"), helpers.idPrefix + "climate-advanced", false);
            var advanced: any = advancedDisclosure.section;
            advanced.appendChild(precisionField.field);
            advanced.appendChild(stepField.field);
            var minField: any = helpers.textField(i18n("Minimum Temperature"), helpers.idPrefix + "climate-min", climateConfig.min, i18n("e.g. {example}", { example: "-25" }));
            var minInp: any = minField.input;
            minInp.inputMode = "decimal";
            advanced.appendChild(minField.field);
            var maxField: any = helpers.textField(i18n("Maximum Temperature"), helpers.idPrefix + "climate-max", climateConfig.max, i18n("e.g. {example}", { example: "5" }));
            var maxInp: any = maxField.input;
            maxInp.inputMode = "decimal";
            advanced.appendChild(maxField.field);
            minInp.addEventListener("change", saveClimateAdvancedSettings);
            maxInp.addEventListener("change", saveClimateAdvancedSettings);
            panel.appendChild(advancedDisclosure.panel);
        },
        renderPreview: function (this: any, b?: any, helpers?: any) {
            var climateConfig: any = parseClimatePrecisionConfig(b.precision);
            var prec: any = parseInt(climateConfig.precision || "0", 10) || 0;
            var unit: any = temperatureUnitSymbol();
            var actualVal: any = (21).toFixed(prec);
            var targetVal: any = (20).toFixed(prec);
            var numberMode: any = climateNumberDisplayMode(b);
            var numberVal: any = numberMode === "actual" ? actualVal : targetVal;
            var labelMode: any = climateLabelDisplayMode(b);
            var label: any = (b.label && b.label.trim()) || i18nDevice("Climate");
            // onSelect saves the English default label; treat it like an empty label.
            if (label === "Climate")
                label = i18nDevice("Climate");
            if (labelMode === "status") {
                label = i18nDevice("Idle");
            }
            else if (labelMode === "actual") {
                label = actualVal + unit;
            }
            else if (labelMode === "target") {
                label = targetVal + unit;
            }
            function climateLabelHtml(this: any) {
                return cardBadgeLabelHtml(helpers, label, CLIMATE_CARD_METADATA.preview.badge);
            }
            if (numberMode === "icon") {
                var iconName: any = b.icon && b.icon !== "Auto" ? b.icon : "Thermostat";
                return {
                    iconHtml: '<span class="sp-btn-icon mdi mdi-' + iconSlug(iconName) + '"></span>',
                    labelHtml: climateLabelHtml(),
                };
            }
            return {
                buttonClass: "sp-climate-temp-card",
                iconHtml: cardSensorPreviewHtml(b, helpers, numberVal, unit),
                labelHtml: climateLabelHtml(),
            };
        },
    });
    registry.register("climate_control", Object.assign({}, registry.definitions.climate, {
        label: function (this: any) { return i18nDynamic(cardContractCardLabel("climate_control")); },
        allowInSubpage: function (this: any) { return cardContractAllowInSubpage("climate_control"); },
        pickerKey: function (this: any) { return cardContractPickerKey("climate_control"); },
        hidden: function (this: any) { return cardContractHidden("climate_control"); },
        defaultConfig: function (this: any) { return cardContractDefaultConfig("climate_control"); },
    }));
}
