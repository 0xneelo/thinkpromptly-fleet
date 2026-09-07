# Lane GK-M.6 — Giselher — two narrow closes, then the guard is declared done (2026-09-08T01:35Z, 🎛 ORCHESTRATOR 34)

Review of `agent-giselher/goalkeeper-mac` @ a5e8c21: rules 1–5 and item 6 CLOSED, all 24 listed
probes match, suites 236 / 33 / 62 green, the rule-3 correction (a repo's own `.claude/` is not the
config dir) is right and stays. Two findings from probing beyond the list, then WEAVE:

1. **CRITICAL — a literal that executes is not prose.** `stripTextLiterals()` (`guard.js:~103`)
   blanks quoted arguments of text emitters before the NAMES scan. A double-quoted literal
   containing an unescaped `$(` or a backtick executes regardless of the wrapping program:
   `echo "$(rm -rf ~/.claude/goalkeeper)"`, `git commit -m "$(…)"`, `printf "%s" "$(cat <jail>/thread.md > /tmp/x)"`
   and the fleet-message form are ALLOWED today. Fix: never strip a literal that contains an
   unescaped `$(`, `${`, or a backtick — treat it as command text. Tests: the four forms (DENY);
   `echo "the PoC was rm goalkeeper/x"` without substitution (ALLOW); `git commit -m 'cost $(5)'`
   in single quotes (ALLOW — single quotes do not substitute).
2. **HIGH — a relative hop into the config dir.** After the rule-3 correction,
   `cd $HOME && cd .claude && rm -rf goalkeeper` is ALLOWED: `$HOME` is substituted away and the
   bare relative `.claude` is never treated as the config dir. Fix, narrow: `mentionsConfigDir`
   is also true when any `cd`/`pushd` target (after expansion) is `.claude`, `./.claude`, ends
   in `/.claude`, or equals `<cfg>`; and when the session cwd is `$HOME` and the command contains
   a `cd .claude` hop. Worktree paths (`.claude/worktrees/…`) are never a `cd` target of that
   shape, so the false positive stays closed. Tests: the form above (DENY); cwd `$HOME` +
   `cd .claude && rm -rf goalkeeper` (DENY); `cd /Users/misterislez/remote-system/.claude/worktrees/goalkeeper-mac && git status`
   (ALLOW); `cd .claude/worktrees/x && ls` (ALLOW).

## The stop rule (binding)

This is the last guard round. Static analysis of shell text is never complete; PLAN §9 addendum
already states that the guard prevents accidents and tamper detection is the guarantee. Any
further adversarial form found after items 1–2 is recorded — not fixed — in
`test/README.md` under **Accepted limits**, each with a test that pins the current behaviour and
the sentence "caught by `goalkeeper.py sweep` tamper detection, not by the guard". Do not open
another round yourself; the orchestrator will not either.

Same branch, one commit per item, installer re-run, report + LINEAR-PENDING updated, push. First
line of the last commit body: `ACK GKM6`. Then stop; the weave is the orchestrator's.
