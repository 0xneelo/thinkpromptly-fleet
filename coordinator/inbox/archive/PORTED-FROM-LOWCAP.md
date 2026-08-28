# Provenance — adjudication history ported from the lowcap Coordinator v0.1 instance

Ported 2026-08-29 by 🎛 ORCHESTRATOR 17 during the canonical-home consolidation
(operator placement ruling 2026-08-28: this repo's `coordinator/` is the ONLY board).

**Source:** `lowcap-connector` branch `agent-sylvia`, tip
`05d5eb8c83b24899349569f513a08f1d424e0421` — a parallel v0.1 build whose acceptance runs
processed four REAL sitreps from lowcap seats. That branch is superseded (noted on
XYZ-1827); these files preserve its adjudication history verbatim.

**The four ported files** (three in `archive/`, one in `rejected/`): all four were
REFUSED by the lowcap instance — two wrong-owner, one stale, one non-ISO `event_time`.
**No lane state was mutated by any of them**, so nothing in `board.json` derives from
this port. Their `lane:` ids refer to the LOWCAP board's numbering (L1–L6 seeded straight
from the o30→o31 handoff), not this board's rolled-up lanes.

**Known discrepancies, recorded rather than repaired:**
1. Lowcap run commits report a cumulative "1 applied", and its L2 carried
   `reported_at: 2026-08-28T18:10:00Z` — but no applied sitrep artifact survives.
   Spec gap flagged for v0.2: applied sitreps leave no archive artifact. The
   `18:10:00Z` value was NOT ported — no artifact, no edge.
2. Two refusal stamps predate the `event_time` they refused (liselotte, hartmut) —
   fixture-authored times in the lowcap acceptance run; preserved as-is.
