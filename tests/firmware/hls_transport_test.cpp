#include "mpegts_demux.h"
#include "h264_video.h"
#include "playback_policy.h"
#include <cassert>
#include <fstream>
#include <iterator>
#include <vector>

using namespace esphome::hls_screensaver;

int main(int argc, char **argv) {
  // Invalid synchronization, scrambled packets and oversized adaptation fields
  // must be rejected without forwarding bytes to the video decoder.
  unsigned calls = 0;
  MpegTsDemux bad([&](const uint8_t *, size_t, const PesTimestamp &) { ++calls; return true; });
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
    MpegTsDemux demux([&](const uint8_t *data, size_t size, const PesTimestamp &pts) {
      assert(pts.present);
      if (!first_pts) first_pts = pts.value;
      last_pts = pts.value;
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

    // Repacketize the SAME elementary video with different PES boundaries.
    // One PES contains many pictures; a continuation PES has no PTS at all.
    std::vector<uint8_t> elementary, remuxed;
    MpegTsDemux gather([&](const uint8_t *data, size_t size, const PesTimestamp &) {
      elementary.insert(elementary.end(), data, data + size); return true;
    });
    assert(gather.feed(bytes.data(), bytes.size()) && gather.finish());
    uint16_t video_pid = 0;
    for (size_t offset = 0; offset < bytes.size(); offset += 188) {
      const auto *p = bytes.data() + offset;
      const unsigned payload = 4 + ((p[3] & 0x20) ? 1 + p[4] : 0);
      if ((p[1] & 0x40) && payload + 4 < 188 && p[payload] == 0 && p[payload + 1] == 0 &&
          p[payload + 2] == 1 && (p[payload + 3] & 0xf0) == 0xe0) {
        video_pid = ((p[1] & 31) << 8) | p[2]; break;
      }
      remuxed.insert(remuxed.end(), p, p + 188); // includes the real PAT/PMT
    }
    assert(video_pid != 0 && !elementary.empty());
    unsigned cc = 0;
    auto packetize = [&](const std::vector<uint8_t> &pes) {
      for (size_t i = 0; i < pes.size();) {
        const auto n = std::min<size_t>(170, pes.size() - i);
        uint8_t p[188]; std::fill(p, p + 188, 0xff);
        p[0] = 0x47; p[1] = (video_pid >> 8) | (i == 0 ? 0x40 : 0);
        p[2] = video_pid & 255; p[3] = 0x30 | (cc++ & 15);
        p[4] = 183 - n; p[5] = 0;
        std::copy_n(pes.data() + i, n, p + 188 - n);
        remuxed.insert(remuxed.end(), p, p + 188); i += n;
      }
    };
    const auto t = first_pts;
    std::vector<uint8_t> first_pes{0,0,1,0xe0,0,0,0x80,0x80,5,
      uint8_t(0x21 | ((t >> 29) & 14)), uint8_t(t >> 22), uint8_t(((t >> 14) & 0xfe) | 1),
      uint8_t(t >> 7), uint8_t(((t << 1) & 0xfe) | 1)};
    const size_t split = elementary.size() / 2;
    first_pes.insert(first_pes.end(), elementary.begin(), elementary.begin() + split);
    packetize(first_pes);
    std::vector<uint8_t> continuation{0,0,1,0xe0,0,0,0x80,0,0};
    continuation.insert(continuation.end(), elementary.begin() + split, elementary.end());
    packetize(continuation);
    std::vector<uint8_t> recovered;
    VideoParameters parameters;
    PictureTimestamps timestamps;
    PlaybackClock presentation;
    AnnexBParser remux_annex;
    unsigned pictures = 0;
    auto timed_nal = [&](const uint8_t *data, size_t size, const PesTimestamp &stamp) {
      const unsigned type = data[0] & 31;
      if (type == 7) assert(parse_sps(data, size, parameters));
      if (type == 1 || type == 5) {
        BitReader bits(data + 1, size - 1);
        if (bits.ue() == 0) { // one emitted picture per access unit, not per slice
          uint64_t pts, due;
          assert(timestamps.resolve(stamp, parameters, pts));
          assert(presentation.schedule(pts, 1000, due));
          assert(due == 1000 + pictures * 100);
          ++pictures;
        }
      }
      return true;
    };
    MpegTsDemux alternative([&](const uint8_t *data, size_t size, const PesTimestamp &stamp) {
      recovered.insert(recovered.end(), data, data + size);
      return remux_annex.feed_timed(data, size, stamp, timed_nal);
    });
    assert(alternative.feed(remuxed.data(), remuxed.size()) && alternative.finish());
    assert(remux_annex.finish_timed(timed_nal));
    assert(recovered == elementary && pictures == 20);
  }
  return 0;
}
