# BLOCKED — Lane 2 cannot push: no active GitHub train

**Konrad · devops-engineer** · branch `agent-konrad` · 2026-08-28
Linear: **XYZ-1825** (`operator:gate`) · lane issue **XYZ-1819** (left In Progress, not Done)

Duplicated onto the branch because the branch itself is unpushed: if you are reading this
from a local checkout, the Linear gate may not be visible to you.

## One action needed

Start a GitHub train on the keys page (`localhost:3131/keys.html`, one Touch ID). Then:

```sh
tok=$(curl -sf http://100.125.231.25:3131/api/ghtoken \
  | python3 -c 'import json,sys;print(json.load(sys.stdin)["token"])')
GH_TOKEN=$tok git -C ~/projects/remote-system/.claude/worktrees/konrad push origin agent-konrad
```

## The blocker

```
GET http://100.125.231.25:3131/api/ghtoken
  -> 503 {"ok":false,"error":"no active GitHub train — ask the operator to start one on the keys page"}
GET /api/ghtrain -> {"active":false,"expiresAt":null}
```

Confirmed at 15:22:40, 15:23:13, 15:23:46, 15:25:51 and 15:27. A worker cannot start a train
and cannot mint (`deploy-keys/AGENT.md`: minting needs 1Password approval, no agent can do
it). This is the goal pack's documented ABORT condition, so I stopped rather than burn turns
against a gate only the operator can open.

Separately: the deck was entirely unreachable from the box between roughly 15:19 and 15:25
(TCP refused on 3131, `connect=0.000000s`, while tailscale showed `misters-macbook-pro`
active). It recovered on its own. Worth a look if that was not a deliberate restart.

## What is finished

Everything except the push. Five commits, milestones A–F:

| Commit | Milestone |
|---|---|
| `ba38557` | A — contract stub server |
| `0f7ae2c` | B — detached pinger, lease claim, deregister |
| `8232ae7` | C+D — idempotent installer, Codex wrapper, `INSTALL-MAC.md` |
| `9d3f4c4` | E — integration vs Lane 1 + tailnet bearer key |
| `42dd9dd` | F — lane report (`reports/konrad.md`) |

Acceptance 1–5 green. 17/17 unit, 7/7 integration against Lane 1's real server. Registry row
posted (`FD-konrad` → `done`). Full detail in `reports/konrad.md`.

## Live on german-box right now

The hooks are installed: `~/.claude/fleet/`, `SessionStart`/`SessionEnd` in `settings.json`,
a marked block in `session-kind/mark.sh`. Backups at `~/.claude/settings.json.bak-2026-08-28`
and `~/.claude/session-kind/mark.sh.bak-2026-08-28`.

Roll back any time: `sh ~/.claude/fleet/install-box.sh --uninstall`

Until the deck runs Lane 1's code, each new session logs one `claim failed` line and spawns
no pinger. Session start is unaffected — the claim is detached and costs 2 ms.

## Before arming the tailnet key

If `FLEET_TAILNET_KEY` is set on the deck, `FD_TAILNET_KEY` must be set to the same value in
`~/.claude/fleet/fleet.env` on every box that talks to it. Arming one side alone makes every
box session fail to register — loudly now (log line plus alert file), but still failing.

## Also open

**XYZ-1824** — the frozen contract enumerates only `410` and `409` as pinger stop conditions,
so `403` (Host mismatch) is retried forever and silently, and a session whose row vanished
beats against `404` forever without re-registering. Needs a contract decision, not code.

— Konrad
