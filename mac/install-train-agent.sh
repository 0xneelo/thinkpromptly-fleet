#!/bin/sh
# install-train-agent.sh — install (or remove) the fleetdeck train broker as a per-user
# macOS LaunchAgent, so the train survives every ./up.sh.
#
# OPERATOR-ONLY. No agent session runs this: it touches launchctl and the operator's
# 1Password session. A worker session proves the broker's logic with the box harness
# (test/train-proxy.test.js) and ships this script for the operator to run.
#
#   sh mac/install-train-agent.sh              # install and start
#   sh mac/install-train-agent.sh --uninstall  # stop and remove
#   sh mac/install-train-agent.sh --print      # render the plist to stdout, change nothing
#   sh mac/install-train-agent.sh --status     # what launchd thinks, plus a live probe
#
# Re-running the install is safe: it boots the old job out, rewrites the plist, boots the
# new one in. It never touches the deck, and it holds no secret — the App PEM and every
# minted token live in the broker's memory only.
#
# POSIX sh. Nothing here needs bash.
set -eu

LABEL=com.fleetdeck.train
REPO=$(cd "$(dirname "$0")/.." && pwd)
TEMPLATE="$REPO/mac/$LABEL.plist"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOGDIR="$HOME/Library/Logs/fleetdeck-train"
PORT=${FLEET_TRAIN_PORT:-3132}
DOMAIN="gui/$(id -u)"

MODE=install
case "${1:-}" in
  --uninstall) MODE=uninstall ;;
  --print)     MODE=print ;;
  --status)    MODE=status ;;
  '')          MODE=install ;;
  *) echo "usage: $0 [--uninstall|--print|--status]" >&2; exit 2 ;;
esac

die() { echo "install-train-agent: $*" >&2; exit 1; }

# --------------------------------------------------------------- environment checks
# launchd hands a job /usr/bin:/bin:/usr/sbin:/sbin and nothing else. `node` and `op` are
# almost never on that PATH, so the plist carries the PATH we resolve them on here rather
# than hoping. A wrong PATH shows up as a broker that answers 503 for every mint.
BASE_PATH=/usr/bin:/bin:/usr/sbin:/sbin
resolve_path() {
  _extra=''
  for _b in node op; do
    _p=$(command -v "$_b" 2>/dev/null) || continue
    _d=$(dirname "$_p")
    # Skip a directory launchd already gives us, and any we have added once already, so a
    # Homebrew node and a /usr/bin op do not produce a PATH with repeats in it.
    case ":$BASE_PATH:$_extra:" in *":$_d:"*) ;; *) _extra="${_extra:+$_extra:}$_d" ;; esac
  done
  printf '%s' "${_extra:+$_extra:}$BASE_PATH"
}

render() {
  NODE=$(command -v node) || die "node is not on PATH — install node, then re-run"
  [ -f "$TEMPLATE" ] || die "missing template $TEMPLATE"
  [ -f "$REPO/fleetdeck-train.js" ] || die "missing $REPO/fleetdeck-train.js"
  NEWPATH=$(resolve_path)
  # `|` as the sed delimiter: every value here is a filesystem path.
  sed -e "s|__NODE__|$NODE|g" \
      -e "s|__REPO__|$REPO|g" \
      -e "s|__PATH__|$NEWPATH|g" \
      -e "s|__LOGDIR__|$LOGDIR|g" \
      -e "s|__PORT__|$PORT|g" \
      "$TEMPLATE"
}

if [ "$MODE" = print ]; then
  render
  exit 0
fi

[ "$(uname -s)" = Darwin ] || die "this installs a macOS LaunchAgent; uname says $(uname -s)"

probe() {
  # A live readiness probe. The status route is the cheapest one that proves the process
  # is up AND answering, and it reveals no secret.
  curl -sf --max-time 3 "http://127.0.0.1:$PORT/api/ghtrain" 2>/dev/null
}

if [ "$MODE" = status ]; then
  echo "label:  $LABEL"
  echo "plist:  $PLIST $([ -f "$PLIST" ] && echo '(present)' || echo '(ABSENT)')"
  echo "logs:   $LOGDIR"
  echo "launchd:"
  launchctl print "$DOMAIN/$LABEL" 2>/dev/null | sed -n '1,12p' || echo "  not loaded"
  echo "probe:  $(probe || echo 'no answer on 127.0.0.1:'"$PORT")"
  exit 0
fi

if [ "$MODE" = uninstall ]; then
  # bootout on a job that is not loaded exits non-zero; that is not a failure here.
  launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
  rm -f "$PLIST"
  echo "uninstalled $LABEL. Logs under $LOGDIR were left alone — delete them by hand."
  echo "The deck now answers 503 'train broker unreachable' on /api/ghtoken until you"
  echo "re-install, which is the intended, visible failure."
  exit 0
fi

# --------------------------------------------------------------------------- install
if ! command -v op >/dev/null 2>&1; then
  echo "warning: the 1Password CLI (op) is not on this shell's PATH." >&2
  echo "         The broker needs it to read the App PEM. Install it, then re-run." >&2
fi

mkdir -p "$HOME/Library/LaunchAgents" "$LOGDIR"
render > "$PLIST.tmp"
# plutil is the cheapest proof the substitution did not produce a broken plist. A malformed
# plist makes bootstrap fail with an opaque "Input/output error".
plutil -lint "$PLIST.tmp" >/dev/null || { rm -f "$PLIST.tmp"; die "rendered plist is malformed"; }
mv "$PLIST.tmp" "$PLIST"

launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
# Every other failure in this script names itself; launchd's raw stderr on a failed
# bootstrap ("Input/output error", "Bootstrap failed: 5") tells the operator nothing, so
# say what actually went wrong and where to look.
launchctl bootstrap "$DOMAIN" "$PLIST" || die "launchctl bootstrap $DOMAIN failed.
  The plist at $PLIST is valid (plutil checked it), so the usual causes are a stale job
  still registered under this label, or a login session launchd cannot see. Try:
      launchctl bootout $DOMAIN/$LABEL
      launchctl print $DOMAIN | head
  If you are in an ssh session rather than logged in at the Mac, bootstrap into gui/ will
  fail by design — run this from a terminal on the Mac itself."
launchctl enable "$DOMAIN/$LABEL"
launchctl kickstart -k "$DOMAIN/$LABEL" || die "the agent bootstrapped but would not start; see $LOGDIR/err.log"

# Give launchd a moment, then prove it with a real request rather than trusting the exit code.
n=0
while [ "$n" -lt 25 ]; do
  if probe >/dev/null; then
    echo "installed and answering: $LABEL on 127.0.0.1:$PORT"
    echo "  plist $PLIST"
    echo "  logs  $LOGDIR/out.log, $LOGDIR/err.log"
    echo
    echo "The broker holds the train window in memory. It now outlives every ./up.sh."
    echo "A broker crash still loses the window — launchd restarts the process, and you"
    echo "start a new train from the keys page. It still dies with the Mac."
    exit 0
  fi
  n=$((n + 1))
  sleep 0.2
done

echo "bootstrapped, but 127.0.0.1:$PORT did not answer within 5s." >&2
echo "Check $LOGDIR/err.log and: launchctl print $DOMAIN/$LABEL" >&2
exit 1
