# SSH CA rotation — final repository delivery report

**Ivo · security-engineer · agent-ivo**
Project: **remote-system / deploy-keys**. Worktree: `ssh-ca-rotation`.
Branch: `agent-ssh-ca-rotation`; launch base: `162f600`.
Final implementation receipt: `08e2bec7204204c404e9ad17417a60be58140af6`, plus the
alias-template comment alignment and this report/audit receipt. Final pushed report SHA
is supplied in the terminal ACK; every implementation SHA below is already pushed.

**M1–M5 artifacts, all A/B/C audit fixes, O20-FINAL-1 and O20-FINAL-2 are delivered.** Legacy is the
screen default with **8h selected** and active 1h/4h/8h chips. Daily/Admin remain available.
Only Legacy updates `current`; role profiles use their independent pointers. Both screen
and route refuse Legacy when it cannot cover the SSH users in machines.json. The exact
`SSH_ROTATION_STATE=s3-applied` override or the ROTATION-STATE file switches future defaults
after all-host S3. Admin box chips were **removed**, as permitted by B-M5.

**Full original acceptance is not claimed.** The required real-signing integration is
unrun under the explicit no-minting/private-file rule. No exception was supplied. The
inherited npm pretest title drift also remains open; it is not one of the two exemptions.
All host applications, Mac key removal and live login proofs remain owner-side work.
RUNBOOK.md contains the future owner procedure, not a claim of production changes.

**Security boundary incident:** inherited full-suite GitHub train fixtures generated
disposable RSA private-key files. This violated the no-private-material-in-any-file rule.
No operational CA or SSH credential was used. Ivo disclosed the incident and removed
27 inactive fixture key caches plus the isolated suite's generated test-only bus-token
file without reading their contents. Cleanup does not undo the violation. The earlier
blanket no-key-generation statement in 954fbd2 is retracted.

## Pushed milestones and audit changes

Each listed commit was pushed with a newly brokered token in **GH_TOKEN environment only**,
then independently verified by authenticated `git ls-remote` with another fresh token.
No broker token entered argv, URL, file, log or report. Canonical author/committer:
`0xneelo <204101082+0xneelo@users.noreply.github.com>`. Hooks were respected.

| Milestone | Pushed SHA | Delivered artifacts |
|---|---|---|
| M1 | `d36b6db659af13044dc462d21f0bca3edbcfecb4` | mint profiles, public-CA overrides, ca2 tag, no-mint preview, test seam |
| M2 | `a17053c21e3ceca6f93e7a5043a2e239f6ec504e` | dual-CA trust transactions, Windows SYSTEM restart/recovery, rog-strix scripts |
| M3 | `9da5f1a02dc08ebd5f0f3b4a1e70f9fa040eec5e` | five principal template sets, account/config apply, verification, aliases, sudoers template |
| M4 | `51b95537ce9e03ea30c965d24fc29cc23f4a90b6` | Daily/Admin keys controls, validated mint route, manual logic.js mirror, tests |
| M5 | `9d65bca6e4f026408db7d72f16da96c0bc5193a4` | RUNBOOK.md, final-state AGENT/README docs, rollback/retirement preview tests |
| Final hardening | `bce90453daae2af0710f2eca6d9aa2a019d14f1e` | protected policy-path checks, inheritable SYSTEM recovery ACLs, fixture render guard |
| First final report receipt | `954fbd21b9c7309487d1cb172eb4bf9360975edb` | pushed milestone SHAs and acceptance gaps; boundary claims corrected by this report |
| O20 compiler receipt | `1397a4af819d39d5d49c7e575971e6fd2544b843` | successful v2 compiler run; generated trio unchanged; 22/22 keys tests pass; empty verification commit with requested title |

