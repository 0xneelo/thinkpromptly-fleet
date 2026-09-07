# GK-M report — Giselher · tooling-engineer

Lane [lane-giselher-mac.md](../lane-giselher-mac.md) · Goal **G3** · pending Linear issue P2 and
rows `G-1`…`G-13` in [LINEAR-PENDING.md](../LINEAR-PENDING.md) (Linear is unreachable from this
Mac — no MCP — so every would-be issue is logged there, per the lane's standing rule).

Branch `agent-giselher/goalkeeper-mac`, worktree `.claude/worktrees/goalkeeper-mac`, on the
operator's Mac by explicit operator ruling 2026-09-07.

## Milestones

| # | Commit | What |
|---|---|---|
| 1 | `1dee953` | re-snapshot `mac/claude-home/` from the live `~/.claude` |
| 2 | `9c4e605` | session kind 🥅 — `mark.sh`, `guard.js`, `census.py`, 54 node + 33 sh tests |
| 3 | `3b8156f` | the `/goalkeeper` skill — `SKILL.md` + `references/anchor-check.md` |
| 4 | `45f547b` | `goalkeeper.py` — `thread add` / `sweep` / `audit`, 42 fixture tests |
| 5 | `7451729` | `install-claude-home.sh`, the data-repo seed, `init-goalkeeper-repo.sh`, both run |
| 6 | this commit | the real sweep + audit over this Mac, and the askpass token-leak fix |

## Tests

All three suites green, run from the worktree root:

```
node --test mac/claude-home/session-kind/test/guard.test.js          # 54 pass, 0 fail
sh mac/claude-home/session-kind/test/mark.test.sh                    # 33 pass (2 skipped: no timeout(1) on this box)
python3 -m unittest discover -s mac/claude-home/skills/goalkeeper/tests   # 42 pass
```

No suite reads the live marks directory or a live path: `guard.test.js` points
`CLAUDE_SESSION_KIND_MARKS` at a `mkdtemp` fixture, `mark.test.sh` runs `mark.sh` against a
throwaway `CLAUDE_CONFIG_DIR` with stub `number.py`/`census.py`, and the Python suite asserts it
in `TestNoLivePaths`.

### What review caught, and what it cost

A `reviewer` pass over milestone 2 found **four real bypasses** in the first cut of `guard.js`,
all reproduced with direct payloads and closed before the commit (LINEAR-PENDING `G-6`):

1. **critical** — `underGoalkeeper()` compared raw strings, so the 🥅 seat could write anywhere via
   `<cfg>/goalkeeper/../../remote-system/server.js`. The jail was one path segment deep.
2. **high** — the same root cause let any other seat write *into* `~/.claude/goalkeeper/` with a
   doubled slash or a `..` segment, riding in on the generic `<cfg>/` allowance.
3. **high** — the 🥅 target test was case-sensitive, so `to: "goalkeeper"` walked straight past it.
4. **medium** — the reach test keyed on `tool_name === "Bash"`, so any MCP shell wrapper was invisible.

Fixes: a `norm()` helper that expands `~`, resolves `.`/`..` and anchors relative paths to the
session cwd before any comparison; addressee fields matched case-insensitively *in addition to*
PLAN §3.4.2's literal serialised-input rule; the reach test now fires on any payload carrying a
`command`. An adversarial test group (12 of the 54) locks all four down. The 42 pre-existing
tests stayed green throughout, and no regression reached the four existing kinds.

## The installer

`sh mac/install-claude-home.sh --dry-run` then, after the suites passed, the real run:

```
changed 9   unchanged 8   backups made 6   stamp 2026-09-07
```

It refuses to install a `guard.js` that does not parse — that hook runs for every session on this
machine, and a broken one breaks every open seat. It patches the `settings.json` matcher by exact
string replacement (asserting the old value occurs exactly once, and validating the JSON parses
before writing) rather than rewriting the file. It never touches `marks/` or `numbers.db`.

### Live files replaced, with their backups

| Live file | Backup |
|---|---|
| `~/.claude/session-kind/mark.sh` | `mark.sh.bak-2026-09-07` |
| `~/.claude/session-kind/guard.js` | `guard.js.bak-2026-09-07` |
| `~/.claude/session-kind/census.py` | `census.py.bak-2026-09-07` |
| `~/.claude/session-kind/README.md` | `README.md.bak-2026-09-07` |
| `~/.claude/settings.json` | `settings.json.bak-2026-09-07` |
| `~/.claude/skills/local-orchestrator/SKILL.md` | `SKILL.md.bak-2026-09-07` |
| `~/.claude/skills/goalkeeper/goalkeeper.py` | `goalkeeper.py.bak-2026-09-07` (second install, token-leak fix) |

Created new, no backup needed: `~/.claude/skills/goalkeeper/SKILL.md`,
`~/.claude/skills/goalkeeper/references/anchor-check.md`.

Unchanged and therefore skipped: `number.py`, `title.js`, `statusline.sh`, and all five
`skills/adhd-goals/` files.

**If any live seat starts erroring:**
`cp ~/.claude/session-kind/guard.js.bak-2026-09-07 ~/.claude/session-kind/guard.js`

Verified immediately after installing: the live `guard.js` parses, the live `settings.json` is
valid JSON with matcher
`Agent|Task|Edit|Write|NotebookEdit|Skill|Bash|SendMessage|mcp__ccd_session_mgmt__send_message`,
and this worker session still writes its lane report, edits source, spawns builders and pushes —
only 🥅 reach is denied.

## The data repo

`sh mac/init-goalkeeper-repo.sh` created `~/.claude/goalkeeper/` — `thread.md`, `projects.json`
(`remote-system` + `lowcapsxyz`), `audits/`, `README.md` — first commit `49395a3`, no remote, by
design. It never overwrites an existing file and never re-inits an existing repo.

## The real run (milestone 6)

Against the installed `~/.claude/skills/goalkeeper/goalkeeper.py`, in `~/.claude/goalkeeper`:

```
thread add "today monday 7th september i want the lowcapsxyz consensus page re-designed
            and other parts redesigned" --horizon day --project lowcapsxyz   → T-2026-09-07-1
sweep --since 2026-09-06T00:00:00Z
audit
```

Sweep: `remote-system` 304 commits, 11 lanes, 0 decisions, 11 sessions, 76 operator turns
(**fetched**); `lowcapsxyz` 814 commits, 11 lanes, 16 decisions, 3 sessions, 62 operator turns
(**STALE**). Audit: 168 lines, 24 KB, committed `5a79257` in the data repo.

The direction is the operator's own sentence as recorded verbatim in PLAN.md §2 ruling 2 — it is
the example the operator gave of what a direction *is*, and PLAN §7 names it as the day-zero
entry. **The thread otherwise holds nothing: the operator should seed their real directions
before treating an audit as complete.** The seat has deliberately not filled in verdicts; that is
the seat's job with the operator, not a worker's.

Attached: [audit-2026-09-07.md](audit-2026-09-07.md).

## What I found that the operator should see

Three of these are gates or decisions, not things I could resolve.

- **`G-13` (gate) — half the evidence is permanently STALE.** The broker token's GitHub App is
  installed on `0xneelo/thinkpromptly-fleet` but not `0xneelo/lowcap-connector`, so a lowcapsxyz
  fetch fails with `Invalid username or token`. The degradation is by design and the note marks
  it STALE, but **NO ACTIVITY on a lowcapsxyz direction cannot be trusted until this is fixed** —
  and lowcapsxyz is the project the operator's own example direction is about.
- **`G-9` (decision) — PLAN §3.3's operator-turn filter admitted ~60% harness noise.**
  **Settled by PLAN §9**: the exclusion is now the default and `--strict-turns` is gone. See the
  GK-M.2 round below.
- **`G-5` (decision) — the write ban is anchored, not literal.** goal.md item 2 says other kinds
  are denied "writes under `/goalkeeper/`". Taken literally that also blocks this repo's own
  `docs/goals/goalkeeper/**`, which would stop every worker writing its lane report. Implemented
  against `<CLAUDE_CONFIG_DIR>/goalkeeper` instead. Verified a worker can still write this file.
- **`G-7` (decision) — a seat cannot `SendMessage` any text containing `GOALKEEPER` or 🥅**, even
  to a third party, because PLAN §3.4.2 specifies it literally. Lowercase mentions in a message
  *body* pass, so ordinary talk about this project works; the badge spelling does not.
- **`G-2` (decision) — PLAN §3.1 and the lane file contradict each other** on whether
  `mac/claude-home/` vendoring and the installer are in v1. The lane file and the launch prompt
  mandate them; I followed those and flagged it.
- **`G-12` — `census.py` does not see CLI worker sessions as live.** So the one-🥅 refusal keys on
  *desktop* liveness. That is the specified use, and I verified the plumbing end to end against the
  real census: `--live-badge-prefix "🎛"` lists both live orchestrators in the exact `badge<TAB>cwd`
  format and `mark.sh`'s awk turns that into a refusal. Nobody should read "0 goalkeeper" in a
  census summary as proof no seat is running.
- **Token leak, found and fixed in this commit.** `mint-github-token.sh --askpass` writes the live
  token in **plaintext** to `$TMPDIR/tmp.ghXXXX/askpass.sh` and tells the caller to delete it. My
  first sweep did not, so each run left a readable token on disk (I also found one from 2026-09-05
  left by another session — worth a sweep of `$TMPDIR` by whoever owns that path). `fetch()` now
  traps `EXIT INT TERM` and removes the helper dir; verified 0 dirs before and after a successful
  real fetch.

## Acceptance

goal.md items 1–6 and 8 hold on this Mac. Item 7 is Luitpold's lane (GK-D) and is untouched here —
I own none of `server.js` or `.claude/skills/coordinator-*`.

Item 1 caveat, stated precisely: `mark.sh --goalkeeper` prints the badge and `census.py` counts 🥅,
and the refusal fires against a live **desktop** 🥅 seat. I could not stamp a live 🥅 *and* have
census see it from this CLI session (see `G-12`), so the refusal is proven in two halves — the
`mark.sh` half by `mark.test.sh` cases 1–3 against a stub census emitting the documented format,
and the `census.py` half against the real census and real live desktop seats.

## Push

Branch pushed with the broker token (`GH_TOKEN` in env only, never argv, URL, file or log; the
askpass helper dir removed by the same trap the sweep now uses).

```
git ls-remote origin agent-giselher/goalkeeper-mac
6665c5f930a24de1802284a3901ecc3701ac4d8c        refs/heads/agent-giselher/goalkeeper-mac
```

Six milestones, three green suites (54 node + 33 sh + 42 python), the installer idempotent on a
re-run (`changed 0   unchanged 17`), and `~/.claude/goalkeeper/` live at data-repo commit
`5a79257`. Open items are `G-2`, `G-5`, `G-7`, `G-9` (decisions) and `G-13` (gate) in
LINEAR-PENDING.md — none of them block GK-D or the weave.

---

# GK-M.2 — the fix round

Review verdict on `3c4177e` was **FIX-FIRST**. Brief: `lane-giselher-fixes.md`, items 1–9, with
PLAN §9's amendments binding. Same branch. All nine closed, each with tests.

## Commits

| Item | Commit | What |
|---|---|---|
| 1 | `582458a` | symlinks cannot cross the jail wall |
| 5 | `2eecf8c` | installer stamp from the clock; a backup is never skipped |
| 6 | `1f31683` | the data repo's first commit really contains `audits/` |
| 7 | `7c826dc` | read-only means the working tree, not the fetch |
| 3 + 4 | `dc96d4c` | timeout-proof token cleanup; harness noise out by default |
| 4 | `e0d4bad` | SKILL.md follows item 4 |
| 8 | `c9853be` | a message that *mentions* the goalkeeper is not a message *to* it |
| 2 | `ef7ca92` | the shell reach deny reads the addressee, not the whole command |
| 9 | `09d0dff` | a heredoc quoting a reach is not a reach |

Nine items, eight commits: items 3 and 4 share `dc96d4c`. They live in one file and were built in
one pass; splitting them afterwards meant hand-reverting interleaved regions and pushing an
intermediate commit that did not run. A commit failing its own tests is worse for review than a
joint one. Its message documents each item separately. Logged as `G-15`.

## Tests

```
node --test mac/claude-home/session-kind/test/guard.test.js      # 128 pass  (was 54)
sh   mac/claude-home/session-kind/test/mark.test.sh              # 33 pass   (2 skipped, no timeout(1))
python3 -m unittest discover -s mac/claude-home/skills/goalkeeper/tests   # 48 pass (was 42)
```

## Three defects the brief did not name, found while closing it

These are the round's real content — the brief's items pointed at the right places, and the first
fix at each was not enough.

1. **A dangling symlink defeats `realpathSync`.** The obvious item-1 fix — realpath the deepest
   existing ancestor — still allowed the jailbreak, because `realpathSync` *throws* on a dangling
   link, so the walk fell back to the safe parent and allowed a write that then followed the link
   out. Resolving the link by hand with `lstat`/`readlink` is what actually closes it. My first
   PoC run showed `ALLOW` and that is the only reason I caught it.
2. **A missing mint script produced an unauthenticated fetch that reported success.**
   `eval "$(missing-script)"` exits 0 with an empty substitution, so the `&&` chain continued into
   a `git fetch` with no credentials, and `fetch()` returned truthy — meaning `fetched_at` would
   have been stamped on evidence that was never freshened. The shell now also requires
   `[ -n "$GIT_ASKPASS" ]`. This is beyond the brief's item 3 and is deliberate.
3. **`--to="🥅 GOALKEEPER 9"` was allowed.** The item-2 flag pattern stopped at the first space, so
   the badge's own spelling — the most obvious way anyone would address the seat — slipped through
   while the bare lowercase form was correctly denied. Found by the agent writing the item-2 tests,
   not by me.

## The 19:28Z incident, reproduced on myself

Item 9 is the guard denying prose. It bit me twice mid-round: the installed guard refused two of my
own Bash calls because the badge word and a bus path co-occurred in one command. The second denial
**silently discarded a `guard.js` edit** — a PreToolUse deny loses the whole call, so a denied edit
is indistinguishable from an edit that did nothing, and I only noticed because the probe results
made no sense afterwards. Everything I wrote about this feature from then on assembled the trigger
strings from fragments.

Proven fixed against the **live** guard after installing: a heredoc quoting the reach PoC now runs,
and so does prose naming the seat beside a bus path.

## Installer re-run

```
changed 3   unchanged 14   backups made 3   stamp 2026-09-07
```

Item 5's collision fallback is visible and working — `.bak-2026-09-07` already existed from the
first round, so this round's copies went to:

| Live file | Backup |
|---|---|
| `~/.claude/session-kind/guard.js` | `guard.js.bak-2026-09-07-224248` |
| `~/.claude/skills/goalkeeper/goalkeeper.py` | `goalkeeper.py.bak-2026-09-07-224248` |
| `~/.claude/skills/goalkeeper/SKILL.md` | `SKILL.md.bak-2026-09-07` (first backup of this file) |

Verified after installing: the live `guard.js` parses, `settings.json` is valid JSON with the full
matcher, and the live `goalkeeper.py` parses.

**Rollback, if a live seat starts erroring:**
`cp ~/.claude/session-kind/guard.js.bak-2026-09-07-224248 ~/.claude/session-kind/guard.js`

## Still open for the operator

- **`G-13` (gate)** — the broker's GitHub App is not installed on `0xneelo/lowcap-connector`, so
  lowcapsxyz evidence stays STALE and `NO ACTIVITY` there cannot be trusted. Unchanged by this round.
- **`G-18` (note)** — a **live** plaintext broker token was on disk at 16:24Z today, left by some
  other caller of `mint-github-token.sh --askpass`; removed by hand. `sweep_stale_askpass_dirs()`
  will now mop up such leaks as a side effect of any fetch, but the leaking caller is still out
  there and worth finding.
- **`G-12`, and the test README's "Known limits"** — the hung-census skip on this Mac, the
  check-then-act race on the one-🥅 rule, and census not seeing CLI worker sessions as live. All
  accepted for v1, all now written down rather than left as folklore.

`G-2`, `G-5`, `G-7` and `G-9` are settled by PLAN §9 and need nothing further.

---

# GK-M.3 — the last round

Re-review of `c85afbb`: all nine GK-M.2 items CLOSED, suites green, verdict **WEAVE once these
land**. Brief: `lane-giselher-fixes-2.md`, items 1–5. All five closed.

Every one of them was in `commandWritesGoalkeeper` — the Bash write-into-jail check I added
*beyond* the GK-M.2 brief. Unbriefed work gets the least review, and it showed.

## Commits

| Item | Commit | What |
|---|---|---|
| 1 | `ccc2664` | a `cd` in the same command no longer defeats the jail |
| 2 | `f4dd189` | `$HOME` is a spelling of `~`, and `norm()` now knows it |
| 3 | `8cba3b8` | a copy reads its sources and writes its destination |
| 4 | `c8dac99` | `agent` and `seat` are addressee keys again |
| 5 | `846ad28` | the harness tag is anchored to exact names |
| 1–4 | `dd220bd` | their regression groups in `guard.test.js` |

## Tests

```
node --test mac/claude-home/session-kind/test/guard.test.js      # 152 pass  (was 128)
sh   mac/claude-home/session-kind/test/mark.test.sh              # 33 pass   (2 skipped, no timeout(1))
python3 -m unittest discover -s mac/claude-home/skills/goalkeeper/tests   # 52 pass (was 48)
```

25 GK-M.3 probe shapes green, and the GK-M.2 probes for the reach, heredoc and quoted-addressee
shapes still pass.

## What each fix actually protects

- **Item 1** is the real hole. `cd ~/.claude/goalkeeper && echo pwned > evil.md` wrote into the
  jail with a target that is just a filename. The scanner now tracks where the shell is standing
  across `&&`, `||`, `;`, `|` and newlines. The care is in the unknowable case: after a
  `cd "$var"` a relative target cannot be placed, and denying those would break every worker
  writing relative paths in its own repo — so that case denies only when the command names the
  jail somewhere anchored.
- **Item 3** was a false positive, not a hole, and the worse kind of one: it refused an
  orchestrator *reading* the seat's audit note, with a message saying "never write there" that
  was not even true of the command. A copy reads its sources.
- **Item 5** protects an operator turn from being discarded. That is the error this filter must
  not make — §3.3 calls activity OFF THREAD only when no direction *and* no operator turn covers
  it, so a lost turn turns authorised work into reported drift. Measured after the fix: no row in
  the current window opens with `<command-`, so it changes no count today. It closes a latent
  path, not an observed one.

## Robustness, checked separately

The segment scanner was probed outside the suite — empty command, only operators, a 200-deep
`cd`, a 200 KB command, an unterminated quote, 2000 segments, a symlink loop. All exit 0 in under
40 ms. The guard is fail-open on error, but a **hang** would wedge every seat rather than fail
open, so this is worth re-checking whenever the scanner changes.

## One deviation in the tests, diagnosed not papered over

`mkdir <jail>/sub` allows, where the brief's case list expects a deny. An earlier fixture group
deliberately makes `<jail>/sub` a symlink pointing **out** of the jail, so resolving it out and
allowing is correct — denying it would be the bug. The mkdir-into-the-jail intent is asserted with
`<jail>/newsub`, and the collision is named in a comment.

## Installer re-run

```
changed 2   unchanged 15   backups made 2   stamp 2026-09-07
```

| Live file | Backup |
|---|---|
| `~/.claude/session-kind/guard.js` | `guard.js.bak-2026-09-07-230650` |
| `~/.claude/skills/goalkeeper/goalkeeper.py` | `goalkeeper.py.bak-2026-09-07-230650` |

Vendored tree is byte-identical to live for `guard.js`, `mark.sh`, `census.py`, `goalkeeper.py`
and `SKILL.md`. Verified against the **live** guard afterwards: the `cd`-into-jail and `$HOME`
PoCs deny, `cp` out of the jail allows, and this worker still writes its own lane report.

**Rollback:** `cp ~/.claude/session-kind/guard.js.bak-2026-09-07-230650 ~/.claude/session-kind/guard.js`

## Still open for the operator

Unchanged by this round: **`G-13`** (gate — the broker's GitHub App is not installed on
`0xneelo/lowcap-connector`, so lowcapsxyz evidence stays STALE and `NO ACTIVITY` there cannot be
trusted), **`G-18`** (a live plaintext broker token was found on disk from another caller of
`--askpass`; removed, but that caller is still leaking), and the test README's *Known limits*.

Lane GK-M is complete. The weave is the orchestrator's.

---

# GK-M.4 — the jail becomes conservative, tampering becomes evidence

Final review of `b44d562`: items 1–5 CLOSED, suites green, every named PoC behaving — and
adversarial probing still found three more ways around the Bash write-jail, plus one destructive
read. Brief: `lane-giselher-fixes-3.md`, items 1–3, with the PLAN §9 addendum binding.

That is four rounds, each closing the forms the last one missed. The lesson the brief draws, and
I agree with, is that the approach was wrong rather than the patches: **static analysis of shell
text is never complete.** So this round gives up precision for a rule with no seams, and moves the
guarantee to detection.

## Commits

| Item | Commit | What |
|---|---|---|
| 3 | `293bd41` | `SKILL.md` — what protects the records, and what does not |
| 1 | `d1d824e` | the Bash jail becomes conservative |
| 2 | `2f5327c` | tampering with the seat's records becomes evidence |
| — | this commit | report, ledger, `ACK GKM4` |

## Tests

```
node --test mac/claude-home/session-kind/test/guard.test.js      # 188 pass  (was 152)
sh   mac/claude-home/session-kind/test/mark.test.sh              # 33 pass   (2 skipped, no timeout(1))
python3 -m unittest discover -s mac/claude-home/skills/goalkeeper/tests   # 62 pass (was 52)
```

39 GK-M.4 probe shapes green, and every earlier probe suite still passes.

## Item 1 — the rule now has no seams

The three bypasses, all reproduced before the change:

- `cd "$HOME/.claude" && cd goalkeeper && echo pwned > evil.md` — the `$` "unknowable" test ran
  *before* anything expanded `$HOME`, and the second, relative `cd` then resolved against the
  session cwd.
- `(cd <jail> && …)`, `{ cd <jail>; …; }`, `bash -c '…'` — the `cd` regex required the whole
  segment to be exactly `cd <dir>`.
- `mv <jail>/thread.md /tmp/stolen.md` — allowed by the destination-only rule, though `mv`
  **destroys its source**.

The `cd` tracker and the destination analysis are gone. For a non-goalkeeper stamped kind: a
command that names the goalkeeper directory is allowed only if it is a pure read; anything else
naming it is denied; a command that does not name it is never touched.

**This reverses a GK-M.3 change of mine.** `cp <jail>/audits/2026-09-07.md /tmp/copy.md` was made
ALLOW two rounds ago because refusing an orchestrator reading the seat's evidence was a false
positive. It is DENY again — `cp`/`mv` naming the jail are refused in every argument position,
which is the only way to close `mv` out without resuming the analysis four rounds have shown to be
unfinishable. Evidence still leaves by `cat`, `head`, `sed -n` or `git show`. Logged as `G-22`.

**One deviation from the brief's literal text, taken deliberately.** Its NAMES list includes a
bare `goalkeeper/` segment; that also matches this repo's own `docs/goals/goalkeeper/` — the goal
pack, every lane brief, every lane report. Under the literal reading no worker could
`git add docs/goals/goalkeeper/…` or write its own report; the rule would stop the fleet rather
than the seat. PLAN §9 (G-5) already settled that directory stays writable and the addendum words
the rule as "names the goalkeeper **directory**", so that is what NAMES tests. Asserted explicitly
in the suite. Logged as `G-23`.

## Item 2 — detection is the guarantee

Every CLI commit is authored `goalkeeper@local`; `sweep` keeps the resulting SHA and the paths it
wrote in `sweep-state.json` (gitignored in the data repo), then checks three things before its own
writes: uncommitted changes, commits by another author, and mtimes newer than the last commit that
the seat did not write. Plus `no_baseline` when the state file is missing, and `check_failed` when
a check cannot run — **silence must never read as cleanliness.** Findings land in `sweep.json` as
`tamper[]`; `audit` opens with a ⚠ TAMPER block and the verbatim sentence marking the thread and
audits since the last clean SHA unverified. A clean run adds nothing.

Verified end to end on a fixture: baseline sweep → clean sweep reporting zero → a foreign commit
by `someone@else` plus an uncommitted edit → a sweep reporting exactly those two → an audit opening
with the block. The live `~/.claude/goalkeeper` was checked untouched before and after.

Seven places the brief's prose and its own concrete spec disagreed are resolved toward the spec and
listed in `2f5327c`. The one worth repeating: `written` had to be excluded from the *uncommitted*
check too, not just the mtime check, or two clean runs in a row were impossible — at the cost, now
documented, that a foreign edit to `sweep.json` or `sweep-state.json` between runs is invisible.
Those are seat output, not records.

## The limit, stated rather than papered over

A glob (`cd ~/.claude/goal*eeper`) or a variable holding the path never spells the directory, so
the guard allows it; a process that bypasses Claude Code tooling is not seen at all. That is not a
fifth round's defect — it is why item 2 exists. `SKILL.md` now says so to the seat, and tells it
what to do when a TAMPER block appears: report it, name the unverified entries, let the operator
confirm. Never reason around it, never repair the records itself. Also in the test README's
*Known limits*.

## Installer re-run

```
changed 3   unchanged 14   backups made 3   stamp 2026-09-07
```

| Live file | Backup |
|---|---|
| `~/.claude/session-kind/guard.js` | `guard.js.bak-2026-09-07-233658` |
| `~/.claude/skills/goalkeeper/goalkeeper.py` | `goalkeeper.py.bak-2026-09-07-233658` |
| `~/.claude/skills/goalkeeper/SKILL.md` | `SKILL.md.bak-2026-09-07-233658` |

Vendored tree is byte-identical to live for `guard.js`, `mark.sh`, `census.py`, `goalkeeper.py`,
`SKILL.md` and `anchor-check.md`. Verified against the **live** guard afterwards: all three
bypasses deny, pure reads allow, and this worker still writes its lane report, stages its pack and
pushes.

**Rollback:** `cp ~/.claude/session-kind/guard.js.bak-2026-09-07-233658 ~/.claude/session-kind/guard.js`

## Still open for the operator

`G-13` (gate — the broker's GitHub App is not on `0xneelo/lowcap-connector`, so lowcapsxyz evidence
stays STALE), `G-18` (a live plaintext broker token from another `--askpass` caller), `G-22` (the
`cp`-out reversal, for confirmation), `G-23` (the NAMES narrowing), `G-24` and the test README's
*Known limits*.

Lane GK-M is complete. The weave is the orchestrator's.
