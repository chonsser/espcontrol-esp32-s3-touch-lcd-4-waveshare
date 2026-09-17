import { i18n, i18nKey, webLocale } from "../i18n";

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface Rect {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

export interface PositionedRect extends Rect {
  readonly pos: number;
}

export interface MenuPosition {
  readonly x: number;
  readonly y: number;
}

export interface CardTypeDefinition {
  readonly key?: string;
  readonly label?: string | (() => string);
  readonly pickerKey?: string | null | (() => string | null);
  readonly allowInSubpage?: boolean | (() => boolean);
  readonly isAvailable?: ((context: { isSub: boolean }) => boolean) | null;
}

export interface CardPickerOption {
  readonly key: string;
  readonly label: string;
  readonly icon: string;
  readonly description: string;
  readonly disabled: boolean;
}

interface PickerDetails {
  readonly icon: string;
  readonly description: string;
}

const INFO_ONLY_CARD_TYPES = new Set([
  "sensor",
  "calendar",
  "clock",
  "door_window",
  "image",
  "local_sensor",
  "presence",
  "timezone",
  "weather",
  "weather_forecast",
]);

const CARD_TYPE_PICKER_DETAILS: Readonly<Record<string, PickerDetails>> = {
  "": { icon: "toggle-switch", description: i18n("Toggle lights, switches, helpers, or fans.") },
  action: { icon: "flash", description: i18n("Run a Home Assistant or local action.") },
  alarm: { icon: "shield-home", description: i18n("Control or trigger alarm panel actions.") },
  calendar: { icon: "calendar-clock", description: i18n("Show date, time, or world clock values.") },
  climate: { icon: "thermostat", description: i18n("Show climate status and temperature controls.") },
  cover: { icon: "window-shutter", description: i18n("Control blinds, curtains, or covers.") },
  door_window: { icon: "door-open", description: i18n("Show open or closed sensor state.") },
  presence: { icon: "account", description: i18n("Show person or presence status.") },
  fan_speed: { icon: "fan", description: i18n("Control fan speed, mode, or direction.") },
  garage: { icon: "garage", description: i18n("Show and control a garage door.") },
  gate: { icon: "gate", description: i18n("Show and control a gate.") },
  image: { icon: "image", description: i18n("Display an image card where supported.") },
  wifi_qr: { icon: "wifi", description: i18n("Share a Wifi network using a Connect Card or QR Card.") },
  internal: { icon: "power-plug", description: i18n("Control built-in device relays.") },
  light_brightness: { icon: "lightbulb", description: i18n("Configure light switch, brightness, or temperature controls.") },
  lawn_mower: { icon: "robot-mower", description: i18n("Show or control a robotic lawn mower.") },
  local_sensor: { icon: "gauge", description: i18n("Show a sensor value from this device.") },
  lock: { icon: "lock", description: i18n("Show and control a lock.") },
  media: { icon: "speaker", description: i18n("Control media playback or volume.") },
  media_control: { icon: "music", description: i18n("Open all media controls and volume in a modal.") },
  push: { icon: "gesture-tap-button", description: i18n("Fire a momentary button event.") },
  sensor: { icon: "gauge", description: i18n("Display sensor values or states.") },
  slider: { icon: "tune-vertical", description: i18n("Adjust a numeric or brightness value.") },
  subpage: { icon: "view-grid-plus", description: i18n("Open a nested page of cards.") },
  webhook: { icon: "webhook", description: i18n("Send a direct HTTP request.") },
  vacuum: { icon: "robot-vacuum", description: i18n("Show or control a vacuum cleaner.") },
  weather: { icon: "weather-partly-cloudy", description: i18n("Show weather or forecast data.") },
};

const CARD_TYPE_PICKER_DEFAULTS: Readonly<Record<string, string>> = {
  climate: "climate_control",
  light_brightness: "light_control",
  media_control: "media",
};

export function previewValue<T>(preview: Record<string, unknown> | null | undefined, key: string, fallback: T): T {
  return preview && Object.prototype.hasOwnProperty.call(preview, key) ? preview[key] as T : fallback;
}

export function registryValue<T>(definition: Record<string, unknown> | null | undefined, key: string, fallback: T): T {
  if (!definition || !Object.prototype.hasOwnProperty.call(definition, key)) return fallback;
  const candidate = definition[key];
  const value = typeof candidate === "function" ? (candidate as () => unknown)() : candidate;
  return value == null ? fallback : value as T;
}

export function buttonConfigDisabledForDevice(
  definitions: Readonly<Record<string, CardTypeDefinition>>,
  disabledCardTypes: readonly string[],
  button: { readonly type?: string | null } | null | undefined,
): boolean {
  const type = button?.type || "";
  if (disabledCardTypes.includes(type)) return true;
  const definition = definitions[type] as Record<string, unknown> | undefined;
  const pickerKey = registryValue(definition, "pickerKey", "");
  return !!pickerKey && disabledCardTypes.includes(pickerKey);
}

export function infoOnlyCardVisible(key: string, infoOnly: boolean): boolean {
  return !infoOnly || INFO_ONLY_CARD_TYPES.has(key || "");
}

export function defaultCardTypeForPicker(key: string): string {
  return CARD_TYPE_PICKER_DEFAULTS[key] || key;
}

export function cardTypePickerDetails(key: string, label: string): PickerDetails {
  return CARD_TYPE_PICKER_DETAILS[key || ""] || {
    icon: "card-outline",
    description: label ? i18n("Configure a {label} card.", { label }) : i18n("Configure a card."),
  };
}

export function cardTypePickerOptions(
  definitions: Readonly<Record<string, CardTypeDefinition>>,
  disabledCardTypes: readonly string[],
  infoOnly: boolean,
  isSub: boolean,
  selectedTypeKey: string | null | undefined,
): CardPickerOption[] {
  const options: CardPickerOption[] = [];
  let selectedUnsupported: { key: string; label: string } | null = null;
  const hasSelectedType = selectedTypeKey !== null && selectedTypeKey !== undefined;
  for (const [typeKey, definition] of Object.entries(definitions)) {
    const rawDefinition = definition as Record<string, unknown>;
    const pickerKey = registryValue(rawDefinition, "pickerKey", "");
    const allowInSubpage = !!registryValue(rawDefinition, "allowInSubpage", false);
    const label = registryValue(rawDefinition, "label", definition.key || i18nKey("toggle__card_type", "Toggle"));
    if (disabledCardTypes.includes(typeKey) || disabledCardTypes.includes(pickerKey)) continue;
    if (!infoOnlyCardVisible(typeKey, infoOnly) || (pickerKey && !infoOnlyCardVisible(pickerKey, infoOnly))) {
      if (hasSelectedType && (selectedTypeKey === typeKey || (pickerKey && selectedTypeKey === pickerKey))) {
        selectedUnsupported = { key: selectedTypeKey, label };
      }
      continue;
    }
    if (pickerKey && pickerKey !== typeKey) continue;
    if (isSub && !allowInSubpage) continue;
    if (definition.isAvailable && !definition.isAvailable({ isSub }) && selectedTypeKey !== typeKey) continue;
    options.push({ key: typeKey, label, disabled: false, ...cardTypePickerDetails(typeKey, label) });
  }
  if (selectedUnsupported) {
    const label = i18n("{label} (not available)", { label: selectedUnsupported.label });
    options.push({
      key: selectedUnsupported.key,
      label,
      disabled: true,
      ...cardTypePickerDetails(selectedUnsupported.key, label),
    });
  }
  return options.sort((a, b) => a.label.localeCompare(b.label, webLocale()));
}

export function closestGridCell(point: Point, cells: readonly PositionedRect[]): number {
  let bestDistance = Number.POSITIVE_INFINITY;
  let bestPosition = -1;
  for (const cell of cells) {
    if (point.x >= cell.left && point.x <= cell.right && point.y >= cell.top && point.y <= cell.bottom) {
      return cell.pos;
    }
    const centerX = (cell.left + cell.right) / 2;
    const centerY = (cell.top + cell.bottom) / 2;
    const distance = (point.x - centerX) ** 2 + (point.y - centerY) ** 2;
    if (distance < bestDistance) {
      bestDistance = distance;
      bestPosition = cell.pos;
    }
  }
  return bestPosition;
}

export function swapGridCell(
  point: Point,
  container: Rect,
  gridCols: number,
  gridRows: number,
): number {
  const width = Math.max(1, container.right - container.left);
  const height = Math.max(1, container.bottom - container.top);
  const column = Math.max(0, Math.min(Math.floor((point.x - container.left) / (width / gridCols)), gridCols - 1));
  const row = Math.max(0, Math.min(Math.floor((point.y - container.top) / (height / gridRows)), gridRows - 1));
  return row * gridCols + column;
}

export function clampMenuPosition(
  point: Point,
  menuWidth: number,
  menuHeight: number,
  viewportWidth: number,
  viewportHeight: number,
  margin = 4,
): MenuPosition {
  return {
    x: Math.max(margin, Math.min(point.x, viewportWidth - menuWidth - margin)),
    y: Math.max(margin, Math.min(point.y, viewportHeight - menuHeight - margin)),
  };
}
