# Linear pending — ssh-ca-rotation
Seat 20 had no Linear MCP on 2026-09-10. Worker files these (project `remote-system`, labels `agent:ivo`, `project:remote-system`, `subproject:deploy-keys`, `session:cli-worker`), or keeps them here with timestamps.
1. `[Ivo · security-engineer] mint script: CA_PUB override, ca2 Key ID tag, --daily/--admin (M1)`
2. `[Ivo · security-engineer] trust scripts for both CAs, rog-strix scripts committed (M2)`
3. `[Ivo · security-engineer] principals templates + apply/verify scripts (M3)`
4. `[Ivo · security-engineer] keys screen Daily/Admin + mint route profile (M4)`
5. `[Ivo · security-engineer] runbook + final-state docs (M5)` — plus one `operator:decision`: vibes-asus trust state.

## 2026-09-10 — Ivo execution status

Project: remote-system / deploy-keys. Tag: agent-ivo. Labels for all M1–M5 entries:
`agent:agent-ivo`, `project:remote-system`, `subproject:deploy-keys`, `session:cli-worker`.
Linear project issue scan failed with `oauth_token_invalid_grant`; no issue, comment, or
state transition was sent. Existing M1–M5 entries remain pending. Retry once per milestone.
Registry POST returned HTTP 401 (seat fence); skipped permanently, including PENDING registration.
Badge verified: WORKER / Ivo. Canonical git identity verified. Reads, edits, and diff reviews
are performed by Ivo directly under the explicit Codex exception; no subagents.

M1 status: In Progress locally. Implementing profile validation and public-CA override;
non-minting regression tests first. The real signing integration test is opt-in and will not
run without an explicit exception to the no-minting/private-file rule.

Pending operator:decision — vibes-asus trust state. Options: owner audits and approves
onboarding as a sixth CA host, or keep outside this rotation. Recommendation: keep outside
until its trust and account state are verified by its owner. No guessed principal or access.

Pending operator:decision — admin plus box tag is a union, not a restriction. Preserve the
contract's additive Admin chips and label this clearly; use a tag-only Admin CLI mint to
prove single-host refusal. Recommendation: do not claim additive tags narrow admin access.
Source: https://man.openbsd.org/sshd_config (AuthorizedPrincipalsFile).

Signed: Ivo

## O20 compiler and final-suite receipt — 2026-09-10T21:31:14Z

Project remote-system / deploy-keys. Tag agent-ivo; labels agent:agent-ivo,
project:remote-system, subproject:deploy-keys, session:cli-worker.

Would-be completion comment: O20-IVO-COMPILE-3 compiler run succeeded. Generated app.js,
fixture.js, and props.json were byte-identical; restored the requested hand-maintained
files and generated S2 evidence. Keys tests: 22/22 pass. Empty compiler receipt pushed
and independently verified: 1397a4af819d39d5d49c7e575971e6fd2544b843.
The completed full-suite receipt on bce90453daae2af0710f2eca6d9aa2a019d14f1e is
756 total / 754 pass / 1 exempt credits failure / 1 unrun signing integration.
All nine keysLive bus-fixture regressions were fixed. Full acceptance is not claimed.
Linear retry returned oauth_token_invalid_grant; this comment was not posted.

Security incident correction: inherited GitHub train fixtures generated disposable RSA
private key files during full-suite testing, violating the lane's no-private-files rule.
No real CA or SSH credential was used. Ivo disclosed this and removed 27 inactive test
RSA cache files and the isolated suite HOME's test-only bus-token file without reading
contents. The cleanup does not undo the violation. REPORT.md corrects the earlier blanket
no-key-generation claim. No full-suite rerun followed discovery.

Would-be needs:general issue: [Ivo · security-engineer] Clean up GitHub train RSA fixtures
and define safe execution for strict no-private-file lanes. Labels: needs:general,
agent:agent-ivo, project:remote-system, subproject:deploy-keys, session:cli-worker.
The existing fake-op helper caches generated RSA keys under temporary train directories;
the tests leave those caches behind. Add guaranteed cleanup and an explicit test selection
boundary so strict lanes can avoid credential generation. This is outside CA rotation
implementation; no unrelated test-helper changes were made here.

Close receipt: name.py close Ivo failed because the script is absent on this box (exit 2).
mark.sh --clear succeeded (exit 0). No Done state or successful name release is claimed.
Signed: Ivo

## M2 local completion — 2026-09-10

Would-be M1/M2 issue comments: implementations and offline checks recorded in REPORT.md.
M1 pushed d36b6db659af13044dc462d21f0bca3edbcfecb4. M2 6/6 offline tests pass;
ShellCheck and PowerShell parse clean. Linear retry: oauth_token_invalid_grant.
No status/comment sent. Signed: Ivo

Pending needs:general — inherited npm pretest extractor/fixture titles disagree about
goals/unblock on the launch base. Reproduce: npm test, before Node tests execute.
Project remote-system / deploy-keys; agent:agent-ivo; session:cli-worker.
Keep outside CA rotation implementation. Signed: Ivo

## M3 local completion — 2026-09-10

