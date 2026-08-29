---
name: coordinator-init
description: Run the Coordinator initiation ritual with the operator present — a grill-me-style interview that COLLECTS the northstar in their own words, the project's lanes with named owners and cadences, the project's own lane_cap, and the cadence policy, then writes coordinator/board.json via init_board.py and stops. Use when the operator types /coordinator-init, says "initiate the coordinator", "set up the coordinator for this project", "let's define the northstar and the lanes", or when a board still carries PROPOSED seeds and someone asks to confirm them.
---

# Coordinator initiation (M6)

> **THE ONE RULE — this ritual COLLECTS. It never invents, drafts, suggests, or seeds.**
> The northstar and the lanes come out of the operator's mouth and are recorded in the
> operator's own words. You do not offer a candidate northstar "to react to". You do not
> propose a lane set from the repo, the tracker, or a handoff doc. You do not fill a gap
> with a placeholder.
> **If the operator is not present, the ritual STOPS.** It does not run half-way, it does
> not write a partial board, it does not leave a draft. Come back when they are here.
> (DESIGN §2 forbids inventing operator intent; R1 and R2 make this ritual the only
> legitimate source of a northstar and a lane set.)

There is **no `grill-me` skill installed on this machine**, so the interview protocol R1 asks
for is embedded below instead of delegated.

## 0. One coordinator per project — refuse an initiated board first (R1)

Before you ask the operator anything, look:

```bash
python3 -c "import json;n=json.load(open('coordinator/board.json'))['northstar'];print(n.get('ruling_id'),n.get('seed'))"
```

A board is **already initiated** when `northstar.ruling_id` is non-null, or when
`northstar.seed` is absent or is not `"PROPOSED"`. `init_board.py` enforces this itself and
exits 1 — you do not need to talk it into refusing, and you must not work around it.

**Refusing is the default and the safe path.** Re-initiation is not a refresh: it discards
the project's accumulated cross-seat memory — the confirmed northstar, every lane's
ownership and history, and the operator queue. So it needs the operator to say so
explicitly, in their own words, live in this session:

```bash
python3 coordinator/init_board.py --answers <answers.json> --out coordinator/board.json \
  --reinit-confirmed "<the operator's verbatim sentence>"
```

Those words are recorded verbatim in the new board under `reinit`. An orchestrator's
"operator said X" is never intent and never authorises this (DESIGN §2, Inputs 1). Never
paraphrase the sentence, never supply it yourself.

**A not-yet-initiated board is a different case.** Its `PROPOSED` seeds bind nothing (R2:
*"coordinator needs to be properly initiated."*) — but PROPOSED is not the same as empty:
those seeded lanes and queue items are the operator's open questions, and initiation
replaces all of them at once. `init_board.py` refuses there too and lists exactly what would
go. Run the interview first, show the operator that list, and only then pass
`--replace-proposed`.

## 1. The interview — one question at a time

Grill-me style: **ask, wait, then push back once on a vague answer before moving on.** A
northstar that survives one round of *"how would you know that was true?"* is worth having.
Do not accept the first mushy sentence. Do not batch the questions into one wall of text —
one question, one answer, one push-back, next.

Push back on: an answer that could be true of any project; an answer with no observable
consequence; a milestone nobody could go and check; an owner who is not a person.
Push back **once**, then take what they give you. You are collecting, not negotiating.

### Q1 — the northstar (one sentence)

> "In one sentence: what is this project for?"

Record the answer **verbatim, in the operator's own words**. Never tidy it, never make it
snappier, never turn it into a slogan.

Then two follow-ups, one at a time:

> "If that were achieved, what would be observably different?"
> "What does it explicitly exclude — what would someone wrongly assume is in it?"

The follow-up answers go into `coordinator/northstar.md`, not into the board: the boot
bundle is size-gated at 8KB and the board carries the sentence only.

Then:

> "Which ruling id records this, and what date do I stamp as confirmed?"

If there is no ruling id yet, the operator makes one now (a tracker id at acceptance — an
intent without an id does not exist, DESIGN §2). Do not invent one.

### Q2 — the lanes

> "How many lanes does this project carry, and what is each one?"

**There is no cap here and you must not suggest one.** R3, verbatim: *"there is no point in
having a limit or amount of lanes, the amount of lanes is dependent on the project and will
be defined during initiation"*. Never say "the usual is six", never nudge toward a number.

For **each** lane, collect all five:

