# SSH CA rotation + role principals + back-door key cleanup

**From:** 🔬 RESEARCHER 3 · ssh-ca-rotation
**Research date:** 2026-09-10
**Status of this file:** findings brief **plus** the operator-requested launch package (operator, 2026-09-10 ~23:30: "package it and notify the orchestrator to get it launched"). The orchestrator owns `/introduce-goal`; this file is the spec it hands the worker.
**ELI5 companion (operator-facing):** https://claude.ai/code/artifact/0407ea09-707c-489e-a490-285dcd4cdcd4
**Memory:** `deploy-ca-key-on-disk-unencrypted.md` in the remote-system memory dir.

## Findings (all REAL, verified on the Mac today)

| # | Finding | Evidence (sources) |
|---|---|---|
| F1 | **The deploy CA private key sits on disk.** `~/.ssh/id_ed25519` (dated 2026-07-21) IS the CA (`SHA256:Sg4TJdI9+SNBj8K0et1nEBhb8ntuX7ZzXSqzikyyDL0`). Until 21:10 today it had **no passphrase**; `ssh-keygen -y -P ''` succeeded. The operator added a passphrase at ~21:10 as a stopgap. The 1Password agent holds the same key, so the Touch ID gate on every mint was bypassable by any process running as the operator. | 3: disk file fingerprint, `ssh-add -L` via the 1P socket, `~/.ssh/deploy-ca.pub` |
| F2 | The 2026-08-15 session that chose `id_ed25519` as CA asserted it "never existed on disk". Wrong. Nobody ever decided to delete it; the move-to-1P-then-delete step was done for the GitHub App PEM only. | transcript `0bcc0bcf…` 2026-08-15T15:29Z; file mtime |
| F3 | **rog-strix refusals were principal omissions**, not trust problems. Mints 09-06 21:58 → 09-08 00:42 carried `root,vibe` only (UI chip missing, fixed in `5a75007`); 09-08 19:43 `vibe` only; 09-09 00:53 `vibe,root`. Cert auth to `rs-deploy` and `gb-deploy` both verified OK today with a `misterisley,vibe,root` cert. | `ssh-keygen -L ~/.ssh/deploy-certs/*/deployer-cert.pub`; live `ssh -v` |
| F4 | **rog-strix CA-trust bootstrap is uncommitted.** `deploy-keys/setup-rog-strix-ca.ps1` + `bootstrap-rog-strix.sh` exist only untracked in worktree `vps-systems-setup-29a121`. `deploy-keys/AGENT.md`/`README.md` host lists omit rog-strix. | git log --all; worktree `git status` |
| F5 | **Four more static private keys on disk, no passphrase:** `ivy-deploy`, `lowcap_backup_pull`, `onboarding-box`, `vps-onboarding-app-sync`. One host each. No `authorized_keys` restrictions known. | `ssh-keygen -y -P ''` per file |
| F6 | No `ForwardAgent` anywhere in `~/.ssh/config`. Good. | grep |
| F7 | Every VPS cert is a **root** cert; promptly/onboarding/ivy share the `root` principal and cannot be scoped apart. Windows boxes log in as administrators (`vibe`, `misterisley`), which Windows OpenSSH runs elevated. | `public/v2/screens/keys.js:45`; machine-fleet memory |
| F8 | Done today outside the repo (researcher, operator-visible): `Host 138.199.198.246` block in `~/.ssh/config` gained `CertificateFile`/`IdentityFile deploy-certs/current/*` lines (cert first, passphrase key as fallback). Backup in the session scratchpad. | `ssh -o BatchMode=yes 138.199.198.246 'echo ok'` → ok |

## Recommendation → ONE goal, five ordered slices

Suggested worker role: `security-engineer` (or `devops-engineer`). Branch off `main`. Owned files: `deploy-keys/*`, `public/v2/screens/keys.js`, `server.js` (mint route only), `machines.json`, `docs/`. **Boxes are touched only through the admin cert the operator mints for the worker.**

**Ordering rule (no-downtime):** every box trusts BOTH CAs during the transition. Old CA is removed from trust last. Nothing is deleted before the new path is proven on all five boxes.

### Slice 1 — New CA, born inside 1Password  ⛔ operator gate
1. Operator creates a new SSH key **inside 1Password** (title `fleet-deploy-ca`), never exports the private half.
2. Worker: `mint-deploy-cert.sh` gains `CA_PUB` override (default `~/.ssh/deploy-ca.pub`) and writes which CA signed into the cert Key ID (`deployer-<stamp>-ca2`), so old/new certs are distinguishable in `ssh-keygen -L` and on the keys screen.
3. Operator exports only the **public** half to `~/.ssh/deploy-ca-v2.pub`.
Acceptance: `ssh-keygen -L` of a test cert shows the new CA fingerprint; `ssh-add -L` via the 1P socket lists it; **no file under `~/.ssh` matches it with `ssh-keygen -y`.**

### Slice 2 — Every door trusts the new stamp (both CAs during transition)
1. Linux ×3 (`think-box`, `onboarding-app-box`, `ivy-box`): append the v2 pub to `/etc/ssh/deploy_ca.pub` (file may hold several CAs, one per line); `sshd -t`; reload.
2. Windows ×2: extend `deploy-keys/setup-german-box-ca.ps1` to append; **commit** `setup-rog-strix-ca.ps1` + `bootstrap-rog-strix.sh` from worktree `vps-systems-setup-29a121` (fix the AGENT.md/README host lists to include rog-strix; keep the "trust line above `Match Group administrators`" + "restart sshd via SYSTEM schtask" notes).
3. Prove: a v2-signed cert logs in on all five (`gb-deploy`, `rs-deploy`, `vps-deploy`, `ob-deploy`, `ivybox-deploy`).
Acceptance: five green `ssh -o BatchMode=yes <alias> 'echo ok'` with a v2 cert AND with a v1 cert (both still work).

