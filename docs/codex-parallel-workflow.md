# Codex Parallel Workflow

Use this workflow when you want Codex to implement multiple independent tickets in parallel without conflicting edits.

## Core model

- Use one Git branch per ticket.
- Use one Git worktree per branch.
- Use one Codex session per worktree.
- Keep one controller session in the main repo checkout for review, rebases, and merge decisions.

This workflow uses `git worktree` so each Codex session edits an isolated checkout.

Do not run multiple Codex implementation sessions in the same worktree.

## Wave-based execution

Only run tickets in parallel when they are in the same dependency wave.

### Wave 1

Run these in parallel from `main`:

- `feature/pw-01-device-recipient-subscriptions`
- `feature/pw-06-event-lifecycle-expansion`
- `ops/pw-10-worker-structured-logs`
- `docs/pw-11-runbooks-dashboard-baseline`
- `ops/pw-12-cicd-rollback-automation`
- `ops/pw-13-security-baseline`

Recommended merge order:

1. `feature/pw-01-device-recipient-subscriptions`
2. `feature/pw-06-event-lifecycle-expansion`
3. `ops/pw-10-worker-structured-logs`
4. `docs/pw-11-runbooks-dashboard-baseline`
5. `ops/pw-12-cicd-rollback-automation`
6. `ops/pw-13-security-baseline`

### Wave 2

Start after `PW-01` and `PW-06` are merged:

- `feature/pw-02-recipient-management-api`
- `feature/pw-07-queue-idempotency-job-metadata`
- `feature/pw-08-worker-failure-state-visibility`

### Wave 3

Start after `PW-02` is merged:

- `feature/pw-03-worker-recipient-fanout`
- `feature/pw-04-frontend-recipient-controls`

### Wave 4

Start after the Wave 3 contracts are stable:

- `feature/pw-05-invite-share-flow`
- `feature/pw-09-notification-attempt-tracking-retries`

## Bootstrap Wave 1

Use the helper script:

```bash
./scripts/create-wave1-worktrees
```

It creates sibling worktrees next to the current repo:

- `../ping-watch-pw01`
- `../ping-watch-pw06`
- `../ping-watch-pw10`
- `../ping-watch-pw11`
- `../ping-watch-pw12`
- `../ping-watch-pw13`

The script expects the current checkout to be on `main` and pulls `main` fast-forward before creating branches.

## Launch Wave 1 Codex sessions

After the worktrees exist, use:

```bash
./scripts/run-wave1-codex
```

This launches one terminal per worktree and starts one Codex session per worktree with a branch-specific prompt.
The launcher starts Codex without approval prompts by passing `--ask-for-approval never --sandbox danger-full-access`.
The launcher expects a desktop terminal emulator and currently supports `x-terminal-emulator`, `gnome-terminal`, `konsole`, `xfce4-terminal`, and `kitty`.

## Running Codex

Open one terminal per worktree and start one Codex session per worktree.

If you want the repo to open them for you, `./scripts/run-wave1-codex` launches one terminal per worktree automatically.

Use a narrow prompt per session. Example:

```text
Work only on PW-01 in this branch.
Follow PLAN.md.
Do test-first.
Do not change unrelated files.
Run targeted tests first, then report exact results.
If you need an API contract from another ticket, stop and report the dependency.
```

## Review loop

Use the main checkout as the controller:

1. Wait for each worktree session to finish.
2. Review the diff and test output for each branch.
3. Merge branches in dependency order.
4. Rebase later-wave branches on updated `main`.
5. Start the next wave.

Useful commands:

```bash
git log --oneline --decorate --graph --all
git diff main..feature/pw-01-device-recipient-subscriptions --stat
git diff main..feature/pw-06-event-lifecycle-expansion --stat
```

## Verification rule

Before merging a branch, run the repo gate from that worktree:

- `./scripts/test-unit`
- `./scripts/test-integration`
- `./scripts/test-e2e`

Or run:

- `./scripts/test-all`

Record the exact pass/fail output in the branch review notes.
