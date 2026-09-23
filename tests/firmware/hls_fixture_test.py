"""Exercise the bounded TS/H.264 parser against a reproducible real HLS stream.

Requires local ffmpeg/ffprobe with libx264. No network or panel is involved.
"""
import json
from pathlib import Path
import subprocess
import sys
import tempfile


def main():
    parser = str(Path(sys.argv[1]).resolve())
    with tempfile.TemporaryDirectory(prefix="espcontrol-hls-") as temporary:
        playlist = Path(temporary) / "fixture.m3u8"
        subprocess.run([
            "ffmpeg", "-hide_banner", "-loglevel", "error", "-f", "lavfi",
            "-i", "testsrc2=size=320x192:rate=10", "-t", "6", "-an",
            "-c:v", "libx264", "-profile:v", "baseline", "-level:v", "1.3",
            "-pix_fmt", "yuv420p", "-b:v", "180k", "-maxrate", "240k",
            "-bufsize", "480k", "-bf", "0", "-refs", "1", "-g", "20",
            "-keyint_min", "20", "-sc_threshold", "0", "-x264-params",
            "repeat-headers=1:aud=1:force-cfr=1", "-f", "hls", "-hls_time", "2",
            "-hls_list_size", "0", "-hls_flags", "independent_segments",
            str(playlist),
        ], check=True, timeout=60)
        segment = Path(temporary) / "fixture0.ts"
        probe = subprocess.run([
            "ffprobe", "-v", "error", "-select_streams", "v:0",
            "-show_entries", "stream=codec_name,profile,width,height,r_frame_rate",
            "-of", "json", str(segment),
        ], check=True, capture_output=True, text=True, timeout=20)
        stream = json.loads(probe.stdout)["streams"][0]
        assert stream["codec_name"] == "h264"
        assert stream["profile"] == "Constrained Baseline"
        assert (stream["width"], stream["height"]) == (320, 192)
        assert stream["r_frame_rate"] == "10/1"
        # The executable checks split packet boundaries, SPS, 20 video slices
        # and the 90 kHz timestamp span in each independent two-second segment.
        for segment in sorted(Path(temporary).glob("fixture*.ts")):
            subprocess.run([parser, str(segment)], check=True, timeout=20)


if __name__ == "__main__":
    main()
