# Coordinator v0.2 — surfaces (M3 glance, M4 push)

Two ways the board reaches the operator without them asking: a page they already
have open, and a message when something changes. Both read `coordinator/board.json`
and neither writes it.

## Glance — `public/board.html`

```sh
python3 coordinator/render.py                       # writes public/board.html
python3 coordinator/render.py --stdout               # print, write nothing
python3 coordinator/render.py --now 2026-08-29T12:00:00Z   # frozen clock
python3 coordinator/render.py path/to/board.json --out /tmp/board.html
```

Regenerate it after every coordinator run that changes the board, and commit the
result: the HTML is a derived artefact, but it is the artefact fleetdeck serves.

**Where fleetdeck serves it from.** `server.js` serves any file under `public/`
generically, so `public/board.html` is live at `/board.html` with no server change.
The page is fully self-contained — inlined CSS, pre-rendered HTML, no CDN, no
fetch, no external asset — so it opens identically from a `file://` path.

**The stamp.** The header carries the short git commit and the generated time.
A stamp older than the deck's HEAD means the page is stale (DESIGN §4: make
staleness visible rather than prevent it). Outside a repo the stamp reads
`unknown` and the run warns on stderr; it never fails.

**What the layout guarantees** (DESIGN §4 — fixed spatial slots, rows never
reshuffle, so a rotating seat re-orients in seconds):

| Slot | Contents |
|---|---|
| 1 | Stamp: commit, generated time, source board |
| 2 | Northstar, alone — a `PROPOSED` seed says PROPOSED and binds nothing (R2) |
| 3 | **Exceptions, pinned above everything.** Empty renders a stated calm line, never a gap |
| 4a | Operator queue: age open, deadline, and the default that stands on expiry |
| 4b | Lanes, **in board order, always** — never sorted by state or age |
| 5 | State legend and the dimming key |

`done-claimed` is drawn in hatched coral and never green; `done-verified` is solid
green; `DISPUTED` is a red-filled badge on a red-tinted row; `UNKNOWN` is a dashed
violet badge on a dashed row. The four are unmistakable at arm's length and are
never collapsed together (DESIGN §4: LLM false-completion is measured behaviour).

`reported_at` and `verified_at` age separately and there is no global "last
updated" clock. A lane dims progressively as `reported_at` passes its own cadence
(`next_report_due − reported_at`, else the policy default): full, aging, stale,
dark. A `verified_at` older than that cadence is struck through — a verified stamp
is a decaying assertion.

## Push — `coordinator/notify.py`

```sh
python3 coordinator/notify.py                       # DRY RUN: print, write nothing
python3 coordinator/notify.py --send                # deliver, then record what was sent
python3 coordinator/notify.py --reset               # forget every notified id
python3 coordinator/notify.py --selftest            # frozen clock, temp state
```

**Env contract.** `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID`, read from the
environment only. If either is unset, or `--send` is absent, the run is a dry run:
it prints the exact message and changes no state. The token never appears in
argv, in the state file, or in a logged URL.

**State file.** `coordinator/.notify-state.json` (override with `--state`),
gitignored. It holds only `notified` ids, `pending_cleared` ids and `last_send_at`
— no board content and no credentials. Deleting it is safe: the next run treats
every current exception as new, which costs one duplicate digest.

**Transitions, not heartbeats.** A message goes out only for an exception `id`
that this run has and the last run did not. `id` is `EX-<kind>-<subject>` and is
stable across runs, so a persisting exception is silent from the second run on. A
quiet board sends nothing.

**Cleared items.** Reported as one quieter `CLEARED (n): …` line inside the next
real notification. A run where things only cleared sends nothing — the ids are
held in `pending_cleared` until there is real news to carry them. An exception
that reappears cancels its own pending clear.

**Digest.** One message per run, whatever the count: ten new exceptions are ten
lines in one message. Over twelve, the rest are counted (`+N more — see the
board`), and the whole message is capped under Telegram's 4096-char limit.

**Rate limit.** `MIN_SEND_INTERVAL` = 3600 s (`--min-interval`), recorded as
`last_send_at`. A suppressed send marks nothing as notified, so the held items go
out with the next allowed run rather than being lost. A muted channel has negative
value; a bad day must not produce a flood.

**Never on a critical path** (DESIGN §2). A delivery failure prints one `WARN:`
line to stderr and exits 0, marking nothing as notified so the next run retries.

## Not in v0.2

**Button-ack is v0.3.** DESIGN §9.3 sequences notify first and button-ack second,
and the v0.2 scope proposal lists it under "Explicitly OUT". The message says so
in its own last line: rule in the portal or in Linear. Delivery is not
acknowledgement, and nothing here waits on a reply.
