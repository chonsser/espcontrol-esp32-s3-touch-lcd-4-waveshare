import type { CardConfig } from "../contracts/types";
import { encodeConfigField } from "./config_primitives";
import { serializeGridOrder, type SlotSizeMap } from "./grid";

export const STANDALONE_SCREEN_PREFIX = "@screen:";

export type StandaloneScreenNameError = "required" | "too-long" | "control-character" | null;

export interface StandaloneScreenEnvelope {
  readonly screenLabel: string;
  readonly payload: string;
}

export interface StandaloneSubpageMetadata {
  readonly standalone?: boolean;
  readonly screenLabel?: string;
  readonly standaloneInvalid?: boolean;
  readonly rawConfig?: string;
}

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

export function standaloneScreenNameError(value: unknown): StandaloneScreenNameError {
  const label = String(value ?? "");
  if (!label.trim()) return "required";
  if (/[\u0000-\u001f\u007f-\u009f]/.test(label)) return "control-character";
  if (utf8ByteLength(label) > 64) return "too-long";
  return null;
}

function decodeStandaloneScreenLabel(value: string): string | null {
  if (/%(?![0-9a-fA-F]{2})/.test(value)) return null;
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

export function parseStandaloneScreenEnvelope(value: unknown): StandaloneScreenEnvelope | null {
  const raw = String(value ?? "");
  if (!raw.startsWith(STANDALONE_SCREEN_PREFIX)) return null;
  const separator = raw.indexOf("\n", STANDALONE_SCREEN_PREFIX.length);
  if (separator < 0) return null;
  const label = decodeStandaloneScreenLabel(raw.substring(STANDALONE_SCREEN_PREFIX.length, separator));
  if (label == null || standaloneScreenNameError(label)) return null;
  return { screenLabel: label, payload: raw.substring(separator + 1) };
}

export function wrapStandaloneScreenConfig(screenLabel: string, payload: string): string {
  const error = standaloneScreenNameError(screenLabel);
  if (error) throw new Error(`Invalid standalone screen name: ${error}`);
  return STANDALONE_SCREEN_PREFIX + encodeConfigField(screenLabel) + "\n" + String(payload || "");
}

export function isStandaloneSubpage(value: unknown): value is StandaloneSubpageMetadata & { standalone: true } {
  return !!value && typeof value === "object" &&
    (value as StandaloneSubpageMetadata).standalone === true;
}

export function isQuarantinedStandaloneSubpage(
  value: unknown,
): value is StandaloneSubpageMetadata & { standaloneInvalid: true; rawConfig: string } {
  return !!value && typeof value === "object" &&
    (value as StandaloneSubpageMetadata).standaloneInvalid === true &&
    typeof (value as StandaloneSubpageMetadata).rawConfig === "string";
}

export function isProtectedSubpageStorage(value: unknown): boolean {
  return isStandaloneSubpage(value) || isQuarantinedStandaloneSubpage(value);
}

export function hasStandaloneScreens(subpages: Readonly<Record<string, unknown>>): boolean {
  return Object.values(subpages).some((value) =>
    typeof value === "string"
      ? parseStandaloneScreenEnvelope(value) !== null
      : isStandaloneSubpage(value));
}

export function serializeHomeGridOrder(
  grid: readonly number[],
  sizes: SlotSizeMap,
  subpages: Readonly<Record<string, unknown>>,
): string {
  const order = serializeGridOrder(grid, sizes);
  return order || (hasStandaloneScreens(subpages) ? "0" : "");
}

/** Finds storage using the complete parsed subpage document and current home cards. */
export function firstFreeStandaloneScreenSlot(
  subpages: Readonly<Record<string, unknown>>,
  buttons: readonly Partial<CardConfig>[],
  maxSlots: number,
  preferredSlot?: number,
): number | null {
  const free = (slot: number): boolean =>
    !subpages[String(slot)] && buttons[slot - 1]?.type !== "subpage";
  if (preferredSlot && preferredSlot >= 1 && preferredSlot <= maxSlots && free(preferredSlot)) {
    return preferredSlot;
  }
  for (let slot = 1; slot <= maxSlots; slot += 1) {
    if (free(slot)) return slot;
  }
  return null;
}
