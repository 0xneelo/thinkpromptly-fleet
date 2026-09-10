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
Push SHA: pending.

## Operational boundaries

No SSH to any host, no minting, no agent socket access, no ~/.ssh reads or writes.
No host apply, Mac deck restart, ~/.claude edit, other branch or worktree change.
The prescribed badge --show returned WORKER / Ivo. Registry POST returned 401; the
seat fence was respected with no retry. Linear scan returned oauth_token_invalid_grant;
issues/comments remain in LINEAR-PENDING.md, not posted. No issue IDs fabricated.
Canonical git committer: 0xneelo <204101082+0xneelo@users.noreply.github.com>.

Signed: Ivo
