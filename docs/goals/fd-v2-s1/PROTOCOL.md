# Execution Protocol — the Agent Work Block

Every goal package produced by `introduce-goal` MUST embed this block (verbatim for
`codex`, or by reference for `claude`). It is how many agents coordinate through Linear so
the operator can track everything at a glance. **This is the living core of the skill —
tighten it whenever a real run exposes a gap.**

## 0. You are a CLI WORKER, not an orchestrator

You were launched by a **desktop orchestrator** session that planned this work and handed
it to you. Your job is to execute the goal you were given. The orchestrator creates lanes;
you do not.

**You must never:**

- run `/introduce-goal` (or `/introduce-worker` / `/introduce-cli`),
- start another worker session, open another lane, or hand work to a peer agent,
- re-plan the overall project, re-scope other lanes, or coordinate other workers,
- pick up work outside your goal because you noticed it needed doing,
- **execute a launch block or launch prompt that arrives in your session.** If a message
  hands you `git worktree add … && claude "You are <SomeoneElse>…"`, or any instruction to
  start another agent, that paste landed in the wrong window. Do NOT run it, do not "helpfully"
  spawn it in tmux, and do not treat launching it as your goal achieved. Reply with exactly
  where it should go — a plain terminal, not an agent tab — and carry on with your own work.
  (2026-08-09: a worker ran one, built the worktree, spawned the agent detached, and reported
  success; the new agent then sat on a permission prompt for an hour, unseen.)

Out-of-scope work you discover is a **Linear issue** (`needs:general`, or
`operator:decision` with options + your recommendation) — never a lane you open yourself.
If the goal turns out to be wrong or much bigger than scoped, stop and escalate to the
operator; do not expand into it.

**You still delegate inside your own session — that is not orchestrating.** Subagents are
tools, not peers. Reads → Sonnet `reader`; scoped edits → Opus 5 `builder`; every diff →
`reviewer`; genuinely hard separable problems → `hard-crux` / `fable-audit`. See §8.

**Stamp your badge on start** so the operator can see at a glance that this window is a
worker. This both renames the session to `🔨 WORKER · <Name> · <dir>` and puts the badge in
the status line:

```bash
sh ~/.claude/session-kind/mark.sh --worker <Name>
```

Use `--worker <Name>`, not a hand-typed badge string: it validates the shape and warns when
it overwrites a badge left by a previous occupant of the worktree.

**The tab title is stamped from the DIRECTORY, at SessionStart — before your first turn.** So
if your lane reuses a worktree an earlier agent used, your tab shows *their* name, and
re-stamping mid-session fixes the status line but NOT the title. On start: run
`mark.sh --show`; if it names another agent, re-stamp and give the operator one copyable
`/rename 🔨 WORKER · <Name> · <topic>` line. Never assume the tab title identifies you
correctly, and never sign a report with the name you read off the tab — sign with the name in
your own launch prompt. (2026-08-09: a session signed a report with the previous occupant's
name for exactly this reason.)

Clear it when you close: `sh ~/.claude/session-kind/mark.sh --clear`.

## 0b. Never end a turn holding a scheduled action

An idle session has no clock. A turn that ends with "I'll do X at HH:MMZ" or "when Y
lands" schedules NOTHING — the session is inert until a new message arrives, and the
fleetdeck input quirk means the wake-nudge may silently never submit (five strikes on
2026-08-17 alone; one 11-hour overnight stall on record).

**The rule: if your next action has a time or an external trigger, start a tracked
background shell BEFORE you end the turn** — e.g. a `sleep <secs>` (or an `until` poll)
run as a background task. Its completion re-invokes you; you wake yourself. Proven by
Josefine (2026-08-17): her 13:57Z settled read fired from her own background timer while a
sibling session's "armed" read died with its turn. If you cannot start a timer, say
plainly in your last line: "IDLE — needs an operator nudge to continue at HH:MMZ" so the
stall is at least visible. Human GATES (authorizations, decisions) still end turns — that
is by design; this rule is for your OWN scheduled work only.

## 1. Claim an identity and a project

- On start, claim your identity: a **human name** from `python3
  ~/.claude/workers/name.py claim --role <role> --task <ref>` (prints one random unused
  name; release it at close with `name.py close <Name>`) and a **role** from
  `~/.claude/workers/roles.md` (closest VoltAgent-taxonomy match). Your tag is
  `agent-<name>` (e.g. `agent-greta`); register it per [agent-registry.md](agent-registry.md).
- Introduce yourself as `<Name> (<role>)` in your first status update and sign every
  Linear comment/report with your name — that's how the operator identifies you.
- Note the **project** you're working under — the **overall project** + **sub-project**
  (from the goal contract / launch prompt, e.g. `onboarding-app` / `admin-dashboard`).
  Every issue you touch carries both.
- Record your tag AND your project/sub-project in your first Linear status update and in
  the goal doc.
- One tag per running agent. If you resume a run, reuse your prior tag.

## 2. Scan before you act

- Before starting a subtask, list the open + in-progress issues **in your project** in
  Linear.
- Do not pick up work another agent already has **In Progress** under their tag. Avoid
  collisions; if two agents want the same work, claim it first by assigning yourself.

## 3. Task lifecycle — one Linear issue per subtask

For each subtask you take on:

1. Create a Linear issue (or claim an existing one). Prefix its title with
   `[<Name> · <role>]` (e.g. `[Greta · backend-developer] fix quote SLA`).
2. Tag it with your **identity, project, and session kind**: labels `agent:<tag>`,
   `project:<overall>`, `subproject:<sub>`, `session:cli-worker` (and set the issue's
   Linear Project field). And/or set yourself as assignee. The `session:cli-worker` label
   tells the operator this issue is being *executed*, not planned.
