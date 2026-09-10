# notify-seat-aliases — desktop seat aliases on /api/notify reach their seat

Project: **remote-system** / sub-project: **fleetdeck-notify**. Worker: **Ysolde · backend-developer**, tag `agent-ysolde`, box session `FD-notify-seat-aliases`, branch `agent-notify-seat-aliases`, base `origin/claude/local-orchestrator-f378c6` (Mac main + this pack).
Written by 🎛 ORCHESTRATOR 20 on 2026-09-10. Operator word: "gpt xhigh" (2026-09-10 ~19:05Z). Source finding: lowcap 🎛 seat 36, message O20-SEATS-1 (verified by seat 20 against the code and the live deck).

## Goal (one line)

`POST /api/notify` resolves `orchestrator <project>`, `global`, `design <N>`, `researcher <N>` and `coordinator <N>` against the titles the Claude Desktop app actually shows, so a seat that titled itself with `set_session_title` is addressable.

## The defect, verified

- `desktopSessions()` (`server.js:524-543`) reads `~/.claude/sessions/<pid>.json` and uses only `pid`, `sessionId`, `messagingSocketPath`, `name`. The alias regexes (`server.js:2894-2914`, `NOTIFY_SEATS`) match `name`. Every desktop session file on this Mac has `nameSource: "derived"` (slugs like `v3-page-bugs-0b7a77-93`), because `set_session_title` changes the app's title, never the CLI session `name`.
- The app's titles live in the desktop session store: `~/Library/Application Support/Claude/claude-code-sessions/<account>/<org>/local_<uuid>.json`, one file per session (985 files on 2026-09-10), keys include `sessionId` (`local_…`), `cliSessionId`, `cwd`, `title`, `titleSource`, `lastActivityAt`, `isArchived`. No `pid`. The deck never reads it.
- Result: `orchestrator lowcap-connector` → 409 `seat_unaddressable` for a live seat; `design|researcher|coordinator <N>` have no fallback at all; `orchestrator` alone falls back to the single `seats` row owner (`server.js:2905-2914`), which is shared across projects.

## Plan

**M1 — title join.** In `desktopSessions()` (or a helper next to it) load a title index from the desktop store: map `cliSessionId → {title, cwd, lastActivityAt, isArchived}`; join on `sessions/<pid>.json.sessionId`. Cache the index; refresh when a store file changes (mtime/size scan of the store dirs, or a short TTL such as 5 s). Each desktop session gains a `title` field (null when no store record). Verify the join key on this Mac first: the seat-20 session file has `sessionId d4f52004-39d2-433f-abbd-e93f240f6f85`; its store record must carry that value in `cliSessionId`. If the key differs, report which field matches before building on it.

**M2 — resolve on title.** The seat regexes match `title` first, then `name` (unchanged behaviour for CLI `/rename` users). `resolvedVia` gains the value `title`. Ambiguity rules stay as they are (`server.js:2961-2966`). The `orchestrator <project>` → seats-table fallback stays, but only after the title match fails. The 409 `seat_unaddressable` body lists the live desktop titles that were considered (titles only, no cwd), so the next seat can see why.

**M3 — tests.** Fixture-based: a temp `sessions` dir with a derived-name session file and a temp store dir with a titled record, paths injected through whatever override `server.js` already has for `~/.claude/sessions` (find it; if there is none, add an env override in the same style as the existing ones, documented in the README env table). Cases: orchestrator by project, design/researcher/coordinator by number, global, no-record → unchanged 409, two live seats with the same title → 409 ambiguous, archived record ignored.

**M4 — decision note, docs only.** `docs/goals/notify-seat-aliases/seats-per-project.md`: options for the single shared `orchestrator` seat (`server.js:187, 260, 418-486, 3165-3178`): (a) keep one seat, since the fence is bootstrap-mode and the alias fallback becomes unnecessary after M2; (b) per-project seat ids `orchestrator:<project>` with per-project epochs and the registry fence keyed by project; (c) seat id stays, `owner_project` column added. One recommendation. Tag `operator:decision`. No code.

## Acceptance

1. `node --test` for the new tests passes on the box; the existing suite still passes for the tests that can run there (listener tests need the 127.0.0.2 alias; say which were skipped).
2. On the Mac, after the operator weaves and restarts the deck: `node bin/fleet-notify.js send --to "orchestrator remote-system" --from claude-desktop "ping. Reply ACK O20-ALIAS"` returns `delivered` with `resolvedVia: "title"`, and the same for `design 14` and `coordinator 19` while those seats are live. Seat 20 runs this check; the worker records the exact command in its final report.
3. No new dependency. No reads of the desktop store on the tailnet handler beyond what `/api/notify` already does on loopback.
4. `README.md` env table documents any new override; `docs/design/fleetdeck-v2/improvised.md` gets one dated line if the v2 bus screen shows `resolvedVia`.

## Out of scope

Per-project seat implementation (M4 is a note). Any change under `~/.claude/skills/` (global skill, not this repo). lowcap-connector's registry claims. The 115 stale `suspect` rows in the deck registry.

## Constraints

- Push only over the broker token: `tok=$(curl -sf http://100.125.231.25:3131/api/ghtoken | python3 -c 'import json,sys;print(json.load(sys.stdin)["token"])'); GH_TOKEN=$tok git push origin agent-notify-seat-aliases`. `GH_TOKEN` env only, never argv, URLs, files, logs; re-fetch per push.
- Never restart the Mac deck (`up.sh` is operator-only). Test with fixtures and, if a live instance is needed, a second `server.js` on another port inside the worktree with `PORT` and a scratch `fleet.db`.
- No ssh to any host is needed for this goal.
- Linear unreachable is never a blocker: log to `LINEAR-PENDING.md` in this directory and keep working.
