# Lane 2 test stub

`stub-server.js` is a dependency-free mock of the FROZEN fleet-lifecycle contract
(`docs/goals/xyz-1742-fleet-lifecycle/CONTRACT.md`), for testing the detached pinger before
Lane 1's real backend (`server.js`, Edith) lands. In-memory only: no sqlite, no `fleet.db`,
no files. Node 18+ core, no npm install.

**Never point a test at the operator's live deck** (`100.125.231.25:3131` from the box,
`localhost:3131` on the Mac). Always use the stub's own port.

```sh
FD_STUB_PORT=3199 FD_STUB_TTL_S=6 node box/hooks/test/stub-server.js
```

| Env | Default | Meaning |
|---|---|---|
| `FD_STUB_PORT` | `3199` | listen port (binds `127.0.0.1` only) |
| `FD_STUB_TTL_S` | `90` | lease TTL; reaper ticks every `ttl_s/3`, suspect window `2*ttl_s` |

Contract routes: `POST /api/lease/claim`, `POST /api/heartbeat`, `GET /api/sessions`,
`GET /api/health`. All timestamps are integer unix-ms.

Test-control routes — **stub-only, not in the contract**, and always served normally even in
`down`/`slow` mode:

| Route | Body | Effect |
|---|---|---|
| `POST /_test/reset` | — | wipe all state, mode back to `normal` |
| `POST /_test/reap` | `{host,name}` | force `lease_state='reaped'` |
| `POST /_test/expire` | `{host,name}` | push `expires_at` into the past |
| `POST /_test/mode` | `{mode}` | `normal` \| `flaky` (every 2nd contract req 500) \| `down` (503) \| `slow` (2s) |
| `GET /_test/state` | — | all rows + per-session beat log (unix-ms) + counts |
