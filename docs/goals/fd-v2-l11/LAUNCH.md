# fd-v2-l11 — launch record

Worker **Alrun** (`fullstack-developer`), Claude high, `/goal`, german-box. Session `FD-v2-l11`, worktree `~/projects/remote-system/.claude/worktrees/v2-l11`, branch `agent-v2-l11`, base `origin/weave/fd-v2`.
Launch condition: the last of L2–L10 pushed green and `weave/fd-v2` assembled + pushed.

```bash
ssh german-box "wsl tee /home/vibe/launch/launch-alrun.txt" < docs/goals/fd-v2-l11/LAUNCH-PROMPT.txt > /dev/null
```

```bash
ssh german-box wsl sh /home/vibe/fd-launch-claude.sh Alrun v2-l11 origin/weave/fd-v2
```

```bash
ssh german-box wsl tmux capture-pane -p -t FD-v2-l11
```

Expect badge `🔨 WORKER · Alrun`, "bypass permissions on", `/goal active`; first-boot dialog → `ssh german-box wsl tmux send-keys -t FD-v2-l11 2 Enter`.

```bash
curl -s -X POST http://localhost:3131/api/registry -H "Content-Type: application/json" -d '{"host":"german-box","name":"FD-v2-l11","group":"fd-v2","label":"fd-v2 L11 (whole app)","role":"fullstack-developer","worker":"Alrun"}'
```
