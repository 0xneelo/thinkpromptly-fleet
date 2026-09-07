# GK-D — Luitpold · backend-developer — the deck refuses messages to 🥅

Goal G3 · lane [lane-luitpold-deck.md](../lane-luitpold-deck.md) · pending issues P6–P11 in
[LINEAR-PENDING.md](../LINEAR-PENDING.md). Branch `agent-goalkeeper-deck` on the german-box.

**Status: done.** goal.md items 7–8 hold. The refusal is committed but **not live** — it reaches
the running deck at the operator's next `./up.sh` (already tracked as P5).

## Branch

| | |
|---|---|
| Branch | `agent-goalkeeper-deck` |
| `88d7593` | skill isolation lines + pending entries P6–P10 |
| `978b7e0` | the choke point, the bus change, `test/goalkeeper-refusal.test.js`, P11 |
| `PUSHED_SHA` | this report |

## Tests

`npm test` → `node --test --test-concurrency=1 test/*.test.js`.

| | tests | pass | fail |
|---|---|---|---|
| Before | 229 | 229 | 0 |
| After | 237 | 236 | 1 |

The one failure is **not a regression**: `test/train-broker.test.js` died on
`EADDRINUSE 127.0.0.1:34974`, the known port contention from sibling sessions on this box. Re-run
alone it is **16 pass / 0 fail**. An earlier full run of the same tree was 237/237. The eight new
goalkeeper cases pass in every run.

## The server.js hunk

One choke point, in `deliverDesktopSession`, immediately after the row is resolved and before the
peer key is read:

```js
const GOALKEEPER_DIR = path.join(HOME, '.claude', 'goalkeeper').toLowerCase();
function isGoalkeeper(row) {
  if (row.name.replace(/^[\s\p{Cf}]+/u, '').startsWith('🥅')) return true;
  const cwd = typeof row.cwd === 'string' && row.cwd ? path.resolve(row.cwd).toLowerCase() : '';
  return cwd === GOALKEEPER_DIR || cwd.startsWith(GOALKEEPER_DIR + path.sep);
}
```

```js
  if (!row) throw new Error('Claude Desktop session "' + name + '" is not live');
  if (isGoalkeeper(row)) {
    // `source` is the sender's own `from` text off the wire: logged for the audit trail,
    // quoted so it cannot forge a log line, and trusted for nothing.
    console.log('goalkeeper refused a message from ' + JSON.stringify(message.source) + ' to ' + JSON.stringify(row.name));
    const error = new Error('goalkeeper accepts no messages');
    error.code = 403;
    error.refused = true;
    throw error;
  }
```

Two supporting changes were needed to make that 403 reach a caller:

1. **`desktopSessions()` now carries `cwd`.** The `<pid>.json` records already hold it; the
   function dropped it. No existing consumer spreads a row (`server.js:2340` and
   `desktop-sessions.js view()` both pick fields by name), so the field is exposed nowhere.
2. **`message-bus.js deliverOne` rethrows a refusal.** It swallowed *every* delivery error into
   `status:'failed'` and answered HTTP 200 — no 403 could have survived it. A refusal is a verdict,
   not a transport failure, so it is recorded like any failure and then rethrown; both HTTP catch
   blocks already map `error.code` onto the status. Transport errors behave exactly as before.
   `enqueue`'s `.finally()` chain gained a `.catch()` because that derived promise can now reject,
   and an unhandled rejection there would take the deck down.

Both tests deliberately read wide. The badge check strips invisible format characters — a
zero-width space before 🥅 walked straight past a bare `startsWith` — and the cwd compare folds
case for the Mac's case-insensitive filesystem. Refusing one message too many is harmless;
missing one is not.

## Callers covered

All three inherit the refusal because all three deliver through `deliverDesktopSession`:
`/api/notify` (`notifySend`), loopback `POST /api/messages`, and the sessions page (which posts to
`/api/messages` at `public/sessions.js:150`). A refused notify throws before `notifyInsert`, so it
leaves no notify row and never arms `notifyRetry`.

`test/goalkeeper-refusal.test.js` — 8 cases over real HTTP against a spawned server with a private
`CLAUDE_SESSIONS_DIR`, so it can never resolve against the operator's live seats:

1. `POST /api/messages` to a 🥅 row → 403, and the row records as `failed`.
2. `POST /api/notify` to a 🥅 row → same 403.
3. an ordinary name with `cwd` = the goalkeeper dir → 403.
4. **control:** a `🎛 ORCHESTRATOR` row still delivers, with the auth frame observed on the socket.
5. `id:<uuid>` of a 🥅 row → 403.
6. a zero-width space before the badge does not bypass it.
7. a case-variant spelling of the goalkeeper dir is still refused.
8. the `current` gap, pinned — see below.

Cases 6 and 7 were mutation-checked against the un-hardened predicate and fail without it, so
neither is a tautology.

## The two skill lines

Appended to the hard-nevers section of each — `.claude/skills/coordinator-portal/SKILL.md:133`
(§6 Inherited hard nevers) and `.claude/skills/coordinator-run/SKILL.md:138` (Hard nevers for
the run):

> - Never address a 🥅 GOALKEEPER seat — no SendMessage, notify, bus message, or sitrep to it. Never
>   write under `~/.claude/goalkeeper/`. The goalkeeper reads your files; you never read or reach it
>   (operator ruling 2026-09-07).

## Open items

- **P11 — `current` still reaches a fronted 🥅 chat (`operator:decision`).** `deliverClaudeDesktop`
  (`server.js:2333`) short-circuits `target.session === 'current'` to the macOS AX bridge *before*
  `deliverDesktopSession`. Three ways in: `session:"current"` on `/api/messages`,
  `to:"claude-desktop:current"` on notify, and an unaddressable-seat notify with `openChat:true`,
  which falls back to `current` at `server.js:2575`. This is structural, not an oversight — the
  bridge types into whichever window is frontmost and resolves no session row, so the choke point
  has nothing to test. The brief says one choke point and no second check, so I left it and pinned
  it with test 8 instead. Mac-only, and it needs the goalkeeper chat to be frontmost.
  **Recommendation: accept for now; revisit if the goalkeeper ever runs as a Desktop seat rather
  than a CLI session.**
- **P10 — the third skill (`operator:decision`).** PLAN §3.4 item 4 asks for the isolation line in
  `local-orchestrator` too. It lives under `~/.claude/skills/`, which this lane is barred from
  (Giselher owns `~/.claude`). goal.md item 7 asks only for the two repo skills, so I did those.
  **Recommendation: the operator adds the one line by hand** — it needs no lane.
- **P5 — `./up.sh` (`operator:gate`).** The refusal is committed, not running. I did not restart
  the deck.
- **P4 — Linear (`operator:gate`).** Linear MCP on this box returns `oauth_token_invalid_grant`,
  so the `agent-luitpold` tag was never registered and no issue was created. Everything is logged
  as P6–P11 instead.

## Boundaries

Nothing under `mac/`, `~/.claude` (the home one), `up.sh`, `main`, or another worktree was
written. `~/.claude/sessions/*.json` was read once, key names only, to confirm the `cwd` field
exists. No seat was messaged. The deck was not restarted.

— Luitpold
