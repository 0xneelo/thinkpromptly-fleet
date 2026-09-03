#!/usr/bin/env python3
"""Collect the live Claude Code sessions of one repo and dump their last messages to markdown.

Sources (all local, read-only):
  ~/.claude/sessions/<pid>.json      live session registry (pid alive == session alive)
  ~/.claude/projects/<cwd>/<id>.jsonl  transcripts
  ~/.claude/session-kind/marks/     seat badges (ORCHESTRATOR/RESEARCHER/WORKER), optional
"""
import argparse, glob, json, os, re, subprocess, sys, time
from datetime import datetime, timezone

HOME = os.path.expanduser("~")
SESSIONS = os.path.join(HOME, ".claude", "sessions")
PROJECTS = os.path.join(HOME, ".claude", "projects")
MARKS = os.path.join(HOME, ".claude", "session-kind", "marks")
TAIL_BYTES = 2 * 1024 * 1024


def git(cwd, *args):
    try:
        out = subprocess.run(["git", "-C", cwd] + list(args), capture_output=True, text=True)
    except OSError:
        return ""
    return out.stdout.strip() if out.returncode == 0 else ""


def repo_paths(start):
    """Main worktree root + every linked worktree, as absolute paths."""
    top = git(start, "rev-parse", "--show-toplevel")
    if not top:
        sys.exit("not a git repository: %s" % start)
    common = git(start, "rev-parse", "--path-format=absolute", "--git-common-dir") or git(start, "rev-parse", "--git-common-dir")
    root = os.path.dirname(os.path.abspath(common)) if common else top
    paths = {root}
    for line in git(root, "worktree", "list", "--porcelain").splitlines():
        if line.startswith("worktree "):
            paths.add(line[len("worktree "):])
    return root, sorted(paths)


def under(path, roots):
    for r in roots:
        if path == r or path.startswith(r.rstrip("/") + "/"):
            return True
    return False


def alive(pid):
    try:
        os.kill(pid, 0)
    except OSError:
        return False
    return True


def badges():
    """(by session id, by cwd) -> seat badge, from the session-kind marks."""
    by_id, by_cwd = {}, {}
    for f in glob.glob(os.path.join(MARKS, "*.cwd")):
        base = f[:-4]
        try:
            cwd = open(f).read().strip()
            badge = open(base).read().strip()
        except OSError:
            continue
        if not (cwd and badge):
            continue
        by_cwd.setdefault(cwd, badge)
        try:
            meta = open(base + ".meta").read()
        except OSError:
            meta = ""
        m = re.search(r"session ([0-9a-f-]{36})", meta)
        if m:
            by_id[m.group(1)] = badge
    return by_id, by_cwd


def transcript(session_id, cwd):
    guess = os.path.join(PROJECTS, re.sub(r"[^A-Za-z0-9]", "-", cwd), session_id + ".jsonl")
    if os.path.exists(guess):
        return guess
    hits = glob.glob(os.path.join(PROJECTS, "*", session_id + ".jsonl"))
    return hits[0] if hits else None


def tail_rows(path):
    with open(path, "rb") as fh:
        size = fh.seek(0, os.SEEK_END)
        fh.seek(max(0, size - TAIL_BYTES))
        blob = fh.read()
    lines = blob.split(b"\n")
    if size > TAIL_BYTES:
        lines = lines[1:]
    rows = []
    for line in lines:
        if not line.strip():
            continue
        try:
            rows.append(json.loads(line))
        except ValueError:
            continue
    return rows


NOISE = ("<command-name>", "<command-message>", "<local-command-", "<user-prompt-submit-hook>", "Caveat: The messages below")


def clean(text):
    text = re.sub(r"<system-reminder>.*?</system-reminder>", "", text, flags=re.S)
    return text.strip()


def text_of(row):
    """Human-visible text of a user/assistant row, or None."""
    msg = row.get("message") or {}
    content = msg.get("content")
    if isinstance(content, str):
        parts = [content]
    elif isinstance(content, list):
        parts = [b.get("text", "") for b in content if isinstance(b, dict) and b.get("type") == "text"]
    else:
        return None
    text = clean("\n".join(p for p in parts if p))
    if not text or text.startswith(NOISE):
        return None
    return text


def messages(rows, limit):
    out = []
    for row in rows:
        if row.get("type") not in ("user", "assistant") or row.get("isSidechain") or row.get("isMeta"):
            continue
        text = text_of(row)
        if text is None:
            continue
        out.append({"role": row["type"], "ts": row.get("timestamp", ""), "text": text,
                    "branch": row.get("gitBranch", ""), "model": (row.get("message") or {}).get("model", "")})
    return out[-limit:] if limit else out


def ai_title(rows):
    for row in reversed(rows):
        if row.get("type") == "ai-title" and row.get("aiTitle"):
            return row["aiTitle"]
    return ""


def own_session_pids():
    """pids of the claude processes above this script — used to mark 'this session'."""
    pids, pid = set(), os.getpid()
    for _ in range(12):
        out = subprocess.run(["ps", "-o", "ppid=", "-p", str(pid)], capture_output=True, text=True).stdout.strip()
        if not out.isdigit() or out == "1":
            break
        pid = int(out)
        pids.add(pid)
    return pids


