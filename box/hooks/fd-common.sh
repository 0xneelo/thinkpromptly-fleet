#!/bin/sh
# Sourced helper library for the fleet-lifecycle hooks (XYZ-1742 Lane 2).
# Installed at ~/.claude/fleet/fd-common.sh; sourced, never executed.
#
# Rules that outrank convenience here:
#  - A hook must never break the session: every helper returns 0 on internal failure and
#    stays silent on stdout unless it is explicitly a value-printing helper.
#  - Zero-quote rule (server.js:95-99): values interpolated into a tmux command are
#    whitelist-validated by fd_safe_name, never escaped. SAFE_NAME has no `.` on purpose.
#  - One credential, handled like one: FD_TAILNET_KEY is the shared bearer key the server's
#    tailnet listener requires on every POST (CONTRACT S3). It is never an argv word - `ps`
#    is world-readable - so it travels to curl in a 0600 --config file. Nothing else here
#    reads a credential store, and nothing writes the Mac.
# POSIX sh only (WSL bash + macOS sh both run this).
#
# FD_NAME is a TEST / MAC-ONLY override of the session name. Inside tmux the tmux session
# name always wins (see fd_session_name): it is the identity the server and the reaper key
# on, and every call site must agree on it or the claim guard silently checks two different
# pidfiles.

# State/config/log root. Overridable so the test harness never touches the real fleet dir.
FD_DIR="${FD_DIR:-${CLAUDE_CONFIG_DIR:-$HOME/.claude}/fleet}"

# A literal tab, for parsing the pinger's "pid<TAB>starttime" identity record.
FD_TAB=$(printf '\t')

# Same charset as server.js SAFE_NAME. `${#1}` avoids a subprocess per call.
fd_safe_name() {
  _v=${1:-}
  case $_v in '' | *[!A-Za-z0-9_-]*) return 1 ;; esac
  [ ${#_v} -le 64 ]
}

# Config: fleet.env is sourced, but the environment always wins over the file.
fd_load_config() {
  _e_url=${FD_BASE_URL:-}
  _e_host=${FD_HOST:-}
  _e_live=${FD_LIVENESS:-}
  _e_ph=${FD_PARENT_HOST:-}
  _e_pn=${FD_PARENT_NAME:-}
  _e_to=${FD_CURL_TIMEOUT:-}
  _e_key=${FD_TAILNET_KEY:-}

  [ -r "$FD_DIR/fleet.env" ] && . "$FD_DIR/fleet.env"

  [ -n "$_e_url" ] && FD_BASE_URL=$_e_url
  [ -n "$_e_host" ] && FD_HOST=$_e_host
  [ -n "$_e_live" ] && FD_LIVENESS=$_e_live
  [ -n "$_e_ph" ] && FD_PARENT_HOST=$_e_ph
  [ -n "$_e_pn" ] && FD_PARENT_NAME=$_e_pn
  [ -n "$_e_to" ] && FD_CURL_TIMEOUT=$_e_to
  [ -n "$_e_key" ] && FD_TAILNET_KEY=$_e_key

  FD_BASE_URL=${FD_BASE_URL:-http://100.125.231.25:3131}
  FD_HOST=${FD_HOST:-german-box}
  FD_PARENT_HOST=${FD_PARENT_HOST:-}
  FD_PARENT_NAME=${FD_PARENT_NAME:-}
  FD_CURL_TIMEOUT=${FD_CURL_TIMEOUT:-10}
  # Empty is the normal case: the server only requires the key when FLEET_TAILNET_KEY is armed,
  # and loopback (the Mac) is exempt either way. Surrounding spaces are trimmed (the server
  # trims its own key too, so a tidy-up must not become a mismatch), but a `"`, a `\` or ANY
  # control character is a dropped key, not a repaired one: the first two break the quoting of
  # the curl config line, and a CR or LF - which is what a fleet.env that made a round trip
  # through a CRLF editor looks like - would end that config line early and inject the rest as
  # a further curl directive. A 401 with a named cause beats either.
  FD_TAILNET_KEY=${FD_TAILNET_KEY:-}
  while :; do
    case $FD_TAILNET_KEY in
      ' '*) FD_TAILNET_KEY=${FD_TAILNET_KEY#' '} ;;
      *' ') FD_TAILNET_KEY=${FD_TAILNET_KEY%' '} ;;
      *) break ;;
    esac
  done
  case $FD_TAILNET_KEY in
    *'"'* | *'\'* | *[[:cntrl:]]*)
      FD_TAILNET_KEY=''
      fd_log 'WARN FD_TAILNET_KEY contains a quote, backslash or control character (CR/LF/tab) - ignoring it, POSTs go unauthenticated'
      ;;
  esac
  if [ -z "${FD_LIVENESS:-}" ]; then
    if [ "$FD_HOST" = mac ]; then FD_LIVENESS=pid; else FD_LIVENESS=tmux; fi
  fi

  # Exported so the detached pinger inherits the same target and dirs. The key is exported
  # too - a key set only in this hook's environment must reach the pinger, and /proc/<pid>/environ
  # is owner-only, unlike the argv `ps` prints for every user on the box.
  export FD_DIR FD_BASE_URL FD_HOST FD_LIVENESS FD_CURL_TIMEOUT FD_TAILNET_KEY
  return 0
}

