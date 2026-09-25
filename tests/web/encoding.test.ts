import {
  chooseSerializedSubpageConfig,
  configOptionEnabled,
  configOptionValue,
  decodeConfigField,
  encodeConfigField,
  legacyButtonConfigSafe,
  parseRawButtonConfig,
  parseRawSubpageConfig,
  parseStructuredSubpageConfig,
  buildSubpageGrid,
  firstFreeStandaloneScreenSlot,
  serializeCompactSubpageConfig,
  serializeLegacySubpageConfig,
  setConfigOption,
  setConfigOptionValue,
  splitSubpageConfigChunks,
  standaloneScreenNameError,
  serializeHomeGridOrder,
  structuredSubpageFromParsed,
  wrapStandaloneScreenConfig,
  trimConfigFields,
} from "../../src/webserver/model";
import {
  cardContractSubpageTypeCode,
  cardContractSubpageTypeFromCode,
} from "../../src/webserver/generated/card_contract";
import { createConfigCodecFeature } from "../../src/webserver/application/config_codec";

function equal<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) throw new Error(`${message}: expected ${String(expected)}, received ${String(actual)}`);
}

function deepEqual(actual: unknown, expected: unknown, message: string): void {
  const actualText = JSON.stringify(actual);
  const expectedText = JSON.stringify(expected);
  if (actualText !== expectedText) throw new Error(`${message}: expected ${expectedText}, received ${actualText}`);
}

