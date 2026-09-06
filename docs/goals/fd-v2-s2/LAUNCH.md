# fd-v2-s2 — launch record

Worker **Julius** (`frontend-developer`), Claude breed, effort high, `/goal` mode, german-box.
Session `FD-v2-s2`, worktree `~/projects/remote-system/.claude/worktrees/v2-s2`, branch `agent-v2-s2`,
base `origin/agent-v2-s1` (S1's branch: main + design docs + pass-1 port). **Launch only after S1 is green.**

## Pre-flight (all must pass)

```bash
git fetch origin agent-v2-s1 && git show origin/agent-v2-s1:docs/design/fleetdeck-v2/verify/S1/report.json | python3 -c 'import json,sys;print("S1 allPass:",json.load(sys.stdin).get("allPass"))'
python3 ~/.claude/session-kind/census.py | head -3          # no FD-v2-s2 already LIVE
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3131/api/ghtoken   # 200 = train open
ssh german-box qwinsta                                       # RDP holder session (Vibe, Disc) present
```

## Launcher (Claude breed, no bypass flag — the box's Claude config already boots in bypass)

`fd-launch-claude.sh` in this directory = the box's `fd-launch-gpt.sh` with the codex line replaced by plain `claude`.
Transport once:

```bash
ssh german-box "wsl tee /home/vibe/fd-launch-claude.sh" < docs/goals/fd-v2-s2/fd-launch-claude.sh > /dev/null
```

## Transport the prompt

```bash
ssh german-box "wsl tee /home/vibe/launch/launch-julius.txt" < docs/goals/fd-v2-s2/LAUNCH-PROMPT.txt > /dev/null
```

## Launch

```bash
ssh german-box wsl sh /home/vibe/fd-launch-claude.sh Julius v2-s2 origin/agent-v2-s1
```

## Verify

```bash
ssh german-box wsl tmux capture-pane -p -t FD-v2-s2
```

Expect the badge `🔨 WORKER · Julius`, the status line showing bypass permissions, and the `/goal` line
accepted (not sitting after `>`; a `/goal` reject means the objective exceeded 4000 chars — see memory
`goal-objective-4000-char-cap`). A first-boot "set auto mode as default?" dialog is answered with `2` (keep bypass):
`ssh german-box wsl tmux send-keys -t FD-v2-s2 2 Enter`. Fast mode is unavailable on the box account; do not send `/fast`.

## Registry row (design seat, from the Mac, at launch)

```bash
curl -s -X POST http://localhost:3131/api/registry -H "Content-Type: application/json" -d '{"host":"german-box","name":"FD-v2-s2","group":"fd-v2","label":"fd-v2 S2 pass-2 compile","role":"frontend-developer","worker":"Julius"}'
```
