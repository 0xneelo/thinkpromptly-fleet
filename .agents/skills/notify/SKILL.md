---
name: notify
description: One-verb fleet messaging with guaranteed delivery and an enforced ACK loop. Desktop seats (orchestrator <project>, global, researcher <N>, design <N>, coordinator <N>) are reached with Claude Code's built-in SendMessage by their ListAgents name; tmux workers (a worker name or host:session) over the Fleetdeck bus with auto-retry and an API ACK. Use when asked to /notify, notify, ping, or message another agent session and confirm it actually received and answered — instead of raw fleet-message sends, manual pane typing, or a bus send to a desktop chat.
---

# notify

Two kinds of target, two transports. Pick by the alias before anything else:

| Alias | Kind | Transport |
|---|---|---|
| `orchestrator <project>`, `global`, `researcher <N>`, `design <N>`, `coordinator <N>` | Claude Desktop seat | `SendMessage` tool — [Seats](#seats) |
| `<WorkerName>`, `worker <name>`, `host:session` | tmux worker | Fleetdeck bus via `fleet-notify.js` — [Workers](#workers) |

## Seats

A seat is a Claude Desktop session. The bus bridge can only type into whichever chat is
fronted (`claude-desktop:current`), so a seat alias over the bus lands in the wrong chat — the
deck refuses it with 409 `seat_unaddressable`. Use the tools every Claude Code session has:

1. `ListAgents`. Match the alias to exactly one row name:
   - `orchestrator <project>` → starts with `🎛 ORCHESTRATOR` and contains `· <project>`
     (spelling drifts: `lowcap-connector` / `lowcapconnector` / `lowcap` are one project).
     No such row → `curl -s http://127.0.0.1:3131/api/seats`: the `orchestrator` row's
     `owner_name` (only with `fenced:true` and `expires_at` in the future) is the seat's session
     name even when it was never renamed.
   - `global` → `🌐 GLOBAL` · `researcher <N>` → `🔬 RESEARCHER <N>` · `design <N>` →
     `🎨 DESIGN <N>` · `coordinator <N>` → `🧭 COORDINATOR <N>`.
   - Only `interactive` rows are seats on this Mac. `Remote Control` rows are other machines.
2. `SendMessage` to that exact row name. First line says what it is about; ask for the reply
   by your own name (the first line of the `ListAgents` output):
   ```
   [notify] from <your badge or worker name>: <one-line ask>
   <detail>
   Reply via SendMessage to <your session name> when handled.
   ```
   Add `notify_when_idle: true` when you must know the seat finished its turn.
3. The ACK is the seat's reply. It arrives in your conversation as a
   `<cross-session-message from="…">` — nothing to poll, nothing to curl.

Two rows match → send to neither; ask the operator which. No row → the seat is not live on
this Mac: say so, list what `ListAgents` showed, and leave the message where the seat reads
instead (`operator-handoff`, or a Linear comment via `linear-handoff`). Never resend a seat
alias over the bus, never hand-type into a pane.

Not on this Mac (a german-box tmux worker): a desktop seat is out of reach. Leave a Linear
comment on the goal issue and say so in your report. `--open-chat` on the bus CLI is the
operator's escape hatch for when they have the seat fronted; an agent does not use it.

## Workers

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
`resolvedVia` is `address`, `name`, or `label` — `label` means no worker carries that name and a
session label mentioned it as a whole word; check `resolvedTarget` before trusting it.

| Alias | Resolves to |
|---|---|
| `<WorkerName>` or `worker <name>` | registry lookup → `host:session` tmux worker (worker / session name first, label word-match as fallback) |
| `host:session` | passed through unchanged |
| a seat alias | 409 `seat_unaddressable` naming the seat owner — go to [Seats](#seats) |

Ambiguous alias → HTTP 409 with candidates. Unknown → 404 with live sessions. Pick one, resend.

### Options

- `--no-ack` — fire-and-forget (delivery still verified + retried).
- `--timeout <sec>` — ACK wait, default 120.
- `--open-chat` — operator only: best-effort delivery to whichever Claude Desktop chat is open;
  disables the ACK wait unless `--expect-ack` is also set (`--expect-ack` cannot combine with `--no-ack`).
- Env: `FLEETDECK_URL` (default `http://127.0.0.1:3131`), `FLEETDECK_BUS_TOKEN` (bearer, required off-loopback).

## Receiving a notify

Over the bus, the message arrives with header `[notify <id>] from <sender>` and an ACK footer.
Do what it asks (or answer the question), then run the footer command:

```bash
curl -s -X POST "$FLEETDECK_URL/api/notify/<id>/ack" -H "Authorization: Bearer $FLEETDECK_BUS_TOKEN" -H 'content-type: application/json' -d '{"from":"<your name>","response":"<one line>"}'
```

Local sessions use `http://127.0.0.1:3131` and no auth header.
As a `<cross-session-message>` (a seat), reply with `SendMessage` to its `from` name instead.
Always ACK — the sender is blocked on it.

## When it fails

- `delivered:false` — bus delivery failed after auto-retries. Audit: `curl -s "http://127.0.0.1:3131/api/notify?limit=20"`. Wedged pane → `tmux send-keys -t <session> C-u`, then resend.
- `delivered:true, acked:false` — receiver got it but never ACKed. Nudge with a second notify referencing the id, or check the target directly.
- `SendMessage` errors naming two candidates → resend with the ` [ref]` the error shows.

## API (for scripts)

- `POST /api/notify` `{to, from, text, expectAck?, openChat?}` → `{id, messageId, resolvedTarget, resolvedVia, status}`; seat aliases return 409 `{ok:false, error:'seat_unaddressable', seat, owner:{host,name,fenced}|null, hint}` unless `openChat`
- `GET /api/notify/<id>` → notify row (including `resolved_via`) joined with `delivery`, `delivery_error`, `delivered`, and `acked`
- `GET /api/notify?limit=20` → recent audit list
- `POST /api/notify/<id>/ack` `{from, response}` → `{ok}` (first ACK wins; repeats return `already:true`)

`GET /api/notify` (the audit list) is loopback-only. `GET /api/notify/<id>` and both POSTs are
reachable on loopback, or over the tailnet with the bus bearer token — the same gate `/api/messages`
carries, so a remote receiver can ACK and a remote sender can poll its own notify.
