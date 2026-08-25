#!/bin/bash
# Mint a short-lived OpenSSH user certificate signed by the CA key held in 1Password.
# The CA private key never leaves the 1Password agent (-U signs via the agent).
set -euo pipefail

AGENT_SOCK="$HOME/Library/Group Containers/2BUA8C4S2C.com.1password/t/agent.sock"
CA_PUB="$HOME/.ssh/deploy-ca.pub"

ttl=1h
principals=
outdir=

usage() {
	echo "usage: $(basename "$0") -n principal[,principal] [-t 1h|4h|8h] [-o outdir]" >&2
	exit 2
}

while getopts ':t:n:o:h' opt; do
	case "$opt" in
	t) ttl=$OPTARG ;;
	n) principals=$OPTARG ;;
	o) outdir=$OPTARG ;;
	*) usage ;;
	esac
done

case "$ttl" in
1h | 4h | 8h) ;;
*)
	echo "error: -t must be 1h, 4h or 8h (got '$ttl')" >&2
	exit 2
	;;
esac

[ -n "$principals" ] || {
	echo "error: -n is required — cert principals must match the login username (e.g. -n root)" >&2
	exit 2
}

stamp=$(date +%Y%m%d-%H%M%S)
outdir=${outdir:-$HOME/.ssh/deploy-certs/$stamp}

if [ ! -S "$AGENT_SOCK" ]; then
	echo "error: 1Password SSH agent socket not found at:" >&2
	echo "  $AGENT_SOCK" >&2
	echo "Enable it in 1Password > Settings > Developer > Use the SSH agent." >&2
	exit 1
fi
export SSH_AUTH_SOCK="$AGENT_SOCK"

if [ ! -f "$CA_PUB" ]; then
	echo "error: CA public key not found at $CA_PUB" >&2
	echo >&2
	echo "List the keys the 1Password agent holds:" >&2
	echo "  SSH_AUTH_SOCK=\"$AGENT_SOCK\" ssh-add -L" >&2
	echo >&2
	echo "Copy the single line for the key you want to act as the CA into:" >&2
	echo "  $CA_PUB" >&2
	exit 1
fi

mkdir -p -m 700 "$outdir"

# Stale files would make ssh-keygen prompt "Overwrite?" and hang a headless run.
rm -f "$outdir/deployer" "$outdir/deployer.pub" "$outdir/deployer-cert.pub"

ssh-keygen -t ed25519 -f "$outdir/deployer" -N "" -C "deployer-cert" -q
chmod 600 "$outdir/deployer"

if ! ssh-keygen -Us "$CA_PUB" \
	-I "deployer-$stamp" \
	-n "$principals" \
	-V "+$ttl" \
	-z "$(date +%s)" \
	"$outdir/deployer.pub" >/dev/null; then
	echo "Signing failed — 1Password is probably locked. Unlock 1Password and re-run." >&2
	exit 1
fi

login=${principals%%,*}

# Stable pointer for the vps-deploy / gb-deploy ssh aliases in ~/.ssh/config.
ln -sfn "$outdir" "$HOME/.ssh/deploy-certs/current"
ssh-keygen -Lf "$outdir/deployer-cert.pub" | grep -E '^[[:space:]]*Valid:' >&2 || true
echo >&2
echo "ssh -o IdentitiesOnly=yes -o IdentityAgent=none -i \"$outdir/deployer\" -o CertificateFile=\"$outdir/deployer-cert.pub\" $login@<host>" >&2
echo >&2
cat >&2 <<EOF
Host deploy-target
    HostName <host>
    User $login
    IdentitiesOnly yes
    IdentityAgent none
    IdentityFile $outdir/deployer
    CertificateFile $outdir/deployer-cert.pub
EOF
echo >&2

echo "$outdir"
