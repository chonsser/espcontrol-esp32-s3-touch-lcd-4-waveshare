import { createScreensaverHlsFeature, validHlsUrl } from "../../src/webserver/application/screensaver_hls";
import { normalizeScreensaverAction, screensaverActionOption } from "../../src/webserver/model/settings";
import { state, initializeAppState } from "../../src/webserver/state/app_instance";
import { initializeDeviceConfig } from "../../src/webserver/device_config";

function equal(actual: unknown, expected: unknown, message: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${message}: ${JSON.stringify(actual)} != ${JSON.stringify(expected)}`);
}
export async function runScreensaverHlsTests() {
  Object.assign(globalThis, { __ESPCONTROL_DEFAULT_DEVICE_ID__: "test", __ESPCONTROL_DEVICE_PROFILES__: { test: { slots: 1 } }, __ESPCONTROL_TIMEZONE_OPTIONS__: [] });
  await initializeDeviceConfig();
  equal(normalizeScreensaverAction("HLS Stream"), "hls", "wire action normalizes");
  equal(screensaverActionOption("hls"), "HLS Stream", "action roundtrips");
  for (const url of ["http://panel.local/live.m3u8", "https://example.org/live?token=abc%2F123", ""]) equal(validHlsUrl(url), true, "valid URL");
  for (const url of ["rtsp://camera/live", "http://user:pass@host/live", "http://host/x#fragment", "http://host/\nx", "http:///host/live", "http://%65xample.org/live", "http://host:/live", "http://host:0/live", "http://host/" + "x".repeat(255)]) equal(validHlsUrl(url), false, "reject unsafe URL");
  function setup(action: any, url: any, ok = true) {
    initializeAppState();
    const writes: any[] = [], warnings: any[] = [];
    const feature = createScreensaverHlsFeature({ els: {} } as any, {
      entityDetailPaths: (domain: string) => [domain],
      getJsonFirst: async (paths: string[]) => paths[0] === "select" ? action : url,
      postSelect: async (name: string, value: string) => { writes.push([name, value]); return { ok }; },
      postTextWithObjectIds: async (name: string, _ids: string[], value: string) => { writes.push([name, value]); return { ok }; },
    } as any, { entityName: (name: string) => name, entityObjectIds: (name: string) => [name] } as any,
    { showBanner: (message: string) => warnings.push(message) } as any, () => {});
    return { feature, writes, warnings };
  }
  const action = { value: "Display Off", option: ["Display Off", "Clock", "HLS Stream"] };
  const url = { value: "", max_length: 255 };
  for (const [a, u] of [[null, null], [action, null], [null, url]]) {
    const env = setup(a, u);
    await env.feature.load();
    equal(env.feature.supported(), false, "both capabilities required");
    equal(await env.feature.saveUrl("http://host/live.m3u8"), false, "no blind URL write");
    equal(await env.feature.setAction("hls"), false, "no unsupported action");
    equal(await env.feature.restoreUrl("http://host/live.m3u8", "hls"), "off", "unsupported backup falls back");
    equal(env.writes, [], "unsupported device receives no HLS writes");
  }
  let env = setup(action, url);
  await env.feature.load();
  equal(env.feature.supported(), true, "empty existing URL still advertises capability");
  equal(env.writes, [], "discovery never saves");
  env.feature.applyAction({ value: "HLS Stream" });
  equal(env.feature.supported(), true, "SSE preserves metadata");
  equal(await env.feature.setAction("hls"), false, "cannot enable empty URL");
  equal(await env.feature.saveUrl("http://host/live.m3u8"), true, "explicit URL save");
  equal(state.screensaverHlsUrl, "http://host/live.m3u8", "confirmed state saved");
  equal(await env.feature.setAction("hls"), true, "enable after URL confirmation");
  equal(env.writes, [["screen_saver_hls_url", "http://host/live.m3u8"], ["screen_saver_action", "HLS Stream"]], "URL precedes action");
  env = setup(action, { value: "http://host/old.m3u8" }, false);
  await env.feature.load();
  equal(await env.feature.saveUrl("http://host/new.m3u8"), false, "failed save reported");
  equal(state.screensaverHlsUrl, "http://host/old.m3u8", "failed write retains confirmed value");
  let failed = false;
  try { await env.feature.restoreUrl("http://host/new.m3u8", "hls"); } catch { failed = true; }
  equal(failed, true, "failed URL restore aborts before action");
  equal(env.writes.some(write => write[0] === "screen_saver_action"), false, "failed URL never activates HLS");
  env = setup(action, url);
  await env.feature.restoreUrl(undefined, "off");
  equal(state.screensaverHlsUrl, "", "old backups reset URL to empty");

  let resolveAction!: (value: any) => void, resolveUrl!: (value: any) => void;
  env = setup(new Promise(resolve => { resolveAction = resolve; }), new Promise(resolve => { resolveUrl = resolve; }));
  env.feature.applyAction(action);
  env.feature.applyUrl(url);
  const staleRead = env.feature.load();
  await env.feature.saveUrl("http://host/new.m3u8");
  await env.feature.setAction("hls");
  resolveAction(action);
  resolveUrl({ value: "http://host/old.m3u8" });
  await staleRead;
  equal(state.screensaverHlsUrl, "http://host/new.m3u8", "old GET cannot overwrite a successful URL save");
  equal(state.screensaverAction, "hls", "old GET cannot overwrite a successful action save");
}
