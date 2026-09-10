# SSH access for agents

Target state after the owner applies [RUNBOOK.md](../docs/goals/ssh-ca-rotation/RUNBOOK.md).
These repository artifacts do not mean any host was changed. Check the owner's receipt.
Project remote-system / deploy-keys. Rotation worker Ivo, tag agent-ivo.

## Today (until S3)

The existing aliases use `deploy-certs/current` and privileged login-name principals:
`vps-deploy`, `ob-deploy`, `ivybox-deploy` log in as root; `gb-deploy` as vibe;
`rs-deploy` as misterisley. These are the recorded pre-rotation settings, not live probes.
The keys screen defaults to **Legacy**, with root,vibe,misterisley,tabor and 8h selected;
its TTL chips allow 1h, 4h, or 8h. Only Legacy mints update `current`.
Daily and Admin are additional modes for the owner to stage and verify during S3.

Connect using the existing alias, or use the explicit certificate directory supplied by
the operator in the Connect form/manual command:

```text
ssh -o IdentitiesOnly=yes -o IdentityAgent=none -i <dir>/deployer -o CertificateFile=<dir>/deployer-cert.pub <login>@<host>
```

The german-box SSH shell is Windows **cmd**; invoke `wsl` for Unix commands and tmux.
Creating a Windows deploy account does not provision that user's WSL distribution.
Owners must prove required collector/WSL access before switching aliases.
These connection instructions apply only to separately authorized operators/agents;
Ivo's repository lane never connects, mints, or reads its own SSH directory.

Do not switch the five existing aliases during a partial rollout. After every host passes
S3 and collector checks, the owner activates the role aliases below, updates each SSH row's
`user` in machines.json to match, and sets `deploy-keys/ROTATION-STATE` to `s3-applied`.
The exact environment override is `SSH_ROTATION_STATE=s3-applied`; without it the file
controls the default. The file is read per request. Before this gate it remains `legacy`.
The UI and route refuse a Legacy mint that omits a configured machine login.

## Role profiles after S3

- **Daily**: `deploy`, 8h, PTY only (forwarding and user-rc extensions cleared).
  Login as the standard/no-sudo deploy user using the five `*-deploy` aliases.
- **Admin**: `admin`, 1h, default OpenSSH extensions. Privileged logins use `*-admin`.
  Admin box chips were removed from the screen. CLI tags are additive:
  `admin,promptly-only` still grants fleet-wide Admin. A box-restricted CLI cert carries
  only the chosen tag, with no admin principal.

The CA private key must exist only inside 1Password. The operator mints through its agent
and approves in 1Password. An agent worker never mints, uses ssh-add, connects an agent socket,
or generates/uploads its own keys. The short-lived leaf private key is a separate credential
on the operator's disk; never paste/copy its contents or a certificate blob into reports.
Ask the operator for the least privilege and duration required. Check metadata locally with
`ssh-keygen -Lf <dir>/deployer-cert.pub`; record only public fingerprints and status.
Use `--ca-pub <v2-public-file>` or CA_PUB after v1 retirement: the historical default path
`~/.ssh/deploy-ca.pub` is intentionally not silently changed by the script.

## Five approved hosts

| Host | Address | Daily alias / login | Admin alias / login | Host tag |
|---|---|---|---|---|
| think-box (promptly) | 138.199.198.246 | vps-deploy / deploy | vps-admin / root | promptly-only |
| onboarding-app-box | 178.104.80.26 | ob-deploy / deploy | ob-admin / root | onboarding-only |
| ivy-box | 168.119.52.183 | ivybox-deploy / deploy | ivybox-admin / root | ivy-only |
| german-box | 100.80.44.86 | gb-deploy / deploy | gb-admin / vibe | german-only |
| rog-strix | 100.124.95.60 | rs-deploy / deploy | rs-admin / misterisley | rog-only |

**vibes-asus: sixth machine, trust UNKNOWN, outside this rotation.** No guessed template/tag.
Mac is the operator/1Password/deck machine, not an SSH target for this lane.
Before S3, existing deploy aliases still use root/vibe/misterisley; the owner stages the
User changes from `ssh-config.roles.example` only after all five hosts pass S3.
Daily mints update `current-daily`; Admin mints update `current-admin`. The role alias
groups use their matching pointer. Neither profile changes the legacy `current` link.

AuthorizedPrincipalsFile: `/etc/ssh/principals/%u` on Linux,
`__PROGRAMDATA__/ssh/principals/%u` on Windows. Deploy accepts only deploy. Privileged files
accept admin and the corresponding host tag. Legacy login-name principals stay during S3,
then are removed explicitly in S5. Both CAs stay trusted until the final retirement gate.
Windows trust must be global, above Match Group administrators. Validate sshd, then use a
SYSTEM task for detached restart and check its result; never restart the Mac deck.

The archived rog-strix bootstrap public fingerprint
`SHA256:JaxLCc5XTWKixVFdoHMCLQyzpsCTNTbMs6wO4hcvV/U` is the operator's 1Password
wsl-machine fallback (misterislez-mac-to-wsl), not a CA. Rotation leaves it unchanged.

## Chained or retired static keys (owner must fill actual state)

| Key | Consumer | Required final state |
|---|---|---|
| ivy-deploy | TO-DISCOVER (Mac-side) | exact forced command + source restriction, or retired |
| lowcap_backup_pull | TO-DISCOVER (Mac-side); backup-pull launchd job lead | exact backup command + source restriction, or retired |
| onboarding-box | TO-DISCOVER (Mac-side) | exact forced command + source restriction, or retired |
| vps-onboarding-app-sync | TO-DISCOVER (Mac-side) | exact sync command + source restriction, or retired |

Retained robot keys additionally prohibit PTY, port/agent/X11 forwarding. A passphrase-less
key is acceptable only after its command/source restrictions pass live negative tests.
Never delete or constrain a key before the owner discovers and approves its consumer.

## GitHub push (1-hour App tokens — self-serve while a train runs)

The App's PEM lives only in 1Password. The operator starts a **GitHub train** on the fleetdeck keys page (`localhost:3131/app#keys`) — one Touch ID — and for the train's window (1h/4h/8h) the deck brokers fresh 1-hour tokens to any local process. Get one yourself:

```bash
eval "$(/Users/misterislez/remote-system/deploy-keys/mint-github-token.sh --broker --askpass)"
```

No train active → the command fails with the broker's message (`no active GitHub train — ask the operator to start one on the keys page`). Then stop and ask the operator to start a train; you cannot start one and you cannot mint.

With the exports set, push over HTTPS for up to 1 hour:

```bash
git -C <repo> push https://x-access-token@github.com/0xneelo/<repo>.git <branch>
```

On the german-box — or any machine on the tailnet — the deck brokers the same tokens over tailscale, read-only. During a train, `curl -sf http://100.125.231.25:3131/api/ghtoken` returns `{token, expires_at}`; parse out the token and use it as the **password** with username `x-access-token` over HTTPS. The same rules apply: never in argv, never in a URL, never in a file. No train → HTTP 503 with the same message (`no active GitHub train — ask the operator to start one on the keys page`); stop and ask the operator.

Never put the token itself in a URL, argv, or any file; the askpass helper handles it. Delete the helper dir (printed to stderr) when done. The operator's 1Password git-push route is unaffected.


Signed rotation documentation: Ivo
