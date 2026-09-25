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
