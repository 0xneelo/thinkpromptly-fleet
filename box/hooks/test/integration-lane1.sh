#!/bin/sh
# integration-lane1.sh - the Lane 2 hooks against Lane 1's REAL server (XYZ-1742 milestone E).
#
#   sh box/hooks/test/integration-lane1.sh
#
# run-tests.sh proves the hooks against box/hooks/test/stub-server.js, which is a mock written
# from the same contract by the same lane - so a green run there cannot catch a place where
# Lane 1 and Lane 2 read the contract differently. This one runs them against Edith's actual
# server.js, taken straight out of her branch, on a disposable database.
#
# What it starts, it starts here and kills here. Two safety rules make that structural:
#   1. The target must be LOOPBACK (127.x) on this script's own port. The operator's deck is
#      100.125.231.25:3131 from the box and localhost:3131 on the Mac; both are refused.
#   2. FLEET_SSH_BIN is forced to a binary that always fails, so the reaper this script drives
#      cannot ssh anywhere. Nothing on any real host is polled, warned, killed or name-closed.
# The database is a fresh file under a mktemp dir and the hosts file is written here, so no
# real fleet.db and no real hosts.json is ever opened.
set -u

BIN=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
REPO=$(CDPATH= cd -- "$BIN/../.." && pwd)

BRANCH=${FD_INTG_BRANCH:-agent-edith}       # the landed Lane 1 branch, read-only, via git show
PORT=${FD_INTG_PORT:-3198}                  # instance 1: loopback, unkeyed
PORT2=$((PORT + 1))                         # instance 2: the tailnet listener, key armed
KEYADDR=127.0.0.2                           # a second loopback address for instance 2's
                                            # tailnet listener - the tailnet gate is bound to
                                            # its own address, so it can be exercised without
                                            # the Mac's tailscale IP, which this box does not
                                            # own (bind of 100.125.231.25 gives EADDRNOTAVAIL)
BASE=http://127.0.0.1:$PORT
BASE2=http://$KEYADDR:$PORT2
# GET /api/sessions is loopback-only by contract, and the tailnet listener does not serve it
# (M11, S3) - so instance 2 is WRITTEN through the gated tailnet address and READ through its
# own loopback address. That split is the contract, not a workaround.
BASE2R=http://127.0.0.1:$PORT2

# Lane 1's own knobs (server.js:24-34), used rather than invented: the contract's 90s TTL and
# 180s suspect window would make one reap scenario take six minutes.
TTL=5
WINDOW=5
TICK=1
CAD=$((TTL / 3))
[ "$CAD" -ge 1 ] || CAD=1

# --- test-safety interlock ---------------------------------------------------
for u in "$BASE" "$BASE2"; do
  hp=${u#*://}; hp=${hp%%/*}; h=${hp%%:*}; p=${hp##*:}
  case $h in
    127.*) : ;;
    localhost) : ;;
    *) echo "REFUSING TO RUN: $u is not loopback. Never the operator's deck." >&2; exit 1 ;;
  esac
  if [ "$p" = 3131 ]; then
    echo "REFUSING TO RUN: port 3131 is the live deck's port." >&2
    exit 1
  fi
done
command -v tmux >/dev/null 2>&1 || { echo "REFUSING TO RUN: tmux is missing." >&2; exit 1; }
command -v node >/dev/null 2>&1 || { echo "REFUSING TO RUN: node is missing." >&2; exit 1; }
git -C "$REPO" rev-parse --verify "$BRANCH" >/dev/null 2>&1 || {
  echo "REFUSING TO RUN: branch $BRANCH does not exist here - Lane 1 has not landed." >&2
  exit 1
}

# --- private world -----------------------------------------------------------
TMPROOT=$(mktemp -d) || exit 1
W=$TMPROOT/srv
FD_DIR=$TMPROOT/fleet
CFG=$TMPROOT/cfg
RUNNER=$TMPROOT/runner.sh
mkdir -p "$W" "$FD_DIR/state" "$FD_DIR/log" "$CFG" "$TMPROOT/launch"
HOME=$TMPROOT                    # tombstones and alerts must never land in the real ~/launch
export FD_DIR HOME

SESSIONS=''
SRV_PID=''
SRV2_PID=''
MACPID=''                        # the process a mac-host row's liveness check watches
FAILED=0
PASSED=0
N=0

