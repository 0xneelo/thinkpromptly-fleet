# deploy-keys

Short-lived deploy credentials for headless deployers.

## What this is

One mint step, done while 1Password is unlocked, produces credentials that die on their own.

- `mint-deploy-cert.sh` — an OpenSSH certificate for our own hosts. `sshd` enforces the `-V` expiry.
- `mint-github-token.sh` — a GitHub App installation token for github.com. GitHub enforces the 1h expiry.

No long-lived private key sits on disk. A locked 1Password agent no longer blocks a running deploy,
because the deployer holds a finished credential, not an agent connection. At these TTLs no revocation
infrastructure is needed — the credential outlives nothing.

## One-time host setup (SSH)

On your Mac, pick the 1Password key that will act as the CA:

```
SSH_AUTH_SOCK="$HOME/Library/Group Containers/2BUA8C4S2C.com.1password/t/agent.sock" ssh-add -L
```

Copy the one line for that key into `~/.ssh/deploy-ca.pub`.

On each server:

1. Copy `~/.ssh/deploy-ca.pub` to `/etc/ssh/deploy_ca.pub`.
2. Add to `/etc/ssh/sshd_config`:

   ```
   TrustedUserCAKeys /etc/ssh/deploy_ca.pub
   ```

3. Reload: `systemctl reload sshd` (or `service ssh reload`).

Certificate principals must match the login username. `-n` is required for exactly this reason —
use `-n root` to log in as `root`.

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

## Usage

Mint a 4h certificate for `root`:

```
outdir=$(./mint-deploy-cert.sh -n root -t 4h)
ssh -o IdentitiesOnly=yes -o IdentityAgent=none \
    -i "$outdir/deployer" -o CertificateFile="$outdir/deployer-cert.pub" \
    root@your-host
```

The script also prints a matching `~/.ssh/config` Host block.

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

## Safety notes

- The throwaway SSH private key is unencrypted on disk, but it is useless once the certificate expires.
- A crashed or abandoned deployer leaves nothing usable past the TTL.
- The CA private key never leaves 1Password. `ssh-keygen -U` signs through the agent.
- The GitHub token is never in argv and never in a git remote URL. In `--askpass` mode it **is**
  written to one place: the helper file, mode 700, inside a mode-700 `mktemp` directory. The script
  prints that directory path. Delete it when the deploy finishes. If you forget, the token is dead
  server-side within 1h — GitHub enforces that expiry and it cannot be extended.