# The fleet session name, or nothing at all when it is not whitelist-safe.
# Inside tmux the tmux session name is AUTHORITATIVE and FD_NAME is ignored: SessionStart
# and `mark.sh --worker` must resolve the same name or the claim guard never engages, and
# tmux is the one name the server and reaper already key on. FD_NAME is the override for
# the two places with no tmux session: the Mac and the tests.
fd_session_name() {
  _n=''
  [ -n "${TMUX:-}" ] && _n=$(tmux display-message -p '#S' 2>/dev/null)
  [ -n "$_n" ] || _n=${FD_NAME:-}
  fd_safe_name "$_n" || return 0
  printf '%s\n' "$_n"
}

# The pid the server should record: the pane leader on the box, the session pid on the mac.
fd_pane_pid() {
  if [ "${FD_LIVENESS:-tmux}" = pid ]; then
    printf '%s\n' "${FD_PID:-$PPID}"
  else
    tmux display-message -p '#{pane_pid}' 2>/dev/null
  fi
}

# Non-zero when the session behind $1 is gone. The `=` prefix forces an exact tmux match:
# without it `FD-konrad` would also match the prefix of another session's name.
fd_alive() {
  if [ "${FD_LIVENESS:-tmux}" = pid ]; then
    [ -n "${FD_PID:-}" ] || return 1
    kill -0 "$FD_PID" 2>/dev/null
  else
    fd_safe_name "${1:-}" || return 1
    tmux has-session -t "=$1" 2>/dev/null
  fi
}

# Process start time for $1 - the one field that a recycled pid cannot inherit. Field 22 of
# /proc/<pid>/stat on Linux; `ps -o lstart=` (spaces folded) everywhere else. Prints nothing
# when it cannot be read, which callers must treat as "no identity", never as a match.
fd_proc_id() {
  _p=${1:-}
  case $_p in '' | *[!0-9]*) return 0 ;; esac
  if [ -r "/proc/$_p/stat" ]; then
    # comm (field 2) may contain spaces and ')', so drop "pid (comm) " first - awk's
    # leftmost-longest match takes it to the LAST ") " - then starttime is field 22-2.
    awk '{ sub(/^[0-9]+ \(.*\) /, ""); print $20 }' "/proc/$_p/stat" 2>/dev/null
  else
    ps -o lstart= -p "$_p" 2>/dev/null | tr -s ' \t' '__' | tr -d '\n'
  fi
  return 0
}

# The pid half of a "pid<TAB>starttime" pinger identity record (as read from the pidfile).
fd_pinger_pid() {
  _r=${1:-}
  printf '%s\n' "${_r%%"$FD_TAB"*}"
}

