import { createInitialState } from "../../src/webserver/state/app_state";
import * as settings from "../../src/webserver/model/settings";
import { createScreensaverClockFormatFeature } from "../../src/webserver/application/screensaver_clock_format";
import { createScreensaverClockFontFeature } from "../../src/webserver/application/screensaver_clock_font";
import { state, initializeAppState } from "../../src/webserver/state/app_instance";
import { initializeDeviceConfig } from "../../src/webserver/device_config";

function equal(actual: unknown, expected: unknown, message: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

export async function runScreensaverClockFontTests(): Promise<void> {
  Object.assign(globalThis, { __ESPCONTROL_DEFAULT_DEVICE_ID__: "test", __ESPCONTROL_DEVICE_PROFILES__: { test: { slots: 1 } }, __ESPCONTROL_TIMEZONE_OPTIONS__: [] });
  await initializeDeviceConfig();
  const initial = createInitialState({ slots: 1 } as any);
  equal((initial as any).screensaverClockFont, "Roboto Thin", "new devices retain the existing thin clock appearance");
  equal(initial.screensaverAction, "off", "appearance does not enable the clock screensaver");
  const normalize = (settings as any).normalizeScreensaverClockFont;
  for (const [input, expected] of [[undefined, "Roboto Thin"], [null, "Roboto Thin"], ["future", "Roboto Thin"], ["Roboto Bold", "Roboto Bold"], ["Roboto Mono", "Roboto Mono"], ["Roboto Thin", "Roboto Thin"]]) {
    equal(normalize(input), expected, "backup font normalization");
  }
  const backupCurrent = { clockFormatOptions: ["12h", "24h"], ntpDefaults: [], updateFrequencyOptions: [], screenRotationOptions: [] } as any;
  for (const [backup, expected] of [[{}, "Roboto Thin"], [{ screensaver_clock_font: "invalid" }, "Roboto Thin"], [{ screensaver_clock_font: "Roboto Mono" }, "Roboto Mono"]] as const) {
    equal((settings.normalizeBackupPanelSettings(backup, backupCurrent) as any).screensaverClockFont, expected, "flat backup settings preserve or default clock font");
  }
  const validFormat = (settings as any).isValidScreensaverClockFormat;
  const normalizeFormat = (settings as any).normalizeScreensaverClockFormat;
  const normalizeSize = (settings as any).normalizeScreensaverClockSize;
  for (const value of ["", "%H:%M", "%H:%M:%S", "%I:%M", "%d.%m.%Y", "%Y-%m-%d", "12 / 2026", "%y", "%Y".repeat(8)])
    equal(validFormat(value), true, `valid numeric clock format ${value}`);
  for (const value of [" ", "---", "abc", "%p", "%%", "%", "%H\n%M", "%H\t%M", "%Y".repeat(9), "1".repeat(33), null, 123]) {
    equal(validFormat(value), false, `unsafe or oversized format ${value}`);
    equal(normalizeFormat(value), "", "invalid backup format retains legacy default");
  }
  equal(normalizeFormat("%H:%M:%S"), "%H:%M:%S", "seconds format roundtrips");
  for (const value of [undefined, "future", "", 4]) equal(normalizeSize(value), "Auto", "invalid backup size defaults to Auto");
  for (const value of ["Auto", "Small", "Medium", "Large"]) equal(normalizeSize(value), value, "known size roundtrips");
  function setup(metadata: any | Promise<any>, response: any = { ok: true }) {
    initializeAppState();
    Object.assign(state, initial, { screensaverClockFontOptions: [] });
    const writes: unknown[] = [];
    const warnings: string[] = [];
    const reads: unknown[] = [];
    const feature = createScreensaverClockFontFeature({ els: {} } as any, {
      getJsonFirst: async (paths: any) => { reads.push(paths); return typeof metadata === "function" ? metadata() : metadata; },
      entityDetailPaths: (domain: any, names: any, detail: any) => names.map((name: string) => `/${domain}/${name}?detail=${detail}`),
      postSelect: async (name: any, value: any) => { writes.push([name, value]); return response; },
    }, { entityName: () => "Screen Saver Clock Font" }, { showBanner: (message: string) => warnings.push(message) });
    return { feature, writes, warnings, reads };
  }
  const metadata = { id: "select-screen_saver_clock_font", value: "Roboto Bold", option: ["Roboto Thin", "Roboto Bold", "Roboto Mono", "Future Font"] };
  let env = setup(metadata);
  equal(await env.feature.setFont("Roboto Bold"), false, "no blind POST before metadata");
  equal(env.writes, [], "loading guard does not reach the device");
  await env.feature.load();
  equal(state.screensaverClockFontOptions, ["Roboto Thin", "Roboto Bold", "Roboto Mono"], "only recognized advertised options are offered");
  equal(state.screensaverClockFont, "Roboto Bold", "GET updates current font");
  env.feature.applyState({ value: "Roboto Mono" });
  equal(state.screensaverClockFont, "Roboto Mono", "SSE state-only update preserves capabilities");
  env.feature.applyState({ value: "Future Font" });
  equal(state.screensaverClockFont, "Roboto Thin", "unknown incoming state falls back locally");
  equal(env.writes, [], "incoming GET and SSE never correct firmware via POST");
  await env.feature.setFont("Roboto Mono");
  equal(env.writes, [["Screen Saver Clock Font", "Roboto Mono"]], "supported write uses stable protocol option");
  equal(state.screensaverClockFont, "Roboto Mono", "successful write updates state without requiring an echo");
  await env.feature.restore(undefined);
  equal(state.screensaverClockFont, "Roboto Thin", "old backups reset to Thin on supported firmware");
  await env.feature.restore("unknown");
  equal(env.writes.length, 3, "invalid backup font also restores Thin");

  env = setup(null);
  await env.feature.restore("Roboto Bold");
  equal(env.writes, [], "old firmware restores without posting the unsupported entity");
  equal(env.warnings.length, 1, "skipped font restore informs the user");

  let retryMetadata: any = null;
  env = setup(() => retryMetadata);
  await env.feature.load();
  equal(await env.feature.setFont("Roboto Bold"), false, "unreachable metadata never permits writes");
  retryMetadata = metadata;
  await env.feature.load();
  equal(await env.feature.setFont("Roboto Bold"), true, "later discovery retries after a transient read failure");

  env = setup({ ...metadata, option: ["Roboto Bold"] });
  await env.feature.restore("Roboto Mono");
  equal(env.writes, [], "missing preset and unavailable Thin are skipped");
  equal(env.warnings.length, 1, "partial firmware skip is reported");
  await env.feature.setFont("Roboto Thin");
  equal(env.writes, [], "unadvertised known preset cannot be posted");

  env = setup({ ...metadata, option: ["Roboto Thin"] });
  await env.feature.restore("Roboto Mono");
  equal(env.writes, [["Screen Saver Clock Font", "Roboto Thin"]], "unavailable backup preset falls back only to advertised Thin");

  let resolveMetadata!: (value: any) => void;
  env = setup(new Promise(resolve => { resolveMetadata = resolve; }));
  const loading = env.feature.load();
  const restoring = env.feature.restore("Roboto Mono");
  await Promise.resolve();
  equal(env.writes, [], "restore waits for asynchronous capability discovery");
  equal(env.reads.length, 1, "restore shares the pending metadata request");
  resolveMetadata(metadata);
  await Promise.all([loading, restoring]);
  equal(env.writes, [["Screen Saver Clock Font", "Roboto Mono"]], "restore resumes with supported option after discovery");

  env = setup(new Promise(resolve => { resolveMetadata = resolve; }));
  const racingLoad = env.feature.load();
  env.feature.applyState({ value: "Roboto Mono" });
  resolveMetadata(metadata);
  await racingLoad;
  equal(state.screensaverClockFont, "Roboto Mono", "a late GET cannot overwrite newer state-only SSE");
  equal(state.screensaverClockFontOptions, ["Roboto Thin", "Roboto Bold", "Roboto Mono"], "a state-only SSE does not discard pending GET capabilities");
  equal(await env.feature.setFont("Roboto Bold"), true, "late metadata enables supported writes after state-only SSE");

  env = setup(new Promise(resolve => { resolveMetadata = resolve; }));
  const racingMetadataLoad = env.feature.load();
  env.feature.applyState({ value: "Roboto Mono", option: ["Roboto Mono"] });
  resolveMetadata(metadata);
  await racingMetadataLoad;
  equal(state.screensaverClockFontOptions, ["Roboto Mono"], "a late GET cannot restore options removed by newer SSE metadata");
  equal(await env.feature.setFont("Roboto Bold"), false, "stale GET options never authorize an unsupported write");
  equal(env.writes, [], "metadata races remain read-only");

  env = setup(metadata, { ok: false, status: 500 });
  await env.feature.load();
  equal(await env.feature.setFont("Roboto Mono"), false, "failed write remains failure");
  equal(state.screensaverClockFont, "Roboto Bold", "failed write leaves confirmed state intact");
  let failed = false;
  try { await env.feature.restore("Roboto Mono"); } catch { failed = true; }
  equal(failed, true, "backup restore does not disguise a real failed font write as success");

  const formatWrites: unknown[] = [];
  const formatWarnings: string[] = [];
  let resolveFormats!: (value: any) => void;
  const pendingFormats = new Promise(resolve => { resolveFormats = resolve; });
  let failFormatWrite = false;
  initializeAppState();
  const formats = createScreensaverClockFormatFeature({ els: {} } as any, {
    entityDetailPaths: (domain: any, names: any) => [`/${domain}/${names[0]}`],
    getJsonFirst: async (paths: any) => {
      await pendingFormats;
      if (paths[0].includes("date_format")) return null;
      if (paths[0].includes("date_size")) return { id: "select-screen_saver_clock_date_size", value: "Small", option: ["Small", "Medium", "Future"] };
      if (paths[0].includes("time_size")) return { id: "select-screen_saver_clock_time_size", value: "Auto", option: ["Auto", "Large"] };
      return { id: "text-screen_saver_clock_time_format", value: "%H:%M", max_length: 32 };
    },
    postText: async (name: any, value: any) => { formatWrites.push([name, value]); return { ok: !failFormatWrite }; },
    postSelect: async (name: any, value: any) => { formatWrites.push([name, value]); return { ok: !failFormatWrite }; },
  }, { entityName: (key: string) => key }, { showBanner: (message: string) => formatWarnings.push(message) });
  equal(await formats.set("timeFormat", "%H:%M:%S"), false, "format write is blocked before discovery");
  const restoreFormats = formats.restore({ screensaverClockTimeFormat: "%H:%M:%S", screensaverClockDateFormat: "%d.%m.%Y", screensaverClockTimeSize: "Medium", screensaverClockDateSize: "Large" });
  await Promise.resolve();
  equal(formatWrites, [], "all expanded settings wait for metadata");
  formats.applyState("timeSize", { value: "Large" });
  resolveFormats(null);
  await restoreFormats;
  equal(formatWrites, [["screen_saver_clock_time_format", "%H:%M:%S"], ["screen_saver_clock_time_size", "Auto"]], "restore writes only supported entities and falls back to advertised Auto");
  equal(formatWarnings.length, 2, "missing date and size without Auto are skipped with warning");
  equal(state.screensaverClockTimeFormat, "%H:%M:%S", "successful format restore synchronizes state");
  formats.applyState("timeFormat", { value: "%I:%M" });
  equal(state.screensaverClockTimeFormat, "%I:%M", "format SSE updates state");
  equal(await formats.set("timeFormat", "%p"), false, "invalid draft never posts");
  equal(await formats.set("dateSize", "Auto"), false, "unadvertised size never posts");
  equal(formatWrites.length, 2, "read-only events and invalid requests have no transport effects");
  failFormatWrite = true;
  equal(await formats.set("timeFormat", "%H:%M"), false, "failed format write is not accepted");
  equal(state.screensaverClockTimeFormat, "%I:%M", "failed format write preserves confirmed state");
  failed = false;
  try { await formats.restore({}); } catch { failed = true; }
  equal(failed, true, "failed format restore propagates error");
  const normalized = settings.normalizeBackupPanelSettings({ screensaver_clock_time_format: "%p", screensaver_clock_date_format: "%d.%m.%Y", screensaver_clock_time_size: "Small", screensaver_clock_date_size: "bogus" }, backupCurrent) as any;
  equal([normalized.screensaverClockTimeFormat, normalized.screensaverClockDateFormat, normalized.screensaverClockTimeSize, normalized.screensaverClockDateSize], ["", "%d.%m.%Y", "Small", "Auto"], "expanded backup normalization defaults invalid fields independently");
}
