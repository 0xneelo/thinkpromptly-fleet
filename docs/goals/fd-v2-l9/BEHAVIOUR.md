# fd-v2-l9 — behaviour inventory: Machines

Extracted 2026-09-07 from `public/machines.html`, `public/machines.js`, `server.js`, `machines.json` by a reader. Ledger D16.

## 1. Data

- Row (`machinesView()`, `server.js:1922-1966`): `id, label (≤60 || id), os (≤20), route (≤10), ssh (≤60), host` (deck join key, null unless in `hosts.json`, `:1936-1939`), `error`, `sessions` (registry rows joined on `host`, `:1943`), `state` (`'ok'|'no_report'`), `reported_at` (`collected_at||ts`), `reported_host` (ok rows only, the machine's own `hostname -s`), `clients[]`.
- Client: `client, where ('local'|'wsl'|'windows'), state, installed, signed_in, label, usage` + `email, config_email, org, config_org, account_id, plan, tier, proof, expires_at, last_refresh, last_active, orgs_seen, shares, note`. Missing combos synthesized as `{state:'not_installed', installed:false, signed_in:null, label:null, usage:null}` per `where` × `MACHINE_CLIENTS` (`:1959-1962`).
- Top level: `machines[], collected_at (s), collecting, collect_started_at, push_url`. `GET /api/machines?refresh=1` forces the ssh fan-out (`:2771-2774`); the 60 s poll never forces, only the Refresh button does.
- Push: `POST /api/machines` (`:1985-2004`) from `route:'push'` machines (e.g. `rog-strix`); polled machines skip push routes (`:1736`).

## 2. Rendering today (`public/machines.js`)

- Table `.machines`: header `Machine` + 4 client columns `Claude CLI / Codex CLI / Claude desktop / Codex desktop` (`:3-8, 195`).
- Machine cell (`machineCell` `:172-190`): `.who` = label; chips `os`, `ssh <ssh>` or bare `route`, `"N session(s)"`; then `.err` = `m.error`, or `no_report && route==='push'` → `"no report yet — cron this on that machine:"` + copyable `sh fleet-logins.sh push <push_url> <id>`, or `"no report yet"`; `reported <ago>`; one `.sess` line per session `[name, worker, role||label, status].join(' · ')`.
- Client cell (`clientEntry` `:123-158`): entries by client; empty → `—` (blank when `no_report`); WSL/Windows tag when `where==='windows'` or the machine os includes `wsl`; `not_installed` → `—`; identity `.who` = label, else `"signed in, account unknown"` or `"<org8> · unmapped org"`; mono `.addr` = email; chips: `plan` (except `business`), `TIER` (`Max 20×`/`Max`), `PROOF` → `token-proved` / `config only` / `last active`, `STATE` → `token expired` (bad) / `busy (429)` (warn) / `signed out` (warn) / `api key` / `never used` / `read failed` (bad) (`:11-19`); freshness `"token valid|expired <ago>"` (claude_cli) / `"refreshed <ago>"` (codex) / `"last active <ago>"` (`:110-119`); `shares` → `"same login as CLI"`; `note` verbatim.
- Usage bars (`usageNodes` `:93-98`): windows in `WIN_ORDER` `five_hour, seven_day, extra, weekly, secondary`, each `label | track/fill | pct%|—`, amber ≥70 / red >90 (`:68-87`); trailing `"sampled <age>[ — older than the window it measured, so these have reset since]"`; `"no usage data"` / `"no usage windows reported"`.
- Session attribution on the local `claude_cli` runner only: `"N session(s) run as <label||email>"` (`:150-156`).

## 3. Chrome, polling, errors

- `#refresh` → `load(true)`, disabled while loading; `setInterval(load, 60000)` (no force). `collecting`/`collect_started_at` are **not rendered today**. Fetch error → `'cannot reach fleetdeck'`. No localStorage. Old ids/classes: `#machines #refresh`, `.machine .who .chips .chip .err .fresh .login .tag .addr .sess .bar-row .bar-track .bar-fill .pct .age-amber .age-red .copy`.

## 4. Mock counterparts (D16) and improvisations

- Mock (L617-668): collapsible card per machine — header (chevron `m.toggle`, `m.name`, `m.kind` chip, session-count chip if any, right side `"reported just now"` + `"Open in Registry"` if sessions) → body grid of `m.rows`: `r.env` (WSL/Windows/blank) + `r.client`, `r.primary`/`r.summary`, `r.secondary`, chips, bars (`label, fill%, right`), `r.note`.
- Map: machine cell ⇄ card header; each `clientEntry` ⇄ one row (env = WSL/Windows tag, primary = label, summary = chip, secondary = email, chips = plan/tier/proof/state, bars = usage windows, note = freshness/shares/note text). Seed groups rows by client column with WSL/Windows as two entries.
- Improvise and document: "Open in Registry" → Registry with a host filter (`#registry` + `f-q=<host>`); default expanded (matches today's always-visible table); the push "no report yet — cron this" line and the copyable command; `collecting` indicator (decide; today none); error text placement.
