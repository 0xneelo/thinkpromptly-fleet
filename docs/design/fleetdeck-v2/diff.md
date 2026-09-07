# Fleetdeck v2 — diff ledger (mock vs current)

Contract for the build: a gap not in this ledger does not get built. Evidence = mock line range in
`docs/design/fleetdeck-v2/mock/Fleetdeck Final.dc.html` + current `file:line`. Size S/M/L.
Phase: **P1** = verbatim static port (pixel gate vs mock), **P2** = logic integration (pixel gate vs mock in
fixture mode + behaviour parity with the current app). Status: ☐ open · 🔨 in a slice · ✅ verified (screenshot
pair + diff % filed under `verify/`).

## Rows

| Row | Surface | Mock shows | Current does | Size | Phase | Slice | Status |
|---|---|---|---|---|---|---|---|
| D01 | Runtime + markup | dc-runtime React template, inline styles, glass tokens, single file for land/app/deck (L1-2176) | static HTML + `style.css` classes + vanilla `app.js`; 5 separate pages | L | P1 → S2 | S1, S2 | ✅ S1 `70c32bb` (gate 36/36, max 0.033 %) · ✅ S2 `f370e4e` (plain JS, parity 36/36, interactions 34/34, no engine) |
| D02 | Background video layer | fixed blurred video (80px) behind the app, on/off toggle, `localStorage['fd-app-video']` (L143-148, L1255/1268) | none | S | P1 | S1 | ✅ S1 `70c32bb` (gate 36/36, max 0.033 %) |
| D03 | Sidebar | 252px / 64px collapsible, eye logo + "fleetdeck / by thinkpromptly", header buttons collapse · theme · video, 8 icon nav items (Windows, Org chart, Registry, Message bus+badge, SSH keys, Accounts, Machines, Desktop sessions), "Connect all" pill, sessions grouped by box with count, footer hint text (L150-206) | 260px fixed, wordmark, 4 buttons + 4 page links, Connect all, sessions by host + hidden toggle, accounts-mini, health pills, Refresh (index.html:10-34, style.css:71) | M | P1 → P2 (L2) | S1, L2 | P1 ✅ S1 `70c32bb` (gate 36/36, max 0.033 %) · P2 ✅ L2 `e904077` (fixture gate 36/36 max 0.033 %, live 59/59) |
| D04 | Page header | per-screen title + subtitle (`titles` map L1302-1311), "Live API" pill, Refresh, right-rail toggle (L210-220) | none for Windows; each overlay has its own header | S | P1 → P2 (L2) | S1, L2 | P1 ✅ S1 `70c32bb` (gate 36/36, max 0.033 %) · P2 ✅ L2 `e904077` (fixture gate 36/36 max 0.033 %, live 59/59) |
| D05 | Right rail | 222px "Accounts" mini bars with provider logos + "Boxes" list with holder/reachable status (L738-768) | sidebar footer `#accounts-mini` (app.js:136-158) + `#health` pills (app.js:99-121) | M | P1 → P2 (L2) | S1, L2 | P1 ✅ S1 `70c32bb` (gate 36/36, max 0.033 %) · P2 ✅ L2 `e904077` (fixture gate 36/36 max 0.033 %, live 59/59) |
| D06 | Theme + tokens | dark `#0a0a0a` / light `#f2f1ee`, ink alpha scale, oklch good/warn/bad, Inter, mono stack, glass blur 28px, `localStorage['fd-landing-dark']` (L1253-1279) | coral/brown palette, system font, `fleetTheme` key (style.css:3-51, app.js:52-64) | S | P1 (tokens) → P2 (key migration) | S1, L1 | P1 ✅ S1 `70c32bb` (gate 36/36, max 0.033 %) · P2 ☐ |
| D07 | Density | `compact` state swaps row/card padding (7/11px, 14/16 vs 18/20) | none | S | P1 | S1 | ✅ S1 `70c32bb` (gate 36/36, max 0.033 %) |
| D08 | Reply toast | bottom-right 340px, "{from} replied", preview, Open thread, 7s auto-dismiss (L769-780, L1473) | none | S | P1 → P2 (L6) | S1, L6 | P1 ✅ S1 `70c32bb` (gate 36/36, max 0.033 %) · P2 ✅ L6.1 `2f72f00` (toast proven both ways; fixture gate 36/36, live 50/50) · rider L6.2 open (deep links) |
| D09 | Windows tiles | grid `minmax(420px,1fr)`, tile = dot · name · box · ⤢ · ×, mono log body, footer model/path + state (L222-249, seed L1841-1870) | grid `minmax(480px,1fr)`, `.bar` = ☰ · title/host · ⤢ · ×, xterm body, stall/dead overlays + reconnect (app.js:1020-1179, style.css:217) | M | P1 → P2 (L3) | S1, L3 | P1 ✅ S1 `70c32bb` (gate 36/36, max 0.033 %) · P2 ✅ L3 `b6d94b5` (fixture gate 36/36 max 0.033 %, live 37/37) |
| D10 | Session full screen | fixed overlay z55: ≡ session-switch menu, name, host, live pill, Message + Close; mono body; footer prompt + model/path/branch + hint; Escape closes (L781-815, L1238-1243) | `.tile.max` + `body.has-max`, sidebar as drawer switcher, shift+Esc restore (app.js:860-863, 1007-1011, 1140-1145) | M | P1 → P2 (L3) | S1, L3 | P1 ✅ S1 `70c32bb` (gate 36/36, max 0.033 %) · P2 ✅ L3 `b6d94b5` (fixture gate 36/36 max 0.033 %, live 37/37) |
| D11 | Org chart | stats "N sessions · N seats", tabs attached/unattached, sort machine↔project, scope select; attached = 3-card spine (org node → coordinator → orchestrator, "Send a message") + kids grid; unattached = card grid with idle badge + 2×2 meta (L251-344, L1879-1904) | overlay with title, source badge live/fixture, theme toggle, close, live region, nested `ul` tree of `.org-node` cards + `<details>` unattached; 30s poll + 1s countdown; `?orgFixture=1` (app.js:189-205, 253-392, 1255-1259; orgchart.js) | L | P1 → P2 (L5) | S1, L5 | P1 ✅ S1 `70c32bb` (gate 36/36, max 0.033 %) · P2 ✅ L5 `0edc033` (fixture gate 36/36 max 0.033 %, live 50/50) |
| D12 | Registry | filter row (search, live/gone, status, last-msg selects, count, Reset), bulk bar (N selected · Kill · Tag kill · Hide · Clear), table ☐ Session Group Task Status Active Last msg Last seen Actions(Show · Message · ⋯) (L346-395, seed L1366-1379) | tabs Overview/Details, filters incl. active-age, column sort persisted, inline cell edits (label/role/note/task), bulk kill/forget, row actions Show/Kill/Tag kill/Hide/Forget/Untag (app.js:614-830) | L | P1 → P2 (L4) | S1, L4 | P1 ✅ S1 `70c32bb` (gate 36/36, max 0.033 %) · P2 ✅ L4 `ecd6985` (fixture gate 36/36 max 0.033 %, live 36/36) |
| D13 | Message bus | two-pane chat: rail (search, Select mode, Pinned/Recent, previews, unread), thread (header actions with tooltips: reader view · maximize · pin · show session · copy thread; in/out bubbles, per-recipient receipts, Retry, offline banner), composer (from chip, ⌘↩, Send/Queue) (L397-501, seed L1415-1446) | form target/source/message + "Send now", deliveries table, retry, refresh (index.html:103-122, app.js:911-979, 1214-1233) | L | P1 → P2 (L6) | S1, L6 | P1 ✅ S1 `70c32bb` (gate 36/36, max 0.033 %) · P2 ✅ L6 `b4fd310` (fixture gate 36/36 max 0.033 %, live 47/47) |
| D14 | SSH keys | 4 cards: Mint (TTL chips 1h/4h/8h, principal chips root/vibe, Mint, 1Password Touch ID note), GitHub train (Active pill, countdown, chips, End train, curl hint), Certificates (active row + countdown + Kill now, copy-cmd block + Copy, expired + Delete), Keys table Name/Type/Fingerprint/Comment (L503-566, seed L1924-1934) | keys.html `#ttls #principals #mint #train-status #train-ttls #train-end #certs #pubkeys`, 30s poll (keys.js) | M | P1 → P2 (L7) | S1, L7 | P1 ✅ S1 `70c32bb` (gate 36/36, max 0.033 %) · P2 ✅ L7 `ca8b4a8` (fixture gate 36/36 max 0.033 %, live 66/66) |
| D15 | Accounts | summary bar + privacy note; collapsible cards: provider pill, name, email, id, plan pill, live status, timestamp; expanded: banner, stale note, usage bars, 7-day sparkline, "seen on" (L568-615, seed L1936-1964) | accounts.html `#summary #accounts #errors-panel`, refresh (accounts.js) | M | P1 → P2 (L8) | S1, L8 | P1 ✅ S1 `70c32bb` (gate 36/36, max 0.033 %) · P2 ✅ L8 `97bdbb2` (fixture gate 36/36 max 0.033 %, live 60/60) |
| D16 | Machines | collapsible per-machine cards (kind chip, session count, reported, Open in Registry) → client rows split WSL/Windows with identity, chips, bars, note (L617-668, seed L1977-2001) | machines.html `#machines` 4 client cells, 60s poll (machines.js) | M | P1 → P2 (L9) | S1, L9 | P1 ✅ S1 `70c32bb` (gate 36/36, max 0.033 %) · P2 ✅ L9 `9054f5b` (fixture gate 36/36 max 0.033 %, live 46/46) |
| D17 | Desktop sessions | filter row (search + accounts · machines · live · state selects, count, Reset); "Live now" group pinned first; per-person groups (email·acct, machine chip); table Conversation / Last activity / Status / Action; row title, branch, model chip, where, when/turns, Live/Offline pill, Show · Message · Copy context · Copy conversation; expand → Created / CLI session / Session / Full path (L670-735, seed L1315-1330) | sessions.html filters, status line, `#session-composer`, groups by account, transcript, copy context/transcript, 30s poll (sessions.js) | M | P1 → P2 (L10) | S1, L10 | P1 ✅ S1 `70c32bb` (gate 36/36, max 0.033 %) · P2 ✅ L10 `3bdcaf5` (fixture gate 36/36 max 0.033 %, live 33/33) |
| D18 | Landing | fixed nav (Deck¹⁴ · App · Registry · Certs · Docs · theme · Request access), hero (kickers, blurb, eyebrow, "Attach. Steer. Audit.", session widget "german-box · HOLDER OK · 12 ACTIVE · Open the deck"), 80vh spacer, Capability ("Registry On Demand", "Nothing runs unwatched.", 3 numbered cards), video-scrub canvas, reveal animations (L37-139, L969-1200) | none | L | P1 (free in S1) → P2 route (L1) | S1, L1 | P1 ✅ S1 `70c32bb` (gate 36/36, max 0.033 %) · P2 ☐ |
| D19 | Investor deck | 5 slides, dot pager, arrow/space nav, word/blur animations, per-slide video (L819-963, L2000-2100) | none | M | P1 (free in S1) → P2 route (L1) | S1, L1 | P1 ✅ S1 `70c32bb` (gate 36/36, max 0.033 %) · P2 ☐ |
| D20 | View switching + back pill | root `state.view` land/app/deck, "← fleetdeck" back pill bottom-right (L965, L2124-2133) | separate pages | S | P2 (L1) | L1 | ✅ L11 `8f95eb2` + L11.1 `6e7f27f` (routes live, gate 36/36, live smoke 30/30) · rider L11.2 open (hash on nav) |

