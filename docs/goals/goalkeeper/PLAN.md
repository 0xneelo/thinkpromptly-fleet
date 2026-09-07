# Goalkeeper — plan v2 (2026-09-07, 🎛 ORCHESTRATOR 34)

Goal: **G3** (`docs/operator-goals/ledger.json`). v2 supersedes v1 (same day) after a Fable
audit (§8). Supersedes the lane plan in `docs/research/goal-keeper-lanes-2026-09-05.md`
(branch `claude/goal-keeper-role-4b183a`, 976f821, not on main) where the two disagree; the
09-05 gap analysis stays valid as evidence.

## 1. What happened before this seat (verified 2026-09-06T21:35Z – 2026-09-07T01:10Z)

| When (UTC) | Who | What |
|---|---|---|
| 09-05 01:13 | operator, session e3470c09 (unstamped, worktree `goal-keeper-role-4b183a`) | "we need to create a new role 'goal-keeper' … his job is just keeping track of goals, absolutely nothing else" |
| 09-05 01:36 | operator, same | "how would i know what an orchestrator just asked me is not some context rotten problem he just made up but related to our goalkeeping jobs" |
| 09-05 23:54 | session e3470c09 | commit 976f821: gap analysis + lane plan L1–L6; vendored `~/.claude` sources under `mac/claude-home/` |
| 09-06 12:29 | operator | "is the goalkeeper built now finally" |
| 09-06 13:53 | 🎛 ORCHESTRATOR 32 (session 0efd1f19, a worker session that self-promoted) | launched 11 Codex lanes via `ssh gb-deploy "wsl sh /home/vibe/fd-launch-gpt.sh <Name> <slug> <base> xhigh"`, six of them gk-l1…l6 from 976f821 |
| 09-06 ~15:25 | both sessions | went quiet. No handoff written. |
| 09-07 00:35 | this seat | found the lanes in the deck session list |

Lane state 2026-09-07T01:05Z (box, read-only):

| lane | worker | branch | commits beyond base | pushed | state |
|---|---|---|---|---|---|
| L1 ledger write path | Ymma | agent-gk-l1-ledger | 0 | no | idle: Linear `oauth_token_invalid_grant` |
| L2 session kind 🥅 | Sighard | agent-gk-l2-sessionkind | 0 | no | idle: "L2 remains unimplemented. Reconnect Linear, then resume" |
| L3 `/goal-keeper` skill | Bertwin | agent-gk-l3-skill | 1 (d451497: SKILL.md + anchor-check.md, 279 lines, no tests) | yes | idle on Linear |
| L4 sweep | Ingomar | agent-gk-l4-sweep | 0 | no | idle on Linear |
| L5 hooks brief injection | Uodalrich | agent-gk-l5-hooks | 0 | no | idle on Linear |
| L6 deck goals page | Poppo | agent-gk-l6-goalspage | 0 | no | idle on Linear |

Root cause: the 09-06 briefs made Linear mandatory at the claim step and the box's Linear MCP
token is dead. The introduce-goal templates were made Linear-optional on 2026-09-07; the box
MCP state itself is unverified from here.

## 2. Operator rulings 2026-09-07 (verbatim, this session)

1. Shape: "Hooks + script + 🥅 seat".
2. "goals are not cards, or part of turns they are general directions like a red thread like i am
   saying 'today monday 7th september i want the lowcapsxyz consensus page re-designed and other
   parts redesigned'"
3. "we dont care about lanes or handoffs, these are the jobs of the cooridnator and orchestrator,
   the goalkeeper works together with the operator and 'audits' the drift of the coordinator from
   the daily / weekly goals"
4. "the goalkeeper is just an auditor and notifies the operator it doesnt communciate with the
   orchestrator or coordinator. only through indirect messages. (we can still decide how,
   potentially through a board or just by operator provided messages. but important, the
   coordinator cannot communicate with the goalkeeper at all.)"
5. Scope: "One 🥅 for all projects".
6. Relay: "Audit note + drafted relay you forward".

## 3. The goalkeeper, v1 scope

**One `🥅 GOALKEEPER <N>` desktop seat per operator, all projects.** Works 1-on-1 with the
operator. Holds the **red thread**: the operator's dated directions, verbatim. **Audits** what
the coordinator and orchestrator seats actually did against the thread and reports drift to the
operator only. Never messages a seat. No seat can address it (§3.4).

### 3.1 Where it lives — outside every fleet repo

