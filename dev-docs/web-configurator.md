# Web Configurator

The web configurator is the browser setup page loaded from a device's web
server. It is written in TypeScript and built as one shared application bundle,
an embedded offline fallback, a hosted compatibility bridge and asset manifest,
plus small per-device loader files.

## Source Layout

| Path | Purpose |
|---|---|
| `src/webserver/entry.ts` | Composition root. It installs application modules and card registrations in one deliberate order. |
| `src/webserver/application/` | Shared state, rendering, API, backup, settings, preview, and codec modules. Each file exports an explicit installer. |
| `src/webserver/cards/` | Card-specific settings panels and previews. Each file exports an explicit registration function. |
| `src/webserver/model/*.ts` | Typed model sources. |
| `src/webserver/state/*.ts` | Typed device configuration, application state factory, event aliases, and event parsing. |
| `src/webserver/api/*.ts` | Injectable HTTP transport, ordered POST queue, typed request results, and failure classification. |
| `src/webserver/generated/*.ts` | Typed card metadata, entity catalogue, icon data, and translation tables generated from their shared sources. |
| `src/webserver/i18n/` | Translation runtime: the page language, `i18n()` and its sibling lookup functions, and the reload that follows a panel language change. It imports only the generated translation tables, so every other module may import it. |
| `src/webserver/testing/*.ts` | Browser test hooks, included only in test bundles. |
| `docs/public/webserver/<slug>/www.js` | Generated per-device compatibility loader for older hosted URLs. |
| `docs/public/webserver/embedded/www.js` | Generated offline editor included by current firmware build entry points. |
| `docs/public/webserver/bundles/<sha256>/www.js` | Generated immutable hosted application bundle selected through `web-assets.json`. |

`entry.ts` imports every application installer and card registration directly.
The visible call order is the runtime order; the build does not discover files,
sort filenames, concatenate source, or depend on import side effects.
All TypeScript and generated data are imported directly by the bundle build.
The application exposes one mutable state instance created by
`createInitialState(deviceConfig)`; tests create isolated instances from the
same factory.
Controllers keep responsibility for banners, reconnect scheduling, and UI
locking; the typed device API owns transport, fallback attempts, throttling,
keepalive requests, and JSON decoding.

## Build

The web generator writes `docs/public/webserver/<slug>/www.js` for each supported
device. The shared `docs/public/webserver/www.js` is a small hosted bridge: it
uses `web-assets.json` to select an immutable content-addressed editor for the
development build and the stable release/rollback versions declared by the
generator. The matching offline editor is written to
`docs/public/webserver/embedded/www.js`. Firmware
loads that local editor first as a fallback, then asks the hosted bridge for its
declared compatible bundle; if the manifest or bundle cannot be loaded, the
local editor starts automatically.

The configurator page itself is served by the device. New build entry points in
`builds/*.yaml` bundle the matching JavaScript with `web_server.js_include`, so
a flashed branch uses that branch's setup UI. The generated files are still
published for older firmware that loads the hosted GitHub Pages copy:

```text
https://jtenniswood.github.io/espcontrol/webserver/<slug>/www.js
```

The fallback hosted bundle URL is set as `js_url` in
`common/device/core_infra.yaml`. Keep that path stable for older installed
firmware and imported configs.

## Translations

Configurator text is translated from `product/v2/translations/web.*.txt`, with
`web.en.txt` as the key master. `python3 scripts/build.py web-i18n` turns those
catalogs, the card labels in `product/v2/card_contract.json`, and the firmware
values named by `i18nDevice(...)` into `src/webserver/generated/i18n.ts`. Only
languages that have a `web.<lang>.txt` file are translated; every other panel
language renders the configurator in English. The
[translations skill](../.agents/skills/translations/SKILL.md) owns the call-site
rules, the catalog workflow, and the list of text that stays English by design.

