# Context — what the earlier agents built and left open (read first)

Distilled by ORCHESTRATOR 32 (2026-09-05) from sessions `5197172c` (design + build),
`3a824d6c` (review + fixes) and the commit `505d53a` on `claude/account-usage-cronjob-29e68a`.

## A. Operator asks, in order

1. 14:58Z — "lets build a proper account usage check. its a cronjob that logs into our claude &
   codex sessions once every half hour and checks the usage and serves it on fleetdeck."
2. 15:04Z — "can we build a page called 'machines' where we show all of our machines: macbook,
   german-box, onboarding-vps, thinkpromptly-vps, ivy-vps, rog-strix — and then we show what
   each machine is logged in? claude CLI account, codex CLI account, claude desktop, codex desktop"
3. 17:10Z — "retrieve the session of the workers that worked on: machine overview with all
   logins and the usage"
4. 18:03Z — "review the diff and commit it"
5. 21:4xZ — "build out the localhost:3131/machines page where we have an overview of all of our
   machines and what claude / codex session they are logged in ... then start the worker lanes"

## B. Design decisions already made (keep them)

- No real "login" is possible; the page piggybacks on the sessions already signed in on each box.
- **Nothing is installed on a polled machine**: `box/fleet-logins.sh` is piped over
  `ssh <host> [wsl] sh -s`. The repo copy is the only copy.
- **Route per machine in `machines.json`**: `local` (macbook), `ssh` (german-box wsl+windows,
  onboarding-vps, thinkpromptly-vps, ivy-vps), `push` (rog-strix: no ssh route, runs the script
  on a cron and POSTs to `/api/machines`).
- **Identity only** on this page so far (email, org uuid, plan, account id, proof). Usage lives
  in the Credits pipeline (`/api/credits`, `accounts.html`). Lane 2 joins the two.
- **Tokens never leave the machine that owns them**: read into python memory, one profile call,
  header via a 0600 temp file (unlinked on exit AND on SIGHUP/SIGTERM), never printed, stored,
  logged, or served.
- **Rows keyed by the `machines.json` id**, never the reported hostname (the Mac's `hostname -s`
  is an rfc1918 address).
- **WSL both sides** on german-box: the collector reports the WSL distro and the Windows profile
  as separate identities tagged `local` / `windows`.
- TTL 300 s on GET collection; `?refresh=1` forces.
- Push endpoint accepts only a machine whose configured `route` is `push` (reviewer fix #2).
- A collector that could not run is the row's error (its `note`), never "nothing installed"
  (reviewer fix #1).

## C. What exists at `505d53a`

| file | role |
|---|---|
| `box/fleet-logins.sh` | collector (sh + python3), one JSON line per machine |
| `machines.json` | the six machines and their routes |
| `public/machines.html`, `public/machines.js` | the page |
| `server.js` (+218) | `/api/machines` GET/POST, `machinePayload`, `machinesCollect`, `machinesView`, `machinesRoute` |
| `test/machines.test.js` | 3 tests: token-vs-config precedence, rejected token fallback, route gating |
| `README.md`, `public/index.html`, `public/style.css` | docs, nav link, styles |

Suite: 191/191 on the Mac (2026-09-05 21:37 local).

## D. Open — the lanes exist for these

- The **real ssh sweep was never run**: all probes used a scratch script, never the production
  `fleet-logins.sh` through `machinesCollect`. The ssh/wsl argv path has no test either.
- `machines.json` names **`german-box`** and **`onboarding-box`** as ssh aliases — those are the
  1Password-agent / static-key routes. The deck must use the **cert aliases**: `gb-deploy`,
  `ob-deploy`, `vps-deploy`, `ivybox-deploy` (memory `machine-fleet`; handoff O12 §1.5).
- **Codex desktop identity** unresolved: the app is Electron; its session lives in Chromium
  `Login Data For Account` / `Account Web Data`, not `~/.codex/auth.json`.
- **Claude desktop identity** is an org uuid only (`plan-usage-history.json` `samples[].org`);
  the email comes from `credits-accounts.json` — only 1 of 4 uuids seen resolved.
- german-box **Windows-side Codex login was stale** (plan `plus`, refreshed 2026-05-27) vs the
  WSL side (`pro`, 2026-08-27) under the same account id — show it, flag it.
- Reviewer **#4**: a GET during an in-flight sweep returns stale rows with no "collecting" signal.
- Reviewer **#5**: `machinesCollect` duplicates `creditsCollect`'s throttle + fan-out pattern.
- **rog-strix** push cron never installed; rog-strix is Windows — whether it has WSL/sh is unknown.
- **Usage is not on the page** (ask 1 and 3). **Live sessions per machine are not on the page**
  (ask 5: "what claude / codex session they are logged in").
- The deck has not been restarted with this code: `up.sh` is **operator-only** (memory
  `up-sh-operator-only`). Landing = branch woven to main by the orchestrator + one operator
  `./up.sh`.

## E. Gotchas

- ssh to german-box goes zsh → CMD → wsl → bash: **zero quotes** in remote command strings;
  `m.ssh` values are argv elements to `execFile`/`spawn`, never interpolated.
- Mac Claude CLI credentials live in the login Keychain (`security find-generic-password
  -s "Claude Code-credentials" -w`), read via subprocess so the token is never a shell word.
- Claude desktop: `~/Library/Application Support/Claude/plan-usage-history.json`.
- `python3` must exist on the polled box; its absence is the collector-failed note.
- The Mac's real name is `scutil --get ComputerName`, not `hostname -s`.
