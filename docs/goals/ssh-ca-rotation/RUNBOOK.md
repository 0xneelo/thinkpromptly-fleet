# SSH CA rotation owner runbook

Prepared by **Ivo (security-engineer), agent-ivo**, remote-system / deploy-keys.
This is a gated future operation. Nothing below has been applied by this worker.
The repository scripts and offline tests are the delivery; live acceptance belongs to
host owners. Execute S1 → S2 → S3 → S4 → S5 in that order. Finish a slice on all five
hosts before starting the next. Stop on any failed check; never repair access by exporting
the CA private half. Never restart the Mac deck as part of this runbook.

## Who, where, and prerequisites

| Host | Owner/authorization | Address | Daily / Admin alias | Privileged login | Box-only principal |
|---|---|---|---|---|---|
| german-box | seat 20, on operator word | 100.80.44.86 | gb-deploy / gb-admin | vibe | german-only |
| rog-strix | seat 20, on operator word | 100.124.95.60 | rs-deploy / rs-admin | misterisley | rog-only |
| onboarding-app-box | onboarding-app session | 178.104.80.26 | ob-deploy / ob-admin | root | onboarding-only |
| ivy-box | operator | 168.119.52.183 | ivybox-deploy / ivybox-admin | root | ivy-only |
| think-box | lowcap orchestrator seat, D-90 | 138.199.198.246 | vps-deploy / vps-admin | root | promptly-only |

Use the table's order within each slice. Think-box is last and **held** until its owner
clears collisions with “Remove deploy CA key from prod root authorized_keys”, “Harden prod
VPS sshd: no root password login”, and “Lowcap-connector VPS security hardening”. Do not
replace their sshd_config or authorized_keys changes. `lowcap_backup_pull` also intersects
“Fix dead lowcap VPS backup-pull launchd job”; that owner must supply the S5 consumer facts.
No worker in this goal contacts or coordinates those sessions.

vibes-asus is a sixth machine with **UNKNOWN trust/account state**, not an approved target.
It has no principal template, mint tag, or apply command here. Admin box chips are removed.
Owner decision: inspect first, then authorize a separately scoped onboarding; recommendation
is to keep it outside this rotation until verified. GitHub App PEM/OAuth rotation and
rog-strix Tailscale expiry (2026-12-01) are outside this runbook.

Before touching one host:

1. Obtain that owner's approval and a maintenance window. Preserve an existing privileged
   session and a working console/recovery route. On Windows the restart drops **every SSH
   session**, including that privileged session. Before every Windows apply, prove the
   **wsl-machine non-certificate admin login** below and retain an independent console.
2. Stage the reviewed `deploy-keys/` directory **with its lib/ and principals/ subdirectories**
   from branch `agent-ssh-ca-rotation` at a pushed SHA listed in REPORT.md. Work locally on the
   target, from the staged repository root. On **both Windows boxes**, stage that root at
   `C:\ProgramData\ssh-ca-rotation` (so it contains deploy-keys\lib and deploy-keys\principals).
   In an elevated cmd run `cd /d C:\ProgramData\ssh-ca-rotation`; in elevated PowerShell run
   `Set-Location C:\ProgramData\ssh-ca-rotation`. Use PowerShell 5.1+ with LocalAccounts
   and ScheduledTasks modules. The table commands work from cmd via powershell.exe.
   Linux: root via sudo, Python 3.8+, OpenSSH, systemd, useradd/usermod.
3. Stage only the operator-exported v2 **public** key: Linux `/var/tmp/deploy-ca-v2.pub`;
   Windows `C:\ProgramData\ssh\deploy-ca-v2.pub`. Compare its SHA256 fingerprint to the operator's
   separately supplied public fingerprint. Never place private CA material on any host.
4. Linux examples use service `ssh` and `/usr/sbin/sshd`. Verify locally that this is the
   installed service/binary; if the unit is `sshd`, consistently use `--service sshd` in apply
   **and rollback**. Windows derives its validator from the sshd Win32_Service PathName;
   verify that executable. If detection is ambiguous, stop and pass the verified full path
   through `-Sshd` for apply and rollback.
5. Review `sshd_config` plus its Includes/Match rules and public authorized_keys entries.
   A `cert-authority` authorized_keys entry can trust a CA independently of TrustedUserCAKeys;
   v1 retirement must cover that path too, under its owning lane. Do not guess or remove it here.
6. Run the relevant dry-run **on the target** to get the actual file diff. Offline `--root`
   fixtures demonstrate the planner but are not a substitute for reviewing that host.

