#!/bin/sh
# fleet-env-set.sh — set one key in this machine's ~/.claude/fleet/fleet.env, taking the
# value from STDIN. Master copy lives in the repo; installed on the box at
# /home/vibe/bin/fleet-env-set.sh the same way fleet-lastmsg.sh and fleet-credits.sh are.
#
#   printf '%s' "$SECRET" | sh fleet-env-set.sh FD_TAILNET_KEY
#
# Why stdin and not an argument: `ps` is world-readable, so a secret must never become an
# argv word (same rule as fd-common.sh's 0600 curl --config file). It is also why the
# ssh command string that drives this carries ZERO quotes — see the quote-free rule in
# README.md: `ssh german-box <cmd>` traverses zsh -> CMD -> wsl -> bash and nested quotes
# get mangled. The key name is an argv word; that is fine, it is not a secret and it is
# whitelist-validated below.
#
# Idempotent: setting a key that is already there replaces that line in place, so running
# the provisioning script twice is a no-op rather than a growing file. Every other line,
# including the operator's own comments and edits, is preserved byte for byte.
#
# POSIX sh only (WSL bash and macOS sh both run this).
set -eu

FD_DIR="${FD_DIR:-${CLAUDE_CONFIG_DIR:-$HOME/.claude}/fleet}"
ENVFILE="$FD_DIR/fleet.env"

KEY=${1:-}
case "$KEY" in
  '' | *[!A-Z_]*) echo "fleet-env-set: key must match [A-Z_]+, got: ${KEY:-<empty>}" >&2; exit 2 ;;
esac

# The value never reaches a log, a terminal or an argv. Only its length is ever reported.
VALUE=$(cat)
# A trailing newline from `cat` of a file, or a stray CR from a value that made a round trip
# through Windows, would end up inside the credential. Strip both, then refuse the rest:
# fleet.env is sourced by /bin/sh, so a newline, quote or backslash in a value is either a
# broken credential or an injection.
VALUE=$(printf '%s' "$VALUE" | tr -d '\r\n')
case "$VALUE" in
  '') echo "fleet-env-set: refusing to write an empty value for $KEY" >&2; exit 3 ;;
  *[\'\"\\]* | *' '*)
    echo "fleet-env-set: value for $KEY holds a quote, backslash or space - refusing" >&2
    exit 3 ;;
esac
# fd-common.sh guards control characters again when it reads the key back. Both layers use
# the same set on purpose - a value that is legal here and rejected there is a credential
# that silently stops working, which is the worst of the three outcomes.
case "$VALUE" in
  *[[:cntrl:]]*)
    echo "fleet-env-set: value for $KEY holds a control character - refusing" >&2
    exit 3 ;;
esac

mkdir -p "$FD_DIR"
# Create it 0600 BEFORE anything is written, never after: a file that is briefly
# world-readable while it holds a bearer key has already leaked it.
umask 077
TMP="$ENVFILE.tmp.$$"
# Every exit path from here on removes the temp file. Without this, a full disk or an
# unwritable directory leaves a 0600 file holding a bearer key lying in $FD_DIR, and the
# next run picks a new $$ rather than cleaning it up.
trap 'rm -f "$TMP"' EXIT HUP INT TERM
: > "$TMP"
chmod 0600 "$TMP"

if [ -f "$ENVFILE" ]; then
  # Drop any existing line for this key, commented out or not, and keep everything else.
  # grep exits 1 when it selects no lines, which is legal here (fleet.env held nothing but
  # this key). It exits 2 when it could not READ the file - and that must never be treated
  # as "the file was empty", because the next two lines would then write a fleet.env holding
  # only this one key and silently destroy FLEETDECK_BUS_TOKEN, FD_HOST and every operator
  # edit. provision-fleet-secrets.sh calls this three times in a row against the same file,
  # so one masked read error would take the previous two calls down with it.
  rc=0
  grep -v -E "^[[:space:]]*#?[[:space:]]*${KEY}=" "$ENVFILE" > "$TMP" || rc=$?
  if [ "$rc" -gt 1 ]; then
    echo "fleet-env-set: cannot read $ENVFILE (grep exit $rc) - refusing to rewrite it" >&2
    exit 4
  fi
fi
printf '%s=%s\n' "$KEY" "$VALUE" >> "$TMP"

mv "$TMP" "$ENVFILE"
chmod 0600 "$ENVFILE"
trap - EXIT HUP INT TERM

echo "fleet-env-set: $KEY set in $ENVFILE (${#VALUE} chars, mode 0600)"