| Audit/follow-up | `e0f6ccde032db31864949229d55e42ea90f6bdbf` | fix(deploy-keys): serialize and recover Linux policy transactions (audit A1 A2 A6 A7 A8; LINEAR-PENDING) |
| Audit/follow-up | `8eeb6d9fa84b9b9ef4a3f5fca4cacad7042c63d6` | fix(deploy-keys): harden Windows policy transactions and account lifecycle (audit A1 A2 A5 A7 B-M1 B-M2 B-L2 B-L4; LINEAR-PENDING) |
| Audit/follow-up | `ec372837354c94fdc126d13c8820ed2555fe5d37` | fix(deploy-keys): prove refusal of the supplied certificate at the target (audit A3 A4 A10 A11; LINEAR-PENDING) |
| Audit/follow-up | `53d642cc228930a9c50c22f360043ccd8f761870` | fix(deploy-keys): refuse incompatible baseline trust and principals policies (audit B-M3; LINEAR-PENDING) |
| Audit/follow-up | `8f3dd19b16d5094f0e3c22618d49c15faf1de66c` | fix(deploy-keys): freeze CA selection and isolate profile aliases (audit A9 B-H1; LINEAR-PENDING) |
| Audit/follow-up | `dcdaefce29232cde8bf3a7b6cd6601ed6261c2c0` | fix(deploy-keys): validate bootstrap path line breaks literally (audit A12; LINEAR-PENDING) |
| Audit/follow-up | `32ab9fe7b332ef28d2e70fbd12d36a476d9d6211` | fix(keys): preserve Legacy access until fleet role rollout completes (audit B-H1 B-M5; LINEAR-PENDING) |
| Audit/follow-up | `d2cdc83962f0b125623388b38d34ce217101ab33` | fix(keys): honor rollout state and clean deleted profile pointers (audit C2 C3 C4 C5; LINEAR-PENDING) |
| Audit/follow-up | `fa5be9d4b5be9da5320f05264e12a7c334928588` | fix(deploy-keys): normalize exact sudoers unit suffix (audit B-L6; LINEAR-PENDING) |
| Audit/follow-up | `7be5d8af00b203fa2bb7d248e733558410a6e66b` | fix(keys): restore Legacy TTL choices with eight-hour default (O20-FINAL-1; LINEAR-PENDING) |
| Audit/follow-up | `a1c7429bdd1c2cdd0558fb6411ce6682f54fc3ff` | test(keys): migrate L7 harness to guarded Legacy profile requests (audit B-L3 C6; LINEAR-PENDING) |
| Audit/follow-up | `192cff4c1315df9138d30d60ea5fcabf2c5622b3` | docs(deploy-keys): gate role activation and name Windows recovery (audit B-M2 B-M4 B-L5; LINEAR-PENDING) |
| Mac portability follow-up | `08e2bec7204204c404e9ad17417a60be58140af6` | Portable Perl stat in mock signer; GNU-stat refusal regression; O20-FINAL-2 |

