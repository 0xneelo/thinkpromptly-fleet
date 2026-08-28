# COORDINATOR — Design v1

Date: 2026-08-28 · Session: coordinator-role-design · Status: **DESIGN v1 — all forks resolved by operator 2026-08-28 (§9); ready for v0.1 build**

Provenance: 73-agent fleet run `wf_b01c8f78-9c2` (50 web literature scouts, 10 archive miners over
our own seat transcripts, 10 GPT-5.6-xhigh hunters, Fable-xhigh oracle) + ChatGPT Pro deep research.
Full inputs: [research/](research/) — [oracle-verdict.md](research/oracle-verdict.md) is the
adjudication; [chatgpt-deep-research.md](research/chatgpt-deep-research.md),
[lit-digest.md](research/lit-digest.md), [evidence-digest.md](research/evidence-digest.md),
[hunter-attacks.md](research/hunter-attacks.md), [miner-incidents.json](research/miner-incidents.json)
are the streams it merged. Three independent sources (our hunters, ChatGPT, the literature) converged
on the same core mechanisms; where they conflicted, the oracle ruled and this doc records the ruling.

## 0. TL;DR

The Coordinator is **not a session and not a smarter agent**. It is:

> **A git-versioned state directory (`coordinator/`) plus a stateless run procedure.**
> Each run: read the boot bundle (<2k tokens, hard gate) → drain the durable inbox →
> commit exactly one revision → emit exceptions → die. Session context is never the memory.

It owns the fleet's cross-seat memory and the operator's one-screen Goal Board. It compresses and
curates. It never directs, builds, adjudicates, or sits on a critical path. Motto: **überschaubar**.

The operator-facing face of the role is the **Portal** (§2a): a disposable interactive session that
fronts these files and answers the operator's questions — so "where are we / what's blocked / what
did we decide" stops clogging the orchestrator. The Portal is a view, never the memory.

Git supplies the machinery the research specced as distributed-systems infrastructure: atomic
multi-file commits (no split-brain), commit history (ordering + monotonic revision), non-fast-forward
push rejection (compare-and-swap / fencing), the commit log (append-only event log). Event-sourcing
frameworks, leases, fencing tokens, and transactional outboxes are **rejected as overbuilt** for a
solo operator with one coordinator run at a time.

## 1. Verdict (what the evidence supports)

~46 cited incidents from our own archives, six failure classes
([evidence-digest.md](research/evidence-digest.md)):

| Failure class (count) | Coordinator fixes it? |
| --- | --- |
| A. Lossy seat handoff — o30→o31 build-intent death, misdelivery to archived seat (~8) | **Provably. This alone justifies v0.1.** |
| D. Stale claims acted on — O26 wrongful prod rollback, O28's 11h stalled train (~7) | Yes, **with the reconciliation loop enforced** |
| F. Duplicate/conflicting lanes — twin workers, forged-authority doc (~6) | Yes, via ownership registry on the board |
| C. Re-derived work — watcher scar 6/6 seats, 1000-reader fan-out (~9) | **Only with an enforced boot-read gate.** The facts existed; nobody consulted them. |
| E. Operator re-explaining the northstar (~6) | Same condition as C |
| B. In-seat context clog — 17.5h seat, degraded steering (~10) | **No. Out of scope by charter.** In-seat hygiene problem; do not let the role grow trying. |

Key line from the oracle: *"a Coordinator earns nothing from existing; it earns its keep from two
enforced behaviors: (1) mandatory first-read at seat boot with explicit acceptance, and (2) an active
reconciliation cadence that checks board claims against reality. A board without both is MEMORY.md
with better CSS."*

Kill criterion: §7.

## 2. Charter v1

**Mission.** Custodian of cross-seat memory and the operator's one-glance surface. Owns the Goal
Board and the intent/decision ledger; runs the reconciliation loop that keeps them honest.

