# Lane GK-M.2 — Giselher — fix round after review (2026-09-07T19:30Z, 🎛 ORCHESTRATOR 34)

Two reviewers read `agent-giselher/goalkeeper-mac` @ 3c4177e. Verdict FIX-FIRST. Same branch,
same rules as [lane-giselher-mac.md](lane-giselher-mac.md); one milestone commit per numbered
item; re-run the installer at the end (fresh `.bak` per item 5); update your report and the
pending ledger; push. Plan amendments in [PLAN.md](PLAN.md) §9 are binding and settle G-2, G-5,
G-7, G-9.

## Must fix before weave

1. **Symlink escape from the write jail** (`guard.js` `norm`/`underGoalkeeper`/`allowedWrite`).
   Paths are resolved lexically only. PoC: `ln -s /elsewhere ~/.claude/goalkeeper/x.js`, then a
   `Write` to that path passes. Fix: after lexical `norm()`, `fs.realpathSync` the deepest existing
   ancestor (the target may not exist yet) and compare the realpath; apply the same to the
   "other kinds may not write under the goalkeeper dir" check. Tests: symlink inside the jail
   pointing out, symlink outside pointing in, a not-yet-existing file under a symlinked parent.
2. **Lowercase bypass of the Bash reach deny for non-goalkeeper seats** (`guard.js` ~187).
   The Bash path tests only `GK_TARGET` (case-sensitive badge match); the SendMessage path also
   has the case-insensitive addressee check. PoC from an ORCHESTRATOR seat: a curl to the deck's
   messages endpoint with `{"to":"goalkeeper"}` (lowercase) is allowed. Fix: apply the
   case-insensitive addressee/target match to the reach patterns too (`to`, `session`, `target`,
   `--to`, path segment `goalkeeper`). Test both cases.
3. **Askpass token cleanup is not timeout-proof** (`goalkeeper.py` `fetch()` ~128-152).
   The shell `trap` cannot run when Python's `subprocess.run(timeout=)` SIGKILLs the child, so a
   timed-out fetch leaves the plaintext broker token in `$TMPDIR/tmp.gh*/askpass.sh`. Fix: record
   the helper dir path in Python before the fetch (parse the mint output or pass a known
   `TMPDIR`) and remove it in a `finally:` regardless of how the child died; additionally run the
   child with `start_new_session=True` and on timeout send SIGTERM to the group before SIGKILL.
   Also sweep and delete any stale `$TMPDIR/tmp.gh*` dirs older than one hour at the start of
   `fetch()` — the report found one from 2026-09-05. Tests with a fake `MINT`: success, non-zero
   exit, simulated timeout — the dir must be gone in all three.
4. **Harness-noise filter misses two shapes** (`goalkeeper.py` `is_injected` ~386-400). Real rows
   in `audits/2026-09-07.md:143-153` start with `<local-command-caveat>` and
   `<local-command-stdout>`; the `startswith` list does not match them. Fix: treat any row whose
   text begins with a `<local-command-`, `<task-notification`, `<system-reminder` or
   `<command-` tag as injected, and make this the DEFAULT filter (PLAN §3.3 as amended in §9,
   not an opt-in `--strict-turns`). Test from the real row shapes.

## Should fix in the same round

5. `install-claude-home.sh:25` hardcodes `STAMP="2026-09-07"`. Use `$(date +%Y-%m-%d)`, and if
   that `.bak-<stamp>` already exists, write `.bak-<stamp>-<HHMMSS>` instead of skipping.
6. `init-goalkeeper-repo.sh` never copies `audits/.gitkeep`, so the data repo's first commit has
   no `audits/`. Copy it.
7. `SKILL.md` "Hard nevers": replace "never write outside `~/.claude/goalkeeper/`" with the
   amended wording in PLAN §9 (a `git fetch --prune origin` into another project's `.git`
   refs is the one permitted write; working trees and source are never touched).
8. Reflect the §9 amendments in `guard.js` (item G-7): the SendMessage/send_message deny for
   non-goalkeeper kinds matches the addressee fields only (`to`, `session_id`, `title`,
   `target.session`, `name`), case-insensitively — not the whole serialised input. Keep the
   goalkeeper kind's deny-all. Update the tests that asserted the whole-input match.
9. **The Bash reach deny fires on prose** (live incident 2026-09-07T19:28Z). The orchestrator's
   own Bash call — a heredoc writing THIS file, which quoted the item-2 PoC — was denied because
   the command text contained the badge word and a messages-endpoint path anywhere. The reach
   check must be addressee-shaped: fire when a target-bearing token (`--to <x>`, `"to":"<x>"`,
   `"session":"<x>"`, `target.session`, `HOST:SESSION` after `--to`) names the goalkeeper
   (case-insensitive), or when the command's destination path is the goalkeeper dir. It must not
   fire on the mere co-occurrence of the badge word and an API path in a long command or heredoc.
   Tests: the denied heredoc shape (allow), the real PoC shapes (deny).

## Note only (no change)

- `mark.sh` one-seat check is check-then-act (a same-second race is accepted).
- `mark.test.sh` cases 8–9 skip on this Mac (no `timeout(1)`); a hung `census.py` blocks the
  stamp rather than failing open. Record it in the README; no fix in v1.
- G-12: census does not see CLI workers; the one-🥅 refusal keys on desktop liveness. Intended.

## Done when

All four must-fix items closed with tests, items 5–9 applied, all three suites green, installer
re-run (report lists the new `.bak` names), report and LINEAR-PENDING updated, branch pushed.
Reply to no one; the orchestrator watches the branch.
