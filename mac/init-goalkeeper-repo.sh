#!/bin/sh
# Create the goalkeeper's data repo at ~/.claude/goalkeeper from mac/goalkeeper-seed/.
#
#   sh mac/init-goalkeeper-repo.sh --dry-run
#   sh mac/init-goalkeeper-repo.sh
#
# Idempotent and non-destructive: an existing file is never overwritten, and an
# existing git repo is never re-initialised. This is the seat's own history —
# losing it loses the operator's recorded words.
set -eu

SRC=$(cd "$(dirname "$0")/goalkeeper-seed" && pwd)
DEST="${GOALKEEPER_HOME:-${CLAUDE_CONFIG_DIR:-$HOME/.claude}/goalkeeper}"
DRY=0
[ "${1:-}" = "--dry-run" ] && DRY=1

say() { printf '%s\n' "$*"; }
act() { [ "$DRY" -eq 1 ] && printf 'DRY  %s\n' "$*" || printf '     %s\n' "$*"; }

say "init $DEST$([ "$DRY" -eq 1 ] && echo '  [DRY RUN]')"

if [ "$DRY" -eq 0 ]; then mkdir -p "$DEST/audits"; fi

for rel in projects.json thread.md README.md; do
  if [ -f "$DEST/$rel" ]; then
    say "     exists, kept: $rel"
  else
    act "create: $rel"
    [ "$DRY" -eq 0 ] && cp "$SRC/$rel" "$DEST/$rel"
  fi
done

if [ -d "$DEST/.git" ]; then
  say "     git repo already initialised"
else
  act "git init + first commit"
  if [ "$DRY" -eq 0 ]; then
    git -C "$DEST" init -q
    git -C "$DEST" add -A
    git -C "$DEST" -c user.name="goalkeeper" -c user.email="goalkeeper@localhost" \
      commit -q -m "goalkeeper: data repo — thread.md, projects.json, audits/"
  fi
fi

say ""
if [ "$DRY" -eq 1 ]; then
  say "DRY RUN — nothing written."
else
  say "ready. Open a desktop session with cwd $DEST and run /goalkeeper."
fi
