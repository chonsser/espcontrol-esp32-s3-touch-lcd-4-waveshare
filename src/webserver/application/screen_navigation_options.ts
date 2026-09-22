import type { DeviceApi } from "../api/device_api";

export type ScreenOptionsStatus = "idle" | "loading" | "ready" | "unavailable" | "unsupported" | "error";
export interface ScreenOptions { entity_id: string; status: ScreenOptionsStatus; options: string[] }

/** Metadata only: changing the source never writes panel settings or calls HA actions. */
export function createScreenOptionsDiscovery(api: Pick<DeviceApi, "getJson">, changed: () => void) {
  let current: ScreenOptions = { entity_id: "", status: "idle", options: [] };
  let generation = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const publish = (value: ScreenOptions) => { current = value; changed(); };
  async function request(entity: string, token: number, attempt: number): Promise<void> {
    let deadline: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        api.getJson<ScreenOptions>("/api/v1/screen-navigation/options?entity_id=" + encodeURIComponent(entity)),
        new Promise<never>((_, reject) => { deadline = setTimeout(() => reject(new Error("Discovery timeout")), 8000); }),
      ]);
      if (token !== generation) return;
      if (!result.ok) { publish({ entity_id: entity, status: result.status === 404 ? "unsupported" : "error", options: [] }); return; }
      const value = result.value;
      if (value.entity_id !== entity || !["loading", "ready", "unavailable", "unsupported", "error"].includes(value.status) || !Array.isArray(value.options) || value.options.length > 64 || value.options.some(option => typeof option !== "string" || new TextEncoder().encode(option).length > 255)) throw new Error("Invalid options response");
      if (value.status === "loading" && attempt < 12) {
        publish({ entity_id: entity, status: "loading", options: [] });
        timer = setTimeout(() => { void request(entity, token, attempt + 1); }, 1000);
      } else publish({ entity_id: entity, status: value.status === "loading" ? "unavailable" : value.status, options: value.status === "ready" ? [...new Set(value.options)] : [] });
    } catch { if (token === generation) publish({ entity_id: entity, status: "error", options: [] }); }
    finally { clearTimeout(deadline); }
  }
  function setEntity(entity: string, retry = false) {
    if (!retry && current.entity_id === entity) return;
    const token = ++generation;
    clearTimeout(timer);
    let status: ScreenOptionsStatus = "loading";
    if (!entity) status = "idle";
    else if (entity.length > 100 || !/^[a-z_]+\.[a-z0-9_]+$/.test(entity)) status = "unsupported";
    publish({ entity_id: entity, status, options: [] });
    if (status === "loading") timer = setTimeout(() => { void request(entity, token, 0); }, retry ? 0 : 400);
  }
  return { view: () => current, setEntity, retry: () => setEntity(current.entity_id, true) };
}
