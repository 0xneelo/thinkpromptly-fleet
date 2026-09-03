#!/usr/bin/env python3
"""Scan every Claude Code session active in the last N days; write excerpt packs for summarizing.

Reads (local, read-only):
  ~/.claude/projects/<mangled-cwd>/<session-id>.jsonl   transcripts; subagent files in subdirs are skipped
  ~/.claude/sessions/<pid>.json                        live registry, marks sessions still running
Writes one run directory (default ~/.claude/session-exports/summary/<stamp>/):
  sessions.json   one record per session, newest first
  batch-NN.md     excerpt packs of --batch sessions each, one per reader subagent
  summaries/      empty; each reader drops batch-NN.json here, render.py merges them
"""
import argparse, glob, json, os, re, subprocess, time
from collections import deque
from datetime import datetime, timezone

HOME = os.path.expanduser("~")
PROJECTS = os.path.join(HOME, ".claude", "projects")
SESSIONS = os.path.join(HOME, ".claude", "sessions")
NOISE = ("<local-command-", "<user-prompt-submit-hook>", "Caveat: The messages below", "<ide_", "Base directory for this skill:")
HEAD = 700  # bytes of a line that carry the role / sidechain / tool_result markers


def loads(raw):
    try:
        return json.loads(raw)
    except ValueError:
        return None


def clip(text, n):
    """Keep the head and the tail of a long message; the tail holds the recap."""
    if len(text) <= n:
        return text
    h = n * 2 // 5
    return text[:h].rstrip() + "\n…[%d chars cut]…\n" % (len(text) - n) + text[-(n - h):].lstrip()


def text_of(row):
    """Human-visible text of a user/assistant row, or None. Slash commands become '/name args'."""
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


def scan_file(path, first_n, tail_n, chars):
    s = {"id": os.path.splitext(os.path.basename(path))[0], "path": path, "cwd": "", "branch": "",
         "custom_title": "", "ai_title": "", "start": "", "end": "", "prompts": 0, "replies": 0, "first": []}
    tail = deque(maxlen=tail_n)
    with open(path, "rb") as fh:
        for raw in fh:
            head = raw[:HEAD]
            if b'"type":"custom-title"' in head or b'"type":"ai-title"' in head:
                row = loads(raw) or {}
                s["custom_title"] = row.get("customTitle") or s["custom_title"]
                s["ai_title"] = row.get("aiTitle") or s["ai_title"]
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
                continue  # tool-only turn: counts for activity/time, not as a reply
            s["prompts" if role == "user" else "replies"] += 1
            msg = {"role": role, "ts": ts, "text": clip(text, chars)}
            if role == "user" and len(s["first"]) < first_n:
                s["first"].append(msg)
            tail.append(msg)
    s["last"] = list(tail)
    return s


def live_ids():
    """Session ids whose registry pid is alive AND still a claude process (pids get recycled)."""
    ids = set()
    for f in glob.glob(os.path.join(SESSIONS, "*.json")):
        try:
            s = json.load(open(f))
            cmd = subprocess.run(["ps", "-o", "command=", "-p", str(int(s["pid"]))], capture_output=True, text=True).stdout
        except (OSError, ValueError, KeyError, TypeError):
            continue
        if "claude" in cmd.lower():
            ids.add(s.get("sessionId"))
    return ids


def project(cwd):
    if not cwd:
        return "?"
    rel = os.path.relpath(cwd, HOME) if cwd.startswith(HOME) else cwd
    if rel == ".":
        return "~"
    m = re.match(r"(.*?)/\.claude/worktrees/([^/]+)", rel)
    if m:
        return "%s ⎇ %s" % (os.path.basename(m.group(1)), re.sub(r"-[0-9a-f]{6}$", "", m.group(2)))
    return os.path.basename(rel) or rel


def name(s):
    if s["custom_title"] or s["ai_title"]:
        return s["custom_title"] or s["ai_title"]
    return s["first"][0]["text"].splitlines()[0][:70] if s["first"] else s["id"][:8]


def local(ts):
    try:
        dt = datetime.strptime(ts, "%Y-%m-%dT%H:%M:%S.%fZ").replace(tzinfo=timezone.utc)
    except ValueError:
        return ts[:16]
    return dt.astimezone().strftime("%m-%d %H:%M")


def pack(label, batch, start):
    L = ["# %s — %d sessions" % (label, len(batch)), ""]
    for n, s in enumerate(batch, start):
        L += ["## #%d · %s" % (n, s["id"]),
              "name: %s%s" % (s["name"], "  (LIVE now)" if s["live"] else ""),
              "project: %s · branch %s · %s → %s · %d prompts / %d replies" %
              (s["project"], s["branch"] or "?", local(s["start"]), local(s["end"]), s["prompts"], s["replies"]),
              "", "### opening prompts"]
        for m in s["first"]:
            L += ["**%s** %s:" % (m["role"], local(m["ts"])), m["text"], ""]
        closing = [m for m in s["last"] if m not in s["first"]]
        L += ["### closing messages" + ("" if closing else " (none beyond the prompts above)")]
        for m in closing:
            L += ["**%s** %s:" % (m["role"], local(m["ts"])), m["text"], ""]
    return "\n".join(L) + "\n"


def main():
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--days", type=float, default=7, help="window in days (default 7)")
    p.add_argument("--batch", type=int, default=15, help="sessions per reader pack (default 15)")
    p.add_argument("--first", type=int, default=2, help="opening prompts kept per session (default 2)")
    p.add_argument("--tail", type=int, default=6, help="closing messages kept per session (default 6)")
    p.add_argument("--chars", type=int, default=1000, help="max chars per message (default 1000)")
    p.add_argument("--min-turns", type=int, default=1, help="drop sessions with fewer prompts+replies (default 1)")
    p.add_argument("--out", help="run directory (default ~/.claude/session-exports/summary/<stamp>)")
    a = p.parse_args()

    cutoff = time.time() - a.days * 86400
    cutoff_iso = datetime.fromtimestamp(cutoff, timezone.utc).strftime("%Y-%m-%dT%H:%M:%S")
    live, out = live_ids(), []
    for path in glob.glob(os.path.join(PROJECTS, "*", "*.jsonl")):
        if os.path.getmtime(path) < cutoff:
            continue
        s = scan_file(path, a.first, a.tail, a.chars)
        if not s["prompts"] or s["prompts"] + s["replies"] < a.min_turns or s["end"] < cutoff_iso:
            continue
        s["name"], s["project"], s["live"] = name(s), project(s["cwd"]), s["id"] in live
        out.append(s)
    out.sort(key=lambda s: s["end"], reverse=True)

    d = a.out or os.path.join(HOME, ".claude", "session-exports", "summary", time.strftime("%Y-%m-%d-%H%M"))
    os.makedirs(os.path.join(d, "summaries"), exist_ok=True)
    with open(os.path.join(d, "sessions.json"), "w") as fh:
        json.dump({"days": a.days, "batch": a.batch, "generated": time.strftime("%Y-%m-%d %H:%M"), "sessions": out}, fh, indent=1)
    batches = [out[i:i + a.batch] for i in range(0, len(out), a.batch)]
    for n, batch in enumerate(batches, 1):
        with open(os.path.join(d, "batch-%02d.md" % n), "w") as fh:
            fh.write(pack("batch-%02d" % n, batch, (n - 1) * a.batch + 1))
    print(d)
    print("%d sessions in the last %g days → %d packs (batch-01 … batch-%02d), %d live" %
          (len(out), a.days, len(batches), len(batches), sum(s["live"] for s in out)))


if __name__ == "__main__":
    main()
