#!/usr/bin/env python3
"""goalkeeper.py — the 🥅 seat's evidence tools (PLAN §3.1–§3.3).

Three subcommands:
  thread add   append the operator's words verbatim to thread.md, then commit
  sweep        gather machine evidence from every project into sweep.json
  audit        render audits/<date>.md: one block per live direction, then drift

The data repo is $GOALKEEPER_HOME (default ~/.claude/goalkeeper). Every other repo is
read-only evidence, reached by absolute path from projects.json.
"""

import argparse
import datetime as dt
import json
import os
import re
import shlex
import shutil
import signal
import subprocess
import sys
import tempfile
import time

MINT = "/Users/misterislez/remote-system/deploy-keys/mint-github-token.sh"
US = "\x1f"  # git --format field separator; survives subjects containing | or tabs
FETCH_TIMEOUT = 60
SEAT_EMAIL = "goalkeeper@local"  # every commit this CLI makes; anything else is foreign
STATE_FILE = "sweep-state.json"  # what the seat itself last did; gitignored in the data repo

# Words too common to anchor a direction to a piece of activity.
STOPWORDS = {
    "that", "this", "with", "from", "have", "want", "need", "into", "your", "yours",
    "them", "they", "their", "there", "then", "than", "some", "more", "most", "just",
    "also", "when", "what", "which", "were", "will", "would", "should", "could",
    "about", "after", "before", "again", "other", "make", "made", "does", "done",
    "like", "very", "much", "must", "only", "over", "same", "such", "take", "today",
    "tomorrow", "week", "weekly", "daily", "monday", "tuesday", "wednesday",
    "thursday", "friday", "saturday", "sunday", "january", "february", "march",
    "april", "june", "july", "august", "september", "october", "november",
    "december",
}


# ---------------------------------------------------------------- environment

def home_dir():
    return os.path.abspath(
        os.environ.get("GOALKEEPER_HOME") or os.path.expanduser("~/.claude/goalkeeper")
    )


def sessions_dir():
    return os.environ.get("GOALKEEPER_SESSIONS_DIR") or os.path.expanduser("~/.claude/sessions")


def projects_dir():
    return os.environ.get("GOALKEEPER_PROJECTS_DIR") or os.path.expanduser("~/.claude/projects")


def mark_sh():
    return os.environ.get("GOALKEEPER_MARK_SH") or os.path.expanduser("~/.claude/session-kind/mark.sh")


def load_projects(home):
    """projects.json is a list, or {"projects": [...]}. Missing or broken → []."""
    try:
        with open(os.path.join(home, "projects.json"), encoding="utf-8") as fh:
            data = json.load(fh)
    except (OSError, ValueError):
        return []
    if isinstance(data, dict):
        data = data.get("projects", [])
    if not isinstance(data, list):
        return []
    return [p for p in data if isinstance(p, dict) and p.get("alias")]


# ---------------------------------------------------------------------- time

def parse_iso(text):
    """ISO8601 → aware datetime. 3.9's fromisoformat rejects a trailing Z, so strip it."""
    s = str(text).strip()
    if s.endswith("Z") or s.endswith("z"):
        s = s[:-1] + "+00:00"
    stamp = dt.datetime.fromisoformat(s)
    if stamp.tzinfo is None:
        stamp = stamp.replace(tzinfo=dt.timezone.utc)
    return stamp


