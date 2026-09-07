# fd-v2-l8 — launch record

Worker **Kunhild** (`frontend-developer`), Claude high, `/goal`, german-box. Session `FD-v2-l8`, worktree `~/projects/remote-system/.claude/worktrees/v2-l8`, branch `agent-v2-l8`, base `origin/agent-v2-base`.
Launch condition: S2 pushed with parity 36/36 + report.json allPass, L1 merges cleanly.

```bash
ssh german-box "wsl tee /home/vibe/launch/launch-kunhild.txt" < docs/goals/fd-v2-l8/LAUNCH-PROMPT.txt > /dev/null
```

```bash
ssh german-box wsl sh /home/vibe/fd-launch-claude.sh Kunhild v2-l8 origin/agent-v2-base
```

```bash
ssh german-box wsl tmux capture-pane -p -t FD-v2-l8
```

Expect badge `🔨 WORKER · Kunhild`, "bypass permissions on", `/goal active`; first-boot dialog → `ssh german-box wsl tmux send-keys -t FD-v2-l8 2 Enter`.

```bash
curl -s -X POST http://localhost:3131/api/registry -H "Content-Type: application/json" -d '{"host":"german-box","name":"FD-v2-l8","group":"fd-v2","label":"fd-v2 L8 accounts","role":"frontend-developer","worker":"Kunhild"}'
```
