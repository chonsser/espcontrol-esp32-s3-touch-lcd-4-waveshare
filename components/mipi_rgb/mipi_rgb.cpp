#if defined(USE_ESP32_VARIANT_ESP32S3) || defined(USE_ESP32_VARIANT_ESP32P4)
#include "mipi_rgb.h"
#include "esphome/core/gpio.h"
#include "esphome/core/hal.h"
#include "esphome/core/helpers.h"
#include "esphome/core/log.h"
#include <cinttypes>
#include <driver/gpio.h>
#include <esp_cache.h>
#include <esp_heap_caps.h>
#include <esp_idf_version.h>
#include <esp_lcd_panel_rgb.h>
#include <freertos/task.h>
#include <new>
#include <span>

namespace esphome::mipi_rgb {

static const uint8_t DELAY_FLAG = 0xFF;

// Maximum bytes to log for init commands (truncated if larger)
static constexpr size_t MIPI_RGB_MAX_CMD_LOG_BYTES = 64;
static constexpr uint8_t RGB_BOUNCE_BUFFER_ROWS = 20;
static constexpr uint8_t MADCTL_MY = 0x80;     // Bit 7 Bottom to top
static constexpr uint8_t MADCTL_MX = 0x40;     // Bit 6 Right to left
static constexpr uint8_t MADCTL_MV = 0x20;     // Bit 5 Swap axes
static constexpr uint8_t MADCTL_ML = 0x10;     // Bit 4 Refresh bottom to top
static constexpr uint8_t MADCTL_BGR = 0x08;    // Bit 3 Blue-Green-Red pixel order
static constexpr uint8_t MADCTL_XFLIP = 0x02;  // Mirror the display horizontally
static constexpr uint8_t MADCTL_YFLIP = 0x01;  // Mirror the display vertically

void MipiRgb::setup_enables_() {
  if (!this->enable_pins_.empty()) {
    for (auto *pin : this->enable_pins_) {
      pin->setup();
      pin->digital_write(true);
    }
    delay(10);
  }
  if (this->reset_pin_ != nullptr) {
    this->reset_pin_->setup();
    this->reset_pin_->digital_write(true);
    delay(5);
    this->reset_pin_->digital_write(false);
    delay(5);
    this->reset_pin_->digital_write(true);
  }
}

#ifdef USE_SPI
void MipiRgbSpi::setup() {
  this->setup_enables_();
  this->spi_setup();
  this->write_init_sequence_();
  this->common_setup_();
}
void MipiRgbSpi::write_command_(uint8_t value) {
  this->enable();
  if (this->dc_pin_ == nullptr) {
    this->write(value, 9);
  } else {
    this->dc_pin_->digital_write(false);
    this->write_byte(value);
    this->dc_pin_->digital_write(true);
  }
  this->disable();
}

void MipiRgbSpi::write_data_(uint8_t value) {
  this->enable();
  if (this->dc_pin_ == nullptr) {
    this->write(value | 0x100, 9);
  } else {
    this->dc_pin_->digital_write(true);
    this->write_byte(value);
  }
  this->disable();
}

/**
 * this relies upon the init sequence being well-formed, which is guaranteed by the Python init code.
 */

void MipiRgbSpi::write_init_sequence_() {
  size_t index = 0;
  auto &vec = this->init_sequence_;
  while (index != vec.size()) {
    if (vec.size() - index < 2) {
      this->mark_failed(LOG_STR("Malformed init sequence"));
      return;
    }
    uint8_t cmd = vec[index++];
    uint8_t x = vec[index++];
    if (x == DELAY_FLAG) {
      ESP_LOGD(TAG, "Delay %dms", cmd);
      delay(cmd);
    } else {
      uint8_t num_args = x & 0x7F;
      if (vec.size() - index < num_args) {
        this->mark_failed(LOG_STR("Malformed init sequence"));
        return;
      }
      if (cmd == SLEEP_OUT) {
        delay(120);  // NOLINT
      }
      const auto *ptr = vec.data() + index;
      char hex_buf[format_hex_pretty_size(MIPI_RGB_MAX_CMD_LOG_BYTES)];
      ESP_LOGD(TAG, "Write command %02X, length %d, byte(s) %s", cmd, num_args,
               format_hex_pretty_to(hex_buf, ptr, num_args, '.'));
      index += num_args;
      this->write_command_(cmd);
      while (num_args-- != 0)
        this->write_data_(*ptr++);
      if (cmd == SLEEP_OUT)
        delay(10);
    }
  }
  // this->spi_teardown();  // SPI not needed after this
  this->init_sequence_.clear();
  delay(10);
}

void MipiRgbSpi::dump_config() {
  MipiRgb::dump_config();
  LOG_PIN("  CS Pin: ", this->cs_);
  LOG_PIN("  DC Pin: ", this->dc_pin_);
  ESP_LOGCONFIG(TAG, "  SPI Data rate: %uMHz", (unsigned) (this->data_rate_ / 1000000));
}

#endif  // USE_SPI

void MipiRgb::setup() {
  this->setup_enables_();
  this->common_setup_();
}

void MipiRgb::common_setup_() {
  esp_lcd_rgb_panel_config_t config{};
  config.flags.fb_in_psram = 1;
  // Album-art redraws are full-screen and PSRAM-heavy. A larger internal bounce
  // buffer gives the RGB DMA more headroom while JPEG decode/LVGL compete for PSRAM.
  config.bounce_buffer_size_px = this->width_ * RGB_BOUNCE_BUFFER_ROWS;
  config.num_fbs = this->tear_free_ ? 2 : 1;
  config.timings.h_res = this->width_;
  config.timings.v_res = this->height_;
  config.timings.hsync_pulse_width = this->hsync_pulse_width_;
  config.timings.hsync_back_porch = this->hsync_back_porch_;
  config.timings.hsync_front_porch = this->hsync_front_porch_;
  config.timings.vsync_pulse_width = this->vsync_pulse_width_;
  config.timings.vsync_back_porch = this->vsync_back_porch_;
  config.timings.vsync_front_porch = this->vsync_front_porch_;
  config.timings.flags.pclk_active_neg = this->pclk_inverted_;
  config.timings.pclk_hz = this->pclk_frequency_;
  config.clk_src = LCD_CLK_SRC_PLL160M;
  size_t data_pin_count = sizeof(this->data_pins_) / sizeof(this->data_pins_[0]);
  for (size_t i = 0; i != data_pin_count; i++) {
    config.data_gpio_nums[i] = static_cast<gpio_num_t>(this->data_pins_[i]->get_pin());
  }
  config.data_width = data_pin_count;
  config.disp_gpio_num = GPIO_NUM_NC;
  if (this->hsync_pin_) {
    config.hsync_gpio_num = static_cast<gpio_num_t>(this->hsync_pin_->get_pin());
  } else {
    config.hsync_gpio_num = GPIO_NUM_NC;
  }
  if (this->vsync_pin_) {
    config.vsync_gpio_num = static_cast<gpio_num_t>(this->vsync_pin_->get_pin());
  } else {
    config.vsync_gpio_num = GPIO_NUM_NC;
  }
  if (this->de_pin_) {
    config.de_gpio_num = static_cast<gpio_num_t>(this->de_pin_->get_pin());
  } else {
    config.de_gpio_num = GPIO_NUM_NC;
  }
  config.pclk_gpio_num = static_cast<gpio_num_t>(this->pclk_pin_->get_pin());
  // RGB and GDMA IRQ allocation happens synchronously on this task's core.
  if (this->tear_free_)
    this->capture_source_owner_();
  esp_err_t err = esp_lcd_new_rgb_panel(&config, &this->handle_);
  if (err == ESP_OK && this->tear_free_)
    err = this->setup_tear_free_();
  if (err == ESP_OK)
    err = esp_lcd_panel_reset(this->handle_);
  if (err == ESP_OK)
    err = esp_lcd_panel_init(this->handle_);
  if (err != ESP_OK) {
    ESP_LOGE(TAG, "lcd setup failed: %s", esp_err_to_name(err));
    this->mark_failed(LOG_STR("lcd setup failed"));
    if (this->tear_free_) {
      if (this->handle_ != nullptr) {
        esp_lcd_panel_del(this->handle_);
        this->handle_ = nullptr;
      }
      if (this->vsync_ != nullptr) {
        if (this->vsync_->semaphore != nullptr)
          vSemaphoreDelete(this->vsync_->semaphore);
        this->vsync_->~VsyncContext();
        heap_caps_free(this->vsync_);
        this->vsync_ = nullptr;
      }
      this->frame_buffers_[0] = this->frame_buffers_[1] = nullptr;
    }
  }
  ESP_LOGCONFIG(TAG, "MipiRgb setup complete: pclk=%" PRIu32 "Hz bounce_rows=%u", this->pclk_frequency_,
                RGB_BOUNCE_BUFFER_ROWS);
}

esp_err_t MipiRgb::setup_tear_free_() {
  auto err = esp_lcd_rgb_panel_get_frame_buffer(this->handle_, 2, &this->frame_buffers_[0], &this->frame_buffers_[1]);
  if (err != ESP_OK)
    return err;

  // The callback must never dereference the component, which may live in PSRAM.
  void *storage = heap_caps_malloc(sizeof(VsyncContext), MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT);
  if (storage == nullptr)
    return ESP_ERR_NO_MEM;
  this->vsync_ = new (storage) VsyncContext();
  this->vsync_->semaphore = xSemaphoreCreateBinaryStatic(&this->vsync_->semaphore_storage);
  if (this->vsync_->semaphore == nullptr)
    return ESP_ERR_NO_MEM;

  const size_t size = this->width_ * this->height_ * sizeof(uint16_t);
  for (auto *fb : this->frame_buffers_) {
    memset(fb, 0, size);
    err = esp_cache_msync(fb, size, ESP_CACHE_MSYNC_FLAG_DIR_C2M | ESP_CACHE_MSYNC_FLAG_UNALIGNED);
    if (err != ESP_OK)
      return err;
  }

  const uint64_t horizontal = this->width_ + this->hsync_pulse_width_ + this->hsync_back_porch_ + this->hsync_front_porch_;
  const uint64_t vertical = this->height_ + this->vsync_pulse_width_ + this->vsync_back_porch_ + this->vsync_front_porch_;
  const uint32_t timeout_ms = (2000ULL * horizontal * vertical + this->pclk_frequency_ - 1) / this->pclk_frequency_;
  // Per-call wait budget, NOT a deadline for the ownership acknowledgement.
  // An underrun can abandon a bounce wrap and postpone release to a third frame.
  this->swap_timeout_ticks_ = pdMS_TO_TICKS(timeout_ms) + 2;
  esp_lcd_rgb_panel_event_callbacks_t callbacks{};
  callbacks.on_vsync = MipiRgb::on_vsync_;
  callbacks.on_frame_buf_complete = MipiRgb::on_frame_complete_;
  return esp_lcd_rgb_panel_register_event_callbacks(this->handle_, &callbacks, this->vsync_);
}

void MipiRgb::capture_source_owner_() {
  this->source_owner_task_ = xTaskGetCurrentTaskHandle();
  this->source_owner_core_ = xPortGetCoreID();
  // Audited IDF bounce-buffer latch/callback order and level 1-3 IRQ allocation.
  // Other chips/IDF versions and verbose IDF logging retain the two-wrap fence.
#if defined(USE_ESP32_VARIANT_ESP32S3) && ESP_IDF_VERSION == ESP_IDF_VERSION_VAL(5, 5, 5) && \
    defined(CONFIG_LOG_MAXIMUM_LEVEL) && CONFIG_LOG_MAXIMUM_LEVEL < 5 && \
    !defined(MIPI_RGB_FORCE_CONSERVATIVE_FENCE)
  this->exact_source_fence_ = xTaskGetCoreID(this->source_owner_task_) == this->source_owner_core_;
#endif
}

bool MipiRgb::is_source_owner_() const {
  if (xPortInIsrContext() || xTaskGetCurrentTaskHandle() != this->source_owner_task_)
    return false;
#if defined(USE_ESP32_VARIANT_ESP32S3) && ESP_IDF_VERSION == ESP_IDF_VERSION_VAL(5, 5, 5)
  if (this->exact_source_fence_)
    return xPortGetCoreID() == this->source_owner_core_ &&
           xTaskGetCoreID(this->source_owner_task_) == this->source_owner_core_;
#endif
  return true;
}

#ifdef MIPI_RGB_DIAGNOSTICS
class RgbDiagnosticTimer {
 public:
  explicit RgbDiagnosticTimer(uint64_t &total) : total_(total), start_(micros()) {}
  ~RgbDiagnosticTimer() { this->total_ += static_cast<uint32_t>(micros() - this->start_); }