Windows recovery gate, **Mac operator only**: export only the public half of the existing
1Password **wsl-machine** key to `$HOME/.ssh/wsl-machine.pub`, and verify fingerprint
`SHA256:JaxLCc5XTWKixVFdoHMCLQyzpsCTNTbMs6wO4hcvV/U`. Use the matching 1Password agent
identity with certificate/config fallback disabled, independently on each Windows host:

```bash
for LOGIN_TARGET in vibe@100.80.44.86 misterisley@100.124.95.60; do
  ssh -F /dev/null -o IdentitiesOnly=yes -o CertificateFile=none \
    -o PubkeyAcceptedAlgorithms=ssh-ed25519 -o StrictHostKeyChecking=yes \
    -o PreferredAuthentications=publickey -o PasswordAuthentication=no -o KbdInteractiveAuthentication=no \
    -o IdentityAgent="$HOME/Library/Group Containers/2BUA8C4S2C.com.1password/t/agent.sock" \
    -i "$HOME/.ssh/wsl-machine.pub" "$LOGIN_TARGET" 'whoami /groups'
done
```

Require Administrators SID `S-1-5-32-544` enabled in the resulting token, not deny-only.
If that named fallback does not already work on a host, stop: this rotation does not install
it. A cert login or an existing connection is not the recovery proof. These are future
owner commands; this worker neither accesses the agent nor runs SSH.

All apply entry points accept a dry-run (`--dry-run`, `-DryRun`, or `-WhatIf`). Dry-runs
write no files, users, ACLs, services, tasks, or backups. They show the full file changes,
account actions, and planned validation/reload. Linux `--root` is allowed only for offline
previews. Ordinary reruns are idempotent. Existing symlink/reparse targets are refused. Applies also refuse SSH policy files/directories
owned by or writable to unprivileged users; owners must resolve unsafe directory permissions
before retrying. Windows backup-directory ACLs explicitly inherit Administrators/SYSTEM
permissions so the detached recovery task can read its manifest and backup files.

A host-wide lock serializes trust and principals applies/rollbacks, including planning and
snapshot reads. Linux uses a protected lock file; Windows uses a named mutex and a pending
marker covering the detached restart. Dry-run does not acquire a persistent file lock.
Linux baseline `sshd -T` checks are mandatory across IPv4/IPv6 contexts: trust must resolve
to `/etc/ssh/deploy_ca.pub`; initial S3 must have no pre-existing principals file/command.
An unchanged managed rerun or explicit `--retire-legacy` may retain this script's exact
managed principals policy. Unrecognized Includes/Match policy requires owner reconciliation,
never silent rewriting. Trust append must retain v1 in the planned file unless `--retire-v1`.
The deploy password-denial Match block precedes existing Match rules; an earlier Include
that could defeat precedence is refused. Verify the actual target dry-run before proceeding.

On apply, scripts validate the baseline, save a private-to-admin **public-configuration**
backup, install changes, validate again, and reload/restart only sshd. Linux automatically
restores on validation/reload failure. Windows restores on synchronous validation failure;
its detached SYSTEM restart task restores files/ACLs and restarts the old configuration if
restart fails. Never assume “queued” means “succeeded”. Record the printed backup path.
New deploy accounts are disabled on failed apply/rollback; their homes/data are retained
for owner review. No automatic deletion of user data occurs.

## S1 — operator creates the CA inside 1Password

**Human gate:** operator creates an SSH key inside 1Password, title `fleet-deploy-ca`, and
exports only its public half to `~/.ssh/deploy-ca-v2.pub` on the **Mac**. Do not generate a CA
on disk and import it. Do not export/copy the private half. The v1 public fingerprint is
`SHA256:Sg4TJdI9+SNBj8K0et1nEBhb8ntuX7ZzXSqzikyyDL0`.

Mac operator terminal only (never this worker):

```bash
ssh-keygen -lf "$HOME/.ssh/deploy-ca-v2.pub" -E sha256
./deploy-keys/mint-deploy-cert.sh --admin --ca-pub "$HOME/.ssh/deploy-ca-v2.pub" --dry-run
```

The preview must report the agreed new fingerprint, `admin`, 1h, and Key ID ending `-ca2`.
The operator may list the 1Password agent's **public** keys to compare fingerprints:

```bash
SSH_AUTH_SOCK="$HOME/Library/Group Containers/2BUA8C4S2C.com.1password/t/agent.sock" ssh-add -L |
  ssh-keygen -lf - -E sha256
```

The operator's Mac-side inventory must confirm no on-disk private key corresponds to the
new CA. Do not print private contents or copy them into tickets. Record fingerprints and
pass/fail only. This inventory and all actual minting are explicitly outside Ivo's execution.

