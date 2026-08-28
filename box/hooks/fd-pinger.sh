#!/bin/sh
# fd-pinger.sh <session> - the detached heartbeat loop. NOT a hook: a hook-driven beat
# false-positives during a long Bash call, so this runs as its own process, outliving the
# tmux session that spawned it.
#
# This loop is the FROZEN M8 contract (CONTRACT.md "Pinger contract"), followed literally:
#   liveness proof before every beat  ->  200 renew / 410 tombstone+stop / 409 stop+surface
#   / anything else is transient, keep beating. Re-claiming is NOT allowed from here.
set -u

FD_BIN=${FD_BIN:-$(dirname -- "$0")}
. "$FD_BIN/fd-common.sh" || exit 0
fd_load_config

ses=${1:-}
fd_safe_name "$ses" || exit 0
FD_LOG_SES=$ses
export FD_LOG_SES

lease=$FD_DIR/state/$ses.lease
[ -r "$lease" ] || { fd_log "pinger: no lease file, nothing to beat for"; exit 0; }
. "$lease"

epoch=${FD_EPOCH:-}
ttl=${FD_TTL_S:-}
case $epoch in '' | *[!0-9]*) fd_log "pinger: unusable epoch in the lease file"; exit 0 ;; esac
case $ttl in
  '' | *[!0-9]*)
    fd_log "WARN pinger: unusable FD_TTL_S in the lease file (got '$ttl'), falling back to 90s"
    ttl=90
    ;;
esac

# Cadence is always derived from the server's ttl_s, never hardcoded (S2). Floor of 1s so
# low-TTL test runs still work.
cadence=$((ttl / 3))
[ "$cadence" -ge 1 ] || cadence=1

# "pid<TAB>starttime", not a bare pid: the start time is what stops a recycled pid from
# passing as this pinger and making the claim guard skip a claim the session needs.
pidf=$FD_DIR/state/$ses.pinger.pid
printf '%s\t%s\n' "$$" "$(fd_proc_id $$)" >"$pidf" 2>/dev/null
trap 'rm -f "$pidf" 2>/dev/null; exit 0' TERM INT

fd_log "pinger: start pid=$$ epoch=$epoch ttl_s=$ttl cadence=${cadence}s"

fails=0
while :; do
  # 1. Prove the session is alive BEFORE beating: a beat for a dead session is exactly the
  # false-positive this whole design exists to prevent.
  if ! fd_alive "$ses"; then
    fd_log "pinger: session gone, exiting"
    rm -f "$pidf" 2>/dev/null
    exit 0
  fi

  FD_J_host=$FD_HOST FD_J_name=$ses FD_J_epoch=$epoch
  export FD_J_host FD_J_name FD_J_epoch
  body=$(fd_json_body host name epoch)
  unset FD_J_host FD_J_name FD_J_epoch

  out=$(fd_post /api/heartbeat "$body")
  code=$(printf '%s\n' "$out" | sed -n 1p)
  resp=$(printf '%s\n' "$out" | sed 1d)

  case $code in
    200)
      fails=0
      t=$(printf '%s' "$resp" | fd_json ttl_s)
      case $t in
        '' | *[!0-9]*) : ;;
        *)
          if [ "$t" != "$ttl" ]; then
            ttl=$t
            cadence=$((ttl / 3))
            [ "$cadence" -ge 1 ] || cadence=1
            fd_log "pinger: ttl_s changed to $ttl, cadence now ${cadence}s"
          fi
          ;;
      esac
      ;;
    410)
      # Reaped, and a reaped row never resurrects (M2). Leave a headstone the operator can
      # find, then stop for good.
      reason=$(printf '%s' "$resp" | fd_json reason)
      reaped_at=$(printf '%s' "$resp" | fd_json reaped_at)
      tdir=$HOME/launch/tombstones
      mkdir -p "$tdir" 2>/dev/null
      printf '%s\n' \
        "session:   $ses" \
        "host:      $FD_HOST" \
        "epoch:     $epoch" \
        "reason:    ${reason:-reaped}" \
        "reaped_at: ${reaped_at:-unknown} (server, unix-ms)" \
        "observed:  $(date +%Y-%m-%dT%H:%M:%S%z) (local)" \
        "" \
        "The fleet server reaped this lease. The pinger stopped and will not re-claim;" \
        "a reaped row never resurrects. Start a fresh session to get a new lease." \
        >"$tdir/$ses.txt" 2>/dev/null
      fd_log "pinger: 410 reaped (${reason:-reaped}), tombstone written, exiting"
      rm -f "$pidf" 2>/dev/null
      exit 0
      ;;
    409)
      # A newer incarnation fenced us (M1). The contract forbids re-claiming from here, so
      # the only correct move is to stop and make it visible.
      adir=$HOME/launch/fd-alerts
      mkdir -p "$adir" 2>/dev/null
      printf '%s\n' \
        "session:  $ses" \
        "host:     $FD_HOST" \
        "epoch:    $epoch (stale)" \
        "observed: $(date +%Y-%m-%dT%H:%M:%S%z) (local)" \
        "" \
        "The heartbeat was fenced with 409: a newer incarnation of this (host,name) holds" \
        "the lease. The pinger stopped - re-claiming from the pinger is not allowed by the" \
        "contract. A human or the session itself must run lease-claim.sh again." \
        >"$adir/$ses.txt" 2>/dev/null
      # Best-effort, LOCAL tmux only - nothing here ever writes another host. $ses passed
      # fd_safe_name, so no quote character can reach the tmux command line.
      tmux display-message -t "=$ses" \
        "fleet: lease fenced by a newer incarnation - heartbeat stopped, re-claim needed" \
        2>/dev/null || :
      fd_log "pinger: 409 fenced at epoch $epoch, alert written, exiting"
      rm -f "$pidf" 2>/dev/null
      exit 0
      ;;
    *)
      # 000 (no connection), 5xx, timeouts: all transient. Never exit on these - a deck
      # restart must not silently kill every pinger in the fleet. One log line per 10
      # consecutive failures so a long outage cannot flood the log.
      fails=$((fails + 1))
      [ $((fails % 10)) -eq 1 ] && fd_log "pinger: transient http $code (failure $fails), still beating"
      ;;
  esac

  sleep "$cadence"
done
