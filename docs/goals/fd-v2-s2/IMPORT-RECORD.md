# S2 startup — input import record (DECK-32)

Worker Julius · `frontend-developer` · branch `agent-v2-s2` · 2026-09-07.

The pack's first action says the branch must be cut from `origin/agent-v2-s1` and the pack must exist
under `docs/goals/fd-v2-s2/`, else file `operator:gate` and stop. The branch check passed; the pack check
did not. This file records what was actually missing and how it was resolved, so the gate decision is auditable.

## Preflight results

| Check | Result |
|---|---|
| `git status -sb` shows `agent-v2-s2` tracking `origin/agent-v2-s1` | PASS |
| HEAD equals the S1 tip `39ae4ad` | PASS |
| `sh ~/.claude/session-kind/mark.sh --show` says Julius | PASS (`🔨 WORKER · Julius`) |
| `docs/goals/fd-v2-s2/` present in base | **FAIL — pack absent from every local ref, every remote ref in the S1 lineage, and from history** |
| `scripts/design-diff.mjs` + baselines present in base | **FAIL — present only on `origin/agent-v2-s0`** |
| `curl /api/ghtoken` | 200 (GitHub train open) |
| registry POST | `unauthorized` (known box-side 401, non-blocking) |

## Import 1 — the pack and the precedent tools (docs-only)

`docs/goals/fd-v2-s2/` and `docs/design/fleetdeck-v2/precedent/` existed only on
`origin/claude/fleetdeck-v2-redesign-plan-5a5cd5`. Identity was confirmed before merging: that branch's
`docs/goals/fd-v2-s2/LAUNCH-PROMPT.txt` is byte-identical to this session's launch prompt, and its
`LAUNCH.md` names this worktree, this branch and this base. DESIGN-35 then confirmed the same fix by message.

    git merge --no-edit origin/claude/fleetdeck-v2-redesign-plan-5a5cd5   # fbf6e0a, clean

Brought in: the pack (README, PROTOCOL, LAUNCH, LAUNCH-PROMPT, fd-launch-claude.sh), the four precedent
tools (`compile-dc.js`, `convert-pitch-v4-jsx.js`, `f2-parity.mjs`, `style-parity.mjs`) plus their README,
and the S2 rulings added to `plan.md` / `decisions.md`. 3207 insertions, 4 deletions. S1's evidence
(`verify/S1/`, `fd-v2-s1/REPORT.md`, `fd-v2-s1/LINEAR-PENDING.md`) was verified present afterwards.

## Import 2 — the pixel gate and its baselines

The README lists as Inputs "the pixel gate `scripts/design-diff.mjs` (S0), baselines under
`docs/design/fleetdeck-v2/baseline/`". Neither was reachable from `agent-v2-s1`: wave A ran S0 and S1 in
parallel off `main`, and S0's branch was never merged into S1's.

**This is the root cause of S1's missing gate.** S1's `REPORT.md` records the pixel gate as
"NOT RUN; no allPass claim", with all 18 screens x 2 themes "not run", because at S1's reference
`47dbabb` the script did not yet exist — S1 imported only the three devDependencies (commit `1dd2c56`).
S0's tip `cf88d29` does have the script (359 lines) and 37 baseline files.

    git merge --no-edit origin/agent-v2-s0    # 38f5335, clean, no conflicts

Verified afterwards: `scripts/design-diff.mjs` present, 37 baseline files present, S1's
`public/v2/index.html` and `public/v2/vendor/dc-runtime.js` intact, S1's five-extension MIME fix in
`server.js` intact.

## Why this is not a gate

The gate exists to catch a pack that was never written. The pack was written, is addressed to this
session by name, and was one merge away; the same is true of the gate script the pack names as an Input.
Importing declared inputs is execution, not re-scoping. No source file was modified by either merge.

## One thing the operator should know

**S1 is not green.** `docs/design/fleetdeck-v2/verify/S1/report.json` does not exist, and LAUNCH.md's
pre-flight ("launch only after S1 is pushed with a green gate") therefore cannot be satisfied as written.
S1 delivered its port, its MIME fix and its network proof, but never its pixel gate. S2 proceeds because
the missing piece was the un-merged gate — now in hand — and because S2's own acceptance re-proves the
same 36-screen surface against the same baselines. If the operator wants S1 formally closed first, that
is an `operator:decision`; S2's gate run will produce the evidence either way.

DESIGN-35 also advised that Waldemar may still push a gate report and small fixes to `agent-v2-s1`;
this branch will merge `origin/agent-v2-s1` once more before the final gate run.

Signed **Julius**.

---

## Update 2026-09-07 — S1 accepted, superseding the caveat above

DESIGN-35 confirmed S1 is final and accepted at `origin/agent-v2-s1` @ `70c32bb`, carrying its own
36/36 gate report, S0's `scripts/design-diff.mjs` and the devDependencies. Merged into `agent-v2-s2`:

    git fetch origin agent-v2-s1 && git merge --no-edit origin/agent-v2-s1   # clean, no conflicts

Checked before merging: `public/v2/index.html`, `scripts/design-diff.mjs`, `server.js` and `package.json`
are **byte-identical** between my branch and S1's accepted tip, so the merge added only evidence and docs
and could not disturb the compiler work in flight. After the merge, `template.dc.html` and
`pass1/index.html` still hash to `96be98b6…03d755` — they remain byte-identical to the accepted pass 1.

**The "S1 is not green" caveat above is therefore resolved.** It was accurate when written and is kept
rather than rewritten, because the reason it was true — S0's gate living on an unmerged branch — is the
finding worth preserving.

Cross-validation worth recording: S1's accepted `verify/S1/report.json` and my independent
`verify/S1-pass1-recheck/report.json` were produced by separate runs on different ports (4181 vs 3199)
and agree exactly — `allPass: true`, 36 results, max mismatch `0.03294753086419753`. The gate is
reproducible to the digit.
