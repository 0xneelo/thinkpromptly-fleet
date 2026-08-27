VERDICT — AMEND FIRST

# AUDIT XYZ-1742 · Lane 1 backend design (pre-implementation)

Inputs: `HANDOFF-XYZ-1742-orgchart.md` §3–§5 · dossier artifact 3c20ea35 (full HTML) · `server.js` @ 6198384.

**Evidence caveat that gates everything else:** the dossier does NOT contain 35 enumerated
defects. Each hunter card lists exactly 5 bullets against headline counts 18 / 6 / 11
(lifecycle / API-sec / DB). Union with handoff §3 = **15 named defects; 20 exist only as
counts**, and the research clone is gone (handoff §6). See MUST-16.

---

## Amendments — paste into the Lane 1 goal pack verbatim

### MUST

**M1 — Lease-start endpoint.** Add `POST /api/lease/claim {host,name,worker?,pid?,parent_host?,parent_name?}` → `200 {epoch,expires_at,ttl_s}`. One synchronous transaction: `epoch = COALESCE(epoch,0)+1`, `lease_state='active'`, clears `reaped`/`suspect`. Re-claiming a reused `(host,name)` (tmux name reuse; orchestrator number pool reuses N) MUST succeed and fence the prior incarnation. Test: claim → reap → re-claim → old-epoch heartbeat gets 409, new-epoch gets 200.
*Prevents: defect 4 (partial CAS), tmux/seat-number reuse hitting a stale 410. Why: the spec's contract issues session epochs nowhere — Lane 2 cannot obtain the epoch its heartbeats must carry.*

