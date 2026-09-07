#!/bin/sh
# Stamp the current cwd as an orchestrator / researcher / goalkeeper / worker session.
#
#   mark.sh --orchestrator ["topic"]  claim a number (idempotent per dir) AND stamp
#                                     `🎛 ORCHESTRATOR <N>`; prints the badge. USE THIS —
#                                     it makes a hand-typed number impossible.
#   mark.sh --researcher ["topic"]    claim a number (same pool as orchestrators) AND
#                                     stamp `🔬 RESEARCHER <N>`; prints the badge.
#   mark.sh --design ["topic"]        claim a number (same pool) AND stamp
#                                     `🎨 DESIGN <N>` (design implementation
#                                     orchestrator); prints the badge.
#   mark.sh --coordinator ["topic"]   claim a number (same pool) AND stamp
#                                     `🧭 COORDINATOR <N>` (coordinator portal);
#                                     prints the badge.
#   mark.sh --goalkeeper ["topic"]    claim a number (same pool) AND stamp
#                                     `🥅 GOALKEEPER <N>` (the auditor seat); prints the
#                                     badge. REFUSED while another 🥅 seat is live in a
#                                     different directory — there is ONE goalkeeper for all
#                                     projects.
#   mark.sh --worker <Name>           stamp `🔨 WORKER · <Name>`; warns loudly (stderr) if
#                                     this directory still carries another agent's badge,
#                                     which is the reused-worktree case that used to leave
#                                     a dead agent's name in the tab title.
#   mark.sh "<badge>"                 raw stamp. Validated; an explicit ORCHESTRATOR <N> is
#                                     verified against the registry so it cannot duplicate
#                                     a number another live session holds.
#   mark.sh --clear | --show          remove / print the marker for $PWD
#   mark.sh --list                    every marker: badge, age, cwd (flags dead cwds)
#   mark.sh --reap                    drop markers whose directory no longer exists
#
# The badge lives in marks/<key>; marks/<key>.cwd records the directory (<key> is a one-way
# hash) and marks/<key>.meta the stamping session id + date, so a stale badge is auditable
# instead of invisible. Readers (guard.js, title.js, statusline.sh) only read marks/<key>.
#
# WHY the badge can go stale: it is keyed by DIRECTORY, and the title hook fires at
# SessionStart — before a worker's first turn. So a session started in a worktree a previous
# agent used shows that agent's name until something re-stamps. Always stamp in the launch
# command, BEFORE `claude` starts; re-stamping mid-session fixes the status line but NOT the
# tab title (that needs /rename).

DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/session-kind"
MARKS="$DIR/marks"
KEY=$(printf '%s' "$PWD" | shasum 2>/dev/null | cut -c1-12)
[ -n "$KEY" ] || exit 0
FILE="$MARKS/$KEY"

valid_badge() {
  # Structure must be one of the two known shapes, and carry no path/tab/newline junk
  # (a pasted path in the badge is how one marker ended up unreadable).
  case "$1" in
    *"/"*|*"	"*) return 1 ;;
  esac
  case "$1" in
    "🎛 ORCHESTRATOR"|"🎛 ORCHESTRATOR "[0-9]*) return 0 ;;
    "🔬 RESEARCHER"|"🔬 RESEARCHER "[0-9]*) return 0 ;;
    "🎨 DESIGN"|"🎨 DESIGN "[0-9]*) return 0 ;;
    "🧭 COORDINATOR"|"🧭 COORDINATOR "[0-9]*) return 0 ;;
    "🥅 GOALKEEPER"|"🥅 GOALKEEPER "[0-9]*) return 0 ;;
    "🔨 WORKER · "?*) return 0 ;;
    *) return 1 ;;
  esac
}

stamp() {
  mkdir -p "$MARKS" 2>/dev/null || exit 1
  printf '%s\n' "$1" >"$FILE" 2>/dev/null || exit 1
  printf '%s\n' "$PWD" >"$FILE.cwd" 2>/dev/null
  printf 'stamped %s session %s\n' "$(date +%Y-%m-%d)" \
    "${CLAUDE_CODE_SESSION_ID:-${CLAUDE_SESSION_ID:-unknown}}" >"$FILE.meta" 2>/dev/null
}

