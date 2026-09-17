// Host checks for the real MipiRgb drawing methods; no display is contacted.
#include <algorithm>
#include <cassert>
#include <cstdint>
#include <cstring>
#include <functional>
#include <iostream>
#include <optional>
#include <vector>

#define IRAM_ATTR
#define ESP_LOGV(...) ((void) 0)
#define ESP_LOGE(...) ((void) 0)
#define ESP_LOGW(...) (++warnings)
#define LOG_STR(x) x
#define portMUX_INITIALIZER_UNLOCKED 0
#define portENTER_CRITICAL(x) ((void) 0)
#define portEXIT_CRITICAL(x) ((void) 0)
#define portENTER_CRITICAL_ISR(x) ((void) 0)
#define portEXIT_CRITICAL_ISR(x) ((void) 0)
using portMUX_TYPE = int;
using TickType_t = uint32_t;
using BaseType_t = int;
constexpr int pdTRUE = 1, pdFALSE = 0, ESP_OK = 0;
constexpr int ESP_CACHE_MSYNC_FLAG_DIR_C2M = 1, ESP_CACHE_MSYNC_FLAG_UNALIGNED = 2;
using esp_err_t = int;
using esp_lcd_panel_handle_t = void *;
struct esp_lcd_rgb_panel_event_data_t {};
struct StaticSemaphore_t { bool ready{false}; };
using SemaphoreHandle_t = StaticSemaphore_t *;
static TickType_t ticks;
static int warnings;
static std::function<void()> next_vsync;
static std::function<void()> before_wait;
// Optional millisecond scheduler: respects the requested semaphore deadline.
static std::function<void(TickType_t)> timed_wait;
TickType_t xTaskGetTickCount() { return ticks; }
int xSemaphoreGiveFromISR(SemaphoreHandle_t semaphore, BaseType_t *woken) {
  semaphore->ready = true;
  *woken = pdTRUE;
  return pdTRUE;
}
int xSemaphoreTake(SemaphoreHandle_t semaphore, TickType_t timeout) {
  if (before_wait)
    before_wait();
  if (!semaphore->ready) {
    if (timed_wait) {
      timed_wait(timeout);
      if (!semaphore->ready)
        return pdFALSE;
    } else if (next_vsync) {
      ++ticks;
      next_vsync();
    } else {
      ticks += timeout;
      return pdFALSE;
    }
  }
  semaphore->ready = false;
  return pdTRUE;
}

struct Flush { void *ptr; size_t size; };
static std::vector<Flush> flushes;
static int cache_error;
int esp_cache_msync(void *ptr, size_t size, int flags) {
  assert(flags == (ESP_CACHE_MSYNC_FLAG_DIR_C2M | ESP_CACHE_MSYNC_FLAG_UNALIGNED));
  flushes.push_back({ptr, size});
  return cache_error;
}
struct Submission { int x, y, end_x, end_y; const void *ptr; };
static std::vector<Submission> submissions;
static int submission_error;
static std::function<void(const void *)> on_submit;
int esp_lcd_panel_draw_bitmap(void *, int x, int y, int end_x, int end_y, const void *ptr) {
  submissions.push_back({x, y, end_x, end_y, ptr});
  if (submission_error == ESP_OK && on_submit)
    on_submit(ptr);
  return submission_error;
}

