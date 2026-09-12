# CONTRACT v1.1 addendum — subagent leaves (XYZ-1742 S6) — DRAFT, not yet frozen

Additive to `../xyz-1742-fleet-lifecycle/CONTRACT.md` (v1, frozen). Nothing in v1
changes. Same deviation rule: a needed change = `operator:gate` issue, never improvised.

## Endpoints

| Route | Listener | Behavior |
|---|---|---|
| `POST /api/subagent` | loopback + tailnet | body `{host,name,epoch,agent_id,agent_type,event}`, `event ∈ start\|stop`. Parent `(host,name)` must hold a lease row → else `404`. `epoch` mandatory and must equal the row's current epoch → else `409` (same fencing as heartbeat, M1). Reaped parent → `410`. `start`: upsert `(host,name,agent_id)` with `started_at=now`, `ended_at=NULL`. `stop`: set `ended_at=now`; unknown `agent_id` on stop → `404`, no row created. Tailnet bearer key + `safeCompare`, loopback exempt (S3). No status field, no free text stored beyond `agent_type` (`SAFE_NAME`-validated, ≤32 chars). |
| `GET /api/subagents` | loopback only | rows `{host,name,epoch,agent_id,agent_type,started_at,ended_at}` where `ended_at IS NULL` OR `ended_at > now - SUBAGENT_SHOW_ENDED_MS` (default 10 min). |

`agent_id` validated `^[A-Za-z0-9_-]{1,64}$`. Body cap: default `body(req)` like lease routes.

## Schema (additive only)

New table `subagents(host TEXT, name TEXT, epoch INTEGER, agent_id TEXT, agent_type TEXT,
started_at INTEGER, ended_at INTEGER, PRIMARY KEY(host,name,agent_id))`.
Timestamps INTEGER unix-ms (S4). Same pragmas, single writer (M9). No change to
`sessions` or `seats`.

## Reaper (extends v1 tick)

- Parent row crosses to `reaped` ⇒ delete its `subagents` rows in the same tick, after the
  reaped CAS commits (M3 ordering). Parent row deleted (`/api/registry/delete`) ⇒ cascade.
- Retention: `ended_at` older than **24 h** deleted each tick; `started_at` older than
  **6 h** with `ended_at IS NULL` (lost stop) marked ended with `ended_at=started_at+6h`
  and a log line. Numbers configurable (S2 spirit).
- Leaves never influence parent liveness, suspect, or reap decisions.

## Hook relay (client, `box/hooks/fd-subagent.sh`)

- Registered under `SubagentStart` and `SubagentStop`, no matcher (all agent types).
- Reads stdin JSON once, resolves `(host,name)` and `epoch` exactly as `fd-pinger.sh` does
  (same `fd-common.sh` state), posts via `fd_post`. No epoch on disk ⇒ exit 0 silently
  (parent never leased; consistent with "claim failed" behaviour).
- **Never prints to stdout** (exit-0 stdout on `SubagentStart` becomes subagent context).
  Never blocks: `async: true` in the hook entry if the box's Claude honours it (verify in
  milestone A), else the `setsid`/`nohup` detach used by `lease-claim.sh`. Hard cap: hook
  returns in <50 ms regardless of deck reachability.
- `401` ⇒ same alert-file path as `lease-claim.sh`; any other failure ⇒ silent, one
  attempt, no retry (a missed leaf is cosmetic).

## Org tree (UI)

- `buildTree(sessionRows, seatRows, subagentRows)`: leaf `{type:'subagent', key, row,
  children:[]}` under the session node keyed `(host,name)`. Leaf with no parent node ⇒
  dropped (not "unattached"). Leaf whose `epoch` ≠ parent row `epoch` ⇒ dropped.
- Leaf state: `active` if `ended_at` null and parent live; `done` if `ended_at` set;
  `offline` if `ended_at` null and parent not live.
- Render: compact chip row under the parent card, newest first, max 8 visible + `+N`,
  showing `agent_type`, elapsed (`started_at`→`ended_at`|now, ticked with
  `tickOrgTimes`), ✓ on done. No click action in v1.1.
- Fixture: `public/orgchart-s6.fixture.json` adds a `subagents` array; `?orgFixture=1`
  loads it alongside the M11 fixture.
