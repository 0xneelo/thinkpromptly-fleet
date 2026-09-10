# SSH CA rotation — repository delivery report

Author: Ivo (security-engineer), `agent-ivo`.
Project: remote-system / deploy-keys. Branch: `agent-ssh-ca-rotation`.
Base: `162f600`. Status: implementation in progress; no host acceptance claimed.

## M1

Added CA_PUB/--ca-pub precedence, v2 Key ID tagging, Daily/Admin profiles, strict
profile/principal/TTL checks, non-minting --dry-run, isolated test-signing seam,
and refusal to overwrite existing output directories.
Regression: before implementation 1 pass / 4 fail / 1 skipped; after implementation
5 pass / 0 fail / 1 skipped. The skipped real-signing test requires explicit permission
because this lane prohibits minting and private files. ShellCheck 0.11.0: clean.
Ivo performed reads, implementation, and self-review directly under the Codex exception;
no subagents. Review found no remaining M1 issue; real-signing validation is outstanding.
Pushed and independently verified SHA: `d36b6db659af13044dc462d21f0bca3edbcfecb4`.

## Operational boundaries

No SSH to any host, no minting, no agent socket access, no ~/.ssh reads or writes.
No host apply, Mac deck restart, ~/.claude edit, other branch or worktree change.
The prescribed badge --show returned WORKER / Ivo. Registry POST returned 401; the
seat fence was respected with no retry. Linear scan returned oauth_token_invalid_grant;
issues/comments remain in LINEAR-PENDING.md, not posted. No issue IDs fabricated.
Canonical git committer: 0xneelo <204101082+0xneelo@users.noreply.github.com>.

Signed: Ivo

## M2

Implemented Linux and Windows multi-CA trust transactions with exact file previews,
validation, failure restore, explicit rollback commands, and retained backups. Windows
restart is detached under SYSTEM. Public-only offline fixtures: 6 tests pass, including
Linux validation/reload failure restoration and both Windows DryRun/WhatIf modes.
ShellCheck and PowerShell parser clean. Ivo self-review: fixed Windows PowerShell 5
compatibility and replaced additive ACL grants with explicit protected DACLs.

The rog-strix inputs stay verbatim in inputs/. Their deploy-keys counterparts necessarily
change beyond append logic to meet the binding dry-run/rollback/no-transport constraints:
bootstrap now prints a local owner command; rotation never adds the bootstrap fallback.
Its public fingerprint identifies 1Password wsl-machine, not the CA.
M2 push SHA: pending. Linear retry still oauth_token_invalid_grant; entries remain pending.

Baseline prerequisite finding: npm test stops at pretest fixture title drift (goals/unblock).
The direct test suite is running separately. No exemption is assumed for this preflight;
it will be reported and queued if outside this lane.

Signed: Ivo
