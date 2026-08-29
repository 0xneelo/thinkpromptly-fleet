#!/usr/bin/env python3
"""Write a v0.2 board.json from the answers the initiation ritual collected (M6).

Usage:
  python3 coordinator/init_board.py --answers <answers.json> --out coordinator/board.json
                                    [--replace-proposed]
                                    [--reinit-confirmed "<the operator's verbatim words>"]
                                    [--now ISO] [--dry-run]

This script is a WRITER, not an interviewer and not an author. Every value it
writes comes from the answers file, which the `coordinator-init` skill fills in
from the operator's own words. It invents nothing — not a northstar, not a lane,
not a milestone, not a `lane_cap` (R3: "there is no point in having a limit or
amount of lanes, the amount of lanes is dependent on the project and will be
defined during initiation").

One coordinator per project (R1): it refuses to overwrite an already-initiated
board unless the operator says so verbatim via --reinit-confirmed.

Exit 0 = written (or dry-run printed), exit 1 = refused or invalid answers.
"""

import argparse
import json
import os
import sys
from datetime import timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import board_lib  # noqa: E402  (path fix must precede the import)

# v0.2 board: the policy block, per-lane cadence, and the initiation record.
SCHEMA_VERSION = 2

BOARD_NOTE = "Canonical. Written only by a coordinator run. DESIGN §4."

LANE_FIELDS = ("id", "goal", "done_milestone", "owner", "next_decision", "cadence_hours")

# DESIGN §4: owner is a NAMED seat, never "the fleet". An unowned lane also
# breaks the §3 ordering rule, which matches a sitrep's seat against the owner.
UNOWNED = ("the fleet", "fleet", "the team", "team", "unassigned", "tbd", "nobody", "everyone")

R1_VERBATIM = (
    "the northstar should be defined at the beginning of the coordinator initiation by using "
    "the /grill-me skill there should be only one coordinator per project. In the future we "
    "might create a meta-coordinator (that oversees multiple projects)"
)


def fail(message):
    print("FAIL: %s" % message, file=sys.stderr)
    return 1


# --- the one-coordinator-per-project guard (R1) ---------------------------

def is_initiated(board):
    """True when this board has already been through an initiation.

    PROPOSED is the pre-initiation state and initiation is what clears it, so a
    board is initiated once it carries a northstar ruling id, or once its
    northstar seed marker is gone or is no longer PROPOSED.
    """
    # An explicit initiation record settles it outright.
    if isinstance(board.get("initiation"), dict):
        return True
    northstar = board.get("northstar")
    if not isinstance(northstar, dict):
        # A board with no northstar object at all is a board whose state cannot be
        # read. Treat the unreadable case as initiated: the cost of demanding the
        # operator's words for a board that turned out to be a seed is a sentence,
        # and the cost of the reverse is a live project's memory.
        return True
    if northstar.get("ruling_id") is not None:
        return True
    return northstar.get("seed") != "PROPOSED"


def refusal_text(path, board):
    northstar = board.get("northstar") if isinstance(board.get("northstar"), dict) else {}
    return "\n".join([
        "REFUSED: %s is already initiated." % path,
        "  northstar.ruling_id = %r" % (northstar.get("ruling_id"),),
        "  northstar.seed      = %r" % (northstar.get("seed"),),
        "",
        "One coordinator per project — operator ruling R1, 2026-08-29, verbatim:",
        '  "%s"' % R1_VERBATIM,
        "",
        "Re-initiation is not a refresh. It discards this project's accumulated cross-seat",
        "memory: the confirmed northstar, every lane's ownership and history, and the",
        "operator queue. Refusing is the safe path and is the default.",
        "",
        "To proceed, the operator must authorise it themselves, in their own words:",
        '  --reinit-confirmed "<the operator\'s verbatim sentence authorising re-initiation>"',
        "",
        "That sentence must be:",
        "  - stated by the operator directly — an orchestrator's \"operator said X\" is never",
        "    intent, and never authorises this (DESIGN §2, Inputs 1);",
        "  - passed verbatim and non-empty — no paraphrase, no placeholder, no default;",
        "  - it is recorded, word for word, in the new board under `reinit` with the timestamp.",
    ])


def seeded_content(board):
    """What an existing, not-yet-initiated board would lose if overwritten."""
    lanes = board.get("lanes") if isinstance(board.get("lanes"), list) else []
    queue = board.get("operator_queue") if isinstance(board.get("operator_queue"), list) else []
    return lanes, queue


def seed_refusal_text(path, board):
    lanes, queue = seeded_content(board)
    lines = [
        "REFUSED: %s already exists and carries seeded content." % path,
        "  %d lane(s): %s" % (len(lanes), ", ".join(
            str(lane.get("id")) for lane in lanes if isinstance(lane, dict)) or "-"),
        "  %d operator-queue item(s): %s" % (len(queue), ", ".join(
            str(item.get("id")) for item in queue if isinstance(item, dict)) or "-"),
        "",
        "This board is not initiated — its seeds are still PROPOSED and bind nothing",
        "(operator ruling R2, 2026-08-29: \"coordinator needs to be properly initiated.\").",
        "But PROPOSED is not the same as empty: those lanes and queue items are the",
        "operator's open questions, and initiation would replace all of them at once.",
        "",
        "Writing here is the normal initiation path, so it is allowed — but never silently:",
        "  --replace-proposed",
        "",
        "Run the interview first, show the operator exactly which seeds are being replaced,",
        "and pass the flag only once they have seen the list above.",
    ]
    return "\n".join(lines)


