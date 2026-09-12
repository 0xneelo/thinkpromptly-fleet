# Linear MCP proxy in fleetdeck — findings brief (🔬 RESEARCHER 3, 2026-09-06)

**Ask (operator):** "our agents keep losing their linear mcp connections — build a proxy into the fleetdeck."

**Verdict:** build it. The proxy is ~150 lines in the deck, no OAuth code at all, and it removes the
root cause instead of the symptom. Ready for a worker; spec in §4.

## 1. Root cause (proven)

| # | Finding | Evidence |
|---|---|---|
| 1 | Workers reach Linear as a per-session **OAuth** HTTP MCP (`https://mcp.linear.app/mcp`). Tokens expire on a ~day scale. | `~/.claude/skills/linear/SKILL.md:9-15`, `~/.claude/skills/german-box-workers/SKILL.md §9` |
| 2 | Re-auth needs a browser **on the box** = RDP only, one-shot `start-auth` links, tmux line-wrap breaks the URL. Four documented failure modes. | `german-box-workers/SKILL.md §9` (2026-08-14) |
| 3 | Codex (GPT) workers hit `AuthRequired … invalid_token` from `mcp.linear.app` at start. | `german-box-workers/SKILL.md §6.5`; Mac `~/.codex/config.toml` `[mcp_servers.linear]` has url only |
| 4 | Today the box's `~/.claude.json` has **zero** linear entries (top level + all 10 projects). Workers add it ad hoc, or go without and use the never-block fallback. | reader pull of `gb:/home/vibe/.claude.json` 2026-09-06 |
| 5 | Desktop seats flapped too (NOT connected 08-29 → connected 08-30). | `HANDOFF-2026-08-29-o17.md:77`, `docs/goals/HANDOFF-2026-08-30-o12-to-next.md:100` |
| 6 | **Linear's MCP server accepts a Linear API key directly** as `Authorization: Bearer <key>` — no OAuth hop. A read-only key gives read-only access. | https://linear.app/docs/mcp FAQ "Can I authenticate with my own API keys or OAuth access tokens?" |
| 7 | Auth server metadata: issuer `https://mcp.linear.app`, DCR at `/register`, `refresh_token` grant supported. Not needed once (6) is used. | `https://mcp.linear.app/.well-known/oauth-authorization-server` |
| 8 | Unauthenticated probe: `401` + `WWW-Authenticate: Bearer realm="OAuth", resource_metadata=…, error="invalid_token"`. A 401 from ANY server makes Claude Code start an OAuth dance against it. | probe 2026-09-06 |
| 9 | Claude Code reconnects dropped HTTP MCP servers with backoff (5 tries) but does **not** re-auth on 401 unless a `headersHelper` is configured. | https://code.claude.com/docs/en/mcp |

So "losing the connection" = the OAuth token died and nothing on the box can renew it without a human at an RDP browser.

## 2. Why a deck proxy and not "API key on every box"

Fact 6 alone would let each box carry `Authorization: Bearer ${LINEAR_API_KEY}` to `mcp.linear.app`. Rejected because fleet doctrine says **boxes hold no standing third-party credential** (operator ruling 2026-08-15 for GitHub: the train broker on the Mac mints 1h tokens; the box has nothing). A write-capable Linear key on a box = one box compromise leaks the workspace. The proxy keeps that shape:

- deck holds ONE Linear API key (`~/.fleetdeck-linear-key`, 0600 — same pattern as `~/.fleetdeck-bus-token`);
- workers carry only the **bus token** they already have in `~/.claude/fleet/fleet.env`;
- rotation and revocation happen in one place; the deck logs one line per Linear call (who/what/status);
- read-only variant for free (`/mcp/linear/readonly` → upstream `/mcp/readonly`).

Existing precedent to copy: `server.js` `trainProxy` (~1645) for `/api/ghtoken` — except that one buffers; this one must **stream** (MCP answers can be SSE).