# True when the identity record $1 names a live fd-pinger. `kill -0` plus a cmdline match is
# not enough on its own: a recycled pid whose cmdline merely CONTAINS "fd-pinger" (an editor
# with the file open, a grep) would pass, the claim guard would skip both the claim and the
# spawn, and the session would go suspect then reaped while fully alive. So the recorded
# start time must match too - a recycled pid always has a different one.
fd_pinger_running() {
  _rec=${1:-}
  _p=${_rec%%"$FD_TAB"*}
  case $_rec in *"$FD_TAB"*) _st=${_rec#*"$FD_TAB"} ;; *) _st='' ;; esac
  case $_p in '' | *[!0-9]*) return 1 ;; esac
  kill -0 "$_p" 2>/dev/null || return 1
  # No recorded start time (or a mismatch) means the pidfile is stale, not that we are lucky.
  [ -n "$_st" ] && [ "$_st" = "$(fd_proc_id "$_p")" ] || return 1
  if [ -r "/proc/$_p/cmdline" ]; then
    tr '\0' ' ' <"/proc/$_p/cmdline" 2>/dev/null | grep -q fd-pinger
  else
    ps -o command= -p "$_p" 2>/dev/null | grep -q fd-pinger
  fi
}

# True when $1 was last modified more than $2 seconds ago. Used only to break a wedged lock,
# so an unreadable mtime returns FALSE: never break a lock on a guess.
fd_older_than() {
  _f=${1:-}
  _age=${2:-60}
  _m=$(stat -c %Y "$_f" 2>/dev/null) || _m=''
  [ -n "$_m" ] || _m=$(stat -f %m "$_f" 2>/dev/null)
  _now=$(date +%s 2>/dev/null)
  case $_m in '' | *[!0-9]*) return 1 ;; esac
  case $_now in '' | *[!0-9]*) return 1 ;; esac
  [ $((_now - _m)) -gt "$_age" ]
}

# POST $2 (a JSON string) to $FD_BASE_URL$1. The body goes in on stdin, never in argv.
# Prints the HTTP code on line 1 and the response body on the rest; a dead connection or
# a timeout prints `000` with an empty body and is NOT fatal.
#
# Every header goes through a curl --config file, always, not only when there is a key to
# send: one code path is one code path to audit, and `-H "Authorization: Bearer $k"` would
# put the shared key in argv, where any user on the box reads it out of `ps`. The file is
# created by mktemp (0600) and chmod'd 0600 explicitly BEFORE the key is written into it,
# and a trap inside the subshell removes it however that subshell ends. `printf` is a shell
# builtin, so writing the key costs no process and no argv either.
fd_post() {
  _tmp=$(mktemp 2>/dev/null) || { printf '000\n'; return 0; }
  _cfg=$(mktemp 2>/dev/null) || { rm -f "$_tmp" 2>/dev/null; printf '000\n'; return 0; }
  if ! chmod 0600 "$_cfg" 2>/dev/null; then
    rm -f "$_cfg" "$_tmp" 2>/dev/null
    printf '000\n'
    return 0
  fi
  printf 'header = "Content-Type: application/json"\n' >"$_cfg" 2>/dev/null
  [ -n "${FD_TAILNET_KEY:-}" ] &&
    printf 'header = "Authorization: Bearer %s"\n' "$FD_TAILNET_KEY" >>"$_cfg" 2>/dev/null
  _code=$(
    # Two traps, not one: on a signal both scratch files go, but on a NORMAL exit only the
    # secret-bearing config does - $_tmp still holds the response body this function is about
    # to print, and is removed by the last line below.
    trap 'rm -f "$_cfg" "$_tmp" 2>/dev/null' INT TERM
    trap 'rm -f "$_cfg" 2>/dev/null' EXIT
    printf '%s' "${2:-}" | curl -sS --max-time "${FD_CURL_TIMEOUT:-10}" \
      --config "$_cfg" --data-binary @- \
      -o "$_tmp" -w '%{http_code}' "$FD_BASE_URL$1" 2>/dev/null
  )
  case $_code in '' | *[!0-9]*) _code=000 ;; esac
  printf '%s\n' "$_code"
  cat "$_tmp" 2>/dev/null
  rm -f "$_tmp" "$_cfg" 2>/dev/null
  return 0
}

