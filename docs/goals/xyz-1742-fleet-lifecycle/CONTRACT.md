# CONTRACT v1 — fleet lifecycle backend (XYZ-1742) — FROZEN 2026-08-27

All three lanes build against this. Lane 1 (Edith) implements it. **No lane changes it.**
A needed deviation = `operator:gate` Linear issue + stop that slice. M/S refs =
`AUDIT-XYZ-1742-lane1.md` (repo root) — its full text governs where this summary is thin.

## Endpoints

| Route | Listener | Behavior |
|---|---|---|
| `POST /api/lease/claim` | loopback + tailnet | body `{host,name,worker?,role?,pid?,parent_host?,parent_name?}` → `200 {epoch,expires_at,ttl_s}`. One synchronous txn: `epoch=COALESCE(epoch,0)+1`, `lease_state='active'`, clears suspect/reaped. Re-claim of a reused `(host,name)` succeeds and fences the prior incarnation (M1). Parent edge written ONLY here, validated: `parent_host ∈ HOSTS() ∪ {mac}`, `SAFE_NAME`, no self-parent (M12). |
| `POST /api/heartbeat` | loopback + tailnet | body `{host,name,epoch}`. Epoch mandatory on a leased row: missing/stale → `409 {current_epoch_hint:false}`, renews nothing. Current epoch → `200 {expires_at,ttl_s,lease_state}` (S1). Reaped row → `410 {reason,reaped_at}` always; never resurrects (M2). Liveness-only: no status field by design (S7). |
| `POST /api/seats/claim` | **loopback only** | body `{seat,owner_host,owner_name}`, seat ∈ `coordinator\|orchestrator` → `{epoch,expires_at}`. Synchronous conditional txn, epoch++ (fences prior holder). Seat renewed by the holder session's heartbeat; expired seat → suspect, never silently deleted (M13). |
| `GET /api/sessions` | loopback only | rows += `pid,parent_host,parent_name,epoch,lease_state,expires_at,suspect_at`. UI liveness := `tmux-live OR lease_state='active'` (M11). |
| `GET /api/seats` | loopback only | seat rows (M11). |
| `GET /api/health` | loopback only | += `reaper_last_tick_at` (M14). |

**Fencing existing writes (M17):** `/api/kill`, `/api/registry/delete`, and `/api/registry`
writes to `status`/`task` — agent calls (no `Origin` header, the server.js:509-514 pattern)
MUST carry `seat_epoch` of the current orchestrator/coordinator seat; stale → `409`.
Browser calls (allowed Origin) exempt. Tailnet write routes take one shared bearer key,
`safeCompare`; loopback exempt (S3).

## Schema (additive only — M10)

`sessions` += `pid, parent_host, parent_name, epoch, expires_at, lease_state, suspect_at,
warned_at` — all nullable/defaulted via the existing try/ALTER loop; no DROP, no rebuild;
copy `fleet.db` → `fleet.db.bak-<date>` before first boot. New table
`seats(seat PRIMARY KEY, owner_host, owner_name, epoch, expires_at, suspect_at)`.
All new timestamps INTEGER unix-ms — never compare against legacy ISO strings (S4).
Pragmas pinned + asserted at boot: `journal_mode=WAL`, `synchronous=FULL`; throw if
read-back differs. fleet.db stays single-writer (M9).

## Reaper

States `active → suspect → reaped`. Every transition one synchronous conditional UPDATE
(CAS, no awaits between read and write) — see M3 for the exact WHERE clauses.
- Order per reap: `reaped` CAS commits **before** `tmux kill-session`; kill failure leaves
  the row reaped and retries next tick; `name.py close <Name>` only after a confirmed
  kill, from the row's `worker` column; NEVER kill or name-close `host='mac'` rows —
  🪦 only (M4).
- Second liveness sample: re-check tmux `session_activity` immediately pre-kill; recent
  activity ⇒ no kill, flag `pinger_dead` (M5).
- Cascade guard: >K sessions (default 3) or a whole host crossing suspect→reaped in one
  tick, or that host's ssh poll failing ⇒ skip all reaps, one host-level alert (M6).
- Boot + clock-jump grace: no reaps for one full suspect window after start; monotonic
  tick source; wall-clock jump > TTL re-arms the grace (M7).
- Two-phase warn, durable: suspect sets `suspect_at`; bus warn sets `warned_at`; restart
  re-warns unwarned suspects before any reap; reap gated on `warned_at` age. Warn text
  over ssh/tmux obeys the zero-quote rule (server.js:95-99) (M15).
- Every transition logged with epoch + reason; `reaper_last_tick_at` in /api/health (M14).
- Retention: reaped rows hidden/deleted after 14 days; heartbeats update in place, no
  history rows (S5).

## Numbers (S2 — defaults, all configurable)

TTL **90s** · renew cadence **ttl_s/3 = 30s** (client derives from response, never
hardcodes) · suspect/appeal window **180s** (2×TTL) · reaper tick **30s**.

## Pinger contract (Lane 2 — frozen here, M8)

Detached pinger (NOT a hook — long Bash calls block hooks): proves its session alive
before every beat (`tmux has-session` on box, `kill -0 <pid>` on mac); check fails ⇒ exit.
Transient network error ⇒ keep beating. `410` ⇒ stop + write local tombstone note.
`409` ⇒ re-claim is NOT allowed from the pinger; surface to the session.

## Org tree (Lane 3)

One edge: `(parent_host,parent_name)`. Seats render as roots; sessions under their
parent; orphans under their host. v1 tree = tmux sessions + mac desktop rows only —
leaf subagents (readers/hunters) are OUT (S6). Stale/reaped mac rows render 🪦 with
"close me"; box reaped rows disappear after kill (grey until then).
