# R4 findings — account-usage cron + Machines page (2026-09-06)

From: 🔬 RESEARCHER 4 (worktree fleetdeck-notify-seat-delivery-bf2b7a, branch claude/account-usage-cronjob-29e68a).
To: 🎛 ORCHESTRATOR 32 (remote-system). Read-only probes; no source changed. One builder overwrite of
box/fleet-logins.sh was reverted to HEAD before this brief; the tree is clean.

## F1 — there is NO scheduled usage collection. The pack assumes one.
- `creditsCollect` runs only on `GET /api/credits` (server.js:2260) behind a 60 s TTL (server.js:1082). The only
  `setInterval` in server.js is `reaperLoop` (server.js:2497). Nothing collects while the Accounts page is closed.
- `lane-valentin-usage.md:18-19` says the Machines usage column reads "the Credits pipeline's stored rows", and
  `context.md:8-9` lists the half-hourly cron as ask #1 "already existing". Both are wrong: the stored rows are as
  old as the last Accounts page load. The Machines page will show stale usage unless someone opens Accounts.
- Fix is small and separable: run `creditsCollect(true)` at boot and every 30 min, append one credits_history
  point per org per live read (today history comes only from the desktop app's own samples, server.js:1072).
  Load: 3 machines × 2 calls/h — far under the 429 threshold in memory ai-account-usage-sources.
- Not "log in": no refresh flow exists and credentials entry is off-limits. It piggybacks on the CLI tokens that
  Claude Code refreshes whenever it runs; workers on the boxes keep them live. Codex stays passive (rollout jsonl).

## F2 — the landed Machines page (505d53a) is not on the running deck
- Running deck = main checkout at db759a1 [agent-zachary]; `git merge-base --is-ancestor 505d53a db759a1` = no;
  `GET :3131/machines.html` → 404. Operator sees it only after merge + `./up.sh` (operator-only).

## F3 — probe results that close pack open questions (context.md:61-66)
- Codex desktop (mac) uses `~/.codex` as its home: `dictation-history/`, `attachments/`, `computer-use/`,
  `ambient-suggestions/`, `generated_images/` live there; Chromium `Preferences`/`Local State` carry no
  `account_info`. So `~/.codex/auth.json` IS the desktop login — the landed collector's "shares auth.json" is right.
- Claude desktop org→email: all four org uuids in `plan-usage-history.json` are already mapped in
  `credits-accounts.json` (`machineLabeler` resolves them); "1 of 4 resolved" is stale.
- Fleet state 2026-09-06 (identity fields only, no tokens read): mac — Claude CLI lafayette (profile-proved,
  tier default_claude_max_20x), Codex admin@deus.finance pro (id token exp passed → state `expired`, renews on
  next run), Claude desktop last active as org d24c4827 (Aylin); german-box WSL — Claude CLI admin@deus.finance
  org 8323fe6e, Codex pro; german-box Windows side — same emails, Codex auth.json stale (plan `plus`, refreshed
  2026-05-27), no Codex desktop; onboarding-vps — Codex only (pro); ivy-vps — Codex only (pro, refreshed
  2026-06-18); think-box — nothing logged in. rog-strix — no ssh route, no trace anywhere in repo/ssh config/memory.

## F4 — two unmerged Credits branches touch the same seam
- `claude/fleetdeck-hour-limit-display-4e8eec` (worktree root-selection-onboarding-vps-f096cf): UNCOMMITTED
  profile-identity fix for fleet-credits.sh (+45/−5) + server.js (+18) + test/credits.test.js. Without it the
  Accounts page can file a token's usage under the config-file email (the 2026-09-02 Aylin/Lafayette misfile).
- `claude/data-accuracy-issue-ad0729`: 2 commits, model-scoped weekly parsing, not on main; the running deck
  already shows `seven_day_fable`, so the deck runs code ahead of main.

## Suggested routing
1. Add the 30-min timer + live history points as a lane (owner: Rhoda's seam or a new worker). ~30 lines + test.
2. Have the hour-limit worktree session commit its identity fix before Machines usage column ships.
3. rog-strix stays `push`; the operator:gate in lane-rhoda-land.md:56-59 already covers it.
