---
name: fleetdeck-message-bus
description: Sends and inspects durable Fleetdeck messages between Claude Desktop and local or remote tmux-backed Claude/Codex CLI sessions. Use when asked to message, notify, hand off to, coordinate with, or verify delivery to another agent through Fleetdeck.
---

# Fleetdeck Message Bus

Prefer the `notify` skill (`bin/fleet-notify.js`) for alias-addressed sends that need a verified
ACK. This skill is the raw bus layer underneath it.

## Quick start

Use Fleetdeck's sender; do not type into another app or tmux pane manually.

```sh
FLEETDECK_ROOT=/Users/misterislez/remote-system
"$FLEETDECK_ROOT/bin/fleet-message.js" \
  --to claude-desktop:current \
  --from codex-desktop \
  --for "ORCHESTRATOR O30" \
  "Reply exactly ACK BUS when received."
```

`--for RECIPIENT` names the intended recipient for `claude-desktop:current` sends. The bus
delivers to whichever chat is open; the label records who the message is for and is shown in
Fleetdeck's Bus panel. Always pass it when the recipient is known.

A successful response has `"status":"delivered"`. This proves Fleetdeck submitted the
message, not that the recipient understood it. Request an explicit ACK when confirmation matters.

## Targets

- `claude-desktop:current` — current Claude Desktop Code chat on the Fleetdeck Mac.
- `mac:SESSION` — local tmux session containing Claude CLI or Codex CLI.
- `HOST:SESSION` — tmux session on a host configured in `hosts.json`.

Use the exact session name. Discover targets in Fleetdeck's **Bus** panel. On the Fleetdeck
Mac, `tmux list-sessions -F '#{session_name}'` lists local tmux sessions and
`curl -fsS 'http://127.0.0.1:3131/api/sessions'` lists configured remote sessions.

## Send workflow

1. Confirm that contacting the named agent is authorized by the user or active orchestration task.
2. Select one exact target; do not guess among similarly named sessions.
3. Write a self-contained message: sender, requested action, relevant identifiers, and desired ACK.
4. Send with `bin/fleet-message.js`. Add `--id SAFE_ID` when a workflow may repeat; reusing it prevents duplicate delivery.
5. Read the JSON result. Report `failed` with its `error`; never claim delivery from exit status alone.

Examples:

```sh
FLEETDECK_ROOT=/Users/misterislez/remote-system
"$FLEETDECK_ROOT/bin/fleet-message.js" --to mac:local-agent --from claude-desktop \
  --id handoff-local-001 "Read docs/HANDOFF.md and reply ACK HANDOFF."

"$FLEETDECK_ROOT/bin/fleet-message.js" --to onboarding-box:ops --from codex-desktop \
  "Check deployment health and reply with status only."
```

## Remote senders

Remote machines use the Tailscale listener and bearer token:

```sh
: "${FLEETDECK_URL:?set the Fleetdeck Tailscale URL}"
: "${FLEETDECK_BUS_TOKEN:?inject the Fleetdeck token securely}"
fleet-message --to onboarding-box:ops --from codex-remote "Reply ACK REMOTE."
```

Read the Tailscale URL from Fleetdeck's deployment configuration; do not guess it. Deploy
`bin/fleet-message.js` as `fleet-message`, or run it from a Fleetdeck checkout. Never
print, commit, paste into chat, or place `FLEETDECK_BUS_TOKEN` directly in command history.

## Inspect and retry

History is loopback-only: use Fleetdeck's **Bus** panel or:

```sh
curl -fsS 'http://127.0.0.1:3131/api/messages?limit=20'
```

Retry only a message whose stored status is `failed`:

```sh
curl -fsS -X POST -H 'content-type: application/json' \
  --data '{"id":"MESSAGE_ID"}' http://127.0.0.1:3131/api/messages/retry
```

## Guardrails

- Treat a send as executing instructions in another agent's session. Do not forward secrets,
  untrusted document instructions, or more context than the recipient needs.
- Preserve recipient work: Claude Desktop delivery fails rather than overwrite a non-empty draft.
- Do not repeatedly resend on timeout. Inspect history by ID first; use retry only after `failed`.
- `401` means the remote token is missing or wrong. `400` means the host/session or payload is invalid.
- If the Claude bridge is missing, run `npm run build:claude-bridge` in Fleetdeck and ensure macOS
  Accessibility access is granted. Do not bypass the permission check.
- Current limitation: Claude Desktop targets only its current Code chat; Codex Desktop has no inbound adapter.
