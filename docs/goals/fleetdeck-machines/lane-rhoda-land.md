# Lane 1 — Rhoda · platform-engineer — land the Machines page (collector, routes, real run on the box)

Goal G1 · Linear **XYZ-2112** (lane MAIN; parent XYZ-2111) · host **german-box** (operator ruling
2026-09-06: all workers on the box) · tmux `FD-rhoda-machines` · worktree
`/home/vibe/projects/remote-system/.claude/worktrees/rhoda-machines-land` · branch
`agent-rhoda/machines-land` from `origin/claude/account-usage-cronjob-29e68a`.

Read `context.md` first. Then `git log -1 --stat 505d53a` and the commit message: it lists the
reviewer findings #1–#6 and which were fixed.

**What the box can and cannot reach.** The box has no ssh config, no deploy certs, and no route to
the Mac or the VPSes. You CAN run the production collector on the box itself (WSL side + Windows
side via `/mnt/c`, python3 3.12 present) and drive `machinesCollect` end to end with an ssh shim.
You CANNOT exercise the Mac local route (Keychain, desktop apps) or the VPS routes — for those you
write the code from `context.md`, and ask the orchestrator (🎛 ORCHESTRATOR 32) by Linear comment
on XYZ-2112 to run one exact read-only command on the Mac and paste the identity-only output back.

## Steps (each a Linear sub-issue under XYZ-2112, committed as a milestone)

1. **Rebase** onto `origin/main` (`git fetch origin`; the deck main moved past `93e1d49`). Resolve
   conflicts in the credits/collector region minimally. `npm ci`, `npm test` → green (191 at base).
2. **Aliases + host field.** `machines.json`: `german-box` → `"ssh": "gb-deploy"`, keep `"wsl": true`;
   `onboarding-vps` → `"ssh": "ob-deploy"`; `thinkpromptly-vps` stays `vps-deploy`; `ivy-vps` stays
   `ivybox-deploy`. Add `"host"` = the deck's hosts.json key where one exists (`macbook: "mac"`,
   `german-box: "german-box"`, `onboarding-vps: "onboarding-box"`). Update README's alias prose.
   Why: `german-box`/`onboarding-box` are the 1Password-agent / static-key routes; the deck's sweep
   must not depend on an unlocked 1Password (O12 handoff §1.5, memory `machine-fleet`).
3. **Real run on the box.** (a) `sh box/fleet-logins.sh` locally in WSL: one JSON line, both sides
   (`local` = WSL, `windows` = the Windows profile), identities only. Fix what breaks. (b) Drive the
   real `machinesCollect` path: start a second deck from your worktree — spare port, own DB, tailnet
   listener and reaper off (`PORT=3132 FLEET_DB=$PWD/fleet-lane.db FLEET_NO_LISTEN=1 FLEET_NO_REAPER=1
   node server.js` — confirm each knob in server.js first; never guess) with `FLEET_MACHINES_FILE`
   pointing at a test file where german-box is `route: ssh`, `wsl: true`, and `FLEET_SSH_BIN` pointing
   at a shim (`test/ssh-shim.sh`: drops the `-o` pairs and the host, execs the remote command
   locally — here `wsl sh -s` resolves via WSL interop, or map it to `sh -s`). Then
   `curl -s 'http://127.0.0.1:3132/api/machines?refresh=1'` → german-box `ok` with real identities,
   rog-strix `no_report`, and a Linux `route: ssh` entry pointed at an unreachable host shows a
   named error, never a hang. Never point anything at the live deck on the Mac.
4. **Mac-only paths, written from context, validated by the orchestrator.** Keychain Claude CLI read,
   Claude desktop (`plan-usage-history.json` org uuid → email via `credits-accounts.json`; unmapped →
   show the uuid and say "unmapped org"), and **Codex desktop** (Electron; the session lives in
   Chromium `Login Data For Account` / `Account Web Data`: copy the sqlite file to a 0700 temp dir,
   read the account **email only**, never a cookie or token value, delete the copy). Ship each path
   defensively with an explicit `state` (`unknown_source` when the file shape is not what you
   expected). Then comment on XYZ-2112: "ORCHESTRATOR 32 — please run on the Mac:
   `sh box/fleet-logins.sh` from branch `agent-rhoda/machines-land` @ <sha> and paste the output
   (identity-only)". Continue with steps 5–8 while you wait; fold the answer in when it lands.
