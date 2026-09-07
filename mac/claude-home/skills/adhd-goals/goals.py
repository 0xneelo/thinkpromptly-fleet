#!/usr/bin/env python3
"""Operator-goal ledger for ONE repo — docs/operator-goals/ledger.json (committed, docs-only).

  goals.py add "<goal>" [--why TEXT] [--asked YYYY-MM-DD] [--refs XYZ-1,claude/x] [--source TEXT] [--theme WORD] [--status mentioned]
  goals.py status G3 active|done|parked|dropped|mentioned [--note TEXT]
  goals.py health G3 moving|stalled|blocked [--progress TEXT] [--next TEXT]
  goals.py theme G3 <word>              1–2 word grouping for the full list (deck, fleet, workers, …)
  goals.py attach G3 XYZ-1742 [--title TEXT] [--who NAME] [--lane BRANCH] [--state TEXT] [--emoji 🟢]
  goals.py list [--all] [--full]        markdown board for chat; NOW view folds done/dropped/mentioned,
                                        --full = the no-limits list: every goal, grouped by theme
  goals.py render [--out PATH] [--full] HTML board from template.html (--full opens on "All"); prints the path
  goals.py check                        validate the ledger; exit 1 on schema errors

Status `mentioned` (💭) = the operator voiced this outcome and nobody picked it up — the no-limits list
(/adhd-full-goals) adds these; `parked`/`dropped` need the operator's own words.

Goal record:
  {"id":"G3","goal":"outcome the operator wants, ≤12 words","why":"operator's own words, one line","asks":["more verbatim operator lines"],"theme":"deck",
   "asked":"2026-09-03","status":"active|done|parked|dropped|mentioned","health":"moving|stalled|blocked",
   "progress":"one line","next":"one line, who acts","tasks":[{"ref":"XYZ-1742","title":"","who":"","lane":"","state":"","emoji":"🟢"}],
   "sources":["session 7cb2e629 09-03"],"updated":"2026-09-05","log":[{"at":"2026-09-05","note":"…"}]}
"""
import argparse, json, os, subprocess, sys, time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from scan import repo_root  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
STATUS = {"active", "done", "parked", "dropped", "mentioned"}
HEALTH = {"moving": "🟢", "stalled": "🟡", "blocked": "🔴"}
BADGE = {"done": "✅", "parked": "⏸", "dropped": "🗑", "mentioned": "💭"}
LEGEND = "⚡ 🟢 moving · 🟡 stalled · 🔴 blocked · ⏸ parked · ✅ done · 🗑 dropped · 💭 mentioned, not picked up"
FIELDS = {"id": "", "goal": "", "why": "", "asks": [], "theme": "", "asked": "", "status": "active", "health": "moving", "progress": "",
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


def project_of(a, path):
    """Project name: the main checkout's basename; with --ledger outside any git checkout, the ledger's own."""
    if a.repo:
        return os.path.basename(repo_root(a.repo))
    r = subprocess.run(["git", "rev-parse", "--path-format=absolute", "--git-common-dir"], capture_output=True, text=True)
    if r.returncode == 0 and r.stdout.strip():
        return os.path.basename(repo_root())
    if a.ledger and os.path.exists(path):
        with open(path) as fh:
            return json.load(fh).get("project") or "repo"
    return "repo" if a.ledger else sys.exit("not inside a git checkout — pass --repo or --ledger")


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


def cell(t, n=0):
    t = " ".join(str(t or "—").split()).replace("|", "\\|")
    return t if not n or len(t) <= n else t[:n - 1].rstrip() + "…"


def tally_line(goals):
    tally = {}
    for g in goals:
        tally[badge(g)] = tally.get(badge(g), 0) + 1
    return " · ".join("%s %d" % kv for kv in tally.items()) or "no goals yet"


def render_md(led, show_all):
    goals = led["goals"]
    L = ["🎯 **Goals — %s** · %s · %s" % (led.get("project", "?"), led.get("updated") or "never saved", tally_line(goals)), "",
         "| # | ⚡ | 🎯 Goal | asked | Progress | ⏭ Next |", "|---|---|---|---|---|---|"]
    folded, wished = [], []
    for g in goals:
        if g["status"] in ("done", "dropped") and not show_all:
            folded.append("%s %s" % (g["id"], cell(g["goal"])))
            continue
        if g["status"] == "mentioned" and not show_all:
            wished.append("%s %s" % (g["id"], cell(g["goal"], 40)))
            continue
        L.append("| %s | %s | %s | %s | %s | %s |" % (g["id"], badge(g), cell(g["goal"]), cell(g["asked"][5:]),
                                                     cell(g.get("progress")), cell(g.get("next"))))
    if folded:
        L += ["", "✅/🗑 folded: " + " · ".join(folded)]
    if wished:
        L += ["", "💭 mentioned, not picked up (%d): %s — full list: `/adhd-full-goals`" % (len(wished), " · ".join(wished))]
    L += ["", LEGEND]
    return "\n".join(L)


def render_full_md(led):
    """The no-limits list: every goal, grouped by theme, with the operator's own words."""
    goals = led["goals"]
    L = ["🎯 **All goals — %s** · no limits, every outcome the operator wanted · %s · %s" % (
        led.get("project", "?"), led.get("updated") or "never saved", tally_line(goals))]
    themes = []
    for g in goals:
        t = g.get("theme") or "—"
        if t not in themes:
            themes.append(t)
    for t in themes:
        L += ["", "**%s**" % ("no theme" if t == "—" else t), "", "| # | ⚡ | 🎯 Goal | asked | 💬 Why (operator) | Progress |", "|---|---|---|---|---|---|"]
        for g in goals:
            if (g.get("theme") or "—") == t:
                L.append("| %s | %s | %s | %s | %s | %s |" % (g["id"], badge(g), cell(g["goal"]), cell(g["asked"][5:]),
                                                             cell(g.get("why"), 90), cell(g.get("progress") or g["status"], 40)))
    L += ["", LEGEND]
    return "\n".join(L)


def main():
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--repo", help="checkout holding the ledger (default: the current worktree)")
    p.add_argument("--ledger", help="ledger path override")
    sub = p.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("add"); s.add_argument("goal"); s.add_argument("--why", default=""); s.add_argument("--asked", default=today())
    s.add_argument("--refs", default=""); s.add_argument("--source", default="operator, in chat"); s.add_argument("--theme", default="")
    s.add_argument("--status", default="active", choices=sorted(STATUS))
    s = sub.add_parser("status"); s.add_argument("id"); s.add_argument("value", choices=sorted(STATUS)); s.add_argument("--note", default="")
    s = sub.add_parser("health"); s.add_argument("id"); s.add_argument("value", choices=sorted(HEALTH)); s.add_argument("--progress"); s.add_argument("--next")
    s = sub.add_parser("theme"); s.add_argument("id"); s.add_argument("value")
    s = sub.add_parser("attach"); s.add_argument("id"); s.add_argument("ref"); s.add_argument("--title", default=""); s.add_argument("--who", default="")
    s.add_argument("--lane", default=""); s.add_argument("--state", default=""); s.add_argument("--emoji", default="")
    s = sub.add_parser("list"); s.add_argument("--all", action="store_true"); s.add_argument("--full", action="store_true")
    s = sub.add_parser("render"); s.add_argument("--out"); s.add_argument("--full", action="store_true")
    sub.add_parser("check")
    a = p.parse_args()

    path = ledger_path(a)
    led = load(path, project_of(a, path))
    led.setdefault("goals", [])
    for g in led["goals"]:
        for k, v in FIELDS.items():
            g.setdefault(k, list(v) if isinstance(v, list) else v)

    if a.cmd == "add":
        n = 1 + max([int(g["id"][1:]) for g in led["goals"] if g["id"][1:].isdigit()] or [0])
        g = dict(FIELDS, id="G%d" % n, goal=a.goal.strip(), why=a.why, theme=a.theme, asked=a.asked, status=a.status,
                 sources=[a.source], updated=today(), tasks=[{"ref": r.strip()} for r in a.refs.split(",") if r.strip()],
                 log=[{"at": today(), "note": "added" + (" as %s" % a.status if a.status != "active" else "")}])
        led["goals"].append(g)
        save(path, led)
        print("added %s %s · %s · asked %s" % (badge(g), g["id"], g["goal"], g["asked"]))
    elif a.cmd == "theme":
        g = find(led, a.id)
        g["theme"] = a.value.strip()
        g["updated"] = today()
        save(path, led)
        print("%s · theme → %s" % (g["id"], g["theme"]))
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
        print(render_full_md(led) if a.full else render_md(led, a.all))
    elif a.cmd == "render":
        errs = check(led)
        if errs:
            sys.exit("ledger invalid:\n" + "\n".join(errs))
        with open(os.path.join(HERE, "template.html")) as fh:
            html = fh.read()
        led["rendered"] = time.strftime("%Y-%m-%d %H:%M")
        led["view"] = "full" if a.full else "open"
        html = html.replace("/*LEDGER*/", json.dumps(led, ensure_ascii=False).replace("</", "<\\/"))
        html = html.replace("<title>Operator Goals</title>", "<title>%s goals</title>" % led.get("project", "Operator"))
        out = a.out or os.path.join(os.path.expanduser("~"), ".claude", "session-exports", "goals", "board-%s.html" % led.get("project", "repo"))
        os.makedirs(os.path.dirname(out), exist_ok=True)
        with open(out, "w") as fh:
            fh.write(html)
        print(out)


if __name__ == "__main__":
    main()
