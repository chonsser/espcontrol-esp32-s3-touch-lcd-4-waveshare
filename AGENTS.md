# AGENTS.md

## Communication

- The user is technical but not development-oriented. Explain changes in approachable terms and avoid unnecessary implementation detail.
- Keep final updates concise: what changed, how it was checked, and what the user needs to test.

## Development workflow

- Work directly on `main` by default, as explicitly requested by the user on 2026-09-25. This replaces the previous feature-branch/worktree/PR-first workflow.
- Fetch the latest `origin/main` before changes. Keep commits focused; do not include unrelated unfinished work.
- Do not create new feature branches, worktrees or pull requests unless the user asks. Commit checked changes and push them to the user's fork on `main`.
- Respect an existing session's worktree isolation. If `main` is checked out elsewhere, use a detached checkout of `origin/main` in the current worktree and push `HEAD:main` without force; do not modify another checkout or check out `main` concurrently.
- Run relevant checks before pushing, and state remaining failures explicitly. Direct-to-main work does not waive verification or constitute physical device acceptance.
- Firmware flashing still requires explicit permission; use only the factory configuration on provisioned panels.
- Do not close related GitHub issues until the user confirms the fix works.
- Retain existing feature branches/worktrees until their work is integrated and cleanup is safe; do not delete another session's workspace.

## Preserve completed features

- Do not leave completed work stranded on separate branches while delivering firmware that drops it. When completed features are meant to coexist on the same device, integrate them into a common branch and push that branch to the user's fork.
- Before building or flashing, identify the features the user already has and expects to keep. Verify that the integration branch contains their commits, that regenerated web assets expose them together, and that combined checks pass; a successful build of one feature branch is not enough.
- For existing feature PRs, merge only when the user asks and preserve both feature histories. A merge or push is not proof of device acceptance; keep issues open until the user confirms the fix. New work follows the direct-to-main workflow above.
- State the exact integration branch and build revision in delivery notes. Distinguish source integration, successful compilation, and physical device testing; never silently replace a combined firmware with a feature-only image.

## GitHub account

- Use the user's private GitHub account `chonsser` for this project, including all GitHub CLI (`gh`) operations. Do not use work accounts.
- Before authenticated GitHub operations, verify the active account with `gh auth status`; if needed, select it with `gh auth switch --hostname github.com --user chonsser`.
- Target the user's fork explicitly with `--repo chonsser/espcontrol-esp32-s3-touch-lcd-4-waveshare` when using `gh`. Do not open upstream pull requests unless the user asks.

## Pull requests

- PR descriptions should explain the purpose of the change, the practical impact, and how it was checked.
- Include clear testing notes so the user can test the branch independently of `main`.
- If firmware needs flashing, name the affected display or device in the PR body.
- Distinguish automated checks from physical device testing. A compile/build pass is not the same as user-confirmed device testing.
- Use the automated PR testing guidance as the starting point for the PR body whenever it is available.
