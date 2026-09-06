#!/usr/bin/env sh
# remote-system CLAUDE worker launcher. Runs INSIDE WSL on german-box as vibe.
# Usage: sh ~/fd-launch-claude.sh <Name> <slug> <base-branch>   PLAIN terminal only.
# Same shape as fd-launch-gpt.sh; boots plain `claude` (the box config already defaults to bypass).
set -u
NAME=${1:?usage: fd-launch-claude.sh <Name> <slug> <base-branch>}
SLUG=${2:?usage: fd-launch-claude.sh <Name> <slug> <base-branch>}
BASE=${3:?base branch, e.g. origin/main or origin/agent-v2-s1}
REPO=$HOME/projects/remote-system
SES=FD-$SLUG
WT=$REPO/.claude/worktrees/$SLUG
PROMPT=$HOME/launch/launch-$(echo "$NAME" | tr '[:upper:]' '[:lower:]').txt
[ -n "${CLAUDECODE:-}" ] && { echo "STOP: plain terminal only (agent session detected)."; exit 1; }
command -v claude >/dev/null 2>&1 || { echo "STOP: claude missing on PATH"; exit 1; }
[ -f "$PROMPT" ] || { echo "SKIP $NAME: $PROMPT missing"; exit 1; }
tmux has-session -t "=$SES" 2>/dev/null && { echo "STOP $NAME: tmux $SES exists — attach it."; exit 1; }
tok=$(curl -sf --max-time 5 http://100.125.231.25:3131/api/ghtoken | python3 -c 'import json,sys;print(json.load(sys.stdin)["token"])' 2>/dev/null || true)
[ -n "$tok" ] || { echo "STOP $NAME: no broker token (GitHub train shut)"; exit 1; }
GH_TOKEN=$tok git -C "$REPO" fetch origin main "${BASE#origin/}" --quiet 2>/dev/null || GH_TOKEN=$tok git -C "$REPO" fetch origin main --quiet || { echo "FAIL $NAME: fetch"; exit 1; }
unset tok
[ -d "$WT" ] || git -C "$REPO" worktree add "$WT" -b "agent-$SLUG" "$BASE" || { echo "FAIL $NAME: worktree"; exit 1; }
tmux new-session -d -s "$SES" -c "$WT"
tmux send-keys -t "$SES" "sh ~/.claude/session-kind/mark.sh --worker $NAME 2>/dev/null; claude \"\$(cat $PROMPT)\"" Enter
echo "LAUNCHED $NAME $SES @ $WT on agent-$SLUG (base $BASE)"
