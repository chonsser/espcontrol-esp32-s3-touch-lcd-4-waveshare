#pragma once

#include <algorithm>
#include <array>
#include <cstdint>
#include <mutex>
#include <optional>
#include <string>
#include <vector>
#include "panel_config_document.h"

namespace espcontrol {

constexpr size_t SCREEN_OPTIONS_MAX_ENTITIES = 16;
constexpr size_t SCREEN_OPTIONS_MAX_RAW_BYTES = 8192;
constexpr size_t SCREEN_OPTIONS_MAX_COUNT = 64;
constexpr size_t SCREEN_OPTIONS_MAX_VALUE_BYTES = 255;

// HA transports attributes as text: lists may use JSON or Python repr quotes.
// Parse just a list of strings, without trimming values or evaluating anything.
inline bool parse_screen_navigation_options(const std::string &raw, std::vector<std::string> &output) {
  output.clear();
  if (raw.size() > SCREEN_OPTIONS_MAX_RAW_BYTES) return false;
  size_t pos = 0;
  auto whitespace = [&]() {
    while (pos < raw.size() && (raw[pos] == ' ' || raw[pos] == '\n' || raw[pos] == '\r' || raw[pos] == '\t')) ++pos;
  };
  auto hex = [&](unsigned count, uint32_t &value) {
    value = 0;
    while (count--) {
      if (pos >= raw.size()) return false;
      const char ch = raw[pos++];
      const int digit = ch >= '0' && ch <= '9' ? ch - '0' : ch >= 'a' && ch <= 'f' ? ch - 'a' + 10 : ch >= 'A' && ch <= 'F' ? ch - 'A' + 10 : -1;
      if (digit < 0) return false;
      value = (value << 4) | static_cast<unsigned>(digit);
    }
    return true;
  };
  auto append_codepoint = [](std::string &value, uint32_t cp) {
    if (cp == 0 || cp > 0x10FFFF || (cp >= 0xD800 && cp <= 0xDFFF)) return false;
    if (cp < 0x80) value += static_cast<char>(cp);
    else if (cp < 0x800) { value += static_cast<char>(0xC0 | (cp >> 6)); value += static_cast<char>(0x80 | (cp & 0x3F)); }
    else if (cp < 0x10000) { value += static_cast<char>(0xE0 | (cp >> 12)); value += static_cast<char>(0x80 | ((cp >> 6) & 0x3F)); value += static_cast<char>(0x80 | (cp & 0x3F)); }
    else { value += static_cast<char>(0xF0 | (cp >> 18)); value += static_cast<char>(0x80 | ((cp >> 12) & 0x3F)); value += static_cast<char>(0x80 | ((cp >> 6) & 0x3F)); value += static_cast<char>(0x80 | (cp & 0x3F)); }
    return true;
  };
  std::vector<std::string> parsed;
  whitespace();
  if (pos == raw.size() || raw[pos++] != '[') return false;
  whitespace();
  size_t count = 0;
  while (pos < raw.size() && raw[pos] != ']') {
    if (++count > SCREEN_OPTIONS_MAX_COUNT || (raw[pos] != '\'' && raw[pos] != '"')) return false;
    const char quote = raw[pos++];
    std::string value;
    bool closed = false;
    while (pos < raw.size()) {
      char ch = raw[pos++];
      if (ch == quote) { closed = true; break; }
      if (static_cast<unsigned char>(ch) < 0x20) return false;
      if (ch != '\\') value += ch;
      else {
        if (pos == raw.size()) return false;
        ch = raw[pos++];
        switch (ch) {
          case '\\': case '\'': case '"': case '/': value += ch; break;
          case 'b': value += '\b'; break;
          case 'f': value += '\f'; break;
          case 'n': value += '\n'; break;
          case 'r': value += '\r'; break;
          case 't': value += '\t'; break;
          case 'x': case 'u': case 'U': {
            uint32_t cp;
            if (!hex(ch == 'x' ? 2 : ch == 'u' ? 4 : 8, cp)) return false;
            if (cp >= 0xD800 && cp <= 0xDBFF && ch == 'u') {
              if (pos + 2 > raw.size() || raw[pos++] != '\\' || raw[pos++] != 'u') return false;
              uint32_t low;
              if (!hex(4, low) || low < 0xDC00 || low > 0xDFFF) return false;
              cp = 0x10000 + ((cp - 0xD800) << 10) + low - 0xDC00;
            }
            if (!append_codepoint(value, cp)) return false;
            break;
          }
          default: return false;
        }
      }
      if (value.size() > SCREEN_OPTIONS_MAX_VALUE_BYTES) return false;
    }
    if (!closed || !configuration::panel_config_valid_utf8(reinterpret_cast<const uint8_t *>(value.data()), value.size())) return false;
    if (std::find(parsed.begin(), parsed.end(), value) == parsed.end()) parsed.push_back(std::move(value));
    whitespace();
    if (pos == raw.size()) return false;
    if (raw[pos] == ']') break;
    if (raw[pos++] != ',') return false;
    whitespace();
  }
  if (pos == raw.size() || raw[pos++] != ']') return false;
  whitespace();
  if (pos != raw.size()) return false;
  output = std::move(parsed);
  return true;
}

enum class ScreenOptionsStatus { LOADING, READY, UNAVAILABLE, UNSUPPORTED, ERROR };
inline const char *screen_options_status_name(ScreenOptionsStatus status) {
  switch (status) {
    case ScreenOptionsStatus::LOADING: return "loading";
    case ScreenOptionsStatus::READY: return "ready";
    case ScreenOptionsStatus::UNAVAILABLE: return "unavailable";
    case ScreenOptionsStatus::UNSUPPORTED: return "unsupported";
    default: return "error";
  }
}
struct ScreenOptionsSnapshot {
  std::string entity_id;
  ScreenOptionsStatus status{ScreenOptionsStatus::LOADING};
  std::vector<std::string> options;
  int http_status{200};
};
struct ScreenOptionsJob { size_t index; uint32_t generation; std::string entity; };

// HTTP only queues reads and takes snapshots. The main loop owns HA calls.
// Retain bounded channel identities for the firmware lifetime, and evict old
// option payloads under a separate 16 KiB budget.
class ScreenNavigationOptions {
 public:
  static bool valid_entity(const std::string &entity) {
    if (entity.empty() || entity.size() > 100) return false;
    const auto dot = entity.find('.');
    if (dot == std::string::npos || dot == 0 || dot + 1 == entity.size()) return false;
    for (size_t i = 0; i < entity.size(); ++i) {
      const char ch = entity[i];
      if (i == dot || (ch >= 'a' && ch <= 'z') || ch == '_' || (i > dot && ch >= '0' && ch <= '9')) continue;
      return false;
    }
    return true;
  }
  ScreenOptionsSnapshot request(const std::string &entity, uint32_t now) {
    if (!valid_entity(entity)) return {entity, ScreenOptionsStatus::ERROR, {}, 400};
    std::lock_guard<std::mutex> lock(mutex_);
    size_t index = 0;
    while (index < used_ && records_[index].entity != entity) ++index;
    if (index == used_) {
      if (used_ == records_.size()) return {entity, ScreenOptionsStatus::ERROR, {}, 429};
      ++used_;
      records_[index].entity = entity;
      records_[index].pending = true;
    }
    auto &record = records_[index];
    record.touched = now;
    if (!connected_) record.status = ScreenOptionsStatus::UNAVAILABLE;
    else if (!record.in_flight && !record.pending &&
             static_cast<uint32_t>(now - record.completed) >= (record.status == ScreenOptionsStatus::READY ? 5000u : 1000u)) {
      record.pending = true;
      record.status = ScreenOptionsStatus::LOADING;
      release_options(record);
    }
    if (connected_ && record.pending) record.status = ScreenOptionsStatus::LOADING;
    return {entity, record.status, record.options, 200};
  }
  std::optional<ScreenOptionsJob> next_job(bool connected, uint32_t now) {
    std::lock_guard<std::mutex> lock(mutex_);
    if (connected != connected_) {
      connected_ = connected;
      for (size_t i = 0; i < used_; ++i) {
        auto &record = records_[i];
        ++record.generation;
        record.in_flight = false;
        record.pending = static_cast<uint32_t>(now - record.touched) <= 30000;
        record.status = connected ? ScreenOptionsStatus::LOADING : ScreenOptionsStatus::UNAVAILABLE;
        release_options(record);
      }
    }
    for (size_t i = 0; i < used_; ++i) {
      auto &record = records_[i];
      if (record.in_flight && static_cast<uint32_t>(now - record.started) >= 10000) {
        ++record.generation;
        record.in_flight = false;
        record.status = ScreenOptionsStatus::UNAVAILABLE;
        record.completed = now;
      }
      if (connected && record.pending) {
        record.pending = false;
        record.in_flight = true;
        record.status = ScreenOptionsStatus::LOADING;
        record.started = now;
        return ScreenOptionsJob{i, ++record.generation, record.entity};
      }
    }
    return std::nullopt;
  }
  void receive(size_t index, uint32_t generation, const std::string &raw, uint32_t now) {
    std::vector<std::string> parsed;
    {
      std::lock_guard<std::mutex> lock(mutex_);
      if (!accepts(index, generation)) return;
    }
    const bool unavailable = raw.empty() || raw == "unknown" || raw == "unavailable";
    const bool valid = !unavailable && parse_screen_navigation_options(raw, parsed);
    std::lock_guard<std::mutex> lock(mutex_);
    if (!accepts(index, generation)) return;
    auto &record = records_[index];
    release_options(record);
    size_t incoming = 0;
    for (const auto &value : parsed) incoming += value.size();
    while (cached_bytes_ + incoming > 16384) {
      size_t oldest = records_.size();
      for (size_t i = 0; i < used_; ++i) {
        if (i != index && records_[i].bytes && (oldest == records_.size() ||
            static_cast<uint32_t>(now - records_[i].touched) > static_cast<uint32_t>(now - records_[oldest].touched))) oldest = i;
      }
      if (oldest == records_.size()) break;
      release_options(records_[oldest]);
      records_[oldest].status = ScreenOptionsStatus::LOADING;
    }
    record.options = std::move(parsed);
    record.bytes = incoming;
    cached_bytes_ += incoming;
    record.in_flight = false;
    record.completed = now;
    record.status = valid ? ScreenOptionsStatus::READY : unavailable ? ScreenOptionsStatus::UNAVAILABLE : ScreenOptionsStatus::ERROR;
  }
  void failed(size_t index, uint32_t generation, uint32_t now) { receive(index, generation, "unavailable", now); }

 private:
  struct Record {
    std::string entity;
    std::vector<std::string> options;
    ScreenOptionsStatus status{ScreenOptionsStatus::LOADING};
    uint32_t generation{0}, touched{0}, started{0}, completed{0};
    size_t bytes{0};
    bool pending{false}, in_flight{false};
  };
  bool accepts(size_t index, uint32_t generation) const {
    return connected_ && index < used_ && records_[index].in_flight && records_[index].generation == generation;
  }
  void release_options(Record &record) {
    cached_bytes_ -= record.bytes;
    record.bytes = 0;
    std::vector<std::string>().swap(record.options);
  }
  std::mutex mutex_;
  std::array<Record, SCREEN_OPTIONS_MAX_ENTITIES> records_{};
  size_t used_{0}, cached_bytes_{0};
  bool connected_{false};
};

inline ScreenNavigationOptions &screen_navigation_options() {
  static ScreenNavigationOptions service;
  return service;
}
}  // namespace espcontrol