**Form.** `coordinator/` in the repo: `board.json` (canonical) · `board.html` (derived, pushed to
fleetdeck, stamped with git commit hash + generated-time) · `northstar.md` · `decisions-effective.md`
· `inbox/`. Plus a stateless run procedure (skill). Runs trigger on inbox arrival or timer.

**Precedence.** Operator > board > any seat's session memory. A board entry is *binding* only when
it cites an operator ruling ID verbatim; otherwise it is advisory situational awareness. A live
operator instruction always beats the board; the seat then sitreps so the board catches up.
(Matches existing doctrine: operator adjudicates, not the system; evidence is not authority.)

**Inputs (closed list).**
1. **Operator intents** — from the operator directly or an operator-authored tracker record only.
   An orchestrator's "operator said X" is never intent; it triggers a confirmation ping. Every
   accepted intent gets a Linear ID **at acceptance**, before anything else — an intent without a
   tracker ID does not exist. (This is the o30→o31 fix; matches "Build intents: Linear FIRST".)
2. **Seat sitreps** — fixed schema (§3), event-driven per the CCIR list, delivered to the durable
   inbox (committed file or tracker comment), never to a session queue.
3. **Verification attestations** — typed cards from bounded read-only readers:
   `{claim, verdict, evidence_link, observed_at}`. Never the underlying dump.

**Outputs.** The committed board revision (+ derived HTML); exception items to the operator
(tracker records with lifecycle); drift notes to the current seat — tracker record canonical, bus
message carries only the tracker ID, never independent content.

**Hard nevers.** Never builds. Never mints builders or workers (bounded read-only verifier readers
are permitted and are not workers). Never reads source code. Never adjudicates disputes — records
them DISPUTED and routes to the operator. Never re-scopes without the operator. **Never restates an
auth/money/migration/delete/scope ruling in its own words** — verbatim quote under its ID or a link,
never a paraphrase (a cost-capped approval relayed as "approved" becomes unbounded spend; the single
most dangerous defect found in the draft). **Never sits on a critical path** — anything time-bounded
goes seat→operator directly; the Coordinator is copied asynchronously.

## 2a. The Portal — interactive coordinator session (operator ruling, 2026-08-28)

The operator gets a standing way to *talk to* the coordinator without violating the
files-are-the-memory rule: a desktop session (badge `🧭 COORDINATOR <N>`, primed by a
`/coordinator-portal` skill) that fronts the state. Think `kubectl` + librarian: it reads the
archive and speaks for it; it is not the archive.

**What it does.**
- Answers operator questions ("where are we", "what's blocked", "what did we decide about X",
  "what happened while I slept") from `board.json`, `decisions-effective.md`, `northstar.md`, and
  the research/decision archive — spawning read-only readers for anything deeper.
- Receives operator intents conversationally, then routes them through the normal write path:
  Linear ID at acceptance → inbox entry → coordinator run commit. Chat is never the record.
- Can execute the run procedure inline when the operator is present (it is itself a cheap session).

**Disposability rules (what keeps it from becoming the god-session).**
1. **Fresh-read rule:** every operator question is answered against a fresh read of `board.json` +
   `decisions-effective.md` (they are tiny). A stale portal session can therefore never serve stale
   state — its age is irrelevant.
2. **Rotate freely, lose nothing:** killing the portal loses zero state by construction. If a
   portal session's own context grows past comfort, close it and open a new one — no handoff doc,
   no ceremony; the boot bundle is the handoff.
3. **Write path unchanged:** the portal never "just remembers" an intent, ruling, or status — if it
   matters, it goes to Linear/inbox/commit in the same turn, or it does not exist.

**Inherited hard nevers:** no building, no worker/builder minting, no source reads, no steering
orchestrators outside the tracker-first channel, no paraphrasing auth/money/scope rulings, never on
a critical path. The portal is below the orchestrator in execution authority and above it only in
memory span.

## 3. Wire spec

