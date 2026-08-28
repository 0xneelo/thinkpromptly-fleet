VERDICT: SPLIT — the role is justified by the evidence for exactly one failure class (lossy handoff durability) and as an enforcement point for three more, but the draft's "persistent session" architecture is wrong and reproduces the failures it targets; adopt v1 below with the Coordinator recast as a persistent artifact + stateless procedure, never a long-lived session.

I spot-checked two load-bearing evidence citations independently: `prod-consensus-write-armed-gate-findings.md` line 21 ("treat 'the writer is armed' as the standing prod state") does contradict `MEMORY.md:20` ("--write FLAG DELETED at #42 — never re-add"), and `reader-fleet-deadlock-postmortem.md:11-14` matches the digest's ~1000-reader account. Both corroborate. The jsonl transcript citations, the METR/PushBench numbers, and the 0.96-vs-0.48 structured-handoff study I could not verify from here — see §8.

---

## 1. VERDICT (detail)

**Provably solves:** Class A (lossy handoff). Every cited incident — o30→o31 build-intent death, false delivery to an archived seat, O26's silently-held reconciliation — is a durability failure at a seat boundary. A seat-independent durable ledger + board closes that seam architecturally. This alone justifies a minimal version, because one dead build intent already cost 18h+ and the class recurs (n=6).

**Solves only with an enforced gate:** Classes C, D-narrow, E, F. The evidence digest's own bottom line is correct and decisive: the ~1000-reader fan-out happened *despite* the facts existing somewhere findable; MEMORY.md — the existing persistent store — was found self-contradicting in 10 cases (I verified one). Therefore a Coordinator earns nothing from *existing*; it earns its keep from two enforced behaviors: (1) mandatory first-read at seat boot with explicit acceptance, and (2) an active reconciliation cadence that checks board claims against reality. A board without both is MEMORY.md with better CSS.

**Will NOT solve:** Class B (context-clog in-session failures: the leaked admin token, the 593K-token session, false liveness heuristics). These are in-session verification and secret-hygiene problems. The charter must say so explicitly, or the role will be blamed for them and grow scope trying to fix them.

**The architectural ruling.** The draft says "a persistent role… a fresh coordinator session boots from them." The hunts' strongest structural findings (dueling writers, compaction-as-memory, delayed-message reordering, split-brain across persistence targets) all attack the *persistent session* reading. They dissolve if the Coordinator is defined as: **durable files in git + a stateless procedure run against them.** Each run: read boot bundle → drain durable inbox → commit one revision → emit outputs → die. Git gives you, for free, what the hunts propose rebuilding as distributed-systems machinery: atomic multi-file commits (kills the split-brain findings), ordering and a monotonic revision (the commit history), non-fast-forward rejection (the compare-and-swap/fencing the "dueling coordinators" findings demand), and a durable append-only event log (the commit log itself). I explicitly **reject** the proposed event-sourcing frameworks, renewable leases with fencing tokens, and transactional outboxes as overbuilt for a solo operator with one coordinator run at a time — the residual risk (two coordinator runs racing a git push) is handled by the existing session-kind registry claim plus git's push rejection, and is acceptable at this scale.

---

## 2. CHARTER v1

**Mission.** Custodian of the fleet's cross-seat memory and the operator's one-glance surface. Owns the Goal Board and the intent/decision ledger; runs the reconciliation loop that keeps them honest. Compresses and curates; never directs. Motto: ueberschaubar.

**Form.** Not a session. A git-versioned state directory (`coordinator/`: `board.json` canonical, `board.html` derived, `northstar.md`, `decisions-effective.md`, `inbox/`) plus a stateless run procedure. Runs are triggered by inbox arrivals or a timer; each run boots from the bundle (<2k tokens, enforced by a size gate in the run script), commits exactly one revision, and terminates. Session context is never the memory.

**Precedence (new, from authority-conflict hunt).** Operator > board > any seat's session memory. A board entry is *binding* only when it cites an operator ruling ID verbatim; otherwise it is advisory situational awareness. A live operator instruction always beats the board; the seat's duty is then to sitrep the change so the board catches up. This matches the existing "operator adjudicates, not the system" and "evidence is not authority" doctrine.

