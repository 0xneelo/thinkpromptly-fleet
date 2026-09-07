#!/usr/bin/env python3
"""Scan THIS repo's Claude Code sessions for the last N days; write operator-prompt packs for goal extraction.

Reads ~/.claude/projects/<mangled-cwd>/<id>.jsonl (top level only; subagent transcripts skipped) for sessions
whose cwd is the repo's main checkout or one of its .claude/worktrees. Keeps EVERY operator prompt (clipped)
and a short clip of every agent reply, in order, so a reader can tell what was asked and where it ended.

Writes one run dir (default ~/.claude/session-exports/goals/<stamp>/):
  sessions.json   one record per session, oldest first
  pack-00.md      (--sources) the operator's words on disk: coordinator board/decisions/northstar, the goal
                  ledger, the newest handoff, memory notes — the coordinator's memory (D-3: files, not chat)
  pack-NN.md      chronological excerpt packs, one per reader subagent
  candidates/     empty; each reader drops pack-NN.json here
  hunts/          empty; hunter reports land here
"""
import argparse, glob, json, os, re, subprocess, sys, time
from datetime import datetime, timezone

HOME = os.path.expanduser("~")
PROJECTS = os.path.join(HOME, ".claude", "projects")
SESSIONS = os.path.join(HOME, ".claude", "sessions")
NOISE = ("<local-command-", "<user-prompt-submit-hook>", "Caveat: The messages below", "<ide_", "Base directory for this skill:",
         "<task-notification>", "<ci-monitor-event>", "<system-reminder>")
HEAD = 700
SEATS = (("🎛", "orchestrator"), ("🌐", "global"), ("🎨", "design"), ("🔬", "researcher"), ("🧭", "coordinator"), ("🔨", "worker"))


def repo_root(path=None):
    if path:
        return os.path.realpath(path)
    r = subprocess.run(["git", "rev-parse", "--path-format=absolute", "--git-common-dir"], capture_output=True, text=True)
    common = r.stdout.strip()
    if r.returncode or not common:
        sys.exit("not inside a git repo — pass --repo <main checkout>")
    common = os.path.realpath(common)
    return os.path.dirname(common) if os.path.basename(common) == ".git" else common


def loads(raw):
    try:
        return json.loads(raw)
    except ValueError:
        return None


def clip(text, n):
    if len(text) <= n:
        return text
    h = n * 2 // 5
    return text[:h].rstrip() + "\n…[%d chars cut]…\n" % (len(text) - n) + text[-(n - h):].lstrip()


def text_of(row):
    content = (row.get("message") or {}).get("content")
    if isinstance(content, str):
        parts = [content]
    elif isinstance(content, list):
        parts = [b.get("text", "") for b in content if isinstance(b, dict) and b.get("type") == "text"]
    else:
        return None
    text = "\n".join(p for p in parts if p)
    m = re.search(r"<command-name>(.*?)</command-name>", text, re.S)
    if m:
        a = re.search(r"<command-args>(.*?)</command-args>", text, re.S)
        return (m.group(1).strip() + " " + (a.group(1).strip() if a else "")).strip()
    text = re.sub(r"<system-reminder>.*?</system-reminder>", "", text, flags=re.S).strip()
    if not text or text.startswith(NOISE):
        return None
    return text


def scan_file(path, chars, reply_chars):
    s = {"id": os.path.splitext(os.path.basename(path))[0], "cwd": "", "branch": "", "title": "",
         "start": "", "end": "", "prompts": 0, "replies": 0, "msgs": []}
    with open(path, "rb") as fh:
        for raw in fh:
            head = raw[:HEAD]
            if b'"type":"custom-title"' in head or b'"type":"ai-title"' in head:
                row = loads(raw) or {}
                s["title"] = row.get("customTitle") or s["title"] or row.get("aiTitle") or ""
                continue
            if b'"role":"user"' in head:
                role = "user"
                if b'"type":"tool_result"' in head:
                    continue
            elif b'"role":"assistant"' in head:
                role = "assistant"
            else:
                continue
            if b'"isSidechain":true' in head:
                continue
            row = loads(raw)
            if not row or row.get("type") != role:
                continue
            ts = row.get("timestamp", "")
            s["start"] = s["start"] or ts
            s["end"] = ts or s["end"]
            s["cwd"] = s["cwd"] or row.get("cwd", "")
            s["branch"] = row.get("gitBranch") or s["branch"]
            text = text_of(row)
            if text is None:
                continue
            s["prompts" if role == "user" else "replies"] += 1
            s["msgs"].append({"role": role, "ts": ts, "text": clip(text, chars if role == "user" else reply_chars)})
    return s


