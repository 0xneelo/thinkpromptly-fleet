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

The `cd`-tracker and destination-analysis groups were **removed in GK-M.4** and replaced by group 16,
"the jail is conservative". Three review rounds each found a new shell form around the precise
write-jail analysis — a two-step `cd` through `$HOME`, subshell and brace grouping, and `mv` out of
the jail — because static analysis of shell text is never complete. The rule now: for a
non-goalkeeper stamped kind, a command that NAMES the goalkeeper directory is allowed only when it is
a pure read (simple pagers, `sed -n`, read-only `git log/show/status/diff`, and nothing that
redirects, groups, substitutes or calls an interpreter); anything else that names it is denied. A
command that does not name the directory is never touched by this check. One earlier behaviour is
deliberately **reversed**: `cp <jail>/x /tmp/copy.md` was allowed in GK-M.3 and is now denied, since
`cp`/`mv` naming the jail are refused in every argument position — evidence leaves the jail by `cat`
or `git show`. NAMES tests the goalkeeper **directory**, not any path segment spelled `goalkeeper`,
so this repo's own `docs/goals/goalkeeper/` — the goal pack and every lane report — stays writable
for workers (PLAN §9 G-5); group 16 asserts that carve-out explicitly.

GK-M.5 widened NAMES from three spellings to **five rules**, because after a `cd "$HOME/.claude"` a
relative `goalkeeper/thread.md` named the jail and was invisible. NAMES now holds when: (1) the
absolute jail path appears, realpath or lexical; (2) the `.claude/goalkeeper` literal appears; (3) the
config dir is mentioned anywhere **and** a `goalkeeper` path segment appears anywhere; (4) a
`cd`/`pushd` target starts with `goalkeeper`; or (5) the session's own cwd is inside the config dir and
any `goalkeeper` segment appears. `goalkeeper-mac` is not a segment, so the lane branch still merges.
Item 6 blanks quoted string literals before that scan, but only for non-executing text emitters
(`echo`, `printf`, `say`, `tmux display-message`, `git commit -m|-F`, `node …/fleet-message|fleet-notify`)
and never for executors (`bash/sh/zsh -c`, `eval`, `xargs`, `tmux send-keys`, `ssh`, `scp`, `python*`,
`node -e`, `perl`, `ruby`, `osascript`, `env`) — a bus directive quoting a PoC is prose, a `bash -c`
string is a command. A literal that follows `>`, `>>` or `tee` is a redirect **target** and is never
stripped, so `echo pwned > "$HOME/.claude/goalkeeper/evil.md"` still denies.

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

Five things these suites cannot prove. They are recorded so nobody reads a green run as proving more
than it does.

- **Cases 8–9 skip here.** They cover a *hung* `census.py`, and the 10s bound needs `timeout(1)` or
  `gtimeout(1)`. macOS ships neither, so on this box a hung census **blocks the stamp** rather than
  failing open. The fail-open paths that *are* exercised — census exiting non-zero, and census missing
  — pass. Install coreutils and the two cases run.
- **The one-🥅 rule is check-then-act.** `mark.sh` asks census, then claims a number. Two
  `--goalkeeper` stamps in the same second can both pass the check. Accepted: the seat is opened by
  hand, once.
- **NAMES can be evaded.** A glob (`cd ~/.claude/goal*eeper`) or a variable holding the path
  (`D=~/.claude/goalkeeper; cd "$D"`) never spells the directory, so the guard allows it. That is the
  accepted limit of the conservative rule: the guard prevents *accidents*, and detection in
  `goalkeeper.py sweep` — uncommitted changes, foreign-author commits, mtimes newer than the last
  commit — is the guarantee. Neither stops a process that bypasses Claude Code tooling.
- **Rule 3 has one accepted false positive.** A single command that mentions both `.claude/...` and
  `docs/goals/goalkeeper/...` is denied, because rule 3 asks only that both appear somewhere in the
  line. Split it into two commands.
- **`census.py` does not see CLI worker sessions as live** — it observes processes with `ps`/`lsof` and
  classifies a CLI worker as `GHOST`. So the refusal keys on *desktop* liveness, which is the specified
  use (the 🥅 seat is a desktop session). A `0 goalkeeper` line in a census summary is therefore not
  proof that no seat is running.
