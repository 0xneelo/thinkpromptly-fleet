#!/usr/bin/env python3
"""Validate coordinator/board.json against the Coordinator board spec (v0.2).

Usage: python3 coordinator/check.py [path-to-board.json] [--now ISO] [--selftest]

Default board is board.json beside this script. Every violation prints as one
`FAIL: <message>` line on stderr; the check never stops at the first one.
Exit 0 = valid, exit 1 = at least one violation.
"""

import contextlib
import io
import json
import os
import shutil
import sys
import tempfile

import board_lib as bl
import bundle
import exceptions
import runlog

LANE_KEYS = ("id", "goal", "done_milestone", "owner", "state", "blockers", "next_decision",
             "reported_at", "verified_at", "evidence", "next_report_due")

TIME_KEYS = ("reported_at", "verified_at", "next_report_due")

QUEUE_KEYS = ("id", "item", "default", "opened_at", "deadline")

MARKER_KINDS = ", ".join(name for name, _ in bl.MILESTONE_MARKERS)


def is_int(value):
    return isinstance(value, int) and not isinstance(value, bool)


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
        if not bl.iso_ok(northstar.get("confirmed_at")):
            fails.append("northstar.confirmed_at is not ISO-8601: %r" % (northstar.get("confirmed_at"),))

    # Operator ruling R3, 2026-08-29 (verbatim): "there is no point in having a limit or amount
    # of lanes, the amount of lanes is dependent on the project and will be defined during
    # initiation". This OVERRIDES DESIGN §4's "hard cap 6": there is no constant here any more,
    # only the board's own cap, written by the initiation ritual.
    cap, lanes = board.get("lane_cap"), board.get("lanes")
    if is_int(cap) and cap < 1:
        fails.append("lane_cap is %d — a board must have room for at least one lane" % cap)
    if isinstance(lanes, list) and is_int(cap) and cap >= 1 and len(lanes) > cap:
        fails.append("%d lanes exceed this board's lane_cap of %d — raise the cap at initiation "
                     "or park a lane, never densify the board (operator ruling R3)"
                     % (len(lanes), cap))


def check_policy(board, fails):
    policy = board.get("policy")
    if policy is None:
        return  # absent is fine: board_lib.policy() fills every key from DEFAULT_POLICY
    if not isinstance(policy, dict):
        fails.append("top-level 'policy' must be an object")
        return
    for key in sorted(policy):
        value = policy[key]
        if key not in bl.DEFAULT_POLICY:
            fails.append("policy: unknown key %r — the policy keys are %s"
                         % (key, ", ".join(sorted(bl.DEFAULT_POLICY))))
        elif not is_int(value) or value < 1:
            fails.append("policy.%s must be a positive int, got %r" % (key, value))


def check_queue(board, fails):
    queue = board.get("operator_queue")
    if queue is None:
        return
    if not isinstance(queue, list):
        fails.append("top-level 'operator_queue' must be a list")
        return

    seen_ids = set()
    for index, item in enumerate(queue):
        if not isinstance(item, dict):
            fails.append("operator_queue #%d is not an object" % index)
            continue
        iid = item.get("id") if isinstance(item.get("id"), str) else "#%d" % index

        for key in QUEUE_KEYS:
            if key not in item:
                fails.append("operator_queue %s: missing key '%s'" % (iid, key))

        if isinstance(item.get("id"), str):
            if item["id"] in seen_ids:
                fails.append("operator_queue id %r is used more than once — ids must be unique"
                             % (item["id"],))
            seen_ids.add(item["id"])

        # DESIGN §4.3: every queue item carries a deadline and a default. A null clock is how
        # an item goes quiet — with no `opened_at` it can never age into an exception (M1).
        for key in ("opened_at", "deadline"):
            if key in item and not (isinstance(item[key], str) and bl.iso_ok(item[key])):
                fails.append("operator_queue %s: %s must be a non-null ISO-8601 time, got %r"
                             % (iid, key, item.get(key)))


