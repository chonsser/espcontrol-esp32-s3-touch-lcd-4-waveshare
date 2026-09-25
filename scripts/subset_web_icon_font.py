#!/usr/bin/env python3
"""Regenerate the checked-in offline icon font with fonttools==4.59.0.

Normal web builds validate and use this asset without requiring FontTools.
Run this script after changing the Product Model or fixed browser icon set.
"""
import argparse
import hashlib
import io
import json

import build

FONTTOOLS_VERSION = "4.59.0"


def generate():
    import fontTools
    from fontTools import subset
    from fontTools.pens.recordingPen import RecordingPen
    from fontTools.ttLib import TTFont

    if fontTools.__version__ != FONTTOOLS_VERSION:
        raise build.BuildError(f"Install fonttools=={FONTTOOLS_VERSION} to regenerate the web icon font")
    source = build.MDI_WEB_FONT.read_bytes()
    icons = build.load_json(build.ICONS_JSON)
    codepoints = build.web_mdi_icon_codepoints(icons)
    required = sorted({int(codepoints[name], 16) for name in build.web_mdi_icon_names(icons, codepoints)})
    original = TTFont(io.BytesIO(source), recalcTimestamp=False, recalcBBoxes=False)
    font = TTFont(io.BytesIO(source), recalcTimestamp=False, recalcBBoxes=False)
    missing = set(required) - original.getBestCmap().keys()
    if missing:
        raise build.BuildError(f"Pinned MDI font lacks required codepoints: {sorted(missing)}")
    options = subset.Options()
    options.recalc_timestamp = False
    subsetter = subset.Subsetter(options=options)
    subsetter.populate(unicodes=required)
    subsetter.subset(font)
    output = io.BytesIO()
    font.save(output)
    data = output.getvalue()
    # Check the saved artifact, not just the in-memory subset. Preserve every
    # outline and advance so this is a size reduction, not a visual downgrade.
    saved = TTFont(io.BytesIO(data), recalcTimestamp=False, recalcBBoxes=False)
    old_cmap, new_cmap = original.getBestCmap(), saved.getBestCmap()
    old_glyphs, new_glyphs = original.getGlyphSet(), saved.getGlyphSet()
    for codepoint in required:
        before, after = old_cmap[codepoint], new_cmap[codepoint]
        old_pen, new_pen = RecordingPen(), RecordingPen()
        old_glyphs[before].draw(old_pen)
        new_glyphs[after].draw(new_pen)
        if old_pen.value != new_pen.value or original["hmtx"][before] != saved["hmtx"][after]:
            raise build.BuildError(f"Subsetting changed icon U+{codepoint:04X}")
    manifest = {
        "fonttools_version": FONTTOOLS_VERSION,
        "source_sha256": hashlib.sha256(source).hexdigest(),
        "subset_sha256": hashlib.sha256(data).hexdigest(),
        "codepoints": required,
    }
    return data, json.dumps(manifest, indent=2) + "\n"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    data, manifest = generate()
    if args.check:
        if build.MDI_WEB_SUBSET.read_bytes() != data or build.MDI_WEB_SUBSET_MANIFEST.read_text() != manifest:
            raise build.BuildError("Web icon subset is stale; run scripts/subset_web_icon_font.py")
    else:
        build.MDI_WEB_SUBSET.write_bytes(data)
        build.MDI_WEB_SUBSET_MANIFEST.write_text(manifest)
    print(f"Web icon subset: {len(data):,} bytes; all icon outlines and advances preserved")


if __name__ == "__main__":
    main()
