#!/usr/bin/env python3
"""Report the boot bundle's byte gate as machine-readable JSON.

Usage: python3 coordinator/gate.py [board.json] [--now ISO]

bundle.py already prints the gate as a human footer line; a caller that wants the
numbers would have to parse that prose back apart, and every such parser is a second
copy of the gate that can disagree with the first. This adapter exists so there is
exactly one implementation of the arithmetic — bundle.gate_report — and everything
else, the HTTP API included, reads it through here.
"""

import argparse
import json
import sys

import board_lib as bl
import bundle


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("board", nargs="?", default=bl.default_board_path())
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

    size, headroom, pct = bundle.gate_report(board, now, args.board)
    print(json.dumps({"size": size, "headroom": headroom, "pct": pct}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
