# Seat 20 queue — remote-system (🎛 ORCHESTRATOR 20, opened 2026-09-10)

Open items without a Linear ID (Linear MCP is not connected in this seat). Each line: owner · item · origin.

## Operator gates
- operator · **RE-MINT the deploy cert with principals `root,vibe,misterisley,tabor`** (keys page, Touch ID, 8h). Since 2026-09-11 00:21 local `current` is a `tabor`-only cert: gb-deploy, vps-deploy, german-box and the deck's bus all refuse; Ivo/Ysolde bus messages undelivered (o20-ysolde-review-1, o20-ivo-compile-2) · memory mint-repoints-current-for-all-aliases.
- operator · `./up.sh` restart of the Mac deck — covers 607cc86 usage-log table, 360f281 Accounts fix, 9d50afb vibes-asus chip, 4f4c1f8 Docs screen, 7c10bbf notify seat aliases, b50ba50 desktop snapshot removed (operator ruling) · 2026-09-11.
- operator · lowcap VPS `/etc/ssh-alert.env` chat id still annotated (digits + " private <name>"); Mac copy fixed. Word to seat 20 ("fix vps chat id") or answer the lowcap session · great-wescoff report ~19:20Z.

## Operator decisions
- operator · `machinesUsage()` in server.js still branches on `sample_ts`, dead since b50ba50 removed the desktop snapshot; removing it touches the /api/machines contract · live-usage-overview session 2026-09-11.
- operator · Ysolde Acceptance 1 baseline exception: two pre-existing suite failures (credits `3 !== 1`, v2 screens extra `goals`) — seat 20 rules after reproducing on base · Ysolde REPORT.md 1c1d12c.
- operator · vibes-asus: is it a fleet box whose sshd should trust the deploy CA? (sixth box, unknown to the rotation spec) · ssh-ca-rotation pack.
- operator · `machines.json` has no `vibes-asus` row (Windows box, user `tabor`) · Poppa weave brief 9d50afb.
- operator · password auth off on vibes-asus only after a proven cert login · same.
- operator · per-project `orchestrator` seats in `/api/seats` — Ysolde's M4 note will carry options + recommendation · lowcap seat 36 finding O20-SEATS-1.
- operator · ivy-box ssh-alert rollout: unassigned (onboarding-box is owned by the onboarding-app hardening session) · G3.

## Watching
- seat 20 · Ivo `FD-ssh-ca-rotation` (G5): M1–M5 + compile 1397a4a on origin; hunter found 12 (4 High), oracle pending — Ivo fixing from docs/goals/ssh-ca-rotation/AUDIT-2026-09-11.md; weave after fixes + verdict. Repo artifacts only; host applies gated per owner (think-box → lowcap seat D-90, onboarding-box → onboarding-app session, ivy-box → operator, german-box + rog-strix → seat 20 on word). Operator gates: S1 new CA in 1Password, S3 deploy users, S4 delete ~/.ssh/id_ed25519, S5 delete static keys.
- seat 20 · G4 Ysolde WOVEN 7c10bbf (main, pushed 2026-09-11 ~01:1xZ); Acceptance 1 baseline exception granted (ruling o20-ysolde-ruling-1); review fixes 0df8959 in. Remaining: Acceptance 2 live check on the Mac after the deck restart, then G4 → done.
- seat 20 · onboarding-box test results from the onboarding-app hardening session (confirm only).

## Landed by this seat
- 2026-09-10 G3 done · 360f281 Accounts weave · 9d50afb keys chip weave · main pushed at both.
