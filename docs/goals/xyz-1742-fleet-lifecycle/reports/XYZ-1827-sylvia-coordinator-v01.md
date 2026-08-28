# XYZ-1827 — Coordinator v0.1 — Sylvia · tooling-engineer

Branch `agent-sylvia`. Date 2026-08-28. Status: **BUILT AND COMMITTED — PUSH GATED.**

Linear XYZ-1827 carries the full report and the six acceptance proofs. This file is the
in-repo copy so the branch documents its own gate.

## ⛔ Gate

The branch is not pushed and the registry row is not written. Both endpoints live on the
operator's Mac (`100.125.231.25:3131`) and the host is offline:

```
tailscale  100.125.231.25 misters-macbook-pro  offline, last seen 26m ago
curl /api/ghtoken   HTTP 000   (6 attempts)
curl /api/registry  HTTP 000
ping                100% packet loss
port 3131           unreachable
```

Not a 503 — the broker host is down, so a train could not even be asked about. Same blocker
six times running, so this lane stops instead of burning turns. No other credential was used:
the push route is the broker token by design, and the precedent here is `bc85ca7` (XYZ-1819),
where a branch waited rather than going around the gate.

**To finish, once the Mac is up:**

```sh
tok=$(curl -sf http://100.125.231.25:3131/api/ghtoken | python3 -c 'import json,sys;print(json.load(sys.stdin)["token"])')
GH_TOKEN=$tok git push origin agent-sylvia
curl -s -X POST http://100.125.231.25:3131/api/registry \
  -H "Content-Type: application/json" \
  -d '{"host":"german-box","name":"FD-sylvia","status":"done"}'
```

## Delivered

| # | Deliverable | Commit |
|---|---|---|
| 1 | `coordinator/` state dir + `check.py` | `db55a25` |
| 2 | `.claude/skills/coordinator-run/SKILL.md` | `a6fbe46` |
| 3 | `.claude/skills/coordinator-portal/SKILL.md` | `f2e57ea` |
| 4 | `coordinator/hooks/boot-gate.py` + README (disarmed) | `f6db8d9` |
| — | run-procedure proof, made by a fresh cheap session | `e70c552` |

All six acceptance proofs pass; output is on the issue. The hook is **not armed** — the
`settings.json` stanza and env contract are in `coordinator/hooks/README.md`, and arming is
an operator step.

## Decisions the operator still owns

1. `northstar.md` is empty. No operator statement of a northstar exists in the seed sources
   and inventing one is forbidden (DESIGN §2, §6). Tracked as `OQ-1`.
2. All four lanes are `state: UNKNOWN`, `seed: PROPOSED`. A seed is not intent until
   confirmed. Tracked as `OQ-2`.
3. The train-68 audit queue is not seeded as a lane — an audit queue is tactical task
   tracking, which DESIGN §6 keeps in Linear. Tracked as `OQ-3`.
4. The boot bundle sits at 85% of the 8192-byte gate with four lanes and five verbatim
   rulings, 87% after one sitrep. Verbatim quotes cannot shrink — that is the anti-paraphrase
   rule — so six live lanes needs either a bigger gate or `decisions-effective.md` out of the
   boot bundle.
5. The boot gate denies a gated seat all Bash. It allows by target instead of by command
   shape, because a command-shape classifier had a one-command bypass
   (`git log --output=coordinator/.seat-ack/<seat>` forges the ack marker) and, once correct,
   deadlocked the seat. If that is too blunt for orchestrator seats, say so.

— Sylvia
