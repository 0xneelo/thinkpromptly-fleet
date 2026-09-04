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

## Point the tooling at a customer instance

The Python tooling stays in this product repo. To operate on a state directory in
another repo, set `COORDINATOR_INSTANCE_ROOT` for the process to the directory that
contains `board.json`, `northstar.md`, `decisions-effective.md`, and `inbox/`:

```sh
COORDINATOR_INSTANCE_ROOT=/absolute/path/to/customer/coordinator \
  python3 coordinator/check.py
COORDINATOR_INSTANCE_ROOT=/absolute/path/to/customer/coordinator \
  python3 coordinator/bundle.py --size
```

All state-aware CLIs that use the default board path follow that root. `runlog.py`
also defaults its inbox to `<root>/inbox`. An explicit board, inbox, or output path
still wins where a CLI already accepts one. With the variable unset, behavior is
unchanged: the dev fixture beside the tooling is used.
