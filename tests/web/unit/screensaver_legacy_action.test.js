"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { loadTypescriptTest } = require("./helpers/load_typescript_test");
const settings = loadTypescriptTest("src/webserver/model/settings.ts");

// Old panel states and backups must never reactivate a removed player.
test("unsupported screensaver actions fall back to display off", () => {
  for (const action of ["HLS Stream", "hls", "hls_stream", "unknown-action"]) {
    assert.equal(settings.normalizeScreensaverAction(action), "off");
    assert.equal(settings.screensaverActionOption(action), "Display Off");
  }
  for (const [action, expected] of [["Display Off", "off"], ["Screen Dimmed", "dim"], ["Clock", "clock"]]) {
    assert.equal(settings.normalizeScreensaverAction(action), expected);
  }
});

test("legacy video backup keeps other settings but discards the stream", () => {
  const restored = settings.normalizeBackupPanelSettings({
    screensaver_action: "HLS Stream",
    clock_screensaver: true,
    screensaver_hls_url: "http://example.test/retired.m3u8",
    screensaver_mode: "timer",
    screensaver_timeout: 120,
    screen_rotation: "90",
  }, {
    clockFormatOptions: ["12h", "24h"], clockFormat: "24h",
    timezone: "Europe/Warsaw", language: "pl",
    ntpDefaults: ["pool.ntp.org", "time.nist.gov", "time.google.com"],
    ntpServer1: "pool.ntp.org", ntpServer2: "time.nist.gov", ntpServer3: "time.google.com",
    autoUpdate: true, updateFrequency: "Daily", updateFrequencyOptions: ["Daily"],
    coverArtHomeAssistantProtocol: "http", coverArtHomeAssistantPort: 8123,
    coverArtHomeAssistantEndpointMode: "Manual", screenRotationOptions: ["0", "90", "180", "270"],
  });
  assert.equal(restored.screensaverAction, "off");
  assert.equal(restored.screensaverMode, "timer");
  assert.equal(restored.screensaverTimeout, 120);
  assert.equal(restored.screenRotation, "90");
  assert.equal(Object.hasOwn(restored, "screensaverHlsUrl"), false);
});
