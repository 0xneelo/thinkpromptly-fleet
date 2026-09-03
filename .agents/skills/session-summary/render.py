#!/usr/bin/env python3
"""Merge the readers' batch-NN.json files into the final table.

usage: render.py <run-dir> [--stdout]
Writes <run-dir>/summary.md and prints its path, then names any batch that is missing or unparsable.
"""
import glob, json, os, re, sys
from datetime import datetime, timezone

STATUS = {"solved": "✅ solved", "open": "🟡 open", "none": "⚪ none"}


def cell(t):
    return re.sub(r"\s*\n\s*", " ", str(t)).replace("|", "\\|").strip()


def local(ts):
    try:
        dt = datetime.strptime(ts, "%Y-%m-%dT%H:%M:%S.%fZ").replace(tzinfo=timezone.utc)
    except ValueError:
        return ts[:16]
    return dt.astimezone().strftime("%m-%d %H:%M")


def main():
    d = sys.argv[1]
    run = json.load(open(os.path.join(d, "sessions.json")))
    by_n, by_id, bad = {}, {}, []  # readers mistype UUIDs; key on the block number, then an 8-char id prefix
    for f in sorted(glob.glob(os.path.join(d, "summaries", "*.json"))):
        try:
            for r in json.load(open(f)):
                if isinstance(r.get("n"), int):
                    by_n[r["n"]] = r
                by_id[str(r.get("id", ""))[:8]] = r
        except (ValueError, TypeError, AttributeError) as e:
            bad.append("%s: %s" % (os.path.basename(f), e))
    rows, counts, missing = [], {}, set()
    for i, s in enumerate(run["sessions"], 1):
        r = by_n.get(i) or by_id.get(s["id"][:8])
        if not r:
            missing.add("batch-%02d" % ((i - 1) // run["batch"] + 1))
        status = str((r or {}).get("status", "")).lower()
        counts[status] = counts.get(status, 0) + 1
        rows.append("| %d | %s%s | %s | %s | %s | %s |" % (
            i, cell(s["name"]), " 🟢" if s["live"] else "", cell(s["project"]), local(s["end"]),
            cell(r.get("summary", "")) if r else "—", STATUS.get(status, "⚠ not summarized")))
    n_missing = len(rows) - sum(counts.get(k, 0) for k in STATUS)
    head = ["# Claude sessions — last %g days" % run["days"], "",
            "%s · %d sessions · %s%s" % (run["generated"], len(rows),
                                         " · ".join("%s %d" % (STATUS[k], counts.get(k, 0)) for k in STATUS),
                                         " · ⚠ %d not summarized" % n_missing if n_missing else ""),
            "", "🟢 = still running · times local", "",
            "| # | Session | Project | Last active | What happened | Status |", "|---|---|---|---|---|---|"]
    body = "\n".join(head + rows) + "\n"
    out = os.path.join(d, "summary.md")
    with open(out, "w") as fh:
        fh.write(body)
    if "--stdout" in sys.argv:
        sys.stdout.write(body)
    print(out)
    if bad:
        print("unparsable: " + "; ".join(bad))
    if missing:
        print("re-run readers for: " + ", ".join(sorted(missing)))


if __name__ == "__main__":
    main()
