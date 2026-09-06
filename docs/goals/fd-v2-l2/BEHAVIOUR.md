# fd-v2-l2 — behaviour inventory: app shell (sidebar · page header · right rail)

Extracted 2026-09-07 from the current app (`public/app.js`, `public/index.html`, `public/style.css`) by a reader.
This is the behaviour the new shell must preserve 1:1 while looking like the mock (ledger rows D03, D04, D05).

## 1. Sessions list (`app.js:833-884`)

- Source `GET /api/sessions` → `d.sessions`, normalised by `norm()` (`app.js:182`) with defaults
  `{label:'',role:'',worker:'',note:'',group:'',task:'',status:'active',live:true}`. Fields used: `host`, `name`, `live`, `status`, `label`, `active_at`.
- Only `s.live` rows are listed (`app.js:839`).
- Hidden rows: localStorage `showHidden` (`'1'`/`'0'`, `app.js:43,876`). Off → rows with `status==='hidden'` excluded (`app.js:841`); toggle text `"show N hidden"` / `"hide hidden"` (`app.js:868-880`), toggling re-runs `loadSessions()`.
- Grouping: only when more than one host is present (`app.js:842`); a `.host-label` divider is inserted whenever the host changes in API order (`app.js:844-848`). The list is not re-sorted.
- Row: `div.session` (+ `.inactive` when `status==='hidden'`, `app.js:849`); `title` = `"<name> [· <label>] · active <ago(active_at)>"` (`app.js:850`). Amber dot when `status==='kill-requested'` (`app.js:859`); green dot when the tile is open (`.session.open .dot`, `style.css:156`, class set by `sync()` per `tiles.has(key)`, `app.js:89`).
- Row contents: dot, `span.name` (ellipsis), ghost `⤢` button (`.rowmax`, `app.js:851-857`) → `openMax(host,name)`, click propagation stopped.
- Row click: `body.has-max` → `openMax(host,name)` (switch while maximized) else `openTile(host,name)` (`app.js:861-864`).
- Errors: one `div.err` per `errors[]` entry as `"<host>: <message>"`; `"no sessions"` when empty and no errors (`app.js:881-882`).
- `#refresh` → `loadSessions(); loadHealth(); loadAccounts();` (`app.js:1175-1179`). No interval for the list; it reloads on boot, connect-all, hidden toggle, edits, refresh.

## 2. Health pills (`app.js:99-132`, `#health`)

- Source `GET /api/health` → `data.hosts` (or a bare array) (`app.js:104`). Fetch failure → one red pill `"health unreachable"` (`app.js:106`).
- Per host `h` (fields `agentLocked, kind, reachable, holderOk, wslAlive, host`), in this order:
  1. `agentLocked` → amber `"<host> · 1Password locked"`, tip `"Unlock 1Password on this Mac, then Refresh"` (`app.js:112-114`).
  2. `kind==='linux'` → green `"<host> · reachable"` (tip `"ssh + tmux answered on this Linux host"`) if `reachable`, else red `"<host> · unreachable"` (tip `"ssh to this Linux host failed — network or key"`) (`app.js:115-120`).
  3. `holderOk===null || wslAlive===null` → amber `"<host> · unreachable"`, tip `"ssh to the box failed — network or 1Password"` (`app.js:121-124`).
  4. else green `"<host> · holder OK"` (tip `HOLDER_TIP`, `app.js:1-2`) when `holderOk && wslAlive`, else red `"<host> · HOLDER DOWN"` (`app.js:126-129`).
- Markup `div.pill > span.dot.<green|red|amber> + text`, `title=tip` (`app.js:92-97`); colours `#22c55e / #ef4444 / #f59e0b` (`style.css:185-187`).
- No polling: loaded at boot (`app.js:1253`) and on `#refresh`.

## 3. Accounts mini (`app.js:136-178`, `#accounts-mini`)

