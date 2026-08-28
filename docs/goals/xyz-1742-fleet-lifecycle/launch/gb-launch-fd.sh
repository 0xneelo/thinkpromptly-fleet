# gb-launch-fd.sh <Name> <slug> <claude|gpt> [xhigh|high] — XYZ-1742 fleetdeck lanes
# Runs ON THE BOX in WSL bash, from a PLAIN terminal: wsl sh gb-launch-fd.sh Edith edith claude
set -u
NAME=$1; SLUG=$2; BREED=$3; EFF=${4:-xhigh}
REPO=$HOME/projects/remote-system
BRANCH=claude/xyz-1742-fleet-orgchart-c2b616
SES=FD-$SLUG; WT=$REPO/.claude/worktrees/$SLUG
CX=/home/vibe/.npm-global/bin/codex
PROMPT=$HOME/launch/launch-$SLUG.txt
[ -n "${CLAUDECODE:-}" ] && { echo "STOP: plain terminal only"; exit 1; }
[ -f "$PROMPT" ] || { echo "SKIP $NAME: $PROMPT missing"; exit 1; }
tmux has-session -t "=$SES" 2>/dev/null && { echo "STOP: $SES exists — attach it"; exit 1; }
ghtok() { curl -sf http://100.125.231.25:3131/api/ghtoken | python3 -c 'import json,sys;print(json.load(sys.stdin)["token"])'; }
gitcred() { GH_TOKEN=$(ghtok) git -c credential.helper= -c 'credential.helper=!f(){ echo username=x-access-token; echo password=$GH_TOKEN; }; f' "$@"; }
if [ ! -d "$REPO/.git" ]; then
  mkdir -p "$(dirname "$REPO")"
  gitcred clone https://github.com/0xneelo/thinkpromptly-fleet "$REPO" || { echo "STOP: clone failed — GitHub train open? repo exists?"; exit 1; }
fi
gitcred -C "$REPO" fetch origin || { echo "STOP: fetch failed — GitHub train open?"; exit 1; }
[ -d "$WT" ] || git -C "$REPO" worktree add "$WT" -b "agent-$SLUG" "origin/$BRANCH" || exit 1
if [ "$BREED" = gpt ]; then
  grep -qF "[projects.\"$WT\"]" "$HOME/.codex/config.toml" 2>/dev/null \
    || printf '\n[projects."%s"]\ntrust_level = "trusted"\n' "$WT" >> "$HOME/.codex/config.toml"
  CMD="$CX --dangerously-bypass-approvals-and-sandbox -m gpt-5.6-sol -c model_reasoning_effort='$EFF' \"\$(cat $PROMPT)\""
else
  CMD="claude --dangerously-skip-permissions \"\$(cat $PROMPT)\""
fi
tmux new-session -d -s "$SES" -c "$WT"
tmux send-keys -t "$SES" "sh ~/.claude/session-kind/mark.sh --worker $NAME 2>/dev/null; $CMD" Enter
ROLE=unknown; case $SLUG in edith) ROLE=backend-developer;; konrad) ROLE=devops-engineer;; alfons) ROLE=frontend-developer;; sylvia) ROLE=tooling-engineer;; esac
curl -s -X POST http://100.125.231.25:3131/api/registry -H "Content-Type: application/json" \
  -d "{\"host\":\"german-box\",\"name\":\"$SES\",\"group\":\"xyz-1742\",\"task\":\"XYZ-1742\",\"label\":\"$SLUG lane\",\"role\":\"$ROLE\",\"worker\":\"$NAME\"}" >/dev/null
echo "LAUNCHED $NAME → tmux attach -t $SES"
