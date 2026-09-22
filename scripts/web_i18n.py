"""Web configurator i18n: call-site extractor, catalog validator, and TypeScript emitter.

Imported by scripts/build.py (``sync_web_i18n``); it is not a command on its own.

Authored catalogs live next to the firmware ones:

    product/v2/translations/web.en.txt      English key master
    product/v2/translations/web.<lang>.txt  one file per translated locale

They use the same compact ``key=value`` grammar as strings.*.txt, so build.py
passes in its own ``load_compact_strings`` parser and both catalog families keep
one definition of comments and escapes.

Call sites in src/webserver/**/*.ts (generated/, testing/ and i18n/ excluded):

    i18n("English")                         English-source keyed
    i18nMark("English")                     marks a literal, translated later
    i18nKey("context_key", "English")       homonyms and context
    i18nPlural("family", n, {one: "..", other: ".."})
    i18nDevice("English")                   firmware catalog (emulated panel text)

Modes (see ``build``):

    generate  catalog structure and call-site syntax are fatal; literals missing
              from the catalog and unused entries are warnings, so the bundle can
              be built while call sites are still being wrapped
    strict    (--check) missing and unused entries are failures too
    extract   (--extract) rewrites web.en.txt from the call sites and fills gaps
              in every web.<lang>.txt with the English value
"""
import json
import re
from dataclasses import dataclass, field
from pathlib import Path


class WebI18nError(RuntimeError):
    pass


# CLDR plural categories per catalog locale, in the order they are written.
# A new web.<lang>.txt needs its row here (and nothing else in the generator).
PLURAL_CATEGORIES = {
    "en": ("one", "other"),
    "pl": ("one", "few", "many", "other"),
}
KNOWN_PLURAL_CATEGORIES = ("zero", "one", "two", "few", "many", "other")

ENGLISH_LOCALE = "en"
CATALOG_GLOB = "web.*.txt"
MAX_KEY_LENGTH = 64
EXCLUDED_SOURCE_DIRECTORIES = ("generated", "testing", "i18n")
CONTRACT_GROUP = "product/v2/card_contract.json"
EXTRACT_HINT = "python3 scripts/build.py web-i18n --extract"

KEY_RE = re.compile(r"^[a-z0-9_]+$")
LOCALE_RE = re.compile(r"^[a-z]{2,3}(?:-[a-z0-9]+)*$")
PLACEHOLDER_RE = re.compile(r"\{([A-Za-z_][A-Za-z0-9_]*)\}")
# The compact format escapes LF and backslash only. Internal tabs are safe;
# other controls and Unicode line separators cannot round-trip through splitlines().
UNSUPPORTED_TEXT_CHAR_RE = re.compile(r"[\x00-\x08\x0b-\x1f\x7f-\x9f\u2028\u2029]")
CALL_RE = re.compile(r"(?<![\w$.])(i18nPlural|i18nDevice|i18nMark|i18nKey|i18n)\s*\(")
WORD_RE = re.compile(r"[\w$]+")
FUNCTION_KEYWORD_RE = re.compile(r"\bfunction\s*\*?\s*$")

# A `/` after one of these starts a regular expression, not a division.
REGEX_PREFIX_CHARS = set("(,=:[!&|?{;+-*%<>~^")
REGEX_PREFIX_WORDS = {
    "return", "typeof", "instanceof", "in", "of", "new", "delete", "void",
    "throw", "case", "do", "else", "yield", "await",
}
SIMPLE_ESCAPES = {
    "n": "\n", "t": "\t", "r": "\r", "b": "\b", "f": "\f", "v": "\v", "0": "\0",
}


# ===========================================================================
# TypeScript scanning
# ===========================================================================

class _Scanner:
    """Marks which characters of a TypeScript source are code.

    Comments are blanked (newlines kept, so offsets and line numbers hold) and
    the insides of string, template and regular-expression literals are not
    code, so an ``i18n(`` mentioned in a comment or a string is never extracted.
    Code inside a template ``${...}`` expression is code again.
    """

    def __init__(self, text):
        self.text = text
        self.length = len(text)
        self.is_code = bytearray(self.length)
        self.blanked = list(text)
        self.last_char = ""
        self.last_word = ""

    def run(self):
        self._code(0, False)
        return "".join(self.blanked), self.is_code

    def _blank(self, start, end):
        for index in range(start, end):
            if self.blanked[index] != "\n":
                self.blanked[index] = " "

    def _regex_allowed(self):
        if self.last_char == "":
            return True
        if self.last_char == "w":
            return self.last_word in REGEX_PREFIX_WORDS
        return self.last_char in REGEX_PREFIX_CHARS

    def _code(self, i, in_template_expression):
        text = self.text
        n = self.length
        depth = 0
        while i < n:
            ch = text[i]
            nxt = text[i + 1] if i + 1 < n else ""
            if ch == "/" and nxt == "/":
                end = text.find("\n", i)
                end = n if end < 0 else end
                self._blank(i, end)
                i = end
                continue
            if ch == "/" and nxt == "*":
                end = text.find("*/", i + 2)
                end = n if end < 0 else end + 2
                self._blank(i, end)
                i = end
                continue
            if ch in "\"'":
                i = self._quoted(i)
                self.last_char = "s"
                continue
            if ch == "`":
                i = self._template(i + 1)
                self.last_char = "s"
                continue
            if ch == "/" and self._regex_allowed():
                end = self._regex(i)
                if end is not None:
                    i = end
                    self.last_char = "s"
                    continue
            if ch == "{":
                depth += 1
            elif ch == "}":
                if in_template_expression and depth == 0:
                    return i
                depth -= 1
            word = WORD_RE.match(text, i)
            if word:
                for index in range(i, word.end()):
                    self.is_code[index] = 1
                self.last_char = "w"
                self.last_word = word.group(0)
                i = word.end()
                continue
            self.is_code[i] = 1
            if not ch.isspace():
                self.last_char = ch
            i += 1
        return n

    def _quoted(self, i):
        text = self.text
        n = self.length
        quote = text[i]
        j = i + 1
        while j < n and text[j] != quote and text[j] != "\n":
            j += 2 if text[j] == "\\" else 1
        return min(j + 1, n)

    def _template(self, i):
        text = self.text
        n = self.length
        while i < n:
            ch = text[i]
            if ch == "\\":
                i += 2
                continue
            if ch == "`":
                return i + 1
            if ch == "$" and text[i + 1:i + 2] == "{":
                i = self._code(i + 2, True) + 1
                continue
            i += 1
        return n

    def _regex(self, i):
        text = self.text
        n = self.length
        j = i + 1
        in_class = False
        while j < n:
            ch = text[j]
            if ch == "\n":
                return None
            if ch == "\\":
                j += 2
                continue
            if ch == "[":
                in_class = True
            elif ch == "]":
                in_class = False
            elif ch == "/" and not in_class:
                j += 1
                while j < n and (text[j].isalnum() or text[j] == "_"):
                    j += 1
                return j
            j += 1
        return None


