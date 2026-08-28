#!/bin/sh
# install-box.sh - install the fleet-lifecycle hooks (XYZ-1742 Lane 2) into a Claude config
# dir. Box-side installer; the Mac equivalent is the same script, driven by INSTALL-MAC.md.
#
#   install-box.sh              install / upgrade
#   install-box.sh --dry-run    print the plan, change nothing
#   install-box.sh --uninstall  remove the hook entries and the mark.sh block
#
# Target is ${CLAUDE_CONFIG_DIR:-$HOME/.claude} - the same resolution fd-common.sh uses, so
# the installer and the installed hooks can never disagree about where the fleet dir is.
#
# Rules that outrank convenience here:
#  - IDEMPOTENT. Five runs leave exactly one SessionStart entry, one SessionEnd entry and
#    one mark.sh block. Every edit is replace-in-place keyed on a marker, never an append.
#  - settings.json is edited with python3's json module, never sed/regex. A live config dir
#    holds keys this script has never heard of and they all have to survive byte-for-byte.
#  - Operator data is never clobbered: fleet.env and roles.map are seeded only when absent,
#    and a backup taken earlier the same day is never overwritten with later content.
#  - Non-zero exit means a GENUINE failure (unreadable source, corrupt settings.json,
#    a write that did not land). A missing session-kind/ or an absent settings.json is a
#    normal, reportable case - not an error.
# POSIX sh only (WSL bash + macOS sh both run this).
set -u

MODE=install
DRY=''
for a in "$@"; do
  case $a in
    --uninstall) MODE=uninstall ;;
    --dry-run) DRY=1 ;;
    -h | --help)
      sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "install-box.sh: unknown option '$a' (try --help)" >&2
      exit 2
      ;;
  esac
done

SRC=$(cd -- "$(dirname -- "$0")" && pwd) || {
  echo "install-box.sh: cannot resolve my own directory" >&2
  exit 1
}
CFG=${CLAUDE_CONFIG_DIR:-$HOME/.claude}
FLEET=$CFG/fleet
DAY=$(date -u +%Y-%m-%d)
RC=0

# Every line of the final summary. Collected rather than printed inline so the plan for a
# --dry-run and the report for a real run come out in the same shape.
say() { printf '  %s\n' "$1"; }
fail() {
  printf '  FAILED: %s\n' "$1" >&2
  RC=1
}

SCRIPTS='fd-common.sh lease-claim.sh fd-pinger.sh deregister.sh fd-codex-wrap.sh'
EXECUTABLE='lease-claim.sh fd-pinger.sh deregister.sh fd-codex-wrap.sh'

# ---------------------------------------------------------------- preflight
for f in $SCRIPTS; do
  [ -r "$SRC/$f" ] || {
    echo "install-box.sh: missing source file $SRC/$f" >&2
    exit 1
  }
done
command -v python3 >/dev/null 2>&1 || {
  echo "install-box.sh: python3 is required (settings.json is edited as JSON, never as text)" >&2
  exit 1
}

if [ "$MODE" = install ]; then
  printf 'fleet-lifecycle install%s -> %s\n' "${DRY:+ (dry run)}" "$CFG"
else
  printf 'fleet-lifecycle uninstall%s -> %s\n' "${DRY:+ (dry run)}" "$CFG"
fi

# ---------------------------------------------------------------- 1. scripts + dirs
if [ "$MODE" = install ]; then
  if [ -n "$DRY" ]; then
    say "would create $FLEET, $FLEET/state, $FLEET/log"
    say "would copy: $SCRIPTS"
  else
    if mkdir -p "$FLEET" "$FLEET/state" "$FLEET/log" 2>/dev/null; then
      say "dirs ready: fleet/, fleet/state/, fleet/log/"
    else
      fail "cannot create $FLEET (and state/, log/)"
    fi
    if [ "$RC" = 0 ]; then
      copied=0
      for f in $SCRIPTS; do
        # Copy-then-rename, not cp-in-place: a pinger from the previous install may still be
        # executing its own file, and truncating that inode under it is how an upgrade turns
        # into a syntax error at runtime. mv swaps the directory entry; the old inode lives
        # until the running process exits.
        if cp -- "$SRC/$f" "$FLEET/$f.new" 2>/dev/null; then
          case " $EXECUTABLE " in
            *" $f "*) chmod 755 "$FLEET/$f.new" 2>/dev/null ;;
            *) chmod 644 "$FLEET/$f.new" 2>/dev/null ;;  # fd-common.sh is sourced, never run
          esac
          if mv -f -- "$FLEET/$f.new" "$FLEET/$f" 2>/dev/null; then
            copied=$((copied + 1))
          else
            rm -f "$FLEET/$f.new" 2>/dev/null
            fail "cannot install $FLEET/$f"
          fi
        else
          fail "cannot copy $SRC/$f"
        fi
      done
      say "installed $copied script(s) into $FLEET"
    fi
  fi
