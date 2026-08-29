#!/usr/bin/env python3
"""Push exception transitions to the operator's Telegram — notify only (v0.2 M4).

Usage: python3 coordinator/notify.py [board.json] [--now ISO] [--send]
                                     [--state <path>] [--min-interval SECONDS]
                                     [--reset] [--selftest]

Sends on a *transition* — an exception id this run has that the last run did not.
Never a heartbeat: a quiet board sends nothing, and the same three exceptions on
the next run send nothing again. Cleared ids ride along as a quieter line, but a
clear on its own never triggers a send; it waits and groups with the next real
one. Every send is one digest, so ten new exceptions are one message.

Delivery reads TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID from the environment.
Without both, or without --send, the run is a DRY RUN: it prints the exact
message and changes no state. The token never enters argv, the state file, or a
logged URL.

DESIGN §2: the notifier is never on a critical path. Any delivery failure is one
WARN line on stderr and exit 0 — a dead notifier must not wedge a coordinator run.

No buttons. DESIGN §9.3 sequences notify first and button-ack second; button-ack
is v0.3 and explicitly out of scope here (v0.2 scope proposal, "Explicitly OUT").
"""

import argparse
import json
import os
import sys
import tempfile
import urllib.parse
import urllib.request

import board_lib as bl

try:
    import exceptions as exceptions_mod
except ImportError:  # exceptions.py is M1 and may not have landed yet
    exceptions_mod = None

STATE_NAME = ".notify-state.json"
STATE_VERSION = 1

# A channel that gets muted has negative value, so the floor is an hour between
# sends. Items suppressed by it are never marked notified — they go out next time.
MIN_SEND_INTERVAL = 3600

MAX_ITEMS = 12       # listed in full; the rest are counted, and the board has them all
MAX_CHARS = 3500     # Telegram's limit is 4096; leave room for the tail lines

API = "https://api.telegram.org/bot%s/sendMessage"


def default_state_path(board_path):
    return os.path.join(bl.board_dir(board_path), STATE_NAME)


def load_state(path):
    """The previous run's ids. A missing or corrupt file is a fresh start, not a
    crash — the worst case is one duplicate digest, and the alternative is a
    notifier that dies on a truncated write."""
    blank = {"version": STATE_VERSION, "notified": [], "pending_cleared": [], "last_send_at": None}
    try:
        with open(path, encoding="utf-8") as handle:
            state = json.load(handle)
    except (OSError, ValueError):
        return blank
    if not isinstance(state, dict):
        return blank

    merged = dict(blank)
    for key in ("notified", "pending_cleared"):
        if isinstance(state.get(key), list):
            merged[key] = [item for item in state[key] if isinstance(item, str)]
    if isinstance(state.get("last_send_at"), str):
        merged["last_send_at"] = state["last_send_at"]
    return merged


def compose(new_items, cleared, now, source):
    """One digest for the whole run. Ten new exceptions are ten lines, not ten
    messages — the operator gets one thread per run, coalesced per incident id."""
    head = ["COORDINATOR — %d new exception%s" % (len(new_items), "" if len(new_items) == 1 else "s"),
            "%s · %s" % (bl.to_iso(now), source), ""]

    lines = []
    for item in new_items[:MAX_ITEMS]:
        detail = str(item.get("detail", "")).strip()
        lines.append("- %s %s (%s): %s" % (item.get("kind"), item.get("subject"),
                                           item.get("age"), detail))
    if len(new_items) > MAX_ITEMS:
        lines.append("- +%d more — see the board." % (len(new_items) - MAX_ITEMS))

    tail = []
    if cleared:
        # A resolved incident is news too, but quieter: ids only, one line.
        tail += ["", "CLEARED (%d): %s" % (len(cleared), ", ".join(cleared))]
    tail += ["", "Notify only — no ack button in v0.2. Rule in the portal or in Linear."]

    text = "\n".join(head + lines + tail)
    if len(text) > MAX_CHARS:
        text = text[:MAX_CHARS].rsplit("\n", 1)[0] + "\n- … truncated, see the board."
    return text


def plan(found, state):
    """(new_items, cleared_ids) for this run — the whole transition rule.

    An id that reappeared cancels its own pending clear: the operator is about to
    be told it is back, and telling them it went away in the same breath is noise.
    """
    live = [item.get("id") for item in found]
    notified = set(state.get("notified") or [])
    pending = set(state.get("pending_cleared") or []) - set(live)
    new_items = [item for item in found if item.get("id") not in notified]
    cleared = sorted((notified - set(live)) | pending)
    return new_items, cleared


