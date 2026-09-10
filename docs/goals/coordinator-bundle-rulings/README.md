# coordinator-bundle-rulings — two standing operator rulings applied to the boot bundle

Project: **remote-system** / sub-project: **coordinator**. Worker: **Vitus · python-pro**, tag `agent-vitus`, box session `FD-coordinator-bundle-rulings`, branch `agent-coordinator-bundle-rulings`, base `origin/claude/local-orchestrator-f378c6` (Mac main + docs). Packaged by 🎛 ORCHESTRATOR 20, 2026-09-11, from 🧭 COORDINATOR 19 (lowcap portal), lowcap ledger D-387 thread. Run mode: GPT xhigh, /goal.

## The rulings (operator, verbatim, recorded in lowcap `coordinator/decisions-effective.md` on branch claude/portal-1aa6cd)

- **D-318** (2026-09-08 23:46Z, "raise the gate"): `coordinator/bundle.py:26` `BUNDLE_GATE_BYTES = 12288` → `16384`. `check.py` prints FAIL at 15,295 B on the lowcap board today; the portal overrides by hand every run.
- **D-304** (2026-09-08 18:40:52Z, operator click, card 2 = A): the boot bundle renders **one** evidence pointer per lane; the board keeps every link.

## Sizing (verified 2026-09-11)

- Gate: `coordinator/bundle.py:26`; enforced in `bundle.py:159-166` (`footer()`) and `coordinator/check.py:177-184` (`check_bundle()`, FAIL/WARN text). No test pins the literal; `check.py --selftest` references `bundle.BUNDLE_GATE_BYTES` symbolically.
- Evidence: `coordinator/bundle.py:92-108` `lane_full()`, lines 106-107 join ALL items of the lane's `evidence` list. The list is append-order with no per-entry timestamp; render the FIRST pointer (`evidence[0]`), the longest-standing proof. `coordinator/render.py:209-210` (the board) builds its own `ev_html` with every link — leave it untouched.
- Tests: `python3 coordinator/check.py --selftest` (add an assertion that `lane_full` emits exactly one pointer when two are attached, and that the footer uses 16384); `test/coordinator-api.test.js` via `node --test test/coordinator-api.test.js` (gate route asserts size only).

## Milestones — TWO atomic commits, so the portal can cherry-pick them

1. **M1 — D-318**: one commit, `bundle.py:26` only (+ the selftest assertion for the footer if it pins a value). Message: `fix(coordinator): boot-bundle gate 12288 → 16384 (D-318, operator 2026-09-08)`.
2. **M2 — D-304**: one commit, `bundle.py:106-107` + selftest assertion. Message: `fix(coordinator): the boot bundle shows one evidence pointer per lane; the board keeps every link (D-304)`.
3. **M3 — report**: `docs/goals/coordinator-bundle-rulings/REPORT.md` with both SHAs, the selftest output, and the cherry-pick line for the portal: `git cherry-pick <M1> <M2>` onto `agent-alaric-xyz-2026` (the detached worktree `.claude/worktrees/xyz-2026-tooling-4638804f` the lowcap portal runs; its committed gate is still 8192).

## Acceptance

1. `python3 coordinator/check.py --selftest` passes on the branch; `node --test test/coordinator-api.test.js` passes (with `FLEET_TEST_TAILNET_BIND=::1` if a listener binds).
2. `git diff origin/claude/local-orchestrator-f378c6..HEAD -- coordinator/` touches only `bundle.py` and `check.py` (selftest); `render.py` unchanged.
3. Both commits pushed; SHAs in REPORT.md and in the Linear issue (or LINEAR-PENDING.md).

## Constraints

Push only over the broker token (`tok=$(curl -sf http://100.125.231.25:3131/api/ghtoken | python3 -c 'import json,sys;print(json.load(sys.stdin)["token"])'); GH_TOKEN=$tok git push origin agent-coordinator-bundle-rulings`), `GH_TOKEN` env only. No ssh anywhere. Do not touch `coordinator/render.py`, the lowcap repo, or any worktree but your own. Linear unreachable → `LINEAR-PENDING.md` here.
