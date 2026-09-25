#pragma once
#include "screen_navigation_options.h"

// Called only on the ESPHome main loop, never from the HTTP server task.
inline void pump_screen_navigation_options() {
  auto &service = espcontrol::screen_navigation_options();
  const auto job = service.next_job(ha_api_state_connected(), esphome::millis());
  if (!job) return;
  if (!ha_internal_heap_available("screen option discovery")) {
    service.failed(job->index, job->generation, esphome::millis());
    return;
  }
  struct CallbackOwner { bool armed{false}; };
  static std::array<CallbackOwner, espcontrol::SCREEN_OPTIONS_MAX_ENTITIES> owners{};
  auto *owner = &owners[job->index];
  owner->armed = false;
  ha_release_callbacks_for_owner(owner);
  const size_t index = job->index;
  const uint32_t generation = job->generation;
  const bool subscribed = ha_read_coordinator().subscribe(
      job->entity, "options", [owner, index, generation](esphome::StringRef raw) {
        // Discovery requires a fresh HA reply after subscription registration.
        if (!owner->armed) return;
        auto &target = espcontrol::screen_navigation_options();
        if (raw.size() > espcontrol::SCREEN_OPTIONS_MAX_RAW_BYTES) {
          target.receive(index, generation, "!oversized", esphome::millis());
        } else {
          target.receive(index, generation, std::string(raw.c_str(), raw.size()), esphome::millis());
        }
      }, 1u << 5, owner, false, false);
  owner->armed = true;
  if (subscribed) ha_reannounce_state_subscriptions();
  if (!subscribed || !ha_read_coordinator().request_fresh(job->entity, "options"))
    service.failed(index, generation, esphome::millis());
}