**Inputs (closed list, amended):**
1. **Operator intents** — only from the operator directly or an operator-authored tracker record. An orchestrator sitrep claiming "operator said X" is never intent; it triggers a confirmation ping. Every accepted intent is written to the tracker (Linear issue) with a stable ID *at acceptance*, before any CCIR event — this is the fix for the motivating o30→o31 death, and it matches the already-ruled doctrine "Build intents: Linear FIRST, seat queues are lossy."
2. **Seat sitreps** — fixed schema (§3), event-driven per the CCIR list, delivered to the durable inbox (a committed file or tracker comment), never to a session queue.
3. **Verification attestations** (new third category, resolving the reader contradiction) — typed cards from bounded read-only readers the Coordinator may spawn: `{claim, verdict, evidence_link, observed_at}`. Never the underlying dump.

**Outputs:** the committed board revision (with derived HTML, commit hash stamped on the page); exception items to the operator (tracker records with lifecycle, §3); drift notes to the current seat (tracker-first, bus carries only the tracker ID — never independent content, killing the dual-channel supersession findings).

**Hard nevers (amended):** never builds; never mints builders or workers (bounded read-only verifier readers are explicitly permitted and are not workers); never reads source code; never adjudicates disputes — it *records* them as DISPUTED and routes to the operator; never re-scopes without the operator; never restates an auth/money/migration/delete/scope constraint in its own words — such rulings are quoted verbatim under their ID or linked, never paraphrased (this kills the authorization-scope-stripping finding, which I treat as the single most dangerous defect in the draft); **never sits on the critical path** — anything time-bounded goes seat→operator directly, Coordinator copied asynchronously.

---

## 3. WIRE SPEC

**Sitrep** (one committed file or tracker comment per event; bounced if malformed, never best-effort parsed):

```
seat:        o31 (seat id + name)
lane:        L3 (board lane id)
event:       one of the CCIR list
event_time:  ISO, when it happened (not when sent)
state:       proposed lane state (enum: active|blocked|done-claimed|closed)
delta:       <=5 lines, what changed vs the board's current text
blockers:    full current list for the lane (ids), not just the newest
evidence:    >=1 link for any done/deployed/verified claim (commit, deploy log, live URL)
ruled_out:   <=3 lines, approaches tried and dead (optional but preserved verbatim)
next_report: expected time of my next event on this lane
```

Cap ~15 lines total. `blockers` is the full set every time — level-triggered, so a lost intermediate sitrep can't leave a phantom blocker or hide a concurrent one (kills the single-slot overwrite findings). `ruled_out` is carried because dead-end re-litigation across rotations is the top continuity failure in the literature digest. `next_report` arms the dead-man switch.

**Ordering rule (replaces epoch machinery):** the Coordinator applies a sitrep only if `event_time` is newer than the lane's last applied `event_time` AND the seat is the lane's registered owner. Anything else is committed to the inbox archive and flagged, never applied. Two lines of logic; covers the delayed-o30-report scenarios.

**CCIR trigger list v1 (a sitrep is due when):**
1. Lane opened / closed / owner changed (rotation must explicitly transfer or abandon every open commitment — silence at rotation is a violation).
2. Train deployed or deploy failed.
3. New blocker, blocker cleared, or blocker set changed.
4. Done-milestone claimed (evidence link mandatory).
5. Operator ruling received in-session (verbatim quote + confirmation ping — provenance rule applies).
6. **Disagreement**: two agents' conclusions conflict, or a cross-verification failed (new — the closed-taxonomy hunt finding is correct that disputes otherwise fire no trigger).
7. **Sub-threshold drift**: "trending toward blocked" — a cheap FYI line, no ping (anti-watermelon channel).
8. `next_report` deadline reached with nothing to say → explicit "no change, alive" one-liner.

**Course-correction channel:** tracker record is canonical — `{id, cites: ruling-id, supersedes: prior-id, target seat}`. Bus message = the ID only. Receiving seat must acknowledge on the tracker record before the Coordinator marks it delivered; unacknowledged past deadline → exception.

**Exception lifecycle:** exceptions are tracker records with states `pending → acknowledged → ruled → verified`, stable incident IDs, coalesced per incident (transition-based, not occurrence-based — one thread per incident, kills the alert-storm finding). Delivery ≠ acknowledgement; unacknowledged past deadline re-pings per policy. Overnight default: reversible work inside the last acknowledged intent continues; irreversible actions (deploy, delete, spend, new lane) pause pending the operator — pre-authorized in the charter, not improvised at 3am.

---

## 4. BOARD SPEC

