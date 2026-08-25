# SSH access for agents — read this first

SSH to our hosts uses short-lived OpenSSH certificates. Not static keys. Not the 1Password agent. Certs work from any sandboxed shell.

## Connect

Easiest path — two config aliases that always use the newest cert (via the `~/.ssh/deploy-certs/current` symlink): `ssh vps-deploy` (root@VPS) and `ssh gb-deploy` (vibe@german-box). If they fail with a missing-file or permission error, the current cert expired, was killed, or lacks your principal — ask the operator for a fresh `root,vibe` mint.

Manual form: certs live in `~/.ssh/deploy-certs/<timestamp>/` — two files: `deployer` (private key) and `deployer-cert.pub` (certificate).

```bash
ssh -o IdentitiesOnly=yes -o IdentityAgent=none -o BatchMode=yes \
  -i <dir>/deployer -o CertificateFile=<dir>/deployer-cert.pub <user>@<host>
```

Hosts and login users:
- `root@138.199.198.246` — lowcap VPS (Linux)
- `vibe@100.80.44.86` — german-box (Windows OpenSSH; default shell is cmd, tmux runs inside WSL)

## Pick a cert

Check before use — the cert's principal must match the login user, and it must not be expired:

```bash
ssh-keygen -Lf <dir>/deployer-cert.pub
```

Read the `Valid:` and `Principals:` lines. Expired or wrong principal → `Permission denied`. Newest dir is usually the right one: `ls -dt ~/.ssh/deploy-certs/*/ | head -1`.

## You cannot mint

Minting requires the operator's 1Password approval — no agent can do it. If no valid cert exists for your target, stop and ask the operator: "mint me a 1h/4h/8h cert for `<principals>`" (they use the fleetdeck SSH-keys page at `localhost:3131/keys.html` or `~/remote-system/deploy-keys/mint-deploy-cert.sh`).

Never: `ssh-add`, touching the 1Password agent socket, generating or uploading your own SSH keys, copying cert files off this machine.

## GitHub push (1-hour App tokens — self-serve while a train runs)

The App's PEM lives only in 1Password. The operator starts a **GitHub train** on the fleetdeck keys page (`localhost:3131/keys.html`) — one Touch ID — and for the train's window (1h/4h/8h) the deck brokers fresh 1-hour tokens to any local process. Get one yourself:

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
