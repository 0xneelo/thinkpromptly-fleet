#!/usr/bin/env python3
"""Render board.json into one self-contained board.html for fleetdeck (v0.2 M3).

Usage: python3 coordinator/render.py [board.json] [--out public/board.html]
                                     [--now ISO] [--stdout]

The glance surface. Everything is inlined — no CDN, no fetch, no external asset —
so the page opens from a file:// path exactly as it opens off fleetdeck, and no
JavaScript is needed to read it.

DESIGN §4 governs the layout: one screen, fixed spatial slots, rows never
reshuffle (lanes render in board order, always). Exceptions are pinned above
everything; `done-claimed` and `done-verified` are drawn differently and never
collapsed; `reported_at` and `verified_at` age separately, with no global
"last updated" clock. The page is stamped with the git commit and the generated
time so a stamp/head mismatch makes staleness visible rather than prevented.
"""

import argparse
import html
import json
import os
import subprocess
import sys

import board_lib as bl

try:
    import exceptions as exceptions_mod
except ImportError:  # exceptions.py is M1 and may not have landed yet
    exceptions_mod = None

# How dim a lane goes as `reported_at` ages past its own cadence. The last band
# is deliberately hard to read: a lane nobody has spoken for in two cadences has
# nothing to say that is worth reading at a glance.
STALE_BANDS = ((0.5, "fresh"), (1.0, "aging"), (2.0, "stale"), (None, "dark"))

# One line per state, shown in the legend. The wording is the whole point of the
# state, compressed — a rotating seat reads it once and never asks again.
STATE_NOTE = {
    "active": "someone is on it",
    "blocked": "stopped, blocker listed",
    "done-claimed": "self-reported — NOT verified, no green",
    "done-verified": "attested against evidence",
    "DISPUTED": "two attestations conflict — only the operator rules",
    "UNKNOWN": "no signal; the dead-man switch flipped it",
    "closed": "owes nothing",
}


def esc(value):
    """Any board value as safe HTML text; None and "" become an em dash."""
    if value is None or (isinstance(value, str) and not value.strip()):
        return "—"
    return html.escape(str(value).strip())


def git_stamp(path):
    """Short HEAD of the repo holding `path`, or 'unknown' outside a repo.

    Never raises: an unstamped page is worse than an unknown-stamped one, but a
    renderer that dies because it ran outside git is worse than both.
    """
    try:
        out = subprocess.run(["git", "rev-parse", "--short", "HEAD"],
                             cwd=os.path.dirname(os.path.abspath(path)),
                             stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                             timeout=5, check=False)
    except (OSError, subprocess.SubprocessError):
        return "unknown"
    stamp = out.stdout.decode("utf-8", "replace").strip()
    return stamp if out.returncode == 0 and stamp else "unknown"


def relative(seconds):
    """'2h ago' / 'in 4h' / 'unknown' — a clock the eye reads without arithmetic."""
    if seconds is None:
        return "unknown"
    if seconds < 0:
        return "in %s" % bl.humanize_age(-seconds)
    return "%s ago" % bl.humanize_age(seconds)


def cadence_seconds(lane, board):
    """The lane's own cadence: due minus reported when both exist, else policy."""
    reported = bl.parse_iso(lane.get("reported_at"))
    due = bl.parse_iso(lane.get("next_report_due"))
    if reported and due and due > reported:
        return int((due - reported).total_seconds())
    return bl.policy(board)["default_cadence_hours"] * 3600


def staleness(age, cadence):
    """Band name for an age measured in cadences; 'dark' when the age is unknown."""
    if age is None or cadence <= 0:
        return "dark"
    ratio = max(age, 0) / float(cadence)
    for limit, name in STALE_BANDS:
        if limit is None or ratio < limit:
            return name
    return "dark"


# --- sections -------------------------------------------------------------
# Each returns a finished block of HTML. They run in slot order and the slots
# never move, so the operator's eye lands in the same place every time.

def northstar_html(board):
    star = board.get("northstar") if isinstance(board.get("northstar"), dict) else {}
    proposed = star.get("seed") == "PROPOSED" or not star.get("ruling_id")
    # Ruling R2: a PROPOSED northstar binds nothing until the operator states it,
    # so the page says PROPOSED in words rather than implying a standing order.
    badge = ('<span class="tag proposed">PROPOSED — binds nothing</span>' if proposed
             else '<span class="tag ruled">stated</span>')
    cite = "ruling %s · confirmed %s" % (esc(star.get("ruling_id")), esc(star.get("confirmed_at")))
    return ('<section class="slot northstar">'
            '<h2>Northstar %s</h2>'
            '<p class="star">%s</p>'
            '<p class="cite">%s</p>'
            '</section>' % (badge, esc(star.get("text")), cite))


