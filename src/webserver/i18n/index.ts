// Web configurator i18n runtime.
//
// The locale is fixed for the lifetime of the page: it is resolved once, when
// this module is evaluated, so i18n() is safe everywhere, including module-scope
// tables. English is the identity: call sites carry the English text and the
// generated tables are only read for other locales, with English as the fallback.
//
// This module must stay free of application imports: every consumer imports it,
// and the locale has to be settled before any of them evaluates.
import {
  WEB_I18N_DEVICE_SOURCES,
  WEB_I18N_DEVICE_VALUES,
  WEB_I18N_KEY_INDEX,
  WEB_I18N_LOCALES,
  WEB_I18N_SOURCE_COUNT,
  WEB_I18N_SOURCES,
  WEB_I18N_VALUES,
} from "../generated/i18n";

export type I18nParams = Record<string, string | number>;

export interface I18nPluralForms {
  one: string;
  other: string;
}

/** The generated tables, replaceable through setWebLocaleForTests(). */
export interface WebI18nTables {
  locales: readonly string[];
  sourceCount: number;
  sources: readonly string[];
  keyIndex: Record<string, number>;
  values: Record<string, readonly (string | 0)[]>;
  deviceSources: readonly string[];
  deviceValues: Record<string, readonly (string | 0)[]>;
}

const DEFAULT_LOCALE = "en";
const LOCALE_STORAGE_KEY = "espcontrol.web.locale";
const LOCALE_URL_PARAM = "espcontrol_lang";
const RELOAD_GUARD_KEY = "espcontrol.web.locale.reload";
const RELOAD_DEBOUNCE_MS = 400;
// A blocked reload (backup import, config lock) is retried for about two minutes.
const RELOAD_MAX_BLOCKED_CHECKS = 300;

const GENERATED_TABLES: WebI18nTables = {
  locales: WEB_I18N_LOCALES,
  sourceCount: WEB_I18N_SOURCE_COUNT,
  sources: WEB_I18N_SOURCES,
  keyIndex: WEB_I18N_KEY_INDEX,
  values: WEB_I18N_VALUES,
  deviceSources: WEB_I18N_DEVICE_SOURCES,
  deviceValues: WEB_I18N_DEVICE_VALUES,
};

let tables: WebI18nTables = GENERATED_TABLES;
let sourceIndex: Map<string, number> | null = null;
let deviceIndex: Map<string, number> | null = null;
let pluralRules: Intl.PluralRules | null | undefined;
let pendingLocale = "";
let pendingGuard: (() => boolean) | undefined;
let pendingTimer: ReturnType<typeof setTimeout> | null = null;
let blockedChecks = 0;
let activeLocale = initialWebLocale();

// ── Locale ───────────────────────────────────────────────────────────────

function normalizeLocale(value: unknown): string {
  return String(value == null ? "" : value).trim().toLowerCase();
}

