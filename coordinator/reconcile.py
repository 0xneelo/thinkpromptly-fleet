#!/usr/bin/env python3
"""Apply reader attestation cards to the board — the reconciliation pass (M2).

Usage:
  python3 coordinator/reconcile.py --cards <cards.json> [--board coordinator/board.json]
                                   [--now ISO] [--dry-run]

DESIGN-v1 §4e: "a reader checks every lane's top claim against its evidence link
and every effective decision against its source; mismatches open DISPUTED. This
pass is the role's actual justification for existing."

The duty is split, on purpose:

  - a bounded read-only reader session does the JUDGING and returns typed
    attestation cards (`.claude/skills/coordinator-reconcile/SKILL.md`);
  - this script does the deterministic board mutation and NOTHING else.

The script never judges. It never picks a winner between a lane's claim and a
reader's card — a contradiction opens DISPUTED with both attestations preserved
and routes to the operator (DESIGN §2 hard nevers).

Card shape (DESIGN §2, input 3, plus the quote M2 requires):

  {"lane": "L3", "claim": "the lane's top claim, quoted from the board",
   "verdict": "supports" | "contradicts" | "inconclusive",
   "evidence_link": "...", "observed_at": "ISO",
   "quote": "the contradicting or supporting quote"}

Exit 0 = applied (or dry-run), exit 1 = a card was rejected; nothing is written.
"""

import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import board_lib  # noqa: E402  (path fix must precede the import)

VERDICTS = ("supports", "contradicts", "inconclusive")

DISPUTE_NOTE = ("Both attestations preserved; any done state is suppressed, never overwritten. "
                "The Coordinator never picks a winner — the operator rules (DESIGN §2).")


def fail(message):
    print("FAIL: %s" % message, file=sys.stderr)


def nonempty_str(value):
    return isinstance(value, str) and value.strip() != ""


# --- validation: every card, before any mutation --------------------------

def validate_cards(cards, lanes_by_id, fails):
    for index, card in enumerate(cards):
        label = "card #%d" % index
        if not isinstance(card, dict):
            fails.append("%s is not an object" % label)
            continue
        if nonempty_str(card.get("lane")):
            label = "card #%d (lane %s)" % (index, card["lane"])
            if card["lane"] not in lanes_by_id:
                fails.append("%s: no such lane on the board" % label)
        else:
            fails.append("%s: missing 'lane'" % label)

        if not nonempty_str(card.get("claim")):
            fails.append("%s: missing 'claim' — the card must quote the lane's top claim so the "
                         "board can show what was actually checked" % label)

        verdict = card.get("verdict")
        if verdict not in VERDICTS:
            fails.append("%s: verdict %r is not one of %s" % (label, verdict, " | ".join(VERDICTS)))

        if not board_lib.iso_ok(card.get("observed_at")) or card.get("observed_at") is None:
            fails.append("%s: observed_at must be ISO-8601, got %r" % (label, card.get("observed_at")))

        # An unquoted contradiction is an opinion, not an attestation.
        if verdict == "contradicts" and not nonempty_str(card.get("quote")):
            fails.append("%s: a 'contradicts' card needs a verbatim 'quote' from the evidence. An "
                         "unquoted contradiction is an opinion, and an opinion does not open "
                         "DISPUTED (M2)." % label)


# --- application ----------------------------------------------------------

def apply_contradicts(lane, card, now_iso, changes):
    """Open DISPUTED, preserving the lane's attestation and the reader's."""
    prior_state = lane.get("state")
    disputed = lane.get("disputed")
    if not isinstance(disputed, dict):
        disputed = {
            "opened_at": now_iso,
            # The lane's own side, captured before the state is suppressed.
            "lane_attestation": {
                "claim": lane.get("goal"),
                "done_milestone": lane.get("done_milestone"),
                "suppressed_state": prior_state,
                "owner": lane.get("owner"),
                "reported_at": lane.get("reported_at"),
                "evidence": list(lane.get("evidence") or []),
            },
            "reader_attestations": [],
            "note": DISPUTE_NOTE,
        }
        lane["disputed"] = disputed
    disputed.setdefault("reader_attestations", []).append({
        "claim": card["claim"],
        "verdict": "contradicts",
        "quote": card["quote"],  # verbatim, never summarised
        "evidence_link": card.get("evidence_link"),
        "observed_at": card["observed_at"],
    })

    link = card.get("evidence_link")
    if nonempty_str(link):
        evidence = lane.setdefault("evidence", [])
        if link not in evidence:
            evidence.append(link)

    lane["state"] = "DISPUTED"
    changes.append("%s: %s -> DISPUTED (contradicted; both attestations kept, operator rules)"
                   % (lane["id"], prior_state))


