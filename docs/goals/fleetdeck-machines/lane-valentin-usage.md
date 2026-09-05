# Lane 2 — Valentin · fullstack-developer — usage per login + live sessions per machine

Goal G1 · Linear **XYZ-2113** (lane MAIN; parent XYZ-2111) · host **german-box** · tmux
`FD-valentin-machines` · worktree `/home/vibe/projects/remote-system/.claude/worktrees/valentin-machines-usage`
· branch `agent-valentin/machines-usage` from `origin/claude/account-usage-cronjob-29e68a`.

Read `context.md` first, then `public/machines.js`, `machinesView()` in `server.js`, and how
`public/accounts.js` renders usage windows.

## What the operator wants to see

Per machine, per client: the account it is signed in as (exists) **plus that account's current
usage**, and **which Claude/Codex sessions run on that machine**.

## Steps (each a Linear sub-issue under XYZ-2113, committed as a milestone)

1. **`npm ci`** in the worktree (node 24 on the box); `npm test` green before you change anything.
2. **Usage per login cell.** Source: the Credits pipeline's stored rows — `creditsRows()` in
   server.js, what `/api/credits` serves. Row keys: `id, kind, org, email, label, windows, state,
   tier, host, source, sample_ts, stale_windows, confirmed, seen, history`. Write a pure
   `machinesUsage(rows)` that returns a lookup; join Claude clients by org uuid (`c.org`, fallback
   `c.config_org`), Codex clients by email (`c.email`, lowercased). `machinesView()` attaches
   `usage: { windows, state, sample_ts, stale_windows }` per client (or `null`). **No new collection,
   no network**: a machines page load must never call `creditsCollect`; `?refresh=1` may.
3. **Render usage** in each login cell: compact bars per window with the sample age, the same
   semantics `accounts.html` uses. If `accounts.js` has a reusable renderer, factor the minimal
   shared helper into one common file both pages load; if it is not modular, copy the minimal
   rendering and say so in the report.
4. **Live sessions per machine.** Source: the registry rows behind `/api/sessions` (keys `host, name,
   worker, role, status, label, live, tmux_live, task, group, lease_state, epoch`). Map deck host →
   machine via a `host` field on each `machines.json` entry (`macbook: "mac"`, `german-box:
   "german-box"`, `onboarding-vps: "onboarding-box"` — Rhoda adds the identical field on her branch;
   keep the values identical). `machinesSessions(rows)` → per machine: live sessions
   (`name · worker · role/label · status`), count in the row header, and under the Claude CLI login
   row the line "N sessions run as <label or email>". The registry does not know the breed — make
   no Claude-vs-Codex claim per session unless a registry field carries it.
5. **Tests** in `test/machines.test.js`: usage join (matched, unmatched, stale sample), sessions
   join (live, gone, unknown host), and a no-leak assertion (no key named `token`, `access_token`,
   `refresh_token`, `cookie`, `authorization` anywhere in the `/api/machines` payload).
6. **Page rules**: `textContent` only, never `innerHTML` from data; colours and spacing from the
   `style.css` tokens; the page must stay readable with usage missing (`null`) and with zero sessions.
7. **Rebase, then push.** Before your final push: `git fetch origin`; if
   `origin/agent-rhoda/machines-land` exists, rebase onto it (Rhoda posts her SHA on XYZ-2112);
   resolve `machinesView` minimally — her key is `collecting`, yours are `usage` and `sessions`.
   Note the base you ended on in the report.

## Out of scope

The collector, `machines.json` routes/aliases, `machinesCollect`, the real ssh sweep (Rhoda's lane);
the deck restart (operator); anything in lowcap-connector.

## Box rules

- GitHub: no standing credential on the box. Per push:
  `tok=$(curl -sf http://100.125.231.25:3131/api/ghtoken | python3 -c 'import json,sys;print(json.load(sys.stdin)["token"])')`
  then `GH_TOKEN=$tok git push origin agent-valentin/machines-usage`. `GH_TOKEN` env only — never
  argv, URLs, files, logs. 503 → `operator:gate` "start a GitHub train", keep working. Never
  `gh auth login`.
- Registry: before the final report
  `curl -s -X POST http://100.125.231.25:3131/api/registry -H "Content-Type: application/json" -d '{"host":"german-box","name":"FD-valentin-machines","status":"done"}'`.
- Linear token expired and re-auth fails → commit the report as
  `docs/goals/fleetdeck-machines/reports/valentin.md` and push; never block on it.

## Report (comment on XYZ-2113)

What each cell and the Sessions block show (describe one real-shaped example), test count, pushed
SHA + `git ls-remote origin agent-valentin/machines-usage`, the base you rebased onto, and anything
you copied instead of sharing. Never a token, cookie, or header value.

## Done when

XYZ-2113 Done with that report; branch pushed and remote-verified; suite green. Release:
`python3 ~/.claude/workers/name.py close Valentin`; `sh ~/.claude/session-kind/mark.sh --clear`;
registry `status: done`.
