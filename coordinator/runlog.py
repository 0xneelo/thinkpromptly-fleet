#!/usr/bin/env python3
"""Archive a dispositioned sitrep and derive a run's counters from the artefacts alone.

Usage: python3 coordinator/runlog.py archive --sitrep <path> --disposition applied|archived|rejected
                                             --run <ISO> [--lane L2] [--seat o31]
                                             [--event-time ISO] [--reason "..."]
       python3 coordinator/runlog.py counters --run <ISO>
       python3 coordinator/runlog.py verify   --run <ISO> --applied n --archived n --rejected n

The recorded gap (inbox/archive/PORTED-FROM-LOWCAP.md #1): a lowcap run reported
"1 applied" and left no artefact for it, so the claim could not be falsified — and
v0.1's rule deletes an applied sitrep, which is exactly how that happened.

v0.2 rule: an applied sitrep MUST leave an archive artefact, and run counters MUST
be derivable from the artefacts alone. `counters` therefore reads nothing but the
sidecars, and `verify` fails a claim the artefacts do not support.
"""

import argparse
import glob
import hashlib
import json
import os
import shutil
import sys

import board_lib as bl

# Where each disposition lands. `archived` keeps v0.1's home so the ported refusals
# and their .flag notes stay where the operator already reads them.
DESTINATIONS = {
    "applied": ("archive", "applied"),
    "archived": ("archive",),
    "rejected": ("rejected",),
}

SIDECAR_SUFFIX = ".provenance.json"


def default_inbox():
    return bl.default_instance_path("inbox")


def sha256_of(path):
    """Hash the sitrep bytes so a later silent edit of the artefact is detectable."""
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(65536), b""):
            digest.update(chunk)
    return digest.hexdigest()


def sidecars(inbox):
    """Every provenance sidecar under archive/ and rejected/, recursively."""
    found = []
    for top in ("archive", "rejected"):
        pattern = os.path.join(inbox, top, "**", "*" + SIDECAR_SUFFIX)
        found.extend(sorted(glob.glob(pattern, recursive=True)))
    return found


def counters(inbox, run):
    """Counts for `run`, derived from sidecars and nothing else."""
    tally = {"run": run, "applied": 0, "archived": 0, "rejected": 0}
    for path in sidecars(inbox):
        try:
            with open(path, encoding="utf-8") as handle:
                sidecar = json.load(handle)
        except (OSError, ValueError):
            continue  # an unreadable sidecar proves nothing; it must not inflate a count
        if not isinstance(sidecar, dict) or sidecar.get("run") != run:
            continue
        disposition = sidecar.get("disposition")
        if disposition in tally:
            tally[disposition] += 1
    return tally


def do_archive(args, inbox):
    fails = []
    if not os.path.isfile(args.sitrep):
        fails.append("no sitrep at %s" % args.sitrep)
    if not bl.parse_iso(args.run):
        fails.append("--run is not ISO-8601: %r" % (args.run,))
    if args.event_time is not None and not bl.parse_iso(args.event_time):
        fails.append("--event-time is not ISO-8601: %r" % (args.event_time,))

    name = os.path.basename(args.sitrep)
    dest_dir = os.path.join(inbox, *DESTINATIONS[args.disposition])
    dest = os.path.join(dest_dir, name)
    sidecar_path = dest + SIDECAR_SUFFIX
    for path in (dest, sidecar_path):
        if os.path.exists(path):
            # Never clobber: an overwritten artefact is the same unfalsifiable claim
            # the v0.2 rule exists to stop.
            fails.append("%s already exists — refusing to overwrite an artefact" % path)

    if fails:
        for failure in fails:
            print("FAIL: %s" % failure, file=sys.stderr)
        return 1

    provenance = {
        "disposition": args.disposition,
        "run": args.run,
        "lane": args.lane,
        "seat": args.seat,
        "event_time": args.event_time,
        "reason": args.reason,
        "archived_at": bl.to_iso(bl.now_utc()),
        "sha256": sha256_of(args.sitrep),
    }

    os.makedirs(dest_dir, exist_ok=True)
    shutil.move(args.sitrep, dest)
    with open(sidecar_path, "w", encoding="utf-8") as handle:
        handle.write(json.dumps(provenance, indent=2, ensure_ascii=False) + "\n")

    print(dest)
    print("archived %s as %s (run %s)" % (name, args.disposition, args.run), file=sys.stderr)
    return 0


def do_counters(args, inbox):
    print(json.dumps(counters(inbox, args.run), ensure_ascii=False))
    return 0


def do_verify(args, inbox):
    derived = counters(inbox, args.run)
    claimed = {"applied": args.applied, "archived": args.archived, "rejected": args.rejected}
    fails = []
    for disposition in ("applied", "archived", "rejected"):
        if claimed[disposition] != derived[disposition]:
            fails.append("run %s claims %d %s but the artefacts show %d — an applied sitrep "
                         "must leave an archive artefact (PORTED-FROM-LOWCAP #1)"
                         % (args.run, claimed[disposition], disposition, derived[disposition]))
    if fails:
        for failure in fails:
            print("FAIL: %s" % failure, file=sys.stderr)
        return 1
    print("OK: run %s verified from artefacts — %d applied, %d archived, %d rejected"
          % (args.run, derived["applied"], derived["archived"], derived["rejected"]))
    return 0


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--inbox", default=default_inbox(), help="inbox directory to work in")
    subs = parser.add_subparsers(dest="command", required=True)

    archive = subs.add_parser("archive", help="move a dispositioned sitrep and record provenance")
    archive.add_argument("--sitrep", required=True)
    archive.add_argument("--disposition", required=True, choices=sorted(DESTINATIONS))
    archive.add_argument("--run", required=True)
    archive.add_argument("--lane")
    archive.add_argument("--seat")
    archive.add_argument("--event-time", dest="event_time")
    archive.add_argument("--reason")

    count = subs.add_parser("counters", help="derive a run's counters from the sidecars alone")
    count.add_argument("--run", required=True)

    check = subs.add_parser("verify", help="fail a claimed count the artefacts do not support")
    check.add_argument("--run", required=True)
    for disposition in ("applied", "archived", "rejected"):
        check.add_argument("--" + disposition, type=int, required=True)

    args = parser.parse_args(sys.argv[1:] if argv is None else argv)
    handler = {"archive": do_archive, "counters": do_counters, "verify": do_verify}[args.command]
    return handler(args, args.inbox)


if __name__ == "__main__":
    sys.exit(main())
