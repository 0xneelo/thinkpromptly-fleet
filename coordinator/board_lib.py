#!/usr/bin/env python3
"""Shared primitives for the coordinator scripts: board IO, time, and ages.

Every other module in `coordinator/` imports this one and nothing else of its
siblings, except `check.py` and `bundle.py` which also import `exceptions.py`.
Keep it dependency-free (stdlib only) and side-effect free on import.

DESIGN-v1 §4 is the board spec; the v0.2 additions (policy block, queue-item
deadlines, exceptions) are specified in docs/coordinator/v02-scope-proposal.md
M1 and in docs/coordinator/SCHEMA-v2.md.
"""

import json
import os
import re
from datetime import datetime, timedelta, timezone

INSTANCE_ROOT_ENV = "COORDINATOR_INSTANCE_ROOT"

# --- board defaults -------------------------------------------------------
# Written explicitly into board.json by the initiation ritual (M6); these
# values apply to a board that predates the policy block.
DEFAULT_POLICY = {
    # Cadence used for a lane or queue item that carries no explicit deadline.
    "default_cadence_hours": 24,
    # A done-claimed lane older than this with no attestation is an exception.
    "unattested_done_days": 3,
    # An operator-queue item open longer than this is an exception.
    "queue_item_days": 3,
}

# DESIGN §4 state enum — case-sensitive on purpose.
STATES = ("active", "blocked", "done-claimed", "done-verified", "DISPUTED", "UNKNOWN", "closed")

# States the dead-man switch leaves alone: a closed lane owes nothing, and a
# DISPUTED lane is already an exception the operator has to rule on.
DEADMAN_EXEMPT = ("closed", "DISPUTED")


def board_dir(board_path):
    return os.path.dirname(os.path.abspath(board_path))


def default_instance_root():
    """The state directory used by CLIs when no explicit board path is supplied.

    The product checkout keeps its historical default (this module's directory).
    A customer instance can live in another repository and opt in per process via
    COORDINATOR_INSTANCE_ROOT; no cwd or product-checkout layout is then assumed.
    """
    configured = os.environ.get(INSTANCE_ROOT_ENV, "").strip()
    if configured:
        return os.path.abspath(os.path.expanduser(configured))
    return os.path.dirname(os.path.abspath(__file__))


def default_instance_path(*parts):
    return os.path.join(default_instance_root(), *parts)


def default_board_path():
    return default_instance_path("board.json")


def load(path):
    """Read a board. Raises OSError or ValueError — callers decide the exit code."""
    with open(path, encoding="utf-8") as handle:
        board = json.load(handle)
    if not isinstance(board, dict):
        raise ValueError("the top level of %s must be a JSON object" % path)
    return board


def dumps(board):
    """Canonical on-disk form: 2-space indent, unescaped unicode, trailing newline."""
    return json.dumps(board, indent=2, ensure_ascii=False) + "\n"


def save(path, board):
    """Write a board atomically so a crashed run never leaves a truncated board.

    The temp name carries the pid: two coordinator scripts invoked close together
    would otherwise interleave writes into one shared `.tmp` and rename a hybrid
    into place. fsync before the rename so an OS-level crash cannot land the
    directory entry ahead of the bytes.
    """
    tmp = "%s.%d.tmp" % (path, os.getpid())
    try:
        with open(tmp, "w", encoding="utf-8") as handle:
            handle.write(dumps(board))
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(tmp, path)
    except BaseException:
        if os.path.exists(tmp):
            os.unlink(tmp)
        raise


def policy(board):
    """The board's policy block with every missing key filled from DEFAULT_POLICY."""
    merged = dict(DEFAULT_POLICY)
    supplied = board.get("policy")
    if isinstance(supplied, dict):
        for key, value in supplied.items():
            # A non-positive cadence would put every deadline in the past, so a
            # junk value falls back to the default rather than poisoning the clock.
            if key in merged and isinstance(value, int) and not isinstance(value, bool) and value >= 1:
                merged[key] = value
    return merged


# --- time -----------------------------------------------------------------

def now_utc():
    return datetime.now(timezone.utc)


def parse_iso(value):
    """ISO-8601 (with optional trailing Z) to an aware UTC datetime, or None.

    None is returned for null, a non-string, or anything unparseable — callers
    treat "no timestamp" and "bad timestamp" the same way: no age is computable.
    """
    if not isinstance(value, str) or not value.strip():
        return None
    text = value.strip()
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def iso_ok(value):
    """True when value is null (allowed) or parses as ISO-8601."""
    return value is None or parse_iso(value) is not None


