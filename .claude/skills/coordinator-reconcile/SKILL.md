---
name: coordinator-reconcile
description: Run the Coordinator reconciliation pass (M2) — spawn one bounded read-only reader per lane to check that lane's top claim against its evidence link, collect typed attestation cards, and apply them with reconcile.py so a contradicted claim opens DISPUTED with the quote and a supported done-claim is promoted to done-verified. Use when the weekly reconciliation is due, when the operator asks "is the board actually true / check the done lanes / verify L3", or when a done-claimed lane has sat unattested past the policy window.
---

# Coordinator reconciliation pass (M2)

DESIGN-v1 §4e: *"a reader checks every lane's top claim against its evidence link and every
effective decision against its source; mismatches open DISPUTED. **This pass is the role's
actual justification for existing.**"* A board without it is MEMORY.md with better CSS.

**The duty is split and the split is the point.** Readers judge; the script writes. You never
do both in one head.

| Who | Does | Never does |
|---|---|---|
| bounded read-only reader | looks at ONE claim and ONE evidence link, returns a card | writes the board, dumps the evidence, judges a second claim |
| `coordinator/reconcile.py` | the deterministic board mutation | judges anything |
| you (the pass) | dispatch readers, collect cards, run the script | pick a winner in a dispute |

## 1. Read the board, pick the claims

```bash
python3 coordinator/check.py
```

Then read `coordinator/board.json`. For each lane, the claim to check is its **top claim**:
its `done_milestone` when the lane is `done-claimed` or `done-verified`, otherwise its
current `goal` plus whatever state it asserts. Note the lane's first `evidence` link — that
is what the reader checks the claim against.

Prioritise, in this order: `done-claimed` lanes with no attestation, `done-verified` lanes
whose `verified_at` is older than the lane's cadence (a verified stamp is a decaying
assertion, DESIGN §4), then everything else.

## 2. One falsifiable claim per reader

Spawn bounded read-only readers — uncapped in count, **tools not workers** (DESIGN §9.4),
so this does not violate the never-mint-workers rule. Launch them in one message so they run
concurrently.

Each reader gets exactly one claim and one link, and returns **a card, never a dump**:

```json
{"lane": "L3", "claim": "the lane's top claim, quoted from the board",
 "verdict": "supports" | "contradicts" | "inconclusive",
 "evidence_link": "https://... or git:<sha>", "observed_at": "2026-08-29T13:05:00Z",
 "quote": "the contradicting or supporting quote, verbatim from the evidence"}
```

Rules to put in every reader's prompt:

- Check **only** the claim you were given against **only** the link you were given.
- `contradicts` requires a **verbatim quote** from the evidence. No quote, no contradiction —
  an unquoted contradiction is an opinion, and `reconcile.py` rejects the whole run.
- Cannot reach the link, needs credentials, the link is ambiguous → `inconclusive`. Guessing
  is worse than nothing.
- Return the card and nothing else. No summary of the repo, no recommendation, no fix.

## 3. Apply the cards

Collect the cards into one JSON file (a list, or `{"cards": [...]}`), then:

```bash
python3 coordinator/reconcile.py --cards /tmp/cards.json --board coordinator/board.json --dry-run
python3 coordinator/reconcile.py --cards /tmp/cards.json --board coordinator/board.json
python3 coordinator/check.py
```

What the script does, deterministically:

- **`contradicts`** → lane state becomes `DISPUTED`; a `disputed` block preserves **both**
  attestations — the lane's own claim and state, and the reader's card with the quote
  verbatim. Any done state is **suppressed, never overwritten in place**. The Coordinator
  never picks a winner (DESIGN §2 hard never) — the operator rules.
- **`supports`** → promotes `done-claimed` to `done-verified` and stamps `verified_at` from
  `observed_at`, and only when `evidence_link` is present. It promotes from no other state.
- **`inconclusive`** → no change, reported.
- Any invalid card → the whole run is rejected, exit 1, and the board is not touched.

## 4. Route the disputes, then stop

Every lane the pass moved to `DISPUTED` is an **exception for the operator** — a tracker
record with the usual lifecycle (`pending → acknowledged → ruled → verified`), one thread per
incident, carrying both attestations. If the tracker is unreachable, write the same content
to `coordinator/inbox/<ISO>-coordinator-EXCEPTION.md`.

Commit the board change with the cards' provenance in the message, then stop:

```
coordinator: reconcile <ISO-date> — <n> cards, <n> disputed, <n> verified
```

## Hard nevers

- Never adjudicate a dispute. Record `DISPUTED`, keep both sides, route to the operator.
- Never open `DISPUTED` on an unquoted contradiction.
- Never set `done-verified` without an evidence link.
- Never edit a lane's `goal`, `done_milestone`, or `owner` — those change only on an
  operator event.
- Never let a reader read source code beyond the one link it was given, and never accept a
  dump in place of a card.
- Never build, and never mint builders or workers.
