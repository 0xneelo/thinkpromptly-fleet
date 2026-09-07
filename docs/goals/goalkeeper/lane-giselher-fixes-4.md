# Lane GK-M.5 — Giselher — one hole in NAMES, closed narrowly (2026-09-08T00:55Z, 🎛 ORCHESTRATOR 34)

Review of `agent-giselher/goalkeeper-mac` @ 18884eb: items 1–3 CLOSED, suites 188 / 33 / 62
green, every listed form behaves, and the false-positive class (this repo's `docs/goals/goalkeeper/`,
the branch name `agent-giselher/goalkeeper-mac`, the weave commands) is ALLOWED as it must be.
One CRITICAL remains, then WEAVE:

`commandNamesGoalkeeper()` (`guard.js:130-140`) recognises only a bare `cd goalkeeper`, the literal
`.claude/goalkeeper`, or the absolute jail path. So after a `cd "$HOME/.claude"`, a **relative**
`goalkeeper/<subpath>` is invisible. Verified ALLOWED for an ORCHESTRATOR kind:
`cd "$HOME/.claude" && rm goalkeeper/thread.md` · `cd "$HOME/.claude" && echo pwn > goalkeeper/evil.md`
· `cd "$HOME/.claude" && cd goalkeeper/audits && echo pwn > x.md`.

Do NOT fix this by matching any `goalkeeper` path segment — that reopens the false positives the
probe just cleared (`docs/goals/goalkeeper/`, `agent-giselher/goalkeeper-mac`). Same branch, one
commit, tests, installer re-run, report + pending ledger, push. First line of the commit body:
`ACK GKM5`.

## The rule (replaces the current NAMES)

After heredoc stripping and expansion of `~`, `$HOME`, `${HOME}`, `$CLAUDE_CONFIG_DIR`, NAMES is
true when any of these holds:

1. the absolute jail path (`<cfg>/goalkeeper`, realpath or lexical) appears; or
2. the literal `.claude/goalkeeper` appears; or
3. the command mentions the config dir anywhere (`.claude` as a path segment, or the expanded
   `<cfg>` path) **and** also contains a `goalkeeper` path segment anywhere — relative or absolute,
   with or without a subpath (`goalkeeper/x`, `goalkeeper`, `./goalkeeper/x`); or
4. a `cd`/`pushd` whose target starts with `goalkeeper` (`cd goalkeeper`, `cd goalkeeper/audits`,
   `cd ./goalkeeper`); or
5. the hook's session cwd is inside `<cfg>` (a stamped non-goalkeeper seat has no business there)
   and the command contains any `goalkeeper` path segment.

A command with a `goalkeeper` segment but none of 1–5 (this repo's docs, branch names, the
installer's own `mac/claude-home/skills/goalkeeper/...` paths) is NOT names, exactly as today.

## Tests to add (guard.test.js)

DENY (ORCHESTRATOR): the three forms above; `cd $HOME/.claude; rm -rf goalkeeper`;
`cd "$CLAUDE_CONFIG_DIR" && tee goalkeeper/thread.md`; cwd `~/.claude` + `echo x > goalkeeper/t.md`.
ALLOW (ORCHESTRATOR): `git add docs/goals/goalkeeper/LINEAR-PENDING.md && git commit -m x`;
`git merge origin/agent-giselher/goalkeeper-mac`; `cp mac/claude-home/skills/goalkeeper/SKILL.md /tmp/`;
`cat ~/.claude/goalkeeper/thread.md` (pure read); cwd `~/remote-system` + `echo x > goalkeeper/t.md`
(relative segment, no `.claude`, cwd outside cfg — allowed; the file lands in the repo, not the jail).
Record in test/README.md the accepted false positive: a command that mentions both `.claude/...`
and `docs/goals/goalkeeper/...` in one line is denied; split it into two commands.

## Item 6 — prose in a quoted argument is not a command (added 2026-09-08T01:00Z)

The orchestrator's bus directive quoting the PoC above was DENIED by the live guard at 00:58Z:
`node bin/fleet-message.js --to mac:LC-giselher ... "… cd \"$HOME/.claude\" … rm goalkeeper/thread.md …"`.
Item 9 strips heredoc bodies; string-literal arguments were not stripped. Rule: before the NAMES
scan, strip single- and double-quoted string literals **only** when the segment's program is a
non-executing text emitter or messenger: `node …/fleet-message.js`, `node …/fleet-notify.js`,
`echo`, `printf`, `git commit -m|-F`, `tmux display-message`, `say`. Never strip for `bash -c`,
`sh -c`, `zsh -c`, `eval`, `xargs`, `tmux send-keys`, `ssh`, `python*`, `node -e`, `perl`, `osascript`
— their quoted arguments execute. Tests: the denied directive shape (ALLOW); `echo "rm x" > ~/.claude/goalkeeper/x`
(DENY — the redirect is outside the literal); `bash -c 'rm ~/.claude/goalkeeper/x'` (DENY);
`tmux send-keys -t x 'rm ~/.claude/goalkeeper/x' Enter` (DENY).

## Done when

Rule 1–5 and item 6 implemented with those tests, all suites green, installer re-run (report lists the new
`.bak`), report + LINEAR-PENDING updated, pushed with `ACK GKM5`. Then stop; the weave is the
orchestrator's.