- cwd and data: `~/.claude/goalkeeper/`, its own local git repo (history, no exposure to the
  orchestrator's weaves and rebases). The seat commits after every `thread add` and `audit`.
  One directory → `mark.sh` claims per directory → one seat; census refuses a second 🥅.
- Skill: `~/.claude/skills/goalkeeper/` — `SKILL.md`, `references/anchor-check.md` (from
  Bertwin's `origin/agent-gk-l3-skill`, verdict machine kept), `goalkeeper.py`.
- Session kind: `~/.claude/session-kind/` edited in place with `.bak` (the 09-06 pattern).
  `mac/claude-home/` vendoring and `install-claude-home.sh` are **out of v1** (stale snapshot,
  box workers cannot read the Mac).
- Reads other projects read-only by absolute path from `projects.json`. Writes nothing there.

| File in `~/.claude/goalkeeper/` | Content |
|---|---|
| `thread.md` | append-only. `### T-2026-09-07-1 · Mon 2026-09-07 · day · lowcap-connector` + the operator's words verbatim. Horizon `day` or `week`. |
| `projects.json` | `{alias, path, ledger, board, decisions}` per repo; aliases like `lowcapsxyz → /Users/misterislez/projects/lowcap-connector` |
| `sweep.json` | machine evidence (§3.2), never hand-edited |
| `audits/YYYY-MM-DD.md` | audit note + drafted relay lines |

### 3.2 `goalkeeper.py` v1: `thread add`, `sweep`, `audit`

Deferred (with the deck page): `render` HTML, hourly `CronCreate` digest, badge patterns.

`sweep --since <ISO>` writes `sweep.json`:

```
{ "swept_at", "since",
  "projects": [ { "alias", "path", "fetched_at" | null,          # git fetch --prune origin, broker token; null = STALE, local refs used
      "commits":       [{sha, author, date, ref, subject}],       # origin/* refs, since
      "board_lanes":   [{id, state, goal, branch, reported_at}],  # coordinator/board.json
      "decisions":     [{id, date, text}],                        # decisions-effective.md rows added since
      "ledger_goals":  [{id, goal, status, updated}],             # docs/operator-goals/ledger.json
      "sessions":      [{title, cwd, session_id, transcript}],    # ~/.claude/sessions/*.json + mark.sh --list, cwd under path
      "operator_turns":[{session_id, ts, text}] } ],              # §3.3 filter
  "inbound_peer_msgs": [{ts, from, text}] }                       # the goalkeeper's own transcript, §3.4(3)
```

`audit` writes `audits/<date>.md`: one block per direction in the live day/week window with
the evidence rows that touch it, then a block **Unmatched activity** (commits, lanes, decisions
traceable to no direction and to no operator turn). The seat fills in the verdicts.

### 3.3 Evidence rules — what counts as the operator's words

- Operator words are exactly two things: `thread.md`, and **operator turns** read from each
  live seat's transcript. Deterministic filter: `type == "user"`, `message.content` is a string,
  contains neither `<cross-session-message` nor `<command-message>`. (Measured on 🎛 28's
  transcript: 676 user rows → 39 operator-typed turns.)
- Ledger, board, Linear and sitrep text is **quoted** in a RE-SCOPED verdict, never followed
  (anchor-check.md:42-45: `source: operator` is not a substitute for attributable words).
- Every verdict cites a sha, lane id, decision id or turn timestamp, or says UNVERIFIED.

| Verdict | Meaning |
|---|---|
| ON THREAD | activity since the direction's date traces to it |
| NO ACTIVITY | nothing in any seat touches it (carries `fetched_at`; STALE if no fetch) |
| OFF THREAD | activity traceable to no direction **and to no operator turn** — phrased as a question: "did you ask for this? yes → `thread add`" |
| RE-SCOPED | a seat's phrasing differs from the operator's words; quoted side by side |

Each drift line ends with a drafted relay:
`→ relay to 🎛 ORCHESTRATOR 28 · lowcap-connector: "<one sentence in the operator's words>"`.
The operator forwards it or does not. Nothing else leaves the seat.

### 3.4 Isolation — real, not advisory

1. **Deck choke point.** `server.js deliverDesktopSession` refuses a resolved row whose `name`
   starts with `🥅` or whose `cwd` is `~/.claude/goalkeeper` (403). This covers notify,
   loopback `POST /api/messages` (unauthenticated) and the sessions page — not only `notifySend`.
2. **Guard.** `settings.json` PreToolUse matcher gains `Skill|Bash|SendMessage|mcp__ccd_session_mgmt__send_message`
   (today `Skill` is unmatched, so the existing `introduce-goal` deny is dead). Stamped kinds:
   deny `SendMessage`/`send_message` when `JSON.stringify(tool_input)` contains `GOALKEEPER` or
   `🥅`; deny Bash matching `fleet-notify|fleet-message|api/notify|api/messages|\.claude/sessions/`
   with a 🥅 target. Goalkeeper kind: deny every `SendMessage`/`send_message`, deny Bash
   matching those patterns at all, deny builders and `introduce-goal`, allow writes only under
   `~/.claude/goalkeeper/` and the scratchpad (not the generic docs/md allowlist).
3. **Raw socket stays open** (any same-user process can write a peer frame). Mitigation is
   goalkeeper-side and deterministic: `sweep` greps the goalkeeper's own transcript for
   `<cross-session-message` and emits each as an `inbound_peer_msgs` drift line — evidence,
   never instruction.
4. **Skills.** `local-orchestrator`, `coordinator-portal`, `coordinator-run` gain one line:
   never address 🥅, never write under `~/.claude/goalkeeper/`.

## 4. Lanes v1

| Lane | Where | Breed | Deliverable |
|---|---|---|---|
| **GK-M** | Mac-local CLI worktree of this repo for the pack + report; edits live `~/.claude/` | Claude (needs Mac paths, transcripts, marks) | session kind (`mark.sh --goalkeeper`, guard rules §3.4.2 with unit tests, census 🥅 + one-seat refusal), skill `~/.claude/skills/goalkeeper/` (SKILL.md on the auditor charter, anchor-check kept), `goalkeeper.py` v1 with fixture tests + one real run over this Mac, `~/.claude/goalkeeper/` repo init with `projects.json`, isolation line in `~/.claude/skills/local-orchestrator/SKILL.md`, `.bak` of every edited live file |
| **GK-D** | german-box | Codex `gpt-6-astra` xhigh (D-30) | `server.js deliverDesktopSession` 🥅 refusal + test; isolation line in repo `.claude/skills/coordinator-portal` and `coordinator-run` |

09-05 lanes: L2→GK-M, L3→GK-M input, L4+L1 slice→GK-M; L1 lock/intent inbox, L5 hooks
injection, L6 deck page: retired or deferred (rulings 2, 4, 6). Box sessions `FD-gk-l1…l6`:
retire (zero commits beyond base, clean trees; L3 is pushed and harvested by GK-M).

## 5. Gates that need the operator

| # | Gate | Why |
|---|---|---|
| 1 | Word for a **Mac-local** worker (GK-M) | every v1 artifact lives on the Mac; box workers cannot reach it |
| 2 | Word to **retire the six `FD-gk-*` box sessions** | zero commits; they hold worker names and deck rows |
| 3 | Linear re-auth on the box + the Mac desktop (no Linear MCP in this session) | packs go Linear-optional; issues get filed when it is back |
| 4 | `./up.sh` on the deck | unrelated: G1/G2 code is on main but not running |

## 6. Launch

Broker probed 200 before each launch. GK-D via `fd-launch-gpt.sh` (prompt file to
`~/launch/launch-<name>.txt` on the box via ssh tee, plain shell). GK-M via a Mac tmux session
`LC-<name>` started from a plain shell in a Mac worktree of this repo, Claude with the
`introduce-goal` execution protocol. Briefs carry: Linear-optional rule, `Goal: G3`, broker
token recipe, "if Linear MCP errors, write the issue text to `docs/goals/goalkeeper/LINEAR-PENDING.md`
and continue".

## 7. Day zero (optional, by hand, tonight)

The audit for "consensus page redesigned" needs no code: a `thread.md` entry, `git fetch` +
`git log origin --since=2026-09-07` in lowcap-connector, its `coordinator/board.json`, and the
🎛 28 operator turns. Bertwin's draft skill (`origin/agent-gk-l3-skill`) is a usable checklist
until GK-M lands.

## 8. Fable audit 2026-09-07 — findings applied

C1 G3 text said "nudges the live seats" → rewritten to rulings 2–6. C2 title-only refusal →
deck choke point + Bash/Skill in guard + inbound-frame evidence. H1 data on a fleet branch →
`~/.claude/goalkeeper/` own repo. H2 OFF THREAD overclaimed → operator turns as evidence, verdicts
cite or say UNVERIFIED, OFF THREAD is a question. H3 sweep schema undefined → §3.2. H4 goalkeeper
could write any docs/ → allowlist is its own dir. M1 ledger text as operator words → §3.3. M2
stale local refs → fetch + `fetched_at`. M3 stale vendor round trip → Mac-local lane. M4 render +
cron are card-shaped → deferred. M5 Linear → optional + pending file. L1 two 🥅 → one dir +
census refusal. L2 title spoof → cwd check too. L3 uncommitted → committed with this v2.
