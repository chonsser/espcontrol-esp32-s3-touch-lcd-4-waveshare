#include "hls_playlist.h"
#include <cassert>
#include <string>

using namespace esphome::hls_screensaver;

int main() {
  assert(valid_url("http://192.168.1.10/live/index.m3u8?token=a%2Fb"));
  assert(valid_url("https://example.test:8443/live"));
  for (const auto *url : {"file:///tmp/x", "http://u:p@example.test/a", "http://example.test/a\r\nX:Y", "https://", "javascript:x", "http://host\\evil/x", "http://host/a#fragment"})
    assert(!valid_url(url));
  assert(resolve_url("http://host/a/b/list.m3u8?t=x", "../seg.ts?key=a") == "http://host/a/seg.ts?key=a");
  assert(resolve_url("https://host/a/list.m3u8", "/seg.ts") == "https://host/seg.ts");
  assert(resolve_url("https://host/a/list.m3u8", "//other.test/seg.ts") == "https://other.test/seg.ts");
  assert(resolve_url("https://host/a/list.m3u8?old", "?new") == "https://host/a/list.m3u8?new");
  Playlist p;
  std::string error;
  const std::string media = "#EXTM3U\r\n#EXT-X-TARGETDURATION:2\r\n#EXT-X-MEDIA-SEQUENCE:42\r\n#EXTINF:2.0,\r\na.ts\r\n#EXT-X-DISCONTINUITY\r\n#EXTINF:1.5,\r\nb.ts\r\n#EXT-X-ENDLIST\r\n";
  assert(parse_playlist(media, "https://host/live/list.m3u8", p, error));
  assert(p.segments.size() == 2 && p.sequence == 42 && p.end_list);
  assert(p.segments[0].url == "https://host/live/a.ts");
  assert(p.segments[1].duration_ms == 1500 && p.segments[1].discontinuity);
  const std::string master = "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1500000,RESOLUTION=1280x720,CODECS=\"avc1.64001f,mp4a.40.2\"\nhigh.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=250000,RESOLUTION=320x192,CODECS=\"avc1.42c00d,mp4a.40.2\"\nlow.m3u8\n";
  assert(parse_playlist(master, "http://host/master.m3u8", p, error));
  assert(p.variant == "http://host/low.m3u8" && p.segments.empty());
  for (const auto *tag : {"#EXT-X-KEY:METHOD=AES-128,URI=\"key\"", "#EXT-X-MAP:URI=\"init.mp4\"", "#EXT-X-BYTERANGE:12@0", "#EXT-X-PART:DURATION=0.2,URI=\"p.ts\"", "#EXT-X-I-FRAMES-ONLY"}) {
    assert(!parse_playlist(std::string("#EXTM3U\n#EXT-X-TARGETDURATION:2\n") + tag + "\n#EXTINF:2,\na.ts\n", "http://host/l", p, error));
    assert(!error.empty());
  }
  for (const auto *body : {"garbage", "#EXTM3U\n#EXTINF:nan,\nx.ts", "#EXTM3U\n#EXTINF:100,\nx.ts", "#EXTM3U\n#EXTINF:2,\nfile:///x", "#EXTM3U\n#EXTINF:2,\n", "#EXTM3U\n#EXT-X-MEDIA-SEQUENCE:18446744073709551616\n"})
    assert(!parse_playlist(body, "http://host/list", p, error));
  assert(!parse_playlist(std::string(17000, 'a'), "http://host/list", p, error));
  return 0;
}
