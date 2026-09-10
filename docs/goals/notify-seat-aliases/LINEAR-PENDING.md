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

### PENDING-ACCEPTANCE — operator gate (2026-09-10T19:22:44Z)

Title: `[Ysolde · backend-developer] rule on baseline exceptions for notify Acceptance 1`

Labels: `operator:gate`, `agent:ysolde`, `agent:agent-ysolde`,
`project:remote-system`, `subproject:fleetdeck-notify`, `session:cli-worker`.
Linear Project: `remote-system`. Intended status: open, blocking goal acceptance.
Unfiled because Linear requires reauthentication.

Concrete result: M1–M4 are pushed, all 39 focused tests pass, and the full suite
has 704 passes plus two failures reproduced on base `34287bf`. The fixture pretest
also fails unchanged. All receipts and reproductions are in `REPORT.md` and
`verification.md`; repair issues are recorded above/below in this ledger.

Requested ruling: accept these documented baseline exceptions for Acceptance 1,
or hold goal completion until their owning lanes fix them. The worker's asynchronous
question is pending; no exception is assumed. This approval is needed because the
goal requires suite success while its scope rules send unrelated repairs to pending
issues. M1–M4 delivery is concrete and complete; full-goal acceptance remains held.

Final implementation report: `docs/goals/notify-seat-aliases/REPORT.md`, signed Ysolde.
It includes exact live-Mac join and CLI send commands, with expected title resolution,
delivery and ACK responses for Acceptance 2. No live-Mac outcome is claimed.

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
Pushed SHA: `d863502bdde3d1dddf4dc12a1a23fef6a0cf3dc7`. A fresh broker-authenticated
`git ls-remote` matched the full SHA after push.

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

### PENDING-M3 — merge completion comment (2026-09-10)

Per `O20-YSOLDE-MERGE-1`, merged main `aa047b2f7578af016872ec9f0f848774a686dfd3`
into this lane and pushed `82fcf4b92107e87d1a1131105303666b6ba7a47d`; a fresh
broker-authenticated remote check matched. The manual import conflict retains both
main's Docs/Unblock imports and this lane's title index. Main route blocks and this
lane's title resolution blocks retain their source-parent bytes.

Focused: **39/39 passed**. Final full suite: **768 passed, 1 failed, 0 skipped**;
pretest passed. Only the previously exempt credits host-wide `3 !== 1` failure
remains. The old v2 failure is fixed on main. A visible Docs metadata fixture and
a full serial rerun eliminate the initial hidden-path fixture failure and transient
port collision; exact commands and counts are in the report's integration addendum.
No new exception or additional production/test-source change was introduced to
address those test-environment failures.

Self-review by Ysolde: no unresolved merge findings. Linear retry still returns
`oauth_token_invalid_grant`; this is the pending completion comment. The operator's
`o20-ysolde-ruling-1` grants Acceptance 1's documented baseline exceptions and
supersedes the acceptance hold earlier in this ledger. Acceptance 2 stays with seat 20.

Signed: Ysolde

### PENDING-M2 — review completion comment (2026-09-10)

Per `O20-YSOLDE-REVIEW-2`, fixed remote diagnostic disclosure on the merged branch:
tailnet `seat_unaddressable` returns `consideredTitles: null`; loopback keeps the
titles. Ambiguous seat candidates now include the app title when present. Updated
the README and tailnet test. Also capped diagnostics at 100 titles without limiting
resolution and skipped desktop title files above 16 MiB, including replacement
recovery coverage. This supersedes the earlier M3 tailnet diagnostic behavior.

Pushed SHA: `0df8959893ad9df428eb775de3fce8760de7c05d`. A fresh broker-authenticated
remote check matched. The four targeted tests failed before implementation; the
focused suite now passes **41/41**. Full suite: pretest passed, **770 passed,
1 failed, 0 skipped** of 771 tests. Only the credits host-wide `3 !== 1` failure
remains, covered by `o20-ysolde-ruling-1`.

Ysolde performed the reads, edits and full diff review directly, as instructed for
this Codex worker; no subagents and no unresolved findings. Syntax and whitespace
checks passed. Linear retry still returns `oauth_token_invalid_grant`, so this
signed comment remains pending. Seat 20 owns the weave and live-Mac Acceptance 2.

Signed: Ysolde
