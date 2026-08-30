# coordinator/ — machinery + dev fixture, NOT a live instance

This repo (thinkpromptly-fleet) **builds** the coordinator; it does not **run** one.
Operator ruling 2026-08-30 (O13 seat, recorded on XYZ-1889 at closure):

> "you are building the coordinator, you arent using it"

- The files here (`board.json`, `northstar.md`, `*.py`, `hooks/`, `inbox/`) are the
  product and its dev fixture. The board's seeded lanes are a frozen 2026-08-28 snapshot;
  they bind nothing and never will in this repo.
- `/coordinator-init` runs only in CUSTOMER repos (first live instance:
  lowcap-connector, opened by the operator 2026-08-30). The boot gate is permanently
  disarmed in this repo by design.
- Do not re-file "run the init here" — that was XYZ-1889, closed on the ruling above.
- Known product gap: the deck serves this fixture at `/api/coordinator/*` instead of a
  customer instance's board — instance-aware board root is seam 8 of
  `docs/goals/gb-home-migration/goal.md` (XYZ-1890).