### Slice 3 — Guest lists (role principals) + daily/admin split
1. Linux ×3: create user `deploy` (no sudo; owns the app/repo dirs it needs; one narrow sudoers line per box for `systemctl restart <app>` if needed). Windows ×2: create a **standard** (non-admin) user `deploy`.
2. Every box: `AuthorizedPrincipalsFile /etc/ssh/principals/%u` (Windows: `__PROGRAMDATA__/ssh/principals/%u`). Files: `principals/deploy` = `deploy`; `principals/root` (Windows: `principals/vibe`, `principals/misterisley`) = `admin` + `<box>-only` (`promptly-only`, `onboarding-only`, `ivy-only`, `german-only`, `rog-only`). **During transition also list the legacy login name** (`root` / `vibe` / `misterisley`) so v1 certs keep working; drop it in Slice 5.
3. `mint-deploy-cert.sh`: two profiles. `--daily` → `-n deploy -V +8h -O clear -O permit-pty`. `--admin` → `-n admin[,<box>-only…] -V +1h` (current extensions). Keys screen (`keys.js` BOXES map + `server.js` mint route): two buttons **Daily cert** (default) / **Admin cert**, optional per-box chips only on Admin (they add `<box>-only`). `machines.json` / ssh aliases: `*-deploy` aliases log in as `deploy`; add `*-admin` aliases logging in as root/vibe/misterisley.
Acceptance: daily cert → shell as `deploy` on all five, `sudo -n true` fails; admin cert → root/admin shell on all five; a `promptly-only` cert opens promptly and is refused by the other four.

### Slice 4 — Shred the photocopy  ⛔ operator gate
Operator deletes `~/.ssh/id_ed25519` (+ `.pub` stays harmless). Worker first grep-proves nothing else references it: `~/.ssh/config` (lines 3/22/83 today), `~/.gitconfig`, LaunchAgents, fleetdeck `server.js`/`machines.json`, lowcap `scripts/deploy-vps.sh`. Any hit gets cert lines (pattern from F8).
Acceptance: `ssh-keygen -y -f ~/.ssh/id_ed25519` → no such file; minting still works (agent holds the v2 key); all five aliases still green.

### Slice 5 — Chain or retire the four back-door keys; retire CA v1
1. For each of `ivy-deploy`, `lowcap_backup_pull`, `onboarding-box`, `vps-onboarding-app-sync`: find the consumer (cron? script? which box?). If a robot truly needs it: keep it, but on the box's `authorized_keys` prefix the line with `command="<one exact command>",from="<one address>",no-pty,no-port-forwarding,no-agent-forwarding,no-X11-forwarding`; add a passphrase-less-is-OK note **only** because the chain limits it. Otherwise delete the key pair and switch the consumer to a daily cert.
2. Remove CA v1 (`Sg4T…`) from every box's trust file and delete `~/.ssh/deploy-ca.pub` (v1). Drop the legacy login names from the principals files.
Acceptance: `ssh -i <key>` for a chained key can run only its one command; a v1-signed cert is refused on all five; `deploy-keys/AGENT.md` documents the final state (two profiles, principals files, chained keys table).

## Operator gates (human-only)
- Slice 1: create the key in 1Password; export only the pub. Touch ID per mint thereafter.
- Slice 3: approve creating `deploy` users on five boxes.
- Slice 4: delete `~/.ssh/id_ed25519`.
- Slice 5: approve deleting any of the four static keys.

## Out of scope
Rotating the GitHub App PEM (already 1P-only), the german-box long-lived gh OAuth token (separate, still "pending operator go" since 2026-08-15), Tailscale key expiry on rog-strix (2026-12-01).

## Pointers
- Worktree with this brief: `/Users/misterislez/remote-system/.claude/worktrees/cert-minting-behavior-9ba0dd` (branch `claude/cert-minting-behavior-9ba0dd`, local only).
- Uncommitted rog-strix scripts: `/Users/misterislez/remote-system/.claude/worktrees/vps-systems-setup-29a121/deploy-keys/`.
- Mint log (principals per mint): `for d in ~/.ssh/deploy-certs/2026*; do ssh-keygen -L -f $d/deployer-cert.pub | grep -A3 Principals; done`.
- ssh config backup from today's raw-IP patch: session scratchpad `ssh-config.bak-*`.

## Adjacent live sessions (collision risk on the same boxes, seen in list_sessions 2026-09-10 20:xxZ)
- lowcap-connector: "Remove deploy CA key from prod root authorized_keys", "Harden prod VPS sshd: no root password login", "Lowcap-connector VPS security hardening" — all touch think-box `sshd_config` / `authorized_keys`. Sequence Slice 2/3 after them or hand the same worker both.
- lowcap-connector: "Fix dead lowcap VPS backup-pull launchd job" — that job is the consumer of `lowcap_backup_pull` (Slice 5 input).
- remote-system: "vibes-asus machine chip" (branch `claude/add-vibes-asus-chip-93dd75`) — adds a sixth box to the keys screen chips; Slice 3 rewrites that chip map. Weave order matters.
