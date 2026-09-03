---
name: session-summary
description: Scan every Claude Code session on this Mac that was active in the last N days (default 7, all projects and worktrees) and produce one table — session name, project, a two-sentence summary of the problem worked on, and whether it was solved or is still open. Use when asked to /session-summary, "summarize my sessions", "what did we work on this week", "which sessions are still open", "weekly session review", or for a cross-project retro. Reads local transcripts only; fans the summarizing out to reader subagents.
---

# session-summary

Three steps: scan → one `reader` per pack → render. Budget: ~10 s scan, then one parallel reader round.

## 1. Scan

```bash
python3 ~/.claude/skills/session-summary/scan.py --days 7
```

Prints the run dir `D` and `N sessions → M packs (batch-01 … batch-MM)`. Each pack holds
≤15 sessions as excerpts: opening prompts + closing messages, tool noise stripped.

## 2. Summarize — one `reader` subagent per pack, ALL launched in ONE message

Prompt per pack (fill `D` and `NN`, keep the rest verbatim):

> Read `D/batch-NN.md`. It holds excerpts of Claude Code sessions, one `## #<n> · <session-id>` block each (opening prompts, then closing messages).
> For EVERY block produce `{"n": <n from the heading>, "id": "<session-id>", "summary": "<exactly 2 sentences: 1) the problem or task the session worked on; 2) what happened and where it ended>", "status": "solved" | "open" | "none"}`.
> `solved` = the task from the opening prompts was completed and the closing messages confirm it (fix landed, answer delivered, file / PR / deploy done).
> `open` = still in progress, blocked, waiting on the operator, handed off to another session or worker, or ended mid-task.
> `none` = nothing to solve (a question answered, chat, a seat that only routed, aborted before work) — still write the 2 sentences.
> Judge from the closing messages first; a written plan is not `solved`.
> Write the JSON array (every block, same order) to `D/summaries/batch-NN.json` with `python3` + `json.dump` via a Bash heredoc. Reply with exactly one line: `batch-NN: <count> sessions`. No summaries in the reply.

If a reader says it could not write the file, ask it to return the JSON and save it yourself with a heredoc.

## 3. Render

```bash
python3 ~/.claude/skills/session-summary/render.py D
```

Writes `D/summary.md` and prints its path, then `re-run readers for: batch-NN` for any pack
that is missing or unparsable. Re-run those readers, render again.

## 4. Hand over

Paste the header line and the table. Above ~40 rows, attach `D/summary.md` with SendUserFile
and paste only the header plus the 10 most recent `🟡 open` rows. End with one next step (usually: pick an
open session to resume).

Table columns: `# · Session (🟢 = still running) · Project (repo ⎇ worktree) · Last active · What happened · Status`.

## Options (`scan.py`)

| Flag | Default | Meaning |
|---|---|---|
| `--days N` | 7 | window; a session counts when its last message is inside it |
| `--batch N` | 15 | sessions per pack = per reader |
| `--first N` / `--tail N` | 2 / 6 | opening prompts / closing messages kept per session |
| `--chars N` | 1000 | per-message cap; long messages keep head + tail |
| `--min-turns N` | 2 | drop sessions with fewer prompts + replies |
| `--out DIR` | `~/.claude/session-exports/summary/<stamp>` | run dir |

## What it reads (local, read-only)

| Source | Used for |
|---|---|
| `~/.claude/projects/<mangled-cwd>/<id>.jsonl` | messages, `custom-title` / `ai-title`, cwd, branch |
| `~/.claude/sessions/<pid>.json` | 🟢 live marker (pid alive + session id) |

Skipped: subagent transcripts (`<id>/subagents/`), sidechains, tool calls and results,
thinking, hook output, system reminders. Slash commands survive as `/name args`.

## Limits

- This Mac only. german-box tmux workers keep their transcripts on the box.
- Session name = custom title → AI title → first prompt line. Untitled seats show their
  first prompt, often the priming slash command.
- Status is the reader's judgement from the last six messages; verify before acting on `solved`.
