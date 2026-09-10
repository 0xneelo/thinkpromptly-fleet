# SSH CA rotation — final repository delivery report

**Ivo · security-engineer · agent-ivo**

Project: **remote-system / deploy-keys**. Worktree: `ssh-ca-rotation`.

Branch: `agent-ssh-ca-rotation`; launch base: `162f600`.

**M1–M5 repository artifacts are pushed. Full acceptance is not claimed:** the required
real-signing integration test remains unrun under the explicit no-minting/private-file
rule. An exception was requested; none has been received. No host operation is authorized
or implied by this delivery. RUNBOOK.md is the future owner apply plan.

## Pushed milestones

Every row was pushed using a newly brokered token in GH_TOKEN only and independently
verified against `git ls-remote` with another fresh broker token. No token in argv, URL,
file, log, or report. Canonical author/committer is
`0xneelo <204101082+0xneelo@users.noreply.github.com>`; hooks were not bypassed.

| Milestone | Pushed SHA | Delivered artifacts |
|---|---|---|
| M1 | `d36b6db659af13044dc462d21f0bca3edbcfecb4` | mint profiles, public-CA overrides, ca2 tag, no-mint preview, test seam |
| M2 | `a17053c21e3ceca6f93e7a5043a2e239f6ec504e` | dual-CA trust transactions, Windows SYSTEM restart/recovery, rog-strix scripts |
| M3 | `9da5f1a02dc08ebd5f0f3b4a1e70f9fa040eec5e` | five principal template sets, account/config apply, verification, aliases, sudoers template |
| M4 | `51b95537ce9e03ea30c965d24fc29cc23f4a90b6` | Daily/Admin keys controls, validated mint route, manual logic.js mirror, tests |
| M5 | `9d65bca6e4f026408db7d72f16da96c0bc5193a4` | RUNBOOK.md, final-state AGENT/README docs, rollback/retirement preview tests |
| Final hardening | `bce90453daae2af0710f2eca6d9aa2a019d14f1e` | protected policy-path checks, inheritable SYSTEM recovery ACLs, fixture render guard |