namespace esphome {
struct Color { uint16_t value; };
struct GPIOPin {};
struct InternalGPIOPin : GPIOPin {};
template<typename T> struct RAMAllocator {
  T *allocate(size_t n) { return new T[n]{}; }
};
uint16_t convert_big_endian(uint16_t value) { return (value >> 8) | (value << 8); }
namespace display {
enum ColorOrder { COLOR_ORDER_BGR };
enum ColorBitness { COLOR_BITNESS_565, COLOR_BITNESS_888 };
enum DisplayType { DISPLAY_TYPE_COLOR };
enum DisplayRotation {
  DISPLAY_ROTATION_0_DEGREES, DISPLAY_ROTATION_90_DEGREES,
  DISPLAY_ROTATION_180_DEGREES, DISPLAY_ROTATION_270_DEGREES
};
struct ColorUtil { static uint16_t color_to_565(Color color) { return color.value; } };
struct Clipping {
  bool inside(int, int) { return true; }
  bool is_set() { return false; }
};
class Display;
struct Page { std::function<void(Display &)> get_writer() { return {}; } };
class Display {
 public:
  virtual ~Display() = default;
  virtual void setup() {}
  virtual void loop() {}
  virtual void update() {}
  virtual void dump_config() {}
  virtual int get_width() { return 0; }
  virtual int get_height() { return 0; }
  virtual int get_width_internal() { return 0; }
  virtual int get_height_internal() { return 0; }
  virtual DisplayType get_display_type() { return DISPLAY_TYPE_COLOR; }
  virtual void draw_pixel_at(int, int, Color) {}
  virtual void fill(Color color) {
    for (int y = 0; y < get_height(); y++)
      for (int x = 0; x < get_width(); x++)
        draw_pixel_at(x, y, color);
  }
  virtual void draw_pixels_at(int x, int y, int w, int h, const uint8_t *ptr, ColorOrder, ColorBitness,
                              bool, int xo, int yo, int pad) {
    const int stride = (xo + w + pad) * 3;
    ptr += yo * stride + xo * 3;
    for (int row = 0; row < h; row++) {
      for (int col = 0; col < w; col++)
        draw_pixel_at(x + col, y + row, Color{ptr[col * 3]});
      ptr += stride;
    }
  }
  bool is_failed() { return failed_; }
  void mark_failed(const char *) { failed_ = true; }
  Clipping get_clipping() { return {}; }
  void clear() { fill({0}); }
  void test_card() {}
  void stop_poller() {}
 protected:
  bool failed_{false}, auto_clear_enabled_{false}, show_test_card_{false};
  Page *page_{nullptr};
  std::optional<std::function<void(Display &)>> writer_;
  DisplayRotation rotation_{DISPLAY_ROTATION_0_DEGREES};
};
}  // namespace display
}  // namespace esphome

#include "mipi_rgb_test.inc"

namespace esphome::mipi_rgb {
void MipiRgb::setup() {}
void MipiRgb::dump_config() {}
}  // namespace esphome::mipi_rgb

class TestDisplay : public esphome::mipi_rgb::MipiRgb {
 public:
  explicit TestDisplay(TickType_t timeout = 6) : MipiRgb(4, 3) {
    frame_buffers_[0] = a;
    frame_buffers_[1] = b;
    vsync_ = &context;
    context.semaphore = &context.semaphore_storage;
    swap_timeout_ticks_ = timeout;
  }
  ~TestDisplay() { delete[] buffer_; }
  void vsync() { on_vsync_(nullptr, nullptr, &context); }
  void bounce_complete() { on_frame_complete_(nullptr, nullptr, &context); }
  void refresh() {
    bounce_complete();
    vsync();
  }
  void wrap_counter() { context.count = context.frame_count = UINT32_MAX; }
  uint16_t *front() { return static_cast<uint16_t *>(frame_buffers_[front_buffer_]); }
  void draw(int x, int y, int w, int h, const uint16_t *ptr, int xo = 0, int yo = 0, int pad = 0) {
    draw_pixels_at(x, y, w, h, reinterpret_cast<const uint8_t *>(ptr), esphome::display::COLOR_ORDER_BGR,
                   esphome::display::COLOR_BITNESS_565, false, xo, yo, pad);
  }
  void finish() { wait_for_swap_(); }
  std::vector<int64_t> ownership() const {
    return {front_buffer_, back_buffer_, swap_pending_, swap_vsync_count_, swap_frame_count_,
            pending_rect_.x, pending_rect_.y, pending_rect_.w, pending_rect_.h};
  }
  bool dirty() const { return x_low_ <= x_high_ && y_low_ <= y_high_; }
  uint16_t a[12]{}, b[12]{};
  VsyncContext context;
};