## 3. Deck facts a builder needs (verified 2026-09-06)

- Two listeners: loopback `http.createServer` ~`server.js:2216`; tailnet `tailnetHandler` ~`2451`. Route dispatch is an if-chain per listener.
- Tailnet S3 gate ~`2458`: `POST && !BUS_ROUTES.has(p) && !notifyPath(p) && !tailnetAuthed(req) → 401`. Bus routes are exempt because one header cannot equal two secrets (XYZ-1888 comment). The MCP route needs the same exemption, then `busAuthorized(req)` (~537).
- Helpers: `send(res, code, type, body)` ~1867, `json(res, obj, code)`, `body(req, max)` ~1839.
- Test harness: `test/http.js` `startServer(env)` boots a real deck on 127.0.0.1 + 127.0.0.2; `test/train-proxy.test.js` + `test/fake-github.js` = fake-upstream pattern; `test/bus-tailnet-auth.test.js` = bus token + `FLEET_TAILNET_KEY` in tests.
- Box side: `box/fleet-env-set.sh` writes `fleet.env` (holds `FLEETDECK_BUS_TOKEN`, `FD_BASE_URL=http://100.125.231.25:3131`); `box/hooks/fd-common.sh:34-55` = how scripts source it. Box scripts are installed with `ssh german-box "wsl tee /home/vibe/bin/<name>" < box/<name>`; remote command strings may hold ZERO quotes.
- Codex 0.153: `codex mcp add linear --url <URL> --bearer-token-env-var FLEETDECK_BUS_TOKEN` (env var must reach the codex process; check `box/hooks/fd-codex-wrap.sh`).
- Streamable HTTP MCP: POST JSON-RPC with `Accept: application/json, text/event-stream`; reply is JSON or SSE; 202 empty for notifications; `Mcp-Session-Id` echoed on later requests; `MCP-Protocol-Version`; GET = server→client SSE (or 405); DELETE ends a session; 404 = stale session, client re-initializes.

## 4. Build spec (one worker, one lane)

**Files:** new `linear-proxy.js`, `test/fake-linear-mcp.js`, `test/linear-proxy.test.js`, `box/fleet-linear-mcp.sh`; edit `server.js` (mount only), `README.md` (one paragraph after the GitHub-train one).

**`linear-proxy.js`** exports `{ LINEAR_ROUTE:'/mcp/linear', linearPath(p), linearProxy(req,res,p) }`.
- Upstream base `FLEET_LINEAR_MCP_URL || 'https://mcp.linear.app'`; `http`/`https` by protocol; keep-alive agent.
- Key: `FLEET_LINEAR_API_KEY` env, else read `FLEETDECK_LINEAR_KEY_FILE || ~/.fleetdeck-linear-key` **on every request** (rotation without a deck restart — `up.sh` is operator-only). Missing → 503 `{ok:false,error:'deck has no Linear credential: …'}`.
- Path map `/mcp/linear`→`/mcp`, `/mcp/linear/readonly`→`/mcp/readonly`, else 404. Methods POST/GET/DELETE, else 405.
- Upstream request headers: whitelist `content-type, accept, mcp-session-id, mcp-protocol-version, last-event-id, content-length`; set `authorization: Bearer <key>`, `host`, `user-agent: fleetdeck-linear-proxy`. Never forward the client's authorization or cookies.
- Body: pipe req→upstream, 2 MB cap (413 if over and headers unsent). GET/DELETE: `end()`.
- Response: `res.writeHead(status, whitelist: content-type, mcp-session-id, mcp-protocol-version, cache-control, content-length)`, `flushHeaders()`, `up.pipe(res)`. **Upstream 401/403 → 502 JSON** naming the deck credential; **never emit `www-authenticate`** (fact 8). Log that case at most once / 60 s.
- Upstream headers timeout 30 s, cleared on `response`; NO idle timeout after headers (SSE may sit quiet). Error before headers → 503 JSON; after → `res.destroy()`. `res.on('close', () => up.destroy())`.
- One log line per request, no bodies, no tokens: `linear-proxy POST /mcp 200 84ms`.

