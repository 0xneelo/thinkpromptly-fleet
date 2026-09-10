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
It has no principal template, mint tag, or apply command here. Its UI chip is disabled.
Owner decision: inspect first, then authorize a separately scoped onboarding; recommendation
is to keep it outside this rotation until verified. GitHub App PEM/OAuth rotation and
rog-strix Tailscale expiry (2026-12-01) are outside this runbook.

Before touching one host:

1. Obtain that owner's approval and a maintenance window. Preserve an existing privileged
   session and a working console/recovery route. Do not close either until a new login passes.
2. Stage the reviewed `deploy-keys/` directory **with its lib/ and principals/ subdirectories**
   from branch `agent-ssh-ca-rotation` at a pushed SHA listed in REPORT.md. Work locally on the
   target, from the staged repository root. Windows: elevated PowerShell 5.1+ with LocalAccounts
   and ScheduledTasks modules. Linux: root via sudo, Python 3.8+, OpenSSH, systemd, useradd/usermod.
3. Stage only the operator-exported v2 **public** key: Linux `/var/tmp/deploy-ca-v2.pub`;
   Windows `C:\ProgramData\ssh\deploy-ca-v2.pub`. Compare its SHA256 fingerprint to the operator's
   separately supplied public fingerprint. Never place private CA material on any host.
4. Linux examples use service `ssh` and `/usr/sbin/sshd`. Verify locally that this is the
   installed service/binary; if the unit is `sshd`, consistently use `--service sshd` in apply
   **and rollback**. Windows examples use the inbox OpenSSH sshd path; if the service uses a
   different executable, pass that verified full path through `-Sshd` for apply and rollback.
5. Review `sshd_config` plus its Includes/Match rules and public authorized_keys entries.
   A `cert-authority` authorized_keys entry can trust a CA independently of TrustedUserCAKeys;
   v1 retirement must cover that path too, under its owning lane. Do not guess or remove it here.
6. Run the relevant dry-run **on the target** to get the actual file diff. Offline `--root`
   fixtures demonstrate the planner but are not a substitute for reviewing that host.

All apply entry points accept a dry-run (`--dry-run`, `-DryRun`, or `-WhatIf`). Dry-runs
write no files, users, ACLs, services, tasks, or backups. They show the full file changes,
account actions, and planned validation/reload. Linux `--root` is allowed only for offline
previews. Ordinary reruns are idempotent. Existing symlink/reparse targets are refused.

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
V2_LEGACY=$(./deploy-keys/mint-deploy-cert.sh -n root,vibe,misterisley -t 1h --ca-pub "$HOME/.ssh/deploy-ca-v2.pub")
V1_LEGACY=$(./deploy-keys/mint-deploy-cert.sh -n root,vibe,misterisley -t 1h --ca-pub "$HOME/.ssh/deploy-ca.pub")
ssh-keygen -Lf "$V2_LEGACY/deployer-cert.pub"
ssh-keygen -Lf "$V1_LEGACY/deployer-cert.pub"
```

Retain directory **paths**, not key/cert contents, in the operator terminal. Each mint
updates `deploy-certs/current`, so use the explicit paths in all transition checks below.
Refresh expired 1h certs when needed. The v2 Key ID must end `-ca2`; compare Signing CA.
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
| german-box | `.\deploy-keys\setup-german-box-ca.ps1 -CaPub C:\ProgramData\ssh\deploy-ca-v2.pub -DryRun` | `.\deploy-keys\setup-german-box-ca.ps1 -CaPub C:\ProgramData\ssh\deploy-ca-v2.pub` |
| rog-strix | `.\deploy-keys\setup-rog-strix-ca.ps1 -CaPub C:\ProgramData\ssh\deploy-ca-v2.pub -WhatIf` | `.\deploy-keys\setup-rog-strix-ca.ps1 -CaPub C:\ProgramData\ssh\deploy-ca-v2.pub` |
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

Windows, from the recovery/console session: substitute the exact printed path/task name:

```powershell
Get-Content -LiteralPath '<printed-backup-path>\result.txt'
Get-Service sshd
Get-ScheduledTaskInfo -TaskName '<printed-task-name>'
```

Require `restart-ok`, service Running, and task completion. After successful new login,
remove just that completed task with `Unregister-ScheduledTask -TaskName '<printed-task-name>' -Confirm:$false`.
If result.txt is absent or says restored/failed, stop; use the recovery session. Retain backups.

Mac owner S2 check: aliases still use their legacy users. Do not install S3's deploy-user
alias definitions yet. For **both** V1_LEGACY and V2_LEGACY, run all five individually:

```bash
for CERT_DIR in "$V1_LEGACY" "$V2_LEGACY"; do
  for TARGET in gb-deploy rs-deploy ob-deploy ivybox-deploy vps-deploy; do
    ssh -o BatchMode=yes -o IdentityAgent=none -o IdentitiesOnly=yes \
      -o PreferredAuthentications=publickey -o PasswordAuthentication=no \
      -o KbdInteractiveAuthentication=no -o PubkeyAcceptedAlgorithms=ssh-ed25519-cert-v01@openssh.com \
      -o StrictHostKeyChecking=yes -o ControlMaster=no -o ControlPath=none \
      -i "$CERT_DIR/deployer" -o CertificateFile="$CERT_DIR/deployer-cert.pub" "$TARGET" 'echo ok'
  done
 done
