# Fleetdeck v2 — decisions log

## 2026-09-07 · unblock sheet (8/8) — see `plan.md` §Operator decisions

## 2026-09-07 · precedent for "verbatim port, then pre-compile" (operator asked; found)

Two prior ports used the same method:

| Repo | Pack | What happened |
|---|---|---|
| `~/projects/onboarding-app` | `docs/goals/pitch-v4-clean-port/` (VIB-246..267, commits `91e7104`…`47bd1a7`) | `.dc.html` → verbatim dc-runtime port → JSX conversion. **Never dropped `@babel/standalone`**; `pitch-v4.html` still compiles JSX at load. |
| `~/projects/lowcap-connector` | `docs/goals/editorial-clean-port/` (Richmond, branch `agent-richmond/editorial-clean-port`, commits `27309326`, `082625e1`) | **Pass 1**: mocks land byte-verbatim on parked `/editorial/*` routes with their own dc-runtime. **Pass 2**: mechanical script compilation to plain HTML/JS, wired to the existing endpoints, then promoted. |

Rules and tools worth reusing:

- **D15 (lowcap DECISIONS.md):** mechanical verbatim only. The ONLY allowed edits are T1 (fonts) and T2 (asset uuid → src) substitutions, each quoted OUT/IN in the commit body. *"NEVER edit shipped markup toward the mock — that method failed and is banned."* Adopted here for S1.
- Parity suite: `~/projects/lowcap-connector/tools/f2-parity.mjs` (construct-counted parity mock ↔ compiled, normalized DOM byte-identical), `tools/hook-inventory.js` (every generated DOM hook resolves), `tools/promote-*.js` (count-asserted promote deltas), `tools/style-parity.mjs`.
- Converter: `~/projects/onboarding-app/server/scripts/convert-pitch-v4-jsx.js` (dc template → JSX, mirrors dc-runtime compile semantics: `{{ }}`, `sc-if`/`sc-for`, event map, pseudo-class CSS) and `extract-dc-bundle*.js`.
- Pitfall (lowcap REPORT.md): pass-2 normalization-order corruption, reproduced twice → fixed by script-strip-first + tail-anchored assert.

