# AGENTS.md

## Communication

- The user is technical but not development-oriented. Explain changes in approachable terms and avoid unnecessary implementation detail.
- Keep final updates concise: what changed, how it was checked, and what the user needs to test.

## Development workflow

- Treat `main` as the stable branch.
- For normal code, firmware, configuration, UI, or documentation changes, create a short-lived branch from the latest `main`.
- Use a separate git worktree for feature or fix work so multiple issues can be developed and tested at the same time without changing `main`.
- Use short, descriptive branch names like `fix-display-timeout` or `update-pr-workflow`; do not include `codex` in branch names or PR titles.
- Infer the branch name from the requested outcome unless the task is ambiguous.
- Keep each branch focused on one bug fix, feature, device change, cleanup, or documentation change.
- If a request starts to include unrelated work, keep the extra work out of the branch unless the user explicitly asks to include it.
- Commit completed changes and push the branch.
- Open a pull request marked ready for review so automated checks and review systems run, instead of merging directly to `main`.
- Leave the pull request open until the user confirms they have tested it.
- Do not close related GitHub issues until the user confirms the fix works.
- Only work directly on `main` when the user explicitly asks for it, or for a tiny emergency/documentation-only change where a PR would add no value.
- After a pull request is merged, clean up its local worktree and branch when practical.

## Preserve completed features

- Do not leave completed work stranded on separate branches while delivering firmware that drops it. When completed features are meant to coexist on the same device, integrate them into a common branch and push that branch to the user's fork.
- Before building or flashing, identify the features the user already has and expects to keep. Verify that the integration branch contains their commits, that regenerated web assets expose them together, and that combined checks pass; a successful build of one feature branch is not enough.
- Keep the source feature branches and PRs available until the combined version is tested and the user confirms merging. Do not automatically merge into `main`, close issues, or include unrelated unfinished work.
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
