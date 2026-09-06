# fd-v2-l4 — behaviour inventory: Registry

Extracted 2026-09-07 from `public/app.js` (L440-830), `public/index.html` (L40-85), `server.js` by a reader.
The new Registry screen (ledger D12) must preserve all of this inside the mock's single-table layout
(ruling O3: edits and secondary actions behind the row `⋯` menu, Details fields in an expandable row).

## 1. Columns (`app.js:613-644`)

| key | field | label | cell |
|---|---|---|---|
| sel | — | ☐ | checkbox (both tabs) |
| name | `name` | Session | `td.mono` |
| host | `host` | Host | muted |
| label | `label` | Label | **editable** `editCell(s,'label')` |
| role | `role`/`worker` | Role/Worker | muted, `role · worker` or `—` |
| group | `group` | Group | **editable** |
| task | `task` | Task | `taskView`: matches `TASK_RE=/^[A-Z][A-Z0-9]*-\d+$/` → link `https://linear.app/synchronicity/issue/<task>` (new tab, noopener) + ✎ edit button; else plain text; **editable** |
| note | `note` | Note | **editable** |
| status | `status` | Status | `span.spill.<status>` |
| active | `active_at` | Active | `agoCell` |
| msg | `msg_at` | Last msg | `agoCell` |
| seen | `last_seen_at` | Last seen | muted; prefix `"gone · last seen "` when `!live` |
| actions | — | Actions | `actionCell` |

Old tabs: `overview = [sel,name,group,task,status,active,msg,seen,actions]`, `details = [sel,name,host,label,role,group,task,note,status,actions]`. **Mock has one table = overview columns; host/label/role/note move to the expandable details row.**

`editCell` (`:465-494`): click on td (not on a link, not while an input exists) → `<input>` with the current value; blur/Enter → `POST /api/registry {host,name,<field>:value}`; toast `"Saved <field>"` or `"<field> not saved: <error>"`; always `loadSessions()` after; Escape discards (no POST) and reloads.

## 2. Filters (`app.js:672-710`, `index.html:51-70`)

