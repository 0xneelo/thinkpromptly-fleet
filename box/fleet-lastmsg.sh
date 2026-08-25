#!/usr/bin/env bash
# Master copy — installed on the box at /home/vibe/bin/fleet-lastmsg.sh (see README).
# One line per tmux session: <session><TAB><iso><TAB><msg|mtime>
# <iso> is the timestamp of the last assistant message in that pane's Claude Code
# transcript; a transcript whose tail holds no parseable assistant event falls back
# to the file's mtime. No network, no blocking reads — this must never hang.

PY=$(command -v python3)

# One pane per session (the first): panes of a session share the worker's cwd.
tmux list-panes -a -F '#{session_name}	#{pane_current_path}' 2>/dev/null |
  awk -F'\t' '!seen[$1]++' |
  while IFS=$'\t' read -r s p; do
    [ -n "$s" ] && [ -n "$p" ] || continue
    # Claude Code's project slug: every / and . in the cwd becomes a dash.
    dir="$HOME/.claude/projects/$(printf %s "$p" | tr '/.' '--')"
    [ -d "$dir" ] || continue
    f=$(ls -t "$dir"/*.jsonl 2>/dev/null | head -1) # newest = the live session
    [ -n "$f" ] || continue

    ts=""
    # Only the last 300k is scanned: transcripts run to hundreds of MB.
    [ -n "$PY" ] && ts=$("$PY" -c '
import sys, json, os
p = sys.argv[1]
sz = os.path.getsize(p)
with open(p, "rb") as f:
    if sz > 300000: f.seek(sz - 300000)
    data = f.read()
for line in reversed(data.split(b"\n")):
    try: o = json.loads(line)
    except Exception: continue
    if isinstance(o, dict) and o.get("type") == "assistant" and o.get("timestamp"):
        print(o["timestamp"]); break
' "$f" 2>/dev/null)

    if [ -n "$ts" ]; then
      printf '%s\t%s\tmsg\n' "$s" "$ts"
    else
      printf '%s\t%s\tmtime\n' "$s" "$(date -u -d @"$(stat -c %Y "$f")" +%Y-%m-%dT%H:%M:%SZ)"
    fi
  done
exit 0