else
  say "scripts left in place (uninstall removes wiring, not the fleet dir)"
fi

# ---------------------------------------------------------------- 2. fleet.env + roles.map
# fleet.env may hold FD_TAILNET_KEY, so it is owner-only. This only ever REMOVES bits: an
# operator who set 0400 keeps 0400, and a mode this script cannot read is left untouched
# rather than guessed at. Silent when the file is already owner-only.
tighten_owner_only() {
  _m=$(stat -c %a "$1" 2>/dev/null) || _m=''
  [ -n "$_m" ] || _m=$(stat -f %Lp "$1" 2>/dev/null) || _m=''
  case $_m in '' | *[!0-7]*) return 0 ;; esac
  _go=${_m#"${_m%??}"}                     # the group+other digits of a 3- or 4-digit mode
  [ "$_go" = 00 ] && return 0
  if [ -n "$DRY" ]; then
    say "would tighten $2 to owner-only (mode $_m; it may hold a bearer key)"
  elif chmod go-rwx "$1" 2>/dev/null; then
    say "tightened $2 to owner-only (was mode $_m; it may hold a bearer key)"
  else
    say "WARNING: $2 is mode $_m and could not be tightened - it may hold a bearer key"
  fi
  return 0
}

seed_file() {
  # $1 = path, $2 = description, $3 = mode to create it with (optional). Body on stdin.
  # Never overwrites: fleet.env carries operator edits (a different FD_BASE_URL, a parent
  # edge, a tailnet key) and an upgrade must not undo them.
  if [ -e "$1" ]; then
    say "$2 already present, left untouched"
    [ -n "${3:-}" ] && tighten_owner_only "$1" "$2"
    cat >/dev/null
    return 0
  fi
  if [ -n "$DRY" ]; then
    say "would seed $2${3:+ (mode $3)}"
    cat >/dev/null
    return 0
  fi
  # Created INSIDE a `umask 077` subshell, so the file is owner-only from the instant it
  # exists: `: >file` then chmod leaves a window in which any local process can open it and
  # keep reading through the chmod, secret and all. The chmod after it only ever narrows
  # further (an operator-chosen 0400, say), so no window is reopened.
  # Any failure removes the partial file: a leftover empty fleet.env would look "already
  # present" to every later run and never get its default content - one transient failure
  # turning into a permanent one.
  if [ -n "${3:-}" ] && ! { (umask 077; : >"$1") 2>/dev/null && chmod "$3" "$1" 2>/dev/null; }; then
    rm -f "$1" 2>/dev/null
    fail "cannot create $1 with mode $3"
    cat >/dev/null
    return 0
  fi
  if cat >"$1" 2>/dev/null; then
    say "seeded $2${3:+ (mode $3)}"
  else
    rm -f "$1" 2>/dev/null
    fail "cannot write $1"
  fi
}

if [ "$MODE" = install ] && [ "$RC" = 0 ]; then
  seed_file "$FLEET/fleet.env" "fleet.env" 0600 <<'ENV'
# fleet-lifecycle config (XYZ-1742 Lane 2). Sourced by the hooks; the environment wins over
# this file. Seeded once by install-box.sh and never rewritten - edit it freely.

# Where the fleet server lives. Tailnet IP from the box; http://localhost:3131 on the mac.
FD_BASE_URL=http://100.125.231.25:3131

# This machine's host key, as the server knows it: german-box or mac.
FD_HOST=german-box

# The parent edge, written at claim time only. Both halves or neither; leaving both empty is
# legal and renders the session as an orphan under its host.
FD_PARENT_HOST=mac
FD_PARENT_NAME=orchestrator

