#pragma once

// A legacy light tile is a toggle, so its userdata is never a LightControlCtx.
// Keep its labels, checked state and binding intact while the modal owns a
// separate context. btn is only the layout/title anchor for this context.
inline void light_control_open_entity_modal(const ParsedCfg &config, lv_obj_t *button) {
  auto *light = new LightControlCtx();
  light->modal_owned = true;
  light->entity_id = config.entity;
  light->label = config.label;
  light->btn = button;
  light->accent_color = current_button_primary_color();
  light->label_font = switch_confirmation_message_font(
    button ? lv_obj_get_style_text_font(button, LV_PART_MAIN) : nullptr);
  light->number_font = light->label_font;
  light->icon_font = switch_confirmation_icon_font(light->label_font);
  light_control_open_modal(light);
  if (!light_control_modal_ui().panel) {
    light_control_hide_modal();
    return;
  }
  HaCallbackOwnerScope owner(light);
  subscribe_light_control_state(light);
  ha_schedule_metadata_refresh(config.entity,
    {"", "brightness", "color_temp_kelvin", "supported_color_modes", "friendly_name"},
    HA_SUBSCRIPTION_SCOPE_DEFAULT);
}

// This is deliberately a controls-only dispatcher: no generic click handler,
// confirmation, service call, transport action or navigation is allowed here.
inline void card_open_default_controls(const ParsedCfg &config, lv_obj_t *button) {
  const auto context = card_runtime_context(config);
  using Driver = espcontrol::card_runtime::CardDriverId;
  if (context.runtime.driver == Driver::TOGGLE && config.entity.compare(0, 6, "light.") == 0) {
    light_control_open_entity_modal(config, button);
    return;
  }
  void *data = button ? lv_obj_get_user_data(button) : nullptr;
  if (card_runtime_main_click_opens_modal(context)) {
    switch (context.runtime.driver) {
      case Driver::LIGHT_CONTROL:
        if (data) { light_control_open_modal(static_cast<LightControlCtx *>(data)); return; }
        break;
      case Driver::FAN_CONTROL:
        if (data) { fan_control_open_modal(static_cast<FanCardCtx *>(data)); return; }
        break;
      case Driver::FAN:
        if (data) { fan_preset_open(static_cast<FanCardCtx *>(data)); return; }
        break;
      case Driver::CLIMATE:
        if (data) { climate_control_open_modal(static_cast<ClimateControlCtx *>(data)); return; }
        break;
      case Driver::COVER_MODAL:
        if (data) { cover_control_open_modal(static_cast<CoverControlCtx *>(data)); return; }
        break;
      case Driver::ALARM:
        if (data && alarm_card_context_valid(static_cast<AlarmCardCtx *>(data))) {
          alarm_card_open_page(static_cast<AlarmCardCtx *>(data)); return;
        }
        break;
      case Driver::IMAGE:
        if (data) { image_card_open_modal(static_cast<ImageCardCtx *>(data)); return; }
        break;
      case Driver::WIFI_QR:
        espcontrol::cards::wifi_qr_driver_handle_main_click(context, config, button);
        return;
      case Driver::MEDIA_VOLUME:
        if (data) { media_volume_open_modal(static_cast<MediaVolumeCtx *>(data)); return; }
        break;
      case Driver::MEDIA_CONTROL:
      case Driver::MEDIA_GROUP:
      case Driver::MEDIA_COVER_ART: {
        auto *media = data ? static_cast<MediaControlCtx *>(data)
                           : grid_media_control_runtime_for_owner(button);
        if (media) { media_control_open_modal(media); return; }
        break;
      }
      case Driver::OPTION_SELECT:
        if (data) { option_select_open_modal(static_cast<OptionSelectCtx *>(data)); return; }
        break;
      default:
        break;
    }
  }
  more_info_open_modal(config, button);
}
