#include <cassert>
#include <string>
#include <vector>
#include "screen_navigation_options.h"

int main() {
  using namespace espcontrol;
  std::vector<std::string> options;
  assert(parse_screen_navigation_options(R"(["Home", " music, TV ", "Łazienka", "quote\"", "slash\\"])", options));
  assert((options == std::vector<std::string>{"Home", " music, TV ", "Łazienka", "quote\"", "slash\\"}));
  assert(parse_screen_navigation_options(R"(['Bob\'s', '\u0141azienka', '\U0001f600', '\x41', 'a\nb',])", options));
  assert((options == std::vector<std::string>{"Bob's", "Łazienka", "😀", "A", "a\nb"}));
  assert(parse_screen_navigation_options(R"(["\ud83d\ude00", "same", "same"])", options));
  assert((options == std::vector<std::string>{"😀", "same"}));
  assert(parse_screen_navigation_options("[]", options) && options.empty());
  for (const auto &raw : {"unknown", "['incomplete'", "[1]", "['a']junk", "['a',, 'b']", "['bad\\q']", "['\\uD800']", "['\\uDC00']", "['\\x00']"}) {
    assert(!parse_screen_navigation_options(raw, options));
    assert(options.empty());
  }
  assert(!parse_screen_navigation_options("['" + std::string(256, 'a') + "']", options));
  assert(!parse_screen_navigation_options(std::string(8193, ' '), options));
  assert(!parse_screen_navigation_options(std::string("['\xc0\xaf']"), options));
  std::string many = "[";
  for (int i = 0; i < 65; ++i) { if (i) many += ','; many += '"' + std::to_string(i) + '"'; }
  assert(!parse_screen_navigation_options(many + ']', options));

  ScreenNavigationOptions service;
  assert(service.request("bad/id", 0).http_status == 400);
  assert(service.request("input_select.", 0).http_status == 400);
  ScreenNavigationOptions custom;
  assert(custom.request("input_group.biuro_wyswietlacz_biurko_ekran", 0).http_status == 200);
  const auto custom_job = custom.next_job(true, 1);
  assert(custom_job);
  custom.receive(custom_job->index, custom_job->generation, "['Custom option']", 2);
  assert(custom.request(custom_job->entity, 3).options[0] == "Custom option");
  assert(service.request("input_select.screen", 0).status == ScreenOptionsStatus::UNAVAILABLE);
  auto job = service.next_job(true, 1);
  assert(job && job->entity == "input_select.screen");
  const auto first = *job;
  assert(!service.next_job(true, 2));
  assert(service.request(first.entity, 3).status == ScreenOptionsStatus::LOADING);
  service.receive(first.index, first.generation, "['Home','Music']", 4);
  auto result = service.request(first.entity, 5);
  assert(result.status == ScreenOptionsStatus::READY && result.options.size() == 2);
  assert(!service.next_job(true, 6));
  service.request("select.second", 7);
  job = service.next_job(true, 8);
  assert(job && job->entity == "select.second" && job->index != first.index);
  service.receive(job->index, job->generation, "['Second']", 9);
  assert(service.request(first.entity, 10).options[0] == "Home");
  service.next_job(false, 11);
  assert(service.request(first.entity, 12).status == ScreenOptionsStatus::UNAVAILABLE);
  service.receive(first.index, first.generation, "['Stale']", 13);
  job = service.next_job(true, 14);
  assert(job && job->generation != first.generation);
  service.receive(job->index, job->generation, "['Fresh']", 15);
  assert(service.request(first.entity, 16).options[0] == "Fresh");
  auto second = service.next_job(true, 17);
  assert(second);
  service.next_job(true, 10018);
  assert(service.request(second->entity, 10019).status == ScreenOptionsStatus::UNAVAILABLE);
  service.receive(second->index, second->generation, "['Late']", 10020);
  assert(service.request(second->entity, 10021).options.empty());
  for (int i = 2; i < 16; ++i) assert(service.request("input_select.s" + std::to_string(i), 10022).http_status == 200);
  assert(service.request("input_select.over_capacity", 10023).http_status == 429);
  assert(service.request(first.entity, 10024).http_status == 200);
  return 0;
}
