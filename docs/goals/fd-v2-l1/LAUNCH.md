# fd-v2-l1 — launch record

Worker **Juergen** (`frontend-developer`), Claude breed, effort high, `/goal` mode, german-box.
Session `FD-v2-l1`, worktree `~/projects/remote-system/.claude/worktrees/v2-l1`, branch `agent-v2-l1`,
base `origin/claude/fleetdeck-v2-redesign-plan-5a5cd5` (main + design docs + this pack + API fixtures).
Runs in parallel with S2 (Julius); no dependency on S1/S2 output.

## Pre-flight

```bash
python3 ~/.claude/session-kind/census.py | head -3          # no FD-v2-l1 already LIVE
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3131/api/ghtoken   # 200 = train open
ssh german-box qwinsta                                       # RDP holder (Vibe, Disc) present
```

## Transport + launch (Claude-breed launcher already on the box: `~/fd-launch-claude.sh`)

```bash
ssh german-box "wsl tee /home/vibe/launch/launch-juergen.txt" < docs/goals/fd-v2-l1/LAUNCH-PROMPT.txt > /dev/null
```

```bash
ssh german-box wsl sh /home/vibe/fd-launch-claude.sh Juergen v2-l1 origin/claude/fleetdeck-v2-redesign-plan-5a5cd5
```

## Verify

```bash
ssh german-box wsl tmux capture-pane -p -t FD-v2-l1
```

Expect badge `🔨 WORKER · Juergen`, "bypass permissions on", `/goal active`. First-boot dialog → `2`.

## Registry row (design seat, from the Mac)

```bash
curl -s -X POST http://localhost:3131/api/registry -H "Content-Type: application/json" -d '{"host":"german-box","name":"FD-v2-l1","group":"fd-v2","label":"fd-v2 L1 data layer","role":"frontend-developer","worker":"Juergen"}'
```