class _ArgumentError(Exception):
    pass


def _skip_space(text, i):
    n = len(text)
    while i < n and text[i].isspace():
        i += 1
    return i


def _parse_string_literal(text, i):
    """Parse the JS/TS string literal at text[i]; return (value, end_index)."""
    n = len(text)
    quote = text[i]
    out = []
    j = i + 1
    while True:
        if j >= n:
            raise _ArgumentError("unterminated string literal")
        ch = text[j]
        if ch == quote:
            j += 1
            break
        if ch == "\n" and quote != "`":
            raise _ArgumentError("unterminated string literal")
        if quote == "`" and ch == "$" and text[j + 1:j + 2] == "{":
            raise _ArgumentError(
                "template literal with a ${...} expression cannot be extracted; "
                "use one literal with {placeholders} and pass the values as params"
            )
        if ch != "\\":
            out.append(ch)
            j += 1
            continue
        if j + 1 >= n:
            raise _ArgumentError("unterminated string literal")
        esc = text[j + 1]
        if esc == "\n":
            j += 2
        elif esc == "\r":
            j += 3 if text[j + 2:j + 3] == "\n" else 2
        elif esc == "x" and re.match(r"[0-9A-Fa-f]{2}", text[j + 2:j + 4]):
            out.append(chr(int(text[j + 2:j + 4], 16)))
            j += 4
        elif esc == "u" and text[j + 2:j + 3] == "{":
            end = text.find("}", j + 3)
            if end < 0 or not re.fullmatch(r"[0-9A-Fa-f]{1,6}", text[j + 3:end]):
                raise _ArgumentError("invalid \\u{...} escape")
            out.append(chr(int(text[j + 3:end], 16)))
            j = end + 1
        elif esc == "u" and re.match(r"[0-9A-Fa-f]{4}", text[j + 2:j + 6]):
            out.append(chr(int(text[j + 2:j + 6], 16)))
            j += 6
        else:
            out.append(SIMPLE_ESCAPES.get(esc, esc))
            j += 2
    value = "".join(out)
    # "😀" style surrogate pairs become one code point.
    value = value.encode("utf-16", "surrogatepass").decode("utf-16", "replace")
    return value, j


def _expect_string(text, i, name, position):
    i = _skip_space(text, i)
    if i >= len(text) or text[i] not in "\"'`":
        if name == "i18n":
            raise _ArgumentError(
                "i18n() needs a string literal as its first argument; "
                "use i18nDynamic() for runtime values, or wrap each branch separately"
            )
        if name == "i18nDevice":
            raise _ArgumentError(
                "i18nDevice() needs a string literal as its first argument so the firmware "
                "table can be restricted to it; call it once per literal (one per branch)"
            )
        raise _ArgumentError(f"{name}() needs a string literal as its {position} argument")
    value, end = _parse_string_literal(text, i)
    after = _skip_space(text, end)
    follower = text[after] if after < len(text) else ""
    if follower == "+":
        raise _ArgumentError(
            f"{name}() string concatenation cannot be extracted; "
            "use one literal with {placeholders} and pass the values as params"
        )
    if follower not in (",", ")", "}"):
        raise _ArgumentError(
            f"{name}() {position} argument must be one plain string literal "
            f"(unexpected {follower!r} after it)"
        )
    return value, after


def _skip_expression(text, i):
    """Skip one call argument; return the index of the top-level `,` or `)` after it."""
    n = len(text)
    depth = 0
    while i < n:
        ch = text[i]
        if ch in "\"'`":
            quote = ch
            i += 1
            while i < n and text[i] != quote:
                i += 2 if text[i] == "\\" else 1
            i += 1
            continue
        if ch in "([{":
            depth += 1
        elif ch in ")]}":
            if depth == 0:
                return i
            depth -= 1
        elif ch == "," and depth == 0:
            return i
        i += 1
    raise _ArgumentError("unterminated call")


def _parse_plural_forms(text, i):
    i = _skip_space(text, i)
    if i >= len(text) or text[i] != "{":
        raise _ArgumentError(
            "i18nPlural() needs an inline {one: \"...\", other: \"...\"} object literal "
            "as its third argument"
        )
    forms = {}
    i += 1
    while True:
        i = _skip_space(text, i)
        if i >= len(text):
            raise _ArgumentError("unterminated i18nPlural() forms object")
        if text[i] == "}":
            i += 1
            break
        if text[i] in "\"'":
            name, i = _parse_string_literal(text, i)
        else:
            word = WORD_RE.match(text, i)
            if not word:
                raise _ArgumentError("i18nPlural() forms must be {one: \"...\", other: \"...\"}")
            name = word.group(0)
            i = word.end()
        i = _skip_space(text, i)
        if i >= len(text) or text[i] != ":":
            raise _ArgumentError("i18nPlural() forms must be {one: \"...\", other: \"...\"}")
        value, i = _expect_string(text, i + 1, "i18nPlural", f"forms.{name}")
        if name in forms:
            raise _ArgumentError(f"i18nPlural() repeats the {name!r} form")
        forms[name] = value
        if text[i] == ",":
            i += 1
    if set(forms) != {"one", "other"}:
        raise _ArgumentError(
            "i18nPlural() English forms must be exactly {one, other}; "
            "other plural categories belong in web.<lang>.txt"
        )
    return forms, i


