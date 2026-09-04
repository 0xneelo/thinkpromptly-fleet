# Brief for the onboarding-app orchestrator — round-3 rulings (2026-09-04)
From 🧭 COORDINATOR 6 (lowcap coordinator portal). Repo: `~/projects/onboarding-app`. Team: VIB.

## Rulings (choice → effect)
- **VIB-4 · VIB-10 · VIB-14 · VIB-164 Postgres Road-to-Production** → **Schedule the cutover sitting**. The note field was EMPTY: the operator did not say when. First action: ask the operator for the date, then turn the rehearsed runbook into a scheduled op with a checklist. Do not retire.
- **VIB-80 SYN-200 closeout (deploy + VOLUME_SOURCE flip to subgraph)** → **Still wanted**. Note EMPTY: ask the operator when; then it becomes a scheduled prod op with a checklist.
- **VIB-239 · VIB-299 Inventory API v1/v2** → **Park both**: close as "parked on external", reopen the day the Vibe inventory team replies.
- **VIB-324 wallet-login verifier upgrades (ERC-1271/6492 + SIWE)** → **Defer + close**: re-file as part of wallet-login enablement when that day comes.

## Open input needed from the operator
Two dates: the Postgres cutover sitting and the SYN-200 flip. Ask once, in one message.

## First actions (in this order)
1. Boot as this project's local orchestrator: `/local-orchestrator`, then end your first reply with the `/rename 🎛 ORCHESTRATOR <N> · onboarding-app · round-3 rulings` line.
2. Register EVERY ruling above as a Linear comment on its issue, titled `Operator ruling 2026-09-04 (unblock sheet, round 3)`, choice + note verbatim. Linear is the record; chat is not.
3. Apply the state the ruling implies (close / cancel / park) on the same pass.
4. For build items: package with `/introduce-goal` and launch on the german-box via `/german-box-workers`. The box is shared with lowcap-connector (11 lanes live at 11:00Z on 2026-09-04) — check capacity before minting.
5. Doctrine D-15: a task is done this week (by Sunday 2026-09-07) or cancelled. Priorities are not a queue.
6. Report completion to the coordinator portal `🧭 COORDINATOR 6` with `SendMessage` (or `mcp__ccd_session_mgmt__send_message`). Do NOT use deck notify for desktop seats — it reports delivered without rendering (DECK-23).

## Hard rules
- One project only: this repo. Forward anything else to its own orchestrator.
- Never edit source, never spawn builders, never touch prod without the operator's word.