 private:
  uint64_t &total_;
  uint32_t start_;
};
#endif

void MipiRgb::loop() {
  // The ESP-IDF RGB driver already restarts on real DMA underflow when needed.
  // Continuously requesting restarts can cause visible one-frame shifts and flicker.
}

bool IRAM_ATTR MipiRgb::on_vsync_(esp_lcd_panel_handle_t panel, const esp_lcd_rgb_panel_event_data_t *event_data,
                                void *user_ctx) {
  auto *context = static_cast<VsyncContext *>(user_ctx);
  portENTER_CRITICAL_ISR(&context->lock);
  context->count++;
  portEXIT_CRITICAL_ISR(&context->lock);
  BaseType_t task_woken = pdFALSE;
  xSemaphoreGiveFromISR(context->semaphore, &task_woken);
  return task_woken == pdTRUE;
}

bool IRAM_ATTR MipiRgb::on_frame_complete_(esp_lcd_panel_handle_t panel,
                                         const esp_lcd_rgb_panel_event_data_t *event_data, void *user_ctx) {
  auto *context = static_cast<VsyncContext *>(user_ctx);
  portENTER_CRITICAL_ISR(&context->lock);
  context->frame_count++;
  portEXIT_CRITICAL_ISR(&context->lock);
  BaseType_t task_woken = pdFALSE;
  xSemaphoreGiveFromISR(context->semaphore, &task_woken);
  return task_woken == pdTRUE;
}

bool MipiRgb::wait_for_swap_() {
  if (!this->is_source_owner_() || this->is_failed())
    return false;
  if (!this->swap_pending_)
    return true;
#ifdef MIPI_RGB_DIAGNOSTICS
  RgbDiagnosticTimer wait_timer(this->diagnostics_.wait_us);
#endif
  const TickType_t start = xTaskGetTickCount();
  while (true) {
    portENTER_CRITICAL(&this->vsync_->lock);
    const uint32_t count = this->vsync_->count;
    const uint32_t frame_count = this->vsync_->frame_count;
    portEXIT_CRITICAL(&this->vsync_->lock);
    // The exact fence excludes an old latch between publication and arming.
    // A real wrap completes the old PSRAM copy, latches the new source, THEN
    // calls us. Trailing old pixels in SRAM bounce buffers may still drain.
    // VSYNC-only underrun restart does not latch and must never release PSRAM.
    if (this->exact_source_fence_ ? frame_count - this->swap_frame_count_ >= 1
                                  : count - this->swap_vsync_count_ >= 2 &&
                                        frame_count - this->swap_frame_count_ >= 2)
      break;
    // Once timed out, later refreshes only poll. Missing callbacks must not
    // impose another full wait (or warning) on every LVGL refresh attempt.
    if (this->swap_timed_out_)
      return false;
    const TickType_t elapsed = xTaskGetTickCount() - start;
    if (elapsed >= this->swap_timeout_ticks_) {
      // Keep BOTH buffers, indices, dirty repair and original fence untouched.
      // Only a later real acknowledgement can release back; elapsed time cannot.
      this->swap_timed_out_ = true;
      ESP_LOGW(TAG, "RGB swap delayed; retaining buffers and retrying complete refresh");
      return false;
    }
    xSemaphoreTake(this->vsync_->semaphore, this->swap_timeout_ticks_ - elapsed);
  }
  this->swap_pending_ = false;
  this->swap_timed_out_ = false;
#ifdef MIPI_RGB_DIAGNOSTICS
  this->diagnostics_.acknowledgements++;
#endif
  return true;
}

void MipiRgb::begin_frame() {
  if (this->tear_free_ && !this->is_failed() && this->is_source_owner_()) {
    this->frame_active_ = true;
    this->frame_aborted_ = false;
  }
}

bool MipiRgb::end_frame() {
  if (this->tear_free_ && !this->is_source_owner_())
    return false;
  if (!this->frame_active_)
    return true;
  this->frame_active_ = false;
  // Never publish a suffix of a rejected refresh, even if its fence arrived
  // between chunks. The caller must re-invalidate/replay the complete refresh.
  const bool accepted = !this->frame_aborted_ && this->submit_frame_();
#ifdef MIPI_RGB_DIAGNOSTICS
  if (!accepted)
    this->diagnostics_.rejected_refreshes++;
#endif
  return accepted;
}

bool MipiRgb::write_tear_free_(int x_start, int y_start, int w, int h, const uint8_t *ptr, int stride) {
  if (!this->is_source_owner_())
    return false;
  if (this->frame_active_ && this->frame_aborted_)
    return false;
  const int x_end = std::min(x_start + w, static_cast<int>(this->width_));
  const int y_end = std::min(y_start + h, static_cast<int>(this->height_));
  const int x = std::max(x_start, 0);
  const int y = std::max(y_start, 0);
  if (x >= x_end || y >= y_end)
    return true;
  ptr += (y - y_start) * stride + (x - x_start) * sizeof(uint16_t);
  if (!this->wait_for_swap_()) {
    this->frame_aborted_ = true;
    return false;
  }

  auto *front = static_cast<uint16_t *>(this->frame_buffers_[this->front_buffer_]);
  auto *back = static_cast<uint16_t *>(this->frame_buffers_[this->back_buffer_]);
  // Repair exactly once per frame; repeating this per chunk would overwrite
  // chunks already staged for this refresh with pixels from the old front.
  if (this->frame_dirty_.h == 0) {
    const auto previous = this->pending_rect_;
    // Only this actual first chunk can prove complete overwrite. A bounding
    // union of separate chunks may contain holes and is not sufficient proof.
    const bool overwritten = x <= previous.x && y <= previous.y &&
                             x_end >= previous.x + previous.w && y_end >= previous.y + previous.h;
    if (!overwritten) {
#ifdef MIPI_RGB_DIAGNOSTICS
      RgbDiagnosticTimer repair_timer(this->diagnostics_.repair_us);
      this->diagnostics_.repair_bytes += previous.w * previous.h * sizeof(uint16_t);
#endif
      for (int row = previous.y; row < previous.y + previous.h; row++) {
        const size_t offset = row * this->width_ + previous.x;
        memcpy(back + offset, front + offset, previous.w * sizeof(uint16_t));
      }
    }
  }
  {
#ifdef MIPI_RGB_DIAGNOSTICS
    RgbDiagnosticTimer staging_timer(this->diagnostics_.staging_us);
    this->diagnostics_.staging_bytes += (x_end - x) * (y_end - y) * sizeof(uint16_t);
#endif
    for (int row = y; row < y_end; row++) {
      memcpy(back + row * this->width_ + x, ptr, (x_end - x) * sizeof(uint16_t));
      ptr += stride;
    }
  }
  const auto staged = this->frame_dirty_;
  const int left = staged.h == 0 ? x : std::min(x, staged.x);
  const int top = staged.h == 0 ? y : std::min(y, staged.y);
  this->frame_dirty_ = {left, top, std::max(x_end, staged.x + staged.w) - left,
                        std::max(y_end, staged.y + staged.h) - top};
  return this->frame_active_ || this->submit_frame_();
}

bool MipiRgb::submit_frame_() {
  if (!this->is_source_owner_() || this->is_failed())
    return false;
  if (this->frame_dirty_.h == 0)
    return true;
  auto *back = static_cast<uint16_t *>(this->frame_buffers_[this->back_buffer_]);
  const auto changed = this->frame_dirty_;
  const auto previous = this->pending_rect_;
  // Keep the entire modified region repairable if cache sync or submission fails.
  const int dirty_x = previous.h == 0 ? changed.x : std::min(changed.x, previous.x);
  const int dirty_y = previous.h == 0 ? changed.y : std::min(changed.y, previous.y);
  const int dirty_end_x = std::max(changed.x + changed.w, previous.x + previous.w);
  const int dirty_end_y = std::max(changed.y + changed.h, previous.y + previous.h);
  this->pending_rect_ = {dirty_x, dirty_y, dirty_end_x - dirty_x, dirty_end_y - dirty_y};
  // Match IDF's C2M writeback flags and full-row range; never invalidate CPU writes.
  // IDF skips framebuffer writeback in bounce mode, where the ISR reads via cache.
#ifdef MIPI_RGB_DIAGNOSTICS
  const uint32_t cache_start = micros();
  this->diagnostics_.cache_bytes += (dirty_end_y - dirty_y) * this->width_ * sizeof(uint16_t);
#endif
  auto err = esp_cache_msync(back + dirty_y * this->width_,
                            (dirty_end_y - dirty_y) * this->width_ * sizeof(uint16_t),
                            ESP_CACHE_MSYNC_FLAG_DIR_C2M | ESP_CACHE_MSYNC_FLAG_UNALIGNED);
#ifdef MIPI_RGB_DIAGNOSTICS
  this->diagnostics_.cache_us += static_cast<uint32_t>(micros() - cache_start);
#endif
  // Passing an IDF-owned full-frame pointer selects it without copying into the
  // scanned framebuffer. Publish only once after ALL chunks of an LVGL refresh.
  if (err == ESP_OK) {
    // Only the audited owned-pointer/bounce/no-color-callback path is inside
    // this guard: no copy, cache sync, allocation, descriptor relink or wait.
    // Same-core IRQ masking excludes the driver's latch AND our callback;
    // locking only our counters would NOT exclude an earlier cross-core latch.
#ifdef MIPI_RGB_DIAGNOSTICS
    const uint32_t publish_start = micros();
#endif
    if (this->exact_source_fence_)
      portENTER_CRITICAL(&this->vsync_->lock);
    err = esp_lcd_panel_draw_bitmap(this->handle_, 0, 0, this->width_, this->height_, back);
    if (!this->exact_source_fence_)
      portENTER_CRITICAL(&this->vsync_->lock);
    this->swap_vsync_count_ = this->vsync_->count;
    this->swap_frame_count_ = this->vsync_->frame_count;
    portEXIT_CRITICAL(&this->vsync_->lock);
#ifdef MIPI_RGB_DIAGNOSTICS
    this->diagnostics_.publish_max_us =
        std::max(this->diagnostics_.publish_max_us, static_cast<uint32_t>(micros() - publish_start));
#endif
  }
  this->frame_dirty_ = {};
  if (err != ESP_OK) {
    ESP_LOGE(TAG, "RGB framebuffer submission failed: %s", esp_err_to_name(err));
    return false;
  }

#ifdef MIPI_RGB_DIAGNOSTICS
  this->diagnostics_.submissions++;
#endif
  this->swap_pending_ = true;
  std::swap(this->front_buffer_, this->back_buffer_);
  this->pending_rect_ = changed;
  return true;
}

void MipiRgb::update() {
  if ((this->tear_free_ && !this->is_source_owner_()) || this->is_failed())
    return;
  if (this->auto_clear_enabled_) {
    this->clear();
  }
  if (this->show_test_card_) {
    this->test_card();
  } else if (this->page_ != nullptr) {
    this->page_->get_writer()(*this);
  } else if (this->writer_.has_value()) {
    (*this->writer_)(*this);
  } else {
    this->stop_poller();
  }
  if (this->buffer_ == nullptr || this->x_low_ > this->x_high_ || this->y_low_ > this->y_high_)
    return;
  ESP_LOGV(TAG, "x_low %d, y_low %d, x_high %d, y_high %d", this->x_low_, this->y_low_, this->x_high_, this->y_high_);
  int w = this->x_high_ - this->x_low_ + 1;
  int h = this->y_high_ - this->y_low_ + 1;
  const bool accepted =
      this->write_to_display_(this->x_low_, this->y_low_, w, h, reinterpret_cast<const uint8_t *>(this->buffer_),
                              this->x_low_, this->y_low_, this->width_ - w - this->x_low_);
  // Keep generic buffered drawing retryable if ownership/submission failed, or
  // if an enclosing raw frame has not yet been submitted. Option-off unchanged.
  if (this->tear_free_ && (!accepted || this->frame_active_))
    return;
  // invalidate watermarks
  this->x_low_ = this->width_;
  this->y_low_ = this->height_;
  this->x_high_ = 0;
  this->y_high_ = 0;
}

void MipiRgb::draw_pixels_at(int x_start, int y_start, int w, int h, const uint8_t *ptr, display::ColorOrder order,
                             display::ColorBitness bitness, bool big_endian, int x_offset, int y_offset, int x_pad) {
  if ((this->tear_free_ && !this->is_source_owner_()) || w <= 0 || h <= 0 || this->is_failed())
    return;
  // if color mapping is required, pass the buck.
  // note that endianness is not considered here - it is assumed to match!
  if (bitness != display::COLOR_BITNESS_565) {
    if (this->tear_free_ && !this->check_buffer_())
      return;
    Display::draw_pixels_at(x_start, y_start, w, h, ptr, order, bitness, big_endian, x_offset, y_offset, x_pad);
    this->write_to_display_(x_start, y_start, w, h, reinterpret_cast<const uint8_t *>(this->buffer_), x_start, y_start,
                            this->width_ - w - x_start);
  } else {
    this->write_to_display_(x_start, y_start, w, h, ptr, x_offset, y_offset, x_pad);
  }
}

bool MipiRgb::write_to_display_(int x_start, int y_start, int w, int h, const uint8_t *ptr, int x_offset, int y_offset,
                                int x_pad) {
  esp_err_t err = ESP_OK;
  auto stride = (x_offset + w + x_pad) * 2;
  ptr += y_offset * stride + x_offset * 2;  // skip to the first pixel
  if (this->tear_free_)
    return this->write_tear_free_(x_start, y_start, w, h, ptr, stride);
  // x_ and y_offset are offsets into the source buffer, unrelated to our own offsets into the display.
  if (x_offset == 0 && x_pad == 0) {
    err = esp_lcd_panel_draw_bitmap(this->handle_, x_start, y_start, x_start + w, y_start + h, ptr);
  } else {
    // draw line by line
    for (int y = 0; y != h; y++) {
      err = esp_lcd_panel_draw_bitmap(this->handle_, x_start, y + y_start, x_start + w, y + y_start + 1, ptr);
      if (err != ESP_OK)
        break;
      ptr += stride;  // next line
    }
  }
  if (err != ESP_OK)
    ESP_LOGE(TAG, "lcd_lcd_panel_draw_bitmap failed: %s", esp_err_to_name(err));
  return err == ESP_OK;
}

bool MipiRgb::check_buffer_() {
  if (this->is_failed())
    return false;
  if (this->buffer_ != nullptr)
    return true;
  // this is dependent on the enum values.
  RAMAllocator<uint16_t> allocator;
  this->buffer_ = allocator.allocate(this->height_ * this->width_);
  if (this->buffer_ == nullptr) {
    this->mark_failed(LOG_STR("Could not allocate buffer for display!"));
    return false;
  }
  return true;
}

void MipiRgb::draw_pixel_at(int x, int y, Color color) {
  if (this->tear_free_ && !this->is_source_owner_())
    return;
  if (!this->get_clipping().inside(x, y) || this->is_failed())
    return;

  switch (this->rotation_) {
    case display::DISPLAY_ROTATION_0_DEGREES:
      break;
    case display::DISPLAY_ROTATION_90_DEGREES:
      std::swap(x, y);
      x = this->width_ - x - 1;
      break;
    case display::DISPLAY_ROTATION_180_DEGREES:
      x = this->width_ - x - 1;
      y = this->height_ - y - 1;
      break;
    case display::DISPLAY_ROTATION_270_DEGREES:
      std::swap(x, y);
      y = this->height_ - y - 1;
      break;
  }
  if (x >= this->get_width_internal() || x < 0 || y >= this->get_height_internal() || y < 0) {
    return;
  }
  if (!this->check_buffer_())
    return;
  size_t pos = (y * this->width_) + x;
  uint16_t new_color = convert_big_endian(display::ColorUtil::color_to_565(color));
  if (this->buffer_[pos] == new_color)
    return;
  this->buffer_[pos] = new_color;
  // low and high watermark may speed up drawing from buffer
  if (x < this->x_low_)
    this->x_low_ = x;
  if (y < this->y_low_)
    this->y_low_ = y;
  if (x > this->x_high_)
    this->x_high_ = x;
  if (y > this->y_high_)
    this->y_high_ = y;
}
void MipiRgb::fill(Color color) {
  if (this->tear_free_ && !this->is_source_owner_())
    return;
  if (!this->check_buffer_())
    return;

  // If clipping is active, fall back to base implementation
  if (this->get_clipping().is_set()) {
    Display::fill(color);
    return;
  }

  auto *ptr_16 = reinterpret_cast<uint16_t *>(this->buffer_);
  uint16_t new_color = convert_big_endian(display::ColorUtil::color_to_565(color));
  std::fill_n(ptr_16, this->width_ * this->height_, new_color);
  this->x_low_ = 0;
  this->y_low_ = 0;
  this->x_high_ = this->width_ - 1;
  this->y_high_ = this->height_ - 1;
}

int MipiRgb::get_width() {
  switch (this->rotation_) {
    case display::DISPLAY_ROTATION_90_DEGREES:
    case display::DISPLAY_ROTATION_270_DEGREES:
      return this->get_height_internal();
    case display::DISPLAY_ROTATION_0_DEGREES:
    case display::DISPLAY_ROTATION_180_DEGREES:
    default:
      return this->get_width_internal();
  }
}

int MipiRgb::get_height() {
  switch (this->rotation_) {
    case display::DISPLAY_ROTATION_0_DEGREES:
    case display::DISPLAY_ROTATION_180_DEGREES:
      return this->get_height_internal();
    case display::DISPLAY_ROTATION_90_DEGREES:
    case display::DISPLAY_ROTATION_270_DEGREES:
    default:
      return this->get_width_internal();
  }
}

static const char *get_pin_name(GPIOPin *pin, std::span<char, GPIO_SUMMARY_MAX_LEN> buffer) {
  if (pin == nullptr)
    return "None";
  pin->dump_summary(buffer.data(), buffer.size());
  return buffer.data();
}

void MipiRgb::dump_pins_(uint8_t start, uint8_t end, const char *name, uint8_t offset) {
  char pin_summary[GPIO_SUMMARY_MAX_LEN];
  for (uint8_t i = start; i != end; i++) {
    this->data_pins_[i]->dump_summary(pin_summary, sizeof(pin_summary));
    ESP_LOGCONFIG(TAG, "  %s pin %d: %s", name, offset++, pin_summary);
  }
}

void MipiRgb::dump_config() {
  ESP_LOGCONFIG(TAG, "  Tear-free: %s", YESNO(this->tear_free_ && !this->is_failed()));
  if (this->tear_free_) {
    ESP_LOGCONFIG(TAG, "  Framebuffers: %p, %p", this->frame_buffers_[0], this->frame_buffers_[1]);
    ESP_LOGCONFIG(TAG, "  Source fence: %s", this->exact_source_fence_ ? "exact bounce wrap" : "conservative two wraps");
  }
  char reset_buf[GPIO_SUMMARY_MAX_LEN];
  char de_buf[GPIO_SUMMARY_MAX_LEN];
  char pclk_buf[GPIO_SUMMARY_MAX_LEN];
  char hsync_buf[GPIO_SUMMARY_MAX_LEN];
  char vsync_buf[GPIO_SUMMARY_MAX_LEN];
  ESP_LOGCONFIG(TAG,
                "MIPI_RGB LCD"
                "\n  Model: %s"
                "\n  Width: %u"
                "\n  Height: %u"
                "\n  Rotation: %d degrees"
                "\n  PCLK Inverted: %s"
                "\n  HSync Pulse Width: %u"
                "\n  HSync Back Porch: %u"
                "\n  HSync Front Porch: %u"
                "\n  VSync Pulse Width: %u"
                "\n  VSync Back Porch: %u"
                "\n  VSync Front Porch: %u"
                "\n  Invert Colors: %s"
                "\n  Pixel Clock: %uMHz"
                "\n  Reset Pin: %s"
                "\n  DE Pin: %s"
                "\n  PCLK Pin: %s"
                "\n  HSYNC Pin: %s"
                "\n  VSYNC Pin: %s",
                this->model_, this->width_, this->height_, this->rotation_, YESNO(this->pclk_inverted_),
                this->hsync_pulse_width_, this->hsync_back_porch_, this->hsync_front_porch_, this->vsync_pulse_width_,
                this->vsync_back_porch_, this->vsync_front_porch_, YESNO(this->invert_colors_),
                (unsigned) (this->pclk_frequency_ / 1000000), get_pin_name(this->reset_pin_, reset_buf),
                get_pin_name(this->de_pin_, de_buf), get_pin_name(this->pclk_pin_, pclk_buf),
                get_pin_name(this->hsync_pin_, hsync_buf), get_pin_name(this->vsync_pin_, vsync_buf));

  this->dump_pins_(8, 13, "Blue", 0);
  this->dump_pins_(13, 16, "Green", 0);
  this->dump_pins_(0, 3, "Green", 3);
  this->dump_pins_(3, 8, "Red", 0);
}

}  // namespace esphome::mipi_rgb
#endif  // defined(USE_ESP32_VARIANT_ESP32S3) || defined(USE_ESP32_VARIANT_ESP32P4)
