#!/bin/sh
# provision-fleet-secrets.sh — put the two shared fleet secrets where they belong.
# Run on the MAC (the deck's machine). It is the operator's half of XYZ-1854's riders.
#
#   sh mac/provision-fleet-secrets.sh              # both riders
#   sh mac/provision-fleet-secrets.sh --tailnet    # FLEET_TAILNET_KEY only
#   sh mac/provision-fleet-secrets.sh --bus        # FLEETDECK_BUS_TOKEN only
#   sh mac/provision-fleet-secrets.sh --show       # what is armed where; no secret printed
#   sh mac/provision-fleet-secrets.sh --host onboarding-box --no-wsl
#
# Rider a — FLEET_TAILNET_KEY. The server's tailnet listener requires this bearer key on
#   every POST that arrives over tailscale and exempts loopback (server.js tailnetAuthed).
#   Both ends of the wiring already exist; what was missing was a value. This generates one,
#   keeps it on the Mac at ~/.fleetdeck/tailnet-key (0600) for the deck to source, and
#   pushes the same bytes to the box.
#
# Rider b — FLEETDECK_BUS_TOKEN (XYZ-1844). Fleetdeck mints this at ~/.fleetdeck-bus-token
#   when it first runs. Box workers need the same value or bin/fleet-message.js cannot post
#   a reply, which is the bug: orchestrator->worker delivers, worker->orchestrator 401s.
#
# Secret handling, non-negotiable:
#   - A value is NEVER an argv word here or on the box: `ps` is world-readable. Both travel
#     to box/fleet-env-set.sh on STDIN.
#   - Nothing is printed. --show reports armed/absent and a length, never a value.
#   - Nothing is committed: ~/.fleetdeck/ and *.pem are gitignored, fleet.env is not in-tree.
#   - Every remote command string holds ZERO quote characters (README quote-free rule):
#     ssh german-box <cmd> traverses zsh -> CMD -> wsl -> bash and nested quotes get mangled.
#
# POSIX sh.
set -eu

REPO=$(cd "$(dirname "$0")/.." && pwd)
HOST=german-box
WSL=wsl
BOXBIN=/home/vibe/bin
KEYDIR="$HOME/.fleetdeck"
KEYFILE="$KEYDIR/tailnet-key"
BUSFILE="${FLEETDECK_BUS_TOKEN_FILE:-$HOME/.fleetdeck-bus-token}"
# The DECK's own tailnet address, not the box's — every box points at this same one, which
# is why it does not vary with --host. It is the value README.md tells remote senders to
# use. Override it if the deck ever moves.
DECK_URL=${FLEETDECK_URL:-http://100.125.231.25:3131}
DO_TAILNET=1
DO_BUS=1
MODE=provision

while [ $# -gt 0 ]; do
  case "$1" in
    --tailnet) DO_BUS=0 ;;
    --bus)     DO_TAILNET=0 ;;
    --show)    MODE=show ;;
    --no-wsl)  WSL='' ;;
    --host)     shift; HOST=${1:?--host needs a value} ;;
    --deck-url) shift; DECK_URL=${1:?--deck-url needs a value} ;;
    *) echo "usage: $0 [--tailnet|--bus] [--show] [--host H] [--no-wsl] [--deck-url U]" >&2; exit 2 ;;
  esac
  shift
done

die() { echo "provision-fleet-secrets: $*" >&2; exit 1; }
say() { echo "  $*"; }

# ssh joins its argument words with spaces into ONE remote command string, so passing
# `wsl` as a leading word keeps that string quote-free. A `kind: linux` host takes --no-wsl
# and the prefix drops out.
remote() {
  if [ -n "$WSL" ]; then ssh -o BatchMode=yes "$HOST" "$WSL" "$@"
  else ssh -o BatchMode=yes "$HOST" "$@"; fi
}

