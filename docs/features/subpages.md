---
title: Subpage Cards
description:
  How to use Subpage cards on your EspControl panel to organise cards into folders.
---

# Subpage

![Subpage screen showing Back button and cover position buttons](/images/screen-subpage.png)

A Subpage card works like a folder. Tapping it on the panel opens a new page with its own set of cards. This is useful for grouping related controls together, such as all the lights in one room, without filling up the home screen.

Opening any named subpage shows its label on the left of the clock bar, both on the panel and in the web editor preview, replacing the usual item there. Returning home restores that item.

A subpage has one fewer usable slot than the home screen because it includes a **Back** card. Subpage cards on the home screen can show a small chevron marker so you can spot them easily. You can turn this marker on or off with **Screen: Subpage Chevron** in the Clock Bar settings.

## Setting Up a Subpage

1. Select a card on the home screen and change its type to **Subpage**.
2. Choose a subpage **Type**. **Generic** is a normal folder. The other presets make the home-screen Subpage tile look and behave like the thing it represents, such as **Lights**, **Switch**, **Alarm**, **Cover**, **Garage Door**, **Lock**, **Vacuum**, **Lawn Mower**, **Weather**, **Sensor**, or **Camera / Image**, before opening the detailed subpage.
3. Set a **Label** and **Icon** if you want them.
4. Click **Edit Subpage** in the card settings, or right-click the card and choose **Edit Subpage**.
5. The preview switches to the subpage. Add and arrange cards here the same way you would on the home screen.
6. Click the **Back** card to return to the home screen.

You can also right-click an empty space on the home screen and choose **Create Subpage**.

Subpages can contain Switch, Lights, Action, Local Action, Option Select, Webhook, Trigger, Sensor, Local Sensor, Doors & Windows, Presence, Slider, Fans, Vacuum, Lawn Mower, Cover, Garage Door, Lock, Alarm, Date & Time, Clock, World Clock, Weather, Camera, Media, Climate, Internal Switches, and Screen Lock cards. Subpages cannot contain another Subpage card.

## Choose a Screen From an Entity

In the web page, open **Screen**. All screen configurations appear beside one
another, with a preview and value assignments for each screen. Use **+** to add
an independent screen, then add cards in its editor. Each independent screen has
a full grid: it does not need a home-screen card or reserve a Back card.
Existing Subpage cards keep their normal Back card and continue to work as before.

The **Screen from Home Assistant** section stays open above the editors. Enter
the shared source entity once, for example `input_select.aktualny_ekran`.
The panel automatically reads its available options through the existing
Home Assistant connection. Choose the value that opens each screen from its
list, then save the screen settings. For example, `Salon` can open a living-room
screen and `Start` can return home. More than one value can select the same screen.

Option discovery does not save the source or change the panel's current screen.
The source must expose an `options` attribute, as standard `input_select` and
`select` entities do; custom entity IDs are preserved. If Home Assistant is
disconnected or the entity does not provide a list, a status and retry control
appear. Existing assignments remain visible even if an option disappears, so
you can replace or remove them without losing the other settings.

You can rename or delete an independent screen here. Deleting it removes its
cards and matching navigation rules, while keeping home-screen cards intact.
Independent screens and ordinary subpages share the device's screen capacity;
the editor tells you when no more screens fit. Update older firmware before
creating independent screens.

Values match exactly, including capital letters and spaces. `unknown`, `unavailable`,
and values without a matching rule leave the current screen unchanged. Rules
can only open screens; they do not press cards or run their actions. This feature
also works on ESP32-S3 panels.

The current matching value applies when the setting is enabled or the panel
restarts. After that, each changed value opens its screen once. You can then
navigate manually without the same value repeatedly pulling you back. The screen
selected by Home Assistant stays selected until the next matching entity change;
the home-screen timeout does not return it home. The screensaver can still dim or
turn off the display while preserving the selected screen underneath. If you
navigate to another screen manually, its normal home-screen timeout applies.

**Wake the screen when the state changes** is enabled by default. Turn it off to wait until the display
is awake. A screen lock, setup screen, alarm takeover, or active interactive
control temporarily holds the latest selection; it applies once the panel is
available. An unmatched value cancels a waiting selection.

Clear the entity and save to disable this feature. The form rejects rules that
exceed available storage. Backups include screens, names and these settings;
when importing onto another panel, rules follow screens that fit the new layout.
Rules for screens that cannot be restored are omitted with a notice.

## Open or Activate a Target From Home Assistant

You can ask Home Assistant to wake the panel and open or activate something on the home screen. This is useful in automations, scripts, dashboards, or voice routines where you want the panel to jump to a relevant page or open a card's normal control popup.

