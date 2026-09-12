---
name: session-export
description: Collect every live Claude Code session whose cwd is inside this repo (main checkout + all worktrees) and write their last messages into one markdown file — a seat-by-seat snapshot of what each session is doing right now. Use when asked to /session-export, "export the sessions", "what is every session in this repo doing", "collect the last messages of all active sessions", "give me a session digest/overview", or before an orchestrator seat handoff. Local sessions on this Mac only; it never messages a session (use `notify` for that).
---

# session-export

## Quick start

```bash
python3 .agents/skills/session-export/collect.py
```

Prints the path of the file it wrote:
`~/.claude/session-exports/<repo>/sessions-<YYYY-MM-DD-HHMM>.md`.

Read that file, then give the operator a 3–6 line summary — one line per session,
newest first — and the path. Attach it with SendUserFile when the operator is away.

## Options

| Flag | Default | Meaning |
|---|---|---|
| `--repo PATH` | cwd | any path inside the target repo |
| `-n, --messages N` | 6 | messages kept per session |
| `--chars N` | 1200 | max characters per message before truncation |
| `--out FILE` | see above | write somewhere else (e.g. into `docs/`) |
| `--stdout` | off | print the markdown instead of writing a file |
| `--json` | off | machine-readable output (same data, for further processing) |

Keep `-n` small. `-n 20 --chars 4000` on a busy repo produces a file too large to
read back into context in one pass — export it, then grep it.

## What counts as "active"

A session is included when its process is alive **and** its cwd is inside the repo.
Liveness comes from `~/.claude/sessions/<pid>.json` plus a `kill -0` check, so both
Claude Desktop and CLI sessions are covered, and stale registry entries drop out.

Repo membership is `git worktree list` from the main checkout — the main repo and every
linked worktree, including `.claude/worktrees/*`.

## What it reads (read-only, local)

| Source | Used for |
|---|---|
| `~/.claude/sessions/<pid>.json` | live sessions: pid, cwd, session id, title |
| `~/.claude/projects/<mangled-cwd>/<session-id>.jsonl` | the messages (last 2 MB of each transcript) |
| `~/.claude/session-kind/marks/` | seat badge — 🎛 ORCHESTRATOR N / 🔬 RESEARCHER N / 🔨 WORKER · Name |

Kept: operator and assistant prose. Dropped: thinking, tool calls, tool results,
subagent sidechains, hook output, system reminders, slash-command wrappers. A session
that has only run tools since its last reply shows its previous prose, not silence.

## Limits

- **This Mac only.** tmux workers on the german-box keep their transcripts on that box —
  they are not in the export. Ask them directly with `notify`.
- A seat badge is matched by session id, falling back to cwd; a reused worktree can
  therefore show the badge of the seat that stamped it.
- The calling session appears too, marked `◀ this session`.
