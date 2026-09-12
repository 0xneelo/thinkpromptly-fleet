# fd-v2-l12 — launch record

Worker **Hadwig** (`backend-developer`), Claude breed, effort high, `/goal` mode, german-box.
Launched 2026-09-07 by 🎨 DESIGN 35 after the bus delivery of L11.3 to Alrun never reached the pane
(bus said delivered; scrollback had no trace; Alrun's session was 22 min into one test turn).
Session `FD-v2-l12`, worktree `~/projects/remote-system/.claude/worktrees/v2-l12`, branch `agent-v2-l12`,
base `origin/weave/fd-v2` = `79cd53a` (the deployed candidate). Registry row posted. Alrun told over
the bus to ship L11.2 only and leave `sendFile` alone.

```bash
ssh german-box "wsl tee /home/vibe/launch/launch-hadwig.txt" < docs/goals/fd-v2-l12/LAUNCH-PROMPT.txt > /dev/null
ssh german-box wsl sh /home/vibe/fd-launch-claude.sh Hadwig v2-l12 origin/weave/fd-v2
ssh german-box wsl tmux capture-pane -p -t FD-v2-l12
```

Probe for the proof lives at `/home/vibe/launch/probe-scroll.cjs` on the box (Mac copy in the design
seat's scratchpad; source recorded in decisions.md "live defect 3").