cleanup() {
  for s in $SESSIONS; do tmux kill-session -t "=$s" 2>/dev/null; done
  pkill -f "fd-pinger.sh intg-$$-" 2>/dev/null
  [ -n "$MACPID" ] && kill "$MACPID" 2>/dev/null
  [ -n "$SRV_PID" ] && kill "$SRV_PID" 2>/dev/null
  [ -n "$SRV2_PID" ] && kill "$SRV2_PID" 2>/dev/null
  if [ "$FAILED" -eq 0 ]; then rm -rf "$TMPROOT"; else echo "artifacts kept: $TMPROOT"; fi
}
trap cleanup EXIT INT TERM

ok() { PASSED=$((PASSED + 1)); printf 'PASS  %-32s %s\n' "$1" "${2:-}"; }
bad() { FAILED=$((FAILED + 1)); printf 'FAIL  %-32s %s\n' "$1" "${2:-}"; }
note() { printf '      %s\n' "$1"; }
skip() { printf 'SKIP  %-32s %s\n' "$1" "${2:-}"; }

# --- Lane 1's server, from her branch, never edited --------------------------
git -C "$REPO" show "$BRANCH:server.js" >"$W/server.js" || exit 1
git -C "$REPO" show "$BRANCH:package.json" >"$W/package.json" 2>/dev/null || :
printf '%s\n' '["german-box"]' >"$W/hosts.json"

# ws and node-pty are required at the top of server.js, so they have to be resolvable even
# though no test here opens a websocket or a pty. The cache is reused between runs: a fresh
# npm install per run would dominate the runtime.
CACHE=${FD_INTG_CACHE:-${TMPDIR:-/tmp}/fd-intg-deps}
if [ ! -d "$CACHE/node_modules/ws" ] || [ ! -d "$CACHE/node_modules/node-pty" ]; then
  echo "installing ws + node-pty into $CACHE (once; set FD_INTG_CACHE to move it)"
  mkdir -p "$CACHE" || exit 1
  (cd "$CACHE" && npm install ws node-pty --no-save --no-audit --no-fund) >"$TMPROOT/npm.log" 2>&1 || {
    echo "npm install failed; see $TMPROOT/npm.log" >&2
    FAILED=1
    exit 1
  }
fi
ln -s "$CACHE/node_modules" "$W/node_modules" || exit 1

# The one place the safety rules are actually enforced, so they are set together and never
# individually: no ssh binary that can reach a host, no Name pool, a throwaway db.
start_server() { # $1=port $2..=extra env assignments, exported by the caller
  PORT=$1 \
  FLEET_DB=$W/fleet$1.db \
  FLEET_HOSTS_FILE=$W/hosts.json \
  FLEET_TTL_S=$TTL FLEET_SUSPECT_WINDOW_S=$WINDOW FLEET_REAPER_TICK_S=$TICK \
  FLEET_SSH_BIN=/bin/false \
  node "$W/server.js" >>"$TMPROOT/server$1.log" 2>&1 &
}

wait_up() { # $1=base url
  _i=0
  while [ "$_i" -lt 60 ]; do
    curl -sS --max-time 2 "$1/api/health" >/dev/null 2>&1 && return 0
    _i=$((_i + 1))
    sleep 0.25
  done
  return 1
}

start_server "$PORT"
SRV_PID=$!
if ! wait_up "$BASE"; then
  echo "server did not come up on $BASE; see $TMPROOT/server$PORT.log" >&2
  cat "$TMPROOT/server$PORT.log" >&2
  FAILED=1
  exit 1
fi
echo "Lane 1 server ($BRANCH) up on $BASE - $(grep -m1 '^lifecycle:' "$TMPROOT/server$PORT.log")"
echo "FD_DIR=$FD_DIR  db=$W/fleet$PORT.db  ssh=/bin/false"
echo

# --- helpers ----------------------------------------------------------------
# POST a raw body and print "<http_code>\n<body>", the same shape fd_post returns.
post() { # $1=path $2=json $3=base
  printf '%s' "$2" | curl -sS --max-time 5 -H 'Content-Type: application/json' \
    --data-binary @- -w '\n%{http_code}' "${3:-$BASE}$1" 2>/dev/null
}
code_of() { printf '%s\n' "$1" | tail -1; }
body_of() { printf '%s\n' "$1" | sed '$d'; }

