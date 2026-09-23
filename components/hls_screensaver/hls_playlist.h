#pragma once

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdlib>
#include <limits>
#include <string>
#include <vector>

namespace esphome::hls_screensaver {

inline constexpr size_t MAX_URL = 2048;
inline constexpr size_t MAX_PLAYLIST = 16 * 1024;
inline constexpr size_t MAX_SEGMENT = 256 * 1024;

inline bool starts_with(const std::string &s, const char *prefix) { return s.rfind(prefix, 0) == 0; }

inline bool valid_url(const std::string &url) {
  const size_t scheme = starts_with(url, "http://") ? 7 : starts_with(url, "https://") ? 8 : 0;
  if (!scheme || url.size() > MAX_URL || url.size() <= scheme) return false;
  for (unsigned char c : url) if (c <= 32 || c >= 127 || c == '\\' || c == '#') return false;
  auto end = url.find_first_of("/?", scheme);
  auto authority = url.substr(scheme, end == std::string::npos ? end : end - scheme);
  if (authority.empty() || authority.find('@') != std::string::npos || authority.find('%') != std::string::npos) return false;
  std::string port;
  if (authority.front() == '[') {
    auto close = authority.find(']');
    if (close == std::string::npos || close < 3) return false;
    if (close + 1 < authority.size()) {
      if (authority[close + 1] != ':') return false;
      port = authority.substr(close + 2);
      if (port.empty()) return false;
    }
  } else {
    auto colon = authority.find(':');
    if (colon != std::string::npos) {
      port = authority.substr(colon + 1);
      authority.resize(colon);
      if (port.empty()) return false;
    }
    if (authority.empty()) return false;
    for (unsigned char c : authority)
      if (!((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '.' || c == '-' || c == '_')) return false;
  }
  if (!port.empty()) {
    uint32_t value = 0;
    if (port.size() > 5) return false;
    for (char c : port) { if (c < '0' || c > '9') return false; value = value * 10 + unsigned(c - '0'); }
    if (!value || value > 65535) return false;
  }
  return true;
}

inline std::string resolve_url(const std::string &base, const std::string &ref) {
  if (!valid_url(base) || ref.empty()) return {};
  if (starts_with(ref, "http://") || starts_with(ref, "https://")) return valid_url(ref) ? ref : std::string{};
  if (ref.find(":") != std::string::npos && ref.find(':') < ref.find_first_of("/?")) return {};
  const auto scheme_end = base.find("://") + 3;
  const auto authority_end = base.find_first_of("/?", scheme_end);
  const auto origin = base.substr(0, authority_end);
  if (starts_with(ref, "//")) {
    const auto url = base.substr(0, scheme_end - 2) + ref;
    return valid_url(url) ? url : std::string{};
  }
  auto base_path = authority_end == std::string::npos || base[authority_end] == '?' ? "/" : base.substr(authority_end);
  base_path.resize(base_path.find('?') == std::string::npos ? base_path.size() : base_path.find('?'));
  std::string path = ref.front() == '/' ? ref : ref.front() == '?' ? base_path + ref : base_path.substr(0, base_path.rfind('/') + 1) + ref;
  auto query_pos = path.find('?');
  const auto query = query_pos == std::string::npos ? std::string{} : path.substr(query_pos);
  if (query_pos != std::string::npos) path.resize(query_pos);
  std::vector<std::string> parts;
  for (size_t pos = 1; pos <= path.size();) {
    auto end = path.find('/', pos);
    auto part = path.substr(pos, end == std::string::npos ? end : end - pos);
    if (part == "..") { if (!parts.empty()) parts.pop_back(); }
    else if (part != ".") parts.push_back(part);
    if (end == std::string::npos) break;
    pos = end + 1;
  }
  std::string url = origin + "/";
  for (size_t i = 0; i < parts.size(); ++i) { if (i) url += '/'; url += parts[i]; }
  url += query;
  return valid_url(url) ? url : std::string{};
}

inline bool unsigned_number(const std::string &s, uint64_t &out) {
  if (s.empty()) return false;
  out = 0;
  for (char c : s) {
    if (c < '0' || c > '9' || out > (std::numeric_limits<uint64_t>::max() - unsigned(c - '0')) / 10) return false;
    out = out * 10 + unsigned(c - '0');
  }
  return true;
}

inline std::string attribute(const std::string &line, const std::string &key) {
  auto pos = line.find(':');
  if (pos == std::string::npos) return {};
  ++pos;
  while (pos < line.size()) {
    const auto eq = line.find('=', pos);
    if (eq == std::string::npos) break;
    const auto name = line.substr(pos, eq - pos);
    auto begin = eq + 1;
    const bool quoted = begin < line.size() && line[begin] == '"';
    if (quoted) ++begin;
    auto end = line.find(quoted ? '"' : ',', begin);
    if (quoted && end == std::string::npos) return {};
    if (name == key) return line.substr(begin, end == std::string::npos ? end : end - begin);
    if (end == std::string::npos) break;
    pos = end + (quoted ? 2 : 1);
  }
  return {};
}

struct Segment {
  std::string url;
  uint32_t duration_ms{0};
  bool discontinuity{false};
};
struct Playlist {
  std::vector<Segment> segments;
  std::string variant;
  uint64_t sequence{0};
  uint32_t target_ms{0};
  bool end_list{false};
};

inline bool parse_playlist(const std::string &text, const std::string &url, Playlist &out, std::string &error) {
  out = {};
  error.clear();
  auto fail = [&](const char *message) { error = message; return false; };
  if (text.size() > MAX_PLAYLIST || !valid_url(url)) return fail("Playlist or URL exceeds limits");
  bool first = true, variant_pending = false, variant_ok = false, discontinuity = false;
  bool master = false;
  unsigned variant_count = 0;
  uint32_t duration = 0;
  uint64_t variant_bandwidth = 0, best_bandwidth = std::numeric_limits<uint64_t>::max();
  for (size_t pos = 0; pos < text.size();) {
    auto end = text.find('\n', pos);
    auto line = text.substr(pos, end == std::string::npos ? end : end - pos);
    pos = end == std::string::npos ? text.size() : end + 1;
    if (!line.empty() && line.back() == '\r') line.pop_back();
    if (first) { first = false; if (line != "#EXTM3U") return fail("Not an HLS playlist"); continue; }
    if (line.empty()) continue;
    if (line.size() > MAX_URL + 256 || line.find('\0') != std::string::npos) return fail("Invalid playlist line");
    if (starts_with(line, "#EXT-X-KEY:") || starts_with(line, "#EXT-X-SESSION-KEY:")) {
      if (attribute(line, "METHOD") != "NONE") return fail("Encrypted HLS is not supported");
    } else if (starts_with(line, "#EXT-X-MAP:") || starts_with(line, "#EXT-X-BYTERANGE:") ||
               starts_with(line, "#EXT-X-PART") || starts_with(line, "#EXT-X-PRELOAD-HINT:") ||
               starts_with(line, "#EXT-X-SKIP:") || starts_with(line, "#EXT-X-I-FRAME")) {
      return fail("Only full MPEG-TS HLS segments are supported");
    } else if (starts_with(line, "#EXT-X-STREAM-INF:")) {
      if (variant_pending || !out.segments.empty() || duration || ++variant_count > 64) return fail("Invalid master playlist");
      master = variant_pending = true;
      variant_ok = unsigned_number(attribute(line, "BANDWIDTH"), variant_bandwidth) && variant_bandwidth > 0 && variant_bandwidth <= 512000;
      const auto resolution = attribute(line, "RESOLUTION");
      if (!resolution.empty()) {
        auto split = resolution.find('x'); uint64_t w = 0, h = 0;
        variant_ok &= split != std::string::npos && unsigned_number(resolution.substr(0, split), w) &&
                      unsigned_number(resolution.substr(split + 1), h) && w > 0 && h > 0 && w <= 320 && h <= 192;
      }
      const auto codecs = attribute(line, "CODECS");
      if (!codecs.empty()) variant_ok &= codecs.find("avc1.42") != std::string::npos && codecs.find("hvc") == std::string::npos;
    } else if (starts_with(line, "#EXT-X-MEDIA-SEQUENCE:")) {
      if (!out.segments.empty() || !unsigned_number(line.substr(22), out.sequence) || out.sequence > UINT64_MAX - 64) return fail("Invalid media sequence");
    } else if (starts_with(line, "#EXT-X-TARGETDURATION:")) {
      uint64_t seconds = 0;
      if (!unsigned_number(line.substr(22), seconds) || seconds == 0 || seconds > 10) return fail("Segments must be at most 10 seconds");
      out.target_ms = uint32_t(seconds * 1000);
    } else if (starts_with(line, "#EXTINF:")) {
      if (master || duration) return fail("Invalid segment duration");
      const auto value = line.substr(8, line.find(',') == std::string::npos ? std::string::npos : line.find(',') - 8);
      char *tail = nullptr;
      const double seconds = std::strtod(value.c_str(), &tail);
      if (value.empty() || *tail || !std::isfinite(seconds) || seconds < 0.001 || seconds > 10) return fail("Invalid segment duration");
      duration = uint32_t(std::round(seconds * 1000));
    } else if (line == "#EXT-X-DISCONTINUITY") {
      discontinuity = true;
    } else if (line == "#EXT-X-ENDLIST") {
      out.end_list = true;
    } else if (line[0] != '#') {
      const auto resolved = resolve_url(url, line);
      if (resolved.empty()) return fail("Invalid segment URL");
      if (variant_pending) {
        if (variant_ok && variant_bandwidth < best_bandwidth) { out.variant = resolved; best_bandwidth = variant_bandwidth; }
        variant_pending = false;
      } else {
        if (master || !duration || out.segments.size() >= 64) return fail("Invalid or oversized media playlist");
        out.segments.push_back({resolved, duration, discontinuity});
        duration = 0; discontinuity = false;
      }
    }
  }
  if (duration || variant_pending) return fail("Incomplete playlist");
  if (master) return !out.variant.empty() || fail("No compatible low-resolution H.264 variant");
  return (!out.segments.empty() && out.target_ms) || fail("Empty or incomplete media playlist");
}

}  // namespace esphome::hls_screensaver