# ===========================================================================
# Usage extraction
# ===========================================================================

@dataclass(frozen=True)
class Site:
    path: str
    line: int

    def __str__(self):
        return f"{self.path}:{self.line}"


@dataclass
class Usage:
    """Everything the call sites and the card contract need from the catalogs."""
    sources: dict = field(default_factory=dict)          # English literal -> first Site
    keys: dict = field(default_factory=dict)             # context key -> (English, Site)
    plurals: dict = field(default_factory=dict)          # family key -> ({one, other}, Site)
    device: dict = field(default_factory=dict)           # firmware English literal -> first Site
    contract_labels: dict = field(default_factory=dict)  # label -> Site
    order: list = field(default_factory=list)            # ("source"|"key"|"plural", id) in first-use order
    errors: list = field(default_factory=list)


def _line_of(text, index):
    return text.count("\n", 0, index) + 1


def _check_literal(name, value):
    if not value:
        raise _ArgumentError(f"{name}() literal is empty")
    unsupported = UNSUPPORTED_TEXT_CHAR_RE.search(value)
    if unsupported:
        raise _ArgumentError(
            f"{name}() literal contains unsupported control or line separator "
            f"U+{ord(unsupported.group()):04X}; use LF for a line break"
        )
    if value != value.strip():
        raise _ArgumentError(
            f"{name}() literal {value!r} has leading or trailing whitespace; "
            "keep spacing outside the call"
        )


def _check_key(name, key):
    if not KEY_RE.match(key) or len(key) > MAX_KEY_LENGTH:
        raise _ArgumentError(
            f"{name}() key {key!r} must match [a-z0-9_]+ and be at most {MAX_KEY_LENGTH} characters"
        )


def extract_from_text(text, relative_path, usage):
    """Collect every i18n call in one TypeScript source into `usage`."""
    blanked, is_code = _Scanner(text).run()
    for match in CALL_RE.finditer(blanked):
        if not is_code[match.start()]:
            continue
        if FUNCTION_KEYWORD_RE.search(blanked, max(0, match.start() - 24), match.start()):
            continue
        name = match.group(1)
        site = Site(relative_path, _line_of(text, match.start()))
        try:
            _extract_call(blanked, match.end(), name, site, usage)
        except _ArgumentError as exc:
            usage.errors.append(f"{site}: {exc}")


def _extract_call(text, i, name, site, usage):
    if name in ("i18n", "i18nMark"):
        value, _ = _expect_string(text, i, name, "first")
        _check_literal(name, value)
        if value not in usage.sources:
            usage.sources[value] = site
            usage.order.append(("source", value))
        return
    if name == "i18nDevice":
        value, _ = _expect_string(text, i, name, "first")
        _check_literal(name, value)
        usage.device.setdefault(value, site)
        return
    key, i = _expect_string(text, i, name, "key")
    _check_key(name, key)
    if text[i] != ",":
        raise _ArgumentError(f"{name}() is missing its English text")
    if name == "i18nKey":
        value, _ = _expect_string(text, i + 1, name, "English")
        _check_literal(name, value)
        if key in usage.plurals:
            raise _ArgumentError(f"key {key!r} is already an i18nPlural() family at {usage.plurals[key][1]}")
        known = usage.keys.get(key)
        if known is None:
            usage.keys[key] = (value, site)
            usage.order.append(("key", key))
        elif known[0] != value:
            raise _ArgumentError(
                f"i18nKey({key!r}) English text {value!r} differs from {known[0]!r} at {known[1]}"
            )
        return
    i = _skip_expression(text, i + 1)
    if text[i] != ",":
        raise _ArgumentError("i18nPlural() is missing its {one, other} English forms")
    forms, _ = _parse_plural_forms(text, i + 1)
    for form in forms.values():
        _check_literal(name, form)
    if not placeholders(forms["one"]) - {"count"} <= placeholders(forms["other"]):
        raise _ArgumentError("i18nPlural() 'one' form uses a placeholder that 'other' does not")
    if key in usage.keys:
        raise _ArgumentError(f"key {key!r} is already an i18nKey() key at {usage.keys[key][1]}")
    known = usage.plurals.get(key)
    if known is None:
        usage.plurals[key] = (forms, site)
        usage.order.append(("plural", key))
    elif known[0] != forms:
        raise _ArgumentError(f"i18nPlural({key!r}) English forms differ from the ones at {known[1]}")


def source_files(source_dir):
    files = []
    for path in sorted(source_dir.rglob("*.ts"), key=lambda item: item.relative_to(source_dir).as_posix()):
        parts = path.relative_to(source_dir).parts
        if parts[0] in EXCLUDED_SOURCE_DIRECTORIES or path.name.endswith(".d.ts"):
            continue
        files.append(path)
    return files


def contract_labels(contract):
    """Display labels the configurator reads from the card contract at run time."""
    labels = []

    def walk(node):
        if isinstance(node, dict):
            for name, value in node.items():
                if name == "label" and isinstance(value, str) and value.strip():
                    labels.append(value)
                else:
                    walk(value)
        elif isinstance(node, list):
            for value in node:
                walk(value)

    for card in contract.get("cards", {}).values():
        if isinstance(card.get("label"), str) and card["label"].strip():
            labels.append(card["label"])
        # `default.label` and `normalization` hold persisted values, not chrome.
        walk(card.get("options", []))
        walk(card.get("behavior", {}))
    return list(dict.fromkeys(labels))


