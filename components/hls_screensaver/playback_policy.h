#pragma once
#include "h264_video.h"
#include "mpegts_demux.h"

namespace esphome::hls_screensaver {

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
    generation_ = generation;
    if (running_ && (!wanted || revision != revision_)) {
      running_ = false; ++token_; return Action::STOP;
    }
    if (wanted && !occupied_) {
      revision_ = revision; ++token_; occupied_ = true; return Action::START;
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
