#!/usr/bin/env python3
"""Translation quality checks for the firmware and web configurator catalogs.

scripts/build.py already enforces catalog structure (key parity, placeholders,
plural categories, extracted call sites). This script covers the mistakes that
still build cleanly but ship wrong text:

  1. Glyph coverage: every character of every strings.*.txt value is in
     common/assets/text_glyphs.yaml or hebrew_glyphs.yaml. A missing glyph
     renders as a blank box on the panel instead of failing the compile.
  2. Firmware literals: every espcontrol_i18n("literal") and
     espcontrol_i18n(std::string("literal")) value, and every
     espcontrol_i18n_key("key"), exists in strings.en.txt. A missing value stays
     English in every language; a missing key shows the key name.
  3. Duplicate English values in strings.en.txt are listed in
     DUPLICATE_ENGLISH_VALUES with the key that must come first, because
     espcontrol_i18n() resolves a value through the first key that carries it.
  4. Identical values: product/v2/translations/identical.<locale>.txt declares
     which catalog families of that locale are complete. In a complete family a
     value equal to its English source must be listed there as
     firmware:<key> or web:<key>, so an untranslated leftover cannot return.
     Families not declared complete are reported without failing.
  5. Language codes agree across the language_select options in
     common/addon/time.yaml, LANGUAGE_OPTIONS and LANGUAGE_LABELS in
     src/webserver/state/app_state.ts, and strings.*.txt; web.*.txt and
     identical.*.txt must name codes from that set.
  6. Advisory only: English values that the web and firmware catalogs of one
     locale translate differently.

Usage:
    python3 scripts/check_translations.py              # exit 1 on any failure
    python3 scripts/check_translations.py --self-test
"""

from __future__ import annotations

import argparse
import re
import sys
import tempfile
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

TRANSLATIONS_DIR = "product/v2/translations"
GLYPH_FILES = ("common/assets/text_glyphs.yaml", "common/assets/hebrew_glyphs.yaml")
FIRMWARE_LITERAL_GLOBS = ("components/espcontrol/*.h", "common/device/*.yaml", "common/addon/*.yaml")
GENERATED_FIRMWARE_FILES = {"i18n_generated.h"}
LANGUAGE_SELECT_YAML = "common/addon/time.yaml"
LANGUAGE_SELECT_ID = "language_select"
APP_STATE_TS = "src/webserver/state/app_state.ts"
ENGLISH = "en"

# Catalog families an identical.<locale>.txt file can describe.
FAMILY_PREFIXES = {"firmware": "strings", "web": "web"}

MONTHS = (
    "january", "february", "march", "april", "may", "june",
    "july", "august", "september", "october", "november", "december",
)

# English value -> the keys allowed to share it. The first key listed must also
# come first in strings.en.txt: espcontrol_i18n("Open") resolves through it, and
# the later keys are reachable only through espcontrol_i18n_key().
DUPLICATE_ENGLISH_VALUES: dict[str, tuple[str, ...]] = {
    "Open": ("open", "state_open"),
    **{month.capitalize(): (month, f"month_day_{month}") for month in MONTHS},
}

ADVISORY_LIMIT = 25
PLACEHOLDER_RE = re.compile(r"\{[A-Za-z_][A-Za-z0-9_]*\}")
IDENTICAL_ENTRY_RE = re.compile(r"^([a-z]+):([a-z0-9_]+(?:\.[a-z]+)?)\s*(?:#.*)?$")
FIRMWARE_CALL_RE = re.compile(r"\bespcontrol_i18n(_key)?\s*\(\s*(?:std::string\s*\(\s*)?(?=\")")
TS_STRING = r"\"(?:[^\"\\]|\\.)*\"|'(?:[^'\\]|\\.)*'"
TS_STRING_RE = re.compile(TS_STRING)
TS_OBJECT_KEY_RE = re.compile(r"(?:\"([^\"]+)\"|'([^']+)'|([A-Za-z_$][\w$]*))\s*:\s*(?:" + TS_STRING + ")")

C_SIMPLE_ESCAPES = {
    "n": "\n", "t": "\t", "r": "\r", "\\": "\\", "\"": "\"", "'": "'", "?": "?",
    "a": "\a", "b": "\b", "f": "\f", "v": "\v",
}
YAML_SIMPLE_ESCAPES = {
    "0": "\0", "a": "\a", "b": "\b", "t": "\t", "n": "\n", "v": "\v", "f": "\f",
    "r": "\r", "e": "\x1b", " ": " ", "\"": "\"", "/": "/", "\\": "\\",
    "N": "\x85", "_": "\xa0",
}


class TranslationCheckError(RuntimeError):
    """An input file could not be read well enough to run the checks."""


@dataclass
class Report:
    errors: list[str] = field(default_factory=list)
    advisories: list[str] = field(default_factory=list)
    summary: list[str] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Parsers
# ---------------------------------------------------------------------------

def unescape_compact_string(value: str) -> str:
    """Same escapes as scripts/build.py: backslash-n, and a backslash before any other character."""
    out = []
    i = 0
    while i < len(value):
        ch = value[i]
        if ch != "\\" or i + 1 >= len(value):
            out.append(ch)
            i += 1
            continue
        nxt = value[i + 1]
        out.append("\n" if nxt == "n" else nxt)
        i += 2
    return "".join(out)