def collect_usage(root, source_dir, contract_path):
    usage = Usage()
    for path in source_files(source_dir):
        extract_from_text(path.read_text(encoding="utf-8"), path.relative_to(root).as_posix(), usage)
    if contract_path is not None and contract_path.exists():
        contract = json.loads(contract_path.read_text(encoding="utf-8"))
        relative = contract_path.relative_to(root).as_posix()
        for label in contract_labels(contract):
            if label != label.strip():
                usage.errors.append(f"{relative}: label {label!r} has leading or trailing whitespace")
                continue
            usage.contract_labels[label] = Site(relative, 0)
    return usage


# ===========================================================================
# Catalogs
# ===========================================================================

def placeholders(value):
    return set(PLACEHOLDER_RE.findall(value))


def split_key(key):
    """('cards_selected.few') -> ('cards_selected', 'few'); plain keys -> (key, None)."""
    if "." not in key:
        return key, None
    base, category = key.split(".", 1)
    return base, category


def catalog_path(strings_dir, locale):
    return strings_dir / f"web.{locale}.txt"


def load_catalogs(strings_dir, load_strings):
    """Return {locale: {key: value}} for every web.<locale>.txt, English first."""
    catalogs = {}
    english_path = catalog_path(strings_dir, ENGLISH_LOCALE)
    if english_path.exists():
        catalogs[ENGLISH_LOCALE] = load_strings(english_path)
    for path in sorted(strings_dir.glob(CATALOG_GLOB)):
        locale = path.name[len("web."):-len(".txt")]
        if locale == ENGLISH_LOCALE:
            continue
        if not LOCALE_RE.match(locale):
            raise WebI18nError(f"{path.name}: {locale!r} is not a valid locale code")
        catalogs[locale] = load_strings(path)
    return catalogs


def validate_catalogs(catalogs, usage):
    """Structural catalog errors. These are fatal in every mode."""
    errors = []
    english = catalogs.get(ENGLISH_LOCALE)
    if english is None:
        return [f"Missing web.{ENGLISH_LOCALE}.txt (run {EXTRACT_HINT})"]

    for locale, entries in catalogs.items():
        name = f"web.{locale}.txt"
        if locale not in PLURAL_CATEGORIES:
            errors.append(
                f"{name}: no plural categories for locale {locale!r}; "
                "add it to PLURAL_CATEGORIES in scripts/web_i18n.py"
            )
            continue
        allowed = PLURAL_CATEGORIES[locale]
        families = {}
        for key, value in entries.items():
            base, category = split_key(key)
            if not KEY_RE.match(base) or len(base) > MAX_KEY_LENGTH:
                errors.append(f"{name}: key {key!r} must match [a-z0-9_]+ (max {MAX_KEY_LENGTH} characters)")
            if category is not None:
                if category not in KNOWN_PLURAL_CATEGORIES:
                    errors.append(f"{name}: key {key!r} has an unknown plural category")
                elif category not in allowed:
                    errors.append(f"{name}: key {key!r} uses a plural category {locale!r} does not have {allowed}")
                families.setdefault(base, set()).add(category)
            if not value:
                errors.append(f"{name}: key {key!r} has an empty value")
            elif value != value.strip():
                errors.append(f"{name}: key {key!r} has leading or trailing whitespace")
            unsupported = UNSUPPORTED_TEXT_CHAR_RE.search(value)
            if unsupported:
                errors.append(
                    f"{name}: key {key!r} contains unsupported control or line separator "
                    f"U+{ord(unsupported.group()):04X}; use LF for a line break"
                )
        for base, present in families.items():
            if base in entries:
                errors.append(f"{name}: {base!r} is both a plain key and a plural family")
            missing = [category for category in allowed if category not in present]
            if missing:
                errors.append(f"{name}: plural family {base!r} is missing {', '.join(missing)}")

    for locale, entries in catalogs.items():
        if locale == ENGLISH_LOCALE or locale not in PLURAL_CATEGORIES:
            continue
        name = f"web.{locale}.txt"
        expected_keys = set()
        for key in english:
            base, category = split_key(key)
            if category is None:
                expected_keys.add(key)
            else:
                expected_keys.update(f"{base}.{target}" for target in PLURAL_CATEGORIES[locale])
        missing = sorted(expected_keys - entries.keys())
        extra = sorted(entries.keys() - expected_keys)
        if missing or extra:
            errors.append(
                f"{name} keys do not match web.en.txt (missing={missing[:5]}, extra={extra[:5]}); "
                f"run {EXTRACT_HINT}"
            )
        for key, value in entries.items():
            base, category = split_key(key)
            reference = english.get(key)
            if reference is None and category is not None:
                reference = english.get(f"{base}.other")
            if reference is None:
                continue
            expected = placeholders(reference)
            actual = placeholders(value)
            if category == "one":
                expected = expected - {"count"}
                actual = actual - {"count"}
            if expected != actual:
                errors.append(
                    f"{name}: key {key!r} placeholders {sorted(actual)} do not match English {sorted(expected)}"
                )

    seen = {}
    for key, value in english.items():
        if "." in key or key in usage.keys:
            continue
        if value in seen:
            errors.append(
                f"web.en.txt: keys {seen[value]!r} and {key!r} share the English value {value!r}; "
                "a second meaning needs a context key used through i18nKey() "
                f"(an unused leftover is dropped by {EXTRACT_HINT})"
            )
        else:
            seen[value] = key
    return errors