| Field | Question | Rule |
|---|---|---|
| `goal` | "What is this lane driving to?" | one line |
| `done_milestone` | "What exactly will exist when it is done?" | must be capability-shaped — see below |
| `owner` | "Who owns it, by name?" | a **named seat**, never "the fleet" (DESIGN §4) |
| `next_decision` | "What is the next decision this lane needs from you?" | |
| `cadence_hours` | "How often should this lane report?" | hours, an int |

**Capability-shaped milestone.** `done_milestone` must name something a reader can go and
look at. Check each one before you move on:

```bash
python3 -c "import sys;sys.path.insert(0,'coordinator');import board_lib;t=sys.argv[1];print(board_lib.milestone_is_capability_shaped(t), board_lib.milestone_markers(t))" "<the operator's milestone>"
```

A milestone must carry at least `board_lib.MILESTONE_MIN_MARKERS` (currently **two**) distinct
markers out of: link, commit, tracker id, count or threshold, observable verb, file path. Two,
because one alone lets aspiration through — "keep the tests green" has a verb and nothing to
check it against, while "train 67 serving on prod" has a count *and* a verb.

`False` → tell the operator **why** it fails (which markers it has and which it lacks — "it
names a state but no thing to check it against") and **ask again**.
Never rewrite their milestone for them, and never smuggle a marker in to make the check
pass. `init_board.py` re-checks every milestone and refuses the whole board if one fails.

### Q3 — `lane_cap`

> "What is the most lanes this project should ever carry at once?"

The answer is the operator's. **It is not 6 and it is not a default** — the design's old
hard cap is overridden by R3. Write down whatever number they say; it becomes an initiation
parameter in `board.json` and `check.py` validates against it from then on. It must be at
least the number of lanes you just opened.

### Q4 — the cadence policy

Offer each `DEFAULT_POLICY` value (`coordinator/board_lib.py`) as a **starting point to
accept or override**, one at a time:

- `default_cadence_hours` (default 24) — the cadence a lane or queue item gets when it states none.
- `unattested_done_days` (default 3) — a done-claimed lane older than this with no attestation is an exception.
- `queue_item_days` (default 3) — an operator-queue item open longer than this is an exception.

## 2. Write the answers file

Everything collected, and nothing else, into a JSON answers file (keep it out of the repo —
`/tmp` is fine; the board is the record):

```json
{
  "northstar": {"text": "<verbatim>", "ruling_id": "<id>", "confirmed_at": "<ISO>"},
  "lane_cap": 4,
  "policy": {"default_cadence_hours": 24, "unattested_done_days": 3, "queue_item_days": 3},
  "lanes": [
    {"id": "L1", "goal": "...", "done_milestone": "...", "owner": "<named seat>",
     "next_decision": "...", "cadence_hours": 24}
  ]
}
```

Read the northstar sentence back to the operator and get a yes before you write it. If a
word is wrong, it is their word that replaces it, not yours.

## 3. Initiate, validate, show, stop

```bash
python3 coordinator/init_board.py --answers /tmp/coordinator-answers.json --out coordinator/board.json --dry-run
python3 coordinator/init_board.py --answers /tmp/coordinator-answers.json --out coordinator/board.json
python3 coordinator/check.py
```

Add `--replace-proposed` only if the board already carries PROPOSED seeds **and** the
operator has seen the list of what is being replaced (step 0).

Then show the operator the resulting board — northstar, then each lane's goal · milestone ·
owner · cadence — and **stop**.

Write the two northstar follow-up answers into `coordinator/northstar.md` in the same turn,
verbatim, under the ruling id.

The ritual **does not open work**: it does not spawn a seat, does not mint a builder, does
not start a lane, does not build. Initiation ends with a board and a stopped session.

## Hard nevers

- Never invent, draft, or suggest a northstar, a lane, a milestone, an owner, or a `lane_cap`.
- Never run without the operator present.
- Never suggest a lane count or a cap (R3).
- Never rewrite an operator's milestone to pass the capability check.
- Never re-initiate an initiated board without `--reinit-confirmed` carrying the operator's
  own words.
- Never write a `seed` marker onto an initiated board — `PROPOSED` is the pre-initiation
  state, and initiation is what clears it.
- Never build, mint workers, or read source code (DESIGN §2).

## Future (not built)

R1, verbatim: *"the northstar should be defined at the beginning of the coordinator
initiation by using the /grill-me skill there should be only one coordinator per project. In
the future we might create a meta-coordinator (that oversees multiple projects)"*

A meta-coordinator over multiple projects is a **recorded future idea, explicitly out of
v0.2**. Recorded here so it is not re-derived. Build nothing for it.
