#!/usr/bin/env python3
"""Validate coordinator/board.json against the Coordinator v1 board spec.

Usage: python3 coordinator/check.py [path-to-board.json]

Default board is board.json beside this script. Every violation prints as one
`FAIL: <message>` line on stderr; the check never stops at the first one.
Exit 0 = valid, exit 1 = at least one violation.
"""

import json
import os
import sys
from datetime import datetime

# DESIGN §3: the boot bundle stays inside ~2k tokens ≈ 8KB.
BUNDLE_GATE_BYTES = 8192
BUNDLE_FILES = ("board.json", "northstar.md", "decisions-effective.md")

# DESIGN §4 state enum — case-sensitive on purpose.
STATES = ("active", "blocked", "done-claimed", "done-verified", "DISPUTED", "UNKNOWN", "closed")

LANE_KEYS = ("id", "goal", "done_milestone", "owner", "state", "blockers", "next_decision",
             "reported_at", "verified_at", "evidence", "next_report_due")

TIME_KEYS = ("reported_at", "verified_at", "next_report_due")

HARD_LANE_CAP = 6  # DESIGN §4: a 7th lane forces a park or merge, never a denser board.


def is_int(value):
    return isinstance(value, int) and not isinstance(value, bool)


def iso_ok(value):
    """True if value is null (allowed) or parses as ISO-8601 with an optional trailing Z."""
    if value is None:
        return True
    if not isinstance(value, str):
        return False
    try:
        datetime.fromisoformat(value[:-1] + "+00:00" if value.endswith("Z") else value)
    except ValueError:
        return False
    return True


def check_top(board, fails):
    for key, typ, label in (("schema_version", int, "int"), ("northstar", dict, "object"),
                            ("lane_cap", int, "int"), ("lanes", list, "list")):
        if key not in board:
            fails.append("missing top-level key '%s'" % key)
        elif not isinstance(board[key], typ) or isinstance(board[key], bool):
            article = "an" if label[0] in "aeiou" else "a"
            fails.append("top-level '%s' must be %s %s" % (key, article, label))

    northstar = board.get("northstar")
    if isinstance(northstar, dict):
        for key in ("text", "ruling_id", "confirmed_at"):
            if key not in northstar:
                fails.append("northstar: missing key '%s'" % key)
        if not iso_ok(northstar.get("confirmed_at")):
            fails.append("northstar.confirmed_at is not ISO-8601: %r" % (northstar.get("confirmed_at"),))

    cap, lanes = board.get("lane_cap"), board.get("lanes")
    if is_int(cap) and cap > HARD_LANE_CAP:
        fails.append("lane_cap is %d — the design's hard cap is %d lanes (DESIGN §4)" % (cap, HARD_LANE_CAP))
    if isinstance(lanes, list):
        limit = min(cap, HARD_LANE_CAP) if is_int(cap) else HARD_LANE_CAP
        if len(lanes) > limit:
            fails.append("%d lanes exceed the lane cap of %d — a 7th lane forces a park or merge, "
                         "never a denser board (DESIGN §4)" % (len(lanes), limit))


def check_lane(lane, index, seen_ids, fails):
    if not isinstance(lane, dict):
        fails.append("lane #%d is not an object" % index)
        return
    lid = lane.get("id") if isinstance(lane.get("id"), str) else "#%d" % index

    for key in LANE_KEYS:
        if key not in lane:
            fails.append("lane %s: missing key '%s'" % (lid, key))

    if "id" in lane:
        if lane["id"] in seen_ids:
            fails.append("lane id %r is used more than once — lane ids must be unique" % (lane["id"],))
        seen_ids.add(lane["id"])

    state = lane.get("state")
    if state not in STATES:
        fails.append("lane %s: state %r is not one of %s" % (lid, state, " | ".join(STATES)))

    for key in ("blockers", "evidence"):
        if key in lane and not isinstance(lane[key], list):
            fails.append("lane %s: '%s' must be a list" % (lid, key))

    for key in TIME_KEYS:
        if key in lane and not iso_ok(lane[key]):
            fails.append("lane %s: %s is not ISO-8601: %r" % (lid, key, lane[key]))

    # A live lane always owes a next report; only a closed lane may drop the cadence.
    due = lane.get("next_report_due")
    if state != "closed" and not (isinstance(due, str) and due.strip()):
        fails.append("lane %s: next_report_due is required while state is %r" % (lid, state))

    # DESIGN §4a/§4b: no green without an external pointer.
    evidence = lane.get("evidence")
    has_evidence = isinstance(evidence, list) and len(evidence) > 0
    if state == "done-verified":
        if lane.get("verified_at") is None:
            fails.append("lane %s: done-verified needs a non-null verified_at (DESIGN §4a)" % lid)
        if not has_evidence:
            fails.append("lane %s: done-verified needs a non-empty evidence list (DESIGN §4a)" % lid)
    elif state == "done-claimed" and not has_evidence:
        fails.append("lane %s: done-claimed needs a non-empty evidence list (DESIGN §4a)" % lid)


def check_bundle(dirpath, fails, warns):
    """Return the boot-bundle byte total, or None when the sibling files are absent."""
    total = 0
    for name in BUNDLE_FILES:
        path = os.path.join(dirpath, name)
        if not os.path.isfile(path):
            warns.append("bundle files not found beside board.json")
            return None
        total += os.path.getsize(path)

    pct = percent(total)
    if total > BUNDLE_GATE_BYTES:
        fails.append("boot bundle is %d bytes, over the %d-byte gate (%d%%) — compact the bundle or "
                     "open a compaction exception with the operator" % (total, BUNDLE_GATE_BYTES, pct))
    elif pct >= 90:
        warns.append("boot bundle at %d bytes (%d%% of the %d-byte gate)"
                     % (total, pct, BUNDLE_GATE_BYTES))
    return total


def percent(total):
    return int(round(total * 100.0 / BUNDLE_GATE_BYTES))


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    path = argv[0] if argv else os.path.join(os.path.dirname(os.path.abspath(__file__)), "board.json")

    try:
        with open(path, encoding="utf-8") as handle:
            board = json.load(handle)
    except OSError as exc:
        print("FAIL: cannot read %s: %s" % (path, exc), file=sys.stderr)
        return 1
    except ValueError as exc:
        print("FAIL: %s is not valid JSON: %s" % (path, exc), file=sys.stderr)
        return 1

    if not isinstance(board, dict):
        print("FAIL: the top level of %s must be a JSON object" % path, file=sys.stderr)
        return 1

    fails, warns = [], []
    check_top(board, fails)
    lanes = board.get("lanes")
    if isinstance(lanes, list):
        seen_ids = set()
        for index, lane in enumerate(lanes):
            check_lane(lane, index, seen_ids, fails)
    total = check_bundle(os.path.dirname(os.path.abspath(path)), fails, warns)

    for warning in warns:
        print("WARN: %s" % warning, file=sys.stderr)
    if fails:
        for failure in fails:
            print("FAIL: %s" % failure, file=sys.stderr)
        return 1

    count = len(lanes) if isinstance(lanes, list) else 0
    size = "bundle size unchecked" if total is None else "bundle %d bytes (%d%% of gate)" % (total, percent(total))
    print("OK: board.json valid — %d lanes, %s" % (count, size))
    return 0


if __name__ == "__main__":
    sys.exit(main())
