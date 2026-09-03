---
name: notify
description: One-verb fleet messaging with guaranteed delivery and an enforced ACK loop. Resolves a friendly alias — orchestrator <project>, global, researcher <N>, design <N>, coordinator <N> (Claude Desktop seats, delivered on that session's own cross-session socket), a worker name, or host:session — via the Fleetdeck registry, delivers over the Fleetdeck bus, auto-retries failed delivery, and blocks until the receiver ACKs back through the API. Use when asked to /notify, notify, ping, or message another agent session and confirm it actually received and answered — instead of raw fleet-message sends, manual pane typing, or a bus send into whichever desktop chat is open.
---

# notify

## Quick start

```bash
FLEETDECK_ROOT=/Users/misterislez/remote-system
node "$FLEETDECK_ROOT/bin/fleet-notify.js" send --to "orchestrator lowcap-connector" --from "<your badge or worker name>" "Deploy window opens 14:00 — confirm."
```

Preflight once per session: `curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3131/api/notify?limit=1`.
`404` means the running deck predates the notify layer (it needs an operator `./up.sh` restart) —
say so in one line and fall back to the `fleetdeck-message-bus` skill for this send; do not
retry `/api/notify` or hand-type into a pane.

Blocks (default 120s) until the receiver ACKs. Prints one JSON line:
`{"id","resolvedTarget","resolvedVia","delivered","acked","ackFrom","ackResponse"}`.
`resolvedVia` is `seat`, `address`, `name`, or `label` — `label` means no worker carries that name and a
session label mentioned it as a whole word; check `resolvedTarget` before trusting it.

## Targets

| Alias | Resolves to |
|---|---|
| `orchestrator <project>` / `orchestrator-<project>` | the live Claude Desktop session titled `🎛 ORCHESTRATOR <N> · <project> · …` (spelling drift ok: `lowcap-connector` = `lowcapconnector`); else the fenced `orchestrator` lease owner from `/api/seats` |
| `global` · `researcher <N>` · `design <N>` · `coordinator <N>` | the live session titled `🌐 GLOBAL` · `🔬 RESEARCHER <N>` · `🎨 DESIGN <N>` · `🧭 COORDINATOR <N>` |
| `<WorkerName>` or `worker <name>` | registry lookup → `host:session` tmux worker (worker / session name first, label word-match as fallback) |
| `host:session` | passed through unchanged; `claude-desktop:<session name>` addresses a desktop session by its `ListAgents` name |

Ambiguous alias → HTTP 409 with candidates. Unknown → 404 with live sessions. Pick one, resend.

## Desktop seats

A seat is a Claude Desktop session. The deck finds it by its `ListAgents` name (the `/rename`
title) in `~/.claude/sessions/` and writes the notify straight onto that session's cross-session
socket — the same channel `SendMessage` uses — so it lands in that chat whatever is fronted.
`resolvedTarget` is `claude-desktop:<session name>`; check it is the seat you meant.

409 `seat_unaddressable` means no live session is titled for that seat: it is not running, or
was never renamed (`/rename 🎛 ORCHESTRATOR <N> · <project> · <topic>`). Say so and leave the
message where the seat reads instead (`operator-handoff`, or a Linear comment via `linear-handoff`).
`--open-chat` is the operator's escape hatch — best-effort typing into whichever chat is open — not
an agent's.

If the 409 hint reads "delivers to whichever chat is open", the running deck predates seat
delivery (operator `./up.sh` pending). From a desktop session, deliver with the built-in tools
instead: `ListAgents`, pick the row titled for the seat, `SendMessage` to that exact name with
`[notify] from <you>: …` and ask for a `SendMessage` reply — the reply is the ACK. From a tmux
worker there is no route until the restart; leave a Linear comment.

## Options

- `--no-ack` — fire-and-forget (delivery still verified + retried).
- `--timeout <sec>` — ACK wait, default 120.
- `--open-chat` — operator only: best-effort delivery to whichever Claude Desktop chat is open; disables the ACK wait unless `--expect-ack` is also set (`--expect-ack` cannot combine with `--no-ack`).
- Env: `FLEETDECK_URL` (default `http://127.0.0.1:3131`), `FLEETDECK_BUS_TOKEN` (bearer, required off-loopback).

## Receiving a notify

The message arrives with header `[notify <id>] from <sender>` and an ACK footer. In a desktop
seat it shows as `<cross-session-message from="fleetdeck:<sender>">` — `fleetdeck:` is the bus, not
a name `SendMessage` can reach, so ACK with the footer, never by replying. Do what it asks (or
answer the question), then run:

```bash
curl -s -X POST "$FLEETDECK_URL/api/notify/<id>/ack" -H "Authorization: Bearer $FLEETDECK_BUS_TOKEN" -H 'content-type: application/json' -d '{"from":"<your name>","response":"<one line>"}'
```

Local sessions use `http://127.0.0.1:3131` and no auth header.
Always ACK — the sender is blocked on it.

## When it fails

- `delivered:false` — bus delivery failed after auto-retries. Audit: `curl -s "http://127.0.0.1:3131/api/notify?limit=20"`. Wedged pane → `tmux send-keys -t <session> C-u`, then resend. A desktop seat that "is not live" restarted or closed between resolve and delivery — resend.
- `delivered:true, acked:false` — receiver got it but never ACKed. Nudge with a second notify referencing the id, or check the target directly. `ackFrom` says who answered; a mismatch with `resolvedTarget` means the wrong session got it.

## API (for scripts)

- `POST /api/notify` `{to, from, text, expectAck?, openChat?}` → `{id, messageId, resolvedTarget, resolvedVia, status}`; a seat with no live session returns 409 `{ok:false, error:'seat_unaddressable', seat, owner:{host,name,fenced}|null, hint}` unless `openChat`
- `GET /api/notify/<id>` → notify row (including `resolved_via`) joined with `delivery`, `delivery_error`, `delivered`, and `acked`
- `GET /api/notify?limit=20` → recent audit list
- `POST /api/notify/<id>/ack` `{from, response}` → `{ok}` (first ACK wins; repeats return `already:true`)
- `POST /api/messages` accepts `{type:'claude-desktop', session:'<ListAgents name>'}` as a target too; `GET /api/messages` lists the live ones under `targets`

`GET /api/notify` (the audit list) is loopback-only. `GET /api/notify/<id>` and both POSTs are
reachable on loopback, or over the tailnet with the bus bearer token — the same gate `/api/messages`
carries, so a remote receiver can ACK and a remote sender can poll its own notify.
