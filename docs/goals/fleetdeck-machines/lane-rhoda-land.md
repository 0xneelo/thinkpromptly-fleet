# Lane 1 — Rhoda · platform-engineer — land the Machines page against the real fleet

Goal G1 · Linear **XYZ-2112** (lane MAIN; parent XYZ-2111) · host **Mac** (the deck host: the
collector's ssh aliases and the Keychain local route exist only there) · tmux `FD-rhoda-machines`
· worktree `/Users/misterislez/remote-system/.claude/worktrees/rhoda-machines-land` · branch
`agent-rhoda/machines-land` from `origin/claude/account-usage-cronjob-29e68a`.

Read `context.md` first. Then `git log -1 --stat 505d53a` and the commit message: it lists the
reviewer findings #1–#6 and which were fixed.

## Steps (each a Linear sub-issue under XYZ-2112, committed as a milestone)

1. **Rebase** onto `origin/main` (`git fetch origin`; the deck main moved past `93e1d49`). Resolve
   conflicts in the credits/collector region minimally. `npm test` → green (191 at base).
2. **Aliases + host field.** `machines.json`: `german-box` → `"ssh": "gb-deploy"`, keep `"wsl": true`;
   `onboarding-vps` → `"ssh": "ob-deploy"`; `thinkpromptly-vps` stays `vps-deploy`; `ivy-vps` stays
   `ivybox-deploy`. Add `"host"` = the deck's hosts.json key where one exists (`macbook: "mac"`,
   `german-box: "german-box"`, `onboarding-vps: "onboarding-box"`). Update README's alias prose.
   Why: `german-box`/`onboarding-box` are the 1Password-agent / static-key routes; the deck's sweep
   must not depend on an unlocked 1Password (O12 handoff §1.5, memory `machine-fleet`).
3. **Real sweep, isolated.** Start a second deck from your worktree — spare port, own DB, tailnet
   listener and reaper off (`PORT=3132 FLEET_DB=$PWD/fleet-lane.db FLEET_NO_LISTEN=1 FLEET_NO_REAPER=1
   node server.js` — confirm each knob in server.js first; if a knob does not do what its name says,
   find the right one, never guess). Then `curl -s 'http://127.0.0.1:3132/api/machines?refresh=1'`.
   Target: macbook (Keychain Claude CLI, `~/.codex/auth.json`, Claude desktop, Codex desktop),
   german-box (WSL side + Windows side), onboarding-vps, thinkpromptly-vps, ivy-vps → each `ok`.
   Check the cert first: `ssh-keygen -Lf ~/.ssh/deploy-certs/current/deployer-cert.pub`; expired →
   `operator:gate` and continue with what you can. Never point anything at `:3131` or its `fleet.db`.
4. **Fix what the sweep breaks** in `box/fleet-logins.sh` / `machinesCollect`: python3 missing on a
   box (the `note` path must show), wsl argv, Keychain read (`security find-generic-password` may
   need the login keychain unlocked — if it prompts a GUI dialog you cannot answer, record it as the
   row's error and file an issue), desktop-app paths. **Codex desktop identity**: it is Electron; the
   session lives in Chromium `Login Data For Account` / `Account Web Data`. Copy the sqlite file to a
   0700 temp dir before reading (the app holds a lock), read the account **email only**, never a
   cookie or token value, delete the copy. If that is not clean in one sitting, ship
   `state: 'unknown_source'` with a chip and file a follow-up — do not sink the lane in it.
   **Claude desktop**: org uuid → email via `credits-accounts.json` (already the labeler); when
   unmapped show the uuid and say "unmapped org" rather than nothing.
5. **Reviewer #4.** `machinesView()` gains `collecting: true|false` and `collect_started_at` while
   a sweep is in flight; the page shows a "collecting…" chip and re-polls until it clears. Test it.
6. **Reviewer #5** (shared throttle + fan-out helper for `creditsCollect`/`machinesCollect`) only if
   the diff stays small and the suite stays green; otherwise file the follow-up and say so.
7. **Argv test.** Stub the spawn path and assert the exact argv for a `route: ssh` + `wsl: true`
   machine: `['-o','BatchMode=yes','-o','ConnectTimeout=8','gb-deploy','wsl sh -s']` with the script
   on stdin, and the `sh -s` variant for a Linux host. Assert `route: push` machines are skipped.
8. **rog-strix.** No Windows collector here. File ONE `operator:gate` issue: the push line the page
   prints (`sh fleet-logins.sh push http://<tailnet-ip>:3131/api/machines rog-strix`), the question
   "does rog-strix have WSL or Git Bash?", recommendation (WSL cron if yes; PowerShell port as a
   follow-up lane if no).
9. **Push early** — right after step 3 has evidence — and comment the SHA on XYZ-2112 so Valentin
   can rebase. Push again at the end.

## Coordination

You own `box/fleet-logins.sh`, `machines.json`, `machinesCollect`/`machinesRoute`/`machinePayload`,
the collector + route tests, README §Machines. Valentin (XYZ-2113, german-box) owns
`public/machines.js|html`, the machines CSS block, and adds `machinesUsage`/`machinesSessions`
called from `machinesView`. Keep your `machinesView` change to the `collecting` keys.

## Credentials

- GitHub (Mac): `eval "$(/Users/misterislez/remote-system/deploy-keys/mint-github-token.sh --broker
  --askpass)"` then `git push https://x-access-token@github.com/0xneelo/thinkpromptly-fleet.git
  agent-rhoda/machines-land`; delete the helper dir it prints. Broker 503 → `operator:gate`
  "start a GitHub train on localhost:3131/keys.html", keep working.
- Host ssh: the cert aliases only. Never `ssh-add`, never the 1Password agent, never mint.

## Report (comment on XYZ-2112)

Per-machine table: id · route · state · clients (client/where/state/proof/email or org) · error.
Suite count. Pushed SHA + `git ls-remote origin agent-rhoda/machines-land`. Issues filed.
Emails and org uuids may appear; token, cookie and header values never.

## Done when

XYZ-2112 Done with that report; branch pushed and remote-verified; suite green; all five polled
machines `ok` or each failure a filed issue; the rog-strix gate filed. Then release:
`python3 ~/.claude/workers/name.py close Rhoda`; `sh ~/.claude/session-kind/mark.sh --clear`;
registry `status: done`.
