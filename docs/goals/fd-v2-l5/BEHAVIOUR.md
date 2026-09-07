# fd-v2-l5 — behaviour inventory: Org chart

Extracted 2026-09-07 from `public/app.js`, `public/orgchart.js`, `public/index.html`, `style.css`, `server.js` by a reader. Ledger D11.

## 1. Data

- Session rows via `norm` (`app.js:185-186`); org reads `SESSION_FIELDS` (`orgchart.js:6-28`): `host,name,label,role,worker,status,note,group,task,last_seen_at,active_at,msg_at,live,pid,parent_host,parent_name,epoch,lease_state,expires_at,suspect_at,pinger_dead`.
- `GET /api/seats` (`server.js:2754-2758`) → `{ok:true, seats:[{seat, owner_host, owner_name, expires_at, suspect_at, fenced}]}` — **epoch is withheld on the wire** (`:2757`); the epoch badge renders only in fixture mode (`app.js:264,327`).
- `fetchOrgData` (`app.js:189-205`): `?orgFixture=1` → `/orgchart-m11.fixture.json` + `rebaseFixture` (`orgchart.js:171-196`, shifts timestamps by `now - captured_at`), returns `{sessions, seats, errors, fixture:true}`; else `Promise.all([fetchSessions(), fetch('/api/seats')])`, error `'/api/seats HTTP <status>'`.
- `#org-source` badge (`app.js:387-388, 409-410`): `'M11 fixture'` (amber), `'live API'` (green), `'integration pending'` (red). **Ruling O4: fold into the header "Live API" pill.**

## 2. `buildTree` (`orgchart.js:80-167`)

- Roots are seats only, coordinator before orchestrator (`:94-100`). Owner session found by `owner_host/owner_name` → seat attached to that node and pushed as root (`:102-107`); no owner → `type:'seat-vacant'` node, key `'seat\0'+seat` (`:108-109`); owner already claimed → second vacant node with `conflict:true` (`:110-121`).
- `isLive(row)` = `row.live===true || row.lease_state==='active'` (`:61-63`); `live` stays the gate for opening terminals elsewhere.
- Non-seat nodes in `childSort` order (`:76-78`: `worker||name||label`, then `host`, locale-numeric) attach to `parent_host+parent_name` if it exists, is not self and creates no cycle (`:128-141`); otherwise **unattached** (`:154-157`), keeping their own subtree. Children and unattached sorted (`:160-165`).

## 3. States (`orgchart.js:65-74`)

| state | dot | condition |
|---|---|---|
| tombstone | `#777570`, subtle bg | `lease_state==='reaped' && host==='mac'` |
| reaped | `#777570`, opacity .62 | `lease_state==='reaped'` |
| suspect | `#e4a354`, pulsing shadow | `lease_state==='suspect'` |
| active | `#43b779` | `isLive(row)` |
| offline | `#777570`, opacity .62 | otherwise |

`needsAttention(row, now)`: `now - Date.parse(active_at||last_seen_at) >= 15 min` → class `needs-attention` + badge `'idle 15m+'` (`app.js:275,288`). `pinger_dead` → blue badge `'pinger'`, title `"Session is live; its detached heartbeat pinger failed"` (`app.js:283-286`).

## 4. Card (`orgNodeCard`, `app.js:253-332`)

- Vacant seat card: `C`/`O` mark, seat name, `owner_host / owner_name` mono, epoch `'#'+epoch` (fixture only), expiry countdown, body `'Owner row already holds another seat'` (conflict) or `'No current owner row'`.
- Normal card: `dataset.host/name/state`, `aria-label "<worker||name>, <state>"`; title row = dot + bold `worker||name` + optional `pinger` / `idle 15m+` badges; tombstone gets `🪦 close me` (title `"Close this stale Mac desktop session; fleetdeck never kills Mac rows"`).
- Identity row: `role || 'unassigned role'`, mono `host / name`. Work row: `group || 'no group'` / task as Linear link (`TASK_RE`) or `'no task'`.
- `dl.org-facts`, 4 rows: `epoch` → `'legacy'` or `'#'+epoch`; `lease` → `lease_state || (live ? 'tmux live' : 'unleased')`; `age` → ticking `shortDuration(now - last_seen_at)` or `'unknown'`; `expires` → `'none'` | `'<d> left'` | `'expired <d> ago'`. `shortDuration`: `Ns` / `Nm` / `Nh Mm` / `Nd Hh` (`app.js:216-224`).
- Owner card with seat: class `has-seat` (coral border) + badge (mark, seat, epoch, expiry countdown) (`app.js:320-330`).

## 5. Header and status (`index.html:86-102`)

- Title `Org chart`, subtitle `"Parent-child hierarchy across the fleet. A host is a label on a node, never a group."`; `#org-source`; `#theme-toggle`; `#org-close` (title `"Close (esc)"`).
- `#org-status` (live region): loading `'Loading M11 fixture…'` / `'Loading live seats and sessions…'`; success `"<N> sessions · <N> seats[ · <N> unattached][ · <N> host errors]"` (`app.js:389-393`); error `'Org chart unavailable: <message>'`.
- `<details id=org-unattached>`: summary `'Unattached sessions'` + count + `'no parent row in the fleet'` (`app.js:373-379`). Empty tree: `'No seats or sessions to map.'`; error-path empty state: `'The frozen seat endpoint is not available on this branch.'` + `'Use the committed contract fixture to review this UI.'` + link `'Open fixture preview'` → `/?orgFixture=1` (`app.js:413-418`).

## 6. Timers and lifecycle

- `setInterval(tickOrgTimes,1000)` always (`app.js:1255`); `setInterval(()=>{ if(orgOpen) loadOrg(); },30000)` (`:1257-1259`); `renderOrg` resets `orgTicks` (`:360,394`), error path clears it (`:408`).
- `toggleOrg(on)` (`:1189-1197`) closes fleet/bus, loads on open; Escape closes (`:1213-1216`); boot auto-opens in fixture mode (`:1254`).
- No org-specific localStorage. Old ids/classes: `#orgchart #org-title #org-source #theme-toggle #org-close #org-status #org-tree #org-unattached #org-btn`, `.org-*`, `.state-*`, `.has-seat`, `.needs-attention`.

## 7. Mock counterparts (D11) and improvisations

- Stats row `"N sessions · N seats"` ⇄ `#org-status` text; mock tabs **attached / unattached** ⇄ tree + `<details>` strip (keep count semantics).
- Mock **sort machine↔project + scope select**: new; built over `buildTree` output without changing `childSort`.
- Spine (org node → coordinator → orchestrator, "Send a message") ⇄ seat roots (`seat-vacant` / `has-seat`); "Send a message" → bus thread deep-link (ruling O8 pattern).
- Kids grid ⇄ nested `.org-level` tree; unattached card grid + `idle 15m+` badge + 2×2 meta ⇄ `.org-unattached-list` + `org-attention` + the four `org-facts`.
- Improvise and document: source badge text inside the "Live API" pill (O4); error / "integration pending" state in mock tokens; seat conflict + fixture-only epoch badge treatment; tombstone `close me` badge.
