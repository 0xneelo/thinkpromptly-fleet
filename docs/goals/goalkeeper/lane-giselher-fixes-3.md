# Lane GK-M.4 — Giselher — the jail becomes conservative, tampering becomes evidence (2026-09-08T00:05Z, 🎛 ORCHESTRATOR 34)

Final review of `agent-giselher/goalkeeper-mac` @ b44d562: items 1–5 CLOSED, suites 152 / 33 / 52
green, every named PoC behaves. Adversarial probing beyond the list still found three bypasses of
the Bash write-jail (`commandWritesGoalkeeper`) and one destructive read:

- `cd "$HOME/.claude" && cd goalkeeper && echo pwned > evil.md` — ALLOWED (the `$` wildcard test
  runs before `norm()` expands `$HOME`; the next relative `cd` then resolves against the session cwd).
- `(cd ~/.claude/goalkeeper && echo pwned > evil.md)`, `{ cd …; …; }`, `bash -c '…'` — ALLOWED
  (the `cd` regex needs the whole segment to be exactly `cd <dir>`).
- `mv ~/.claude/goalkeeper/thread.md /tmp/stolen.md` — ALLOWED (destination-only rule; `mv`
  destroys its source).

Static analysis of shell text is never complete. This round replaces precision with two things
that are: a conservative rule, and detection. Same branch, one commit per item, re-run the
installer, update report + pending ledger, push. First line of the last commit body: `ACK GKM4`.
PLAN §9 addendum (orchestrator branch, 2026-09-08) is binding.

## Must do

1. **Conservative Bash jail for non-goalkeeper stamped kinds.** Replace the `cd`-tracker and
   destination analysis with this rule, applied to the command text after heredoc stripping and
   after expanding `~`, `$HOME`, `${HOME}`, `$CLAUDE_CONFIG_DIR`:
   - Let NAMES = the command contains a `goalkeeper` path segment (case-insensitive:
     `/goalkeeper`, `goalkeeper/`, `cd goalkeeper`, `pushd goalkeeper`, or the absolute jail path).
   - If NAMES and the command is a **pure read** → ALLOW. Pure read = every `;`/`&&`/`||`/`|`
     segment starts with one of `cat head tail less more sed -n grep rg ls wc diff stat file md5 shasum jq`
     or `git -C <jail> (log|show|status|diff|ls-files|rev-parse)` or `git (log|show|status|diff) --
     <jail path>`, and the command contains no `>`, `>>`, `<(`, `$(`, backtick, `(`, `{`, `cd`,
     `pushd`, `bash -c`, `sh -c`, `zsh -c`, `eval`, `xargs`, `python`, `node`, `perl`, `ruby`, `osascript`.
   - If NAMES and not a pure read → DENY with the reason "non-goalkeeper seats read the goalkeeper
     dir with simple commands only; anything with a write, a cd, a subshell or an interpreter is denied".
   - If not NAMES → ALLOW (this check never fires on commands that do not name the jail).
   `mv`, `cp`, `rm`, `ln`, `dd`, `install`, `tee`, `truncate`, `chmod`, `chown`, `rsync` naming the
   jail are therefore denied in every position, including `mv <jail>/x /tmp/y`. Keep the goalkeeper
   kind's own behaviour unchanged. Tests: the three bypasses above (DENY), `mv` out (DENY), the
   pure-read forms (ALLOW: `cat ~/.claude/goalkeeper/thread.md`, `git -C ~/.claude/goalkeeper log`,
   `sed -n 1,20p $HOME/.claude/goalkeeper/audits/2026-09-07.md | head`), and ordinary orchestrator
   commands that never name the jail (ALLOW). Delete the tracker tests that no longer apply and
   say so in the test README.
2. **Tamper detection in `goalkeeper.py sweep`.** The CLI's own commits use a fixed identity
   (`-c user.name=goalkeeper -c user.email=goalkeeper@local`) and record the resulting SHA in
   `sweep-state.json` (new file, gitignored inside the data repo). Each sweep records `tamper[]`:
   (a) `git status --porcelain` non-empty before the sweep's own writes; (b) commits since the
   last recorded SHA whose author is not `goalkeeper@local`; (c) files under the repo whose mtime
   is newer than the last commit and that the sweep did not write. `audit` prints a **TAMPER**
   block first when `tamper[]` is non-empty, listing each item with path, mtime or SHA, and the
   line "someone other than this seat changed the goalkeeper's records — treat the thread and
   audits since <SHA> as unverified until the operator confirms them". Tests with a fixture repo:
   clean run (empty), a foreign commit, an uncommitted edit, an mtime-only touch.
3. **`SKILL.md`**: one paragraph "What protects the records" stating both mechanisms and the
   limit honestly: the guard makes accidental writes fail, tamper detection makes deliberate ones
   visible, and neither prevents a process that bypasses Claude Code tooling.

## Done when

Items 1–3 with tests, suites green, installer re-run (report lists the new `.bak` names), report
and LINEAR-PENDING updated, pushed with `ACK GKM4`. Then stop; the weave is the orchestrator's.
