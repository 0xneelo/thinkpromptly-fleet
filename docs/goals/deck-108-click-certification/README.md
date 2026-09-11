# DECK-108 — deck click certification

Worker: Bernward · security-engineer. Branch `agent-bernward/deck-108`. Design of record: DECK-109 brief
`docs/research/deck-click-trust-brief-2026-09-11.md` §Amendment (1Password-signed clicks) + seat-20 rulings
(`RULINGS.md` on `claude/local-orchestrator-f378c6`), ACCEPT-1/2/3 (O20-BERNWARD-DESIGN-1), review R1–R4
(O20-BERNWARD-REVIEW-1).

## What a seat gets

A deploy-class click on an Unblock sheet is signed through the operator's 1Password SSH key (Touch ID). A seat
verifies it itself — and only on a sheet it posted itself, never on a sheet id a bus message hands it. The sheet
POST answers `{ id, url, questions: [{ id, questionSha256, pin }] }`; the seat records `questions[].pin` from its own
POST response and passes it:

```bash
node /Users/misterislez/remote-system/bin/fleetdeck-verify-answer.js <sheet-id> <qid> --pin <hex>   # --json, --allowed-signers <file>, --help
```

`--pin` is required (64 lowercase hex; missing or malformed = exit 2). The pin binds the sheet, the question id, the
question text and the sheet's own words (title, intro, project), so the seat's question copied onto a sheet an agent
posted, or the seat's own sheet retitled into a "drill", does not verify with the seat's pin. Exit 0 only when the
requested sheet, question id, served question and served sheet words reproduce the pin and the signature is valid,
unexpired and current. Exit 1: unanswered, unsigned, dismissed, timeout, error, invalid, expired, superseded,
unconfigured or pin-mismatch — `pin-mismatch`: the sheet, question id, question and sheet words the deck serves now do
not reproduce your pin (another sheet, another question, or rewritten in fleet.db after you posted it); `invalid`: the signature does not
verify, or its `expiresAt` lies more than 86400 s + 60 s ahead (the deck's maximum TTL plus clock skew — a lying deck
cannot stretch a signature's life); `superseded`: your own verify passed, but the deck does not certify this answer: a
signature this deck process did not make (made outside it, or before a restart), an older signature, a key the deck did
not boot with, or another principal. Exit 2: usage, deck unreachable, unknown sheet or question, no allowed_signers.

## The signed bytes (verbatim — seats, boxes and the lowcap coordinator verify exactly these)

```
v2|sheetId|qid|choice|answeredAt|operator_id|project|expiresAt|question_sha256
```

- Each field is escaped before the join: first `%` → `%25`, then `|` → `%7C`. Plain ids and ISO times do not change.
- `project` = the sheet's `source.project` when it is a string, else the empty string.
- `expiresAt` = ISO time of signing + `FLEET_UNBLOCK_SIG_TTL_SECS` (default 7200).
- `question_sha256` = lowercase hex SHA-256 of the UTF-8 bytes of ECMAScript `JSON.stringify(question)`, where
  `question` is the object exactly as `GET /api/unblock/:id` serves it in `sheet.questions`. Other JSON encoders
  disagree on edge cases (small floats, lone surrogates), so a seat does not recompute it with its own encoder: the
  CLI hashes the served question with ECMAScript `JSON.stringify` and uses that hash only when it reproduces the
  seat's pin.
- A field that is not well-formed UTF-16 (a lone surrogate) is never signed: its UTF-8 would be the bytes of U+FFFD.
  The sheet POST refuses one in a question id, an option key or `source.project`.
- UTF-8, no trailing newline. Signature: `ssh-keygen -Y sign`, namespace `fleetdeck-unblock`. Verify:
  `ssh-keygen -Y verify -f ~/.claude/fleet/allowed_signers -I <operator_id> -n fleetdeck-unblock -s <sig>` with the
  bytes on stdin.

The seat's pin (verbatim — `questions[].pin` in the POST response; not signed, only compared):

```
v2-pin|sheetId|qid|question_sha256|sheet_sha256
```

- The same escaping as the v2 bytes (`%` → `%25`, then `|` → `%7C`), the same refusal of a field that is not
  well-formed UTF-16, UTF-8, no trailing newline.
- `pin` = lowercase hex SHA-256 of those bytes. `question_sha256` is the hash above.
- `sheet_sha256` = lowercase hex SHA-256 of the UTF-8 bytes of ECMAScript `JSON.stringify([title, intro, project])`:
  `title` and `intro` are the sheet's as `GET /api/unblock/:id` serves them (`intro` is `''` when absent or null),
  `project` is as in the v2 bytes. The POST computes it from the row it stored (sqlite stores a lone surrogate as
  U+FFFD), so the CLI reproduces it from the GET. The v2 signed bytes do not carry it: a rewritten title changes no
  signature, only the pin.

## Rules the deck enforces

- **Fail closed (R1).** No operator file → every operator write (answer, close, reopen, send, sign) is 503
  `sign-in not configured`. The agent-facing sheet POST stays open.
- **Every operator write** needs the allowed Origin (403) AND a live session (401): an HttpOnly SameSite=Strict
  cookie plus the `x-fleetdeck-session` header token, which lives only in the deck page's memory (a page reload
  means signing in again). Browsers send cookies to every port on 127.0.0.1, so the cookie alone would leak to any
  local dev server the operator opens.
