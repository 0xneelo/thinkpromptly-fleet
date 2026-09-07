# fd-v2-l11 — Mac-side references to the old deck URLs (design seat edits these at cut-over)

Grep 2026-09-07 over `~/.claude/{skills,CLAUDE.md,session-kind,workers}` for `localhost:3131/` UI paths (API paths excluded).
After L11, `/keys.html` etc. answer with a 302 to `/app#keys`, so nothing breaks; the docs are updated for clarity.

| File | Line | Today | After cut-over |
|---|---|---|---|
| `~/.claude/skills/clean-german-box/SKILL.md` | 8 | `http://localhost:3131` (dashboard) | `http://localhost:3131/app` |
| `~/.claude/skills/german-box-workers/SKILL.md` | 125 | `localhost:3131` tiles | `localhost:3131/app` |
| `~/.claude/skills/german-box-workers/SKILL.md` | 393 | `localhost:3131/keys.html` (GitHub train) | `localhost:3131/app#keys` |
| `~/.claude/skills/local-orchestrator/SKILL.md` | 366-367, 395, 412 | `localhost:3131/keys.html` | `localhost:3131/app#keys` |
| `~/.claude/skills/local-orchestrator/SKILL.md` | 502 | probe `localhost:3131` | unchanged (probe hits `/api/ghtoken`) |
| repo `.claude/launch.json` | `fleetdeck` config | `http://localhost:3131` | `http://localhost:3131/app` (L11 edits this one in-repo) |
| memory `fleetdeck-app.md` | — | `npm start → http://localhost:3131` | add: `/` = landing, `/app` = deck, `/deck` = investor deck |

Owner: 🎨 DESIGN 35, done in the same hour L11 pushes green (skills are outside the repo; L11 lists any further hits it finds in its REPORT).
