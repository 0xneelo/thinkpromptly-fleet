# Lane S6 — subagent leaves, hooks → deck → org chart (Odilia · fullstack-developer)

**Goal (one line):** every Claude-breed fleet session's in-session subagents (reader,
builder, hunter, oracle, …) appear as leaves under that session in the org chart within
seconds of `SubagentStart`, flip to done on `SubagentStop`, pair correctly under parallel
fan-out, and vanish with their parent — per `CONTRACT-ADDENDUM.md`.

## Scope

**In:** `box/hooks/fd-subagent.sh` (new) + `install-box.sh` wiring + `INSTALL-MAC.md`
section; `server.js` table/routes/reaper per the addendum + `test/subagents.test.js`;
`public/orgchart.js`, `public/app.js`, `public/style.css`, `public/orgchart-s6.fixture.json`;
this pack's `reports/odilia.md`.
**Out:** any change to CONTRACT v1 routes, `sessions`/`seats` schema, pinger, reaper
ordering for sessions; the operator's Mac `~/.claude` (deliver the doc section instead);
Codex-breed leaves; click-through to subagent transcripts; cost/token per leaf.

## Read first, in order

`README.md` (this pack) · `CONTRACT-ADDENDUM.md` · `../xyz-1742-fleet-lifecycle/CONTRACT.md`
(v1, frozen — the addendum sits on top) · `../xyz-1742-fleet-lifecycle/lane2-hooks.md` +
`reports/konrad.md` (hook conventions, harness, the one-disclosure lesson) ·
`box/hooks/fd-common.sh` + `fd-pinger.sh` (identity, epoch state, `fd_post`) ·
`public/orgchart.js` `buildTree`/`stateOf` · `test/seats-fencing.test.js` (test style).

## Acceptance

1. **Parallel pairing.** A box Claude session spawns 3 readers in one message: 3 leaves
   appear under its node within 5 s, each with `agent_type`; each flips to done within 5 s
   of its own stop, in the right order. Verified against your own deck instance, keyed by
   `agent_id` — no first-unended heuristic anywhere.
2. **Hook hygiene.** `fd-subagent.sh` never writes stdout on exit 0 (prove with a
   capture: subagent context contains no relay text); returns in <50 ms with the deck
   unreachable; `401` ⇒ alert file, no retry; no secrets in argv/logs; zero-quote-safe.
3. **Fencing.** Stale `epoch` ⇒ `409`, no row. Unknown `(host,name)` ⇒ `404`. Reaped parent
   ⇒ `410`. Stop for unknown `agent_id` ⇒ `404`, no row. All four are `node:test` cases.
4. **Cascade + retention.** Parent reaped ⇒ leaves gone in the same tick; ended rows >24 h
   pruned; lost-stop rows closed at 6 h with a log line. Tested with clock injection, not
   sleeps.
5. **UI.** Fixture renders leaves under the correct parent; state classes `active/done/
   offline`; elapsed ticks; overflow `+N` at 9+; leaves with mismatched epoch or missing
   parent are dropped. `buildTree` covered by `node:test` if importable, else a fixture-
   driven smoke documented in the report.
6. **Install.** `install-box.sh` twice ⇒ no duplicate hook entries; uninstall removes both
   entries; `INSTALL-MAC.md` section complete enough that the operator needs no other doc.
7. **Safety.** Own deck instance on another port with local `hosts.json`; never the
   operator's Mac `:3131` or its `fleet.db`. Test sessions named `ODILIA-T-*` only.

## Milestones (commit + Linear checkpoint each)

**A** payload capture: register a throwaway `SubagentStart`/`SubagentStop` hook in your
own `CLAUDE_CONFIG_DIR`, spawn one reader, commit the two sample JSONs under
`reports/samples/`; confirm whether `async: true` is honoured on the box's Claude ·
**B** server: table + routes + reaper cascade/retention + tests ·
**C** hooks: `fd-subagent.sh` + install/uninstall wiring + harness tests (Konrad's
`box/hooks/test`) + `INSTALL-MAC.md` section ·
**D** UI: `buildTree` leaves + chips + fixture + tick ·
**E** integration: real Claude session on your instance, acceptance 1–2 end to end ·
**F** report → `reports/odilia.md`, registry `done`, lane issue Done.

## Conditions

Addendum is the contract: a needed deviation = `operator:gate` issue + stop that slice.
Never orchestrate. Delegate in-session: `reader` for reads, `builder` for scoped edits,
`reviewer` on every diff before commit. If Linear OAuth is dead, commit the would-be
comment under `reports/` and keep going. Same blocker 3 times ⇒ abort with an issue.