- Source `GET /api/credits` → `d.rows`.
- `pct` = max of the numeric `.pct` among: codex rows `[w.weekly, r.weekly, r.secondary]`; others `[w.five_hour, w.seven_day]` (`w = r.windows || {}`, `app.js:138-141`); `null` when none.
- Bar `.bar-track > .bar-fill`, width `clamp(pct,0,100)%`; class `red` if `pct>90`, `amber` if `pct>=70`, else green (`app.js:154-155`, `style.css:763-765`).
- Label: `short = full.split(' ')[0] + (kind==='codex' ? ' ·gpt' : '')`, `full = r.label||r.email||r.id` (`app.js:159-160`). Row = `span.mini-who`, track, `span.pct` (`'—'` when null) (`app.js:161`). `€` flag (`span.mini-flag`) when `credits.capped` (`app.js:163`, colour `#f0836b`).
- Tooltip from label/email, pct summary, credits used/limit, `r.source` (`app.js:145-152`).
- "detail" link → `/accounts.html` (`index.html:27`). Failure text `"accounts unavailable"` (`app.js:176`). Loaded at boot and on `#refresh`; no interval.

## 4. Nav and `sync()` (`app.js:75-90`, `index.html:14-21`)

- Booleans `fleetOpen`, `orgOpen`, `busOpen` (default false); `windowsOpen = !fleetOpen && !orgOpen && !busOpen` (`app.js:80`).
- `sync()`: `#empty.hidden = tiles.size>0`; `#fleet/#orgchart/#bus .hidden` per boolean; `.sel` + `aria-selected` on `#nav-windows/#org-btn/#fleet-btn/#bus-btn`; `.open` on each sidebar row per `tiles.has(key)` (`app.js:89`).
- `#nav-windows` clears all three (`app.js:1201-1206`); `#org-btn` → `toggleOrg()` (closes fleet+bus, `loadOrg()`); `#fleet-btn` → `toggleFleet()` (closes org+bus, `loadSessions()`); `#bus-btn` → `toggleBus()` (closes fleet+org, `loadBus()`). Links to `/keys.html`, `/accounts.html`, `/machines.html`, `/sessions.html` are real navigations (until L11).
- `#empty` shows when `tiles.size===0`; its `#empty-fleet` button → `toggleFleet(true)` (`app.js:1211`). Copy today: "No terminals open — pick a session, Connect all, or open the Registry". **New copy per operator ruling: "There are no sessions yet, open a new session via an orchestrator first."** (improvised.md entry required).
- `#drawer-close` removes `body.drawer-open` (`app.js:1163-1164`); outside-click closes the drawer unless inside `#sidebar` or `.menubtn` (`app.js:1166-1173`). Escape closes whichever of fleet/org/bus is open (`app.js:1213-1217`).

## 5. Theme (`app.js:11-65`)

- Key `fleetTheme` (`'light'|'dark'`). Resolution: URL `?theme=` > localStorage > `prefers-color-scheme: light` ? light : dark (default dark) (`app.js:11-20`).
- Applies `documentElement.dataset.theme` and `style.colorScheme` at init and in `syncTheme()` (`app.js:21-22, 53-55`); `#theme-toggle` text `"☀ Light"` / `"☾ Dark"`, `aria-pressed`, `title="Switch to <other> theme"` (`app.js:56-58`); toggle flips, saves, re-syncs (`app.js:60-64`).
- **Mock mapping:** the mock persists `fd-landing-dark` (`'1'|'0'`); L1 ships the migration (`fleetTheme` read once, then `fd-landing-dark` authoritative). The mock's toggle sits in the sidebar header (sun/moon icon button).

## 6. Keys, ids, timers

- localStorage: `fleetTheme`, `showHidden`, (`fleetTab` belongs to the Registry, L4).
- DOM ids the old shell relies on: `#sidebar #drawer-close #nav-windows #org-btn #fleet-btn #bus-btn #connect-all #sessions #accounts-mini #health #refresh #grid #empty #empty-fleet #fleet #fleet-close #theme-toggle`. The new shell uses the mock's markup; hooks are `data-*`/id only, never classes grafted onto mock markup.
- Timers: `setInterval(tickOrgTimes,1000)` (`app.js:1255`), `setInterval(()=>{ if(orgOpen) loadOrg(); },30000)` (`app.js:1257-1259`). None for sessions/health/accounts.

## Mock counterparts (from `diff.md` D03–D05)

- Sessions list → sidebar "groups" (box header + count chip + rows with dot + mono name).
- Health pills → right rail "Boxes" list (holder OK / reachable / unreachable states, same texts as above, same colour semantics via the mock's good/warn/bad tones).
- Accounts mini → right rail "Accounts" mini bars with provider logos.
- Refresh → page-header "Refresh" button (same three loads). "Live API" pill: carries the org source badge text per ruling O4.
- Nav → the eight icon nav items; `#empty` → improvised empty state in mock tokens.
