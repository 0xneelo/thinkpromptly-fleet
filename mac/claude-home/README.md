# claude-home — vendored sources for the operator's `~/.claude`

`~/.claude` is not a git repo, so fleet workers cannot patch it. Sources that the fleet
maintains live here; the operator syncs them with `mac/install-claude-home.sh` (operator-only,
like `install-train-agent.sh`). Never copy `session-kind/marks/` or `numbers.db` — that is live state.

Snapshot taken 2026-09-05 from `~/.claude/skills/adhd-goals` and `~/.claude/session-kind`.