def to_iso(moment):
    """Aware datetime to the board's on-disk form: UTC, second precision, Z."""
    return moment.astimezone(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def age_seconds(timestamp, now):
    """Seconds elapsed since `timestamp`, or None when it is absent/unparseable.

    Negative for a timestamp in the future — a deadline that has not arrived is
    not an age, and callers check the sign rather than clamping it away.
    """
    moment = parse_iso(timestamp)
    if moment is None:
        return None
    return int((now - moment).total_seconds())


def humanize_age(seconds):
    """Compact age for a one-glance surface: 45m, 6h, 4d 2h, 12d."""
    if seconds is None:
        return "unknown"
    sign = "-" if seconds < 0 else ""
    seconds = abs(int(seconds))
    days, rest = divmod(seconds, 86400)
    hours, rest = divmod(rest, 3600)
    minutes = rest // 60
    if days and hours:
        return "%s%dd %dh" % (sign, days, hours)
    if days:
        return "%s%dd" % (sign, days)
    if hours:
        return "%s%dh" % (sign, hours)
    return "%s%dm" % (sign, minutes)


def default_due(from_moment, board):
    """The deadline a lane or queue item gets when it states none of its own."""
    return to_iso(from_moment + timedelta(hours=policy(board)["default_cadence_hours"]))


# --- the capability-shaped milestone rule (M1) ----------------------------
# DESIGN §4b only has teeth if `done_milestone` names something a reader can go
# and look at. These are the observable markers; a milestone must carry at
# least one. The rule rejects pure aspiration ("make the pipeline solid"), not
# imperfect prose.
MILESTONE_MARKERS = (
    ("link", re.compile(r"https?://\S+")),
    # The `git:` prefix is required. A bare hex run is not evidence of anything:
    # "stuff is done b00b1e5" would otherwise name a commit that never existed.
    ("commit", re.compile(r"\bgit:[0-9a-f]{7,40}\b")),
    ("tracker id", re.compile(r"\b[A-Z]{2,6}-\d+\b")),
    # Digits and number words only. `no`, `all`, `every` and `each` were dropped:
    # they let "no progress has been made" read as a countable claim.
    ("count or threshold", re.compile(
        r"\d|\b(?:one|two|three|four|five|six|seven|eight|nine|ten|zero)\b", re.IGNORECASE)),
    ("observable verb", re.compile(
        r"\b(?:serving|served|deployed|deploys|running|responds|responding|returns|returning|"
        r"live|in production|passing|passes|green|clean|closed|merged|pushed|committed|"
        r"verified|attested|reachable|installed|renders|rendering)\b", re.IGNORECASE)),
    ("file path", re.compile(r"\b[\w./-]+/[\w.-]+\.\w{1,5}\b")),
)

# A checkable milestone names BOTH a thing and a state — "train 67 serving on
# prod" carries a count and an observable verb. One marker alone is what lets
# aspiration through: "make sure the tests stay green" has a verb and nothing to
# check it against. Two distinct markers is the smallest rule that admits every
# real milestone on the board and rejects every aspiration the review found.
MILESTONE_MIN_MARKERS = 2


# A reference marker names a specific artefact. The generic markers describe it.
# They are scored against the text with the references REMOVED, so one token can
# never satisfy two markers by itself: "XYZ-1742" is a tracker id and would
# otherwise also read as a count, passing a milestone that says nothing at all.
REFERENCE_MARKERS = ("link", "commit", "tracker id", "file path")


def milestone_markers(text):
    """Names of the observable markers in a done-milestone, in spec order.

    Markers are made independent by construction: each reference match is cut out
    of the text before the generic markers are scored against what is left.
    """
    if not isinstance(text, str):
        return []
    found, residue = [], text
    for name, pattern in MILESTONE_MARKERS:
        if name in REFERENCE_MARKERS and pattern.search(text):
            found.append(name)
            residue = pattern.sub(" ", residue)
    for name, pattern in MILESTONE_MARKERS:
        if name not in REFERENCE_MARKERS and pattern.search(residue):
            found.append(name)
    return [name for name, _ in MILESTONE_MARKERS if name in found]


def milestone_is_capability_shaped(text):
    """True when a done-milestone names something checkable in production."""
    if not isinstance(text, str) or not text.strip():
        return False
    return len(milestone_markers(text)) >= MILESTONE_MIN_MARKERS


def board_exceptions(board, now):
    """The M1 exceptions for a board, or its own stored copy when M1 is absent.

    Both surfaces (render, notify) need this and neither may hard-depend on
    exceptions.py: a surface that crashes because the computation is missing shows
    the operator nothing, which is the failure mode M1 exists to prevent.
    """
    try:
        import exceptions as exceptions_mod
    except ImportError:
        exceptions_mod = None
    if exceptions_mod is not None:
        return exceptions_mod.compute(board, now)
    stored = board.get("exceptions")
    return [item for item in stored if isinstance(item, dict)] if isinstance(stored, list) else []
