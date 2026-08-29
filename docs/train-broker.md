# The train broker — `fleetdeck-train`

The GitHub train used to live inside `server.js`. Every `./up.sh` killed it, and while the
deck is under active development that is a recurring outage: a box worker that had a token
a minute ago suddenly gets `503 no active GitHub train`, and the operator has to walk back
to the keys page and touch the sensor again.

`fleetdeck-train` is that broker as its own process. The deck proxies to it. Deck restarts
no longer touch the train window.

## What moved, and what did not

| | before | after |
|---|---|---|
| holds the App PEM + the train window | `server.js` | `fleetdeck-train.js` |
| answers `/api/ghtoken`, `/api/ghtrain` on `:3131` | `server.js` | `server.js`, **proxying** |
| survives `./up.sh` | no | **yes** |
| survives a Mac reboot / sleep-to-death | no | no, by design |

Every consumer URL is unchanged. `curl -s localhost:3131/api/ghtoken` from the Mac and
`curl -s http://100.125.231.25:3131/api/ghtoken` from the box both still work, byte for
byte the same responses. No pack, worker recipe or doc needs an edit.

## The shape

```
                     :3131 loopback ──┐
  keys.html ─────────────────────────►│  fleetdeck (server.js)      :3132 loopback
                                      │    ├ Origin gate on start/stop │
  box worker ─── :3131 tailnet ──────►│    └ trainProxy() ─────────────┼──► fleetdeck-train
                                      ┘                                │      ├ the App PEM
                                                                       │      ├ the window
                                                                       │      └ mints tokens
```

The broker binds `127.0.0.1` only and additionally allow-lists its own `Host` header, so a
browser cannot reach it by DNS rebinding. The tailnet listener stays the single tailnet
exposure surface, with its existing gates — the broker is never on the tailnet.

The **Origin gate stays on the deck**. Starting a train unlocks the PEM, so that decision
is made by the same fail-closed check as before, on the same listener as before; the broker
only ever sees a request the deck already vouched for.

## Touch ID

Unchanged for the operator, but it moved process. `keys.html` never triggered Touch ID
itself — the prompt comes from `op document get` inside the broker, and 1Password's CLI
only reaches the desktop app from inside the operator's **GUI login session**. That is why
the launch agent is bootstrapped into `gui/$UID` and not into `system/`. A system daemon
gets "connection refused" from 1Password on every single mint.

## Install (operator only)

```sh
sh mac/install-train-agent.sh
```

It renders `mac/com.fleetdeck.train.plist`, installs it to
`~/Library/LaunchAgents/com.fleetdeck.train.plist`, bootstraps it into `gui/$UID`, and then
proves it with a real request instead of trusting an exit code. Re-running is safe.

`launchd` hands a job `/usr/bin:/bin:/usr/sbin:/sbin` and nothing else, so the installer
writes the `PATH` on which it actually resolved `node` and `op`. Getting this wrong is the
most likely install failure and it looks like a broker that answers `502` on every mint.

    sh mac/install-train-agent.sh --print       # render the plist, change nothing
    sh mac/install-train-agent.sh --status      # what launchd thinks, plus a live probe
    sh mac/install-train-agent.sh --uninstall   # bootout + remove the plist

Uninstall leaves `~/Library/Logs/fleetdeck-train/` alone; delete it by hand.

## Logs

    ~/Library/Logs/fleetdeck-train/out.log
    ~/Library/Logs/fleetdeck-train/err.log

They hold lifecycle lines and errors only. **No token, PEM, or GitHub response body is ever
logged** — the same rule the in-process broker followed.

## Failure modes, and what each looks like

| symptom | cause | fix |
|---|---|---|
| `503 no active GitHub train — ask the operator to start one on the keys page` | normal: no train open, or it expired | start one on the keys page |
| `503 train broker unreachable at 127.0.0.1:3132 — is the com.fleetdeck.train launch agent loaded?` | the broker is not running | `sh mac/install-train-agent.sh --status`, then `--uninstall && install` |
| `502` with 1Password's own text | vault locked, or CLI integration off | unlock 1Password; Settings → Developer → CLI integration |
| `502 ... is not a PEM private key` | `GH_APP_KEY_OP` points at the wrong document | fix `deploy-keys/github-app.env` |
| `500 GH_APP_ID / GH_APP_INSTALLATION_ID must be numeric` | typo in `deploy-keys/github-app.env` | fix it; it is re-read per request, no restart needed |

The two `503`s are worded differently on purpose. One is the train being closed, which is
the normal resting state; the other is an infrastructure fault. They must never be confused
in a log or in an agent's retry logic — and not on the keys page either: when the deck
cannot reach the broker, the train panel shows an amber **BROKER DOWN** badge and the
reason, rather than the grey INACTIVE it shows for a train that is simply not open. Saying
INACTIVE there would send the operator to the Touch ID sensor for a train that cannot
start.

## Crash semantics — read this before filing a bug

`KeepAlive` restarts the **process**. It does not restore the **window**.

The train window is deliberately in memory and never on disk: writing it down would mean
writing an unlocked App PEM to a file, which is the one thing this design refuses to do. So
after a broker crash the operator starts a new train from the keys page. `launchd` throttles
respawns to one per 10s, so a crash-loop shows up as a broker that is up but has no train,
not as a hot loop.

The broker still dies with the Mac. That posture is unchanged and intentional: no train
window survives the Mac going down.

`SIGTERM` and `SIGINT` end the train cleanly before exit, so a `launchctl kickstart -k`
never leaves an orphaned `caffeinate` behind.

## The two shared secrets

Neither belongs to the broker, but both are provisioned by the same script, because they
are the same kind of plumbing.

```sh
sh mac/provision-fleet-secrets.sh          # run on the MAC
sh mac/provision-fleet-secrets.sh --show   # armed/absent per machine; prints no value
```

**`FLEET_TAILNET_KEY`** — the shared bearer key the deck's tailnet listener requires on
every POST arriving over tailscale, exempting loopback. Both ends of the wiring already
existed (`server.js` `tailnetAuthed()`; `box/hooks/fd-common.sh` `FD_TAILNET_KEY`); what was
missing was a value. The script generates one at `~/.fleetdeck/tailnet-key` (mode `0600`)
and pushes the same bytes to the box's `~/.claude/fleet/fleet.env` (also `0600`). The deck
half is one line you add to `up.sh`:

    export FLEET_TAILNET_KEY=$(cat ~/.fleetdeck/tailnet-key)

While it is unset, the tailnet listener accepts unauthenticated POSTs. That is the current
unarmed state, not a regression — but it is the reason to arm it.

**`FLEETDECK_BUS_TOKEN`** — fleetdeck mints this at `~/.fleetdeck-bus-token` on first run.
Box workers need the same value or `bin/fleet-message.js` cannot post: orchestrator→worker
delivers, worker→orchestrator `401`s. That asymmetry is XYZ-1844. The script copies the
Mac's token, plus `FLEETDECK_URL`, into the box's `fleet.env`.

A note on how they travel: **no secret is ever an argv word**, on either machine. `ps` is
world-readable, so both values reach `box/fleet-env-set.sh` on stdin, and every remote
command string holds zero quote characters, per the quote-free rule in `README.md`.

## Testing it without a Mac

`test/train-broker.test.js` and `test/train-proxy.test.js` spawn a real broker and a real
deck on their own free loopback ports, with a fake `op` (a genuine generated RSA key, so
the JWT is really signed and really verified) and a fake GitHub. The proxy suite restarts
the deck under a live train and asserts the token still mints with an identical
`train_expires_at` — acceptance 1, proved without touching the operator's deck.

    npm test