# Seconds any single HTTP call may take before it counts as a transient failure.
FD_CURL_TIMEOUT=10

# Shared bearer key for the server's tailnet listener: it must be byte-identical to the
# server's FLEET_TAILNET_KEY, or every claim and heartbeat from this box gets a 401. Leave it
# commented out while the server's key is unset. The mac never needs it - its calls go to
# loopback, which the server exempts. This file is mode 0600 because of this line.
#FD_TAILNET_KEY=

# Liveness proof before every beat. Unset defaults to tmux on the box, pid on the mac:
#   tmux -> tmux has-session      pid -> kill -0 $FD_PID
#FD_LIVENESS=tmux
ENV

  # roles.map: "<worker-slug or session-name><TAB><role>". lease-claim.sh looks the worker up
  # here when FD_ROLE is not set. The separators are literal tabs and load-bearing
  # (awk -F'\t'), so they are built with printf rather than typed into the heredoc, and the
  # heredoc keeps seed_file out of a subshell (a pipeline would lose its RC changes).
  ROLES=$(printf '%s\t%s\n' \
    edith backend-developer \
    konrad devops-engineer \
    alfons frontend-developer)
  seed_file "$FLEET/roles.map" "roles.map" <<ROLESMAP
$ROLES
ROLESMAP
fi

# ---------------------------------------------------------------- 3. settings.json hooks
SETTINGS=$CFG/settings.json

# The claim is DETACHED, not run inline. lease-claim.sh retries a failed claim three times
# with backoff and up to three FD_CURL_TIMEOUT-second curl calls, so a synchronous hook would
# stall EVERY new session on this box for that whole path whenever the deck is unreachable -
# on a box running 28 workers that is a real tax, and a fleet outage must never slow a session
# start. So: backgrounded exactly the way the mark.sh block does it (setsid where there is
# one, so the claim also outlives the hook's process group), all three fds detached so the
# hook's pipes close at once, and an explicit `exit 0`. The hook returns immediately, prints
# nothing and cannot fail; the timeout registered below stays as a backstop on the fork.
CLAIM_SH="\"$FLEET/lease-claim.sh\""
CLAIM_CMD="if command -v setsid >/dev/null 2>&1; then setsid sh $CLAIM_SH </dev/null >/dev/null 2>&1 & else sh $CLAIM_SH </dev/null >/dev/null 2>&1 & fi; exit 0"
# SessionEnd stays synchronous: deregister.sh only signals a pid it already knows and waits at
# most 3s for it to go, with no network call on any path.
DEREG_CMD="sh \"$FLEET/deregister.sh\""