def telegram_send(token, chat_id, text):
    """POST one message. Raises on any failure; the caller downgrades it to WARN."""
    data = urllib.parse.urlencode({"chat_id": chat_id, "text": text,
                                   "disable_web_page_preview": "true"}).encode("utf-8")
    # The token lives in the URL because the API demands it — so this URL is never
    # printed, never logged, and never written to the state file.
    request = urllib.request.Request(API % token, data=data)
    with urllib.request.urlopen(request, timeout=15) as response:
        response.read()


def dispatch(found, now, state_path, sender, min_interval, source):
    """Decide, deliver, persist. Returns (message_or_None, reason).

    `sender` is None for a dry run, and a dry run writes nothing: the state file
    only ever records what the operator was actually told.
    """
    state = load_state(state_path)
    new_items, cleared = plan(found, state)
    live = [item.get("id") for item in found]

    if not new_items:
        # Nothing to announce. Park the clears for the next real notification.
        if sender is not None:
            state["notified"] = sorted(set(state.get("notified") or []) & set(live))
            state["pending_cleared"] = cleared
            state["version"] = STATE_VERSION
            bl.save(state_path, state)
        return None, "quiet: %d exception%s, none new%s" % (
            len(found), "" if len(found) == 1 else "s",
            ", %d cleared held for the next send" % len(cleared) if cleared else "")

    message = compose(new_items, cleared, now, source)
    since_last = bl.age_seconds(state.get("last_send_at"), now)
    if sender is not None and since_last is not None and 0 <= since_last < min_interval:
        # Suppressed, not dropped: nothing is marked notified, so the same items
        # are still new on the next allowed run and go out then.
        return None, ("WARN rate-limited: last send %s ago, minimum interval %s — %d new "
                      "exception(s) held for the next allowed run"
                      % (bl.humanize_age(since_last), bl.humanize_age(min_interval),
                         len(new_items)))

    if sender is None:
        return message, "dry run: nothing sent, no state written"

    try:
        sender(message)
    except OSError as exc:
        # DESIGN §2: a dead notifier never wedges a run. Nothing is marked
        # notified, so the next run retries this digest unchanged.
        return None, ("WARN delivery failed (%s) — nothing marked notified, the next run retries"
                      % type(exc).__name__)

    state["notified"] = sorted(set(live))
    state["pending_cleared"] = []
    state["last_send_at"] = bl.to_iso(now)
    state["version"] = STATE_VERSION
    try:
        bl.save(state_path, state)
    except OSError as exc:
        return message, ("WARN sent, but the state file did not save (%s) — the next run may "
                         "repeat this digest" % exc)
    return message, "sent: %d new, %d cleared" % (len(new_items), len(cleared))


# --- selftest -------------------------------------------------------------

def fixture(count, base="2026-08-29T09:00:00Z"):
    """`count` exception records of the M1 shape, ids stable across runs."""
    return [{"id": "EX-overdue-L%d" % n, "kind": "overdue-lane", "subject": "L%d" % n,
             "since": base, "age_seconds": 93600, "age": "1d 2h",
             "detail": "lane L%d (owner Someone) is 1d 2h past its next_report_due" % n}
            for n in range(1, count + 1)]


