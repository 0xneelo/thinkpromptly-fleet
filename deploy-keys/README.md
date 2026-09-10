# deploy-keys

Repository tools for operator-approved, short-lived deploy credentials. SSH rotation is
prepared here; host application is gated in [RUNBOOK.md](../docs/goals/ssh-ca-rotation/RUNBOOK.md).
See [AGENT.md](AGENT.md) for roles, the five-host map, unknown sixth host, and chained-key policy.
Nothing in these files establishes a live host trust state.

## SSH CA rotation

The intended CA is born inside 1Password and its private half never leaves it. Only the
public half is distributed to trust stores. During transition both v1 and v2 are trusted;
legacy login-name principals remain until the owner's final retirement proof.

| Tool | Purpose |
|---|---|
| mint-deploy-cert.sh | operator mint, --daily (deploy/8h/PTY only) or --admin (admin/1h/default extensions), CA_PUB / --ca-pub, non-minting --dry-run |
| apply-trust-linux.sh | local owner append/retire trust, --dry-run, --rollback, validation and reload |
| setup-german-box-ca.ps1 / setup-rog-strix-ca.ps1 | local Windows owner trust, -DryRun/-WhatIf, -Rollback, SYSTEM restart with recovery |
| bootstrap-rog-strix.sh | print local owner invocation only; original transport archived verbatim under goal inputs/ |
| apply-principals-linux.sh / apply-principals-windows.ps1 | deploy accounts and per-login role principals, previews and rollback |
| verify-cert.sh | owner-only fresh certificate-auth checks, role/scope refusal distinction, --dry-run |
| render-sudoers.sh --app UNIT | pure exact-unit sudoers template renderer; no installation |
| ssh-config.roles.example | staged Daily/Admin aliases; owner activates per host after S3 |

Five scoped hosts: think-box, onboarding-app-box, ivy-box, german-box, rog-strix.
**vibes-asus is a sixth box with UNKNOWN trust**, excluded pending owner decision. The
rog-strix bootstrap fingerprint `SHA256:JaxLCc5XTWKixVFdoHMCLQyzpsCTNTbMs6wO4hcvV/U`
identifies the operator 1Password wsl-machine fallback, not CA v2. Both original rog-strix
inputs remain verbatim in `docs/goals/ssh-ca-rotation/inputs/` as provenance; use the guarded
entry scripts under deploy-keys. Windows trust goes above Match Group administrators;
restart sshd via the generated SYSTEM task and inspect its result before proceeding.

Operator examples (not executed by repository workers):

```bash
./deploy-keys/mint-deploy-cert.sh --daily --ca-pub /path/to/deploy-ca-v2.pub --dry-run
./deploy-keys/mint-deploy-cert.sh --daily --ca-pub /path/to/deploy-ca-v2.pub
./deploy-keys/mint-deploy-cert.sh --admin --ca-pub /path/to/deploy-ca-v2.pub
./deploy-keys/mint-deploy-cert.sh --admin -n promptly-only --ca-pub /path/to/deploy-ca-v2.pub
```

CLI --ca-pub wins over CA_PUB; historical default is ~/.ssh/deploy-ca.pub. Non-v1 CAs get a
`deployer-<stamp>-ca2` Key ID. Profiles fix TTLs at 8h/1h; explicit legacy `-n` retains the
1h/4h/8h cap for transition. Admin with extra tags is a union, not restricted scope; omit
admin for a tag-only cert. The keys UI defaults to Daily and hides tags until Admin is selected.
Its loopback mint route accepts `{profile, ttl?, extraTags?}`; it rejects arbitrary principals,
unknown/duplicate tags, duration overrides, and caller-supplied CA paths. Legacy API payloads
must migrate to this schema; the operator CLI retains explicit legacy minting.

The CA stays only in 1Password; a leaf private key is created in a new mode-700 output directory
and expires with its certificate. The script refuses existing output directories. Never put
credential contents in git/logs. Worker tests use public-config fixtures and fake transports.
Real test signing is opt-in and is prohibited during this lane without a specific exception.

## GitHub credentials (separate from SSH rotation)

The following existing GitHub helper flow is not modified by this SSH lane. Ivo's pushes
use freshly brokered GH_TOKEN in the environment only; no token URL, argv, or file.

## One-time GitHub App setup

1. GitHub → Settings → Developer settings → GitHub Apps → New GitHub App.
2. Permissions: **Contents** Read & write, **Metadata** Read-only.
3. Uncheck **Active** under Webhook.
4. Install the App on the repos the deployer needs.
5. **App ID** is on the App page. **Installation ID** is the number in the URL at
   Settings → Installations → Configure (`…/settings/installations/<id>`).
6. Generate and download the private key PEM. Put it in 1Password and delete the file:
   `op document create <downloaded>.pem --title lowcap-deployer-pem && rm <downloaded>.pem`.
   Set `GH_APP_KEY_OP` to the document title — minting is then Touch ID-gated via the op CLI.
   (`GH_APP_KEY_FILE=<path>` still works as an on-disk fallback, but the key is a standing
   credential any local process can read; prefer 1Password.)

```
export GH_APP_ID=123456
export GH_APP_INSTALLATION_ID=7654321
export GH_APP_KEY_OP=lowcap-deployer-pem
```

Mint a token and push over https:

```
eval "$(./mint-github-token.sh --askpass)"
git clone https://github.com/owner/repo.git
cd repo && git push
```

The remote URL must be `https`, not `ssh`. The token never goes in the URL.

`--askpass` prints six `export` lines, and all six matter:

- `GIT_ASKPASS` points at the helper that prints the token as the password.
- `GIT_CONFIG_COUNT` / `GIT_CONFIG_KEY_0` / `GIT_CONFIG_VALUE_0` set an empty `credential.helper`.
  Git consults configured credential helpers **before** `GIT_ASKPASS`. This machine has a global
  `osxkeychain` helper and a `gh` helper for github.com; without the reset, one of them would answer
  first and bypass the minted token, or persist the minted token into the login keychain. An empty
  value resets the whole helper list for these commands only. Needs git 2.31 or newer.
- `GIT_CONFIG_KEY_1` / `GIT_CONFIG_VALUE_1` set `credential.username=x-access-token`, which removes
  the username prompt.

The exports live in that shell only. Open a new shell to drop them.

Without `--askpass` the token is printed on stdout and nothing else is:

```
token=$(./mint-github-token.sh)
```


Signed rotation documentation: Ivo