def coverage_problems(catalogs, usage, firmware_english):
    """Call sites vs catalogs. Warnings while generating, failures under --check."""
    problems = []
    english = catalogs.get(ENGLISH_LOCALE, {})
    source_values = {
        value for key, value in english.items()
        if "." not in key and key not in usage.keys
    }
    for literal, site in usage.sources.items():
        if literal not in source_values:
            problems.append(f"{site}: {literal!r} is not in web.en.txt")
    for label, site in usage.contract_labels.items():
        if label not in source_values:
            problems.append(f"{site.path}: card contract label {label!r} is not in web.en.txt")
    for key, (value, site) in usage.keys.items():
        if key not in english:
            problems.append(f"{site}: i18nKey key {key!r} is not in web.en.txt")
        elif english[key] != value:
            problems.append(f"{site}: i18nKey({key!r}) says {value!r} but web.en.txt has {english[key]!r}")
    for key, (forms, site) in usage.plurals.items():
        for category in PLURAL_CATEGORIES[ENGLISH_LOCALE]:
            entry = f"{key}.{category}"
            if entry not in english:
                problems.append(f"{site}: i18nPlural key {entry!r} is not in web.en.txt")
            elif english[entry] != forms[category]:
                problems.append(
                    f"{site}: i18nPlural({key!r}) {category} form {forms[category]!r} "
                    f"but web.en.txt has {english[entry]!r}"
                )
    firmware_values = set(firmware_english.values())
    for literal, site in usage.device.items():
        if literal not in firmware_values:
            problems.append(
                f"{site}: i18nDevice({literal!r}) is not a value in strings.en.txt "
                "(leave text the firmware cannot translate unwrapped)"
            )
    used_values = set(usage.sources) | set(usage.contract_labels)
    for key, value in english.items():
        base, category = split_key(key)
        if category is not None:
            if base not in usage.plurals:
                problems.append(f"web.en.txt: plural family {base!r} is unused ({key})")
        elif key not in usage.keys and value not in used_values:
            problems.append(f"web.en.txt: key {key!r} is unused")
    return problems


# ===========================================================================
# Extract (catalog rewrite)
# ===========================================================================

def slugify(value):
    slug = re.sub(r"[^a-z0-9]+", "_", value.lower()).strip("_")
    slug = slug[:MAX_KEY_LENGTH].strip("_")
    return slug or "text"


def _unique_key(slug, taken):
    if slug not in taken:
        return slug
    counter = 2
    while True:
        suffix = f"_{counter}"
        candidate = slug[:MAX_KEY_LENGTH - len(suffix)].rstrip("_") + suffix
        if candidate not in taken:
            return candidate
        counter += 1


def plan_english_catalog(usage, english):
    """Return [(group, [(key, value), ...]), ...] for the rewritten web.en.txt."""
    existing_key = {}
    for key, value in english.items():
        if "." in key or key in usage.keys or key in usage.plurals:
            continue
        existing_key.setdefault(value, key)

    reserved = set(usage.keys) | set(usage.plurals)
    wanted = list(usage.sources) + [label for label in usage.contract_labels if label not in usage.sources]
    taken = set(reserved)
    for literal in wanted:
        if literal in existing_key:
            taken.add(existing_key[literal])

    assigned = {}
    for literal in wanted:
        key = existing_key.get(literal)
        if key is None:
            key = _unique_key(slugify(literal), taken)
            taken.add(key)
        assigned[literal] = key

    groups = {}

    def group(name):
        return groups.setdefault(name, [])

    for kind, identifier in usage.order:
        if kind == "source":
            group(usage.sources[identifier].path).append((assigned[identifier], identifier))
        elif kind == "key":
            value, site = usage.keys[identifier]
            group(site.path).append((identifier, value))
        else:
            forms, site = usage.plurals[identifier]
            for category in PLURAL_CATEGORIES[ENGLISH_LOCALE]:
                group(site.path).append((f"{identifier}.{category}", forms[category]))
    for label in usage.contract_labels:
        if label not in usage.sources:
            group(CONTRACT_GROUP).append((assigned[label], label))

    ordered = sorted((name for name in groups if name != CONTRACT_GROUP))
    if CONTRACT_GROUP in groups:
        ordered.append(CONTRACT_GROUP)
    return [(name, groups[name]) for name in ordered]


def plan_locale_catalog(locale, plan, old_english, old_locale):
    """Mirror the English plan; keep a translation only while its English is unchanged."""
    categories = PLURAL_CATEGORIES[locale]
    result = []
    for name, entries in plan:
        english_now = dict(entries)
        rows = []
        done = set()
        for key, value in entries:
            base, category = split_key(key)
            if category is None:
                kept = old_locale.get(key) if old_english.get(key) == value else None
                rows.append((key, kept if kept else value))
                continue
            if base in done:
                continue
            done.add(base)
            for target in categories:
                reference_key = f"{base}.{target}" if f"{base}.{target}" in english_now else f"{base}.other"
                reference = english_now[reference_key]
                target_key = f"{base}.{target}"
                kept = old_locale.get(target_key) if old_english.get(reference_key) == reference else None
                rows.append((target_key, kept if kept else reference))
        result.append((name, rows))
    return result


def escape_compact_string(value):
    return value.replace("\\", "\\\\").replace("\n", "\\n")


def render_catalog(locale, plan):
    if locale == ENGLISH_LOCALE:
        lines = [
            "# Web configurator strings - English key master.",
            f"# Rewritten by `{EXTRACT_HINT}` from the i18n call sites in",
            "# src/webserver and the labels in product/v2/card_contract.json. Do not add or",
            "# reorder entries by hand; translate the values in web.<lang>.txt instead.",
        ]
    else:
        lines = [
            f"# Web configurator strings - {locale}.",
            "# Keys, order and {placeholders} mirror web.en.txt. New keys arrive with the",
            f"# English value from `{EXTRACT_HINT}`; translate the value only.",
        ]
    for name, entries in plan:
        lines.append("")
        lines.append(f"# {name}")
        for key, value in entries:
            lines.append(f"{key}={escape_compact_string(value)}")
    return "\n".join(lines) + "\n"


def flatten(plan):
    entries = {}
    for _name, rows in plan:
        for key, value in rows:
            entries[key] = value
    return entries


# ===========================================================================
# TypeScript emitter
# ===========================================================================