**Sequencing question raised by the precedent.** Richmond compiled to plain JS *before* wiring logic. The
sheet ruling was "vendor first, pre-compile at the end (L11)". Proposal: insert **S2 = pass-2 compile**
right after S1, so L1–L10 are written against plain JS (our stack, like today's `app.js`) instead of
against the dc-runtime template. **Operator ruling (same day, after a from-zero explainer): compile EARLY.** S2 follows S1; L1–L10 are written in plain JS; L11 no longer compiles.

## 2026-09-07 · Accounts trend: history already exists (reader audit)

- `credits_history (org, t, fh, sd, xu)` in `fleet.db` (`server.js:1158`), 60-day retention (`server.js:1209`), written by `creditsHistoryWrite` (`server.js:1229-1251`) from each machine's collector push, read by `creditsRows` (`server.js:1543-1548`) and attached as `history[]` (thinned to 120 points) on every Claude row of `GET /api/credits`. Codex rows have no series by design (`server.js:1543-1544`).
- Cadence gap: history only advances on page-load collects (60 s TTL); no cron/launchd poller exists.
- **Ruling applied:** sheet decision 7 ("server rider") is moot. **L8 plots `row.history`**; no `L8s`. A periodic collect is a cadence improvement, not a design item.
- **Operator, same day:** "we have the usage trackers here but they are absolutely unusable, always wrong, they definitely need fixing, lots of fixing." → **Out of design scope.** Logged as a separate goal for the remote-system orchestrator: `fd-usage-trackers` (backend correctness of `/api/credits` collectors: stale samples, "could not read usage on rfc1918-internal", 15-day-old snapshots shown as live, per-machine merge). L8 renders whatever the API returns and must not mask wrong data.

## 2026-09-07 · packaging S0 + S1 (introduce-goal, signed off)

- Project `remote-system` / sub-project `fleetdeck-v2`.
- S0 → **Gisbert** (`qa-engineer`), GPT Astra xhigh, `/goal`. S1 → **Waldemar** (`frontend-developer`), GPT Astra xhigh, `/goal`. Both on the german-box, in parallel.
- S1 stays inside `public/v2/` (vendored runtime under `public/v2/vendor/`, media under `public/v2/media/`) so no `server.js` change is needed for pass 1 and the gate can run against a plain static server.

## 2026-09-07 · S2 method (design-seat decision after the tools audit)

Precedent pass 2 dumped rendered DOM to static HTML and hand-wrote behaviour (fits marketing pages). Fleetdeck
is an app whose tabs/menus/toggles/composer/lists are the design, so **S2 compiles the template into plain-JS
render functions and keeps the mock's logic class running on a ≤300-line shim**; React/Babel/dc-runtime are
dropped; the template stays in the repo as the source (`public/v2/template.dc.html`, `npm run v2:compile`,
`v2:check`). Gates: F2 normalized-DOM parity 36/36, interaction parity after a scripted click-through, pixel gate,
no-engine network proof. Fallback = the precedent's DOM-dump method, only via `operator:decision`. Precedent
tools copied to `docs/design/fleetdeck-v2/precedent/`. Pack: `docs/goals/fd-v2-s2/`.

Launch stall 2026-09-07: both GPT workers stopped on `oauth_token_invalid_grant` from the box's Linear MCP
(the prompt said "a blocker that is not a Linear issue does not exist"). Fixed by a bus nudge (never-block rule,
`LINEAR-PENDING.md`) and by amending the packs + the introduce-goal skill references. Operator action pending:
re-auth Linear on the box over RDP (german-box-workers skill §9).

## 2026-09-07 · launch log (wave A + early S2/L1, operator: "I want it ASAP")

| Session | Worker | Slice | Breed | Base | Launched (Mac local) |
|---|---|---|---|---|---|
| `FD-v2-s0` | Gisbert | S0 gate harness | GPT Astra xhigh | docs branch @ `76c859c` | ~01:00 |
| `FD-v2-s1` | Waldemar | S1 verbatim port | GPT Astra xhigh | docs branch @ `76c859c` | ~01:00 |
| `FD-v2-s2` | Julius | S2 compile to plain JS | Claude high | `origin/agent-v2-s1` @ `39ae4ad` (before S1's gate report; rebases if S1 changes) | ~02:25 |
| `FD-v2-l1` | Juergen | L1 data layer + fixture + v2 routing | Claude high | docs branch @ `226f02c` | ~02:40 |

S1 independent review (design seat, 2026-09-07 ~02:30): T1/T2-only YES; MANIFEST hashes verified; MIME lines exact.
Two findings sent back: align `package.json`/lock with S0's; prove the vendored Inter woff2 is variable.

## 2026-09-07 · S0 accepted; S0.1 follow-up

Independent review of `origin/agent-v2-s0` @ `cf88d29`: harness trustworthy YES (exit codes, screen map by text/key
actions, numbers traceable to committed artifacts, scope clean). Findings routed to Gisbert as goal **S0.1** on the
same branch: `networkidle` hangs against a live app with WebSockets → bounded in-flight-request settle; blur after
clicks + hide focus-visible outlines and scrollbars on both sides; mock side served with `page.route` mapping CDN
URLs to S1's vendored files when present; rename `verify/S0-baseline-failed` → `verify/baseline-failed`.
Kept as designed: pixelmatch threshold 0.1 with `includeAA:false` (per pack; same Chromium on the same box on both sides).
Rule for later slices: every gate report records the script sha it ran with; S1's report is valid against the S0
script version it names.

## 2026-09-07 · S1 accepted

`origin/agent-v2-s1` @ `70c32bb`: independent review T1/T2-only YES; both findings fixed (package.json/lock identical to
S0's; Inter = one variable woff2 covering 400-700, documented in MANIFEST); gate `verify/S1/report.json` allPass 36/36,
max 0.033 % (registry dark); `network.json` zero external hosts; design-seat spot check of registry-dark and
message-bus-light screenshots against the baselines: identical to the eye. Ledger: D01/D02/D07 ✅, P1 half of D03–D19 ✅.
Waldemar released. Julius (S2) told to merge `70c32bb` before his final gate run.

## 2026-09-10 · the `#goals` screen reads the goalkeeper jail, and only its CLI writes to it

New screen `/app#goals` plus `GET/POST /api/goals`. The screen READS the 🥅 goalkeeper seat's git jail
(`$GOALKEEPER_HOME`, default `~/goalkeeper`) — `thread.md`, `goals.json`, `projects.json`, the newest
`audits/<date>.md` — fresh on every call, and it never writes a file there: every write spawns
`goalkeeper.py … --by operator`, the seat's own CLI, which commits inside the jail. A direct file write
from the deck would leave that working tree dirty under the seat's feet and lose the authorship the
thread exists to preserve.

POST is the OPERATOR'S BROWSER path and nothing else: the route is registered on the loopback listener
only (absent from `tailnetHandler`, like `/api/seats`) and an allowed `Origin` header is REQUIRED, so a
seat, a box worker or a coordinator cannot add to the red thread or close a goal through the deck. The
goalkeeper itself never posts — it writes with its CLI, in its jail. Writes are serialised through one
promise chain so two quick clicks cannot run two `git commit`s over the same index.

The mock has no Goals screen, so `template.dc.html` carries only the mount node `#fd-goals-root` and
`public/v2/screens/goals.js` draws the whole screen in plain DOM (createElement/textContent only — a
dictated direction must never be parsed as markup). Nothing polls: it loads on entering the screen and
on Refresh, because the jail changes when the goalkeeper commits.

## 2026-09-10 · the `#unblock` screen holds every seat's decision sheet, and the operator sends answers back

New screen `/app#unblock` plus `/api/unblock`. It is the deck version of the `adhd-unblock` HTML sheet:
a seat (orchestrator, coordinator, worker) POSTs its sheet — title, intro, questions with options and a
from-zero explainer — and the operator answers every open sheet in one place instead of one Artifact
per seat. Sheets and answers live in two `fleet.db` tables (`unblock_sheets`, `unblock_answers`), not
in a jail, because nothing else owns them.

Every click is timestamped by the SERVER: `answered_at` when a choice is first clicked (re-clicking the
same option keeps the first time, a different option moves it), `note_at` on the last note edit. The
operator's own time is the audit trail the seats reason over — "the note is newer than the click, so
the note is the last word".

Answers go back over the message bus, and only when the operator says so: **Send new (N)** posts the
answers changed since the last send (`partial: true`, same JSON the HTML sheet prints), **Send all**
the whole sheet, each card its own **Send this**. Nothing auto-sends a half-answered sheet. The send
that leaves every question answered and nothing pending closes the sheet itself (`closed: true` in the
reply, a `closed` chip by the title) — the operator never wonders whether it is still open; **Reopen
sheet** brings it back. The reply
target is the bus target the seat named when it posted; a sheet with no target gets a copy box instead
of a send button.

`POST /api/unblock` is the one AGENT route (no `Origin`, like the registry); every write the operator
makes (`PUT …/answers/:qid`, `…/send`, `…/close`) requires an allowed `Origin`, so a seat cannot answer
its own questions through the deck. All routes are loopback-only: every seat that posts is a Claude
Desktop session on this Mac. The screen polls every 20 s while open, because sheets arrive while the
operator is looking at the list.
## 2026-09-10 · the `#docs` screen

New screen `/app#docs` over `GET /api/docs`. It lists what the sessions themselves produce —
artifacts, ELI5s, unblock sheets, session digests, reports, loose HTML and markdown — newest
first, filterable by day, session, kind and text. The data source is the deck's own sqlite index,
swept from the session exports, the session scratchpads and each repo's `docs/`: a sweep of the
file system is far too slow to do per keystroke, so the index is the thing the screen queries and
Refresh (`?refresh=1`) is the only way to make it sweep again.

The server does the filtering, so every filter change is one fetch; the `days` and `kinds` counts
in the response are counts over the UNFILTERED index, which is what keeps a chip's number honest
while a filter is on.

Files are served BY ID ONLY, through `/api/docs/open?id=<id>`, on the loopback listener — a path
never reaches the URL. What can be stored is gated on the way in: a POST registers only a real
`.html`/`.md` file, and never one under a hidden directory (`~/.ssh`, `.secrets`, `~/.claude/*`)
unless a swept root owns it. No seat or box worker on the tailnet can reach the route at all. A row of kind `artifact` is already a URL and opens
directly. Every link opens in a new tab with `rel=noopener`.

The filters live on the hash (`#docs?session=…&day=…&kind=…&q=…`), so a filtered screen is a link
the operator can copy, and `router.route()` now returns `{ view, screen, params }` with
`navigate(screen, params)` writing them back. That is also how the Desktop sessions row icon
arrives here: it deep-links `#docs?session=<CLI uuid>`, which is the one id both screens share.

The mock has no Docs screen, so `template.dc.html` carries only the mount node `#fd-docs-root` and
`public/v2/screens/docs.js` draws the whole screen in plain DOM (createElement/textContent only —
a title comes from a file some session wrote and must never be parsed as markup). Nothing polls.

`?source=` filters the same way, and a leading `-` negates it (`source=-scratchpad`), which is the
screen's "No scratchpads" choice — the only filter that is remembered (`localStorage['fd-docs-source']`),
and it is remembered by navigating once so the hash stays the single truth.

`?project=` filters the same way and is not remembered: which repo the operator is looking at
changes with the work. A scratchpad row's project is decoded from the encoded cwd; an exports row
learns it from the folder under the root, except for the buckets every project shares
(`eli5-explainers`, `unblock-sheets`), where only `goals/board-<repo>.html` and
`summary/<stamp>-<repo>/…` still name one.

Each row's Open-in-app icon POSTs an id to `/api/docs/open-app` and the deck runs `open -a <App>`:
the app map (`FLEET_DOCS_APPS` over html/Artifact → Google Chrome, md → Cursor) is the server's, so
no page ever names an executable, and the Origin check fails closed — unlike `POST /api/docs`, which
a shell hook posts to with no Origin, this route launches a local application.
