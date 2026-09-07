# fd-v2-l9 — launch record

Worker **Eckbert** (`frontend-developer`), Claude high, `/goal`, german-box. Session `FD-v2-l9`, worktree `~/projects/remote-system/.claude/worktrees/v2-l9`, branch `agent-v2-l9`, base `origin/agent-v2-base`.
Launch condition: S2 pushed with parity 36/36 + report.json allPass, L1 merges cleanly.

```bash
ssh german-box "wsl tee /home/vibe/launch/launch-eckbert.txt" < docs/goals/fd-v2-l9/LAUNCH-PROMPT.txt > /dev/null
```

```bash
ssh german-box wsl sh /home/vibe/fd-launch-claude.sh Eckbert v2-l9 origin/agent-v2-base
```

```bash
ssh german-box wsl tmux capture-pane -p -t FD-v2-l9
```

Expect badge `🔨 WORKER · Eckbert`, "bypass permissions on", `/goal active`; first-boot dialog → `ssh german-box wsl tmux send-keys -t FD-v2-l9 2 Enter`.

```bash
curl -s -X POST http://localhost:3131/api/registry -H "Content-Type: application/json" -d '{"host":"german-box","name":"FD-v2-l9","group":"fd-v2","label":"fd-v2 L9 machines","role":"frontend-developer","worker":"Eckbert"}'
```
