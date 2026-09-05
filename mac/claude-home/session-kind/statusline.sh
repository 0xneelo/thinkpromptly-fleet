#!/bin/sh
# Prepend the session-kind badge to Honey's statusline, without touching
# honey/statusline.js (Honey overwrites that file on update).
# A statusline must never error: stderr is muted and we always exit 0.
exec 2>/dev/null

DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
INPUT=$(cat)

CWD=$(printf '%s' "$INPUT" | /usr/bin/python3 -c 'import sys,json; print(json.load(sys.stdin).get("cwd") or "")')
if [ -n "$CWD" ]; then
  KEY=$(printf '%s' "$CWD" | shasum | cut -c1-12)
  FILE="$DIR/session-kind/marks/$KEY"
  # -mtime -1: a marker older than 24h is stale and must not mislead.
  if [ -n "$KEY" ] && [ -f "$FILE" ] && [ -n "$(find "$FILE" -mtime -1)" ]; then
    BADGE=$(cat "$FILE")
    [ -n "$BADGE" ] && printf '%s ' "$BADGE"
  fi
fi

if [ -f "$DIR/honey/statusline.js" ]; then
  printf '%s' "$INPUT" | node "$DIR/honey/statusline.js"
fi

exit 0
