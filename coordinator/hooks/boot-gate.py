#!/usr/bin/env python3
"""PreToolUse boot-read gate for coordinator orchestrator seats.

DESIGN-v1 §9.2 (operator ruling, verbatim): "**Boot-read gate: HARD.** PreToolUse-style hook
denies orchestrator-seat work until the seat has read `board.json` and restated lane ownership.
Advisory gates are proven failures (Class C/E)."

Reads a Claude Code hook payload on stdin and denies tool calls until the seat's ack marker
exists at <repo>/coordinator/.seat-ack/<seat-id>.

While the gate is closed the seat may: use the read-only tools, and Write/Edit into
coordinator/inbox/. Nothing else — no Bash at all. The gate allows by TARGET, never by command
shape: deciding that a shell command does not write is not reliably decidable, and every attempt
lost to a new flag (`git log --output=<marker>` forged an ack in one command).

This ships DISARMED: the gate only activates when COORDINATOR_SEAT_KIND == "orchestrator".
See README.md. Self-test: python3 boot-gate.py --selftest
"""

import contextlib
import io
import json
import os
import re
import shutil
import sys
import tempfile

# Task is deliberately absent: a subagent's own tool calls may not re-enter this hook, so a
# gated seat could spawn one and do anything. A seat needs no subagents before it has restated.
READ_ONLY_TOOLS = ("Read", "Glob", "Grep", "NotebookRead", "TodoWrite", "WebFetch",
                   "WebSearch", "ListMcpResources", "ReadMcpResource")

# The only writes a gated seat needs: the restatement sitrep into coordinator/inbox/.
WRITE_TOOLS = ("Write", "Edit")
PATH_KEYS = ("file_path", "path", "notebook_path")

# A seat id names a file under .seat-ack/, so it stays plain. The leading-alphanumeric anchor also
# rejects '.' and '..', which would otherwise name existing directories and fake an ack.
SEAT_ID_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,63}")

MAX_WALK_UP = 6


def valid_seat_id(seat_id):
    return bool(SEAT_ID_RE.fullmatch(seat_id))


def find_repo_root(start):
    """Walk up from start looking for a coordinator/ dir. Return its parent, or None."""
    current = os.path.abspath(start)
    for _ in range(MAX_WALK_UP + 1):
        if os.path.isdir(os.path.join(current, "coordinator")):
            return current
        parent = os.path.dirname(current)
        if parent == current:
            break
        current = parent
    return None


def marker_path(repo_root, seat_id):
    return os.path.join(repo_root, "coordinator", ".seat-ack", seat_id)


def target_path(tool_input):
    for key in PATH_KEYS:
        value = (tool_input or {}).get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


def contains(parent, child):
    """True when child resolves to parent or below it.

    realpath() both sides first: that is the point of this check. It collapses `..` and follows
    symlinks, so coordinator/inbox/../../server.js and a symlink pointing out of the inbox both
    fail containment instead of passing a string-prefix test.
    """
    real_parent, real_child = os.path.realpath(parent), os.path.realpath(child)
    try:
        return os.path.commonpath([real_parent, real_child]) == real_parent
    except ValueError:  # different drives, or a mix of absolute and relative
        return False


def is_inbox_write(payload, repo_root):
    """True when this Write/Edit targets a path inside coordinator/inbox/."""
    raw = target_path(payload.get("tool_input"))
    if not raw:
        return False  # a write with no recognizable path is never allowed
    base = payload.get("cwd") or repo_root
    candidate = raw if os.path.isabs(raw) else os.path.join(base, raw)

    # Redundant with the inbox test below, asserted anyway so no future edit can let a seat write
    # its own ack marker.
    if contains(os.path.join(repo_root, "coordinator", ".seat-ack"), candidate):
        return False
    return contains(os.path.join(repo_root, "coordinator", "inbox"), candidate)


