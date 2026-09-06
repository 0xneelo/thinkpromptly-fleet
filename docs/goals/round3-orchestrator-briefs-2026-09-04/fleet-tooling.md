# Brief for the fleet orchestrator (remote-system) — round-3 rulings (2026-09-04)
From 🧭 COORDINATOR 6 (lowcap coordinator portal). Repo: `~/remote-system`. Teams: VIB (tooling items), DECK.

## Rulings (choice → effect)
- **VIB-192 SessionStart hook auto-loads /cost-aware** → **Build the hook anyway** (belt-and-suspenders enforcement via settings.json, even though the global CLAUDE.md already carries the delegation rules).
- **VIB-210 linear-handoff wiring** → **Finish the wiring**: a box session clones the canonical repo into WSL and reconciles improved-handoff.
- **SYN-144 hosted-Promptly roadmap (root gate)** → **Revive — provision SSH now**. Operator action first: VPS deploy access for the Promptly chain (DNS, Stripe, APNS, Resend, Linear OAuth…). The Promptly product repo is not under `~/projects` on this Mac — ask the operator where it lives, then hand the chain to that repo's orchestrator; you only own the SSH bootstrap gate.

## Also open on the fleet side (not from the sheet)
- **DECK-23** deck notify to a desktop seat reports delivered:true but never renders — filed 2026-09-04, medium, this week or cancel.
- **DECK-11** board root instance-aware — now needed by **XYZ-2026** (D-25: the lowcap coordinator instance moves into lowcap-connector by 2026-09-07). Coordinate the deck root change with the lowcap orchestrator (🎛 ORCHESTRATOR 5).

## First actions (in this order)
1. Boot as this project's local orchestrator: `/local-orchestrator`, then end your first reply with the `/rename 🎛 ORCHESTRATOR <N> · remote-system · round-3 rulings` line.
2. Register EVERY ruling above as a Linear comment on its issue, titled `Operator ruling 2026-09-04 (unblock sheet, round 3)`, choice + note verbatim. Linear is the record; chat is not.
3. Apply the state the ruling implies (close / cancel / park) on the same pass.
4. For build items: package with `/introduce-goal` and launch on the german-box via `/german-box-workers`. The box is shared with lowcap-connector (11 lanes live at 11:00Z on 2026-09-04) — check capacity before minting.
5. Doctrine D-15: a task is done this week (by Sunday 2026-09-07) or cancelled. Priorities are not a queue.
6. Report completion to the coordinator portal `🧭 COORDINATOR 6` with `SendMessage` (or `mcp__ccd_session_mgmt__send_message`). Do NOT use deck notify for desktop seats — it reports delivered without rendering (DECK-23).

## Hard rules
- One project only: this repo. Forward anything else to its own orchestrator.
- Never edit source, never spawn builders, never touch prod without the operator's word.
