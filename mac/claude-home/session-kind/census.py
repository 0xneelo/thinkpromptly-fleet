#!/usr/bin/env python3
"""Count the sessions that are actually OPEN — by observation, not by bookkeeping.

Nothing reliably closes a session: tabs get closed, machines sleep, sessions die mid-turn.
So neither `numbers.db` nor `marks/` can be trusted to say what is running. This asks the
OS instead — which processes are alive, and what directory each one sits in — then joins
that against both registries and the session transcripts.

  census.py            table + summary of every session directory and its real state
  census.py --reap     close/drop registry entries with NO live process behind them
  census.py --quiet    summary line only
  census.py --live-badge-prefix "🥅"
                       `badge<TAB>cwd` for LIVE sessions with that badge prefix, nothing else

Statuses:
  LIVE          a driver process is alive in that directory
  LIVE·WAITING  alive, but its transcript has not been written for --idle minutes —
                usually sitting on a permission prompt, NOT dead (the failure mode that
                made a launched worker look "done" for an hour on 2026-08-09)
  LIVE·TWIN     two or more drivers in ONE directory — two agents on one worktree/branch.
                Read-only they coexist; the first write corrupts. Kill one.
  UNSTAMPED     live session with no badge — invisible to the status line and the guard
  GHOST         badge and/or number claim with nothing running — reapable

stdlib only; reads `ps` and `lsof` (no sudo, own processes only). Never kills anything.
"""
import argparse
import hashlib
import os
import re
import sqlite3
import subprocess
import time

DIR = os.path.dirname(os.path.abspath(__file__))
MARKS = os.path.join(DIR, "marks")
DB = os.path.join(DIR, "numbers.db")
PROJECTS = os.path.join(os.path.dirname(DIR), "projects")

# Electron shells, the launcher stub and crash handlers all mention claude but are not
# sessions; the stub in particular carries the real binary in its ARGS and would double-count.
NOT_A_DRIVER = ("disclaimer", "Helper", "crashpad", "chrome-native-host", "Electron")


def executable(cmd):
    """The binary a ps command line actually runs.

    Cannot just take the first token: the desktop binary lives under 'Application Support'
    (a path WITH a space), while a wrapper shell can carry 'claude' in its arguments
    (`-/bin/zsh /tmp/cmux-surface-resume/claude-...`) and must not count as a session. So
    grow the candidate token by token and take the first one that exists on disk.
    """
    parts = cmd.split(" ")
    for i in range(1, len(parts) + 1):
        cand = " ".join(parts[:i])
        if cand.startswith("/") and os.path.isfile(cand):
            return cand
    return None


def drivers():
    """pid -> (ppid, command) for every live claude session driver owned by this user."""
    out = subprocess.run(
        ["ps", "-Ao", "pid=,ppid=,command="], capture_output=True, text=True
    ).stdout
    found = {}
    for line in out.splitlines():
        line = line.strip()
        if not line:
            continue
        bits = line.split(None, 2)
        if len(bits) < 3 or not bits[0].isdigit():
            continue
        pid, ppid, cmd = int(bits[0]), int(bits[1]), bits[2]
        if "/claude" not in cmd or any(bad in cmd for bad in NOT_A_DRIVER):
            continue
        exe = executable(cmd)
        if not exe or os.path.basename(exe) != "claude":
            continue
        found[pid] = (ppid, cmd)
    return found


def alive(pid):
    try:
        os.kill(pid, 0)
        return True
    except OSError:
        return False


def independent(pids, parents):
    """Drop pids whose parent chain contains another driver in the same directory.

    A desktop tab can run a host process plus a child; those are ONE session. Two sessions
    launched separately (a tab and a tmux pane, say) share no ancestry — that is a real twin.
    """
    keep = []
    for p in pids:
        cur, nested = parents.get(p), False
        seen = 0
        while cur and cur > 1 and seen < 20:
            if cur in pids:
                nested = True
                break
            cur = parents.get(cur)
            seen += 1
        if not nested:
            keep.append(p)
    return keep


def cwds(pids):
    """pid -> cwd, one lsof call for every process we own."""
    out = subprocess.run(
        ["lsof", "-u", os.environ.get("USER", ""), "-a", "-d", "cwd", "-Fpn"],
        capture_output=True,
        text=True,
    ).stdout
    where, cur = {}, None
    for line in out.splitlines():
        if line.startswith("p"):
            cur = int(line[1:]) if line[1:].isdigit() else None
        elif line.startswith("n") and cur in pids and cur not in where:
            where[cur] = line[1:]
    return where


def key_for(path):
    return hashlib.sha1(path.encode()).hexdigest()[:12]


def badge_for(path):
    f = os.path.join(MARKS, key_for(path))
    try:
        with open(f) as fh:
            return fh.read().strip()
    except OSError:
        return None


def claims():
    """cwd -> number, for active claims only."""
    if not os.path.exists(DB):
        return {}
    con = sqlite3.connect(DB)
    try:
        return {
            row[1]: row[0]
            for row in con.execute(
                "SELECT n, cwd FROM numbers WHERE status='active' AND cwd IS NOT NULL"
            )
        }
    finally:
        con.close()


def last_activity(path):
    """Newest transcript mtime for that directory, or None if it never ran a session."""
    slug = path.replace("/", "-").replace(".", "-")
    d = os.path.join(PROJECTS, slug)
    try:
        times = [
            os.path.getmtime(os.path.join(d, f))
            for f in os.listdir(d)
            if f.endswith(".jsonl")
        ]
    except OSError:
        return None
    return max(times) if times else None