| Function | Use |
|---|---|
| `i18n("English", params?)` | Text whose only destination is the configurator page. The argument must be a string literal. |
| `i18nKey("context_key", "English")` | A homonym that needs its own wording. |
| `i18nPlural("family", count, { one, other })` | Counted text; each language supplies its own plural categories. |
| `i18nDynamic(value)` | A runtime value whose possible texts were registered with `i18nMark("...")`. |
| `i18nMark("English")` | Marks a literal for extraction and returns it unchanged, for errors thrown in `model/` and `api/` and translated where the banner shows them. |
| `i18nDevice("English")` | Text in the preview that imitates the panel. It reads the firmware catalogs, so the preview matches the display. |
| `webLocale()` | The page language, for `Intl` formatting and `localeCompare`. |

Never wrap a value that is saved, sent to the device, or compared in code. The
English rendering must stay byte-identical, because the browser and smoke checks
locate elements by their English text.

### Page language

The page is built once, before the panel language is known, and many labels
live in tables created when a module loads. The page language is therefore
fixed for each page load:

1. When `src/webserver/i18n/` first loads, it reads the `espcontrol_lang` URL
   parameter (and removes it from the address bar), then the
   `espcontrol.web.locale` entry in `localStorage`, and otherwise uses English.
   A language without a web catalog resolves to English.
2. `init()` sets `document.documentElement.lang` to that language.
3. When the panel reports `Screen: Language`, or the user picks a language on
   the Settings tab and the POST has completed, `requestWebLocale()` stores the
   language as the hint for the next visit. If it differs from the page
   language, the page reloads once after a short delay.
4. The reload waits while `webLocaleReloadAllowed()` in
   `src/webserver/application/language_state.ts` is false: during a config lock,
   or while a caller such as backup import holds `holdWebLocaleReload()`. A
   `sessionStorage` marker stops a reload loop, and when `localStorage` is
   unavailable the reload carries the language in the `espcontrol_lang`
   parameter instead.

A browser reloads when it meets a panel set to a different supported language.
Dirty or new card drafts, locked configuration operations, pending POSTs and
backup imports defer that reload. Imports hold it until their queued settings
have settled, so a language change does not interrupt the rest of the restore.
The device replays its full state when the event stream reconnects.

### Hosted and embedded bundles

Translations ship inside the bundle, so a panel shows a translated configurator
only when the bundle it loads contains that language. Entry points that set
`js_url: ""` (`builds/<slug>.yaml` and `devices/<slug>/dev.yaml`) always serve
the embedded bundle of the checkout they were built from. Entry points that
keep the hosted `js_url` from `common/device/core_infra.yaml`, which the released
factory builds do, load the upstream hosted bridge. It serves the upstream
bundle whenever the upstream `web-assets.json` lists the panel's device slug and
firmware version, and falls back to the embedded bundle otherwise. To test
unpublished translations on a factory build, open the panel with
`?espcontrol_fallback=1` to select its embedded bundle. Keep the factory build
for provisioned panels that rely on stored Wi-Fi credentials and dynamic API
encryption; switching to a development/non-factory image can break access.

## Device API Shape

The setup page reads and writes ESPHome web server entities exposed by the
device. Button configuration is saved in text entities such as:

```text
Button 1 Config
Button 2 Config
...
```

The setup page serializes card settings to a compact string. Firmware parses the
same string on-device. Keep `src/webserver/application/config_codec.ts` and
`components/espcontrol/button_grid_config.h` in sync.

To inspect what the device actually stored, read the matching ESPHome web server
entity:

```bash
curl -s "http://<device-ip>/text/Button%201%20Config?detail=all"
curl -s "http://<device-ip>/text/Button%20On%20Color?detail=all"
```

The setup page writes to these same text/select/number/switch entities, so the
REST response shows the exact compact string firmware will parse.

### Reset and editing sessions

Reset-capable firmware advertises `reset.modes` in capabilities. Read
`GET /api/v1/reset` when opening an editing session and retain its `epoch` for
that session. Configuration POST/PUT requests require `X-EspControl-Epoch`;
after a reset, a stale or missing epoch is rejected with 409/428. Reload the
device state instead of refreshing the epoch and replaying old edits. Older
firmware returns 404 for reset discovery and keeps its existing write protocol.
Standard ESPHome control routes (such as `/light/.../turn_on` and
`/button/.../press`, plus operational switches such as the P4-86 relays) and the `/wifisave` and `/update` forms do not require an
epoch. Configuration routes, including text, number, select and switch
settings, still require it. Switches marked as configuration or diagnostic
entities remain protected; unknown switch routes are not exempt. A supplied stale epoch is rejected on every route,
and all mutations are blocked while reset is pending. OTA transport status is
tracked per source, and the active native flash handle stays reserved until
ESP-IDF ends or aborts it. A rejected or failed overlapping OTA attempt cannot
release another writer's reset protection.

