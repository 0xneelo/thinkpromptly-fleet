# Lane 2 tests

Two harnesses. Run both from the repo root.

| Script | Runs against | Cases |
|---|---|---|
| `run-tests.sh` | `stub-server.js`, the contract mock | 17 |
| `integration-lane1.sh` | Lane 1's real `server.js`, read from branch `agent-edith` | 7 |

**Never point a test at the operator's live deck** (`100.125.231.25:3131` from the box,
`localhost:3131` on the Mac). Both harnesses refuse to start unless the target is loopback
on their own disposable port, and neither will use port 3131.

```sh
sh box/hooks/test/run-tests.sh
sh box/hooks/test/integration-lane1.sh
```

Both need `tmux`: without it the M5 second liveness sample always reads "dead", every
suspect row silently reaps, and the `pinger_dead` case cannot fail. They refuse to run
rather than report a green suite that proved nothing.

## `stub-server.js`

A dependency-free mock of the FROZEN contract
(`docs/goals/xyz-1742-fleet-lifecycle/CONTRACT.md`). In-memory only: no sqlite, no
`fleet.db`, no files. Node 18+ core, no npm install. It is **not** the real server — Lane 1
(`server.js`, Edith) owns that.

```sh
FD_STUB_PORT=3199 FD_STUB_TTL_S=6 FD_STUB_REAP_TICK_S=1 node box/hooks/test/stub-server.js
```

| Env | Default | Meaning |
|---|---|---|
| `FD_STUB_PORT` | `3199` | listen port (binds `127.0.0.1` only) |
| `FD_STUB_TTL_S` | `90` | lease TTL; suspect window `2*ttl_s` |
| `FD_STUB_REAP_TICK_S` | `30` | reaper tick — its own contract number (S2), not `ttl_s/3`; `run-tests.sh` sets it to 1s so the suite stays short |
| `FD_STUB_TAILNET_KEY` | unset | when set, POSTs need `Authorization: Bearer <key>` or get 401, mirroring Lane 1's tailnet gate (S3) |

Contract routes: `POST /api/lease/claim`, `POST /api/heartbeat`, `GET /api/sessions`,
`GET /api/health`. All timestamps are integer unix-ms. `claim` validates `host` and `name`
with the same rule as the real server (`host === 'mac' || hosts.json`, `SAFE_NAME`
`^[A-Za-z0-9_-]{1,64}$`) so a body the stub accepts is one the backend accepts.

### Where the stub deliberately matches Lane 1 over the contract

A heartbeat for a `(host,name)` with **no row at all** returns **404**, not 409. That is what
Lane 1 does, and the difference is load-bearing: 409 stops a pinger permanently, 404 is
transient. The stub returned 409 until integration caught it — which would have stopped every
pinger in the fleet after a deck restart with an empty database. The contract only specifies
409 for a missing or stale epoch on a row that **exists**, so this is a gap it does not cover.

`GET /api/sessions` rows carry one **stub-only extra**, `reaped_at` — handy for tests, not
part of the contract's read surface. Lane 1's 200 bodies carry an extra `ok:true`, which the
stub does not emit; nothing parses it.

### Test-control routes

Stub-only, not in the contract, and always served normally even in `down`/`slow` mode so the
harness can always recover the stub:

| Route | Body | Effect |
|---|---|---|
| `POST /_test/reset` | — | wipe all state, mode back to `normal` |
| `POST /_test/reap` | `{host,name}` | force `lease_state='reaped'` |
| `POST /_test/expire` | `{host,name}` | push `expires_at` into the past |
| `POST /_test/mode` | `{mode}` | `normal` \| `flaky` (every 2nd contract req 500) \| `down` (503) \| `slow` (2s) |
| `POST /_test/tailnet_key` | `{key}` | arm or clear the bearer gate under already-running pingers |
| `GET /_test/state` | — | all rows + per-session beat log (unix-ms) + counts |

## `integration-lane1.sh`

Stands up a **disposable** instance of Lane 1's server — `git show agent-edith:server.js`,
its own `fleet.db`, its own `hosts.json`, loopback only. Edith's branch is never modified.
It sets `FLEET_SSH_BIN=/bin/false`, so the reaper it drives can never ssh, kill a tmux
session, or close a worker name.

It exercises the real claim/heartbeat/409/410 paths and the real tailnet 401 gate. The gate
is reached by binding a second loopback address (`FLEET_TAILNET_BIND`/`FLEET_TAILNET_HOST`),
because this box cannot bind the Mac's tailscale address — the handler and its checks are
the real ones, nothing is stubbed.

**Not covered on the box:** Lane 1's ssh warn-and-kill sequence for a `german-box` row. With
ssh disabled such a row can only reach `suspect`, so the 410 path is proven through a
`host=mac` row, which takes the identical reaper path without ssh (M4). `heartbeat()`
answers 410 on any reaped row regardless of host, so the pinger side is fully covered.
