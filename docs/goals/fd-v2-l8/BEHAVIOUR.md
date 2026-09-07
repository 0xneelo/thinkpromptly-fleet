# fd-v2-l8 — behaviour inventory: Accounts (credits)

Extracted 2026-09-07 from `public/accounts.html`, `public/accounts.js`, `server.js` by a reader. Ledger D15. Ruling: plot `row.history`; Codex rows have none.

## 1. Data

- `GET /api/credits[?refresh=1]` (`server.js:2768-2769`): `refresh=1` forces `creditsCollect(true)`; otherwise a 60 s TTL cache (`CREDITS_TTL`, `:1165,1562`). No `collecting` flag (the request awaits the fan-out).
- Row (`creditsRows`, `server.js:1515-1556`; sample `docs/design/fleetdeck-v2/fixtures/api/credits.json`): `kind ('claude'|'codex'), id, host, updated_at, source ('oauth'|'desktop'|'push'|'codex'), org, email, label, confirmed, tier|type, state (ok|token_expired|rate_limited|error|absent), windows{name:{pct,resets_at,stale?}}` (claude), `weekly, secondary` (codex), `credit{used,limit,decimals,currency,enabled,capped}` (claude), `credits{has_credits,unlimited,balance}` (codex), `seen[{host,source}]`, `history[{t,fh,sd,xu}]` (claude only, ≤120 points), `sample_ts`, `stale_windows`.
- `errors[]` = `{host, message}` (≤500 chars). Window ageing (`:1493-1513`): `five_hour` 2 h, `seven_day` 24 h, `extra` 7 d → `pct:null, stale:true`, `stale_windows:true`.

## 2. Summary bar (`accounts.js:199-217`)

`"<N> account(s)"` · `"<hit> at or over a limit"` (any window/weekly/secondary `pct>=100` or `credit.capped`) · `"spent $X · $Y"` per currency or `"no credits spent"`. Privacy note (`accounts.html:13-18`): *"Usage per AI account, most constrained first. Every machine reads its own token locally and reports only percentages — no access token ever leaves the machine that owns it. The trend line is the Claude desktop app's own samples, merged across machines. Names and org mapping live in `credits-accounts.json`."*

## 3. Card (`accounts.js:119-195`)

- Header: pill colour green (`source && state==='ok'`) / amber (`source`) / none, text `kind`; `.who` = `label||email||id`; email muted; org uuid first 8 chars mono; plan pill `TIER[tier]` or verbatim; codex `plan` pill; source text `SOURCE[source]` (`live` / `desktop snapshot` / `push`) + `" · usage from <windows_from>"`; `"unconfirmed mapping"` (amber) when `!confirmed`; right side `"<ago> · <push|host>"` from `updated_at`.
- `ago`: `just now` / `Nm ago` / `Nh ago` / `Nd ago`; `age-amber` >1 d, `age-red` >3 d.
- No data: `"no data yet — run push from their machine"` (no bars).
- Banners: `token_expired` → `"token expired — open Claude Code on <host>"`; `rate_limited` → `"usage endpoint busy on <host> — figures below are the last good read"`; `error` → `"could not read usage on <host>"`.
- Stale note: `"sampled <ago> — older than the window it measured, so these have reset since"` (`stale_windows`) or `"sampled <ago> — no reset times in this source"`.
- Bars (claude): windows ordered `five_hour, seven_day, …extra last`; labels `5 hour`, `7 day`, `extra usage`, `weekly`, `session`, `seven_day_<x>` → `"7 day <X>"` (e.g. `7 day Fable`); fill `clamp(pct)`; red >90, amber ≥70; pct text or `—`; right `resets now` / `resets in Nm` / `Nh Nm`. Codex: `weekly`/`secondary` bars.
- Credits line: `"credits: X.XX / Y.YY <CUR>"` + `" · spend limit reached"` (capped, class notice) + `" · extra usage off"` (`!enabled`); codex `"credits: unlimited"` or balance.
- Trend (`spark`, `:88-117`): points with numeric `sd`; <2 → `"no history yet"`; SVG `viewBox 0 0 100 28`, x time-scaled, y `28-(sd/100)*28`, polygon + polyline, class `spark <level(lastSd)>`, tooltip `"N days, M samples"`, right label `<lastSd>%`. Claude rows only.
- `"seen on <host> · <source>, …"` when `seen.length`.
- Ordering: `worst(r)` desc (max pct over main windows; null last) = "most constrained first".

## 4. Errors panel, refresh, keys

- `#errors-panel` lists `"<host>: <message>"`. No polling; Refresh → `load(true)`; failure → `"cannot reach fleetdeck"`. No localStorage. Old ids: `#summary #accounts #errors-panel #errors #refresh`.

## 5. Mock counterparts (D15) and improvisations

- Mock (L568-615, seed L1936-1964): summary bar + privacy note; collapsible cards (chevron, provider pill, name, email, id, plan pill, live status, right timestamp); expanded: banner, stale note, bars, 7-day sparkline `trendPts`, "seen on".
- Map: header ⇄ head row; `right` = `"<ago> · <host|push>"`; bars ⇄ `bars[]` (label, pct, resets); `trendPts` ⇄ `history[].sd` (Codex: omit the sparkline block); banner/staleNote ⇄ the texts above; `seen` ⇄ seen line.
- Improvise and document: default expanded state (suggest: rows at/over a limit expanded, others collapsed; or all expanded like today — pick one); ordering worst-first kept; the `no data yet` row; the credits line placement; provider logo files from `/v2/media/`.
- diff.md O6 is superseded: history exists; plot it.
