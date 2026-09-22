#pragma once

#include <cctype>
#include <cstdint>
#include <optional>
#include <string>
#include <utility>
#include <vector>

namespace espcontrol {

enum class ScreenNavigationAction { WAIT, WAKE, NAVIGATE };

struct ScreenNavigationConditions {
  bool ready = false;
  bool active = false;
  bool waking = false;
  bool locked = false;
  bool protected_display = false;
};

// Owns the current binding and its latest unconsumed selection. It deliberately
// knows no card actions: target 0 is home; positive targets are subpage slots.
class EntityScreenNavigation {
 public:
  bool configure(const std::string &entity, const std::string &encoded_rules,
                 bool wake) {
    if (configured_ && entity == entity_ && encoded_rules == encoded_rules_ && wake == wake_)
      return false;
    configured_ = true;
    entity_ = entity;
    encoded_rules_ = encoded_rules;
    wake_ = wake;
    ++generation_;
    pending_target_.reset();
    last_state_.reset();
    rules_.clear();
    valid_ = entity_valid(entity) && parse_rules(encoded_rules);
    if (!valid_) rules_.clear();
    return true;
  }

  bool enabled() const { return valid_ && !entity_.empty() && !rules_.empty(); }
  const std::string &entity() const { return entity_; }
  uint32_t generation() const { return generation_; }
  std::optional<int> pending_target() const { return pending_target_; }
  void complete_navigation() { pending_target_.reset(); }

  void receive(uint32_t generation, const std::string &state) {
    if (generation != generation_ || !enabled()) return;
    if (last_state_ && *last_state_ == state) return;
    last_state_ = state;
    pending_target_.reset();
    if (state.empty() || state.size() > 255 || state == "unknown" || state == "unavailable") return;
    for (const auto &rule : rules_) {
      if (rule.state == state) {
        pending_target_ = rule.target;
        return;
      }
    }
  }

  ScreenNavigationAction next_action(const ScreenNavigationConditions &conditions,
                                     bool target_available) {
    if (!pending_target_ || !conditions.ready || conditions.locked ||
        conditions.protected_display || conditions.waking)
      return ScreenNavigationAction::WAIT;
    if (!target_available) {
      pending_target_.reset();
      return ScreenNavigationAction::WAIT;
    }
    if (conditions.active) return ScreenNavigationAction::NAVIGATE;
    return wake_ ? ScreenNavigationAction::WAKE : ScreenNavigationAction::WAIT;
  }

 private:
  struct Rule { int target; std::string state; };

  static bool entity_valid(const std::string &entity) {
    if (entity.empty()) return true;
    if (entity.size() > 100) return false;
    const size_t dot = entity.find('.');
    if (dot == std::string::npos || dot == 0 || dot + 1 == entity.size()) return false;
    for (size_t i = 0; i < entity.size(); ++i) {
      if (i == dot) continue;
      const char ch = entity[i];
      if ((ch >= 'a' && ch <= 'z') || ch == '_' ||
          (i > dot && ch >= '0' && ch <= '9')) continue;
      return false;
    }
    return true;
  }

  static bool decode_state(const std::string &encoded, std::string &state) {
    for (size_t i = 0; i < encoded.size(); ++i) {
      char ch = encoded[i];
      if (ch == '%') {
        if (i + 2 >= encoded.size()) return false;
        const std::string escape = encoded.substr(i, 3);
        if (escape == "%25") ch = '%';
        else if (escape == "%09") ch = '\t';
        else if (escape == "%0A") ch = '\n';
        else if (escape == "%0D") ch = '\r';
        else return false;
        i += 2;
      } else if (ch == '\t' || ch == '\r' || ch == '\n' || ch == '\0') {
        return false;
      }
      state += ch;
    }
    if (state == "unknown" || state == "unavailable") return false;
    for (unsigned char ch : state) {
      if (!std::isspace(ch)) return true;
    }
    return false;
  }

  bool parse_rules(const std::string &encoded) {
    if (encoded.size() > 255) return false;
    if (encoded.empty()) return true;
    size_t start = 0;
    while (start < encoded.size()) {
      size_t end = encoded.find('\n', start);
      if (end == std::string::npos) end = encoded.size();
      const size_t tab = encoded.find('\t', start);
      if (tab == std::string::npos || tab == start || tab >= end) return false;
      int target = 0;
      for (size_t i = start; i < tab; ++i) {
        if (encoded[i] < '0' || encoded[i] > '9') return false;
        target = target * 10 + (encoded[i] - '0');
        if (target > 32) return false;
      }
      std::string state;
      if (!decode_state(encoded.substr(tab + 1, end - tab - 1), state)) return false;
      for (const auto &rule : rules_) if (rule.state == state) return false;
      rules_.push_back({target, std::move(state)});
      if (end == encoded.size()) return true;
      start = end + 1;
    }
    return false;  // A trailing separator creates an empty mapping.
  }

  bool configured_ = false;
  bool valid_ = false;
  bool wake_ = true;
  uint32_t generation_ = 0;
  std::string entity_;
  std::string encoded_rules_;
  std::optional<std::string> last_state_;
  std::optional<int> pending_target_;
  std::vector<Rule> rules_;
};

}  // namespace espcontrol
