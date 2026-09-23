"""Bounded, silent HLS screensaver for ESP32-S3 panels."""

import esphome.codegen as cg
import esphome.config_validation as cv
from esphome.components import esp32, socket, text_sensor
from esphome.const import CONF_ID

DEPENDENCIES = ["esp32", "psram", "lvgl", "network"]
AUTO_LOAD = ["socket", "text_sensor"]

hls_ns = cg.esphome_ns.namespace("hls_screensaver")
HlsScreensaver = hls_ns.class_("HlsScreensaver", cg.Component)

CONFIG_SCHEMA = cv.All(
    cv.Schema(
        {
            cv.GenerateID(): cv.declare_id(HlsScreensaver),
            cv.Optional("status"): text_sensor.text_sensor_schema(),
        }
    ).extend(cv.COMPONENT_SCHEMA),
    cv.only_with_framework("esp-idf"),
    socket.consume_sockets(1, "hls_screensaver"),
)

async def to_code(config):
    var = cg.new_Pvariable(config[CONF_ID])
    await cg.register_component(var, config)
    if "status" in config:
        status = await text_sensor.new_text_sensor(config["status"])
        cg.add(var.set_status_sensor(status))
    esp32.add_idf_component(name="espressif/esp_h264", ref="1.4.0")
    esp32.include_builtin_idf_component("esp_http_client")
    esp32.include_builtin_idf_component("tcp_transport")
    esp32.include_builtin_idf_component("esp-tls")
    esp32.add_idf_sdkconfig_option("CONFIG_MBEDTLS_CERTIFICATE_BUNDLE", True)
    esp32.add_idf_sdkconfig_option("CONFIG_ESP_HTTP_CLIENT_ENABLE_CUSTOM_TRANSPORT", True)
    esp32.add_idf_sdkconfig_option("CONFIG_ESP_H264_DUAL_TASK", False)
    cg.add_define("USE_HLS_SCREENSAVER")