settings_py() {
  # $1 = mode (install|uninstall|plan). Prints one status word then a human line per change.
  python3 - "$SETTINGS" "$CLAIM_CMD" "$DEREG_CMD" "$1" "$SETTINGS.bak-$DAY" <<'PY'
import json, os, re, sys, tempfile

path, claim_cmd, dereg_cmd, mode, backup = sys.argv[1:6]

# Our entries are identified by their COMMAND, not by position: the operator may reorder
# them, and an append-only installer would stack a second copy on every run.
#
# But ownership is EXACT, never "contains". A foreign hook whose command merely MENTIONS
# fleet/lease-claim.sh - a diagnostic wrapper, a compound command, a script that greps for
# it - is not ours. On install it must survive untouched, and on uninstall it must not be
# deleted, which would be exactly the operator data loss this file promises not to cause.
# So a command is ours only if the whole string, after whitespace normalisation, is one of
# the forms this installer has ever generated - past forms included, so an upgrade still
# collapses to one entry. The path inside a form is left open (SLOT), because an entry
# pointing at a different CLAUDE_CONFIG_DIR is still one of ours.
SLOT = "\x00"
GENERATED = [
    # current: detached, so a fleet outage cannot stall a session start
    "if command -v setsid >/dev/null 2>&1; then setsid sh \x00 </dev/null >/dev/null 2>&1 "
    "& else sh \x00 </dev/null >/dev/null 2>&1 & fi; exit 0",
    # pre-2026-08-28: run inline
    "sh \x00",
]


def owner_res(script):
    """One anchored regex per generated form of the command that runs <script>."""
    e = re.escape(script)
    slot = "(?:\"[^\"]*%s\"|'[^']*%s'|(?:[^\\s\"']*/)?%s)" % (e, e, e)
    return [re.compile(slot.join(re.escape(lit) for lit in form.split(SLOT)))
            for form in GENERATED]


def is_ours(cmd, res):
    cmd = " ".join(str(cmd).split())  # our forms are single-spaced; re-indenting is still ours
    return any(rx.fullmatch(cmd) for rx in res)


WANT = [("SessionStart", owner_res("fleet/lease-claim.sh"), claim_cmd),
        ("SessionEnd", owner_res("fleet/deregister.sh"), dereg_cmd)]
TIMEOUT = 10  # a hung hook must never stall a session start
# mode is install|uninstall|plan-install|plan-uninstall. Dry-run and direction are
# INDEPENDENT: `--uninstall --dry-run` has to plan the removal, not the install.
dry = mode.startswith("plan")
removing = mode.endswith("uninstall")


def die(msg):
    print("error")
    print(msg)
    sys.exit(1)


if os.path.exists(path):
    try:
        with open(path, encoding="utf-8") as fh:
            raw = fh.read()
        cfg = json.loads(raw) if raw.strip() else {}
        # Parsed a second time on purpose: `orig` is the untouched shape, kept so that
        # "did anything change?" below is a question about content, not about formatting.
        orig = json.loads(raw) if raw.strip() else {}
    except Exception as exc:
        # Refusing is the safe move: rewriting a file we could not parse would lose keys.
        die("settings.json is not readable as JSON (%s) - not touching it" % exc)
    if not isinstance(cfg, dict):
        die("settings.json is not a JSON object - not touching it")
elif removing:
    print("absent")
    print("settings.json does not exist, nothing to remove")
    sys.exit(0)
else:
    raw, cfg, orig = "", {}, None  # no file yet: creating one is always a change

hooks = cfg.get("hooks", {})
if not isinstance(hooks, dict):
    die("settings.json has a 'hooks' key that is not an object - not touching it")
hooks = dict(hooks)
notes = []

for event, res, cmd in WANT:
    groups = hooks.get(event, [])
    if not isinstance(groups, list):
        die("settings.json hooks.%s is not a list - not touching it" % event)
    groups = [g for g in groups]
    entry = {"type": "command", "command": cmd, "timeout": TIMEOUT}
    seen = 0
    emptied = set()
    for gi, group in enumerate(groups):
        if not isinstance(group, dict) or not isinstance(group.get("hooks"), list):
            continue  # a foreign shape we do not understand stays exactly as it is
        was = group["hooks"]
        kept = []
        for h in was:
            if isinstance(h, dict) and is_ours(h.get("command", ""), res):
                seen += 1
                if seen == 1 and not removing:
                    kept.append(entry)  # replace in place, keeping its position
                continue  # every later copy is a duplicate: drop it
            kept.append(h)
        if was and not kept:
            emptied.add(gi)  # it held nothing but entries of ours
        group = dict(group)
        group["hooks"] = kept
        groups[gi] = group
    # Drop only the groups THIS RUN emptied - with whatever other keys they carry (a matcher,
    # say), since such a group never held anything but ours; leaving it behind as
    # {"matcher": ..., "hooks": []} is uninstall debris. An operator's pre-existing empty
    # placeholder was not emptied by us, so it stays exactly where it is.
    groups = [g for gi, g in enumerate(groups) if gi not in emptied]
    if removing:
        if seen:
            notes.append("removed %d %s entry/entries" % (seen, event))
        if groups:
            hooks[event] = groups
        else:
            hooks.pop(event, None)
    else:
        if seen == 0:
            groups.append({"hooks": [entry]})
            notes.append("added %s -> %s" % (event, cmd))
        elif seen > 1:
            notes.append("collapsed %d duplicate %s entries into one" % (seen, event))
        hooks[event] = groups

if hooks:
    cfg["hooks"] = hooks
else:
    cfg.pop("hooks", None)

new = json.dumps(cfg, indent=2, ensure_ascii=False) + "\n"
# Semantic, not textual. A hand-edited settings.json - 4-space indent, a different key order,
# the operator's Mac config - is already correct when its CONTENT matches, and comparing bytes
# would rewrite it into our formatting on every single run while reporting a change that was
# never asked for. Compare the parsed objects and leave the bytes alone.
if orig is not None and cfg == orig:
    print("unchanged")
    print("hooks already correct, file not rewritten")
    sys.exit(0)
if dry:
    print("would-change")
    for n in notes or ["would rewrite the hooks block"]:
        print(n)
    sys.exit(0)

# One backup per UTC day, created only if absent: the first run of the day holds the
# pre-install content, and a later run must not overwrite it with already-patched content.
if raw and not os.path.exists(backup):
    try:
        with open(backup, "w", encoding="utf-8") as fh:
            fh.write(raw)
        notes.append("backed up to %s" % os.path.basename(backup))
    except Exception as exc:
        die("cannot write the backup %s (%s)" % (backup, exc))

try:
    d = os.path.dirname(path) or "."
    fd, tmp = tempfile.mkstemp(dir=d, prefix=".settings.json.")
    with os.fdopen(fd, "w", encoding="utf-8") as fh:
        fh.write(new)
    os.replace(tmp, path)  # atomic: a reader never sees a half-written settings.json
except Exception as exc:
    die("cannot write %s (%s)" % (path, exc))
print("changed")
for n in notes:
    print(n)
PY
}