`board.json` canonical; `board.html` derived, stamped with git commit hash + generated-time; a viewer comparing the stamp against the repo head sees staleness — no atomic-publish protocol needed, the mismatch is *visible* instead of prevented (consistent with "doc clocks lie, ask the box").

**One screen, fixed spatial slots, rows never reshuffle** (visual momentum — a rotating seat re-orients in seconds):

1. **Northstar** (1 sentence) + its ruling ID + date. Changes only on operator intent. Standing orders physically separate from shift state.
2. **Lanes (hard cap 6; a 7th forces a park/merge, never a denser board).** Columns: `goal` | `done-milestone (set at lane creation, never inferred later)` | `owner (named seat, never "the fleet")` | `state` | `blockers: count + oldest (id, age) → link to full tracker queue` | `next decision (id-linked, never restated)` | `reported_at (self)` | `verified_at (evidence-linked)` | `next_report due`.
3. **Operator queue:** open decision items, oldest first, each with deadline and default.
4. **Effective decisions:** the bounded currently-operative rulings list (ID, one line, verbatim-linked); superseded ones drop to the unloaded archive. This plus the weekly pass is the anti-MEMORY.md-rot mechanism.

**State enum:** `active | blocked | done-claimed | done-verified | DISPUTED | UNKNOWN | closed`. `done-claimed` ≠ `done-verified` — rendered differently, always. DISPUTED preserves both attestations and suppresses any done state (fail-closed; the Coordinator never picks a winner). UNKNOWN is automatic when `next_report` lapses — silence must never look like health.

**Staleness display:** per-lane `reported_at` and `verified_at` shown separately and aged visually (dim past expected cadence). No global "last updated" clock. `verified_at` writes only against an evidence link and expires after the lane's cadence — a verified stamp is a decaying assertion, not a permanent state (this is the fix for "last-VERIFIED", the defect four of five hunts independently found; I concur it was the draft's second-worst).

**Anti-decorative guards:** (a) two-signal minimum — no green without an external pointer; (b) self-reported "done" renders as `done-claimed` until an attestation lands (LLM false-completion is a measured behavior, per the literature digest — the board assumes it); (c) time-in-state displayed per lane — a lane long in `active` with no events is a flag; (d) an unbroken all-green streak across a weekly cycle triggers an audit ping by rule, not by vibes; (e) weekly reconciliation pass — a reader checks every lane's top claim against its evidence link and every effective decision against its source file; mismatches open DISPUTED. This pass is the role's actual justification for existing.

**Rejected board features (overbuilt):** per-field provenance on all fields (only `state` and `blockers` carry their own freshness; `goal`/`milestone` change only via operator events by definition); merged desired/observed columns are kept split per lane (`goal+milestone` = desired, `state+blockers+timestamps` = observed) but without a full spec/status reconciler.

---

## 5. TOP 10 FAILURE MODES (ranked by expected damage; merged from 41 hunt findings + 2 of mine)

The two findings touching authorization and money stay in prose: **#1 Paraphrase strips authorization scope** — a cost-capped approval relayed as "approved" becomes unbounded spend; mitigation: verbatim-quote-or-link rule for all auth/money/migration/delete/scope rulings, executing seat acknowledges the ruling ID itself, never a summary. **#2 Pre-event intent death** — operator intent accepted by a seat that dies before any CCIR event fires; mitigation: tracker-ID-at-acceptance; an intent without a tracker ID does not exist.

```json
{"cols":["rank","failure","mitigation"],"rows":[
[3,"stale-green: seat dies silently, event-only intake never corrects the board","next_report dead-man deadline -> auto-UNKNOWN + exception; found by 4/5 hunts"],
[4,"false VERIFIED: self-report stamped as verification","reported_at/verified_at split; evidence link mandatory; verified decays"],
[5,"single-slot blocker hides concurrent blocker; empty slot read as unblocked","full blocker-set per sitrep (level-triggered) + count+oldest on board"],
[6,"delayed sitrep from dead seat overwrites newer state","apply only if event_time newer AND seat is lane owner; else archive+flag"],
[7,"board rot / self-contradiction (the MEMORY.md disease)","weekly reconciliation pass vs evidence links; effective-decisions list bounded, supersedes-linked"],
[8,"orchestrator's 'operator said X' laundered into intent","intent only from operator-direct or operator-authored tracker record; else confirm-ping"],
[9,"coordinator on the critical path of a time-bounded action","hard-never: urgent = seat->operator direct, coordinator async copy only"],
[10,"conflicting reports, no representation -> last writer wins","DISPUTED state, both attestations kept, done suppressed, operator routed"]
],"n":8}
```