For S2, the operator needs a **v2 legacy-login cert** while hosts still use login-name
principals, and a still-valid v1 legacy cert. Mint them on the Mac with 1Password approval:

```bash
V2_LEGACY=$(./deploy-keys/mint-deploy-cert.sh --legacy -n root,vibe,misterisley,tabor -t 8h --ca-pub "$HOME/.ssh/deploy-ca-v2.pub")
V1_LEGACY=$(./deploy-keys/mint-deploy-cert.sh --legacy -n root,vibe,misterisley,tabor -t 8h --ca-pub "$HOME/.ssh/deploy-ca.pub")
ssh-keygen -Lf "$V2_LEGACY/deployer-cert.pub"
ssh-keygen -Lf "$V1_LEGACY/deployer-cert.pub"
```

Retain directory **paths**, not key/cert contents, in the operator terminal. Only Legacy
updates `deploy-certs/current`; Daily updates `current-daily`, Admin `current-admin`.
Use explicit paths in transition checks. Refresh expired certificates when needed. The v2 Key ID must end `-ca2`; compare Signing CA.
The default CA path remains the required `~/.ssh/deploy-ca.pub`; the explicit CLI flag wins
over CA_PUB. Future UI mints inherit CA_PUB from the deck process environment. Deploy this
repository UI only when the operator can configure that process for v2 in an independently
approved deployment; until then use the explicit CLI flag. This run does not restart the deck.

S1 rollback: no host trust has changed. Keep the previous approved route and stop to resolve
the 1Password/public-key mismatch. Never export a private CA as a workaround.

## S2 — append v2 trust, keep v1 everywhere

Execute locally on each host, one at a time:

| Host | Preview | Apply |
|---|---|---|
| german-box | `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\deploy-keys\setup-german-box-ca.ps1 -CaPub C:\ProgramData\ssh\deploy-ca-v2.pub -DryRun` | `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\deploy-keys\setup-german-box-ca.ps1 -CaPub C:\ProgramData\ssh\deploy-ca-v2.pub` |
| rog-strix | `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\deploy-keys\setup-rog-strix-ca.ps1 -CaPub C:\ProgramData\ssh\deploy-ca-v2.pub -WhatIf` | `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\deploy-keys\setup-rog-strix-ca.ps1 -CaPub C:\ProgramData\ssh\deploy-ca-v2.pub` |
| onboarding-app-box | `sudo sh ./deploy-keys/apply-trust-linux.sh /var/tmp/deploy-ca-v2.pub --service ssh --dry-run` | `sudo sh ./deploy-keys/apply-trust-linux.sh /var/tmp/deploy-ca-v2.pub --service ssh` |
| ivy-box | `sudo sh ./deploy-keys/apply-trust-linux.sh /var/tmp/deploy-ca-v2.pub --service ssh --dry-run` | `sudo sh ./deploy-keys/apply-trust-linux.sh /var/tmp/deploy-ca-v2.pub --service ssh` |
| think-box (collision hold) | `sudo sh ./deploy-keys/apply-trust-linux.sh /var/tmp/deploy-ca-v2.pub --service ssh --dry-run` | `sudo sh ./deploy-keys/apply-trust-linux.sh /var/tmp/deploy-ca-v2.pub --service ssh` |

Expected diff: preserve every existing CA, add the v2 public line once, and ensure the global
TrustedUserCAKeys directive. Public key identity is compared independent of comments. The
Windows directive is **above Match Group administrators**. Original rog-strix inputs are
archived in `inputs/`; the delivered bootstrap helper prints a local PowerShell command
and never performs SSH. It is not the archived password-SSH bootstrap.

The rog-strix bootstrap fingerprint `SHA256:JaxLCc5XTWKixVFdoHMCLQyzpsCTNTbMs6wO4hcvV/U`
identifies the operator's 1Password **wsl-machine** fallback, public comment
`misterislez-mac-to-wsl`; it is not CA v2. Rotation neither adds nor removes that fallback.

Windows, from an elevated PowerShell recovery/console session: substitute the exact printed path/task name:

```powershell
Get-Content -LiteralPath '<printed-backup-path>\result.txt'
Get-Service sshd
Get-ScheduledTaskInfo -TaskName '<printed-task-name>'
```