case "$1" in
  --clear) rm -f "$FILE" "$FILE.cwd" "$FILE.meta" 2>/dev/null ;;
  --show)  [ -f "$FILE" ] && cat "$FILE" 2>/dev/null ;;

  --orchestrator|--researcher|--design|--coordinator|--goalkeeper)
    case "$1" in
      --orchestrator) PREFIX="🎛 ORCHESTRATOR" ;;
      --researcher)   PREFIX="🔬 RESEARCHER" ;;
      --design)       PREFIX="🎨 DESIGN" ;;
      --coordinator)  PREFIX="🧭 COORDINATOR" ;;
      --goalkeeper)   PREFIX="🥅 GOALKEEPER" ;;
    esac
    # ONE goalkeeper for all projects: refuse a second 🥅 seat in another directory.
    # Re-stamping THIS directory stays idempotent. The check is bounded at 10s and fails
    # OPEN — a census that errors, is missing, or HANGS (it shells out to ps/lsof) leaves
    # OTHER empty and the stamp proceeds. A broken census must never wedge a stamp.
    # macOS ships no timeout(1); coreutils' gtimeout is the fallback, and with neither the
    # call is simply unbounded (the old behaviour) rather than skipped.
    if [ "$1" = "--goalkeeper" ]; then
      if command -v timeout >/dev/null 2>&1; then GKTMO="timeout 10"
      elif command -v gtimeout >/dev/null 2>&1; then GKTMO="gtimeout 10"
      else GKTMO=""; fi
      OTHER=$($GKTMO python3 "$DIR/census.py" --live-badge-prefix "🥅" 2>/dev/null \
              | awk -F'\t' -v me="$PWD" 'NF>=2 && $2 != me { print $1 " in " $2 }')
      if [ -n "$OTHER" ]; then
        echo "mark.sh: a 🥅 GOALKEEPER seat is already live:" >&2
        printf '  %s\n' "$OTHER" >&2
        echo "mark.sh: there is ONE goalkeeper for all projects (PLAN.md v2 §3.1)." >&2
        echo "mark.sh: close that seat first (mark.sh --clear in its directory), or work in it." >&2
        exit 4
      fi
    fi
    if [ -n "$2" ]; then
      N=$(python3 "$DIR/number.py" claim --topic "$2") || exit 1
    else
      N=$(python3 "$DIR/number.py" claim) || exit 1
    fi
    [ -n "$N" ] || { echo "mark.sh: number registry returned nothing" >&2; exit 1; }
    BADGE="$PREFIX $N"
    stamp "$BADGE"
    printf '%s\n' "$BADGE"
    ;;

  --worker)
    [ -n "$2" ] || { echo "mark.sh --worker needs a name" >&2; exit 2; }
    BADGE="🔨 WORKER · $2"
    if [ -f "$FILE" ]; then
      OLD=$(cat "$FILE" 2>/dev/null)
      if [ "$OLD" != "$BADGE" ]; then
        echo "mark.sh: this directory was last stamped '$OLD' — reused worktree." >&2
        echo "mark.sh: overwriting with '$BADGE'. If a session for '$OLD' is still alive," >&2
        echo "mark.sh: STOP: two drivers on one worktree. Otherwise the tab title may still" >&2
        echo "mark.sh: read the old name — fix it with /rename inside the new session." >&2
      fi
    fi
    stamp "$BADGE"
    printf '%s\n' "$BADGE"
    ;;

  --list)
    for f in "$MARKS"/*; do
      case "$f" in *.cwd|*.meta|"$MARKS/*") continue ;; esac
      [ -f "$f" ] || continue
      where="unknown cwd"
      [ -f "$f.cwd" ] && where=$(cat "$f.cwd" 2>/dev/null)
      note=""
      [ "$where" != "unknown cwd" ] && [ ! -d "$where" ] && note=" [DEAD CWD]"
      meta=""
      [ -f "$f.meta" ] && meta=$(cat "$f.meta" 2>/dev/null)
      printf '%s\t%s\t%s%s\t%s\n' "$(basename "$f")" "$(cat "$f" 2>/dev/null)" \
        "$where" "$note" "$meta"
    done
    ;;

  --reap)
    n=0
    for f in "$MARKS"/*; do
      case "$f" in *.cwd|*.meta|"$MARKS/*") continue ;; esac
      [ -f "$f" ] || continue
      [ -f "$f.cwd" ] || continue
      where=$(cat "$f.cwd" 2>/dev/null)
      if [ -n "$where" ] && [ ! -d "$where" ]; then
        printf 'dropping %s (%s) — cwd gone: %s\n' "$(basename "$f")" \
          "$(cat "$f" 2>/dev/null)" "$where"
        rm -f "$f" "$f.cwd" "$f.meta" 2>/dev/null
        n=$((n + 1))
      fi
    done
    printf 'reaped %s marker(s)\n' "$n"
    ;;

  "")      exit 0 ;;

  *)
    if ! valid_badge "$1"; then
      echo "mark.sh: refusing badge '$1'" >&2
      echo "mark.sh: expected '🎛 ORCHESTRATOR <N>', '🔬 RESEARCHER <N>', '🎨 DESIGN <N>', '🧭 COORDINATOR <N>', '🥅 GOALKEEPER <N>' or '🔨 WORKER · <Name>' (no paths)." >&2
      echo "mark.sh: prefer 'mark.sh --orchestrator/--researcher/--design/--coordinator/--goalkeeper \"<topic>\"' / '--worker <Name>'." >&2
      exit 2
    fi
    N=$(printf '%s' "$1" | sed -n 's/^🎛 ORCHESTRATOR \([0-9][0-9]*\)$/\1/p')
    [ -n "$N" ] || N=$(printf '%s' "$1" | sed -n 's/^🔬 RESEARCHER \([0-9][0-9]*\)$/\1/p')
    [ -n "$N" ] || N=$(printf '%s' "$1" | sed -n 's/^🎨 DESIGN \([0-9][0-9]*\)$/\1/p')
    [ -n "$N" ] || N=$(printf '%s' "$1" | sed -n 's/^🧭 COORDINATOR \([0-9][0-9]*\)$/\1/p')
    [ -n "$N" ] || N=$(printf '%s' "$1" | sed -n 's/^🥅 GOALKEEPER \([0-9][0-9]*\)$/\1/p')
    if [ -n "$N" ]; then
      python3 "$DIR/number.py" verify "$N" || exit 3
    fi
    stamp "$1"
    ;;
esac

# --- fleetdeck lifecycle (XYZ-1742 Lane 2) BEGIN ---
# `mark.sh --worker <Name>` is the one line BOTH breeds run at launch, and the Codex breed
# has no hooks - so the fleet lease is claimed from here too, which is what covers Codex
# without editing the launcher. Constraints, all load-bearing:
#   - only on a successful `--worker <Name>` (this sits after the case, so a bad invocation
#     has already exited);
#   - backgrounded, so mark.sh never delays the launch line;
#   - no stdout, no stderr, no change of exit status - the launcher and the status line read
#     the badge mark.sh printed above;
#   - a missing lease-claim.sh is a silent no-op, never an error;
#   - FD_DIR wins, exactly as it does in fd-common.sh, so a test that redirects the fleet dir
#     cannot end up claiming a real lease against live fleet state from here.
# Managed by install-box.sh: everything between these markers is replaced on upgrade and
# removed by `install-box.sh --uninstall`. Do not hand-edit.
if [ "${1:-}" = --worker ] && [ -n "${2:-}" ]; then
  _fd_claim="${FD_DIR:-${CLAUDE_CONFIG_DIR:-$HOME/.claude}/fleet}/lease-claim.sh"
  if [ -r "$_fd_claim" ]; then
    if command -v setsid >/dev/null 2>&1; then
      FD_WORKER="$2" setsid sh "$_fd_claim" </dev/null >/dev/null 2>&1 &
    else
      FD_WORKER="$2" sh "$_fd_claim" </dev/null >/dev/null 2>&1 &
    fi
  fi
  unset _fd_claim
fi
# --- fleetdeck lifecycle (XYZ-1742 Lane 2) END ---
exit 0
