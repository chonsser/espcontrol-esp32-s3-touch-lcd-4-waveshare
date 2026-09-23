#include "playback_policy.h"
#include <cassert>
#include <vector>
using namespace esphome::hls_screensaver;

struct Bits {
  std::vector<uint8_t> bytes{0x67};
  unsigned count{0};
  void put(uint32_t value, unsigned n) {
    while (n--) {
      if (count % 8 == 0) bytes.push_back(0);
      bytes.back() |= ((value >> n) & 1) << (7 - count++ % 8);
    }
  }
  void ue(uint32_t value) {
    unsigned n = 0;
    for (auto v = value + 1; v >>= 1;) ++n;
    put(0, n); put(value + 1, n + 1);
  }
};

int main() {
  Bits sps;
  sps.put(66, 8); sps.put(0x40, 8); sps.put(13, 8);
  sps.ue(0); sps.ue(0); sps.ue(2); sps.ue(1); sps.put(0, 1);
  sps.ue(19); sps.ue(11); sps.put(1, 1); sps.put(1, 1); sps.put(0, 1);
  sps.put(1, 1); // VUI present
  sps.put(0, 4); // no aspect, overscan, video signal or chroma location
  sps.put(1, 1); sps.put(1, 32); sps.put(20, 32); sps.put(1, 1); // fixed 10 fps
  // Escape the synthetic RBSP as an actual Annex-B SPS.
  std::vector<uint8_t> escaped;
  unsigned zeros = 0;
  for (auto byte : sps.bytes) {
    if (zeros >= 2 && byte <= 3) { escaped.push_back(3); zeros = 0; }
    escaped.push_back(byte); zeros = byte == 0 ? zeros + 1 : 0;
  }
  VideoParameters parameters;
  assert(parse_sps(escaped.data(), escaped.size(), parameters));
  assert(parameters.fixed_frame_rate && parameters.num_units_in_tick == 1 && parameters.time_scale == 20);

  PictureTimestamps timestamps;
  PlaybackClock clock;
  uint64_t pts, due;
  auto picture = [&](PesTimestamp stamp) {
    assert(timestamps.resolve(stamp, parameters, pts));
    assert(clock.schedule(pts, 1000, due));
  };
  picture({126000, 1, true}); assert(due == 1000);
  picture({126000, 1, true}); assert(pts == 135000 && due == 1100); // second picture, same PES
  picture({0, 2, false}); assert(pts == 144000 && due == 1200); // no PTS in next PES
  picture({153000, 3, true}); assert(due == 1300); // next explicit anchor
  assert(timestamps.resolve({153000, 4, true}, parameters, pts));
  assert(!clock.schedule(pts, 1000, due)); // a NEW, duplicate explicit PTS is not inferred away

  timestamps.reset(); clock.reset();
  picture({(uint64_t(1) << 33) - 4500, 5, true});
  picture({0, 6, false}); assert(pts == 4500);
  timestamps.reset();
  assert(!timestamps.resolve({0, 1, false}, parameters, pts)); // no anchor
  parameters.fixed_frame_rate = false;
  assert(timestamps.resolve({90000, 1, true}, parameters, pts));
  assert(!timestamps.resolve({90000, 1, true}, parameters, pts)); // never invent cadence
  parameters.fixed_frame_rate = true; parameters.time_scale = 60;
  assert(!timestamps.resolve({90000, 1, true}, parameters, pts)); // declared 30 fps
  parameters.num_units_in_tick = 1001; parameters.time_scale = 24000;
  timestamps.reset();
  assert(timestamps.resolve({0, 7, true}, parameters, pts));
  assert(timestamps.resolve({0, 7, true}, parameters, pts) && pts == 7507);
  assert(timestamps.resolve({0, 7, true}, parameters, pts) && pts == 15015); // fractional remainder

  // A later slice of a picture can cross into the PES that anchors the NEXT
  // picture. Keep the timestamp of the first slice until that picture is done.
  timestamps.reset();
  const uint8_t first_slice[] = {0x65, 0x80}; // first_mb_in_slice = 0
  const uint8_t next_slice[] = {0x65, 0x40}; // first_mb_in_slice = 1
  assert(!timestamps.begin_slice(next_slice, sizeof(next_slice), {126000, 1, true}));
  assert(timestamps.begin_slice(first_slice, sizeof(first_slice), {126000, 1, true}));
  assert(timestamps.begin_slice(next_slice, sizeof(next_slice), {135000, 2, true}));
  assert(timestamps.resolve_picture(parameters, pts) && pts == 126000);
  assert(timestamps.begin_slice(first_slice, sizeof(first_slice), {135000, 2, true}));
  assert(timestamps.resolve_picture(parameters, pts) && pts == 135000);
}
