# Install the fleet-lifecycle hooks on the Mac

XYZ-1742 Lane 2. This is the only doc you need. Nothing in this work touches your Mac by
itself — you run the steps below.

## What it does

Your Mac sessions do not show up in the fleet deck. This makes them register themselves.

| Piece | What it is |
|---|---|
| `lease-claim.sh` | runs at session start: claims a lease, then spawns the pinger. The hook starts it **detached**, so it never delays a session start |
| `fd-pinger.sh` | a **detached** process that heartbeats until the session dies |
| `deregister.sh` | runs at session end: stops the pinger, clears local state |
| `fd-codex-wrap.sh` | the same lifecycle for a Codex session, which has no hooks |
| `fd-common.sh` | shared helpers, sourced by the others |

The pinger is a separate process, not a hook, on purpose. A hook cannot run while the
session is inside a long Bash call, so a hook-only heartbeat goes quiet during exactly the
work you most want to see — and the server marks a hard-working session suspect. A detached
process keeps beating through it.

The hooks never write another host, never read a credential, and never print to your
session. Every failure path is silent and exits 0: a fleet outage must not break a session —
and, because the claim runs detached, it does not slow one down either.

## What gets modified

| Path | Change | Reversible |
|---|---|---|
| `~/.claude/fleet/` | new directory: the five scripts, `fleet.env`, `roles.map`, `state/`, `log/` | left in place by `--uninstall`; delete by hand |
| `~/.claude/settings.json` | adds one `SessionStart` and one `SessionEnd` entry under `hooks` | yes |
| `~/.claude/session-kind/mark.sh` | inserts one marked block near the end | yes |

The installer backs up `settings.json` and `mark.sh` before its first write of the day
(`settings.json.bak-<date>`, `mark.sh.bak-<date>`) and never overwrites a backup it already
made that day. `install-box.sh --uninstall` removes both edits. `install-box.sh --dry-run`
prints the plan and changes nothing — run that first.

Re-running the installer is safe. It replaces its own entries in place, so five runs leave
exactly one `SessionStart` entry, one `SessionEnd` entry and one `mark.sh` block. It never
rewrites `fleet.env` or `roles.map` once they exist, so your edits survive every upgrade.

It also knows exactly which entries are its own. A hook of yours whose command merely
*mentions* `fleet/lease-claim.sh` is not one of ours: install leaves it alone and
`--uninstall` does not delete it. And when nothing needs to change, `settings.json` is not
rewritten at all — your indentation and key order are left exactly as you have them, whatever
they are.

The `mark.sh` block fires only on `mark.sh --worker <Name>`. That is the launcher path, and
on the Mac it is normally inert — it is there so a Codex session started through the
launcher still gets a lease. It runs in the background, prints nothing, and does not change
`mark.sh`'s exit status or its badge output.

## The Mac differences

There are exactly two, and they are the only intended difference between the two hosts.

| Setting | Box | Mac | Why |
|---|---|---|---|
| `FD_BASE_URL` | `http://100.125.231.25:3131` | `http://localhost:3131` | the server runs on the Mac, so it is a loopback call, not a tailnet one |
| `FD_LIVENESS` | `tmux` (`tmux has-session`) | `pid` (`kill -0 <pid>`) | Mac desktop sessions are not tmux sessions, so there is no session name to ask about |

Everything else — the contract, the cadence, the retry rules, the tombstones — is identical.

`FD_LIVENESS` defaults to `pid` whenever `FD_HOST=mac`, so setting `FD_HOST=mac` is enough.
Setting it explicitly does no harm.

## Install

1. Get the files onto the Mac. From a checkout of this repo:

   ```sh
   cd <repo>/box/hooks
   ```

   Or copy them across from the box:

   ```sh
   scp -r german-box:<repo>/box/hooks ~/fleet-hooks && cd ~/fleet-hooks
   ```

2. Look at the plan:

   ```sh
   sh install-box.sh --dry-run
   ```

3. Install:

   ```sh
   sh install-box.sh
   ```

4. Point it at the Mac. The installer seeds `~/.claude/fleet/fleet.env` with the box values,
   so edit it once — it is never rewritten:

   ```sh
   # ~/.claude/fleet/fleet.env
   FD_BASE_URL=http://localhost:3131
   FD_HOST=mac
   FD_LIVENESS=pid
   FD_CURL_TIMEOUT=10

   # Session identity. Read the next section before you set these.
   FD_NAME=orchestrator
   #FD_PARENT_HOST=
   #FD_PARENT_NAME=
   ```

   Delete the `FD_PARENT_HOST=mac` / `FD_PARENT_NAME=orchestrator` lines the installer
   seeded, or replace them per the parent-edge section below.

## Session name — read this

On the box the session name comes from tmux. On the Mac there is no tmux, so the name comes
from **`FD_NAME`**. Without it the hook cannot name the session and skips the claim silently
(the log says so).

Two Mac sessions sharing one `FD_NAME` claim the same `(host, name)`. The second claim
**fences** the first: the older session's pinger gets a `409`, stops, and writes an alert.
That is the server working as designed, not a bug.

So:

- **One Mac session at a time** — put `FD_NAME=orchestrator` in `fleet.env` and forget it.
- **Several at once** — you must leave `FD_NAME` out of `fleet.env` entirely, then export a
  distinct name per session before starting Claude, for example
  `export FD_NAME=orchestrator3`. `FD_NAME` is the one setting `fleet.env` overrides the
  environment for, so a value left in the file silently wins over every session's export and
  they all fence each other.

