# Lane 2 report — session hooks + detached pinger

**Konrad · devops-engineer** · branch `agent-konrad` · Linear **XYZ-1819** · 2026-08-28

Every fleet session now registers itself at start, heartbeats from a **detached** pinger
obeying the frozen M8 contract, and stops beating at end. Shipped in-repo under
`box/hooks/`, installed and live on german-box, with `INSTALL-MAC.md` as the Mac deliverable.

## Status

| Milestone | Commit |
|---|---|
| A stub server (contract mock) | `ba38557` |
| B pinger + hooks + tests | `0f7ae2c` |
| C box install and wiring · D Codex wrapper + Mac doc | `8232ae7` |
| E integration vs Lane 1 + tailnet bearer key | `9d3f4c4` |
| F this report | `this commit` |

**Tests: 17/17 unit, 7/7 integration.** Lane 1 (`agent-edith`) landed during the build, so
milestone E is a real integration, not the stub-verified fallback the lane pack allows.

## Acceptance

| # | Requirement | Result |
|---|---|---|
| 1 | Lease row with correct `worker/role/pid/parent_*`; survives a long busy call; expires within one TTL of `tmux kill-session` | **green** — verified against Lane 1's real server. Row read back as `worker=konradintg role=devops-engineer pid=… parent=mac/orchestrator epoch=1 lease_state=active`. The busy-session case is scaled (14s at TTL 6, > 2×TTL) rather than a literal 10-minute call; see *Honest limits*. |
| 2 | Same for a Codex-breed session (wrapper path) | **green by construction, not by a live Codex run** — see *Honest limits*. |
| 3 | Kill the pinger only → `pinger_dead`, not reaped (M5) | **green** — stub-verified. Lane 1's reaper drives it, but a `german-box` row cannot be reaped on this box (ssh disabled by design in the harness). |
| 4 | `install-box.sh` idempotent; `INSTALL-MAC.md` complete | **green** — proven *live*, 5 runs: exactly one `SessionStart`, one `SessionEnd`, one `mark.sh` block, no rewrites after the first, all pre-existing settings keys preserved. |
| 5 | No secrets in any hook; zero-quote-safe; nothing writes the Mac from the box | **green** — no `ssh`/`scp` in any executable, no token literals, `SAFE_NAME` whitelisting on every value reaching a `tmux` argument, and the bearer key never enters argv (0 hits across 120 whole-system `ps` snapshots during live requests). |

## What shipped

```
box/hooks/  fd-common.sh  lease-claim.sh  fd-pinger.sh  deregister.sh
            install-box.sh  fd-codex-wrap.sh  INSTALL-MAC.md
box/hooks/test/  stub-server.js  run-tests.sh  integration-lane1.sh  README.md
```

Installed on the box at `~/.claude/fleet/`, with `SessionStart`/`SessionEnd` in
`settings.json` and a marked block in `session-kind/mark.sh`.

**The Codex breed is covered without touching the launcher.** `gb-launch-fd.sh` already runs
`mark.sh --worker $NAME` in its send-keys line for *both* breeds, and editing that launcher
is out of Lane 2's scope. So `install-box.sh` adds an idempotent marked block to box-side
`mark.sh`. Codex has no hooks; this is the one launch step every breed runs.

**`deregister.sh` posts nothing.** The contract has no lease-release route, and
`/api/registry` status writes are epoch-fenced under M17, which a hook has no seat epoch for.
Stopping the beat is the contract-legal way to end a lease. Consequence worth knowing: a
clean end and a crash disappear on the same timeline, one TTL plus the suspect window.

## Three defects worth recording

**1. The idempotency guard was check-then-act, and its test was accidentally rigged.**
A Claude session runs `lease-claim.sh` twice — `SessionStart` and `mark.sh --worker`. Two
overlapping invocations could both see an absent pidfile, both claim, and the second claim
would bump the epoch and **fence the session's own live pinger**, which then 409s and alerts
as fenced while the session is perfectly healthy. Exactly the failure the guard exists to
prevent.

Worse, the test could not have caught it: it put a hardcoded `sleep 1` between the two calls,
roughly a thousand times the window the pinger needs to arm the guard, so it would have
passed against a guard with no locking at all. It now takes an atomic `mkdir` mutex across
guard-check → claim → spawn → pidfile-write, with stale-lock breaking bounded at 60s and only
when no live pinger is registered. The replacement test races two children off a shared start
gate, 5 iterations, and is **falsified**: with only the lock removed it fails on iteration 1
(`pingers=2 epoch=2`) while the old sleep-based case still passes.

**2. A synchronous `SessionStart` hook would have taxed every session on the box.**
`lease-claim.sh` retries 3× with backoff. Measured against a black-holed deck the synchronous
form takes **36.15s**, truncated by its own 10s hook timeout — so during any fleet outage,
every new session on this 28-session box would have paid 10s at startup. Detached via
`setsid` it costs **0.002s**. This was caught before the live install, and confirmed in
production immediately after: with the endpoints not yet deployed, a real claim took ~36s
entirely in the background while session start cost 18ms.