Commit links use the actual origin repository:
[history of this branch](https://github.com/0xneelo/thinkpromptly-fleet/commits/agent-ssh-ca-rotation).
The later report-only receipt commit records these immutable implementation SHAs.

## Acceptance against README 1–5

| # | Status | Evidence / limitation |
|---|---|---|
| 1 | **OPEN** | **756 total: 754 pass, 1 explicitly exempt credits failure (3 !== 1), 1 unrun signing test**. Focused tests: 46 pass, 0 fail, 1 unrun opt-in signing test. All other lane regressions fixed. `npm test` also has inherited pretest fixture-title drift; no exemption is claimed for it. |
| 2 | PASS (repository/offline) | ShellCheck 0.11.0 clean on all 6 new/changed .sh entry scripts. All 4 delivered PowerShell files parse. Windows DryRun/WhatIf and Linux dry-runs preserve exact fixture snapshots; rollback previews and Linux validation/reload failure restoration pass. No real apply was executed. |
| 3 | PASS (scan + diff review) | Full-branch git grep for private-key/certificate blobs and recognized token formats: 0 matching files. Changes reviewed contain public keys/fingerprints, code, and synthetic test fixtures only. No operational credential material committed or reported. |
| 4 | PASS | No SSH to any host, no certificate minting or key generation, no agent-socket access, and no read/write of the worker's ~/.ssh. No host apply, Mac deck restart, ~/.claude file edit, other branch/worktree mutation, or sibling-agent orchestration. |
| 5 | PASS (repository) | RUNBOOK.md covers S1→S5, named owners, 5-host command/check/rollback tables, Windows task completion, CA overlap, 15-check role/scope matrix, Mac discovery/deletion gates, collisions, and all four TO-DISCOVER consumer rows. All 9 referenced script entry files exist. |

The real-signing test is present in `test/deploy-cert-mint.test.js`, guarded by
`SSH_CA_ALLOW_TEST_MINT=1`. It generates temporary credentials, signs through a test-only
file signer, inspects SSH metadata, and deletes its temporary directory. It is **not run**
in this goal. It requires a direct exception to the hard prohibition; elapsed time is not
approval. Therefore “all new tests pass” cannot be asserted without qualification.

## Validation details

- M1 red-before-green: 1 pass / 4 fail / 1 skipped before implementation, then 5 pass /
  0 fail / 1 skipped. Covers profile/principal/TTL validation, public override precedence,
  v1/non-v1 Key ID distinction, and zero-write previews.
- Trust/principals/verify/renderer: final **18/18** pass, with PowerShell running offline
  from a local 7.4.6 runtime. Tests include both Windows dry-run spellings, last-CA refusal,
  rollback bytes/ACL previews, no fixture mutation, and fake transport success/refusal/error
  distinction. Python transaction tests inject validation/reload failures against temporary
  public configuration; all service/account commands are mocked.
- Keys and actual mint route: **23/23** pass. Requests exercise the existing Origin fence,
  fixed durations, approved/duplicate/unknown tags, arbitrary-principal rejection, and exact
  spawn arguments with the mint process mocked.
- Offline Playwright: Daily default, tags hidden until Admin, label-keyed chip join, unknown
  vibes-asus disabled, both mocked request bodies, no page errors, and isolated mint-card
  layout at 390px. Every request is fulfilled locally; no live API or mint is contacted.
  The surrounding desktop shell has an existing narrow-viewport limitation, queued separately.
- The first full suite after M4 found 9 fixture-render regressions caused by accessing
  absent FD.screens. Corrected the presence/shape guard; all **32/32** bus/keys/route tests
  and the browser proof then passed. These failures are not exempted.
- Final full suite: **756 total: 754 pass, 1 explicitly exempt credits failure (3 !== 1), 1 unrun signing test**. The only allowed observed failure is the existing
  credits discovery `3 !== 1`. The separately allowed routable-screen failure did not occur.
- `npm test` pretest fails before running tests: extractor titles omit `goals`/`unblock`
  present in fixture.js. This was observed before lane code changes. The extractor,
  fixture.js, and template.dc.html are byte-identical to the launch base (git diff empty).
  This is recorded as needs:general in LINEAR-PENDING.md, not silently exempted. Direct
  suite invocation is `node --test --test-concurrency=1 test/*.test.js` with isolated HOME,
  SSH_AUTH_SOCK unset, and real SSH blocked by the test PATH wrapper.
- Dependencies were installed only in this worktree; `npm rebuild node-pty` resolved the
  initial missing native module. No global package installation or host configuration changed.

The branch-wide material scan was run with git grep, not inferred from git status:

```bash
git grep -IlE -- '-----BEGIN ([A-Z0-9]+ )*PRIVATE KEY-----|ssh-[a-z0-9-]+-cert-v01@openssh.com[[:space:]]+[A-Za-z0-9+/=]{32,}|gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{40,}|sk-(proj-)?[A-Za-z0-9_-]{40,}'
```

Exit 1 / no matches. A corresponding staged-branch scan included the new runbook/report.
This is a format scan plus human diff review, not a claim that regex detects every possible
secret. Repository-only S4 search for id_ed25519 in server.js/machines.json also returned
no matches. Mac-side discovery remains for its owner; the worker did not inspect those files.

## Review decisions and limitations

Ivo performed every read, edit, pre/post security review, and diff review directly under
the user's explicit Codex exception. No reader/builder/reviewer/Fable agents were spawned.
Self-review corrections included immutable mint output directories, relative output-path
normalization, effective Linux sshd policy checks, disabled rollback accounts with retained
data, snapshot path validation, saved ACL restoration, explicit Windows ACL inheritance,
and refusal of unprivileged-write policy files/directories even when content is unchanged.
Windows live ACL/service behavior remains an owner-side gate; only parsing/previews ran here.

The archived rog-strix inputs remain **verbatim** in inputs/. Their delivered counterparts
necessarily changed beyond CA append logic for the required dry-run/rollback guarantees:
bootstrap now prints a local owner command, and trust scripts do not add an operator fallback
key. This departure from “only the multi-CA change” is explicit. The bootstrap public key
fingerprint identifies 1Password wsl-machine, not CA v2. Existing fallback authorization is
preserved. No real v2 CA was created by this lane.

Admin tags are alternatives, as [OpenSSH documents](https://man.openbsd.org/sshd_config),
so `admin,promptly-only` does not restrict access. The UI makes that clear. The CLI supports
an Admin-profile tag-only cert for the required 1-success/4-refusal check. Daily remains
`deploy`/8h/PTY only; Admin remains 1h with default extensions. Legacy CLI -n retains the
1h/4h/8h cap. Legacy HTTP principals payloads now return 400 and must migrate to the profile
schema. UI rollout and CA_PUB configuration are future operator actions; the deck was not
restarted. logic.js was mirrored manually; v2:compile was never run.

Impeccable product guidance informed the controls using the existing screen and prescribed
UX. No new product/design setup or broader redesign was introduced. The user's lane scope
prevailed over optional skill setup work.

## Registry, Linear, and remaining owner work

Badge --show verified **WORKER / Ivo**. Registry POST for FD-ssh-ca-rotation returned
**401**; the seat fence was respected, with no retry (including no PENDING registration).
Linear scan and milestone retries returned **oauth_token_invalid_grant**. No issue, comment,
assignment, or status transition is claimed. Would-be issues, milestone comments, and
out-of-scope decisions remain in LINEAR-PENDING.md, signed Ivo.

Remaining repository acceptance gaps: unrun signing integration and inherited npm pretest
fixture-title drift. Pending owner decisions include vibes-asus trust, additive Admin tags,
and Mac-side static-key consumers. Actual S1–S5 applies, Mac private-key deletion, consumer
restrictions/retirements, and live login proofs are future human-gated work, outside this
worker's authorization. The final-state documentation describes the target, not observed
production. See RUNBOOK.md for exact future actions and rollback.

**Signed: Ivo**
