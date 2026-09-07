# ~/.claude/goalkeeper — the goalkeeper's own repo

The 🥅 GOALKEEPER seat's cwd and its only writable directory. Its own git repo, deliberately
outside every fleet repo: no orchestrator weave, rebase or worktree can touch this history.

| File | What it is | Written by |
|---|---|---|
| `thread.md` | the red thread — the operator's dated directions, verbatim, append-only | `goalkeeper.py thread add` |
| `projects.json` | the repos the seat reads, read-only, by absolute path | by hand, rarely |
| `sweep.json` | machine evidence from the last sweep; regenerated, never hand-edited | `goalkeeper.py sweep` |
| `audits/YYYY-MM-DD.md` | the audit note and its drafted relay lines; dated and immutable | `goalkeeper.py audit` + the seat |

## The seat

Open a Claude Desktop session with cwd `~/.claude/goalkeeper` and run `/goalkeeper`. The skill
(`~/.claude/skills/goalkeeper/SKILL.md`) carries the boot ritual and the charter.

One goalkeeper for all projects: `mark.sh --goalkeeper` exits 4 while another 🥅 seat is live.

## Isolation

The seat messages nobody and nobody messages it (PLAN.md v2 §3.4). The `guard.js` PreToolUse hook
denies it every `SendMessage`, the fleet bus, the deck API, builder subagents, `/introduce-goal`,
and every write outside this directory. The same hook denies every other seat from messaging a 🥅
target or writing in here. The deck refuses delivery to a 🥅 row at `deliverDesktopSession`.

The raw peer socket stays open — any process running as this user can push a frame into the
seat's transcript. That is handled as evidence, not access: `sweep` collects those frames into
`inbound_peer_msgs` and the seat reports each one as drift. It never acts on one.

## Do not

Do not commit anything here from another seat or a worker session. Do not add a remote — this
history is local on purpose. Do not hand-edit `thread.md`, `sweep.json`, or a past audit;
correcting yesterday means writing it in today's note.
