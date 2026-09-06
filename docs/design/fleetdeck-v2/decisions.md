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
