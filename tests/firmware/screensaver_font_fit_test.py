"""Check compiled 4bpp rasters and execute the real firmware size selector.

Explicit optional-dependency validation, never part of generic host CTest:
  /path/to/esphome/venv/bin/python tests/firmware/screensaver_font_fit_test.py
Pinned Bold/Mono sources are checked against vendored provenance. Thin uses
ESPHome's build-time gfonts cache; --legacy-font can select an existing cache.
Tests every legacy numeric time unchanged, every new separator's raster extent,
all compiled pool sizes, 32-character outputs and combined time/date layouts at
all profile dimensions/rotations. The layout algorithm is production C++, not a
Python reimplementation; its LVGL metric boundary gets real ESPHome glyph data.
"""
import argparse
import hashlib
import json
import os
import struct
import subprocess
import tempfile
from functools import lru_cache
from pathlib import Path
import re

import yaml
from freetype import Face
from esphome.components.font import glyph_to_glyphinfo, pt_to_px
from screensaver_appearance_test import helper_source, cpp_string

ROOT = Path(__file__).resolve().parents[2]
GLYPHS = " 0123456789:./-"
SIZES = (24, 40, 64, 96, 128)
FAMILIES = ("font_number_clock", "font_number_clock_bold", "font_number_clock_mono")


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
    required = {name for family in FAMILIES for name in (family, *(f"{family}_{size}" for size in SIZES))}
    assert required <= fonts.keys(), "Each family needs the legacy font and the complete compiled size pool"
    times = [f"{hour:02d}:{minute:02d}" for hour in range(24) for minute in range(60)]
    times += [f"{hour}:{minute:02d}" for hour in range(1, 13) for minute in range(60)]
    legacy_clipping = []
    assets = ROOT / "common/assets/fonts"
    sources = json.loads((assets / "screensaver-font-sources.json").read_text())

    @lru_cache(maxsize=None)
    def font_path(source):
        if source.startswith("gfonts://"):
            if args.legacy_font:
                return args.legacy_font
            from esphome.core import CORE
            from esphome.components.font import font_file_schema, _gfonts_ttf_path
            CORE.config_path = ROOT / "builds/screensaver-font-fit.yaml"
            return _gfonts_ttf_path(font_file_schema(source))
        filename, provenance = next((name, record) for name, record in sources.items()
                                    if record["source"] == source)
        path = assets / filename
        data = path.read_bytes()
        assert hashlib.sha256(data).hexdigest() == provenance["sha256"], f"Wrong source bytes: {filename}"
        tables = {}
        for i in range(struct.unpack_from(">H", data, 4)[0]):
            tag, _, offset, _ = struct.unpack_from(">4sIII", data, 12 + 16 * i)
            tables[tag] = offset
        assert b"fvar" not in tables, f"Expected static font: {filename}"
        weight = struct.unpack_from(">H", data, tables[b"OS/2"] + 4)[0]
        assert weight == provenance["weight"]
        return path

    @lru_cache(maxsize=None)
    def raster(font_id, size):
        font = fonts[font_id]
        assert font["bpp"] == 4 and set(font["glyphs"]) == set(GLYPHS)
        face = Face(str(font_path(font["file"])))
        family = next(f for f in reversed(FAMILIES) if font_id.startswith(f))
        expected = {FAMILIES[0]: (b"Roboto", b"Thin"), FAMILIES[1]: (b"Roboto", b"Bold"),
                    FAMILIES[2]: (b"Roboto Mono", b"Regular")}[family]
        assert (face.family_name, face.style_name) == expected
        glyphs = {c: glyph_to_glyphinfo(c, face, size, 4) for c in GLYPHS}
        line_height = pt_to_px(face.size.height)
        for c, g in glyphs.items():
            assert 0 <= g.offset_y <= g.offset_y + g.height <= line_height, (font_id, size, c, "vertical raster")
        data_bytes = sum(len(g.bitmap_data) for g in glyphs.values())
        print(f"{font_id}@{size}: line={line_height}, max advance={max(g.advance for g in glyphs.values())}, "
              f"4bpp glyph bytes={data_bytes}")
        return glyphs, line_height, data_bytes

    def bounds(text, glyphs):
        pen, left, right = 0, 0, 0
        for ch in text:
            g = glyphs[ch]
            left = min(left, pen + g.offset_x)
            right = max(right, pen + g.offset_x + g.width)
            pen += g.advance  # The actual ESPHome callback has no kerning.
        return pen, left, right

    # Compile the real helper against measured descriptor tables, so changing
    # fitting/padding/combined height in production changes this test's outcome.
    cpp = helper_source + '\nint main() {\n'
    font_variables = {}

    def font_variable(font_id, size):
        nonlocal cpp
        key = (font_id, size)
        if key not in font_variables:
            glyphs, height, _ = raster(font_id, size)
            variable = f"f{len(font_variables)}"
            font_variables[key] = variable
            cpp += f'lv_font_t {variable}{{0, {height}}};\n'
            for ch, g in glyphs.items():
                cpp += f'{variable}.glyphs[{ord(ch)}] = {{{g.advance}, {g.offset_x}, {g.width}}};\n'
        return font_variables[key]

    profiles = []
    for path in sorted((ROOT / "devices").glob("*/packages.yaml")):
        substitutions = read_yaml(path)["substitutions"]
        if "clock_font_size" not in substitutions:
            continue
        value = str(substitutions["clock_font_size"])
        while "${" in value:
            key = re.fullmatch(r"\$\{(\w+)\}", value).group(1)
            value = str(substitutions[key])
        legacy = int(value)
        width, height = (int(substitutions[k]) for k in ("screen_width", "screen_height"))
        profiles.append((path.parent.name, width, height, legacy))
        total_bytes = 0
        for family in FAMILIES:
            glyphs, line_height, size_bytes = raster(family, legacy)
            total_bytes += size_bytes
            font_variable(family, legacy)
            for size in SIZES:
                font_id = f"{family}_{size}"
                assert fonts[font_id]["size"] == size and fonts[font_id]["file"] == fonts[family]["file"]
                total_bytes += raster(font_id, size)[2]
                font_variable(font_id, size)
            for rotation in (0, 90, 180, 270):
                w, h = (width, height) if rotation % 180 == 0 else (height, width)
                for text in times:
                    advance, left, right = bounds(text, glyphs)
                    fits = advance <= w and line_height <= h and left >= 0 and right <= advance
                    if not fits:
                        issue = f"{path.parent.name} {rotation}deg {family}@{legacy}: {text} {advance}x{line_height} into {w}x{h}"
                        if family == FAMILIES[0]:
                            legacy_clipping.append(issue)
                        else:
                            raise AssertionError(issue)
        print(f"{path.parent.name}: total clock pool bitmap data {total_bytes} bytes (descriptors excluded)")

    cpp += r'''
    auto ink_fits = [](const lv_font_t *font, const std::string &shape, ClockScreensaverMeasure measure) {
      // Try every digit at every numeric slot (including all narrow and all wide
      // values). Literal overhang, first/last slashes and 32-character extremes
      // are included. Conservative slot reservations bound all mixed values too.
      for (char digit = '0'; digit <= '9'; ++digit) {
        long pen = measure.pad;
        for (char c : shape) {
          if (c >= '0' && c <= '9') c = digit;
          const auto &g = font->glyphs.at(c);
          assert(pen + g.ofs_x >= 0);
          assert(pen + g.ofs_x + g.box_w <= measure.width);
          pen += g.adv_w;
        }
        assert(pen + measure.pad <= measure.width);
        assert(measure.height == font->line_height);
      }
    };
    '''
    shapes = ["00:00", "00:00:00", "00.00.0000", "00.00.0000 00:00:00", "0" * 32,
              "/" + "0" * 31, "0" * 31 + "/"]
    # Each literal repeated to the maximum length with one required digit tests
    # the full grammar, not just conventional HH:MM/date combinations.
    shapes += [ch * 31 + "0" for ch in " :./-"]
    cpp += 'const std::string shapes[] = {' + ','.join(cpp_string(s) for s in shapes) + '};\n'
    cases = 0
    for name, width, height, legacy in profiles:
        for family in FAMILIES:
            entries = [(size, font_variables[(f"{family}_{size}", size)]) for size in SIZES]
            entries += [(legacy, font_variables[(family, legacy)])]
            cpp += '{ const ClockScreensaverFont pool[] = {' + ','.join(f'{{{size}, &{font}}}' for size, font in entries) + '};\n'
            dimensions = [(width, height), (height, width), (width, height), (height, width)]
            cpp += 'for (auto dimensions : {' + ','.join(f'std::pair<int,int>{{{w},{h}}}' for w, h in dimensions) + '}) {\n'
            cpp += f'for (int time_upper : {{64,96,{legacy}}}) for (int date_upper : {{24,40,64}}) {{\n'
            cpp += r'''
              for (const auto &time_shape : shapes) for (const auto &date_shape : shapes) {
                const auto layout = choose_clock_screensaver_layout(pool, 6, time_shape, date_shape,
                    time_upper, date_upper, dimensions.first, dimensions.second);
                assert(layout.time_font && layout.date_font);
                assert(layout.time.width <= dimensions.first && layout.date.width <= dimensions.first);
                assert(layout.time.height + 8 + layout.date.height <= dimensions.second);
                ink_fits(layout.time_font, time_shape, layout.time);
                ink_fits(layout.date_font, date_shape, layout.date);
                for (const auto &entry : pool) {
                  if (entry.font == layout.time_font) assert(entry.size <= time_upper);
                  if (entry.font == layout.date_font) assert(entry.size <= date_upper);
                }
                const auto alone = choose_clock_screensaver_layout(pool, 6, time_shape, "",
                    time_upper, date_upper, dimensions.first, dimensions.second);
                assert(alone.time_font && !alone.date_font);
                assert(alone.time.width <= dimensions.first && alone.time.height <= dimensions.second);
                ink_fits(alone.time_font, time_shape, alone.time);
              }
            } } }
            '''
            cases += 4 * 3 * 3 * len(shapes) ** 2
    cpp += 'std::cout << "Real raster-backed combined layouts passed\\n"; }\n'
    with tempfile.TemporaryDirectory(prefix="screensaver-font-fit-") as directory:
        source, binary = Path(directory) / "test.cpp", Path(directory) / "test"
        source.write_text(cpp)
        subprocess.run([os.environ.get("CXX", "c++"), "-std=c++17", "-Wall", "-Wextra", "-Werror", "-UNDEBUG",
                        str(source), "-o", str(binary)], check=True)
        subprocess.run([str(binary)], check=True)
    assert profiles
    if legacy_clipping:
        print(f"Existing Thin clipping ({len(legacy_clipping)} cases, legacy size unchanged):")
        print('\n'.join(legacy_clipping[:12]))
    else:
        print("No pre-existing Thin clipping at the measured compiled sizes.")
    print(f"Font fit passed: {len(profiles)} profiles, 4 rotations, {len(times)} legacy times per family, "
          f"{cases} combined bounded-format/preset cases and {len(font_variables)} compiled metric tables.")


if __name__ == "__main__":
    main()