def unblock_hint(marker):
    return ("Read coordinator/board.json with Read, then post a lane-ownership restatement sitrep "
            "with Write into coordinator/inbox/ naming every lane you own. The coordinator-run or "
            "coordinator-portal skill then writes the marker %s — never write it yourself." % marker)


def decide(payload, env, repo_root):
    """Pure decision. Returns (allow, reason). Every inactive path allows."""
    if (env.get("COORDINATOR_SEAT_KIND") or "").strip().lower() != "orchestrator":
        return True, "gate inactive: COORDINATOR_SEAT_KIND is not 'orchestrator'"

    if not repo_root:
        return True, "gate inactive: no coordinator/ dir above the working directory"

    seat_id = (env.get("COORDINATOR_SEAT") or env.get("CLAUDE_SESSION_ID") or "").strip()

    # isfile(), not exists(): a directory must never satisfy the marker.
    if valid_seat_id(seat_id) and os.path.isfile(marker_path(repo_root, seat_id)):
        return True, "seat %s acknowledged the board" % seat_id

    # --- the gate is closed from here ---
    payload = payload if isinstance(payload, dict) else {}
    tool_name = payload.get("tool_name")
    if not tool_name:
        # An unreadable payload names no tool, so the gate cannot tell a read from a write. Allow:
        # denying here would also deny Read and trap the seat with no way to clear the gate.
        return True, "gate inactive: payload names no tool"

    if tool_name in READ_ONLY_TOOLS:
        return True, "read-only tool allowed so the seat can read the board"

    # An armed gate with no usable seat id has no marker path, so it can never open. Deny rather
    # than allow — the operator armed this ruling on purpose. Only the operator can fix it.
    if not seat_id:
        return False, (
            "Boot-read gate (DESIGN-v1 §9.2, HARD): the gate is armed but neither COORDINATOR_SEAT "
            "nor CLAUDE_SESSION_ID names a seat, so there is no marker path and the gate can never "
            "open. Set COORDINATOR_SEAT to a plain seat id, or unset COORDINATOR_SEAT_KIND to "
            "disarm the gate.")
    if not valid_seat_id(seat_id):
        return False, (
            "Boot-read gate (DESIGN-v1 §9.2, HARD): seat id %r is unusable — it must match "
            "[A-Za-z0-9][A-Za-z0-9._-]{0,63}. Set COORDINATOR_SEAT to a plain seat id, or unset "
            "COORDINATOR_SEAT_KIND to disarm the gate." % seat_id)

    marker = marker_path(repo_root, seat_id)

    if tool_name in WRITE_TOOLS:
        # This handler fails CLOSED. A target that cannot be resolved — an embedded NUL byte, a
        # symlink loop, an overlong component, a non-string cwd — is a policy question, not a bug,
        # so it denies here. It must never reach main()'s fail-open catch-all, which would turn an
        # unresolvable path into an allow.
        try:
            allowed = is_inbox_write(payload, repo_root)
        except Exception:  # noqa: BLE001 - any resolution failure is a deny
            return False, (
                "Boot-read gate (DESIGN-v1 §9.2, HARD): seat '%s' has not acknowledged the board, "
                "and this %s target could not be resolved safely, so it is denied. %s"
                % (seat_id, tool_name, unblock_hint(marker)))
        if allowed:
            return True, "write into coordinator/inbox/ allowed so the seat can post its restatement"

    if tool_name == "Bash":
        return False, (
            "Boot-read gate (DESIGN-v1 §9.2, HARD): seat '%s' has not acknowledged the board, so "
            "Bash is denied outright — no shell runs while the gate is closed, because deciding "
            "that a command does not write is not reliably decidable. %s Bash returns once the "
            "marker exists." % (seat_id, unblock_hint(marker)))

    if tool_name == "Task":
        return False, (
            "Boot-read gate (DESIGN-v1 §9.2, HARD): seat '%s' has not acknowledged the board, so "
            "Task is denied — a subagent's own tool calls may not re-enter this hook, so spawning "
            "one would bypass the gate entirely. %s" % (seat_id, unblock_hint(marker)))

    if tool_name in WRITE_TOOLS:
        return False, (
            "Boot-read gate (DESIGN-v1 §9.2, HARD): seat '%s' has not acknowledged the board, so %s "
            "is allowed only into coordinator/inbox/ and this target is outside it (the .seat-ack "
            "marker is never writable by the seat). %s" % (seat_id, tool_name, unblock_hint(marker)))

    return False, (
        "Boot-read gate (DESIGN-v1 §9.2, HARD): seat '%s' has not acknowledged the board, so %s is "
        "denied. %s" % (seat_id, tool_name, unblock_hint(marker)))


