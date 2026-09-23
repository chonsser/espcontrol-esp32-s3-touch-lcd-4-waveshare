"""Host tests for the actual IDF transport adapter; SDK operations are fakes."""
import os
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
stub = r'''
#pragma once
#include <atomic>
#include <cassert>
#include <cstdint>
using esp_err_t = int;
constexpr int ESP_OK = 0;
struct Transport;
using esp_transport_handle_t = Transport *;
using connect_func = int (*)(Transport *, const char *, int, int);
using io_read_func = int (*)(Transport *, char *, int, int);
using io_func = int (*)(Transport *, const char *, int, int);
using trans_func = int (*)(Transport *);
using poll_func = int (*)(Transport *, int);
struct Transport {
  void *context{}; connect_func connect{}; io_read_func read{}; io_func write{};
  trans_func close{}, destroy{}; poll_func poll_read{}, poll_write{};
};
inline uint64_t fake_now = 0;
inline int reads = 0, live = 0, allocations = 0, fail_allocation = 0, last_timeout = 0;
inline bool certificate_bundle = false;
inline std::atomic<bool> *cancel_during_read = nullptr;
inline uint64_t clock_ms() { return fake_now; }
inline Transport *esp_transport_init() {
  if (++allocations == fail_allocation) return nullptr;
  ++live; return new Transport();
}
inline void *esp_transport_get_context_data(Transport *t) { return t->context; }
inline int esp_transport_set_context_data(Transport *t, void *context) { t->context=context; return ESP_OK; }
inline int esp_transport_set_func(Transport *t, connect_func c, io_read_func r, io_func w,
                                 trans_func close, poll_func pr, poll_func pw, trans_func d) {
  t->connect=c; t->read=r; t->write=w; t->close=close; t->poll_read=pr; t->poll_write=pw; t->destroy=d;
  return ESP_OK;
}
inline int esp_transport_connect(Transport *t, const char *h, int p, int ms) {
  if (t->connect) return t->connect(t,h,p,ms);
  last_timeout=ms; return 0;
}
inline int esp_transport_read(Transport *t, char *b, int n, int ms) {
  if (t->read) return t->read(t,b,n,ms);
  ++reads; last_timeout=ms; fake_now += 500; *b='X';
  if (cancel_during_read) cancel_during_read->store(true);
  return 1;
}
inline int esp_transport_write(Transport *t, const char *b, int n, int ms) {
  if (t->write) return t->write(t,b,n,ms);
  last_timeout=ms; return n;
}
inline int esp_transport_poll_read(Transport *t, int ms) { return t->poll_read ? t->poll_read(t,ms) : 1; }
inline int esp_transport_poll_write(Transport *t, int ms) { return t->poll_write ? t->poll_write(t,ms) : 1; }
inline int esp_transport_close(Transport *t) { return t->close ? t->close(t) : 0; }
inline int esp_transport_destroy(Transport *t) {
  if (t->destroy) t->destroy(t);
  delete t; --live; return ESP_OK;
}
inline Transport *esp_transport_tcp_init() { return esp_transport_init(); }
inline Transport *esp_transport_ssl_init() { return esp_transport_init(); }
inline int esp_crt_bundle_attach(void *) { return ESP_OK; }
inline void esp_transport_ssl_crt_bundle_attach(Transport *, esp_err_t (*)(void *)) { certificate_bundle=true; }
'''
source = (ROOT / "components/hls_screensaver/hls_screensaver.cpp").read_text()
fetch = source[source.index("static bool fetch("):source.index("static bool fetch_retry(")]
http = r'''
#include "bounded_transport.h"
#include "hls_playlist.h"
#include "byte_buffer.h"
#include <string>
using namespace esphome::hls_screensaver;
static uint64_t now_ms() { return clock_ms(); }
struct PlaybackSession { std::atomic<bool> cancelled{false}; };
struct ResponseHeaders { std::string location; bool compressed{false}; };
static int http_event(void *) { return 0; }
struct esp_http_client_config_t {
  const char *url{}; int timeout_ms{}, buffer_size{}, buffer_size_tx{};
  bool disable_auto_redirect{}; Transport *transport{};
  int (*crt_bundle_attach)(void *){}; int (*event_handler)(void *){}; void *user_data{};
};
struct Client { esp_http_client_config_t config; };
static Client *esp_http_client_init(const esp_http_client_config_t *c) { return new Client{*c}; }
static void esp_http_client_set_header(Client *, const char *, const char *) {}
static int esp_http_client_open(Client *, int) { return ESP_OK; }
static int64_t esp_http_client_fetch_headers(Client *c) {
  char byte;
  assert(c->config.transport != nullptr && "fetch must install the bounded adapter");
  while (esp_transport_read(c->config.transport, &byte, 1, 1000) > 0)
    assert(reads < 100 && "unbounded header loop");
  return -1;
}
static int esp_http_client_get_status_code(Client *) { return 200; }
static int esp_http_client_read(Client *, char *, int) { return 0; }
static bool esp_http_client_is_complete_data_received(Client *) { return false; }
static void esp_http_client_cleanup(Client *c) { esp_transport_close(c->config.transport); delete c; }
'''
test = r'''
int main() {
  for (const auto *url : {"http://host/live", "https://host/live"}) {
    PlaybackSession session;
    ByteBuffer body;
    std::string final_url;
    fake_now=0; reads=0;
    assert(!fetch(session, url, body, MAX_PLAYLIST, final_url));
    assert(fake_now == 20000 && live == 0);
    fake_now=0; reads=0; cancel_during_read=&session.cancelled;
    assert(!fetch(session, url, body, MAX_PLAYLIST, final_url));
    assert(reads == 1 && live == 0);
    cancel_during_read=nullptr;
  }
  for (bool tls : {false, true}) {
    std::atomic<bool> cancelled{false}; fake_now=0; reads=0; certificate_bundle=false;
    {
      DeadlineTransport transport(cancelled, 20000, clock_ms);
      assert(transport.init(tls));
      assert(certificate_bundle == tls);
      char byte;
      // Same repeated transport reads used by fetch_headers: peer never
      // finishes its header, but drips a byte before each per-read timeout.
      while (esp_transport_read(transport.handle(), &byte, 1, 1000) > 0) {
        assert(reads < 100 && "overall header deadline was not enforced");
      }
      assert(fake_now == 20000 && reads == 40);
      const int before=reads;
      assert(esp_transport_read(transport.handle(), &byte, 1, 1000) < 0);
      assert(reads == before);
    }
    assert(live == 0);
    cancelled=false; fake_now=0; reads=0;
    {
      DeadlineTransport transport(cancelled, 20000, clock_ms);
      assert(transport.init(tls));
      cancel_during_read=&cancelled;
      char byte;
      assert(esp_transport_read(transport.handle(), &byte, 1, 1000) < 0);
      assert(reads == 1); // in-progress read finished, no next read after cancellation
      assert(esp_transport_read(transport.handle(), &byte, 1, 1000) < 0);
      assert(reads == 1);
      cancel_during_read=nullptr;
    }
    assert(live == 0);
    cancelled=false; fake_now=19950;
    {
      DeadlineTransport transport(cancelled, 20000, clock_ms);
      assert(transport.init(tls));
      assert(esp_transport_write(transport.handle(), "x", 1, 1000) == 1);
      assert(last_timeout == 50);
    }
    assert(live == 0);
  }
  for (int allocation : {1, 2}) {
    allocations=0; fail_allocation=allocation;
    std::atomic<bool> cancelled{false};
    { DeadlineTransport transport(cancelled, 20000, clock_ms); assert(!transport.init(false)); }
    assert(live == 0);
  }
}
'''
with tempfile.TemporaryDirectory(prefix="hls-http-deadline-") as temp:
    directory = Path(temp)
    (directory / "esp_transport.h").write_text(stub)
    for name in ("esp_transport_tcp.h", "esp_transport_ssl.h", "esp_crt_bundle.h"):
        (directory / name).write_text('#include "esp_transport.h"\n')
    cpp = directory / "deadline.cpp"
    cpp.write_text(http + fetch + test)
    binary = directory / "deadline"
    subprocess.run([os.environ.get("CXX", "c++"), "-std=c++17", "-Wall", "-Wextra", "-Werror",
                    "-I", str(directory), "-I", str(ROOT / "components/hls_screensaver"),
                    str(cpp), "-o", str(binary)], check=True)
    subprocess.run([str(binary)], check=True)
