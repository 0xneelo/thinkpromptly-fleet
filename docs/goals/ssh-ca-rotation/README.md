# ssh-ca-rotation — a CA that only lives in 1Password, role principals, back-door keys chained or gone

Project: **remote-system** / sub-project: **deploy-keys**. Worker: **Ivo · security-engineer**, tag `agent-ivo`, box session `FD-ssh-ca-rotation`, branch `agent-ssh-ca-rotation`, base `origin/claude/local-orchestrator-f378c6` (Mac main 9d50afb + this pack + the research doc).
Packaged by 🎛 ORCHESTRATOR 20 on 2026-09-10 from 🔬 RESEARCHER 3's brief. Operator's words (via the researcher, ~23:30 local): "package it and notify the orchestrator to get it launched". Run mode: GPT xhigh, /goal (tonight's standing word).

Spec: `docs/research/ssh-ca-rotation-2026-09-10.md` (slices S1–S5, acceptance checks, gates). Memory: `deploy-ca-key-on-disk-unencrypted`. Findings are verified on the Mac by the researcher; treat the spec as the contract and this file as the split.

## The split — the worker never touches a host

| Who | What |
|---|---|
| **Ivo (this lane, on the german-box)** | every repo artifact: mint script profiles, trust + principals apply scripts, verification script, keys screen + mint route, runbook, docs. No ssh to any host, no minting, no `~/.ssh` reads, no key material in git. |
| operator | S1 create the new CA inside 1Password and export only the public half; S3 approve `deploy` users; S4 delete `~/.ssh/id_ed25519`; S5 approve deleting any static key. |
| host owners, using Ivo's scripts | think-box (lowcap 🎛 seat, ruling D-90), onboarding-app-box (onboarding-app session), ivy-box (operator), german-box + rog-strix (seat 20 on the operator's word). One host at a time, in runbook order, rollback line ready. |
| Mac-side discovery (S4 grep, S5 consumers) | operator or a Mac-local session; the researcher's findings list the known references. |

`inputs/` holds the two rog-strix scripts verbatim from worktree `vps-systems-setup-29a121` (untracked there). They embed two ed25519 PUBLIC keys: the v1 CA (`SHA256:Sg4TJdI9+SNBj8K0et1nEBhb8ntuX7ZzXSqzikyyDL0`) and `SHA256:JaxLCc5XTWKixVFdoHMCLQyzpsCTNTbMs6wO4hcvV/U` (bootstrap; identify it in M2). No private material (checked 2026-09-10).

## Milestones (each commits + pushes, each has tests or a dry-run)

**M1 — mint script.** `deploy-keys/mint-deploy-cert.sh`: `CA_PUB` override (env and `--ca-pub <file>`, default `~/.ssh/deploy-ca.pub`); Key ID `deployer-<stamp>-ca2` when the CA is not the v1 fingerprint above; profiles `--daily` (`-n deploy -V +8h -O clear -O permit-pty`) and `--admin` (`-n admin[,<box>-only…] -V +1h`, current extensions); the 1h/4h/8h cap unchanged. Test: a node test that generates a throwaway CA in a temp dir and signs through a test-only file-signing hook (never an agent), asserting `ssh-keygen -L`: principals, validity, Key ID tag, extensions. `shellcheck` clean.

**M2 — trust scripts, both CAs during transition.** Commit `inputs/setup-rog-strix-ca.ps1` and `inputs/bootstrap-rog-strix.sh` into `deploy-keys/` (verbatim, then only the multi-CA change). Extend `deploy-keys/setup-german-box-ca.ps1` and the rog-strix script to APPEND a CA line (one per line, idempotent, `-WhatIf`/dry-run). New `deploy-keys/apply-trust-linux.sh <v2-pub-file>`: idempotent append to `/etc/ssh/deploy_ca.pub`, `sshd -t` before reload, restore the previous file on failure, print resulting fingerprints. `deploy-keys/AGENT.md` and `deploy-keys/README.md` host lists gain rog-strix and note vibes-asus as a sixth box whose trust state is unknown (operator question, do not guess).

**M3 — principals + daily/admin.** Templates `deploy-keys/principals/<box>/` per the spec (`deploy` → `deploy`; `root` | `vibe` | `misterisley` → `admin` + `<box>-only`; legacy login name listed during transition). `deploy-keys/apply-principals-linux.sh` (creates a no-sudo `deploy` user if absent, installs `AuthorizedPrincipalsFile /etc/ssh/principals/%u`, `sshd -t`, reload, rollback) and `deploy-keys/apply-principals-windows.ps1` (`__PROGRAMDATA__/ssh/principals/%u`, standard non-admin `deploy` user, dry-run). `deploy-keys/verify-cert.sh <alias> --expect deploy|admin|refused` for the acceptance checks. The narrow sudoers line for `systemctl restart <app>` is a template with the app name as a parameter.

**M4 — keys screen + mint route.** `public/v2/screens/keys.js`: two buttons **Daily cert** (default) and **Admin cert**; per-box `<box>-only` chips only when Admin is selected; keep the label-keyed chip join from 9d50afb. `server.js` mint route: `profile: daily|admin` wired to `--daily`/`--admin`; validate the extra tags server-side. Tests in `test/v2-keys.test.js` (extend the 20 existing) and a mint-route test. Mirror `public/v2/logic.js` by hand — `npm run v2:compile` clobbers hand edits (memory `fleetdeck-v2-compile-clobbers-hand-edits`).

**M5 — runbook + final-state docs.** `docs/goals/ssh-ca-rotation/RUNBOOK.md`: the gated apply order S1 → S2 → S3 → S4 → S5, per host: who runs it, the exact command with Ivo's script, the check, the rollback; collision notes (think-box sshd sessions in lowcap; `lowcap_backup_pull` consumer in "Fix dead lowcap VPS backup-pull launchd job"); the S5 chained-keys table with the four keys and a `consumer: TO-DISCOVER (Mac-side)` column. `AGENT.md` documents the final state (two profiles, principals files, chained keys).

## Acceptance

1. All new tests pass on the box; the existing suite has two known baseline failures (credits host-wide discovery `3 !== 1`, v2 routable-screen extra `goals`) — those two are exempt, anything else is yours.
2. `shellcheck` clean on every new or changed `.sh`; every apply script has a dry-run that prints the exact host-side diff and changes nothing.
3. `git grep` on the branch finds no private key, cert, token or passphrase: only `.pub` content and fingerprints.
4. No ssh from the worker to any host during this goal (the report states it). No minting. `~/.ssh` on the box untouched.
5. RUNBOOK.md is complete enough that a host owner can apply one slice on one host from it alone.

## Out of scope

Applying anything to any host (gated, per the split). Deleting keys. GitHub App PEM rotation, the german-box gh OAuth token, Tailscale key expiry on rog-strix (2026-12-01). vibes-asus trust state (operator question).

## Constraints

- Push only over the broker token: `tok=$(curl -sf http://100.125.231.25:3131/api/ghtoken | python3 -c 'import json,sys;print(json.load(sys.stdin)["token"])'); GH_TOKEN=$tok git push origin agent-ssh-ca-rotation`. `GH_TOKEN` env only.
- Never restart the Mac deck. Never `ssh-add`, never touch an agent socket.
- Linear unreachable is never a blocker: `LINEAR-PENDING.md` here. The registry POST may answer 401/409 without a seat epoch: skip it, say so.
