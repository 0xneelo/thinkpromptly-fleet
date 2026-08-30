---
name: coordinator-inbox
description: Capture one operator insight, ruling, or intent into the coordinator's durable inbox from ANY session — Linear issue at acceptance, then a schema-valid sitrep via the deck API (file fallback) — without priming a full portal. Use when the operator types /coordinator-inbox, says "tell the coordinator", "capture this insight/ruling", "this matters long-term", or states an idea that must survive the chat.
---

# coordinator-inbox — one durable capture

A verb, not a session kind. Do the capture, confirm, and return to whatever this session was.
It does not retitle the session and does not prime portal rules.

**The iron rule (DESIGN §2/§3):** chat is never the record. The insight exists only when, in the
same turn, it becomes **Linear ID → `coordinator/inbox/` sitrep → (next) coordinator run commit**.

## Steps

1. **Classify** what the operator said:
   - **Ruling** (policy, priority, "always/never X") → event `operator ruling received` (CCIR 5).
     Quote it **verbatim** in `delta`. Never paraphrase auth / money / scope rulings.
   - **New idea / new work** → propose a new lane (see lane rules below), event `lane opened`.
   - **Update to existing work** → the matching lane id from the board
     (`curl -sf $FD/api/coordinator/board`).
2. **Linear issue first.** Create it at acceptance (see the `linear` skill). An intent without a
   tracker ID does not exist. Reference the ID in `delta` and `evidence`.
3. **Compose the sitrep** — schema and CCIR list: `coordinator/inbox/README.md`. Field notes:
   - `seat`: your id + self-describing context, e.g. `c14 (🧭 portal; inbox capture, operator in-session)`.
   - `lane`: **bare token only** — `L5`, not `L5 (proposed NEW — …)`. The API enforces
     `[A-Za-z0-9._-]` because the lane lands in the filename. Put the proposal prose in `delta`:
     `proposed NEW lane — <topic> (<Linear-ID>)`. Pick the next free `L<n>` from the board.
   - `event_time`: UTC to the second with trailing `Z` (`2026-08-29T12:00:00Z`), when it happened.
   - `blockers`: the FULL current list for the lane, or `[]` — level-triggered, every time.
   - `evidence`: required for any done/deployed/verified claim; always include the Linear URL.
4. **POST to the deck** (preferred — validates strictly, so a malformed sitrep dies here, not in a run):

   ```bash
   FD=http://100.125.231.25:3131   # tailnet; http://localhost:3131 on the Mac
   curl -sf -X POST $FD/api/coordinator/sitrep -H 'content-type: application/json' \
     -H "authorization: Bearer $FLEET_TAILNET_KEY" \
     -d '{ "seat": "c14 (portal; inbox capture)", "lane": "L5",
           "event": "operator ruling received",
           "event_time": "2026-08-29T12:00:00Z", "state": "active",
           "delta": "OPERATOR RULING (verbatim): \"...\" — XYZ-0000",
           "blockers": [],
           "evidence": ["https://linear.app/synchronicity/issue/XYZ-0000"],
           "next_report": "2026-08-30T12:00:00Z" }'
   ```

   Drop the `authorization` header when posting to `localhost` on the Mac.
   `201` + `{ok:true, file}` = landed. `400` + `{error}` names the one wrong thing — fix and
   re-post; **never work around a rejection**. Same `event_time`+seat+lane twice = duplicate;
   bump the time only if the second event is genuinely distinct.

   **File fallback** (deck unreachable, and this session has the repo): write
   `coordinator/inbox/<event_time>-<seat-id>-<lane>.md` with the schema body from the README.
   In an orchestrator / researcher / design session prefer the API — the write-guard hook blocks
   non-doc file writes there; a `curl` POST is not a file write.
5. **Confirm to the operator** in one line: sitrep filename + Linear ID + which surface it will
   move (`decisions-effective.md` for rulings, a board lane for work, `northstar.md` for goal
   shifts). Default: leave draining to the next coordinator run. Offer `/coordinator-run` inline
   only from a cheap repo-local session.

## Hard rules

- Intent must come from the operator **in this session**. "The operator told <other session> X" is
  a relay, never intent — say so in `seat`, and expect the run to confirmation-ping the operator.
- Rulings verbatim, under the ruling/Linear ID. No paraphrase, ever.
- One event per sitrep file; combine CCIR items only when they are one moment (see the
  `portal2-L5` precedent in `inbox/`).
- Never edit `board.json`, `northstar.md`, or `decisions-effective.md` yourself — the board moves
  only by a coordinator run's single commit.