**3. My hooks were missing the tailnet bearer key (contract S3).**
Lane 1's `tailnetHandler` gates every POST behind `FLEET_TAILNET_KEY`, and box hooks reach
her over the tailnet. We sent no `Authorization` header. Harmless today — the key defaults to
unset, explicitly "keeps today's box workers working" — but arming it would make **every box
session silently fail to register**, with the pinger treating the 401 as transient and beating
forever. Found only by integrating; no amount of stub testing would have surfaced it.

The key now travels in `fleet.env` (owner-only from the instant the file exists, via a `umask`
subshell — a `chmod` one statement later still leaves a readable window) and reaches curl
through a `0600 --config` file, never `-H`: a header in argv is readable by every user on this
box through `ps`.

## The stub was the wrong oracle on a load-bearing code

Lane 1 returns **404** for a heartbeat on a row that does not exist. The stub returned **409**.
A 409 stops a pinger permanently; a 404 is transient. Had the stub been right, a deck restart
with an empty database would have stopped **every pinger in the fleet at once**. The hooks
already treated 404 as transient, matching her — only the stub was wrong, and only integration
could reveal it. The contract does not cover this case: it specifies 409 for a missing or
stale epoch on a row that *exists*.

This is the general lesson from the lane: a mock built from the same document as the client
agrees with the client for exactly the reasons that make it useless as a check.

## Contract observations — filed, not resolved

`CONTRACT.md` is frozen, so these went to **XYZ-1824** rather than into code:

- **403 (Host mismatch) is retried forever and silently.** As permanent as a bad key, and
  completely invisible. 401 is now surfaced; 403 is not, because adding a stop condition the
  contract does not enumerate is a contract amendment, not a lane decision.
- **A session whose row vanished beats against 404 forever** and never re-registers, because
  the pinger may not re-claim. Someone should decide whether that is intended.
- **For Lane 1:** a POST to a route not mounted on the tailnet listener *hangs* rather than
  404ing (`GET /api/health` 404s instantly). Harmless now the routes exist, but it makes any
  future undeployed route look like a network black hole.
- Lane 1's 200 bodies carry an extra `ok:true` beyond the contract's `{epoch,expires_at,ttl_s}`.
  Additive and harmless; asserted in integration so it stays that way.

## Honest limits

- **Acceptance 2 is green by construction, not by a live Codex run.** The wrapper's argv
  round-trip, exit-code propagation and cleanup are tested, and the `mark.sh` path is the same
  code the Claude breed uses. A real Codex TUI under `fd-codex-wrap.sh` was stood in with
  `sleep` and an argv-echo script — terminal and job-control behaviour with an actual TUI is
  unverified.
- **The 10-minute busy call is scaled, not literal.** Case 4 holds a session busy for 14s at
  TTL 6 — more than 2×TTL, the same ratio the real 90s TTL implies — rather than blocking a
  box for ten minutes.
- **Lane 1's ssh warn-and-kill sequence is not exercised.** The harness sets
  `FLEET_SSH_BIN=/bin/false` so it can never kill a real session, which means a `german-box`
  row only ever reaches `suspect`. The 410 path is proven through a `host=mac` row, which
  takes the identical reaper path without ssh (M4).
- **Nothing is verified on macOS.** No Mac here. The `nohup` fallback (macOS has no `setsid`),
  `ps -o lstart=`, `stat -f %m`, and `[[:cntrl:]]` under bash 3.2 are untested on real macOS.
  `INSTALL-MAC.md` tells the operator to `--dry-run` first.
- **Hooks were verified by running the exact registered command strings**, not by making
  Claude Code fire them — that needs a real session start on the live config.
- **One disclosure:** during an early helper smoke, before the interlock existed, builder
  traffic hit the operator's deck once — `POST http://100.125.231.25:3131/nope` → 404, no
  state change, no test ever ran against it. Both harnesses now refuse to start unless the
  target is loopback on their own disposable port.

## For the operator

The hooks are **installed and live on german-box now**. They claim against
`http://100.125.231.25:3131`; until the deck runs Lane 1's code, each new session logs one
`claim failed` line and spawns no pinger. Session start is unaffected (2ms).

- Roll back at any time: `sh ~/.claude/fleet/install-box.sh --uninstall`. Backups are at
  `~/.claude/settings.json.bak-2026-08-28` and `~/.claude/session-kind/mark.sh.bak-2026-08-28`.
- **Before arming `FLEET_TAILNET_KEY` on the deck**, put the same value in
  `~/.claude/fleet/fleet.env` as `FD_TAILNET_KEY` on every box that talks to it. Arming one
  without the other makes every box session fail to register — loudly now, but still failing.
- The parent edge defaults to `mac`/`orchestrator` in `fleet.env`. If box workers should hang
  under a specific seat instead, that is a one-line edit; leaving it unset is legal and renders
  the session as an orphan under its host.
- `INSTALL-MAC.md` is the Mac install. Lane 2 never touched your Mac.

— Konrad