```

Require **10/10** successful fresh connections. No agent, password, bare public key, or
existing multiplexed session may satisfy this gate. Host-key errors are not authentication
refusals. Check trust fingerprints locally too; the script prints the resulting public set.

S2 rollback per host (first preview the exact printed backup):

| Host | Rollback command (append dry-run flag for preview) |
|---|---|
| german-box | `.\deploy-keys\setup-german-box-ca.ps1 -Rollback '<S2-backup>'` |
| rog-strix | `.\deploy-keys\setup-rog-strix-ca.ps1 -Rollback '<S2-backup>'` |
| onboarding-app-box | `sudo sh ./deploy-keys/apply-trust-linux.sh --rollback '<S2-backup>' --service ssh` |
| ivy-box | `sudo sh ./deploy-keys/apply-trust-linux.sh --rollback '<S2-backup>' --service ssh` |
| think-box | `sudo sh ./deploy-keys/apply-trust-linux.sh --rollback '<S2-backup>' --service ssh` |

Re-run the v1 check on that host after rollback. Do not progress until both-CA checks pass
on every target. Rollback itself retains a new snapshot; do not confuse it with S2's snapshot.

## S3 — operator-approved deploy accounts and role principals

**Human gate:** approve creating a no-sudo Linux deploy user / standard non-admin Windows
deploy user on each host. Existing privileged deploy accounts cause the scripts to stop;
the owner must resolve membership/rights explicitly. Linux creation uses an unusable password
and a shell; Windows generates an unlogged in-memory random password. SSH password and
keyboard-interactive login are disabled for deploy. No secret is exported or reported.

| Host | Preview | Apply |
|---|---|---|
| german-box | `.\deploy-keys\apply-principals-windows.ps1 -Box german-box -DryRun` | `.\deploy-keys\apply-principals-windows.ps1 -Box german-box` |
| rog-strix | `.\deploy-keys\apply-principals-windows.ps1 -Box rog-strix -WhatIf` | `.\deploy-keys\apply-principals-windows.ps1 -Box rog-strix` |
| onboarding-app-box | `sudo sh ./deploy-keys/apply-principals-linux.sh --box onboarding-app-box --service ssh --dry-run` | `sudo sh ./deploy-keys/apply-principals-linux.sh --box onboarding-app-box --service ssh` |
| ivy-box | `sudo sh ./deploy-keys/apply-principals-linux.sh --box ivy-box --service ssh --dry-run` | `sudo sh ./deploy-keys/apply-principals-linux.sh --box ivy-box --service ssh` |
| think-box (collision hold) | `sudo sh ./deploy-keys/apply-principals-linux.sh --box think-box --service ssh --dry-run` | `sudo sh ./deploy-keys/apply-principals-linux.sh --box think-box --service ssh` |

Require the appropriate principals directory and per-user contents:

- Linux: `/etc/ssh/principals/%u`; root-owned files, deploy cannot write them.
- Windows: `__PROGRAMDATA__/ssh/principals/%u`; SYSTEM/Administrators control writes,
  standard users can read principals but cannot modify them.
- `deploy`: only `deploy`.
- `root`, `vibe`, or `misterisley`: `admin`, the host's box-only tag, and its legacy login.
  Keep legacy principals until S5 to preserve the previous cert path.

After each host passes local validation and the Windows task result check above, the Mac
operator merges **only that host's two blocks** from `deploy-keys/ssh-config.roles.example`
into their SSH config. Replace conflicting earlier alias blocks; OpenSSH uses first obtained
values. The `*-deploy` alias now logs in as deploy, and `*-admin` as root/vibe/misterisley.
Existing machines.json already selects the five deploy aliases. Validate existing collectors
and required Windows/WSL access as the new user before moving on. No automatic collector or
application ownership changes are made by this rotation.

Mac operator mints the role certs (real approval required):

```bash
DAILY_DIR=$(./deploy-keys/mint-deploy-cert.sh --daily --ca-pub "$HOME/.ssh/deploy-ca-v2.pub")
ADMIN_DIR=$(./deploy-keys/mint-deploy-cert.sh --admin --ca-pub "$HOME/.ssh/deploy-ca-v2.pub")
PROMPTLY_DIR=$(./deploy-keys/mint-deploy-cert.sh --admin -n promptly-only --ca-pub "$HOME/.ssh/deploy-ca-v2.pub")
```

**Principal matching is OR.** `admin,promptly-only` remains fleet-wide Admin. The UI's
optional Admin chips deliberately add tags and say they do not restrict access. To test
single-host restriction, the CLI example above omits `admin` and includes only promptly-only.
This follows [OpenSSH AuthorizedPrincipalsFile](https://man.openbsd.org/sshd_config).
Daily uses `-O clear -O permit-pty`; Admin retains OpenSSH's default extensions.

From the Mac owner terminal, verify each host using the explicit paths (the verifier also
accepts `--dry-run`, which prints its exact invocation without reading credentials/config):

| Host | Daily check | Admin check | Scope check |
|---|---|---|---|
| german-box | `./deploy-keys/verify-cert.sh gb-deploy --expect deploy --identity "$DAILY_DIR/deployer" --certificate "$DAILY_DIR/deployer-cert.pub"` | `./deploy-keys/verify-cert.sh gb-admin --expect admin --identity "$ADMIN_DIR/deployer" --certificate "$ADMIN_DIR/deployer-cert.pub"` | `./deploy-keys/verify-cert.sh gb-admin --expect refused --identity "$PROMPTLY_DIR/deployer" --certificate "$PROMPTLY_DIR/deployer-cert.pub"` |
| rog-strix | `./deploy-keys/verify-cert.sh rs-deploy --expect deploy --identity "$DAILY_DIR/deployer" --certificate "$DAILY_DIR/deployer-cert.pub"` | `./deploy-keys/verify-cert.sh rs-admin --expect admin --identity "$ADMIN_DIR/deployer" --certificate "$ADMIN_DIR/deployer-cert.pub"` | `./deploy-keys/verify-cert.sh rs-admin --expect refused --identity "$PROMPTLY_DIR/deployer" --certificate "$PROMPTLY_DIR/deployer-cert.pub"` |
| onboarding-app-box | `./deploy-keys/verify-cert.sh ob-deploy --expect deploy --identity "$DAILY_DIR/deployer" --certificate "$DAILY_DIR/deployer-cert.pub"` | `./deploy-keys/verify-cert.sh ob-admin --expect admin --identity "$ADMIN_DIR/deployer" --certificate "$ADMIN_DIR/deployer-cert.pub"` | `./deploy-keys/verify-cert.sh ob-admin --expect refused --identity "$PROMPTLY_DIR/deployer" --certificate "$PROMPTLY_DIR/deployer-cert.pub"` |
| ivy-box | `./deploy-keys/verify-cert.sh ivybox-deploy --expect deploy --identity "$DAILY_DIR/deployer" --certificate "$DAILY_DIR/deployer-cert.pub"` | `./deploy-keys/verify-cert.sh ivybox-admin --expect admin --identity "$ADMIN_DIR/deployer" --certificate "$ADMIN_DIR/deployer-cert.pub"` | `./deploy-keys/verify-cert.sh ivybox-admin --expect refused --identity "$PROMPTLY_DIR/deployer" --certificate "$PROMPTLY_DIR/deployer-cert.pub"` |
| think-box | `./deploy-keys/verify-cert.sh vps-deploy --expect deploy --identity "$DAILY_DIR/deployer" --certificate "$DAILY_DIR/deployer-cert.pub"` | `./deploy-keys/verify-cert.sh vps-admin --expect admin --identity "$ADMIN_DIR/deployer" --certificate "$ADMIN_DIR/deployer-cert.pub"` | `./deploy-keys/verify-cert.sh vps-admin --expect admin --identity "$PROMPTLY_DIR/deployer" --certificate "$PROMPTLY_DIR/deployer-cert.pub"` |

Daily checks require Linux username deploy/nonzero UID and failure of `sudo -n true`, or
Windows username deploy and a non-admin token. Admin checks require UID 0 or an admin token.
Refusal requires OpenSSH's public-key authentication denial; a timeout, absent credential,
DNS failure, or host-key failure does not pass. Require **5 daily + 5 admin + 1 scoped success
+ 4 scoped refusals = 15 passing checks**. Also verify both v1/v2 legacy certs still log in
through the privileged `*-admin` aliases (10 more fresh logins using the S2 flags).

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

APPROVED_UNIT is a required owner-supplied unit name without `.service`; verify the
`/usr/bin/systemctl` path. No wildcard. The service and any code it executes as root must
not be deploy-writable. Skip this entirely unless needed. Rollback: restore the saved
sudoers file, or remove this newly added file if none existed, then `sudo visudo -c`.

S3 rollback uses the **S3** backup on the same host:

- german-box / rog-strix: `.\deploy-keys\apply-principals-windows.ps1 -Rollback '<S3-backup>'`
- onboarding-app-box / ivy-box / think-box: `sudo sh ./deploy-keys/apply-principals-linux.sh --rollback '<S3-backup>' --service ssh`

Preview first. Restore that host's previous Mac alias User setting and verify its v1
legacy login. New deploy accounts are disabled, not deleted. Existing accounts are retained.
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
| german-box | `.\deploy-keys\setup-german-box-ca.ps1 -RetireV1 -DryRun` then repeat without `-DryRun` | `.\deploy-keys\apply-principals-windows.ps1 -Box german-box -RetireLegacy -DryRun` then repeat without `-DryRun` |
| rog-strix | `.\deploy-keys\setup-rog-strix-ca.ps1 -RetireV1 -WhatIf` then repeat without `-WhatIf` | `.\deploy-keys\apply-principals-windows.ps1 -Box rog-strix -RetireLegacy -WhatIf` then repeat without `-WhatIf` |
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
and independently of legacy-name removal**. Use the S2 cert-only flags and each privileged
alias, expecting Permission denied (publickey), or the verifier's `--expect refused`.
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
