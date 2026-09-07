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
- **`G-9` (decision) — PLAN §3.3's operator-turn filter admits ~60% harness noise.** Measured
  here: 75 of 126 rows that pass the filter are `<task-notification>` / `<system-reminder>` /
  context-continuation summaries, not the operator. That matters because OFF THREAD requires "no
  operator turn covers it", so noise silently absolves real drift. §3.3 is implemented **verbatim**
  because acceptance item 4 requires it; `sweep --strict-turns` drops the three shapes (127 → 51
  on real data). Recommend folding it into §3.3 for v1.1 — that needs a PLAN amendment.
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