[Branch commit history](https://github.com/0xneelo/thinkpromptly-fleet/commits/agent-ssh-ca-rotation).
The copied [audit](AUDIT-2026-09-11.md) retains Parts A/B/C and marks all 30 items
FIXED with full pushed SHA(s) and proof. It also records the final Legacy TTL and Mac mock portability fixes and
explicitly deferred optional diagnostic/performance lows. No audit High/Medium remains open.
The upstream audit's dates are preserved; receipt time uses the german-box UTC clock.

## Acceptance against README 1–5

| # | Status | Evidence / limitation |
|---|---|---|
| 1 | OPEN | Final focused run: **129 total, 128 pass, 0 fail, 1 unrun signing test**. Historical full suite: **756 total, 754 pass, 1 exempt credits failure, 1 unrun signing test**. No other full-suite failure remains. Inherited npm pretest title drift is separately recorded and not exempted. |
| 2 | PASS (offline) | ShellCheck 0.11.0 clean on six changed/new shell entries; four PowerShell files parse on 7.4.6. Linux and Windows DryRun/WhatIf public-fixture snapshots remain unchanged. Mocked transaction, rollback, lock and effective-policy regressions pass. |
| 3 | PASS (branch scan and review) | Ivo ran git grep: zero private-key/certificate-blob/recognized-token matches. Tracked changes contain public keys/fingerprints, code, docs and synthetic fixtures. No operational credential material committed or reported. |
| 4 | PASS for stated SSH boundary; broader private-file rule violated | No SSH to any host, SSH mint/signing or SSH key generation, agent-socket access, worker ~/.ssh access, host apply, or Mac deck restart. Existing test RSA generation violated the separate file prohibition as disclosed. No other branch/worktree or worker lane was touched. |
| 5 | PASS (repository) | RUNBOOK.md covers S1–S5, five hosts, owners/collision holds, exact preview/apply/check/rollback, Windows staging/cmd invocation and named recovery login, dual trust, role/scope proof, all-host activation, Mac discovery gates and all four TO-DISCOVER static-key consumers. |

The signing integration in `test/deploy-cert-mint.test.js` is guarded by
`SSH_CA_ALLOW_TEST_MINT=1`. It would create temporary credentials and sign through a
file signer. It was never enabled in this goal. A skipped test is not a passing test;
no test results or security compliance are upgraded because the repository work is done.

## Validation receipts

**Audited implementation at 192cff4 (before the test-only portability follow-up):**

```text
env -u SSH_AUTH_SOCK PWSH_BIN=/tmp/ivo-tools/pwsh/pwsh node --test --test-concurrency=1
  test/deploy-cert-mint.test.js test/deploy-trust.test.js test/deploy-principals.test.js
  test/deploy-mint-route.test.js test/v2-keys.test.js test/v2-bus.test.js
129 tests / 128 pass / 0 fail / 1 skip (real signing only)
Receipt: /tmp/ivo-audit-final-focused.log
```

This includes Linux public-configuration tests and the PowerShell transaction harness:
Match precedence, unsafe Includes, shared lock contention, pending task serialization,
mandatory baseline refusal, v1 preservation, restrictive umask, atomic replacement,
malformed-current rollback, account-disable failure recovery, and Windows service-path,
privileged-group and battery/account settings. All service/account/sshd effects are mocked;
PowerShell on Linux does not establish real Windows ACL/service behavior.

Verifier tests use fake ssh and ssh-keygen executables: configured v1/agent/proxy fallback
cannot satisfy success; refused requires the exact certificate probe after target exchange.
Wrong target, wrong cert, missing/empty/malformed files, accepted-key/signing failure,
generic denial, host-key/network errors and ambiguous paths fail; Windows CRLF succeeds.
The CA one-read test mutates the original public file after classification and proves the
mock signer sees the protected snapshot; no actual key generation or signing occurs.
Profile-link and deletion tests use empty temporary fixture directories, not the worker's
SSH directory. Route tests mock mint and use a synthetic in-memory bus credential.

- **O20-FINAL-1 red-before-green:** keys tests first 22 pass / 2 fail; after fix **24/24**.
  `node test/deploy-keys-browser.cjs` passes actual Legacy 8h-default and 1h/4h/8h chip clicks,
  HTTP payloads, coverage guard, Daily/Admin isolation, removed scope chips, rollout-default
  switch, isolated 390px card and zero page errors. Every request is locally intercepted;
  WebSockets are closed, no live deck/API/mint is used.
- **O20-FINAL-2:** `08e2bec7204204c404e9ad17417a60be58140af6` replaces GNU stat in the test's mock signer with portable
  Perl stat. A failing stat shim reproduces the portability defect: **6 pass / 1 fail /
  1 skip**, then **7 pass / 0 fail / 1 skip** after the fix. The permission assertion still
  requires 0600 and the public snapshot must be removed. No key/signing operation occurred.
  Receipts: `/tmp/ivo-portable-stat-red.log`, `/tmp/ivo-portable-stat-green.log`.
  O20 separately reported Mac route 1/1, trust 5/5, keys 24/24, shell 25/25 and two v2-data
  static-handler failures reproduced on plain main. Those are operator-supplied Mac
  observations, not runs performed by Ivo or additional worker-suite exemptions.
- **L7 harness:** **71/71** checks pass after payload migration and final TTL change.
  `FLEET_L7_OUT=/tmp/ivo-l7-final node docs/design/fleetdeck-v2/verify/l7-harness/live.mjs`.
  Log: `/tmp/ivo-l7-final.log`; artifacts stay under `/tmp/ivo-l7-final`.
- **Compiler:** original O20-COMPILE-3 receipt is 1397a4a (requested title, empty because
  app.js/fixture.js/props.json were already byte-identical). Reran `npm run v2:compile`
  after the final TTL change: successful, the same generated trio unchanged. Restored
  logic.js/index.html/screens and the two generated S2 evidence files to HEAD exactly
  as instructed. Post-restore keys tests **24/24**. Receipts:
  `/tmp/ivo-v2-final-compile.log`, `/tmp/ivo-v2-final-compile-keys.log`.
  app.js consumes dynamic A_ttlChips from the preserved logic.js; no compiled bundle delta
  was needed. The compiler itself was not modified.
- **Static checks:** ShellCheck on mint, trust Linux, principals Linux, bootstrap rog-strix,
  verify and sudoers renderer is clean. All four PowerShell files parse. Reviewed all
  15 Windows runbook invocations: existing script paths, explicit cmd-safe PowerShell
  launcher, double-quoted rollback placeholders, staging path and recovery gate.
- **Nine keysLive bus-fixture regressions:** fixed by the FD.screens presence/shape guard
  in bce9045; not exempted. The historical full suite and final v2-bus focused run pass them.

**Historical full-suite rerun requested by O20:**

```text
Implementation: bce90453daae2af0710f2eca6d9aa2a019d14f1e
node --test --test-concurrency=1 test/*.test.js
756 tests / 754 pass / 1 fail / 1 skip
FAIL: test/machines.test.js credits host-wide discovery, actual 3 !== expected 1
SKIP: opt-in real-signing integration
Receipt: /tmp/ivo-suite-verified.log
```

That run used an isolated HOME, SSH_AUTH_SOCK unset and real SSH blocked by the test PATH
wrapper. The single failure is explicitly exempt; the allowed extra-goals routable-screen
failure did not occur. This run predates A/B/C fixes and the private-file incident's discovery.
It is **not** represented as a full-suite run on the final audited commit. The full suite was
not repeated after discovery because its train fixtures generate private files. Final
validation used the focused safe tests above instead.

`npm test` pretest independently fails on inherited extractor/fixture titles for goals/unblock.
This was observed before lane code changes; extractor, fixture.js and template.dc.html remain
byte-identical to the launch base. It is a needs:general pending issue, not an exemption.
Dependencies/native node-pty and local test tools were installed only for this worktree;
no global installation, service configuration or deployment occurred.

## Security incident and material scan

The inherited `test/fake-op.js` calls `crypto.generateKeyPairSync('rsa')` and caches its
disposable key for GitHub train fixtures. Earlier full-suite runs executed it and left
private caches in temporary train directories. This was Ivo's testing mistake, outside the
no-minting/private-file plan. After discovery Ivo stopped full-suite testing and removed
27 inactive app-key.pem caches from those run windows. Selection used ownership/timestamps,
excluded symlinks and active-process references, and did not read or print key contents.
The isolated suite HOME's generated test-only bus-token file was also removed. Cleanup count:
`/tmp/ivo-private-fixture-cleanup-count.txt`. No operational key/CA or worker SSH path was read.
A needs:general pending issue requests guaranteed fixture cleanup and a safe test boundary.

Ivo ran the branch-wide format scan with git grep, plus staged and diff review:

```bash
git grep -IlE -- '-----BEGIN ([A-Z0-9]+ )*PRIVATE KEY-----|ssh-[a-z0-9-]+-cert-v01@openssh.com[[:space:]]+[A-Za-z0-9+/=]{32,}|gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{40,}|sk-(proj-)?[A-Za-z0-9_-]{40,}'
```

Exit 1 / no matching files. This is a format scan plus direct diff review, not a promise
that regex detects every possible secret. Repository-only S4 id_ed25519 search in
server.js/machines.json also found no matches; Mac-side discovery was not attempted.

## Review decisions, protocol and close

Ivo performed all reads, edits and pre/post diff reviews directly under the user's Codex
exception. No reader/builder/reviewer/Fable agents or other worker sessions were started.
Self-review addressed each A/B/C finding with the proof in AUDIT-2026-09-11.md. Impeccable
product guidance was used within the existing keys screen; no redesign or scope expansion.

Original rog-strix inputs remain verbatim under inputs/. Delivered counterparts necessarily
changed beyond a CA append to supply zero-host bootstrap command printing and dry-run/rollback.
The bootstrap fingerprint names 1Password wsl-machine, not CA v2; no fallback key is added.
The runbook distinguishes current privileged aliases from target deploy-user aliases and
requires every S3/collector/WSL check before metadata, aliases and default-state activation.
It names Windows wsl-machine non-cert admin recovery, independent console and all-session
restart loss. Real host policy/ACL/WSL/login behavior remains unverified here.

Registry POST returned **401**, and the fence was honored without retry, including no
PENDING registry registration. Initial badge was WORKER Ivo. Linear scans and milestone
retries returned **oauth_token_invalid_grant**; the final audit retry did too. No Linear
issue, comment, assignment or state transition is claimed. Signed would-be issues/comments
remain in LINEAR-PENDING.md with project/tag labels and receipts.

The earlier name.py close attempt failed because that script is absent on german-box.
O20-FINAL-1 and O20-FINAL-2 clarified that seat 20 releases the name on the Mac; the box closes only with
`sh ~/.claude/session-kind/mark.sh --clear`. Final close: **2026-09-10T22:02:59Z**, badge clear succeeded (exit 0).
No name.py retry or other ~/.claude edit is performed.

Remaining original acceptance gaps are the forbidden/unrun signing integration and inherited
npm pretest drift, alongside the irreversible record of the test private-file violation.
Remaining host actions are all outside this lane: S1–S5 execution, Mac CA deletion, static-key
consumer discovery/restriction/retirement and real authentication proofs. Stopping after the
requested final ACK and badge close, with these limitations explicit.

**Signed: Ivo**