def live_ids():
    ids = set()
    for f in glob.glob(os.path.join(SESSIONS, "*.json")):
        try:
            j = json.load(open(f))
            cmd = subprocess.run(["ps", "-o", "command=", "-p", str(int(j["pid"]))], capture_output=True, text=True).stdout
        except (OSError, ValueError, KeyError, TypeError):
            continue
        if "claude" in cmd.lower():
            ids.add(j.get("sessionId"))
    return ids


def seat(title):
    for emoji, kind in SEATS:
        if emoji in title:
            return kind
    return "session"


def local(ts):
    try:
        dt = datetime.strptime(ts, "%Y-%m-%dT%H:%M:%S.%fZ").replace(tzinfo=timezone.utc)
    except ValueError:
        return ts[:16]
    return dt.astimezone().strftime("%m-%d %H:%M")


def header(n, s, cont=False):
    return ["## S%d · %s · %s%s · %s · %s → %s · %d prompts / %d replies%s" % (
        n, s["id"][:8], seat(s["title"]), " (LIVE)" if s["live"] else "", s["title"] or "(untitled)",
        local(s["start"]), local(s["end"]), s["prompts"], s["replies"], " · (continued)" if cont else ""), ""]


def clipped(path, n):
    try:
        with open(path, encoding="utf-8", errors="replace") as fh:
            return clip(fh.read().strip(), n)
    except OSError:
        return ""


def board_lines(path):
    """coordinator/board.json → northstar + one line per lane; lanes[].goal / done_milestone are operator outcomes."""
    b = loads(open(path).read()) or {}
    L = []
    ns = (b.get("northstar") or {}).get("text")
    if ns:
        L.append("northstar: " + ns)
    for ln in b.get("lanes") or []:
        L.append("%s [%s] goal: %s — done when: %s (owner: %s)" % (ln.get("id"), ln.get("state"), ln.get("goal"),
                                                                    ln.get("done_milestone"), ln.get("owner")))
    for q in b.get("operator_queue") or []:
        L.append("operator_queue: " + json.dumps(q, ensure_ascii=False)[:400])
    return "\n".join(L)


def write_sources(d, root, project, mangled, memory_budget=40000):
    """pack-00.md — what the operator wanted, as recorded on disk. Each file clipped; memory notes newest first."""
    body = ["# pack-00 — %s · operator-facing FILES (not sessions): the coordinator's memory on disk" % project,
            "Read `coordinator/README.md` first: if it says the coordinator instance is NOT live in this repo, its board lanes are a fixture — not this repo's goals.", ""]
    files = [("coordinator/README.md", 3000), ("coordinator/northstar.md", 6000), ("coordinator/board.json", 20000),
             ("coordinator/decisions-effective.md", 45000), ("docs/operator-goals/ledger.json", 20000)]
    for rel, n in files:
        path = os.path.join(root, rel)
        if not os.path.exists(path):
            continue
        text = clip(board_lines(path), n) if rel.endswith("board.json") else clipped(path, n)
        body += ["## %s" % rel, "", text, ""]
    hand = sorted(glob.glob(os.path.join(root, "docs", "goals", "HANDOFF-*.md")), key=os.path.getmtime)
    if hand:
        body += ["## %s (newest seat handoff)" % os.path.relpath(hand[-1], root), "", clipped(hand[-1], 15000), ""]
    mem, used = sorted(glob.glob(os.path.join(PROJECTS, mangled, "memory", "*.md")), key=os.path.getmtime, reverse=True), 0
    for path in mem:
        if os.path.basename(path) == "MEMORY.md" or used > memory_budget:
            continue
        text = clipped(path, 1500)
        used += len(text)
        body += ["## memory/%s" % os.path.basename(path), "", text, ""]
    with open(os.path.join(d, "pack-00.md"), "w") as fh:
        fh.write("\n".join(body) + "\n")


