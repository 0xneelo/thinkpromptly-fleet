# fd-v2-l6 — behaviour inventory: Message bus (+ reply toast)

Extracted 2026-09-07 from `public/app.js`, `public/index.html`, `message-bus.js`, `server.js` by a reader. Ledger D13, D08.

## 1. Data

- `GET /api/messages?limit=50` (`app.js:918`; route `server.js:2451-2464`, loopback, no token). `limit` → `message-bus.js:98-99` (default 50, cap 100). Response `{messages, targets}`.
- `messages[]` (`message-bus.js:13-30`): `id, source, target{type, host?, session}, text, status, error, created_at, updated_at, delivered_at`; ordered `created_at DESC`.
- `targets[]` (`server.js:2333-2340`): `{type:'claude-desktop', session:'current'}` first, then one per live desktop session (`session: name`), then local live tmux sessions. Client (`app.js:920-925`) merges its own `{type:'tmux', host, session}` for every live fleet session (no de-dupe).

## 2. Send (`index.html:108-113`, `app.js:1218-1235`)

- Fields: `#bus-target` select (required; option value = `JSON.stringify(target)`, label `"Claude Desktop · <label||'current chat'>"` or `"<host> · <session>"`), `#bus-source` (default `fleetdeck-ui`, maxlength 80), `#bus-message` (maxlength 65536). Button "Send now".
- Submit: disable, toast `"Delivering message…"`; `POST /api/messages {source, target, text}`; ok → `"Message delivered"` + clear text; else `"Delivery failed: <error||'unknown error'>"`; always `loadBus()`.
- Server validation (`message-bus.js:80-92`, `server.js:2214-2231`): `source` `^[A-Za-z0-9._:@/-]{1,80}$`; `text` non-empty, ≤64 KiB (413 `text exceeds 64 KiB`); `claude-desktop` target needs `session` ≤300 chars; `tmux` target needs `host ∈ {mac, HOSTS()}` + `SAFE_NAME` (400 `tmux target must name a configured host and safe session`); duplicate client `id` → idempotent. Response `{ok: status==='delivered', ...message}`; delivery is awaited inline, so the reply is `delivered` or `failed`.

## 3. Statuses and retry

- `queued → sending → delivered | failed` (`message-bus.js:54-74`); boot resets stale queued/sending to failed `"delivery interrupted by Fleetdeck restart"`; `error` ≤1000 chars.
- Table row (`app.js:940-959`): When · Source · Target · Status (`td.bus-status.<status>`) · Message (`error` as tooltip) · Retry (only `failed`): `POST /api/messages/retry {id}` (404 unknown, 409 `only failed messages can be retried`), toasts `"Retrying message…"` / `"Message delivered"` / `"Retry failed: <error>"`, then `loadBus()`. `#bus-refresh` → `loadBus()`. **No poll.**

## 4. Delivery semantics (for receipts and the offline banner)

- Per-target FIFO (`message-bus.js:128-135`). tmux: `load-buffer` → `paste-buffer -p -d` → separate `send-keys Enter` (`server.js:2238-2258`). claude-desktop `current`: local AX bridge, macOS only, 8 s timeout; named desktop session: `id:<uuid>` or name → unix socket, two JSON lines, 5 s timeout, clean close = success (`server.js:2260-2329`).
- Ack exists only for `/api/notify` (`server.js:2610-2685`: `delivered`, `acked`, `ack_from`, retry ×2 at 5 s). `/api/messages` receipts = `status` + `delivered_at` only.

## 5. `setBusTarget(target)` (`app.js:901-909, 933-937`)

Stores the JSON value; selects it immediately if the option exists, else on the next `loadBus()`. Called by Registry "Message" and desktop sessions. **This becomes `FD.screens.bus.open(target)` in v2** (deep-link into the thread; ruling O8).

## 6. Keys, ids, keyboard, server rules

- No bus localStorage today. Ids `#bus #bus-close #bus-form #bus-target #bus-source #bus-message #bus-refresh #bus-rows`. Escape closes the panel (`app.js:1216`).
- Origin gate on `/api/messages*` when an Origin header is present (403); tailnet listener needs `BUS_TOKEN`; body cap `MAX_BODY_BYTES+4096`; errors `{ok:false,error}` with HTTP 400/404/409/413 — display `error` verbatim.

## 7. Mock counterparts (D13, D08) and improvisations (all client-side, document each)

- **Threads**: group `messages[]` by target (`type\0host\0session`); rail rows = one per target (+ targets with no messages from `targets[]`), preview = last message text, timestamp = last `created_at`; Pinned/Recent split.
- **Unread**: localStorage `fd-bus-seen` = `{targetKey: lastSeenIso}`; unread = inbound rows (source ≠ ours, i.e. not `fleetdeck-ui`/our source chip) newer than seen; badge count → `FD.shell.setBadge(n)` (L2 hook).
- **Pinned**: localStorage `fd-bus-pinned` = `[targetKey]`; pin action in the thread header.
- **Receipts**: per message from `status`/`delivered_at`/`error` (`delivered` / `failed` + Retry); broadcast (Select mode, N targets) = N `POST /api/messages` (same text), rows correlated by text + timestamp; per-recipient receipt = each row's status.
- **Offline banner**: target not in current `targets[]` / not live in `/api/sessions` → banner + button label `Queue` (still posts; delivery fails → Retry) — or disable send; pick one, document.
- **Inbound poll + toast (D08)**: while the bus screen is open poll `GET /api/messages` every 15 s; on the app shell poll every 60 s; a new inbound row (source ≠ ours) for a thread other than the open one → toast `"<from> replied"` with preview, `Open thread`, auto-dismiss 7 s (mock L769-780, L1473).
- **Composer**: `⌘/Ctrl+Enter` sends; `from` chip editable = `source`; Send/Queue label per offline state.
- **Header actions**: reader view (wider bubbles), maximize (`busMax`), pin, show session (tmux → `FD.screens.windows.openMax(host,session)`, desktop → no-op with tooltip), copy thread (plain text of the thread) — all client-side.
- Keep the old semantics: `Escape` priority chain from the mock (menu → terminal → bus max), toasts and error strings quoted above.
