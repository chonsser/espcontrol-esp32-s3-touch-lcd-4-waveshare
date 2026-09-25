# Independent Screens Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Create and edit independent entity-controlled screens directly in the Screen tab.

**Architecture:** Reuse the existing subpage payload transport and editor, with explicit standalone metadata independent of home cards. Keep firmware navigation scoped to registered screens, and expose a capability before editors create the new payload format.

**Tech Stack:** TypeScript, ESPHome YAML, C++17, existing native PanelConfig v1, Playwright and host tests.

**Spec:** docs/superpowers/specs/2026-09-22-independent-screens-design.md

## Global Constraints

- Work only in `.worktrees/add-entity-screen-navigation`; main is stable.
- Shared working tree: respect task ownership; no unrelated edits, no secret output.
- Standalone wire envelope: `@screen:<encodeConfigField(name)>\n<existing-subpage-payload>`.
- Web metadata: `standalone?: true`, `screenLabel?: string`; name 1–64 UTF-8 bytes without control characters.
- Existing regular subpage serialization stays unchanged; standalone grids have all cells, no Back tile.
- Keep current chunk limits and exact state matching/wake/lock behavior.
- Root owns generated files, commits/push, PR updates, and firmware upload. Workers do not spawn agents.

### Task 1: Web storage, editor safety and backup model

**Files:** `src/webserver/model/subpage.ts`, `application/config_codec.ts`, `state/types.ts`, `application/preview_interactions.ts`, `application/preview_clipboard.ts`, `features/backup.ts`, relevant web unit tests. Add a small `model/standalone_screens.ts` helper if useful. Do not edit screen_navigation.ts, controls_shell.ts, settings_page.ts, entry.ts, app_status_preview.ts or generated files.

**Interfaces:** Export metadata through existing parsed/runtime/structured subpage objects. `parseRawSubpageConfig` recognizes the envelope and `serializeSubpageConfig` retains it even for empty screens. Consumers use `standalone === true` and `screenLabel`. Existing saveSubpageConfig/enterSubpage are retained. Report a safe allocation API or precise use of complete native document for Task 3.

- [x] Write failing model tests: name/metadata round trip; empty named screen; full grid without Back; unchanged ordinary subpage bytes.
- [x] Implement the metadata envelope and grid handling at shared model boundaries.
- [x] Write failing regression tests for normal home-card delete/copy/paste and conversion at a slot holding an independent screen.
- [x] Protect independent payloads and guard collisions in ordinary subpage creation/paste/type change; never silently replace data.
- [x] Test and implement structured backup preservation, separate screen allocation/remapping, and skipped-screen warnings.
- [x] Run focused tests and TypeScript check; report changed files, test results, and remaining UI integration seams. Root commits after review.

### Task 2: Firmware screen creation and capability (root)

**Files:** `components/espcontrol/button_grid_subpages.h`, `button_grid_grid.h`, `button_grid_navigation.h`, `panel_config_capabilities.h`, new focused helper if appropriate; firmware parser/runtime tests and CMake.

**Interfaces:** Read the same standalone envelope and register its numeric storage ID in normal navigation registry; use its own label, independent of same-ID home card. Advertise `screen_navigation: {version: 2, standalone: true}`.

- [x] Write failing tests for envelope parsing, invalid name rejection, full-grid ordering, normal subpage compatibility and standalone runtime ownership.
- [x] Build standalone screens from stored payloads even when the same-ID home card is ordinary or unused.
- [x] Omit Back and parent indicators/click binding for standalone screens; retain lock handling, HA subscriptions and resource cleanup.
- [x] Add capability, test response bounds and old capability fields.
- [x] Run meaningful host tests and sanitizer checks; request independent review.

### Task 3: Screen-tab selector, add action and entity settings

**Files:** `src/webserver/application/screen_navigation.ts`, `controls_shell.ts`, `settings_page.ts`, `entry.ts`, `app_status_preview.ts`, `features/screen_navigation_controller.ts`, `model/screen_navigation.ts`, relevant tests and translation catalogs. Load-completion changes may touch `state_loader_api.ts` only after coordinating with root. Task 1's model files remain owned by Task 1.

**Interfaces:** Reuse `enterSubpage(id)`, `exitSubpage()`, existing subpage saves and Task 1 metadata. Feature supports capability via GET `/api/v1/capabilities`; root firmware provides version 2. Existing HA mapping rules use target 0 for home, positive IDs for registered ordinary or standalone screens.

- [x] Write failing browser/controller tests for the Screen placement and accessible + action.
- [x] Remove the old Settings card and place source entity, wake preference and selected-screen state setting in Screen.
- [x] Add screen selection, safe allocation after complete loading, persisted empty-screen creation and immediate editor entry.
- [x] Add rename/delete controls with clear selected-screen confirmation, preserving same-ID home card and removing stale mappings. Home cannot be deleted.
- [x] Keep all cells usable, update preview title from standalone metadata, and preserve unsaved edits against GET/SSE races.
- [x] Test add/edit/save/reload, full home grid, same-ID main-card safety, capacity errors, unsupported firmware and backup restore. Update English/Polish catalogs, run focused browser/unit/type checks.

### Task 4: Integration, review and OTA

- [x] Regenerate entities/translations/web assets, snapshots and size baseline; update user docs and final PR description for Screen-tab UX.
- [x] Review Tasks 1–3 and fix concrete findings; run product, web unit/type, relevant browser and firmware host checks.
- [x] Commit and push the branch; keep PR #3 open for user device testing.
- [x] Compile pinned ESPHome 2026.9.0 using `dev-pr-navigation.yaml`, then upload to 192.168.11.59.
- [x] Verify reboot, uptime stability, capability, settings and embedded UI hash; report concise setup/testing instructions.

## Completion evidence

Firmware commit `4005d6f32` compiled and uploaded successfully to the Waveshare ESP32-S3-Touch-LCD-4 at `192.168.11.59`. Product and fast-web checks passed, including 219 web unit tests and TypeScript; generated Waveshare browser smoke and 76 firmware host tests passed. Task and final reviews are clear, including the final clipboard metadata regression. GitHub CI passed for that firmware commit.

After OTA, the panel reported standalone-screen capability v2, all three navigation settings endpoints responded, and embedded JavaScript matched the compiled asset byte-for-byte. A read-only live Chromium check confirmed the Polish Ekran tab, enabled + button, screen selector and entity settings, with no configuration writes. Uptime advanced from 5 to 65 seconds without another restart. PR #3 remains open for physical touch and Home Assistant state-switching confirmation.

## Implementation decisions

- Screens created with + are independent of home cards and have no Back tile. If ordinary subpages were intended, the creation flow would need adjustment.
- Firmware implementation was coordinated by the root agent alongside a worker on disjoint web-model files. Ownership overlap would require reconciliation; independent reviews covered both tasks.
- The + action immediately creates a screen with a translated default name; renaming is available afterwards. A custom initial name therefore requires one additional action.
