# XYZ-1854 — train-broker isolation · lane report

**Zita · devops-engineer** · branch `agent-zita` · base `509e80f`

Operator intent: *"isolate the git train service so it doesnt get shutdown constantly on
restarts as we are devving the fleetdeck further."*

## What shipped

The train broker is out of `server.js` and into `fleetdeck-train.js`, its own loopback-only
process, run on the Mac as the launchd user agent `com.fleetdeck.train`. The deck proxies
the existing `:3131` endpoints to it. **Every consumer URL is unchanged** — no pack, worker
recipe or doc needed an edit — and a deck restart no longer closes the train.

| file | what it is |
|---|---|
| `fleetdeck-train.js` | the broker: holds the App PEM and the train window in memory, mints 1h tokens |
| `server.js` | the train block deleted; `trainProxy()` forwards the same paths on both listeners |
| `mac/com.fleetdeck.train.plist` | LaunchAgent template — `RunAtLoad`, `KeepAlive`, throttled, file logging |
| `mac/install-train-agent.sh` | install / `--uninstall` / `--print` / `--status`, ending in a live probe |
| `mac/provision-fleet-secrets.sh` | distributes `FLEET_TAILNET_KEY` and `FLEETDECK_BUS_TOKEN` to the box |
| `box/fleet-env-set.sh` | box-side setter: one key into `fleet.env`, value on **stdin**, 0600 |
| `docs/train-broker.md` | operations: install, logs, failure modes, crash semantics, secrets |
| `test/train-broker.test.js` | 16 tests — the broker in isolation |
| `test/train-proxy.test.js` | 13 tests — the acceptance harness, deck + broker together |
| `test/bus-tailnet-auth.test.js` | 6 tests — the bus gate, which had no HTTP coverage at all |
| `test/provision.test.js` | 10 tests — the quote-free rule and the no-secret-in-argv rule |
| `test/fake-op.js`, `test/fake-github.js`, `test/fake-ssh-recorder.js` | test doubles |

**162/162 tests pass**, up from 117 on `509e80f`.

## The design decisions worth knowing

**The Origin gate stayed on the deck.** Starting a train unlocks the PEM, so that decision
is still made by the same fail-closed `ALLOWED_ORIGINS` check, on the same listener, before
anything is forwarded. The broker only ever sees a request the deck already vouched for.
Proxy test 2 asserts a start POST with no Origin dies on the deck and never reaches the
broker.

**The broker is loopback-only and additionally guards its own `Host` header**, so a browser
cannot reach it by DNS rebinding. The tailnet listener remains the single tailnet exposure
surface, with its existing gates. Start/stop stay off the tailnet exactly as before.

**Two `503`s that must never be confused.** `no active GitHub train` is the normal resting
state; `train broker unreachable at 127.0.0.1:3132 — is the com.fleetdeck.train launch
agent loaded?` is an infrastructure fault. Proxy test 9 asserts they differ.

**The proxy deadline is 130s, deliberately longer than `MINT_TIMEOUT` (120s).** `startTrain`
blocks on the 1Password approval prompt while a human walks to the Touch ID sensor. A
shorter proxy deadline would return an error to `keys.html` for a train that then opened
anyway — a split brain where the operator believes there is no train and every box worker
can mint tokens.

**Touch ID moved process, and that is why the agent is a `gui/$UID` LaunchAgent.**
`keys.html` never triggered Touch ID itself; the prompt comes from `op document get`, which
now runs inside the broker. The 1Password CLI only reaches the desktop app from inside the
operator's GUI login session, so a system daemon would get connection-refused on every
single mint. `launchd` also hands a job `/usr/bin:/bin:/usr/sbin:/sbin` and nothing else, so
the installer writes the `PATH` on which it actually resolved `node` and `op` — getting that
wrong is the most likely install failure and it looks like a broker that 502s every mint.

## Acceptance

