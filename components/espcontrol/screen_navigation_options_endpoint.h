#pragma once
#ifdef USE_WEBSERVER
#include "esphome/components/json/json_util.h"
#include "esphome/components/web_server_idf/web_server_idf.h"
#include "panel_identity.h"
#include "screen_navigation_options.h"

namespace espcontrol {
class ScreenNavigationOptionsHandler final : public esphome::web_server_idf::AsyncWebHandler {
 public:
  bool canHandle(esphome::web_server_idf::AsyncWebServerRequest *request) const override {
    char path[esphome::web_server_idf::AsyncWebServerRequest::URL_BUF_SIZE];
    return request->method() == HTTP_GET && request->url_to(path) == "/api/v1/screen-navigation/options";
  }
  void handleRequest(esphome::web_server_idf::AsyncWebServerRequest *request) override {
    httpd_req_t *raw = *request;
    if (panel_identity == nullptr || !panel_identity->ready()) {
      request->send(503, "text/plain", "Panel is starting");
      return;
    }
#ifdef USE_WEBSERVER_AUTH
    if (!request->authenticate(panel_identity->username(), panel_identity->password())) {
      request->requestAuthentication();
      return;
    }
#endif
    const std::string entity = request->arg("entity_id");
    const auto result = screen_navigation_options().request(entity, esphome::millis());
    const std::string response = esphome::json::build_json([&](JsonObject root) {
      root["entity_id"] = result.entity_id;
      root["status"] = screen_options_status_name(result.status);
      JsonArray options = root["options"].to<JsonArray>();
      for (const auto &option : result.options) options.add(option);
    });
    httpd_resp_set_hdr(raw, "Cache-Control", "no-store");
    request->send(result.http_status, "application/json", response.c_str());
  }
};
inline void register_screen_navigation_options_endpoint(esphome::web_server_idf::AsyncWebServer &server) {
  static bool registered = false;
  if (!registered) { server.addHandler(new ScreenNavigationOptionsHandler()); registered = true; }
}
}  // namespace espcontrol
#endif
