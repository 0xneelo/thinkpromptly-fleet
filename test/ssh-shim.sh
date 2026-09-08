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
#   FLEET_SHIM_ARGV_LOG   append one NUL-delimited argv record per call, for argv assertions
#   FLEET_SHIM_UNREACH    space-separated hosts that answer like an unreachable box
#   FLEET_SHIM_MAP_WSL    1 = run `wsl sh -s` as plain `sh -s` (no WSL interop available)

# The deck polls machines concurrently, so several shims append to this log at once. A
# record must therefore be ONE write() to the O_APPEND descriptor: POSIX makes that append
# atomic, so two racing shims cannot interleave. `printf` reuses its format for every
# argument, so a single call emits the whole record in one small buffered write.
#
# The empty trailing argument is what closes the record — a second NUL. It used to be a
# separate `printf '\n'`, which made a record TWO writes, and two shims could land both
# argument runs before either terminator: the two calls then read back as one record with
# the arguments of both. That is the flake fixed on 2026-09-08 (it failed ~8% of runs of
# test/machines.test.js). No argv the deck builds contains an empty string, so a NUL pair
# never occurs inside a record.
if [ -n "$FLEET_SHIM_ARGV_LOG" ]; then
  printf '%s\0' "$@" '' >> "$FLEET_SHIM_ARGV_LOG"
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