## Behaviour contract (P2 must keep all of this working exactly as today)

| Area | Current behaviour to preserve | Source |
|---|---|---|
| Tiles | 1 WebSocket per tile `/term?host&session&cols&rows`; fit addon + ResizeObserver → `{type:"resize"}`; stall/dead overlays with reconnect; copy-on-select; closing a tile never kills the session; Connect all opens live non-hidden sessions with 500 ms stagger | app.js:1020-1179, 1241-1249 |
| Maximize | one `.max` tile at a time; shift+Esc restores; sidebar list switches sessions while maximized | app.js:860-863, 1007-1011, 1140-1145 |
| Sessions list | `GET /api/sessions`; grouped by host; hidden rows toggle (`showHidden`); manual Refresh | app.js:182-186, 876 |
| Health / accounts mini | `GET /api/health` pills; `GET /api/credits` bars | app.js:99-158 |
| Registry | `GET /api/sessions`; filters persisted `fleetFilter`; tab `fleetTab`; sort `fleetSort`; inline edits → `POST /api/registry`; kill → `POST /api/kill`; forget → `POST /api/registry/delete`; bulk kill/forget | app.js:465, 614-830 |
| Org chart | `GET /api/sessions` + `GET /api/seats` → `FleetOrgChart.buildTree`; 30 s poll while open + 1 s countdown; `?orgFixture=1` loads `orgchart-m11.fixture.json` | app.js:189-205, 253-392, 1255-1259 |
| Message bus | `GET /api/messages?limit=50` (rows + targets); `POST /api/messages`; `POST /api/messages/retry` | app.js:911-979, 1214-1233 |
| SSH keys | `GET /api/sshkeys`, `POST /api/sshkeys/mint`, `POST /api/sshkeys/delete`, `GET/POST /api/ghtrain`, `POST /api/ghtrain/end`; 30 s poll | keys.js |
| Accounts | `GET /api/credits[?refresh=1]`; errors panel | accounts.js:239 |
| Machines | `GET /api/machines[?refresh=1]`; 60 s poll | machines.js:222-232 |
| Desktop sessions | `GET /api/desktop-sessions[?refresh=1]`, `GET /api/desktop-sessions/transcript`, `POST /api/messages`; copy context / copy conversation; 30 s poll when visible | sessions.js:150-342 |
| Theme | persisted; `syncTheme` sets `data-theme` | app.js:12, 52-64 |
| Security | Host/Origin gate unchanged; no new endpoints without seat fencing | server.js:584-585 |

