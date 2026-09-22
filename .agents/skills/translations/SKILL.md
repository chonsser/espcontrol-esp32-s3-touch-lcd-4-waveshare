---
name: translations
description: Find static user-visible words shown on the physical EspControl device or in its web configurator and integrate them into the translation process. Use when the user asks to add, audit, fix, or review firmware/device UI translations, web setup-page translations, a new language, hard-coded display text, i18n keys, or physical screen/card/modal/status text in the espcontrol repository.
---

# Translations

## Purpose

Use this skill to move static UI text into the EspControl translation workflow. There are two surfaces, each with its own catalogs and generator:

| Surface | Authored catalogs | Generated output | Generator |
|---|---|---|---|
| Physical display (firmware) | `product/v2/translations/strings.*.txt` | `components/espcontrol/i18n_generated.h` | `python3 scripts/build.py i18n` |
| Web configurator (`src/webserver/`) | `product/v2/translations/web.*.txt` | `src/webserver/generated/i18n.ts` | `python3 scripts/build.py web-i18n` |

Keep the work narrow: static UI text only, no Home Assistant dynamic content, and no unrelated refactors. Never hand-edit the generated outputs.

## Scope

Count text that can appear on the physical EspControl display or in the web configurator, including:

- Screen, card, modal, setup, and status labels.
- Button labels and confirmation text.
- Empty states and user-visible error/status messages.

Do not translate or change:

- Home Assistant-provided entity names, states, attributes, service names, IDs, or icon names.
- Log messages, code comments, internal code strings, API strings, generated identifiers, or CSS/HTML implementation details.
- Dynamic content supplied by integrations or Home Assistant.
- Anything that is saved, sent to the device, or compared in code. See "Persisted Values Stay English" below.

These surfaces stay English by design. Document them; do not chase them:

- The ESPHome captive-portal page and the browser's HTTP sign-in prompt.
- Home Assistant entity names from `product/v2/entity_names.json` (for example "Screen: Language"); REST and event-stream paths derive from them.
- ESPHome select option values (Hourly/Daily, "Sunrise and sunset", the timezone list) and machine JSON under `/api/v1/`.
- Text the user types and the firmware stores as-is, such as the alarm announcement defaults.
- Arbitrary Home Assistant states rendered through `sentence_cap_text()`.

## Firmware Workflow

1. Start from a clean feature branch/worktree based on latest `origin/main` unless the user explicitly says otherwise.
2. Search for hard-coded user-visible strings mainly in:
   - `components/espcontrol/`
   - `common/device/`
   - `common/addon/` when text can appear on the display
   - `product/v2/translations/strings.en.txt`
3. For `src/webserver/` text, use the Web Configurator Workflow below. The preview inside the configurator that imitates panel text reads the firmware catalogs through `i18nDevice(...)`, so a firmware wording change also changes that preview.
4. For each candidate string, classify it before editing:
   - Already present in `product/v2/translations/strings.en.txt` and rendered through `espcontrol_i18n(...)` or `espcontrol_i18n_key(...)`: leave it alone.
   - Present in `product/v2/translations/strings.en.txt` but displayed as raw English: update the firmware code to use the translation helper.
   - Passed into a local helper that later renders text through `espcontrol_i18n(...)`: make sure the English value exists in every `product/v2/translations/strings.*.txt` file.
   - Returned from a local helper and later displayed without another translation call: translate the known static return values before returning or before display.
   - Missing from `product/v2/translations/strings.en.txt`: add a stable `snake_case` key to `strings.en.txt` and add the matching key to every `product/v2/translations/strings.*.txt` file.
5. For non-English translation files, add a reasonable translation. If uncertain, use the English source text instead of guessing badly.
6. Regenerate firmware translation output:

```bash
python3 scripts/build.py i18n
```

7. Verify:

```bash
python3 scripts/build.py i18n --check
npm run check:translations
npm run check:product
```

`npm run check:translations` (`scripts/check_translations.py`) fails when:

- a translated character is missing from both `common/assets/text_glyphs.yaml` and `common/assets/hebrew_glyphs.yaml` (the panel would draw a blank box);
- an `espcontrol_i18n("...")` literal or an `espcontrol_i18n_key("...")` key is missing from `strings.en.txt`;
- two keys in `strings.en.txt` share an English value without being listed in `DUPLICATE_ENGLISH_VALUES` in that script. `espcontrol_i18n("Open")` resolves through the first key that carries the value, so later keys such as `state_open` or `month_day_october` are reachable only through `espcontrol_i18n_key(...)`;
- a value in a language declared complete equals English without being listed in `product/v2/translations/identical.<lang>.txt`;
- the language codes in `common/addon/time.yaml`, `src/webserver/state/app_state.ts`, and `strings.*.txt` disagree.

If `npm run check:product` fails because `esbuild` is missing in a fresh worktree, run `npm ci` in that worktree and rerun the check. Mention any npm audit warnings, but do not fix unrelated dependency issues as part of translation work.