if [ "$MODE" = show ]; then
  echo "mac:"
  if [ -f "$KEYFILE" ]; then
    say "FLEET_TAILNET_KEY  armed  ($(wc -c <"$KEYFILE" | tr -d ' ') bytes, mode $(stat -f %Lp "$KEYFILE"), $KEYFILE)"
  else
    say "FLEET_TAILNET_KEY  ABSENT ($KEYFILE)"
  fi
  if [ -f "$BUSFILE" ]; then
    say "FLEETDECK_BUS_TOKEN armed ($(wc -c <"$BUSFILE" | tr -d ' ') bytes, mode $(stat -f %Lp "$BUSFILE"), $BUSFILE)"
  else
    say "FLEETDECK_BUS_TOKEN ABSENT ($BUSFILE) - start the deck once; it mints the token"
  fi
  echo "deck process:"
  say "FLEET_TAILNET_KEY  $([ -n "${FLEET_TAILNET_KEY:-}" ] && echo 'exported in THIS shell' || echo 'not exported in this shell')"
  echo "$HOST:"
  # Every probe here is quote-free and value-free: grep -c counts lines, it never prints one.
  remote test -x "$BOXBIN/fleet-env-set.sh" >/dev/null 2>&1 &&
    say "fleet-env-set.sh installed" || say "fleet-env-set.sh NOT installed"
  for k in FD_TAILNET_KEY FLEETDECK_BUS_TOKEN FLEETDECK_URL; do
    n=$(remote grep -c "^$k=" /home/vibe/.claude/fleet/fleet.env 2>/dev/null || echo 0)
    say "$k $([ "${n:-0}" -gt 0 ] && echo 'set in fleet.env' || echo 'ABSENT from fleet.env')"
  done
  exit 0
fi

# --------------------------------------------------------- install the box-side setter
[ -f "$REPO/box/fleet-env-set.sh" ] || die "missing $REPO/box/fleet-env-set.sh"
echo "installing box/fleet-env-set.sh on $HOST:$BOXBIN ..."
remote mkdir -p "$BOXBIN"
remote tee "$BOXBIN/fleet-env-set.sh" < "$REPO/box/fleet-env-set.sh" >/dev/null
remote chmod +x "$BOXBIN/fleet-env-set.sh"

# ------------------------------------------------------------------- rider a: tailnet key
if [ "$DO_TAILNET" = 1 ]; then
  mkdir -p "$KEYDIR"
  chmod 0700 "$KEYDIR"
  if [ ! -f "$KEYFILE" ]; then
    # 32 bytes of urandom, hex. No spaces, quotes or backslashes, so it survives both
    # fleet.env sourcing and the curl --config line fd-common.sh writes.
    umask 077
    openssl rand -hex 32 > "$KEYFILE"
    chmod 0600 "$KEYFILE"
    echo "generated a new FLEET_TAILNET_KEY at $KEYFILE"
  else
    echo "reusing the FLEET_TAILNET_KEY already at $KEYFILE"
  fi
  # Value on stdin only. The key NAME is the sole argv word, and it is not a secret.
  tr -d '\r\n' < "$KEYFILE" | remote sh "$BOXBIN/fleet-env-set.sh" FD_TAILNET_KEY
fi

# ---------------------------------------------------------------------- rider b: bus token
if [ "$DO_BUS" = 1 ]; then
  [ -f "$BUSFILE" ] || die "no $BUSFILE — start the deck once so fleetdeck mints the bus token, then re-run"
  tr -d '\r\n' < "$BUSFILE" | remote sh "$BOXBIN/fleet-env-set.sh" FLEETDECK_BUS_TOKEN
  # Box worker shells read the URL from the same file, so a worker needs no extra setup.
  printf '%s' "$DECK_URL" | remote sh "$BOXBIN/fleet-env-set.sh" FLEETDECK_URL
fi

cat <<'NEXT'

Done on the box. Two things remain on this Mac, and only you can do them:

1. Arm the deck with the same key. The deck reads FLEET_TAILNET_KEY from its environment,
   so add this to up.sh (or export it before ./up.sh):

       export FLEET_TAILNET_KEY=$(cat ~/.fleetdeck/tailnet-key)

   Until it is exported, the tailnet listener accepts unauthenticated POSTs — which is the
   current, unarmed state, not a new hole. Once armed, a box POST without the matching key
   gets 401 and the pinger says so in its log.

2. Restart the deck (./up.sh) so it picks the key up.

Verify from the box afterwards:

       curl -s -o /dev/null -w %{http_code} -X POST http://100.125.231.25:3131/api/registry \
            -H content-type:application/json -d {}          # expect 401
       . ~/.claude/fleet/fleet.env && curl -s -o /dev/null -w %{http_code} \
            -X POST http://100.125.231.25:3131/api/registry \
            -H content-type:application/json -H "authorization: Bearer $FD_TAILNET_KEY" \
            -d {}                                            # expect 400, not 401
NEXT
