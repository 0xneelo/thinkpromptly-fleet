# fleetdeck

Browser deck for Claude-code worker fleets running in tmux on remote ssh hosts.
Lists every tmux session on each host in `hosts.json`, one click attaches a live
terminal tile, "Connect all" opens a tile per session.

    npm install && npm start   # http://localhost:3131

**Tests.** The suite is `node:test`, no framework. It needs the dependencies installed **in the
worktree you run it from**: `node_modules/` is gitignored, so a fresh clone and every fresh
`git worktree` starts without it.

    npm install   # once per worktree — 6 packages, about 2s
    npm test      # node --test, one file at a time

`npm test` checks that first. `scripts/check-deps.js` runs as `pretest` and prints one line
naming the missing packages, instead of letting the first test file die on `Cannot find
module 'ws'` — a stack trace that reads like a broken branch. Every test binds its own
loopback port and writes its own temp `fleet.db`, so a run never touches the operator's deck.

**Message bus.** Fleetdeck persists messages in `fleet.db`, serializes delivery per target,
and supports the current Claude Desktop session plus local or configured remote tmux sessions. Build the
macOS bridge once, then send from Codex, Claude, scripts, or the Bus panel:

    npm run build:claude-bridge
    bin/fleet-message.js --to claude-desktop:current --from codex-desktop "hello from Codex"
    bin/fleet-message.js --to mac:local-agent --from claude-desktop "hello local CLI"
    bin/fleet-message.js --to german-box:LC-worker --from orchestrator "check the handoff"

The Claude bridge uses macOS Accessibility, posts into Claude's current Code session, and
restores the previously focused app. Grant Accessibility access when macOS first asks. Remote
senders set `FLEETDECK_URL=http://100.125.231.25:3131` and
`FLEETDECK_BUS_TOKEN`; Fleetdeck creates that token at `~/.fleetdeck-bus-token` with mode 0600.
Message IDs are idempotent, failed deliveries stay visible and retryable, and tailnet message
POSTs require the bearer token.

**GitHub train.** The train broker is its own process, `fleetdeck-train.js`, run as a macOS
launch agent (`com.fleetdeck.train`). It holds the GitHub App PEM and the train window in
memory and mints 1h installation tokens; the deck **proxies** `/api/ghtoken` and
`/api/ghtrain` on both listeners to it, so every consumer URL is unchanged. The point is
that the train now survives `./up.sh` — deck restarts no longer close it. Install and
operate it with:

    sh mac/install-train-agent.sh            # --status, --uninstall, --print
    sh mac/provision-fleet-secrets.sh        # FLEET_TAILNET_KEY + FLEETDECK_BUS_TOKEN

Full operations notes, failure modes and crash semantics: `docs/train-broker.md`.

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

**Accounts view.** `/accounts.html` (API path stays `/api/credits`) shows plan usage per
team account, most constrained first — 5-hour, 7-day and paid extra-usage credits for each
Claude account, plus the Codex/ChatGPT weekly window, with a header summary of how many
accounts are at or over a limit and what has been spent. Three sources feed it, best first:
the live OAuth usage endpoint (needs a valid Claude Code token on that machine, gives real
reset times), the Claude desktop app's `plan-usage-history.json` (derived numbers only,
covers accounts with no CLI login), and `POST /api/credits` for machines outside the fleet.
**Access tokens never leave the machine that owns them** — the collector calls the endpoint
locally and emits only percentages, amounts and reset stamps. The desktop app's
`config.json` holds a token cache and is never read.

**Usage history.** Each account's sparkline is the desktop app's own 7-day series. Every
machine sends at most 300 samples per org and the deck stores at most that many per org per
report, from at most 25 orgs — the limit is enforced at the writer, not trusted from the
sender, because `/api/credits` accepts pushes from machines off the fleet. Samples merge
into `credits_history` (org + second is the key, so the same sample from two machines lands
once) and keep **60 days**, pruned by whichever path writes. One box therefore fills in the
accounts another stopped sampling. The `seen on` line names every machine reporting that
account and how.

`credits-accounts.json` maps each Claude org uuid to a person. A CLI login on any fleet
machine proves an account's email and flips its row to confirmed; unconfirmed rows are
labelled as such in the view. To confirm the remaining one, sign that account into Claude
Code once on any fleet machine and refresh.

`box/fleet-credits.sh` is the master copy, installed on the box like `fleet-lastmsg.sh`:

    ssh -o BatchMode=yes german-box "wsl tee /home/vibe/bin/fleet-credits.sh" < box/fleet-credits.sh
    ssh -o BatchMode=yes german-box "wsl chmod +x /home/vibe/bin/fleet-credits.sh"

A `kind: linux` host runs it directly, at the same path and without the `wsl` prefix:

    ssh -o BatchMode=yes onboarding-box "mkdir -p /home/vibe/bin && tee /home/vibe/bin/fleet-credits.sh" < box/fleet-credits.sh
    ssh -o BatchMode=yes onboarding-box "chmod +x /home/vibe/bin/fleet-credits.sh"

A machine outside the fleet pushes instead of being polled — on a cron:

    sh fleet-credits.sh push http://<tailnet-ip>:3131/api/credits

A desktop-app sample only refreshes while that account is actually being used, so the view
shows each sample's age; an org sampled days ago is stale data, not idle usage.

**Quote-free rule.** `ssh german-box <cmd>` traverses zsh → Windows CMD → wsl → bash.
Nested quotes get mangled and there is no reliable escaping, so every remote command
string contains ZERO quotes; commands go through `execFile`/`pty.spawn` arg arrays and
session names must match `/^[A-Za-z0-9_-]+$/` or they are rejected.

**Holder invariant.** WSL only stays alive while a *disconnected* RDP session for user
Vibe is running `wsl -e sleep infinity` — RDP in as Vibe, run it, then close the window
(disconnect, never sign out). The header badge goes red when that holder is gone.

**Host entries.** `hosts.json` holds either `"name"` (a Windows+WSL box) or
`{"name":…, "kind":"linux", "ssh":"<alias>"}`. `ssh` is the `~/.ssh/config` alias the deck
dials, when that differs from the fleet name the UI shows. german-box carries
`"ssh":"gb-deploy"` — an alias pinned to the short-lived deploy cert with
`IdentityAgent none`, so the ~20s poll never wakes the operator's 1Password agent. `Host
german-box` stays the operator's own route and is untouched. There is no fallback: when
the cert expires the poll fails and the deck logs one line naming
`deploy-keys/mint-deploy-cert.sh` as the fix. Mint a fresh cert, then Refresh.

**1Password trap.** A locked 1Password ssh agent makes every ssh through a 1Password-backed
alias fail with `communication with agent failed`; the header shows amber "1P LOCKED" —
unlock the Mac's 1Password, then Refresh/Reconnect. The box polls no longer take this route.
