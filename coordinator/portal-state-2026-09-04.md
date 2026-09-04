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

## Short-term roadmap (next 48 h, written 2026-09-04 ~20:50Z, Cyprus = UTC+3)
| when | what lands | who | gate |
|---|---|---|---|
| Fri night | 77.1 acceptance FAILED on 56/8453 (improved, not cured); prod stays `c1c88d69` | O40 | none |
| Fri 21:33Z | coordinator run applies 51 sitreps → board.json catches up to train 77 | run | bundle ≤ 8192 B |
| Fri night / Sat | Ignaz round 2 (head_tracking Alchemy dial) + Hiltrud HOLD fix → **train 77.2** | O40 | operator word "deploy 77.2" |
| Sat morning | XYZ-2026 cutover: fleet steps A2–A5 (merge 4638804f with review, arm COORDINATOR_INSTANCE_ROOT, cleanup, DECK-11) then lowcap ff + inbox move | fleet orchestrator (boot it: brief `fleet-tooling.md`) + O40 | fleet seat booted |
| Sat | family-system rulings → XYZ-2013 lanes (shadow first, two rotations) | O40 | sheet JSON pasted |
| Sat | five other orchestrators booted with the round-3 briefs | operator | — |
| Sun 09-06 | D-15 week end: dead In-Progress issues cancelled or re-minted; DECK-23/24 done or cancelled | seats | — |
| Mon 09-07 | XYZ-2026 due; D-26 request-lane + D-27 start-modes lanes start as slots free | O40 | cap |
| last | cg_wrong 80 verification (D-22) | — | every other lane closed |

## Open questions for the operator (answer in the next portal)
1. Family-system sheet — 9 cards, artifact f8b04b84 (durable HTML in docs/research/unblock-sheets/). Card 7 (breaker_evidence) is the standing policy AFTER 77; "ship it" already covered 77.
2. Lioba's 3 cards (XYZ-2024 revert) — in the O39→O40 handoff on lowcap main.
3. CoinGecko `/key` monthly credit number → XYZ-1697.
4. Dates: Postgres cutover sitting (VIB-4/10/14/164) and SYN-200 flip (VIB-80).
5. WIK-22 / 40 / 70 keepers (search-book).
6. Promptly repo location + VPS SSH (SYN-144 revive).
7. Board-move cutover: Saturday (recommended, recorded) or tonight?
8. The ~40 dead box registry rows: run `/clean-german-box` (seat) — yes/no.

## Portal 6 closed
2026-09-04 ~20:55Z on the operator's word "close"; the operator opened the successor portal
before closing this one. Successor: read board.json → decisions-effective.md → this file → the
21:33Z run's commit; push `agent-zachary` after the run.
