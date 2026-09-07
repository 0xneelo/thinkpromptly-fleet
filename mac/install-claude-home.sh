#!/bin/sh
# Install the vendored ~/.claude tree from mac/claude-home/ onto this Mac.
#
#   sh mac/install-claude-home.sh --dry-run   # show every action, change nothing
#   sh mac/install-claude-home.sh             # install
#
# Idempotent: a file already identical to the vendored copy is skipped, and no
# .bak is made for it. A file that differs is backed up to <file>.bak-<STAMP>
# (only if that backup does not already exist — the first install of the day
# keeps the pre-install original) and then replaced.
#
# NEVER touched, by design:
#   - ~/.claude/session-kind/marks/   (live session badges; keyed by directory)
#   - ~/.claude/session-kind/numbers.db (the seat-number registry)
#   - any existing *.bak* file
#
# guard.js is a PreToolUse hook that runs for EVERY session on this machine. A
# broken guard.js breaks every open seat. This script verifies `node --check`
# on the vendored guard.js BEFORE copying it, and if any live session errors
# after an install, restore the backup:
#
#   cp ~/.claude/session-kind/guard.js.bak-<STAMP> ~/.claude/session-kind/guard.js
set -eu

STAMP="2026-09-07"
SRC=$(cd "$(dirname "$0")/claude-home" && pwd)
DEST="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
DRY=0
[ "${1:-}" = "--dry-run" ] && DRY=1

changed=0
skipped=0
backed=0

say() { printf '%s\n' "$*"; }
act() { [ "$DRY" -eq 1 ] && printf 'DRY  %s\n' "$*" || printf '     %s\n' "$*"; }

# install_file <relative path under claude-home>
install_file() {
  rel="$1"
  src="$SRC/$rel"
  dst="$DEST/$rel"
  [ -f "$src" ] || { say "!!   missing from vendor tree, skipped: $rel"; return 0; }

  case "$rel" in
    */marks/*|*/numbers.db|*.bak*)
      say "!!   refusing to install a protected path: $rel"; return 0 ;;
  esac

  if [ -f "$dst" ] && cmp -s "$src" "$dst"; then
    skipped=$((skipped + 1))
    return 0
  fi

  if [ -f "$dst" ]; then
    bak="$dst.bak-$STAMP"
    if [ -e "$bak" ]; then
      act "backup exists, kept: $bak"
    else
      act "backup: $rel -> $rel.bak-$STAMP"
      [ "$DRY" -eq 0 ] && cp -p "$dst" "$bak"
      backed=$((backed + 1))
    fi
    act "replace: $dst"
  else
    act "create:  $dst"
  fi

  if [ "$DRY" -eq 0 ]; then
    mkdir -p "$(dirname "$dst")"
    cp "$src" "$dst"
    # Mirror the vendored executable bit.
    [ -x "$src" ] && chmod +x "$dst"
  fi
  changed=$((changed + 1))
}

# --- 0. refuse to install a guard.js that does not parse -------------------
if [ -f "$SRC/session-kind/guard.js" ]; then
  if ! node --check "$SRC/session-kind/guard.js" >/dev/null 2>&1; then
    say "ABORT: mac/claude-home/session-kind/guard.js does not parse."
    say "       Installing it would break the PreToolUse hook in every open seat."
    exit 1
  fi
  say "ok   guard.js parses"
fi
if [ -f "$SRC/skills/goalkeeper/goalkeeper.py" ]; then
  if ! python3 -c "import ast,sys; ast.parse(open(sys.argv[1]).read())" "$SRC/skills/goalkeeper/goalkeeper.py" >/dev/null 2>&1; then
    say "ABORT: goalkeeper.py does not parse."
    exit 1
  fi
  say "ok   goalkeeper.py parses"
fi

say ""
say "install $SRC -> $DEST  (stamp $STAMP)$([ "$DRY" -eq 1 ] && echo '  [DRY RUN]')"
say ""

# --- 1. session-kind -------------------------------------------------------
say "session-kind/"
for f in mark.sh guard.js census.py number.py title.js README.md statusline.sh; do
  install_file "session-kind/$f"
done

# --- 2. the goalkeeper skill ----------------------------------------------
say "skills/goalkeeper/"
install_file "skills/goalkeeper/SKILL.md"
install_file "skills/goalkeeper/goalkeeper.py"
install_file "skills/goalkeeper/references/anchor-check.md"

# --- 3. adhd-goals (vendored so the tree round-trips; usually a no-op) -----
say "skills/adhd-goals/"
for f in SKILL.md REFERENCE.md goals.py scan.py template.html; do
  install_file "skills/adhd-goals/$f"
