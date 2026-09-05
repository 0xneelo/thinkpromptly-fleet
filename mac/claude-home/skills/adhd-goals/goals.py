#!/usr/bin/env python3
"""Operator-goal ledger for ONE repo — docs/operator-goals/ledger.json (committed, docs-only).

  goals.py add "<goal>" [--why TEXT] [--asked YYYY-MM-DD] [--refs XYZ-1,claude/x] [--source TEXT]
  goals.py status G3 active|done|parked|dropped [--note TEXT]
  goals.py health G3 moving|stalled|blocked [--progress TEXT] [--next TEXT]
  goals.py attach G3 XYZ-1742 [--title TEXT] [--who NAME] [--lane BRANCH] [--state TEXT] [--emoji 🟢]
  goals.py list [--all]                 markdown board for chat (done goals folded unless --all)
  goals.py render [--out PATH]          HTML board from template.html; prints the file path
  goals.py check                        validate the ledger; exit 1 on schema errors

Goal record:
  {"id":"G3","goal":"outcome the operator wants, ≤12 words","why":"operator's own words, one line",
   "asked":"2026-09-03","status":"active|done|parked|dropped","health":"moving|stalled|blocked",
   "progress":"one line","next":"one line, who acts","tasks":[{"ref":"XYZ-1742","title":"","who":"","lane":"","state":"","emoji":"🟢"}],
   "sources":["session 7cb2e629 09-03"],"updated":"2026-09-05","log":[{"at":"2026-09-05","note":"…"}]}
"""
import argparse, json, os, subprocess, sys, time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from scan import repo_root  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
STATUS = {"active", "done", "parked", "dropped"}
HEALTH = {"moving": "🟢", "stalled": "🟡", "blocked": "🔴"}
BADGE = {"done": "✅", "parked": "⏸", "dropped": "🗑"}
FIELDS = {"id": "", "goal": "", "why": "", "asked": "", "status": "active", "health": "moving", "progress": "",
          "next": "", "tasks": [], "sources": [], "updated": "", "log": []}


def today():
    return time.strftime("%Y-%m-%d")


def checkout(a):
    """The CURRENT checkout (worktree-aware) — the ledger is committed on the seat's own branch and landed on main."""
    if a.repo:
        return os.path.realpath(a.repo)
    r = subprocess.run(["git", "rev-parse", "--show-toplevel"], capture_output=True, text=True)
    if r.returncode or not r.stdout.strip():
        sys.exit("not inside a git checkout — pass --repo or --ledger")
    return os.path.realpath(r.stdout.strip())


def ledger_path(a):
    return a.ledger or os.path.join(checkout(a), "docs", "operator-goals", "ledger.json")


def load(path, project):
    if not os.path.exists(path):
        return {"project": project, "updated": "", "goals": []}
    with open(path) as fh:
        led = json.load(fh)
    led["project"] = project
    return led


def save(path, led):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    led["updated"] = today()
    with open(path, "w") as fh:
        json.dump(led, fh, indent=1, ensure_ascii=False)
        fh.write("\n")


def find(led, gid):
    for g in led["goals"]:
        if g["id"].upper() == gid.upper():
            return g
    sys.exit("no goal %s — ids: %s" % (gid, ", ".join(g["id"] for g in led["goals"]) or "none"))


def badge(g):
    return BADGE.get(g["status"]) or HEALTH.get(g.get("health", "moving"), "🟢")


def check(led):
    errs, seen = [], set()
    for i, g in enumerate(led.get("goals", [])):
        gid = g.get("id", "?")
        if gid in seen:
            errs.append("%s: duplicate id" % gid)
        seen.add(gid)
        for k in ("id", "goal", "asked", "status"):
            if not g.get(k):
                errs.append("goal #%d (%s): missing %s" % (i, gid, k))
        if g.get("status") not in STATUS:
            errs.append("%s: status %r not in %s" % (gid, g.get("status"), sorted(STATUS)))
        if g.get("health", "moving") not in HEALTH:
            errs.append("%s: health %r not in %s" % (gid, g.get("health"), sorted(HEALTH)))
        for t in g.get("tasks", []):
            if not t.get("ref"):
                errs.append("%s: task without ref" % gid)
    return errs


def cell(t):
    return " ".join(str(t or "—").split()).replace("|", "\\|")


