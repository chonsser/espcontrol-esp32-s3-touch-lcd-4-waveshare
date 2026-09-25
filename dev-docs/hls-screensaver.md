# HLS screensaver

The Waveshare ESP32-S3-Touch-LCD-4 profile includes a native video screensaver. The web UI configures it; video decoding runs on the panel, not in the browser. Other device profiles do not include the decoder.

## Integration and device status (2026-09-25)

The shared branch **`integrate-hls-screens`** includes both the complete HLS branch (`c53104e82`) and independent-screen/navigation branch (`0e527673c`). Neither source branch nor stable `main` was discarded or replaced. The combined web application retains independent grids, Home Assistant screen mappings and HLS settings together.

The reported **`Stopped`** status had a firmware cause: `display_mode_reconcile` omitted HLS from its presentation-effect allowlist. The controller could request HLS but never open its view, so the player correctly refused to start before presentation. Commit **`589dcd597`** includes HLS in that allowlist without relaxing priority, wake or OTA guards. A regression executes the actual YAML reconciliation tail and reproduces the missing dispatch before the fix.

The combined Waveshare **factory** firmware compiled successfully from **`589dcd597`**, using ESPHome 2026.9.0, ESP-IDF 5.5.5 and `espressif/esp_h264` 1.4.0. Linked image: 5,965,975 bytes (82.0% flash); reported static RAM: 252,475/341,760 bytes (73.9%). Subsequent integration work adds tests, generator preservation and compatibility snapshots; it does not change the compiled runtime sources or generated device YAML. Those numbers do not measure runtime PSRAM headroom or frame rate.

**Not yet installed:** the provisioned panel still runs the HLS-only `359316718` firmware uploaded with permission on 2026-09-25. That installed version lacks both multi-screen integration and the HLS dispatch correction. No combined OTA or physical playback/touch verification has occurred. A successful build is not device acceptance.

Automated integration evidence:

- 26/26 targeted native HLS, display, independent-screen, navigation and hold-control tests pass.
- 223/223 web unit tests pass. The independent navigation browser script passes, and the screen overview suite passes 12/12, including one built app editing a screen and then saving an HLS URL/action without changing its grids or mappings.
- TypeScript, generated web outputs, backup/state/device API contracts and translations pass. Device regeneration now retains all HLS hooks and its package on Waveshare only, with a regression against the actual generator output.
- Shared non-HLS Guition S3/P4 configurations pass ESPHome validation, not full firmware builds.
- Fast web and product domain checks pass, including browserless smoke, migration baseline, product snapshot and device regeneration (the task runner reuses valid cached passes where reported).
- Full host suite with the ESPHome Python environment: **92/95 pass**. `web_ota_guard_test` and `reset_ota_wrapper_test` fail on unused test-scaffold constants under Apple Clang `-Werror`; `cover_art_activation_test` fails on a non-virtual-destructor warning in its scaffold. Bare `npm test` selects system Python, adding missing-PyYAML failures in `screensaver_appearance_wiring_test`, `presence_transition_test`, `clock_card_wiring_test`, `entity_screen_navigation_idle_test` and `entity_screen_navigation_routing_test`, and skipping `hls_config_test`. It stops before downstream checks; those were run separately above.
- Full browser-suite limitations remain: the Waveshare browser smoke run stopped on a Polish UI click intercepted by a sticky header; its cause has not been established. Do not treat the targeted browser passes as a green complete browser suite.

Before deployment, compile the shared branch, verify both feature tips remain ancestors, and use only the factory YAML below. Keep the source PRs and integration PR open until the user confirms device testing.

## Configuration and compatibility

In **Settings → Screensaver**, save the **HLS Stream URL**, then select **HLS Stream** as the action for the timer or presence sensor. Both controls configure the same action. The URL editor and action appear only when firmware advertises the HLS option and exposes the URL entity.

