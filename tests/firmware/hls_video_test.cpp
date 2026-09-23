#include "h264_video.h"

#include <cassert>
#include <cstdint>
#include <vector>

using namespace esphome::hls_screensaver;

int main() {
  // BT.601 studio-range I420, two rows sharing one chroma row.
  const uint8_t black[] = {16, 16, 16, 16, 128, 128};
  const uint8_t white[] = {235, 235, 235, 235, 128, 128};
  uint16_t pixels[4] = {};
  assert(i420_to_rgb565(black, sizeof(black), 2, 2, pixels, 4));
  for (auto pixel : pixels) assert(pixel == 0);
  assert(i420_to_rgb565(white, sizeof(white), 2, 2, pixels, 4));
  for (auto pixel : pixels) assert(pixel == 0xffff);
  assert(!i420_to_rgb565(white, 5, 2, 2, pixels, 4));
  assert(!i420_to_rgb565(white, 6, 3, 2, pixels, 4));
  assert(!i420_to_rgb565(white, 6, 2, 2, pixels, 3));

  // 320x192 constrained-baseline SPS generated from the documented fixture.
  // The fixture integration test below also validates actual encoder output.
  VideoParameters params;
  const uint8_t baseline[] = {0x67,0x42,0xc0,0x0d,0xda,0x05,0x06,0x6c,0x04,0x40,0,0,3,0,0x40,0,0,5,3,0xc5,0x0a,0xa8};
  assert(parse_sps(baseline, sizeof(baseline), params));
  assert(params.width == 320 && params.height == 192);
  assert(params.coded_width == 320 && params.coded_height == 192);
  const uint8_t pps[] = {0x68,0xce,0x32,0xc8};
  uint32_t pps_id = 99;
  assert(parse_pps(pps, sizeof(pps), params.sps_id, pps_id));
  assert(pps_id == 0);
  const uint8_t cabac[] = {0x68, 0xee, 0x32, 0xc8};
  assert(!parse_pps(cabac, sizeof(cabac), params.sps_id, pps_id));
  const uint8_t truncated[] = {0x67, 0x42};
  assert(!parse_sps(truncated, sizeof(truncated), params));
  const uint8_t high_profile[] = {0x67, 0x64, 0, 0x1f, 0xff};
  assert(!parse_sps(high_profile, sizeof(high_profile), params));

  // Annex-B start codes can cross arbitrary transport boundaries.
  std::vector<std::vector<uint8_t>> nals;
  AnnexBParser parser;
  auto consume = [&](const uint8_t *data, size_t size) {
    nals.emplace_back(data, data + size);
    return true;
  };
  const uint8_t stream[] = {0, 0, 0, 1, 0x09, 0xf0, 0, 0, 1, 0x65, 0x88, 0x80};
  for (auto byte : stream) assert(parser.feed(&byte, 1, consume));
  assert(parser.finish(consume));
  assert(nals.size() == 2);
  assert((nals[0] == std::vector<uint8_t>{0x09, 0xf0}));
  assert((nals[1] == std::vector<uint8_t>{0x65, 0x88, 0x80}));
  parser.reset();
  std::vector<uint8_t> oversized(128 * 1024 + 1, 0x55);
  const uint8_t start[] = {0, 0, 1, 0x65};
  assert(parser.feed(start, sizeof(start), consume));
  assert(!parser.feed(oversized.data(), oversized.size(), consume));
  parser.reset();
  std::vector<uint64_t> stamps;
  auto timed = [&](const uint8_t *, size_t, uint64_t pts) { stamps.push_back(pts); return true; };
  assert(parser.feed_timed(stream, 6, 90000, timed));
  assert(parser.feed_timed(stream + 6, sizeof(stream) - 6, 99000, timed));
  assert(parser.finish_timed(timed));
  assert((stamps == std::vector<uint64_t>{90000, 99000}));
  return 0;
}
