# Lane 1 — backend lease / reaper / fencing (Edith · backend-developer)

**Goal (one line):** implement `CONTRACT.md` in `server.js` + `fleet.db` schema, so
fleetdeck *owns* session lifecycle: leases with epochs, a CAS-guarded two-phase reaper,
and fenced seats — provably avoiding the 15 named mission-control defects.

## Scope

**In:** `server.js`, schema migration, the reaper loop, unit/integration tests, test
fixtures (a fake host poller is fine). Lift-as-code sources listed in
`HANDOFF-XYZ-1742-orgchart.md` §6 (re-clone mission-control/agent-deck shallow if useful —
fix the named bugs in anything lifted).
**Out:** hooks/pingers (Lane 2), any UI (Lane 3), the operator's live deck + its
`fleet.db`, `keys.html`/cert/train code, changing the contract.

## Acceptance (operator decision: M16 option b)

1. Every **M1–M17** amendment in `AUDIT-XYZ-1742-lane1.md` implemented, each with the
   test named in its clause passing. S1–S7 implemented or a one-line documented reason.
2. The **15 named defects** (audit coverage table rows 1–15) each mapped to a passing
   test or a written "prevented-by-construction" note in your report.
3. Existing behavior intact: `sessions()` merge, registry upsert/delete validation,
   `/api/kill`, both listeners' route split — old rows in a copied `fleet.db` survive
   boot twice (M10 test).
4. `npm start` on a fresh checkout + on a copy of a populated `fleet.db` both boot clean.

## Milestones (commit + Linear checkpoint each)

- **A** schema migration + pragmas + backup (M9, M10, S4)
- **B** lease-claim + heartbeat endpoints, mounted per contract (M1, M2, S1, S7)
- **C** seats + fencing of privileged writes + tailnet bearer key (M13, M17, S3)
- **D** reaper: CAS transitions, two-phase warn, second sample, cascade guard, boot/clock
  grace, observability, retention (M3–M7, M14, M15, S5)
- **E** parent edge + read contract for Lane 3 (M11, M12, S6)
- **F** defect-map test sweep + report → `docs/goals/xyz-1742-fleet-lifecycle/reports/edith.md`

## Conditions

- Reaper kills in tests target **your own throwaway tmux sessions on the box** (prefix
  `EDITH-T-`), never `FD-*`/`LC-*` sessions and never over ssh to another host.
- `name.py` calls in the reap path: mock in tests (the real registry lives on the Mac —
  ship the call behind a config flag Lane 2/ops can point at the Mac later).
- Zero-quote rule for any ssh/tmux payloads (server.js:95-99).
- Riskiest known traps: wall-clock vs monotonic (M7), awaits inside transactions (M3),
  reap ordering (M4). Re-read those three before writing the reaper.
