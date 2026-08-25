# fleetdeck

Browser deck for Claude-code worker fleets running in tmux on remote ssh hosts.
Lists every tmux session on each host in `hosts.json`, one click attaches a live
terminal tile, "Connect all" opens a tile per session.

    npm install && npm start   # http://localhost:3131

**Session registry.** `fleet.db` (sqlite, server is the only writer) keeps a row per
`host + tmux session` with label / role / worker / status / note, so a killed or vanished
worker stays visible in the Registry view instead of disappearing. Status is one of
`active | done | kill-requested | killed | hidden`. Agents classify sessions with
`curl -X POST localhost:3131/api/registry -d '{"host":"german-box","name":"LC-x","label":"lane 24 worker"}'`;
`/api/registry/delete` drops a row and `/api/kill` runs `tmux kill-session` (irreversible).

**Last msg.** The Registry's "Last msg" column is the timestamp of the last assistant turn
in each session's Claude Code transcript (`~/.claude/projects/<cwd-slugified>/<newest>.jsonl`
on the box) — a truer idle signal than pane activity. `box/fleet-lastmsg.sh` is the master
copy; it must be **installed on the box** at `/home/vibe/bin/fleet-lastmsg.sh` (stdin, since
the remote command string may hold no quotes or redirects):

    ssh -o BatchMode=yes german-box "wsl mkdir -p /home/vibe/bin"
    ssh -o BatchMode=yes german-box "wsl tee /home/vibe/bin/fleet-lastmsg.sh" < box/fleet-lastmsg.sh
    ssh -o BatchMode=yes german-box "wsl chmod +x /home/vibe/bin/fleet-lastmsg.sh"

Missing script or failed ssh is not an error: rows keep their stored `msg_at`, new ones show `—`.

**Quote-free rule.** `ssh german-box <cmd>` traverses zsh → Windows CMD → wsl → bash.
Nested quotes get mangled and there is no reliable escaping, so every remote command
string contains ZERO quotes; commands go through `execFile`/`pty.spawn` arg arrays and
session names must match `/^[A-Za-z0-9_-]+$/` or they are rejected.

**Holder invariant.** WSL only stays alive while a *disconnected* RDP session for user
Vibe is running `wsl -e sleep infinity` — RDP in as Vibe, run it, then close the window
(disconnect, never sign out). The header badge goes red when that holder is gone.

**1Password trap.** A locked 1Password ssh agent makes every ssh fail with
`communication with agent failed`; the header shows amber "1P LOCKED" — unlock the Mac's
1Password, then Refresh/Reconnect.