def exceptions_html(found):
    """The pinned slot. Empty renders a stated calm line, never a gap — an absent
    section and a computed-empty one must not look alike."""
    if not found:
        return ('<section class="slot exceptions calm">'
                '<h2>Exceptions <span class="count">0</span></h2>'
                '<p class="none">No exceptions. Every lane is inside its cadence, every '
                'done-claim is attested or young, and no queue item has expired.</p>'
                '</section>')

    rows = []
    for item in found:
        kind = item.get("kind") if isinstance(item.get("kind"), str) else "unknown"
        rows.append('<li class="ex ex-%s">'
                    '<span class="ex-kind">%s</span>'
                    '<span class="ex-subject">%s</span>'
                    '<span class="ex-age">%s</span>'
                    '<span class="ex-detail">%s</span>'
                    '<span class="ex-id">%s</span>'
                    '</li>'
                    % (html.escape(kind), esc(kind),
                       esc(item.get("subject")), esc(item.get("age")),
                       esc(item.get("detail")), esc(item.get("id"))))
    return ('<section class="slot exceptions live">'
            '<h2>Exceptions <span class="count">%d</span></h2>'
            '<ul class="ex-list">%s</ul>'
            '</section>' % (len(found), "".join(rows)))


def queue_html(board, now):
    items = [item for item in board.get("operator_queue", []) if isinstance(item, dict)] \
        if isinstance(board.get("operator_queue"), list) else []
    if not items:
        return ('<section class="slot queue"><h2>Operator queue <span class="count">0</span></h2>'
                '<p class="none">Nothing waiting on the operator.</p></section>')

    rows = []
    for item in items:
        age = bl.age_seconds(item.get("opened_at"), now)
        left = bl.age_seconds(item.get("deadline"), now)
        overdue = left is not None and left > 0
        rows.append('<li class="qi%s">'
                    '<div class="qi-head"><span class="qi-id">%s</span>'
                    '<span class="qi-age">open %s</span></div>'
                    '<div class="qi-item">%s</div>'
                    '<div class="qi-foot"><span class="qi-due%s">deadline %s · %s</span>'
                    '<span class="qi-default">on expiry: %s</span></div>'
                    '</li>'
                    % (" expired" if overdue else "", esc(item.get("id")),
                       bl.humanize_age(age) if age is not None else "unknown",
                       esc(item.get("item")),
                       " over" if overdue else "",
                       esc(item.get("deadline")),
                       "EXPIRED %s" % bl.humanize_age(left) if overdue else relative(left),
                       esc(item.get("default"))))
    return ('<section class="slot queue"><h2>Operator queue <span class="count">%d</span></h2>'
            '<ol class="qi-list">%s</ol></section>' % (len(items), "".join(rows)))


def clock_html(label, stamp, age, extra=""):
    return ('<div class="clock%s"><span class="ck-label">%s</span>'
            '<span class="ck-rel">%s</span><span class="ck-abs">%s</span></div>'
            % (extra, label, relative(age), esc(stamp)))


