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
