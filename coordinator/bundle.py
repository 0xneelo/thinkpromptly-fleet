#!/usr/bin/env python3
"""Build the compacted boot bundle — what a booting seat actually reads.

Usage: python3 coordinator/bundle.py [board.json] [--now ISO] [--size]

The raw concatenation of board.json + northstar.md + decisions-effective.md was at
87% of the 8192-byte gate with four lanes (v02-scope-proposal M5), so compaction is
a dependency of M1 and M3, not cleanup after them. The gate has already stopped a
run once, at boot, which is the worst possible moment.

Sections are fixed spatial slots and never reorder (DESIGN §4). Exceptions render in
full and are never summarised — they are the reason the bundle exists. A lane renders
in full when it carries an exception or is live; the rest get one line each. Nothing
truncates a goal or a done_milestone mid-sentence: half a milestone is worse than a
referenced one.
"""

import argparse
import os
import sys

import board_lib as bl
import exceptions

# DESIGN §3: the boot bundle stays inside ~2k tokens ≈ 8KB.
BUNDLE_GATE_BYTES = 8192

# The pre-compaction bundle: the three files a seat used to read end to end.
RAW_BUNDLE_FILES = ("board.json", "northstar.md", "decisions-effective.md")

# States that always render in full, exception or not — someone is on the hook for them.
LIVE_STATES = ("active", "blocked", "DISPUTED")


def raw_total(dirpath):
    """Byte total of the uncompacted bundle files, or None if any is missing."""
    total = 0
    for name in RAW_BUNDLE_FILES:
        path = os.path.join(dirpath, name)
        if not os.path.isfile(path):
            return None
        total += os.path.getsize(path)
    return total


def decision_count(board, board_path):
    """Rows in the effective-decisions table, or None when it cannot be read."""
    ref = board.get("effective_decisions_ref")
    if not isinstance(ref, str) or not ref.strip():
        return None
    here = bl.board_dir(board_path)
    for candidate in (os.path.join(os.path.dirname(here), ref),
                      os.path.join(here, os.path.basename(ref)), ref):
        if os.path.isfile(candidate):
            with open(candidate, encoding="utf-8") as handle:
                return sum(1 for line in handle if line.startswith("| D-"))
    return None


def stamp(value):
    return value if isinstance(value, str) and value.strip() else "never"


def due_note(due, now):
    """`due <iso> (<age> overdue)` or `(in <age>)` — the deadline plus its verdict."""
    seconds = bl.age_seconds(due, now)
    if seconds is None:
        return "next_report_due unset"
    verdict = "%s overdue" % bl.humanize_age(seconds) if seconds > 0 \
        else "in %s" % bl.humanize_age(-seconds)
    return "next_report_due %s (%s)" % (due, verdict)


def northstar_lines(board):
    star = board.get("northstar") if isinstance(board.get("northstar"), dict) else {}
    text = star.get("text")
    return ["NORTHSTAR",
            "  %s" % (text if isinstance(text, str) and text.strip() else "(unstated)"),
            "  ruling %s · confirmed %s" % (star.get("ruling_id") or "(none)",
                                            star.get("confirmed_at") or "(none)")]


def exception_lines(found):
    lines = ["EXCEPTIONS (%d)" % len(found)]
    for entry in found:
        lines.append("  %s · %s · %s" % (entry["id"], entry["age"], entry["detail"]))
    if not found:
        lines.append("  none")
    return lines


def lane_full(lane, index, now):
    lid = exceptions.lane_id(lane, index)
    blockers = lane.get("blockers")
    evidence = lane.get("evidence")
    return [
        "  %s · %s · owner %s" % (lid, lane.get("state"), lane.get("owner") or "UNASSIGNED"),
        "    goal: %s" % (lane.get("goal") or "(unset)"),
        "    done_milestone: %s" % (lane.get("done_milestone") or "(unset)"),
        "    blockers: %s" % ("; ".join(str(item) for item in blockers)
                              if isinstance(blockers, list) and blockers else "none"),
        "    next_decision: %s" % (lane.get("next_decision") or "(none)"),
        "    reported_at %s · verified_at %s · %s"
        % (stamp(lane.get("reported_at")), stamp(lane.get("verified_at")),
           due_note(lane.get("next_report_due"), now)),
        "    evidence: %s" % (" · ".join(str(item) for item in evidence)
                              if isinstance(evidence, list) and evidence else "none"),
    ]


