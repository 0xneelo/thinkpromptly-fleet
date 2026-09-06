# fd-v2-l3 — behaviour inventory: terminal tiles + full screen

Extracted 2026-09-07 from `public/app.js`, `public/index.html`, `public/style.css`, `server.js` by a reader.
The new Windows screen and the "Session full screen" overlay (ledger D09, D10) must preserve all of this.

## 1. Tile lifecycle (`app.js:1007-1158`)

- `openTile(host, session)` (`:1020`): dedupe key `host+'\0'+session` (`:67`); existing tile → no-op, no reconnect (`:1022`).
- Callers: sidebar row click when not maximized → `openTile`; row click while `body.has-max` → `openMax` (drawer = switcher) (`:861-864`); sidebar row `⤢` (`.rowmax`) always → `openMax` (`:854-857`); Registry "Show" → `openMax` (`:856`); Connect all → `openTile` per session, sequential, 500 ms stagger (`:1241-1250`).
- `openMax(host,session)` (`:1013-1018`): `openTile`, then `toggleMax(tile)` if not already `.max`, then remove `drawer-open`.
- Close (`:1149-1158`): `ro.disconnect()`, `ws.onclose=null`, `ws.close()`, `term.dispose()`, `tile.remove()`, `tiles.delete(k)`, `syncMaxBody()`, `sync()`. **Sends nothing, calls no API; the remote tmux session survives.**
- One maximized tile at a time: `toggleMax(tile)` (`:1007-1011`) sets the new one first, then `setMax(t,false)` on every other `.tile.max` (avoids `has-max` flicker).
- `setMax(tile,on)` (`:997-1005`): toggles `.max`; `.maxbtn` text `⤡`/`⤢`, `aria-label` Restore/Maximize, `title` `"Restore (shift+esc)"` / `"Maximize (shift+esc restores)"`; `syncMaxBody()`; dispatches custom `refit` event.
- `syncMaxBody()` (`:990-994`): `body.has-max` ⇔ a `.tile.max` exists; none → also drop `drawer-open`.
- Keyboard: **shift+Esc only** (plain Esc must reach tmux/vim): `term.attachCustomKeyEventHandler` (`:1126-1132`) → `toggleMax` and swallow when maximized.
- Drawer while maximized: `☰` (`.menubtn`, visible only on `.max`, `style.css:604-605`) toggles `body.drawer-open` (`:1028-1031`); bar double-click (not on a button) → `toggleMax` (`:1038-1040`); `#drawer-close` clears it (`:1163`); outside click clears it unless inside `#sidebar`/`.menubtn` (`:1166-1173`).
- CSS driven by body classes: `has-max` → sidebar fixed, off-canvas (`style.css:81-89`); `has-max.drawer-open` → sidebar slides in with shadow (`:90-93`); `#drawer-close` only under `has-max.drawer-open` (`:100-108`); `.tile.max` → `position:fixed; inset:0; z-index:50` (`:578-585`); `.tile.dead .term` → `opacity:.35; grayscale` (`:607`).

## 2. xterm setup (`app.js:1047-1062`)

- `new Terminal({ scrollback:5000, fontSize:12, theme:XTERM_THEME, macOptionClickForcesSelection:true })`.
- `XTERM_THEME` (`:4-9`): `{ background:'#1a1915', foreground:'#e8e6dc', cursor:'#d97757', selectionBackground:'rgba(217,119,87,0.3)' }` — **to be re-derived from the mock's tokens (mono body colours) and recorded in improvised.md.**
- Addons: `FitAddon`, `WebLinksAddon` (`:1054-1056`); `term.open(div.term)` appended after `.bar` (`:1041-1043,1057`).
- Copy-on-select: `onSelectionChange` → `navigator.clipboard.writeText` (`:1059-1062`).
- Focus: on `refit`, `term.focus()` only when maximized (`:1144-1147`).
- Resize: `ResizeObserver(sendResize)` on the tile (`:1140-1141`) + `refit` event; `sendResize` (`:1134-1138`) = `fit.fit()` then `ws.send(JSON.stringify({type:'resize',cols,rows}))` if open. `ws.onopen = sendResize` (`:1094`, re-send after handshake). Initial `cols/rows` in the WS URL from `term` after `fit.fit()` (`:1075`).

## 3. WebSocket protocol (`app.js:1087-1121`, `server.js:2878-2947`)