Require `restart-ok`, service Running, and task completion. After successful new login,
remove just that completed task with `Unregister-ScheduledTask -TaskName '<printed-task-name>' -Confirm:$false`.
If result.txt is absent or says restored/failed, stop; use the independent console. Retain
backups. Tasks are configured to start and continue on battery. A `ca-rotation.pending`
marker blocks concurrent/later applies until restart or successful automatic restoration.
If recovery itself failed and the marker persists: read its public backup-path value, inspect
the named task/result and sshd configuration, stop that exact task from the console, and
verify no apply/recovery process remains. Only then may the owner remove the stale marker
`C:\ProgramData\ssh\ca-rotation.pending` and preview/run the appropriate rollback below.
Never clear it simply to bypass a running task; retain the recorded backup path first.

Mac owner S2 check: existing `*-deploy` aliases keep their legacy users and `current`.
Add only the five **individual `Host *-admin` endpoint blocks** from
`ssh-config.roles.example` (HostName/User); defer both common identity/certificate groups
and any `*-deploy` changes until all S3 checks pass. This adds verification aliases without
changing existing collectors. The verifier takes only HostName/port from each alias and
forces its explicit user, identity, certificate and a fresh direct connection.
For both certificates, run all five individually from the Mac owner terminal:

```bash
for CERT_DIR in "$V1_LEGACY" "$V2_LEGACY"; do
  for TARGET in gb-admin rs-admin ob-admin ivybox-admin vps-admin; do
    ./deploy-keys/verify-cert.sh "$TARGET" --expect admin \
      --identity "$CERT_DIR/deployer" --certificate "$CERT_DIR/deployer-cert.pub"
  done
done
```

Require **10/10** successful fresh connections. No alias-configured extra cert, agent,
password, bare public key, or multiplexed session may satisfy this gate. Verify trust
fingerprints locally too; the script prints the resulting public set. The verifier requires
Mac Python 3, OpenSSH and direct reachability; configured proxies are deliberately excluded.
Use credential paths without whitespace, quotes, backslashes or percent expansion tokens.

S2 rollback per host (first preview the exact printed backup):

| Host | Rollback command (append dry-run flag for preview) |
|---|---|
| german-box | `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\deploy-keys\setup-german-box-ca.ps1 -Rollback "<S2-backup>"` |
| rog-strix | `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\deploy-keys\setup-rog-strix-ca.ps1 -Rollback "<S2-backup>"` |
| onboarding-app-box | `sudo sh ./deploy-keys/apply-trust-linux.sh --rollback '<S2-backup>' --service ssh` |
| ivy-box | `sudo sh ./deploy-keys/apply-trust-linux.sh --rollback '<S2-backup>' --service ssh` |
| think-box | `sudo sh ./deploy-keys/apply-trust-linux.sh --rollback '<S2-backup>' --service ssh` |

Re-run the v1 check on that host after rollback. Do not progress until both-CA checks pass
on every target. Rollback itself retains a new snapshot; do not confuse it with S2's snapshot.

## S3 — operator-approved deploy accounts and role principals

**Human gate:** approve creating a no-sudo Linux deploy user / standard non-admin Windows
deploy user on each host. Existing privileged deploy accounts cause the scripts to stop;
the owner must resolve membership/rights explicitly. Linux creation uses an unusable password
and a shell; Windows generates an unlogged in-memory random password and sets
PasswordNeverExpires/UserMayNotChangePassword. SSH password and
keyboard-interactive login are disabled for deploy. No secret is exported or reported.

| Host | Preview | Apply |
|---|---|---|
| german-box | `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\deploy-keys\apply-principals-windows.ps1 -Box german-box -DryRun` | `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\deploy-keys\apply-principals-windows.ps1 -Box german-box` |
| rog-strix | `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\deploy-keys\apply-principals-windows.ps1 -Box rog-strix -WhatIf` | `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\deploy-keys\apply-principals-windows.ps1 -Box rog-strix` |
| onboarding-app-box | `sudo sh ./deploy-keys/apply-principals-linux.sh --box onboarding-app-box --service ssh --dry-run` | `sudo sh ./deploy-keys/apply-principals-linux.sh --box onboarding-app-box --service ssh` |
| ivy-box | `sudo sh ./deploy-keys/apply-principals-linux.sh --box ivy-box --service ssh --dry-run` | `sudo sh ./deploy-keys/apply-principals-linux.sh --box ivy-box --service ssh` |
| think-box (collision hold) | `sudo sh ./deploy-keys/apply-principals-linux.sh --box think-box --service ssh --dry-run` | `sudo sh ./deploy-keys/apply-principals-linux.sh --box think-box --service ssh` |

Require the appropriate principals directory and per-user contents:

