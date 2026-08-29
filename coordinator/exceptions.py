#!/usr/bin/env python3
"""Compute the board's exceptions — the arithmetic that makes silence visible.

Usage: python3 coordinator/exceptions.py [board.json] [--apply] [--now ISO]

Pure arithmetic over the existing schema, no new persistent state (v0.2 M1).
Four kinds: an overdue lane, a done-claim nobody attested, an operator-queue item
nobody ruled on, a DISPUTED lane. Printing the list exits 0 either way — an
exception is something to look at, not a program error.

`--apply` additionally fills missing deadlines, runs the dead-man switch and
writes the list into the board's top-level `exceptions` key.
"""

import argparse
import json
import sys

import board_lib as bl

# Sort order of the kinds, and the spec order in docs/coordinator/SCHEMA-v2.md.
KINDS = ("overdue-lane", "unattested-done", "stale-queue-item", "disputed-lane")

SECONDS_PER_DAY = 86400


def owner_brief(owner):
    """The owner's name without its parenthetical annotation.

    Every exception detail line lands in the boot bundle, where the annotation
    ("last known: the O30/O31 seat") costs bytes the name already carries.
    """
    if not isinstance(owner, str) or not owner.strip():
        return "UNASSIGNED"
    text = owner.strip()
    head = text.split(" (")[0].strip()
    return "%s …" % head if head != text else head


def record(kind, subject, since, seconds, detail):
    """One exception. `id` carries no age and no timestamp — M4 diffs ids across runs
    to spot transitions, so an id that moved with the clock would report every lane
    as new on every run."""
    return {"id": "EX-%s-%s" % (kind, subject), "kind": kind, "subject": subject,
            "since": since, "age_seconds": seconds, "age": bl.humanize_age(seconds),
            "detail": detail}


def objects(value):
    return [item for item in value if isinstance(item, dict)] if isinstance(value, list) else []


def lane_id(lane, index):
    lid = lane.get("id")
    return lid if isinstance(lid, str) and lid.strip() else "#%d" % index


def compute(board, now):
    """Every exception on the board, sorted by kind then oldest first.

    A subject whose `since` is absent or unparseable yields nothing: you cannot age
    what has no clock. ensure_deadlines() is what stops that from hiding a lane.
    """
    limits = bl.policy(board)
    found = []

    for index, lane in enumerate(objects(board.get("lanes"))):
        lid = lane_id(lane, index)
        state = lane.get("state")
        owner = owner_brief(lane.get("owner"))

        due = lane.get("next_report_due")
        overdue = bl.age_seconds(due, now)
        if state not in bl.DEADMAN_EXEMPT and overdue is not None and overdue > 0:
            found.append(record(
                "overdue-lane", lid, due, overdue,
                "lane %s (owner %s) is %s past its next_report_due"
                % (lid, owner, bl.humanize_age(overdue))))

        reported = lane.get("reported_at")
        claimed_for = bl.age_seconds(reported, now)
        if (state == "done-claimed" and lane.get("verified_at") is None
                and claimed_for is not None
                and claimed_for > limits["unattested_done_days"] * SECONDS_PER_DAY):
            found.append(record(
                "unattested-done", lid, reported, claimed_for,
                "lane %s has stood done-claimed for %s with no attestation — it stays out of "
                "done-verified until someone checks the evidence (DESIGN §4b)"
                % (lid, bl.humanize_age(claimed_for))))

        if state == "DISPUTED" and claimed_for is not None:
            found.append(record(
                "disputed-lane", lid, reported, claimed_for,
                "lane %s has been DISPUTED for %s — both attestations stand and only the "
                "operator can rule (owner %s)" % (lid, bl.humanize_age(claimed_for), owner)))

    for index, item in enumerate(objects(board.get("operator_queue"))):
        iid = item.get("id")
        iid = iid if isinstance(iid, str) and iid.strip() else "#%d" % index
        opened = item.get("opened_at")
        open_for = bl.age_seconds(opened, now)
        if open_for is not None and open_for > limits["queue_item_days"] * SECONDS_PER_DAY:
            found.append(record(
                "stale-queue-item", iid, opened, open_for,
                "operator-queue item %s has been open %s with no ruling — on expiry the default "
                "stands: %s" % (iid, bl.humanize_age(open_for), item.get("default"))))

    found.sort(key=lambda entry: (KINDS.index(entry["kind"]), -entry["age_seconds"]))
    return found


def apply_deadman(board, now):
    """Flip every lapsed lane to UNKNOWN and return the ids that moved.

    DESIGN §4: UNKNOWN is automatic on a next_report lapse. Silence has to change
    the board by itself, or silence reads as health.
    """
    flipped = []
    for index, lane in enumerate(objects(board.get("lanes"))):
        state = lane.get("state")
        if state in bl.DEADMAN_EXEMPT or state == "UNKNOWN":
            continue
        overdue = bl.age_seconds(lane.get("next_report_due"), now)
        if overdue is not None and overdue > 0:
            lane["state"] = "UNKNOWN"
            flipped.append(lane_id(lane, index))
    return flipped


def ensure_deadlines(board, now):
    """Give every open item a clock, and report how many fields were filled.

    A null deadline is how an item disappears: with no `since` there is no age, with
    no age there is no exception, and the board reads healthy because it is silent.
    """
    filled = 0

    for item in objects(board.get("operator_queue")):
        if not bl.parse_iso(item.get("opened_at")):
            # An item with no opening time is at least open now; inventing an older
            # one would fabricate an age the board cannot support.
            item["opened_at"] = bl.to_iso(now)
            filled += 1
        if not bl.parse_iso(item.get("deadline")):
            item["deadline"] = bl.default_due(bl.parse_iso(item["opened_at"]), board)
            filled += 1

    for lane in objects(board.get("lanes")):
        if lane.get("state") == "closed":
            continue  # a closed lane owes nothing
        if not bl.parse_iso(lane.get("next_report_due")):
            from_moment = bl.parse_iso(lane.get("reported_at")) or now
            lane["next_report_due"] = bl.default_due(from_moment, board)
            filled += 1

    return filled


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("board", nargs="?", default=bl.default_board_path())
    parser.add_argument("--apply", action="store_true",
                        help="fill deadlines, run the dead-man switch, save the board")
    parser.add_argument("--now", help="freeze the clock at this ISO time")
    args = parser.parse_args(sys.argv[1:] if argv is None else argv)

    try:
        board = bl.load(args.board)
    except (OSError, ValueError) as exc:
        print("FAIL: cannot read %s: %s" % (args.board, exc), file=sys.stderr)
        return 1

    now = bl.parse_iso(args.now) if args.now else bl.now_utc()
    if now is None:
        print("FAIL: --now is not ISO-8601: %r" % (args.now,), file=sys.stderr)
        return 1

    if not args.apply:
        print(json.dumps(compute(board, now), indent=2, ensure_ascii=False))
        return 0

    filled = ensure_deadlines(board, now)
    flipped = apply_deadman(board, now)
    found = compute(board, now)
    board["exceptions"] = found
    try:
        bl.save(args.board, board)
    except OSError as exc:
        print("FAIL: cannot write %s: %s" % (args.board, exc), file=sys.stderr)
        return 1

    print(json.dumps(found, indent=2, ensure_ascii=False))
    print("applied: %d exceptions · %d deadlines filled · dead-man flipped %s"
          % (len(found), filled, ", ".join(flipped) if flipped else "nothing"), file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