// Model REFR_READY after LVGL has cleared its invalid-area list and left the
// rendering critical section. Execute the ACTUAL device YAML lambdas below.
// The system layer stays fullscreen even when a sliding active screen does not.
struct FakeLvgl {
  struct Layer { FakeLvgl *display; int x, y, w, h; } system{this, 0, 0, 4, 3};
  bool rendering{false};
  Layer *invalidated{nullptr};
  FakeLvgl *get_disp() { return this; }
};
FakeLvgl::Layer *lv_display_get_layer_sys(FakeLvgl *display) { return &display->system; }
void lv_obj_invalidate(FakeLvgl::Layer *layer) {
  assert(!layer->display->rendering);
  assert(layer->x == 0 && layer->y == 0 && layer->w == 4 && layer->h == 3);
  layer->display->invalidated = layer;
}
#define id(name) name
#include "waveshare_frame_hooks.inc"
#undef id

void begin_refresh(TestDisplay &display, FakeLvgl &lvgl) {
  waveshare_begin_frame(display, lvgl);
  lvgl.rendering = true;
}
void end_refresh(TestDisplay &display, FakeLvgl &lvgl) {
  lvgl.rendering = false;
  lvgl.invalidated = nullptr;
  waveshare_end_frame(display, lvgl);
}

void expect_pixels(TestDisplay &display, std::initializer_list<uint16_t> values) {
  assert(values.size() == 12);
  assert(std::equal(values.begin(), values.end(), display.front()));
}

void check_bounce_latch_race() {
  TestDisplay display;
  display.set_tear_free(true);
  // IDF 5.5.5 rgb_panel_draw_bitmap changes cur_fb_index immediately, but
  // fill_bounce_buffer latches bb_fb_index before calling on_frame_buf_complete.
  // A callback from a latch BEFORE publication can arrive AFTER our snapshot.
  const void *selected = display.a;
  const void *scanning = display.a;
  on_submit = [&](const void *ptr) {
    assert(ptr != scanning);  // No submission may have just written the reader's buffer.
    if (selected == display.a)
      display.refresh();  // Old events inside draw_bitmap must also be excluded.
    selected = ptr;
  };
  uint16_t source[] = {7, 8};
  display.draw(0, 0, 2, 1, source);
  // LVGL can reuse its source immediately on return, even though swap is pending.
  source[0] = source[1] = 99;
  expect_pixels(display, {7, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0});
  int event = 0;
  next_vsync = [&] {
    ++event;
    if (event <= 2) {
      display.vsync();  // VSYNC by itself is never a release fence.
    } else if (event == 3) {
      display.bounce_complete();  // Delayed callback from old pre-publication latch.
    } else {
      scanning = selected;  // Only this wrap really selects the new framebuffer.
      display.bounce_complete();
    }
  };
  before_wait = [&] {
    assert(std::all_of(display.a, display.a + 12, [](uint16_t p) { return p == 0; }));
  };
  const uint16_t second = 9;
  display.draw(3, 2, 1, 1, &second);
  assert(event == 4 && !display.is_failed());
  expect_pixels(display, {7, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 9});
  before_wait = {};
  next_vsync = {};
  on_submit = {};
}