def lane_html(lane, board, now):
    state = lane.get("state") if lane.get("state") in bl.STATES else "UNKNOWN"
    cadence = cadence_seconds(lane, board)
    reported = bl.age_seconds(lane.get("reported_at"), now)
    verified = bl.age_seconds(lane.get("verified_at"), now)
    due = bl.age_seconds(lane.get("next_report_due"), now)
    band = staleness(reported, cadence)

    # DESIGN §4: a verified stamp is a decaying assertion. Past the lane's own
    # cadence it is struck through — the lane is not verified now, it *was*.
    if lane.get("verified_at") is None:
        verified_slot = ('<div class="clock never"><span class="ck-label">verified</span>'
                         '<span class="ck-rel">never</span>'
                         '<span class="ck-abs">no attestation</span></div>')
    elif verified is not None and verified > cadence:
        verified_slot = clock_html("verified", lane.get("verified_at"), verified, " expired")
    else:
        verified_slot = clock_html("verified", lane.get("verified_at"), verified)

    blockers = [b for b in lane.get("blockers", [])] if isinstance(lane.get("blockers"), list) else []
    blocker_html = "".join('<li>%s</li>' % esc(b) for b in blockers) or '<li class="none">none</li>'
    evidence = [e for e in lane.get("evidence", [])] if isinstance(lane.get("evidence"), list) else []
    ev_html = " · ".join(esc(e) for e in evidence) if evidence else "no evidence pointer"

    seed = ('<span class="tag proposed">PROPOSED</span>'
            if lane.get("seed") == "PROPOSED" else "")

    return ('<li class="lane state-%s band-%s">'
            '<div class="lane-id"><span class="lid">%s</span>'
            '<span class="badge b-%s">%s</span>%s'
            '<span class="lane-owner">%s</span></div>'
            '<div class="lane-body">'
            '<div class="goal">%s</div>'
            '<div class="milestone"><span class="k">done when</span>%s</div>'
            '<div class="blockers"><span class="k">blockers (%d)</span><ul>%s</ul></div>'
            '<div class="next"><span class="k">next decision</span>%s</div>'
            '<div class="evidence"><span class="k">evidence</span>%s</div>'
            '</div>'
            '<div class="lane-clocks">%s%s%s<div class="cadence">cadence %s</div></div>'
            '</li>'
            % (state.replace("-", "_"), band, esc(lane.get("id")),
               state.replace("-", "_"), esc(state), seed, esc(lane.get("owner")),
               esc(lane.get("goal")), esc(lane.get("done_milestone")),
               len(blockers), blocker_html, esc(lane.get("next_decision")), ev_html,
               clock_html("reported", lane.get("reported_at"), reported),
               verified_slot,
               clock_html("due", lane.get("next_report_due"), due,
                          " over" if due is not None and due > 0 else ""),
               bl.humanize_age(cadence)))


def lanes_html(board, now):
    lanes = [l for l in board.get("lanes", []) if isinstance(l, dict)] \
        if isinstance(board.get("lanes"), list) else []
    cap = board.get("lane_cap") if isinstance(board.get("lane_cap"), int) else len(lanes)
    rows = "".join(lane_html(lane, board, now) for lane in lanes)
    return ('<section class="slot lanes"><h2>Lanes <span class="count">%d / %d</span></h2>'
            '<ol class="lane-list">%s</ol></section>' % (len(lanes), cap, rows or
                                                         '<li class="none">no lanes</li>'))


def legend_html():
    items = "".join('<span class="lg"><span class="badge b-%s">%s</span>%s</span>'
                    % (state.replace("-", "_"), state, note)
                    for state, note in STATE_NOTE.items())
    return ('<section class="slot legend"><h2>States</h2><div class="lg-row">%s</div>'
            '<p class="cite">Lanes dim as <code>reported_at</code> ages past the lane\'s own '
            'cadence: full · aging · stale · dark. A struck-through <code>verified</code> stamp '
            'is past its cadence and no longer asserts anything.</p></section>' % items)