# --- answers validation ---------------------------------------------------

def nonempty_str(value):
    return isinstance(value, str) and value.strip() != ""


def positive_int(value):
    return isinstance(value, int) and not isinstance(value, bool) and value > 0


def validate(answers, fails):
    """Collect every problem with the answers file; never stop at the first."""
    if not isinstance(answers, dict):
        fails.append("the answers file must be a JSON object")
        return

    northstar = answers.get("northstar")
    if not isinstance(northstar, dict):
        fails.append("missing 'northstar' object — the ritual collects it from the operator")
    else:
        if not nonempty_str(northstar.get("text")):
            fails.append("northstar.text is empty — the northstar is recorded in the operator's "
                         "own words and is never drafted for them")
        if not nonempty_str(northstar.get("ruling_id")):
            fails.append("northstar.ruling_id is missing — a board entry binds only when it cites "
                         "an operator ruling id (DESIGN §2)")
        if not board_lib.iso_ok(northstar.get("confirmed_at")):
            fails.append("northstar.confirmed_at is not ISO-8601: %r" % (northstar.get("confirmed_at"),))

    lanes = answers.get("lanes")
    if not isinstance(lanes, list) or not lanes:
        fails.append("'lanes' must be a non-empty list — initiation defines the project's lanes")
        lanes = []
    else:
        seen = set()
        for index, lane in enumerate(lanes):
            validate_lane(lane, index, seen, fails)

    cap = answers.get("lane_cap")
    if not positive_int(cap):
        fails.append("'lane_cap' must be a positive int — the operator's own answer to \"what is "
                     "the most lanes this project should ever carry at once?\" (R3: no default)")
    elif isinstance(lanes, list) and cap < len(lanes):
        fails.append("lane_cap is %d but initiation opens %d lanes — the cap cannot start already "
                     "breached" % (cap, len(lanes)))

    supplied = answers.get("policy", {})
    if not isinstance(supplied, dict):
        fails.append("'policy' must be an object")
    else:
        for key, value in supplied.items():
            if key not in board_lib.DEFAULT_POLICY:
                fails.append("policy: unknown key %r — expected one of %s"
                             % (key, ", ".join(sorted(board_lib.DEFAULT_POLICY))))
            elif not positive_int(value):
                fails.append("policy.%s must be a positive int, got %r" % (key, value))


def validate_lane(lane, index, seen, fails):
    if not isinstance(lane, dict):
        fails.append("lane #%d is not an object" % index)
        return
    lid = lane["id"] if nonempty_str(lane.get("id")) else "#%d" % index

    for key in LANE_FIELDS:
        if key not in lane:
            fails.append("lane %s: missing '%s'" % (lid, key))

    if nonempty_str(lane.get("id")):
        if lane["id"] in seen:
            fails.append("lane id %r is used more than once — lane ids must be unique" % (lane["id"],))
        seen.add(lane["id"])
    elif "id" in lane:
        fails.append("lane #%d: 'id' is empty" % index)

    for key in ("goal", "done_milestone", "owner", "next_decision"):
        if key in lane and not nonempty_str(lane.get(key)):
            fails.append("lane %s: '%s' is empty" % (lid, key))

    owner = lane.get("owner")
    if nonempty_str(owner) and owner.strip().lower() in UNOWNED:
        fails.append("lane %s: owner %r is not a named seat — DESIGN §4 requires a named owner, "
                     "never \"the fleet\"" % (lid, owner))

    if "cadence_hours" in lane and not positive_int(lane.get("cadence_hours")):
        fails.append("lane %s: cadence_hours must be a positive int, got %r"
                     % (lid, lane.get("cadence_hours")))

    milestone = lane.get("done_milestone")
    if nonempty_str(milestone) and not board_lib.milestone_is_capability_shaped(milestone):
        found = board_lib.milestone_markers(milestone)
        fails.append("lane %s: done_milestone is not capability-shaped — it names too little for a "
                     "reader to go and look at: %r. It carries %d of the %d observable markers "
                     "required (found: %s; the markers are: %s). Ask the operator again; never "
                     "rewrite their milestone for them."
                     % (lid, milestone, len(found), board_lib.MILESTONE_MIN_MARKERS,
                        ", ".join(found) or "none",
                        ", ".join(name for name, _ in board_lib.MILESTONE_MARKERS)))


# --- the board ------------------------------------------------------------