# One field of one row from the contract route GET /api/sessions.
sess() { # $1=name $2=field $3=base
  curl -sS --max-time 5 "${3:-$BASE}/api/sessions" 2>/dev/null | python3 -c '
import sys, json
d = json.load(sys.stdin)
for r in d.get("sessions", []):
    if r.get("name") == sys.argv[1]:
        v = r.get(sys.argv[2])
        print("" if v is None else v)
        break
' "$1" "$2" 2>/dev/null
}

wait_field() { # $1=name $2=field $3=want $4=timeout_s $5=base
  _wt=0
  while [ "$_wt" -lt "$4" ]; do
    [ "$(sess "$1" "$2" "${5:-$BASE}")" = "$3" ] && return 0
    sleep 1
    _wt=$((_wt + 1))
  done
  return 1
}

pinger_pid() { cut -f1 "$FD_DIR/state/$1.pinger.pid" 2>/dev/null; }
pinger_count() { pgrep -f "fd-pinger.sh $1" 2>/dev/null | wc -l | tr -dc 0-9; }

# A throwaway tmux session running the real hook in-pane, exactly as run-tests.sh does it.
# Named intg-<pid>-<n>: never FD-*, so it can never be confused with a live fleet session.
new_session() { # <key=val>... ; sets SES
  N=$((N + 1))
  SES=intg-$$-$N
  : >"$CFG/$SES.env"
  for kv in "$@"; do printf 'export %s\n' "$kv" >>"$CFG/$SES.env"; done
  if ! tmux new-session -d -s "$SES" "$RUNNER" 2>/dev/null; then SES=''; return 1; fi
  SESSIONS="$SESSIONS $SES"
  return 0
}

cat >"$RUNNER" <<EOF
#!/bin/sh
export FD_DIR=$FD_DIR HOME=$TMPROOT FD_BASE_URL=$BASE
export FD_HOST=german-box FD_LIVENESS=tmux FD_CURL_TIMEOUT=5
ses=\$(tmux display-message -p '#S')
[ -r "$CFG/\$ses.env" ] && . "$CFG/\$ses.env"
"$BIN/lease-claim.sh"
exec sleep 900
EOF
chmod +x "$RUNNER"

# --- 1. claim shape: epoch, ttl_s, and her extra ok:true ---------------------
new_session FD_WORKER=konradintg FD_ROLE=devops-engineer \
  FD_PARENT_HOST=mac FD_PARENT_NAME=orchestrator; s1=$SES
if [ -z "$s1" ] || ! wait_field "$s1" lease_state active 20; then
  bad "1 claim against real server" "row never went active"
else
  lease=$FD_DIR/state/$s1.lease
  ep=$(sed -n 's/^FD_EPOCH=//p' "$lease" 2>/dev/null)
  tl=$(sed -n 's/^FD_TTL_S=//p' "$lease" 2>/dev/null)
  src=$(sed -n 's/^FD_TTL_SOURCE=//p' "$lease" 2>/dev/null)
  # Her 200 body is {ok:true, epoch, expires_at, ttl_s} - one key more than the contract
  # spells out. The parser reads named keys, so the extra one must change nothing.
  if [ "$ep" = 1 ] && [ "$tl" = "$TTL" ] && [ "$src" = server ]; then
    ok "1 claim against real server" "epoch=$ep ttl_s=$tl from the server (ok:true ignored, not fallback)"
  else
    bad "1 claim against real server" "lease file says epoch=$ep ttl_s=$tl source=$src (want 1/$TTL/server)"
  fi
fi

# --- 2. the row carries every field we sent ----------------------------------
if [ -n "$s1" ]; then
  w=$(sess "$s1" worker); r=$(sess "$s1" role); pd=$(sess "$s1" pid)
  ph=$(sess "$s1" parent_host); pn=$(sess "$s1" parent_name)
  ep=$(sess "$s1" epoch); ls=$(sess "$s1" lease_state)
  evid="worker=$w role=$r pid=$pd parent=$ph/$pn epoch=$ep lease_state=$ls"
  if [ "$w" = konradintg ] && [ "$r" = devops-engineer ] && [ -n "$pd" ] &&
    [ "$ph" = mac ] && [ "$pn" = orchestrator ] && [ "$ep" = 1 ] && [ "$ls" = active ]; then
    ok "2 GET /api/sessions row" "$evid"
  else
    bad "2 GET /api/sessions row" "$evid"
  fi
