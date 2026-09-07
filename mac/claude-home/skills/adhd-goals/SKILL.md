---
name: adhd-goals
description: Goal-focused ADHD view — WHAT THE OPERATOR WANTS, not what the orchestrator is doing. Mines this repo's session history (N days back, reader/hunter fan-out) plus the committed goal ledger, reconciles the operator's goals, attaches lanes/Linear tasks as collapsible sub-items, and delivers a one-glance chat table plus a clickable HTML goal board. Sub-commands - set/list/done/park/drop/full. `full` (/adhd-full-goals) = the NO-LIMITS list - every outcome the operator ever wanted or mentioned, as if there were no time, capacity or cost limits, mined from ALL history plus the coordinator files and confirmed with the live coordinator/orchestrator seat. Use when the user types /adhd-goals, /adhd-full-goals, /adhd-set-goal, /adhd-list-goals, asks "what are our goals", "where do we stand on the goals", "what did I ask for", "I lost track of the goals", "what would we build if we could do everything", "the complete goal list", "everything I ever asked for", or when an orchestrator or coordinator boots, hands off, or packages a lane and must name the goal it serves.
---

# ADHD Goals — where we stand on the operator's goals

**Goals are the operator's. Tasks, lanes and Linear issues are the orchestrator's.** This skill
keeps them apart: one goal ledger per repo, mined from history and confirmed by the operator.
`/adhd-table` = who is on what · `/adhd-roadmap` = when · **`/adhd-goals` = why, and how far** ·
**`/adhd-full-goals` = everything the operator ever wanted, no limits**.

Ledger: `docs/operator-goals/ledger.json` (docs-only → orchestrators may write it; commit it on
`origin/main` like a handoff). Never confuse it with `docs/goals/` = worker goal packs (= tasks).

## Invocations

| Typed | Does |
|---|---|
| `/adhd-goals [--days N] [--readers N] [--hunters N]` | **rebuild**: scan history → readers → reconcile ledger → board (defaults 3 · 4 · 0) |
| `/adhd-goals set "<goal>" [why…]` · `/adhd-set-goal …` | record a goal NOW: `goals.py add "<goal>" --why "<operator's words>"` |
| `/adhd-goals list` · `/adhd-list-goals` | board from the ledger, no scan: `goals.py list` (+ `render` if asked) |
| `/adhd-goals done\|park\|drop G3 [note]` | `goals.py status G3 done --note "…"` |
| `/adhd-goals full [--readers N] [--hunters N]` · `/adhd-full-goals` | **the no-limits list** (defaults 8 · 0): ALL history + coordinator files → readers → ask the live seat → reconcile (💭 `mentioned`) → `list --full` + board |

Scripts live in this skill's dir: `S=~/.claude/skills/adhd-goals`. Run them from inside the repo
(any worktree) — they derive the main checkout via git; `--repo PATH` overrides.

## Rebuild — 5 steps

1. **Scan** (10 s): `python3 $S/scan.py --days N --packs R` → prints run dir `D` and
   `pack-01 … pack-MM`. Chronological packs of every operator prompt + clipped agent replies for
   sessions inside this repo (main + worktrees; 🎛 seats flagged). Also read the newest
   `docs/goals/HANDOFF-*.md` §3 yourself — it is the cheapest goal source.
2. **Extract** — one `reader` per pack, ALL in ONE message, prompt from
   [REFERENCE.md §Reader](REFERENCE.md). Each drops `D/candidates/pack-NN.json`.
3. **Reconcile** (you, the driver — this is the judgement step, rules in
   [REFERENCE.md §Reconcile](REFERENCE.md)): merge candidates into the existing ledger. Same
   outcome = one goal, earliest `asked`, latest evidence. New goal = `goals.py add`. Status and
   health from the LAST evidence, never from a plan. Then `python3 $S/goals.py check`.
4. **Attach tasks** — for every `XYZ-####` / branch / `LC-*` ref the readers found:
   `goals.py attach G3 XYZ-1742 --who Karl --lane claude/x --state "In Review" --emoji 👀`.
   Linear reachable → refresh state/assignee with `mcp__linear__get_issue` for the OPEN refs of
   ACTIVE goals only (≤6 calls — each reply carries the full issue body); done goals keep the
   reader's state. Linear down → `⚠️ Linear unreachable`. `git worktree list` fills lanes.
   Optional `--hunters N` (≥1): launch `hunter` bees with the [REFERENCE.md §Hunter](REFERENCE.md)
   prompt over `D` + the ledger; fold their findings back with `add`/`status`/`attach`.
5. **Deliver**: `python3 $S/goals.py render` → HTML path → publish with the Artifact tool
   (favicon 🎯, title `<project> goals`; no Artifact tool → `SendUserFile display:"render"`).
   In chat paste `goals.py list` output (≤10 goal rows; the board holds the expansion), then:
   - one line: `N goals · 🟢 a · 🟡 b · 🔴 c · ⏸ d · ✅ e` + ⚠️ for any failed source
   - **⏭ Next step (<2 min):** confirm/correct: `"/adhd-goals drop G4"` or `"set …"` — the
     operator owns the list; a mined goal is a guess until they nod.