- URL `ws://${location.host}/term?host=<enc>&session=<enc>&cols=<n>&rows=<n>`.
- Client → server: JSON text only: `{type:'input',data}` on `term.onData` (`:1123`, only when `readyState===1`); `{type:'resize',cols,rows}`.
- Server → client: raw pty bytes passthrough; one control frame `{"type":"exit","code":n}` before `ws.close()` on pty exit (`server.js:2919-2923`).
- Client `onmessage` (`:1095-1100`): strings starting with `{"type":"exit"` are dropped; else `term.write(e.data)`; rolling `tail` of the last 2000 chars for lock detection.
- `onclose = die` (`:1101`). `die()` (`:1104-1121`): clear stall timer; no-op if an overlay exists; add `.dead`; overlay card `<h2>Disconnected</h2>`; if `tail` contains `"communication with agent failed"` (`AGENT_LOCKED`, `:3`) or `"agent refused operation"` → note `"1Password locked — unlock it, then Reconnect"`; button `Reconnect` → `term.reset(); connect()`.
- Stall: 15 s timer armed in `connect()` (`:1081-1086`) → `.stall` text `"no output — 1Password on this Mac may be locked or waiting for approval"`; cleared on any message (`:1096`) and on each `connect()`.
- No auto-reconnect, no backoff; manual Reconnect only. `connect()` resets `tail`, removes overlay/`.dead`, refits, re-arms the stall timer, opens a fresh WebSocket.
- Server: upgrade gate `ALLOWED_HOSTS` + optional `Origin` in `ALLOWED_ORIGINS` (`server.js:584-585, 2880-2881`); path exactly `/term`; `cols/rows` via `dim()` 1..1000 fallback 80/24 (`:588, 2886-2887`); `host ∈ HOSTS()`, `session` matches `SAFE_NAME=/^[A-Za-z0-9_-]{1,64}$/` else `ws.close(4400)` (`:581, 2891`); pty = `ssh -o BatchMode=yes -o ConnectTimeout=8 -t <host> 'tmux attach -t <session>'`, `xterm-256color` (`:2896-2903`); on ws close or pty exit `reap()` kills only the local ssh/pty (`:2910-2916, 2941`); messages: `input` → `term.write`, `resize` → `term.resize` (validated), bad JSON logged (`:2930-2939`).

## 4. Connect all (`app.js:1241-1250`)

Iterates `/api/sessions` order; skips `!s.live` and `status==='hidden'`; `openTile(host,name)` each; `await 500 ms` between opens (1Password agent refuses concurrent handshakes); no cap.

## 5. Empty state and chrome

- `#empty`: `"No terminals open — pick a session, Connect all, or <button id=empty-fleet>open the Registry</button>"` (`index.html:37`); `hidden = tiles.size>0` in `sync()` (`:76`). **Ruling: new copy "There are no sessions yet, open a new session via an orchestrator first." rendered in mock tokens; improvised.md entry + screenshot.**
- Tile bar (`:1024-1043`): `☰` `.menubtn` (aria/title `Sessions`, visible only maximized), `span.title` + nested `span.host` `" · <host>"`, `⤢` `.maxbtn` (aria `Maximize`, title `"Maximize (shift+esc restores)"`), `✕` `.x`. **Mock tile header: dot · name · box · ⤢ · × (no ☰); the ≡ switcher lives in the full-screen header menu (ruling O2).**
- Sidebar hint (`index.html:29`): `"detach = ctrl-b then d · closing a tile never kills the remote session · ⤢ fullscreen, ☰ switch, shift+esc back"` — the mock's footer text is the equivalent (`"… ⤢ fullscreen, ≡ switch, shift+esc back"`).

## 6. State and hooks

- No persistence of open tiles or max state (`tiles` Map in memory, `:39`).
- localStorage touched here: none tile-specific (`fleetTheme`, `showHidden` are shell keys).
- Old DOM ids/classes: `#grid #empty #sidebar #sessions #drawer-close #connect-all`; `.tile .tile.max .tile.dead .bar .title .host .term .overlay .card .stall .menubtn .maxbtn .x`; `body.has-max`, `body.drawer-open`; sidebar `.session(.open|.inactive) .rowmax .dot(.amber) .name`. New hooks are `data-*`/id only, never classes on mock markup.

## 7. Mock counterparts (D09, D10) and the fixture-mode contract

- Windows tile body: in **fixture mode** the template renders the seed `tl.lines` (pixel gate); in **live mode** the same box hosts an xterm mount sized to the mock's mono body (font-size/line-height/colours from the tokens), footer shows `foot1/foot2` from registry `label/role/task` (decide + document). The gate stays green in fixture mode; live mode is verified by an interaction test (open tile, resize, close) plus a screenshot filed under `verify/L3/` for the chrome.
- Full-screen overlay (mock L781-815): header ≡ menu lists `termSessions` (dot, name, host) = the old drawer switcher; `Message` → bus thread; `Close` → restore; Escape closes menu → terminal → maximized bus (mock L1238-1243); **shift+Esc must still restore** (old behaviour) — both bindings live together; document in improvised.md.
- Toast on inbound reply (D08) is L6's, not here.
