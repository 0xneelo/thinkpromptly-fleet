# fd-v2-l10 — behaviour inventory: Desktop sessions

Extracted 2026-09-07 from `public/sessions.html`, `public/sessions.js`, `desktop-sessions.js`, `server.js`, `README.md` by a reader. Ledger D17.

## 1. Data

- `GET /api/desktop-sessions[?refresh=1]` (`server.js:2776-2780`) → `{groups[], machines[], collected_at, collecting, ttl_ms}` (`desktop-sessions.js:175`). TTL 300 s; `refresh=1` forces a collect.
- `groups[]` (`:150-169`): key `accountUuid:orgUuid:machine`; `accountUuid, orgUuid, machine, label` (org label or `'Unmapped account'`), `email`, `sessions[]`.
- Session (`:22-30` + view): `accountUuid, orgUuid, id, title, cwd, worktree, branch, model, createdAt, lastActivityAt, isArchived, completedTurns, cliSessionId`, `live`, `liveState ('live'|'offline'|'unknown')`, `liveName`, `messageTarget {type:'claude-desktop', session:'id:'+cliSessionId} | null`, `collected_at`, `stale`. Live only decidable on local machines (exactly one live socket match, `:158-164`); remote = `unknown`.
- `machines[]` (`:127-136`): `id, label, host, local, state, collected_at, attempted_at, stale, skipped`.
- Sort: sessions by `lastActivityAt` desc, `id` asc; groups by `label, accountUuid, machine, orgUuid`. **No "Live now" group today.**
- Transcript: `GET /api/desktop-sessions/transcript?machine&account&org&id` (`server.js:2781-2791`) → 200 text/plain, 404 `no transcript`, 502 `transcript unavailable`.

## 2. Filters (`sessions.html:32-50`, `sessions.js:58-92`)

`#sessions-search` (placeholder "Title, folder, branch…"; substring over title/cwd/worktree/branch/model), `#sessions-account` (`All accounts` + `label · uuid8`), `#sessions-machine` (`All machines`), `#sessions-live` (`Any live status / Live / Offline / Unknown`), `#sessions-archived` (`All sessions / Not archived / Archived`). Defaults `""`; AND-combined; no persistence. Reset clears all. Count `"<shown> of <total> sessions · <live> live"`; `"Last collection: <age>"` / `"No completed collection"`. A vanished selection keeps a synthetic `"Previously selected (unavailable)"` option.

## 3. Rows (`sessions.js:192-250`)

- Title `title || 'Untitled session'` + `cwd` path line + `<details>` "Session details" (Worktree, Created, CLI session, Session — values only when present).
- Context: `branch || 'No branch'` (mono), `model || 'Model unknown'`.
- Activity: `age(lastActivityAt)` (`Just now`, `Nm ago`, `Nh ago`, `Nd ago`, `Unknown`) + `completedTurns===null ? 'Turns unknown' : 'N turns'`.
- State chips: `Live` / `Live unknown` / `Offline` (+ `Archived`, + `Cached` when stale).
- Action: `Message` (live + messageTarget) → composer; else text `Live check unavailable` / `Not running`. **No Show today.**
- Copy conversation: label cycles `Copy conversation → Copying… → Copied | Copy failed | No transcript` (1.5 s); clipboard = `sessionContext(group,session)` + `\n` + transcript. `sessionContext` (`:168-181`) = `Label: value` lines: Title, Account (label·email·uuid), Machine, Directory, Worktree, Branch, Model, Created, Last activity, Turns, Status (liveState[, archived]), CLI session, Session.

## 4. Composer (`#session-composer`, `sessions.js:94-166`)

Fields `#composer-title` ("Message <title>"), `#composer-recipient` (`label · machine · liveName`), `#composer-availability`, `#composer-text` (required, maxlength 16000), `#composer-send`, `#composer-status`, `#composer-close`. `POST /api/messages {source:'desktop-sessions-page', target: messageTarget, text}`. Success `"Message delivered."` + clear; failure `"Message could not be delivered. Your draft is kept; check the Bus before retrying."`; target gone → `"This session is no longer available to message."` and send disabled.

## 5. Polling, errors, keys

- `setInterval(load, 30000)` only when `!document.hidden`; `#sessions-refresh` → `load(true)` (`Collecting…`/`Refresh`). Errors: `"Sessions could not be refreshed."[+" The last view is still shown."]`, first-load failure `"Sessions unavailable"` / `"Could not load desktop sessions."`; per-machine notes: `no_report` → "Waiting for a first collection.", `not_found` → "No Desktop session directory found.", `unavailable` → "Collection failed. Previously collected sessions are still shown.", `partial` → "Some session files could not be read. Previously collected sessions are still shown.", fallback "Cached metadata. Refresh to collect the latest sessions." Empty: "No sessions match these filters. Reset filters to see all conversations." / "No Desktop sessions collected yet. Open a Code tab on a configured machine, then refresh."
- localStorage: only `fleetTheme`. Old ids: `#sessions-* #desktop-session-groups #session-composer #composer-*`.

## 6. Mock counterparts (D17) and improvisations

- Filter row ≈ 1:1 (state select = archived filter). Per-person groups (email·acct, machine chip) ≈ group heading. Table Conversation / Last activity / Status / Action (mock has 4 columns; branch + model chip live inside the Conversation cell).
- Improvise and document: **"Live now" group pinned first** (new); **Show** (no tile exists → expand the details row and scroll it into view, or open the transcript in a reader panel — pick one); **Message** → `FD.screens.bus.open(messageTarget)` (ruling O8; the bus thread replaces the page-level composer); **Copy context** (new separate button = `sessionContext()` only) and **Copy conversation** (context + transcript); expand row labels Created / CLI session / Session / Full path (`cwd`); `Cached`/`Archived` chips placement; machine notes and empty states in mock tokens.