Both reset modes clear the saved panel name, including legacy NVS identity
records, before panel identity loads. Firmware-default names remain.

Partial reset also retains the P4-86 one-time Wi-Fi initialization marker, so
its boot action cannot clear the preserved credentials. Its preference key is
an adapter for the pinned ESPHome version, alongside the Wi-Fi and API keys.

The firmware requires web asset version 2 so an older hosted editor cannot
omit these write preconditions. The current bundle also has a version 1
manifest entry for older firmware; reset discovery hides unsupported actions.

`POST /api/v1/reset` requires `Content-Type: application/json`,
`X-EspControl-Request: reset`, the session epoch, and a body containing only
`{"mode":"customization"}` or `{"mode":"factory"}`. Existing web authentication
applies; cross-origin requests are rejected. A 202 response means intent is
durable, not that cleanup has completed. Stop saves/imports immediately, and
reload only after a newer epoch reports `pending: false`. A lost response may
still mean reset was accepted. The same pending mode is idempotent; conflicting
modes and requests during firmware installation receive 409.
A journal-write failure returns 500 and schedules a restart to resolve whether
the intent persisted; writes stay blocked until that restart. Reset recording
and OTA flash entry points share an interlock, so an automatic, web, native OTA
or C6 update cannot begin writing after reset intent has been reserved. The
ESP-IDF `esp_ota_begin` and hosted `esp_hosted_slave_ota_begin` linker adapters
must remain covered when upgrading the pinned ESPHome/SDK versions.

The early-startup coordinator owns cleanup independently of configuration
loading. Its `espcontrol_rst` journal survives factory cleanup. Failed cleanup
blocks restoration and retries with a serial recovery message. The credential
adapter in `reset_policy.h` is coupled to the pinned ESPHome Wi-Fi and API
preference keys and must be checked when upgrading ESPHome.
Reset cleanup always erases individual records. ESPHome's platform-level NVS
initialization recovery remains unchanged; if NVS itself is unreadable and the
platform erases it before setup, the reset journal cannot be recovered. The
interrupted-reset guarantees assume NVS can initialize and read its journal.

## Adding a Card Settings UI

Each card module registers its label/default providers, preview renderer,
settings renderer, and selection initializer with the shared card registry.
Contract helpers keep labels, defaults, picker behavior, and visibility aligned
with firmware metadata. `entry.ts` owns deliberate registration order.

Use [Change the Web Configurator](playbooks/change-web-configurator.md) for the
exact edit, generation, and verification steps, or the
[card playbook](playbooks/add-card-type.md) when both UI surfaces change.

## Preview and Persistence Rules

- Update the draft object first.
- Use the existing helper save functions where available.
- Schedule a preview refresh after changing fields that affect the tile.
- Keep option-backed fields in the `options` string, not as new top-level fields,
  unless the saved config format intentionally changes.
- Confirm reload behavior. If the setting saves but vanishes after reload, check
  option preservation in `config_codec.js`.

## Local Testing

The web playbook owns browser checks and the physical-display loop. Browsers
cache `www.js` aggressively, so physical testing must hard reload after each
rebuild.

### Shared long-press options

Button cards store `long_press=more_info` or `long_press=none` in `options`;
absence preserves the existing tap behavior. `more_info` optionally uses
`long_press_entity` and `long_press_text`, encoded with the usual option-value
escaping. The shared codec and firmware parser preserve these fields after
family normalization. The editor also preserves them around card-specific
renderers and field changes, because those normalizers only own their own fields.
Slider surfaces are excluded by matching web and firmware support policies.

The main-grid YAML dispatches `on_long_press` separately from `on_short_click`.
Subpages install their hold handler before the family tap handler and consume
LVGL's release-time `CLICKED` event after a hold. Media shortcuts defer their
press-time action when a custom hold is configured. The information overlay owns
its HA callbacks and releases them before closing; delayed callbacks also check
the overlay generation.
