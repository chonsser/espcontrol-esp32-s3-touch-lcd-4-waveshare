import {
    cardContractAllowInSubpage,
    cardContractCard,
    cardContractCardLabel,
    cardContractDefaultConfig,
    cardContractDomains,
    cardContractHidden,
    cardContractPickerKey,
} from "../generated/card_contract";
import { escHtml, iconSlug } from "../application/ui_primitives";
import type { CardRegistry, CardUiServices } from "../application/card_registry";
import type { ConfigAccessClimateAlarmOptionsFeature } from "../application/config_access_climate_alarm_options";
import type { ButtonSettingsRenderQueueFeature } from "../application/button_settings_render_queue";
import type { ControlsFieldsFeature } from "../application/controls_fields";
import { i18n, i18nDevice, i18nDynamic } from "../i18n";
export function registerAlarmCardTypes(
    registry: CardRegistry,
    accessOptions: ConfigAccessClimateAlarmOptionsFeature,
    renderQueue: ButtonSettingsRenderQueueFeature,
    fields: ControlsFieldsFeature,
    cardUi: CardUiServices,
): void {
    const { renderButtonSettings } = cardUi;
    const { condField } = fields;
    const {
        alarmBehaviorSpec,
        alarmActionSpecs,
        alarmMaxVisibleActions,
        alarmActionIconIsGenerated,
        alarmActionInfo,
        alarmPinRequired,
        setAlarmPinRequired,
        alarmVisibleActions,
        setAlarmVisibleActions,
        alarmIconDisplayMode,
        setAlarmIconDisplayMode,
        alarmLabelDisplayMode,
        setAlarmLabelDisplayMode,
        normalizeAlarmOptions,
    } = accessOptions;
    // Alarm cards: one-tap alarm_control_panel actions.
    var ALARM_CONTROL_PANEL_VALUE: any = "control_panel";
    function alarmControlPanelValue(this: any) {
        return alarmBehaviorSpec().controlPanelValue || ALARM_CONTROL_PANEL_VALUE;
    }
    function alarmUsesDefaultIcon(this: any, icon?: any) {
        return !icon || icon === "Auto" || icon === "Security" || icon === "Shield Home" || icon === "Alarm";
    }
    function alarmCardTypeOptions(this: any) {
        var options: any = [
            { value: alarmControlPanelValue(), label: i18n("All Controls") },
        ];
        var actions: any = alarmActionSpecs();
        for (var i: any = 0; i < actions.length; i++)
            options.push({ value: actions[i].value, label: i18nDynamic(actions[i].label) });
        return options;
    }
    function alarmCardTypeOptionsForSettings(this: any) {
        return alarmCardTypeOptions();
    }
    function alarmLabelIsGenerated(this: any, label?: any) {
        if (!label)
            return true;
        var actions: any = alarmActionSpecs();
        for (var i: any = 0; i < actions.length; i++) {
            if (label === actions[i].label)
                return true;
        }
        return false;
    }
    // Emulated panel text: the firmware translates an alarm action's default label,
    // also when that label was saved in English.
    function alarmActionDeviceLabel(this: any, info?: any) {
        if (info.value === "away")
            return i18nDevice("Arm Away");
        if (info.value === "home")
            return i18nDevice("Arm Home");
        if (info.value === "night")
            return i18nDevice("Arm Night");
        if (info.value === "vacation")
            return i18nDevice("Arm Vacation");
        if (info.value === "disarm")
            return i18nDevice("Disarm");
        return info.label;
    }
    function alarmIconIsGenerated(this: any, icon?: any) {
        if (!icon || icon === "Auto" || alarmUsesDefaultIcon(icon))
            return true;
        var actions: any = alarmActionSpecs();
        for (var i: any = 0; i < actions.length; i++) {
            if (alarmActionIconIsGenerated(actions[i].value, icon))
                return true;
        }
        return false;
    }
    function setAlarmCardType(this: any, b?: any, value?: any, helpers?: any) {
        var info: any = alarmActionInfo(value);
        var wasAlarmAction: any = b.type === "alarm_action";
        if (value === alarmControlPanelValue() || !info) {
            var shouldUseControlLabel: any = wasAlarmAction && alarmLabelIsGenerated(b.label);
            var shouldUseControlIcon: any = alarmIconIsGenerated(b.icon);
            b.type = "alarm";
            b.sensor = "";
            b.unit = "";
            b.precision = "";
            b.icon_on = "Auto";
            if (shouldUseControlLabel)
                b.label = "";
            if (shouldUseControlIcon)
                b.icon = "Security";
            b.options = normalizeAlarmOptions(b.options);
            helpers.saveField("type", b.type);
            helpers.saveField("sensor", "");
            helpers.saveField("unit", "");
            helpers.saveField("precision", "");
            helpers.saveField("icon_on", "Auto");
            helpers.saveField("label", b.label || "");
            helpers.saveField("icon", b.icon || "Security");
            helpers.saveField("options", b.options || "");
            renderButtonSettings();
            return;
        }
        info = info || alarmActionSpecs()[0];
        var oldInfo: any = alarmActionInfo(b.sensor);
        var shouldUseGeneratedLabel: any = !wasAlarmAction || alarmLabelIsGenerated(b.label);
        var shouldUseGeneratedIcon: any = !wasAlarmAction || alarmIconIsGenerated(b.icon) ||
            (oldInfo && alarmActionIconIsGenerated(oldInfo.value, b.icon));
        b.type = "alarm_action";
        b.sensor = info.value;
        b.unit = "";
        b.precision = "";
        b.icon_on = "Auto";
        if (shouldUseGeneratedLabel)
            b.label = info.label;
        if (shouldUseGeneratedIcon)
            b.icon = info.icon;
        b.options = normalizeAlarmOptions(b.options);
        helpers.saveField("type", b.type);
        helpers.saveField("sensor", b.sensor || "");
        helpers.saveField("unit", "");
        helpers.saveField("precision", "");
        helpers.saveField("icon_on", "Auto");
        helpers.saveField("label", b.label || "");
        helpers.saveField("icon", b.icon || "Auto");
        helpers.saveField("options", b.options || "");
        renderButtonSettings();
    }
    var ALARM_CARD_METADATA: any = {
        mode: {
            label: i18n("Type"),
            idSuffix: "alarm-card-type",
            options: alarmCardTypeOptionsForSettings,
            value: function (this: any, b?: any) {
                return b.type === "alarm"
                    ? alarmControlPanelValue()
                    : (alarmActionInfo(b.sensor) || alarmActionSpecs()[0]).value;
            },
        },
        entity: {
            label: i18n("Alarm Entity"),
            placeholder: i18n("e.g. {example}", { example: "alarm_control_panel.house" }),
            domains: function (this: any, b?: any) { return cardContractDomains(b && b.type === "alarm_action" ? "alarm_action" : "alarm"); },
            bindName: "entity",
            rerender: true,
            requiredMessage: i18n("Add an alarm_control_panel entity before saving."),
        },
        labelDisplay: {
            label: i18n("Label Display"),
            options: [
                ["name", i18n("Name")],
                ["status", i18n("Status")],
            ],
        },
        iconDisplay: {
            label: i18n("Icon Display"),
            options: [
                ["static", i18n("Static")],
                ["status", i18n("Status")],
            ],
        },
    };
    function renderAlarmCardTypeField(this: any, panel?: any, b?: any, helpers?: any) {
        helpers.renderCardModeSelector(panel, b, helpers, Object.assign({}, ALARM_CARD_METADATA, {
            mode: Object.assign({}, ALARM_CARD_METADATA.mode, {
                options: alarmCardTypeOptionsForSettings(),
                onChange: function (this: any) {
                    setAlarmCardType(b, this.value, helpers);
                },
            }),
        }));
    }
    function renderAlarmVisibleActionsField(this: any, panel?: any, b?: any, helpers?: any) {
        var actions: any = alarmActionSpecs();
        if (!actions.length)
            return null;
        var field: any = document.createElement("div");
        field.className = "sp-field";
        field.appendChild(helpers.fieldLabel(i18n("Visible Actions"), helpers.idPrefix + "alarm-visible-actions"));
        var inputs: any = [];
        function selectedActions(this: any) {
            var selected: any = [];
            for (var i: any = 0; i < inputs.length; i++) {
                if (inputs[i].input.checked)
                    selected.push(inputs[i].value);
            }
            return selected;
        }
        function syncInputs(this: any, values?: any) {
            values = values || alarmVisibleActions(b);
            var selectedCount: any = values.length;
            for (var i: any = 0; i < inputs.length; i++) {
                inputs[i].input.checked = values.indexOf(inputs[i].value) >= 0;
                inputs[i].input.disabled = !inputs[i].input.checked && selectedCount >= alarmMaxVisibleActions();
            }
        }
        var visible: any = alarmVisibleActions(b);
        for (var i: any = 0; i < actions.length; i++) {
            var action: any = actions[i];
            var row: any = helpers.toggleRow(i18nDynamic(action.label), helpers.idPrefix + "alarm-visible-action-" + action.value, visible.indexOf(action.value) >= 0);
            field.appendChild(row.row);
            inputs.push({ value: action.value, input: row.input });
            row.input.addEventListener("change", function (this: any) {
                var selected: any = selectedActions();
                setAlarmVisibleActions(b, selected);
                helpers.saveField("options", b.options);
                syncInputs(alarmVisibleActions(b));
                renderQueue.schedule();
            });
        }
        syncInputs(visible);
        panel.appendChild(field);
        return field;
    }
    registry.register("alarm", {
        label: function (this: any) { return i18nDynamic(cardContractCardLabel("alarm")); },
        allowInSubpage: function (this: any) { return cardContractAllowInSubpage("alarm"); },
        pickerKey: function (this: any) { return cardContractPickerKey("alarm"); },
        hidden: function (this: any) { return cardContractHidden("alarm"); },
        hideLabel: true,
        labelPlaceholder: i18n("e.g. House Alarm"),
        defaultConfig: function (this: any) { return cardContractDefaultConfig("alarm"); },
        cardMetadata: ALARM_CARD_METADATA,
        onSelect: function (this: any, b?: any) {
            b.entity = "";
            b.label = "";
            b.sensor = "";
            b.unit = "";
            b.precision = "";
            b.icon = "Security";
            b.icon_on = "Auto";
            b.options = "";
        },
        renderSettingsBeforeLabel: function (this: any, panel?: any, b?: any, slot?: any, helpers?: any) {
            renderAlarmCardTypeField(panel, b, helpers);
        },
        renderSettings: function (this: any, panel?: any, b?: any, slot?: any, helpers?: any) {
            b.sensor = "";
            b.unit = "";
            b.precision = "";
            b.icon_on = "Auto";
            if (!b.icon || b.icon === "Auto")
                b.icon = "Security";
            var normalizedOptions: any = normalizeAlarmOptions(b.options);
            if (b.options !== normalizedOptions) {
                b.options = normalizedOptions;
                helpers.saveField("options", normalizedOptions);
            }
            helpers.renderCardEntityField(panel, b, helpers, {
                entity: Object.assign({}, ALARM_CARD_METADATA.entity, {
                    idSuffix: "alarm-entity",
                }),
            });
            var cardSettingsDisclosure: any = helpers.disclosureSection(i18n("Card Settings"), helpers.idPrefix + "alarm-card-settings", false);
            var cardSettings: any = cardSettingsDisclosure.section;
            var modalSettingsDisclosure: any = helpers.disclosureSection(i18n("Modal Settings"), helpers.idPrefix + "alarm-modal-settings", false);
            var modalSettings: any = modalSettingsDisclosure.section;
            var labelHost: any = condField();
            helpers.renderCardTextField(labelHost, b, helpers, {
                label: i18n("Label"),
                idSuffix: "alarm-label",
                field: "label",
                placeholder: i18n("e.g. House Alarm"),
                rerender: true,
            });
            function setLabelVisible(this: any, value?: any) {
                labelHost.classList.toggle("sp-visible", value === "name");
            }
            var iconHost: any = condField();
            helpers.renderCardIconPicker(iconHost, b, helpers, {
                pickerIdSuffix: "alarm-icon-picker",
                idSuffix: "alarm-icon",
                field: "icon",
                fallback: "Security",
                label: i18n("Icon"),
            });
            function setIconVisible(this: any, value?: any) {
                iconHost.classList.toggle("sp-visible", value === "static");
            }
            helpers.renderCardSegmentControl(cardSettings, b, helpers, {
                segment: Object.assign({}, ALARM_CARD_METADATA.iconDisplay, {
                    value: function (this: any) { return alarmIconDisplayMode(b); },
                    onSelect: function (this: any, button?: any, cardHelpers?: any, value?: any) {
                        setAlarmIconDisplayMode(button, value);
                        cardHelpers.saveField("options", button.options);
                        setIconVisible(value);
                        renderQueue.schedule();
                    },
                }),
            });
            setIconVisible(alarmIconDisplayMode(b));
            cardSettings.appendChild(iconHost);
            helpers.renderCardSegmentControl(cardSettings, b, helpers, {
                segment: Object.assign({}, ALARM_CARD_METADATA.labelDisplay, {
                    value: function (this: any) { return alarmLabelDisplayMode(b); },
                    onSelect: function (this: any, button?: any, cardHelpers?: any, value?: any) {
                        setAlarmLabelDisplayMode(button, value);
                        cardHelpers.saveField("options", button.options);
                        setLabelVisible(value);
                        renderQueue.schedule();
                    },
                }),
            });
            setLabelVisible(alarmLabelDisplayMode(b));
            cardSettings.appendChild(labelHost);
            panel.appendChild(cardSettingsDisclosure.panel);
            renderAlarmVisibleActionsField(modalSettings, b, helpers);
            function savePinOptions(this: any) {
                setAlarmPinRequired(b, "arm", armPinToggle.input.checked);
                setAlarmPinRequired(b, "disarm", disarmPinToggle.input.checked);
                helpers.saveField("options", b.options);
            }
            var pinSettingsDisclosure: any = helpers.disclosureSection(i18n("PIN Settings"), helpers.idPrefix + "alarm-pin-settings", false);
            var pinSettings: any = pinSettingsDisclosure.section;
            var armPinToggle: any = helpers.renderCardOptionToggle(pinSettings, b, helpers, {
                label: i18n("PIN required for arming"),
                idSuffix: "alarm-pin-arm",
                checked: function (this: any) { return alarmPinRequired(b, "arm"); },
                onChange: savePinOptions,
            });
            var disarmPinToggle: any = helpers.renderCardOptionToggle(pinSettings, b, helpers, {
                label: i18n("PIN required for disarming"),
                idSuffix: "alarm-pin-disarm",
                checked: function (this: any) { return alarmPinRequired(b, "disarm"); },
                onChange: savePinOptions,
            });
            modalSettings.appendChild(pinSettingsDisclosure.panel);
            panel.appendChild(modalSettingsDisclosure.panel);
        },
        renderPreview: function (this: any, b?: any, helpers?: any) {
            var label: any = (b.label && b.label.trim()) || (b.entity && b.entity.trim()) || i18nDevice("Alarm");
            if (alarmLabelDisplayMode(b) === "status")
                label = i18nDevice("Disarmed");
            var iconName: any = iconSlug(b.icon && b.icon !== "Auto" ? b.icon : "Security");
            if (alarmIconDisplayMode(b) === "status")
                iconName = iconSlug("Shield Off");
            return {
                iconHtml: '<span class="sp-btn-icon mdi mdi-' + iconName + '"></span>',
                labelHtml: '<span class="sp-btn-label">' + helpers.escHtml(label) + '</span>',
            };
        },
    });
    registry.register("alarm_action", {
        label: function (this: any) { return i18nDynamic(cardContractCardLabel("alarm_action")); },
        allowInSubpage: function (this: any) { return cardContractAllowInSubpage("alarm_action"); },
        labelPlaceholder: i18n("e.g. Arm Away"),
        pickerKey: function (this: any) { return cardContractPickerKey("alarm_action"); },
        hidden: function (this: any) { return cardContractHidden("alarm_action"); },
        defaultConfig: function (this: any) { return cardContractDefaultConfig("alarm_action"); },
        cardMetadata: ALARM_CARD_METADATA,
        isAvailable: function (this: any) { return false; },
        onSelect: function (this: any, b?: any) {
            var info: any = alarmActionSpecs()[0];
            b.entity = "";
            b.label = info.label;
            b.sensor = info.value;
            b.unit = "";
            b.icon = info.icon;
            b.icon_on = "Auto";
            b.precision = "";
            b.options = "";
        },
        renderSettingsBeforeLabel: function (this: any, panel?: any, b?: any, slot?: any, helpers?: any) {
            b.sensor = alarmActionInfo(b.sensor) ? b.sensor : "away";
            renderAlarmCardTypeField(panel, b, helpers);
        },
        renderSettings: function (this: any, panel?: any, b?: any, slot?: any, helpers?: any) {
            b.sensor = alarmActionInfo(b.sensor) ? b.sensor : "away";
            b.unit = "";
            b.precision = "";
            b.icon_on = "Auto";
            b.options = normalizeAlarmOptions(b.options);
            helpers.renderCardEntityField(panel, b, helpers, {
                entity: Object.assign({}, ALARM_CARD_METADATA.entity, {
                    idSuffix: "alarm-action-entity",
                }),
            });
            helpers.renderCardIconPicker(panel, b, helpers, {
                pickerIdSuffix: "alarm-action-icon-picker",
                idSuffix: "alarm-action-icon",
                field: "icon",
                fallback: function (this: any) { return alarmActionInfo(b.sensor).icon; },
                label: i18n("Icon"),
            });
            var pinMode: any = b.sensor === "disarm" ? "disarm" : "arm";
            helpers.renderCardOptionToggle(panel, b, helpers, {
                label: i18n("PIN required"),
                idSuffix: "alarm-action-pin",
                checked: function (this: any) { return alarmPinRequired(b, pinMode); },
                onChange: function (this: any, button?: any, cardHelpers?: any, checked?: any) {
                    setAlarmPinRequired(button, pinMode, checked);
                    cardHelpers.saveField("options", button.options);
                },
            });
        },
        renderPreview: function (this: any, b?: any, helpers?: any) {
            var info: any = alarmActionInfo(b.sensor) || alarmActionSpecs()[0];
            var label: any = !b.label || b.label === info.label ? alarmActionDeviceLabel(info) : b.label;
            var iconName: any = iconSlug(b.icon || info.icon);
            return {
                iconHtml: '<span class="sp-btn-icon mdi mdi-' + iconName + '"></span>',
                labelHtml: '<span class="sp-btn-label">' + helpers.escHtml(label) + '</span>',
            };
        },
    });
}