def marked_dirs():
    out = set()
    try:
        names = os.listdir(MARKS)
    except OSError:
        return out
    for n in names:
        if not n.endswith(".cwd"):
            continue
        try:
            with open(os.path.join(MARKS, n)) as fh:
                p = fh.read().strip()
            if p:
                out.add(p)
        except OSError:
            pass
    return out


def age(seconds):
    if seconds is None:
        return "never"
    m = int((time.time() - seconds) // 60)
    if m < 60:
        return "{}m".format(m)
    if m < 60 * 48:
        return "{}h".format(m // 60)
    return "{}d".format(m // 1440)


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--reap", action="store_true", help="clear entries with no live process")
    ap.add_argument("--quiet", action="store_true", help="summary line only")
    ap.add_argument("--idle", type=int, default=10, help="minutes before LIVE·WAITING")
    ap.add_argument(
        "--live-badge-prefix",
        metavar="PREFIX",
        help="print `badge<TAB>cwd` for live sessions whose badge starts with PREFIX, "
             "and nothing else (machine-readable liveness query for mark.sh)",
    )
    args = ap.parse_args()

    procs = drivers()
    parents = {pid: info[0] for pid, info in procs.items()}
    where = cwds(set(procs))
    by_dir = {}
    for pid, d in where.items():
        if alive(pid):  # lsof snapshot can be a moment stale; re-check before reporting
            by_dir.setdefault(d, []).append(pid)
    for d, pids in list(by_dir.items()):
        by_dir[d] = independent(pids, parents)
        if not by_dir[d]:
            del by_dir[d]

    claimed = claims()
    rows = []
    for d in sorted(set(by_dir) | marked_dirs() | set(claimed)):
        pids = sorted(by_dir.get(d, []))
        badge = badge_for(d)
        n = claimed.get(d)
        act = last_activity(d)
        if not pids:
            status = "GHOST"
        elif len(pids) > 1:
            status = "LIVE·TWIN"
        elif not badge:
            status = "UNSTAMPED"
        elif act is not None and (time.time() - act) > args.idle * 60:
            status = "LIVE·WAITING"
        else:
            status = "LIVE"
        rows.append((status, d, badge, n, pids, act))

    live = [r for r in rows if r[0].startswith("LIVE") or r[0] == "UNSTAMPED"]

    if args.live_badge_prefix:
        for status, d, badge, n, pids, act in live:
            if (badge or "").startswith(args.live_badge_prefix):
                print("{}\t{}".format(badge, d))
        return

    orch = sum(1 for r in live if (r[2] or "").startswith("🎛"))
    res = sum(1 for r in live if (r[2] or "").startswith("🔬"))
    des = sum(1 for r in live if (r[2] or "").startswith("🎨"))
    coord = sum(1 for r in live if (r[2] or "").startswith("🧭"))
    gk = sum(1 for r in live if (r[2] or "").startswith("🥅"))
    work = sum(1 for r in live if (r[2] or "").startswith("🔨"))
    print(
        "open sessions: {}  ({} orchestrator, {} researcher, {} design, {} coordinator, "
        "{} goalkeeper, {} worker, {} unstamped)  |  "
        "{} ghost registry entr{}".format(
            len(live),
            orch,
            res,
            des,
            coord,
            gk,
            work,
            sum(1 for r in live if not r[2]),
            sum(1 for r in rows if r[0] == "GHOST"),
            "y" if sum(1 for r in rows if r[0] == "GHOST") == 1 else "ies",
        )
    )
    twins = [r for r in rows if r[0] == "LIVE·TWIN"]
    if twins:
        print("!! {} directory(ies) with TWO drivers — kill one before either writes".format(len(twins)))

    if not args.quiet:
        print()
        print("{:<13} {:<5} {:<26} {:<9} {}".format("STATUS", "N", "BADGE", "IDLE", "DIRECTORY"))
        for status, d, badge, n, pids, act in rows:
            print(
                "{:<13} {:<5} {:<26} {:<9} {}{}".format(
                    status,
                    n if n is not None else "-",
                    (badge or "-")[:26],
                    age(act),
                    d,
                    "  pids=" + ",".join(str(p) for p in pids) if len(pids) > 1 else "",
                )
            )

    if args.reap:
        print()
        con = sqlite3.connect(DB) if os.path.exists(DB) else None
        dropped = 0
        for status, d, badge, n, _pids, act in rows:
            if status != "GHOST":
                continue
            if act is not None and (time.time() - act) < 3600:
                # Detection is process-based; if it were ever wrong for a session that just
                # ran, dropping the badge would disarm that session's no-build guard.
                print("kept   {:<5} {:<26} {} (active {} ago)".format(
                    n if n is not None else "-", (badge or "-")[:26], d, age(act)))
                continue
            if n is not None and con is not None:
                con.execute(
                    "UPDATE numbers SET status='closed', touched=? WHERE n=?",
                    (time.strftime("%Y-%m-%d"), n),
                )
            k = key_for(d)
            for suffix in ("", ".cwd", ".meta"):
                try:
                    os.remove(os.path.join(MARKS, k + suffix))
                except OSError:
                    pass
            dropped += 1
            print("reaped {:<5} {:<26} {}".format(n if n is not None else "-", (badge or "-")[:26], d))
        if con is not None:
            con.commit()
            con.close()
        print("reaped {} ghost entr{}".format(dropped, "y" if dropped == 1 else "ies"))


if __name__ == "__main__":
    main()