## Binding map (mock seed field → real API field)

| Mock array | Field | Real source |
|---|---|---|
| `tiles[]` | name, box, foot1/foot2, lines | live tile = xterm; name/host from `/api/sessions` row `name`/`host`; footer = registry `label`/`role`/`task` (decide in L3) |
| `groups[]` | box, n, sessions[] | `/api/sessions` grouped by `host`, `live` rows |
| `regData[]` | s, g, tk, st, active, msg, seen, gone | registry row `name, group, task, status, active_at, msg_at, last_seen_at, !live` |
| `busSessions[]` / `seedThreads` | id, name, host, live, pinned; msg dir/from/at/status/per/err/text | `/api/messages` rows `id, source, target{type,host,session}, text, status, error, created_at, delivered_at`; pinned/unread = client-side |
| `orgCard()` | name, on, role, path, grp, epoch, lease, age, exp | registry row `name, live, role, note?, group, epoch, lease_state, active_at, expires_at`; seats from `/api/seats` |
| `keyRows[]` | name, fp, comment (type hard-coded ED25519) | `/api/sshkeys` keys; certs + train from the same + `/api/ghtrain` |
| `accounts[]` | prov, name, email, id, plan, live, bars, trendPts | `/api/credits` entries (`state, weekly, secondary, credits, plan, snapshot_ts` or `windows{}`); **trend history does not exist server-side** (O6) |
| `machines[]` | name, kind, sessions, cols[].client, sections | `/api/machines` `machines[]` (`id, label, os, route, sessions, state, reported_at, clients[]`) |
| `dsData[]` | title, path, branch, model, when, turns, created, cli, sid, live | `/api/desktop-sessions` rows (`title, cwd, worktree, branch, model, lastActivityAt, completedTurns, createdAt, cliSessionId, id, isArchived`) |