8. Commit and push the branch, then open a ready-for-review pull request.

## Search Guidance

Use targeted searches and then inspect context manually. Useful starting points:

```bash
rg --line-number --glob '!src/webserver/**' '"[^"]*[A-Za-z][^"]*"' components/espcontrol common/device common/addon product/v2/translations
rg --line-number "espcontrol_i18n|espcontrol_i18n_key|strings\\.en\\.txt" components/espcontrol common/device common/addon product/v2/translations
rg --line-number "lv_label_set_text\([^\n]*(\"|std::string|sentence_cap_text)|text:\s*\"|text:\s*!lambda" components/espcontrol common/device common/addon --glob '!components/espcontrol/i18n_generated.h'
rg --line-number "static const char \*|const char \*.*\[\]|std::array<.*char|std::vector<.*string" components/espcontrol --glob '!components/espcontrol/i18n_generated.h'
```

Treat search results as candidates, not proof. Many strings in firmware code are not translatable UI text.

When the broad search is too noisy, prioritize:

- `lv_label_set_text(...)` and YAML `text:` values that can render on the physical display.
- Local status/helper functions such as `*_set_status(...)`, `*_label(...)`, or `*_loading_state(...)` that accept a static English string and later set a label.
- Static arrays or return branches that provide user-visible labels, not icon names or API values.
- Existing helper-wrapped literals missing from the translation source files.

After inspecting likely candidates, run the translation check to catch helper-wrapped text that is missing from `strings.en.txt`. It reports each missing literal as `file:line`:

```bash
python3 scripts/check_translations.py
```

Use this narrower raw-literal audit to find English-looking text that is not directly wrapped in `espcontrol_i18n(...)`. Inspect each hit manually; many are logs, templates, icons, option values, or Home Assistant data and must not be translated.

```bash
python3 - <<'PY'
from pathlib import Path
import re

root = Path.cwd()
paths = (
    list((root / "components/espcontrol").glob("*.h")) +
    list((root / "common/device").glob("*.yaml")) +
    list((root / "common/addon").glob("*.yaml"))
)
skip_context = [
    "ESP_LOG", "find_icon", "icon_", "mdi:", "name:", "id:", "platform:",
    "unit_of_measurement:", "entity_", "CARD_CONTRACT", "#include", "font:",
    "color:", "file:", "path:", "url:", "mode:", "type:", "sensor:",
    "service:", "attribute:", "lambda:",
]
string_re = re.compile(r'"((?:[^"\\]|\\.)*)"')
for path in paths:
    if path.name in {"i18n_generated.h", "button_grid_contract_generated.h"}:
        continue
    for line_no, line in enumerate(path.read_text(errors="ignore").splitlines(), 1):
        if "espcontrol_i18n" in line or "espcontrol_i18n_key" in line:
            continue
        if any(value in line for value in skip_context):
            continue
        for match in string_re.finditer(line):
            raw = match.group(1)
            try:
                value = bytes(raw, "utf-8").decode("unicode_escape")
            except Exception:
                value = raw
            if not re.search(r"[A-Za-z]", value):
                continue
            if not (re.search(r"[A-Z][a-z]", value) or " " in value or "?" in value):
                continue
            if len(value) <= 2:
                continue
            print(f"{path.relative_to(root)}:{line_no}: {value} | {line.strip()}")
PY
```

## Web Configurator Workflow

The web configurator mirrors the firmware convention: English-keyed lookup at the call site, authored `key=value` catalogs with `web.en.txt` as the key master, and English as the fallback for anything missing. The page language is fixed for each page load. It follows the panel's `Screen: Language` setting and reloads once when that changes. Languages without a `web.<lang>.txt` file render in English.

### Call-site functions

Import them with a relative path from `src/webserver/i18n` (never through a global, and never aliased, because the extractor matches the call names textually):

```ts
import { i18n, i18nKey, i18nPlural, i18nDevice, i18nDynamic, i18nMark, webLocale } from "../i18n";

input.placeholder = i18n("e.g. {example}", { example: "light.kitchen" }); // translate the prefix, not the entity id
btn.textContent = i18n("Docs") + " ";                                     // spacing stays outside the literal
title.textContent = i18nKey("open__state", "Open");                       // homonym that needs its own wording
hint.textContent = i18nPlural("cards_selected", n, { one: "{count} card selected", other: "{count} cards selected" });
o.value = opt; o.textContent = i18nDynamic(opt);                          // runtime value; register each label once with i18nMark("Hourly")
throw new Error(i18nMark("Invalid backup file"));                         // stays English; translated where the banner shows it
label.textContent = i18nDevice("Closed");                                 // panel text inside the preview, from strings.*.txt
names.sort(function (a, b) { return a.localeCompare(b, webLocale()); });
```

