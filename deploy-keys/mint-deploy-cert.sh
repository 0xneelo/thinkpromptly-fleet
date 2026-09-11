#!/bin/bash
# Operator-only mint; the real CA stays inside 1Password. --dry-run never mints.
set -euo pipefail
CA_PUB=${CA_PUB:-$HOME/.ssh/deploy-ca.pub}
AGENT_SOCK="$HOME/Library/Group Containers/2BUA8C4S2C.com.1password/t/agent.sock"
v1=SHA256:Sg4TJdI9+SNBj8K0et1nEBhb8ntuX7ZzXSqzikyyDL0
profile='' ttl='' principals='' outdir='' dry_run=0
usage() {
  echo "usage: $0 [--legacy|--daily|--admin] [-n principals] [-t 1h|4h|8h] [--ca-pub file] [-o outdir] [--dry-run]" >&2
  exit 2
}
fail() { echo "error: $*" >&2; exit 2; }
while [ "$#" -gt 0 ]; do
  case "$1" in
    --legacy|--daily|--admin) [ -z "$profile" ] || fail 'choose one profile'; profile=${1#--}; shift ;;
    -n|-t|-o|--ca-pub)
      [ "$#" -ge 2 ] && [ -n "$2" ] || usage
      case "$1" in -n) principals=$2;; -t) ttl=$2;; -o) outdir=$2;; --ca-pub) CA_PUB=$2;; esac
      shift 2 ;;
    --dry-run) dry_run=1; shift ;;
    *) usage ;;
  esac
done
case "$profile" in
  legacy) principals=${principals:-root,vibe,misterisley,tabor}; ttl=${ttl:-1h} ;;
  daily) principals=${principals:-deploy}; ttl=${ttl:-8h}
    [ "$principals" = deploy ] && [ "$ttl" = 8h ] || fail 'daily requires deploy and 8h' ;;
  admin) principals=${principals:-admin}; ttl=${ttl:-1h}
    [ "$ttl" = 1h ] || fail 'admin requires 1h'
    IFS=, read -r -a tags <<< "$principals"
    for tag in "${tags[@]}"; do
      case "$tag" in admin|promptly-only|onboarding-only|ivy-only|german-only|rog-only) ;; *) fail 'unknown admin principal';; esac
    done ;;
  '') [ -n "$principals" ] || fail 'choose --daily, --admin, or explicit legacy -n'; ttl=${ttl:-1h} ;;
esac
case "$ttl" in 1h|4h|8h) ;; *) fail '-t must be 1h, 4h or 8h';; esac
[[ "$principals" =~ ^[a-zA-Z0-9_-]+(,[a-zA-Z0-9_-]+)*$ ]] || fail 'invalid principals'
[ -f "$CA_PUB" ] || fail 'CA public key file missing; export only its public half from 1Password'
# Accept exactly one ordinary ed25519 PUBLIC key, never a certificate or private key.
ca_public=$(cat -- "$CA_PUB")
printf '%s\n' "$ca_public" | awk 'NF && $1 !~ /^#/ { if ($1 != "ssh-ed25519" || NF < 2) exit 1; n++ } END { if (n != 1) exit 1 }' || fail 'expected one ed25519 public CA key'
fp=$(printf '%s\n' "$ca_public" | ssh-keygen -lf /dev/stdin -E sha256 | awk '{print $2}')
[ -n "$fp" ] || fail 'invalid CA public key'
stamp=$(date +%Y%m%d-%H%M%S)
key_id=deployer-$stamp
[ "$fp" = "$v1" ] || key_id=$key_id-ca2
extensions=default
options=()
if [ "$profile" = daily ]; then extensions=permit-pty; options=(-O clear -O permit-pty); fi
current_link=current
case "$profile" in daily|admin) current_link=current-$profile ;; esac
if [ "$dry_run" = 1 ]; then
  printf 'profile=%s\nprincipals=%s\nttl=%s\nkey_id=%s\nca_fingerprint=%s\nextensions=%s\n' "${profile:-legacy}" "$principals" "$ttl" "$key_id" "$fp" "$extensions"
  printf 'current_link=%s\n' "$current_link"
  exit 0
fi
# Deliberately opt-in test seam. Tests supply an isolated signer, never an agent.
if [ "${SSH_CA_TEST_MODE:-}" = 1 ]; then
  [ -x "${SSH_CA_TEST_SIGNER:-}" ] && [ -n "$outdir" ] || fail 'test mode requires signer and explicit output directory'
else
  [ -z "${SSH_CA_TEST_SIGNER:-}" ] || fail 'test signer requires test mode'
  [ -S "$AGENT_SOCK" ] || fail '1Password SSH agent unavailable'
  export SSH_AUTH_SOCK="$AGENT_SOCK"
fi
outdir=${outdir:-$HOME/.ssh/deploy-certs/$stamp}
umask 077
ca_snapshot=$(mktemp "${TMPDIR:-/tmp}/ssh-ca-public.XXXXXX")
trap 'rm -f "$ca_snapshot"' EXIT
printf '%s\n' "$ca_public" > "$ca_snapshot"
# Refuse an existing directory: never overwrite an active credential or follow its symlink.
mkdir -p "$(dirname "$outdir")"
outdir=$(cd "$(dirname "$outdir")" && pwd)/$(basename "$outdir")
mkdir -m 700 "$outdir" || fail 'output directory must be new'
ssh-keygen -t ed25519 -f "$outdir/deployer" -N '' -C deployer-cert -q
# macOS /bin/bash 3.2 calls an empty array unbound under set -u (Legacy and Admin have no options).
sign_args=(-I "$key_id" -n "$principals" -V "+$ttl" -z "$(date +%s)" ${options[@]+"${options[@]}"} "$outdir/deployer.pub")
if [ "${SSH_CA_TEST_MODE:-}" = 1 ]; then
  SSH_CA_PUBLIC_SNAPSHOT="$ca_snapshot" "$SSH_CA_TEST_SIGNER" "${sign_args[@]}" >/dev/null
else
  ssh-keygen -Us "$ca_snapshot" "${sign_args[@]}" >/dev/null
  mkdir -p "$HOME/.ssh/deploy-certs"
  ln -sfn "$outdir" "$HOME/.ssh/deploy-certs/$current_link"
fi
ssh-keygen -Lf "$outdir/deployer-cert.pub" | awk '/Valid:/{print}' >&2
printf '%s\n' "$outdir"
