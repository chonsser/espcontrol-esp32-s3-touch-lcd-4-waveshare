#!/usr/bin/env python3
"""Guard the Waveshare memory savings without removing display features."""
import sys
import unittest
from pathlib import Path

try:
    import yaml
except ImportError:
    print("SKIP: PyYAML is required for profile checks")
    sys.exit(77)

ROOT = Path(__file__).resolve().parents[2]
DEVICE = ROOT / "devices/waveshare-esp32-s3-touch-lcd-4/device"


class Loader(yaml.SafeLoader):
    pass


Loader.add_multi_constructor("!", lambda loader, tag, node: loader.construct_scalar(node)
                             if isinstance(node, yaml.ScalarNode) else loader.construct_mapping(node))


class MemoryBudgetTest(unittest.TestCase):
    def test_large_media_fonts_keep_languages_and_sizes_at_two_bpp(self):
        fonts = {font["id"]: font for font in yaml.load((DEVICE / "fonts.yaml").read_text(), Loader=Loader)["font"]}
        media = {"font_cover_art_title": 70, "font_media_control_title": 60, "font_cover_art_artist": 40}
        for name, size in media.items():
            with self.subTest(font=name):
                font = fonts[name]
                self.assertEqual(font["bpp"], 2)
                self.assertEqual(font["size"], size)
                self.assertEqual(font["file"], "gfonts://Roboto@Light")
                self.assertEqual(font["glyphs"], "../../../common/assets/text_glyphs.yaml")
                self.assertEqual(font["extras"], [{"file": "gfonts://Heebo@Light", "glyphs": "../../../common/assets/hebrew_glyphs.yaml"}])
        for name, font in fonts.items():
            if name not in media:
                self.assertEqual(font["bpp"], 4, name)

    def test_media_raster_metrics_are_unchanged(self):
        try:
            from esphome.core import CORE
            from esphome.components.font import font_file_schema, _gfonts_ttf_path, glyph_to_glyphinfo
            from freetype import Face
        except ImportError:
            self.skipTest("ESPHome font tooling is required for raster comparison")
        CORE.config_path = ROOT / "builds/waveshare-esp32-s3-touch-lcd-4.factory.yaml"
        old_bytes = new_bytes = 0
        for family, glyph_file in (("Roboto@Light", "text_glyphs.yaml"), ("Heebo@Light", "hebrew_glyphs.yaml")):
            path = _gfonts_ttf_path(font_file_schema(f"gfonts://{family}"))
            if not path.exists():
                self.skipTest("Build the factory profile first to populate its pinned font cache")
            glyphs = set("".join(yaml.safe_load((ROOT / "common/assets" / glyph_file).read_text())))
            face = Face(str(path))
            for size in (70, 60, 40):
                for char in glyphs:
                    before = glyph_to_glyphinfo(char, face, size, 4)
                    after = glyph_to_glyphinfo(char, face, size, 2)
                    for metric in ("advance", "width", "height", "offset_x", "offset_y"):
                        self.assertEqual(getattr(before, metric), getattr(after, metric), (family, size, char, metric))
                    old_bytes += len(before.bitmap_data)
                    new_bytes += len(after.bitmap_data)
        self.assertLess(new_bytes, old_bytes * 0.51)
        print(f"Media bitmap bytes: {old_bytes:,} -> {new_bytes:,}; glyph metrics unchanged")

    def test_partial_draw_buffer_retains_rotation_and_atomic_presentation(self):
        config = yaml.load((DEVICE / "device.yaml").read_text(), Loader=Loader)
        lvgl = config["lvgl"]
        self.assertEqual(lvgl["buffer_size"], "25%")
        self.assertEqual(lvgl["rotation"], 0)
        self.assertIn("begin_frame()", str(lvgl["on_draw_start"]))
        self.assertIn("end_frame()", str(lvgl["on_draw_end"]))
        self.assertIn("lv_obj_invalidate", str(lvgl["on_draw_end"]))
        sdk = config["esp32"]["framework"]["sdkconfig_options"]
        for flag in ("CONFIG_SPIRAM_FETCH_INSTRUCTIONS", "CONFIG_SPIRAM_RODATA", "CONFIG_LCD_RGB_ISR_IRAM_SAFE"):
            self.assertEqual(sdk[flag], "y", flag)
        self.assertIn("tear_free: true", (DEVICE / "device.yaml").read_text())


if __name__ == "__main__":
    unittest.main()