void check_atomic_color_refresh() {
  TestDisplay display;
  display.set_tear_free(true);
  next_vsync = [&] { display.refresh(); };
  constexpr uint16_t blue = 0x001F, red = 0xF800, green = 0x07E0, white = 0xFFFF;
  uint16_t screen[12];
  std::fill_n(screen, 12, blue);
  display.draw(0, 0, 4, 3, screen);
  display.finish();
  const auto blue_frame = std::vector<uint16_t>(display.front(), display.front() + 12);
  const auto submitted = submissions.size();
  const auto synced = flushes.size();
  // Model ESPHome on_draw_start/on_draw_end: a full-screen color change may
  // arrive as several LVGL flush chunks, NOT one atomic draw_pixels_at call.
  display.begin_frame();
  uint16_t row[4] = {red, red, red, red};
  for (int y : {0, 2, 1}) {
    std::fill_n(row, 4, red);
    display.draw(0, y, 4, 1, row);
    std::fill_n(row, 4, 0xBAD);  // LVGL is free to reuse each source chunk.
    display.refresh();  // A scan boundary between chunks must still show BLUE.
    assert(std::equal(blue_frame.begin(), blue_frame.end(), display.front()));
    assert(submissions.size() == submitted && flushes.size() == synced);
  }
  display.end_frame();
  assert(submissions.size() == submitted + 1 && flushes.size() == synced + 1);
  assert(std::all_of(display.front(), display.front() + 12, [](uint16_t p) { return p == red; }));

  // Multiple disjoint/overlapping dirty areas in one refresh must all survive
  // the next buffer repair, not just the last area in that refresh.
  display.begin_frame();
  display.draw(1, 0, 1, 1, &green);
  display.draw(3, 2, 1, 1, &white);
  display.draw(1, 0, 1, 1, &blue);
  assert(submissions.size() == submitted + 1);
  display.end_frame();
  expect_pixels(display, {red, blue, red, red, red, red, red, red, red, red, red, white});
  display.begin_frame();
  display.draw(2, 1, 1, 1, &green);
  display.end_frame();
  expect_pixels(display, {red, blue, red, red, red, red, green, red, red, red, red, white});

  // Empty/paused refresh and an unmatched end must not publish a stale buffer.
  const auto nonempty = submissions.size();
  display.begin_frame();
  display.end_frame();
  display.end_frame();
  assert(submissions.size() == nonempty);

  // Writeback failure discards the whole unpublished frame, not just its last
  // chunk, and the following frame repairs every discarded dirty area.
  display.begin_frame();
  display.draw(0, 0, 1, 1, &white);
  display.draw(0, 2, 1, 1, &white);
  cache_error = 1;
  display.end_frame();
  cache_error = 0;
  assert(submissions.size() == nonempty);
  display.begin_frame();
  display.draw(3, 0, 1, 1, &green);
  display.end_frame();
  expect_pixels(display, {red, blue, red, green, red, red, green, red, red, red, red, white});

  // Frame hooks must be harmless with the option off.
  TestDisplay legacy;
  const auto direct = submissions.size();
  legacy.begin_frame();
  legacy.draw(0, 0, 1, 1, &red);
  assert(submissions.size() == direct + 1);
  legacy.end_frame();
  assert(submissions.size() == direct + 1);
  next_vsync = {};
}

void check_delayed_third_frame_repaint() {
  TestDisplay display(56);  // Actual Waveshare budget at a 1ms RTOS tick.
  FakeLvgl lvgl;
  display.set_tear_free(true);
  next_vsync = {};
  ticks = 0;
  constexpr uint16_t blue = 0x001F, red = 0xF800, green = 0x07E0, white = 0xFFFF;
  uint16_t initial[12];
  std::fill_n(initial, 12, blue);
  const void *scanning = display.a;
  const void *selected = display.a;
  on_submit = [&](const void *ptr) {
    assert(ptr != scanning);
    selected = ptr;
  };
  display.draw(0, 0, 4, 3, initial);
  // A stale wake token must not affect the post-submit generation fence.
  display.context.semaphore_storage.ready = true;
  const auto original_a = std::vector<uint16_t>(display.a, display.a + 12);
  const auto original_b = std::vector<uint16_t>(display.b, display.b + 12);
  const auto ownership = display.ownership();
  const auto submitted = submissions.size();
  const auto synced = flushes.size();
  const auto warning_count = warnings;

  // 26.52ms scan periods, rounded UP to ms. IDF's first underrun resets
  // bounce_pos_px without a wrap/latch callback; only periods two and three
  // supply the two fresh bounce completions required by the release fence.
  const TickType_t event_times[] = {27, 54, 80};
  size_t event = 0;
  timed_wait = [&](TickType_t budget) {
    if (event == 3 || event_times[event] - ticks > budget) {
      ticks += budget;
      return;
    }
    ticks = event_times[event];
    if (event != 0) {
      scanning = selected;
      display.bounce_complete();
    }
    display.vsync();
    ++event;
  };
  before_wait = [&] {
    assert(std::equal(original_a.begin(), original_a.end(), display.a));
    assert(std::equal(original_b.begin(), original_b.end(), display.b));
  };
  // The next16ms LVGL refresh begins before the previous swap is released.
  ticks = 16;
  begin_refresh(display, lvgl);
  uint16_t row[4] = {red, green, red, green};
  display.draw(0, 0, 4, 1, row);
  assert(ticks == 72 && event == 2 && warnings == warning_count + 1);
  assert(!display.is_failed());  // A recoverable third-period delay is not fatal.
  assert(display.ownership() == ownership);
  std::fill_n(row, 4, 0xBAD);  // LVGL already considers this chunk consumed.

  // Late QUALIFYING callbacks between chunks may NOT resume an aborted frame.
  timed_wait(8);
  assert(ticks == 80 && event == 3);
  std::fill_n(row, 4, white);
  display.draw(0, 2, 4, 1, row);
  display.draw(0, 1, 4, 1, row);
  end_refresh(display, lvgl);
  assert(lvgl.invalidated == &lvgl.system);
  assert(display.ownership() == ownership);
  assert(submissions.size() == submitted && flushes.size() == synced);
  assert(std::equal(original_a.begin(), original_a.end(), display.a));
  assert(std::equal(original_b.begin(), original_b.end(), display.b));
  before_wait = {};
  timed_wait = {};

  // Full repaint of the current UI includes the discarded FIRST chunk and all
  // later dirty areas. No intermediate color may be submitted between chunks.
  const uint16_t current_ui[] = {red, green, red, green, blue, blue, blue, blue, white, white, white, white};
  ticks = 88;
  begin_refresh(display, lvgl);
  for (int y : {0, 2, 1}) {
    display.draw(0, y, 4, 1, current_ui + y * 4);
    assert(ticks == 88 && submissions.size() == submitted);
    assert(std::equal(original_b.begin(), original_b.end(), display.front()));
  }
  end_refresh(display, lvgl);
  assert(lvgl.invalidated == nullptr);
  assert(submissions.size() == submitted + 1 && flushes.size() == synced + 1);
  assert(std::equal(current_ui, current_ui + 12, display.front()));
  on_submit = {};
  next_vsync = [&] { display.refresh(); };
  // A later partial refresh repairs the ENTIRE recovered frame, not its last row.
  begin_refresh(display, lvgl);
  display.draw(2, 1, 1, 1, &green);
  end_refresh(display, lvgl);
  expect_pixels(display, {red, green, red, green, blue, blue, green, blue, white, white, white, white});
  const auto done = submissions.size();
  begin_refresh(display, lvgl);
  end_refresh(display, lvgl);
  end_refresh(display, lvgl);
  assert(submissions.size() == done && lvgl.invalidated == nullptr);
  next_vsync = {};
}

