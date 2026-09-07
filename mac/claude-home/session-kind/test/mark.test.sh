#!/bin/sh
# Tests for mark.sh (badge stamping, the ONE-goalkeeper liveness check) and for
# census.py --live-badge-prefix.
#
# Run: sh mac/claude-home/session-kind/test/mark.test.sh
#
# Every case builds a THROWAWAY CLAUDE_CONFIG_DIR under /private/tmp holding the real
# mark.sh plus STUB number.py and census.py, so the live ~/.claude tree is never touched:
# no real number is claimed, no real process list is scanned. The only real thing this
# suite runs is `census.py --live-badge-prefix`, which is read-only.
set -u

SK=$(cd "$(dirname "$0")/.." && pwd)
ROOT=$(mktemp -d /private/tmp/gk-mark-XXXXXX) || exit 1
trap 'rm -rf "$ROOT"' EXIT INT TERM

N=0
FAILED=0
ok() { N=$((N + 1)); printf 'ok %s - %s\n' "$N" "$1"; }
notok() {
  N=$((N + 1)); FAILED=$((FAILED + 1))
  printf 'not ok %s - %s\n' "$N" "$1"
  [ $# -gt 1 ] && printf '#   %s\n' "$2"
  return 0
}
is() { # got want name
  if [ "$1" = "$2" ]; then ok "$3"; else notok "$3" "got [$1] want [$2]"; fi
}
skip() { N=$((N + 1)); printf 'ok %s - %s # SKIP %s\n' "$N" "$1" "$2"; }

# --- census stubs: what mark.sh's liveness probe sees -------------------------------
CENSUS_NONE='pass'
CENSUS_OTHER='print("\U0001F945 GOALKEEPER 3\t/Users/x/other-project")'
CENSUS_SELF='import os
print("\U0001F945 GOALKEEPER 3\t" + os.getcwd())'
CENSUS_FAIL='import sys
sys.exit(1)'
CENSUS_HANG='import time
time.sleep(30)'

# Fresh cfg + workdir for one case. $1 = case name, $2 = census.py body.
setup() {
  CASE="$ROOT/$1"
  CFG="$CASE/cfg"
  WORK="$CASE/work"
  mkdir -p "$CFG/session-kind" "$WORK"
  cp "$SK/mark.sh" "$CFG/session-kind/mark.sh"
  # Stub registry: claim always hands back 77, verify always agrees, every call is logged
  # so a test can assert mark.sh really consulted it.
  cat >"$CFG/session-kind/number.py" <<'PY'
import sys
open(sys.argv[0] + ".log", "a").write(" ".join(sys.argv[1:]) + "\n")
if sys.argv[1] == "claim":
    print("77")
PY
  printf '%s\n' "$2" >"$CFG/session-kind/census.py"
  KEY=$(printf '%s' "$WORK" | shasum | cut -c1-12)
  FILE="$CFG/session-kind/marks/$KEY"
}

run() { # mark.sh args...; sets OUT, ERR, RC
  OUT=$(cd "$WORK" && CLAUDE_CONFIG_DIR="$CFG" sh "$CFG/session-kind/mark.sh" "$@" 2>"$CASE/err")
  RC=$?
  ERR=$(cat "$CASE/err")
}

# --- 1. ONE goalkeeper for all projects ---------------------------------------------
setup gk-other "$CENSUS_OTHER"
run --goalkeeper "audit"
is "$RC" 4 "--goalkeeper refused while a 🥅 seat is live elsewhere (exit 4)"
case "$ERR" in
  *"/Users/x/other-project"*) ok "refusal names the other seat's directory" ;;
  *) notok "refusal names the other seat's directory" "stderr: $ERR" ;;
esac
if [ -e "$FILE" ]; then notok "refusal writes no marker" "marker exists: $FILE"; else ok "refusal writes no marker"; fi

setup gk-self "$CENSUS_SELF"
run --goalkeeper
is "$RC" 0 "--goalkeeper re-stamps THIS directory (idempotent, exit 0)"
is "$OUT" "🥅 GOALKEEPER 77" "re-stamp prints the badge"

# --- 2. the liveness check fails OPEN ------------------------------------------------
setup gk-broken "$CENSUS_FAIL"
run --goalkeeper
is "$RC" 0 "a census that exits 1 does not wedge the stamp"
is "$OUT" "🥅 GOALKEEPER 77" "broken census still stamps (fails open)"