function hasOwn(record: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function webStorage(kind: "local" | "session"): Storage | null {
  try {
    if (kind === "local") return typeof localStorage === "undefined" ? null : localStorage;
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch (_) {
    return null;
  }
}

function readStorage(kind: "local" | "session", key: string): string {
  try {
    const storage = webStorage(kind);
    return storage ? normalizeLocale(storage.getItem(key)) : "";
  } catch (_) {
    return "";
  }
}

function writeStorage(kind: "local" | "session", key: string, value: string): boolean {
  try {
    const storage = webStorage(kind);
    if (!storage) return false;
    if (value) storage.setItem(key, value);
    else storage.removeItem(key);
    return value ? storage.getItem(key) === value : true;
  } catch (_) {
    return false;
  }
}

function localeFromUrl(): string {
  try {
    if (typeof location === "undefined" || typeof URL === "undefined" || !location.href) return "";
    const url = new URL(location.href);
    if (!url.searchParams.has(LOCALE_URL_PARAM)) return "";
    const requested = normalizeLocale(url.searchParams.get(LOCALE_URL_PARAM));
    url.searchParams.delete(LOCALE_URL_PARAM);
    try {
      if (typeof history !== "undefined" && typeof history.replaceState === "function")
        history.replaceState(null, "", url.pathname + url.search + url.hash);
    } catch (_) { /* the parameter stays visible; the locale still applies */ }
    return requested;
  } catch (_) {
    return "";
  }
}

function initialWebLocale(): string {
  const fromUrl = localeFromUrl();
  if (fromUrl) return resolveWebLocale(fromUrl);
  return resolveWebLocale(readStorage("local", LOCALE_STORAGE_KEY));
}

/** The active locale. It never changes after the page has loaded. */
export function webLocale(): string {
  return activeLocale;
}

/** The web locale for a device language: itself when it has a web catalog, else "en". */
export function resolveWebLocale(deviceLanguage: string): string {
  const locale = normalizeLocale(deviceLanguage);
  return tables.locales.indexOf(locale) === -1 ? DEFAULT_LOCALE : locale;
}

// ── Lookup ───────────────────────────────────────────────────────────────

function interpolate(text: string, params?: I18nParams): string {
  if (!params || typeof text !== "string") return text;
  return text.replace(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g, function (token: string, name: string) {
    return hasOwn(params, name) ? String(params[name]) : token;
  });
}

function indexOfSources(sources: readonly string[], count: number): Map<string, number> {
  const index = new Map<string, number>();
  for (let i = 0; i < count && i < sources.length; i++) {
    const source = sources[i];
    if (source !== undefined && !index.has(source)) index.set(source, i);
  }
  return index;
}

function translatedAt(values: readonly (string | 0)[] | undefined, index: number | undefined, english: string): string {
  if (!values || index === undefined) return english;
  const value = values[index];
  return typeof value === "string" && value ? value : english;
}

function translateSource(source: string): string {
  if (activeLocale === DEFAULT_LOCALE) return source;
  if (!sourceIndex) sourceIndex = indexOfSources(tables.sources, tables.sourceCount);
  return translatedAt(tables.values[activeLocale], sourceIndex.get(source), source);
}

function keyedIndex(key: string): number | undefined {
  return hasOwn(tables.keyIndex, key) ? tables.keyIndex[key] : undefined;
}

/** Translates an English literal. The argument must be a literal so the generator can extract it. */
export function i18n(source: string, params?: I18nParams): string {
  return interpolate(translateSource(source), params);
}

/** Same lookup as i18n() for values only known at run time; never extracted, misses stay English. */
export function i18nDynamic(source: string, params?: I18nParams): string {
  return interpolate(translateSource(source), params);
}

/** Marks a literal for extraction without translating it (gettext N_()); translate later with i18nDynamic(). */
export function i18nMark<T extends string>(source: T): T {
  return source;
}

/** Looks up a context key for English words that need different translations by role. */
export function i18nKey(key: string, english: string, params?: I18nParams): string {
  if (activeLocale === DEFAULT_LOCALE) return interpolate(english, params);
  return interpolate(translatedAt(tables.values[activeLocale], keyedIndex(key), english), params);
}

// CLDR rules for Polish, used when Intl.PluralRules is missing or has no Polish data.
function polishPluralCategory(count: number): string {
  const n = Math.abs(count);
  if (n !== Math.floor(n)) return "other";
  if (n === 1) return "one";
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "few";
  return "many";
}

function pluralCategory(count: number): string {
  if (pluralRules === undefined) {
    pluralRules = null;
    try {
      if (typeof Intl !== "undefined" && typeof Intl.PluralRules === "function"
          && Intl.PluralRules.supportedLocalesOf([activeLocale]).length)
        pluralRules = new Intl.PluralRules(activeLocale);
    } catch (_) {
      pluralRules = null;
    }
  }
  if (pluralRules) return pluralRules.select(count);
  if (activeLocale === "pl") return polishPluralCategory(count);
  return count === 1 ? "one" : "other";
}

function localizedCount(count: number): string {
  try {
    if (typeof Intl !== "undefined" && typeof Intl.NumberFormat === "function")
      return new Intl.NumberFormat(activeLocale).format(count);
  } catch (_) { /* fall through */ }
  return String(count);
}

/**
 * Picks the plural form for `count` and injects it as {count}. The English forms
 * are inline; other locales read `<key>.<category>` and fall back to `<key>.other`,
 * then to English.
 */
export function i18nPlural(key: string, count: number, english: I18nPluralForms, params?: I18nParams): string {
  const englishForm = count === 1 ? english.one : english.other;
  if (activeLocale === DEFAULT_LOCALE)
    return interpolate(englishForm, { count: String(count), ...params });
  const values = tables.values[activeLocale];
  let index = keyedIndex(key + "." + pluralCategory(count));
  if (index === undefined) index = keyedIndex(key + ".other");
  return interpolate(translatedAt(values, index, englishForm), { count: localizedCount(count), ...params });
}

/** Translates emulated panel text from the firmware catalog, so the preview matches the device. */
export function i18nDevice(source: string): string {
  if (activeLocale === DEFAULT_LOCALE) return source;
  if (!deviceIndex) deviceIndex = indexOfSources(tables.deviceSources, tables.deviceSources.length);
  return translatedAt(tables.deviceValues[activeLocale], deviceIndex.get(source), source);
}

// ── Following the device language ────────────────────────────────────────

function clearPendingReload(): void {
  if (pendingTimer !== null) clearTimeout(pendingTimer);
  pendingTimer = null;
  pendingLocale = "";
  pendingGuard = undefined;
  blockedChecks = 0;
}

function canReloadPage(): boolean {
  try {
    return typeof location !== "undefined" && typeof location.reload === "function"
      && typeof setTimeout === "function";
  } catch (_) {
    return false;
  }
}

function scheduleReloadCheck(): void {
  if (pendingTimer !== null) clearTimeout(pendingTimer);
  pendingTimer = setTimeout(runReloadCheck, RELOAD_DEBOUNCE_MS);
}

function runReloadCheck(): void {
  pendingTimer = null;
  const target = pendingLocale;
  if (!target || target === activeLocale) {
    clearPendingReload();
    return;
  }
  let allowed = true;
  try {
    allowed = !pendingGuard || pendingGuard() !== false;
  } catch (_) {
    allowed = false;
  }
  if (!allowed) {
    blockedChecks++;
    if (blockedChecks >= RELOAD_MAX_BLOCKED_CHECKS) clearPendingReload();
    else scheduleReloadCheck();
    return;
  }
  clearPendingReload();
  reloadInto(target);
}

function reloadInto(target: string): void {
  // One reload per target: if the page still comes back in another locale, stop.
  if (readStorage("session", RELOAD_GUARD_KEY) === target) return;
  const guarded = writeStorage("session", RELOAD_GUARD_KEY, target);
  const persisted = writeStorage("local", LOCALE_STORAGE_KEY, target);
  try {
    if (persisted && guarded) {
      location.reload();
      return;
    }
    // Without storage the locale travels in the URL; initialWebLocale() strips it again.
    if (typeof location.replace !== "function" || typeof URL === "undefined") return;
    const url = new URL(location.href);
    url.searchParams.set(LOCALE_URL_PARAM, target);
    location.replace(url.href);
  } catch (_) { /* stay on the current page in the current locale */ }
}

/**
 * Follows the device language. The locale hint is stored at once, so the next page
 * load starts in the right language; when the page itself is in another locale it
 * reloads once, debounced. `guard` must return true when reloading is safe; while it
 * returns false (backup import, config lock) the reload waits and is retried.
 */
export function requestWebLocale(deviceLanguage: string, guard?: () => boolean): void {
  const target = resolveWebLocale(deviceLanguage);
  writeStorage("local", LOCALE_STORAGE_KEY, target);
  if (target === activeLocale) {
    clearPendingReload();
    writeStorage("session", RELOAD_GUARD_KEY, "");
    return;
  }
  if (!canReloadPage()) return;
  pendingLocale = target;
  pendingGuard = guard;
  blockedChecks = 0;
  scheduleReloadCheck();
}

/** Test seam: switches the locale in place and optionally swaps the generated tables. */
export function setWebLocaleForTests(locale: string, testTables?: WebI18nTables): void {
  clearPendingReload();
  tables = testTables || GENERATED_TABLES;
  sourceIndex = null;
  deviceIndex = null;
  pluralRules = undefined;
  activeLocale = resolveWebLocale(locale);
}
