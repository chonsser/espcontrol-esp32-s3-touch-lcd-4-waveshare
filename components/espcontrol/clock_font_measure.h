#pragma once

#include <algorithm>
#include <string>

struct ClockScreensaverMeasure {
  lv_coord_t width = 0, height = 0, pad = 0;
};

// Shared screensaver/card measurement. Reserve widest numeric advances and
// symmetric raster-overhang padding so changing seconds cannot change fit.
inline ClockScreensaverMeasure measure_clock_screensaver_shape(
    const lv_font_t *font, const std::string &shape, lv_coord_t letter_space = 0) {
  ClockScreensaverMeasure result;
  if (!font || shape.empty()) return result;
  lv_coord_t digit_width = 0, digit_pad = 0;
  auto metrics = [&](char ch, lv_coord_t &width, lv_coord_t &pad) {
    lv_font_glyph_dsc_t glyph{};
    if (lv_font_get_glyph_dsc(font, &glyph, static_cast<uint32_t>(ch), 0)) {
      width = glyph.adv_w;
      pad = std::max<lv_coord_t>(0, std::max<lv_coord_t>(-glyph.ofs_x,
                                                       glyph.ofs_x + glyph.box_w - glyph.adv_w));
    }
  };
  for (char ch = '0'; ch <= '9'; ++ch) {
    lv_coord_t width = 0, pad = 0;
    metrics(ch, width, pad);
    digit_width = std::max(digit_width, width);
    digit_pad = std::max(digit_pad, pad);
  }
  for (char ch : shape) {
    lv_coord_t width = digit_width, pad = digit_pad;
    if (ch < '0' || ch > '9') metrics(ch, width, pad);
    result.width += width;
    result.pad = std::max(result.pad, pad);
  }
  result.width += 2 * result.pad + static_cast<lv_coord_t>(shape.size() - 1) * letter_space;
  result.height = font->line_height;
  return result;
}