This Home-Assistant-to-panel action is disabled on the ESP32-S3 4-inch panel because it can stop Home Assistant completing the panel startup registration on that lower-memory model. Tapping Subpage cards on the panel still works normally.

Use the ESPHome action named after your device:

```yaml
action: esphome.<device_name>_navigate
data:
  target: "Lights"
```

Replace `<device_name>` with the ESPHome device name shown in Home Assistant. For example, if the device is called `hall_panel`, the action is:

```yaml
action: esphome.hall_panel_navigate
data:
  target: "Lights"
```

### Test It in Home Assistant

Before using the action in an automation or dashboard button, test it from Home Assistant:

1. Go to **Developer Tools**.
2. Open the **Actions** tab.
3. Search for `navigate` or your panel name, such as `hall_panel`.
4. Select the ESPHome action for your panel.
5. Enter the target page and click **Perform action**.

For example:

```yaml
action: esphome.hall_panel_navigate
data:
  target: "Lights"
```

To return to the home screen, use:

```yaml
action: esphome.hall_panel_navigate
data:
  target: "home"
```

The action is not an entity, so it will not appear in the entity list. It only appears in **Developer Tools** > **Actions** after the panel firmware has registered it with Home Assistant. If Home Assistant shows `Action not found` or `Unknown action selected`, update the panel firmware and reload or restart the ESPHome integration.

The `target` value can be:

- `home` or `main` to open the home screen.
- The **Label** you set on a home-screen card, such as `Lights`, `Heating`, `Camera`, or `Media`. Matching is not case-sensitive, so `lights` and `Lights` work the same way.
- `slot:3` to activate the card in home-screen slot 3.
- `voice`, `mic`, `microphone`, `speaker`, `volume`, or `device_volume` on voice-enabled ESP32-P4-86 firmware to open the device volume and microphone control popup when **Voice Services** are enabled.

You do not need to know a page number. Use the same label you gave the card on the home screen.

If two home-screen cards use the same label, the first matching displayed slot is used. To avoid surprises, give cards you want to target a unique label. If Home Assistant sends a label or slot that does not exist, the panel logs a warning and stays on the current page.

Targeting a normal home-screen card is the same as tapping it on the panel. Camera or image, climate, media volume, light control, cover, alarm, option-select, and similar cards open their normal popup. Action, toggle, webhook, lock, garage, cover command, vacuum, mower, and other command cards can send real Home Assistant commands, so target those carefully.

The panel wakes before navigating, so the action works when the screen is off, dimmed, or showing the clock screensaver. It does not change long-press behavior. If you use the [Home screen timeout](/features/idle), the panel will still return to the home screen using that normal setting.

## Show State

Turn on **Show State** if you want the Subpage card on the home screen to show state.

Subpage cards can show state in three ways:

- **Icon** uses the card's **Icon** as the off icon and shows an **On Icon** when active. Enter a **State Entity** to track a specific Home Assistant entity, or leave it blank to keep the existing automatic behavior where the Subpage card lights up if any active-capable card inside it is on, open, playing, unlocked, or otherwise active.
- **Numeric** shows a Home Assistant sensor value in the large number style used by Sensor cards. Choose a **Sensor Entity**, **Unit**, and **Unit Precision**.
- **Text** shows a Home Assistant sensor state where the card label normally appears. Choose a **Sensor Entity**.

Read-only cards such as Sensor, Date, Clock, World Clock, and Weather do not affect Icon mode. Numeric and Text modes use the sensor entity you enter on the Subpage card. They do not automatically count the cards inside the subpage; use a Home Assistant helper or template sensor for that.

## Moving Cards Between Pages

You can cut, copy, and paste cards between the home screen and subpages. Right-click a card, choose **Cut** or **Copy**, then right-click an empty space on the destination page and choose **Paste**.

## Copying Cards Between Controllers

To copy a card to another EspControl panel:

1. Right-click the card and choose **Copy Code**. If you selected several cards, choose **Copy Cards as Code**.
2. The code is selected automatically. Copy it with **Ctrl+C** or **Command+C**.
3. Open the setup page for the other controller, right-click an empty position, and choose **Paste Code**.
4. Paste the code into the box and choose **Paste**.

Card codes include the card size and any attached subpage. When the destination screen is a different size, EspControl finds suitable empty positions and may reduce a large card to a single tile. The complete group is checked before anything is saved, so a multi-card transfer is not partly applied when there is insufficient room.

Cards that use an internal relay, local action, or local sensor may need to be edited for the destination controller. Card codes can also contain private webhook URLs or headers, so keep them private and do not post them publicly.
