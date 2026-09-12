#!/usr/bin/env sh
# Stands in for `ssh` as FLEET_SSH_BIN so the real machinesCollect path can be driven on a
# box with no ssh route to the fleet. Same argv shape the deck always passes:
#
#   ssh -o BatchMode=yes -o ConnectTimeout=8 <host> <remote command>   (script on stdin)
#
# It drops the -o pairs and the host and runs the remote command HERE, so what is exercised
# is the deck's real fan-out, real stdin piping and real error handling — only the transport
# is faked. Two knobs, both env, so the argv the deck builds is never rewritten by a test:
#
#   FLEET_SHIM_ARGV_DIR   write one NUL-delimited argv record per call, each its own file here
#   FLEET_SHIM_UNREACH    space-separated hosts that answer like an unreachable box
#   FLEET_SHIM_MAP_WSL    1 = run `wsl sh -s` as plain `sh -s` (no WSL interop available)

# The deck polls machines concurrently, so several shims record at once. One file per call,
# created O_EXCL by mktemp, so no two records can share a write. Appending all of them to one
# log was two write(2)s per record (the shell flushes after each printf, elements then the
# newline), and under load two shims interleaved into one merged line plus a blank one.
if [ -n "$FLEET_SHIM_ARGV_DIR" ]; then
  printf '%s\0' "$@" > "$(mktemp "$FLEET_SHIM_ARGV_DIR/call.XXXXXX")"
fi

# Walk off the option pairs the deck always sends; whatever is left is host then command.
while [ "$1" = "-o" ]; do shift 2; done
HOST=$1
shift

for h in $FLEET_SHIM_UNREACH; do
  if [ "$h" = "$HOST" ]; then
    # Verbatim shape of a real timeout, so the deck's error text is the one an operator
    # would actually read on the page.
    echo "ssh: connect to host $HOST port 22: Connection timed out" >&2
    exit 255
  fi
done

CMD=$*
if [ "$FLEET_SHIM_MAP_WSL" = "1" ]; then
  case $CMD in 'wsl '*) CMD=${CMD#wsl } ;; esac
fi

# The remote command is one unquoted word list by the deck's own quote-free rule, so `exec`
# on it is exactly what the far-side shell would do with it.
exec $CMD