CSS = """
:root {
  --bg:#262624; --card:#1a1915; --bar:#21201d; --line:rgba(255,255,255,.08);
  --text:#c2c0b6; --strong:#e8e6dc; --muted:#9b9892; --coral:#d97757;
  --green:#7cba7c; --amber:#d9a441; --blue:#7fb2d9; --red:#e0574f; --violet:#a98cd9;
  --mono:ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,monospace;
}
* { box-sizing:border-box; }
body {
  margin:0; background:var(--bg); color:var(--text);
  font:13px/1.45 -apple-system,BlinkMacSystemFont,system-ui,"Segoe UI",sans-serif;
  -webkit-font-smoothing:antialiased;
}
.page { max-width:1500px; margin:0 auto; padding:14px 18px 24px; }
h2 { font:600 11px/1 var(--mono); letter-spacing:.14em; text-transform:uppercase;
     color:var(--muted); margin:0 0 8px; }
.count { color:var(--strong); letter-spacing:0; margin-left:6px; }
.slot { background:var(--card); border:1px solid var(--line); border-radius:8px;
        padding:12px 14px; margin-bottom:12px; }
.none { color:var(--muted); margin:0; }
.cite { color:var(--muted); font:11px/1.4 var(--mono); margin:6px 0 0; }
code { font:11px var(--mono); color:var(--muted); }

/* stamp — a mismatch against the deployed HEAD is the staleness signal */
.stamp { display:flex; flex-wrap:wrap; gap:14px; align-items:baseline;
         padding:8px 14px; background:var(--bar); border:1px solid var(--line);
         border-radius:8px; margin-bottom:12px; font:11px var(--mono); color:var(--muted); }
.stamp .title { font:600 13px/1 var(--mono); letter-spacing:.16em; text-transform:uppercase;
                color:var(--strong); }
.stamp b { color:var(--text); font-weight:600; }

.tag { font:600 10px var(--mono); letter-spacing:.08em; padding:2px 6px; border-radius:4px;
       margin-left:8px; vertical-align:middle; }
.tag.proposed { color:var(--amber); border:1px dashed var(--amber); }
.tag.ruled { color:var(--green); border:1px solid var(--green); }

/* 1 — northstar, physically separate from shift state */
.northstar { border-left:3px solid var(--coral); }
.star { color:var(--strong); font-size:15px; margin:0; }

/* 2 — exceptions, pinned above everything */
.exceptions.live { border:1px solid var(--red); background:#231816; }
.exceptions.calm { border-left:3px solid var(--green); }
.ex-list { list-style:none; margin:0; padding:0; }
.ex { display:grid; grid-template-columns:150px 68px 62px 1fr 190px; gap:10px;
      align-items:baseline; padding:6px 0; border-top:1px solid var(--line); }
.ex:first-child { border-top:0; }
.ex-kind { font:600 11px var(--mono); color:var(--red); letter-spacing:.04em; }
.ex-subject { font:600 12px var(--mono); color:var(--strong); }
.ex-age { font:12px var(--mono); color:var(--amber); }
.ex-detail { color:var(--text); }
.ex-id { font:10px var(--mono); color:var(--muted); text-align:right; }
.ex-disputed-lane .ex-kind { color:#ff7a70; }

/* 3+4 — queue beside lanes; both slots keep their position on every render */
.cols { display:grid; grid-template-columns:minmax(280px,1fr) 2.1fr; gap:12px;
        align-items:start; }
.cols .slot { margin-bottom:0; }
.qi-list { list-style:none; margin:0; padding:0; }
.qi { padding:8px 0; border-top:1px solid var(--line); }
.qi:first-child { border-top:0; }
.qi-head, .qi-foot { display:flex; justify-content:space-between; gap:10px;
                     font:11px var(--mono); color:var(--muted); }
.qi-id { color:var(--strong); font-weight:600; }
.qi-item { color:var(--text); margin:3px 0; }
.qi-due.over { color:var(--red); font-weight:600; }
.qi.expired { border-left:3px solid var(--red); padding-left:8px; }

.lane-list { list-style:none; margin:0; padding:0; }
.lane { display:grid; grid-template-columns:190px 1fr 210px; gap:12px;
        padding:10px 0 10px 10px; border-top:1px solid var(--line);
        border-left:3px solid var(--muted); }
.lane:first-child { border-top:0; }
.lid { font:600 14px var(--mono); color:var(--strong); }
.lane-owner { display:block; color:var(--muted); font-size:11px; margin-top:4px; }
.lane-body .k { display:block; font:10px var(--mono); letter-spacing:.1em;
                text-transform:uppercase; color:var(--muted); margin-top:6px; }
.goal { color:var(--strong); }
.lane-body ul { margin:2px 0 0; padding-left:16px; }
.lane-body li.none { list-style:none; margin-left:-16px; }
.evidence { font:11px var(--mono); word-break:break-all; }
.lane-clocks { font:11px var(--mono); }
.clock { display:grid; grid-template-columns:60px 1fr; gap:4px; padding:2px 0; }
.ck-label { color:var(--muted); }
.ck-rel { color:var(--text); }
.ck-abs { grid-column:2; color:var(--muted); font-size:10px; }
.clock.never .ck-rel { color:var(--amber); }
.clock.over .ck-rel { color:var(--red); font-weight:600; }
.clock.expired .ck-rel, .clock.expired .ck-abs { color:var(--red);
        text-decoration:line-through; }
.clock.expired .ck-label::after { content:" exp"; color:var(--red); }
.cadence { color:var(--muted); margin-top:6px; }

/* states — done_claimed must never read as green */
.badge { display:inline-block; font:600 10px var(--mono); letter-spacing:.08em;
         padding:2px 7px; border-radius:4px; margin-left:8px; }
.b-active { color:var(--blue); border:1px solid var(--blue); }
.b-blocked { color:var(--amber); border:1px solid var(--amber); }
.b-done_claimed { color:#20120c; border:1px solid var(--coral); font-weight:700;
  background:repeating-linear-gradient(135deg,var(--coral) 0 6px,#8a4229 6px 12px); }
.b-done_verified { color:#10200f; background:var(--green); border:1px solid var(--green); }
.b-DISPUTED { color:#fff; background:var(--red); border:1px solid var(--red); }
.b-UNKNOWN { color:var(--violet); border:1px dashed var(--violet); }
.b-closed { color:var(--muted); border:1px solid var(--muted); }
.state-active { border-left-color:var(--blue); }
.state-blocked { border-left-color:var(--amber); }
.state-done_claimed { border-left-color:var(--coral); background:rgba(217,119,87,.06); }
.state-done_verified { border-left-color:var(--green); }
.state-DISPUTED { border-left-color:var(--red); background:rgba(224,87,79,.1); }
.state-UNKNOWN { border-left-color:var(--violet); border-left-style:dashed; }
.state-closed { border-left-color:var(--muted); }

/* staleness — dimming is progressive, and exceptions are never dimmed */
.band-fresh { opacity:1; }
.band-aging { opacity:.82; }
.band-stale { opacity:.62; }
.band-dark { opacity:.44; }
.lane:hover { opacity:1; }

.lg-row { display:flex; flex-wrap:wrap; gap:14px; }
.lg { color:var(--muted); font-size:11px; }
.lg .badge { margin:0 6px 0 0; }
@media (max-width:1000px) { .cols { grid-template-columns:1fr; } .ex { grid-template-columns:1fr; }
  .ex-id, .ex-detail { text-align:left; } .lane { grid-template-columns:1fr; } }
"""