**Sitrep** (one committed file or tracker comment per event; malformed → bounced, never
best-effort parsed; ~15 lines cap):

```text
seat:        o31 (seat id + name)
lane:        L3
event:       one of the CCIR list
event_time:  ISO, when it happened (not when sent)
state:       proposed lane state (active|blocked|done-claimed|closed)
delta:       <=5 lines, what changed vs the board's current text
blockers:    FULL current list for the lane (ids) — level-triggered, every time
evidence:    >=1 link for any done/deployed/verified claim (commit, deploy log, live URL)
ruled_out:   <=3 lines, approaches tried and dead (optional, preserved verbatim)
next_report: expected time of my next event on this lane
```

- `blockers` is the full set each time, so a lost sitrep cannot leave a phantom blocker or hide a
  concurrent one.
- `ruled_out` prevents dead-end re-litigation across rotations — the top continuity failure in the
  literature.
- `next_report` arms the dead-man switch: lapse → lane auto-`UNKNOWN` + exception. Silence must
  never look like health.

**Ordering rule** (replaces generation/epoch machinery): apply a sitrep only if `event_time` is
newer than the lane's last applied `event_time` AND the seat is the lane's registered owner.
Anything else → inbox archive + flag, never applied.

**CCIR trigger list v1** — a sitrep is due when:
1. Lane opened / closed / owner changed. Rotation must explicitly transfer or abandon every open
   commitment — silence at rotation is a violation.
2. Train deployed or deploy failed.
3. Blocker new / cleared / set changed.
4. Done-milestone claimed (evidence link mandatory; renders `done-claimed` until attested).
5. Operator ruling received in-session (verbatim quote + confirmation ping).
6. Disagreement: two agents' conclusions conflict, or a cross-verification failed.
7. Sub-threshold drift: "trending toward blocked" — cheap FYI line, no ping (anti-watermelon).
8. `next_report` deadline reached with nothing to say → explicit "no change, alive" one-liner.

**Course corrections**: tracker record canonical `{id, cites: ruling-id, supersedes: prior-id,
target seat}`; bus carries the ID only; receiving seat acknowledges on the tracker record;
unacknowledged past deadline → exception.

**Exceptions**: tracker records, `pending → acknowledged → ruled → verified`, stable incident IDs,
coalesced per incident (one thread per incident, transition-based). Delivery ≠ acknowledgement.
Overnight default (operator-ruled, §9.3): reversible work inside the last acknowledged intent
continues; irreversible actions (deploy, delete, spend, new lane) pause for the operator — and a
lapsed irreversible pause **escalates to the operator's Telegram bot with a one-click accept
button**. The operator checks the phone every ~4 hours including overnight, so the ack-latency
budget for a paused irreversible action is ≤4h. Pre-authorized in this charter, not improvised
at 3am.

## 4. Board spec

