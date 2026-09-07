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
config dir — named absolutely or via `~`/`$HOME`/`$CLAUDE_CONFIG_DIR`, never a repo's own
`.claude/worktrees/...` — is mentioned anywhere **and** a `goalkeeper` path segment appears anywhere; (4) a
`cd`/`pushd` target starts with `goalkeeper`; or (5) the session's own cwd is inside the config dir and
any `goalkeeper` segment appears. `goalkeeper-mac` is not a segment, so the lane branch still merges.
Item 6 blanks quoted string literals before that scan, but only for non-executing text emitters
(`echo`, `printf`, `say`, `tmux display-message`, `git commit -m|-F`, `node …/fleet-message|fleet-notify`)
and never for executors (`bash/sh/zsh -c`, `eval`, `xargs`, `tmux send-keys`, `ssh`, `scp`, `python*`,
`node -e`, `perl`, `ruby`, `osascript`, `env`) — a bus directive quoting a PoC is prose, a `bash -c`
string is a command. A literal that follows `>`, `>>` or `tee` is a redirect **target** and is never
stripped, so `echo pwned > "$HOME/.claude/goalkeeper/evil.md"` still denies.

GK-M.6 closed the last two forms and then stopped (see "Accepted limits" below). **Item 1:** a
double-quoted literal is only prose while it is *inert* — `$(…)`, `${…}` and a backtick are
evaluated by the shell before the wrapping program sees the text, so `echo "$(rm -rf <jail>)"`
deletes the jail. Such a literal is never blanked now; single quotes substitute nothing and stay
blanked, and an escaped `\$(` in prose is still prose (the escape test counts preceding
backslashes). **Item 2:** a `cd`/`pushd` whose **target** is `.claude`, `./.claude`, a path ending
in `/.claude`, or the config dir itself now counts as naming the config dir, which closes
`cd $HOME && cd .claude && rm -rf goalkeeper`. Targets are read quoted or bare and a trailing
slash is ignored; `cd .claude/worktrees/x` is not a target of that shape, so the worktree fix
above stands.

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

## Accepted limits — the guard stops here

GK-M.6 was the **last guard round** (lane brief GK-M.6, the stop rule). Static analysis of shell
text is never complete, and PLAN §9 addendum already settles the division of labour: the guard
prevents *accidents*, and tamper detection is the guarantee. So anything found beyond items 1–2 is
**recorded here, not fixed**. Group 22 of `guard.test.js`, "Accepted limits — pinned, not fixed",
asserts the current behaviour of the first two — those assertions document a limit, they do not
promise a defence.

- **A path the command never spells.** A glob (`cd ~/.claude/goal*eeper`) or a path assembled from
  variables (`C=.claude; G=goalkeeper; cd "$HOME/$C/$G"`) never puts the directory in the text, so
  the guard allows it. Such a command is caught by `goalkeeper.py sweep` tamper detection, not by
  the guard. (A variable that *does* spell it — `D=~/.claude/goalkeeper; cd "$D"` — is denied: `~`
  is expanded before the scan and the line names the directory. Group 22 pins both.)
- **Anything outside Claude Code tooling.** The guard is a PreToolUse hook: a shell opened by hand,
  a cron job, an editor, another agent runtime, or any process not going through the tools sees no
  guard at all. Every one of those is caught by `goalkeeper.py sweep` tamper detection, not by the
  guard.
- **Rule 3 over-denies one honest line.** It asks that the command name the real config dir
  (absolutely, or via `~`, `$HOME`, `${HOME}`, `$CLAUDE_CONFIG_DIR`, all expanded first) **and**
  carry a `goalkeeper` path segment — both merely *somewhere* in the line. A command that
  genuinely names both the config dir and this repo's own `docs/goals/goalkeeper/` is therefore
  denied. Split it into two commands. Nothing is lost by erring this way: a real change to the jail
  is caught by `goalkeeper.py sweep` tamper detection, not by the guard.
- **`mark.test.sh` cases 8–9 skip on this box.** They cover a *hung* `census.py` and the 10s bound
  needs `timeout(1)` or `gtimeout(1)`; macOS ships neither, so here a hung census **blocks** the
  stamp instead of failing open. The fail-open paths that are exercised — census exiting non-zero,
  and census missing — pass. Install coreutils and the two cases run.
- **The one-🥅 rule is check-then-act.** `mark.sh` asks census, then claims a number, so two
  `--goalkeeper` stamps in the same second can both pass the check. Accepted: the seat is opened by
  hand, once. Neither this nor the skip above is a guard limit, and a second seat's writes are
  caught by `goalkeeper.py sweep` tamper detection, not by the guard.
- **`census.py` does not see CLI worker sessions as live** — it observes processes with `ps`/`lsof`
  and classifies a CLI worker as `GHOST`. The refusal therefore keys on *desktop* liveness, which is
  the specified use (the 🥅 seat is a desktop session). A `0 goalkeeper` line in a census summary is
  not proof that no seat is running.
