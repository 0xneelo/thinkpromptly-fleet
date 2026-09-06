# T3 — operator ruling of 2026-09-07, as received and as implemented

Relayed to this session by DESIGN-35 on 2026-09-07, effective immediately. It amends one acceptance
rule of `docs/goals/fd-v2-s2/README.md` and adds one deliverable.

## The ruling

S2 gets **one** extra allowed substitution. Every seed array/const in `logic.js` — `regData`,
`busSessions`, `busGroups`, `seedThreads`, `orgScopeData`, `keyRows`, `accounts`, `machines`, `dsData`,
`tiles`, `groups`, `titles`, and the data inside `termLinesFor` — becomes `const X = FD.fixture.X`. The
literals move **byte-identically** into `public/v2/fixture.js`, a classic script setting
`window.FD = window.FD || {}; FD.fixture = { … }` keyed by the mock's own identifiers, in source order.
`runtime.js` gains `FD.setData(name, value)`, which replaces `FD.fixture[name]` and triggers the same
re-render path `setState` uses. Every OUT->IN pair is quoted in the commit body. All parity gates are
unchanged: F2 36/36, interaction parity, pixel gate, no-engine.

**Rationale given:** after S2 lands, nine logic slices L2-L10 start at once, each touching only its own
screen's methods in `logic.js` and feeding data through `FD.setData` from adapters. So `logic.js` must
not carry data literals.

**Coordination:** `public/v2/fixture.js` is shared with Juergen (L1), whose `tools/extract-fixture.mjs`
must regenerate it byte-identically from the mock. Whoever lands first creates the file; the other
verifies byte-identity. L1's own pack bars Juergen from touching `index.html`, `logic.js`, `app.js` and
`runtime.js`, so the split of ownership is unambiguous.

## Discrepancy, recorded rather than silently absorbed

The ruling said the amended README §T3 was on the docs branch. It is not, as of the merge this session
performed:

    git fetch origin claude/fleetdeck-v2-redesign-plan-5a5cd5     # 226f02c..826d5fa
    git merge --no-edit origin/claude/fleetdeck-v2-redesign-plan-5a5cd5

After that merge `docs/goals/fd-v2-s2/README.md` is still 115 lines, last touched by `7f0430e`, and
contains no occurrence of `T3`, `fixture`, `setData` or `FD.`. The merge did bring new packs for L1-L4
(`docs/goals/fd-v2-l1` … `fd-v2-l4`), so the branch itself did advance — the S2 amendment simply was not
part of it.

**Decision: proceed on the message.** It is specific enough to implement exactly — the substitution list,
the fixture file's shape, the `FD.setData` contract and the unchanged gates are all named. Blocking a slice
that ships tomorrow evening on a missing paragraph would be the wrong trade, and the ruling's authority
does not depend on which file it arrived in. This note is the audit trail; if the published §T3 later
differs from what is implemented here, this file is where to look first.

Consequence for acceptance: the README's "`logic.js` body byte-identical to the mock's script" checkbox is
now read as **byte-identical except the T3 substitutions**, with the moved literals byte-identical in
`fixture.js` and every OUT->IN pair quoted in the commit. The round-trip proof is extended to cover both
files together, so nothing is lost — the bytes still have to add up.

Signed **Julius**.