def iso_z(stamp):
    return stamp.astimezone(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def now_z():
    return iso_z(dt.datetime.now(dt.timezone.utc))


# ----------------------------------------------------------------------- git

def run(cmd, cwd=None, timeout=60):
    """Return (ok, stdout). Never raises; a broken repo degrades to no evidence."""
    try:
        proc = subprocess.run(
            cmd, cwd=cwd, timeout=timeout, stdout=subprocess.PIPE,
            stderr=subprocess.PIPE, universal_newlines=True,
        )
    except (OSError, subprocess.SubprocessError):
        return False, ""
    return proc.returncode == 0, proc.stdout


def is_git_repo(path):
    return run(["git", "-C", path, "rev-parse", "--git-dir"])[0]


def commit_file(home, relpath, message):
    """Stage and commit one file in the data repo. Returns False if git refused."""
    if not is_git_repo(home):
        sys.stderr.write("warning: %s is not a git repo — wrote %s, did not commit\n"
                         % (home, relpath))
        return False
    if not run(["git", "-C", home, "add", "--", relpath])[0]:
        sys.stderr.write("warning: git add failed — %s is written but uncommitted\n" % relpath)
        return False
    if not run(["git", "-C", home, "-c", "user.name=goalkeeper",
                "-c", "user.email=" + SEAT_EMAIL, "commit", "-m", message])[0]:
        sys.stderr.write("warning: git commit failed — %s is written but uncommitted\n" % relpath)
        return False
    return True


def sweep_stale_askpass_dirs(tmpdir=None, max_age_seconds=3600):
    """Delete leftover `tmp.gh*` askpass helper dirs older than max_age_seconds.

    Every one of them may hold a live broker token in plaintext, left behind by a
    process that died before its own cleanup (the lane report found one from
    2026-09-05). Never raises: a failed sweep must not stop the fetch.
    """
    root = tmpdir or tempfile.gettempdir()
    cutoff = time.time() - max_age_seconds
    try:
        names = os.listdir(root)
    except OSError:
        return
    for name in names:
        if not name.startswith("tmp.gh"):
            continue
        path = os.path.join(root, name)
        try:
            if not os.path.isdir(path) or os.path.getmtime(path) > cutoff:
                continue
        except OSError:
            continue
        shutil.rmtree(path, ignore_errors=True)


def kill_process_group(proc, grace=3):
    """SIGTERM the child's whole process group, SIGKILL what survives, then reap.

    `start_new_session=True` gave the child its own group, so this also kills the
    git and mint processes it spawned. Never raises — the child may already be gone.
    """
    def signal_group(sig):
        try:
            os.killpg(os.getpgid(proc.pid), sig)
        except OSError:  # ProcessLookupError / PermissionError included
            pass

    signal_group(signal.SIGTERM)
    try:
        proc.communicate(timeout=grace)
        return
    except subprocess.TimeoutExpired:
        signal_group(signal.SIGKILL)
    try:
        proc.communicate(timeout=grace)
    except subprocess.TimeoutExpired:
        pass


def fetch(path):
    """git fetch --prune origin with a freshly minted broker token.

    The token is minted and consumed inside one /bin/sh, so it never reaches argv, a
    file, or our own output — with ONE exception the mint script forces on us:
    `--askpass` writes the live token in plaintext to a `$TMPDIR/tmp.ghXXXX/askpass.sh`
    helper and prints "delete after use". A sweep runs per project, so without the
    cleanup below every run would leave a readable token on disk. Two layers remove it:
    the in-shell trap deletes it the instant the fetch ends, and the child runs in a
    private TMPDIR that we rmtree in `finally` — which is the layer that matters on
    timeout, because a SIGKILLed shell cannot run its own trap.

    Any failure (missing script, no network, timeout, non-zero)
    is a STALE sweep, not an error: the caller falls back to local refs.
    """
    sweep_stale_askpass_dirs()
    quoted = shlex.quote(path)
    cmd = (
        # Delete the askpass helper dir however this shell exits — the file in it
        # holds the live token in plaintext.
        'trap \'[ -n "$GIT_ASKPASS" ] && rm -rf -- "$(dirname "$GIT_ASKPASS")"\' EXIT INT TERM; '
        # eval of an empty substitution succeeds, so a missing or broken mint script
        # would otherwise fall through to an unauthenticated fetch.
        'eval "$(%s --broker --askpass)" && [ -n "$GIT_ASKPASS" ] && '
        "git -C %s -c credential.helper= "
        "-c credential.helper='!f(){ echo username=x-access-token; echo \"password=$GH_TOKEN\"; }; f' "
        "fetch --prune origin"
    ) % (shlex.quote(MINT), quoted)

    # The child mints into a TMPDIR we own, so the helper dir is ours to delete.
    tmp_home = tempfile.mkdtemp(prefix="gk-fetch-")
    env = dict(os.environ)
    env["TMPDIR"] = tmp_home
    try:
        try:
            proc = subprocess.Popen(
                ["/bin/sh", "-c", cmd], env=env, start_new_session=True,
                stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                universal_newlines=True,
            )
        except OSError:
            return False
        try:
            proc.communicate(timeout=FETCH_TIMEOUT)
        except subprocess.TimeoutExpired:
            kill_process_group(proc)
            return False
        return proc.returncode == 0
    finally:
        shutil.rmtree(tmp_home, ignore_errors=True)


# ------------------------------------------------------------------ evidence

def collect_commits(path, since):
    ok, out = run([
        "git", "-C", path, "log", "--since=" + since, "--date=iso-strict",
        "--format=%H" + US + "%an" + US + "%aI" + US + "%s", "--remotes=origin",
    ])
    if not ok:
        return []
    rows = []
    for line in out.splitlines():
        parts = line.split(US)
        if len(parts) != 4:
            continue
        sha, author, date, subject = parts
        rows.append({"sha": sha, "author": author, "date": date,
                     "ref": refs_containing(path, sha), "subject": subject})
    return rows


def pick_ref(refs):
    """One short, informative ref for a commit — a busy repo has dozens per commit.

    Trunk beats everything (being on main is the interesting fact); otherwise the
    shortest name, which is usually the lane branch. ` +N` counts what was dropped.
    """
    names = [r for r in refs if r and r != "origin"]
    if not names:
        return ""
    trunk = sorted(r for r in names if r in ("origin/main", "origin/master"))
    chosen = trunk[0] if trunk else sorted(names, key=lambda r: (len(r), r))[0]
    rest = len(names) - 1
    return "%s +%d" % (chosen, rest) if rest else chosen


def refs_containing(path, sha):
    ok, out = run(["git", "-C", path, "for-each-ref", "--contains", sha,
                   "--format=%(refname:short)", "refs/remotes/origin"], timeout=30)
    if not ok:
        return ""
    return pick_ref(out.split())


def read_json(path):
    try:
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return None


def as_rows(value, id_key="id"):
    """A list of dicts, or a dict of id→dict. Anything else → []."""
    if isinstance(value, list):
        return [r for r in value if isinstance(r, dict)]
    if isinstance(value, dict):
        rows = []
        for key, row in value.items():
            if isinstance(row, dict):
                row = dict(row)
                row.setdefault(id_key, key)
                rows.append(row)
        return rows
    return []


def collect_board_lanes(path, rel):
    if not rel:
        return []
    data = read_json(os.path.join(path, rel))
    if not isinstance(data, dict):
        return []
    return [
        {"id": str(r.get("id", "")), "state": str(r.get("state", "")),
         "goal": str(r.get("goal", "")), "branch": str(r.get("branch", "")),
         "reported_at": str(r.get("reported_at", ""))}
        for r in as_rows(data.get("lanes"))
    ]


def collect_ledger_goals(path, rel):
    if not rel:
        return []
    data = read_json(os.path.join(path, rel))
    if not isinstance(data, dict):
        return []
    return [
        {"id": str(r.get("id", "")), "goal": str(r.get("goal", "")),
         "status": str(r.get("status", "")), "updated": str(r.get("updated", ""))}
        for r in as_rows(data.get("goals"))
    ]


def is_table_noise(cells):
    """Header (`| id | …`) and separator (`|---|---|`) rows are not decisions."""
    if not cells:
        return True
    if all(re.match(r"^:?-{2,}:?$", c) for c in cells if c):
        return True
    return cells[0].strip().lower() in ("id", "#", "")


def collect_decisions(path, rel, since):
    """Markdown table rows added to decisions-effective.md since <since>."""
    if not rel or not os.path.exists(os.path.join(path, rel)):
        return []
    ok, out = run(["git", "-C", path, "log", "--since=" + since,
                   "--format=%H" + US + "%aI", "--", rel])
    if not ok:
        return []
    rows = []
    for line in out.splitlines():
        parts = line.split(US)
        if len(parts) != 2:
            continue
        sha, date = parts
        ok2, diff = run(["git", "-C", path, "show", sha, "--", rel])
        if not ok2:
            continue
        for dline in diff.splitlines():
            if not dline.startswith("+|"):
                continue
            row = dline[1:]
            cells = [c.strip() for c in row.strip().strip("|").split("|")]
            if is_table_noise(cells):
                continue
            rows.append({"id": cells[0], "date": date, "text": row.rstrip()})
    return rows


# ------------------------------------------------------------------ sessions

def encode_cwd(cwd):
    """~/.claude/projects dir name: every / and . in the absolute path becomes -.

    Verified against a real listing: /Users/me/remote-system/.claude/worktrees/x →
    -Users-me-remote-system--claude-worktrees-x (note the leading -).
    """
    return cwd.replace("/", "-").replace(".", "-")


def pid_alive(pid):
    try:
        os.kill(int(pid), 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    except (OSError, TypeError, ValueError):
        return False
    return True


def read_marks():
    """cwd → badge, from `sh mark.sh --list`. Missing or broken mark.sh → {}."""
    script = mark_sh()
    if not os.path.exists(script):
        return {}
    ok, out = run(["sh", script, "--list"], timeout=30)
    if not ok:
        return {}
    marks = {}
    for line in out.splitlines():
        parts = line.split("\t")
        if len(parts) < 3:
            continue
        badge, cwd = parts[1].strip(), parts[2].strip()
        if cwd.endswith("[DEAD CWD]"):
            cwd = cwd[: -len("[DEAD CWD]")].strip()
        if cwd and badge:
            marks[cwd] = badge
    return marks


def live_sessions():
    """Every ~/.claude/sessions/*.json whose pid is still alive."""
    marks = read_marks()
    out = []
    try:
        names = sorted(os.listdir(sessions_dir()))
    except OSError:
        return out
    for name in names:
        if not name.endswith(".json"):
            continue
        data = read_json(os.path.join(sessions_dir(), name))
        if not isinstance(data, dict):
            continue
        cwd, sid = data.get("cwd"), data.get("sessionId")
        if not cwd or not sid or not pid_alive(data.get("pid")):
            continue
        title = str(data.get("name") or "")
        badge = marks.get(cwd)
        if badge:
            title = "%s · %s" % (badge, title) if title else badge
        out.append({
            "title": title, "cwd": cwd, "session_id": sid,
            "transcript": os.path.join(projects_dir(), encode_cwd(cwd), sid + ".jsonl"),
        })
    return out


def under(cwd, path):
    cwd, path = os.path.abspath(cwd), os.path.abspath(path)
    return cwd == path or cwd.startswith(path.rstrip(os.sep) + os.sep)


# ------------------------------------------------------------ operator turns

# Harness text that arrives as a plain string `user` row and therefore passes §3.3's
# type/content test, but that the operator never typed. The tag pattern matches by
# family, so a new suffix (-caveat, -stdout, -stderr) is caught without a code change.
# Anchored to the exact harness tag names. `<command-` alone also swallowed an
# operator turn opening with the literal text `<command-line ...>`, which is a
# thing a person types; losing a real operator turn is the one error this filter
# must not make, because a turn is what stops activity being called OFF THREAD.
INJECTED_TAG = re.compile(
    r"^<\s*(?:"
    r"command-message|command-name|command-args|command-contents"
    r"|local-command-[a-z]+"
    r"|task-notification"
    r"|system-reminder"
    r"|cross-session-message"
    r")\b")
# Not tag-shaped, so they need their own prefixes.
INJECTED_PREFIXES = (
    "This session is being continued from a previous conversation",
    "Caveat: The messages below were generated by the user while running local commands",
)


def is_injected(text):
    """True when a row is harness output rather than operator prose."""
    if not isinstance(text, str):
        return False
    head = text.lstrip()
    return bool(INJECTED_TAG.match(head)) or head.startswith(INJECTED_PREFIXES)


def is_operator_turn(row):
    """PLAN §3.3 as amended by PLAN §9: `type == "user"`, `message.content` is a string,
    contains neither `<cross-session-message` nor `<command-message>`, and does not open
    with a harness tag (cross-session, command, local-command, task-notification,
    system-reminder) or a context-continuation preamble.

    Anything else — a tool result (list content), a peer frame, a slash-command
    expansion, a malformed row — is not the operator speaking. §9 makes the harness
    exclusion the default, not an opt-in: measured on real data it takes 127 rows to 51.
    """
    if not isinstance(row, dict) or row.get("type") != "user":
        return False
    message = row.get("message")
    if not isinstance(message, dict):
        return False
    content = message.get("content")
    if not isinstance(content, str):
        return False
    if "<cross-session-message" in content or "<command-message>" in content:
        return False
    return not is_injected(content)


def iter_transcript(path):
    """Stream a .jsonl transcript. These files are large — never read one whole."""
    try:
        with open(path, encoding="utf-8", errors="replace") as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                try:
                    row = json.loads(line)
                except ValueError:
                    continue
                if isinstance(row, dict):
                    yield row
    except OSError:
        return


def collect_operator_turns(session, since):
    rows = []
    for row in iter_transcript(session["transcript"]):
        if not is_operator_turn(row):
            continue
        ts = row.get("timestamp") or ""
        if ts and since:
            try:
                if parse_iso(ts) < parse_iso(since):
                    continue
            except ValueError:
                pass
        rows.append({"session_id": session["session_id"], "ts": ts,
                     "text": row["message"]["content"]})
    return rows


def content_text(content):
    """A row's content as text: a plain string, or the text of its blocks."""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for block in content:
            if isinstance(block, str):
                parts.append(block)
            elif isinstance(block, dict):
                for key in ("text", "content"):
                    value = block.get(key)
                    if isinstance(value, str):
                        parts.append(value)
        return "\n".join(parts)
    return ""


def collect_inbound(sessions, home):
    """Peer frames written into the goalkeeper's own transcript — drift, never orders."""
    rows = []
    for session in sessions:
        if not under(session["cwd"], home):
            continue
        for row in iter_transcript(session["transcript"]):
            message = row.get("message")
            text = content_text(message.get("content") if isinstance(message, dict) else None)
            if "<cross-session-message" not in text:
                continue
            match = re.search(r"<cross-session-message[^>]*?\bfrom=\"([^\"]*)\"", text)
            rows.append({"ts": row.get("timestamp") or "", "from": match.group(1) if match else "",
                         "text": text[:2000]})
    return rows


# ------------------------------------------------------------------ thread.md

ENTRY_RE = re.compile(
    r"^### (T-(\d{4}-\d{2}-\d{2})-\d+) · (\S+) (\d{4}-\d{2}-\d{2}) · (day|week) · (.+)$"
)


def parse_thread(home):
    try:
        with open(os.path.join(home, "thread.md"), encoding="utf-8") as fh:
            lines = fh.read().split("\n")
    except OSError:
        return []
    entries, current = [], None
    for line in lines:
        match = ENTRY_RE.match(line)
        if match:
            current = {"id": match.group(1), "date": match.group(4), "dow": match.group(3),
                       "horizon": match.group(5), "project": match.group(6).strip(),
                       "lines": []}
            entries.append(current)
        elif current is not None:
            current["lines"].append(line)
    for entry in entries:
        entry["text"] = "\n".join(entry.pop("lines")).strip("\n")
    return entries


def cmd_thread_add(args, home):
    projects = load_projects(home)
    aliases = [p["alias"] for p in projects]
    if args.project != "all" and args.project not in aliases:
        sys.stderr.write("error: unknown --project %r. Valid: %s\n"
                         % (args.project, ", ".join(aliases + ["all"]) if aliases else "all"))
        return 2

    path = os.path.join(home, "thread.md")
    today = dt.date.today()
    date = today.strftime("%Y-%m-%d")
    n = sum(1 for e in parse_thread(home) if e["date"] == date) + 1
    entry_id = "T-%s-%d" % (date, n)

    text = args.text
    if text.endswith("\n"):
        text = text[:-1]
    block = "### %s · %s · %s · %s\n\n%s\n" % (
        entry_id, today.strftime("%a %Y-%m-%d"), args.horizon, args.project, text)

    try:
        with open(path, encoding="utf-8") as fh:
            existing = fh.read()
    except OSError:
        existing = ""
    os.makedirs(home, exist_ok=True)
    with open(path, "a", encoding="utf-8") as fh:
        if existing and not existing.endswith("\n"):
            fh.write("\n")
        if existing:
            fh.write("\n")
        fh.write(block)

    commit_file(home, "thread.md",
                "thread: %s · %s · %s" % (entry_id, args.horizon, args.project))
    print(entry_id)
    return 0


# ---------------------------------------------------------- tamper detection

TAMPER_CHECKS = ("uncommitted", "foreign_commit", "mtime_after_commit")


def to_z(text):
    """git's %aI carries a local offset; every tamper timestamp is recorded in Z."""
    try:
        return iso_z(parse_iso(text))
    except ValueError:
        return text


def mtime_z(path):
    try:
        return iso_z(dt.datetime.fromtimestamp(os.path.getmtime(path), dt.timezone.utc))
    except OSError:
        return ""


def check_uncommitted(home, written):
    """(paths git reports, entries). One entry per `git status --porcelain` line."""
    ok, out = run(["git", "-C", home, "status", "--porcelain"])
    if not ok:
        return set(), [{"kind": "check_failed", "check": "uncommitted",
                        "why": "git status failed in %s" % home}]
    paths, entries = set(), []
    for line in out.splitlines():
        if len(line) < 4:
            continue
        status, path = line[:2], line[3:].strip()
        paths.add(path)
        if path in written:
            continue
        entries.append({"kind": "uncommitted", "path": path, "status": status,
                        "mtime": mtime_z(os.path.join(home, path))})
    return paths, entries


def check_foreign_commits(home, baseline):
    """Commits since the baseline whose author is not this seat.

    No baseline, or one this repo has never heard of (fresh repo, rewritten history), is
    reported once as `no_baseline` — never as "every commit is foreign".
    """
    if not baseline or not run(["git", "-C", home, "cat-file", "-e",
                                "%s^{commit}" % baseline])[0]:
        return [{"kind": "no_baseline",
                 "what": "no %s baseline — everything committed before now is unverified"
                         % STATE_FILE}]
    ok, out = run(["git", "-C", home, "log", "%s..HEAD" % baseline, "--date=iso-strict",
                   "--format=%H" + US + "%ae" + US + "%aI" + US + "%s"])
    if not ok:
        return [{"kind": "check_failed", "check": "foreign_commit",
                 "why": "git log %s..HEAD failed in %s" % (baseline, home)}]
    entries = []
    for line in out.splitlines():
        parts = line.split(US)
        if len(parts) != 4 or parts[1] == SEAT_EMAIL:
            continue
        entries.append({"kind": "foreign_commit", "sha": parts[0], "author": parts[1],
                        "date": to_z(parts[2]), "subject": parts[3]})
    return entries


def check_mtimes(home, skip):
    """Files touched after the last commit — the shape a `git commit --amend`-free edit,
    a restored backup or an editor write leaves behind even when the tree hashes clean."""
    ok, out = run(["git", "-C", home, "log", "-1", "--format=%H" + US + "%cI"])
    parts = out.strip().split(US)
    if not ok or len(parts) != 2:
        return [{"kind": "check_failed", "check": "mtime_after_commit",
                 "why": "no commit in %s to compare mtimes against" % home}]
    sha, committed = parts
    try:
        cutoff = parse_iso(committed)
    except ValueError:
        return [{"kind": "check_failed", "check": "mtime_after_commit",
                 "why": "unreadable commit date %r in %s" % (committed, home)}]
    entries = []
    for parent, dirs, files in os.walk(home):
        if ".git" in dirs:
            dirs.remove(".git")
        for name in files:
            path = os.path.join(parent, name)
            rel = os.path.relpath(path, home)
            if rel in skip:
                continue
            try:
                # whole seconds: git records the commit second, so a file written
                # 0.3s before its own commit must not read as newer than it
                stamp = int(os.path.getmtime(path))
            except OSError:
                continue
            if stamp > cutoff.timestamp():
                entries.append({"kind": "mtime_after_commit", "path": rel,
                                "mtime": mtime_z(path), "last_commit": sha,
                                "last_commit_at": iso_z(cutoff)})
    return sorted(entries, key=lambda e: e["path"])


def detect_tamper(home):
    """What changed in the data repo that this seat did not do (lane GK-M.4 item 2).

    Three checks, all run before the sweep writes anything:
      (a) `uncommitted`        — `git status --porcelain` is not empty
      (b) `foreign_commit`     — a commit since sweep-state.json's last_clean_sha whose
                                 author email is not goalkeeper@local
      (c) `mtime_after_commit` — a file newer than the last commit that (a) did not report

    The previous run's `written` list is excluded from (a) and (c): those paths are the
    seat's own output — sweep.json is untracked by design — so without the exclusion every
    run would report its own last run as tampering.

    A check that cannot run yields a `check_failed` entry, never silence: silence must
    never be mistaken for cleanliness.
    """
    state = read_json(os.path.join(home, STATE_FILE))
    if not isinstance(state, dict):
        state = {}
    written = {w for w in (state.get("written") or []) if isinstance(w, str)}

    if not is_git_repo(home):
        return [{"kind": "check_failed", "check": check,
                 "why": "%s is not a git repo" % home} for check in TAMPER_CHECKS]

    dirty, entries = check_uncommitted(home, written)
    entries += check_foreign_commits(home, state.get("last_clean_sha"))
    return entries + check_mtimes(home, written | dirty)


def ensure_gitignore(home):
    """Keep sweep-state.json out of the data repo's history. True when the file changed."""
    path = os.path.join(home, ".gitignore")
    try:
        with open(path, encoding="utf-8") as fh:
            body = fh.read()
    except OSError:
        body = ""
    if STATE_FILE in [line.strip() for line in body.splitlines()]:
        return False
    with open(path, "a", encoding="utf-8") as fh:
        if body and not body.endswith("\n"):
            fh.write("\n")
        fh.write(STATE_FILE + "\n")
    return True


def write_sweep_state(home, written, tamper):
    """Record what this seat just did, so the next run can tell its writes from anyone's.

        {"last_clean_sha": "<sha of the last commit this seat made>",
         "last_sweep_at": "<ISO8601 Z>",
         "written": ["sweep.json", "sweep-state.json", ...]}

    A run that found a foreign commit does not advance last_clean_sha: HEAD is not this
    seat's commit, and the audit's TAMPER line names that sha as the last one the operator
    can trust. Every other outcome advances it — including the first run, which has no
    baseline to keep.
    """
    previous = read_json(os.path.join(home, STATE_FILE))
    sha = str(previous.get("last_clean_sha") or "") if isinstance(previous, dict) else ""
    if not any(e.get("kind") == "foreign_commit" for e in tamper):
        ok, out = run(["git", "-C", home, "rev-parse", "HEAD"])
        if ok:
            sha = out.strip()
    state = {"last_clean_sha": sha, "last_sweep_at": now_z(), "written": sorted(written)}
    with open(os.path.join(home, STATE_FILE), "w", encoding="utf-8") as fh:
        json.dump(state, fh, indent=2, ensure_ascii=False)
        fh.write("\n")


# --------------------------------------------------------------------- sweep

def cmd_sweep(args, home):
    since = iso_z(parse_iso(args.since))
    tamper = detect_tamper(home)  # before this sweep writes anything of its own
    sessions = live_sessions()
    out = {"swept_at": now_z(), "since": since, "projects": [],
           "inbound_peer_msgs": collect_inbound(sessions, home), "tamper": tamper}

    for project in load_projects(home):
        path = os.path.abspath(os.path.expanduser(project.get("path", "")))
        fetched_at = None
        if not args.no_fetch and fetch(path):
            fetched_at = now_z()
        mine = [s for s in sessions if under(s["cwd"], path)]
        turns = []
        for session in mine:
            turns.extend(collect_operator_turns(session, since))
        out["projects"].append({
            "alias": project["alias"], "path": path, "fetched_at": fetched_at,
            "commits": collect_commits(path, since),
            "board_lanes": collect_board_lanes(path, project.get("board")),
            "decisions": collect_decisions(path, project.get("decisions"), since),
            "ledger_goals": collect_ledger_goals(path, project.get("ledger")),
            "sessions": mine,
            "operator_turns": turns,
        })

    target = os.path.join(home, "sweep.json")
    os.makedirs(home, exist_ok=True)
    with open(target, "w", encoding="utf-8") as fh:
        json.dump(out, fh, indent=2, ensure_ascii=False)
        fh.write("\n")

    written = ["sweep.json", STATE_FILE]
    if ensure_gitignore(home):
        written.append(".gitignore")
        commit_file(home, ".gitignore", "sweep: gitignore %s" % STATE_FILE)
    write_sweep_state(home, written, tamper)

    parts = ["sweep → sweep.json"]
    total = 0
    for p in out["projects"]:
        total += len(p["commits"])
        parts.append("%s: %d commits, %d lanes, %d decisions, %d sessions, %d operator turns (%s)"
                     % (p["alias"], len(p["commits"]), len(p["board_lanes"]), len(p["decisions"]),
                        len(p["sessions"]), len(p["operator_turns"]),
                        "fetched" if p["fetched_at"] else "STALE"))
    parts.append("total: %d commits, %d inbound peer msgs" % (total, len(out["inbound_peer_msgs"])))
    if tamper:
        parts.append("⚠ TAMPER: %d" % len(tamper))
    print("  |  ".join(parts))
    return 0


# --------------------------------------------------------------------- audit

def keywords(text):
    return {w for w in re.findall(r"[a-z0-9]+", text.lower())
            if len(w) >= 4 and w not in STOPWORDS}


def keyword_hits(direction, row_text, alias=None):
    """How many distinct direction keywords the row hits — 0 when it does not belong
    to the direction at all. The count ranks evidence: more keywords, stronger signal."""
    if alias is not None and direction.get("project") != "all" and direction.get("project") != alias:
        return 0
    low = (row_text or "").lower()
    return sum(1 for word in keywords(direction.get("text", "")) if word in low)


def matches(direction, row_text, alias=None):
    """An evidence row belongs to a direction when the project matches (or the direction
    is `all`) and at least one of the direction's keywords appears in the row."""
    return keyword_hits(direction, row_text, alias) > 0


def is_live(entry, date):
    if entry["horizon"] == "day":
        return entry["date"] == date.strftime("%Y-%m-%d")
    try:
        entry_date = dt.date(*[int(x) for x in entry["date"].split("-")])
    except ValueError:
        return False
    return entry_date.isocalendar()[:2] == date.isocalendar()[:2]


CELL_MAX = 160


def cell(text):
    """One markdown table cell: single line, pipe-safe, never longer than CELL_MAX.

    A multi-line or pipe-carrying commit subject would otherwise break the table.
    """
    out = str(text).replace("\r", " ").replace("\n", " ").strip()
    if len(out) > CELL_MAX:
        out = out[:CELL_MAX] + "…"
    return out.replace("|", "\\|")


def evidence_rows(sweep):
    """(kind, alias, text-to-match, ref, what-it-says, date) for every piece of activity."""
    rows = []
    for p in sweep.get("projects", []):
        alias = p.get("alias", "")
        for c in p.get("commits", []):
            rows.append(("commit", alias, c.get("subject", ""),
                         "`%s` %s %s" % (c.get("sha", "")[:7], c.get("ref", ""), c.get("date", "")),
                         c.get("subject", ""), c.get("date", "")))
        for lane in p.get("board_lanes", []):
            rows.append(("board lane", alias, "%s %s" % (lane.get("goal", ""), lane.get("branch", "")),
                         "lane `%s` %s" % (lane.get("id", ""), lane.get("reported_at", "")),
                         "%s — %s" % (lane.get("state", ""), lane.get("goal", "")),
                         lane.get("reported_at", "")))
        for d in p.get("decisions", []):
            rows.append(("decision", alias, d.get("text", ""),
                         "`%s` %s" % (d.get("id", ""), d.get("date", "")), d.get("text", ""),
                         d.get("date", "")))
        for g in p.get("ledger_goals", []):
            rows.append(("ledger goal", alias, g.get("goal", ""),
                         "`%s` %s" % (g.get("id", ""), g.get("updated", "")),
                         "%s — %s" % (g.get("status", ""), g.get("goal", "")),
                         g.get("updated", "")))
        for t in p.get("operator_turns", []):
            rows.append(("operator turn", alias, t.get("text", ""),
                         "session `%s` %s" % (t.get("session_id", ""), t.get("ts", "")),
                         t.get("text", "")[:300], t.get("ts", "")))
    return rows


TAMPER_LINE = ("someone other than this seat changed the goalkeeper's records — treat the "
               "thread and audits since %s as unverified until the operator confirms them")
NO_BASELINE = "the last verified commit (baseline missing)"


def tamper_what(entry):
    kind = entry.get("kind", "")
    if kind == "uncommitted":
        return "uncommitted change to `%s`" % entry.get("path", "")
    if kind == "foreign_commit":
        return "commit by `%s`" % entry.get("author", "")
    if kind == "mtime_after_commit":
        return "`%s` written after the last commit" % entry.get("path", "")
    if kind == "check_failed":
        return "check `%s` could not run" % entry.get("check", "")
    return entry.get("what") or kind


def tamper_locator(entry):
    kind = entry.get("kind", "")
    if kind == "uncommitted":
        return "`%s %s`, mtime %s" % (entry.get("status", ""), entry.get("path", ""),
                                      entry.get("mtime", ""))
    if kind == "foreign_commit":
        return "`%s` %s — \"%s\"" % (entry.get("sha", "")[:7], entry.get("date", ""),
                                     entry.get("subject", ""))
    if kind == "mtime_after_commit":
        return "mtime %s, last commit `%s` %s" % (entry.get("mtime", ""),
                                                  entry.get("last_commit", "")[:7],
                                                  entry.get("last_commit_at", ""))
    if kind == "check_failed":
        return entry.get("why", "")
    return "—"


def tamper_block(home, tamper):
    """The block `audit` opens with. Its sentence is the operator's, verbatim."""
    state = read_json(os.path.join(home, STATE_FILE))
    sha = str(state.get("last_clean_sha") or "") if isinstance(state, dict) else ""
    rows = ["| %s | %s |" % (cell(tamper_what(e)), cell(tamper_locator(e)))
            for e in tamper if isinstance(e, dict)]
    return (["## ⚠ TAMPER", "", TAMPER_LINE % (sha[:7] if sha else NO_BASELINE), "",
             "| what | locator |", "|---|---|"] + rows + [""])


def cmd_audit(args, home):
    sweep = read_json(os.path.join(home, "sweep.json"))
    if not isinstance(sweep, dict):
        sys.stderr.write("error: no readable %s — run `goalkeeper.py sweep --since <ISO8601>` first\n"
                         % os.path.join(home, "sweep.json"))
        return 2

    if args.date:
        date = dt.date(*[int(x) for x in args.date.split("-")])
    else:
        date = dt.date.today()
    stamp = date.strftime("%Y-%m-%d")

    cap = max(0, args.max_rows)  # 0 = no cap; the note must stay skimmable by default
    live = [e for e in parse_thread(home) if is_live(e, date)]
    rows = evidence_rows(sweep)
    matched = set()

    lines = ["# Audit %s" % stamp, ""]
    tamper = sweep.get("tamper")
    tamper = tamper if isinstance(tamper, list) else []
    if tamper:  # before the metadata line and before any direction — nobody reads past it
        lines += tamper_block(home, tamper)
    fetch_notes = ["%s %s" % (p.get("alias", ""),
                              p.get("fetched_at") or "null STALE")
                   for p in sweep.get("projects", [])]
    lines.append("swept_at `%s` · since `%s` · fetched_at: %s"
                 % (sweep.get("swept_at", ""), sweep.get("since", ""),
                    "; ".join(fetch_notes) if fetch_notes else "no projects"))
    lines.append("")

    if not live:
        lines += ["_No live direction for %s. Nothing on the thread to audit._" % stamp, ""]

    for entry in live:
        lines += ["## %s · %s · %s" % (entry["id"], entry["horizon"], entry["project"]), ""]
        for text_line in entry["text"].split("\n"):
            lines.append("> " + text_line)
        lines += ["", "**Verdict:** _(ON THREAD / NO ACTIVITY / OFF THREAD / RE-SCOPED — the seat fills this in)_", ""]
        lines += ["| evidence | ref | what it says |", "|---|---|---|"]
        # strongest signal first: most direction keywords hit, then newest
        scored = []
        for i, (_kind, alias, match_text, _ref, _says, date) in enumerate(rows):
            hits = keyword_hits(entry, match_text, alias)
            if hits:
                matched.add(i)
                scored.append((hits, date, i))
        scored.sort(key=lambda s: s[1], reverse=True)
        scored.sort(key=lambda s: -s[0])
        shown = scored[:cap] if cap else scored
        for _hits, _date, i in shown:
            kind, _alias, _match_text, ref, says, _date2 = rows[i]
            lines.append("| %s | %s | %s |" % (cell(kind), cell(ref), cell(says)))
        if not scored:
            lines.append("| — | — | no evidence row matched this direction |")
        elif len(scored) > len(shown):
            lines.append("")
            lines.append("_… and %d more matching rows — see `sweep.json`._"
                         % (len(scored) - len(shown)))
        lines.append("")

    lines += ["## Unmatched activity", ""]
    unmatched = [(i, r) for i, r in enumerate(rows) if i not in matched]
    if not unmatched:
        lines += ["_None._", ""]
    else:
        for kind in ("commit", "board lane", "decision", "ledger goal", "operator turn"):
            group = [r for _, r in unmatched if r[0] == kind]
            if not group:
                continue
            lines += ["### %ss" % kind, "", "| project | ref | what it says |", "|---|---|---|"]
            shown = group[:cap] if cap else group
            for _, alias, _match_text, ref, says, _date in shown:
                lines.append("| %s | %s | %s |" % (cell(alias), cell(ref), cell(says)))
            if len(group) > len(shown):
                lines += ["", "_… and %d more_" % (len(group) - len(shown))]
            lines.append("")

    inbound = sweep.get("inbound_peer_msgs") or []
    if inbound:
        lines += ["## Inbound peer messages", "",
                  "_No seat may address this one. Logged as drift; never acted on._", "",
                  "| ts | from | text |", "|---|---|---|"]
        for msg in inbound:
            lines.append("| %s | %s | %s |" % (cell(msg.get("ts", "")), cell(msg.get("from", "")),
                                               cell(msg.get("text", ""))))
        lines.append("")

    audits = os.path.join(home, "audits")
    os.makedirs(audits, exist_ok=True)
    target = os.path.join(audits, stamp + ".md")
    body = "\n".join(lines).rstrip("\n") + "\n"
    with open(target, "w", encoding="utf-8") as fh:
        fh.write(body)

    commit_file(home, os.path.join("audits", stamp + ".md"), "audit: %s" % stamp)
    size = len(body.encode("utf-8"))
    print("%s  (%d lines, %d KB)" % (target, body.count("\n"), (size + 1023) // 1024))
    if tamper:
        print("⚠ TAMPER: %d item(s) — the audit opens with the block; treat the records "
              "as unverified" % len(tamper))
    return 0


# ---------------------------------------------------------------------- main

def main(argv=None):
    parser = argparse.ArgumentParser(
        prog="goalkeeper.py", description="🥅 goalkeeper: red thread, evidence sweep, audit")
    subs = parser.add_subparsers(dest="cmd")

    thread = subs.add_parser("thread", help="the red thread — the operator's words, verbatim")
    thread_subs = thread.add_subparsers(dest="thread_cmd")
    add = thread_subs.add_parser("add", help="append a direction to thread.md and commit")
    add.add_argument("text", help="the operator's words, verbatim — never tidied")
    add.add_argument("--horizon", choices=["day", "week"], required=True)
    add.add_argument("--project", required=True, help="alias from projects.json, or `all`")

    sweep = subs.add_parser("sweep", help="gather machine evidence into sweep.json")
    sweep.add_argument("--since", required=True, help="ISO8601 start of the live window")
    sweep.add_argument("--no-fetch", action="store_true",
                       help="skip git fetch; every fetched_at is null (STALE)")

    audit = subs.add_parser("audit", help="render audits/<date>.md from sweep.json + thread.md")
    audit.add_argument("--date", help="YYYY-MM-DD (default: today)")
    audit.add_argument("--max-rows", type=int, default=25,
                       help="rows per table before `… and N more` (0 = no cap)")

    args = parser.parse_args(argv)
    home = home_dir()

    if args.cmd == "thread":
        if args.thread_cmd != "add":
            thread.print_help()
            return 2
        return cmd_thread_add(args, home)
    if args.cmd == "sweep":
        return cmd_sweep(args, home)
    if args.cmd == "audit":
        return cmd_audit(args, home)
    parser.print_help()
    return 2


if __name__ == "__main__":
    sys.exit(main())
