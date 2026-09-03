---
name: notify
description: One-verb fleet messaging with guaranteed delivery and an enforced ACK loop. Resolves a friendly alias (orchestrator <project>, researcher <N>, design <N>, global, a worker name, or host:session) via the Fleetdeck registry, delivers over the Fleetdeck bus, auto-retries failed delivery, and blocks until the receiver ACKs back through the API. Use when asked to /notify, notify, ping, or message another agent session and confirm it actually received and answered — instead of raw fleet-message sends or manual pane typing.
---

# notify

## Quick start

```bash
FLEETDECK_ROOT=/Users/misterislez/remote-system
node "$FLEETDECK_ROOT/bin/fleet-notify.js" send --to Ivy --from "<your badge or worker name>" "Deploy window opens 14:00 — confirm."
```

Preflight once per session: `curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3131/api/notify?limit=1`.
`404` means the running deck predates the notify layer (it needs an operator `./up.sh` restart) —
say so in one line and fall back to the `fleetdeck-message-bus` skill for this send; do not
retry `/api/notify` or hand-type into a pane.

Blocks (default 120s) until the receiver ACKs. Prints one JSON line:
`{"id","resolvedTarget","resolvedVia","delivered","acked","ackFrom","ackResponse"}`.
`resolvedVia` is `seat`, `address`, `name`, or `label` — `label` means no worker carries that name and a session label mentioned it as a whole word; check `resolvedTarget` before trusting it.

## Targets

| Alias | Resolves to |
|---|---|
| `orchestrator <project>` / `orchestrator-<project>`<br>`global`<br>`researcher <N>`<br>`design <N>` | Claude Desktop seat — refused with 409 `seat_unaddressable` naming the seat owner unless `--open-chat` |
| `<WorkerName>` or `worker <name>` | registry lookup → `host:session` tmux worker (worker / session name first, label word-match as fallback) |
| `host:session` | passed through unchanged |

Ambiguous alias → HTTP 409 with candidates. Unknown → 404 with live sessions. Pick one, resend.

## Desktop seats

Claude Desktop delivery lands in whichever chat is open because a seat has no address of its own yet (addressability decision: XYZ-1965). The 409 names the current seat owner from `/api/seats` (`orchestrator <project>` only; `global`, `researcher N` and `design N` have no seat row, so `owner` is null; over the tailnet `owner` is always null because the seats read is loopback-only); open that seat's chat, then resend with `--open-chat`. This is best-effort and does not wait for an ACK unless `--expect-ack` is also set. When expecting an ACK, check `ackFrom` against the named owner.

## Options

- `--open-chat` — opt into best-effort delivery to whichever Claude Desktop chat is open; disables ACK wait by default.
- `--expect-ack` — wait for an ACK, including with `--open-chat`; cannot be combined with `--no-ack`.
- `--no-ack` — fire-and-forget (delivery still verified + retried).
- `--timeout <sec>` — ACK wait, default 120.
- Env: `FLEETDECK_URL` (default `http://127.0.0.1:3131`), `FLEETDECK_BUS_TOKEN` (bearer, required off-loopback).

## Receiving a notify

The message arrives with header `[notify <id>] from <sender>` and an ACK footer.
Do what it asks (or answer the question), then run the footer command:

```bash
curl -s -X POST "$FLEETDECK_URL/api/notify/<id>/ack" -H "Authorization: Bearer $FLEETDECK_BUS_TOKEN" -H 'content-type: application/json' -d '{"from":"<your name>","response":"<one line>"}'
```

Local sessions use `http://127.0.0.1:3131` and no auth header.
Always ACK — the sender is blocked on it.

## When it fails

- `delivered:false` — bus delivery failed after auto-retries. Audit: `curl -s "http://127.0.0.1:3131/api/notify?limit=20"`. Wedged pane → `tmux send-keys -t <session> C-u`, then resend.
- `delivered:true, acked:false` — receiver got it but never ACKed. Nudge with a second notify referencing the id, or check the target directly. For Claude Desktop targets, see [Desktop seats](#desktop-seats).

## API (for scripts)

- `POST /api/notify` `{to, from, text, expectAck?, openChat?}` → `{id, messageId, resolvedTarget, resolvedVia, status}`; refused seats return `{ok:false, error:'seat_unaddressable', seat, owner:{host,name,fenced}|null, hint}`
- `GET /api/notify/<id>` → notify row (including `resolved_via`) joined with `delivery`, `delivery_error`, `delivered`, and `acked`
- `GET /api/notify?limit=20` → recent audit list
- `POST /api/notify/<id>/ack` `{from, response}` → `{ok}` (first ACK wins; repeats return `already:true`)

`GET /api/notify` (the audit list) is loopback-only. `GET /api/notify/<id>` and both POSTs are
reachable on loopback, or over the tailnet with the bus bearer token — the same gate `/api/messages`
carries, so a remote receiver can ACK and a remote sender can poll its own notify.