## Full list — every goal the operator ever voiced (`/adhd-full-goals`)

The question it answers: *"If we had no limits — no time, no capacity, no cost, no train windows —
what would we be building? Everything the operator wanted and mentioned."* Same ledger, same IDs.
What changes: the window (all history, not N days), the sources (the coordinator's on-disk memory
joins the sessions), the filter (a small or once-mentioned want still counts), and one extra step —
**the seat that holds the operator's context is asked**. Wants nobody picked up get status
`mentioned` (💭); the NOW view folds them into one line, so the full list never crowds the seats.

1. **Scan**: `python3 $S/scan.py --days all --sources --packs R` → `D`, `pack-00` (the operator's
   words on disk: `coordinator/board.json` lanes + northstar, `decisions-effective.md`, the ledger,
   the newest `docs/goals/HANDOFF-*.md`, memory notes) and `pack-01 … pack-RR` (every session since
   the repo's first). `--sources` also reads `coordinator/README.md` — in a repo that only *builds*
   the coordinator its board lanes are a fixture, and the reader is told to skip them.
2. **Extract** — one `reader` per pack incl. pack-00, ALL in ONE message, prompt from
   [REFERENCE.md §Reader (full)](REFERENCE.md). No size filter; rulings and constraints are not goals.
3. **Ask the seat** — the coordinator or orchestrator is the session that heard the operator.
   `ListAgents` → a live `🧭 COORDINATOR` or `🎛 ORCHESTRATOR · <project>` for THIS repo that is not
   this session → send it the draft with the [REFERENCE.md §Ask the seat](REFERENCE.md) message
   (`/notify` alias `coordinator <N>` / `orchestrator <project>`, or `SendMessage`; 120 s) and save
   its reply as `D/candidates/seat.json`. No seat live, or no reply → `⚠️ seat not asked`, continue —
   its memory is already in pack-00 (D-3: the files are the memory, the chat is a view). If THIS
   session is the seat, answer from your own context first: add every want the readers missed.
4. **Reconcile** ([REFERENCE.md §Reconcile (full)](REFERENCE.md)): an existing goal keeps its ID and
   status — this pass only ADDS wants and fills `theme` / `why` / `sources`. New want with evidence
   of a lane, issue or worker → `active`; voiced and never picked up → `mentioned`. `parked` and
   `dropped` need the operator's words. Every goal gets a `theme` (≤ 8 per repo). `goals.py check`.
5. **Deliver**: `goals.py list --full` in chat (every goal, grouped by theme, badges, the
   operator's words) and `goals.py render --full` → Artifact (🎯, title `<project> goals`, opens on
   *All · no limits*). Then one tally line incl. 💭, ⚠️ for any failed source, and
   **⏭ Next step (<2 min):** promote or prune ONE 💭 goal: `"/adhd-goals status G9 active"` or
   `"/adhd-goals drop G9"`. Nothing new found is a valid answer — say so in one line.

The full list is the wishlist, not the queue: a 💭 goal becomes work only when the operator
promotes it or a seat asks. Doctrine like "done this week or cancelled" governs the queue, not this list.

## What counts as a goal (the filter readers and you apply)

- An **outcome the operator asked for or agreed to** — what they want to be true. "Separate the
  node, RPC/WS and request lanes" ✅. "Launch Karl on XYZ-1742" ❌ (task). "Fix the flaky test"
  ❌ unless the operator asked for it as an end in itself.
- ≤ 12 words, verb-first, outcome-phrased; `why` = the operator's own words, one line, verbatim.
- A goal outlives sessions and has many tasks. Fewer than 3 tasks and done in one sitting → task
  (in the **full** pass this size rule is off: a small outcome the operator wanted is still a want).
- The operator changing their mind is a status change (`drop`/`park` + note), never a deletion.
- Never invent intent. No operator words for it → it is not a goal (write it under a goal as `next`).

## Standing rules — this is what makes seats *think* in goals

- **Seat boot** (🎛 orchestrator, 🧭 coordinator): `goals.py list` before the first plan; restate the
  open goals in the first reply. No ledger yet → run the rebuild once, then commit the ledger.
- **New operator ask in chat** that is outcome-level → `goals.py add` in the SAME turn, and cite
  the ID back ("→ G5"). Do not wait for a rebuild. A want that is not for now ("someday", "would be
  nice", "eventually") → `goals.py add "…" --why "…" --status mentioned` — it joins the full list.
- **Every `/introduce-goal` pack and every Linear issue** names its goal: `Goal: G3` in the pack
  header + `goals.py attach G3 <ref>`. A lane that serves no goal is a question for the operator.
- **Seat handoff** (`/orchestrator-handoff` §3): list topics BY GOAL ID; the ledger commit rides
  the handoff commit. **Coordinator**: `board.json.lanes[].goal` should quote a ledger ID.
- Answer "what are we working on?" from the ledger first, tasks second.

## Fallbacks — degrade, never stall

No sessions in window → say so, offer `--days 7`. Reader JSON unparsable → re-run that pack only.
Linear/hunters unavailable → ⚠️ line, continue. Empty ledger is a valid answer ("no goals recorded — set one").
