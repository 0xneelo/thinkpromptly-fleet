# fd-v2-l2 — launch record

<<<<<<< HEAD
Worker **Renate** (`frontend-developer`), Claude high, `/goal`, german-box. Session `FD-v2-l2`, worktree `~/projects/remote-system/.claude/worktrees/v2-l2`, branch `agent-v2-l2`, base `origin/agent-v2-s2`.
=======
Worker **Renate** (`frontend-developer`), Claude high, `/goal`, german-box. Session `FD-v2-l2`, worktree `~/projects/remote-system/.claude/worktrees/v2-l2`, branch `agent-v2-l2`, base `origin/agent-v2-base`.
>>>>>>> claude/fleetdeck-v2-redesign-plan-5a5cd5
Launch condition: S2 pushed with parity 36/36 + report.json allPass, L1 merges cleanly.

```bash
ssh german-box "wsl tee /home/vibe/launch/launch-renate.txt" < docs/goals/fd-v2-l2/LAUNCH-PROMPT.txt > /dev/null
```

```bash
<<<<<<< HEAD
ssh german-box wsl sh /home/vibe/fd-launch-claude.sh Renate v2-l2 origin/agent-v2-s2
=======
ssh german-box wsl sh /home/vibe/fd-launch-claude.sh Renate v2-l2 origin/agent-v2-base
>>>>>>> claude/fleetdeck-v2-redesign-plan-5a5cd5
```

```bash
ssh german-box wsl tmux capture-pane -p -t FD-v2-l2
```

Expect badge `🔨 WORKER · Renate`, "bypass permissions on", `/goal active`; first-boot dialog → `ssh german-box wsl tmux send-keys -t FD-v2-l2 2 Enter`.

```bash
curl -s -X POST http://localhost:3131/api/registry -H "Content-Type: application/json" -d '{"host":"german-box","name":"FD-v2-l2","group":"fd-v2","label":"fd-v2 L2 shell","role":"frontend-developer","worker":"Renate"}'
```
