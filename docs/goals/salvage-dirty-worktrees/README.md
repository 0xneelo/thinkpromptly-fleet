# salvage-dirty-worktrees — rebase 17 finished-but-conflicting or held changes onto main

**Project:** remote-system · **sub-project:** fleetdeck-salvage · **worker:** Elfriede · git-workflow-manager (`agent-elfriede`) · **Linear:** DECK-110
**Packaged by:** 🎛 ORCHESTRATOR 11, 2026-09-12 (seat-11 sweep) · **Run mode:** GPT-6 Astra xhigh, `/goal`, german-box, branch `agent-salvage-dirty-worktrees` from `origin/main`.
**Launch gate:** unblock sheet `ub-ba823ee7` card `salvage-lane` (box-worker ⭐ / mac-local / drop) + an open key window. Seat 11 pushes every source branch when the train opens.

## Goal (one line)
Land every finished change that dead desktop sessions left behind: rebase each source branch onto today's `origin/main`, make the suite green, get a reviewer pass, and hand seat 11 one `weave/<slug>` branch per piece with a verdict.

## Pieces 1–12: finished code that conflicts with main
| # | branch | what | conflicts in |
|---|---|---|---|
| 1 | `claude/friendly-mendel-1f00f0` (eaa3c75) | TPL id tables refreshed after the last recompile + test deriving ids from app.js (card-in-sidebar bug). Supersedes `claude/card-sidemenu-bug-17b115`. | public/v2/screens/shell.js |
| 2 | `claude/account-overview-bug-5da4bb` (4b4f181) | credits rows dated by sample_ts/updated_at, not relay time; creditsWrite test seam | server.js |
| 3 | `claude/mystifying-cartwright-823132` (a92058d) | swallow EPIPE on ssh child stdin (an unreachable host crashed the deck); per-call argv-log files | server.js, test/machines.test.js, test/ssh-shim.sh |
| 4 | `claude/nostalgic-bardeen-efe9b2` (e0bc2e2) | spawnChild die-with-parent guard for test children | test/helpers.js, test/http.js, test/train-broker.test.js |
| 5 | `claude/send-feedback-popup-eef7dd` (6ce8b23) | #unblock Send opens a live delivery-status popup; route returns 502 on real bus failure | unblock.js, public/v2/screens/unblock.js, 2 tests — main now has the auto-close sheet (b38e35c) in the same files; keep both behaviours |
| 6 | `claude/fleetdeck-hour-limit-display-4e8eec` (41d4ab1) | credits keyed by the token's own /api/oauth/profile, not the stale ~/.claude.json email (real 2026-09-02 mis-attribution); worktree preview launch entry | .claude/launch.json, box/fleet-credits.sh, credits-accounts.json, server.js |
| 7 | `claude/cert-tooltips-6ff382` (baaa11a) | public/v2/tip.js dwell popovers replace native title tooltips; cert chips get descriptions | docs/design/fleetdeck-v2/improvised.md, public/v2/screens/keys.js |
| 8 | `claude/vps-systems-setup-29a121` (5659ac2) | rog-strix cert-route rollout: rs-deploy alias, machines.json route, keys.js PRINCIPALS — PARTIAL; README prose already on main; add the vibes-asus row here if card `vibes-asus` says so | README.md, deploy-keys/AGENT.md, deploy-keys/bootstrap-rog-strix.sh, deploy-keys/setup-rog-strix-ca.ps1, machines.json |
| 9 | `claude/mint-popup-live-view-88a9ca` | Keys page live mint-progress popup | public/v2 keys screen |
| 10 | `claude/fleetdeck-cascade-guard-alerts-953d07` | reaper cascade guard: burst hold + drain fix (memory `reaper-cascade-guard-never-reaped`; DECK-12 still fires every tick on the live deck) | server.js reaper |
| 11 | `claude/quizzical-bun-de980d` | ssh-shim test: atomic argv printf | test/ssh-shim.sh |
| 12 | `claude/data-accuracy-issue-ad0729` | Accounts page usage-accuracy fixes | accounts / server.js |

## Pieces 13–17: clean merges a reviewer HELD — fix the finding, then weave
| # | branch | what | finding to fix |
|---|---|---|---|
| 13 | `claude/compassionate-goldwasser-15a817` (458b726) | coordinator/check.py EVIDENCE_SHAPE / evidence_ok | regex anchors `https?://\S+` to end-of-string, so `https://linear.app/…/XYZ-2007 (comment 851a2cd5)` (a real board entry) fails, and single-segment paths like `README.md` fail; accept a URL followed by an annotation and one-segment paths; add both to the selftest |
| 14 | `claude/session-summary-skill-e5f400` | vendored session-summary skill (SKILL.md identical to the Mac copy) | add the `.claude/skills/session-summary -> ../../.agents/skills/session-summary` symlink (session-export ships one); inert without it |
| 15 | `claude/rox-strix-always-on-522ee1` | deploy-keys/rog-strix-always-on.ps1 (Windows always-on power settings) | lines 37–40: `$q` used in a `foreach` that was never opened, closed by a bare `}` → parse error, the whole `-EncodedCommand` block no-ops; fix the loop, add a `deploy-keys/README.md` pointer; must not touch Armoury Crate / dGPU settings |
| 16 | `claude/agent-last-msg-count-24fa3c` | box/fleet-lastmsg.sh counts Codex-breed workers | lines 24–28: the Codex fallback scans only the 80 most recently modified rollout files box-wide, so a long-idle worker drops out entirely; scan per cwd (or fall back to mtime); add a fixture test for the Codex path |
| 17 | `claude/gittrain-restart-interruptions-c4c351` | train broker lifecycle logging (DECK-10, 95c3e03) — reviewed WEAVE, additive logging only | conflicts with the trainGen change now on main (82e8b00) in fleetdeck-train.js; rebase, keep both |

Not in this lane: the three bus branches (`weave/messaging-live-sessions`, `claude/messaging-live-sessions-d52c83`, `claude/bus-connectivity-test-146955`) — card `xyz-2200-bus` decides them. `origin/agent-alaric-xyz-2026` is HELD under DECK-111 (boot-gate not instance-aware).

## Per piece (one Linear sub-issue each under DECK-110)
1. `git rebase origin/main` (or a merge if the history is worth keeping); resolve; if the piece is already on main by other commits → verdict SUPERSEDED, no branch.
2. `FLEET_TEST_TAILNET_BIND=::1 npm test` green. Never run `npm run v2:compile` — it clobbers public/v2/screens/*.js and logic.js (memory `fleetdeck-v2-compile-clobbers-hand-edits`).
3. Reviewer pass on the rebased diff (self-review for a Codex worker; quote findings in the issue comment).
4. Push `weave/<slug>` with the broker token; record the SHA in REPORT.md with verdict LANDED-CLEAN / REBASED / SUPERSEDED / DROPPED(reason).

## Acceptance
- REPORT.md lists all 17 with a verdict and a remote-verified SHA (`git ls-remote origin weave/<slug>`), suite result per piece, and the reviewer findings.
- No piece changes behaviour beyond its own description; #5 keeps the auto-close behaviour from b38e35c; #17 keeps trainGen.
- Seat 11 weaves the `weave/*` branches into main; the lane never pushes to main.

## Constraints
Broker token pushes only (`GH_TOKEN` env, re-fetched per push, never argv/URL/file/log); never 1Password; deck restart is operator-only; out-of-scope findings → Linear (`needs:general`) or LINEAR-PENDING.md if Linear is down.
