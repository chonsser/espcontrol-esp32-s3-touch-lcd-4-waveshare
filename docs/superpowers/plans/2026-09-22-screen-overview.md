# Screen Overview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkboxes.

**Goal:** Show all screen configurations together with one always-visible Home Assistant source and automatically discovered value selectors.

**Architecture:** Retain the current screen storage/navigation controller. Add a bounded read-only options endpoint backed by the existing HA connection; separate shared source controls from per-screen editors and reuse the current card preview/editor machinery with explicit screen ownership.

**Tech Stack:** TypeScript, C++17, ESPHome 2026.9.0, Playwright, host CTest.

**Spec:** docs/superpowers/specs/2026-09-22-screen-overview-design.md

## Global Constraints

- Work only in `.worktrees/add-entity-screen-navigation`; extend PR #3, main stays stable.
- Preserve saved screens, mappings, ordinary Subpage behavior and exact-state navigation semantics.
- One source entity and wake setting, always visible in Screen; screen configs displayed together.
- Discovery never saves settings or calls HA actions. Use the existing HA connection, no new token.
- Endpoint contract: GET `/api/v1/screen-navigation/options?entity_id=<encoded-id>` returns `{entity_id,status,options}`. Status is loading/ready/unavailable/unsupported/error; 400 invalid ID, 429 capacity.
- Bound discovery to 16 distinct IDs per boot, 8192 raw bytes, 64 options, 255 UTF-8 bytes per option; reject invalid/truncated data.
- Root owns generated assets, commits, pushes, PR and OTA. Provisioned `dev-pr-navigation.yaml` overlay is required.

### Task 1: Shared controls and side-by-side editors (worker)

**Files:** `src/webserver/application/screen_navigation.ts`, new focused `screen_overview.ts` / option-discovery module as useful, `controls_shell.ts`, `preview_render.ts`, `preview_interactions.ts`, `grid.ts`, `entry.ts`, relevant CSS, en/pl catalogs, browser/unit tests. No firmware or generated files.

**Interfaces:** Consume the endpoint contract above through `deviceApi.getJson`; retain createScreenNavigationFeature controller APIs, existing screenNavigationEditor create/replace/select, saved rules/wire format. Root implements endpoint independently.

- [x] Add failing production-path browser cases for always-visible shared controls, two simultaneous independent screen editors, click/edit correct-screen routing, and values fetched after entering entity ID.
- [x] Separate non-collapsible global source/wake/save from per-screen metadata and mapping controls; render all registered screens in a responsive gallery without mutating inactive screen state.
- [x] Reuse card preview and editor interaction logic with explicit screen ownership. Ensure typing, drag/drop, context menus, modal saves and + address the intended screen.
- [x] Add debounced discovery with generation checks, finite loading polling, retry and read-only semantics. Test stale responses and unsupported/offline/empty options; preserve unavailable existing values.
- [x] Preserve name/source/mapping drafts, exact multi-value rules and conflict-safe storage. Update English/Polish strings.
- [x] Run focused browser/unit/type checks, self-review, return report and diff for independent review. Root commits after review.

### Task 2: Bounded HA option discovery (root)

**Files:** new `components/espcontrol/screen_navigation_options.h`, `screen_navigation_options_endpoint.h`, `button_grid_screen_navigation_options.h`; `espcontrol_app.cpp`, `panel_config_capabilities.h`, host tests/CMake. No web files.

**Interfaces:** HTTP reads/queues via a mutex-protected pure service; main-loop pump subscribes to the options attribute via a separate HA callback scope and requests fresh values. Responses use the Task 1 schema. Existing server authentication applies.

- [x] Add failing parser/service tests for exact quoted options, malformed/oversized input, deduplication/capacity, source changes, stale generations and offline behavior.
- [x] Implement bounded request/snapshot service and non-evaluating quoted-list parser; no HA calls while holding the HTTP/service mutex.
- [x] Wire main-loop subscriptions and fresh requests; marshal results into the service. Handle connection loss/reconnect and bounded timeout without accumulating callbacks.
- [x] Add authenticated GET endpoint and feature capability. Test malformed requests and endpoint bounds.
- [x] Run focused host/sanitizer tests and request independent review. Root commits after review.

### Task 4: Hold HA selection across idle (root)

- [x] Preserve the last successfully displayed HA target; ordinary manual navigation remains allowed.
- [x] Guard home timeout and all screensaver entry home-return paths.
- [x] Exercise actual YAML lambdas using the real navigation latch; review and update user docs.

### Task 5: Default hold opens real controls (worker)

**Files:** long-press/parser/driver/modal integration, button settings label and en/pl translations, focused firmware/web tests and usage docs. No generated outputs or navigation/options discovery changes.

- [x] Make missing persisted long_press resolve to an effective controls/details action for supported cards; preserve explicit more_info/none.
- [x] Reuse controls-only modal dispatch, never generic action dispatch. Ordinary light toggles open owned temporary light controls safely.
- [x] Consume recognized holds on main and subpage; no premature media transport on press, no click on release.
- [x] Cover production event wiring, light menus, media, wake guards and temporary menu lifetime.
- [x] Run focused checks, self-review and return report/diff; root handles integration.

### Task 3: Integrate, verify and flash

- [ ] Review task changes and resolve findings; update usage docs and regenerate assets/catalog outputs/snapshots/baseline.
- [ ] Run product, fast web, relevant browser and firmware host checks; perform final scoped whole-change review.
- [ ] Commit/push, compile provisioned Waveshare image, OTA to 192.168.11.59.
- [ ] Verify uptime, capability, exact embedded UI and read-only live browser; update PR and report physical testing limits.
