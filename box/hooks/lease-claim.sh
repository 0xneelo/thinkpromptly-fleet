#!/bin/sh
# SessionStart hook (and `mark.sh --worker` call site): claim this session's fleet lease and
# spawn the detached pinger. Runs twice for the Claude breed, so step 2 is a hard
# idempotency guard - a second claim would bump the epoch and fence our own live pinger.
#
# Never breaks the session: every failure path logs and exits 0, and nothing is printed on
# stdout (a SessionStart hook's stdout is injected into the session).
set -u

# Siblings live next to this script; FD_DIR only locates state/log/config, so the hooks can
# be run in place from the repo while state goes to a throwaway dir under test.
FD_BIN=${FD_BIN:-$(dirname -- "$0")}
. "$FD_BIN/fd-common.sh" || exit 0
fd_load_config

ses=$(fd_session_name)
if [ -z "$ses" ]; then
  FD_LOG_SES=unnamed fd_log "claim skipped: no whitelist-safe session name"
  exit 0
fi
FD_LOG_SES=$ses
export FD_LOG_SES

state=$FD_DIR/state
pidf=$state/$ses.pinger.pid
mkdir -p "$state" "$FD_DIR/log" 2>/dev/null || exit 0

# 2. Idempotency guard, made atomic by a mutex.
#
# The guard is test-and-act, and its two call sites (SessionStart and `mark.sh --worker`)
# fire close together - close enough that both can read an absent pidfile before either
# writes one. Both then claim, and the second claim bumps the epoch and fences the FIRST
# session's own live pinger, which 409s and alerts as fenced: exactly the failure the guard
# exists to prevent. `mkdir` is the POSIX atomic test-and-set (no flock, no mktemp race), so
# exactly one caller gets the lock, and it holds it across check -> claim -> spawn -> pidfile.
lock=$state/$ses.claim.lock
if ! mkdir "$lock" 2>/dev/null; then
  # A wedged lock must not lock a machine out of the fleet forever. The claim path is capped
  # at ~3 curl attempts, so a lock older than 60s with no pinger behind it is debris.
  if fd_older_than "$lock" 60 && ! fd_pinger_running "$(cat "$pidf" 2>/dev/null)"; then
    fd_log "breaking a stale claim lock (>60s old, no live pinger)"
    rm -rf "$lock" 2>/dev/null
    mkdir "$lock" 2>/dev/null || exit 0
  else
    # The other invocation holds it and is doing this work. Never block a session start.
    exit 0
  fi
fi
trap 'rmdir "$lock" 2>/dev/null' EXIT
trap 'rmdir "$lock" 2>/dev/null; exit 0' INT TERM

if [ -r "$pidf" ]; then
  old=$(cat "$pidf" 2>/dev/null)
  if fd_pinger_running "$old"; then
    fd_log "already claimed: pinger $(fd_pinger_pid "$old") is live, not re-claiming"
    exit 0
  fi
fi

# 3. Identity. Every field is omitted rather than sent empty or guessed.
worker=${FD_WORKER:-}
if [ -z "$worker" ]; then
  mark=${CLAUDE_CONFIG_DIR:-$HOME/.claude}/session-kind/mark.sh
  badge=''
  [ -x "$mark" ] && badge=$("$mark" --show 2>/dev/null)
  case $badge in
    '🔨 WORKER · '*) worker=${badge#'🔨 WORKER · '} ;;
  esac
fi
[ -n "$worker" ] || worker=${ses#FD-}
if ! fd_safe_name "$worker"; then
  fd_log "worker name not whitelist-safe, omitting it"
  worker=''
fi

# role: explicit env, else the slug's line in roles.map ("<slug>\t<role>"), else omitted.
role=${FD_ROLE:-}
if [ -z "$role" ] && [ -r "$FD_DIR/roles.map" ]; then
  slug=$(printf '%s' "$worker" | tr 'A-Z' 'a-z')
  role=$(awk -F'\t' -v a="$slug" -v b="$ses" '$1 == a || $1 == b { print $2; exit }' \
    "$FD_DIR/roles.map" 2>/dev/null)
fi

pid=$(fd_pane_pid)
case $pid in *[!0-9]*) pid='' ;; esac

# The parent edge is optional: an orphan row is legal, a bad edge is a 400. Send it only
# when both halves resolve, the host is one the server accepts, both pass SAFE_NAME, and
# it is not a self-parent.
ph=${FD_PARENT_HOST:-}
pn=${FD_PARENT_NAME:-}
if [ -n "$ph" ] || [ -n "$pn" ]; then
  if [ -z "$ph" ] || [ -z "$pn" ] ||
    ! fd_safe_name "$ph" || ! fd_safe_name "$pn" ||
    { [ "$ph" != german-box ] && [ "$ph" != mac ]; } ||
    { [ "$ph" = "$FD_HOST" ] && [ "$pn" = "$ses" ]; }; then
    fd_log "parent edge rejected locally, claiming as an orphan"
    ph=''
    pn=''
  fi
fi

FD_J_host=$FD_HOST FD_J_name=$ses FD_J_worker=$worker FD_J_role=$role FD_J_pid=$pid
FD_J_parent_host=$ph FD_J_parent_name=$pn
export FD_J_host FD_J_name FD_J_worker FD_J_role FD_J_pid FD_J_parent_host FD_J_parent_name
body=$(fd_json_body host name worker role pid parent_host parent_name)
unset FD_J_host FD_J_name FD_J_worker FD_J_role FD_J_pid FD_J_parent_host FD_J_parent_name
[ -n "$body" ] || { fd_log "claim skipped: could not build the request body"; exit 0; }

# 4. Claim, with two backoff retries. A session that cannot claim still starts normally.
attempt=0
while :; do
  out=$(fd_post /api/lease/claim "$body")
  code=$(printf '%s\n' "$out" | sed -n 1p)
  resp=$(printf '%s\n' "$out" | sed 1d)
  [ "$code" = 200 ] && break
  # A 401 is configuration, not weather: the tailnet listener wants the shared bearer key
  # (CONTRACT S3) and two more identical POSTs will be refused identically. Retrying would
  # only bury the cause under a generic "failed after 3 attempts", so it gets its own exit
  # and its own alert file - with no lease there is no pinger to surface it later.
  if [ "$code" = 401 ]; then
    fd_alert_unauthorized "$ses" "lease claim at session start"
    fd_log "claim REJECTED 401 unauthorized: the tailnet bearer key is missing or wrong (set FD_TAILNET_KEY in $FD_DIR/fleet.env to the server's FLEET_TAILNET_KEY). Not retried, no pinger spawned, alert written to $HOME/launch/fd-alerts/$ses.txt"
    exit 0
  fi
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 3 ]; then
    fd_log "claim failed after 3 attempts (last http $code), no pinger spawned"
    exit 0
  fi
  sleep $((2 * attempt))