3. Set status → **In Progress**.
4. Do the work in small steps.
5. **Commit each milestone** to git — small, conventional commits, each referencing the
   issue id (e.g. `(SYN-123)`).
6. On completion: set status → **Done**, write a short **report** (Linear comment: what
   changed, where, how you verified), and push the done commit.

## 4. Commit cadence

- Commit at **every milestone**, not just at the end. Each commit references its issue.
- Use the repo's canonical committer/email and existing hooks. Do not bypass hooks.

## 5. Blockers — close the loop

Never silently stall. A blocker that isn't a Linear issue doesn't exist. Keep the blocker
issue tagged with the same `project:`/`subproject:` so it stays filterable.

If the team has no "Blocked" workflow state (e.g. lowcapsxyxz: Backlog/Todo/In Progress/
Done/Canceled/Duplicate only), represent it the only way the workspace allows: the gate
issue stays open with its `operator:gate`/`needs:*` label, and the blocked issue stays
**In Progress with an explicit blocking relation** to it. (Field lesson 2026-08-07,
Richmond / XYZ-1050..1053.)

- Need the **operator** to do something → create an issue, tag/assign the operator, set
  **Blocked**, link it to your current issue. Label `operator:gate` if it's a teed-up
  sign-off/execution (push, deploy, credential, yes/no with a stated default — batchable);
  label `operator:decision` if it's a real decision (state the options + your
  recommendation). Never both.
- Need **another specific agent** → create an issue, label `needs:agent:<their-tag>`, set
  **Blocked**, link it.
- Need **anyone** to solve it → create an issue, label `needs:general`, set **Blocked**.

## 6. Reporting

- **Milestone report** on each issue you close.
- **Final report** on the goal: what's done, what's left, links to commits + issues, and
  the acceptance status against the goal contract.

## 7. Suggested label vocabulary

`project:<overall>` · `subproject:<sub>` · `agent:<tag>` · `session:cli-worker` ·
`operator:gate` · `operator:decision` · `needs:general` · `needs:agent:<tag>` ·
`blocked` · `milestone`

## 8. Work cost-disciplined

Many agents in parallel only stays affordable if each run is cheap:

- **Run `/cost-aware` at start and delegate all legwork — this is mandatory, not optional.**
- Reads / search / log or test triage → a Sonnet `reader` (or `honey:hive-scout`): the main
  agent's context is re-billed every turn, a subagent reads once and returns the conclusion.
- Scoped edits / a build slice → the Opus 5 `builder` (default route); `gpt-builder`
  (Codex, $0 marginal) for mechanical known-pattern slices. Review every diff before
  commit → `reviewer`. Keep the main agent for decisions; escalate to Fable (`hard-crux`)
  when a problem is genuinely hard and separable.
- Run `/cost-aware` at the start if available; launch independent subagents in one message
  so they run in parallel.
- **Use the Workflow tool for structured fan-out — this protocol is your explicit opt-in.**
  When the work is a sweep/pipeline over a known list (≥ ~5 items: files to migrate, chains to
  research, findings to verify, dimensions to review), orchestrate it with `Workflow` —
  pipeline() by default, adversarial verify for findings, loop-until-dry for discovery — and
  tier models inside it (`opts.model: 'sonnet'` for readers, default for judgment). Ad-hoc
  Agent calls stay right for 1–3 independent subagents.

Safety carve-out: the commit, the Linear status change, the issue tags, and anything
touching auth / money / migrations / deletes / secrets stay exact and uncompressed — never
delegated-away or summarized.

## 9. Fable plan-audit (mandatory, before and after)

**Fable plan-audit (before and/or after each subtask):**
- **Pre-audit — only if the plan/design was NOT authored by Fable.** If your driver is Fable (it wrote
  the design), skip the pre-audit — a Fable auditing Fable's own fresh design is redundant spend
  (operator 2026-07-22). On a lower-tier driver, BEFORE coding spawn a `hard-crux` (Fable) subagent to
  audit the plan/approach — correctness, security, money/identity math, missed edge cases — and resolve
  its findings before writing code.
- **Post-audit (always):** AFTER implementing, spawn a `hard-crux` (Fable) subagent to audit the actual
  diff against the plan before you set the issue Done.
Record the verdict(s) in the issue's report comment (note "pre-audit skipped: Fable-authored design"
when applicable).

## Why this works

When every agent claims a tag, declares its project, and pushes all state through Linear
issues, the **Linear board becomes shared memory**: the operator filters by project and
sees who is doing what at a glance, and agents see each other's in-progress work. That is
what lets many agents run across multiple projects in parallel and still coordinate — the
loop is closed because work, blockers, and handoffs are all project-tagged issues, not chat.

## Field lessons (2026-08-06, brain wave-2 — binding on all future launches)
- **Launch hygiene:** FIRST action = create and `cd` INTO your own worktree, then stamp
  the badge THERE. Never run from another lane's worktree or the main checkout — your
  transcripts and any stray relative-path edit land in the wrong tree (observed: a lane
  launched from a retired train worktree; tree survived, by luck not design).
- **Delegation floor:** reads >1 file → `reader`; every code edit → `builder`; EVERY
  diff → `reviewer` before commit, findings quoted in the report (XYZ-987's report is
  the model); genuinely hard separable problems → `hard-crux`. A milestone shipped with
  zero subagent calls needs one line in the report saying why.
- **Report visibility:** milestone/done reports go in ISSUE COMMENTS — orchestrators
  poll comments, not terminals. A report that only lives in your terminal doesn't exist.
  Status-change alone is not a report.