def load_compact_strings(path: Path, label: str) -> dict[str, str]:
    """Parse a key=value catalog the way scripts/build.py does (comments start at column 0)."""
    strings: dict[str, str] = {}
    for line_no, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if not line or line.startswith("#"):
            continue
        if "=" not in line:
            raise TranslationCheckError(f"{label}:{line_no}: expected key=value")
        key, value = line.split("=", 1)
        key = key.strip()
        if not key:
            raise TranslationCheckError(f"{label}:{line_no}: empty key")
        if key in strings:
            raise TranslationCheckError(f"{label}:{line_no}: duplicate key {key!r}")
        strings[key] = unescape_compact_string(value)
    return strings


def _decode_yaml_double_quoted(body: str, label: str) -> str:
    out = []
    i = 0
    while i < len(body):
        ch = body[i]
        if ch != "\\":
            out.append(ch)
            i += 1
            continue
        if i + 1 >= len(body):
            raise TranslationCheckError(f"{label}: dangling backslash")
        nxt = body[i + 1]
        width = {"x": 2, "u": 4, "U": 8}.get(nxt)
        if width:
            digits = body[i + 2:i + 2 + width]
            if len(digits) != width or not re.fullmatch(r"[0-9A-Fa-f]+", digits):
                raise TranslationCheckError(f"{label}: invalid \\{nxt} escape")
            out.append(chr(int(digits, 16)))
            i += 2 + width
            continue
        if nxt not in YAML_SIMPLE_ESCAPES:
            raise TranslationCheckError(f"{label}: unsupported escape \\{nxt}")
        out.append(YAML_SIMPLE_ESCAPES[nxt])
        i += 2
    return "".join(out)


def load_glyph_list(path: Path, label: str) -> set[str]:
    """Characters of a YAML list of scalars, the shape ESPHome reads as `glyphs:`."""
    glyphs: set[str] = set()
    for line_no, raw in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        where = f"{label}:{line_no}"
        if not line.startswith("- "):
            raise TranslationCheckError(f"{where}: expected a '- \"...\"' list entry")
        scalar = line[2:].strip()
        if scalar.startswith("\""):
            match = re.match(r"\"((?:[^\"\\]|\\.)*)\"\s*(?:#.*)?$", scalar)
            if not match:
                raise TranslationCheckError(f"{where}: unterminated double-quoted entry")
            glyphs.update(_decode_yaml_double_quoted(match.group(1), where))
        elif scalar.startswith("'"):
            match = re.match(r"'((?:[^']|'')*)'\s*(?:#.*)?$", scalar)
            if not match:
                raise TranslationCheckError(f"{where}: unterminated single-quoted entry")
            glyphs.update(match.group(1).replace("''", "'"))
        else:
            glyphs.update(re.sub(r"\s+#.*$", "", scalar))
    return glyphs


def _decode_c_string(body: str) -> str:
    """Decode a C++ narrow string literal body; \\x and octal escapes are UTF-8 bytes."""
    out = bytearray()
    i = 0
    while i < len(body):
        ch = body[i]
        if ch != "\\" or i + 1 >= len(body):
            out.extend(ch.encode("utf-8"))
            i += 1
            continue
        nxt = body[i + 1]
        if nxt in C_SIMPLE_ESCAPES:
            out.extend(C_SIMPLE_ESCAPES[nxt].encode("utf-8"))
            i += 2
        elif nxt == "x":
            match = re.match(r"[0-9A-Fa-f]+", body[i + 2:])
            if not match:
                out.extend(b"\\x")
                i += 2
                continue
            out.append(int(match.group(0), 16) & 0xFF)
            i += 2 + len(match.group(0))
        elif nxt in "01234567":
            match = re.match(r"[0-7]{1,3}", body[i + 1:])
            out.append(int(match.group(0), 8) & 0xFF)
            i += 1 + len(match.group(0))
        elif nxt in "uU":
            width = 4 if nxt == "u" else 8
            digits = body[i + 2:i + 2 + width]
            if len(digits) == width and re.fullmatch(r"[0-9A-Fa-f]+", digits):
                out.extend(chr(int(digits, 16)).encode("utf-8"))
                i += 2 + width
            else:
                out.extend(b"\\" + nxt.encode("ascii"))
                i += 2
        else:
            out.extend(nxt.encode("utf-8"))
            i += 2
    return out.decode("utf-8", errors="replace")


C_LITERAL_RE = re.compile(r"\"((?:[^\"\\\n]|\\.)*)\"")


def firmware_call_literals(text: str) -> list[tuple[bool, str, int]]:
    """(is_key_lookup, decoded literal, line) for each literal-argument i18n call.

    Adjacent literals ("a" "b") are joined as the compiler would. Calls whose
    first argument is not a string literal are runtime values and are skipped.
    """
    found = []
    for call in FIRMWARE_CALL_RE.finditer(text):
        position = call.end()
        parts = []
        while True:
            literal = C_LITERAL_RE.match(text, position)
            if not literal:
                break
            parts.append(_decode_c_string(literal.group(1)))
            position = literal.end()
            while position < len(text) and text[position] in " \t\r\n":
                position += 1
        if parts:
            found.append((bool(call.group(1)), "".join(parts), text.count("\n", 0, call.start()) + 1))
    return found


