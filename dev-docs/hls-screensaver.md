# HLS screensaver

The Waveshare ESP32-S3-Touch-LCD-4 profile includes a native video screensaver. The web UI configures it; video decoding runs on the panel, not in the browser. Other device profiles do not include the decoder.

**Validation status:** host parser and web tests pass. Full Waveshare firmware compilation and physical playback verification are still pending. Do not treat these host results as evidence of working panel playback or a guaranteed frame rate.

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
