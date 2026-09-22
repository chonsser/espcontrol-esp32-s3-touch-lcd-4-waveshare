#pragma once

#include <cstdio>
#include <string>

// Numeric-only, locale-independent format language shared by cards and the
// screensaver. Spaces are literal (never trimmed); empty means legacy/hidden.
struct ClockScreensaverFormat {
  bool valid = false;
  bool seconds = false;
  std::string shape;
};

inline ClockScreensaverFormat parse_clock_screensaver_format(const std::string &format) {
  ClockScreensaverFormat result;
  if (format.size() > 32) return result;
  bool digit = false;
  for (size_t i = 0; i < format.size(); ++i) {
    const char ch = format[i];
    if (ch == '%') {
      if (++i == format.size()) return {};
      const char token = format[i];
      switch (token) {
        case 'H': case 'I': case 'M': case 'S': case 'd': case 'm': case 'y':
          result.shape += "00";
          break;
        case 'Y': result.shape += "0000"; break;
        default: return {};
      }
      digit = true;
      result.seconds |= token == 'S';
    } else if (ch >= '0' && ch <= '9') {
      result.shape += '0';
      digit = true;
    } else if (ch == ' ' || ch == ':' || ch == '.' || ch == '/' || ch == '-') {
      result.shape += ch;
    } else {
      return {};
    }
    if (result.shape.size() > 32) return {};
  }
  result.valid = format.empty() || digit;
  if (!result.valid) return {};
  return result;
}

struct ClockScreensaverTime {
  int hour, minute, second, day, month, year;
};

// Allocation-free bounded writer, also validating restored/untrusted formats.
inline bool format_clock_numeric_into(const std::string &format,
                                      const ClockScreensaverTime &time,
                                      char (&out)[33]) {
  out[0] = '\0';
  if (format.size() > 32) return false;
  size_t used = 0;
  bool digit = false;
  for (size_t i = 0; i < format.size(); ++i) {
    char ch = format[i];
    if (ch != '%') {
      if (ch >= '0' && ch <= '9') digit = true;
      else if (ch != ' ' && ch != ':' && ch != '.' && ch != '/' && ch != '-') {
        out[0] = '\0'; return false;
      }
      if (used == 32) { out[0] = '\0'; return false; }
      out[used++] = ch;
      continue;
    }
    if (++i == format.size()) { out[0] = '\0'; return false; }
    const char token = format[i];
    int value = 0;
    switch (token) {
      case 'H': value = time.hour; break;
      case 'I': value = time.hour % 12; if (value == 0) value = 12; break;
      case 'M': value = time.minute; break;
      case 'S': value = time.second; break;
      case 'd': value = time.day; break;
      case 'm': value = time.month; break;
      case 'Y': value = time.year; break;
      case 'y': value = time.year % 100; break;
      default: out[0] = '\0'; return false;
    }
    const size_t digits = token == 'Y' ? 4 : 2;
    if (value < 0 || value > (digits == 4 ? 9999 : 99) || used + digits > 32) {
      out[0] = '\0'; return false;
    }
    for (size_t d = digits; d > 0; --d) {
      out[used + d - 1] = '0' + value % 10;
      value /= 10;
    }
    used += digits;
    digit = true;
  }
  out[used] = '\0';
  if (!format.empty() && !digit) { out[0] = '\0'; return false; }
  return true;
}

inline bool format_clock_screensaver_numeric(const std::string &format,
                                             const ClockScreensaverTime &time,
                                             std::string &out) {
  char buffer[33];
  const bool valid = format_clock_numeric_into(format, time, buffer);
  out = buffer;
  return valid;
}

inline bool clock_screensaver_needs_seconds(const std::string &time_format,
                                            const std::string &date_format) {
  const auto time = parse_clock_screensaver_format(time_format);
  const auto date = parse_clock_screensaver_format(date_format);
  return (time.valid && time.seconds) || (date.valid && date.seconds);
}