- Linux: `/etc/ssh/principals/%u`; root-owned directory 0755/files 0644, deploy cannot write them.
- Windows: `__PROGRAMDATA__/ssh/principals/%u`; SYSTEM/Administrators control writes,
  standard users can read principals but cannot modify them.
- `deploy`: only `deploy`.
- `root`, `vibe`, or `misterisley`: `admin`, the host's box-only tag, and its legacy login.
  Keep legacy principals until S5 to preserve the previous cert path.

After each host passes local validation and the Windows task result check above, verify
roles with the explicit credential paths below. Keep all five existing deploy aliases and
machines.json user metadata unchanged during partial rollout. The new admin endpoint
aliases from S2 suffice for checks; the verifier overrides the login and credentials.
No automatic collector, WSL distribution, or application ownership changes are made here.

Mac operator mints the role certs (real approval required):

```bash
DAILY_DIR=$(./deploy-keys/mint-deploy-cert.sh --daily --ca-pub "$HOME/.ssh/deploy-ca-v2.pub")
PROMPTLY_DIR=$(./deploy-keys/mint-deploy-cert.sh --admin -n promptly-only --ca-pub "$HOME/.ssh/deploy-ca-v2.pub")
ADMIN_DIR=$(./deploy-keys/mint-deploy-cert.sh --admin --ca-pub "$HOME/.ssh/deploy-ca-v2.pub")
```