**`server.js`:** `require('./linear-proxy')`; loopback chain: `if (linearPath(p)) { if (!busAuthorized(req)) return send(res, 403, 'text/plain', '…bus token…'); return await linearProxy(req, res, p); }` — **403 not 401** on purpose (fact 8), say so in a one-line comment. Tailnet: add `&& !linearPath(p)` to the S3 exemption (extend the XYZ-1888 comment by one sentence) + the same gated dispatch. Nothing else.

**`box/fleet-linear-mcp.sh`** (POSIX sh, idempotent, master copy in `box/`): source `fleet.env` the fd-common way; need `FLEETDECK_BUS_TOKEN` (exit 2 if missing) and `FD_BASE_URL`; `URL=$FD_BASE_URL/mcp/linear`; Claude: `claude mcp remove -s user linear || true; claude mcp add -s user --transport http linear "$URL" --header "Authorization: Bearer $FLEETDECK_BUS_TOKEN"`; Codex if on PATH: `codex mcp remove linear || true; codex mcp add linear --url "$URL" --bearer-token-env-var FLEETDECK_BUS_TOKEN` (+ export the var in `fd-codex-wrap.sh` if it does not already). Print URL only, never the token.

**Tests** (real deck via `startServer`, `FLEET_LINEAR_MCP_URL`→fake, `FLEET_LINEAR_API_KEY=test-key-123`, known `FLEETDECK_BUS_TOKEN`, tailnet listener unless stated):
1. initialize → 200; fake saw `Bearer test-key-123`, path `/mcp`, `accept` + `mcp-protocol-version` forwarded, no `cookie`; client got `mcp-session-id`; a second call echoes it upstream.
2. missing/wrong bus token → 403, no `www-authenticate`, fake saw nothing.
3. `FLEET_TAILNET_KEY` armed → bus token alone still passes (S3-exempt).
4. SSE POST streams: first event arrives before the fake sent the last; `text/event-stream` passed through.
5. fake rejects the key → 502 JSON mentioning the credential, no `www-authenticate`.
6. no deck key → 503 JSON.
7. `/mcp/linear/readonly` → `/mcp/readonly`; `/mcp/linear/other` → 404; PUT → 405.
8. client aborts a GET SSE stream → fake's socket closes within 1 s.
9. loopback listener: same 403 gate.
10. upstream port closed → 503 JSON.
`npm test` green, `node --check` on every changed file.

**Docs (same lane):** README paragraph; then `~/.claude/skills/linear/SKILL.md` "Connection" section and `~/.claude/skills/german-box-workers/SKILL.md §9` rewritten to: run `/home/vibe/bin/fleet-linear-mcp.sh` once per box; no OAuth, no RDP; a 502 from the deck = operator rotates `~/.fleetdeck-linear-key`.

## 5. Operator steps (human-only gates)

1. Create a Linear personal API key: linear.app → Settings → Security & access → API keys. Write scope for workers that comment/claim; a second Read-only key is optional.
2. On the Mac: `umask 077; printf '%s\n' '<key>' > ~/.fleetdeck-linear-key` (never paste the key into a chat or a `ps`-visible argv). The deck reads it per request — no restart.
3. After the lane lands: install `fleet-linear-mcp.sh` on the box with the three `tee`/`chmod`/run lines from the README, once.

## 6. Out of scope / later

- Stale-session 404 healing (proxy replaying `initialize` so a worker never sees a dead `Mcp-Session-Id`) — add only if it shows up after the auth fix.
- Per-worker attribution in Linear (all comments post as the key's owner, same as today's OAuth).
- A separate launch agent like the train broker is unnecessary: sessions live at Linear, the key lives in a file, so a deck restart costs one failed call and Claude Code's own retry covers it.
