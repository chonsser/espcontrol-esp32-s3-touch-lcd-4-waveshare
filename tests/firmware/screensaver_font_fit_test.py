"""Fit every numeric time using the actual ESPHome 4bpp raster/advance metrics.

Run explicitly with the ESPHome venv, outside dependency-light host CTest:
  /path/to/esphome/venv/bin/python tests/firmware/screensaver_font_fit_test.py
New static sources are pinned build-time URLs with identical local metric
fixtures (verified by SHA-256). Legacy Thin continues using gfonts; pass
--legacy-font for an existing build cache, otherwise ESPHome resolves its
normal Google Fonts cache (build-time only).
"""
import argparse
import hashlib
import json
import struct
from functools import lru_cache
from pathlib import Path
import re

import yaml
from freetype import Face
from esphome.components.font import glyph_to_glyphinfo, pt_to_px

ROOT = Path(__file__).resolve().parents[2]


class Loader(yaml.SafeLoader):
    pass


Loader.add_multi_constructor("!", lambda loader, tag, node: loader.construct_scalar(node)
                             if isinstance(node, yaml.ScalarNode) else loader.construct_mapping(node))


def read_yaml(path):
    return yaml.load(path.read_text(), Loader=Loader)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--legacy-font", type=Path)
    args = parser.parse_args()
    config = read_yaml(ROOT / "common/device/screen_clock.yaml")
    fonts = {font["id"]: font for font in config["font"]}
    assert {"font_number_clock", "font_number_clock_bold", "font_number_clock_mono"} <= fonts.keys(), \
        "Clock must offer Thin, Bold and Mono compiled fonts"
    times = [f"{hour:02d}:{minute:02d}" for hour in range(24) for minute in range(60)]
    times += [f"{hour}:{minute:02d}" for hour in range(1, 13) for minute in range(60)]
    legacy_clipping = []

    def font_path(font):
        if font["id"] == "font_number_clock":
            if args.legacy_font:
                return args.legacy_font
            from esphome.core import CORE
            from esphome.components.font import font_file_schema, _gfonts_ttf_path
            CORE.config_path = ROOT / "builds/screensaver-font-fit.yaml"
            spec = font_file_schema(font["file"])
            return _gfonts_ttf_path(spec)
        assets = ROOT / "common/assets/fonts"
        sources = json.loads((assets / "screensaver-font-sources.json").read_text())
        filename, provenance = next((name, record) for name, record in sources.items()
                                    if record["source"] == font["file"])
        path = assets / filename
        data = path.read_bytes()
        assert hashlib.sha256(data).hexdigest() == provenance["sha256"], f"Wrong source bytes: {filename}"
        tables = {}
        for i in range(struct.unpack_from(">H", data, 4)[0]):
            tag, _, offset, _ = struct.unpack_from(">4sIII", data, 12 + 16 * i)
            tables[tag] = offset
        assert b"fvar" not in tables, f"Expected static font: {filename}"
        weight = struct.unpack_from(">H", data, tables[b"OS/2"] + 4)[0]
        assert weight == (700 if font["id"] == "font_number_clock_bold" else 400)
        return path

    @lru_cache(maxsize=None)
    def metrics(font_id, size):
        font = fonts[font_id]
        assert font["bpp"] == 4 and font["glyphs"] == " 0123456789:"
        face = Face(str(font_path(font)))
        expected = {"font_number_clock": (b"Roboto", b"Thin"),
                    "font_number_clock_bold": (b"Roboto", b"Bold"),
                    "font_number_clock_mono": (b"Roboto Mono", b"Regular")}[font_id]
        assert (face.family_name, face.style_name) == expected, (font_id, face.family_name, face.style_name)
        glyphs = {c: glyph_to_glyphinfo(c, face, size, 4) for c in font["glyphs"]}
        line_height = pt_to_px(face.size.height)
        all_metrics = []
        for text in times:
            pen = 0
            left, right, top, bottom = 0, 0, 0, 0
            for c in text:
                g = glyphs[c]
                left = min(left, pen + g.offset_x)
                right = max(right, pen + g.offset_x + g.width)
                top = min(top, g.offset_y)
                bottom = max(bottom, g.offset_y + g.height)
                pen += g.advance  # ESPHome LVGL callback uses advance; no kerning.
            all_metrics.append((text, pen, line_height, left, right, top, bottom))
        print(f"{font_id} {size}px: max label {max(m[1] for m in all_metrics)}x{line_height}; "
              f"ink bounds x={min(m[3] for m in all_metrics)}..{max(m[4] for m in all_metrics)} "
              f"y={min(m[5] for m in all_metrics)}..{max(m[6] for m in all_metrics)}; "
              f"4bpp glyph bytes={sum(len(g.bitmap_data) for g in glyphs.values())}")
        return all_metrics

    profiles = 0
    for path in sorted((ROOT / "devices").glob("*/packages.yaml")):
        substitutions = read_yaml(path)["substitutions"]
        if "clock_font_size" not in substitutions:
            continue
        profiles += 1
        width, height = (int(substitutions[key]) for key in ("screen_width", "screen_height"))
        for font_id, font in fonts.items():
            value = str(font["size"])
            while "${" in value:
                key = re.fullmatch(r"\$\{(\w+)\}", value).group(1)
                value = str(substitutions.get(key, config.get("substitutions", {}).get(key, "")))
            size = int(value)
            for rotation in (0, 90, 180, 270):
                w, h = (width, height) if rotation % 180 == 0 else (height, width)
                for text, label_w, label_h, left, right, top, bottom in metrics(font_id, size):
                    fits = label_w <= w and label_h <= h and left >= 0 and top >= 0 and right <= label_w and bottom <= label_h
                    if not fits:
                        issue = f"{path.parent.name} {rotation}deg {font_id}@{size}: {text} {label_w}x{label_h} into {w}x{h}"
                        if font_id == "font_number_clock":
                            legacy_clipping.append(issue)
                        else:
                            raise AssertionError(issue)
        print(f"{path.parent.name}: 12h/24h, all fonts, all four rotations checked")
    assert profiles > 0
    if legacy_clipping:
        print(f"Existing Thin clipping ({len(legacy_clipping)} cases, legacy size unchanged):")
        for issue in legacy_clipping[:12]:
            print(issue)
    else:
        print("No pre-existing Thin clipping at the measured compiled sizes.")
    print(f"Font fit passed: {profiles} profiles, 4 rotations, {len(times)} numeric times per font.")


if __name__ == "__main__":
    main()
