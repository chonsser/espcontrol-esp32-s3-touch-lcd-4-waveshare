#!/usr/bin/env python3
"""Keep the offline icon picker complete without embedding the full MDI font."""
import base64
import re
import sys
import json
import tempfile
import unittest
from unittest.mock import patch
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))
import build


class WebIconFontTest(unittest.TestCase):
    def test_embedded_font_is_bounded_and_covers_every_editor_icon(self):
        css = build.embedded_web_mdi_styles()
        encoded = re.search(r"data:font/ttf;base64,([A-Za-z0-9+/=]+)", css).group(1)
        font = base64.b64decode(encoded, validate=True)
        self.assertEqual(font[:4], b"\x00\x01\x00\x00")
        self.assertLess(len(font), 200_000, "Do not embed thousands of unused MDI glyphs")
        icons = build.load_json(build.ICONS_JSON)
        codepoints = build.web_mdi_icon_codepoints(icons)
        for name in build.web_mdi_icon_names(icons, codepoints):
            self.assertIn(f".mdi-{name}::before{{content:'\\{codepoints[name]}'}}", css)

    def test_stale_font_or_new_icon_requires_regeneration(self):
        manifest = json.loads(build.MDI_WEB_SUBSET_MANIFEST.read_text())
        required = manifest["codepoints"]
        self.assertEqual(build.load_web_icon_font(required), build.MDI_WEB_SUBSET.read_bytes())
        with self.assertRaises(build.BuildError):
            build.load_web_icon_font([*required, 0x10FFFF])
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "font.json"
            for field in ("source_sha256", "subset_sha256", "codepoints"):
                with self.subTest(field=field):
                    broken = dict(manifest)
                    broken[field] = [] if field == "codepoints" else "stale"
                    path.write_text(json.dumps(broken))
                    with patch.object(build, "MDI_WEB_SUBSET_MANIFEST", path):
                        with self.assertRaises(build.BuildError):
                            build.load_web_icon_font(required)


if __name__ == "__main__":
    unittest.main()
