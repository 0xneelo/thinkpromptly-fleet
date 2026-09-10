# Linear pending — notify-seat-aliases

Seat 20 had no Linear MCP in its session on 2026-09-10; the worker files these on start (project `remote-system`, labels `agent:ysolde`, `project:remote-system`, `subproject:fleetdeck-notify`, `session:cli-worker`). If Linear is unreachable, keep them here with timestamps and file them when it is back.

1. `[Ysolde · backend-developer] title join for desktop sessions (M1)` — body: README.md §Plan M1.
2. `[Ysolde · backend-developer] resolve seat aliases on title, resolvedVia=title (M2)` — README.md §Plan M2.
3. `[Ysolde · backend-developer] fixture tests for seat alias resolution (M3)` — README.md §Plan M3.
4. `[Ysolde · backend-developer] decision note: per-project orchestrator seats (M4)` — label `operator:decision`, README.md §Plan M4.

## Execution ledger — Ysolde

2026-09-10: Initial Linear project scan failed with `oauth_token_invalid_grant`
(reauthentication required). All four issues above remain unfiled. Pending references
`PENDING-M1` through `PENDING-M4` identify their commits until real issue IDs exist;
no Linear issue IDs or status changes are claimed.

Identity: Ysolde (backend-developer), `agent-ysolde`; project `remote-system`,
sub-project `fleetdeck-notify`, session `FD-notify-seat-aliases`.
Labels for every pending issue/comment: `agent:ysolde`, `agent:agent-ysolde`,
`project:remote-system`, `subproject:fleetdeck-notify`, `session:cli-worker`.
M4 also carries `operator:decision`.

Registry initial POST and the subsequent `task: PENDING` POST both returned HTTP 401
`unauthorized`; neither requested row update was applied. No alternate credentials
were used. The orchestrator owns the pre-registered row.

M1 in progress: fixture title index and registry join. The box reports Linux and has
no desktop store. The README's Mac join key is the fixture contract; live verification
is deferred to seat 20 after weave. Ysolde performs reads, edits, and diff reviews
directly, without subagents, as explicitly required by the Codex launch override.

Signed: Ysolde

### PENDING-M1 — completion comment (2026-09-10)

Implemented `desktop-seat-titles.js`, the five-second lazy title cache, and joined
live registry `sessionId` to `cliSessionId` in `server.js`. Added the README env table.
Unit fixtures cover projection, TTL rename/archive/delete refresh, absent-store
recovery, malformed records, symlinks and duplicate keys. The initial test failed
because the new module was absent; after implementation, the new five tests plus
19 existing notify tests pass: **24 passed, 0 failed, 0 skipped**.

Self-review: full M1 diff reviewed by Ysolde; no unresolved findings. No dependency
or listener/auth changes. Linear milestone retry still requires reauthentication.
Pushed SHA will be recorded after push in the next ledger update and final report.

Signed: Ysolde