def run_hook():
    raw = sys.stdin.read() if not sys.stdin.isatty() else ""
    try:
        payload = json.loads(raw) if raw.strip() else {}
    except ValueError:
        print("boot-gate: stdin was not valid JSON — allowing", file=sys.stderr)
        payload = {}
    if not isinstance(payload, dict):
        payload = {}

    repo_root = os.environ.get("COORDINATOR_REPO") or ""
    if repo_root and not os.path.isdir(os.path.join(repo_root, "coordinator")):
        repo_root = ""
    if not repo_root:
        repo_root = find_repo_root(payload.get("cwd") or os.getcwd())

    allow, reason = decide(payload, os.environ, repo_root)
    if not allow:
        json.dump({"hookSpecificOutput": {"hookEventName": "PreToolUse",
                                          "permissionDecision": "deny",
                                          "permissionDecisionReason": reason}}, sys.stdout)
        sys.stdout.write("\n")
    return 0


def call_hook(raw, env):
    """Drive the real entry point end-to-end. Returns (exit_code, stdout)."""
    saved_env, saved_stdin = dict(os.environ), sys.stdin
    out, err = io.StringIO(), io.StringIO()
    try:
        for key in list(os.environ):
            if key.startswith("COORDINATOR_") or key == "CLAUDE_SESSION_ID":
                del os.environ[key]
        os.environ.update(env)
        sys.stdin = io.StringIO(raw)
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = run_hook()
    finally:
        sys.stdin = saved_stdin
        os.environ.clear()
        os.environ.update(saved_env)
    return code, out.getvalue()


class SelftestFailure(Exception):
    pass


def check(condition, detail):
    if not condition:
        raise SelftestFailure(detail)


ENV = {"COORDINATOR_SEAT_KIND": "orchestrator", "COORDINATOR_SEAT": "o31"}
READ = {"tool_name": "Read", "tool_input": {"file_path": "coordinator/board.json"}}


def write(path, tool="Write", cwd=None):
    payload = {"tool_name": tool, "tool_input": {"file_path": path}}
    if cwd:
        payload["cwd"] = cwd
    return payload


def bash(command):
    return {"tool_name": "Bash", "tool_input": {"command": command}}