def build_board(answers, now, reinit_confirmed=None):
    northstar = answers["northstar"]
    policy = dict(board_lib.DEFAULT_POLICY)
    policy.update(answers.get("policy") or {})
    initiated_at = northstar.get("confirmed_at") or board_lib.to_iso(now)

    lanes = []
    for lane in answers["lanes"]:
        cadence = lane["cadence_hours"]
        lanes.append({
            "id": lane["id"],
            "goal": lane["goal"],
            "done_milestone": lane["done_milestone"],
            "owner": lane["owner"],
            "state": "active",
            "blockers": [],
            "next_decision": lane["next_decision"],
            "reported_at": board_lib.to_iso(now),
            "verified_at": None,
            "evidence": [],
            "next_report_due": board_lib.to_iso(now + timedelta(hours=cadence)),
            "cadence_hours": cadence,
        })

    board = {
        "schema_version": SCHEMA_VERSION,
        "note": BOARD_NOTE,
        "northstar": {
            # The operator's own sentence, verbatim. No seed marker: PROPOSED is
            # the pre-initiation state and this run is what clears it.
            "text": northstar["text"],
            "ruling_id": northstar["ruling_id"],
            "confirmed_at": initiated_at,
        },
        "lane_cap": answers["lane_cap"],
        "policy": policy,
        "lanes": lanes,
        "operator_queue": [],
        "effective_decisions_ref": "coordinator/decisions-effective.md",
        "initiation": {
            "initiated_at": board_lib.to_iso(now),
            "ruling_id": northstar["ruling_id"],
            "lane_cap": answers["lane_cap"],
            "interviewer": "coordinator-init",
        },
    }
    if reinit_confirmed is not None:
        board["reinit"] = {
            "confirmed_at": board_lib.to_iso(now),
            "operator_words": reinit_confirmed,
        }
    return board


def main(argv=None):
    parser = argparse.ArgumentParser(
        description="Write a v0.2 coordinator board from the initiation ritual's answers.")
    parser.add_argument("--answers", required=True, help="JSON answers file from the interview")
    parser.add_argument("--out", default=board_lib.default_board_path(),
                        help="board to write (default: coordinator/board.json)")
    parser.add_argument("--replace-proposed", action="store_true",
                        help="allow writing over an existing, not-yet-initiated board whose "
                             "PROPOSED seeds would be replaced (R2)")
    parser.add_argument("--reinit-confirmed", default=None, metavar="WORDS",
                        help="the operator's verbatim authorisation to re-initiate an "
                             "already-initiated board (R1)")
    parser.add_argument("--now", default=None, metavar="ISO",
                        help="initiation timestamp (default: now, UTC)")
    parser.add_argument("--dry-run", action="store_true",
                        help="print the board that would be written; write nothing")
    args = parser.parse_args(argv)

    now = board_lib.now_utc()
    if args.now is not None:
        now = board_lib.parse_iso(args.now)
        if now is None:
            return fail("--now is not ISO-8601: %r" % (args.now,))

    if args.reinit_confirmed is not None and not args.reinit_confirmed.strip():
        return fail("--reinit-confirmed is empty — re-initiation needs the operator's own words, "
                    "not an empty string")

    # The guard runs before the answers are even read: refusing is the default.
    if os.path.exists(args.out):
        try:
            existing = board_lib.load(args.out)
        except (OSError, ValueError) as exc:
            return fail("cannot read the existing board %s: %s" % (args.out, exc))
        if is_initiated(existing):
            if args.reinit_confirmed is None:
                print(refusal_text(args.out, existing), file=sys.stderr)
                if not args.dry_run:
                    return 1
                print("\n(--dry-run: the board it WOULD write follows. Nothing is written.)",
                      file=sys.stderr)
            print("RE-INIT authorised by the operator, recorded verbatim in the new board:")
            print('  "%s"' % args.reinit_confirmed)
        else:
            # Not initiated, but not empty either. A seeded board's PROPOSED lanes
            # are the operator's open questions; overwriting them unannounced loses
            # the very thing the initiation interview is meant to resolve.
            lanes, queue = seeded_content(existing)
            if (lanes or queue) and not args.replace_proposed:
                print(seed_refusal_text(args.out, existing), file=sys.stderr)
                if not args.dry_run:
                    return 1
                print("\n(--dry-run: the board it WOULD write follows. Nothing is written.)",
                      file=sys.stderr)

    try:
        with open(args.answers, encoding="utf-8") as handle:
            answers = json.load(handle)
    except OSError as exc:
        return fail("cannot read %s: %s" % (args.answers, exc))
    except ValueError as exc:
        return fail("%s is not valid JSON: %s" % (args.answers, exc))

    fails = []
    validate(answers, fails)
    if fails:
        for problem in fails:
            print("FAIL: %s" % problem, file=sys.stderr)
        return 1

    board = build_board(answers, now, args.reinit_confirmed)

    if args.dry_run:
        print(board_lib.dumps(board), end="")
        print("DRY RUN: nothing written to %s" % args.out, file=sys.stderr)
        return 0

    board_lib.save(args.out, board)
    print("OK: initiated %s — %d lanes, lane_cap %d, northstar ruling %s"
          % (args.out, len(board["lanes"]), board["lane_cap"], board["northstar"]["ruling_id"]))
    print("Next: python3 coordinator/check.py %s" % args.out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
