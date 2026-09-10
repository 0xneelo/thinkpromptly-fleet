# Notify seat aliases — verification

Author: **Ysolde** (`agent-ysolde`, backend-developer).
Project: **remote-system / fleetdeck-notify**. Date: **2026-09-10**.
Node: **v24.14.1**, Linux, designated `agent-notify-seat-aliases` worktree.

All server fixtures used private ports and scratch databases. `TMPDIR` placed test
artifacts beneath this worktree's ignored `.tmp/`; the fake peer sockets received
test messages. No live Mac test, restart, deployment, SSH command or global skill edit
was performed. Existing suite SSH messages are produced by its fake SSH fixtures.

## Focused results

```sh
mkdir -p .tmp
TMPDIR="$PWD/.tmp" node --test test/desktop-seat-titles.test.js test/notify.test.js
```

| Milestone | Passed | Failed | Skipped | Evidence |
|---|---:|---:|---:|---|
| M1 | 24 | 0 | 0 | Five new title-index tests and 19 existing notify tests. |
| M2 | 25 | 0 | 0 | Derived-name/app-title HTTP fixture added. It returned 409 before the resolver change and delivered afterward. |
| M3 | 39 | 0 | 0 | Every alias, missing/archived/wrong-key record, ambiguity, precedence, stable delivery identity, liveness and tailnet access boundary. |

The M2 red run (`--test-name-pattern='an app title joins' test/notify.test.js`)
returned `seat_unaddressable`, **409 !== 200**. The same fixture now returns
`resolvedVia: "title"`, `resolvedTarget: "claude-desktop:id:<cliSessionId>"`,
`status: "delivered"`, and the GET view persists `resolved_via: "title"`.

The cache tests use an injected clock: unchanged index at 4,999 ms, refreshed at
5,000 ms. They exercise rename, archive, deletion and absent-store recovery. Duplicate
active join keys supply no title. Malformed JSON, invalid IDs and symlinks do not
introduce titles.

The tailnet test instruments actual child-process `readdirSync` / `readFileSync`
calls. Boot, unauthorized notify POSTs, inaccessible listing routes, GET of an unknown
notify and ACK of an unknown notify cause **zero store scans**. An authenticated
notify reads the title metadata; the next loopback notify shares that cache. A 409
diagnostic contains only the considered title strings, with no cwd or store metadata.

## Full suite and baseline failures

```sh
TMPDIR="$PWD/.tmp" npm test
TMPDIR="$PWD/.tmp" node --test --test-concurrency=1 test/*.test.js
```

`npm test` exits **1 in pretest**, before tests run: the unchanged fixture extractor
finds the mock's title keys lack `goals`, which is present in `public/v2/fixture.js`.
The underlying Node suite completes in **127,391 ms**:

```text
tests 706
pass 704
fail 2
cancelled 0
skipped 0
todo 0
```

No listener tests were skipped: this box supports `127.0.0.2`.
Both failures were reproduced individually against a clean archive of base
`34287bf` inside this worktree, with the same diagnostics:

| Existing failure | Current and base result |
|---|---|
| `test/machines.test.js:1658`, `fleet-credits.sh — it reads no token and reports no live Claude row, and samples anyway` | Assertion at line 1680: **3 !== 1** desktop rows. Fake HOME does not isolate the collector's absolute host-wide discovery paths. |
| `test/v2-data.test.js:868`, `every screen in the pack is routable` | Actual list contains **goals**; expected list omits it. |

Reproduction (read-only archive; no branch/worktree switch):

```sh
mkdir -p .tmp/notify-base-tests
git archive 34287bf | tar -xf - -C .tmp/notify-base-tests
node .tmp/notify-base-tests/tools/extract-fixture.mjs --check
TMPDIR="$PWD/.tmp" node --test \
  --test-name-pattern='fleet-credits.sh — it reads no token' \
  .tmp/notify-base-tests/test/machines.test.js
TMPDIR="$PWD/.tmp" node --test \
  --test-name-pattern='every screen in the pack is routable' \
  .tmp/notify-base-tests/test/v2-data.test.js
```

Each named baseline test runs **1 test, 0 pass, 1 fail, 0 skipped**. The baseline
pretest also exits 1. The pending repair issues are recorded in `LINEAR-PENDING.md`.
This evidence establishes no new failures in the executed suite; it does **not**
claim that the full suite is green. Acceptance 1 needs the requested operator ruling
on baseline exceptions.

## Review and scope

Ysolde read, built and reviewed each milestone directly. No subagents were used,
per the explicit Codex launch override. Full M1–M3 diffs and `git diff --check`
were reviewed before commits. No unresolved notify findings.

`package.json` and `package-lock.json` are unchanged. No tailnet handler, listener,
schema, fence, or collector was changed. `README.md` documents the store override.
The v2 bus screen and its template/runtime do not display `resolvedVia` or
`resolved_via`, so Acceptance 4's conditional improvised-design line does not apply.

Signed: **Ysolde**