`board.json` canonical; `board.html` derived and pushed to fleetdeck, stamped with commit hash +
generated-time. A stamp/head mismatch makes staleness *visible* instead of prevented ("doc clocks
lie, ask the box").

**One screen. Fixed spatial slots. Rows never reshuffle** (visual momentum — a rotating seat
re-orients in seconds):

1. **Northstar** — 1 sentence + ruling ID + date. Changes only on operator intent. Standing orders
   physically separate from shift state.
2. **Lanes — hard cap 6.** A 7th forces a park or merge, never a denser board. Columns:
   `goal` · `done-milestone` (set at lane creation, never inferred later) · `owner` (named seat,
   never "the fleet") · `state` · `blockers` (count + oldest id/age → link to full queue) ·
   `next decision` (id-linked, never restated) · `reported_at` (self) · `verified_at`
   (evidence-linked) · `next_report due`.
3. **Operator queue** — open decision items, oldest first, each with deadline and default.
4. **Effective decisions** — the bounded currently-operative rulings (ID, one line, verbatim-linked);
   superseded ones drop to an unloaded archive. This + the weekly pass is the anti-MEMORY.md-rot
   mechanism.

**State enum**: `active | blocked | done-claimed | done-verified | DISPUTED | UNKNOWN | closed`.
`done-claimed` ≠ `done-verified`, rendered differently, always (LLM false-completion is measured
behavior — the board assumes it). DISPUTED preserves both attestations and suppresses any done
state; the Coordinator never picks a winner. UNKNOWN is automatic on `next_report` lapse.

**Staleness display**: per-lane `reported_at` and `verified_at` shown separately, dimmed as they age
past expected cadence. No global "last updated" clock. `verified_at` writes only against an evidence
link and **expires** after the lane's cadence — a verified stamp is a decaying assertion.

**Anti-decorative guards**:
(a) two-signal minimum — no green without an external pointer (commit hash, Linear state, deploy log);
(b) self-reported done stays `done-claimed` until an attestation lands;
(c) time-in-state per lane — long-`active` with no events is a flag;
(d) an unbroken all-green weekly streak triggers an audit ping by rule;
(e) **weekly reconciliation pass** — a reader checks every lane's top claim against its evidence
link and every effective decision against its source; mismatches open DISPUTED. *This pass is the
role's actual justification for existing.*

## 5. Top failure modes (merged: 41 hunter findings + ChatGPT + oracle; ranked)

| # | Failure | Mitigation |
| --- | --- | --- |
| 1 | **Paraphrase strips authorization scope** — cost-capped approval relayed as "approved" | Verbatim-quote-or-link rule for auth/money/migration/delete/scope; executing seat acks the ruling ID itself |
| 2 | **Pre-event intent death** — seat accepts intent, dies before any CCIR event | Tracker ID at acceptance; no ID = the intent does not exist |
| 3 | Stale-green: seat dies silently, event-only intake never corrects | `next_report` dead-man → auto-UNKNOWN + exception (found by 4/5 hunts) |
| 4 | False VERIFIED: self-report stamped as verification | reported/verified split; evidence link mandatory; verified decays |
| 5 | Single-slot blocker hides concurrent blocker | Full blocker set per sitrep (level-triggered); count+oldest on board |
| 6 | Delayed sitrep from dead seat overwrites newer state | Apply only if event_time newer AND seat owns lane; else archive+flag |
| 7 | Board rot / self-contradiction (the MEMORY.md disease) | Weekly reconciliation pass; bounded, supersedes-linked decisions list |
| 8 | "Operator said X" laundered into intent | Intent only operator-direct or operator-authored tracker record |
| 9 | Coordinator on a time-bounded critical path | Hard never: urgent = seat→operator direct, Coordinator async copy |
| 10 | Conflicting reports → last writer wins | DISPUTED state, both attestations kept, done suppressed, operator routed |

Rejected as overbuilt (oracle, with reasons): lease/fencing election (git non-FF push +
session-kind registry suffice at one coordinator); transactional outbox / atomic multi-target
publish (one git commit carries all files; HTML mismatch visible by hash); full event-sourcing
replay (the commit log is the event log); boot-as-RECOVERING protocol (drain-inbox-first each run
gives the same guarantee); per-field provenance on all fields (only `state` and `blockers` carry
freshness; `goal`/`milestone` change only via operator events).

## 6. What NOT to build

No immortal god-session. No raw-transcript ingestion. No second tactical task tracker (lanes and
obligations only — tasks stay in Linear/orchestrators). No worker routing. No code-write / merge /
deploy / wallet / prod credentials. No %-complete, utilization, token, or green-lane metrics
(Goodhart). No recursive summaries as memory. No autonomous northstar rewrites. No multi-agent
council per decision. No big ontology before real sitreps. No auto-merge of contradictions.

## 7. Rollout

**v0.1 (~1 day, worth running immediately):** `coordinator/` with `board.json` (≤6 lanes),
`northstar.md`, `decisions-effective.md`; the run procedure as a skill any cheap session executes;
the `/coordinator-portal` priming skill (§2a) so the operator's question-asking moves off the
orchestrator immediately; sitreps as Linear comments in the existing flow; the boot-read gate added
to `/desktop-orchestrator`
priming (seat reads the board first and **restates lane ownership before acting** — explicit accept,
not implicit inheritance). No HTML yet, no readers yet. This alone closes Class A and installs the
consultation gate.

**v0.2:** dead-man deadlines + UNKNOWN; `verified_at` with evidence links; weekly reconciliation
pass; derived `board.html` on fleetdeck.

**Measure over 4 weeks** (baselines from [evidence-digest.md](research/evidence-digest.md)):
1. Lost-intent count — target 0 (baseline 6+).
2. Seat-boot re-explanations by the operator (baseline ~6).
3. Duplicate/conflicting-lane incidents (baseline: Sieghild class).
4. Board-vs-reality mismatches caught by the weekly pass — **nonzero is healthy**; zero for a month
   means the pass is decorative.
5. Exception rate — rising = miscalibrated CCIR thresholds, not "more alerts needed".
6. Boot bundle stays <2k tokens (hard gate in the run script).

**Kill criterion:** if (1)–(3) do not fall by ≥half in 4 weeks, the role is overhead — kill it and
keep only the tracker-ID-at-acceptance rule, which is independently valuable.

Pilot acceptance tests (first 20 real handoffs, from the ChatGPT research, adopted): 0 lost obligations after
acknowledged handoff; 0 seats closing while owning an open commitment; 0 hard-stale lanes shown
healthy; operator states northstar + top blocker + next decision per lane in <60s; median sitrep
effort <45s; ≤6 lanes; 0 silent stale-writes; 0 evidence-less "done"; 0 Coordinator code/tactical
actions; board 100% rebuildable from git history.

## 8. Convergence note (why this design is trustworthy)

Three independent streams — our GPT-5.6 hunters attacking the draft, ChatGPT Pro deep research, and
50 literature scouts — arrived at the same six mechanisms without seeing each other: durable
commitment ledger with lifecycle; REPORTED≠VERIFIED with decay + first-class UNKNOWN; ordering
guards against stale writes; two-phase handoff with receiver restatement; disposable LLM over
durable state; typed exception tiers with ack. The oracle's contribution was subtraction: git
already provides the infrastructure half, and the role lives or dies on two enforced behaviors
(boot-read gate, reconciliation cadence), not on the artifact existing.

## 9. Resolved forks (operator rulings, 2026-08-28, via decision sheet)

1. **Run owner: cheap session per run.** A timer/inbox-hook spawns a disposable cheap session for
   each coordinator run. True stateless reducer; the board is decoupled from seat health.
2. **Boot-read gate: HARD.** PreToolUse-style hook denies orchestrator-seat work until the seat has
   read `board.json` and restated lane ownership. Advisory gates are proven failures (Class C/E).
3. **Overnight default: hold + Telegram escalation.** Reversible work continues; irreversible pauses
   hold AND escalate to a **Telegram bot with a simple accept button**. Operator checks the phone
   every ~4h including during sleep → ack-latency budget ≤4h. The Telegram accept-bot is a v0.2
   build item (notify path first; button-ack second).
4. **Verifier readers: as many as needed.** Coordinator runs spawn read-only verifier readers
   autonomously, uncapped in count, each bounded in scope (one falsifiable claim per reader,
   attestation card back, never a dump). Readers are tools, not workers.
5. **Portal session approved.** The operator wants an interactive session to ask questions of,
   instead of clogging the orchestrator — "the coordinator state should be in these files, yes;
   it's maybe just a portal." Adopted as §2a: state in files, portal as disposable view. The
   `/coordinator-portal` priming skill is a v0.1 build item alongside the state dir.
