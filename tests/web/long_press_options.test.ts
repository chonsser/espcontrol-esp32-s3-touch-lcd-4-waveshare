import { cardSupportsLongPress, copyLongPressOptions, longPressDefaultEntity } from "../../src/webserver/application/config_long_press_options";

function equal(actual: unknown, expected: unknown): void {
  if (actual !== expected) throw new Error(`Expected ${expected}, got ${actual}`);
}
export function runLongPressOptionsTests(): void {
  for (const type of ["slider", "light_brightness", "light_temperature", "fan_speed"]) {
    equal(cardSupportsLongPress({type}), false);
  }
  for (const sensor of ["", "tilt"]) equal(cardSupportsLongPress({type: "cover", sensor}), false);
  equal(cardSupportsLongPress({type: "cover", sensor: "modal"}), true);
  equal(cardSupportsLongPress({type: "media", sensor: "position"}), false);
  equal(cardSupportsLongPress({type: "media", sensor: "now_playing", precision: "progress"}), false);
  for (const sensor of ["next", "previous", "play_pause", "volume", "cover_art", "now_playing"]) {
    equal(cardSupportsLongPress({type: "media", sensor}), true);
  }
  equal(longPressDefaultEntity({type: "sensor", sensor: "sensor.temperature"}), "sensor.temperature");
  equal(longPressDefaultEntity({type: "presence", sensor: "binary_sensor.motion"}), "binary_sensor.motion");
  equal(longPressDefaultEntity({type: "webhook", entity: "https://example.com/a"}), "");
  equal(longPressDefaultEntity({type: "sensor", sensor: "__local_sensor__", entity: "uptime"}), "");
  equal(copyLongPressOptions("active_color,long_press=more_info,long_press_entity=sensor.old,long_press_text=Old", "long_press=none"), "active_color,long_press=none");
  equal(copyLongPressOptions("active_color,long_press=more_info", "long_press=unexpected"), "active_color");
  equal(copyLongPressOptions("active_color", "long_press=more_info,long_press_text=Hello%2C%20world%3B"), "active_color,long_press=more_info,long_press_text=Hello%2C world%3B");
}
