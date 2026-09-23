#pragma once
#include <cstdint>

namespace esphome::hls_screensaver {

// PES PTS anchors only the first picture starting in that PES. Identity must
// survive fragmentation so later pictures do not reuse that explicit anchor.
struct PesTimestamp {
  uint64_t value{0};
  uint64_t sequence{0};
  bool present{false};
};

}  // namespace esphome::hls_screensaver
