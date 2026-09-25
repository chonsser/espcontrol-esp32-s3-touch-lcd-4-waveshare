# Waveshare Memory Budget

## Retained optimizations

The Waveshare ESP32-S3-Touch-LCD-4 keeps these memory reductions independently
of video playback:

- The offline web icon font contains all 452 required icons, with unchanged
  outlines and metrics: 67,876 bytes instead of 1,307,660 bytes. See
  `common/assets/README.md` for deterministic regeneration.
- Three large media text fonts use 2bpp instead of 4bpp. Sizes, Latin/Hebrew
  glyphs and placement metrics are unchanged. Bitmap storage falls from
  739,514 to 370,017 bytes; antialiasing uses four coverage levels.
- LVGL uses 25% draw and software-rotation scratch buffers. Together these
  use 230,400 bytes rather than 921,600 bytes, saving 691,200 bytes.
- Full RGB scanout buffers, tear-free frame batching, software rotation,
  refresh retry hooks, and PSRAM instruction/rodata XIP remain enabled.
  Do not free mapped code/rodata or disable XIP as a runtime cache cleanup.

The historical optimized build `08907e6cc` reduced `.ext_ram.dummy` from
5,898,208 to 4,784,096 bytes. Combined with scratch savings, this improved
its memory budget by 1,805,312 bytes. These are build-time measurements,
not a measurement of live free heap or physical display acceptance.

Regression checks: `tests/web/web_icon_font_test.py`,
`tests/firmware/waveshare_memory_budget_test.py`, and
`scripts/check_mipi_rgb_tear_free.py --sanitize`.
Physical acceptance still includes media text quality, rotated redraw speed,
and stable display/touch operation during normal use and flash writes.

## Removing video support

HLS playback, its decoder dependency, URL/status entities and web controls
have been removed. Independent screens and navigation remain supported.
Only Display Off, Screen Dimmed and Clock remain in the screensaver action
select, in their original order. ESPHome restores an option index; a saved
fourth (HLS) option is out of range and falls back to the initial Display Off.
No settings wipe is required. The old URL preference may remain inert in NVS.

When importing an old backup, unsupported actions normalize to Display Off
and the obsolete stream URL is ignored. Existing timer, clock, brightness
and navigation settings continue to use their existing paths. Backup export
no longer includes a stream URL.

A source update or successful factory compilation does not change an installed
panel. Flash only the factory configuration and only with explicit permission.

## Removal verification (2026-09-25)

Initial removal revision: `9d2df00f1`, integrated on the fork's `main` history.
Fresh uncached web/product checks pass: 224 web unit tests, 113 browserless
smoke cases, types, backup/state/API compatibility, translations and generated
outputs. All 12 independent-screen browser tests pass, including obsolete HLS
metadata, unchanged action options and ordinary clock selection. The three
memory-budget checks and sanitized RGB driver checks also pass.

The complete local test suite is **not green**:

- With ESPHome Python, 82/85 host tests pass. `web_ota_guard_test` and
  `reset_ota_wrapper_test` fail on unused scaffold constants under Apple Clang
  `-Werror`; `cover_art_activation_test` fails on nonvirtual-destructor warnings
  in its scaffold. These failures also occurred before the removal.
- Bare `npm test` additionally lacks PyYAML for
  `screensaver_appearance_wiring_test`, `presence_transition_test`,
  `clock_card_wiring_test`, `entity_screen_navigation_idle_test`, and
  `entity_screen_navigation_routing_test`; it skips the memory-budget test.
  Running with ESPHome Python resolves those dependency failures and the skip.
- `scripts/check_tasks.py --self-test` still fails its existing product legacy
  coverage assertion because `translations` is present only in the actual list.

Factory compilation of `9d2df00f1` succeeds with ESPHome 2026.9.0 and ESP-IDF
5.5.5. Generated code contains screen navigation and only the three remaining
screensaver actions; the linked ELF and dependency lock contain no HLS player
or `esp_h264`. Compiled display-controller and RGB sources match the checkout.
The existing navigation `-Waddress` warning remains.

| Build measurement | Optimized with HLS (`08907e6cc`) | Without HLS (`9d2df00f1`) |
| --- | ---: | ---: |
| Linked image | 4,841,487 B | 4,738,931 B |
| Flash usage | 66.6% | 65.1% |
| Static internal RAM | 252,475 B | 230,019 B |
| `.flash.rodata` | 2,035,760 B | 2,024,544 B |
| `.ext_ram.dummy` | 4,784,096 B | 4,653,024 B |

Removal saves another 131,072 bytes of mapped PSRAM reservation and 22,456
bytes of static internal RAM; the earlier scratch/font savings remain.
These are not live heap measurements.

Factory-config OTA image: 4,739,056 bytes, SHA-256
`78b4ad3e06ffe6b1311bc6101236554f7d3a22843e1ce19d44081a820f1a5a62`.

### Live-action follow-up

A delayed review found that the removed video settings hook also handled
ordinary action edits while already asleep. Revision `1686929e8` restores
that non-video behavior in the shared screensaver select callback. It retargets
only the current idle/presence owner; schedule, manual sleep, wake, media and
alarm requests retain priority. Legacy clock toggles use the same callback.

`tests/firmware/screensaver_action_change_test.py` executes the actual YAML
callbacks with the production arbiter. Off-to-clock failed before the fix and
passes afterward; both automatic owners, all action pairs, legacy toggles,
awake settings, in-flight invalidation and higher-priority owners are covered.
The full ESPHome-Python host suite now passes **83/86**, with the same three
Clang scaffold failures above. `npm test` still selects system Python despite
a PATH override and therefore additionally fails the new test for missing
PyYAML, alongside the previously listed dependency failures. Explicit
`-DPython3_EXECUTABLE` is needed. Fresh uncached web checks pass.

The final factory build from `1686929e8` succeeds: linked image 4,739,363 bytes,
65.2% flash, static internal RAM 230,035 bytes, `.ext_ram.dummy` 4,653,024 bytes.
The retained optimizations and absence of HLS symbols are verified in this build.
The existing navigation compiler warning remains. Its OTA image supersedes the
initial removal image above: 4,739,488 bytes, SHA-256
`57bd4c5d5c0afec677a75d01963e645acba126d02d5da8321063b4c1ada69411`.

These limits are separate from physical testing; no HLS-free image has been
flashed as part of this removal.
