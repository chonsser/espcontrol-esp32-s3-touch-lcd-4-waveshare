#include <cassert>
#include <functional>
#include <string>
#include <vector>
#include "esphome/core/string_ref.h"
#include "ha_read_coordinator.h"
#include "screen_navigation_options.h"

namespace esphome { static uint32_t now = 0; inline uint32_t millis() { return now; } }
struct Transport {
  using State = esphome::StringRef;
  using Callback = std::function<void(State)>;
  struct Subscription { std::string entity; Callback callback; };
  bool connected = true, accept_requests = true;
  size_t requests = 0;
  std::vector<Subscription> subscriptions;
  bool available() const { return true; }
  bool state_connected() const { return connected; }
  void subscribe(const std::string &entity, const std::string &attribute, Callback callback) {
    assert(attribute == "options");
    subscriptions.push_back({entity, std::move(callback)});
  }
  bool request(const std::string &, const std::string &attribute) {
    assert(attribute == "options");
    if (!accept_requests) return false;
    ++requests;
    return true;
  }
  void publish(const std::string &entity, const std::string &raw) {
    for (const auto &subscription : subscriptions) {
      if (subscription.entity == entity) { subscription.callback(State(raw)); return; }
    }
    assert(false);
  }
};
struct HeapProbe { bool available(const char *, size_t, size_t) { return true; } };
using Coordinator = HaReadCoordinator<Transport, HeapProbe>;
inline Coordinator &ha_read_coordinator() { static Coordinator coordinator; return coordinator; }
inline bool ha_api_state_connected() { return ha_read_coordinator().state_connected(); }
inline bool ha_internal_heap_available(const char *) { return true; }
inline void ha_release_callbacks_for_owner(void *owner) { ha_read_coordinator().release_owner(owner); }
inline void ha_reannounce_state_subscriptions() {}
#include "button_grid_screen_navigation_options.h"

int main() {
  auto &coordinator = ha_read_coordinator();
  auto &transport = coordinator.transport();
  auto &service = espcontrol::screen_navigation_options();
  using Status = espcontrol::ScreenOptionsStatus;
  const std::string entity = "input_group.biuro_wyswietlacz_biurko_ekran";
  auto request = [&](const std::string &id) { return service.request(id, esphome::now); };
  auto lookup = [&](const std::string &id) { request(id); pump_screen_navigation_options(); };

  lookup(entity);
  const std::string oversized(256 * 1024, 'x');
  transport.publish(entity, oversized);
  assert(request(entity).status == Status::ERROR);
  assert(coordinator.retained_state_bytes() == 0);
  esphome::now = 1001;
  lookup(entity);
  transport.publish(entity, "['Home',' music, TV ','Łazienka']");
  assert(request(entity).options == std::vector<std::string>({"Home", " music, TV ", "Łazienka"}));
  assert(coordinator.retained_state_bytes() == 0);
  assert(transport.subscriptions.size() == 1 && transport.requests == 2);

  // Lost responses time out; subsequent queries reuse the native channel.
  esphome::now = 7000;
  lookup(entity);
  esphome::now = 17000;
  pump_screen_navigation_options();
  assert(request(entity).status == Status::UNAVAILABLE);
  assert(coordinator.retained_state_bytes() == 0);
  esphome::now = 18001;
  lookup(entity);
  assert(transport.requests == 4);
  transport.publish(entity, "['Recovered']");
  assert(request(entity).options == std::vector<std::string>({"Recovered"}));
  assert(transport.subscriptions.size() == 1 && transport.requests == 4);

  transport.connected = false;
  coordinator.invalidate_retained_state();
  pump_screen_navigation_options();
  transport.publish(entity, oversized);
  assert(request(entity).status == Status::UNAVAILABLE);
  transport.connected = true;
  pump_screen_navigation_options();
  assert(request(entity).status == Status::LOADING);
  transport.publish(entity, "['Reconnected']");
  assert(request(entity).options[0] == "Reconnected");
  assert(coordinator.retained_state_bytes() == 0 && transport.subscriptions.size() == 1);

  // A full lifetime of discovery IDs must not accumulate raw list payloads.
  std::string raw = "['" + std::string(255, 'a') + "']";
  raw.resize(espcontrol::SCREEN_OPTIONS_MAX_RAW_BYTES, ' ');
  for (size_t i = 1; i < espcontrol::SCREEN_OPTIONS_MAX_ENTITIES; ++i) {
    const std::string id = "input_group.options_" + std::to_string(i);
    lookup(id);
    transport.publish(id, raw);
    assert(request(id).status == Status::READY);
    assert(coordinator.retained_state_bytes() == 0);
    transport.publish(id, oversized);  // Updates outside a lookup are also unretained.
    assert(coordinator.retained_state_bytes() == 0);
  }
  assert(request("input_group.excess").http_status == 429);
  assert(transport.subscriptions.size() == espcontrol::SCREEN_OPTIONS_MAX_ENTITIES);

  // Normal subscribers sharing discovery's channel keep default replay and
  // retained-read behavior; discovery must neither disable nor consume it.
  int replay_owner = 0, retained_owner = 0, replacement_owner = 0;
  size_t ordinary_calls = 0;
  assert(coordinator.subscribe(entity, "options", [&](esphome::StringRef) { ++ordinary_calls; },
                               1u, &replay_owner));
  transport.publish(entity, "['Shared']");
  assert(ordinary_calls == 1 && coordinator.retained_state_bytes() == 10);
  assert(coordinator.subscribe(entity, "options", [&](esphome::StringRef) { ++ordinary_calls; },
                               1u, &retained_owner, true));
  assert(ordinary_calls == 2);  // Default replay still happens on rebuild.
  transport.publish(entity, "['Shared']");
  assert(coordinator.retained_state_bytes() == 20);
  bool read = false;
  assert(coordinator.read_retained(entity, "options", [&](esphome::StringRef value) {
    read = std::string(value.c_str(), value.size()) == "['Shared']";
  }, true, 0, 0));
  assert(read);
  assert(coordinator.request_fresh(entity, "options"));
  const size_t shared_requests = transport.requests;
  esphome::now += 6000;
  lookup(entity);
  assert(request(entity).status == Status::LOADING);
  assert(coordinator.retained_state_bytes() == 20);
  assert(transport.requests == shared_requests);  // Preserve another consumer's pending read.
  coordinator.release_owner(&replay_owner);
  assert(coordinator.retained_state_bytes() == 20);
  coordinator.release_owner(&retained_owner);
  assert(coordinator.retained_state_bytes() == 0);
  assert(coordinator.subscribe(entity, "options", [&](esphome::StringRef) { ++ordinary_calls; },
                               1u, &replacement_owner));
  assert(ordinary_calls == 4);  // No lingering raw replay from removed consumers.
  coordinator.release_owner(&replacement_owner);
  transport.publish(entity, "['Discovery only']");
  assert(request(entity).options[0] == "Discovery only");
  assert(coordinator.retained_state_bytes() == 0);

  esphome::now += 6000;
  transport.accept_requests = false;
  lookup(entity);
  assert(request(entity).status == Status::UNAVAILABLE);
  esphome::now += 1001;
  transport.accept_requests = true;
  lookup(entity);
  transport.publish(entity, "['Retry']");
  assert(request(entity).options[0] == "Retry");
  assert(coordinator.retained_state_bytes() == 0);
  assert(transport.subscriptions.size() == espcontrol::SCREEN_OPTIONS_MAX_ENTITIES);
}
