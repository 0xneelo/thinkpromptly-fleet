# Portal data-loss audit — 2026-09-05

Question (operator): when I talk to a 🧭 COORDINATOR portal, does everything important get
recorded, and how does the portal decide what is important?

Scope: every portal session on this Mac, 2026-08-29 → 2026-09-05 (8 transcripts, ~72 operator
statements), diffed against the live record in `lowcap-connector/coordinator/` (board, D-1..D-45,
inbox, archive) and the fleet fixture. Six read-only readers, one per session group plus one over
the sitrep archive. Findings verified against disk and git at audit time.

## 1. How selection works today

There is no API and no hook that asks the portal anything. Selection is the model's own judgment
against two prose rules in `~/.claude/skills/portal/SKILL.md` and DESIGN-v1 §2a/§3:

1. The CCIR list — eight event classes that "must" become a sitrep.
2. "If it matters it goes Linear ID → inbox sitrep → run commit in the same turn, or it does not exist."

What is mechanical: the sitrep POST validates *shape* (7 required keys, ISO time). Nothing
validates *coverage*. `settings.json` carries no coordinator or portal hook; `boot-gate.py` ships
disarmed and targets orchestrator seats only. The design's own oracle predicted the outcome:
"advisory gates are proven failures (Class C/E)" — and the portal's whole write path is advisory.

## 2. What was lost (by mechanism)

| # | Mechanism | Evidence | Count |
|---|---|---|---|
| A | **Conversational priority, not phrased as a ruling** → answered, never filed | 🧭 4, 09-03 23:12 "mainly concerned about finally properly separating ws/node-lane" — unfiled; operator restated it next day, became D-19 | 1 lost, self-healed by restatement |
| B | **Relay ≠ record** — operator words forwarded to a seat over SendMessage, no sitrep/D-row | 🧭 1: "8h cert and git train running", billing status; 🧭 6: cutover "go ahead" forwarded to 🧭 7, no ledger row (survives only in a portal-state note) | 3 lost |
| C | **Session end / retirement race** — operator keeps typing into a portal that has handed off or hit its cap | 🧭 6: family sheet 9/9 pasted after retirement, ledger row deferred (landed later as D-35); 🧭 7-fork: D-44 doctrine stated one turn after handoff, survived only via manual relay, still "confirmation pending"; 🧭 8 + 🧭 9 both hit the session limit mid-exchange | 2 self-healed, 1 unconfirmed |
| D | **Uncommitted at death** | 8 o40 sitreps `2026-09-05T00:15:00Z-*` untracked in lowcap `coordinator/inbox/` right now, plus committed `…21:24:00Z-o40-N3.md` deleted in the working tree; no run since | 8 in flight |
| E | **Archive is a black hole** — filed-correctly sitreps archived wrong-owner (5, run b2645fe6) or "withdrawn/superseded" (33, run 54600111, no operator word) are never re-read | Lost from board: every root-cause diagnosis (RSC 1e8x, connect-timeout storm, raydium tie manufacture, `.take(4)` starvation), the ONLY `ruled_out` line in the archive, all worker→commit attributions for trains 76–77.1, train 76/76.1 SHAs, XYZ-2014, the 0a1d1fef refusal record | 38 sitreps; facts survive only where a D-row independently re-recorded them |
| F | **Paraphrase accepted silently** | D-31 "14 Astra + 6 Claude" is the portal's reading of a cut-off line "20 workers 14"; D-23 relayed by O39, never confirmed | 2 |
| G | **The forbidden handoff doc** — design rule 2 says "no handoff doc, the boot bundle is the handoff". In practice 🧭 6 committed `portal-state-2026-09-04.md` titled "everything that lived only in chat" (c4502d8), 🧭 7 superseded it; it lives in the FLEET repo on `agent-zachary`, not in the live instance, and holds 7 open operator items while `board.operator_queue` is `[]` | rule failed; compensated ad hoc, in the wrong repo | 7 items off-board |
| H | 9 lanes lived only in chat for ~19 h (🧭 1) until the operator asked "is everything stored?" | produced D-7 | near miss |

Explicit operator rulings: essentially all captured (D-6..D-45 trace to a same-turn commit).
Fresh-read rule: held in every session; no answer from memory found.
Restatement forced on the operator: once (A). Everything else the record got, it got because the
operator or a successor portal re-said it — not because the mechanism caught it.

## 3. Why: the two leak classes CCIR does not name

CCIR v1 covers lane/train/blocker/done/ruling/dispute/drift/alive. The losses fall in two classes it
lacks:

- **P1 — operator priority, concern, preference** ("I'm mainly worried about…", "I want…").
- **P2 — an open question waiting on the operator** (the portal-state "Open on the operator" list).

Plus one procedural class: **a statement received after the portal lost write authority** (C).

## 4. Making it bulletproof — the question, asked mechanically

The operator's intuition is right: the CCIR list is already the question; nobody asks it. Ask it
with hooks, gated on the 🧭 badge exactly like the session-kind hooks.

1. **UserPromptSubmit hook** (the question). Injects, every operator turn: "Classify this turn:
   CCIR 1–8, P1, P2, question, none. Anything but question/none is filed BEFORE you answer
   (Linear ID, sitrep, D-row, or `operator_queue`), and one row goes to
   `coordinator/.portal-ledger/<session>.jsonl` `{ts, class, artefact}`."
2. **Stop hook** (the enforcement). Blocks the turn from ending when (a) the ledger has no row
   for the latest operator turn, (b) `git status --porcelain coordinator/` is non-empty, or
   (c) a `.closed` marker exists for this portal (handed off → answer only "type in 🧭 N+1").
   The block reason names the missing item. This is D-1's hard-gate ruling applied to the
   portal's write path. A session-limit death still skips hooks, but (b) means at most one turn
   is ever at risk.
3. **CCIR v2**: add P1 and P2. P2's canonical home is `board.operator_queue` (exists, empty).
   Retire `portal-state-*.md` into it; a portal-state note in another repo is exactly the
   "chat is the record" failure with a file extension.
4. **Archive keeps facts**: when a run archives a sitrep, copy its `delta` and `ruled_out` verbatim
   to an append-only `coordinator/facts.md` (or a lane `archived_facts` list). Archived sitreps
   lose *state authority*, never *facts*. 38 sitreps today say otherwise.
5. **Confirmation lifecycle**: a D-row "flagged for confirmation" gets a `confirm_by`; the Stop
   hook nags until the operator's word lands or the row is marked unconfirmed-expired.

Cost: two small Python hooks + one settings stanza + a README edit. No change to the run, the
board schema, or the API.

## 5. Immediate housekeeping (before any of the above)

- Drain and commit the 8 o40 sitreps in lowcap `coordinator/inbox/` (mechanism D).
- Confirm or correct D-23, D-31, D-44 (mechanism F/C).
- Move the 7 "Open on the operator" items from `portal-state-2026-09-05.md` into
  `board.operator_queue` (mechanism G).

Sources: transcripts under `~/.claude/projects/-Users-misterislez-projects-lowcap-connector--claude-worktrees-{sweet-kare-868778,portal-4cbecd,portal-6e907d,portal-coordinator-continue-54c0fb,pool-sourcing-election-map-b71c5d,reverent-lalande-ba8b41,portal-coordinator-launch-227f33,gifted-tereshkova-f6d0d6}/`; lowcap `coordinator/` at `d97ac99d`; fleet `coordinator/portal-state-2026-09-05.md` at `db759a1`.
