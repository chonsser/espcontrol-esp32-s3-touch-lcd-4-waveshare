import { state } from "../state/app_instance";
import { iconSlug } from "../application/ui_primitives";
import type { CardRegistry, CardUiServices } from "../application/card_registry";
import type { ConfigConfirmationOptionsFeature } from "../application/config_confirmation_options";
import type { EntityStateFeature } from "../application/entity_state";
import type { ControlsFieldsFeature } from "../application/controls_fields";
import {
    SWITCH_CONFIRM_DEFAULT_NO,
    SWITCH_CONFIRM_DEFAULT_YES,
} from "../application/config_option_core";
import { i18n, i18nDevice } from "../i18n";
export function registerActionCardTypes(
    registry: CardRegistry,
    confirmationOptions: ConfigConfirmationOptionsFeature,
    entityState: Pick<EntityStateFeature, "refreshEntityDatalist">,
    fields: ControlsFieldsFeature,
    cardUi: CardUiServices,
): void {
    const { renderButtonSettings } = cardUi;
    const { cardBadgeLabelHtml, cardLargeNumbersActiveForCardSize, cardSensorPreviewHtml, condField } = fields;
    const { refreshEntityDatalist } = entityState;
    const {
        actionCardActions: ACTION_CARD_ACTIONS,
        actionCardInfo,
        actionCardEntityMatchesAction,
        actionCardIsOptionSelect,
        actionCardIsLocal,
        normalizeSavedConfigActionFields,
        normalizeActionCardConfig,
        actionCardStateEntity,
        actionCardStateUnit,
        actionCardStatePrecision,
        actionCardStateDisplayMode,
        setActionCardStateOptions,
        actionCardNeedsExtraValue,
        actionCardIsScript,
        actionScriptConfirmationDefaultMessage,
        actionScriptConfirmationEnabled,
        actionScriptConfirmationMessage,
        actionScriptConfirmationNoText,
        actionScriptConfirmationYesText,
        actionScriptFields,
        normalizeActionOptions,
        setActionScriptConfirmationOptions,
        setActionScriptFields,
    } = confirmationOptions;
    var ACTION_CARD_METADATA: any = {
        mode: {
            label: i18n("Type"),
            idSuffix: "action",
            options: ACTION_CARD_ACTIONS,
            value: function (this: any, b?: any) {
                return b.sensor || "scene.turn_on";
            },
        },
        entity: {
            idSuffix: "entity",
            bindName: "entity",
            rerender: true,
            requiredMessage: i18n("Add an entity before saving."),
        },
        stateMode: {
            label: i18n("Type"),
            options: [
                ["icon", i18n("Icon")],
                ["numeric", i18n("Numeric")],
                ["text", i18n("Text")],
            ],
        },
        largeNumbers: {
            label: i18n("Large State Numbers"),
            idSuffix: "large-state-numbers",
            supported: function (this: any, b?: any) {
                return !actionCardIsOptionSelect(b) && !actionCardIsLocal(b) && actionCardStateDisplayMode(b) === "numeric";
            },
        },
        stateUnitField: {
            label: i18n("Unit"),
            idSuffix: "action-state-unit",
            placeholder: i18n("e.g. {example}", { example: "%" }),
            bindName: null,
        },
        confirmationToggle: {
            label: i18n("Confirmation Required"),
            idSuffix: "script-confirm-toggle",
            checked: function (this: any, b?: any) { return actionScriptConfirmationEnabled(b); },
        },
        scriptFields: {
            label: i18n("Fields"),
            idSuffix: "script-fields",
            placeholder: i18n("e.g. {example}", { example: "mode: night" }),
            value: function (this: any, b?: any) { return actionScriptFields(b); },
        },
        confirmationMessage: {
            label: i18n("Message"),
            idSuffix: "script-confirm-message",
            placeholder: i18n("Run this script?"),
            bindName: null,
            value: function (this: any, b?: any) { return actionScriptConfirmationMessage(b); },
        },
        confirmationYes: {
            label: i18n("Confirm Button"),
            idSuffix: "script-confirm-yes",
            placeholder: i18n("Yes"),
            bindName: null,
            value: function (this: any, b?: any) { return actionScriptConfirmationYesText(b); },
        },
        confirmationNo: {
            label: i18n("Cancel Button"),
            idSuffix: "script-confirm-no",
            placeholder: i18n("No"),
            bindName: null,
            value: function (this: any, b?: any) { return actionScriptConfirmationNoText(b); },
        },
        preview: {
            optionBadge: "chevron-down",
            actionBadge: "flash",
        },
    };
    registry.register("action", {
        label: i18n("Action"),
        allowInSubpage: true,
        labelPlaceholder: i18n("e.g. Movie Mode"),
        cardMetadata: ACTION_CARD_METADATA,
        onSelect: function (this: any, b?: any) {
            b.entity = "";
            b.sensor = "scene.turn_on";
            b.unit = "";
            b.icon = "Flash";
            b.icon_on = "Auto";
            b.precision = "";
            b.options = "";
        },
        renderSettingsBeforeLabel: function (this: any, panel?: any, b?: any, slot?: any, helpers?: any) {
            normalizeActionCardConfig(b);
            var actionField: any = helpers.renderCardModeSelector(panel, b, helpers, Object.assign({}, ACTION_CARD_METADATA, {
                mode: Object.assign({}, ACTION_CARD_METADATA.mode, {
                    onChange: function (this: any) {
                        var wasLocal: any = actionCardIsLocal(b);
                        var entityMatchesAction: any = actionCardEntityMatchesAction(b.entity, this.value);
                        b.sensor = this.value;
                        helpers.saveField("sensor", b.sensor);
                        if (wasLocal !== actionCardIsLocal(b) || !entityMatchesAction) {
                            b.entity = "";
                            helpers.saveField("entity", "");
                        }
                        if (!actionCardNeedsExtraValue(b.sensor)) {
                            b.unit = "";
                            helpers.saveField("unit", "");
                        }
                        if (actionCardIsOptionSelect(b)) {
                            b.options = "";
                            helpers.saveField("options", "");
                        }
                        else if (actionCardIsLocal(b)) {
                            b.options = "";
                            helpers.saveField("options", "");
                            if (!b.icon || b.icon === "Auto" || b.icon === "Flash") {
                                b.icon = "Gesture Tap";
                                helpers.saveField("icon", b.icon);
                            }
                        }
                        else {
                            b.options = normalizeActionOptions(b.options, b.sensor);
                            helpers.saveField("options", b.options);
                            if (b.icon === "Gesture Tap") {
                                b.icon = "Flash";
                                helpers.saveField("icon", b.icon);
                            }
                        }
                        b.icon_on = "Auto";
                        b.precision = "";
                        helpers.saveField("icon_on", "Auto");
                        helpers.saveField("precision", "");
                        renderButtonSettings();
                    },
                }),
            }));
            var actionSelect: any = actionField.select;
            actionSelect.value = b.sensor;
        },
        renderSettings: function (this: any, panel?: any, b?: any, slot?: any, helpers?: any) {
            normalizeActionCardConfig(b);
            var info: any = actionCardInfo(b.sensor) || ACTION_CARD_ACTIONS[0];
            var isOptionSelect: any = actionCardIsOptionSelect(b);
            var isLocal: any = actionCardIsLocal(b);
            if (isLocal) {
                renderActionCardLocalSettings(panel, b, slot, helpers);
                return;
            }
            var entityField: any = helpers.renderCardEntityField(panel, b, helpers, {
                entity: Object.assign({}, ACTION_CARD_METADATA.entity, {
                    label: isOptionSelect ? i18n("Select Entity") : i18n("Action Entity"),
                    placeholder: info.placeholder,
                    domains: info.domains,
                }),
            });
            var entityInp: any = entityField.input;
            if (actionCardNeedsExtraValue(b.sensor)) {
                var valueInput: any = helpers.textInput(helpers.idPrefix + "action-value", b.unit, i18n("e.g. {example}", { example: "50" }));
                var valueLabel: any = helpers.fieldLabel(i18n("Value"), helpers.idPrefix + "action-value");
                var valueField: any = document.createElement("div");
                valueField.className = "sp-field";
                valueField.appendChild(valueLabel);
                valueField.appendChild(valueInput);
                panel.appendChild(valueField);
                helpers.bindField(valueInput, "unit", true);
                helpers.requireField(valueInput, i18n("Enter a value before saving."));
            }
            if (!isOptionSelect) {
                helpers.renderCardIconPicker(panel, b, helpers, {
                    pickerIdSuffix: "icon-picker",
                    idSuffix: "icon",
                    field: "icon",
                    fallback: "Flash",
                });
            }
            entityInp._entityDomains = info.domains || [];
            refreshEntityDatalist(entityInp);
            if (isOptionSelect || actionCardNeedsExtraValue(b.sensor)) {
                helpers.requireEntityDomain(
                    entityInp,
                    info.domains || [],
                    isOptionSelect
                        ? i18n("Choose a select or input_select entity.")
                        : i18n("Choose the number entity type that matches this action."));
            }
            if (isOptionSelect)
                return;
            if (actionCardIsScript(b)) {
                var fieldsInput: any = document.createElement("textarea");
                fieldsInput.className = "sp-input sp-textarea";
                fieldsInput.id = helpers.idPrefix + ACTION_CARD_METADATA.scriptFields.idSuffix;
                fieldsInput.placeholder = ACTION_CARD_METADATA.scriptFields.placeholder;
                fieldsInput.value = actionScriptFields(b);
                fieldsInput.rows = 3;
                fieldsInput.spellcheck = false;
                var fieldsWrapper: any = document.createElement("div");
                fieldsWrapper.className = "sp-field";
                fieldsWrapper.appendChild(helpers.fieldLabel(ACTION_CARD_METADATA.scriptFields.label, fieldsInput.id));
                fieldsWrapper.appendChild(fieldsInput);
                panel.appendChild(fieldsWrapper);
                function saveScriptFields(this: any) {
                    setActionScriptFields(b, fieldsInput.value);
                    helpers.saveField("options", b.options);
                }
                fieldsInput.addEventListener("input", saveScriptFields);
                fieldsInput.addEventListener("change", saveScriptFields);
                fieldsInput.addEventListener("blur", saveScriptFields);
                var confirmOn: any = actionScriptConfirmationEnabled(b);
                var confirmToggle: any = helpers.renderCardOptionToggle(panel, b, helpers, ACTION_CARD_METADATA.confirmationToggle);
                var confirmSection: any = condField();
                confirmSection.classList.add("sp-action-confirm-section");
                if (confirmOn)
                    confirmSection.classList.add("sp-visible");
                var messageField: any = helpers.renderCardTextField(confirmSection, b, helpers, ACTION_CARD_METADATA.confirmationMessage);
                var messageInput: any = messageField.input;
                messageInput.maxLength = 72;
                var yesField: any = helpers.renderCardTextField(confirmSection, b, helpers, ACTION_CARD_METADATA.confirmationYes);
                var yesInput: any = yesField.input;
                yesInput.maxLength = 20;
                var noField: any = helpers.renderCardTextField(confirmSection, b, helpers, ACTION_CARD_METADATA.confirmationNo);
                var noInput: any = noField.input;
                noInput.maxLength = 20;
                panel.appendChild(confirmSection);
                function saveScriptConfirmationOptions(this: any) {
                    setActionScriptConfirmationOptions(b, confirmToggle.input.checked, messageInput.value || actionScriptConfirmationDefaultMessage(), yesInput.value || SWITCH_CONFIRM_DEFAULT_YES, noInput.value || SWITCH_CONFIRM_DEFAULT_NO);
                    helpers.saveField("options", b.options);
                }
                confirmToggle.input.addEventListener("change", function (this: any) {
                    confirmSection.classList.toggle("sp-visible", this.checked);
                    if (this.checked) {
                        if (!messageInput.value)
                            messageInput.value = actionScriptConfirmationDefaultMessage();
                        if (!yesInput.value)
                            yesInput.value = SWITCH_CONFIRM_DEFAULT_YES;
                        if (!noInput.value)
                            noInput.value = SWITCH_CONFIRM_DEFAULT_NO;
                    }
                    saveScriptConfirmationOptions();
                });
                [messageInput, yesInput, noInput].forEach(function (this: any, input?: any) {
                    input.addEventListener("input", saveScriptConfirmationOptions);
                    input.addEventListener("change", saveScriptConfirmationOptions);
                    input.addEventListener("blur", saveScriptConfirmationOptions);
                    input.addEventListener("keydown", function (this: any, e?: any) {
                        if (e.key === "Enter") {
                            saveScriptConfirmationOptions();
                            this.blur();
                        }
                    });
                });
            }
            var stateEntity: any = actionCardStateEntity(b);
            var stateMode: any = actionCardStateDisplayMode(b);
            var stateUnit: any = actionCardStateUnit(b);
            var statePrecision: any = actionCardStatePrecision(b);
            var mode: any = helpers.renderCardSegmentControl(panel, b, helpers, {
                segment: Object.assign({}, ACTION_CARD_METADATA.stateMode, {
                    value: function (this: any) { return stateMode; },
                    onSelect: function (this: any, button?: any, cardHelpers?: any, value?: any) {
                        setStateMode(value, true);
                    },
                }),
            });
            var iconBtn: any = mode.buttons.icon;
            var numericBtn: any = mode.buttons.numeric;
            var textBtn: any = mode.buttons.text;
            var stateEntityField: any = helpers.renderCardEntityField(panel, b, helpers, {
                entity: {
                    label: i18n("Sensor Entity"),
                    idSuffix: "action-state-entity",
                    value: function (this: any) { return stateEntity; },
                    placeholder: i18n("e.g. {example}", { example: "sensor.printer_percent_complete" }),
                    domains: ["sensor", "binary_sensor", "text_sensor"],
                    bindName: null,
                    rerender: false,
                },
            });
            var stateEntityInp: any = stateEntityField.input;
            var iconOnSection: any = helpers.renderCardIconPicker(panel, b, helpers, {
                pickerIdSuffix: "icon-on-picker",
                idSuffix: "icon-on",
                field: "icon_on",
                fallback: "Auto",
                label: i18n("On Icon"),
            });
            var numericSection: any = condField();
            var stateUnitField: any = helpers.renderCardTextField(numericSection, b, helpers, Object.assign({}, ACTION_CARD_METADATA.stateUnitField, {
                value: function (this: any) { return stateUnit; },
            }));
            var stateUnitInp: any = stateUnitField.input;
            var statePrecisionField: any = helpers.precisionField(helpers.idPrefix + "action-state-precision", stateMode === "numeric" ? statePrecision : "0", function (this: any) {
                statePrecision = this.value || "0";
                saveStateOptions();
            });
            var statePrecisionSelect: any = statePrecisionField.select;
            numericSection.appendChild(statePrecisionField.field);
            helpers.renderCardLargeNumbersToggle(numericSection, b, helpers, ACTION_CARD_METADATA);
            panel.appendChild(numericSection);
            function saveStateOptions(this: any) {
                stateEntity = stateEntityInp.value;
                stateUnit = stateUnitInp.value;
                helpers.saveField("options", setActionCardStateOptions(b, stateEntity, stateMode, stateUnit, statePrecision));
            }
            function setStateMode(this: any, modeValue?: any, persist?: any) {
                stateMode = modeValue === "icon" || modeValue === "text" ? modeValue : "numeric";
                iconBtn.classList.toggle("active", stateMode === "icon");
                numericBtn.classList.toggle("active", stateMode === "numeric");
                textBtn.classList.toggle("active", stateMode === "text");
                iconOnSection.style.display = stateMode === "icon" ? "" : "none";
                numericSection.classList.toggle("sp-visible", stateMode === "numeric");
                if (!persist)
                    return;
                if (stateMode === "icon" || stateMode === "text") {
                    stateUnit = "";
                    stateUnitInp.value = "";
                    statePrecision = "0";
                    statePrecisionSelect.value = "0";
                }
                if (stateMode !== "icon") {
                    b.icon_on = "Auto";
                    helpers.saveField("icon_on", "Auto");
                }
                saveStateOptions();
            }
            setStateMode(stateMode, false);
            stateEntityInp.addEventListener("input", saveStateOptions);
            stateEntityInp.addEventListener("change", saveStateOptions);
            stateEntityInp.addEventListener("blur", saveStateOptions);
            stateEntityInp.addEventListener("keydown", function (this: any, e?: any) {
                if (e.key === "Enter") {
                    saveStateOptions();
                    this.blur();
                }
            });
            stateUnitInp.addEventListener("input", saveStateOptions);
            stateUnitInp.addEventListener("change", saveStateOptions);
            stateUnitInp.addEventListener("blur", saveStateOptions);
            stateUnitInp.addEventListener("keydown", function (this: any, e?: any) {
                if (e.key === "Enter") {
                    saveStateOptions();
                    this.blur();
                }
            });
        },
        renderPreview: function (this: any, b?: any, helpers?: any) {
            var label: any = b.label || b.entity || (actionCardIsLocal(b) ? i18nDevice("Local Action") : i18nDevice("Action"));
            if (actionCardIsLocal(b)) {
                // The panel translates the default label, also when it was saved in English.
                if (b.label === "Local Action")
                    label = i18nDevice("Local Action");
                var localIconName: any = b.icon && b.icon !== "Auto" ? iconSlug(b.icon) : "gesture-tap";
                return {
                    iconHtml: '<span class="sp-btn-icon mdi mdi-' + localIconName + '"></span>',
                    labelHtml: cardBadgeLabelHtml(helpers, label, "chip"),
                };
            }
            if (actionCardIsOptionSelect(b)) {
                return {
                    iconHtml: cardSensorPreviewHtml(b, helpers, i18nDevice("Option"), null),
                    labelHtml: cardBadgeLabelHtml(helpers, label, ACTION_CARD_METADATA.preview.optionBadge),
                };
            }
            var iconName: any = b.icon && b.icon !== "Auto" ? iconSlug(b.icon) : "flash";
            if (actionCardStateEntity(b) && actionCardStateDisplayMode(b) === "numeric" &&
                cardLargeNumbersActiveForCardSize(b, helpers, ACTION_CARD_METADATA)) {
                return {
                    iconHtml: cardSensorPreviewHtml(b, helpers, "42", actionCardStateUnit(b) || ""),
                    labelHtml: cardBadgeLabelHtml(helpers, label, ACTION_CARD_METADATA.preview.actionBadge),
                };
            }
            var stateBadge: any = actionCardStateEntity(b)
                ? '<span class="sp-sensor-badge mdi mdi-' +
                    (actionCardStateDisplayMode(b) === "icon" ? "toggle-switch" :
                        (actionCardStateDisplayMode(b) === "text" ? "format-text" : "gauge")) +
                    '"></span>'
                : "";
            return {
                iconHtml: stateBadge + '<span class="sp-btn-icon mdi mdi-' + iconName + '"></span>',
                labelHtml: cardBadgeLabelHtml(helpers, label, ACTION_CARD_METADATA.preview.actionBadge),
            };
        },
    });
    function renderActionCardLocalSettings(this: any, panel?: any, b?: any, slot?: any, helpers?: any) {
        var pickerSection: any = document.createElement("div");
        pickerSection.className = "sp-field";
        panel.appendChild(pickerSection);
        helpers.markCardPrimaryField(pickerSection, "entity");
        helpers.renderCardIconPicker(panel, b, helpers, {
            pickerIdSuffix: "icon-picker",
            idSuffix: "icon",
            field: "icon",
            fallback: "Gesture Tap",
        });
        function buildDropdown(this: any, actions?: any) {
            pickerSection.innerHTML = "";
            pickerSection.className = "sp-field";
            pickerSection.appendChild(helpers.fieldLabel(i18n("Local Action"), helpers.idPrefix + "action-sel"));
            var sel: any = document.createElement("select");
            sel.className = "sp-select";
            sel.id = helpers.idPrefix + "action-sel";
            var placeholder: any = document.createElement("option");
            placeholder.value = "";
            placeholder.textContent = i18n("Choose an action…");
            sel.appendChild(placeholder);
            actions.forEach(function (this: any, a?: any) {
                var opt: any = document.createElement("option");
                opt.value = a.key;
                opt.textContent = a.label ? a.label + " (" + a.key + ")" : a.key;
                if (a.key === b.entity)
                    opt.selected = true;
                sel.appendChild(opt);
            });
            if (b.entity && !actions.some(function (this: any, a?: any) { return a.key === b.entity; })) {
                var curOpt: any = document.createElement("option");
                curOpt.value = b.entity;
                curOpt.textContent = i18n("{name} (current)", { name: b.entity });
                curOpt.selected = true;
                sel.appendChild(curOpt);
            }
            sel.addEventListener("change", function (this: any) {
                var key: any = this.value;
                if (!key)
                    return;
                b.entity = key;
                helpers.saveField("entity", key);
                var action: any = actions.find(function (this: any, a?: any) { return a.key === key; });
                if (action && action.label && !b.label) {
                    b.label = action.label;
                    helpers.saveField("label", action.label);
                    var labelInp: any = document.getElementById(helpers.idPrefix + "label");
                    if (labelInp)
                        labelInp.value = action.label;
                }
            });
            pickerSection.appendChild(sel);
        }
        function buildEmpty(this: any) {
            pickerSection.innerHTML = "";
            pickerSection.className = "";
            var banner: any = document.createElement("div");
            banner.className = "sp-banner sp-error";
            banner.textContent =
                i18n("No local actions are registered on this device. Add register_local_action() calls to your device’s on_boot lambda.");
            pickerSection.appendChild(banner);
        }
        function buildFallback(this: any) {
            pickerSection.innerHTML = "";
            pickerSection.className = "sp-local-picker-fallback";
            var banner: any = document.createElement("div");
            banner.className = "sp-banner sp-error";
            banner.textContent = i18n("Could not reach device. Enter the action key manually.");
            pickerSection.appendChild(banner);
            var kf: any = document.createElement("div");
            kf.className = "sp-field";
            kf.appendChild(helpers.fieldLabel(i18n("Action Key"), helpers.idPrefix + "local-key"));
            var keyInp: any = helpers.textInput(helpers.idPrefix + "local-key", b.entity, i18n("e.g. {example}", { example: "zoom_mute" }));
            kf.appendChild(keyInp);
            pickerSection.appendChild(kf);
            helpers.bindField(keyInp, "entity", true);
            helpers.requireField(keyInp, i18n("Add an action key before saving."));
        }
        pickerSection.textContent = i18n("Loading actions…");
        fetch("/local_actions", { credentials: "include" })
            .then(function (this: any, resp?: any) {
            if (!resp.ok)
                throw new Error("HTTP " + resp.status);
            return resp.json();
        })
            .then(function (this: any, data?: any) {
            if (!data.length) {
                buildEmpty();
            }
            else {
                buildDropdown(data);
            }
        })
            .catch(function (this: any) {
            buildFallback();
        });
    }
}
