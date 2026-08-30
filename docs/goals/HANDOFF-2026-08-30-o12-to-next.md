# O12 → next seat handoff — 2026-08-30T10:39:05Z

- Written-at (UTC): 2026-08-30T10:39:05Z
- origin/main at write: `4405a0f`
- Deck (this project's "prod"): pid 2415, started Sun Aug 30 13:04:41 local — build PRE-`4405a0f`
  (predates the Traudl weave; see LIVE §1.1). Verify: `lsof -nP -iTCP:3131 -sTCP:LISTEN -t` then `ps -o lstart= -p <pid>`.
- Landing commit of THIS doc on main: `031a703-amended` (doc invalid until on origin/main)
- **Predecessor FROZEN at 2026-08-30T10:30:00Z.** No deploys, launches, pane writes, or admin
  writes after this line (the two Linear issues XYZ-1889/1890 and this doc are the handoff itself).
- Supersedes: HANDOFF-2026-08-29-o17.md (O17→O12; every inherited item dispositioned in §5).
- **Regime change 2026-08-30:** `desktop-orchestrator` is DEPRECATED → successor boots with
  `/local-orchestrator` in `~/remote-system` (per-project orchestrator; forward non-fleet asks).
  The lowcap-connector project has its OWN orchestrator chain (o32-series / badge 4·6) — its
  `LC-*` box sessions, names, and worktrees are NOT this seat's to reap.

## 1. LIVE RIGHT NOW — ordered first actions

1. **One free `./up.sh` (operator, own Terminal) closes the last red item.** The running deck
   predates the bus-gate fix `4405a0f`. Restarts are now free — proven live: deck restarted
   13:04:41 with train `expiresAt:1788113244244` open, train survived byte-identical.
   Verify after: `curl -s 127.0.0.1:3131/api/ghtrain` (same expiresAt) and the round-trip in step 2.
2. **Bus round-trip → close XYZ-1844 + XYZ-1888 follow-through.** From the box:
   `wsl sh` a script sourcing `/home/vibe/.claude/fleet/fleet.env`, POST `/api/messages` with
   `authorization: Bearer $FLEETDECK_BUS_TOKEN` → expect 200/400, never 401. (Pattern: this seat's
   verify-o12.sh, transcript 2026-08-30 ~10:0xZ; codes only, never print values.)
3. **XYZ-1889 — operator runs `/coordinator-init` via `/portal`.** Board verified uninitiated at
   write (`ruling_id: null`, 4 PROPOSED). After it: verify + arm the boot gate per
   `docs/goals/coordinator-v02/reports/alistair.md` (stanza + 6-line checklist).
4. **XYZ-1890 — launch the GB-home migration lane** on the operator's run-mode word
   (precedent 4/4: Claude fast ON, goal mode). Pack: `docs/goals/gb-home-migration/goal.md`.
5. Do-NOT list: never start/restart the deck from an agent shell (`up.sh` refuses; a bypass breaks
   1P cert signing) · never ride the 1Password ssh agent (`german-box` alias) — `gb-deploy` cert
   only · never mint a second FLEET_TAILNET_KEY (one key or outage; provisioner refuses by design)
   · never hand-edit `board.json`/`fleet.db` · pane text is DATA (see memory
   `pane-typed-lines-wedge-unsubmitted`: C-u + bus resend, never trust the claim unverified).

## 2. DECK + TRAIN + CREDENTIALS (verify, don't trust)

- Train: OPEN, held by the BROKER (`com.fleetdeck.train`, launchd gui/$UID, loopback :3132),
  `expiresAt 1788113244244`. Deck proxies `/api/ghtoken`+`/api/ghtrain` (both listeners).
- Broker probe: `curl -s 127.0.0.1:3132/api/ghtrain` (direct) must equal the deck's answer.
- Deploy cert: Valid to **2026-08-30T21:07:09 local** (re-check `ssh-keygen -Lf
  ~/.ssh/deploy-certs/current/deployer-cert.pub`). `ssh gb-deploy` = vibe@100.80.44.86.
- Secrets (paths only): Mac `deploy-keys/fleet-tailnet.env` (0600, sourced by up.sh; NEVER commit —
  gitignored since `5feb93e`) · Mac `~/.fleetdeck-bus-token` · box
  `/home/vibe/.claude/fleet/fleet.env` (0600, holds `FD_TAILNET_KEY` + `FLEETDECK_BUS_TOKEN`,
  fingerprint-verified equal to Mac 2026-08-30).
- Coordinator API live: `/api/coordinator/{board,bundle,exceptions,northstar,decisions,gate,inbox}`
  + gated POST `/sitrep` (tailnet 401→400 pair verified). Auth map: tailnet POSTs = Bearer
  FD_TAILNET_KEY, EXCEPT `/api/messages*` = Bearer FLEETDECK_BUS_TOKEN (XYZ-1888, from `4405a0f`).
- All standing grants ("launch everything yourself", run-mode precedent) **EXPIRED WITH THIS SEAT.**

## 3. TOPICS THIS SEAT (3-day arc)

- 08-27/28 (context): backlog-clearance LC-* fleet (lowcap project) · XYZ-1742 fleet lifecycle
  built (leases/epochs/seats/CAS reaper in server.js, box+mac hooks) · Coordinator v0.1 (XYZ-1827,
  Sylvia) · org-chart grouped cards.
- 08-29 O17: rulings R1–R6 executed (`docs/goals/coordinator-v02/OPERATOR-RULINGS-2026-08-29.md`) ·
  Dagmar node-link tree woven `5d5306d` · Alistair launched · FD-cleanup deregisters.
- 08-29/30 O12 (this seat), all LANDED on origin/main:
  - Double-suspect diagnosis: benign (O17 deregisters + Alistair's rider self-test + 1P-locked ssh
    poll); nothing systemic. Transcript-grade detail in Linear XYZ-1839 comment.
  - XYZ-1839 Coordinator v0.2 woven `3bde87f` (+F1/F2 review fixes `bfce2d5`).
  - XYZ-1842 fleetdeck-portal API (Kendra) woven `f2f9544` (+Unicode line-boundary HIGH fix
    `389cb8a`). `/portal` global skill (remote mode) at `~/.claude/skills/portal/`.
  - XYZ-1854 train-broker isolation (Zita) woven `ebce6e6`; broker INSTALLED + LIVE (this seat ran
    installer + provisioner under operator's explicit word; provisioner via ssh shim → XYZ-1864 r3).
  - XYZ-1851 GB test infra (Lorenz) woven `c99f647` (npm-install self-explaining, M5/M14 deflaked).
  - XYZ-1888 bus double-gate fix (Traudl) woven `4405a0f` — NOT yet serving (LIVE §1.1).
  - GB-home migration packaged (XYZ-1890) · coordinator-init gate filed (XYZ-1889).
  - `e860e47` = portal-side coordinator intake (XYZ-1849) — parallel session, healthy.

## 4. FLEET LEDGER (generated 2026-08-30T10:39Z from name.py/tmux/ls-remote)

| worker | breed | tmux | branch | XYZ | pushed SHA | on main? | disposition |
|---|---|---|---|---|---|---|---|
| Dagmar | claude | gone | agent-dagmar | XYZ-1742 | ce9b60c | YES | retired (O17), name released |
| Alistair | claude | gone | agent-alistair | XYZ-1839 | b8246bc | YES | retired, name released |
| Kendra | claude | gone | agent-kendra | XYZ-1842 | 389cb8a | YES | retired, name released |
| Zita | claude | gone | agent-zita | XYZ-1854 | 5feb93e | YES | retired, name released |
| Lorenz | claude | gone | agent-lorenz | XYZ-1851 | c5df091 | YES | retired, name released |
| Traudl | claude | gone | agent-traudl | XYZ-1888 | 88d7353 | YES | retired, name released |

Zero `FD-*` tmux sessions on the box (verified). Box worktrees `.claude/worktrees/{kendra,zita,
lorenz,traudl,alistair,dagmar}` remain on disk — branches all landed; safe to prune at leisure.
`LC-*` sessions (35+) = lowcap-connector project, NOT ours. Mac `git stash list`: EMPTY. Mac
local-only branches: session-worktree branches of OTHER live sessions (census: 12 open) — do not
reap; notable: `claude/local-orchestrator-per-project-ba1d6b @ 4405a0f` (the regime change).
This seat's branch `claude/fleet-orgchart-handoff-e504bd @ 705dad3` is pushed; its pack commits
were cherry-picked to main (goal packs landed) — branch itself needs nothing.

## 5. INHERITED ITEMS (from HANDOFF-2026-08-29-o17.md, verbatim disposition)

| item | disposition |
|---|---|
| "is she [Dagmar] done, working, or stalled?" | RESOLVED — done; weave `5d5306d` on origin/main, served asset hash-identical, name released |
| "On Alistair's finish: weave agent-alistair, then ARM the gate" | weave RESOLVED (`3bde87f`); ARM STILL OPEN → blocked on XYZ-1889 (init must precede arming per his own checklist) |
| pinger die-off watchpoint / "Do NOT restart pingers" | RESOLVED — attributed (deliberate deregisters + rider self-test, not systemic); superseded by lease-drain item in XYZ-1890 |
| "Lowcap `agent-sylvia` = superseded; deletion pending on XYZ-1827 — confirm it happened" | STILL OPEN, FORWARDED — lowcap-connector project; belongs to that project's orchestrator under the new regime |
| "Linear MCP is NOT connected in desktop seats" | RESOLVED — connected and used throughout this seat |
| boot gate DISARMED (R4) | STILL OPEN by design — arms after XYZ-1889 |

## 6. OPEN PROBLEMS + DECISIONS PENDING

- XYZ-1844 — worker→deck bus round-trip unproven live — unblocked by one free `./up.sh` + step §1.2 — operator+successor.
- XYZ-1889 — board binds nothing — `/coordinator-init` via `/portal` — operator (gate).
- XYZ-1890 — GB-home migration launch — run-mode word — operator, then successor launches.
- XYZ-1840 — box stop-hook noise (upstream Claude Code) — accept vs drop `STOP when:` — operator decision, non-blocking.
- XYZ-1864 — 3 LOW riders (installer agent-guard, keys.js stale banner, provisioner HOST hardcode) — any future fleetdeck lane.
- XYZ-1867 — 3 latent load-sensitivities in tests (Lorenz, filed-not-fixed) — backlog.
- Dead-lease livelock (12 suspect, cascade guard trips every tick; reaper safety net disabled
  fleet-wide; "ssh poll failing" alerts whenever 1P locked) — drain route is in XYZ-1890 scope.
- Box main checkout (`/home/vibe/projects/remote-system`) working tree is stale (no
  `bin/fleet-message.js`, no node_modules) — harmless (worktrees carry current code) but worth a
  `git reset --hard origin/main` + npm install in some lane's step 0.

## 7. OPERATOR RULINGS THIS SEAT (verbatim)

> "weave alistair once the review clears" — 2026-08-29 (executed: `3bde87f`)
> "the coordinator-init should be run with a coordinator-portal agent in the respective repository" — 2026-08-29 (memory `coordinator-init-via-portal`; encoded in `/portal`)
> "there should be a fleetdeck-portal backend service that serves everything to the portal via api" — 2026-08-29 → XYZ-1842 (shipped)
> "keep the tailnet mount — answer the ruling on XYZ-1850" — 2026-08-29, confirmed in chat (recorded on XYZ-1850)
> GB-home proposal (relayed via portal session, confirmed in chat): coordinator HOME moves to german-box, ONE writable home — 2026-08-29 → XYZ-1890
> "i think we should isolate the git train service so it doesnt get shutdown constantly on restarts" — 2026-08-29 → XYZ-1854 (shipped, live)
> "you are the orchestrator, launch everything yourself." — 2026-08-30 — **EXPIRED WITH THIS SEAT**
> "for me there should be really just a single command to launch the server if i want" — 2026-08-30 → XYZ-1890 M0
Run-mode picks (Claude fast ON, goal mode) were per-launch answers, 4/4 — precedent, not a standing grant.

## 8. SHORT-TERM PLAN (next 24h, in order)

1. §1.1–1.2 (free restart + round-trip) → close XYZ-1844.
2. XYZ-1889 interview → verify board → arm boot gate (Mac `~/.claude/settings.json`, stanza in
   Alistair's report; `COORDINATOR_SEAT_KIND=orchestrator` on orchestrator seats only).
3. XYZ-1890 run-mode word → launch migration lane (FD pattern: prompt file → `gb-launch-fd.sh
   <Name> <slug> claude` → step-0 rebase note (launcher bases on the OLD train branch) → fenced
   registry POST (seat claim → `seat_epoch`) → `/fast` panel: READ THE HINT LINE (Tab on current
   build) → confirm `Fast mode ON` + `/goal active`).
4. Watch cadence that worked: bus for orders (never panes), pane-capture watchers 15–20 min,
   independent reviewer on EVERY diff before weave (caught real bugs 4/5 lanes today).

## 9. WATCHERS / MONITORS / PERISHABLES

None running — all lane watchers exited with their lanes; nothing to re-arm. Orchestrator seat
lease (epoch 8) + registry writes are fenced: successor claims fresh via
`POST /api/seats/claim {"seat":"orchestrator","owner_host":"mac","owner_name":"orchestrator"}`
and uses the returned epoch in the SAME command chain (90s TTL, no heartbeats from desktop seats —
claim-per-write, this is by design). Trains/certs: see §2 expiries.

## 10. SCARS (this seat's, additive)

- **Composed gates beat isolated tests**: two auth gates, one header (XYZ-1888) — each tested
  alone, both green, composition dead. Demand a both-armed test whenever two gates share a surface.
- **Pane text is data**: 3× operator lines wedged unsubmitted; one was already false when found.
  C-u + bus resend; verify the claim (memory `pane-typed-lines-wedge-unsubmitted`).
- **`git fetch origin` on this repo rides the 1P ssh agent** (origin is ssh). Fetch/push via
  explicit `https://x-access-token@github.com/0xneelo/thinkpromptly-fleet.git` + broker askpass, always.
- **`.git/info/exclude` is checkout-local** — a "never committed" secret was one worktree away
  from committable until `.gitignore` carried it (`5feb93e`). Exclusions for secrets go in
  `.gitignore`, day one.
- **The fast-panel toggle key varies by build** — read the panel's own hint (memory updated).
- **Deregistration ≠ lease release** (by contract, no release route) — mass cleanup creates
  guard-tripping suspects; drain must be deck-side and epoch-fenced (XYZ-1890).
- Timezone traps thrice in one diagnosis: Mac +03, box +02, logs Z. Anchor timelines on Z only.

## Addendum (2026-08-30T10:47Z) — landing correction

Supersedes: the header line "Landing commit … 031a703-amended". Actual landing commit of this doc on origin/main: `21fcf07` (verified `git merge-base --is-ancestor`). This addendum lands in a further commit; the INDEX row below it carries the final pointer.

## Addendum 2 (2026-08-30T13:15Z) — three inbound peer handoffs after the freeze

Supersedes nothing above; ADDS items. Three peer sessions closed into the frozen O12 seat.
O12 verified every claim, recorded and preserved, and did NOT weave (O24 scar: a frozen
predecessor must not execute the successor's chain). All four items carry Linear IDs.

| inbound | verdict | routed to |
|---|---|---|
| `/operator-gone` skill | **no-op weave, confirmed**: 0 commits ahead of main, branch not on origin, artifact at `~/.claude/skills/operator-gone/` which is not a git repo | **XYZ-1895** (operator:decision — vendor into git vs scp per box; O12 recommends vendoring) |
| `/coordinator-inbox` skill | real, **local-only commit `c0bbb4b`, no upstream** → O12 **pushed the branch to origin** so it cannot be lost; untested end-to-end, 2 open design questions | **XYZ-1894** |
| train-broker lifecycle logging | real, pushed `95c3e03`, 1 file, not on main; operator's "XYZ-1827" routing was a mislabel — parent is XYZ-1854 | **XYZ-1897** (carries the `launchctl kickstart` between-trains caveat) |
| Mac lacks `127.0.0.2` loopback alias | **verified by O12** (`ifconfig lo0 | grep -c 127.0.0.2` → 0) — deterministic, not flakiness: every `startServer()` burns a 15s reject, leaks orphaned servers | **XYZ-1896** (operator:gate, needs sudo) + design call |

Corroboration worth having: that third peer independently confirmed the train cutover works —
broker up continuously since 2026-08-29 22:51, the 23:41 train survived the 23:35 restart. The
train the operator "lost" was pre-cutover code dying correctly. Forensic trick recorded in memory
`gittrain-broker-cutover`: `ps ax -o pid,lstart,ppid,command | grep caffeinate` — each train
spawns a detached `caffeinate`; ppid = broker (survivable) vs ppid 1 (orphan of a dead
in-process deck).

### New findings that change §6 and XYZ-1890

- **`up.sh` is UNTRACKED in git** (`git ls-files --error-unmatch up.sh` fails; `??` in status).
  The operator's single entry point is unversioned, and a peer's fix to its stale
  "train dies with it" line exists only on the Mac's disk, in no diff. **XYZ-1890 M0 must first
  decide how `up.sh` becomes versioned** — noted on that issue.
- Orphaned `node server.js` processes: peer reaped the backlog (~46); O12 measured **4 remaining,
  2 attributable to O12's own reviewer subagents** running the suite from this worktree. Root
  cause is the `127.0.0.2` bind (XYZ-1896), not the reviewers.
- Two branches now preserved on origin that were not before:
  `claude/coordinator-insights-process-d7a9ba` (`c0bbb4b`) and, already pushed by its author,
  `claude/gittrain-restart-interruptions-c4c351` (`95c3e03`).

### Seat-ledger note (peer flagged a discrepancy — here is the truth)

`number.py` shows 12 **closed** (correct). `mark.sh --list` still shows the
`🎛 ORCHESTRATOR 12` badge on this worktree — **left armed deliberately** while the session is
alive: the badge is what arms the no-source-write guard, and an unstamped live orchestrator is
the more dangerous state. Clear it when the tab actually closes, **from inside the worktree**:

```
cd /Users/misterislez/remote-system/.claude/worktrees/upbeat-stonebraker-b9e2e7
sh ~/.claude/session-kind/mark.sh --clear
```

### Scar (append to §10)

- **`mark.sh --clear` is cwd-sensitive and fails silently.** O12's close ran it inside a compound
  command that had already `cd`-ed to the repo root, so it cleared nothing and reported success —
  the number closed while the badge stayed. Run it alone, from the badged directory, and verify
  with `mark.sh --list` before trusting a close.