# The python helpers take direction and dry-run as one word, but they are independent
# flags there: `--uninstall --dry-run` must plan a removal.
smode=$MODE
[ -n "$DRY" ] && smode=plan-$smode

if [ "$RC" = 0 ]; then
  out=$(settings_py "$smode" 2>&1)
  status=$(printf '%s\n' "$out" | sed -n 1p)
  printf '%s\n' "$out" | sed 1d | while IFS= read -r l; do
    [ -n "$l" ] && printf '  settings.json: %s\n' "$l"
  done
  case $status in
    error) fail "settings.json was left untouched (see above)" ;;
    unchanged | absent | changed | would-change) : ;;
    *) fail "settings.json: unexpected installer state '$status'" ;;
  esac
fi

# ---------------------------------------------------------------- 4. mark.sh block
MARK=$CFG/session-kind/mark.sh

mark_py() {
  python3 - "$MARK" "$1" "$MARK.bak-$DAY" <<'PY'
import os, sys, tempfile

path, mode, backup = sys.argv[1:4]
dry = mode.startswith("plan")
removing = mode.endswith("uninstall")
BEGIN = "# --- fleetdeck lifecycle (XYZ-1742 Lane 2) BEGIN ---"
END = "# --- fleetdeck lifecycle (XYZ-1742 Lane 2) END ---"

BLOCK = """%s
# `mark.sh --worker <Name>` is the one line BOTH breeds run at launch, and the Codex breed
# has no hooks - so the fleet lease is claimed from here too, which is what covers Codex
# without editing the launcher. Constraints, all load-bearing:
#   - only on a successful `--worker <Name>` (this sits after the case, so a bad invocation
#     has already exited);
#   - backgrounded, so mark.sh never delays the launch line;
#   - no stdout, no stderr, no change of exit status - the launcher and the status line read
#     the badge mark.sh printed above;
#   - a missing lease-claim.sh is a silent no-op, never an error;
#   - FD_DIR wins, exactly as it does in fd-common.sh, so a test that redirects the fleet dir
#     cannot end up claiming a real lease against live fleet state from here.
# Managed by install-box.sh: everything between these markers is replaced on upgrade and
# removed by `install-box.sh --uninstall`. Do not hand-edit.
if [ "${1:-}" = --worker ] && [ -n "${2:-}" ]; then
  _fd_claim="${FD_DIR:-${CLAUDE_CONFIG_DIR:-$HOME/.claude}/fleet}/lease-claim.sh"
  if [ -r "$_fd_claim" ]; then
    if command -v setsid >/dev/null 2>&1; then
      FD_WORKER="$2" setsid sh "$_fd_claim" </dev/null >/dev/null 2>&1 &
    else
      FD_WORKER="$2" sh "$_fd_claim" </dev/null >/dev/null 2>&1 &
    fi
  fi
  unset _fd_claim
fi
%s
""" % (BEGIN, END)


def die(msg):
    print("error")
    print(msg)
    sys.exit(1)


if not os.path.exists(path):
    print("absent")
    print("no session-kind/mark.sh here, skipped")
    sys.exit(0)
try:
    with open(path, encoding="utf-8") as fh:
        raw = fh.read()
except Exception as exc:
    die("cannot read mark.sh (%s)" % exc)

lines = raw.split("\n")
try:
    b = next(i for i, l in enumerate(lines) if l.strip() == BEGIN)
    e = next(i for i, l in enumerate(lines) if l.strip() == END)
except StopIteration:
    b = e = None
if b is not None and (e is None or e < b):
    die("found a BEGIN marker with no END after it - fix mark.sh by hand")

if b is not None:
    # Replace the managed block in place. Re-running can never stack a second copy.
    head, tail = lines[:b], lines[e + 1:]
    note, plan = "block replaced", "replace the block"
    if removing:
        while head and head[-1] == "":
            head.pop()
        new = "\n".join(head + [""] + tail)
        note, plan = "block removed", "remove the block"
    else:
        new = "\n".join(head) + "\n" + BLOCK + "\n".join(tail)
elif removing:
    print("unchanged")
    print("no managed block present, nothing to remove")
    sys.exit(0)
else:
    # First install. The block goes immediately before the final bare `exit 0`, so it runs
    # after the case statement for every path that reaches a normal exit - and NOT for the
    # early `exit 2` a bad --worker invocation takes. Anchor on the LAST line that is exactly
    # `exit 0`; the `"") exit 0 ;;` arm inside the case is not one.
    idx = [i for i, l in enumerate(lines) if l.strip() == "exit 0" and l.strip() == l]
    if idx:
        at = idx[-1]
        new = "\n".join(lines[:at]) + "\n" + BLOCK + "\n".join(lines[at:])
        note = "block inserted before the final `exit 0`"
        plan = "insert the block before the final `exit 0`"
    else:
        # No recognisable tail. Appending is still correct - the block is self-guarding - but
        # say so loudly, because it means mark.sh no longer looks the way we expect.
        new = raw + ("" if raw.endswith("\n") else "\n") + "\n" + BLOCK
        note = "WARN no final `exit 0` found; block appended at the end - review mark.sh"
        plan = "WARN append the block at the end - no final `exit 0` found; review mark.sh"

if new == raw:
    print("unchanged")
    print("block already current, file not rewritten")
    sys.exit(0)
if dry:
    print("would-change")
    print("would %s" % plan)
    sys.exit(0)

# One backup per UTC day, created only if absent (see settings.json above for why).
notes = [note]
if not os.path.exists(backup):
    try:
        with open(backup, "w", encoding="utf-8") as fh:
            fh.write(raw)
        notes.append("backed up to %s" % os.path.basename(backup))
    except Exception as exc:
        die("cannot write the backup %s (%s)" % (backup, exc))

try:
    st = os.stat(path)
    d = os.path.dirname(path) or "."
    fd, tmp = tempfile.mkstemp(dir=d, prefix=".mark.sh.")
    with os.fdopen(fd, "w", encoding="utf-8") as fh:
        fh.write(new)
    os.chmod(tmp, st.st_mode & 0o7777)  # mark.sh must stay executable
    os.replace(tmp, path)
except Exception as exc:
    die("cannot write %s (%s)" % (path, exc))
print("changed")
for n in notes:
    print(n)
PY
}

if [ "$RC" = 0 ]; then
  out=$(mark_py "$smode" 2>&1)
  status=$(printf '%s\n' "$out" | sed -n 1p)
  printf '%s\n' "$out" | sed 1d | while IFS= read -r l; do
    [ -n "$l" ] && printf '  mark.sh: %s\n' "$l"
  done
  case $status in
    error) fail "mark.sh was left untouched (see above)" ;;
    unchanged | absent | changed | would-change) : ;;
    *) fail "mark.sh: unexpected installer state '$status'" ;;
  esac
fi

# ---------------------------------------------------------------- summary
if [ "$RC" != 0 ]; then
  echo "done with errors - nothing was left half-written; fix the cause and re-run." >&2
elif [ -n "$DRY" ]; then
  echo "dry run: nothing was changed."
elif [ "$MODE" = uninstall ]; then
  echo "uninstalled. fleet.env, roles.map, state/ and log/ were left alone."
else
  echo "installed. Next: start a session and check $FLEET/log/<session>.log"
fi
exit "$RC"
