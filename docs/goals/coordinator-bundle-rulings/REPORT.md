# coordinator-bundle-rulings — landed (seat 20, 2026-09-11)

Vitus (python-pro, box session FD-coordinator-bundle-rulings) delivered three commits on `agent-coordinator-bundle-rulings` (f3265e5 M0, a7a8a2c M1, 2eb093a M2); goal achieved, badge cleared, name released by seat 20. His own REPORT.md stayed uncommitted in his worktree; this file replaces it. Linear: **PENDING** (box Linear OAuth `oauth_token_invalid_grant`); the issue text is in LINEAR-PENDING.md.

Woven onto Mac main b76f5b5 by cherry-pick (main SHAs, the ones to cite):

| Milestone | main SHA | what |
|---|---|---|
| M0 | 360e3d5 | test(coordinator): selftest uses fixed fixtures, not the live board (inherited failure; three lines in check.py) |
| M1 | c1a1a36 | fix(coordinator): boot-bundle gate 12288 → 16384 (D-318) |
| M2 | 3631cff | fix(coordinator): the boot bundle shows one evidence pointer per lane; the board keeps every link (D-304) |

Verification on the merged tree (Mac): `python3 coordinator/check.py --selftest` → SELFTEST PASS (66 assertions); `FLEET_TEST_TAILNET_BIND=::1 node --test test/coordinator-api.test.js` → 41 pass, 0 fail. `coordinator/render.py` untouched.

For the lowcap portal (runs the tooling from the detached worktree `.claude/worktrees/xyz-2026-tooling-4638804f`, commit 4638804f = `agent-alaric-xyz-2026`, committed gate still 8192): `git cherry-pick c1a1a36 3631cff` (add `360e3d5` first if the selftest runs there). Both apply to bundle.py/check.py only.
