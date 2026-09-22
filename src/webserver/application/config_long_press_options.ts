import type { CardConfig } from "../contracts/types";
import { configOptionValue, setConfigOptionValue } from "../model/config_primitives";

export function longPressAction(options: unknown): string {
    const action = configOptionValue(options, "long_press");
    return action === "more_info" || action === "none" ? action : "";
}

export function copyLongPressOptions(target: string, source: unknown): string {
    const action = longPressAction(source);
    let options = setConfigOptionValue(target, "long_press", action);
    for (const name of ["long_press_entity", "long_press_text"]) {
        options = setConfigOptionValue(options, name,
            action === "more_info" ? configOptionValue(source, name) : "");
    }
    return options;
}

export function longPressDefaultEntity(card: Partial<CardConfig>): string {
    const value = ["sensor", "presence", "door_window"].includes(card.type || "")
        ? card.sensor : card.entity;
    return /^[a-z_]+\.[a-z0-9_]+$/.test(value || "") ? value! : "";
}

export function cardSupportsLongPress(card: Partial<CardConfig>): boolean {
    if (["slider", "light_brightness", "light_temperature", "fan_speed"].includes(card.type || "")) return false;
    if (card.type === "cover" && (!card.sensor || card.sensor === "tilt")) return false;
    return !(card.type === "media" && (card.sensor === "position" ||
        ((!card.sensor || card.sensor === "now_playing") && card.precision === "progress")));
}