**Principal matching is OR.** `admin,promptly-only` remains fleet-wide Admin. Admin box
chips were removed from the UI; the screen's Admin mode grants all five approved hosts.
To test single-host restriction, the CLI example omits `admin` and includes only promptly-only.
Both Admin variants update `current-admin`, so mint fleet-wide Admin **last**, as above.
This follows [OpenSSH AuthorizedPrincipalsFile](https://man.openbsd.org/sshd_config).
Daily uses `-O clear -O permit-pty`; Admin retains OpenSSH's default extensions.

From the Mac owner terminal, verify each host using the explicit paths (the verifier also
accepts `--dry-run`, which prints its preflight/alias-resolution plan and command with
endpoint placeholders without reading credentials/config):

| Host | Daily check | Admin check | Scope check |
|---|---|---|---|
| german-box | `./deploy-keys/verify-cert.sh gb-deploy --expect deploy --identity "$DAILY_DIR/deployer" --certificate "$DAILY_DIR/deployer-cert.pub"` | `./deploy-keys/verify-cert.sh gb-admin --expect admin --identity "$ADMIN_DIR/deployer" --certificate "$ADMIN_DIR/deployer-cert.pub"` | `./deploy-keys/verify-cert.sh gb-admin --expect refused --identity "$PROMPTLY_DIR/deployer" --certificate "$PROMPTLY_DIR/deployer-cert.pub"` |
| rog-strix | `./deploy-keys/verify-cert.sh rs-deploy --expect deploy --identity "$DAILY_DIR/deployer" --certificate "$DAILY_DIR/deployer-cert.pub"` | `./deploy-keys/verify-cert.sh rs-admin --expect admin --identity "$ADMIN_DIR/deployer" --certificate "$ADMIN_DIR/deployer-cert.pub"` | `./deploy-keys/verify-cert.sh rs-admin --expect refused --identity "$PROMPTLY_DIR/deployer" --certificate "$PROMPTLY_DIR/deployer-cert.pub"` |
| onboarding-app-box | `./deploy-keys/verify-cert.sh ob-deploy --expect deploy --identity "$DAILY_DIR/deployer" --certificate "$DAILY_DIR/deployer-cert.pub"` | `./deploy-keys/verify-cert.sh ob-admin --expect admin --identity "$ADMIN_DIR/deployer" --certificate "$ADMIN_DIR/deployer-cert.pub"` | `./deploy-keys/verify-cert.sh ob-admin --expect refused --identity "$PROMPTLY_DIR/deployer" --certificate "$PROMPTLY_DIR/deployer-cert.pub"` |
| ivy-box | `./deploy-keys/verify-cert.sh ivybox-deploy --expect deploy --identity "$DAILY_DIR/deployer" --certificate "$DAILY_DIR/deployer-cert.pub"` | `./deploy-keys/verify-cert.sh ivybox-admin --expect admin --identity "$ADMIN_DIR/deployer" --certificate "$ADMIN_DIR/deployer-cert.pub"` | `./deploy-keys/verify-cert.sh ivybox-admin --expect refused --identity "$PROMPTLY_DIR/deployer" --certificate "$PROMPTLY_DIR/deployer-cert.pub"` |
| think-box | `./deploy-keys/verify-cert.sh vps-deploy --expect deploy --identity "$DAILY_DIR/deployer" --certificate "$DAILY_DIR/deployer-cert.pub"` | `./deploy-keys/verify-cert.sh vps-admin --expect admin --identity "$ADMIN_DIR/deployer" --certificate "$ADMIN_DIR/deployer-cert.pub"` | `./deploy-keys/verify-cert.sh vps-admin --expect admin --identity "$PROMPTLY_DIR/deployer" --certificate "$PROMPTLY_DIR/deployer-cert.pub"` |

Daily checks require Linux username deploy/nonzero UID and failure of `sudo -n true`, or
Windows username deploy and a non-admin token. Admin checks require UID 0 or an admin token.
Refusal requires a completed SSH exchange with the resolved target and a rejected publickey
probe for the explicit certificate fingerprint. A generic auth error, absent credential,
local signing failure, wrong certificate, DNS failure, or host-key failure does not pass. Require **5 daily + 5 admin + 1 scoped success
+ 4 scoped refusals = 15 passing checks**. Also verify both v1/v2 legacy certs still log in
through the privileged `*-admin` aliases (repeat the S2 verifier loop: 10 fresh logins).

**All-host activation gate:** after every S3 role/scope and legacy check passes, prove all
required collectors and Windows/WSL operations as deploy using explicit Daily credentials.
Then replace conflicting alias definitions with the complete `ssh-config.roles.example`:
`*-deploy` uses User deploy/current-daily; `*-admin` uses its privileged user/current-admin.
OpenSSH uses first obtained values, so remove/replace earlier conflicting alias settings.
Update each SSH machine's `user` in machines.json to deploy at the same activation gate.
Only then set `deploy-keys/ROTATION-STATE` to `s3-applied`, or configure the exact override
`SSH_ROTATION_STATE=s3-applied` in a separately approved deployment. Before this gate the
file remains `legacy`; the screen defaults to Legacy/8h and keeps 1h/4h/8h TTL chips active.
The state file is read per request; changing it needs no Mac deck restart. If any host or
collector is not ready, keep the legacy default, metadata and existing deploy aliases.
The Legacy coverage guard then refuses future Legacy mints once machines.json names deploy.

Owner application permissions are separate, explicit decisions. Do not chown an existing
production tree wholesale. For a new approved deployment directory only, an owner can use
`sudo install -d -o deploy -g deploy -m 0750 /srv/deploy/<approved-app>` after checking the
exact path. No broad sudo belongs to deploy. If a restart permission is required, render
one exact unit, review, then validate and install it:

```bash
./deploy-keys/render-sudoers.sh --app APPROVED_UNIT > /var/tmp/deploy-app.sudoers
sudo visudo -cf /var/tmp/deploy-app.sudoers
# Review the exact proposed file; compare against any existing one before installing.
sudo diff -u /etc/sudoers.d/deploy-app /var/tmp/deploy-app.sudoers
# After owner approval, retain a copy of the old public sudoers file if one exists.
sudo install -o root -g root -m 0440 /var/tmp/deploy-app.sudoers /etc/sudoers.d/deploy-app
sudo visudo -c
```

APPROVED_UNIT is a required owner-supplied unit name; an optional trailing `.service` is
normalized to exactly one suffix. Verify the
`/usr/bin/systemctl` path. No wildcard. The service and any code it executes as root must
not be deploy-writable. Skip this entirely unless needed. Rollback: restore the saved
sudoers file, or remove this newly added file if none existed, then `sudo visudo -c`.

S3 rollback uses the **S3** backup on the same host:

- german-box / rog-strix: `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\deploy-keys\apply-principals-windows.ps1 -Rollback "<S3-backup>"`
- onboarding-app-box / ivy-box / think-box: `sudo sh ./deploy-keys/apply-principals-linux.sh --rollback '<S3-backup>' --service ssh`

Preview first. If activation already occurred, restore the previous aliases and matching
machines.json users, reset the rollout file to legacy and remove any s3-applied environment
override under the deployment owner. Verify v1 legacy login. New deploy accounts are disabled, not deleted. Existing accounts are retained.
Keep S2's dual trust while resolving S3; do not roll back another owner's concurrent edits.

## S4 — remove the on-disk v1 CA private file (operator only)

**Human gate:** only after S2/S3 pass everywhere and Mac-side reference discovery is complete.
The repository worker does not inspect the Mac or any worker `~/.ssh`.

Mac owner discovery, filenames/line numbers only; avoid logging unrelated file contents:

```bash
rg -n -o 'id_ed25519' "$HOME/.ssh/config" "$HOME/.gitconfig" "$HOME/Library/LaunchAgents"
rg -n -o 'id_ed25519' server.js machines.json
rg -n -o 'id_ed25519' /PATH/TO/lowcap-connector/scripts/deploy-vps.sh
```

The owner must replace every discovered consumer with the approved certificate alias or
explicit certificate/identity pair and test that consumer. `rg` exit 1 means no matches;
missing paths/errors do not count as proof. Research named SSH config lines 3/22/83; treat
those as historical leads, not current facts. Include cron/LaunchAgents and relevant Git
configuration consumers. No static-key fallback should mask a failed cert check.

After explicit approval the **operator** removes just `$HOME/.ssh/id_ed25519` on the Mac;
the public half may remain. Do not put a backup private copy on disk. Owner verifies:

```bash
test ! -e "$HOME/.ssh/id_ed25519"
ssh-keygen -y -f "$HOME/.ssh/id_ed25519" >/dev/null 2>&1
# Required result of the second command: failure because the file is absent.
```

Then operator mints a fresh v2 Daily and Admin through 1Password and repeats all five daily
and admin checks from S3. An already issued cert alone does not prove future minting works.
S4 recovery: use verified v2/1Password and the retained owner console. Do not recreate the
private CA file. Halt the operation if the new path cannot provide recovery.

## S5 — chain or retire static keys, then remove v1 and legacy principals

**Human gate:** approve each deletion separately. All consumer identity, destination,
source address, and exact forced command must be discovered on the Mac by its owner.

| Static key name | Consumer | Research lead / decision required | Final authorized_keys state |
|---|---|---|---|
| ivy-deploy | TO-DISCOVER (Mac-side) | ivy-box consumer; keep only if unattended automation requires it | forced command + exact source, or retired |
| lowcap_backup_pull | TO-DISCOVER (Mac-side) | “Fix dead lowcap VPS backup-pull launchd job”; coordinate with its owner | forced read/backup command + exact source, or retired |
| onboarding-box | TO-DISCOVER (Mac-side) | onboarding-app-box access consumer | forced command + exact source, or retired |
| vps-onboarding-app-sync | TO-DISCOVER (Mac-side) | onboarding sync consumer; identify direction and destination | forced sync command + exact source, or retired |

Do not fill unknowns with guessed commands/IPs. Capture only the key's `.pub` fingerprint,
consumer identifier, and chosen restriction in the owner receipt. For every retained robot
key, prepare this **single public authorized_keys line** on its destination:

```text
command="<one exact approved command>",from="<one exact approved source address>",no-pty,no-port-forwarding,no-agent-forwarding,no-X11-forwarding ssh-ed25519 <PUBLIC_BASE64> <public-comment>
```

The command must safely handle/reject SSH_ORIGINAL_COMMAND and caller input. An unrestricted
shell wrapper or broad rsync/scp command is not a restriction. A passphrase-less robot key
is acceptable only after that constrained command and source restriction have been proven.
Owner stages a candidate public authorized_keys file in a temporary path, compares the
**complete diff** against the current file, saves its current bytes and ACL/mode, and applies
only the approved line, preserving all other entries. Use an owner-controlled file/editor;
never paste private material. Preview is `diff -u <current-authorized_keys> <candidate>`;
rollback is restoration of the saved file and ACL/mode from the retained recovery session.
On Windows use the correct per-user file, or administrators_authorized_keys for admin logins,
and preserve its protected Administrators/SYSTEM ACL. Do not edit the unrelated bootstrap
fallback as part of this four-key cleanup.

For a retained key, the Mac owner must test with agent/cert fallback and multiplexing disabled:
`ssh -o BatchMode=yes -o IdentityAgent=none -o IdentitiesOnly=yes -o CertificateFile=none -o PubkeyAcceptedAlgorithms=ssh-ed25519 -o ControlPath=none -i <key-path> <user@host> <command>`.
Prove: approved operation succeeds; arbitrary shell/command does not execute; PTY and
forwarding requests fail; a disallowed source fails. Check resulting artifacts, not just
exit status (a forced command can return success while ignoring the requested command).
For retirement, migrate and test the consumer with Daily certs first, remove its public
line, prove bare-key refusal, and only then let the operator delete its pair. Recovery uses
the proven cert/console path; do not assume a deleted private key can be restored.

**Only after all five hosts and four consumers are proven**, remove v1 trust and legacy
principal names, one host at a time. After S5, always use the retirement flag on
principals reruns; the transition default intentionally includes legacy names:

| Host | Trust retirement (preview then apply) | Principal retirement (preview then apply) |
|---|---|---|
| german-box | `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\deploy-keys\setup-german-box-ca.ps1 -RetireV1 -DryRun` then repeat without `-DryRun` | `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\deploy-keys\apply-principals-windows.ps1 -Box german-box -RetireLegacy -DryRun` then repeat without `-DryRun` |
| rog-strix | `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\deploy-keys\setup-rog-strix-ca.ps1 -RetireV1 -WhatIf` then repeat without `-WhatIf` | `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\deploy-keys\apply-principals-windows.ps1 -Box rog-strix -RetireLegacy -WhatIf` then repeat without `-WhatIf` |
| onboarding-app-box | `sudo sh ./deploy-keys/apply-trust-linux.sh --retire-v1 --service ssh --dry-run` then repeat without `--dry-run` | `sudo sh ./deploy-keys/apply-principals-linux.sh --box onboarding-app-box --retire-legacy --service ssh --dry-run` then repeat without `--dry-run` |
| ivy-box | `sudo sh ./deploy-keys/apply-trust-linux.sh --retire-v1 --service ssh --dry-run` then repeat without `--dry-run` | `sudo sh ./deploy-keys/apply-principals-linux.sh --box ivy-box --retire-legacy --service ssh --dry-run` then repeat without `--dry-run` |
| think-box (collision hold) | `sudo sh ./deploy-keys/apply-trust-linux.sh --retire-v1 --service ssh --dry-run` then repeat without `--dry-run` | `sudo sh ./deploy-keys/apply-principals-linux.sh --box think-box --retire-legacy --service ssh --dry-run` then repeat without `--dry-run` |

Trust removal matches the full v1 fingerprint and refuses to remove the last CA. Expect
only v2 in the trust file; any unexpected third CA is an owner decision, not silently removed.
Check Windows task results after **each** invocation before running the next. Retain the
separate S5 trust/principals backup paths. Remove any independently trusted v1 cert-authority
line only through its approved owner transaction; otherwise v1 might still authenticate.

Required final proof: v2 Daily/Admin checks green on all five; the scope matrix remains
1 success / 4 refusals; fresh, unexpired v1-signed certs are refused on every host **before
and independently of legacy-name removal**. Use the verifier with each privileged
alias, that explicit v1 credential pair, and `--expect refused`; a generic denial alone
does not establish this gate.
An expired v1 certificate proves nothing about removal of trust. Obtain the unexpired v1
proof cert through its retained 1Password entry before retirement; never recover it from disk.

Only after these proofs may the operator delete the obsolete Mac v1 **public** file
`~/.ssh/deploy-ca.pub` and retire the old 1Password CA entry by separate approval. Keep
`~/.ssh/deploy-ca-v2.pub`; all future CLI/UI mints must use explicit --ca-pub or CA_PUB=v2.
Do not delete a same-named file if its fingerprint has already been changed to v2.

S5 rollback: on the affected host, restore the corresponding S5 principals snapshot with
its S3 rollback command, then its S5 trust snapshot with the S2 rollback command; preview
both first. Recheck a v2 Admin login from a new connection. Restore a chained public line's
previous file/ACL only under the owner's approval. Do not undo other sessions' edits or
recreate deleted private keys. Retain v2 and the console as the recovery route throughout.

## Owner receipt and repository validation

For each host and slice, record: owner and approval, reviewed repository SHA, public CA
fingerprints, preview outcome, apply exit/task result, backup path, fresh-login check counts,
and rollback result if used. **No private key, certificate blob, token, or passphrase.**
The live S1–S5 receipt is separate from Ivo's repository-only REPORT.md.

Repository checks (offline, no host access):

```bash
node --test test/deploy-cert-mint.test.js test/deploy-trust.test.js test/deploy-principals.test.js test/deploy-mint-route.test.js test/v2-keys.test.js
node test/deploy-keys-browser.cjs
shellcheck deploy-keys/mint-deploy-cert.sh deploy-keys/apply-trust-linux.sh deploy-keys/apply-principals-linux.sh deploy-keys/bootstrap-rog-strix.sh deploy-keys/verify-cert.sh deploy-keys/render-sudoers.sh
```

Set PWSH_BIN to a local PowerShell runtime to exercise Windows fixture previews on Linux.
The signing integration test is deliberately opt-in (`SSH_CA_ALLOW_TEST_MINT=1`) and creates
throwaway credentials. **Do not enable it during this no-minting goal without an explicit
operator exception.** It never uses an agent or a real CA. See REPORT.md for what was actually
executed, all pushed milestone SHAs, known baseline failures, and acceptance gaps.

Signed: **Ivo**