- **Sign-in** = the layer-1 password (scrypt hash in `~/.fleetdeck/operator.json`), rate-limited to 5 wrong tries
  per 60 s window (R2). Not a 1Password login: 1Password can remember an app's approval, and then a forged-Origin
  request could mint a session and a signature with no prompt. The password is generated by
  `scripts/deck-operator-init.js` (24 base64url characters, 144 bits), never chosen: the file is readable by every
  same-user agent, so its hash is open to offline guessing. The script prints it once; save it in 1Password as
  "fleetdeck deck sign-in", then press Cmd-K to clear the scrollback. It refuses to run inside tmux, screen, cmux or
  zellij (`TMUX`, `STY`, `CMUX_WORKSPACE_ID`, `CMUX_SURFACE_ID` or `ZELLIJ` set): tmux, screen and zellij keep
  scrollback, and cmux's CLI can read a tab's scrollback, all open to any same-user process. It also prints
  `operator fingerprint: <8 hex>` (the first 8 lowercase hex of SHA-256 of the stored hash), and the deck's boot line
  in `deck.log` carries the same `operator fingerprint: …`. Compare the operator fingerprint in `deck.log` with the one
  deck-operator-init printed, after every restart: a different value means the operator file was replaced.
- **Audit.** Every wrong password logs `operator: sign-in refused (wrong password)`; a rate-limit trip logs
  `operator: sign-in rate-limited (5 wrong in 60 s window, retry in <n> s)` once per window. Never the password or
  the request body.
- **No framing.** Every HTML response carries `X-Frame-Options: DENY` and `Content-Security-Policy: frame-ancestors
  'none'` (no other CSP directive), so no other page can frame the deck and steer the operator's clicks.
- **Signing** = deploy-class cards only (`deployClass: true` or an option key `deploy-*`). The deck signs only a
  click it saw: every fresh click through a signed-in session leaves an in-memory click record
  `{choice, answeredAt, operatorId}` (a clear deletes it), and `/sign` needs the stored row to equal that record
  exactly, else 409 `click not seen by this deck` — so a row written into fleet.db is never signed, even when the
  page echoes it back with "Sign now". The same choice clicked again on a row the deck has no record of is a fresh
  click. It also signs only the answer the browser names (`{choice, answeredAt, questionSha256}`),
  compare-and-set, one at a time. `questionSha256` is the hash of the question as the page loaded it; a question
  rewritten since is 409 `question changed`, nothing signed. A re-click or clear while the prompt is up stores
  nothing, even if the old row is restored in fleet.db. A dismissed or timed-out 1Password prompt is recorded
  (`sigState`), never a trigger. The op-agent signer refuses in any `CLAUDE*` environment, so a deck started from an
  agent shell can never raise a 1Password prompt. Approve a Touch ID prompt only within seconds of your own click or
  Sign now; never approve a second or unexpected prompt.
- **Certify only what this deck signed.** `sigValid` is true only for the signature this deck process stored for
  the answer. A valid operator-key signature written into fleet.db by anything else — an older one restored, or one
  a same-user process got from the 1Password agent directly — reads `superseded`. Consequence: after a deck
  restart every signature reads not current, and the operator re-signs (click again, then sign).
- **Show only what the deck saw.** Every answer view carries `clickSeen` (a strict boolean): the stored row equals
  the click this deck saw from a signed-in session. A deploy-class card whose click the deck did not see (a row
  written into fleet.db, a choice rewritten there, an answer from before a restart) shows no selection, so a
  planted choice is never presented as the operator's answer and never lures a same-choice click.
- **Send** carries a pointer only: `{sheet, sheetId, title, qids}`. Its text tells the seat to act only on a sheet
  it posted itself, with the pin from its own POST; it never names the id to verify.

## Configuration (deck)

| Env | Default | Meaning |
|---|---|---|
| `FLEET_OPERATOR_FILE` | `~/.fleetdeck/operator.json` | password hash + operator id; missing = fail closed; broken = deck exits |
| `FLEET_ALLOWED_SIGNERS` | `~/.claude/fleet/allowed_signers` | the operator's public key; the deck signs with and verifies against it |
| `FLEET_UNBLOCK_SIGNER` | `op-agent` | `op-agent` (1Password socket) · `file:<private key>` (dev/tests) · `off` |
| `FLEET_UNBLOCK_SIG_TTL_SECS` | `7200` | signature lifetime, 60…86400; unset or outside that range = 7200 |

## Operator gate (one issue, in order — exact commands)

See `LINEAR-PENDING.md` item 3. After the branch is woven to main and before the deck restart.

## Residual risks (recorded by seat 20 as a follow-up decision, out of this lane)

- `~/.claude/fleet/allowed_signers`, the verifier, node and the seats' dotfiles are user-writable: a deliberately
  hostile same-user agent can swap them. Follow-up: a root-owned install of the anchor and the verifier.
- An agent driving the operator's signed-in browser (Claude in Chrome) can click like the operator. Keep
  `localhost:3131` / `127.0.0.1:3131` off the extension's allowed sites.
- If 1Password remembers the deck's approval, the Touch ID prompt may not appear on every click; the session is
  then the gate for signing.
