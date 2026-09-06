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

**Machines view.** `/machines.html` lists every machine in `machines.json` and, per machine,
which account each of the four AI clients is signed in as: Claude CLI, Codex CLI, Claude
desktop, Codex desktop. Each cell names the person (via `credits-accounts.json`), the
address, and how the identity was proved — `token-proved` when the machine asked its own
token who it belongs to, `config only` when it could only read a config file, `last active`
when the fact comes from the Claude desktop app's own history. A WSL box reports both sides,
tagged `WSL` and `Windows`.

**Desktop sessions.** `/sessions.html` merges Claude Desktop Code tabs across accounts and
machines, with account, machine, live-status, archive, and text filters. Each row's
Session details panel has a Copy conversation button: the row's metadata as `Label: value`
lines, then the transcript that `GET /api/desktop-sessions/transcript` renders from the
session's `<cliSessionId>.jsonl` on the owning machine via `box/desktop-transcript.sh`
(text and tool calls; thinking dropped, tool output clipped). Its read-only
`GET /api/desktop-sessions` returns `groups` keyed by account UUID, org UUID, and machine,
plus per-machine collection status. Org labels come from `credits-accounts.json`.
Enable a machine with `"desktop_sessions": true` on its existing `machines.json` entry;
the Mac and german-box are enabled, while rog-strix remains deferred. The same local/SSH
routing used by Machines pipes `box/desktop-sessions.sh` to the configured deploy alias.

The collector opens only `<accountUuid>/<orgUuid>/local_<id>.json` beneath the Mac
`~/Library/Application Support/Claude/claude-code-sessions` directory or Windows users'
`AppData/Local/Packages/Claude_*/LocalCache/Roaming/Claude/claude-code-sessions` directory
(also `AppData/Roaming/Claude/claude-code-sessions`). It reads no Claude config, credential,
transcript, or peer-key files. Only the named session metadata fields enter SQLite.

Collection has a five-minute TTL; `?refresh=1` requests a new sweep, and concurrent loads
share a sweep. Failed or partial scans retain cached sessions with visible status. A
complete empty scan removes old rows for that machine. Local live badges join
`cliSessionId` to `sessionId` in the deck's existing live process/socket registry on every
GET. Remote liveness is `unknown`, since a remote process cannot be proved by the Mac's
registry. Live local rows send through the existing message bus using a stable `id:<UUID>`
target, resolved again at delivery; they never fall back to the frontmost chat.

Fixture overrides: `FLEET_DESKTOP_SESSIONS_SH`, `FLEET_DESKTOP_SESSIONS_TTL_SECS`, and
`FLEET_DESKTOP_WINDOWS_USERS`, alongside the existing Machines and isolated database
knobs. All API collection timestamps are Unix milliseconds; session timestamps are ISO UTC.
`npm test` covers the collector, cache, route, and message-ID join. Optional browser
acceptance uses an external Playwright install and only a fixture HTTP server:

    PLAYWRIGHT_MODULE=/path/to/playwright node scripts/verify-desktop-sessions-ui.js

Set `CHROMIUM_PATH` if the browser is installed separately, and `DESKTOP_SCREENSHOT_DIR`
to retain dark, light, and mobile screenshots. This script never starts the live deck.

**Nothing is installed on a polled machine.** `box/fleet-logins.sh` is piped over
`ssh <host> [wsl] sh -s`, so the master copy in this repo is the only copy. A machine with no
ssh route from here (rog-strix) pushes instead, on a cron — the page prints the exact line.
Only a `route: push` machine is accepted there; a polled machine's row is what the deck read
over ssh, never what a tailnet peer claims about it. A wrapper fallback line (no python3,
collector crashed) shows as the row's error, not as "nothing installed":

    sh fleet-logins.sh push http://<tailnet-ip>:3131/api/machines rog-strix

Rows are keyed by the `machines.json` id, never by the hostname a machine reports: the Mac
answers `hostname -s` with an rfc1918 address that names nobody — that answer travels as
`reported_host` and is shown as a fact, not used as a key. A machine that is down keeps
its last known logins on screen with the ssh error beside them.

**ssh aliases are deploy certs.** `machines.json` names `gb-deploy`, `ob-deploy`,
`vps-deploy` and `ivybox-deploy` — the certificate aliases under `~/.ssh/deploy-certs/current`.
The older `german-box` / `onboarding-box` aliases go through the 1Password agent or a static
key, so a sweep that used them would fail whenever 1Password happened to be locked; the deck
must not depend on that. An expired cert is an operator gate, never something the deck mints.
Where a machine is also one of the deck's own hosts it carries `host` — the `hosts.json` key,
plus `mac` for the deck itself. That is the key a machines row would be joined to its sessions
and leases by; nothing joins on it yet, it is carried so the join has a key to use.

**Identity only.** The Claude access token and the Codex tokens are read into python memory
on the machine that owns them, used for that machine's one profile call, and never printed,
stored in `fleet.db`, logged, or sent to a browser — the request headers go through a 0600
temp file, so no token appears in `ps`. `~/.claude.json` can name a *different* account than
the token in use, so the token's own answer wins and the config is shown as a fallback.

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
