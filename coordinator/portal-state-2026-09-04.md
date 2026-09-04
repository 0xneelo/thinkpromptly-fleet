# Portal state — 🧭 COORDINATOR 6, written 2026-09-04 ~20:40Z

The only knowledge that lived in the portal chat and not in the ledger, inbox, or Linear. A
successor portal reads this after board.json + decisions-effective.md (D-1 gate), then deletes
or supersedes it. D-7: context is stored mid-transit, never only in chat.

## Open on the operator (as of writing)
1. CoinGecko `/key` monthly credit number → XYZ-1697 (route ruled: operator reads, seat PUTs).
2. Family-system sheet, 9 cards (Fridolin XYZ-2013) — artifact f8b04b84, durable copy
   `docs/research/unblock-sheets/family-system-unblock-2026-09-04.html`. Paste JSON to the portal.
3. Lioba's 3 cards from the XYZ-2024 revert — in the O39→O40 handoff (`docs/goals/HANDOFF-2026-09-04-o39-to-o40.md` on lowcap-connector main).
4. Five orchestrator briefs not yet booted: `docs/goals/round3-orchestrator-briefs-2026-09-04/` (ivy, onboarding-app, symm-treasury, search-book, fleet-tooling). Inputs they will ask: two dates (Postgres cutover, SYN-200 flip), WIK-22/40/70 keepers, Promptly repo + VPS SSH.
5. DECK-23 (notify false delivered) and DECK-24 (ghtoken broker 502 flaps) — filed, unowned until the fleet orchestrator boots.
6. Dead "In Progress" lowcap issues with no live worker (XYZ-1567, 1922, 1924, 1990, 1991, 1789, 1961): cancel-with-revive or re-mint under D-15 by Sunday 09-06.
7. ~40 dead german-box registry rows still labelled active (`/clean-german-box`, a seat action).

## Open on the lowcap seat (O40 = 🎛 ORCHESTRATOR 5, session local_c82fcf80-438a-4579-b2c0-2dd83f019d71)
- 77.1 (`c1c88d69`) acceptance read on 56/8453 → XYZ-2029; then XYZ-2028 closes.
- Hiltrud XYZ-2027 FINAL on review HOLD → 77.2. Alaric XYZ-2026 worker-complete; CUTOVER = Saturday 09-05 with a booted fleet seat (recorded on XYZ-2026); fleet inbox stays live until then.
- Queue after 77.1: XYZ-2027 → XYZ-2026 → D-26 lane (XYZ-963+929) → D-27 lane (XYZ-1349) → hygiene → riders; cg_wrong LAST (D-22).

## Coordinator mechanics
- Ledger lives on branch `agent-zachary` of the fleet repo (not main). Push after every ledger session with the broker recipe (`/how-to-fleet-git`); merging to main is the fleet orchestrator's call.
- Run at 21:33:43Z applies the untracked inbox sitreps (51 files at writing, o39 + o40). Bundle gate ~94%: sitreps stay one line. Push again after the run commit.
- Portal seat delivery: use `SendMessage` / `mcp__ccd_session_mgmt__send_message`; deck notify to seats is broken (DECK-23).
- D-30: all GPT lanes/hunters = `gpt-6-astra` high/xhigh; box launcher Codex 0.153.3, Mac 0.153.2.