void check_rejected_refresh_repaint() {
  for (int failure = 0; failure < 2; ++failure) {
    TestDisplay display;
    FakeLvgl lvgl;
    display.set_tear_free(true);
    next_vsync = [&] { display.refresh(); };
    const uint16_t initial[12] = {1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12};
    display.draw(0, 0, 4, 3, initial);
    begin_refresh(display, lvgl);
    const uint16_t replacement = 55;
    display.draw(0, 0, 1, 1, &replacement);
    display.draw(3, 2, 1, 1, &replacement);
    cache_error = failure == 0;
    submission_error = failure == 1;
    end_refresh(display, lvgl);
    assert(lvgl.invalidated == &lvgl.system);
    assert(std::equal(initial, initial + 12, display.front()));
    cache_error = submission_error = 0;
    uint16_t current_ui[12];
    std::copy_n(initial, 12, current_ui);
    current_ui[0] = current_ui[11] = replacement;
    begin_refresh(display, lvgl);
    display.draw(0, 0, 4, 3, current_ui);
    end_refresh(display, lvgl);
    assert(lvgl.invalidated == nullptr);
    assert(std::equal(current_ui, current_ui + 12, display.front()));
  }
  next_vsync = {};
}

void check_generic_dirty_retry() {
  TestDisplay display;
  display.set_tear_free(true);
  next_vsync = {};
  const uint16_t pixel = 7;
  display.draw(0, 0, 1, 1, &pixel);
  display.fill({0x1234});
  display.draw_pixel_at(2, 1, {0x5678});
  display.update();
  assert(!display.is_failed() && display.dirty());
  const auto submitted = submissions.size();
  const auto timed_out = ticks;
  display.update();  // No callback, no second blocking wait, dirty data retained.
  assert(ticks == timed_out && submissions.size() == submitted && display.dirty());
  display.refresh();
  display.refresh();
  display.update();  // Retry the stored pixels without calling fill/draw again.
  assert(!display.dirty());
  expect_pixels(display, {0x3412, 0x3412, 0x3412, 0x3412, 0x3412, 0x3412,
                          0x7856, 0x3412, 0x3412, 0x3412, 0x3412, 0x3412});
  next_vsync = [&] { display.refresh(); };
  for (int failure = 0; failure < 2; ++failure) {
    display.draw_pixel_at(failure, 0, {0xABCD});
    cache_error = failure == 0;
    submission_error = failure == 1;
    display.update();
    assert(display.dirty());
    cache_error = submission_error = 0;
    display.update();
    assert(!display.dirty() && display.front()[failure] == 0xCDAB);
  }
  next_vsync = {};
}

