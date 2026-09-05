---
name: adhd-goals
description: Goal-focused ADHD view — WHAT THE OPERATOR WANTS, not what the orchestrator is doing. Mines this repo's session history (N days back, reader/hunter fan-out) plus the committed goal ledger, reconciles the operator's goals, attaches lanes/Linear tasks as collapsible sub-items, and delivers a one-glance chat table plus a clickable HTML goal board. Sub-commands - set/list/done/park/drop. Use when the user types /adhd-goals, /adhd-set-goal, /adhd-list-goals, asks "what are our goals", "where do we stand on the goals", "what did I ask for", "I lost track of the goals", or when an orchestrator or coordinator boots, hands off, or packages a lane and must name the goal it serves.
---

# ADHD Goals — where we stand on the operator's goals

**Goals are the operator's. Tasks, lanes and Linear issues are the orchestrator's.** This skill
keeps them apart: one goal ledger per repo, mined from history and confirmed by the operator.
`/adhd-table` = who is on what · `/adhd-roadmap` = when · **`/adhd-goals` = why, and how far**.

Ledger: `docs/operator-goals/ledger.json` (docs-only → orchestrators may write it; commit it on
`origin/main` like a handoff). Never confuse it with `docs/goals/` = worker goal packs (= tasks).

## Invocations

| Typed | Does |
|---|---|
| `/adhd-goals [--days N] [--readers N] [--hunters N]` | **rebuild**: scan history → readers → reconcile ledger → board (defaults 3 · 4 · 0) |
| `/adhd-goals set "<goal>" [why…]` · `/adhd-set-goal …` | record a goal NOW: `goals.py add "<goal>" --why "<operator's words>"` |
| `/adhd-goals list` · `/adhd-list-goals` | board from the ledger, no scan: `goals.py list` (+ `render` if asked) |
| `/adhd-goals done\|park\|drop G3 [note]` | `goals.py status G3 done --note "…"` |

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

## What counts as a goal (the filter readers and you apply)

- An **outcome the operator asked for or agreed to** — what they want to be true. "Separate the
  node, RPC/WS and request lanes" ✅. "Launch Karl on XYZ-1742" ❌ (task). "Fix the flaky test"
  ❌ unless the operator asked for it as an end in itself.
- ≤ 12 words, verb-first, outcome-phrased; `why` = the operator's own words, one line, verbatim.
- A goal outlives sessions and has many tasks. Fewer than 3 tasks and done in one sitting → task.
- The operator changing their mind is a status change (`drop`/`park` + note), never a deletion.
- Never invent intent. No operator words for it → it is not a goal (write it under a goal as `next`).

## Standing rules — this is what makes seats *think* in goals

- **Seat boot** (🎛 orchestrator, 🧭 coordinator): `goals.py list` before the first plan; restate the
  open goals in the first reply. No ledger yet → run the rebuild once, then commit the ledger.
- **New operator ask in chat** that is outcome-level → `goals.py add` in the SAME turn, and cite
  the ID back ("→ G5"). Do not wait for a rebuild.
- **Every `/introduce-goal` pack and every Linear issue** names its goal: `Goal: G3` in the pack
  header + `goals.py attach G3 <ref>`. A lane that serves no goal is a question for the operator.
- **Seat handoff** (`/orchestrator-handoff` §3): list topics BY GOAL ID; the ledger commit rides
  the handoff commit. **Coordinator**: `board.json.lanes[].goal` should quote a ledger ID.
- Answer "what are we working on?" from the ledger first, tasks second.

## Fallbacks — degrade, never stall

No sessions in window → say so, offer `--days 7`. Reader JSON unparsable → re-run that pack only.
Linear/hunters unavailable → ⚠️ line, continue. Empty ledger is a valid answer ("no goals recorded — set one").
