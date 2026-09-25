#pragma once

#include <cstddef>
#include <string>
#include "panel_config_document.h"

namespace espcontrol {

// A standalone screen shares subpage payload storage, not its home card.
// Keep an offset into the caller's string instead of copying the card payload.
struct StandaloneScreenConfig {
  bool standalone = false;
  bool valid = true;
  std::string label;
  size_t payload_offset = 0;
};

inline bool standalone_screen_label_space(uint32_t cp) {
  return cp == 0x20 || cp == 0xA0 || cp == 0x1680 ||
         (cp >= 0x2000 && cp <= 0x200A) || cp == 0x2028 || cp == 0x2029 ||
         cp == 0x202F || cp == 0x205F || cp == 0x3000 || cp == 0xFEFF;
}

inline bool standalone_screen_label_valid(const std::string &label) {
  if (label.empty() || label.size() > 64 ||
      !configuration::panel_config_valid_utf8(
          reinterpret_cast<const uint8_t *>(label.data()), label.size())) return false;
  bool visible = false;
  for (size_t i = 0; i < label.size();) {
    const auto first = static_cast<uint8_t>(label[i++]);
    uint32_t cp = first;
    size_t following = 0;
    if (first >= 0xF0) { cp &= 0x07; following = 3; }
    else if (first >= 0xE0) { cp &= 0x0F; following = 2; }
    else if (first >= 0xC0) { cp &= 0x1F; following = 1; }
    while (following--) cp = (cp << 6) | (static_cast<uint8_t>(label[i++]) & 0x3F);
    if (cp < 0x20 || (cp >= 0x7F && cp <= 0x9F)) return false;
    visible = visible || !standalone_screen_label_space(cp);
  }
  return visible;
}

inline StandaloneScreenConfig parse_standalone_screen_config(const std::string &raw) {
  StandaloneScreenConfig result;
  constexpr size_t prefix_size = 8;
  if (raw.compare(0, prefix_size, "@screen:") != 0) return result;
  result.standalone = true;
  result.valid = false;
  const size_t end = raw.find('\n', prefix_size);
  if (end == std::string::npos) return result;
  auto hex = [](char ch) -> int {
    if (ch >= '0' && ch <= '9') return ch - '0';
    if (ch >= 'A' && ch <= 'F') return ch - 'A' + 10;
    if (ch >= 'a' && ch <= 'f') return ch - 'a' + 10;
    return -1;
  };
  for (size_t i = prefix_size; i < end; ++i) {
    char ch = raw[i];
    if (ch == '%') {
      if (i + 2 >= end) return result;
      const int high = hex(raw[i + 1]), low = hex(raw[i + 2]);
      if (high < 0 || low < 0) return result;
      ch = static_cast<char>((high << 4) | low);
      i += 2;
    }
    result.label += ch;
    if (result.label.size() > 64) return result;
  }
  if (!standalone_screen_label_valid(result.label)) return result;
  result.payload_offset = end + 1;
  result.valid = true;
  return result;
}

}  // namespace espcontrol