int main() {
  check_delayed_third_frame_repaint();
  ticks = 0;
  TestDisplay display;
  display.set_tear_free(true);
  next_vsync = [&] { display.refresh(); };
  // A stale pre-submission event must not release the old framebuffer.
  display.vsync();
  const uint16_t padded[] = {90, 90, 90, 90, 90, 11, 12, 90, 90, 13, 14, 90};
  display.draw(1, 0, 2, 2, padded, 1, 1, 1);
  expect_pixels(display, {0, 11, 12, 0, 0, 13, 14, 0, 0, 0, 0, 0});
  assert(submissions.back().ptr == display.b);
  assert(submissions.back().x == 0 && submissions.back().y == 0);
  assert(submissions.back().end_x == 4 && submissions.back().end_y == 3);
  const auto original_a = std::vector<uint16_t>(display.a, display.a + 12);
  before_wait = [&] { assert(std::equal(original_a.begin(), original_a.end(), display.a)); };
  const uint16_t bottom[] = {21, 22};
  display.draw(0, 2, 2, 1, bottom);
  before_wait = {};
  assert(ticks == 2);  // Both fresh vsyncs required, even with a stale token.
  expect_pixels(display, {0, 11, 12, 0, 0, 13, 14, 0, 21, 22, 0, 0});
  assert(flushes.back().ptr == display.a && flushes.back().size == sizeof(display.a));
  const uint16_t overlap[] = {31, 32};
  display.draw(2, 1, 2, 1, overlap);
  expect_pixels(display, {0, 11, 12, 0, 0, 13, 31, 32, 21, 22, 0, 0});

  // Coalesced idle vsyncs must not force an extra wait.
  display.refresh();
  display.refresh();
  display.refresh();
  const auto settled = ticks;
  display.finish();
  assert(ticks == settled);

  // Wrap-safe generation arithmetic and a lost interrupt cannot deadlock.
  display.wrap_counter();
  const uint16_t pixel = 40;
  display.draw(3, 2, 1, 1, &pixel);
  display.finish();
  assert(ticks == settled + 2);
  display.draw(0, 0, 1, 1, &pixel);
  display.draw(0, 1, 1, 1, &pixel);
  expect_pixels(display, {40, 11, 12, 0, 40, 13, 31, 32, 21, 22, 0, 40});

  // Lost interrupts, VSYNC-only underrun and bounce-only progress must all
  // fail closed: neither possibly-scanned framebuffer may change on timeout.
  for (int stalled_event = 0; stalled_event < 3; ++stalled_event) {
    TestDisplay stalled;
    stalled.set_tear_free(true);
    stalled.draw(0, 0, 1, 1, &pixel);
    const auto original_a = std::vector<uint16_t>(stalled.a, stalled.a + 12);
    const auto original_b = std::vector<uint16_t>(stalled.b, stalled.b + 12);
    const auto submitted = submissions.size();
    const auto flushed = flushes.size();
    const auto warning_count = warnings;
    next_vsync = {};
    if (stalled_event == 1)
      next_vsync = [&] { stalled.vsync(); };
    else if (stalled_event == 2)
      next_vsync = [&] { stalled.bounce_complete(); };
    ticks = UINT32_MAX - 2;  // Timeout must work across a FreeRTOS tick wrap.
    FakeLvgl lvgl;
    const auto ownership = stalled.ownership();
    begin_refresh(stalled, lvgl);
    stalled.draw(0, 1, 1, 1, &pixel);
    stalled.draw(0, 2, 1, 1, &pixel);
    end_refresh(stalled, lvgl);
    assert(ticks == 3 && warnings == warning_count + 1);
    assert(lvgl.invalidated == &lvgl.system && !stalled.is_failed());
    // Permanently absent/one-sided callbacks: retries stay nonblocking, keep
    // repainting requested, retain the ORIGINAL fence, and never touch buffers.
    for (int retry = 0; retry < 20; ++retry) {
      if (stalled_event == 1)
        stalled.vsync();
      else if (stalled_event == 2)
        stalled.bounce_complete();
      begin_refresh(stalled, lvgl);
      stalled.draw(0, 1, 1, 1, &pixel);
      stalled.draw(0, 2, 1, 1, &pixel);
      end_refresh(stalled, lvgl);
      assert(lvgl.invalidated == &lvgl.system && !stalled.is_failed());
      assert(ticks == 3 && warnings == warning_count + 1);
      assert(stalled.ownership() == ownership);
      assert(std::equal(original_a.begin(), original_a.end(), stalled.a));
      assert(std::equal(original_b.begin(), original_b.end(), stalled.b));
      assert(submissions.size() == submitted && flushes.size() == flushed);
    }
    // A subsequent FULL repaint can recover, but only after BOTH real counters
    // meet the original fence, without resetting any generations at timeout.
    stalled.refresh();
    stalled.refresh();
    uint16_t repaint[12];
    std::fill_n(repaint, 12, pixel);
    begin_refresh(stalled, lvgl);
    stalled.draw(0, 0, 4, 3, repaint);
    end_refresh(stalled, lvgl);
    assert(lvgl.invalidated == nullptr && ticks == 3);
    assert(submissions.size() == submitted + 1);
    assert(std::equal(repaint, repaint + 12, stalled.front()));
  }
  next_vsync = [&] { display.refresh(); };

  // Failed cache writeback/publication must not poison a later partial update.
  cache_error = 1;
  const uint16_t bad = 99;
  display.draw(1, 0, 1, 1, &bad);
  cache_error = 0;
  submission_error = 1;
  display.draw(2, 0, 1, 1, &bad);
  submission_error = 0;
  display.draw(2, 2, 1, 1, &pixel);
  expect_pixels(display, {40, 11, 12, 0, 40, 13, 31, 32, 21, 22, 40, 40});

  // Clipping preserves source stride and does not write outside the framebuffer.
  const uint16_t clipped[] = {1, 2, 3, 4, 5, 6};
  display.draw(-1, -1, 3, 2, clipped);
  expect_pixels(display, {5, 6, 12, 0, 40, 13, 31, 32, 21, 22, 40, 40});
  const auto count = submissions.size();
  display.draw(8, 8, 1, 1, &pixel);
  display.draw(0, 0, 0, 1, &pixel);
  assert(submissions.size() == count);

  // Generic fill/pixel drawing still publishes through update().
  display.fill({0x1234});
  display.draw_pixel_at(2, 1, {0x5678});
  display.update();
  expect_pixels(display, {0x3412, 0x3412, 0x3412, 0x3412, 0x3412, 0x3412,
                          0x7856, 0x3412, 0x3412, 0x3412, 0x3412, 0x3412});
  const uint8_t rgb[] = {7, 0, 0};
  display.draw_pixels_at(1, 1, 1, 1, rgb, esphome::display::COLOR_ORDER_BGR,
                         esphome::display::COLOR_BITNESS_888, false, 0, 0, 0);
  assert(display.front()[5] == 0x0700);

  // The default path keeps the original direct and per-row IDF calls.
  TestDisplay legacy;
  const auto flushed = flushes.size();
  legacy.draw(1, 0, 2, 2, padded, 1, 1, 1);
  assert(submissions[submissions.size() - 2].ptr == padded + 5);
  assert(submissions.back().ptr == padded + 9);
  assert(submissions.back().y == 1 && submissions.back().end_y == 2);
  legacy.draw(0, 0, 2, 1, bottom);
  assert(submissions.back().ptr == bottom && flushes.size() == flushed);
  check_bounce_latch_race();
  check_atomic_color_refresh();
  check_rejected_refresh_repaint();
  check_generic_dirty_retry();
  std::cout << "mipi_rgb framebuffer/stride/swap/timeout/recovery/atomic-color-refresh/fallback checks: ok\n";
}
