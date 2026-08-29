# GOAL — Coordinator v0.2 (XYZ-1827) — Alistair · platform-engineer

Repo `thinkpromptly-fleet`, branch `agent-alistair` off
`claude/xyz-1742-fleet-orgchart-c2b616`. The coordinator here is CANONICAL (the lowcap
copy is superseded — see `docs/coordinator/IMPORTED.md`).

## Read first, in order

1. `docs/goals/coordinator-v02/OPERATOR-RULINGS-2026-08-29.md` — **the authority.** R1–R4
   amend everything below.
2. `docs/coordinator/v02-scope-proposal.md` — M1–M5 as proposed (ported from the research
   branch; compaction M5 is a DEPENDENCY of M1/M3, not cleanup — bundle is at 87% of the
   8KB gate with 4 lanes).
3. `docs/coordinator/DESIGN-v1.md` §2, §2a, §3, §4, §9 — binding EXCEPT where R1–R4
   override (notably §4's hard cap: abolished by R3).
4. v0.1 as built: `coordinator/`, `.claude/skills/coordinator-run/`, `coordinator-portal/`.

## Deliverables

- **M1–M5 per the proposal**, with M1 acceptance hardened per the recorded gap: *an
  applied sitrep MUST leave an archive artefact, and run counters MUST be derivable from
  the artefacts alone* (the lowcap "1 applied with no artifact" incident,
  `coordinator/inbox/archive/PORTED-FROM-LOWCAP.md`).
- **M6 — the initiation ritual (NEW, R1/R2/R3)**: a `.claude/skills/coordinator-init/`
  skill that runs a grill-me-style interview with the operator and produces: the
  northstar (operator's words verbatim, never invented), the lane set (count is
  project-dependent — no fixed cap), owners, cadences, and `lane_cap` written into
  `board.json` as an initiation parameter. `check.py` drops `HARD_LANE_CAP = 6` and
  validates against the board's own `lane_cap`. One coordinator per project: init
  REFUSES to run on an already-initiated board without an explicit operator
  re-init confirmation. Meta-coordinator: record as a future note in the skill, build
  nothing.
- **Boot gate**: keep shipping disarmed; deliver the final arming stanza + a one-line
  arming checklist in your report — arming happens at weave per R4, not in your lane.
- **Rider — the box stop-hook wart**: every box session close logs
  `Stop hook error: JSON validation failed` (Konrad's SessionEnd wiring,
  `~/.claude/fleet/deregister.sh` + the settings entry). Diagnose on the box, fix the
  hook/installer so session close is clean, keep it silent-fail, update
  `box/hooks/install-box.sh` so fresh installs are correct, and prove it with a
  throwaway session. Do not touch the Mac.

## Boundaries

Touch ONLY: `coordinator/`, `.claude/skills/coordinator-*`, `docs/coordinator/`,
`docs/goals/coordinator-v02/`, `box/hooks/` (rider only), `public/board.html` + its
assets if M-renderer lands there (keep the existing views working; no server.js changes —
if the renderer needs an API change, that is an operator:gate issue, not an edit).
Never seed northstar or lanes with content — the ritual collects them from the operator.
Board seeds stay PROPOSED until initiation runs (R2). Never orchestrate; delegate
in-session (reader/builder/reviewer on every diff).

## Acceptance

1. Proposal M1–M5 acceptance items green, incl. the artefact-derivable counters and the
   compaction self-test (six-lane + populated-exceptions bundle under the gate with
   stated headroom; oversized bundle still trips).
2. `coordinator-init` dry-run transcript committed showing: refusal on an initiated
   board, the interview shape, and a sample board written with operator-supplied values
   + `lane_cap`.
3. `check.py` validates cap from the board; selftest updated; green.
4. Box session close is clean (rider proven with a fresh throwaway session).
5. Branch `agent-alistair` pushed; report `docs/goals/coordinator-v02/reports/alistair.md`;
   registry row done; lane issue under XYZ-1827 checkpointed per milestone (Linear dead →
   commit comments to reports/).
