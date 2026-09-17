import { state } from "../state/app_instance";
import { CARD_SIZE_SINGLE, sizeColSpan } from "../model/grid";
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
import type { ConfigSensorOptionsFeature } from "../application/config_sensor_options";
import type { ControlsFieldsFeature } from "../application/controls_fields";
import { i18n, i18nDevice, i18nDynamic } from "../i18n";
export function registerSensorCardTypes(
    registry: CardRegistry,
    sensorOptions: ConfigSensorOptionsFeature,
    fields: ControlsFieldsFeature,
    cardUi: CardUiServices,
): void {
    const { renderButtonSettings } = cardUi;
    const { cardBadgeLabelHtml, cardSensorPreviewHtml, condField, toggleRow } = fields;
    const {
        sensorCardLocalSource: SENSOR_CARD_LOCAL_SENSOR,
        sensorCardModeController,
        sensorCardIsLocal,
        normalizeSensorOptions,
        sensorActiveColorEnabled,
        sensorTimeUnit,
        setSensorTimeUnit,
        setSensorActiveColorEnabled,
        sensorStateLabelsEnabled,
        sensorStateInput,
        sensorStateOutput,
        sensorStateInput2,
        sensorStateOutput2,
        setSensorStateTranslations,
    } = sensorOptions;
    // Read-only sensor card: displays either numeric data or a text state.
    var SENSOR_CARD_METADATA: any = {
        source: {
            label: i18n("Source"),
            options: [
                ["ha", "Home Assistant"],
                [SENSOR_CARD_LOCAL_SENSOR, i18n("Local Sensor")],
            ],
            value: function (this: any, b?: any) {
                return sensorCardIsLocal(b) ? SENSOR_CARD_LOCAL_SENSOR : "ha";
            },
        },
        entity: {
            label: i18n("Sensor Entity"),
            idSuffix: "sensor",
            placeholder: i18n("e.g. {example}", { example: "sensor.living_room_temperature" }),
            domains: function (this: any) { return cardContractDomains("sensor"); },
            bindName: "sensor",
            rerender: true,
            requiredMessage: i18n("Add a sensor entity before saving."),
        },
        mode: {
            label: i18n("Type"),
            idSuffix: "sensor-type",
            options: [
                ["numeric", i18n("Numeric")],
                ["time", i18n("Time")],
                ["text", i18n("Text")],
                ["icon", i18n("Icon")],
            ],
            value: function (this: any, b?: any) {
                if (b.precision === "icon")
                    return "icon";
                if (b.precision === "time")
                    return "time";
                return b.precision === "text" ? "text" : "numeric";
            },
        },
        largeNumbers: {
            label: i18n("Large Sensor Numbers"),
            idSuffix: "large-sensor-numbers",
            supported: function (this: any, b?: any) {
                return !sensorCardIsLocal(b) && b.precision !== "icon" && b.precision !== "text" && b.precision !== "time";
            },
        },
        activeColor: {
            label: i18n("Lit When Active"),
            idSuffix: "sensor-active-color",
            checked: sensorActiveColorEnabled,
        },
        preview: {
            iconBadge: "toggle-switch",
            numericBadge: "gauge",
            textBadge: "format-text",
        },
    };
    registry.register("sensor", {
        label: function (this: any) { return i18nDynamic(cardContractCardLabel("sensor")); },
        allowInSubpage: function (this: any) { return cardContractAllowInSubpage("sensor"); },
        pickerKey: function (this: any) { return cardContractPickerKey("sensor"); },
        hidden: function (this: any) { return cardContractHidden("sensor"); },
        hideLabel: true,
        defaultConfig: function (this: any) { return cardContractDefaultConfig("sensor"); },
        cardMetadata: SENSOR_CARD_METADATA,
        onSelect: function (this: any, b?: any) {
            b.entity = "";
            b.icon_on = "Auto";
            if (!b.precision)
                b.precision = "";
            if (b.precision !== "icon" && b.precision !== "text")
                b.icon = "Auto";
            b.options = normalizeSensorOptions(b.options, b.precision);
        },
        renderSettings: function (this: any, panel?: any, b?: any, slot?: any, helpers?: any) {
            var sourceControl: any = helpers.renderCardSegmentControl(panel, b, helpers, {
                segment: Object.assign({}, SENSOR_CARD_METADATA.source, {
                    onSelect: function (this: any, button?: any, cardHelpers?: any, value?: any) {
                        setSource(value);
                    },
                }),
            });
            var sourceButtons: any = sourceControl.buttons;
            sourceButtons.ha.classList.toggle("active", !sensorCardIsLocal(b));
            sourceButtons[SENSOR_CARD_LOCAL_SENSOR].classList.toggle("active", sensorCardIsLocal(b));
            function setSource(this: any, value?: any) {
                var fields: any = sensorCardModeController().selectSource(b, value);
                if (!fields.length)
                    return;
                fields.forEach(function (field: any) { helpers.saveField(field, b[field]); });
                renderButtonSettings();
            }
            if (sensorCardIsLocal(b)) {
                renderSensorLocalSettings(panel, b, slot, helpers);
                return;
            }
            var displayMode: any = sensorCardModeController().displayMode(b);
            var isTextMode: any = displayMode === "text";
            var modeField: any = helpers.renderCardModeSelector(panel, b, helpers, {
                mode: Object.assign({}, SENSOR_CARD_METADATA.mode, {
                    onChange: function (this: any) {
                        setMode(this.value, true);
                    },
                }),
            });
            var modeSelect: any = modeField.select;
            helpers.renderCardEntityField(panel, b, helpers, SENSOR_CARD_METADATA);
            var numericSection: any = condField();
            var labelField: any = helpers.renderCardTextField(numericSection, b, helpers, {
                label: i18n("Label"),
                idSuffix: "label",
                field: "label",
                placeholder: i18n("e.g. Living Room"),
                rerender: true,
            });
            var labelInp: any = labelField.input;
            var unitField: any = helpers.renderCardTextField(numericSection, b, helpers, {
                label: i18n("Unit"),
                idSuffix: "unit",
                field: "unit",
                placeholder: i18n("e.g. {example}", { example: "\u00B0C" }),
                rerender: true,
            });
            var unitInp: any = unitField.input;
            unitInp.className = "sp-input";
            var precisionField: any = helpers.precisionField(helpers.idPrefix + "precision", !isTextMode ? (b.precision || "0") : "0", function (this: any) {
                b.precision = this.value === "0" ? "" : this.value;
                helpers.saveField("precision", b.precision);
            });
            var precisionSelect: any = precisionField.select;
            numericSection.appendChild(precisionField.field);
            helpers.renderCardLargeNumbersToggle(numericSection, b, helpers, SENSOR_CARD_METADATA);
            panel.appendChild(numericSection);
            var timeSection: any = condField();
            helpers.renderCardTextField(timeSection, b, helpers, {
                label: i18n("Label"),
                idSuffix: "time-label",
                field: "label",
                placeholder: i18n("e.g. UPS Runtime"),
                rerender: true,
            });
            var timeUnitField: any = helpers.selectField(i18n("Incoming Value Unit"), helpers.idPrefix + "time-unit", [
                ["", i18n("Auto")],
                ["seconds", i18n("Seconds")],
                ["minutes", i18n("Minutes")],
                ["hours", i18n("Hours")],
                ["days", i18n("Days")],
            ], sensorTimeUnit(b), function (this: any) {
                setSensorTimeUnit(b, this.value);
                helpers.saveField("options", b.options);
            });
            var timeUnitNote: any = document.createElement("div");
            timeUnitNote.className = "sp-apply-note";
            timeUnitNote.textContent = i18n("Auto uses the unit reported by Home Assistant. A manual choice overrides it.");
            timeUnitField.field.appendChild(timeUnitNote);
            timeSection.appendChild(timeUnitField.field);
            panel.appendChild(timeSection);
            var textSection: any = condField();
            var textIconPicker: any = helpers.renderCardIconPicker(textSection, b, helpers, {
                pickerIdSuffix: "icon-picker",
                idSuffix: "icon",
                field: "icon",
                fallback: "Auto",
            });
            panel.appendChild(textSection);
            var iconSection: any = condField();
            var offIconPicker: any = helpers.renderCardIconPicker(iconSection, b, helpers, {
                pickerIdSuffix: "icon-off-picker",
                idSuffix: "icon-off",
                field: "icon",
                fallback: "Auto",
                label: i18n("Icon"),
            });
            var onIconPicker: any = helpers.renderCardIconPicker(iconSection, b, helpers, {
                pickerIdSuffix: "icon-on-picker",
                idSuffix: "icon-on",
                field: "icon_on",
                fallback: "Auto",
                label: i18n("On Icon"),
            });
            panel.appendChild(iconSection);
            var activeColorToggle: any = helpers.renderCardActiveColorToggle(panel, b, helpers, SENSOR_CARD_METADATA.activeColor, setSensorActiveColorEnabled);
            var hasStateLabels: any = sensorStateLabelsEnabled(b);
            var advancedToggleSection: any = helpers.toggleSection(i18n("Advanced"), helpers.idPrefix + "sensor-advanced-toggle", hasStateLabels);
            var advancedToggle: any = advancedToggleSection.toggle;
            var advanced: any = advancedToggleSection.section;
            panel.appendChild(advancedToggle.row);
            if (hasStateLabels && isTextMode)
                advanced.classList.add("sp-visible");
            var stateTextGrid: any = document.createElement("div");
            stateTextGrid.className = "sp-state-translation-grid";
            advanced.appendChild(stateTextGrid);
            var inputTextField: any = helpers.textField(i18n("Input Status"), helpers.idPrefix + "sensor-state-input", sensorStateInput(b), i18n("e.g. {example}", { example: "high" }));
            var inputTextInp: any = inputTextField.input;
            stateTextGrid.appendChild(inputTextField.field);
            var outputTextField: any = helpers.textField(i18n("Display Text"), helpers.idPrefix + "sensor-state-output", sensorStateOutput(b), i18n("e.g. Please empty"));
            var outputTextInp: any = outputTextField.input;
            stateTextGrid.appendChild(outputTextField.field);
            var inputText2Field: any = helpers.textField(i18n("Input Status 2"), helpers.idPrefix + "sensor-state-input-2", sensorStateInput2(b), i18n("e.g. {example}", { example: "low" }));
            var inputText2Inp: any = inputText2Field.input;
            stateTextGrid.appendChild(inputText2Field.field);
            var outputText2Field: any = helpers.textField(i18n("Display Text 2"), helpers.idPrefix + "sensor-state-output-2", sensorStateOutput2(b), i18n("e.g. Full"));
            var outputText2Inp: any = outputText2Field.input;
            stateTextGrid.appendChild(outputText2Field.field);
            function saveStateTranslation(this: any) {
                setSensorStateTranslations(b, advancedToggle.input.checked, inputTextInp.value, outputTextInp.value, inputText2Inp.value, outputText2Inp.value);
                helpers.saveField("options", b.options);
            }
            inputTextInp.addEventListener("change", saveStateTranslation);
            outputTextInp.addEventListener("change", saveStateTranslation);
            inputText2Inp.addEventListener("change", saveStateTranslation);
            outputText2Inp.addEventListener("change", saveStateTranslation);
            advancedToggle.input.addEventListener("change", function (this: any) {
                if (this.checked) {
                    if (!isTextMode)
                        setMode("text", true);
                    advanced.classList.add("sp-visible");
                }
                else {
                    advanced.classList.remove("sp-visible");
                    inputTextInp.value = "";
                    outputTextInp.value = "";
                    inputText2Inp.value = "";
                    outputText2Inp.value = "";
                }
                saveStateTranslation();
            });
            panel.appendChild(advanced);
            function resetIconPicker(this: any, picker?: any, value?: any, slug?: any) {
                var iconPreview: any = picker.querySelector(".sp-icon-picker-preview");
                if (iconPreview)
                    iconPreview.className = "sp-icon-picker-preview mdi mdi-" + slug;
                var iconInput: any = picker.querySelector(".sp-icon-picker-input");
                if (iconInput)
                    iconInput.value = value;
            }
            function syncAdvancedVisibility(this: any) {
                advancedToggle.row.style.display = isTextMode ? "" : "none";
                if (!isTextMode)
                    advanced.classList.remove("sp-visible");
            }
            function setMode(this: any, mode?: any, persist?: any) {
                displayMode = mode === "icon" || mode === "text" || mode === "time" ? mode : "numeric";
                isTextMode = displayMode === "text";
                modeSelect.value = displayMode;
                numericSection.classList.toggle("sp-visible", displayMode === "numeric");
                timeSection.classList.toggle("sp-visible", displayMode === "time");
                textSection.classList.toggle("sp-visible", isTextMode);
                iconSection.classList.toggle("sp-visible", displayMode === "icon");
                activeColorToggle.row.style.display = displayMode === "time" ? "none" : "";
                syncAdvancedVisibility();
                if (displayMode === "time")
                    timeUnitField.select.value = sensorTimeUnit(b);
                if (!persist)
                    return;
                var transition: any = sensorCardModeController().selectDisplayMode(b, displayMode);
                if (displayMode === "time") {
                    unitInp.value = "";
                    advancedToggle.input.checked = false;
                    advanced.classList.remove("sp-visible");
                    inputTextInp.value = "";
                    outputTextInp.value = "";
                    inputText2Inp.value = "";
                    outputText2Inp.value = "";
                    resetIconPicker(textIconPicker, "Auto", "cog");
                    resetIconPicker(offIconPicker, "Auto", "cog");
                    resetIconPicker(onIconPicker, "Auto", "cog");
                }
                else if (isTextMode) {
                    labelInp.value = "";
                    unitInp.value = "";
                    resetIconPicker(onIconPicker, "Auto", "cog");
                }
                else if (displayMode === "icon") {
                    unitInp.value = "";
                    advancedToggle.input.checked = false;
                    advanced.classList.remove("sp-visible");
                    inputTextInp.value = "";
                    outputTextInp.value = "";
                    inputText2Inp.value = "";
                    outputText2Inp.value = "";
                }
                else {
                    advancedToggle.input.checked = false;
                    advanced.classList.remove("sp-visible");
                    inputTextInp.value = "";
                    outputTextInp.value = "";
                    inputText2Inp.value = "";
                    outputText2Inp.value = "";
                    resetIconPicker(textIconPicker, "Auto", "cog");
                    resetIconPicker(offIconPicker, "Auto", "cog");
                    resetIconPicker(onIconPicker, "Auto", "cog");
                    precisionSelect.value = "0";
                }
                transition.fields.forEach(function (field: any) { helpers.saveField(field, b[field]); });
                activeColorToggle.input.checked = sensorActiveColorEnabled(b);
            }
            setMode(displayMode, false);
        },
        renderPreview: function (this: any, b?: any, helpers?: any) {
            if (sensorCardIsLocal(b))
                return sensorLocalPreview(b, helpers);
            if (b.precision === "icon") {
                var stateIconName: any = b.icon && b.icon !== "Auto" ? iconSlug(b.icon) : "cog";
                return {
                    iconHtml: '<span class="sp-btn-icon mdi mdi-' + stateIconName + '"></span>',
                    labelHtml: cardBadgeLabelHtml(helpers, b.label || b.sensor || i18nDevice("Sensor"), SENSOR_CARD_METADATA.preview.iconBadge),
                };
            }
            if (b.precision === "text") {
                var iconName: any = b.icon && b.icon !== "Auto" ? iconSlug(b.icon) : "cog";
                return {
                    iconHtml: '<span class="sp-btn-icon mdi mdi-' + iconName + '"></span>',
                    labelHtml: cardBadgeLabelHtml(helpers, i18n("State"), SENSOR_CARD_METADATA.preview.textBadge),
                };
            }
            if (b.precision === "time") {
                var timeValue: any = sizeColSpan((helpers && helpers.cardSize) || CARD_SIZE_SINGLE) > 1
                    ? "1h 30m"
                    : "1h";
                return {
                    iconHtml: cardSensorPreviewHtml(b, helpers, timeValue, ""),
                    labelHtml: cardBadgeLabelHtml(helpers, b.label || b.sensor || i18nDevice("Sensor"), SENSOR_CARD_METADATA.preview.numericBadge),
                };
            }
            var label: any = b.label || b.sensor || i18nDevice("Sensor");
            var unit: any = b.unit || "";
            var prec: any = parseInt(b.precision || "0", 10) || 0;
            var sampleVal: any = (0).toFixed(prec);
            return {
                iconHtml: cardSensorPreviewHtml(b, helpers, sampleVal, unit),
                labelHtml: cardBadgeLabelHtml(helpers, label, SENSOR_CARD_METADATA.preview.numericBadge),
            };
        },
    });
    function renderSensorLocalSettings(this: any, panel?: any, b?: any, slot?: any, helpers?: any) {
        b.type = "sensor";
        b.sensor = SENSOR_CARD_LOCAL_SENSOR;
        var isTextMode: any = b.precision === "text";
        var showAll: any = false;
        var fetchedSensors: any = null;
        var modeField: any = document.createElement("div");
        modeField.className = "sp-field";
        modeField.appendChild(helpers.fieldLabel(i18n("Display")));
        var modeSeg: any = document.createElement("div");
        modeSeg.className = "sp-segment";
        var numericBtn: any = document.createElement("button");
        numericBtn.type = "button";
        numericBtn.textContent = i18n("Numeric");
        var textBtn: any = document.createElement("button");
        textBtn.type = "button";
        textBtn.textContent = i18n("Text");
        modeSeg.appendChild(numericBtn);
        modeSeg.appendChild(textBtn);
        modeField.appendChild(modeSeg);
        panel.appendChild(modeField);
        var pickerSection: any = document.createElement("div");
        panel.appendChild(pickerSection);
        var numericSection: any = condField();
        var lf: any = document.createElement("div");
        lf.className = "sp-field";
        lf.appendChild(helpers.fieldLabel(i18n("Label"), helpers.idPrefix + "label"));
        var labelInp: any = helpers.textInput(helpers.idPrefix + "label", b.label, i18n("e.g. Living Room"));
        lf.appendChild(labelInp);
        numericSection.appendChild(lf);
        helpers.bindField(labelInp, "label", true);
        var uf: any = document.createElement("div");
        uf.className = "sp-field";
        uf.appendChild(helpers.fieldLabel(i18n("Unit"), helpers.idPrefix + "unit"));
        var unitInp: any = helpers.textInput(helpers.idPrefix + "unit", b.unit, i18n("e.g. {example}", { example: "\u00B0C" }));
        unitInp.className = "sp-input";
        uf.appendChild(unitInp);
        numericSection.appendChild(uf);
        helpers.bindField(unitInp, "unit", true);
        var pf: any = document.createElement("div");
        pf.className = "sp-field";
        pf.appendChild(helpers.fieldLabel(i18n("Unit Precision"), helpers.idPrefix + "precision"));
        var precisionSelect: any = document.createElement("select");
        precisionSelect.className = "sp-select";
        precisionSelect.id = helpers.idPrefix + "precision";
        var precOpts: any = [["0", "10"], ["1", "10.2"], ["2", "10.21"]];
        for (var i: any = 0; i < precOpts.length; i++) {
            var opt: any = document.createElement("option");
            opt.value = precOpts[i][0];
            opt.textContent = precOpts[i][1];
            precisionSelect.appendChild(opt);
        }
        precisionSelect.value = !isTextMode ? (b.precision || "0") : "0";
        precisionSelect.addEventListener("change", function (this: any) {
            b.precision = this.value === "0" ? "" : this.value;
            helpers.saveField("precision", b.precision);
        });
        pf.appendChild(precisionSelect);
        numericSection.appendChild(pf);
        panel.appendChild(numericSection);
        var textSection: any = condField();
        var textIconPicker: any = helpers.makeIconPicker(helpers.idPrefix + "icon-picker", helpers.idPrefix + "icon", b.icon || "Auto", function (this: any, opt?: any) {
            b.icon = opt;
            helpers.saveField("icon", opt);
        });
        textSection.appendChild(textIconPicker);
        panel.appendChild(textSection);
        function setMode(this: any, mode?: any, persist?: any) {
            isTextMode = mode === "text";
            numericBtn.classList.toggle("active", !isTextMode);
            textBtn.classList.toggle("active", isTextMode);
            numericSection.classList.toggle("sp-visible", !isTextMode);
            textSection.classList.toggle("sp-visible", isTextMode);
            if (!persist)
                return;
            if (isTextMode) {
                b.precision = "text";
                b.label = "";
                b.unit = "";
                b.icon_on = "Auto";
                labelInp.value = "";
                unitInp.value = "";
                helpers.saveField("precision", "text");
                helpers.saveField("label", "");
                helpers.saveField("unit", "");
                helpers.saveField("icon_on", "Auto");
            }
            else {
                b.precision = "";
                b.icon = "Auto";
                helpers.saveField("precision", "");
                helpers.saveField("icon", "Auto");
                var iconPreview: any = textIconPicker.querySelector(".sp-icon-picker-preview");
                if (iconPreview)
                    iconPreview.className = "sp-icon-picker-preview mdi mdi-cog";
                var iconInput: any = textIconPicker.querySelector(".sp-icon-picker-input");
                if (iconInput)
                    iconInput.value = "Auto";
                precisionSelect.value = "0";
            }
        }
        numericBtn.addEventListener("click", function (this: any) {
            setMode("numeric", true);
            if (fetchedSensors)
                buildDropdown(fetchedSensors);
        });
        textBtn.addEventListener("click", function (this: any) {
            setMode("text", true);
            if (fetchedSensors)
                buildDropdown(fetchedSensors);
        });
        setMode(isTextMode ? "text" : "numeric", false);
        function buildDropdown(this: any, sensors?: any) {
            pickerSection.innerHTML = "";
            pickerSection.className = "";
            var wantType: any = isTextMode ? "text" : "numeric";
            var filtered: any = sensors.filter(function (this: any, s?: any) {
                return s.type === wantType && (showAll || !s.internal);
            });
            var sf: any = document.createElement("div");
            sf.className = "sp-field";
            sf.appendChild(helpers.fieldLabel(i18n("Local Sensor"), helpers.idPrefix + "sensor-sel"));
            var sel: any = document.createElement("select");
            sel.className = "sp-select";
            sel.id = helpers.idPrefix + "sensor-sel";
            var placeholder: any = document.createElement("option");
            placeholder.value = "";
            placeholder.textContent = i18n("Choose a sensor…");
            sel.appendChild(placeholder);
            filtered.forEach(function (this: any, s?: any) {
                var opt: any = document.createElement("option");
                opt.value = s.key;
                opt.textContent = s.type === "text" ? i18n("{name} (text)", { name: s.name }) : s.name;
                if (s.key === b.entity)
                    opt.selected = true;
                sel.appendChild(opt);
            });
            if (b.entity && !filtered.some(function (this: any, s?: any) { return s.key === b.entity; })) {
                var curOpt: any = document.createElement("option");
                curOpt.value = b.entity;
                curOpt.textContent = i18n("{entity} (current)", { entity: b.entity });
                curOpt.selected = true;
                sel.appendChild(curOpt);
            }
            sel.addEventListener("change", function (this: any) {
                var key: any = this.value;
                if (!key)
                    return;
                b.entity = key;
                helpers.saveField("entity", key);
                var sensor: any = sensors.find(function (this: any, s?: any) { return s.key === key; });
                if (!sensor)
                    return;
                if (!b.label) {
                    b.label = sensor.name;
                    labelInp.value = sensor.name;
                    helpers.saveField("label", sensor.name);
                }
                if (!b.unit && sensor.unit) {
                    b.unit = sensor.unit;
                    unitInp.value = sensor.unit;
                    helpers.saveField("unit", sensor.unit);
                }
                setMode(sensor.type === "text" ? "text" : "numeric", true);
            });
            sf.appendChild(sel);
            pickerSection.appendChild(sf);
            var tog: any = toggleRow(i18n("Show internal sensors"), helpers.idPrefix + "show-all", showAll);
            tog.input.addEventListener("change", function (this: any) {
                showAll = this.checked;
                buildDropdown(sensors);
            });
            pickerSection.appendChild(tog.row);
        }
        function buildManualInput(this: any) {
            pickerSection.innerHTML = "";
            pickerSection.className = "sp-local-picker-fallback";
            var errDiv: any = document.createElement("div");
            errDiv.className = "sp-banner sp-error";
            errDiv.textContent = i18n("Could not reach device. Enter sensor key manually.");
            pickerSection.appendChild(errDiv);
            var kf: any = document.createElement("div");
            kf.className = "sp-field";
            kf.appendChild(helpers.fieldLabel(i18n("Sensor Key"), helpers.idPrefix + "local-sensor-key"));
            var keyInp: any = helpers.textInput(helpers.idPrefix + "local-sensor-key", b.entity, i18n("e.g. {example}", { example: "room_temp" }));
            kf.appendChild(keyInp);
            pickerSection.appendChild(kf);
            helpers.bindField(keyInp, "entity", true);
            helpers.requireField(keyInp, i18n("Add a sensor key before saving."));
        }
        var loadingDiv: any = document.createElement("div");
        loadingDiv.className = "sp-field";
        loadingDiv.textContent = i18n("Loading sensors…");
        pickerSection.appendChild(loadingDiv);
        fetch("/local_sensors", { credentials: "include" })
            .then(function (this: any, resp?: any) {
            if (!resp.ok)
                throw new Error("HTTP " + resp.status);
            return resp.json();
        })
            .then(function (this: any, data?: any) {
            fetchedSensors = data;
            buildDropdown(data);
        })
            .catch(function (this: any) {
            buildManualInput();
        });
    }
    function sensorLocalPreview(this: any, b?: any, helpers?: any) {
        if (b.precision === "text") {
            var iconName: any = b.icon && b.icon !== "Auto" ? iconSlug(b.icon) : "cog";
            return {
                iconHtml: '<span class="sp-btn-icon mdi mdi-' + iconName + '"></span>',
                labelHtml: cardBadgeLabelHtml(helpers, i18n("State"), SENSOR_CARD_METADATA.preview.numericBadge),
            };
        }
        var label: any = b.label || b.entity || i18n("Local Sensor");
        var unit: any = b.unit ? helpers.escHtml(b.unit) : "";
        var prec: any = parseInt(b.precision || "0", 10) || 0;
        var sampleVal: any = (0).toFixed(prec);
        return {
            iconHtml: cardSensorPreviewHtml(b, helpers, sampleVal, unit),
            labelHtml: cardBadgeLabelHtml(helpers, label, SENSOR_CARD_METADATA.preview.numericBadge),
        };
    }
}