def language_select_options(text: str, label: str) -> list[str]:
    """Options of the template select whose id is language_select, without a YAML parser."""
    lines = text.splitlines()
    id_re = re.compile(r"^\s*id:\s*[\"']?" + re.escape(LANGUAGE_SELECT_ID) + r"[\"']?\s*(?:#.*)?$")
    id_index = next((i for i, line in enumerate(lines) if id_re.match(line)), None)
    if id_index is None:
        raise TranslationCheckError(f"{label}: no select with id {LANGUAGE_SELECT_ID}")
    start = id_index
    while start >= 0 and not re.match(r"^\s*-\s+\w", lines[start]):
        start -= 1
    if start < 0:
        raise TranslationCheckError(f"{label}: {LANGUAGE_SELECT_ID} is not inside a list entry")
    item_indent = len(lines[start]) - len(lines[start].lstrip())
    end = start + 1
    while end < len(lines):
        line = lines[end]
        if line.strip() and not line.lstrip().startswith("#"):
            indent = len(line) - len(line.lstrip())
            if indent <= item_indent:
                break
        end += 1
    options_index = next(
        (i for i in range(start, end) if re.match(r"^\s*options:\s*(?:#.*)?$", lines[i])), None
    )
    if options_index is None:
        raise TranslationCheckError(f"{label}: {LANGUAGE_SELECT_ID} has no options list")
    options = []
    for line in lines[options_index + 1:end]:
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        match = re.match(r"^\s*-\s*[\"']?([^\"'#\s]+)[\"']?\s*(?:#.*)?$", line)
        if not match:
            break
        options.append(match.group(1))
    if not options:
        raise TranslationCheckError(f"{label}: {LANGUAGE_SELECT_ID} options list is empty")
    return options


def _ts_string_value(literal: str) -> str:
    return re.sub(r"\\(.)", r"\1", literal[1:-1])


def app_state_language_codes(text: str, label: str) -> tuple[list[str], list[str]]:
    """(LANGUAGE_OPTIONS values, LANGUAGE_LABELS keys) from app_state.ts."""
    options_match = re.search(r"\bLANGUAGE_OPTIONS\b[^=\n]*=\s*\[(.*?)\]", text, re.DOTALL)
    if not options_match:
        raise TranslationCheckError(f"{label}: LANGUAGE_OPTIONS array not found")
    options = [_ts_string_value(item) for item in TS_STRING_RE.findall(options_match.group(1))]
    labels_match = re.search(r"\bLANGUAGE_LABELS\b[^=\n]*=\s*\{(.*?)\}\s*;", text, re.DOTALL)
    if not labels_match:
        raise TranslationCheckError(f"{label}: LANGUAGE_LABELS object not found")
    labels = [
        quoted or single or bare
        for quoted, single, bare in TS_OBJECT_KEY_RE.findall(labels_match.group(1))
    ]
    if not options or not labels:
        raise TranslationCheckError(f"{label}: LANGUAGE_OPTIONS or LANGUAGE_LABELS is empty")
    return options, labels


@dataclass
class IdenticalAllowlist:
    locale: str
    label: str
    complete: set[str] = field(default_factory=set)
    entries: dict[str, dict[str, int]] = field(default_factory=dict)


def load_identical_allowlist(path: Path, label: str, locale: str, errors: list[str]) -> IdenticalAllowlist:
    allowlist = IdenticalAllowlist(locale, label, entries={family: {} for family in FAMILY_PREFIXES})
    for line_no, raw in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("@"):
            directive, *families = line.split()
            if directive != "@complete":
                errors.append(f"{label}:{line_no}: unknown directive {directive!r} (only @complete is supported)")
                continue
            for family in families:
                if family not in FAMILY_PREFIXES:
                    errors.append(
                        f"{label}:{line_no}: unknown catalog family {family!r} "
                        f"(expected {' or '.join(sorted(FAMILY_PREFIXES))})"
                    )
                else:
                    allowlist.complete.add(family)
            continue
        match = IDENTICAL_ENTRY_RE.match(line)
        if not match or match.group(1) not in FAMILY_PREFIXES:
            errors.append(f"{label}:{line_no}: expected 'firmware:<key>' or 'web:<key>', got {line!r}")
            continue
        family, key = match.groups()
        if key in allowlist.entries[family]:
            errors.append(
                f"{label}:{line_no}: {family}:{key} is already listed on line {allowlist.entries[family][key]}"
            )
            continue
        allowlist.entries[family][key] = line_no
    return allowlist


# ---------------------------------------------------------------------------
# Checks
# ---------------------------------------------------------------------------

def catalog_label(family: str, locale: str) -> str:
    return f"{TRANSLATIONS_DIR}/{FAMILY_PREFIXES[family]}.{locale}.txt"


