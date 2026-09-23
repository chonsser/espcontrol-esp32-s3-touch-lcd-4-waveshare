#include "playback_policy.h"
#include <cassert>
#include <cstdint>
using namespace esphome::hls_screensaver;

int main() {
  PlaybackClock clock;
  uint64_t due = 0;
  assert(clock.schedule(126000, 1000, due) && due == 1000);
  assert(clock.schedule(135000, 1001, due) && due == 1100);
  assert(!clock.schedule(136000, 1002, due));  // too fast for the admitted stream
  clock.reset();
  assert(clock.schedule((uint64_t(1) << 33) - 4500, 2000, due));
  assert(clock.schedule(4500, 2001, due) && due == 2100);

  clock.reset();
  assert(clock.schedule(0, 1000, due) && due == 1000);
  assert(clock.schedule(9000, 2000, due) && due == 2000);  // recover after network/decode stall
  assert(clock.schedule(18000, 2001, due) && due == 2100);

  PlaybackPolicy policy;
  auto a = policy.request(true, 1, 10);
  assert(a == PlaybackPolicy::Action::START);
  const auto token = policy.token();
  policy.started();
  assert(policy.accepts(token));
  assert(policy.request(true, 2, 10) == PlaybackPolicy::Action::NONE);
  assert(policy.accepts(token));  // same mode, newer display generation
  assert(policy.request(false, 3, 10) == PlaybackPolicy::Action::STOP);
  assert(!policy.accepts(token));
  assert(policy.request(true, 4, 11) == PlaybackPolicy::Action::NONE);  // old workers still exiting
  policy.cleaned();
  assert(policy.request(true, 4, 11) == PlaybackPolicy::Action::START);
  policy.started();
  const auto next = policy.token();
  assert(next != token && policy.accepts(next));
  assert(policy.request(true, 5, 12) == PlaybackPolicy::Action::STOP);  // URL changed
  assert(!policy.accepts(next));

  VideoGate gate;
  const uint8_t sps[] = {0x67,0x42,0xc0,0x0d,0xda,0x05,0x06,0x6c,0x04,0x40,0,0,3,0,0x40,0,0,5,3,0xc5,0x0a,0xa8};
  const uint8_t pps[] = {0x68,0xce,0x32,0xc8};
  const uint8_t idr[] = {0x65,0x88,0x84};
  const uint8_t predicted[] = {0x41,0xe0};
  assert(gate.accept(predicted, sizeof(predicted)) == VideoGate::Result::SKIP);
  assert(gate.accept(sps, sizeof(sps)) == VideoGate::Result::RESET);
  assert(gate.accept(pps, sizeof(pps)) == VideoGate::Result::DECODE);
  assert(gate.accept(idr, sizeof(idr)) == VideoGate::Result::DECODE);
  assert(gate.accept(predicted, sizeof(predicted)) == VideoGate::Result::DECODE);
  const uint8_t bframe[] = {0x41,0xa8};
  assert(gate.accept(bframe, sizeof(bframe)) == VideoGate::Result::REJECT);
  assert(gate.accept(nullptr, 0) == VideoGate::Result::REJECT);
  return 0;
}
