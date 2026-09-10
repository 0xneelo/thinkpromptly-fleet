# Linear pending — notify-seat-aliases

Seat 20 had no Linear MCP in its session on 2026-09-10; the worker files these on start (project `remote-system`, labels `agent:ysolde`, `project:remote-system`, `subproject:fleetdeck-notify`, `session:cli-worker`). If Linear is unreachable, keep them here with timestamps and file them when it is back.

1. `[Ysolde · backend-developer] title join for desktop sessions (M1)` — body: README.md §Plan M1.
2. `[Ysolde · backend-developer] resolve seat aliases on title, resolvedVia=title (M2)` — README.md §Plan M2.
3. `[Ysolde · backend-developer] fixture tests for seat alias resolution (M3)` — README.md §Plan M3.
4. `[Ysolde · backend-developer] decision note: per-project orchestrator seats (M4)` — label `operator:decision`, README.md §Plan M4.

## Execution ledger — Ysolde

2026-09-10: Initial Linear project scan failed with `oauth_token_invalid_grant`
(reauthentication required). All four issues above remain unfiled. Pending references
`PENDING-M1` through `PENDING-M4` identify their commits until real issue IDs exist;
no Linear issue IDs or status changes are claimed.

Identity: Ysolde (backend-developer), `agent-ysolde`; project `remote-system`,
sub-project `fleetdeck-notify`, session `FD-notify-seat-aliases`.
Labels for every pending issue/comment: `agent:ysolde`, `agent:agent-ysolde`,
`project:remote-system`, `subproject:fleetdeck-notify`, `session:cli-worker`.
M4 also carries `operator:decision`.

Registry initial POST and the subsequent `task: PENDING` POST both returned HTTP 401
`unauthorized`; neither requested row update was applied. No alternate credentials
were used. The orchestrator owns the pre-registered row.

M1 in progress: fixture title index and registry join. The box reports Linux and has
no desktop store. The README's Mac join key is the fixture contract; live verification
is deferred to seat 20 after weave. Ysolde performs reads, edits, and diff reviews
directly, without subagents, as explicitly required by the Codex launch override.

Signed: Ysolde

### PENDING-M3 — completion comment (2026-09-10T19:21:00Z)

Implemented the complete fixture matrix in `test/notify.test.js` and recorded
commands, red/green evidence, security checks and baseline reproductions in
`verification.md`. Focused: **39 passed, 0 failed, 0 skipped**. Full serial suite:
**704 passed, 2 failed, 0 skipped**; both failures reproduce on base `34287bf`.
`npm test` separately stops at the unchanged fixture-drift pretest. No listener
tests were skipped; 127.0.0.2 is available on this box.

Self-review: full M3 diff reviewed by Ysolde; no unresolved notify findings. The
two baseline repair issues are recorded here, without expanding this lane. Linear
retry still requires reauthentication. Acceptance 1's baseline-exception ruling
is pending; no full-suite green claim is made.
Pushed SHA: `a03de4568e954659cd81242a2397ef11df105747`. A fresh broker-authenticated
`git ls-remote` matched the full SHA after push.

Signed: Ysolde

### PENDING-M4 — completion comment (2026-09-10)

Added the docs-only `seats-per-project.md` decision note, tagged `operator:decision`.
It compares the three requested options and recommends (b), project-specific seat
IDs and project-bound authority checks, for a separately authorized follow-up.
It explicitly records that bootstrap bypasses fencing only before any seat exists,
and that per-project epoch counters cannot safely use today's epoch-only verifier.

Self-review: Ysolde checked the note against the current schema, seat claim, epoch,
fence and notify fallback code. No unresolved findings. This milestone changes docs
only, with no migration, fencing change or per-project implementation. Linear retry
still requires reauthentication. The decision itself remains open for the operator;
authoring the note completes M4's worker deliverable.
Pushed SHA will be recorded after push in the final ledger/report update.

Signed: Ysolde

### PENDING-BASELINE-CREDITS — out-of-scope issue (2026-09-10T19:19:30Z)

Title: `[Ysolde · backend-developer] isolate fleet-credits fixture from host-wide discovery`

Labels: `needs:general`, `agent:ysolde`, `agent:agent-ysolde`,
`project:remote-system`, `subproject:fleetdeck-notify`, `session:cli-worker`.
Linear Project: `remote-system`. Intended status: Todo. Unfiled because Linear
requires reauthentication.