def load_catalogs(root: Path, family: str) -> dict[str, dict[str, str]]:
    prefix = FAMILY_PREFIXES[family]
    catalogs = {}
    for path in sorted((root / TRANSLATIONS_DIR).glob(f"{prefix}.*.txt")):
        locale = path.name[len(prefix) + 1:-len(".txt")]
        catalogs[locale] = load_compact_strings(path, catalog_label(family, locale))
    return catalogs


def describe_character(ch: str) -> str:
    return f"{ch!r} (U+{ord(ch):04X})"


def check_glyph_coverage(root: Path, firmware: dict[str, dict[str, str]], report: Report) -> None:
    glyphs: set[str] = set()
    for glyph_file in GLYPH_FILES:
        glyphs |= load_glyph_list(root / glyph_file, glyph_file)
    missing_total = 0
    for locale, catalog in firmware.items():
        for key, value in catalog.items():
            missing = sorted({ch for ch in value if ch != "\n" and ch not in glyphs})
            if missing:
                missing_total += len(missing)
                report.errors.append(
                    f"{catalog_label('firmware', locale)}: {key} uses "
                    f"{', '.join(describe_character(ch) for ch in missing)}, which is not in "
                    f"{' or '.join(GLYPH_FILES)}; the panel would draw a blank box"
                )
    report.summary.append(
        f"glyph coverage: {len(firmware)} firmware catalogs against {len(glyphs)} glyphs, "
        f"{missing_total} missing"
    )


def check_firmware_literals(root: Path, english: dict[str, str], report: Report) -> None:
    english_values = set(english.values())
    values = keys = missing = 0
    for pattern in FIRMWARE_LITERAL_GLOBS:
        for path in sorted(root.glob(pattern)):
            if path.name in GENERATED_FIRMWARE_FILES:
                continue
            relative = path.relative_to(root).as_posix()
            for is_key, literal, line in firmware_call_literals(path.read_text(encoding="utf-8", errors="replace")):
                if is_key:
                    keys += 1
                    if literal not in english:
                        missing += 1
                        report.errors.append(
                            f"{relative}:{line}: espcontrol_i18n_key({literal!r}) is not a key in "
                            f"{catalog_label('firmware', ENGLISH)}; the panel would show the key name"
                        )
                else:
                    values += 1
                    if literal not in english_values:
                        missing += 1
                        report.errors.append(
                            f"{relative}:{line}: espcontrol_i18n({literal!r}) is not a value in "
                            f"{catalog_label('firmware', ENGLISH)}; add a key for it to every strings.*.txt "
                            "or it stays English in every language"
                        )
    report.summary.append(
        f"firmware literals: {values} espcontrol_i18n values and {keys} espcontrol_i18n_key keys, {missing} missing"
    )


def check_duplicate_english_values(
    english: dict[str, str],
    allowed_groups: dict[str, tuple[str, ...]],
    report: Report,
) -> None:
    keys_by_value: dict[str, list[str]] = {}
    for key, value in english.items():
        keys_by_value.setdefault(value, []).append(key)
    label = catalog_label("firmware", ENGLISH)
    duplicates = {value: keys for value, keys in keys_by_value.items() if len(keys) > 1}
    before = len(report.errors)
    for value, keys in duplicates.items():
        allowed = allowed_groups.get(value)
        if allowed is None:
            report.errors.append(
                f"{label}: keys {', '.join(keys)} share the value {value!r}; espcontrol_i18n({value!r}) "
                f"only ever resolves through {keys[0]!r}. Reword one value, or add the group to "
                "DUPLICATE_ENGLISH_VALUES in scripts/check_translations.py and reach the later keys "
                "through espcontrol_i18n_key()"
            )
            continue
        unexpected = [key for key in keys if key not in allowed]
        if unexpected:
            report.errors.append(
                f"{label}: {', '.join(unexpected)} also carries the value {value!r}, but "
                f"DUPLICATE_ENGLISH_VALUES only allows {', '.join(allowed)}"
            )
        if keys[0] != allowed[0]:
            report.errors.append(
                f"{label}: {keys[0]!r} now comes before {allowed[0]!r}, so espcontrol_i18n({value!r}) "
                f"would switch to the {keys[0]!r} translation; keep {allowed[0]!r} first"
            )
    for value, allowed in allowed_groups.items():
        if value not in duplicates:
            report.errors.append(
                f"scripts/check_translations.py: DUPLICATE_ENGLISH_VALUES lists {value!r} "
                f"({', '.join(allowed)}), but {label} no longer duplicates it; remove the entry"
            )
    report.summary.append(
        f"duplicate English values: {len(duplicates)} groups against {len(allowed_groups)} allowlisted, "
        f"{len(report.errors) - before} problems"
    )


def is_translatable(value: str) -> bool:
    return any(ch.isalpha() for ch in PLACEHOLDER_RE.sub("", value))


def english_reference(english: dict[str, str], key: str) -> str | None:
    """English text a translated key is measured against.

    A plural category English does not have (Polish .few and .many) is measured
    against the English .other form, which is also what --extract seeds it with.
    """
    if key in english:
        return english[key]
    base, dot, _category = key.partition(".")
    return english.get(f"{base}.other") if dot else None


