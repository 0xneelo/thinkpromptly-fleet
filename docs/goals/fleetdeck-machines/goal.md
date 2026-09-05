# Goal — fleetdeck Machines page (G1)

**Project** remote-system (fleetdeck, origin `0xneelo/thinkpromptly-fleet`) · **sub-project** `fleetdeck-machines`
· **Goal** G1 in `docs/operator-goals/ledger.json` · **Linear** parent XYZ-2111, lanes XYZ-2112 (Rhoda), XYZ-2113 (Valentin)
· packaged 2026-09-05 by 🎛 ORCHESTRATOR 32 · base `claude/account-usage-cronjob-29e68a` @ `505d53a` (+ this pack).

**One line:** `localhost:3131/machines.html` shows every machine in the fleet and, per machine, which
account each of Claude CLI, Codex CLI, Claude desktop and Codex desktop is signed in as, that
account's current usage, and the Claude/Codex sessions running on that machine — real data from the
real machines.

Operator words (2026-09-05): *"build out the localhost:3131/machines page where we have an overview of
all of our machines and what claude / codex session they are logged in"*; earlier: *"machine overview
with all logins and the usage"*. Read `context.md` first — it is what the earlier agents built and left.

## Scope

**In**
- Land the existing identity page: collector, routes, a real run on the box, the Mac-only paths written
  defensively and validated by the orchestrator from the Mac (Lane 1, `lane-rhoda-land.md`).
- Usage per login cell + live sessions per machine (Lane 2, `lane-valentin-usage.md`).
- Tests for every new join and for the ssh/wsl argv wiring. README `Machines view` stays true.

**Out**
- A Windows-native collector for rog-strix (an `operator:gate` names the push line and the WSL question).
- Restarting the deck: `up.sh` is operator-only (memory `up-sh-operator-only`).
- Weaving the branches to `main`: the orchestrator does it after both lanes report.
- Anything in lowcap-connector or the other repos.

## Acceptance (definition of done for G1)

1. Both lane issues Done with reports; both branches pushed with `git ls-remote`-verified SHAs.
2. On the woven tip, `curl -s 'http://127.0.0.1:<port>/api/machines?refresh=1'` from the Mac returns
   all six configured machines; the five polled ones are `state: ok` with real identities (or a
   named error whose cause has a filed issue); rog-strix is `no_report` with the push line shown.
3. Each login cell shows proof (`token-proved` / `config only` / `last active`), the account's usage
   windows with sample age, and each machine lists its live sessions.
4. Full suite green (`npm test`, ≥191 + the new tests). No token, cookie, or header value in any
   payload, log, test fixture, or report.
5. After the operator's `./up.sh`: `localhost:3131/machines.html` renders the same data live.

## Constraints (bind both lanes)

- **Identity + usage only.** Tokens stay on the machine that owns them; the collector prints
  identities. Nothing new is installed on a polled machine.
- **Cert aliases for host ssh**: `gb-deploy`, `ob-deploy`, `vps-deploy`, `ivybox-deploy`
  (`~/.ssh/deploy-certs/current`). Never the 1Password agent, never `ssh-add`, never mint — an
  expired cert is an `operator:gate`.
- **GitHub only via the fleetdeck broker token** (Mac: `deploy-keys/mint-github-token.sh --broker
  --askpass`; box: `http://100.125.231.25:3131/api/ghtoken`). `GH_TOKEN` env only. 503 → gate.
- **Never touch the live deck**: not `:3131`, not its `fleet.db`, not `up.sh`. Test instances use a
  spare `PORT` and their own `FLEET_DB` (knobs in server.js: `PORT`, `FLEET_DB`, `FLEET_NO_LISTEN`,
  `FLEET_NO_REAPER`, `FLEET_HOSTS_FILE`, `FLEET_MACHINES_FILE`, `FLEET_LOGINS_SH`, `FLEET_SSH_BIN`,
  `FLEET_MACHINES_TTL_SECS` — read the code before relying on any of them).
- **Quote-free rule** for anything sent to german-box; `m.ssh` stays an argv element.
- **Rendering**: `textContent` only, theme tokens from `style.css`.
- Standard CLI-worker protocol (`~/.claude/skills/introduce-goal/references/execution-protocol.md`):
  reviewer on every diff, Linear issue per subtask, commit per milestone, never orchestrate.

## Lanes

| lane | worker | host | tmux | branch | owns |
|---|---|---|---|---|---|
| 1 | Rhoda · platform-engineer | german-box | `FD-rhoda-machines` | `agent-rhoda/machines-land` | `box/fleet-logins.sh`, `machines.json`, `machinesCollect`/`machinesRoute`/`machinePayload`, collector + route tests, README §Machines |
| 2 | Valentin · fullstack-developer | german-box | `FD-valentin-machines` | `agent-valentin/machines-usage` | `public/machines.js|html`, machines CSS, `machinesUsage`/`machinesSessions` helpers, their tests |

Shared seam: `machinesView()` — Rhoda adds `collecting`; Valentin adds `usage` and `sessions`.
Valentin rebases onto Rhoda's pushed tip before his final push. Both add the same `host` field to
`machines.json` entries (`macbook→"mac"`, `german-box→"german-box"`, `onboarding-vps→"onboarding-box"`).

## Run mode

Operator ruling 2026-09-06: **all workers run on the german-box**. The box has no ssh route to the Mac or
the VPSes, so the fleet-wide sweep is verified by the orchestrator from the Mac after the weave.

Claude breed, fast mode on, `/goal` mode (remote-system precedent 4/4, O12 handoff). Stop condition
and standing abort are in each lane's launch prompt. Registry group `machines-page`.

## After the lanes

Orchestrator: verify both SHAs remote, weave to `main`, push, then file the `operator:gate`:
"one `./up.sh` on the Mac; then open `localhost:3131/machines.html`". Close G1 on the operator's word.