5. **Reviewer #4.** `machinesView()` gains `collecting: true|false` and `collect_started_at` while
   a sweep is in flight; the page shows a "collecting…" chip and re-polls until it clears. Test it.
6. **Reviewer #5** (shared throttle + fan-out helper for `creditsCollect`/`machinesCollect`) only if
   the diff stays small and the suite stays green; otherwise file the follow-up and say so.
7. **Argv test.** Stub the spawn path and assert the exact argv for a `route: ssh` + `wsl: true`
   machine: `['-o','BatchMode=yes','-o','ConnectTimeout=8','gb-deploy','wsl sh -s']` with the script
   on stdin, and the `sh -s` variant for a Linux host. Assert `route: push` machines are skipped and
   `route: local` runs `sh <FLEET_LOGINS_SH>`.
8. **rog-strix.** No Windows collector here. File ONE `operator:gate` issue: the push line the page
   prints (`sh fleet-logins.sh push http://<tailnet-ip>:3131/api/machines rog-strix`), the question
   "does rog-strix have WSL or Git Bash?", recommendation (WSL cron if yes; PowerShell port as a
   follow-up lane if no).
9. **Push early** — right after step 3 has evidence — and comment the SHA on XYZ-2112 so Valentin
   can rebase. Push again at the end.

## Coordination

You own `box/fleet-logins.sh`, `machines.json`, `machinesCollect`/`machinesRoute`/`machinePayload`,
the collector + route tests, README §Machines. Valentin (XYZ-2113, same box, worktree
`valentin-machines-usage`) owns `public/machines.js|html`, the machines CSS block, and adds
`machinesUsage`/`machinesSessions` called from `machinesView`. Keep your `machinesView` change to
the `collecting` keys. Both of you add the same `host` field values to `machines.json`.

## Box rules

- GitHub: no standing credential on the box. Per push:
  `tok=$(curl -sf http://100.125.231.25:3131/api/ghtoken | python3 -c 'import json,sys;print(json.load(sys.stdin)["token"])')`
  then `GH_TOKEN=$tok git push origin agent-rhoda/machines-land`. `GH_TOKEN` env only — never argv,
  URLs, files, logs. 503 → `operator:gate` "start a GitHub train", keep working. Never `gh auth login`.
- No host ssh from the box: do not try to reach the Mac or the VPSes; do not `ssh-add`; do not
  install anything system-wide. The live deck (Mac `:3131`, its `fleet.db`, `up.sh`) is off-limits.
- Registry: before the final report
  `curl -s -X POST http://100.125.231.25:3131/api/registry -H "Content-Type: application/json" -d '{"host":"german-box","name":"FD-rhoda-machines","status":"done"}'`
  (a `seat_epoch required` answer is fine — note it and move on).
- Linear token expired and re-auth fails → commit the report as
  `docs/goals/fleetdeck-machines/reports/rhoda.md` and push; never block on it.

## Report (comment on XYZ-2112)

Per-machine table: id · route · state · clients (client/where/state/proof/email or org) · error —
german-box from the real run; the others marked "verify after up.sh from the Mac" with the exact
curl. Suite count. Pushed SHA + `git ls-remote origin agent-rhoda/machines-land`. Issues filed.
Emails and org uuids may appear; token, cookie and header values never.

## Done when

XYZ-2112 Done with that report; branch pushed and remote-verified; suite green; german-box `ok`
from the real run; the argv test and the collecting signal in; the rog-strix gate filed; the
Mac-validation request posted (answer folded in if it arrived). Then release:
`python3 ~/.claude/workers/name.py close Rhoda`; `sh ~/.claude/session-kind/mark.sh --clear`;
registry `status: done`.