def render(board, now, stamp, source):
    found = bl.board_exceptions(board, now)
    # Inlined for anyone reading the page as data; the visible board above is
    # pre-rendered HTML, so nothing here is load-bearing and no JS runs.
    payload = json.dumps({"board": board, "exceptions": found, "generated_at": bl.to_iso(now),
                          "commit": stamp}, ensure_ascii=False).replace("</", "<\\/")
    head = ('<div class="stamp"><span class="title">Coordinator board</span>'
            '<span>commit <b>%s</b></span><span>generated <b>%s</b></span>'
            '<span>source <b>%s</b></span>'
            '<span>a stamp older than fleetdeck\'s HEAD means this page is stale — '
            'the board is <code>coordinator/board.json</code></span></div>'
            % (esc(stamp), esc(bl.to_iso(now)), esc(source)))

    return ("<!doctype html>\n<html lang=\"en\"><head><meta charset=\"utf-8\">"
            "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">"
            "<title>coordinator board · %s</title><style>%s</style></head>"
            "<body><div class=\"page\">%s%s%s"
            "<div class=\"cols\">%s%s</div>%s</div>"
            "<script type=\"application/json\" id=\"board-data\">%s</script>"
            "</body></html>\n"
            % (esc(stamp), CSS, head, northstar_html(board), exceptions_html(found),
               queue_html(board, now), lanes_html(board, now), legend_html(), payload))


def default_out(board_path):
    return os.path.join(os.path.dirname(bl.board_dir(board_path)), "public", "board.html")


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("board", nargs="?", default=bl.default_board_path())
    parser.add_argument("--out", help="output path (default public/board.html beside coordinator/)")
    parser.add_argument("--now", help="freeze the clock at this ISO time")
    parser.add_argument("--stdout", action="store_true", help="print the HTML, write no file")
    args = parser.parse_args(sys.argv[1:] if argv is None else argv)

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
        print("WARN: exceptions.py not importable — rendering the board's stored "
              "'exceptions' key instead of recomputing it", file=sys.stderr)

    stamp = git_stamp(args.board)
    if stamp == "unknown":
        print("WARN: no git commit available — the page stamp reads 'unknown'", file=sys.stderr)

    source = os.path.relpath(os.path.abspath(args.board), os.path.dirname(bl.board_dir(args.board)))
    page = render(board, now, stamp, source)

    if args.stdout:
        sys.stdout.write(page)
        return 0

    out = args.out or default_out(args.board)
    try:
        os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
        with open(out, "w", encoding="utf-8") as handle:
            handle.write(page)
    except OSError as exc:
        print("FAIL: cannot write %s: %s" % (out, exc), file=sys.stderr)
        return 1

    lanes = board.get("lanes") if isinstance(board.get("lanes"), list) else []
    print("OK: wrote %s — %d bytes, %d lanes, %d exceptions, stamp %s"
          % (out, len(page.encode("utf-8")), len(lanes),
             len(bl.board_exceptions(board, now)), stamp))
    return 0


if __name__ == "__main__":
    sys.exit(main())