def check_identical_values(
    root: Path,
    catalogs: dict[str, dict[str, dict[str, str]]],
    known_codes: set[str],
    report: Report,
) -> None:
    allowlist_paths = sorted((root / TRANSLATIONS_DIR).glob("identical.*.txt"))
    if not allowlist_paths:
        report.summary.append("identical values: no identical.<locale>.txt, so no locale is declared complete")
    for path in allowlist_paths:
        locale = path.name[len("identical."):-len(".txt")]
        label = f"{TRANSLATIONS_DIR}/{path.name}"
        if locale == ENGLISH or locale not in known_codes:
            report.errors.append(f"{label}: {locale!r} is not a translated language code")
            continue
        allowlist = load_identical_allowlist(path, label, locale, report.errors)
        if not allowlist.complete:
            report.errors.append(
                f"{label}: declare the finished catalog families with a line such as '@complete firmware'"
            )
        for family in FAMILY_PREFIXES:
            english = catalogs[family].get(ENGLISH)
            translated = catalogs[family].get(locale)
            family_label = catalog_label(family, locale)
            listed = allowlist.entries[family]
            if english is None or translated is None:
                if family in allowlist.complete:
                    report.errors.append(f"{label}: declares {family} complete, but {family_label} does not exist")
                for key, line_no in listed.items():
                    report.errors.append(f"{label}:{line_no}: {family}:{key} refers to {family_label}, which does not exist")
                continue
            for key, line_no in listed.items():
                reference = english_reference(english, key)
                if reference is None:
                    report.errors.append(
                        f"{label}:{line_no}: {family}:{key} is not a key in {catalog_label(family, ENGLISH)}"
                    )
                elif translated.get(key) != reference:
                    report.errors.append(
                        f"{label}:{line_no}: {family}:{key} is listed as identical to English, but "
                        f"{family_label} translates it as {translated.get(key)!r}; remove the line"
                    )
            unlisted = [
                key for key, value in translated.items()
                if english_reference(english, key) == value and key not in listed and is_translatable(value)
            ]
            if family in allowlist.complete:
                for key in unlisted:
                    report.errors.append(
                        f"{family_label}: {key} is identical to English ({translated[key]!r}); translate it, "
                        f"or add '{family}:{key}' to {label} if it must stay the same"
                    )
                report.summary.append(
                    f"identical values [{locale}] {family}: complete, {len(listed)} allowlisted, "
                    f"{len(unlisted)} unlisted"
                )
            else:
                report.summary.append(
                    f"identical values [{locale}] {family}: NOT declared complete in {path.name}, "
                    f"so {len(unlisted)} untranslated values are reported but do not fail "
                    f"({len(listed)} allowlisted)"
                )
                if unlisted:
                    shown = ", ".join(unlisted[:ADVISORY_LIMIT])
                    more = f" and {len(unlisted) - ADVISORY_LIMIT} more" if len(unlisted) > ADVISORY_LIMIT else ""
                    report.advisories.append(
                        f"{family_label} is not declared complete: {len(unlisted)} values still equal "
                        f"English ({shown}{more}). Translate them or list them in {label}, then add "
                        f"'{family}' to its @complete line."
                    )


def check_language_codes(
    root: Path,
    catalogs: dict[str, dict[str, dict[str, str]]],
    report: Report,
) -> set[str]:
    yaml_options = language_select_options(
        (root / LANGUAGE_SELECT_YAML).read_text(encoding="utf-8"), LANGUAGE_SELECT_YAML
    )
    ts_options, ts_labels = app_state_language_codes(
        (root / APP_STATE_TS).read_text(encoding="utf-8"), APP_STATE_TS
    )
    sources = {
        f"{LANGUAGE_SELECT_YAML} {LANGUAGE_SELECT_ID} options": yaml_options,
        f"{APP_STATE_TS} LANGUAGE_OPTIONS": ts_options,
        f"{APP_STATE_TS} LANGUAGE_LABELS": ts_labels,
        f"{TRANSLATIONS_DIR}/strings.*.txt": list(catalogs["firmware"]),
    }
    for name, codes in sources.items():
        repeated = sorted({code for code in codes if codes.count(code) > 1})
        if repeated:
            report.errors.append(f"{name}: language codes listed more than once: {', '.join(repeated)}")
    reference_name = f"{TRANSLATIONS_DIR}/strings.*.txt"
    reference = set(sources[reference_name])
    for name, codes in sources.items():
        if name == reference_name:
            continue
        missing = sorted(reference - set(codes))
        extra = sorted(set(codes) - reference)
        if missing:
            report.errors.append(f"{name} is missing language codes that have a strings.<code>.txt: {', '.join(missing)}")
        if extra:
            report.errors.append(f"{name} lists language codes without a strings.<code>.txt: {', '.join(extra)}")
    web_codes = sorted(catalogs["web"])
    unknown_web = sorted(set(web_codes) - reference)
    if unknown_web:
        report.errors.append(
            f"{TRANSLATIONS_DIR}/web.*.txt: {', '.join(unknown_web)} is not a panel language; "
            "the web configurator follows the panel language, so that catalog could never be selected"
        )
    report.summary.append(
        f"language codes: {len(reference)} panel languages; web catalogs: {', '.join(web_codes) or 'none'}"
    )
    return reference


