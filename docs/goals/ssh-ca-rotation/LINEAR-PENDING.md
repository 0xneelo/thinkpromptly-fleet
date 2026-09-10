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