**M2 — Epoch mandatory once leased.** `POST /api/heartbeat` with a missing or stale `epoch` on a leased row returns `409 {current_epoch_hint:false}` and renews nothing. Only the current epoch renews. A heartbeat on a `reaped` row returns `410 {reason,reaped_at}` regardless of epoch and never resurrects the row. Test: two pingers, old and new epoch — only the new one moves `expires_at`.
*Prevents: defects 4, 5 (any client resets another agent's presence). Why: the contract's `epoch?` optional-marker is a hole through the front of the fence — a paused zombie that omits epoch is indistinguishable from the owner.*

**M3 — CAS on every lease transition, no awaits inside.** Every `lease_state` change is a single conditional UPDATE executed synchronously (node:sqlite `DatabaseSync`, no `await` between read and write): `active→suspect` only `WHERE lease_state='active' AND expires_at < :now`; `suspect→active` on a valid beat; `suspect→reaped` only `WHERE lease_state='suspect' AND warned_at IS NOT NULL AND warned_at <= :now - :appeal_window AND expires_at < :now`. Test: a heartbeat landing between reaper read and reaper write never yields a suspect/reaped row whose `expires_at` is in the future.
*Prevents: defects 2 (reaper kills mid-heartbeat), 4, 14 (duplicate transitions). Why: the spec CAS-guards only the seat claim — the exact shape of mission-control's bug.*

**M4 — Reap order: fence first, kill second, name last.** The `reaped` CAS commits BEFORE `tmux kill-session`. Kill failure leaves the row `reaped` and the kill is retried on the next tick (idempotent; at most one in flight per row). `name.py close <Name>` runs ONLY after tmux confirmed the kill (`kill()` ok), with `<Name>` taken from the row's `worker` column (skip + flag if empty) — and NEVER for `host='mac'` rows (🪦 only; the desktop session may still be alive). Test: crash injected between mark and kill leaves a retryable `reaped`+live row visible in `/api/sessions`; no name is released while its session is provably alive.
*Prevents: crash-mid-reap split state; premature name release creating two live agents with one Name. Why: the spec names the pieces but not the order, and order is the whole correctness here.*

**M5 — Second liveness sample before kill.** Immediately before killing, the reaper re-checks the poller's tmux `session_activity` for that session; activity within the suspect window ⇒ do NOT kill, set flag `pinger_dead` and alert instead. Test: session with a killed pinger but active tmux survives the sweep flagged, not dead.
*Prevents: defect 2; lifts agent-deck's "second liveness sample" (dossier Tier 3) into the spec, where it currently isn't. Why: heartbeat and tmux are independent liveness sources — killing on the loss of only one murders working sessions.*

**M6 — Cascade guard.** If more than K sessions (default 3), or every session on one host, would cross `suspect→reaped` in a single tick, or the host's ssh poll is failing, the reaper skips all reaps that tick and raises one host-level alert. Test: simulate tailscale partition (all box beats stop) — zero kills, one alert.
*Prevents: fleet-wide mass-kill after a network partition, Mac sleep, or box outage. Why: partition ≠ death (Kleppmann is in the spec's own citations); nothing in the spec distinguishes one dead session from an unreachable host.*

**M7 — Boot and clock-jump grace, monotonic ticks.** On fleetdeck start, no `suspect→reaped` transition for one full suspect window. Expiry sweeps compare a monotonic counter (`process.hrtime`) against wall clock; a wall-clock jump > TTL (Mac slept, NTP step) re-arms the boot grace. Test: simulated 2×TTL clock jump reaps nothing for a full window.
*Prevents: mass-expiry on Mac wake / deck restart (the deck runs foreground on the operator's Mac and dies with it — handoff §8). Why: the handoff demands "make it monotonic" for the lifted reaper but the contract stores and compares only wall-clock `expires_at`.*

**M8 — Pinger must prove its own session (Lane 2 clause, frozen in the Lane 1 contract).** The detached pinger verifies its session is alive (`tmux has-session` on box; `kill -0 <pid>` on mac) before every beat and exits when the check fails; on transient network error it keeps beating; on 410 it stops and writes a local tombstone note. Test: kill the session, leave the pinger — row expires within one TTL.
*Prevents: the inverse leak — an orphan pinger making a dead session immortal (mission-control's "presence = phoned home" divorced from reality). Why: a detached pinger is the design's own false-liveness generator unless coupled to evidence.*

**M9 — Durability pragmas pinned and asserted.** `PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;` set at open, read back, and the process throws at boot if either differs. fleet.db stays single-writer (this server process only — server.js:15 comment stays true). Test: boot assertion covers it.
*Prevents: defect 7 (`synchronous=NORMAL` losing acknowledged commits). Why: server.js today sets no pragmas at all; nothing stops a builder habit-typing WAL+NORMAL.*

**M10 — Additive-only migration with backup.** New columns (`pid, parent_host, parent_name, epoch, expires_at, lease_state, suspect_at, warned_at`) via the existing try/ALTER loop (server.js:22-28), all nullable or defaulted so `seenStmt`/`touchStmt` inserts keep working; no DROP, no table rebuild; copy `fleet.db` → `fleet.db.bak-<date>` before first boot of the new schema. Test: boot twice on an existing db; old rows intact.
*Prevents: defect 6 (migration 035 destroyed a table). Why: the live db holds the operator's only fleet history.*

**M11 — Read contract for Lane 3.** `GET /api/sessions` rows gain `pid, parent_host, parent_name, epoch, lease_state, expires_at, suspect_at`; new `GET /api/seats` lists seat rows. UI liveness is defined in the contract as `live := tmux-live OR lease_state='active'`. Loopback-only, like today. Test: a mac desktop seat with a fresh lease renders live.
*Prevents: Lane 3 hard-blocked (row() whitelist at server.js:176-190 strips unknown columns); mac rows otherwise render dead forever (never in `tmux ls` — handoff §4.5); keeps defect-12-class fleet reads off the tailnet.*

**M12 — Parent edge written only at lease-claim, validated.** `parent_host ∈ HOSTS() ∪ {mac}`, `parent_name` matches `SAFE_NAME`, self-parent rejected; parent fields are NOT writable via plain `/api/registry` (not added to `REG_FIELDS`). Test: registry POST carrying parent_* changes nothing.
*Prevents: tree corruption by any tailnet peer (defect 5 class applied to the org edge). Why: the contract block declares the columns but no write path or validation — Lane 2 would invent one.*

**M13 — Seat renewal defined; seats loopback-only.** Pick and write into the contract: seat `expires_at` is renewed by the holder's session heartbeat (seat.owner = `(host,name)` of the holder), and an expired seat goes `suspect` like a session — never silently deleted. `/api/seats/*` mounts on the loopback listener only (coordinator/orchestrator are desktop = Mac-local); `/api/heartbeat` + `/api/lease/claim` mount on both listeners (box pingers arrive over tailnet). Test: unrenewed seat is suspect after TTL; tailnet POST to /api/seats/claim gets 404.
*Prevents: every seat expiring minutes after claim (spec gives seats `expires_at` but no renewal path); defect-9-class exposure (a tailnet peer seizing the orchestrator seat and fencing the real one).*

**M14 — Reaper observability.** Every tick records `last_tick_at` (exposed in `/api/health`) and logs each transition with epoch and reason. Test: `/api/health` shows reaper tick age; a stopped reaper is visible within 2 ticks.
*Prevents: defect 3's class — a reaper silently disabled by a config branch, discovered only by the leak it allowed.*

**M15 — Durable two-phase warn.** `active→suspect` sets `suspect_at`; the bus warn sets `warned_at`; after restart, a suspect row with `warned_at IS NULL` is re-warned before any reap; `suspect→reaped` is gated on `warned_at` age (M3). Warn text delivered over ssh/tmux MUST obey the zero-quote rule (server.js:95-99) — no quote characters, ever. Appeal is defined as the suspect-phase response window (a killed tmux session cannot appeal; its pinger dies with it) plus the 410 body for late-returning mac sessions. Test: restart mid-suspect → warn re-sent, no reap before `warned_at + appeal_window`.
*Prevents: defect 8 (fire-and-forget events) applied to the one message that precedes a kill; makes the operator's two-phase reap crash-safe instead of aspirational.*

**M16 — Make the acceptance test list real.** The "35 findings as the build's test list" clause is not executable: only 15 defects are enumerated in any surviving source (dossier top-5 per hunter + handoff §3; the clone is gone). Either (a) re-clone (`git clone --depth 1 https://github.com/builderz-labs/mission-control`) and re-run the hunts to regenerate the full list before packaging, or (b) scope the goal pack's acceptance to the 15 named defects plus M1–M17 / S1–S7. State which in the pack. Test: every acceptance item in the pack is individually checkable.
*Prevents: an unfalsifiable acceptance gate — the named control that is not executable.*

**M17 — Enumerate and fence the privileged write set.** The fenced set is: `/api/kill`, `/api/registry/delete`, and `/api/registry` writes to `status`/`task`. Agent calls (no `Origin` header — the existing discrimination pattern, server.js:509-514) MUST carry `seat_epoch` of the current orchestrator/coordinator seat and get `409` when stale; browser calls (allowed `Origin`) may omit it (operator UI). Test: a fenced-out old orchestrator's `curl /api/kill` with its stale seat_epoch gets 409; the deck UI still kills.
*Prevents: defects 4, 5 — the spec promises "every privileged write carries its epoch" but the contract block fences nothing except heartbeat; today a zombie orchestrator on loopback can kill any session and delete any row.*

### SHOULD

**S1** — Heartbeat 200 returns `{expires_at, ttl_s, lease_state}`; pinger derives cadence as `ttl_s/3` (no hardcoded interval; TTL changes server-side propagate). *Recipe step 2 is otherwise unenforceable from Lane 2.*
**S2** — Pin the numbers in the pack: TTL 90s, renew 30s, suspect/appeal window 2×TTL, reaper tick 30s (all configurable). *Untestable without values.*
**S3** — One shared bearer key on the tailnet listener's write routes (`safeCompare`, Tier-1 guardrails lift — dossier names it, contract omits it); loopback exempt. *Closes defect 5's cross-agent writes; Host-header check is spoofable.*
**S4** — Store `expires_at/suspect_at/warned_at` as INTEGER unix-ms, one format everywhere; never compare against the ISO strings the legacy columns use. *Mixed formats fail silently in comparisons.*
**S5** — Retention: reaped rows auto-hidden/deleted after 14 days; no per-heartbeat history rows (update in place). *Defect 15 — unbounded append-only growth.*
**S6** — Decide now: leaf subagents (readers/hunters, no tmux session) are OUT of the v1 tree, or get short-TTL child rows via lease-claim. *The dossier's render shows them; no data source exists — Lane 3 will otherwise invent one.*
**S7** — Record in the contract that heartbeat is liveness-only by design (no `status` field to mis-store — defect 1's mechanism cannot occur); session distress goes through registry `status`/`note`, which sightings already cannot overwrite (server.js:37-43).

---

## Coverage — named defects → spec-as-written verdict

Verdicts are for the §5 spec **as written**, before amendments. "→ M/S n" = smallest fix.

| # | Defect (source) | Verdict | Clause / fix |
|---|---|---|---|
| 1 | Heartbeat POST ignores reported `status` (§3; hunter L) | PREVENTED | heartbeat payload has no status field; lease_state is server-derived; registry classification separate (server.js:37-43). Note S7 |
| 2 | Reaper marks offline without re-checking `last_seen` (§3; hunter L) | SILENT | no CAS/re-check on suspect→reaped → M3, M5, M6, M7 |
| 3 | Stale reaping silently config-disabled (§3; hunter L) | SILENT | no reaper observability → M14 |
| 4 | Only initial claim CAS-guarded (§3; hunter L) | **REPEATS** | spec CAS's only the seat claim; heartbeat/suspect/reap transitions unguarded → M1, M2, M3, M17 |
| 5 | Any key resets another agent's presence (§3; hunter L) | **REPEATS** | `epoch?` optional; tailnet registry/heartbeat unauthenticated, any peer may beat/write any row → M2, M12, M17, S3 |
| 6 | Migration drops `api_keys`, no rollback (§3; hunter DB) | SILENT | no migration discipline stated → M10 |
| 7 | `synchronous=NORMAL` durability loss (§3; hunter DB) | SILENT | server.js sets no pragmas; nothing pins them → M9 |
| 8 | Event bus fire-and-forget, no replay (§3; hunter DB) | SILENT (partial) | 410-on-heartbeat covers the *reaped* notice; the pre-kill *warn* is still fire-and-forget → M15 |
| 9 | Workspace admin ⇒ host super-admin (§3; hunter S) | PREVENTED* | listener split keeps kill/keys loopback-only (server.js:527, 677-697) — *conditional on M13 (seats loopback-only) |
| 10 | Admin rotates/receives global API key (hunter S) | N/A | no key surface in Lane 1; if S3 adds one: file/env only, no rotation endpoint |
| 11 | Cross-tenant identity tampering (hunter S) | N/A | single-tenant; the session-level analog is #5 → M2 |
| 12 | SSE stream leaks other workspaces' runs (hunter S) | PREVENTED* | no SSE; fleet-wide reads stay loopback — *conditional on M11 mounting |
| 13 | Webhook HMAC secrets plaintext at rest (hunter S) | N/A | webhooks not in Lane 1 scope |
| 14 | Pipeline/notification races → duplicate work/delivery (hunter DB) | SILENT | double-reap / double-warn / double name-close unguarded → M3, M4 |
| 15 | Append-only logs never pruned (hunter DB) | SILENT | reaped rows + incarnations accumulate → S5 |
| 16–28 | Lifecycle hunt, 13 unenumerated (18 − 5 named) | **UNENUMERATED** | not recorded in any surviving source → M16 |
| 29 | API-sec hunt, 1 unenumerated (6 − 5) | **UNENUMERATED** | → M16 |
| 30–35 | DB hunt, 6 unenumerated (11 − 5) | **UNENUMERATED** | → M16 |

Tally: 3 PREVENTED (1 clean, 2 conditional) · 7 SILENT · 2 REPEATS · 3 N/A · 20 UNENUMERATED.

## Axis-(b) findings not covered by any defect row

- **Fence never checked on any existing privileged path**: `/api/kill` (server.js:527-537), `/api/registry` (485-499), `/api/registry/delete` (493-496) carry no epoch and predate the spec — the spec's "every privileged write carries its epoch" names zero endpoints → M17.
- **Wall clock only**: `now()` = ISO wall time (server.js:35); Mac sleep/wake and deck restart mass-expire every lease → M6, M7.
- **Crash-mid-reap**: no ordering between mark/kill/name-close → M4.
- **name.py side effects**: reaper releasing a Name before the kill is confirmed lets the pool re-issue it while the old holder still signs as it → M4.
- **Seat renewal undefined**: seats carry `expires_at` with no renewal path → M13.
- **Contract gaps blocking Lanes 2/3**: no epoch issuance (M1), no cadence in response (S1), no parent write path (M12), no tree/seat read API (M11), mac liveness semantics (M11), pinger 410/failure behavior (M8, S2), subagent leaves (S6).
