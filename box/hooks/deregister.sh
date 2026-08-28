#!/bin/sh
# SessionEnd hook: stop this session's heartbeat and clean up its local state.
#
# It deliberately POSTs NOTHING. The contract has no lease-release route, and the writes
# that could mark a row down (/api/registry status, /api/kill) are epoch-fenced on the
# orchestrator/coordinator seat epoch (M17) - a hook holds no seat epoch, so any such call
# is a guaranteed 409. Stopping the beat IS the contract-legal way to end a lease: the row
# expires, goes suspect, and the reaper handles it.
#
# Never breaks the session: exits 0 on every path, silent on stdout.
set -u

FD_BIN=${FD_BIN:-$(dirname -- "$0")}
. "$FD_BIN/fd-common.sh" || exit 0
fd_load_config

ses=$(fd_session_name)
[ -n "$ses" ] || exit 0
FD_LOG_SES=$ses
export FD_LOG_SES

state=$FD_DIR/state
pidf=$state/$ses.pinger.pid
rec=$(cat "$pidf" 2>/dev/null)          # "pid<TAB>starttime" - identity, not just a pid
pid=$(fd_pinger_pid "$rec")

if fd_pinger_running "$rec"; then
  kill -TERM "$pid" 2>/dev/null
  n=0
  while [ "$n" -lt 30 ] && kill -0 "$pid" 2>/dev/null; do
    n=$((n + 1))
    sleep 0.1
  done
  if kill -0 "$pid" 2>/dev/null; then
    kill -KILL "$pid" 2>/dev/null
    fd_log "deregister: pinger $pid ignored TERM, killed"
  else
    fd_log "deregister: pinger $pid stopped"
  fi
else
  fd_log "deregister: no live pinger"
fi

rm -f "$pidf" "$state/$ses.lease" 2>/dev/null
exit 0