M2 pushed a17053c21e3ceca6f93e7a5043a2e239f6ec504e. M3 artifacts and 16/16 offline
checks are described in REPORT.md. All reads/edits/reviews performed directly by Ivo.
Linear retry still oauth_token_invalid_grant; no comments or state changes posted.
Signed: Ivo

## M4 local completion — 2026-09-10

M3 pushed 9da5f1a02dc08ebd5f0f3b4a1e70f9fa040eec5e. M4: 23/23 unit/route tests and
offline Playwright proof pass. Linear retry still oauth_token_invalid_grant. Would-be
completion comment is in REPORT.md; nothing posted to Linear. Signed: Ivo

Pending needs:general — existing v2 desktop shell crowds out the keys panel at 390px.
The isolated mint card fits; shell responsive layout is outside this security lane.
Reproduce /app#keys at 390px with shell panels open. Keep scope outside CA rotation.
Labels: project:remote-system, subproject:deploy-keys, agent:agent-ivo, session:cli-worker.
Signed: Ivo

## M5 local completion — 2026-09-10

M4 pushed 51b95537ce9e03ea30c965d24fc29cc23f4a90b6. RUNBOOK.md and final-state docs
prepared; 46 focused passes, no failures, one intentionally unrun signing integration.
The signing test requires clarification of the hard no-minting rule; no exception has
been received and none is inferred. Linear retry: oauth_token_invalid_grant.
Would-be milestone/final comments are in REPORT.md; nothing posted. Signed: Ivo

## Final repository receipt — 2026-09-10T21:27:31Z

Project remote-system / deploy-keys. Tag agent-ivo; labels agent:agent-ivo,
project:remote-system, subproject:deploy-keys, session:cli-worker.

All M1–M5 implementation commits are pushed and independently verified; REPORT.md
contains every full SHA. M5: 9d65bca6e4f026408db7d72f16da96c0bc5193a4. Final hardening:
bce90453daae2af0710f2eca6d9aa2a019d14f1e. Final suite: 756 tests, 754 pass, one explicitly
exempt credits 3 !== 1 failure, one unrun signing test. No lane regression remains among
executed tests. Focused 46 pass / 0 fail / 1 unrun; offline browser and ShellCheck pass.

Would-be operator:decision issue: [Ivo · security-engineer] Resolve M1 signing-test versus
absolute no-minting/private-file rule. Options: keep the hard prohibition and accept an
explicitly deferred signing integration, or approve only isolated throwaway signing with
cleanup, no agent, no real CA, and no ~/.ssh reads. Recommendation: keep the prohibition
until the operator explicitly decides. No exception has been received or assumed.

Inherited npm pretest title drift remains needs:general, without an exemption claim.
No Linear operation succeeded; no Done status or comment is claimed. Full acceptance is
not asserted. Actual host applies and Mac discovery remain outside this repository lane.
Signed: Ivo

## Audit and final-item completion — 2026-09-10T22:02:59Z (box UTC clock)

Would-be issue/comment title: [Ivo · security-engineer] Complete SSH CA rotation A/B/C
fixes, Legacy TTL controls and portable Mac mock (O20-IVO-FINAL-2).
Project: remote-system / deploy-keys. Tag: agent-ivo. Labels: agent:agent-ivo,
project:remote-system, subproject:deploy-keys, session:cli-worker, milestone.

All A1–A12, B-H1/B-M1–M5/B-L1–L6 and C1–C6 are FIXED with individual pushed SHAs and
regression/dry-run evidence in AUDIT-2026-09-11.md. The full commit receipt is in REPORT.md.
Legacy defaults to 8h with 1h/4h/8h chips; new profiles have separate pointers; the file/exact
env state flag and actual machine-user guard hold. Admin box chips were removed (B-M5);
that earlier pending additive-chip decision is resolved by O20's binding option.
Windows recovery/command instructions and mandatory baseline refusal are documented.

Final focused audited run: 129 total / 128 pass / 0 fail / 1 unrun signing integration.
Legacy TTL red: 22 pass/2 fail; green 24/24. Offline browser proof passes; L7 71/71.
Compiler rerun succeeded, generated trio unchanged; source overwrites restored as instructed.
Portable mock stat follow-up red: 6 pass/1 fail/1 skip; green: 7 pass/0 fail/1 skip.
Historical full suite: 756 total / 754 pass / 1 allowed credits failure / 1 signing skip
at bce9045. All nine bus-fixture regressions are fixed. No full-suite rerun after the
private-file incident: the unsafe GitHub train fixture would repeat credential generation.
The original acceptance gaps and private-file incident remain explicit in REPORT.md.

Final audit Linear retry returned oauth_token_invalid_grant: no issue/comment/status sent.
Registry 401 fence remains honored, no retry. Ivo performed every read/edit/diff review
without subagents, under the explicit Codex exception. No SSH, SSH mint, host apply,
agent access, or worker ~/.ssh access occurred. Final badge clear succeeded at 2026-09-10T22:02:59Z (exit 0).
Seat 20 releases the name on the Mac; no name.py retry was attempted on german-box.

Signed: Ivo