def write_packs(d, sessions, budget, project, days):
    packs, cur, size, n = [], [], 0, 0
    for i, s in enumerate(sessions, 1):
        cur += header(i, s)
        for m in s["msgs"]:
            block = ["**%s** %s:" % ("operator" if m["role"] == "user" else "agent", local(m["ts"])), m["text"], ""]
            blen = sum(len(b) + 1 for b in block)
            if size + blen > budget and size > 0:
                packs.append(cur)
                cur, size = header(i, s, cont=True), 0
            cur += block
            size += blen
        cur.append("")
    if cur:
        packs.append(cur)
    for k, body in enumerate(packs, 1):
        title = "# pack-%02d of %02d — %s · %s · chronological (oldest first)" % (k, len(packs), project, days)
        with open(os.path.join(d, "pack-%02d.md" % k), "w") as fh:
            fh.write("\n".join([title, ""] + body) + "\n")
    return len(packs)


def main():
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--days", default="3", help="window in days; 'all' (or 0) = the whole history (default 3)")
    p.add_argument("--sources", action="store_true", help="also write pack-00.md: coordinator files, ledger, handoff, memory notes")
    p.add_argument("--repo", help="main checkout path (default: derived from cwd via git)")
    p.add_argument("--packs", type=int, default=0, help="target number of packs = readers (default: by --pack-chars)")
    p.add_argument("--pack-chars", type=int, default=60000, help="max chars per pack when --packs is 0 (default 60000)")
    p.add_argument("--chars", type=int, default=1200, help="max chars per operator prompt (default 1200)")
    p.add_argument("--reply-chars", type=int, default=350, help="max chars per agent reply (default 350)")
    p.add_argument("--out", help="run directory (default ~/.claude/session-exports/goals/<stamp>)")
    a = p.parse_args()

    root = repo_root(a.repo)
    project = os.path.basename(root)
    mangled = re.sub(r"[^A-Za-z0-9]", "-", root)
    days = 0 if str(a.days).lower() in ("all", "0") else float(a.days)
    cutoff = time.time() - days * 86400 if days else 0
    cutoff_iso = datetime.fromtimestamp(cutoff, timezone.utc).strftime("%Y-%m-%dT%H:%M:%S")
    window = "last %g days" % days if days else "all history"
    live, out = live_ids(), []
    for path in glob.glob(os.path.join(PROJECTS, mangled + "*", "*.jsonl")):
        if os.path.getmtime(path) < cutoff:
            continue
        s = scan_file(path, a.chars, a.reply_chars)
        cwd = s["cwd"]
        if not (cwd == root or cwd.startswith(root + "/")):
            continue
        if not s["prompts"] or s["end"] < cutoff_iso:
            continue
        s["live"], s["seat"] = s["id"] in live, seat(s["title"])
        out.append(s)
    out.sort(key=lambda s: s["start"])

    d = a.out or os.path.join(HOME, ".claude", "session-exports", "goals", time.strftime("%Y-%m-%d-%H%M"))
    for sub in ("candidates", "hunts"):
        os.makedirs(os.path.join(d, sub), exist_ok=True)
    total = sum(len(m["text"]) for s in out for m in s["msgs"])
    budget = max(8000, -(-total // a.packs)) if a.packs else a.pack_chars
    if a.sources:
        write_sources(d, root, project, mangled)
    n_packs = write_packs(d, out, budget, project, window)
    with open(os.path.join(d, "sessions.json"), "w") as fh:
        json.dump({"repo": root, "project": project, "days": days or "all", "sources": a.sources, "generated": time.strftime("%Y-%m-%d %H:%M"),
                   "sessions": [{k: v for k, v in s.items() if k != "msgs"} for s in out]}, fh, indent=1)
    print(d)
    print("%d sessions · %s (%d orchestrator, %d live) · %d chars → %d packs (%spack-01 … pack-%02d)" % (
        len(out), window, sum(s["seat"] == "orchestrator" for s in out), sum(s["live"] for s in out), total, n_packs,
        "pack-00 sources + " if a.sources else "", n_packs))


if __name__ == "__main__":
    main()