def _ts_array(values):
    if not values:
        return "[]"
    return "[\n" + "".join(f"  {json.dumps(value, ensure_ascii=False)},\n" for value in values) + "]"


def _ts_locale_record(record):
    if not record:
        return "{}"
    parts = []
    for locale, values in record.items():
        body = "".join(f"    {json.dumps(value, ensure_ascii=False)},\n" for value in values)
        parts.append(f"  {json.dumps(locale)}: [\n{body}  ],\n" if values else f"  {json.dumps(locale)}: [],\n")
    return "{\n" + "".join(parts) + "}"


def emit_typescript(catalogs, usage, firmware_catalogs):
    english = catalogs[ENGLISH_LOCALE]
    locales = [locale for locale in catalogs if locale != ENGLISH_LOCALE]

    keyed = []       # (key, English) for context keys and every plural category
    sources = []     # (key, English) for English-source lookups
    for key, value in english.items():
        base, category = split_key(key)
        if category is None and key not in usage.keys:
            sources.append((key, value))
            continue
        keyed.append((key, value))
        if category == PLURAL_CATEGORIES[ENGLISH_LOCALE][-1]:
            extra = []
            for locale in locales:
                for target in PLURAL_CATEGORIES[locale]:
                    if target not in PLURAL_CATEGORIES[ENGLISH_LOCALE] and target not in extra:
                        extra.append(target)
            for target in sorted(extra, key=KNOWN_PLURAL_CATEGORIES.index):
                keyed.append((f"{base}.{target}", value))

    rows = sources + keyed
    key_index = {key: len(sources) + offset for offset, (key, _value) in enumerate(keyed)}
    values = {}
    for locale in locales:
        translated = catalogs[locale]
        values[locale] = [
            0 if translated.get(key, source) == source else translated[key]
            for key, source in rows
        ]

    firmware_english = firmware_catalogs.get(ENGLISH_LOCALE, {})
    firmware_key = {}
    for key, value in firmware_english.items():
        firmware_key.setdefault(value, key)   # first key wins, like espcontrol_i18n()
    device_sources = sorted(literal for literal in usage.device if literal in firmware_key)
    device_values = {}
    for locale in locales:
        translated = firmware_catalogs.get(locale, {})
        device_values[locale] = [
            0 if translated.get(firmware_key[source], source) == source else translated[firmware_key[source]]
            for source in device_sources
        ]

    index_body = "".join(
        f"  {json.dumps(key)}: {index},\n" for key, index in key_index.items()
    )
    return "\n".join([
        "// =============================================================================",
        "// GENERATED WEB I18N - do not edit by hand",
        "// Generated by scripts/build.py from product/v2/translations/web.*.txt.",
        "// =============================================================================",
        f"export const WEB_I18N_LOCALES: readonly string[] = {json.dumps(locales)};",
        "",
        "// English sources. The first WEB_I18N_SOURCE_COUNT entries are looked up by their",
        "// English text; the rest are reached through WEB_I18N_KEY_INDEX only.",
        f"export const WEB_I18N_SOURCE_COUNT = {len(sources)};",
        "",
        f"export const WEB_I18N_SOURCES: readonly string[] = {_ts_array([source for _key, source in rows])};",
        "",
        "export const WEB_I18N_KEY_INDEX: Record<string, number> = "
        + ("{\n" + index_body + "}" if key_index else "{}") + ";",
        "",
        "// Index-aligned with WEB_I18N_SOURCES; 0 means identical to the English source.",
        f"export const WEB_I18N_VALUES: Record<string, readonly (string | 0)[]> = {_ts_locale_record(values)};",
        "",
        "// Firmware catalog (strings.<locale>.txt) entries referenced through i18nDevice().",
        f"export const WEB_I18N_DEVICE_SOURCES: readonly string[] = {_ts_array(device_sources)};",
        "",
        "export const WEB_I18N_DEVICE_VALUES: Record<string, readonly (string | 0)[]> = "
        + _ts_locale_record(device_values) + ";",
        "",
    ])


# ===========================================================================
# Entry point used by scripts/build.py
# ===========================================================================

@dataclass
class BuildResult:
    outputs: list        # [(Path, content)] every file this run owns, in write order
    problems: list       # strict-mode failures (warnings while generating)
    extracted: bool


def _raise(title, errors):
    raise WebI18nError(title + "\n" + "\n".join(f"  {error}" for error in errors))


def load_firmware_catalogs(strings_dir, locales, load_strings):
    catalogs = {}
    for locale in [ENGLISH_LOCALE, *locales]:
        path = strings_dir / f"strings.{locale}.txt"
        if path.exists():
            catalogs[locale] = load_strings(path)
    return catalogs


def build(root, strings_dir, source_dir, contract_path, output_path, load_strings, extract=False):
    """Validate the catalogs and return the generated TypeScript (and, with
    `extract`, the rewritten catalogs). Raises WebI18nError on fatal problems."""
    root = Path(root)
    usage = collect_usage(root, source_dir, contract_path)
    if usage.errors:
        _raise("Web i18n call sites cannot be extracted:", usage.errors)

    catalogs = load_catalogs(strings_dir, load_strings)
    outputs = []
    if extract:
        old_english = catalogs.get(ENGLISH_LOCALE, {})
        plan = plan_english_catalog(usage, old_english)
        planned = {ENGLISH_LOCALE: plan}
        for locale, old_locale in catalogs.items():
            if locale == ENGLISH_LOCALE:
                continue
            if locale not in PLURAL_CATEGORIES:
                _raise("Web i18n catalogs are invalid:", [
                    f"web.{locale}.txt: no plural categories for locale {locale!r}; "
                    "add it to PLURAL_CATEGORIES in scripts/web_i18n.py"
                ])
            planned[locale] = plan_locale_catalog(locale, plan, old_english, old_locale)
        catalogs = {locale: flatten(locale_plan) for locale, locale_plan in planned.items()}
        outputs.extend(
            (catalog_path(strings_dir, locale), render_catalog(locale, locale_plan))
            for locale, locale_plan in planned.items()
        )

    errors = validate_catalogs(catalogs, usage)
    if errors:
        _raise("Web i18n catalogs are invalid:", errors)

    locales = [locale for locale in catalogs if locale != ENGLISH_LOCALE]
    firmware_catalogs = load_firmware_catalogs(strings_dir, locales, load_strings)
    problems = coverage_problems(catalogs, usage, firmware_catalogs.get(ENGLISH_LOCALE, {}))
    outputs.append((output_path, emit_typescript(catalogs, usage, firmware_catalogs)))
    return BuildResult(outputs=outputs, problems=problems, extracted=extract)


