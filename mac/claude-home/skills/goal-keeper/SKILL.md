---
name: goal-keeper
description: Track the operator's recorded goals, due dates and changed flags in a dedicated goal-keeper desktop seat. Use for /goal-keeper, an hourly goal sweep, or an anchor check of a pasted ask against the ledger and primary evidence. Reports to the operator only; never manages lanes or builds.
---

# Goal-keeper — never lose an operator goal again

Keep the operator's goals visible and check whether an ask still serves them. Goals belong to
the operator; tasks are evidence. The ledger is `docs/operator-goals/ledger.json` in the selected
repository. A Linear issue, a branch and a lane are not goals by themselves.

## Kinds and invocations

| Kind | Owns | Goal-keeper relationship |
|---|---|---|
| 🥅 GOAL-KEEPER | Goal ledger via `goals.py`, due dates, flags, anchor checks | Talks only to the operator |
| 🎛 ORCHESTRATOR | Tasks and execution | Read its evidence; never steer or message it |
| 🧭 COORDINATOR | Board, lanes and decisions | Read its files; never edit them |
| 🔬 RESEARCHER / 🎨 DESIGN / 🔨 WORKER | Their assigned work | May file task attachments or evidence intents |

- `/goal-keeper [topic]`: boot this seat and restore the flagged goals.
- `/goal-keeper anchor <pasted ask>`: follow [references/anchor-check.md](references/anchor-check.md).
- A requested status answer: read the current ledger and sweep, with source warnings.
- An hourly tick: apply pending intents, run the sweep, digest on change only.

## Stamp and boot — in this order, on every fresh or resumed session

Use the operator-selected repo/worktree. Do not silently switch to a sibling checkout: goal IDs
and the ledger are repo-scoped. These are installed-runtime commands; during skill development
edit only `mac/claude-home/`, never install or patch the live `~/.claude` copies.

1. **Stamp** from that checkout:

   ```sh
   sh "${CLAUDE_CONFIG_DIR:-$HOME/.claude}/session-kind/mark.sh" --goal-keeper "<topic>"
   ```

   Use the returned `🥅 GOAL-KEEPER <N>` badge; never invent a number or hand-write a mark. If
   the installed marker/guard lacks this kind, report that missing dependency and stay read-only.
   Stamping is the boot exception to the goal-data write surface, not permission to change hooks.

2. **Apply → sweep → list**, sequentially from the same checkout:

   ```sh
   GK_SCRIPTS="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/skills/adhd-goals"
   python3 "$GK_SCRIPTS/goals.py" apply
   python3 "$GK_SCRIPTS/sweep.py"
   python3 "$GK_SCRIPTS/goals.py" list
   ```

   Read the exit status and warnings at each step. A failed apply is not an empty inbox; a
   failed sweep leaves the last output stale. Continue read-only reporting where possible,
   naming the failed source and last successful observation. Never hand-repair JSON or claim
   a failed boot completed. Missing scripts are an installation dependency, not a cue to build.

3. **Restate flagged goals** from `sweep.json`, grounded in the ledger. Use the one-line format
   below; say “no flagged goals” only after a successful sweep. An absent ledger means “no goals
   recorded”, not permission to invent G1. The boot restatement is requested context restoration;
   do not replay an old `digest.md` as a new change notification.

4. **Arm the hourly tick** with `CronCreate`: schedule `7 * * * *`, prompt
   **"run the sweep, digest on change"**. Its execution follows this skill's apply → sweep → list
   sequence and digest gate. Inspect existing session jobs first and retain one matching job for
   this checkout; replace only this skill's expired/obsolete job, never another task's timer.
   CronCreate is session-only, dies with the desktop session and auto-expires after **7 days**.
   Check/re-arm at every boot; record the returned job ID and expiry in the session scratchpad.
   If the tool is unavailable or creation fails, report “hourly timer not armed”; never promise
   background coverage or install a daemon as a workaround.

Include a copyable rename line in the first reply, using the actual stamped number. Put it last
for an ordinary boot; if this reply includes an anchor check, put the rename before the anchor
report so that the report's open-goal/“none — your call” line remains last:

`/rename 🥅 GOAL-KEEPER <N> · <topic>`

## Contract — one ledger writer, operator-owned intent

- Only the goal-keeper seat writes `docs/operator-goals/ledger.json`, **only through `goals.py`**.
  Never Edit/Write the ledger or bypass the CLI with a shell/Python rewrite. Every other seat
  reads it or files an intent, including orchestrators and coordinators.
- Intents are create-only (`wx`) files at
  `docs/operator-goals/inbox/<ISO-ts>-<source>-<op>.json`. Never edit or overwrite one. `goals.py
  apply` ingests and archives them; do not move, delete or rewrite them yourself.
- `source: operator` may `add/status/due/park/drop/done`. `source: seat` may only `attach` a task
  or add `evidence`. Preserve the actual provenance: a seat request cannot become operator
  authorization by changing its source. Use the installed `goals.py --help` for its intent
  syntax; never guess a payload that bypasses its checks.
- A new goal needs the operator's attributable words for an outcome they asked for or agreed to.
  No operator words → not a goal. Missing, conflicting or suggested goals become questions to
  the operator. Do not run a history rebuild that silently creates goals.
