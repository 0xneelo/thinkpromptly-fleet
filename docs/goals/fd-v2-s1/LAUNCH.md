# fd-v2-s1 — launch record

Worker **Waldemar** (`frontend-developer`), GPT Astra 6 xhigh, `/goal` mode, german-box.
Session `FD-v2-s1`, worktree `~/projects/remote-system/.claude/worktrees/v2-s1`, branch `agent-v2-s1`,
base `origin/claude/fleetdeck-v2-redesign-plan-5a5cd5` (main + design docs + this pack).

## Pre-flight (all three must pass)

```bash
python3 ~/.claude/session-kind/census.py | head -3          # no FD-v2-s1 already LIVE
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3131/api/ghtoken   # 200 = train open
ssh german-box qwinsta                                       # RDP holder session present
```

## Transport the prompt (stdin pipe; remote side quote-free)

```bash
ssh german-box "wsl tee /home/vibe/launch/launch-waldemar.txt" < docs/goals/fd-v2-s1/LAUNCH-PROMPT.txt > /dev/null
```

## Launch (box launcher `~/fd-launch-gpt.sh <Name> <slug> <base> [effort]`)

```bash
ssh german-box wsl sh /home/vibe/fd-launch-gpt.sh Waldemar v2-s1 origin/claude/fleetdeck-v2-redesign-plan-5a5cd5 xhigh
```

## Verify (banner must show `model: gpt-6-astra xhigh` and `permissions: YOLO mode`)

```bash
ssh german-box wsl tmux capture-pane -p -t FD-v2-s1
```

## Registry row (design seat, from the Mac, at launch)

```bash
curl -s -X POST http://localhost:3131/api/registry -H "Content-Type: application/json" -d '{"host":"german-box","name":"FD-v2-s1","group":"fd-v2","label":"fd-v2 S1 verbatim port","role":"frontend-developer","worker":"Waldemar"}'
```

The worker adds `task` (its main Linear key) itself and sets `status: done` on finish.
