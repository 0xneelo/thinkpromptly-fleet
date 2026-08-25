# XYZ-1742 — registry routes now on the tailnet listener

**Status: done.** Commit `89ce887` on `main`, local only (not pushed). The live
process on 3131 was never touched — the fix goes live at the next operator
restart (train-window expiry).

## What changed (server.js, one file)

- `server.js:485` — new `registryRoute(req, res, p)`: the registry POST
  handling (`/api/registry`, `/api/registry/delete`), extracted so both
  listeners share one validator. Same Origin gate, same body validation.
- `server.js:526` — loopback listener calls `registryRoute`. `/api/kill`
  keeps its own block and its own `HOSTS()`-only check, because kill
  reaches for ssh.
- `server.js:681` — tailnet handler mounts the same two registry routes.
  Kill is NOT mounted on the tailnet; trains still start loopback-only.
- `server.js:491` — second gap: registry accepts host `"mac"` so Mac-local
  lanes can register. Registry-only: the ssh polling loops (`sessions()`,
  `health()`) still read fleet hosts from `hosts.json`, and `/api/kill`
  still rejects `mac` (400).

Repo had no git history; commit `2909d1c` is a pristine baseline taken
before the fix, so `git show 89ce887` is the exact diff. `.gitignore`
excludes `deploy-keys/github-app.env`, `*.pem`, `fleet.db*`, logs,
`node_modules/`.

## How verified (no contact with the live process)

Ephemeral copy in the session scratchpad with its own `fleet.db`,
`PORT=3199 node server.js`, then a curl matrix:

| Check | Result |
|---|---|
| tailnet POST `/api/registry` host=german-box | 404 → **200**, row written |
| tailnet POST `/api/registry` host=mac | **200**, row written |
| tailnet GET `/api/registry` | 405 (route mounted, method gated) |
| tailnet POST `/api/kill` | 404 (kill stays loopback-only) |
| tailnet POST, foreign `Origin` header | 403 |
| tailnet POST, bogus host | 400 unknown host |
| tailnet GET `/api/ghtoken` | unchanged (503 no-train, still routed) |
| tailnet POST `/api/registry/delete` | 200 |
| loopback POST `/api/kill` host=mac | 400 (mac never reaches ssh) |

Test instance identified by port (`lsof -iTCP:3199`) and killed by PID;
3131/PID 4413 confirmed listening before and after.

## Operator: confirm after the restart

```bash
curl -s -w ' [%{http_code}]\n' -X POST http://100.125.231.25:3131/api/registry -d '{"host":"mac","name":"post-restart-check","status":"active"}'
```

Expect `{"ok":true} [200]` (was `not found [404]`). Cleanup:

```bash
curl -s -X POST http://100.125.231.25:3131/api/registry/delete -d '{"host":"mac","name":"post-restart-check"}'
```

Note: registry status values are `active, done, kill-requested, killed,
hidden` — a payload with any other status now gets that 400 message
instead of a 404, which is itself proof the route is live.

— Quirin (fullstack-developer)
