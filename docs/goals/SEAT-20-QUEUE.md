# Seat 20 queue — remote-system (🎛 ORCHESTRATOR 20, opened 2026-09-10)

Open items without a Linear ID (Linear MCP is not connected in this seat). Each line: owner · item · origin.

## Operator gates
- operator · G5 host applies, in RUNBOOK order, each gated: S1 create the new CA inside 1Password (pub-only export) · S2 trust both CAs on 5 boxes (think-box via lowcap seat D-90, onboarding-box via onboarding-app session, ivy-box operator, german-box + rog-strix seat 20 on word) · S3 approve `deploy` accounts · S4 delete ~/.ssh/id_ed25519 · S5 retire/chain the four static keys. Runbook: docs/goals/ssh-ca-rotation/RUNBOOK.md (on main).
- operator · **RE-MINT the deploy cert with principals `root,vibe,misterisley,tabor`** (keys page, Touch ID, 8h). Since 2026-09-11 00:21 local `current` is a `tabor`-only cert: gb-deploy, vps-deploy, german-box and the deck's bus all refuse; Ivo/Ysolde bus messages undelivered (o20-ysolde-review-1, o20-ivo-compile-2) · memory mint-repoints-current-for-all-aliases.
- operator · **`./up.sh` once more**: bcd7ee6 (keys screen Legacy/Daily/Admin + mint route + machines.json login guard) plus e520030/1884722 docs-screen fixes are on main but not running (deck pid 90303 from 00:43). After the restart the keys page defaults to Legacy (root,vibe,misterisley,tabor) — the tabor-only footgun class is closed.
- operator · lowcap VPS `/etc/ssh-alert.env` chat id still annotated (digits + " private <name>"); Mac copy fixed. Word to seat 20 ("fix vps chat id") or answer the lowcap session · great-wescoff report ~19:20Z.

## Operator decisions
- operator · kill the leftover Opus test seat in local tmux `testseat` (researcher 3's experiment; its composer holds your unsubmitted line 'yes, that was my tamper test'): `tmux kill-session -t testseat`. Seat 20 does not kill sessions the operator typed into.
- operator · `machinesUsage()` in server.js still branches on `sample_ts`, dead since b50ba50 removed the desktop snapshot; removing it touches the /api/machines contract · live-usage-overview session 2026-09-11.
- operator · Ysolde Acceptance 1 baseline exception: two pre-existing suite failures (credits `3 !== 1`, v2 screens extra `goals`) — seat 20 rules after reproducing on base · Ysolde REPORT.md 1c1d12c.
- operator · vibes-asus: is it a fleet box whose sshd should trust the deploy CA? (sixth box, unknown to the rotation spec) · ssh-ca-rotation pack.
- operator · `machines.json` has no `vibes-asus` row (Windows box, user `tabor`) · Poppa weave brief 9d50afb.
- operator · password auth off on vibes-asus only after a proven cert login · same.
- operator · per-project `orchestrator` seats in `/api/seats` — Ysolde's M4 note will carry options + recommendation · lowcap seat 36 finding O20-SEATS-1.
- operator · ivy-box ssh-alert rollout: unassigned (onboarding-box is owned by the onboarding-app hardening session) · G3.

## Watching
- seat 20 · Vitus `FD-coordinator-bundle-rulings` (GPT xhigh, box): D-318 gate 12288→16384 and D-304 one evidence pointer per lane as two atomic commits for the lowcap portal to cherry-pick onto agent-alaric-xyz-2026; launched 2026-09-11 ~02:5x local; 🧭 COORDINATOR 19 waits for the Linear id (pack docs/goals/coordinator-bundle-rulings/).
- seat 20 · Bernward `bernward-deck-108` (Mac-local Claude worker, tmux, worktree .claude/worktrees/bernward-deck-108, branch agent-bernward/deck-108 from b76f5b5): DECK-108 deck click certification — operator sign-in, HMAC-signed Unblock answers, `fleetdeck-verify-answer` CLI. Launched 2026-09-11 ~02:2x local on the operator's verbatim prompt; runs in default permission mode until the operator sets auto mode in the pane. Gates it will file: root-600 deck secret file (sudo). DECK-109 design brief (researcher 3, 2026-09-11: Ed25519 + pinned pubkey instead of HMAC, passkey step-up, v1 signed string with expiry) landed on the seat branch as docs/research/deck-click-trust-brief-2026-09-11.md (cherry-pick of a98ab24) and on DECK-108/109 in Linear; pointer routed to Bernward over the bus once his permission dialog cleared.
- info · b76f5b5 on main: the test http.js honours FLEET_TEST_TAILNET_BIND so the suite runs without the 127.0.0.2 lo0 alias — XYZ-1896 gate and memory `test-suite-needs-lo0-alias` to be re-verified.
- info · Aylin's org usage-endpoint 403/429 is a one-hour lockout renewed by EVERY call; the deck made 3 calls all day, so the renewals come from her own CLI /usage or desktop app, not the deck (live-usage-overview probe from rog-strix, 2026-09-11). d55373f: automatic read every 8 h (operator ruling), FLEET_USAGE_EVERY_SECS overrides.
- seat 20 · G5 Ivo WOVEN bcd7ee6 (main, pushed 2026-09-11 ~02:05 local): all audit findings fixed (AUDIT-2026-09-11.md on the branch, 32 FIXED, 2 optional WONTFIX), Mac suites green, name released, badge cleared. Residual: the full suite was last run on the box before the audit fixes (Ivo's REPORT.md line ~156); rerun owed once a box session exists. Repo artifacts only; host applies gated per owner (think-box → lowcap seat D-90, onboarding-box → onboarding-app session, ivy-box → operator, german-box + rog-strix → seat 20 on word). Operator gates: S1 new CA in 1Password, S3 deploy users, S4 delete ~/.ssh/id_ed25519, S5 delete static keys.
- seat 20 · G4 Ysolde WOVEN 7c10bbf (main, pushed 2026-09-11 ~01:1xZ); Acceptance 1 baseline exception granted (ruling o20-ysolde-ruling-1); review fixes 0df8959 in. Acceptance 2 met 2026-09-11 00:45 local (three aliases resolvedVia=title after restart pid 90303). G4 DONE.
- seat 20 · onboarding-box test results from the onboarding-app hardening session (confirm only).

## Landed by this seat
- 2026-09-10 G3 done · 360f281 Accounts weave · 9d50afb keys chip weave · main pushed at both.