- Entry URL: HTTP/HTTPS, at most **255 ASCII characters**. No embedded username/password, spaces or fragment. Query strings are supported; avoid sharing backups containing private URL tokens.
- Unencrypted HLS with MPEG-TS segments and H.264 **constrained baseline**, progressive YUV420, at most **320×192**, **15 fps**, one reference frame and no B frames. Use a video-only source; audio is not played.
- The first picture needs a PES timestamp. Later pictures may share a PES or continue through a PES without a timestamp: missing picture times are reconstructed only when H.264 VUI declares a fixed frame rate. Without that timing declaration, each picture needs an explicit timestamp; the player will not guess its cadence.
- AES/DRM, H.265, fMP4/CMAF, byte ranges, I-frame-only playlists and low-latency HLS extensions are unsupported.
- Each segment must fit **256 KiB** and last at most **10 seconds**. Playlists are limited to **16 KiB / 64 segments**. Redirect and resolved segment URLs may be up to 2048 bytes; redirects are limited to three.
- A supported master-playlist variant is chosen at low bandwidth (at most 512 kbit/s). These limits do not guarantee real-time performance on the panel.
- Live playlists advance; finite VOD playlists loop. The image preserves its aspect ratio on the 480×480 display and uses the existing day/night screensaver brightness.

Typing does not save. **Save** commits the URL; a failed save keeps the draft. Saving while the panel is active does not put it to sleep. Backup export includes only the saved URL; restore saves the URL before selecting HLS. Old firmware skips unsupported HLS configuration with a warning.

Playback errors switch the automatically owned screensaver to the clock. The chosen action remains HLS, and the error remains visible. Playback may retry after editing the URL or beginning a new idle period. A corrupted transport stream currently falls back to the clock rather than attempting mid-stream recovery.

## Controlled source

Generate a six-second test pattern in an empty test directory:

```sh
ffmpeg -f lavfi -i testsrc2=size=320x192:rate=10 -t 6 -an \
  -c:v libx264 -profile:v baseline -level:v 1.3 -pix_fmt yuv420p \
  -b:v 180k -maxrate 240k -bufsize 480k -bf 0 -refs 1 \
  -g 20 -keyint_min 20 -sc_threshold 0 -x264-params repeat-headers=1:aud=1:force-cfr=1 \
  -f hls -hls_time 2 -hls_list_size 0 -hls_flags independent_segments fixture.m3u8
python3 -m http.server 8080 --bind 0.0.0.0
```

Use `http://<test-computer-LAN-address>:8080/fixture.m3u8`, not `localhost`, on the panel. Serve only non-sensitive test files and stop the server afterward. This server is a test fixture, not a required production transcoding service.

For a rolling live fixture, omit `-t 6`, use `-hls_list_size 6` and `-hls_flags delete_segments+independent_segments`. HTTPS sources need a certificate trusted by the ESP-IDF certificate bundle.

## Automated checks

```sh
node --test tests/web/unit/screensaver_hls.test.js
node --test tests/web/screensaver_hls_browser.test.js
ESPCONTROL_BROWSER_PROFILE=waveshare-esp32-s3-touch-lcd-4 node scripts/check_web_browser_smoke.js
ctest --test-dir build/tests/firmware -R '^(hls_.*|display_mode_controller_test)$' --output-on-failure
```

Configure and build the normal host CMake harness first. When FFmpeg and ffprobe are installed, CMake also registers `hls_fixture_test`: it generates real segments, checks their codec parameters and feeds all three through the transport parser. It also repacketizes the same elementary video across different PES boundaries and checks reconstructed picture times. It does **not** execute the ESP-IDF decoder or render through LVGL.

`hls_config_test` loads the Python component and checks the merged select action chain using installed ESPHome APIs; it is explicitly skipped if ESPHome is unavailable. `hls_lifecycle_test` exercises the actual main-loop methods with simulated worker completion and LVGL ownership. `hls_http_deadline_test` runs the actual download function and bounded transport adapter against a simulated slow-header peer and cancellation. These are host simulations, not evidence of SDK network, decoder or physical display behavior.

## Device acceptance checklist

After full firmware compilation and separately authorized flashing, verify:

- Moving pattern appears after idle timeout; live advances and VOD loops.
- Aspect ratio and day/night brightness are correct.
- First touch exits immediately without activating a control underneath; presence also wakes the panel.
- Alarm, onboarding, schedule/manual display-off and cover art retain their priorities.
- URL and selected action survive restart; backup/restore preserves the URL and activates only after saving it.
- Invalid/encrypted/oversized sources and Wi-Fi loss fall back to the clock without freezing touch or repeatedly restarting playback.
- OTA and shutdown stop playback; repeated entry/exit and URL changes do not leak memory or leave stale frames.

Flash only `builds/waveshare-esp32-s3-touch-lcd-4.factory.yaml` on the provisioned panel, and only with explicit permission. A build or browser-test pass is not physical device acceptance.
