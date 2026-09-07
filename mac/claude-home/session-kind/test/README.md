# session-kind tests

Two suites. Neither may ever touch the live `~/.claude` tree.

## `guard.test.js` — the PreToolUse guard

Run: `node --test mac/claude-home/session-kind/test/guard.test.js`

Covers `guard.js` for all six badges (orchestrator, researcher, design, coordinator, goalkeeper, worker)
plus unstamped and junk-marker sessions: goalkeeper isolation in both directions, builder/source/mint
denies with their kind-specific reasons, the coordinator `coordinator/` carve-out, and inertness on bad input.
The adversarial group locks in that the isolation cannot be spelled around — `..` traversal out of (and into)
the goalkeeper's repo, a prefix-adjacent `goalkeeper-other/` sibling, doubled slashes, `~` expansion,
relative paths resolved against the session cwd, lowercase/mixed-case addressee fields (while an ordinary
lowercase "goalkeeper" in a message BODY stays allowed), and non-Bash MCP shell wrappers carrying a
`command`.

Every child process is spawned with `CLAUDE_SESSION_KIND_MARKS` (and `CLAUDE_CONFIG_DIR`) set to `mkdtemp`
fixture dirs, which guard.js prefers over the `~/.claude` default — so marks are written and read only under
the temp dirs, removed after the run.

## `mark.test.sh` — badge stamping and the liveness probe

Run: `sh mac/claude-home/session-kind/test/mark.test.sh` (POSIX sh; TAP-ish `ok N - name` lines, non-zero
exit if any case failed).

Covers `mark.sh`: the ONE-goalkeeper rule (`--goalkeeper` refused with exit 4 while a 🥅 seat is live in
another directory, idempotent in its own), the liveness probe failing OPEN when census errors *or hangs*
(bounded at 10s — that case is skipped on a box with no `timeout(1)`/`gtimeout(1)`), the stamp/`--show`/
`--clear` lifecycle, raw-badge validation (`🥅 GOALKEEPER 6` accepted and verified against the registry,
`🥅 GOALIE 6` refused with exit 2), and regression cover for `--orchestrator`, `--researcher`, `--design`,
`--coordinator`, `--worker`. It also asserts the real `census.py --live-badge-prefix` contract: exit 0,
`badge<TAB>cwd` rows only, no header, summary or table.

Each case builds a throwaway `CLAUDE_CONFIG_DIR` under `/private/tmp` holding a COPY of the real `mark.sh`
plus **stub** `number.py` and `census.py` — so no real session number is ever claimed and no real process
list is scanned. `census.py --live-badge-prefix` is the only real thing the suite runs, and it is read-only.

## Known limits, accepted for v1 (reviewed 2026-09-07, no fix)

Three things this suite cannot prove on this Mac. They are recorded so nobody reads a green run as
proving more than it does.

- **Cases 8–9 skip here.** They cover a *hung* `census.py`, and the 10s bound needs `timeout(1)` or
  `gtimeout(1)`. macOS ships neither, so on this box a hung census **blocks the stamp** rather than
  failing open. The fail-open paths that *are* exercised — census exiting non-zero, and census missing
  — pass. Install coreutils and the two cases run.
- **The one-🥅 rule is check-then-act.** `mark.sh` asks census, then claims a number. Two
  `--goalkeeper` stamps in the same second can both pass the check. Accepted: the seat is opened by
  hand, once.
- **`census.py` does not see CLI worker sessions as live** — it observes processes with `ps`/`lsof` and
  classifies a CLI worker as `GHOST`. So the refusal keys on *desktop* liveness, which is the specified
  use (the 🥅 seat is a desktop session). A `0 goalkeeper` line in a census summary is therefore not
  proof that no seat is running.
