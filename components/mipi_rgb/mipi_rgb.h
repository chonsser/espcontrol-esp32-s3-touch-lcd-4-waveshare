#pragma once

#if defined(USE_ESP32_VARIANT_ESP32S3) || defined(USE_ESP32_VARIANT_ESP32P4)
#include "esphome/core/gpio.h"
#include "esphome/components/display/display.h"
#include "esp_lcd_panel_ops.h"
#include "esp_lcd_panel_rgb.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#ifdef USE_SPI
#include "esphome/components/spi/spi.h"
#endif

namespace esphome::mipi_rgb {

constexpr static const char *const TAG = "display.mipi_rgb";
const uint8_t SW_RESET_CMD = 0x01;
const uint8_t SLEEP_OUT = 0x11;
const uint8_t SDIR_CMD = 0xC7;
const uint8_t MADCTL_CMD = 0x36;
const uint8_t INVERT_OFF = 0x20;
const uint8_t INVERT_ON = 0x21;
const uint8_t DISPLAY_ON = 0x29;
const uint8_t CMD2_BKSEL = 0xFF;
const uint8_t CMD2_BK0[5] = {0x77, 0x01, 0x00, 0x00, 0x10};

class MipiRgb : public display::Display {
 public:
  MipiRgb(int width, int height) : width_(width), height_(height) {}
  void setup() override;
  void loop() override;
  void update() override;
  void fill(Color color) override;
  void draw_pixels_at(int x_start, int y_start, int w, int h, const uint8_t *ptr, display::ColorOrder order,
                      display::ColorBitness bitness, bool big_endian, int x_offset, int y_offset, int x_pad) override;
  bool write_to_display_(int x_start, int y_start, int w, int h, const uint8_t *ptr, int x_offset, int y_offset,
                         int x_pad);
  bool check_buffer_();

  display::ColorOrder get_color_mode() { return this->color_mode_; }
  void set_color_mode(display::ColorOrder color_mode) { this->color_mode_ = color_mode; }
  void set_invert_colors(bool invert_colors) { this->invert_colors_ = invert_colors; }
  void set_tear_free(bool tear_free) { this->tear_free_ = tear_free; }
  // With tear_free, bracket ALL raw draw_pixels_at chunks of a logical refresh.
  // False from end_frame means the ENTIRE refresh was rejected: the caller must
  // replay/full-repaint it later (ephemeral source pointers are never retained).
  // LVGL requests a full-display invalidation at REFR_READY. Generic update()
  // keeps its own buffered pixels/dirty watermarks for the next update instead.
  // No-ops, returning true, when tear_free is off or no frame is active.
  void begin_frame();
  bool end_frame();

  void add_data_pin(InternalGPIOPin *data_pin, size_t index) { this->data_pins_[index] = data_pin; };
  void set_de_pin(InternalGPIOPin *de_pin) { this->de_pin_ = de_pin; }
  void set_pclk_pin(InternalGPIOPin *pclk_pin) { this->pclk_pin_ = pclk_pin; }
  void set_vsync_pin(InternalGPIOPin *vsync_pin) { this->vsync_pin_ = vsync_pin; }
  void set_hsync_pin(InternalGPIOPin *hsync_pin) { this->hsync_pin_ = hsync_pin; }
  void set_reset_pin(GPIOPin *reset_pin) { this->reset_pin_ = reset_pin; }
  void set_width(uint16_t width) { this->width_ = width; }
  void set_pclk_frequency(uint32_t pclk_frequency) { this->pclk_frequency_ = pclk_frequency; }
  void set_pclk_inverted(bool inverted) { this->pclk_inverted_ = inverted; }
  void set_model(const char *model) { this->model_ = model; }
  int get_width() override;
  int get_height() override;
  void set_hsync_back_porch(uint16_t hsync_back_porch) { this->hsync_back_porch_ = hsync_back_porch; }
  void set_hsync_front_porch(uint16_t hsync_front_porch) { this->hsync_front_porch_ = hsync_front_porch; }
  void set_hsync_pulse_width(uint16_t hsync_pulse_width) { this->hsync_pulse_width_ = hsync_pulse_width; }
  void set_vsync_pulse_width(uint16_t vsync_pulse_width) { this->vsync_pulse_width_ = vsync_pulse_width; }
  void set_vsync_back_porch(uint16_t vsync_back_porch) { this->vsync_back_porch_ = vsync_back_porch; }
  void set_vsync_front_porch(uint16_t vsync_front_porch) { this->vsync_front_porch_ = vsync_front_porch; }
  void set_enable_pins(std::vector<GPIOPin *> enable_pins) { this->enable_pins_ = std::move(enable_pins); }
  display::DisplayType get_display_type() override { return display::DisplayType::DISPLAY_TYPE_COLOR; }
  int get_width_internal() override { return this->width_; }
  int get_height_internal() override { return this->height_; }
  void dump_pins_(uint8_t start, uint8_t end, const char *name, uint8_t offset);
  void dump_config() override;
  void draw_pixel_at(int x, int y, Color color) override;

