#!/usr/bin/env python3
"""Scan THIS repo's Claude Code sessions for the last N days; write operator-prompt packs for goal extraction.

Reads ~/.claude/projects/<mangled-cwd>/<id>.jsonl (top level only; subagent transcripts skipped) for sessions
whose cwd is the repo's main checkout or one of its .claude/worktrees. Keeps EVERY operator prompt (clipped)
and a short clip of every agent reply, in order, so a reader can tell what was asked and where it ended.

Writes one run dir (default ~/.claude/session-exports/goals/<stamp>/):
  sessions.json   one record per session, oldest first
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
        title = "# pack-%02d of %02d — %s · last %g days · chronological (oldest first)" % (k, len(packs), project, days)
        with open(os.path.join(d, "pack-%02d.md" % k), "w") as fh:
            fh.write("\n".join([title, ""] + body) + "\n")
    return len(packs)


def main():
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--days", type=float, default=3, help="window in days (default 3)")
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
    cutoff = time.time() - a.days * 86400
    cutoff_iso = datetime.fromtimestamp(cutoff, timezone.utc).strftime("%Y-%m-%dT%H:%M:%S")
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
    n_packs = write_packs(d, out, budget, project, a.days)
    with open(os.path.join(d, "sessions.json"), "w") as fh:
        json.dump({"repo": root, "project": project, "days": a.days, "generated": time.strftime("%Y-%m-%d %H:%M"),
                   "sessions": [{k: v for k, v in s.items() if k != "msgs"} for s in out]}, fh, indent=1)
    print(d)
    print("%d sessions in the last %g days (%d orchestrator, %d live) · %d chars → %d packs (pack-01 … pack-%02d)" % (
        len(out), a.days, sum(s["seat"] == "orchestrator" for s in out), sum(s["live"] for s in out), total, n_packs, n_packs))


if __name__ == "__main__":
    main()
