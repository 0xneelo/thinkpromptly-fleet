# Goal — fleetdeck-portal API (Kendra · backend-developer)

Project **remote-system (fleetdeck)** · sub-project **coordinator portal API** · Linear team XYZ.
Operator intent (2026-08-29): *"there should be a fleetdeck-portal backend service that serves
everything to the portal via api"* — proven need: a `/portal` session outside the repo could not
read coordinator state (repo-bound portal failed for the operator the same hour).

**One line:** add `/api/coordinator/*` to the existing fleetdeck `server.js` (localhost:3131) so
🧭 portal sessions read coordinator state — and file intents — over HTTP from any directory or
machine on the tailnet, instead of requiring the repo checkout.

## Endpoints (v1, all under /api/coordinator)

| Route | Method | Serves |
|---|---|---|
| `/board` | GET | parsed `coordinator/board.json` |
| `/bundle` | GET | compacted boot bundle text — `coordinator/bundle.py` |
| `/exceptions` | GET | **live-computed** `exceptions.compute(board, now)` |
| `/northstar` · `/decisions` | GET | raw `northstar.md` / `decisions-effective.md` |
| `/gate` | GET | `{size, headroom, pct}` from `bundle.gate_report` |
| `/inbox` | GET | pending sitrep files: name, mtime, seat/lane/event if parseable |
| `/sitrep` | POST | validated intake → writes one `coordinator/inbox/<ISO>-<seat>-<lane>.md` |

## Binding constraints

1. **Live over snapshot.** Exceptions and bundle are computed fresh per request — never a stored
   `board["exceptions"]` snapshot (review finding F1 doctrine, 2026-08-29). Fresh-read is portal
   doctrine; no caching beyond an optional mtime check.
2. **Do not reimplement Python logic in JS.** Spawn `python3 coordinator/<script>` via async
   `execFile` with a timeout (same pattern as `ssh()` in server.js) — drift between JS and
   `bundle.py`/`exceptions.py` is the failure mode.
3. **Sitrep intake is strict.** Required keys per `coordinator/inbox/README.md` (`seat`, `lane`,
   `event`, `event_time`, `state`, `blockers`, `next_report`; `evidence` when `done-claimed`).
   Invalid → 400 with one-line reason, **nothing written** — never best-effort parse. The server
   writes the file only; it never commits and never touches `board.json`. Coordinator runs drain
   and commit, unchanged.
4. **No board mutation routes.** Read + inbox intake is the entire write surface. Ever.
5. **Existing behavior untouched:** no changes to existing routes, `public/board.html` stays the
   static committed render, `check.py` + all selftests stay green.
6. **POST origin policy** mirrors the existing POST routes (`ALLOWED_ORIGINS` check); GETs open
   like `/api/sessions`. Bind/tailnet exposure inherits the server's current posture.

## Acceptance

1. Every GET returns correct data against live repo state; a planted stale
   `board["exceptions"]` snapshot does NOT surface in `/exceptions` or `/bundle` (test it).
2. POST `/sitrep`: a valid payload lands a file that coordinator-run's strict parser accepts;
   each invalid case → 400 + reason, no file.
3. `coordinator-portal` skill (repo) updated: fresh-reads prefer the API, file fallback kept.
4. Tests follow the repo's existing conventions (`test/`, or a `--selftest` in the new module).
5. Report at `docs/goals/fleetdeck-portal-api/reports/kendra.md`; final `operator:gate` issue
   for the deck restart (`./up.sh` is operator-only — agent-started decks cannot sign certs).

## Base + deps

Branch base: `main` AFTER the agent-alistair weave (needs `bundle.py`/`exceptions.py`).
Work on branch `agent-kendra`. Blocked-by: XYZ-1839.

## Protocol (execution — short form)

You are Kendra, a backend-developer. Badge `🔨 WORKER · Kendra`; tag `agent-kendra`; sign
reports as Kendra. One Linear issue per subtask (`[Kendra · backend-developer]` prefix, labels
`session:cli-worker` + agent tag), In Progress on start, Done + report on finish. Commit every
milestone referencing the issue. Delegate: reads → `reader`, scoped edits → `builder`,
`reviewer` on every diff. **Never orchestrate** — no new lanes/workers/goals; blocked or
out-of-scope → Linear issue (`operator:gate` teed-up sign-off / `operator:decision` options +
recommendation). SSH/hosts: `/Users/misterislez/remote-system/deploy-keys/AGENT.md` — never
mint, never `ssh-add`, never 1Password. Push via broker token, env only, re-fetch per op:
`tok=$(curl -sf http://100.125.231.25:3131/api/ghtoken | python3 -c 'import json,sys;print(json.load(sys.stdin)["token"])')`
then `GH_TOKEN=$tok git push origin agent-kendra`.