def check_lane(lane, index, seen_ids, fails):
    if not isinstance(lane, dict):
        fails.append("lane #%d is not an object" % index)
        return
    lid = lane.get("id") if isinstance(lane.get("id"), str) else "#%d" % index

    for key in LANE_KEYS:
        if key not in lane:
            fails.append("lane %s: missing key '%s'" % (lid, key))

    if "id" in lane and not isinstance(lane["id"], str):
        fails.append("lane %s: 'id' must be a string, got %r — reconcile and exceptions "
                     "address lanes by id" % (lid, lane["id"]))
    if "id" in lane:
        if lane["id"] in seen_ids:
            fails.append("lane id %r is used more than once — lane ids must be unique" % (lane["id"],))
        seen_ids.add(lane["id"])

    state = lane.get("state")
    if state not in bl.STATES:
        fails.append("lane %s: state %r is not one of %s" % (lid, state, " | ".join(bl.STATES)))

    for key in ("blockers", "evidence"):
        if key in lane and not isinstance(lane[key], list):
            fails.append("lane %s: '%s' must be a list" % (lid, key))

    for key in TIME_KEYS:
        if key in lane and not bl.iso_ok(lane[key]):
            fails.append("lane %s: %s is not ISO-8601: %r" % (lid, key, lane[key]))

    # A live lane always owes a next report; only a closed lane may drop the cadence.
    due = lane.get("next_report_due")
    if state != "closed" and not (isinstance(due, str) and due.strip()):
        fails.append("lane %s: next_report_due is required while state is %r" % (lid, state))

    # M1: done-claimed vs done-verified only has teeth if the milestone is checkable, so the
    # milestone must name something a reader can go and look at.
    if "done_milestone" in lane and not bl.milestone_is_capability_shaped(lane["done_milestone"]):
        fails.append("lane %s: done_milestone %r names nothing observable — it cannot be "
                     "verified, only believed. Name at least one of: %s (DESIGN §4b)"
                     % (lid, lane["done_milestone"], MARKER_KINDS))

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


def check_bundle(board, path, now, fails, warns):
    """Gate the COMPACTED bundle — that is the payload a booting seat actually reads.

    The raw file sum is reported alongside so the compaction win stays visible, but it
    is not what the gate measures any more (v0.2 M5).
    """
    size, headroom, pct = bundle.gate_report(board, now, path)
    if headroom < 0:
        fails.append("compacted boot bundle is %d bytes, over the %d-byte gate (%d%%) — compact "
                     "the bundle or open a compaction exception with the operator"
                     % (size, bundle.BUNDLE_GATE_BYTES, pct))
    elif pct >= 90:
        warns.append("compacted boot bundle at %d bytes (%d%% of the %d-byte gate)"
                     % (size, pct, bundle.BUNDLE_GATE_BYTES))

    raw = bundle.raw_total(bl.board_dir(path))
    if raw is None:
        warns.append("raw bundle files not found beside board.json")
    return size, headroom, pct, raw