fi

# --- 3. heartbeats renew, at ttl_s/3 ------------------------------------------
# expires_at is her renewal receipt: it moves forward on every accepted beat. Two samples one
# cadence apart prove both the renewal and the cadence we derived from her ttl_s.
if [ -n "$s1" ]; then
  e1=$(sess "$s1" expires_at)
  sleep $((CAD + 2))
  e2=$(sess "$s1" expires_at)
  st1=$(sess "$s1" lease_state)
  moved=$((${e2:-0} - ${e1:-0}))
  if [ "$moved" -gt 0 ] && [ "$st1" = active ] && [ "$moved" -le $((TTL * 1000)) ]; then
    ok "3 heartbeat renews" "expires_at advanced ${moved}ms in $((CAD + 2))s at cadence ${CAD}s (ttl_s/3), still active"
  else
    bad "3 heartbeat renews" "expires_at $e1 -> $e2 (delta ${moved}ms), lease_state=$st1"
  fi
fi

# --- 4. a real re-claim fences the running pinger (409) -----------------------
if [ -n "$s1" ]; then
  out=$(post /api/lease/claim "{\"host\":\"german-box\",\"name\":\"$s1\",\"worker\":\"newcomer\"}")
  c=$(code_of "$out")
  ep2=$(sess "$s1" epoch)
  alert=$HOME/launch/fd-alerts/$s1.txt
  k=0
  while [ "$k" -lt 20 ] && [ ! -f "$alert" ]; do sleep 1; k=$((k + 1)); done
  sleep $((CAD * 2))                      # a pinger that re-claimed would bump the epoch here
  ep3=$(sess "$s1" epoch)
  if [ "$c" = 200 ] && [ "$ep2" = 2 ] && [ -f "$alert" ] &&
    [ "$(pinger_count "$s1")" = 0 ] && [ "$ep3" = "$ep2" ]; then
    ok "4 real 409 fences the pinger" "re-claim -> epoch $ep2, pinger got 409 in ${k}s, stopped, epoch stayed $ep3"
  else
    bad "4 real 409 fences the pinger" "reclaim_code=$c epoch=$ep2->$ep3 alert=$([ -f "$alert" ] && echo yes || echo no) pingers=$(pinger_count "$s1")"
  fi
  grep -q 'pinger: 409 fenced' "$FD_DIR/log/$s1.log" 2>/dev/null ||
    note "note: no '409 fenced' line in $FD_DIR/log/$s1.log"
  tmux kill-session -t "=$s1" 2>/dev/null
fi

# --- 5. a real reap answers 410 and we write the tombstone -------------------
# The real server has no /_test/reap. A reap needs: lease expired -> suspect -> warn delivered
# -> one suspect window -> reaped. On a german-box row the warn and the kill both go over ssh,
# which is /bin/false here, so that row can only ever reach 'suspect'. A host='mac' row takes
# the same reaper path with no ssh at all (warnSuspect returns ok for mac, killReaped refuses
# to touch it - M4), so that is the row this drives. The 410 the pinger then reads is the same
# code path for both hosts: heartbeat() answers 410 on lease_state='reaped', whatever the host.
# The pinger is SIGSTOPped while the row dies, which is exactly the case the 410 exists for -
# a session that was suspended and comes back after the server gave up on it.
sleep 900 &
MACPID=$!
s5=intg-$$-mac
(
  FD_DIR=$FD_DIR HOME=$TMPROOT FD_BASE_URL=$BASE FD_HOST=mac FD_NAME=$s5 \
    FD_LIVENESS=pid FD_PID=$MACPID FD_CURL_TIMEOUT=5 TMUX= \
    sh "$BIN/lease-claim.sh"
) >/dev/null 2>&1
if ! wait_field "$s5" lease_state active 20; then
  bad "5 real 410 writes a tombstone" "mac row never went active (state=$(sess "$s5" lease_state))"