| # | claim | status |
|---|---|---|
| 1 | deck restart → `/api/ghtoken` still 200 | **proved box-side.** Proxy test 8 opens a train, kills the deck, starts a new deck on the same port against the same broker, and asserts the token still mints with an **identical `train_expires_at`**. The Mac half is the gate. |
| 2 | broker crash → launchd restarts it; window loss documented | **half proved.** Proxy test 9 kills the broker, asserts the distinct 503, restarts it and asserts `active:false` — the window is gone, as designed. `KeepAlive` itself is `launchctl`, so Mac-only, at the gate. Semantics written up in `docs/train-broker.md`. |
| 3 | keys.html starts/stops a train through the proxy | **proved box-side.** Proxy tests 3 and 10 drive the exact calls `public/keys.js` makes (`POST /api/ghtrain {ttl}`, `POST /api/ghtrain/end`) with the deck's own Origin. |
| 4 | box→deck bus round-trip (closes XYZ-1844) | **mechanism proved, live round-trip blocked.** See below. |
| 5 | tailnet sitrep 401 without the key, authorised with it | **already proved** by `test/coordinator-api.test.js:459` (Kendra's lane). The code was never the gap — a generated value and a distribution path were, and those shipped here. |
| 6 | tests, report, gate | **done.** 158/158; this report; one `operator:gate`. |

## What I could not prove, and why

**Acceptance 4 needs the operator.** The bus token exists only on the Mac. I confirmed the
box does have a `~/.fleetdeck-bus-token` — but it is a local artifact, not the deck's, and
the live deck rejects it exactly as it rejects sending nothing:

```
with the box's token : HTTP 401 {"ok":false,"error":"invalid message bus token"}
with no token        : HTTP 401 {"ok":false,"error":"invalid message bus token"}
```

That was an auth-only probe against a deliberately invalid target, so the gate answered
before anything could be delivered; no message was sent to anyone. The file on the box is a
red herring that makes this look provisioned when it is not.

The asymmetry is structural: the bus-token gate lives **only** on the tailnet listener, so
the Mac's own Bus panel posts fine with no token while a box worker cannot. That is exactly
the reported "orchestrator→worker delivers, worker→orchestrator 401s". `test/bus-tailnet-auth.test.js`
now pins that behaviour. XYZ-1844 stays open until the operator runs the provisioning script.

**Nothing was run against the Mac.** No `launchctl`, no deck start or restart, no test
against the live deck. The one thing I touched on the live deck was the read-only auth probe
above and the `/api/ghtoken` fetches the push protocol requires.

## Secrets handling

No secret value is committed, logged, printed, or placed in argv or a URL — in either
script or either process. Both riders travel to the box on **stdin** (`ps` is
world-readable), every remote command string holds zero quote characters per the repo's
quote-free rule, and `fleet.env` is created `0600` *before* anything is written into it.
`test/provision.test.js` checks all of that mechanically against a recording fake `ssh`
rather than leaving it to review.

`FLEET_TAILNET_KEY` is the operator's, at `deploy-keys/fleet-tailnet.env`, sourced by
`up.sh`. The script distributes it and refuses to mint one — see the rider amendment below.
It is never printed and never sent to Linear.

## Review

Two reviewer passes, both of which changed the code.

**Pass 2 (the broker and the proxy)** confirmed all eleven invariants I asked it to check —
the `server.js` diff is confined to the train block, the Origin gate runs before anything is
proxied, start/stop are absent from the tailnet listener, the Host guard is the first line of
the handler so it covers 404s and 405s too, no log line or error message interpolates the PEM
or a token, neither process writes the window to disk, and 130s > 120s. It found four things
worth fixing:

- **The proxy buffered the broker's reply with no cap.** The broker only ever sends a small
  JSON object, but the deck is the control plane for the whole fleet, and anything that got to
  `127.0.0.1:3132` before the real broker did could have grown its memory without bound. Now
  capped at 64KB with a 502, proved against a deliberately hostile stand-in for the broker
  (proxy tests 12 and 13) — the only way to exercise a path the real broker never takes.
- **No abort propagation.** A start POST can sit for the full 120s Touch ID window; closing the
  tab left the deck's socket to the broker open. Now cancelled. The broker still finishes the
  mint it began, which is right — the sensor was touched.
- **`process.exit(0)` on SIGTERM could truncate the last log line**, and under launchd stdout is
  a file rather than a TTY, so it is exactly the shutdown diagnostic that would go missing. Now
  drains with a 1s hard deadline. Clearing the window was already synchronous.
- **`FLEET_TRAIN_BIND` was documented as loopback-only but not enforced.** The Host allowlist is
  derived from it, so a routable bind would have put the PEM-holding process on a real interface
  while the rebinding guard quietly agreed. It now refuses to start. Tested against `0.0.0.0`,
  `10.0.0.5`, the tailnet IP and `::`, and tested *not* to reject `127.0.0.2`, which the harness
  legitimately needs.

It also judged the `FLEET_GH_API` / `FLEET_OP_BIN` / `FLEET_GH_ENV` test seams acceptable rather
than flagging them reflexively: same unconditional-env-override pattern as the existing
`FLEET_SSH_BIN`, and setting this process's environment already implies code execution as the
same user. Not a new hole introduced by the extraction.

**Pass 1 (the shell scripts)** found a real data-loss bug in `box/fleet-env-set.sh`: a
masked `grep` failure meant an unreadable `fleet.env` was treated as an empty one, and the
rewrite would have destroyed `FLEETDECK_BUS_TOKEN`, `FD_HOST` and every operator edit —
with `provision-fleet-secrets.sh` calling the setter three times in a row, one masked read
error would have taken the previous two writes with it. Fixed by distinguishing grep's exit
1 (nothing matched, legal) from exit 2 (cannot read, fatal), plus an `EXIT` trap so a failed
run never leaves a `0600` temp file holding a bearer key behind. Both are now regression
tests.

## One flake I introduced, and removed

The bind-guard test originally pinned `127.0.0.2:18311`'s port at 28311 — inside `test/http.js`'s
20000–40000 random band, on the same second loopback address every deck in the suite uses for its
tailnet listener. It collided occasionally and failed two lifecycle tests in a completely
different file. The fixed port now sits below the band. Worth recording because the symptom
pointed nowhere near the cause.

— Zita

## Rider amendment — 2026-08-29, mid-lane

The orchestrator landed a coordination update while the lane was blocked on the push:
`FLEET_TAILNET_KEY` now **exists**. The operator generated it at
`deploy-keys/fleet-tailnet.env` (mode `0600`) and `up.sh` sources it. Rider (a) therefore
changed from *generate and provision* to **distribute the existing key**.

`mac/provision-fleet-secrets.sh` was reworked accordingly. It now reads the operator's file
and **refuses to run if it is absent**, rather than helpfully minting a replacement. That
refusal is the substance of the change: there is exactly one tailnet key in the fleet, and a
second is not a spare but an outage — every box holding the wrong one gets `401` on every
POST, and the symptom points at the box rather than at whatever minted the rival key. The
generate path is gone, and a test asserts it stays gone.

The file is **parsed, never sourced**: sourcing would execute whatever else it contains, on
the machine that holds the App PEM. `export K=V`, bare `K=V`, and both quoting styles parse
to identical bytes, with `CR` stripped — a stray carriage return would otherwise sit inside
the bearer key and 401 everything. Six shapes are covered by test.

Documented for the future GB-hosted deck: it must arm **this** key, not generate its own. It
is a shared secret between the deck and every box, not a per-deck identity.

### One thing the update got wrong, and it matters

The update described `deploy-keys/fleet-tailnet.env` as git-excluded. On this tree it was
**not**:

```
$ git check-ignore -v deploy-keys/fleet-tailnet.env
(no output — not ignored)
```

`.gitignore` covered `deploy-keys/github-app.env` and `*.pem`, but not the new file. If it is
excluded on the Mac, that is a local `.git/info/exclude`, which does not travel with the repo
— and the future GB-hosted deck in point (1) checks out this same tree. An unignored key file
is one `git add -A` from being published.

Added to the tracked `.gitignore`, with a test that asserts the ignore comes from
`.gitignore` and not from a local exclude.

### Acceptance 5 against the live deck

Point (2) offered the real deck for the tailnet sitrep test, read-only. Confirmed live and
answering over the tailnet:

```
GET /api/coordinator/board       200
GET /api/coordinator/exceptions  200
GET /api/coordinator/inbox       200
```

But a read cannot settle acceptance 5. The S3 gate deliberately exempts reads — that is the
rule under test — so `GET` returns 200 whether the key is armed or not, and the 401/authorised
distinction only appears on a POST. POSTs stay on the local harness per the same update, where
`test/coordinator-api.test.js:459` already proves both halves. Live confirmation is therefore
a one-line operator check after the restart, and it is in the gate.

— Zita