## Open items for the operator (design gaps — not decided here)

| # | Item | Why it matters | Default if no answer |
|---|---|---|---|
| O1 | Windows empty state: the mock always shows 4 tiles; no "no terminals open" design | current app has one (index.html:37) | keep current copy, styled with mock tokens, hidden while tiles exist |
| O2 | Tile ☰ "switch" button: mock footer hint says "≡ switch" but the tile header has no ☰ | current drawer-switch lives on ☰ | ≡ moves to the full-screen header menu only (mock L781-790) |
| O3 | Registry Details tab + inline edits (label/role/note/task) are absent in the mock | functionality loss | keep edits behind the row "⋯" menu |
| O4 | Org chart source badge (live / fixture / pending) absent | dev diagnostic | fold into the header "Live API" pill text |
| O5 | External assets: Google Fonts Inter, wikimedia provider logos, CloudFront videos | deck runs on loopback; offline = blank fonts/logos | P1 verbatim keeps URLs; P2 L1 vendors Inter + logos, videos stay remote |
| O6 | Accounts 7-day sparkline needs usage history the server does not keep | needs a server-side snapshot ring (rider) | hide the sparkline until history exists |
| O7 | Landing + investor deck: build yes (free in S1), but where hosted and which route | deck server is loopback-only | `/landing.html`, `/deck.html`; app stays at `/` |
| O8 | Registry "Message" row action and desktop-session "Message" action → open bus thread? | mock implies it | yes, deep-link into the bus thread |
| O9 | SSH keys: principal chips (root/vibe) source; "Kill now" on an active cert = delete? | current has free-text principals | chips from hosts.json users; Kill now = `/api/sshkeys/delete` |
