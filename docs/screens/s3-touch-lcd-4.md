---
title: 4-inch Waveshare ESP32-S3-Touch-LCD-4
description:
  EspControl on the Waveshare ESP32-S3-Touch-LCD-4 - a 4-inch 480x480 square touchscreen with 9 cards, powered by ESP32-S3.
---

# 4-inch Waveshare ESP32-S3-Touch-LCD-4

The **Waveshare ESP32-S3-Touch-LCD-4** is a 4-inch square touchscreen powered by an **ESP32-S3** processor. It uses the same 480×480 display size and 3x3 EspControl layout as the Guition 4848S040, with room for **9 cards** on the home screen.

::: warning Board revision 4.0 only
EspControl supports board **revision 4.0**, which controls the display reset, touch reset, buzzer, and backlight through a CH32V003 helper chip. The revision is printed on the circuit board; boards with no printed revision are 1.0. Revisions 1.0 to 3.0 use a different helper chip and are not supported.
:::

The board's RS485, CAN, SD card, real-time clock, and battery connector are not used by EspControl. The on-board buzzer is kept off and is available as a **Buzzer** switch in Home Assistant.

## Card Grid

<!--@include: ../generated/screens/s3-touch-lcd-4-grid.md-->

This screen supports two shared image cards across the home page and subpages, allowing one [Camera Card](/card-types/cameras) alongside one Media Cover Art card. Camera cards show still snapshots from `camera.*` or `image.*` entities with an optimised expanded view; live video remains unavailable on this ESP32-S3 model.

## Install

Connect the display to your computer with a USB-C data cable, then click the button below.

<!--@include: ../generated/screens/s3-touch-lcd-4-install.md-->

Pre-built firmware for this panel is published from the first EspControl release that includes it. Until then, use the ESPHome manual setup below.

For a full walkthrough including WiFi setup and Home Assistant pairing, see the [Install guide](/getting-started/install).

::: tip After flashing or OTA update
This panel uses an RGB display with octal PSRAM, which requires a brief hardware reset after flashing or OTA updates. The firmware handles this automatically with a short deep-sleep cycle — the display may flicker once, and the USB serial port briefly disconnects, before the panel comes back up normally.
:::

## Backlight

The backlight is dimmed by the CH32V003 helper chip rather than by the ESP32-S3. If the screen is dark at 100% brightness but lights up at low brightness, the backlight direction on your board is reversed: set `inverted: false` on the `gpio_backlight_pwm` output in `devices/waveshare-esp32-s3-touch-lcd-4/device/device.yaml` and rebuild.

## ESPHome Manual Setup

If you use ESPHome and prefer to compile firmware yourself:

```yaml
substitutions:
  name: "bedside-screen"
  friendly_name: "Bedside Screen"

wifi:
  ssid: !secret wifi_ssid
  password: !secret wifi_password

packages:
  setup:
    url: https://github.com/jtenniswood/espcontrol/
    file: devices/waveshare-esp32-s3-touch-lcd-4/packages.yaml
    refresh: 1sec
```

Use a current ESPHome release: the CH32V003 helper chip driver is built into ESPHome, and EspControl is built and tested with the version pinned in `.github/esphome.env`.
