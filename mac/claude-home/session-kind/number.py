#!/usr/bin/env python3
"""Desktop session number registry — claim the lowest free session number, release on close.

Mirror of workers/name.py for desktop session numbers. Orchestrators (badge
`🎛 ORCHESTRATOR <N>`) and researchers (badge `🔬 RESEARCHER <N>`) share this ONE pool,
so a number identifies a desktop session unambiguously across both kinds.
Numbers rotate: any claim untouched for ROTATE_DAYS becomes claimable again, so claims
that were never closed (dead session) self-heal. The pool is the positive integers, so
there is nothing to restock — claim always returns the lowest number not actively held.

  number.py claim [--topic "deploy QA"]   -> prints just the number
  number.py close <N>
  number.py status

stdlib only. Truth lives in numbers.db; nothing else needs to be edited by hand.
"""
import argparse
import datetime
import os
import sqlite3
import sys

ROTATE_DAYS = 7
DB = os.path.join(os.path.dirname(os.path.abspath(__file__)), "numbers.db")

SCHEMA = """
CREATE TABLE IF NOT EXISTS numbers (
  n       INTEGER PRIMARY KEY,
  status  TEXT NOT NULL DEFAULT 'active',  -- active | closed
  topic   TEXT,
  cwd     TEXT,
  touched TEXT NOT NULL                    -- ISO date of last status change
);
"""


def today():
    return datetime.date.today().isoformat()


def cutoff():
    return (datetime.date.today() - datetime.timedelta(days=ROTATE_DAYS)).isoformat()


def connect():
    con = sqlite3.connect(DB, timeout=10)
    con.executescript(SCHEMA)
    return con


def cmd_claim(con, args):
    con.execute("BEGIN IMMEDIATE")  # serialises parallel sessions claiming at once
    cwd = os.getcwd()
    mine = con.execute(
        "SELECT n FROM numbers WHERE status='active' AND cwd=? AND touched > ? ORDER BY n",
        (cwd, cutoff()),
    ).fetchone()
    if mine:
        # Re-claiming from a directory that already holds a number (a session re-running
        # mark.sh, or a second claim in the same session) hands back the SAME number
        # instead of inflating the pool — the badge and the registry can never diverge.
        con.execute(
            "UPDATE numbers SET touched=?, topic=COALESCE(?, topic) WHERE n=?",
            (today(), args.topic, mine[0]),
        )
        con.commit()
        print(mine[0])
        return
    held = {
        row[0]
        for row in con.execute(
            "SELECT n FROM numbers WHERE status='active' AND touched > ?", (cutoff(),)
        )
    }
    n = 1
    while n in held:
        n += 1
    con.execute(
        "INSERT OR REPLACE INTO numbers(n, status, topic, cwd, touched) "
        "VALUES (?, 'active', ?, ?, ?)",
        (n, args.topic, os.getcwd(), today()),
    )
    con.commit()
    print(n)


def cmd_close(con, args):
    changed = con.execute(
        "UPDATE numbers SET status='closed', touched=? WHERE n=? AND status='active'",
        (today(), args.n),
    ).rowcount
    con.commit()
    if not changed:
        sys.exit("{} is not an active claim".format(args.n))


def cmd_verify(con, args):
    """Exit 0 if <n> is free or already held by this cwd; exit 3 on a cross-cwd conflict.

    mark.sh calls this before stamping an explicitly-passed `🎛 ORCHESTRATOR <N>` badge,
    so a hand-typed or copy-pasted number can never duplicate a live claim.
    """
    row = con.execute(
        "SELECT cwd, topic FROM numbers WHERE n=? AND status='active' AND touched > ?",
        (args.n, cutoff()),
    ).fetchone()
    if row and row[0] != os.getcwd():
        sys.exit(
            "number {} is already held by {} ({}) — run "
            "`sh mark.sh --orchestrator/--researcher \"<topic>\"` to claim your own".format(
                args.n, row[0] or "?", row[1] or "no topic"
            )
        )


def cmd_reap(con, args):
    """Close dead claims: cwd gone from disk, or idle longer than --days.

    Nothing closes a number when a session dies, so without this the pool only ever grows
    and every new orchestrator gets a misleadingly high number.
    """
    stale = (datetime.date.today() - datetime.timedelta(days=args.days)).isoformat()
    rows = con.execute(
        "SELECT n, topic, cwd, touched FROM numbers WHERE status='active'"
    ).fetchall()
    closed = 0
    for n, topic, cwd, touched in rows:
        gone = bool(cwd) and not os.path.isdir(cwd)
        if gone or touched <= stale:
            con.execute(
                "UPDATE numbers SET status='closed', touched=? WHERE n=?", (today(), n)
            )
            closed += 1
            print(
                "closed {:<4} {:<32} {}".format(
                    n, (topic or "-")[:32], "cwd gone" if gone else "idle since " + touched
                )
            )
    con.commit()
    print("reaped {} claim(s)".format(closed))


def cmd_status(con, args):
    counts = dict(con.execute("SELECT status, COUNT(*) FROM numbers GROUP BY status"))
    rotatable = con.execute(
        "SELECT COUNT(*) FROM numbers WHERE status='active' AND touched <= ?", (cutoff(),)
    ).fetchone()[0]
    print(
        "active {}  closed {}  (+{} rotatable after {}d idle)".format(
            counts.get("active", 0), counts.get("closed", 0), rotatable, ROTATE_DAYS
        )
    )
    rows = con.execute(
        "SELECT n, topic, cwd, touched FROM numbers WHERE status='active' ORDER BY n"
    ).fetchall()
    if rows:
        print("\nactive:")
        for n, topic, cwd, touched in rows:
            print("  {:<4} {:<30} {:<40} {}".format(n, topic or "-", cwd or "-", touched))


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = ap.add_subparsers(dest="cmd")

    p = sub.add_parser("claim", help="claim the lowest free number; prints it")
    p.add_argument("--topic", help="what the session is about, if already known")
    p.set_defaults(fn=cmd_claim)

    p = sub.add_parser("close", help="release a number when the session closes")
    p.add_argument("n", type=int)
    p.set_defaults(fn=cmd_close)

    p = sub.add_parser("verify", help="exit 3 if <n> is held by a different directory")
    p.add_argument("n", type=int)
    p.set_defaults(fn=cmd_verify)

    p = sub.add_parser("reap", help="close claims whose cwd is gone or that sat idle")
    p.add_argument("--days", type=int, default=2, help="idle days before a claim is dead")
    p.set_defaults(fn=cmd_reap)

    sub.add_parser("status", help="pool counts and who is active").set_defaults(fn=cmd_status)

    args = ap.parse_args()
    if not getattr(args, "fn", None):
        ap.print_help()
        sys.exit(2)
    con = connect()
    try:
        args.fn(con, args)
    finally:
        con.close()


if __name__ == "__main__":
    main()