# The 401 note, in one place because both the claim and the pinger write it. A 401 is never
# a network blip: the server's tailnet listener gates every POST on the shared bearer key
# (CONTRACT S3), so this is configuration, and configuration is not something to retry
# silently forever. $1 = session, $2 = what the caller was doing when it got the 401.
fd_alert_unauthorized() {
  _ad=$HOME/launch/fd-alerts
  mkdir -p "$_ad" 2>/dev/null || return 0
  printf '%s\n' \
    "session:  ${1:-unknown}" \
    "host:     ${FD_HOST:-unknown}" \
    "url:      ${FD_BASE_URL:-unknown}" \
    "when:     ${2:-a fleet POST}" \
    "observed: $(date +%Y-%m-%dT%H:%M:%S%z) (local)" \
    "" \
    "The fleet server answered 401 unauthorized. Every POST that arrives over the tailnet" \
    "carries a shared bearer key; this machine sent $([ -n "${FD_TAILNET_KEY:-}" ] && echo 'a key the server rejected' || echo 'no key at all')." \
    "" \
    "Fix: set FD_TAILNET_KEY in ${FD_DIR:-~/.claude/fleet}/fleet.env to the same value as the" \
    "server's FLEET_TAILNET_KEY, then start a new session (or re-run lease-claim.sh)." \
    "The Mac needs no key: its calls go to loopback, which the server exempts." \
    >"$_ad/${1:-unknown}.txt" 2>/dev/null
  return 0
}

# Value of top-level key $1 from the JSON on stdin. Malformed JSON prints nothing, exit 0.
fd_json() {
  python3 -c '
import sys, json
try:
    o = json.load(sys.stdin)
    v = o.get(sys.argv[1]) if isinstance(o, dict) else None
except Exception:
    v = None
if v is None or isinstance(v, (dict, list)):
    pass
elif isinstance(v, bool):
    print("true" if v else "false")
else:
    print(v)
' "$1" 2>/dev/null
  return 0
}

# JSON object from the FD_J_<key> environment variables named in $@. Empty values are
# omitted (never sent as ""). Built by json.dumps from the environment on purpose: no
# shell value is ever concatenated into JSON text, which kills a class of quoting bugs.
fd_json_body() {
  python3 -c '
import os, sys, json
NUM = ("pid", "epoch")
o = {}
for k in sys.argv[1:]:
    v = os.environ.get("FD_J_" + k, "")
    if v == "":
        continue
    o[k] = int(v) if k in NUM and v.lstrip("-").isdigit() else v
sys.stdout.write(json.dumps(o))
' "$@" 2>/dev/null
  return 0
}

# Append one timestamped line to the session log, bounded so it can never grow unbounded.
fd_log() {
  _s=${FD_LOG_SES:-}
  [ -n "$_s" ] || _s=$(fd_session_name)
  [ -n "$_s" ] || _s=unnamed
  mkdir -p "$FD_DIR/log" 2>/dev/null || return 0
  _f=$FD_DIR/log/$_s.log
  printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "${1:-}" >>"$_f" 2>/dev/null
  _c=$(wc -l <"$_f" 2>/dev/null | tr -dc 0-9)  # BSD wc pads with spaces
  case $_c in '' | *[!0-9]*) return 0 ;; esac
  if [ "$_c" -gt 2000 ]; then
    tail -n 500 "$_f" >"$_f.trim" 2>/dev/null && mv "$_f.trim" "$_f" 2>/dev/null
  fi
  return 0
}