def apply_supports(lane, card, changes, notes):
    """Promote done-claimed to done-verified, and only that."""
    link = card.get("evidence_link")
    if lane.get("state") != "done-claimed":
        notes.append("%s: supports, but state is %r — no promotion. Only done-claimed is promoted "
                     "(DESIGN §4b)." % (lane["id"], lane.get("state")))
        return
    if not nonempty_str(link):
        notes.append("%s: supports, but the card carries no evidence_link — verified_at writes only "
                     "against an evidence link (DESIGN §4). No promotion." % lane["id"])
        return

    lane["state"] = "done-verified"
    lane["verified_at"] = card["observed_at"]
    evidence = lane.setdefault("evidence", [])
    if link not in evidence:
        evidence.append(link)
    changes.append("%s: done-claimed -> done-verified, verified_at %s"
                   % (lane["id"], card["observed_at"]))


def reconcile(board, cards, now_iso):
    lanes_by_id = {lane["id"]: lane for lane in board.get("lanes", [])
                   if isinstance(lane, dict) and isinstance(lane.get("id"), str)}
    changes, notes = [], []
    for card in cards:
        lane = lanes_by_id[card["lane"]]
        verdict = card["verdict"]
        if verdict == "contradicts":
            apply_contradicts(lane, card, now_iso, changes)
        elif verdict == "supports":
            apply_supports(lane, card, changes, notes)
        else:
            notes.append("%s: inconclusive — no change. %s"
                         % (lane["id"], card.get("quote") or "(no quote)"))
    return changes, notes


def load_cards(path):
    """A cards file is a JSON list, or an object with a 'cards' list."""
    with open(path, encoding="utf-8") as handle:
        payload = json.load(handle)
    if isinstance(payload, dict) and isinstance(payload.get("cards"), list):
        return payload["cards"]
    if isinstance(payload, list):
        return payload
    raise ValueError("expected a JSON list of cards, or an object with a 'cards' list")


def main(argv=None):
    parser = argparse.ArgumentParser(
        description="Apply reader attestation cards to the coordinator board (M2).")
    parser.add_argument("--cards", required=True, help="JSON file of attestation cards")
    parser.add_argument("--board", default=board_lib.default_board_path(),
                        help="board to update (default: coordinator/board.json)")
    parser.add_argument("--now", default=None, metavar="ISO",
                        help="timestamp for opened disputes (default: now, UTC)")
    parser.add_argument("--dry-run", action="store_true",
                        help="report what would change; write nothing")
    args = parser.parse_args(argv)

    now = board_lib.now_utc()
    if args.now is not None:
        now = board_lib.parse_iso(args.now)
        if now is None:
            fail("--now is not ISO-8601: %r" % (args.now,))
            return 1

    try:
        board = board_lib.load(args.board)
    except (OSError, ValueError) as exc:
        fail("cannot read %s: %s" % (args.board, exc))
        return 1
    try:
        cards = load_cards(args.cards)
    except OSError as exc:
        fail("cannot read %s: %s" % (args.cards, exc))
        return 1
    except ValueError as exc:
        fail("%s: %s" % (args.cards, exc))
        return 1

    if not cards:
        print("OK: no cards — nothing to reconcile.")
        return 0

    lanes_by_id = {lane.get("id"): lane for lane in board.get("lanes", []) if isinstance(lane, dict)}
    fails = []
    validate_cards(cards, lanes_by_id, fails)
    if fails:
        for problem in fails:
            fail(problem)
        print("REJECTED: %d card(s) invalid — the board was not touched." % len(fails), file=sys.stderr)
        return 1

    changes, notes = reconcile(board, cards, board_lib.to_iso(now))

    for line in changes:
        print("CHANGED: %s" % line)
    for line in notes:
        print("NOTE:    %s" % line)

    if args.dry_run:
        print("DRY RUN: %d card(s) read, %d change(s) withheld — %s unchanged."
              % (len(cards), len(changes), args.board))
        return 0

    if changes:
        board_lib.save(args.board, board)
    print("OK: %d card(s) applied — %d lane change(s), %d reported without change."
          % (len(cards), len(changes), len(notes)))
    if changes:
        print("Next: python3 coordinator/check.py %s" % args.board)
    return 0


if __name__ == "__main__":
    sys.exit(main())