# ===========================================================================
# Self-test (python3 scripts/build.py --self-test)
# ===========================================================================

def run_self_test():
    def check(condition, message):
        if not condition:
            raise WebI18nError(f"Web i18n self-test failed: {message}")

    source = "\n".join([
        "import { i18n, i18nKey } from \"../i18n\";",
        "// i18n(\"In a comment\") must be ignored",
        "/* i18nMark('Also a comment') */",
        "const note = \"i18n('inside a string')\";",
        "const pattern = /\"/g, other = a / b;",
        "export function i18n(source: string) { return source; }",
        "foo.i18n(\"Member call\");",
        "el.textContent = i18n(\"Save\") + \" \";",
        "el.title = i18n('Don\\'t \"panic\"', { name: x });",
        "el.alt = i18n(`Plain template`);",
        "el.hint = `${i18n(\"Inside expression\")} …`;",
        "const mark = i18nMark(\"Marked\");",
        "const ctx = i18nKey(\"open__state\", \"Open\");",
        "const many = i18nPlural(\"cards_selected\", list.filter(function (c) { return c, 1; }).length, {",
        "  one: \"{count} card selected\",",
        "  other: \"{count} cards selected\",",
        "}, { extra: 1 });",
        "const dev = i18nDevice(",
        "  \"Closed\",",
        ");",
        "const dyn = i18nDynamic(value);",
        "const escaped = i18n(\"Waiting\\u2026\");",
    ])
    usage = Usage()
    extract_from_text(source, "src/webserver/sample.ts", usage)
    check(not usage.errors, f"unexpected extraction errors {usage.errors}")
    check(list(usage.sources) == [
        "Save", "Don't \"panic\"", "Plain template", "Inside expression", "Marked", "Waiting…",
    ], f"extracted sources {list(usage.sources)}")
    check(usage.sources["Save"].line == 8, "line numbers survive comment blanking")
    check(usage.keys == {"open__state": ("Open", Site("src/webserver/sample.ts", 13))}, "context key")
    check(usage.plurals["cards_selected"][0] == {
        "one": "{count} card selected", "other": "{count} cards selected",
    }, "plural forms")
    check(list(usage.device) == ["Closed"], "device literal")

    rejected = {
        "i18n(\"Hello \" + name)": "concatenation",
        "i18n(label)": "i18nDynamic",
        "i18n(`Hi ${name}`)": "template literal",
        "i18n(ok ? \"A\" : \"B\")": "string literal",
        "i18n(\"Docs \")": "whitespace",
        "i18n(\"\")": "empty",
        "i18nKey(\"Bad Key\", \"Text\")": "[a-z0-9_]+",
        "i18nKey(key, \"Text\")": "string literal",
        "i18nPlural(\"k\", n, forms)": "object literal",
        "i18nPlural(\"k\", n, {one: \"a\", few: \"b\", other: \"c\"})": "exactly {one, other}",
        "i18nDevice(state)": "once per literal",
    }
    for snippet, expected in rejected.items():
        bad = Usage()
        extract_from_text("const x = 1;\nconst y = " + snippet + ";", "src/webserver/bad.ts", bad)
        check(len(bad.errors) == 1, f"{snippet} should be rejected once, got {bad.errors}")
        check(bad.errors[0].startswith("src/webserver/bad.ts:2: "), f"{snippet} error names file:line")
        check(expected in bad.errors[0], f"{snippet} error should mention {expected!r}: {bad.errors[0]}")

    # The compact loader uses splitlines(): CR and the other Unicode line
    # separators must never be published literally by --extract. Only LF (which
    # has a compact escape) and an internal tab are supported control characters.
    unsupported_codepoints = [
        *range(0x00, 0x09), *range(0x0B, 0x20), *range(0x7F, 0xA0), 0x2028, 0x2029,
    ]
    for codepoint in unsupported_codepoints:
        value = f"Before{chr(codepoint)}after"
        bad = Usage()
        extract_from_text(f"i18n({json.dumps(value)})", "src/webserver/bad.ts", bad)
        check(any("unsupported control or line separator" in error for error in bad.errors),
              f"source U+{codepoint:04X} must be rejected before extraction: {bad.errors}")
        errors = validate_catalogs({"en": {"label": "Before after"}, "pl": {"label": value}}, Usage())
        check(any("unsupported control or line separator" in error for error in errors),
              f"catalog U+{codepoint:04X} must be rejected before generation: {errors}")

    escaped_value = "Line one\nLine two\\tail\tend=ok"
    escaped_usage = Usage()
    extract_from_text(f"i18n({json.dumps(escaped_value)})", "sample.ts", escaped_usage)
    check(not escaped_usage.errors and list(escaped_usage.sources) == [escaped_value],
          "supported source escapes survive extraction")
    escaped_catalog = render_catalog("en", [("sample.ts", [("escaped", escaped_value)])])
    check(escaped_catalog.splitlines()[-1] == r"escaped=Line one\nLine two\\tail" + "\tend=ok",
          "LF, backslash, tab and equals render as one intact compact catalog row")

    check(slugify("Buy me a coffee") == "buy_me_a_coffee", "slug")
    check(slugify("e.g. {example}") == "e_g_example", "slug placeholders")
    check(slugify("…") == "text", "slug fallback")
    check(len(slugify("x" * 100)) == MAX_KEY_LENGTH, "slug length")
    check(_unique_key("open", {"open", "open_2"}) == "open_3", "slug collision suffix")

    usage.contract_labels = {"Timer": Site(CONTRACT_GROUP, 0), "Save": Site(CONTRACT_GROUP, 0)}
    old_english = {
        "save_button": "Save", "stale": "Stale", "marked": "Old",
        "cards_selected.one": "{count} card", "cards_selected.other": "{count} cards selected",
    }
    old_polish = {
        "save_button": "Zapisz", "stale": "Stare", "marked": "Stary",
        "cards_selected.one": "{count} karta", "cards_selected.few": "{count} karty",
        "cards_selected.many": "{count} kart", "cards_selected.other": "{count} karty",
    }
    plan = plan_english_catalog(usage, old_english)
    english = flatten(plan)
    check(english["save_button"] == "Save", "extract keeps an existing key")
    check("stale" not in english, "extract drops unused entries")
    check(english["open__state"] == "Open" and english["timer"] == "Timer", "extract adds context keys and labels")
    check(english["marked"] == "Marked", "extract may reuse a freed slug")
    check([name for name, _rows in plan] == ["src/webserver/sample.ts", CONTRACT_GROUP], "extract groups")
    polish = flatten(plan_locale_catalog("pl", plan, old_english, old_polish))
    check(polish["save_button"] == "Zapisz", "extract keeps translations")
    check(polish["marked"] == "Marked", "extract resets a translation whose English changed")
    check(polish["cards_selected.one"] == "{count} card selected", "changed plural English resets the form")
    check(polish["cards_selected.few"] == "{count} karty", "unchanged plural reference keeps the form")
    check([key for key in polish if key.startswith("cards_selected.")] == [
        "cards_selected.one", "cards_selected.few", "cards_selected.many", "cards_selected.other",
    ], "extract writes every plural category of the locale")
    rendered = render_catalog("pl", plan_locale_catalog("pl", plan, old_english, old_polish))
    check(rendered == render_catalog("pl", plan_locale_catalog("pl", plan, english, polish)), "extract is idempotent")

    catalogs = {"en": english, "pl": polish}
    check(validate_catalogs(catalogs, usage) == [], f"valid catalogs {validate_catalogs(catalogs, usage)}")
    check(coverage_problems(catalogs, usage, {"closed": "Closed"}) == [], "complete coverage")
    check(any("i18nDevice('Closed')" in problem for problem in coverage_problems(catalogs, usage, {})),
          "unknown device literal is reported")

    def invalid(mutate, expected):
        broken = {"en": dict(english), "pl": dict(polish)}
        mutate(broken)
        errors = validate_catalogs(broken, usage)
        check(any(expected in error for error in errors), f"expected {expected!r} in {errors}")

    def replace_plural_with_plain(c):
        for key in list(c["pl"]):
            if key.startswith("cards_selected."):
                del c["pl"][key]
        c["pl"]["cards_selected"] = "Wybrano {count} kart"

    def replace_plain_with_plural(c):
        del c["pl"]["save_button"]
        for category in ("one", "few", "many", "other"):
            c["pl"][f"save_button.{category}"] = "Zapisz"

    # Matching bases are not enough: the emitter looks up exact keys, so either
    # shape substitution would silently emit English fallbacks for the family.
    invalid(replace_plural_with_plain, "keys do not match")
    invalid(replace_plain_with_plural, "keys do not match")
    invalid(lambda c: c["pl"].pop("save_button"), "keys do not match")
    invalid(lambda c: c["pl"].pop("cards_selected.many"), "is missing many")
    invalid(lambda c: c["pl"].update({"cards_selected.other": "karty"}), "placeholders")
    invalid(lambda c: c["en"].update({"save_2": "Save"}), "share the English value")
    invalid(lambda c: c["en"].update({"cards_selected.few": "x"}), "does not have")
    invalid(lambda c: c["pl"].update({"timer": "Minutnik "}), "whitespace")
    invalid(lambda c: c.update({"xx": dict(c["en"])}), "PLURAL_CATEGORIES")
    one_without_count = {"en": dict(english), "pl": dict(polish, **{"cards_selected.one": "jedna karta"})}
    check(validate_catalogs(one_without_count, usage) == [], "plural 'one' may omit {count}")

    missing = dict(english)
    missing.pop("timer")
    missing["unused"] = "Unused"
    problems = coverage_problems({"en": missing, "pl": polish}, usage, {"closed": "Closed"})
    check(any("'Timer' is not in web.en.txt" in problem for problem in problems), "missing label is reported")
    check(any("'unused' is unused" in problem for problem in problems), "unused entry is reported")

    firmware = {"en": {"open": "Open", "state_open": "Open", "closed": "Closed"},
                "pl": {"open": "Otwórz", "state_open": "Otwarte", "closed": "Zamknięte"}}
    polish["save_button"] = "Save"
    emitted = emit_typescript({"en": english, "pl": polish}, usage, firmware)
    check(emitted.startswith("// ====") and "GENERATED WEB I18N" in emitted, "generated banner")
    check("export const WEB_I18N_LOCALES: readonly string[] = [\"pl\"];" in emitted, "emitted locales")
    source_count = len([key for key in english if "." not in key and key not in usage.keys])
    check(f"WEB_I18N_SOURCE_COUNT = {source_count};" in emitted, "emitted source count")
    check(f"\"open__state\": {source_count}," in emitted, "context keys are indexed after the sources")
    check("\"cards_selected.few\":" in emitted and "\"cards_selected.many\":" in emitted,
          "locale-only plural categories are indexed")
    check("\"Zamknięte\"" in emitted and "Otw" not in emitted, "device table is restricted to referenced sources")
    check(emitted.count("\n    0,\n") >= 1, "values identical to English are emitted as 0")