def report_wording_divergence(catalogs: dict[str, dict[str, dict[str, str]]], report: Report) -> None:
    firmware_english = catalogs["firmware"].get(ENGLISH, {})
    web_english = catalogs["web"].get(ENGLISH, {})
    firmware_keys_by_value: dict[str, list[str]] = {}
    for key, value in firmware_english.items():
        firmware_keys_by_value.setdefault(value, []).append(key)
    for locale, web_catalog in catalogs["web"].items():
        firmware_catalog = catalogs["firmware"].get(locale)
        if locale == ENGLISH or firmware_catalog is None:
            continue
        lines = []
        for key, english_value in web_english.items():
            web_value = web_catalog.get(key)
            firmware_keys = firmware_keys_by_value.get(english_value)
            if not firmware_keys or web_value is None or web_value == english_value:
                continue
            firmware_values = {
                firmware_key: firmware_catalog[firmware_key]
                for firmware_key in firmware_keys
                if firmware_catalog.get(firmware_key, english_value) != english_value
            }
            if firmware_values and web_value not in firmware_values.values():
                firmware_text = ", ".join(f"{name}={text!r}" for name, text in firmware_values.items())
                lines.append(f"  {english_value!r}: web {key}={web_value!r}, firmware {firmware_text}")
        if lines:
            report.advisories.append(
                f"[{locale}] web and firmware catalogs word {len(lines)} shared English values differently "
                "(fine when the roles differ, for example a card-type noun against a command):\n"
                + "\n".join(lines)
            )


def check_root(root: Path, duplicate_values: dict[str, tuple[str, ...]] | None = None) -> Report:
    report = Report()
    catalogs = {family: load_catalogs(root, family) for family in FAMILY_PREFIXES}
    english = catalogs["firmware"].get(ENGLISH)
    if english is None:
        raise TranslationCheckError(f"{catalog_label('firmware', ENGLISH)} is missing")
    if catalogs["web"] and ENGLISH not in catalogs["web"]:
        report.errors.append(f"{catalog_label('web', ENGLISH)} is missing, but other web catalogs exist")
    check_glyph_coverage(root, catalogs["firmware"], report)
    check_firmware_literals(root, english, report)
    check_duplicate_english_values(
        english, DUPLICATE_ENGLISH_VALUES if duplicate_values is None else duplicate_values, report
    )
    known_codes = check_language_codes(root, catalogs, report)
    check_identical_values(root, catalogs, known_codes, report)
    report_wording_divergence(catalogs, report)
    return report


# ---------------------------------------------------------------------------
# Self-test
# ---------------------------------------------------------------------------

SELF_TEST_FILES = {
    "common/assets/text_glyphs.yaml": (
        "# Text glyphs\n"
        "- \" \"\n"
        "- \"!\\\"#'()-./0123456789:?ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\\\]abcdefghijklmnopqrstuvwxyz{}\"\n"
        "- \"\u00f3\u0105\u0119\u0142\u017a\u00e4\"\n"
    ),
    "common/assets/hebrew_glyphs.yaml": "# Hebrew\n- \"\u05d0\"  # alef\n- '\u05d1'\n",
    "product/v2/translations/strings.en.txt": (
        "# Firmware strings\n"
        "open=Open\n"
        "october=October\n"
        "state_open=Open\n"
        "month_day_october=October\n"
        "alarm=Alarm\n"
        "lock=Lock\n"
        "two_lines=Line one\\nLine two\n"
        "ratio=1:1\n"
    ),
    "product/v2/translations/strings.pl.txt": (
        "open=Otw\u00f3rz\n"
        "october=pa\u017adziernik\n"
        "state_open=Otwarte\n"
        "month_day_october=pa\u017adziernika\n"
        "alarm=Alarm\n"
        "lock=Zablokuj\n"
        "two_lines=Linia jeden\\nLinia dwa\n"
        "ratio=1:1\n"
    ),
    "product/v2/translations/strings.he.txt": (
        "open=\u05d0\u05d1\n"
        "october=\u05d0\n"
        "state_open=\u05d1\n"
        "month_day_october=\u05d0\u05d0\n"
        "alarm=\u05d1\u05d1\n"
        "lock=\u05d0\u05d1\u05d0\n"
        "two_lines=\u05d0\\n\u05d1\n"
        "ratio=1:1\n"
    ),
    "product/v2/translations/web.en.txt": "save=Save\nlock=Lock\nwebhook=Webhook\nitems.one={count} item\nitems.other={count} items\n",
    "product/v2/translations/web.pl.txt": (
        "save=Zapisz\nlock=Zamek\nwebhook=Webhook\n"
        "items.one={count} element\nitems.few={count} elementy\n"
        "items.many={count} element\u00f3w\nitems.other={count} elementu\n"
    ),
    "product/v2/translations/identical.pl.txt": (
        "# Deliberately identical\n"
        "@complete firmware web\n"
        "firmware:alarm  # same word in Polish\n"
        "web:webhook\n"
    ),
    "components/espcontrol/sample.h": (
        "inline const char *a() { return espcontrol_i18n(\"Open\"); }\n"
        "inline std::string b() { return espcontrol_i18n(std::string(\"Alarm\")); }\n"
        "inline const char *c() { return espcontrol_i18n_key(\"state_open\"); }\n"
        "inline std::string d(const std::string &state) { return espcontrol_i18n(sentence_cap_text(state)); }\n"
        "inline const char *e() { return espcontrol_i18n(\"Line one\\n\"\n"
        "                                                \"Line two\"); }\n"
    ),
    "components/espcontrol/i18n_generated.h": "inline const char *x() { return espcontrol_i18n(\"Not checked\"); }\n",
    "common/device/screen.yaml": "lambda: |-\n  return espcontrol_i18n(\"Lock\");\n",
    "common/addon/time.yaml": (
        "select:\n"
        "  - platform: template\n"
        "    id: timezone_select\n"
        "    options:\n"
        "      - \"Europe/Warsaw (GMT+1)\"\n"
        "  - platform: template\n"
        "    id: language_select\n"
        "    initial_option: \"en\"\n"
        "    options:\n"
        "      - \"en\"\n"
        "      - \"he\"\n"
        "      - \"pl\"\n"
        "    on_value:\n"
        "      then:\n"
        "        - lambda: |-\n"
        "            set_espcontrol_language(x);\n"
    ),
    "src/webserver/state/app_state.ts": (
        "export const LANGUAGE_LABELS: Readonly<Record<string, string>> = {\n"
        "  en: \"English\", he: \"\u05d0 (Hebrew)\",\n"
        "  \"pl\": \"Polski (Polish)\",\n"
        "};\n"
        "const LANGUAGE_OPTIONS = [\"en\", \"he\", \"pl\"];\n"
    ),
}