def main(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    if "--selftest" in argv:
        return selftest()

    now = bl.now_utc()
    if "--now" in argv:
        at = argv.index("--now")
        value = argv[at + 1] if at + 1 < len(argv) else ""
        now = bl.parse_iso(value)
        if now is None:
            print("FAIL: --now is not ISO-8601: %r" % (value,), file=sys.stderr)
            return 1
        del argv[at:at + 2]

    path = argv[0] if argv else bl.default_board_path()

    try:
        board = bl.load(path)
    except OSError as exc:
        print("FAIL: cannot read %s: %s" % (path, exc), file=sys.stderr)
        return 1
    except ValueError as exc:
        print("FAIL: %s is not valid JSON: %s" % (path, exc), file=sys.stderr)
        return 1

    fails, warns = [], []
    check_top(board, fails)
    check_policy(board, fails)
    check_queue(board, fails)
    lanes = board.get("lanes")
    if isinstance(lanes, list):
        seen_ids = set()
        for index, lane in enumerate(lanes):
            check_lane(lane, index, seen_ids, fails)
    size, headroom, pct, raw = check_bundle(board, path, now, fails, warns)

    for warning in warns:
        print("WARN: %s" % warning, file=sys.stderr)
    if fails:
        for failure in fails:
            print("FAIL: %s" % failure, file=sys.stderr)
        return 1

    count = len(lanes) if isinstance(lanes, list) else 0
    print("OK: board.json valid — %d lanes, bundle %d bytes compacted (%d%% of gate, %d bytes "
          "headroom), raw files %s"
          % (count, size, pct, headroom, "%d bytes" % raw if raw is not None else "unchecked"))
    return 0


# --- self-test ------------------------------------------------------------
# Same shape as coordinator/hooks/boot-gate.py: fixtures in a temp dir, assert, one
# PASS/FAIL line. The clock is frozen everywhere — an age-dependent test that passes
# in the morning and fails at night is worse than no test.

FROZEN = "2026-08-29T12:00:00Z"
RUN = "2026-08-29T12:00:00Z"


class SelftestFailure(Exception):
    pass


def check(condition, detail):
    if not condition:
        raise SelftestFailure(detail)


def fixture_lane(lid, **over):
    lane = {"id": lid, "goal": "ship the %s pipeline to production" % lid,
            "done_milestone": "%s serving on prod at https://example.invalid/%s" % (lid, lid),
            "owner": "Someone (role, agent-someone)", "state": "active", "blockers": [],
            "next_decision": "operator: none", "reported_at": "2026-08-29T09:00:00Z",
            "verified_at": None, "evidence": ["https://example.invalid/%s" % lid],
            "next_report_due": "2026-08-30T09:00:00Z"}
    lane.update(over)
    return lane


def fixture_item(iid, opened="2026-08-29T09:00:00Z"):
    return {"id": iid, "item": "decide %s" % iid, "default": "none",
            "opened_at": opened, "deadline": "2026-08-30T09:00:00Z"}


def fixture_board(lanes, queue=None, **over):
    board = {"schema_version": 1,
             "northstar": {"text": "one sentence", "ruling_id": "R-1",
                           "confirmed_at": "2026-08-28T09:00:00Z"},
             "lane_cap": 9, "policy": dict(bl.DEFAULT_POLICY), "lanes": lanes,
             "operator_queue": queue if queue is not None else [fixture_item("OQ-1")],
             "effective_decisions_ref": "coordinator/decisions-effective.md"}
    board.update(over)
    return board


def lane_fails(lane):
    fails = []
    check_lane(lane, 0, set(), fails)
    return fails


def selftest_exceptions(now, checked):
    """(a) exactly the stale lane and the aged queue item, with ages; fresh board empty."""
    stale = fixture_board(
        [fixture_lane("L1", next_report_due="2026-08-28T09:00:00Z"), fixture_lane("L2")],
        [fixture_item("OQ-1", "2026-08-20T09:00:00Z"), fixture_item("OQ-2")])
    found = exceptions.compute(stale, now)
    ids = [entry["id"] for entry in found]
    check(ids == ["EX-overdue-lane-L1", "EX-stale-queue-item-OQ-1"],
          "seeded board named %r, expected exactly the stale lane and the aged queue item" % (ids,))
    check(found[0]["age"] == "1d 3h" and found[0]["age_seconds"] == 97200,
          "stale lane age is %r/%r" % (found[0]["age"], found[0]["age_seconds"]))
    check(found[1]["age"] == "9d 3h", "aged queue item age is %r" % found[1]["age"])
    check(found[0]["since"] == "2026-08-28T09:00:00Z", "overdue `since` must be next_report_due")
    checked += ["exceptions: exactly the two subjects", "exceptions: lane age",
                "exceptions: queue age", "exceptions: since"]

    fresh = fixture_board([fixture_lane("L1"), fixture_lane("L2")])
    check(exceptions.compute(fresh, now) == [], "a fresh board must produce no exceptions")
    checked.append("exceptions: fresh board is empty")

    # Kind order and oldest-first inside a kind.
    mixed = fixture_board([
        fixture_lane("L1", next_report_due="2026-08-28T09:00:00Z"),
        fixture_lane("L2", next_report_due="2026-08-27T09:00:00Z"),
        fixture_lane("L3", state="DISPUTED", reported_at="2026-08-25T09:00:00Z"),
    ], [fixture_item("OQ-1", "2026-08-20T09:00:00Z")])
    kinds = [entry["kind"] for entry in exceptions.compute(mixed, now)]
    check(kinds == ["overdue-lane", "overdue-lane", "stale-queue-item", "disputed-lane"],
          "wrong kind order: %r" % (kinds,))
    check([entry["id"] for entry in exceptions.compute(mixed, now)][:2]
          == ["EX-overdue-lane-L2", "EX-overdue-lane-L1"], "oldest must sort first inside a kind")
    checked += ["exceptions: kind order", "exceptions: oldest first"]

    # An unparseable `since` yields nothing: you cannot age what has no clock.
    blind = fixture_board([fixture_lane("L1", state="DISPUTED", reported_at=None)], [])
    check(exceptions.compute(blind, now) == [], "an unparseable `since` must yield no exception")
    checked.append("exceptions: no clock, no exception")

    # ensure_deadlines fills what would otherwise stay invisible.
    unset = fixture_board([fixture_lane("L1", next_report_due=None)],
                          [{"id": "OQ-9", "item": "x", "default": "none"}])
    filled = exceptions.ensure_deadlines(unset, now)
    check(filled == 3, "ensure_deadlines filled %d fields, expected 3" % filled)
    check(unset["lanes"][0]["next_report_due"] == "2026-08-30T09:00:00Z",
          "lane deadline came out as %r" % unset["lanes"][0]["next_report_due"])
    check(unset["operator_queue"][0]["deadline"] == "2026-08-30T12:00:00Z",
          "queue deadline came out as %r" % unset["operator_queue"][0]["deadline"])
    checked += ["ensure_deadlines: count", "ensure_deadlines: lane due",
                "ensure_deadlines: queue deadline"]


def selftest_milestone(checked):
    """(b) unverifiable prose is rejected with the reason; the live milestones all pass."""
    prose = lane_fails(fixture_lane("L1", done_milestone="make the pipeline solid"))
    hits = [failure for failure in prose if "done_milestone" in failure]
    check(len(hits) == 1, "unverifiable prose produced %d milestone failures" % len(hits))
    check("names nothing observable" in hits[0], "the reason is missing: %r" % hits[0])
    for kind, _ in bl.MILESTONE_MARKERS:
        check(kind in hits[0], "the message must list the accepted marker kind %r" % kind)
    checked += ["milestone: prose rejected", "milestone: reason given", "milestone: markers listed"]

    live = bl.load(bl.default_board_path())
    for lane in live["lanes"]:
        check(bl.milestone_is_capability_shaped(lane["done_milestone"]),
              "live lane %s milestone was rejected: %r" % (lane["id"], lane["done_milestone"]))
        checked.append("milestone: live lane %s passes" % lane["id"])


def selftest_lane_cap(checked):
    """(c) the cap is the board's own — the hard cap 6 is gone (operator ruling R3)."""
    nine = fixture_board([fixture_lane("L%d" % n) for n in range(1, 10)], lane_cap=9)
    fails = []
    check_top(nine, fails)
    check(fails == [], "9 lanes under a lane_cap of 9 must pass, got %r" % (fails,))

    ten = fixture_board([fixture_lane("L%d" % n) for n in range(1, 11)], lane_cap=9)
    fails = []
    check_top(ten, fails)
    check(len(fails) == 1 and "lane_cap of 9" in fails[0],
          "10 lanes against a lane_cap of 9 must fail naming the board's cap, got %r" % (fails,))

    fails = []
    check_top(fixture_board([fixture_lane("L1")], lane_cap=0), fails)
    check(any("at least one lane" in failure for failure in fails), "lane_cap 0 must fail")
    checked += ["lane_cap: 9 lanes pass under cap 9", "lane_cap: 10 lanes fail against cap 9",
                "lane_cap: zero cap rejected"]


def selftest_policy_and_queue(checked):
    fails = []
    check_policy(fixture_board([], policy={"queue_item_days": 0}), fails)
    check(len(fails) == 1 and "positive int" in fails[0], "policy 0 must fail: %r" % (fails,))
    fails = []
    check_policy(fixture_board([], policy={"cadence": 4}), fails)
    check(len(fails) == 1 and "unknown key" in fails[0], "an unknown policy key must fail")

    fails = []
    check_queue(fixture_board([], [{"id": "OQ-1", "item": "x", "default": "none",
                                    "opened_at": None, "deadline": None}]), fails)
    check(len(fails) == 2, "a null-clock queue item must fail on both time keys: %r" % (fails,))
    fails = []
    check_queue(fixture_board([], [fixture_item("OQ-1"), fixture_item("OQ-1")]), fails)
    check(any("more than once" in failure for failure in fails), "duplicate queue ids must fail")
    checked += ["policy: non-positive rejected", "policy: unknown key rejected",
                "queue: null clock rejected", "queue: duplicate ids rejected"]


def selftest_bundle(now, checked):
    """(d) M5 acceptance: six confirmed lanes plus exceptions stay under the gate."""
    live = bl.load(bl.default_board_path())
    lanes = list(live["lanes"])
    # Two more lanes of realistic weight — the 5th and 6th OQ-2 is about.
    lanes.append(dict(lanes[0], id="L5", goal="lowcap: pools capability — found, added, picked, "
                      "corrected, running in production.",
                      done_milestone="pool selection live on prod for 3 consecutive trains; "
                                     "zero manual corrections in the last 24h.",
                      owner="UNASSIGNED (candidate 5th lane)", state="active"))
    lanes.append(dict(lanes[1], id="L6", goal="fleet: arm the boot-read gate for orchestrator "
                      "seats once the initiation ritual ships.",
                      done_milestone="hook installed in settings.json; one denied call observed "
                                     "in coordinator/hooks/README.md.",
                      owner="UNASSIGNED (candidate 6th lane)", state="blocked"))
    six = dict(live, lane_cap=6, lanes=lanes)
    six["exceptions"] = exceptions.compute(six, now)
    check(len(six["exceptions"]) >= 4,
          "the six-lane fixture must carry a populated exceptions list, got %d"
          % len(six["exceptions"]))

    size, headroom, pct = bundle.gate_report(six, now, bl.default_board_path())
    check(headroom > 0, "six-lane compacted bundle is %d bytes, %d OVER the %d-byte gate"
          % (size, -headroom, bundle.BUNDLE_GATE_BYTES))
    print("  M5: six lanes + %d exceptions -> %d bytes compacted, %d bytes headroom (%d%% of gate)"
          % (len(six["exceptions"]), size, headroom, pct))
    checked += ["bundle: six-lane fixture has exceptions",
                "bundle: six-lane fixture is under the gate (%d bytes headroom)" % headroom]

    text = bundle.build(six, now, bl.default_board_path())
    for entry in six["exceptions"]:
        check(entry["id"] in text and entry["detail"] in text,
              "exception %s was summarised out of the bundle" % entry["id"])
    checked.append("bundle: every exception renders in full")
    order = [text.index(header) for header in ("NORTHSTAR", "EXCEPTIONS", "LANES",
                                               "OPERATOR QUEUE", "EFFECTIVE DECISIONS")]
    check(order == sorted(order), "bundle sections must never reorder (DESIGN §4)")
    check("| D-" not in text and "decisions-effective.md" in text,
          "effective decisions must be a reference, not the table")
    check(str(size) in text.splitlines()[-1], "the footer must state the bundle's own size")
    checked += ["bundle: fixed section order", "bundle: decisions referenced not inlined",
                "bundle: footer states its own size"]

    # A lane with no exception and no live state gets one summary line; a live one does not.
    quiet = fixture_board([fixture_lane("L1", state="done-verified",
                                        verified_at="2026-08-29T09:00:00Z"),
                           fixture_lane("L2", state="active")])
    lines = bundle.build(quiet, now, bl.default_board_path())
    check("  L1 done-verified · Someone … · reported 3h ago" in lines,
          "a quiet lane must render as one summary line")
    check("    goal: ship the L2 pipeline to production" in lines,
          "a live lane must render in full")
    checked += ["bundle: quiet lane summarised", "bundle: live lane in full"]

    # The gate still trips on a genuinely oversized board.
    huge = fixture_board([fixture_lane("L1", goal="x " * 6000)])
    size, headroom, _ = bundle.gate_report(huge, now, bl.default_board_path())
    check(headroom < 0, "an oversized board must trip the gate, got %d bytes" % size)
    fails, warns = [], []
    check_bundle(huge, bl.default_board_path(), now, fails, warns)
    check(any("over the %d-byte gate" % bundle.BUNDLE_GATE_BYTES in failure for failure in fails),
          "check_bundle must FAIL on an oversized bundle: %r" % (fails,))
    checked += ["bundle: oversized board trips the gate", "bundle: check_bundle reports it"]


def call_runlog(argv):
    """Drive runlog's real entry point. Returns (exit_code, stdout)."""
    out, err = io.StringIO(), io.StringIO()
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
        code = runlog.main(argv)
    return code, out.getvalue()


def selftest_snapshot_cannot_mask(now, checked):
    """The stored `exceptions` snapshot must never stand in for live state (F1).

    exceptions.py --apply writes board["exceptions"]. If the bundle read that back,
    every boot after the last run would show the board as it was, and a lane that
    went overdue since would be invisible to the seat booting to own it — silence
    reading as health, which is the one thing M1 exists to prevent.
    """
    live = bl.load(bl.default_board_path())

    # A board with real, live exceptions, carrying a snapshot that claims all-clear.
    masked = dict(live, exceptions=[])
    real = exceptions.compute(masked, now)
    check(len(real) > 0, "fixture must have live exceptions to be masked, got 0")

    text = bundle.build(masked, now, bl.default_board_path())
    for entry in real:
        check(entry["id"] in text,
              "empty stored snapshot masked live exception %s out of the bundle" % entry["id"])
    checked.append("bundle: an empty stored snapshot cannot mask %d live exception(s)" % len(real))

    # A snapshot naming exceptions that no longer hold must not resurrect them either.
    ghost = {"id": "EX-overdue-lane-GHOST", "kind": "overdue-lane", "subject": "GHOST",
             "since": "2020-01-01T00:00:00Z", "age_seconds": 1, "age": "1m",
             "detail": "a stale snapshot entry that no longer holds"}
    stale = dict(live, exceptions=[ghost])
    text = bundle.build(stale, now, bl.default_board_path())
    check("EX-overdue-lane-GHOST" not in text,
          "a stale snapshot entry was resurrected into the bundle")
    checked.append("bundle: a stale snapshot entry is not resurrected")

    # The gate must measure live state too, or the snapshot freezes the byte budget.
    masked_size = bundle.gate_report(masked, now, bl.default_board_path())[0]
    unstamped = dict(live)
    unstamped.pop("exceptions", None)
    live_size = bundle.gate_report(unstamped, now, bl.default_board_path())[0]
    check(masked_size == live_size,
          "the gate measured the snapshot (%d bytes) instead of live state (%d bytes)"
          % (masked_size, live_size))
    checked.append("bundle: the byte gate measures live state, not the snapshot")

    # And the drift warning must actually notice.
    appeared, cleared = bundle.snapshot_drift(masked, now)
    check(len(appeared) == len(real) and not cleared,
          "snapshot_drift missed %d live exception(s) absent from the snapshot" % len(real))
    checked.append("bundle: snapshot drift is detected and reported")


def selftest_runlog(root, checked):
    """(e) the ported lowcap incident, reproduced: no artefact, no counter."""
    inbox = os.path.join(root, "inbox")
    os.makedirs(inbox)
    name = "2026-08-29T10:00:00Z-o31-L2.md"
    sitrep = os.path.join(inbox, name)
    with open(sitrep, "w", encoding="utf-8") as handle:
        handle.write("seat: o31\nlane: L2\nevent: blocker cleared\n")

    # The incident itself: "1 applied" claimed against an empty archive.
    code, _ = call_runlog(["--inbox", inbox, "verify", "--run", RUN,
                           "--applied", "1", "--archived", "0", "--rejected", "0"])
    check(code == 1, "a claim of 1 applied with no artefact must FAIL")
    checked.append("runlog: unfalsifiable '1 applied' now fails")

    code, out = call_runlog(["--inbox", inbox, "archive", "--sitrep", sitrep,
                             "--disposition", "applied", "--run", RUN,
                             "--lane", "L2", "--seat", "o31",
                             "--event-time", "2026-08-29T10:00:00Z"])
    check(code == 0, "archiving an applied sitrep failed")
    artefact = os.path.join(inbox, "archive", "applied", name)
    check(os.path.isfile(artefact), "an applied sitrep must leave an artefact")
    check(not os.path.exists(sitrep), "the sitrep must leave the inbox")
    check(out.strip() == artefact, "archive must print where the artefact landed")
    with open(artefact + runlog.SIDECAR_SUFFIX, encoding="utf-8") as handle:
        sidecar = json.load(handle)
    check(sidecar["disposition"] == "applied" and sidecar["run"] == RUN
          and sidecar["lane"] == "L2" and sidecar["seat"] == "o31",
          "sidecar lost its provenance: %r" % (sidecar,))
    check(sidecar["sha256"] == runlog.sha256_of(artefact),
          "the sidecar hash must match the archived bytes")
    checked += ["runlog: applied leaves an artefact", "runlog: inbox emptied",
                "runlog: artefact path printed", "runlog: sidecar provenance",
                "runlog: sidecar hash"]

    for disposition, subdir in (("archived", "archive"), ("rejected", "rejected")):
        other = os.path.join(inbox, "2026-08-29T11:00:00Z-o30-L1-%s.md" % disposition)
        with open(other, "w", encoding="utf-8") as handle:
            handle.write("seat: o30\n")
        code, _ = call_runlog(["--inbox", inbox, "archive", "--sitrep", other,
                               "--disposition", disposition, "--run", RUN,
                               "--reason", "wrong owner"])
        check(code == 0, "archiving a %s sitrep failed" % disposition)
        check(os.path.isfile(os.path.join(inbox, subdir, os.path.basename(other))),
              "%s sitrep did not land in %s/" % (disposition, subdir))
        checked.append("runlog: %s lands in %s/" % (disposition, subdir))

    code, out = call_runlog(["--inbox", inbox, "counters", "--run", RUN])
    check(code == 0, "counters failed")
    tally = json.loads(out)
    check(tally == {"run": RUN, "applied": 1, "archived": 1, "rejected": 1},
          "counters derived %r from the artefacts" % (tally,))
    checked.append("runlog: counters derived from sidecars alone")

    # A sitrep body with no sidecar contributes nothing — counts come from artefacts only.
    with open(os.path.join(inbox, "archive", "stray.md"), "w", encoding="utf-8") as handle:
        handle.write("not a sidecar\n")
    _, out = call_runlog(["--inbox", inbox, "counters", "--run", RUN])
    check(json.loads(out)["archived"] == 1, "a bodiless file must not move a counter")
    _, out = call_runlog(["--inbox", inbox, "counters", "--run", "2026-08-30T12:00:00Z"])
    check(json.loads(out) == {"run": "2026-08-30T12:00:00Z", "applied": 0, "archived": 0,
                              "rejected": 0}, "counters must be scoped to the run")
    checked += ["runlog: sidecar-only counting", "runlog: counters scoped to the run"]

    code, _ = call_runlog(["--inbox", inbox, "verify", "--run", RUN,
                           "--applied", "1", "--archived", "1", "--rejected", "1"])
    check(code == 0, "an honest claim must verify")
    code, _ = call_runlog(["--inbox", inbox, "verify", "--run", RUN,
                           "--applied", "2", "--archived", "1", "--rejected", "1"])
    check(code == 1, "an inflated claim must fail")
    checked += ["runlog: honest claim verifies", "runlog: inflated claim fails"]

    # Never clobber an artefact: the same filename twice must be refused, not overwritten.
    again = os.path.join(inbox, name)
    with open(again, "w", encoding="utf-8") as handle:
        handle.write("a different body under the same name\n")
    code, _ = call_runlog(["--inbox", inbox, "archive", "--sitrep", again,
                           "--disposition", "applied", "--run", RUN])
    check(code == 1, "archiving over an existing artefact must be refused")
    check(os.path.isfile(again), "a refused archive must leave the sitrep in place")
    checked += ["runlog: refuses to clobber", "runlog: refusal is non-destructive"]


def selftest_deadman(now, checked):
    """(f) silence flips a lane to UNKNOWN; closed and DISPUTED are exempt."""
    lapsed = "2026-08-28T09:00:00Z"
    board = fixture_board([
        fixture_lane("L1", state="active", next_report_due=lapsed),
        fixture_lane("L2", state="closed", next_report_due=lapsed),
        fixture_lane("L3", state="DISPUTED", next_report_due=lapsed),
        fixture_lane("L4", state="active"),
    ])
    flipped = exceptions.apply_deadman(board, now)
    check(flipped == ["L1"], "dead-man flipped %r, expected only the lapsed live lane" % (flipped,))
    states = [lane["state"] for lane in board["lanes"]]
    check(states == ["UNKNOWN", "closed", "DISPUTED", "active"],
          "dead-man left the board in %r" % (states,))
    check(exceptions.apply_deadman(board, now) == [],
          "a second pass must flip nothing — UNKNOWN is already UNKNOWN")
    checked += ["deadman: lapsed lane flips", "deadman: closed and DISPUTED exempt",
                "deadman: idempotent"]


def selftest():
    now = bl.parse_iso(FROZEN)
    root = tempfile.mkdtemp(prefix="coordinator-check-selftest-")
    checked = []
    try:
        selftest_exceptions(now, checked)
        selftest_milestone(checked)
        selftest_lane_cap(checked)
        selftest_policy_and_queue(checked)
        selftest_bundle(now, checked)
        selftest_snapshot_cannot_mask(now, checked)
        selftest_runlog(root, checked)
        selftest_deadman(now, checked)
    except SelftestFailure as exc:
        print("SELFTEST FAIL: %s" % exc)
        return 1
    finally:
        shutil.rmtree(root, ignore_errors=True)

    print("SELFTEST PASS (%d assertions)" % len(checked))
    return 0


if __name__ == "__main__":
    sys.exit(main())