def selftest_decide(root, checked):
    """decide() unit cases against a closed, then open, gate."""
    env = dict(ENV)
    cases = [
        # Bash is denied outright — including the one-command marker forge that broke the classifier.
        ("Bash forge denied", bash("git log --output=coordinator/.seat-ack/o31"), env, False),
        ("Bash read denied", bash("git status"), env, False),
        ("Bash cat denied", bash("cat coordinator/board.json"), env, False),
        # Writes: allowed by target, nothing else.
        ("Write into inbox allowed", write("coordinator/inbox/restate.md", cwd=root), env, True),
        ("Write absolute into inbox allowed",
         write(os.path.join(root, "coordinator", "inbox", "restate.md")), env, True),
        ("Write to .seat-ack denied", write("coordinator/.seat-ack/o31", cwd=root), env, False),
        ("Write outside repo-root file denied", write("server.js", cwd=root), env, False),
        ("Write traversal denied", write("coordinator/inbox/../../server.js", cwd=root), env, False),
        ("Write to board denied", write("coordinator/board.json", cwd=root), env, False),
        ("Write with no path denied", {"tool_name": "Write", "tool_input": {}}, env, False),
        ("Edit into inbox allowed", write("coordinator/inbox/restate.md", "Edit", root), env, True),
        ("Edit outside inbox denied", write("server.js", "Edit", root), env, False),
        # Other tools.
        ("Read allowed", READ, env, True),
        ("MultiEdit denied", write("coordinator/inbox/x.md", "MultiEdit", root), env, False),
        ("NotebookEdit denied", write("coordinator/inbox/x.ipynb", "NotebookEdit", root), env, False),
        ("unknown tool denied", {"tool_name": "Frobnicate"}, env, False),
        ("Task denied", {"tool_name": "Task", "tool_input": {"prompt": "x"}}, env, False),
        # Unresolvable targets fail closed instead of escaping to the fail-open handler.
        ("Write with a NUL byte in the path denied", write("server.js\x00 ", cwd=root), env, False),
        ("Write with a non-string cwd denied",
         {"tool_name": "Write", "tool_input": {"file_path": "coordinator/inbox/x.md"}, "cwd": 123},
         env, False),
        ("unreadable payload allowed", {}, env, True),
        # Seat id.
        ("empty seat id denies Edit", write("coordinator/inbox/x.md", "Edit", root),
         {"COORDINATOR_SEAT_KIND": "orchestrator"}, False),
        ("empty seat id allows Read", READ, {"COORDINATOR_SEAT_KIND": "orchestrator"}, True),
        ("malformed seat id denies", write("coordinator/inbox/x.md", "Edit", root),
         dict(env, COORDINATOR_SEAT="."), False),
        ("seat id with a slash denies", write("coordinator/inbox/x.md", "Edit", root),
         dict(env, COORDINATOR_SEAT="a/b"), False),
        # Arming switch.
        ("gate inactive without seat kind", write("server.js", "Edit", root),
         {"COORDINATOR_SEAT": "o31"}, True),
    ]
    for label, payload, case_env, want in cases:
        allow, reason = decide(payload, case_env, root)
        check(allow is want, "%s — expected allow=%s, got %s (%s)" % (label, want, allow, reason))
        checked.append(label)

    marker = marker_path(root, "o31")
    os.makedirs(marker)  # a directory must not satisfy the marker
    check(decide(bash("git status"), env, root)[0] is False,
          "a directory named like the marker faked an ack")
    checked.append("marker directory rejected")
    os.rmdir(marker)

    open(marker, "w").close()
    try:
        for label, payload in (("Bash allowed after ack", bash("git commit -m x")),
                               ("Write anywhere allowed after ack", write("server.js", cwd=root)),
                               ("Task allowed after ack", {"tool_name": "Task", "tool_input": {}}),
                               ("Read allowed after ack", READ)):
            allow, reason = decide(payload, env, root)
            check(allow, "%s — expected allow, got deny (%s)" % (label, reason))
            checked.append(label)
    finally:
        os.remove(marker)

    check(decide(write("server.js", cwd=root), env, None)[0] is True,
          "gate outside a fleet repo must allow")
    checked.append("no coordinator dir allows")


def selftest_symlinks(root, checked):
    """A symlink out of the inbox must not carry a write out with it."""
    inbox = os.path.join(root, "coordinator", "inbox")
    outside = tempfile.mkdtemp(prefix="boot-gate-outside-")
    escape, ack_link = os.path.join(inbox, "escape.md"), os.path.join(inbox, "ack-link")
    try:
        open(os.path.join(outside, "server.js"), "w").close()
        try:
            os.symlink(os.path.join(outside, "server.js"), escape)
            os.symlink(os.path.join(root, "coordinator", ".seat-ack"), ack_link)
        except (OSError, NotImplementedError):
            return  # no symlink permission on this filesystem: skip, and do not count the cases
        for label, path in (("Write through a symlink out of the inbox denied",
                             "coordinator/inbox/escape.md"),
                            ("Write through a symlink into .seat-ack denied",
                             "coordinator/inbox/ack-link/o31")):
            allow, reason = decide(write(path, cwd=root), ENV, root)
            check(allow is False, "%s — got allow (%s)" % (label, reason))
            checked.append(label)
    finally:
        for link in (escape, ack_link):
            if os.path.islink(link):
                os.remove(link)
        shutil.rmtree(outside, ignore_errors=True)