- `f-q` text (placeholder `search`): lowercase substring over name/host/label/group/task/note/role/worker.
- `f-live`: `""` ("live + gone"), `live`, `gone` → `(live==='live')===Boolean(s.live)`.
- `f-status`: `""` ("any status"), `active`, `done`, `kill-requested`, `killed`, `hidden`.
- `f-msg`, `f-active` (class `age`): keys of `AGE={'':0,'1h':36e5,'6h':216e5,'1d':864e5,'3d':2592e5,'7d':6048e5}` ("any" for ``); `olderThan(iso,age)`.
- Default `{q:'',live:'',status:'',msg:'',active:''}`; persisted as JSON under `fleetFilter` on every input; loaded at start (parse errors swallowed).
- Count `f-count`: `"<n> rows"` or `"<k> of <n> rows"`. Reset: defaults + `localStorage.removeItem('fleetFilter')` + controls reset + re-render.
- **Mock filter row: search, live/gone, status, last-msg selects, count, Reset — no `active-age` select.** Keep `f-active` semantics available (improvise: fold into the ⋯ menu? No — ruling: improvise a place in the filter row consistent with the mock's select style, document in improvised.md with screenshot).

## 3. Sorting (`app.js:609-670, 739-756`)

- Sortable columns = those with a getter (all but sel/actions). Header click: same key+asc → desc, else asc; per-tab `fleetSort[tab]={key,dir}`; header suffix `" ▲"`/`" ▼"`.
- `sortSessions`: unset values sink to the bottom both ways; time columns compare `Date.parse`; others lowercase strings.
- Persisted `fleetSort` = `{overview:{key,dir}, details:{key,dir}}`; default none (API order). With one table, use the `overview` slot.

## 4. Selection + bulk bar (`app.js:594-607, 724-737, 766-821`)

- `selected` = Set of `host+'\0'+name`. Row checkbox toggles; header checkbox = all filtered rows selected; on every render, keys not in the current filtered list are dropped.
- Bulk bar shown when `live+gone>0` selected: `bulk-count` `"<n> selected"`; `bulk-kill` `"Kill <live> live"` (disabled at 0); `bulk-forget` `"Forget <gone> gone"` (disabled at 0); `bulk-clear`.
- Bulk Kill confirm: `"Kill <n> tmux session(s)?\n\n<host:name per line>\n\nIrreversible — everything running in them dies."`; then sequential `POST /api/kill {host,name}`.
- Bulk Forget confirm: `"Forget <n> registry row(s)?"`; sequential `POST /api/registry/delete {host,name}`.
- `bulk()` (`:786-801`): disables buttons; toast pending `"<Verb>ing 0/<n>…"` then `"… i/n · <name>"`; ok → drop from `selected`; failures collected as `"<name>: <stderr|error|unknown error>"`; final toast `"<verb> failed for <k> — …"` (err) or `"<Verb>ed <n>"` (ok); `loadSessions()`.
- **Mock bulk bar: "N selected · Kill · Tag kill · Hide · Clear".** Bulk Tag kill / Hide are new (improvise: sequential `POST /api/registry {status}` per row, same toast pattern, document). Bulk Forget (gone rows) must stay reachable — put it in the bulk bar only when gone rows are selected (improvise, document).

## 5. Row actions (`actionCell`, `app.js:496-567`)

Order: `[Show, Message]` (live only) → `Kill`, `Tag kill|Untag`, `Hide|Unhide` → `Forget` (gone only). Buttons disabled while a row action is in flight.

- `Show` (title "Open this session fullscreen"): `toggleFleet(false); openMax(host,name)`; no POST.
- `Message` (title "Send a message through the bus"): `toggleBus(true); setBusTarget({type:'tmux',host,session:name})`; no POST. **Ruling O8: deep-link into the bus thread.**
- `Kill`: confirm `"Kill tmux session <name> on <host>?\n\nIrreversible — everything running in it dies."`; `POST /api/kill {host,name}`; toasts `"Killing <name>…"` / `"Killed <name>"` / `"kill failed: <stderr|error>"`.
- `Tag kill` / `Untag`: `POST /api/registry {host,name,status:'kill-requested'|'active'}`; toasts `"Tagging <name>…"`/`"Tagged <name> for kill"`, `"Untagging…"`/`"Untagged <name>"`; fail `"status not saved: …"`; titles "Mark kill-requested — nothing is killed" / "Cancel the kill request"; no confirm.
- `Hide` / `Unhide`: status `hidden` / `active`; toasts `"Hiding…"`/`"Hidden <name>"`, `"Unhiding…"`/`"Unhidden <name>"`; no confirm.
- `Forget` (gone only, title "Drop the registry row"): `POST /api/registry/delete {host,name}`; toasts `"Forgetting…"`/`"Forgot <name>"`/`"forget failed: …"`; no confirm at row level.
- **Mock row actions: Show · Message · ⋯.** The ⋯ menu carries Kill, Tag kill/Untag, Hide/Unhide, Forget, and Edit (label/group/task/note) per ruling O3; menu styling improvised in mock tokens, documented with screenshot.

## 6. Status pill, live/gone, time formatting

- Pill `span.spill.<status>` for `active | done | kill-requested | killed | hidden` → mock tones: active=good, kill-requested=warn, killed/done=neutral, hidden=dim (map + document).
- `tr.gone` when `!live` (greyed); `seen` prefix `"gone · last seen "`.
- `ago(iso)` (`:452-461`): `—` (muted) when empty; `just now` <1 min; `Nm ago`; `Nh ago`; `Nd ago`; class `age-red` >1 day, `age-amber` >1 h.
- Hidden rows stay in the Registry table (only the sidebar filters them); `f-status=hidden` finds them.

## 7. Refresh and errors

- `loadSessions()` after every edit save/escape, every row action (ok or fail), after each bulk batch; filter/sort changes re-render the cached list without refetch; no interval.
- Toasts (`:433-448`): pending never auto-dismisses; ok 3 s; err 6 s; click dismisses. Error strings as quoted above.

## 8. Keys, ids, server rules

- localStorage: `fleetFilter`, `fleetSort`, `fleetTab` (`'overview'|'details'`; with one table keep reading it harmlessly).
- Old ids: `f-q f-live f-status f-msg f-active f-count f-reset fleet-bulk bulk-count bulk-kill bulk-forget bulk-clear fleet-head fleet-rows tab-overview tab-details fleet fleet-close`. New hooks `data-*`/id only.
- Server: `/api/registry` POST-only, Origin (if present) must be allowed (403 `forbidden`), JSON body (400 `bad request body`), `host` = `mac` or in `HOSTS()`, `name` matches `SAFE_NAME` (400 `unknown host or bad session name`); `status`/`task` writes are fenced (`fenceCheck`, `server.js:467-486`): from the browser the Origin header satisfies the fence; `status ∈ {active,done,kill-requested,killed,hidden}`; `group` ≤ 64 chars; `task` empty or one `TASK_RE` key ≤ 32 chars; only present fields are written (`label,role,worker,status,note,group→grp,task`). `/api/registry/delete` always fenced. `/api/kill` host must be in `HOSTS()` (never `mac`), result passes `stderr` through on failure.