setup gk-hang "$CENSUS_HANG"
if command -v timeout >/dev/null 2>&1 || command -v gtimeout >/dev/null 2>&1; then
  START=$(date +%s)
  run --goalkeeper
  ELAPSED=$((  $(date +%s) - START ))
  if [ "$ELAPSED" -lt 25 ]; then ok "a census that hangs is bounded (${ELAPSED}s < 25s)"
  else notok "a census that hangs is bounded" "took ${ELAPSED}s"; fi
  is "$OUT" "🥅 GOALKEEPER 77" "hung census still stamps (fails open on timeout)"
else
  skip "a census that hangs is bounded" "no timeout(1)/gtimeout(1) on this box"
  skip "hung census still stamps (fails open on timeout)" "no timeout(1)/gtimeout(1) on this box"
fi

# --- 3. the ordinary goalkeeper stamp lifecycle --------------------------------------
setup gk-clean "$CENSUS_NONE"
run --goalkeeper "drift audit"
is "$RC" 0 "--goalkeeper stamps when no 🥅 seat is live"
is "$OUT" "🥅 GOALKEEPER 77" "prints 🥅 GOALKEEPER <N>"
is "$(cat "$FILE" 2>/dev/null)" "🥅 GOALKEEPER 77" "marker file content matches the badge"
is "$(cat "$FILE.cwd" 2>/dev/null)" "$WORK" "marker records the cwd"
run --show
is "$OUT" "🥅 GOALKEEPER 77" "--show prints the badge"
run --clear
if [ -e "$FILE" ]; then notok "--clear removes the marker" "still there: $FILE"; else ok "--clear removes the marker"; fi

# --- 4. raw badges --------------------------------------------------------------------
setup raw-gk "$CENSUS_NONE"
run "🥅 GOALKEEPER 6"
is "$RC" 0 "raw '🥅 GOALKEEPER 6' accepted by valid_badge"
is "$(cat "$FILE" 2>/dev/null)" "🥅 GOALKEEPER 6" "raw goalkeeper badge stamped"
case "$(cat "$CFG/session-kind/number.py.log" 2>/dev/null)" in
  *"verify 6"*) ok "raw badge verified against the registry (number.py verify 6)" ;;
  *) notok "raw badge verified against the registry (number.py verify 6)" "log: $(cat "$CFG/session-kind/number.py.log" 2>/dev/null)" ;;
esac

setup raw-bad "$CENSUS_NONE"
run "🥅 GOALIE 6"
is "$RC" 2 "raw '🥅 GOALIE 6' refused (exit 2)"
if [ -e "$FILE" ]; then notok "refused badge writes no marker" "marker exists"; else ok "refused badge writes no marker"; fi

# --- 5. regression: the pre-existing kinds still stamp -------------------------------
for pair in "--orchestrator:🎛 ORCHESTRATOR 77" "--researcher:🔬 RESEARCHER 77" \
            "--design:🎨 DESIGN 77" "--coordinator:🧭 COORDINATOR 77"; do
  flag=${pair%%:*}
  want=${pair#*:}
  setup "kind${flag}" "$CENSUS_NONE"
  run "$flag" "topic"
  is "$OUT" "$want" "$flag stamps '$want'"
  is "$(cat "$FILE" 2>/dev/null)" "$want" "$flag marker content matches"
done

setup worker "$CENSUS_NONE"
run --worker Giselher
is "$RC" 0 "--worker Giselher exits 0"
is "$OUT" "🔨 WORKER · Giselher" "--worker stamps '🔨 WORKER · Giselher'"

# --- 6. the REAL census, read-only ----------------------------------------------------
CENSUS_OUT=$(python3 "$SK/census.py" --live-badge-prefix "🥅" 2>"$ROOT/census.err")
is "$?" 0 "census.py --live-badge-prefix exits 0"
if [ -z "$CENSUS_OUT" ]; then
  ok "census.py --live-badge-prefix prints nothing when no 🥅 seat is live"
else
  # A 🥅 seat IS live on this box: the contract is still badge<TAB>cwd and nothing else.
  bad=$(printf '%s\n' "$CENSUS_OUT" | grep -cv '^🥅.*	.' 2>/dev/null)
  is "$bad" 0 "census.py --live-badge-prefix prints only badge<TAB>cwd rows (a 🥅 seat is live)"
fi
case "$CENSUS_OUT" in
  *"open sessions"*|*"STATUS"*|*"GHOST"*)
    notok "census.py --live-badge-prefix prints no header/summary/table" "got: $CENSUS_OUT" ;;
  *) ok "census.py --live-badge-prefix prints no header/summary/table" ;;
esac

printf '1..%s\n' "$N"
if [ "$FAILED" -gt 0 ]; then
  printf '# %s of %s failed\n' "$FAILED" "$N"
  exit 1
fi
printf '# all %s passed\n' "$N"
exit 0