`test/machines.test.js:1658` sets a fake HOME but `box/fleet-credits.sh:59–60,87`
also globs absolute `/mnt/c/Users/*` and `/home/*` paths. On this box the test's
`desktop.length === 1` assertion gets 3 (`test/machines.test.js:1680`). The exact
test also fails with `3 !== 1` in a clean archive of base `34287bf`, using:

```sh
TMPDIR="$PWD/.tmp" node --test --test-name-pattern='fleet-credits.sh — it reads no token' \
  .tmp/notify-base-tests/test/machines.test.js
```

Expected: the owning lane provides a complete discovery fixture boundary and
asserts no ambient host input enters the test. No collector or machine tests were
changed in notify-seat-aliases. Baseline acceptance exception requested from the
operator while the rest of the authorized work continues.

Signed: Ysolde

### PENDING-BASELINE — out-of-scope issue (2026-09-10T19:18:31Z)

Title: `[Ysolde · backend-developer] repair existing v2 fixture title drift in npm pretest`

Labels: `needs:general`, `agent:ysolde`, `agent:agent-ysolde`,
`project:remote-system`, `subproject:fleetdeck-notify`, `session:cli-worker`.
Linear Project: `remote-system`. Intended status: Todo. Unfiled because Linear
requires reauthentication; this is not notify implementation work.

`npm test` exits 1 before running tests: `node tools/extract-fixture.mjs --check`
reports that the mock's `titles` keys omit `goals`, while `public/v2/fixture.js`
contains it. The extractor, mock and generated fixtures are unchanged by this lane.
Reproduced the identical exit 1 and diagnostic using those files archived from
base `34287bf` under this worktree's `.tmp/notify-baseline/`.

Expected: the owning UI lane reconciles the fixture sources/generation so pretest
passes. No generated UI files were edited by this worker. The underlying serial
Node test suite is run separately for Acceptance 1.

The full Node suite also exposes the same eight-versus-nine-screen drift in
`test/v2-data.test.js:868` (`every screen in the pack is routable`): actual keys
include `goals`; the test's expected keys omit it. The exact test fails on the
archived base too. Include that fixture assertion in the owning UI lane's repair.

Signed: Ysolde

### PENDING-M2 — completion comment (2026-09-10)

Seat regexes now match app titles first, then legacy CLI names, then the existing
orchestrator lease fallback. App-title matches use `resolvedVia: "title"` and the
existing stable ID delivery path; name and lease matches retain `resolvedVia: "seat"`.
Ambiguity still returns 409. Unaddressable replies include `consideredTitles`, with
no cwd, store metadata, peer keys or new owner disclosure.

Regression evidence: the derived-name/title fixture returned 409 before the resolver
change; afterward it delivers through the fixture peer socket and persists
`resolved_via: "title"`. Focused suite: **25 passed, 0 failed, 0 skipped**.
Self-review: full M2 diff reviewed by Ysolde; stable ID addressing avoids derived-name
collisions while preserving legacy targets. No unresolved findings. Linear retry
still requires reauthentication; this is the pending issue completion comment.
Pushed SHA: `8e43259ed3460a6c52d0aaf15113b17978bd53cc`. A fresh broker-authenticated
`git ls-remote` matched the full SHA after push.

Signed: Ysolde

### PENDING-M1 — completion comment (2026-09-10)

Implemented `desktop-seat-titles.js`, the five-second lazy title cache, and joined
live registry `sessionId` to `cliSessionId` in `server.js`. Added the README env table.
Unit fixtures cover projection, TTL rename/archive/delete refresh, absent-store
recovery, malformed records, symlinks and duplicate keys. The initial test failed
because the new module was absent; after implementation, the new five tests plus
19 existing notify tests pass: **24 passed, 0 failed, 0 skipped**.

Self-review: full M1 diff reviewed by Ysolde; no unresolved findings. No dependency
or listener/auth changes. Linear milestone retry still requires reauthentication.
Pushed SHA: `5240d81de69d3430107fee2567061019794672ec`. Fresh broker-authenticated
`git ls-remote` matched the full SHA. Both push and verification used broker tokens
only through `GH_TOKEN`; the credential helper was selected through per-command env.

Signed: Ysolde
