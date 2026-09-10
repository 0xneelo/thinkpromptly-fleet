# Notify seat aliases — delivery report

**Ysolde · backend-developer** — `agent-ysolde`

**remote-system / fleetdeck-notify** — 2026-09-10

Branch: **agent-notify-seat-aliases**

Worktree: `/home/vibe/projects/remote-system/.claude/worktrees/notify-seat-aliases`

M1–M4 are implemented and pushed. **Acceptance 1 remains held for an operator
baseline-exception ruling:** all 39 focused tests pass, while the full Node suite
has two failures also reproduced at the base commit. Acceptance 3 and 4 hold.
No full-goal completion or all-green suite is claimed while that ruling is pending.

## Delivery receipts

Every milestone was pushed with a newly fetched broker token, supplied only through
`GH_TOKEN`. A separate broker-authenticated `git ls-remote` after each push matched
its complete SHA. Commits use the canonical committer
`0xneelo <204101082+0xneelo@users.noreply.github.com>`; hooks were not bypassed.

| Milestone / pending issue | Pushed commit |
|---|---|
| M1 / PENDING-M1 — title join and cache | [`5240d81de69d3430107fee2567061019794672ec`](https://github.com/0xneelo/thinkpromptly-fleet/commit/5240d81de69d3430107fee2567061019794672ec) |
| M2 / PENDING-M2 — title-first resolution | [`8e43259ed3460a6c52d0aaf15113b17978bd53cc`](https://github.com/0xneelo/thinkpromptly-fleet/commit/8e43259ed3460a6c52d0aaf15113b17978bd53cc) |
| M3 / PENDING-M3 — fixture matrix and verification | [`a03de4568e954659cd81242a2397ef11df105747`](https://github.com/0xneelo/thinkpromptly-fleet/commit/a03de4568e954659cd81242a2397ef11df105747) |
| M4 / PENDING-M4 — docs-only decision note | [`d863502bdde3d1dddf4dc12a1a23fef6a0cf3dc7`](https://github.com/0xneelo/thinkpromptly-fleet/commit/d863502bdde3d1dddf4dc12a1a23fef6a0cf3dc7) |

Linear project scans/retries require reauthentication (`oauth_token_invalid_grant`).
The four issue definitions, signed milestone completion comments with pushed SHAs,
and the two baseline repair issues are preserved in [LINEAR-PENDING.md](LINEAR-PENDING.md).
`PENDING-M1`…`PENDING-M4` are local references, not invented Linear IDs. No issue
creation, comment posting or workflow transition is claimed.

Both registry POSTs (initial task and `PENDING`) returned HTTP 401 `unauthorized`.
Neither update was applied; no alternate credentials were used. The pre-registered
row remains owned by the orchestrator. The initial badge read was
`🔨 WORKER · Ysolde`, so no re-stamp was needed.

## Result and acceptance

`desktop-seat-titles.js` lazily indexes `<account>/<org>/local_*.json` with a
five-second cache. `server.js:540` joins live `sessionId` to store `cliSessionId`,
adding `title` or null. Archived records are ignored; conflicting duplicate active
keys supply no title. Failed/malformed reads recover on the next refresh.

`server.js:3187` matches seat aliases against app titles before CLI names and the
existing orchestrator lease fallback. Title matches report `resolvedVia: "title"`
and deliver through the existing stable-ID peer path. Two matching live seats
still return 409 `ambiguous`; 409 `seat_unaddressable` now lists `consideredTitles`
without cwd or store metadata. Legacy name and lease targets retain their behavior.

| Acceptance | Status and evidence |
|---|---|
| **1 — tests** | **Held for baseline ruling.** Focused suite **39 pass / 0 fail / 0 skip**. Full serial Node suite **704 pass / 2 fail / 0 skip**, with both failures reproduced at base `34287bff18768cd17111faee0f222c4814ab000f`. No listener skips; 127.0.0.2 works. `npm test` additionally stops at the unchanged fixture-drift pretest. See [verification.md](verification.md). |
| **2 — live Mac** | **Deferred to seat 20 after operator weave/restart**, as assigned. Exact join verification and send commands below. This Linux box has no desktop store. |
| **3 — dependencies / access** | **Pass.** No dependency changes. Existing listener/auth boundaries stay unchanged. The instrumented tailnet fixture proves zero store reads for unauthorized sends and unsupported listing routes; authorized notify uses the same cache as loopback. |
| **4 — docs** | **Pass.** [README env table](../../../README.md) documents `CLAUDE_DESKTOP_STORE_DIR` and existing `CLAUDE_SESSIONS_DIR`. The v2 bus/template/runtime do not display `resolvedVia`/`resolved_via`, so the conditional improvised-design entry does not apply. |

The two unchanged failures are the credits test's host-wide discovery (`3 !== 1`
desktop rows) and the v2 routable-screen assertion's extra `goals` entry. The latter
also explains the fixture pretest failure. They are recorded as `needs:general`
pending issues. This lane did not repair unrelated collector or UI behavior.

M4's [seats-per-project.md](seats-per-project.md) is tagged `operator:decision` and
compares all three requested options. It recommends project-specific seat IDs with
project-bound epoch checks in a separately authorized follow-up. Authoring the note
completes M4; choosing/implementing that option is outside this goal.

Ysolde performed all reads, edits and reviews directly, with no subagents, per the
Codex-specific launch override. Every milestone diff was self-reviewed before
commit; the complete branch diff passed `git diff --check`. No unresolved notify
findings, restart, deploy, merge, other-branch/worktree edits, or `~/.claude/` edits.

## Seat 20: live Mac verification after weave

The worker verified only that this Linux box has no app store. On the Mac, run this
read-only check of the README's seat-20 join key before the sends. If the CLI session
has changed since the pack was written, identify its current sessionId and substitute
that value; do not infer a join from the CLI name or cwd.

```sh
python3 - <<'PY'
import json
from pathlib import Path

sid = 'd4f52004-39d2-433f-abbd-e93f240f6f85'
home = Path.home()
def records(pattern, root):
    for p in root.glob(pattern):
        try:
            value = json.loads(p.read_text())
            if isinstance(value, dict):
                yield value
        except (OSError, ValueError):
            pass

live_files = [r for r in records('[0-9]*.json', home / '.claude/sessions')
              if r.get('sessionId') == sid]
store = home / 'Library/Application Support/Claude/claude-code-sessions'
matches = [r for r in records('*/*/local_*.json', store)
           if r.get('cliSessionId') == sid and r.get('isArchived') is not True]
print(json.dumps({'sessionId': sid, 'registryMatches': len(live_files),
                  'storeMatches': [{'cliSessionId': r.get('cliSessionId'),
                                    'storeSessionId': r.get('sessionId'),
                                    'title': r.get('title')} for r in matches]},
                 ensure_ascii=False, indent=2))
assert len(live_files) == 1 and len(matches) == 1, 'verify the live Mac join key before sending'
PY
```

Expected: one registry match and one non-archived store record whose `cliSessionId`
equals the registry `sessionId`; the store's own `sessionId` is `local_…`. The title
should identify the intended project seat. Allow five seconds after a title edit
for cache expiry. With remote-system orchestrator, design 14 and coordinator 19 live:

```sh
export FLEETDECK_URL=http://127.0.0.1:3131
node bin/fleet-notify.js send --to "orchestrator remote-system" --from claude-desktop "ping. Reply ACK O20-ALIAS"
node bin/fleet-notify.js send --to "design 14" --from claude-desktop "ping. Reply ACK O20-ALIAS"
node bin/fleet-notify.js send --to "coordinator 19" --from claude-desktop "ping. Reply ACK O20-ALIAS"
```

Each CLI command should exit **0** after the addressed seat ACKs. Its JSON should
have this shape (IDs and sender differ per seat):

```json
{
  "id": "n-<notify-id>",
  "resolvedTarget": "claude-desktop:id:<that-seat-cliSessionId>",
  "resolvedVia": "title",
  "delivered": true,
  "acked": true,
  "ackFrom": "<receiving-seat>",
  "ackResponse": "ACK O20-ALIAS"
}
```

The underlying POST response uses `status: "delivered"`; the CLI renders that as
`delivered: true` and waits for an ACK. A timeout is not an ACK success. A 409 should
be inspected using `consideredTitles`; `--open-chat` would bypass the acceptance
being checked and must not be used for this verification.

## Remaining operator actions

Rule on Acceptance 1's documented baseline exceptions (or have the owning lanes
repair them); perform Acceptance 2 on the Mac after weave/restart; choose an M4 seat
option; and restore Linear/registry access so the preserved records can be filed.
No live-Mac result, acceptance exception or deployment approval has been inferred.

Signed: **Ysolde**

2026-09-10 ~21:00Z — Ruling `o20-ysolde-ruling-1` from 🎛 ORCHESTRATOR 20 grants the Acceptance 1 baseline exception for exactly the credits host-wide discovery `3 !== 1` and v2 routable-screen extra `goals` failures; this supersedes the hold above and completes the worker goal. Seat 20 owns the weave and Acceptance 2 on the Mac after restart. Signed: **Ysolde**.

## Integration addendum — O20-YSOLDE-MERGE-1 (2026-09-10)

Per seat 20's explicit addendum, fetched `origin/main` at
`aa047b2f7578af016872ec9f0f848774a686dfd3` and merged it into this branch.
Pushed merge commit: [`82fcf4b92107e87d1a1131105303666b6ba7a47d`](https://github.com/0xneelo/thinkpromptly-fleet/commit/82fcf4b92107e87d1a1131105303666b6ba7a47d).
Its parents are `104fbc84856a0fecb3b66ffb9db6da1ad4de1e58` and the main SHA above.
A separate fresh broker-authenticated `git ls-remote` matched the full merge SHA.

The only manual conflict was the import block in `server.js`; all three imports
(`DesktopSeatTitles`, `DocsIndex`/`defaultRoots`, and `createUnblock`) were retained.
Main's new Docs routes, `notifyRoute`, and accounts refresh block are byte-identical
to main. The live title join, title/name/lease precedence, target resolution and
notify diagnostics are byte-identical to this lane's pre-merge parent. All 28 other
incoming main files are byte-identical in the merge. Ysolde reviewed the merge diff;
syntax and whitespace checks passed. No tests or production behavior were altered
to resolve the environment issues described below.

Validation after the merge:

- Focused suite: **39 passed, 0 failed, 0 skipped**.
- Docs API with a visible metadata fixture: **12 passed, 0 failed, 0 skipped**.
- Final full `npm test`: pretest **passed**; **769 tests, 768 passed, 1 failed,
  0 skipped**, 138,371 ms. The sole failure is the approved credits host-wide
  discovery `3 !== 1` case (now `test/machines.test.js:1739`).
- Main fixes the former v2 routable-screen failure and fixture pretest drift.
  The existing ruling covers the remaining credits failure; no new exception is used.

The initial full run had 766 passes and three failures: the approved credits case,
a Docs fixture rejected because its temporary path inherited the worktree's hidden
`.claude` ancestor, and a transient Unblock `EADDRINUSE` on port 42632. The complete
rerun below fixes the fixture location and has neither of the latter failures.
Only the Docs metadata tree goes into visible `/tmp`; scratch databases remain in
this worktree. The fixture preload is test setup, not a change to the merged files:

```sh
mkdir -p .tmp
cat > .tmp/visible-docs-fixture.cjs <<'JS'
const fs = require('node:fs');
const helpers = require('../test/helpers');
const fixtureTmpdir = helpers.tmpdir;
helpers.tmpdir = (tag) => tag === 'docs'
  ? fs.mkdtempSync('/tmp/fleetdeck-docs-ysolde-')
  : fixtureTmpdir(tag);
JS
TMPDIR="$PWD/.tmp" node --test test/desktop-seat-titles.test.js test/notify.test.js
TMPDIR="$PWD/.tmp" NODE_OPTIONS="--require=$PWD/.tmp/visible-docs-fixture.cjs" npm test
```

Linear was retried for this merge and still requires reauthentication; its signed
completion comment is preserved in `LINEAR-PENDING.md`. Seat 20 still owns the weave,
restart and live-Mac Acceptance 2. The worker did not perform those operations.

Signed: **Ysolde**