  // this will be horribly slow.
 protected:
  void setup_enables_();
  void common_setup_();
  esp_err_t setup_tear_free_();
  bool write_tear_free_(int x_start, int y_start, int w, int h, const uint8_t *ptr, int stride);
  bool submit_frame_();
  bool wait_for_swap_();
  static bool on_vsync_(esp_lcd_panel_handle_t panel, const esp_lcd_rgb_panel_event_data_t *event_data, void *user_ctx);
  static bool on_frame_complete_(esp_lcd_panel_handle_t panel, const esp_lcd_rgb_panel_event_data_t *event_data,
                                 void *user_ctx);

  struct VsyncContext {
    portMUX_TYPE lock = portMUX_INITIALIZER_UNLOCKED;
    StaticSemaphore_t semaphore_storage;
    SemaphoreHandle_t semaphore{nullptr};
    uint32_t count{0};
    uint32_t frame_count{0};
  };
  struct DirtyRect {
    int x{0};
    int y{0};
    int w{0};
    int h{0};
  };
  bool tear_free_{false};
  void *frame_buffers_[2]{};
  VsyncContext *vsync_{nullptr};
  TickType_t swap_timeout_ticks_{0};
  uint32_t swap_vsync_count_{0};
  uint32_t swap_frame_count_{0};
  // Front is the latest SUBMITTED buffer, not necessarily the latched reader.
  // Back may still be scanned until wait_for_swap_() confirms its release.
  uint8_t front_buffer_{0};
  uint8_t back_buffer_{1};
  bool swap_pending_{false};
  // After the first bounded wait, poll the SAME release fence without blocking.
  bool swap_timed_out_{false};
  // Difference to repair from front into back after release, before the next draw.
  DirtyRect pending_rect_{};
  // All chunks staged since the last submit; never repair over these pixels.
  DirtyRect frame_dirty_{};
  bool frame_active_{false};
  // A late acknowledgement cannot resume the remaining chunks of this frame.
  bool frame_aborted_{false};

  InternalGPIOPin *de_pin_{nullptr};
  InternalGPIOPin *pclk_pin_{nullptr};
  InternalGPIOPin *hsync_pin_{nullptr};
  InternalGPIOPin *vsync_pin_{nullptr};
  GPIOPin *reset_pin_{nullptr};
  InternalGPIOPin *data_pins_[16] = {};
  uint16_t hsync_pulse_width_ = 10;
  uint16_t hsync_back_porch_ = 10;
  uint16_t hsync_front_porch_ = 20;
  uint16_t vsync_pulse_width_ = 10;
  uint16_t vsync_back_porch_ = 10;
  uint16_t vsync_front_porch_ = 10;
  uint32_t pclk_frequency_ = 16 * 1000 * 1000;
  bool pclk_inverted_{true};
  const char *model_{"Unknown"};
  bool invert_colors_{};
  display::ColorOrder color_mode_{display::COLOR_ORDER_BGR};
  size_t width_;
  size_t height_;
  uint16_t *buffer_{nullptr};
  std::vector<GPIOPin *> enable_pins_{};
  uint16_t x_low_{1};
  uint16_t y_low_{1};
  uint16_t x_high_{0};
  uint16_t y_high_{0};

  esp_lcd_panel_handle_t handle_{};
};

#ifdef USE_SPI
class MipiRgbSpi : public MipiRgb,
                   public spi::SPIDevice<spi::BIT_ORDER_MSB_FIRST, spi::CLOCK_POLARITY_LOW, spi::CLOCK_PHASE_LEADING,
                                         spi::DATA_RATE_1MHZ> {
 public:
  MipiRgbSpi(int width, int height) : MipiRgb(width, height) {}

  void set_init_sequence(const std::vector<uint8_t> &init_sequence) { this->init_sequence_ = init_sequence; }
  void set_dc_pin(GPIOPin *dc_pin) { this->dc_pin_ = dc_pin; }
  void setup() override;

 protected:
  void write_command_(uint8_t value);
  void write_data_(uint8_t value);
  void write_init_sequence_();
  void dump_config() override;

  GPIOPin *dc_pin_{nullptr};
  std::vector<uint8_t> init_sequence_;
};
#endif

}  // namespace esphome::mipi_rgb
#endif
