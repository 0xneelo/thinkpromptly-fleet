#!/bin/sh
# Acceptance harness for the fleet-lifecycle hooks (XYZ-1742 Lane 2, audit M8).
#
#   sh box/hooks/test/run-tests.sh
#
# Runs the real hooks against box/hooks/test/stub-server.js in throwaway tmux sessions,
# with a private FD_DIR and a private HOME. Roughly two minutes: several cases have to
# outlive a lease TTL (6s here) and a suspect window (2xTTL) for real.
set -u

BIN=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
STUB=$BIN/test/stub-server.js

FD_STUB_PORT=${FD_STUB_PORT:-3199}
FD_STUB_TTL_S=6                      # short TTL: the whole point is to watch a lease die
FD_STUB_REAP_TICK_S=1                # the contract default is 30s; tests cannot wait for it
FD_BASE_URL=${FD_BASE_URL:-http://127.0.0.1:$FD_STUB_PORT}
export FD_STUB_PORT FD_STUB_TTL_S FD_STUB_REAP_TICK_S FD_BASE_URL

# --- test-safety interlock ---------------------------------------------------
# This harness kills tmux sessions and forces reaps. It must be structurally impossible to
# aim it at the operator's live deck (100.125.231.25:3131 from the box, localhost:3131 on
# the Mac), so the target must be loopback AND on the stub's own port.
hostport=${FD_BASE_URL#*://}
hostport=${hostport%%/*}
h=${hostport%%:*}
p=${hostport##*:}
if { [ "$h" != 127.0.0.1 ] && [ "$h" != localhost ]; } || [ "$p" != "$FD_STUB_PORT" ]; then
  echo "REFUSING TO RUN: FD_BASE_URL=$FD_BASE_URL is not the local stub." >&2
  echo "It must be http://127.0.0.1:\$FD_STUB_PORT (or localhost). Never the live deck." >&2
  exit 1
fi
[ -f "$STUB" ] || { echo "REFUSING TO RUN: missing $STUB" >&2; exit 1; }

# Without tmux there are no sessions to claim for, and the stub's M5 second liveness sample
# reads "dead" for everything - the pinger_dead case could not fail. A green run would be a
# lie, so stop instead.
command -v tmux >/dev/null 2>&1 || {
  echo "REFUSING TO RUN: tmux is not installed. Every case needs a real tmux session, and" >&2
  echo "the M5 pinger_dead case cannot fail without one. Install tmux and re-run." >&2
  exit 1
}

BASE=$FD_BASE_URL
TTL=$FD_STUB_TTL_S
CAD=$((TTL / 3))

# --- private world -----------------------------------------------------------
TMPROOT=$(mktemp -d) || exit 1
FD_DIR=$TMPROOT/fleet
CFG=$TMPROOT/cfg
RUNNER=$TMPROOT/runner.sh
mkdir -p "$FD_DIR/state" "$FD_DIR/log" "$CFG" "$TMPROOT/launch"
HOME=$TMPROOT              # tombstones/alerts must never land in the real ~/launch
export FD_DIR HOME
printf 'konradtest\tdevops-engineer\n' >"$FD_DIR/roles.map"

SESSIONS=''
STUB_PID=''
STUB2_PID=''                 # case 13 runs a second, killable stub on its own loopback port
FAILED=0
PASSED=0
N=0

cleanup() {
  for s in $SESSIONS; do tmux kill-session -t "=$s" 2>/dev/null; done
  # Any pinger this run spawned is named after an fdtest session.
  pkill -f "fd-pinger.sh fdtest-$$-" 2>/dev/null
  [ -n "$STUB_PID" ] && kill "$STUB_PID" 2>/dev/null
  [ -n "$STUB2_PID" ] && kill "$STUB2_PID" 2>/dev/null
  if [ "$FAILED" -eq 0 ]; then rm -rf "$TMPROOT"; else echo "artifacts kept: $TMPROOT"; fi
}
trap cleanup EXIT INT TERM

ok() { PASSED=$((PASSED + 1)); printf 'PASS  %-34s %s\n' "$1" "${2:-}"; }
bad() { FAILED=$((FAILED + 1)); printf 'FAIL  %-34s %s\n' "$1" "${2:-}"; }
note() { printf '      %s\n' "$1"; }

# --- stub -------------------------------------------------------------------
node "$STUB" >"$TMPROOT/stub.log" 2>&1 &
STUB_PID=$!
i=0
while [ "$i" -lt 50 ]; do
  curl -sS --max-time 2 "$BASE/api/health" >/dev/null 2>&1 && break
  i=$((i + 1))
  sleep 0.2
done
if [ "$i" -ge 50 ]; then
  echo "stub did not come up on $BASE; see $TMPROOT/stub.log" >&2
  exit 1
fi
curl -sS --max-time 5 -X POST "$BASE/_test/reset" >/dev/null 2>&1
echo "stub up on $BASE (ttl_s=$TTL, cadence=${CAD}s), FD_DIR=$FD_DIR"
echo

# --- helpers ----------------------------------------------------------------
tpost() { printf '%s' "${2:-{\}}" | curl -sS --max-time 5 -H 'Content-Type: application/json' \
  --data-binary @- "$BASE$1" 2>/dev/null; }

# field of a row from GET /api/sessions (the contract route)
sess() {
  curl -sS --max-time 5 "$BASE/api/sessions" 2>/dev/null | python3 -c '
import sys, json
d = json.load(sys.stdin)
for r in d.get("sessions", []):
    if r.get("name") == sys.argv[1]:
        v = r.get(sys.argv[2])
        print("" if v is None else v)
        break
' "$1" "$2" 2>/dev/null
}

# field of a row from GET /_test/state (stub-only: adds the beat log). $3 overrides the
# stub base URL - case 13 runs a second stub it is allowed to kill.
st() {
  curl -sS --max-time 5 "${3:-$BASE}/_test/state" 2>/dev/null | python3 -c '
import sys, json
d = json.load(sys.stdin)
for r in d.get("sessions", []):
    if r.get("name") == sys.argv[1]:
        f = sys.argv[2]
        if f == "beat_count":
            print(len(r.get("beats", [])))
        elif f == "beat_gaps":
            b = r.get("beats", [])
            print(" ".join(str(b[i + 1] - b[i]) for i in range(len(b) - 1)))
        else:
            v = r.get(f)
            print("" if v is None else v)
        break
' "$1" "$2" 2>/dev/null
}

wait_state() { # <ses> <want> <timeout_s> [base]
  _wt=0                                  # functions share scope: keep counters private
  while [ "$_wt" -lt "$3" ]; do
    [ "$(st "$1" lease_state "${4:-$BASE}")" = "$2" ] && return 0
    sleep 1
    _wt=$((_wt + 1))
  done
  return 1
}

wait_active() { wait_state "$1" active "${2:-15}" "${3:-$BASE}"; }

# The pidfile holds "pid<TAB>starttime" (pid-reuse proof), so take field 1 for a kill.
pinger_pid() { cut -f1 "$FD_DIR/state/$1.pinger.pid" 2>/dev/null; }
pinger_count() { pgrep -f "fd-pinger.sh $1" 2>/dev/null | wc -l | tr -dc 0-9; }
pinger_live() { [ "$(pinger_count "$1")" -ge 1 ]; }

# A throwaway tmux session that runs the real hook in-pane. Named fdtest-<pid>-<n>, never
# FD-*, so a test can never collide with (or be mistaken for) a live fleet session.
# Sets $SES rather than printing it: a command substitution would run this in a subshell
# and lose the $N counter, silently reusing one session name for every test.
new_session() { # <key=val>... ; sets SES
  N=$((N + 1))
  SES=fdtest-$$-$N
  : >"$CFG/$SES.env"
  for kv in "$@"; do printf 'export %s\n' "$kv" >>"$CFG/$SES.env"; done
  if ! tmux new-session -d -s "$SES" "$RUNNER" 2>/dev/null; then SES=''; return 1; fi
  SESSIONS="$SESSIONS $SES"
  return 0
}

# The in-pane runner: what a real SessionStart hook does. Every env value is baked in
# rather than inherited, because a pre-existing tmux server's panes do not reliably
# inherit the client environment - and HOME in particular must not be the real one.
cat >"$RUNNER" <<EOF
#!/bin/sh
export FD_DIR=$FD_DIR HOME=$TMPROOT FD_BASE_URL=$BASE
export FD_HOST=german-box FD_LIVENESS=tmux FD_CURL_TIMEOUT=5
ses=\$(tmux display-message -p '#S')
[ -r "$CFG/\$ses.env" ] && . "$CFG/\$ses.env"
if [ "\${RACE:-0}" = 1 ]; then
  # Two claims as simultaneous as a shell allows: both children spin on a gate file that
  # appears only once both are already spinning, so they enter the guard together rather
  # than one arming it for the other.
  gate=$CFG/\$ses.gate
  ( while [ ! -e "\$gate" ]; do :; done; exec "$BIN/lease-claim.sh" ) &
  ( while [ ! -e "\$gate" ]; do :; done; exec "$BIN/lease-claim.sh" ) &
  sleep 0.3
  : >"\$gate"
  wait
else
  "$BIN/lease-claim.sh"
  if [ "\${CLAIMS:-1}" -gt 1 ]; then sleep 1; "$BIN/lease-claim.sh"; fi
fi
exec sleep 900
EOF
chmod +x "$RUNNER"

# --- 1. claim shape ----------------------------------------------------------
new_session FD_WORKER=konradtest FD_PARENT_HOST=german-box FD_PARENT_NAME=fdtest-parent; s1=$SES
if [ -z "$s1" ] || ! wait_active "$s1"; then
  bad "1 claim shape" "row never went active (state=$(st "$s1" lease_state))"
else
  w=$(sess "$s1" worker); r=$(sess "$s1" role); pd=$(sess "$s1" pid)
  ph=$(sess "$s1" parent_host); pn=$(sess "$s1" parent_name)
  ep=$(sess "$s1" epoch); ls=$(sess "$s1" lease_state)
  evid="worker=$w role=$r pid=$pd parent=$ph/$pn epoch=$ep state=$ls"
  if [ "$w" = konradtest ] && [ "$r" = devops-engineer ] && [ -n "$pd" ] &&
    [ "$ph" = german-box ] && [ "$pn" = fdtest-parent ] && [ "$ep" = 1 ] && [ "$ls" = active ]; then
    ok "1 claim shape" "$evid"
  else
    bad "1 claim shape" "$evid"
  fi
fi

# --- 2. parent edge omitted, not faked ---------------------------------------
# No parent at all, and a half-configured parent: both must claim as legal orphans rather
# than invent an edge (a bad edge is a 400 from the real server).
new_session FD_WORKER=orphantest; s2=$SES
new_session FD_WORKER=halfparent FD_PARENT_HOST=german-box; s2b=$SES
if wait_active "$s2" && wait_active "$s2b"; then
  a="$(sess "$s2" parent_host)/$(sess "$s2" parent_name)"
  b="$(sess "$s2b" parent_host)/$(sess "$s2b" parent_name)"
  if [ "$a" = / ] && [ "$b" = / ] && [ "$(sess "$s2" epoch)" = 1 ] && [ "$(sess "$s2b" epoch)" = 1 ]; then
    ok "2 parent omitted not faked" "both rows parent=null, both claimed 200 (epoch=1)"
  else
    bad "2 parent omitted not faked" "no-parent=$a half-parent=$b"
  fi
else
  bad "2 parent omitted not faked" "claim did not return 200 (orphan claim must succeed)"
fi

# --- 4. busy session stays active (run before 3: it generates the beat log) ---
# Scaled-down stand-in for the acceptance test "survives a 10-minute busy Bash call": the
# pane holds a long sleep for > 2xTTL (the full suspect window) while the DETACHED pinger
# beats. A hook-driven heartbeat would go suspect here; this must not.
busy=$((TTL * 2 + 2))
worst=active
k=0
while [ "$k" -lt "$busy" ]; do
  cur=$(st "$s1" lease_state)
  [ "$cur" = active ] || worst=$cur
  sleep 2
  k=$((k + 2))
done
if [ "$worst" = active ]; then
  ok "4 busy session stays active" "${busy}s (> 2xTTL=$((TTL * 2))s) with no state change"
else
  bad "4 busy session stays active" "observed lease_state=$worst"
fi

# --- 3. cadence derived from ttl_s -------------------------------------------
gaps=$(st "$s1" beat_gaps)
if [ -z "$gaps" ]; then
  bad "3 cadence derived" "no beat gaps recorded"
else
  verdict=$(printf '%s' "$gaps" | python3 -c '
import sys
g = [int(x) for x in sys.stdin.read().split()]
want = '"$CAD"' * 1000
bad = [x for x in g if abs(x - want) > 900]        # +-0.9s: one curl round trip of slack
print(("ok" if not bad else "off"), len(g), min(g), max(g), want)
' 2>/dev/null)
  set -- $verdict
  if [ "${1:-off}" = ok ] && [ "${5:-0}" -lt 10000 ]; then
    ok "3 cadence derived" "$2 beats, gaps ${3}-${4}ms, want ${5}ms (ttl_s/3), not 30000ms"
  else
    bad "3 cadence derived" "gaps=$gaps want=$((CAD * 1000))ms"
  fi
fi

# --- 5. session killed -> pinger exits, row expires --------------------------
pp=$(pinger_pid "$s1")
tmux kill-session -t "=$s1" 2>/dev/null
k=0
while [ "$k" -lt 10 ] && kill -0 "$pp" 2>/dev/null; do sleep 1; k=$((k + 1)); done
gone=no
kill -0 "$pp" 2>/dev/null || gone=yes
if wait_state "$s1" reaped 60; then
  if [ "$gone" = yes ] && [ ! -f "$FD_DIR/state/$s1.pinger.pid" ]; then
    ok "5 killed session expires" "pinger $pp exited in ${k}s, pidfile gone, row reaped"
  else
    bad "5 killed session expires" "row reaped but pinger_gone=$gone pidfile still present"
  fi
else
  bad "5 killed session expires" "state=$(st "$s1" lease_state) after 60s (pinger_gone=$gone)"
fi

# --- 6. pinger killed, session alive -> pinger_dead, not reaped (M5) ---------
new_session FD_WORKER=m5test; s6=$SES
if wait_active "$s6"; then
  kill -9 "$(pinger_pid "$s6")" 2>/dev/null
  if wait_state "$s6" pinger_dead 60; then
    ok "6 pinger dead not reaped" "tmux session still live, lease_state=pinger_dead"
  else
    bad "6 pinger dead not reaped" "state=$(st "$s6" lease_state) after 60s"
  fi
else
  bad "6 pinger dead not reaped" "session never went active"
fi

# --- 7. 410 -> tombstone, stop -----------------------------------------------
new_session FD_WORKER=tombtest; s7=$SES
if wait_active "$s7"; then
  tpost /_test/reap "{\"host\":\"german-box\",\"name\":\"$s7\"}" >/dev/null
  tomb=$HOME/launch/tombstones/$s7.txt
  k=0
  while [ "$k" -lt 15 ] && [ ! -f "$tomb" ]; do sleep 1; k=$((k + 1)); done
  if [ -f "$tomb" ] && ! pinger_live "$s7"; then
    ok "7 410 tombstone" "$tomb after ${k}s, pinger exited"
  else
    bad "7 410 tombstone" "tombstone=$([ -f "$tomb" ] && echo yes || echo no) pingers=$(pinger_count "$s7")"
  fi
else
  bad "7 410 tombstone" "session never went active"
fi

# --- 8. 409 -> stop, never re-claim ------------------------------------------
new_session FD_WORKER=fencetest; s8=$SES
if wait_active "$s8"; then
  # A second identity claims the same (host,name) and fences epoch 1.
  tpost /api/lease/claim "{\"host\":\"german-box\",\"name\":\"$s8\",\"worker\":\"newcomer\"}" >/dev/null
  ep_after=$(st "$s8" epoch)
  alert=$HOME/launch/fd-alerts/$s8.txt
  k=0
  while [ "$k" -lt 15 ] && [ ! -f "$alert" ]; do sleep 1; k=$((k + 1)); done
  sleep $((CAD * 3))                     # a re-claiming pinger would bump the epoch here
  ep_final=$(st "$s8" epoch)
  if [ -f "$alert" ] && ! pinger_live "$s8" && [ "$ep_final" = "$ep_after" ]; then
    ok "8 409 stops, no re-claim" "alert after ${k}s, pinger exited, epoch stayed $ep_final"
  else
    bad "8 409 stops, no re-claim" "alert=$([ -f "$alert" ] && echo yes || echo no) pingers=$(pinger_count "$s8") epoch $ep_after->$ep_final"
  fi
else
  bad "8 409 stops, no re-claim" "session never went active"
fi

# --- 9. transient failures keep the beat going -------------------------------
new_session FD_WORKER=flakytest; s9=$SES
if wait_active "$s9"; then
  tpost /_test/mode '{"mode":"down"}' >/dev/null
  sleep $((CAD * 4))                     # > 3 cadences of 503s
  survived=$(pinger_count "$s9")
  before=$(st "$s9" beat_count)
  tpost /_test/mode '{"mode":"normal"}' >/dev/null
  sleep $((CAD * 3))
  after=$(st "$s9" beat_count)
  if [ "$survived" -ge 1 ] && [ "${after:-0}" -gt "${before:-0}" ]; then
    ok "9 transient keeps beating" "survived $((CAD * 4))s of 503, beats $before->$after after recovery"
  else
    bad "9 transient keeps beating" "pingers=$survived beats $before->$after"
  fi
else
  bad "9 transient keeps beating" "session never went active"
fi

# --- 10. idempotent claim -----------------------------------------------------
new_session FD_WORKER=idemtest CLAIMS=2; s10=$SES
if wait_active "$s10"; then
  sleep 2                                # let the second lease-claim.sh finish
  c=$(pinger_count "$s10")
  ep=$(st "$s10" epoch)
  if [ "$c" = 1 ] && [ "$ep" = 1 ]; then
    ok "10 idempotent claim" "2 hook runs -> 1 pinger, epoch bumped once (=1)"
  else
    bad "10 idempotent claim" "pingers=$c epoch=$ep (want 1 and 1)"
  fi
else
  bad "10 idempotent claim" "session never went active"
fi

# --- 12. simultaneous claims: the guard must be atomic, not just fast ---------
# Case 10 sleeps 1s between the two hook runs, which is long enough for the pinger to arm
# the guard - it passes even with no locking at all. This one fires both invocations off a
# shared gate, so they land inside the guard together. A check-then-act guard loses here:
# both see no pidfile, both claim, epoch reaches 2 and the first pinger is fenced by its own
# session. Repeated, because a race that only sometimes loses is still a defect.
races=5
race_i=0
race_bad=''
while [ "$race_i" -lt "$races" ]; do
  race_i=$((race_i + 1))
  new_session FD_WORKER=racetest RACE=1; sr=$SES
  if [ -z "$sr" ] || ! wait_active "$sr"; then
    race_bad="iteration $race_i: row never went active (state=$(st "$sr" lease_state))"
    break
  fi
  sleep 2                                # both invocations are done (the gate opens at 0.3s)
  rc=$(pinger_count "$sr"); rep=$(st "$sr" epoch)
  if [ "$rc" != 1 ] || [ "$rep" != 1 ]; then
    race_bad="iteration $race_i: pingers=$rc epoch=$rep (want 1 and 1)"
    break
  fi
  tmux kill-session -t "=$sr" 2>/dev/null
done
if [ -z "$race_bad" ]; then
  ok "12 simultaneous claims" "$races races: 1 pinger, epoch bumped exactly once each time"
else
  bad "12 simultaneous claims" "$race_bad"
fi

# --- 13. connection refused (the real 000 path) ------------------------------
# Case 9 only drives mode=down, which is a genuine HTTP 503. The branch that fires when the
# deck is restarted is fd_post's 000 (nothing listening), and it must be just as survivable.
# A second stub, on its own port, is used because this case has to KILL the server: the
# harness interlock still guards the main URL, and this one is loopback-only too.
PORT2=$((FD_STUB_PORT + 1))
BASE2=http://127.0.0.1:$PORT2
if [ "$PORT2" = 3131 ]; then
  bad "13 connection refused" "refusing: port $PORT2 is the live deck's port"
else
  start_stub2() {
    FD_STUB_PORT=$PORT2 node "$STUB" >>"$TMPROOT/stub2.log" 2>&1 &
    STUB2_PID=$!
    _i=0
    while [ "$_i" -lt 50 ]; do
      curl -sS --max-time 2 "$BASE2/api/health" >/dev/null 2>&1 && return 0
      _i=$((_i + 1))
      sleep 0.2
    done
    return 1
  }
  STUB2_PID=''
  if ! start_stub2; then
    bad "13 connection refused" "second stub did not come up on $BASE2"
  else
    new_session FD_WORKER=refusedtest FD_BASE_URL=$BASE2; s13=$SES
    if ! wait_active "$s13" 15 "$BASE2"; then
      bad "13 connection refused" "session never went active against $BASE2"
    else
      kill "$STUB2_PID" 2>/dev/null; wait "$STUB2_PID" 2>/dev/null
      STUB2_PID=''
      sleep $((CAD * 4))                 # several cadences with nothing listening at all
      survived13=$(pinger_count "$s13")
      saw000=no
      grep -q 'transient http 000' "$FD_DIR/log/$s13.log" 2>/dev/null && saw000=yes
      # Recovery: a restarted deck is an empty stub, so re-seed the row. A fresh stub starts
      # at epoch 0, so this claim lands on epoch 1 - the epoch the pinger still holds.
      rec_ok=no
      if start_stub2; then
        curl -sS --max-time 5 -H 'Content-Type: application/json' \
          --data-binary "{\"host\":\"german-box\",\"name\":\"$s13\"}" \
          "$BASE2/api/lease/claim" >/dev/null 2>&1
        k=0
        while [ "$k" -lt 15 ]; do
          [ "$(st "$s13" beat_count "$BASE2")" -ge 1 ] 2>/dev/null && { rec_ok=yes; break; }
          sleep 1; k=$((k + 1))
        done
      fi
      if [ "$survived13" -ge 1 ] && [ "$saw000" = yes ] && [ "$rec_ok" = yes ]; then
        ok "13 connection refused" "survived $((CAD * 4))s of 000 (logged), resumed beating in ${k}s"
      else
        bad "13 connection refused" "pingers=$survived13 logged_000=$saw000 recovered=$rec_ok"
      fi
      tmux kill-session -t "=$s13" 2>/dev/null
    fi
    [ -n "$STUB2_PID" ] && kill "$STUB2_PID" 2>/dev/null
    STUB2_PID=''
  fi
fi

# --- 11. hygiene scan ---------------------------------------------------------
# Static, and deliberately narrow about what it claims to prove:
#  a) no remote execution at all, in command position (nothing writes the Mac from the box)
#  b) zero-quote rule: on a tmux/ssh command that interpolates a value (continuations
#     joined first), no escaped/embedded quote character - values are whitelist-validated
#     by fd_safe_name, never escaped
#  c) no token-ish literals
hits=$TMPROOT/hygiene.txt
: >"$hits"
for f in fd-common.sh lease-claim.sh fd-pinger.sh deregister.sh; do
  src=$BIN/$f
  sed -e :a -e '/\\$/N; s/\\\n//; ta' "$src" >"$TMPROOT/joined.sh"
  grep -nE '(^|[;&|(]|\$\()[[:space:]]*(ssh|scp|sftp|rsync)[[:space:]]' "$TMPROOT/joined.sh" |
    sed "s|^|$f a-remote-exec: |" >>"$hits"
  grep -nE '(tmux|ssh)[^#]*\$' "$TMPROOT/joined.sh" |
    grep -E '\\"|\\'"'"'|'"'"'\\'"'"'\\'"'"'' |
    sed "s|^|$f b-quote-in-arg: |" >>"$hits"
  grep -nE 'ghp_|github_pat_|Bearer |password|secret=' "$TMPROOT/joined.sh" |
    sed "s|^|$f c-secret: |" >>"$hits"
done
if [ -s "$hits" ]; then
  bad "11 hygiene scan" "$(wc -l <"$hits" | tr -dc 0-9) hit(s)"
  while IFS= read -r l; do note "$l"; done <"$hits"
else
  ok "11 hygiene scan" "4 scripts: no ssh/scp, no quoted interpolation, no token literals"
fi

echo
echo "passed=$PASSED failed=$FAILED"
[ "$FAILED" -eq 0 ]
