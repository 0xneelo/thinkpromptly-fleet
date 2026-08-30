# XYZ-1888 — bus double-gate: report

**Worker:** Traudl · backend-developer
**Branch:** `agent-traudl` · **Base:** `origin/main` @ `e860e47`
**Issue:** XYZ-1888 (related XYZ-1844, XYZ-1854)

## Base note

The goal pack named `c99f647` as the base. `origin/main` had already moved to `e860e47`, and
`c99f647` is an ancestor of it. I built on `e860e47` — the later tip, same history.

## The defect

`server.js` ran two shared-secret gates over one HTTP header.

1. The tailnet listener gated **every POST** on `tailnetAuthed(req)`, which reads
   `authorization: Bearer <FLEET_TAILNET_KEY>`.
2. `/api/messages` and `/api/messages/retry` then required `busAuthorized(req)`, which reads
   `authorization: Bearer <BUS_TOKEN>` — the **same header**.

One header carries one value. With `FLEET_TAILNET_KEY` armed, a box worker could satisfy gate 1
or gate 2, never both. `bin/fleet-message.js` sends only the bus token, so it failed gate 1 with
`401 unauthorized`. The worker→deck half of the bus was structurally dead, not misconfigured.

XYZ-1854 tested each gate alone, and both passed. Nothing armed both at once, which is the only
configuration the live deck runs.

## The fix

`server.js` — the recommended shape from the issue:

* New `const BUS_ROUTES = new Set(['/api/messages', '/api/messages/retry'])`, declared next to
  `busAuthorized()` so the exemption and the routes it exempts cannot drift apart.
* The S3 gate becomes `if (req.method === 'POST' && !BUS_ROUTES.has(p) && !tailnetAuthed(req))`.
* The bus route dispatch reuses the same set instead of repeating the two literals.

`busAuthorized()` is unchanged and still gates both routes on its own. The change frees the
header, not the authority: the bus token stays mandatory, and it is the only value that opens
the bus. This restores the pre-XYZ-1854 design intent — "the bus-token gate lives only on the
tailnet listener".

No client change. `bin/fleet-message.js` is untouched.

## Proof

`test/bus-tailnet-auth.test.js`. Six new tests, both secrets armed at once, deliberately of
different value and length so nothing can pass by collision.

| Test | Proves |
|---|---|
| stock bus header shape is 200, never 401 | the exact header `bin/fleet-message.js` sends now passes; body carries the bus's own reply |
| a bad payload is 400 | the gate ran and the bus judged the message, rather than a gate refusing it |
| the exemption frees the header, not the authority | no header, the **tailnet key**, and a near-miss bus token each still get `401 invalid message bus token` |
| `/api/messages/retry` composes the same way | the second bus route behaves identically |
| the real `bin/fleet-message.js` gets through | the shipped binary runs as a child process against a two-key deck over the tailnet address, and its reply is the bus's; with the token cleared it is refused |
| no other tailnet POST changed | every other POST route on the listener — `/api/registry`, `/api/registry/delete`, `/api/coordinator/sitrep`, `/api/lease/claim`, `/api/heartbeat`, `/api/credits` — still answers plain-text `401 unauthorized` with no header **and** with the bus token, and each still opens for the tailnet key |

Two existing tests were updated, not deleted around:

* *"the tailnet S3 key and the bus token are separate gates, in that order"* asserted the bug
  itself (bus token + armed key → 401). It is retired; the composition tests above state the
  new contract in its place.
* *"loopback needs no bus token at all"* still passes. It now also asserts that the tailnet
  refusal of a tokenless POST comes from the bus gate (`invalid message bus token`), not the S3
  gate — same 401, different and correct owner.

### The tests are real guards

With `server.js` reverted and the tests kept, **6 of them fail**. The "no other tailnet POST
changed" test passes in both states, which is what a regression guard should do.

### Full suite

`npm test` — **169 passed, 0 failed** (102s).

## Review

A `reviewer` subagent read the diff against the gate question directly: is there any
path/method/trailing-slash/query-string combination where the exemption fires but
`busAuthorized` does not? There is not — the gate and the dispatch test the identical
`BUS_ROUTES.has(p) && req.method === 'POST'` on the same `url.pathname`, so they cannot
disagree. It found no correctness or security defect.

Its one note was a coverage gap: the regression pin covered three routes, not all six. That is
now closed — the test lists every POST route the tailnet listener answers, so the exemption is
pinned as a list of exactly two and a later edit cannot quietly widen it.

## Scope held

* No live deck restart, no live deck writes. Every test runs against the harness in
  `test/http.js`: its own port, its own db, its own hosts file, on `127.0.0.2`.
* No change to the loopback listener, to `busAuthorized()`, to `tailnetAuthed()`, or to any
  route outside the two bus paths.

## What this does not close

XYZ-1844 stays open. This fix is woven but not deployed. It closes only after the operator
deploys it to the deck and a live box→deck round trip succeeds.

— Traudl
