# Goal — train-broker isolation (Zita · devops-engineer)

Project **remote-system (fleetdeck)** · sub-project **train broker service**.
Operator intent (2026-08-29): *"isolate the git train service so it doesnt get shutdown
constantly on restarts as we are devving the fleetdeck further."* Every `./up.sh` currently
kills the in-memory train window; deck dev velocity makes that a recurring outage.

**One line:** extract the GitHub train broker out of `server.js` into its own long-lived
process (`fleetdeck-train`, a macOS **launchd user agent**), with the deck **proxying** the
existing `:3131` endpoints to it — deck restarts stop killing the train.

## Operator rulings (2026-08-29, locked)

1. **Consumer URLs stay put** — `/api/ghtoken` (loopback + tailnet) and the keys-page train
   start/stop endpoints keep their `:3131` paths; the deck forwards to the broker. No pack,
   worker recipe, or doc changes its URL.
2. **launchd user agent** — auto-start at operator login, KeepAlive restart on crash,
   dies with the Mac (the documented "no window survives the Mac" posture is preserved).
3. **Two riders fold in** (same secrets-plumbing territory):
   a. **FLEET_TAILNET_KEY** — generate, arm on the deck env (documented in `up.sh`'s
      procedure), distribute to box worker env so tailnet sitrep POSTs authenticate.
   b. **FLEETDECK_BUS_TOKEN** to box worker env (XYZ-1844) — un-breaks box→deck bus replies.

## Binding constraints

- Broker binds **loopback only**; the deck's tailnet listener keeps the single tailnet
  exposure surface and its existing gates, proxying to the broker.
- Train window state stays **in-memory in the broker** — never persisted to disk. GitHub
  tokens stay 1h, env-only, never in argv/URLs/files/logs. Secrets handling is exact and
  uncompressed; box `fleet.env` is chmod 600.
- Touch ID keys-page flow (`keys.html`) keeps working end-to-end through the proxy.
- SSH-cert minting (1Password) is untouched; `up.sh`'s agent-shell refusal stays.
- `launchd` plist: user LaunchAgent (e.g. `com.fleetdeck.train`), KeepAlive, file logging;
  ship `install-train-agent.sh` + uninstall notes. **Install/activation on the Mac is
  operator-only** — the lane ships scripts and proves logic box-side; it never runs
  `launchctl` against the operator's Mac.
- No behavior change to any non-train deck route.

## Acceptance

1. With a train open: restart the deck → `/api/ghtoken` still 200 from Mac and box
   (proved on the Mac by the operator at the gate; logic proved box-side with a local
   broker + proxy harness first).
2. Broker crash → launchd restarts it; in-memory window loss on crash is documented.
3. keys.html starts/stops a train through the proxy.
4. Bus round-trip from a box session succeeds (closes XYZ-1844).
5. Tailnet sitrep POST: 401 without `FLEET_TAILNET_KEY`, authorised with it (once the
   coordinator API is live).
6. Tests per repo convention; report `docs/goals/train-broker-isolation/reports/zita.md`;
   final `operator:gate` bundling: run `install-train-agent.sh`, export the new env, one
   `./up.sh` — then the orchestrator verifies.

## Base + sequencing

Branch `agent-zita` off `main` AFTER the agent-kendra weave lands (both rework
`server.js`). Launch is held by the orchestrator until that weave is pushed.

## Protocol (short form)

You are Zita, a devops-engineer. Badge `🔨 WORKER · Zita`; tag `agent-zita`; sign as Zita.
One Linear issue per subtask (`[Zita · devops-engineer]`, labels `session:cli-worker` +
`agent-zita` + `project:remote-system`), In Progress on start, commit per milestone,
reviewer subagent on every diff, reader for broad reads. Never orchestrate; blocked →
`operator:gate`/`operator:decision`. Push via train broker token, env only, re-fetch per
operation (`http://100.125.231.25:3131/api/ghtoken`).