done

# --- 4. settings.json PreToolUse matcher ----------------------------------
# The guard now also has to see Skill (the introduce-goal deny is dead without
# it), Bash, and the two message tools. Patched by exact string replacement,
# not a JSON rewrite, so the file's formatting and every other setting survive.
say ""
say "settings.json"
SETTINGS="$DEST/settings.json"
OLD_MATCHER='"Agent|Task|Edit|Write|NotebookEdit"'
NEW_MATCHER='"Agent|Task|Edit|Write|NotebookEdit|Skill|Bash|SendMessage|mcp__ccd_session_mgmt__send_message"'
if [ ! -f "$SETTINGS" ]; then
  say "!!   $SETTINGS not found — patch the PreToolUse matcher by hand:"
  say "!!     $NEW_MATCHER"
elif grep -qF "$NEW_MATCHER" "$SETTINGS"; then
  say "     matcher already patched"
  skipped=$((skipped + 1))
elif ! grep -qF "$OLD_MATCHER" "$SETTINGS"; then
  say "!!   PreToolUse matcher is neither the old nor the new value — not touching it."
  say "!!   Set it by hand to: $NEW_MATCHER"
else
  n=$(grep -cF "$OLD_MATCHER" "$SETTINGS")
  if [ "$n" != "1" ]; then
    say "!!   found $n copies of the old matcher, expected 1 — not touching it."
  else
    bak="$SETTINGS.bak-$STAMP"
    if [ -e "$bak" ]; then
      act "backup exists, kept: $bak"
    else
      act "backup: settings.json -> settings.json.bak-$STAMP"
      [ "$DRY" -eq 0 ] && cp -p "$SETTINGS" "$bak"
      backed=$((backed + 1))
    fi
    act "patch matcher -> $NEW_MATCHER"
    if [ "$DRY" -eq 0 ]; then
      tmp="$SETTINGS.tmp.$$"
      OLD_MATCHER="$OLD_MATCHER" NEW_MATCHER="$NEW_MATCHER" \
        python3 -c 'import os,sys
p=sys.argv[1]; s=open(p).read()
old=os.environ["OLD_MATCHER"]; new=os.environ["NEW_MATCHER"]
assert s.count(old)==1, "matcher count changed under us"
s=s.replace(old,new)
import json; json.loads(s)          # refuse to write invalid JSON
open(sys.argv[2],"w").write(s)' "$SETTINGS" "$tmp"
      mv "$tmp" "$SETTINGS"
    fi
    changed=$((changed + 1))
  fi
fi

# --- 5. isolation line in the local-orchestrator skill --------------------
# One line, appended once: the orchestrator must never address the 🥅 seat and
# never write in its repo (PLAN.md v2 §3.4.4).
say ""
say "skills/local-orchestrator/SKILL.md"
LO="$DEST/skills/local-orchestrator/SKILL.md"
ISO_MARK="Never address a 🥅 GOALKEEPER seat"
ISO_LINE="- **Never address a 🥅 GOALKEEPER seat; never write under \`~/.claude/goalkeeper/\`.** The goalkeeper is the operator's auditor, not a peer: it reads your files, you never reach it. Drift it finds comes back to you from the operator, in the operator's words."
if [ ! -f "$LO" ]; then
  say "!!   $LO not found — add the isolation line by hand."
elif grep -qF "$ISO_MARK" "$LO"; then
  say "     isolation line already present"
  skipped=$((skipped + 1))
else
  bak="$LO.bak-$STAMP"
  if [ -e "$bak" ]; then
    act "backup exists, kept: $bak"
  else
    act "backup: local-orchestrator/SKILL.md -> SKILL.md.bak-$STAMP"
    [ "$DRY" -eq 0 ] && cp -p "$LO" "$bak"
    backed=$((backed + 1))
  fi
  act "append isolation line"
  if [ "$DRY" -eq 0 ]; then
    printf '\n%s\n' "$ISO_LINE" >>"$LO"
  fi
  changed=$((changed + 1))
fi

# --- 6. summary -----------------------------------------------------------
say ""
say "----"
say "changed $changed   unchanged $skipped   backups made $backed   stamp $STAMP"
if [ "$DRY" -eq 1 ]; then
  say "DRY RUN — nothing was written. Re-run without --dry-run to install."
else
  say "Backups: $DEST/**/*.bak-$STAMP"
  say "If any live seat starts erroring, restore the guard first:"
  say "  cp $DEST/session-kind/guard.js.bak-$STAMP $DEST/session-kind/guard.js"
fi
