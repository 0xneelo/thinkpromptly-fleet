# DECK-108 — deck click certification

Worker: Bernward · security-engineer. Branch `agent-bernward/deck-108`. Design of record: DECK-109 brief
`docs/research/deck-click-trust-brief-2026-09-11.md` §Amendment (1Password-signed clicks) + seat-20 rulings
(`RULINGS.md` on `claude/local-orchestrator-f378c6`), ACCEPT-1/2/3 (O20-BERNWARD-DESIGN-1), review R1–R4
(O20-BERNWARD-REVIEW-1).

## What a seat gets

A deploy-class click on an Unblock sheet is signed through the operator's 1Password SSH key (Touch ID). A seat
verifies it itself:

```bash
node /Users/misterislez/remote-system/bin/fleetdeck-verify-answer.js <sheet-id> <qid>   # --json, --allowed-signers <file>, --help
```

Exit 0 only when the signature is valid, unexpired and current. Exit 1: unanswered, unsigned, dismissed, timeout,
error, invalid, expired, superseded or unconfigured — `superseded`: your own verify passed, but the deck does not
certify this answer: an older signature, a key the deck did not boot with, or another principal. Exit 2: usage, deck unreachable,
unknown sheet or question, no allowed_signers.

## The signed bytes (verbatim — seats, boxes and the lowcap coordinator verify exactly these)

```
v2|sheetId|qid|choice|answeredAt|operator_id|project|expiresAt|question_sha256
```

- Each field is escaped before the join: first `%` → `%25`, then `|` → `%7C`. Plain ids and ISO times do not change.
- `project` = the sheet's `source.project` when it is a string, else the empty string.
- `expiresAt` = ISO time of signing + `FLEET_UNBLOCK_SIG_TTL_SECS` (default 7200).
- `question_sha256` = lowercase hex SHA-256 of the UTF-8 bytes of `JSON.stringify(question)`, where `question` is
  the object exactly as `GET /api/unblock/:id` returns it in `sheet.questions` (Python:
  `json.dumps(q, separators=(',', ':'), ensure_ascii=False)`).
- UTF-8, no trailing newline. Signature: `ssh-keygen -Y sign`, namespace `fleetdeck-unblock`. Verify:
  `ssh-keygen -Y verify -f ~/.claude/fleet/allowed_signers -I <operator_id> -n fleetdeck-unblock -s <sig>` with the
  bytes on stdin.

## Rules the deck enforces

- **Fail closed (R1).** No operator file → every operator write (answer, close, reopen, send, sign) is 503
  `sign-in not configured`. The agent-facing sheet POST stays open.
- **Every operator write** needs the allowed Origin (403) AND a live session (401): an HttpOnly SameSite=Strict
  cookie plus the `x-fleetdeck-session` header token from the page's origin-scoped storage. Browsers send cookies to
  every port on 127.0.0.1, so the cookie alone would leak to any local dev server the operator opens.
- **Sign-in** = the layer-1 password (scrypt hash in `~/.fleetdeck/operator.json`), rate-limited to 5 wrong tries
  per 60 s window (R2). Not a 1Password login: 1Password can remember an app's approval, and then a forged-Origin
  request could mint a session and a signature with no prompt.
- **Signing** = deploy-class cards only (`deployClass: true` or an option key `deploy-*`). The deck signs only the
  answer the browser names (`{choice, answeredAt, questionSha256}`), compare-and-set, one at a time.
  `questionSha256` is the hash of the question as the page loaded it; a question rewritten since is 409
  `question changed`, nothing signed. A re-click or clear while the prompt is up stores nothing, even if the old
  row is restored in fleet.db. A dismissed or timed-out 1Password prompt is recorded (`sigState`), never a trigger. The op-agent signer refuses in any `CLAUDE*`
  environment, so a deck started from an agent shell can never raise a 1Password prompt.
- **Rollback guard.** While the deck runs, an older signature restored into fleet.db reads `superseded`.
- **Send** carries a pointer only: `{sheet, sheetId, title, qids}`.

## Configuration (deck)

| Env | Default | Meaning |
|---|---|---|
| `FLEET_OPERATOR_FILE` | `~/.fleetdeck/operator.json` | password hash + operator id; missing = fail closed; broken = deck exits |
| `FLEET_ALLOWED_SIGNERS` | `~/.claude/fleet/allowed_signers` | the operator's public key; the deck signs with and verifies against it |
| `FLEET_UNBLOCK_SIGNER` | `op-agent` | `op-agent` (1Password socket) · `file:<private key>` (dev/tests) · `off` |
| `FLEET_UNBLOCK_SIG_TTL_SECS` | `7200` | signature lifetime |

## Operator gate (one issue, in order — exact commands)

See `LINEAR-PENDING.md` item 3. After the branch is woven to main and before the deck restart.

## Residual risks (recorded by seat 20 as a follow-up decision, out of this lane)

- `~/.claude/fleet/allowed_signers`, the verifier, node and the seats' dotfiles are user-writable: a deliberately
  hostile same-user agent can swap them. Follow-up: a root-owned install of the anchor and the verifier.
- An agent driving the operator's signed-in browser (Claude in Chrome) can click like the operator. Keep
  `localhost:3131` / `127.0.0.1:3131` off the extension's allowed sites.
- The rollback guard lives in deck memory; after a restart a restored older signature is bounded only by `expiresAt`.
- If 1Password remembers the deck's approval, the Touch ID prompt may not appear on every click; the session is
  then the gate for signing.
