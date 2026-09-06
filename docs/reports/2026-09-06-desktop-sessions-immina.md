# Desktop sessions delivery report

Author: Immina · fullstack-developer · remote-system / desktop-sessions
Date: 2026-09-06
Branch: `agent-desktop-sessions-page`
Base: `origin/main` at `26ebf4950cace2ad20835b8ef50d485da58c54a5`
Reviewed implementation tip: `ffd8455e7058833580700658712b2e7f197a3dc3`

Implementation and fixture acceptance are complete. Linear lifecycle completion is
blocked by `UNAUTHORIZED / oauth_token_invalid_grant / Reauthentication required`.
The two lane-issue creation attempts and the operator-gate filing attempt were rejected.
No Linear issue, comment, or Done transition is claimed. The standing abort applies;
this report preserves the gate and intended issue details below. The final response
carries the full pushed SHA, independently checked with a fresh authenticated `git ls-remote`.

## Delivered behavior

- `box/desktop-sessions.sh` collects Code-tab metadata from all account/org directories
  on the Mac and the verified Windows Store layout. Only `local_*.json` files are opened.
  Credential/config files, scheduled tasks, transcripts, and peer keys are excluded.
- `GET /api/desktop-sessions` returns account+org+machine groups, Credits-map labels,
  per-machine collection status, per-row freshness, and live badges. A five-minute TTL
  coalesces concurrent refreshes. SQLite `desktop_sessions` stores projected metadata;
  `desktop_session_sources` preserves collection status, including empty snapshots.
- Partial or failed scans retain cached rows. Only a complete successful snapshot removes
  missing rows. Transport output is bounded to 16 MiB; diagnostics never echo raw output.
- `machines.json` enables the Mac and german-box using their existing local/SSH routes.
  German-box uses `gb-deploy` with `wsl sh -s`; no script installation is needed.
  rog-strix remains deferred.
- `/sessions.html` is linked from the Deck and includes account, machine, live, archived,
  and text filters, session details, explicit stale/empty/error states, and an inline
  composer. Rendering uses `textContent` and existing `style.css` tokens.
- Local live state joins `cliSessionId` to `sessionId` in `desktopSessions()` on every
  GET, even inside the collection TTL. Messaging resolves `id:<UUID>` again at delivery,
  so renames, duplicate titles, and a tab named `current` cannot select another chat.
  Remote live state is explicitly `unknown`: the Mac registry cannot prove a remote PID.

## Validation

| Gate | Result |
| --- | --- |
| `npm test` | 227 passed, 0 failed, 0 skipped; 115808 ms |
| Collector fixture tests | 5 passed |
| API/cache/ID-routing fixture tests | 10 passed |
| Chromium acceptance script | 22 passed |
| JavaScript syntax and `git diff --check` | Passed |
| Independent milestone reviews | M1, M2, M3 approved after corrections |

The browser checks cover four accounts, every filter and intersections, HTML-like titles
remaining text, exact message targets, draft preservation, offline/send races, failed
refresh retention, stale-machine notices, empty states, both themes, and 390px mobile
layout with table scrolling confined to its own region. The script serves fixtures on
an ephemeral loopback port and never starts or contacts the live deck.

Three reviewer findings were reproduced before correction:

1. Deeply nested ignored JSON fields discarded valid collector rows. Per-row recursion
   handling now preserves them and reports one skipped row.
2. SSH `spawn` ignored `maxBuffer`. Streaming caps now reject oversized stdout or stderr
   before buffering an entire reply; raw diagnostics remain outside responses and logs.
3. An offline refresh overwrote successful message delivery feedback. Availability and
   delivery outcome now have separate notices, proved with a deferred successful POST.

Privacy fixtures use unreadable-by-design FIFOs for excluded JSON filenames and benign
unknown fields. No real credential or config content was used in tests, payloads, logs,
or reports. All test database files and servers are isolated.

## German-box filesystem evidence

Verified on german-box itself (`DESKTOP-LJMEJQN`):

`/mnt/c/Users/Vibe/AppData/Local/Packages/Claude_pzs8sxrjxfjjc/LocalCache/Roaming/Claude/claude-code-sessions`

The directory has three account directories and six account/org directories. No
`local_*.json` files were present. Only filenames/layout were inspected; unrelated file
contents were not opened. Running the collector returned:

```json
{"v":1,"state":"ok","ts":1788703500,"complete":true,"skipped":0,"sessions":[]}
```

The Mac's four accounts were exercised with fixtures only. O32 owns real Mac collection
and verification after integration. This lane did not deploy, merge to main, start the
live deck, modify its database, run `up.sh`, or message other fleet sessions.

## Milestones and verification commands

- `80e0238`: metadata collector and five fixture regressions; independently approved.
- `6747043`: SQLite/API/SSH collection and stable-ID messaging; independently approved.
- `ffd8455`: page, navigation, styling, and browser acceptance harness; independently approved.

```sh
npm test
PLAYWRIGHT_MODULE=/path/to/playwright node scripts/verify-desktop-sessions-ui.js
```

For a separately installed browser, set `CHROMIUM_PATH`. To retain screenshots, set
`DESKTOP_SCREENSHOT_DIR`. Captured fixture screenshots are beside this report under
`desktop-sessions-immina/`.

## operator:gate — Linear reauthentication

Required operator action: reconnect the Linear app. Three attempts received the same
authentication blocker, including the gate filing itself, so the gate is preserved here.

Intended lane issue:

- Team: `lowcapsxyxz`
- Title: `[Immina · fullstack-developer] desktop-sessions page`
- Labels: `project:remote-system`, `session:cli-worker`
- State: `In Progress`, then `Done` with this report and the verified pushed SHA.

Intended gate issue:

- Title: `[operator:gate] Immina desktop-sessions delivery: reconnect Linear`
- Labels: `operator:gate`, `project:remote-system`, `session:cli-worker`
- Action: reconnect Linear, create the lane issue, mirror this report and the remote-SHA
  receipt, then complete its lifecycle. No alternate credentials or auth route was used.

Signed: Immina