else
  pp5=$(pinger_pid "$s5")
  kill -STOP "$pp5" 2>/dev/null
  if ! wait_field "$s5" lease_state reaped 90; then
    bad "5 real 410 writes a tombstone" "row never reached reaped in 90s (state=$(sess "$s5" lease_state)); see $TMPROOT/server$PORT.log"
    kill -CONT "$pp5" 2>/dev/null
  else
    kill -CONT "$pp5" 2>/dev/null
    tomb=$HOME/launch/tombstones/$s5.txt
    k=0
    while [ "$k" -lt 20 ] && [ ! -f "$tomb" ]; do sleep 1; k=$((k + 1)); done
    if [ -f "$tomb" ] && [ "$(pinger_count "$s5")" = 0 ]; then
      ok "5 real 410 writes a tombstone" "reaped by her reaper, pinger read the 410 in ${k}s and stopped: $(sed -n 's/^reason: *//p' "$tomb")"
    else
      bad "5 real 410 writes a tombstone" "tombstone=$([ -f "$tomb" ] && echo yes || echo no) pingers=$(pinger_count "$s5")"
    fi
  fi
fi
kill "$MACPID" 2>/dev/null
MACPID=''

# --- 6. her parent validation matches what our omit-don't-fake logic assumes --
# Every one of these is a body our hook refuses to send. This asserts the refusal is right:
# each is a 400 from her, so faking an edge would cost the session its whole claim.
p_fail=''
for c in \
  'unknown_host:{"host":"german-box","name":"intgparent","parent_host":"nosuchhost","parent_name":"x"}' \
  'self_parent:{"host":"german-box","name":"intgparent","parent_host":"german-box","parent_name":"intgparent"}' \
  'bad_charset:{"host":"german-box","name":"intgparent","parent_host":"mac","parent_name":"has spaces"}' \
  'half_edge:{"host":"german-box","name":"intgparent","parent_host":"mac"}' \
  'bad_worker:{"host":"german-box","name":"intgparent","worker":"has spaces"}'; do
  lbl=${c%%:*}
  bdy=${c#*:}
  out=$(post /api/lease/claim "$bdy")
  cc=$(code_of "$out")
  [ "$cc" = 400 ] || p_fail="$p_fail $lbl=$cc"
  note "$lbl -> $cc $(body_of "$out" | cut -c1-90)"
done
# ...and the legal shapes our hook does send: a full edge, and no edge at all.
out=$(post /api/lease/claim '{"host":"german-box","name":"intgparent","parent_host":"mac","parent_name":"orchestrator"}')
[ "$(code_of "$out")" = 200 ] || p_fail="$p_fail good_edge=$(code_of "$out")"
out=$(post /api/lease/claim '{"host":"german-box","name":"intgorphan"}')
[ "$(code_of "$out")" = 200 ] || p_fail="$p_fail orphan=$(code_of "$out")"
if [ -z "$p_fail" ]; then
  ok "6 parent validation" "5 malformed edges -> 400, full edge and orphan -> 200"
else
  bad "6 parent validation" "unexpected codes:$p_fail"
fi

# --- 7. the real S3 bearer gate ----------------------------------------------
# The gate lives on her TAILNET listener, and the loopback listener is exempt by construction
# (it never calls tailnetAuthed). Her tailnet bind address and Host check are both env-settable
# (FLEET_TAILNET_BIND / FLEET_TAILNET_HOST, server.js:15-16), so the listener is put on a
# second loopback address here: it is the real tailnetHandler, with the real gate, reachable
# without owning the Mac's tailscale IP. Nothing about the gate is stubbed.
KEY=intgkey-$$-9d41c7ba26
KEYF=$TMPROOT/key.txt
printf '%s\n' "$KEY" >"$KEYF"                 # greps take the key by -f, never in argv
PORT=$PORT2 \
FLEET_DB=$W/fleet$PORT2.db \
FLEET_HOSTS_FILE=$W/hosts.json \
FLEET_TTL_S=$TTL FLEET_SUSPECT_WINDOW_S=$WINDOW FLEET_REAPER_TICK_S=$TICK \
FLEET_SSH_BIN=/bin/false \
FLEET_TAILNET_BIND=$KEYADDR FLEET_TAILNET_HOST=$KEYADDR:$PORT2 \
FLEET_TAILNET_KEY=$KEY \
node "$W/server.js" >>"$TMPROOT/server$PORT2.log" 2>&1 &
SRV2_PID=$!
if ! wait_up "http://127.0.0.1:$PORT2"; then
  bad "7 real 401 gate" "the keyed instance did not come up on port $PORT2"
elif ! curl -sS --max-time 3 "$BASE2/api/ghtrain" >/dev/null 2>&1; then
  skip "7 real 401 gate" "the tailnet listener is not reachable on $BASE2 - gate NOT exercised"
  note "$(grep -m1 'tailnet' "$TMPROOT/server$PORT2.log")"
else
  note "keyed instance: $(grep -m1 '^lifecycle:' "$TMPROOT/server$PORT2.log")"
  # 7a. no key at all -> her 401, and the claim names the cause instead of retrying blind.
  new_session FD_WORKER=nokeyintg FD_BASE_URL=$BASE2; s7a=$SES
  sleep 4
  log7a=$FD_DIR/log/$s7a.log
  named=no; generic=no
  grep -q 'claim REJECTED 401' "$log7a" 2>/dev/null && named=yes
  grep -q 'claim failed after 3 attempts' "$log7a" 2>/dev/null && generic=yes
  raw401=$(code_of "$(post /api/lease/claim '{"host":"german-box","name":"intgraw"}' "$BASE2")")

  # 7b. the right key -> the whole lifecycle works over the gated listener.
  new_session FD_WORKER=keyedintg FD_BASE_URL=$BASE2 FD_TAILNET_KEY=$KEY; s7b=$SES
  active7=no
  wait_field "$s7b" lease_state active 20 "$BASE2R" && active7=yes
  ep7=$(sess "$s7b" epoch "$BASE2R")
  # argv snapshots while its pinger is beating through the gate: `-H "Authorization: Bearer k"`
  # is world-readable in ps, so this is the check that catches a regression back to one.
  hits=$TMPROOT/ps-hits.txt
  : >"$hits"
  seen=0
  i=0
  while [ "$i" -lt 120 ]; do
    ps -eo args= >"$TMPROOT/ps.now" 2>/dev/null
    grep -F -f "$KEYF" "$TMPROOT/ps.now" >>"$hits" 2>/dev/null
    c=$(grep -cE 'fd-pinger|curl' "$TMPROOT/ps.now" 2>/dev/null | tr -dc 0-9)
    [ "${c:-0}" -gt "$seen" ] && seen=$c
    i=$((i + 1))
    sleep 0.05
  done
  e1=$(sess "$s7b" expires_at "$BASE2R")
  sleep $((CAD + 2))
  e2=$(sess "$s7b" expires_at "$BASE2R")
  nps=$(wc -l <"$hits" | tr -dc 0-9)
  leaks=$TMPROOT/key-in-logs.txt
  grep -rlF -f "$KEYF" "$FD_DIR/log" "$TMPROOT/launch" "$TMPROOT/server$PORT2.log" >"$leaks" 2>/dev/null
  nlog=$(wc -l <"$leaks" | tr -dc 0-9)

  if [ "$raw401" = 401 ] && [ "$named" = yes ] && [ "$generic" = no ] &&
    [ -f "$HOME/launch/fd-alerts/$s7a.txt" ] && [ "$active7" = yes ] &&
    [ "${e2:-0}" -gt "${e1:-0}" ] && [ "${nps:-1}" = 0 ] && [ "${nlog:-1}" = 0 ] &&
    [ "$seen" -ge 1 ]; then
    ok "7 real 401 gate" "unkeyed POST -> $raw401 from her tailnetHandler, claim named it; keyed session claimed epoch=$ep7 and renews (expires_at +$((e2 - e1))ms); key in 0 of $i argv snapshots and 0 logs"
  else
    bad "7 real 401 gate" "raw=$raw401 named=$named generic=$generic alert=$([ -f "$HOME/launch/fd-alerts/$s7a.txt" ] && echo yes || echo no) keyed_active=$active7 expires $e1->$e2 ps_hits=$nps log_hits=$nlog curl_seen=$seen"
  fi
  tmux kill-session -t "=$s7a" 2>/dev/null
  tmux kill-session -t "=$s7b" 2>/dev/null
fi

echo
echo "passed=$PASSED failed=$FAILED"
[ "$FAILED" -eq 0 ]