done

epoch=$(printf '%s' "$resp" | fd_json epoch)
ttl=$(printf '%s' "$resp" | fd_json ttl_s)
case $epoch in '' | *[!0-9]*) fd_log "claim 200 with no usable epoch, no pinger spawned"; exit 0 ;; esac

# Cadence comes from the server (S2). A session with no heartbeat at all is worse than a
# guessed TTL, so there is a fallback - but it is never silent: it means the server sent a
# malformed 200, and both the log and the lease file say so.
ttl_source=server
case $ttl in
  '' | *[!0-9]*)
    fd_log "WARN claim 200 but ttl_s is missing or non-numeric (got '$ttl'), falling back to 90s - malformed response: $(printf '%s' "$resp" | tr -d '\n' | cut -c1-200)"
    ttl=90
    ttl_source=fallback
    ;;
esac

# 5. Lease file: what the pinger needs to beat, nothing more. FD_PID is in here because the
# mac liveness check (FD_LIVENESS=pid) reads it: a pinger restarted from the lease file alone
# would otherwise have no pid, fail fd_alive unconditionally, and quit on a live session.
printf 'FD_NAME=%s\nFD_HOST=%s\nFD_PID=%s\nFD_EPOCH=%s\nFD_TTL_S=%s\nFD_TTL_SOURCE=%s\nFD_CLAIMED_AT=%s\n' \
  "$ses" "$FD_HOST" "$pid" "$epoch" "$ttl" "$ttl_source" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  >"$state/$ses.lease" 2>/dev/null

# 6. Detached, and it must OUTLIVE the tmux session: audit M8's test is "kill the session,
# leave the pinger running - the row must expire", which proves nothing if the pinger dies
# with the pane. setsid puts it in its own session; nohup alone (macOS) survives the SIGHUP.
[ -n "$pid" ] && export FD_PID="$pid"  # mac liveness reads FD_PID
log=$FD_DIR/log/$ses.log
rm -f "$pidf" 2>/dev/null  # a stale pid here must not satisfy the wait loop below
if command -v setsid >/dev/null 2>&1; then
  setsid nohup "$FD_BIN/fd-pinger.sh" "$ses" </dev/null >>"$log" 2>&1 &
else
  nohup "$FD_BIN/fd-pinger.sh" "$ses" </dev/null >>"$log" 2>&1 &
fi
# The pinger owns the pidfile - it is the single writer, because `$!` here is setsid's pid
# whenever setsid forks. Wait briefly so the next hook invocation sees the guard armed.
n=0
while [ "$n" -lt 15 ]; do
  fd_pinger_running "$(cat "$pidf" 2>/dev/null)" && break
  n=$((n + 1))
  sleep 0.1
done
[ "$n" -lt 15 ] || fd_log "pinger did not report a pid within 1.5s"

fd_log "claimed epoch=$epoch ttl_s=$ttl ($ttl_source) worker=${worker:--} role=${role:--} parent=${ph:--}/${pn:--}"
exit 0