def selftest():
    checks, failures = 0, []

    def check(condition, detail):
        nonlocal checks
        checks += 1
        if not condition:
            failures.append(detail)

    now = bl.parse_iso("2026-08-29T12:00:00Z")
    later = bl.parse_iso("2026-08-29T12:30:00Z")       # inside the hour
    much_later = bl.parse_iso("2026-08-29T14:00:00Z")  # past it

    with tempfile.TemporaryDirectory() as tmp:
        path = os.path.join(tmp, STATE_NAME)
        sent = []
        send = sent.append

        # (a) a new exception sends exactly one message
        message, _ = dispatch(fixture(1), now, path, send, MIN_SEND_INTERVAL, "board.json")
        check(len(sent) == 1, "a new exception did not send exactly one message: %r" % (sent,))
        check(message is not None and "EX" not in message.splitlines()[0],
              "the digest headline is not a count line: %r" % (message,))
        check("overdue-lane L1" in (message or ""), "the digest omits the new exception")

        # (b) the same exception on the next run sends nothing
        message, reason = dispatch(fixture(1), much_later, path, send, MIN_SEND_INTERVAL, "board.json")
        check(len(sent) == 1 and message is None,
              "an unchanged exception re-sent: %r" % (reason,))

        # (e) a quiet board produces nothing, and holds the clear for later
        message, reason = dispatch([], much_later, path, send, MIN_SEND_INTERVAL, "board.json")
        check(len(sent) == 1 and message is None, "a quiet board sent something: %r" % (reason,))
        check(load_state(path)["pending_cleared"] == ["EX-overdue-L1"],
              "the cleared id was not held for the next send")

    with tempfile.TemporaryDirectory() as tmp:
        path = os.path.join(tmp, STATE_NAME)
        sent = []

        # (c) ten new exceptions are one digest, not ten messages
        message, _ = dispatch(fixture(10), now, path, sent.append, MIN_SEND_INTERVAL, "board.json")
        check(len(sent) == 1, "ten new exceptions sent %d messages" % len(sent))
        check(message.count("\n- ") == 10, "the digest lists %d of 10 exceptions"
              % (message.count("\n- ")))

        # (d) the rate limit suppresses the next send, and holds the items
        message, reason = dispatch(fixture(11), later, path, sent.append, MIN_SEND_INTERVAL, "board.json")
        check(len(sent) == 1 and message is None, "the rate limit did not suppress: %r" % (reason,))
        check("EX-overdue-L11" not in load_state(path)["notified"],
              "a rate-limited item was marked notified and would never be sent")

        # ... and it goes out on the next allowed run
        message, reason = dispatch(fixture(11), much_later, path, sent.append, MIN_SEND_INTERVAL,
                                   "board.json")
        check(len(sent) == 2, "the suppressed item did not go out when allowed: %r" % (reason,))
        check("overdue-lane L11" in (message or ""), "the suppressed item is missing from the digest")
        check(message.count("\n- ") == 1, "the catch-up digest repeated already-notified items")

    with tempfile.TemporaryDirectory() as tmp:
        # a dry run writes no state at all
        path = os.path.join(tmp, STATE_NAME)
        message, _ = dispatch(fixture(2), now, path, None, MIN_SEND_INTERVAL, "board.json")
        check(message is not None and not os.path.exists(path),
              "a dry run wrote the state file")

    if failures:
        for failure in failures:
            print("SELFTEST FAIL: %s" % failure, file=sys.stderr)
        return 1
    print("SELFTEST PASS (%d assertions)" % checks)
    return 0


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("board", nargs="?", default=bl.default_board_path())
    parser.add_argument("--now", help="freeze the clock at this ISO time")
    parser.add_argument("--send", action="store_true", help="actually deliver (default: dry run)")
    parser.add_argument("--state", help="state file (default coordinator/%s)" % STATE_NAME)
    parser.add_argument("--min-interval", type=int, default=MIN_SEND_INTERVAL,
                        help="seconds between sends (default %d)" % MIN_SEND_INTERVAL)
    parser.add_argument("--reset", action="store_true", help="forget every notified id and exit")
    parser.add_argument("--selftest", action="store_true", help="run the built-in assertions")
    args = parser.parse_args(sys.argv[1:] if argv is None else argv)

    if args.selftest:
        return selftest()

    state_path = args.state or default_state_path(args.board)
    if args.reset:
        try:
            os.remove(state_path)
        except FileNotFoundError:
            pass
        except OSError as exc:
            print("WARN: cannot remove %s: %s" % (state_path, exc), file=sys.stderr)
            return 0
        print("OK: notify state cleared — the next run treats every exception as new")
        return 0

    try:
        board = bl.load(args.board)
    except (OSError, ValueError) as exc:
        print("FAIL: cannot read %s: %s" % (args.board, exc), file=sys.stderr)
        return 1

    now = bl.parse_iso(args.now) if args.now else bl.now_utc()
    if now is None:
        print("FAIL: --now is not ISO-8601: %r" % (args.now,), file=sys.stderr)
        return 1

    if exceptions_mod is None:
        print("WARN: exceptions.py not importable — using the board's stored "
              "'exceptions' key instead of recomputing it", file=sys.stderr)

    token = os.environ.get("TELEGRAM_BOT_TOKEN", "").strip()
    chat_id = os.environ.get("TELEGRAM_CHAT_ID", "").strip()
    sender = None
    if args.send:
        if token and chat_id:
            def sender(text):
                telegram_send(token, chat_id, text)
        else:
            print("WARN: TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID not set — dry run", file=sys.stderr)

    source = os.path.relpath(os.path.abspath(args.board),
                             os.path.dirname(bl.board_dir(args.board)))
    message, reason = dispatch(bl.board_exceptions(board, now), now, state_path, sender,
                               args.min_interval, source)

    if message is not None:
        print(message)
    if reason.startswith("WARN"):
        print("WARN: %s" % reason[4:].strip(), file=sys.stderr)
    else:
        print(reason, file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
