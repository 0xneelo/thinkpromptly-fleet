# Fleetdeck: merged Claude Desktop sessions page (all accounts, all machines)

Findings brief, 2026-09-06, from session "Fleet Deck Claude desktop sessions merge"
(Fable, worktree `.claude/worktrees/fleet-deck-desktop-sessions-merge-28a345`, no code written).
Operator ask: **build it all out** (slices 1-4).

## Data source (verified on the Mac)

Claude Desktop stores every Code-tab session as one JSON file, keyed by account and org:

```
~/Library/Application Support/Claude/claude-code-sessions/<accountUuid>/<orgUuid>/local_<sessionId>.json
```

Fields per file: `sessionId`, `cliSessionId`, `cwd`, `originCwd`, `worktreePath`, `worktreeName`,
`branch`, `sourceBranch`, `model`, `effort`, `createdAt`, `lastActivityAt`, `lastFocusedAt`,
`isArchived`, `title`, `titleSource`, `previousTitles`, `completedTurns`, `permissionMode`,
`bridgeSessionIds`, `writtenBranches`. No tokens. `deleted_<id>` marker files = deleted sessions.
`scheduled-tasks.json` sits next to them (skip it).

Accounts seen on the Mac (org uuid -> person map already used by the Credits view):

| accountUuid | orgUuid | person | sessions |
|---|---|---|---|
| 097e8f43-9275-40e8-a64f-ae8cd6f486fb | d24c4827-df47-40e3-af74-574418a03a4b | Aylin, aylianator@gmail.com | 239 |
| 75691b03-ddf5-47cd-b298-d21076bbee69 | c578669c-cdac-42d7-b451-13f3a3554d75 | Reiner, neelo@vibe.trading | 90 |
| bc450709-674e-4a07-b505-8ea3bd62767e | b14f597c-43a1-4b18-ab9d-a5ab74128546 | Lafayette, lafayette@infinite-holdings.llc | 247 |
| be25ab11-4696-444a-b1b7-3b287c0ca994 | 8323fe6e-fd4d-4f47-8a0d-7291a9da464c | Daniel, admin@deus.finance | 327 |

SAFETY: the collector must read ONLY the `claude-code-sessions/` subtree. Never touch
`config.json` in that dir (holds `oauth:tokenCache`).

## Joins the deck can already do

- **Live badge:** `server.js` `desktopSessions()` (~line 523) reads `~/.claude/sessions/<pid>.json`
  (pid alive + socket present). Its `sessionId` == the desktop file's `cliSessionId`.
- **Message a live row:** `deliverDesktopSession()` (~line 2215) already injects a message over the
  session's peer socket; `/api/messages` accepts `{type:'claude-desktop', session:<ListAgents name>}`.
- **Remote pull:** Machines page pattern — `machinesCollect()` (~line 1668) pipes `box/fleet-logins.sh`
  over `ssh <alias> [wsl] sh -s`, parses the last stdout JSON line, upserts sqlite with a TTL
  (`MACHINES_TTL` 300s), keeps per-id errors so stale rows still render. `machines.json` declares
  `route: local|ssh|push`, `ssh` alias, `wsl` flag.
- **Windows path (german-box, from WSL):**
  `/mnt/c/Users/*/AppData/Local/Packages/Claude_*/LocalCache/Roaming/Claude/claude-code-sessions/`
  — same layout expected (the sibling `plan-usage-history.json` is already read from there by
  fleet-logins.sh:185-214). Verify on first ssh.
- **Last message (optional, local only):** `~/.claude/projects/<cwd-slug>/<cliSessionId>.jsonl` last
  text line; `~/.claude/history.jsonl` has last prompts keyed by sessionId.

## Slices

1. `box/desktop-sessions.sh` — walk `claude-code-sessions/` (mac path; WSL glob on the box), emit
   one JSON line: `{v:1,id,host,os,ts,sessions:[{account,org,sessionId,cliSessionId,title,cwd,
   worktreeName,branch,model,createdAt,lastActivityAt,isArchived,deleted,completedTurns}]}`.
   Whitelist fields; never read anything else in the dir.
2. `GET /api/desktop-sessions[?refresh=1]` + sqlite table `desktop_sessions` (id=host+sessionId,
   payload, updated_at), TTL + per-host error map, same shape as Machines. Join live state from
   `desktopSessions()` for the local host. Org->person map reused from the Credits/Machines code.
3. `public/sessions.html` + `public/sessions.js`, nav link next to Machines in `index.html:20`.
   One table: person/account, machine, title, repo (originCwd basename), branch, model, last
   activity, turns, live/archived/deleted. Filters: account, machine, live-only, hide archived,
   text search. Row action on a live local row: send a bus message via `/api/messages`.
4. Remote hosts via `machines.json` routes: german-box (`gb-deploy`, wsl) now; rog-strix once its
   cert route is proven (no key authorized as of 2026-09-06 04:xx).

## Limits

- Undocumented app internals (desktop CLI 2.1.260). Can change on update; pin field whitelist.
- No embedding/attaching a desktop chat in the browser. List + message only.
- Plain-CLI (non-desktop) sessions are not in this store; `~/.claude/projects` would be a
  separate, account-less source.
