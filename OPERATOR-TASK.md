# Operator tasks

Append-only. Each section is one human-only gate or one blocking decision, tracked in Linear.

## 2026-09-03 — decision: make Fleetdeck desktop seats addressable by /notify (XYZ-1965)

- **Why this is yours:** a fork in the bus delivery contract. Option A depends on a private Claude Code protocol; option B keeps a wrong-chat delivery as its first step. Not an agent's call.
- **Do this:** reply on XYZ-1965 with `A` or `B` (default if silent: A). Also rule whether `researcher N` / `design N` aliases stay while no address exists behind them.
- **Decision needed:** A = route by Claude Code session over the cross-session socket (`~/.claude/sessions/<pid>.json` → `/tmp/cc-socks/<pid>.sock`, `peerProtocol: 1`), stamped through the fenced seat-claim path. B = keep `claude-desktop:current`, compare the ACK `from` with the seat `owner_name`, mark `misdelivered`, requeue. **Recommendation: A.** B only if the socket protocol proves unreachable from a plain Node process.
- **Blocked until you do:** every notify to a desktop seat needs the operator to front that chat and the sender to pass `--open-chat`; the addressability slice cannot start.
- **Verify (once built):** with a different chat fronted, `node bin/fleet-notify.js send --to "orchestrator lowcapconnector" --from Luise "ping"` lands in the ORCHESTRATOR chat and `ackFrom` matches the owner from `/api/seats`.
- **Source:** XYZ-1965 (options, evidence), XYZ-1964 (the fail-closed slice), `server.js` `resolveNotifyTarget`, `bin/fleet-message.js`. Session: Luise · platform-engineer.

## 2026-09-03 — gate: merge the notify fail-closed slice and restart the deck with `./up.sh` (XYZ-1966)

- **Why this is yours:** `server.js` is the live deck process; restart is operator-only (the 1Password cert follows the starting process). Agents never run `./up.sh`.
- **Do this:** 1. merge branch `claude/fleetdeck-notify-seat-delivery-bf2b7a` into `main` (or weave it into the next train; the pushed SHA is in the XYZ-1964 comments). 2. In `~/remote-system` on `main`: `./up.sh`. Default: yes, in the next quiet window.
- **Blocked until you do:** the live deck still types seat-alias notifies into whichever Claude Desktop chat is fronted and `fleet-notify` still blocks up to 120 s on an ACK from the wrong chat; the updated notify skill describes a 409 / `--open-chat` / `--expect-ack` / GET `resolved_via`,`delivered`,`acked` contract the live deck does not serve yet.
- **Verify:** `curl -s -o /dev/null -w '%{http_code}\n' -X POST http://127.0.0.1:3131/api/notify -H 'content-type: application/json' -d '{"to":"global","from":"operator","text":"ping"}'` → `409`; `curl -s http://127.0.0.1:3131/api/notify/n-287c97a691c4cb27` carries `delivered` and `acked` booleans.
- **Source:** XYZ-1966, XYZ-1964, XYZ-1965, branch above. Session: Luise · platform-engineer.
