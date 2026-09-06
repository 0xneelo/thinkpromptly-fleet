# Portal state — 🧭 COORDINATOR 7, written 2026-09-04T21:20Z (Sat 09-05 00:20 Cyprus)

Supersedes `portal-state-2026-09-04.md` (🧭 6, commit 472c9ad — its 48 h table is in git history).
A successor portal reads this after board.json + decisions-effective.md, then supersedes it (D-7).

## Open on the operator
1. DECK-25 (A/B/C): the 8192 B gate holds 11 lanes only with one-line sitreps (run 2 sits at 95%). A = raise to 12288 B, recommended.
2. Word "deploy 77.2" once the candidate is FINAL (L78 sitrep names candidate b11a699a; Ignaz XYZ-2029 round 2 in it).
3. Sign-off on `docs/goals/node-ws-cut-step1/GOAL.md` (lane L2 blocker).
4. Family-system 9 cards (XYZ-2013, artifact f8b04b84) + Lioba's 3 cards (O39→O40 handoff).
5. CoinGecko `/key` monthly number → XYZ-1697.
6. Boot the fleet orchestrator (`docs/goals/round3-orchestrator-briefs-2026-09-04/fleet-tooling.md`) for DECK-11 + the agent-zachary→main merge; 4 more briefs; 2 dates (Postgres cutover, SYN-200 flip).
7. DECK-23/24 unowned; ~40 dead box registry rows (`/clean-german-box`); dead In-Progress issues XYZ-1567/1922/1924/1990/1991/1789/1961 → cancel or re-mint by Sun 09-06 (D-15).

## Open on the lowcap seat (O40 = 🎛 ORCHESTRATOR 5, session local_c82fcf80-438a-4579-b2c0-2dd83f019d71)
- XYZ-2026 cutover steps B + C after a run commit — run 2 = `78c3f53`, go (operator word "cutover after the run, go ahead", 20:47Z).
- Train 77.2 = Ignaz XYZ-2029 R2 + Hiltrud XYZ-2027 (review SHIP). Queue after: D-26 (XYZ-963 + XYZ-929) → D-27 (XYZ-1349) → hygiene → riders; cg_wrong LAST (D-22).

## Coordinator mechanics
- Run 2 = `78c3f53` at 2026-09-04T21:17:32Z: 11 applied (o40 one-liners, event_time 21:12:00Z), 33 archived (o39 sitreps withdrawn by the owner seat o40, superseded; flags + provenance in `inbox/archive/`), 0 rejected; bundle 7819 B (95%); `.seat-ack/o40` written; seat rotation O38→o40 recorded on L1/L2/L3/L6/L9/N3.
- Rule learned: with 11 live lanes, only one-line sitreps (delta ≤ 120 chars, one evidence link) fit the gate; evidence accumulates, so keep the newest few. Always preview: build the drained board in memory and gate it with `bundle.build` before touching a file.
- Next run due 2026-09-05T21:33:43Z. No timer exists — a portal runs it inline. Ledger on `agent-zachary`; push after every ledger session (broker recipe, `/how-to-fleet-git`).
- 48 h roadmap artifact: https://claude.ai/code/artifact/9ed15709-86b0-4cd7-972d-86e425317830

## XYZ-2026 cutover — fleet side A (state at 2026-09-04T21:27Z)
- A1 push: done (agent-zachary at origin = 8b23661+).
- A2 merge of `agent-alaric-xyz-2026` @ 4638804f into agent-zachary: **OPEN for the fleet orchestrator** — needs a merge commit (parent 93e1d49). The portal did not merge code. Diff reviewed: `COORDINATOR_INSTANCE_ROOT` env redirects board path + runlog inbox; fixture default unchanged; selftest PASS (59 assertions) from the worktree.
- A3 arming recipe (no merge needed): detached tooling worktree `~/remote-system/.claude/worktrees/xyz-2026-tooling-4638804f`; run every tool as
  `COORDINATOR_INSTANCE_ROOT=/Users/misterislez/projects/lowcap-connector/coordinator python3 <worktree>/coordinator/{check,bundle,runlog}.py`.
  Verified against a scratch copy of the run-2 instance: check.py OK (7819 B, 95%), bundle --size OK, runlog inbox redirected.
- A3 pre-conditions still open on the lowcap seat (O40): (a) lowcap main SHA with `coordinator/` landed (its B3); (b) that SHA fast-forwarded into the Mac main checkout `/Users/misterislez/projects/lowcap-connector` (on main at accd0264 2026-08-31, 6 dirty entries not ours). Then the portal runs check.py against the real root and sends "ARMED <sha>"; only then C (inbox move). Fleet inbox stays live until that line.
- **A3 DONE — ARMED fcf22617 (2026-09-04T21:32Z).** Instance root = `/Users/misterislez/projects/lowcap-connector/coordinator` on lowcap main fcf22617 (imported with history by Alaric dda7940e; blobs identical to agent-zachary@8b23661; run-2 commit = 54600111 in lowcap history). check.py OK 7819 B (95%) from the 4638804f worktree. The seat executes C (moves the one in-flight sitrep `2026-09-04T21:24:00Z-o40-N3.md`); after C the fleet inbox `~/remote-system/coordinator/inbox/` is CLOSED — do not write here. Next run 2026-09-05T21:33:43Z runs against the lowcap root; the portal is repo-local in lowcap-connector from here (D-25). A4 cleanup on agent-zachary must not remove anything before the seat confirms C.
- A4 fleet cleanup commit and A5 (DECK-11 / FLEET_COORDINATOR_DIR restart): after A3 is confirmed; fleet orchestrator + operator.

## Portal 7: open
