#pragma once
#include "h264_video.h"
#include "mpegts_demux.h"

namespace esphome::hls_screensaver {

class PictureTimestamps {
 public:
  void reset() { ready_ = have_anchor_ = have_picture_ = false; remainder_ = 0; }
  bool begin_slice(const uint8_t *nal, size_t size, const PesTimestamp &stamp) {
    if (size < 2) return false;
    BitReader bits(nal + 1, size - 1);
    const auto first_mb = bits.ue();
    if (!bits.valid()) return false;
    if (first_mb == 0) { picture_ = stamp; have_picture_ = true; }
    return have_picture_;
  }
  bool resolve_picture(const VideoParameters &parameters, uint64_t &pts) {
    return have_picture_ && resolve(picture_, parameters, pts);
  }
  bool resolve(const PesTimestamp &stamp, const VideoParameters &parameters, uint64_t &pts) {
    if (stamp.present && (!have_anchor_ || stamp.sequence != anchor_sequence_)) {
      previous_ = stamp.value; remainder_ = 0;
      anchor_sequence_ = stamp.sequence; have_anchor_ = ready_ = true;
    } else {
      if (!ready_ || !parameters.fixed_frame_rate || !parameters.num_units_in_tick || !parameters.time_scale)
        return false;
      const uint64_t duration = uint64_t(parameters.num_units_in_tick) * 180000;
      if (duration < uint64_t(parameters.time_scale) * 6000 ||
          duration > uint64_t(parameters.time_scale) * 900000) return false;
      const uint64_t ticks = duration + remainder_;
      previous_ = (previous_ + ticks / parameters.time_scale) & ((uint64_t(1) << 33) - 1);
      remainder_ = ticks % parameters.time_scale;
    }
    pts = previous_;
    return true;
  }
 private:
  uint64_t previous_{0}, remainder_{0}, anchor_sequence_{0};
  PesTimestamp picture_;
  bool ready_{false}, have_anchor_{false}, have_picture_{false};
};

class PlaybackClock {
 public:
  void reset() { ready_ = false; }
  bool schedule(uint64_t pts, uint64_t now_ms, uint64_t &due_ms) {
    if (!ready_) { ready_ = true; previous_ = pts; due_ = now_ms; remainder_ = 0; }
    else {
      const int64_t delta = pts_delta(pts, previous_);
      if (delta < 6000 || delta > 900000) return false;  // at most 15 fps
      const auto ticks = uint64_t(delta) + remainder_;
      due_ += ticks / 90;
      remainder_ = ticks % 90;
      previous_ = pts;
      // Decode reference frames even when late, then rebase presentation rather
      // than dropping every future frame forever after a network stall.
      if (now_ms > due_ && now_ms - due_ > 500) due_ = now_ms;
    }
    due_ms = due_;
    return true;
  }
 private:
  bool ready_{false};
  uint64_t previous_{0}, due_{0}, remainder_{0};
};

class PlaybackPolicy {
 public:
  enum class Action { NONE, START, STOP };
  Action request(bool wanted, uint32_t generation, uint32_t revision) {
    if (running_ && (!wanted || generation != generation_ || revision != revision_)) {
      running_ = false; ++token_; return Action::STOP;
    }
    if (wanted && !occupied_) {
      generation_ = generation; revision_ = revision;
      ++token_; occupied_ = true; return Action::START;
    }
    return Action::NONE;
  }
  void started() { running_ = true; }
  void cleaned() { occupied_ = running_ = false; }
  bool accepts(uint64_t token) const { return running_ && token == token_; }
  uint64_t token() const { return token_; }
 private:
  bool running_{false}, occupied_{false};
  uint32_t generation_{0}, revision_{0};
  uint64_t token_{0};
};

class VideoGate {
 public:
  enum class Result { REJECT, SKIP, DECODE, RESET };
  void reset() { have_sps_ = have_pps_ = have_idr_ = false; }
  const VideoParameters &parameters() const { return parameters_; }
  Result accept(const uint8_t *nal, size_t size) {
    if (!nal || size < 2 || (nal[0] & 0x80)) return Result::REJECT;
    const auto type = nal[0] & 31;
    if (type == 7) {
      if (!parse_sps(nal, size, parameters_)) return Result::REJECT;
      have_sps_ = true; have_pps_ = have_idr_ = false;
      return Result::RESET;
    }
    if (type == 8) {
      if (!have_sps_ || !parse_pps(nal, size, parameters_.sps_id, pps_id_)) return Result::REJECT;
      have_pps_ = true; return Result::DECODE;
    }
    if (type == 6 || type == 9 || type == 10 || type == 11 || type == 12) return Result::SKIP;
    if (type != 1 && type != 5) return Result::REJECT;
    if (!have_sps_ || !have_pps_) return Result::SKIP;
    BitReader bits(nal + 1, size - 1);
    const auto first_mb = bits.ue(), slice_type = bits.ue(), pps = bits.ue();
    if (!bits.valid() || first_mb >= unsigned(parameters_.coded_width / 16) * unsigned(parameters_.coded_height / 16) ||
        slice_type > 9 || (slice_type % 5 != 0 && slice_type % 5 != 2) || pps != pps_id_) return Result::REJECT;
    if (type == 5) {
      if (slice_type % 5 != 2) return Result::REJECT;
      have_idr_ = true;
    }
    return have_idr_ ? Result::DECODE : Result::SKIP;
  }
 private:
  VideoParameters parameters_;
  uint32_t pps_id_{0};
  bool have_sps_{false}, have_pps_{false}, have_idr_{false};
};

}  // namespace esphome::hls_screensaver