- `i18n`, `i18nMark`, `i18nKey`, and `i18nDevice` need a plain string literal. Write `a ? i18n("A") : i18n("B")`, not `i18n(a ? "A" : "B")`; write `i18n("x {y}", { y })`, not `i18n("x " + y)` or a template literal with `${}`.
- `i18nPlural` takes an inline `{ one, other }` object and injects `{count}`. Each translated language supplies every plural category it uses (Polish: `.one`, `.few`, `.many`, `.other`).
- No leading or trailing whitespace inside a literal, and only `{name}` placeholders.
- `i18nDevice("...")` must name a value that exists in `strings.en.txt`. Use it only for text that imitates the panel, and apply the firmware rule: a label that is empty or equal to the card's English default shows the translated default.
- Two entries in `web.en.txt` may not share an English value unless the later one is a context key used through `i18nKey(...)`.

### Persisted Values Stay English

Wrap only text whose sole destination is the configurator page. Never wrap:

- anything assigned to a config or state field or sent in a POST, including default labels written into a card config;
- option values (tuple element `[0]`, `value:`), literals compared with `===` or `indexOf`, and ESPHome select option values;
- icon names, entity names and ids, Home Assistant domains and services, timezone ids;
- CSS classes, `data-*` attributes, element ids, test-hook names;
- `LANGUAGE_LABELS` (language names stay in their own language);
- anything in `src/webserver/generated/` or `src/webserver/application/config_codec.ts`.

`npm run check:config`, `npm run check:saved-config-parity`, and `npm run check:backup-contract` prove that no persisted value changed.

### Steps

1. Wrap the call sites, then list the literals the catalog does not know yet:

```bash
python3 scripts/build.py web-i18n --check
```

2. Rewrite `web.en.txt` from the call sites and fill the gaps in every `web.<lang>.txt` with the English value:

```bash
python3 scripts/build.py web-i18n --extract
```

   `--extract` keeps existing keys, drops unused entries, regroups entries under a `#` comment per first-use file, and resets a translation to English when its English source changed. It rewrites both files completely, so hand-written comments and ordering are lost. For a homonym, change the call site to `i18nKey("<context_key>", "English")` first, then extract.
3. Translate the new values in each `web.<lang>.txt`. Keep `{placeholders}` exactly, supply every plural category, reuse the firmware wording for shared words where the role is the same, and leave product and protocol names (EspControl, Home Assistant, Wi-Fi, QR, NTP, MQTT, URL) unchanged.
4. A value that must stay identical to English goes into `product/v2/translations/identical.<lang>.txt` as `web:<key>` (or `firmware:<key>` for `strings.<lang>.txt`). Its `@complete` line names the catalog families that are finished; an identical value in a complete family fails the check unless it is listed.
5. Regenerate and verify:

```bash
python3 scripts/build.py web-i18n
python3 scripts/build.py web-i18n --check
npm run check:translations
npm run check:types
npm run test:web-unit
npm run check:web-smoke
```

   `python3 scripts/build.py all` runs the web generator in its lenient mode, where unknown and unused entries only warn. Run `web-i18n --check` explicitly before it. Rebuild the served bundles with `python3 scripts/build.py www` as described in `dev-docs/playbooks/change-web-configurator.md`.

### Adding a web language

1. The language must already be a panel language: a `strings.<lang>.txt` file, an option of `language_select` in `common/addon/time.yaml`, and an entry in `LANGUAGE_OPTIONS` and `LANGUAGE_LABELS` in `src/webserver/state/app_state.ts`.
2. Add its plural categories to `PLURAL_CATEGORIES` in `scripts/web_i18n.py`.
3. Create an empty `product/v2/translations/web.<lang>.txt`, run `python3 scripts/build.py web-i18n --extract`, and translate the values.
4. Add `product/v2/translations/identical.<lang>.txt` with an `@complete` line once a catalog is fully translated.

### Hosted and embedded bundles

Factory builds point `js_url` at the upstream hosted bundle. A panel shows a translated configurator only when the bundle it loads contains that language: the embedded bundle of this checkout does, a hosted bundle only after the translations have been published there. Test a factory build's embedded translations with `http://<panel-ip>/?espcontrol_fallback=1`. Do not switch provisioned panels to non-factory firmware just to test the UI: those images may omit dynamic API encryption or change Wi-Fi provisioning.

## Editing Rules

- Keep changes focused on translation wiring and translation files.
- Prefer existing i18n patterns in nearby code.
- Use stable, descriptive `snake_case` keys.
- Do not rename existing keys unless required for correctness.
- Do not translate Home Assistant dynamic content.
- Do not change icons, entity IDs, service names, API strings, generated constants, or unrelated UI behavior.
- Do not refactor unrelated code while touching translation call sites.

## Pull Request Requirements

The PR description must include:

- What device or web configurator UI text was added to translations.
- What code paths were changed to use translation helpers.
- Which checks passed.
- Device testing notes explaining which screen, card, modal, or setup/status flow should be checked after flashing, and for web changes which configurator tab or card editor to open after switching `Screen: Language`.

If firmware flashing is useful for confidence, name the affected display or device in the PR body. Do not close related GitHub issues until the user confirms device testing works.