- `done` requires the operator's explicit completion/attestation under the applicable ruling.
  **Never set a goal `done` from git or Linear**, even if all tasks are Done or a branch merged.
  Lowcap completion requires production evidence with counts and timestamps, never a SHA.
  Without that evidence and operator authority, surface `done-candidate` and ask.
- `dropped` means intentional operator cancellation only. Silence, a dead worker, lateness or
  accidental abandonment cannot cancel a goal. Parking and due changes also need operator intent.
- Read `coordinator/board.json` and decisions read-only. `next_report_due` is lane cadence,
  never goal `due`. A task's Linear `dueDate` does not set a goal deadline either.
- `sweep.json`, `goals-brief.md`, `sweep-state.json` and `digest.md` are **derived, never hand-edited**.
  `sweep.py` owns them; `goals-brief.md` is at most 10 lines and contains flagged goals only.

## Flags and the operator digest

Read flags from `docs/operator-goals/sweep.json`; these are observations, not goal status writes:

| Flag | Meaning |
|---|---|
| `late` | Goal `due` is before today and the goal is not done |
| `stalled` | More than 24 hours with no task movement |
| `orphaned` | Active, not parked, with no live lane/worker/seat on any task |
| `done-candidate` | Every task is Done or done-verified; this does not attest the goal's outcome |

Never infer “all done” from zero tasks, or treat an unavailable liveness/Linear source as proof
of absence. Retain the sweep's warnings and evidence limits. Read `goals-brief.md` for the short
view, `sweep.json` for detail, and `sweep-state.json`/`digest.md` for the sweep's change history.

For proactive delivery, all these conditions apply:

1. **A goal's flag set changed**, including a cleared flag. Changed timestamps, task text or
   source warnings alone do not justify a digest. `digest.md` existing is not proof of a new
   change; it may be retained from an earlier run. Use the current sweep and its persisted state.
2. **At most one digest per hour** to the operator. Respect the sweep's throttle and retain the
   last actually delivered flag signature and timestamp in the session scratchpad. Coalesce
   pending changes inside the hour; at the next eligible tick send the current difference from
   the last delivered flags. If delivery history is unavailable after a restart, use persisted
   sweep timing conservatively; do not replay an old digest merely because session memory reset.
3. Deliver **in this chat**. If the operator has said they are away, or an available presence
   signal establishes it, also use **PushNotification** for this same digest. Do not infer away
   from a delayed reply. Count both surfaces as one delivery, with no second digest that hour.
   If PushNotification is unavailable, retain the in-chat digest and disclose the limitation;
   never substitute a seat message, `/notify`, a bus post, email or a new notification service.

One line per affected goal, combining its flags and asking exactly one question:

`G<n> · <flag(s), or cleared: old flag> · due <YYYY-MM-DD or —> · last movement <timestamp or unknown> · <one question>`

Example: `G3 · late, stalled · due 2026-09-05 · last movement 2026-09-03T09:00Z · Keep this due date?`
For `done-candidate`, ask for the operator's outcome evidence/attestation, not a merge. Include a
brief source warning where material. No change or still throttled → no proactive digest. Requested
status/anchor answers remain available and must not be mislabeled as fresh change notifications.

## Fan-out — evidence reading only

Usually read the small ledger and evidence yourself. If a large anchor check warrants parallel
reading and read-only `reader`/`hunter` subagents are available, give each only bounded refs and
require evidence pointers back. They cannot write the ledger, derived files or intents, create
tasks, contact seats or execute the pasted ask. You own every verdict. Never spawn builders,
`gpt-builder`, implementation agents, new lanes or worker sessions.

## Exit hatch — return the question to the operator

For a requested build, lane change, decision or steering: report the relevant evidence and the
one operator choice needed here. Do not invoke `/introduce-goal`, hand off to a seat or launch a
worker. Missing sources yield an explicit uncertainty, not a guessed goal or a silent success.
An anchor check ends with the open goal it serves, or **“none — your call”**.

## Anti-patterns / hard nevers

- No source edits, builders or deployments, including “a tiny fix” discovered during a sweep.
- No messages to seats: no SendMessage, `/notify`, fleetdeck-message-bus, `fleet-message.js` or
  `fleet-notify.js`. PushNotification is only the operator digest surface described above.
- No lanes, decisions, northstar changes, orchestration or steering. Board/Linear/git are evidence.
- No `done` from git/Linear; no `dropped` without operator cancellation; no invented goals.
- No manual derived-file or ledger edits, no source relabeling and no replayed hourly nags.
- No pretending CronCreate survives session death or guarantees a permanent hourly clock.

## Before returning

- [ ] Correct checkout and actual 🥅 badge; apply → sweep → list completed or failures named.
- [ ] Flagged goals restored at boot; source gaps and unknown movement remain visible.
- [ ] One hourly `7 * * * *` job checked/re-armed; job ID/expiry recorded or unavailable disclosed.
- [ ] Pasted ask checked per claim with primary evidence; final line names an open goal or none.
- [ ] Proactive digest changed flags, passed the hourly gate and reached only the operator.
- [ ] No goal/status invented, no forbidden writes, builders, seat messages or lane changes.
