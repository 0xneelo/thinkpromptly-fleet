# Fleetdeck bus — lane→seat delivery never resolves a seat by name (diagnosis, 2026-09-07T22:00Z)

Reported by 🎛 ORCHESTRATOR 28 (lowcap) ~19:00Z and measured by 🧭 COORDINATOR 12: bus window
03:28–21:45Z, lane→seat attempts **44, delivered 0**, every row `failed`, in both name schemes;
seat→lane delivered every time. Linear: **XYZ-2200** (Urgent, project:remote-system, filed by the
lowcap seat); this repo's pending row P12. Read-only diagnosis by 🎛 ORCHESTRATOR 34 via a reader
over `/Users/misterislez/remote-system` (the running deck's checkout) and `fleet.db`.

## Evidence (fleet.db `messages`, target_type = claude-desktop, 2026-09-07)

| error (verbatim) | rows |
|---|---|
| `Claude Desktop session "🎛 ORCHESTRATOR 28 = O45" is not live` | 35 |
| `Claude Desktop session "orchestrator" is not live` | 4 |
| `Claude Desktop session "🎨 DESIGN 35 · fleetdeck v2 redesign" is not live` | 5 |
| `… "🎛 ORCHESTRATOR 28" / "🎛 ORCHESTRATOR 28 · lowcap-connector" / "O45" / "🧭 COORDINATOR 12" is not live` | 1 each |

All 44 come from one `throw` in `server.js deliverDesktopSession` (~line 2319):

```js
const matches = desktopSessions().filter((s) => id ? s.sessionId === id : s.name === name);
const row = matches.length === 1 ? matches[0] : null;
if (!row) throw new Error('Claude Desktop session "' + name + '" is not live');
```

## Root cause

`desktopSessions()` (`server.js` ~524-543) reads `~/.claude/sessions/<pid>.json` and exposes the
peer-session `name`, which for every live desktop session today is `nameSource: "derived"` — an
auto slug such as `goalkeeper-skill-session-673d59-36`. Seat titles (`set_session_title`) and
registry names (`registryWrite`, "orchestrator") live in other namespaces that
`deliverDesktopSession` never consults. The viewing path `desktopSeat()` (~1679-1690) DOES fall back
to `desktopSessionStore.byTitle(seat)`; the delivery path does not. So the UI and the API let a
sender address a seat by title, and delivery can never resolve it. Tailnet vs loopback is a red
herring: `busAuthorized` gates both listeners identically and the socket connect is local either way.

Only two addressing forms can succeed today: the exact derived slug, or `id:<sessionId>` (the
desktop session uuid).

Secondary (separate root cause, same P12): Mac registry rows go stale (`mac|orchestrator`
live=false at 17:57Z and again from 19:09Z; `mac|LC-giselher` since 03:53Z) — no `fd-pinger`
process was running on the Mac at 19:10Z, so the lease heartbeat is not surviving; a desktop
session resumed after a crash may not re-run the SessionStart lease hook.

Running deck: pid 30533 started 2026-09-07 04:23 local; unrelated to this bug (the failing code is
unchanged on disk), but a restart precedes any re-test.

## Fix (one lane, backend-developer, german-box)

1. `deliverDesktopSession`: resolve `name` in order — exact derived slug → `id:<uuid>` →
   `desktopSessionStore.byTitle(name)` → registry `seat` name → live session whose title starts with
   the badge; then use that row's socket. Ambiguity (two matches) is an error that names both.
2. `POST /api/messages` and `/api/notify`: return a distinguishable result — `404 target_not_found`
   vs `409 target_not_live` vs `202 queued` — instead of `200 ok:false`; include the list of known
   desktop targets on 404 so a sender can retarget itself.
3. Mac lease: make `lease-claim.sh` idempotent on resume and have the deck mark a row stale only
   after N missed beats; add a `/api/seats` field `beats_missed`.
4. Tests: spawned-server test that a title-addressed and a registry-name-addressed message to a
   fixture desktop session both deliver; the 404/409 shapes; a lane→seat round-trip fixture.
5. Proof in the report: one real message from a box lane to the live orchestrator seat, addressed
   by title, with `status: delivered` in `fleet.db`, plus the same by `id:`.

Workaround until the lane lands: address a desktop seat as `id:<its sessionId>` (the seat reads
its own uuid from `~/.claude/sessions/<pid>.json` and tells its lanes), or send over the tmux path
(`HOST:SESSION`) which is unaffected.

## Addendum 2026-09-08T00:5xZ — independent confirmation

🧭 COORDINATOR 12 (lowcap) reached the same cause independently (server.js:2317, `matches.length === 1`
against `~/.claude/sessions/<pid>.json` names) and reports lowcap fixed its own script to the `id:`
form; its self-test arrived. Its reading of the remaining remote-system defect is narrower than fix
item 1 above: "a badge was never a name", so only the silent `200 ok:false` (fix item 2: non-2xx or a
checked `ok`, plus the live names on the error) is the bug, recorded as a comment on XYZ-2200. Fix
item 1 (title/registry resolution on the send path) stays in this sketch as a proposal, because the
notify skill and the deck UI both let a sender address a seat by title; the operator settles scope
when giving the goal line.

Needs an operator goal line before packaging (`/introduce-goal`); Linear is unreachable from this
desktop, so the pack records XYZ-2200 as the parent and writes pending entries.