SELF_TEST_DUPLICATE_VALUES = {
    "Open": ("open", "state_open"),
    "October": ("october", "month_day_october"),
}


def _self_test_report(changes: dict[str, str | None] | None = None) -> Report:
    files = dict(SELF_TEST_FILES)
    files.update(changes or {})
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        for relative, content in files.items():
            if content is None:
                continue
            path = root / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(content, encoding="utf-8")
        return check_root(root, SELF_TEST_DUPLICATE_VALUES)


def _edited(relative: str, old: str, new: str) -> dict[str, str | None]:
    content = SELF_TEST_FILES[relative]
    assert old in content, f"self-test fixture {relative} no longer contains {old!r}"
    return {relative: content.replace(old, new, 1)}


def run_self_test() -> None:
    clean = _self_test_report()
    assert not clean.errors, f"clean fixture reported errors: {clean.errors}"
    assert any("'Lock'" in advisory and "Zamek" in advisory and "Zablokuj" in advisory
               for advisory in clean.advisories), clean.advisories

    def expect(changes: dict[str, str | None], *fragments: str) -> Report:
        report = _self_test_report(changes)
        for fragment in fragments:
            assert any(fragment in error for error in report.errors), (
                f"expected an error containing {fragment!r}, got {report.errors}"
            )
        return report

    strings_en = "product/v2/translations/strings.en.txt"
    strings_pl = "product/v2/translations/strings.pl.txt"
    identical = "product/v2/translations/identical.pl.txt"
    sample = "components/espcontrol/sample.h"

    # 1. glyph coverage
    expect(_edited(strings_pl, "lock=Zablokuj", "lock=Zablokuj\u015b"), "lock uses '\u015b' (U+015B)")
    # 2. firmware literals, both call shapes, key lookups, and adjacent literals
    expect(_edited(sample, "espcontrol_i18n(\"Open\")", "espcontrol_i18n(\"Cover Art\")"),
           "sample.h:1: espcontrol_i18n('Cover Art')")
    expect(_edited(sample, "std::string(\"Alarm\")", "std::string(\"Armed\")"), "sample.h:2: espcontrol_i18n('Armed')")
    expect(_edited(sample, "espcontrol_i18n_key(\"state_open\")", "espcontrol_i18n_key(\"state_ajar\")"),
           "espcontrol_i18n_key('state_ajar')")
    expect(_edited(sample, "\"Line two\"", "\"Line 2\""), "espcontrol_i18n('Line one\\nLine 2')")
    expect({"common/device/screen.yaml": "lambda: |-\n  return espcontrol_i18n(\"Unlock\");\n"},
           "common/device/screen.yaml:2: espcontrol_i18n('Unlock')")
    # 3. duplicate English values: unlisted group, unexpected key, order, stale allowlist entry
    expect({strings_en: SELF_TEST_FILES[strings_en] + "siren=Alarm\n",
            strings_pl: SELF_TEST_FILES[strings_pl] + "siren=Syrena\n",
            "product/v2/translations/strings.he.txt":
                SELF_TEST_FILES["product/v2/translations/strings.he.txt"] + "siren=\u05d0\n"},
           "keys alarm, siren share the value 'Alarm'")
    expect(_edited(strings_en, "alarm=Alarm", "alarm=Open"), "alarm also carries the value 'Open'")
    expect({strings_en: SELF_TEST_FILES[strings_en].replace("open=Open\n", "", 1) + "open=Open\n"},
           "'state_open' now comes before 'open'")
    stale = _self_test_report(_edited(strings_en, "month_day_october=October", "month_day_october=Oct"))
    assert any("no longer duplicates" in error and "'October'" in error for error in stale.errors), stale.errors
    # 4. identical values
    expect(_edited(strings_pl, "lock=Zablokuj", "lock=Lock"), "strings.pl.txt: lock is identical to English ('Lock')",
           "add 'firmware:lock'")
    expect(_edited(strings_pl, "alarm=Alarm", "alarm=Alarmowy"), "firmware:alarm is listed as identical to English")
    expect(_edited(identical, "firmware:alarm", "firmware:alarn"), "firmware:alarn is not a key")
    expect(_edited(identical, "web:webhook", "docs:webhook"), "expected 'firmware:<key>' or 'web:<key>'")
    expect(_edited(identical, "web:webhook\n", "web:webhook\nweb:webhook\n"), "web:webhook is already listed on line 4")
    expect(_edited(identical, "@complete firmware web", "@complete firmware docs"), "unknown catalog family 'docs'")
    expect(_edited(identical, "@complete firmware web\n", ""), "declare the finished catalog families")
    expect({identical: None, "product/v2/translations/identical.xx.txt": "@complete firmware\n"},
           "'xx' is not a translated language code")
    expect({"product/v2/translations/web.pl.txt": None}, "declares web complete, but", "web:webhook refers to")
    incomplete = _self_test_report({
        identical: SELF_TEST_FILES[identical].replace("@complete firmware web", "@complete firmware"),
        "product/v2/translations/web.pl.txt":
            SELF_TEST_FILES["product/v2/translations/web.pl.txt"].replace("save=Zapisz", "save=Save"),
    })
    assert not incomplete.errors, incomplete.errors
    assert any("web.pl.txt is not declared complete: 1 values" in advisory and "save" in advisory
               for advisory in incomplete.advisories), incomplete.advisories
    expect(_edited("product/v2/translations/web.pl.txt", "save=Zapisz", "save=Save"),
           "web.pl.txt: save is identical to English ('Save')")
    expect(_edited("product/v2/translations/web.pl.txt", "items.few={count} elementy", "items.few={count} items"),
           "web.pl.txt: items.few is identical to English ('{count} items')")
    # Values with nothing to translate never need an allowlist line.
    assert not any("ratio" in error for error in clean.errors)
    # 5. language codes
    expect(_edited("common/addon/time.yaml", "      - \"pl\"\n", ""), "time.yaml language_select options is missing", "pl")
    expect(_edited("src/webserver/state/app_state.ts", "[\"en\", \"he\", \"pl\"]", "[\"en\", \"he\", \"pl\", \"de\"]"),
           "LANGUAGE_OPTIONS lists language codes without a strings.<code>.txt: de")
    expect(_edited("src/webserver/state/app_state.ts", "  \"pl\": \"Polski (Polish)\",\n", ""),
           "LANGUAGE_LABELS is missing language codes", "pl")
    expect({"product/v2/translations/web.de.txt": "save=Speichern\n"}, "web.*.txt: de is not a panel language")
    expect(_edited("common/addon/time.yaml", "      - \"he\"\n", "      - \"he\"\n      - \"he\"\n"),
           "language codes listed more than once: he")
    # Parser guards
    for changes, fragment in (
        (_edited("common/assets/text_glyphs.yaml", "- \" \"\n", "glyphs: abc\n"), "expected a '- \"...\"' list entry"),
        (_edited(strings_pl, "lock=Zablokuj\n", "lock\n"), "expected key=value"),
        (_edited("common/addon/time.yaml", "id: language_select", "id: locale_select"), "no select with id"),
        ({strings_en: None}, "strings.en.txt is missing"),
    ):
        try:
            _self_test_report(changes)
        except TranslationCheckError as exc:
            assert fragment in str(exc), f"expected {fragment!r} in {exc}"
        else:
            raise AssertionError(f"expected TranslationCheckError containing {fragment!r}")

    assert firmware_call_literals('x = espcontrol_i18n("Caf\\xc3\\xa9 \\"A\\"");') == [(False, 'Caf\u00e9 "A"', 1)]
    assert firmware_call_literals("espcontrol_i18n(title); espcontrol_i18n_pl(\"x\");") == []
    print("Translation check self-tests passed.")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--self-test", action="store_true", help="run the checker against built-in fixtures")
    args = parser.parse_args(argv)
    if args.self_test:
        run_self_test()
        return 0
    try:
        report = check_root(ROOT)
    except TranslationCheckError as exc:
        print(f"ERROR: {exc}")
        return 1
    for line in report.summary:
        print(line)
    for advisory in report.advisories:
        print(f"\nADVISORY (does not fail the check): {advisory}")
    if report.errors:
        print(f"\nERROR: {len(report.errors)} translation problem(s):")
        for error in report.errors:
            print(f"  {error}")
        return 1
    print("\nTranslation checks passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
