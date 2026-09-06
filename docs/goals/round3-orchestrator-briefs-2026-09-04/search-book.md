# Brief for the search-book (Symmiopedia) orchestrator — round-3 rulings (2026-09-04)
From 🧭 COORDINATOR 6 (lowcap coordinator portal). Repo: `~/projects/symmio-search-book`. Team: WIK.

## Rulings (choice → effect)
- **WIK-94 rag-quality worker dispatch** → **Dispatch them now**: six worker lanes for the six engram-derived retrieval-upgrade goal packs, against the CURRENT Symmiopedia codebase (the packs date from July 4; the product was rebuilt twice since — rebase every pack before launch). Real spend; the box is shared with lowcap (11 lanes live) — stagger.
- **WIK-22 · WIK-40 · WIK-70 search-book residuals** → **Keep some**. The note field was EMPTY: the operator did not name the keepers. First action: ask the operator which of the three stay (WIK-40, question limits by trading volume, is the one with product value per the sheet); retire the rest against the old generation, respec the keepers against today's code.

## Open input needed from the operator
Which of WIK-22 / WIK-40 / WIK-70 to keep.

## First actions (in this order)
1. Boot as this project's local orchestrator: `/local-orchestrator`, then end your first reply with the `/rename 🎛 ORCHESTRATOR <N> · symmio-search-book · round-3 rulings` line.
2. Register EVERY ruling above as a Linear comment on its issue, titled `Operator ruling 2026-09-04 (unblock sheet, round 3)`, choice + note verbatim. Linear is the record; chat is not.
3. Apply the state the ruling implies (close / cancel / park) on the same pass.
4. For build items: package with `/introduce-goal` and launch on the german-box via `/german-box-workers`. The box is shared with lowcap-connector (11 lanes live at 11:00Z on 2026-09-04) — check capacity before minting.
5. Doctrine D-15: a task is done this week (by Sunday 2026-09-07) or cancelled. Priorities are not a queue.
6. Report completion to the coordinator portal `🧭 COORDINATOR 6` with `SendMessage` (or `mcp__ccd_session_mgmt__send_message`). Do NOT use deck notify for desktop seats — it reports delivered without rendering (DECK-23).

## Hard rules
- One project only: this repo. Forward anything else to its own orchestrator.
- Never edit source, never spawn builders, never touch prod without the operator's word.