Dropped as overbuilt (with reasons): fencing/lease election (git non-FF push + session-kind registry suffice at n=1 coordinator); transactional outbox/atomic multi-target publish (one git commit carries all files; HTML mismatch is visible by hash); full event-sourcing replay (commit log is the event log); boot-as-RECOVERING protocol (drain-inbox-first at every run gives the same guarantee).

---

## 6. ROLLOUT

**v0.1 (worth running immediately, ~1 day of setup):** `coordinator/` directory with `board.json` (6 lanes max), `northstar.md`, `decisions-effective.md`; a run procedure as a slash-command/skill any cheap session executes; sitreps as tracker comments in the existing Linear flow; the boot-read gate added to the orchestrator priming command (`/desktop-orchestrator` reads the board first and restates lane ownership before acting — explicit accept, not implicit inheritance). No dashboard HTML yet, no readers yet. This already closes Class A and installs the consultation gate.

**v0.2:** dead-man deadlines + UNKNOWN; verified_at with evidence links; weekly reconciliation pass; derived HTML on the fleet dashboard.

**Measure (4 weeks):** (1) lost-intent count — target zero (baseline: 6 incidents); (2) seat-boot re-explanation events by the operator (baseline: n=6 class E); (3) duplicate/conflicting-lane incidents (baseline: Sieghild class); (4) board-vs-reality mismatches caught by the weekly pass — a *nonzero* rate is healthy (the pass is working); zero across a month means the pass is decorative; (5) exception rate to the operator — rising rate means miscalibrated CCIR thresholds, not "more alerts needed"; (6) boot bundle size stays <2k tokens (hard gate in the run script). If (1)–(3) don't move by ≥half in 4 weeks, the role is overhead — kill it and keep only the tracker-ID-at-acceptance rule, which is independently valuable.

---

## 7. OPEN QUESTIONS (genuinely fork the design)

1. **Who runs the run?** A timer/hook that spawns a cheap session per run (true stateless-reducer, my recommendation), vs. the live orchestrator executing the coordinator procedure as a hat it wears (fewer moving parts, but re-couples the board to seat health — the exact coupling that killed the o30 intent). This forks the architecture.
2. **Boot-read gate enforcement:** advisory (priming-prompt instruction) vs. hard (PreToolUse-hook-style deny until the seat has restated the board). The evidence (Class C/E: facts existed, weren't consulted) says advisory gates fail; a hard gate is friction on every seat boot. Operator's tolerance decides.
3. **Overnight default envelope:** confirm the proposed rule — reversible work continues, irreversible (deploy/delete/spend/new-lane) pauses until acknowledgement — and whether a deadline-lapsed irreversible pause should escalate to a second channel or simply hold.
4. **Verifier reader budget:** may Coordinator runs spawn read-only readers autonomously up to a per-run cap (proposed: 2), or must every verification route through the live orchestrator? The first is faster and matches the reader-as-tool doctrine; the second keeps a single minting authority.

---

## 8. Not verified

- The jsonl transcript citations in the evidence digest (`f44d8652…:650-656`, `3681dbe3…:566-632`, `e3756503…:1532/1813`, etc.) — treated as accurate per the brief's provenance (8 miner sweeps + 5 hunts) but not independently re-read; the two memory-file citations I did re-read both checked out exactly.
- Literature-digest empirical numbers (METR gaming rates, PushBench, the 0.96-vs-0.48 structured-vs-narrative study) — used directionally (structured beats narrative; self-reported done is weak evidence), not as load-bearing magnitudes.
- Whether Linear can technically carry the sitrep/ack lifecycle as specced (WAF constraints on bodies exist per `linear-mcp-waf-blocks-sql-in-bodies.md`) — prose-only sitreps should pass, but v0.1 should confirm before committing to tracker-comments-as-inbox.

Corroborating files read: `/Users/misterislez/.claude/projects/-Users-misterislez-projects-lowcap-connector/memory/prod-consensus-write-armed-gate-findings.md`, `/Users/misterislez/.claude/projects/-Users-misterislez-projects-lowcap-connector/memory/reader-fleet-deadlock-postmortem.md`.