def render_md(led, show_all):
    goals = led["goals"]
    tally = {}
    for g in goals:
        tally[badge(g)] = tally.get(badge(g), 0) + 1
    L = ["🎯 **Goals — %s** · %s · %s" % (led.get("project", "?"), led.get("updated") or "never saved",
                                          " · ".join("%s %d" % kv for kv in tally.items()) or "no goals yet"), "",
         "| # | ⚡ | 🎯 Goal | asked | Progress | ⏭ Next |", "|---|---|---|---|---|---|"]
    folded = []
    for g in goals:
        if g["status"] in ("done", "dropped") and not show_all:
            folded.append("%s %s" % (g["id"], cell(g["goal"])))
            continue
        L.append("| %s | %s | %s | %s | %s | %s |" % (g["id"], badge(g), cell(g["goal"]), cell(g["asked"][5:]),
                                                     cell(g.get("progress")), cell(g.get("next"))))
    if folded:
        L += ["", "✅/🗑 folded: " + " · ".join(folded)]
    L += ["", "⚡ 🟢 moving · 🟡 stalled · 🔴 blocked · ⏸ parked · ✅ done · 🗑 dropped"]
    return "\n".join(L)


def main():
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--repo", help="checkout holding the ledger (default: the current worktree)")
    p.add_argument("--ledger", help="ledger path override")
    sub = p.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("add"); s.add_argument("goal"); s.add_argument("--why", default=""); s.add_argument("--asked", default=today())
    s.add_argument("--refs", default=""); s.add_argument("--source", default="operator, in chat")
    s = sub.add_parser("status"); s.add_argument("id"); s.add_argument("value", choices=sorted(STATUS)); s.add_argument("--note", default="")
    s = sub.add_parser("health"); s.add_argument("id"); s.add_argument("value", choices=sorted(HEALTH)); s.add_argument("--progress"); s.add_argument("--next")
    s = sub.add_parser("attach"); s.add_argument("id"); s.add_argument("ref"); s.add_argument("--title", default=""); s.add_argument("--who", default="")
    s.add_argument("--lane", default=""); s.add_argument("--state", default=""); s.add_argument("--emoji", default="")
    s = sub.add_parser("list"); s.add_argument("--all", action="store_true")
    s = sub.add_parser("render"); s.add_argument("--out")
    sub.add_parser("check")
    a = p.parse_args()

    path = ledger_path(a)
    led = load(path, os.path.basename(repo_root(a.repo) if a.repo else repo_root()))
    led.setdefault("goals", [])
    for g in led["goals"]:
        for k, v in FIELDS.items():
            g.setdefault(k, list(v) if isinstance(v, list) else v)

    if a.cmd == "add":
        n = 1 + max([int(g["id"][1:]) for g in led["goals"] if g["id"][1:].isdigit()] or [0])
        g = dict(FIELDS, id="G%d" % n, goal=a.goal.strip(), why=a.why, asked=a.asked, sources=[a.source], updated=today(),
                 tasks=[{"ref": r.strip()} for r in a.refs.split(",") if r.strip()], log=[{"at": today(), "note": "added"}])
        led["goals"].append(g)
        save(path, led)
        print("added %s · %s · asked %s" % (g["id"], g["goal"], g["asked"]))
    elif a.cmd in ("status", "health"):
        g = find(led, a.id)
        g[a.cmd] = a.value
        if a.cmd == "health":
            if a.progress is not None:
                g["progress"] = a.progress
            if a.next is not None:
                g["next"] = a.next
        g["updated"] = today()
        g["log"].append({"at": today(), "note": "%s → %s%s" % (a.cmd, a.value, (" — " + a.note) if getattr(a, "note", "") else "")})
        save(path, led)
        print("%s %s · %s → %s" % (badge(g), g["id"], a.cmd, a.value))
    elif a.cmd == "attach":
        g = find(led, a.id)
        t = next((t for t in g["tasks"] if t.get("ref") == a.ref), None)
        if not t:
            t = {"ref": a.ref}
            g["tasks"].append(t)
        for k in ("title", "who", "lane", "state", "emoji"):
            if getattr(a, k):
                t[k] = getattr(a, k)
        g["updated"] = today()
        save(path, led)
        print("%s ← %s (%d tasks)" % (g["id"], a.ref, len(g["tasks"])))
    elif a.cmd == "check":
        errs = check(led)
        print("\n".join(errs) or "ok · %d goals · %s" % (len(led["goals"]), path))
        sys.exit(1 if errs else 0)
    elif a.cmd == "list":
        print(render_md(led, a.all))
    elif a.cmd == "render":
        errs = check(led)
        if errs:
            sys.exit("ledger invalid:\n" + "\n".join(errs))
        with open(os.path.join(HERE, "template.html")) as fh:
            html = fh.read()
        led["rendered"] = time.strftime("%Y-%m-%d %H:%M")
        html = html.replace("/*LEDGER*/", json.dumps(led, ensure_ascii=False).replace("</", "<\\/"))
        html = html.replace("<title>Operator Goals</title>", "<title>%s goals</title>" % led.get("project", "Operator"))
        out = a.out or os.path.join(os.path.expanduser("~"), ".claude", "session-exports", "goals", "board-%s.html" % led.get("project", "repo"))
        os.makedirs(os.path.dirname(out), exist_ok=True)
        with open(out, "w") as fh:
            fh.write(html)
        print(out)


if __name__ == "__main__":
    main()