Allowed characters are `A-Z a-z 0-9 _ -`, up to 64. No dots, no spaces.

`FD_PID` is optional. Left unset, the hook records the process that started it, which is
what `kill -0` then checks.

## Parent edge

`FD_PARENT_HOST` and `FD_PARENT_NAME` place the session in the org tree. Rules:

- Set **both or neither**. One half alone is dropped locally.
- `FD_PARENT_HOST` must be `mac` or `german-box`. A session cannot be its own parent.
- **Leaving both unset is legal and normal.** The session renders as an orphan under its
  host, `mac`. A Mac orchestrator is usually a root, so unset is the right answer for it.
- The edge is written **only at claim time**. Changing `fleet.env` does nothing until the
  next session start.

## Verify

Start a session, then:

```sh
cat ~/.claude/fleet/log/<FD_NAME>.log      # expect a "claimed epoch=..." line
cat ~/.claude/fleet/state/<FD_NAME>.lease  # the epoch and ttl the pinger is using
pgrep -fl fd-pinger                        # exactly one pinger per live session
curl -s localhost:3131/api/sessions        # your row, with pid / epoch / lease_state
```

A healthy first log line looks like:

```
2026-08-28T12:00:00Z claimed epoch=1 ttl_s=90 (server) worker=Konrad role=devops-engineer parent=-/-
```

### Reading the log

`~/.claude/fleet/log/<session>.log` is one timestamped line per event, trimmed to the last
500 lines when it passes 2000. Lines you will see:

| Line | Meaning |
|---|---|
| `claimed epoch=N ttl_s=90 (server) ...` | normal start |
| `pinger: start pid=... epoch=N ttl_s=90 cadence=30s` | the heartbeat is running (the cadence is a third of the ttl the server gave) |
| `pinger: transient http 000 (failure 1), still beating` | server unreachable; it keeps trying, one line per 10 failures |
| `already claimed: pinger N is live, not re-claiming` | the second hook call of a start; correct, not an error |
| `claim skipped: no whitelist-safe session name` | `FD_NAME` is unset or invalid |
| `claim failed after 3 attempts (last http 000), no pinger spawned` | the deck was unreachable at session start. The claim runs detached, so this log line is the only place it shows — start a new session, or run `sh ~/.claude/fleet/lease-claim.sh` once the deck is back |
| `pinger: 410 reaped (...), tombstone written, exiting` | the server reaped the row |
| `pinger: 409 fenced at epoch N, alert written, exiting` | another session took this name |
| `deregister: pinger N stopped` | normal end |

### Where the notes land

| Path | Written when | What it means |
|---|---|---|
| `~/launch/tombstones/<session>.txt` | the heartbeat got a `410` | the server reaped this lease. A reaped row never comes back. Start a fresh session. |
| `~/launch/fd-alerts/<session>.txt` | the heartbeat got a `409` | a newer session claimed this `(host, name)` and fenced this one. The pinger stopped; re-claiming from the pinger is forbidden by the contract. |

Both are plain text, one file per session, overwritten on the next occurrence.

## Troubleshooting

| Symptom | Check |
|---|---|
| No row appears at all | `~/.claude/fleet/log/` — a `claim skipped` line means `FD_NAME` is unset or has an illegal character. No log file at all means the hook never ran: check `hooks` in `settings.json` and that `~/.claude/fleet/lease-claim.sh` is there and readable. |
| Row appears, then nothing | `curl -s localhost:3131/api/health` — if the server is down, the log fills with `transient http 000` and the row recovers on its own when the server returns. |
| Row goes suspect while the session is plainly alive | `pgrep -fl fd-pinger`. No pinger means it died; the server flags `pinger_dead` and does **not** reap. Restart the session, or run `sh ~/.claude/fleet/lease-claim.sh` in it. If the pinger is alive, check `FD_BASE_URL` and `FD_LIVENESS` in `fleet.env` — `FD_LIVENESS=tmux` on the Mac makes the liveness check fail and the pinger exit. |
| `409` alert file | Two sessions share one `FD_NAME`. Give them distinct names (see above) and restart the one you want. |
| `410` tombstone | The row was reaped. Read the `reason` in the file. Nothing to fix in place — start a new session for a new lease. |
| Session start pauses for a few seconds | Not this hook. `SessionStart` launches the claim as a **detached background process** and returns immediately — measured at 2 ms with the server black-holed. The claim still retries three times with backoff (about 36 seconds against an unreachable server), but in the background, where nothing waits on it. The registered 10-second timeout is now only a backstop on the fork itself. If a start really does pause, look at the other `SessionStart` entries in `settings.json`. The Codex path via `mark.sh` is backgrounded the same way. |
| Session **end** pauses | That one is synchronous, on purpose: `deregister.sh` signals the pinger and waits up to 3 seconds for it to exit before giving up and killing it. It makes no network call on any path, so an unreachable server costs it nothing. |

## Mac rows are never killed

The reaper **never** kills a process or closes a worker name for a `host=mac` row (contract
M4). It marks the row 🪦 in the UI and stops there. Closing a dead Mac session is yours to
do. Box rows are killed and disappear; Mac rows wait for you.

## Uninstall

```sh
sh install-box.sh --uninstall
```

That removes the two `settings.json` hook entries and the `mark.sh` block, and leaves
`~/.claude/fleet/` — including `fleet.env`, your logs and the tombstones — alone. Delete
`~/.claude/fleet/` by hand if you want it gone too.