def label(s):
    """Seat badge + title, without repeating a badge the title already carries."""
    badge, title = s["badge"], s["title"]
    if badge and badge in title:
        badge = ""
    name = " ".join(x for x in [badge, title] if x) or os.path.basename(s["cwd"])
    return name + (" ◀ this session" if s["self"] else "")


def local(ts):
    if not ts:
        return ""
    try:
        dt = datetime.strptime(ts, "%Y-%m-%dT%H:%M:%S.%fZ").replace(tzinfo=timezone.utc)
    except ValueError:
        return ts
    return dt.astimezone().strftime("%Y-%m-%d %H:%M")


def collect(args):
    root, paths = repo_paths(args.repo)
    (seat_by_id, seat_by_cwd), mine, seen = badges(), own_session_pids(), {}
    for f in glob.glob(os.path.join(SESSIONS, "*.json")):
        try:
            s = json.load(open(f))
        except (OSError, ValueError):
            continue
        pid, cwd, sid = s.get("pid"), s.get("cwd") or "", s.get("sessionId")
        if not (pid and sid and cwd) or not under(cwd, paths) or not alive(pid):
            continue
        prev = seen.get(sid)
        if prev and prev["updatedAt"] >= (s.get("updatedAt") or 0):
            continue
        seen[sid] = {"pid": pid, "cwd": cwd, "id": sid, "title": s.get("name") or "",
                     "named": s.get("nameSource") == "user", "entrypoint": s.get("entrypoint") or "",
                     "updatedAt": s.get("updatedAt") or 0, "self": pid in mine}
    out = []
    for s in seen.values():
        path = transcript(s["id"], s["cwd"])
        rows = tail_rows(path) if path else []
        msgs = messages(rows, args.messages)
        s["transcript"] = path or ""
        s["messages"] = msgs
        s["badge"] = seat_by_id.get(s["id"]) or seat_by_cwd.get(s["cwd"], "")
        if not s["named"]:
            # a derived slug adds nothing next to a seat badge; the Path column already carries it
            s["title"] = ai_title(rows) or ("" if s["badge"] else (s["title"] or os.path.basename(s["cwd"])))
        s["branch"] = next((m["branch"] for m in reversed(msgs) if m["branch"]), git(s["cwd"], "rev-parse", "--abbrev-ref", "HEAD"))
        s["last"] = msgs[-1]["ts"] if msgs else ""
        s["mtime"] = os.path.getmtime(path) if path else 0
        out.append(s)
    out.sort(key=lambda s: s["mtime"], reverse=True)
    return root, out


def render(root, sessions, args):
    now = datetime.now().strftime("%Y-%m-%d %H:%M")
    L = ["# Active sessions — %s" % os.path.basename(root),
         "",
         "%s · %d live session%s · last %d message%s each · repo `%s`" %
         (now, len(sessions), "" if len(sessions) == 1 else "s", args.messages, "" if args.messages == 1 else "s", root),
         ""]
    if not sessions:
        L += ["No live Claude Code session has a cwd inside this repo."]
        return "\n".join(L) + "\n"
    L += ["| Session | Branch | Last activity | Path |", "|---|---|---|---|"]
    for s in sessions:
        L.append("| %s | `%s` | %s | `%s` |" % (label(s), s["branch"] or "?", local(s["last"]),
                 os.path.relpath(s["cwd"], os.path.dirname(root))))
    L.append("")
    for s in sessions:
        L += ["## %s" % label(s),
              "",
              "- cwd `%s`" % s["cwd"],
              "- branch `%s` · pid %d · %s · session `%s`" % (s["branch"] or "?", s["pid"], s["entrypoint"] or "?", s["id"]),
              "- transcript `%s`" % (s["transcript"] or "not found"),
              ""]
        if not s["messages"]:
            L += ["_No readable messages in the transcript tail._", ""]
            continue
        for m in s["messages"]:
            text = m["text"]
            if len(text) > args.chars:
                text = text[:args.chars].rstrip() + " …[truncated]"
            L += ["**%s** · %s" % (m["role"], local(m["ts"])), "", "> " + text.replace("\n", "\n> "), ""]
    return "\n".join(L) + "\n"


def main():
    p = argparse.ArgumentParser(description="Export the last messages of every live session in this repo.")
    p.add_argument("--repo", default=os.getcwd(), help="path inside the repo (default: cwd)")
    p.add_argument("-n", "--messages", type=int, default=6, help="messages per session (default 6)")
    p.add_argument("--chars", type=int, default=1200, help="max chars per message (default 1200)")
    p.add_argument("--out", help="output file (default ~/.claude/session-exports/<repo>/sessions-<ts>.md)")
    p.add_argument("--stdout", action="store_true", help="print the markdown instead of writing a file")
    p.add_argument("--json", action="store_true", help="emit JSON instead of markdown")
    args = p.parse_args()

    root, sessions = collect(args)
    if args.json:
        body = json.dumps({"repo": root, "sessions": sessions}, indent=2)
    else:
        body = render(root, sessions, args)
    if args.stdout:
        sys.stdout.write(body)
        return
    out = args.out or os.path.join(HOME, ".claude", "session-exports", os.path.basename(root),
                                   "sessions-%s.%s" % (time.strftime("%Y-%m-%d-%H%M"), "json" if args.json else "md"))
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    with open(out, "w") as fh:
        fh.write(body)
    print(out)


if __name__ == "__main__":
    main()
