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
M2 pushed and independently verified SHA: `a17053c21e3ceca6f93e7a5043a2e239f6ec504e`. Linear retry still oauth_token_invalid_grant; entries remain pending.

Baseline prerequisite finding: npm test stops at pretest fixture title drift (goals/unblock).
The direct test suite is running separately. No exemption is assumed for this preflight;
it will be reported and queued if outside this lane.

Signed: Ivo

## M3

Five principal template directories, Linux/Windows local account/config apply, explicit
legacy-principal and v1 retirement modes, certificate-only verify script, staged SSH alias
example, and exact-unit sudoers template/renderer added. Existing machines.json already
uses the five deploy aliases; alias User changes are staged for owners, not activated.
No guessed sixth-host trust. Linux effective policy is checked before reload. Rollback
disables a newly created account and retains its files. Windows restores saved ACLs.

16/16 trust/principal/verify/renderer tests pass on offline fixtures; combined with M1:
21 pass, 0 fail, 1 opt-in real-signing test unrun. All six changed/new shell entry scripts
are ShellCheck clean; PowerShell parser clean. Self-review by Ivo, no subagents: corrected
rollback account disabling and ACL restoration, and preserved Linux existing file modes.
M3 pushed and independently verified SHA: `9da5f1a02dc08ebd5f0f3b4a1e70f9fa040eec5e`. Linear retry remains oauth_token_invalid_grant.

Signed: Ivo

## M4

Daily/Admin profile controls and additive Admin tag chips shipped in the v2 keys screen.
Daily defaults to deploy/8h; Admin to admin/1h. Unknown vibes-asus is disabled.
Label-keyed chip join preserved. The server rejects unknown fields/tags, duplicate tags,
profile/TTL conflicts, arbitrary principals, and caller-supplied CA paths before spawning.
The existing Origin fence is unchanged. Legacy API payloads with principals now return 400;
operator CLI legacy -n remains available for transition. logic.js was mirrored by hand;
the compiler was not run. Impeccable product guidance used with the existing screen and
the user's prescribed controls; no broader design/context setup was introduced.

23/23 unit/actual-route tests pass. Playwright offline browser proof passes: Daily default,
Admin tags, label join, unknown host disabled, mocked request bodies, no page errors, and
the isolated mint card at 390px. No request reached a live API and no mint process ran.
Phone-width full-shell layout is an existing limitation, not claimed fixed by this lane.
Self-review by Ivo, no subagents: API payload and DOM chip joins checked; no remaining M4
findings. M4 push SHA: pending. Linear retry still oauth_token_invalid_grant.

Direct pre-M4 suite after native dependency build: 750 tests, 748 pass, 1 exempt credits
failure (3 !== 1), 1 skipped signing integration. npm pretest title drift remains separately
recorded. Initial missing native node-pty module was resolved locally by npm rebuild node-pty.

Signed: Ivo
