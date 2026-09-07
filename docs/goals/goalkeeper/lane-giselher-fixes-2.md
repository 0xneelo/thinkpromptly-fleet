# Lane GK-M.3 — Giselher — last round before the weave (2026-09-07T23:05Z, 🎛 ORCHESTRATOR 34)

Re-review of `agent-giselher/goalkeeper-mac` @ c85afbb: all nine GK-M.2 items CLOSED, suites
128 / 33 / 48 green. Verdict WEAVE once the items below land. They are gaps in the Bash
write-into-jail check you added beyond the brief (`commandWritesGoalkeeper`, `guard.js` ~165-215).
Same branch, one commit per item, re-run the installer, update report + pending ledger, push.
First line of the last commit body: `ACK GKM3`.

## Must fix

1. **A `cd` in the same command defeats the jail.** Redirect and mutate targets are resolved
   against the session cwd only. PoC (allowed today, must deny):
   `cd ~/.claude/goalkeeper && echo pwned > evil.md`. Fix: track `cd <dir>` / `pushd` segments
   across `&&`, `;`, `|`, newlines when resolving later relative targets; when the cwd cannot be
   determined statically (a `cd "$var"`), treat relative targets as unknown and deny only if the
   command also names the jail elsewhere — never deny ordinary relative writes in other repos.
2. **`$HOME` is not expanded.** `echo pwned > "$HOME/.claude/goalkeeper/evil.md"` is allowed while
   the `~` form denies. Fix: expand `$HOME`, `${HOME}`, `~`, and `$CLAUDE_CONFIG_DIR` in `norm()`
   before comparison. Tests for each spelling.
3. **Source arguments are treated as write targets.** `cp ~/.claude/goalkeeper/audits/2026-09-07.md /tmp/copy.md`
   is denied as "never write there" though the destination is outside the jail — a false
   positive on ordinary orchestrator evidence reads. Fix: for `cp`/`mv`/`install`/`ln`/`dd`
   only the destination (last non-flag arg, `of=`, `-t` target) is a write target; for `rm`,
   `mkdir`, `touch`, `truncate`, `chmod`, `chown`, `tee` every path arg is. Tests: the cp PoC
   allows; `cp /tmp/x ~/.claude/goalkeeper/x` denies; `tee ~/.claude/goalkeeper/x` denies.
4. **`ADDRESSEE_KEYS` lost `agent` and `seat`.** The GK-M.2 list dropped them silently. Put them
   back (still case-insensitive, addressee-only) and add one regression test per key.

## Should fix

5. `INJECTED_TAG` matches any row starting with `<command-`, which would also swallow an operator
   turn that begins with the literal text `<command-line …`. Anchor the tag to the exact harness
   names: `<command-message`, `<command-name`, `<local-command-`, `<task-notification`,
   `<system-reminder`, `<cross-session-message`. One test with the false-positive shape.

## No action

- PLAN §9 is on the orchestrator's branch `claude/local-orchestrator-ae2248` (362cd9c), not on
  yours; the weave brings both together. Keep citing it.
- The pack docs you and Luitpold both carry (`docs/goals/goalkeeper/*`) come from the shared base;
  the orchestrator resolves the `LINEAR-PENDING.md` append conflict at the weave.

## Done when

Items 1–4 closed with tests, item 5 applied, suites green, installer re-run (report lists the new
`.bak` names), report + LINEAR-PENDING updated, pushed. Then stop; the weave is the orchestrator's.
