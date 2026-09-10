# Orchestrator seats per project — decision note

Date: 2026-09-10. Author: **Ysolde · backend-developer** (`agent-ysolde`).
Project: **remote-system / fleetdeck-notify**. Reference: **PENDING-M4**.
Labels: `operator:decision`, `project:remote-system`, `subproject:fleetdeck-notify`,
`agent:ysolde`, `session:cli-worker`. Status: **awaiting operator decision**.
This milestone is documentation only; it does not authorize a migration or change fencing.

## Current behavior

`server.js:188` defines one `seats` row per seat name; `server.js:261` admits only
`orchestrator` and `coordinator`. `seatClaim()` overwrites the owner of that named
row. `nextSeatEpoch` deliberately allocates epochs across both seats because
`seatLive` / `fenceCheck()` (`server.js:414–486`) validate an epoch without a project.
Registry writes consult that fence (`server.js:3078–3104`).

`FLEET_FENCE=bootstrap` is the default, but it does **not** disable fencing once a
seat has been claimed: only an empty seats table bypasses the check. The operator's
allowed-origin browser is exempt; tailnet writes use their existing bearer gate.
Those are distinct authority boundaries and should stay explicit in any future design.

M2 resolves an app title before CLI name and then the shared orchestrator owner
(`server.js:3187–3255`). A successfully titled project seat therefore needs no lease
fallback for messaging. The fallback remains for compatibility: an unmatched project
alias can still select the shared owner. App titles locate conversations; they do not
grant project-scoped registry authority.

## Options

| Option | Benefit | Cost and remaining limitation |
|---|---|---|
| **(a) Keep the single shared seat** | No schema/API changes; titled conversations are addressable after M2. | One orchestrator claim still replaces another project's owner. Bootstrap only bypasses the fence before any claim. The compatibility fallback remains cross-project. |
| **(b) Use `orchestrator:<project>` seat IDs, per-project epochs and a project-keyed fence** | Independent ownership and revocation per project; a fallback can select the requested project's owner. | Requires a defined project identity, migration, claim/renewal API changes, caller rollout and project checks on every fenced mutation. Numeric epoch alone becomes insufficient. |
| **(c) Keep the seat ID and add `owner_project`** | Makes the current owner's project visible and can prevent a mismatched alias fallback. | Still one owner: a new project replaces the previous one. Merely adding a column provides no isolation unless every authority check uses it; it does not solve concurrent project seats. |

## Recommendation

Choose **(b)** for a separately authorized follow-up if the fleet is to support
independent project orchestrators. It directly addresses shared ownership; (c) adds
metadata without removing that constraint, and (a) leaves it in place. No such
implementation is part of notify-seat-aliases.

Before implementing (b), the operator must approve a canonical project identifier
and how registry rows acquire it. Every privileged mutation must bind the requested
seat/project and epoch to the affected row's project. Per-project counters must never
be paired with today's epoch-only query: two projects could then both hold epoch 1.
The rollout must define legacy claims, coordinator authority, tailnet behavior and
what an unmatched project alias returns, rather than silently inheriting another owner.
Tests should prove that claiming project A cannot revoke B, and that A's epoch cannot
mutate B's rows, including equal numeric epochs and expired/reclaimed owners.

Operator action requested: choose (a), (b), or (c). Until that decision is implemented
under its own scope, the existing seats schema, fallback and fence remain as shipped.

Signed: **Ysolde**
