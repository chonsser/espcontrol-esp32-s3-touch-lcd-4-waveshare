import { i18n } from "../i18n";

export interface ScreenNavigationRule { target: number; state: string }
export interface ScreenNavigationSettings { entity: string; rules: string; wake: boolean }
export const SCREEN_NAVIGATION_ENTITY_LIMIT = 100;
export const SCREEN_NAVIGATION_RULES_LIMIT = 255;
const allTargets = Array.from({ length: 33 }, (_, index) => index);
const utf8Length = (value: string): number => new TextEncoder().encode(value).length;

export function validateScreenNavigationEntity(value: string): string {
  const entity = value.trim();
  if (utf8Length(entity) > SCREEN_NAVIGATION_ENTITY_LIMIT) {
    throw new Error(i18n("The entity name is too long. Use a shorter entity ID."));
  }
  if (entity && !/^[a-z_]+\.[a-z0-9_]+$/.test(entity)) {
    throw new Error(i18n("Enter a valid Home Assistant entity ID, such as input_select.screen."));
  }
  return entity;
}

function validateRules(rows: readonly ScreenNavigationRule[], targets: readonly number[]): void {
  const states = new Set<string>();
  for (const row of rows) {
    if (!row.state.trim() || row.state === "unknown" || row.state === "unavailable") {
      throw new Error(i18n("Enter a state value other than unknown or unavailable."));
    }
    if (states.has(row.state)) throw new Error(i18n("Each state value can only be mapped once."));
    states.add(row.state);
    if (!Number.isInteger(row.target) || row.target < 0 || row.target > 32 || !targets.includes(row.target)) {
      throw new Error(i18n("Choose the home screen or an existing subpage for every mapping."));
    }
  }
}

export function serializeScreenNavigationRules(rows: readonly ScreenNavigationRule[], targets: readonly number[] = allTargets): string {
  validateRules(rows, targets);
  const rules = rows.map(({ target, state }) => `${target}\t${state.replace(/[%\t\n\r]/g, char => ({ "%": "%25", "\t": "%09", "\n": "%0A", "\r": "%0D" })[char]!)}`).join("\n");
  if (utf8Length(rules) > SCREEN_NAVIGATION_RULES_LIMIT) {
    throw new Error(i18n("The screen mappings are too long. Shorten the values or remove a mapping."));
  }
  return rules;
}

export function parseScreenNavigationRules(rules: string, targets: readonly number[] = allTargets): ScreenNavigationRule[] {
  if (!rules) return [];
  const invalid = () => new Error(i18n("The saved screen mappings are invalid. Remove or correct them before saving."));
  const rows = rules.split("\n").map(line => {
    const match = /^(0|[1-9][0-9]*)\t([^\t\r]*)$/.exec(line);
    if (!match || /%(?!25|09|0A|0D)/.test(match[2]!)) throw invalid();
    const state = match[2]!.replace(/%(25|09|0A|0D)/g, (_, code: string) => ({ "25": "%", "09": "\t", "0A": "\n", "0D": "\r" })[code]!);
    return { target: Number(match[1]), state };
  });
  serializeScreenNavigationRules(rows, targets);
  return rows;
}

export function screenNavigationSettingsFromBackup(settings: Record<string, unknown>): ScreenNavigationSettings {
  const entity = validateScreenNavigationEntity(String(settings.screen_navigation_entity || ""));
  const rules = String(settings.screen_navigation_rules || "");
  parseScreenNavigationRules(rules);
  return { entity, rules, wake: settings.screen_navigation_wake !== false };
}

export function screenNavigationBackupSettings(settings: ScreenNavigationSettings): Record<string, unknown> {
  return { screen_navigation_entity: settings.entity, screen_navigation_rules: settings.rules, screen_navigation_wake: settings.wake };
}