export function runEncodingTests(): void {
  const fieldCases = [
    "plain text",
    "50%, warm;cool|night:mode",
    "23°C",
    "emoji 🌤️",
  ];
  for (const value of fieldCases) {
    equal(decodeConfigField(encodeConfigField(value)), value, `field round-trip for ${value}`);
  }
  equal(encodeConfigField("first,second"), "first%2Csecond", "compact field commas are escaped");
  equal(decodeConfigField("broken%ZZvalue"), "broken%ZZvalue", "invalid percent runs are preserved");
  deepEqual(trimConfigFields(["one", "", ""]), ["one"], "trailing empty fields are removed");
  equal(legacyButtonConfigSafe(["light.kitchen", "Kitchen"]), true, "plain cards use legacy encoding");
  equal(legacyButtonConfigSafe(["light.kitchen", "Kitchen;Main"]), false, "delimiter-bearing cards use compact encoding");

  let options = setConfigOption("active_color", "confirm_on", true);
  equal(configOptionEnabled(options, "confirm_on"), true, "flag options can be enabled");
  options = setConfigOptionValue(options, "confirm_message", "Run, now?");
  equal(configOptionValue(options, "confirm_message"), "Run, now?", "valued options round-trip reserved characters");
  options = setConfigOption(options, "confirm_on", false);
  equal(configOptionEnabled(options, "confirm_on"), false, "flag options can be disabled");

  deepEqual(parseRawButtonConfig("light.kitchen;Kitchen;Lightbulb;Auto;;;;;active_color"), {
    entity: "light.kitchen",
    label: "Kitchen",
    icon: "Lightbulb",
    icon_on: "Auto",
    sensor: "",
    unit: "",
    type: "",
    precision: "",
    options: "active_color",
  }, "legacy card parse");
  deepEqual(parseRawButtonConfig("~light.kitchen,Kitchen%2C%20Main,Lightbulb,Auto,,,,,active_color"), {
    entity: "light.kitchen",
    label: "Kitchen, Main",
    icon: "Lightbulb",
    icon_on: "Auto",
    sensor: "",
    unit: "",
    type: "",
    precision: "",
    options: "active_color",
  }, "compact card parse");

  const legacy = serializeLegacySubpageConfig(["1", "B"], [[
    "light.kitchen", "Kitchen", "Lightbulb", "Auto", "", "", "", "", "active_color",
  ]]);
  const compact = serializeCompactSubpageConfig(["1", "B"], [[
    cardContractSubpageTypeCode(""), "light.kitchen", "Kitchen", "Lightbulb", "Auto", "", "", "", "active_color",
  ]]);
  equal(chooseSerializedSubpageConfig(["1", "B"], 1, legacy, compact), compact.length < legacy.length ? compact : legacy,
    "subpage serializer chooses the shortest compatible representation");
  const parsed = parseRawSubpageConfig(compact, cardContractSubpageTypeFromCode);
  equal(parsed.buttons[0]?.entity, "light.kitchen", "compact subpage entity round-trip");
  equal(parsed.buttons[0]?.options, "active_color", "compact subpage option round-trip");

  const named = parseRawSubpageConfig(
    "@screen:Kitchen view\n" + compact,
    cardContractSubpageTypeFromCode,
  );
  equal(named.standalone, true, "named screen envelope marks a standalone screen");
  equal(named.screenLabel, "Kitchen view", "named screen envelope decodes its label");
  equal(named.buttons[0]?.entity, "light.kitchen", "named screen retains its subpage payload");
  equal(
    wrapStandaloneScreenConfig("Kitchen view", compact),
    "@screen:Kitchen view\n" + compact,
    "named screen serialization uses the firmware envelope",
  );
  const codec = createConfigCodecFeature(
    { definitions: {} } as any, {} as any, {} as any, { connectSubpageParser: () => {} } as any, {} as any, {} as any,
    {} as any, {} as any, {} as any, {} as any, {} as any, {} as any,
    { numSlots: 2, gridCols: 2 } as any,
    { saveSubpageEntity: () => {}, scheduleSliderSubpageMigration: () => {} },
    { schedule: () => {} } as any,
    { renderPreview: () => {}, renderButtonSettings: () => {} },
  );
  equal(
    codec.serializeSubpageConfig({
      standalone: true, screenLabel: "Empty", order: [], buttons: [], grid: [], sizes: {},
    }),
    "@screen:Empty\n",
    "the application serializer retains an empty named screen",
  );
  const emptyNamed = parseRawSubpageConfig("@screen:Empty\n", cardContractSubpageTypeFromCode);
  equal(emptyNamed.standalone, true, "empty named screens remain present");
  equal(emptyNamed.buttons.length, 0, "empty named screens have no cards");
  const structuredNamed = structuredSubpageFromParsed(named);
  equal(structuredNamed.standalone, true, "structured backups preserve standalone metadata");
  equal(structuredNamed.screenLabel, "Kitchen view", "structured backups preserve screen names");
  equal(parseStructuredSubpageConfig(structuredNamed).screenLabel, "Kitchen view",
    "structured standalone metadata round-trips");

  const standaloneGrid = buildSubpageGrid({ ...named, order: ["1"] }, 2, 2);
  deepEqual(standaloneGrid.grid, [1, 0], "standalone screens can use the first grid cell without Back");
  const ordinaryGrid = buildSubpageGrid({ ...parsed, order: ["1"] }, 2, 2);
  deepEqual(ordinaryGrid.grid, [-2, 1], "ordinary subpages retain their Back tile");
  equal(standaloneScreenNameError(""), "required", "empty screen names are rejected");
  equal(standaloneScreenNameError("   "), "required", "whitespace-only screen names are rejected");
  equal(standaloneScreenNameError("Bad\u007fname"), "control-character", "C1 controls are rejected");
  equal(standaloneScreenNameError("😀".repeat(17)), "too-long", "screen names use the 64-byte UTF-8 limit");
  equal(
    firstFreeStandaloneScreenSlot(
      { "1": emptyNamed, "2": undefined },
      [{}, { type: "subpage" }, { type: "static" }],
      3,
    ),
    3,
    "screen allocation reserves payloads and empty ordinary subpage cards but allows normal home cards",
  );
  equal(serializeHomeGridOrder([0, 0], {}, { "1": emptyNamed }), "0",
    "an empty home grid with a standalone screen uses the configured sentinel");
  equal(serializeHomeGridOrder([0, 0], {}, {}), "",
    "an empty home grid without standalone screens remains unconfigured");
  equal(serializeHomeGridOrder([1, 0], {}, { "2": emptyNamed }), "1",
    "a populated home grid keeps its ordinary byte encoding");

  equal(
    serializeLegacySubpageConfig(["1", "B"], [["light.kitchen", "Kitchen"]]),
    "1,B|light.kitchen:Kitchen",
    "ordinary subpage bytes remain unchanged",
  );

  const utf8Subpage = "Door 🌤️|".repeat(16);
  const chunks = splitSubpageConfigChunks(utf8Subpage, 4, 64);
  if (!chunks) throw new Error("UTF-8 subpage data should fit the requested chunks");
  equal(chunks.join(""), utf8Subpage, "UTF-8 chunks reassemble exactly");
  if (chunks.some((chunk) => new TextEncoder().encode(chunk).length > 64)) {
    throw new Error("UTF-8 chunks must respect the device byte limit");
  }
}