def selftest_hook(root, checked):
    """run_hook() end-to-end: stdin parsing, repo resolution, emitted hook JSON."""
    env = dict(ENV, COORDINATOR_REPO=root)
    nested = os.path.join(root, "sub", "dir")
    os.makedirs(nested, exist_ok=True)
    forge = json.dumps(dict(bash("git log --output=coordinator/.seat-ack/o31"), cwd=nested))
    inbox = json.dumps(write("coordinator/inbox/restate.md", cwd=root))
    read = json.dumps(dict(READ, cwd=nested))

    code, out = call_hook(forge, env)
    check(code == 0, "a denied call must still exit 0, got %s" % code)
    emitted = json.loads(out)["hookSpecificOutput"]
    check(emitted["hookEventName"] == "PreToolUse", "wrong hookEventName: %r" % emitted)
    check(emitted["permissionDecision"] == "deny", "expected deny, got %r" % emitted)
    check("o31" in emitted["permissionDecisionReason"], "deny reason must name the seat")
    checked += ["hook: Bash forge denied", "hook: exit 0", "hook: hookEventName", "hook: deny reason"]

    # No COORDINATOR_REPO: the repo root must come from the payload cwd walk-up.
    code, out = call_hook(forge, {k: v for k, v in env.items() if k != "COORDINATOR_REPO"})
    check(json.loads(out)["hookSpecificOutput"]["permissionDecision"] == "deny",
          "cwd walk-up failed to find the coordinator dir")
    checked.append("hook: cwd walk-up resolves the repo")

    check(call_hook(read, env)[1] == "", "Read must be allowed while gated")
    check(call_hook(inbox, env)[1] == "", "Write into inbox must be allowed while gated")
    check(call_hook("not json", env)[1] == "", "malformed stdin must fail open")
    check(call_hook("", env)[1] == "", "empty stdin must fail open")
    checked += ["hook: Read allowed", "hook: inbox Write allowed", "hook: malformed stdin",
                "hook: empty stdin"]

    marker = marker_path(root, "o31")
    open(marker, "w").close()
    try:
        check(call_hook(forge, env)[1] == "", "Bash must be allowed after ack")
        check(call_hook(json.dumps(write("server.js", cwd=root)), env)[1] == "",
              "Write anywhere must be allowed after ack")
        checked += ["hook: Bash allowed after ack", "hook: Write allowed after ack"]
    finally:
        os.remove(marker)


def selftest():
    root = tempfile.mkdtemp(prefix="boot-gate-selftest-")
    checked = []
    try:
        os.makedirs(os.path.join(root, "coordinator", ".seat-ack"))
        os.makedirs(os.path.join(root, "coordinator", "inbox"))
        selftest_decide(root, checked)
        selftest_symlinks(root, checked)
        selftest_hook(root, checked)
    except SelftestFailure as exc:
        print("SELFTEST FAIL: %s" % exc)
        return 1
    finally:
        shutil.rmtree(root, ignore_errors=True)

    print("SELFTEST PASS (%d assertions)" % len(checked))
    return 0


def main():
    if "--selftest" in sys.argv[1:]:
        return selftest()
    # Fail OPEN, but only for errors unrelated to a policy decision — env handling, JSON parsing,
    # an unexpected bug. A crashing gate must never wedge the operator's fleet. The opposite
    # direction lives in decide(): an unresolvable write target fails CLOSED.
    try:
        return run_hook()
    except Exception as exc:  # noqa: BLE001 - deliberate catch-all
        print("boot-gate: %s" % exc, file=sys.stderr)
        return 0


if __name__ == "__main__":
    sys.exit(main())
