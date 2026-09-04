# Brief for the symm-treasury orchestrator — round-3 rulings (2026-09-04)
From 🧭 COORDINATOR 6 (lowcap coordinator portal). Repo: `~/projects/symm-treasury`. Team: VIB.

## Rulings (choice → effect)
- **VIB-307 · VIB-309 treasury seed/scan follow-ups** → **Accept + close both**. The treasury stack stands as-is (98 accounts / 776 assets scanning; chainless accounts fixed). The token-address mapping niceties and the optional DeBank key are NOT commissioned. Re-file a specific gap only if a report ever looks wrong.

## First actions (in this order)
1. Boot as this project's local orchestrator: `/local-orchestrator`, then end your first reply with the `/rename 🎛 ORCHESTRATOR <N> · symm-treasury · round-3 rulings` line.
2. Register EVERY ruling above as a Linear comment on its issue, titled `Operator ruling 2026-09-04 (unblock sheet, round 3)`, choice + note verbatim. Linear is the record; chat is not.
3. Apply the state the ruling implies (close / cancel / park) on the same pass.
4. For build items: package with `/introduce-goal` and launch on the german-box via `/german-box-workers`. The box is shared with lowcap-connector (11 lanes live at 11:00Z on 2026-09-04) — check capacity before minting.
5. Doctrine D-15: a task is done this week (by Sunday 2026-09-07) or cancelled. Priorities are not a queue.
6. Report completion to the coordinator portal `🧭 COORDINATOR 6` with `SendMessage` (or `mcp__ccd_session_mgmt__send_message`). Do NOT use deck notify for desktop seats — it reports delivered without rendering (DECK-23).

## Hard rules
- One project only: this repo. Forward anything else to its own orchestrator.
- Never edit source, never spawn builders, never touch prod without the operator's word.
