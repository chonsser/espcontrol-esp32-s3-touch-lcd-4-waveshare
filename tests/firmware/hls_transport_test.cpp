#include "mpegts_demux.h"
#include "h264_video.h"
#include <cassert>
#include <fstream>
#include <iterator>
#include <vector>

using namespace esphome::hls_screensaver;

int main(int argc, char **argv) {
  // Invalid synchronization, scrambled packets and oversized adaptation fields
  // must be rejected without forwarding bytes to the video decoder.
  unsigned calls = 0;
  MpegTsDemux bad([&](const uint8_t *, size_t, uint64_t) { ++calls; return true; });
  uint8_t packet[188] = {};
  assert(!bad.feed(packet, sizeof(packet)));
  bad.reset(); packet[0] = 0x47; packet[3] = 0xd0;
  assert(!bad.feed(packet, sizeof(packet)));
  bad.reset(); packet[3] = 0x30; packet[4] = 184;
  assert(!bad.feed(packet, sizeof(packet)));
  assert(calls == 0);
  assert(pts_delta(100, (uint64_t(1) << 33) - 100) == 200);
  assert(pts_delta(90000, 180000) == -90000);

  if (argc == 2) {
    std::ifstream file(argv[1], std::ios::binary);
    std::vector<uint8_t> bytes((std::istreambuf_iterator<char>(file)), {});
    assert(!bytes.empty());
    AnnexBParser annex;
    unsigned sps = 0, slices = 0;
    uint64_t first_pts = 0, last_pts = 0;
    auto nal = [&](const uint8_t *data, size_t size) {
      if ((data[0] & 31) == 7) {
        VideoParameters p;
        assert(parse_sps(data, size, p));
        assert(p.width == 320 && p.height == 192);
        ++sps;
      }
      if ((data[0] & 31) == 1 || (data[0] & 31) == 5) ++slices;
      return true;
    };
    MpegTsDemux demux([&](const uint8_t *data, size_t size, uint64_t pts) {
      if (!first_pts) first_pts = pts;
      last_pts = pts;
      return annex.feed(data, size, nal);
    });
    // The parser cannot assume network reads are aligned to transport packets.
    for (size_t i = 0; i < bytes.size();) {
      size_t n = std::min<size_t>((i % 237) + 1, bytes.size() - i);
      assert(demux.feed(bytes.data() + i, n));
      i += n;
    }
    assert(demux.finish());
    assert(annex.finish(nal));
    assert(sps >= 1 && slices == 20);
    assert(last_pts - first_pts == 19 * 9000);
  }
  return 0;
}