def lane_summary(lane, index, now):
    lid = exceptions.lane_id(lane, index)
    age = bl.age_seconds(lane.get("reported_at"), now)
    return "  %s %s · %s · reported %s ago" % (
        lid, lane.get("state"), exceptions.owner_brief(lane.get("owner")),
        bl.humanize_age(age) if age is not None else "never")


def lane_lines(board, now, found):
    lanes = exceptions.objects(board.get("lanes"))
    flagged = set(entry["subject"] for entry in found)
    full, summary = [], []
    for index, lane in enumerate(lanes):
        lid = exceptions.lane_id(lane, index)
        if lid in flagged or lane.get("state") in LIVE_STATES:
            full.extend(lane_full(lane, index, now))
        else:
            summary.append(lane_summary(lane, index, now))
    header = "LANES (%d — %d in full, %d summarised)" % (
        len(lanes), len(lanes) - len(summary), len(summary))
    return [header] + full + summary


def queue_lines(board, now):
    items = exceptions.objects(board.get("operator_queue"))
    lines = ["OPERATOR QUEUE (%d)" % len(items)]
    for index, item in enumerate(items):
        iid = item.get("id")
        age = bl.age_seconds(item.get("opened_at"), now)
        lines.append("  %s · open %s · due %s · %s" % (
            iid if isinstance(iid, str) else "#%d" % index,
            bl.humanize_age(age) if age is not None else "unknown",
            item.get("deadline") or "unset", item.get("item") or "(no text)"))
    if not items:
        lines.append("  none")
    return lines


def decision_lines(board, board_path):
    """A reference, never the table. The 2362-byte table is the single biggest lever,
    and a booting seat can open the file when a decision is actually in play."""
    count = decision_count(board, board_path)
    ref = board.get("effective_decisions_ref") or "(no reference)"
    return ["EFFECTIVE DECISIONS",
            "  %s in force — %s (open it when a decision is in play)"
            % ("%d" % count if count is not None else "an unread number of rulings", ref)]


def footer(size):
    headroom = BUNDLE_GATE_BYTES - size
    pct = int(round(size * 100.0 / BUNDLE_GATE_BYTES))
    if headroom < 0:
        return "-- bundle %d bytes · %d OVER the %d-byte gate (%d%%)" % (
            size, -headroom, BUNDLE_GATE_BYTES, pct)
    return "-- bundle %d bytes · %d bytes headroom under the %d-byte gate (%d%%)" % (
        size, headroom, BUNDLE_GATE_BYTES, pct)


def build(board, now, board_path):
    """The compacted bundle as plain text, footer included."""
    found = board.get("exceptions")
    if not isinstance(found, list):
        found = exceptions.compute(board, now)
    found = [entry for entry in found if isinstance(entry, dict) and "id" in entry]

    blocks = [northstar_lines(board), exception_lines(found), lane_lines(board, now, found),
              queue_lines(board, now), decision_lines(board, board_path)]
    body = "\n\n".join("\n".join(block) for block in blocks)

    # The footer states the size of the text it is part of, so settle it by iteration;
    # only a change in digit count can move it, so this converges in two passes.
    text = body + "\n\n" + footer(len(body.encode("utf-8"))) + "\n"
    for _ in range(4):
        size = len(text.encode("utf-8"))
        settled = body + "\n\n" + footer(size) + "\n"
        if settled == text:
            break
        text = settled
    return text


def gate_report(board, now, board_path):
    """(size, headroom, percent) for the compacted bundle."""
    size = len(build(board, now, board_path).encode("utf-8"))
    return size, BUNDLE_GATE_BYTES - size, int(round(size * 100.0 / BUNDLE_GATE_BYTES))


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("board", nargs="?", default=bl.default_board_path())
    parser.add_argument("--now", help="freeze the clock at this ISO time")
    parser.add_argument("--size", action="store_true", help="print only the size/headroom line")
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

    if args.size:
        size, headroom, pct = gate_report(board, now, args.board)
        print(footer(size))
        return 0 if headroom >= 0 else 1
    sys.stdout.write(build(board, now, args.board))
    return 0


if __name__ == "__main__":
    sys.exit(main())
