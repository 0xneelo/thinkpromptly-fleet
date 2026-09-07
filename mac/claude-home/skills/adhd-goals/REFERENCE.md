# adhd-goals — prompts and rules

## Reader prompt (one per pack, fill `D` and `NN`, keep the rest verbatim)

> Read `D/pack-NN.md`: chronological excerpts of Claude Code sessions in ONE repo — `## S<n> · <id> · <seat> · <title>` blocks, then `**operator**` prompts and clipped `**agent**` replies with timestamps.
> Extract the OPERATOR'S GOALS: outcomes the operator asked for, agreed to, or steered toward. Not the agent's tasks, not questions, not chat. A goal is outcome-phrased and outlives one sitting; a one-off instruction ("launch Karl on XYZ-1742", "restart the deck") is a task — attach it to the goal it serves instead.
> For EVERY goal produce `{"goal": "<≤12 words, verb-first outcome>", "why": "<operator's own words, verbatim, ≤30 words>", "asked": "<MM-DD HH:MM of the first ask>", "session": "<8-char id>", "seat": "<seat>", "status_hint": "active" | "done" | "parked" | "dropped" | "unclear", "health_hint": "moving" | "stalled" | "blocked" | "unknown", "evidence": "<one line: the LATEST agent/operator message that shows where it stands, with its timestamp>", "refs": ["XYZ-1742", "claude/branch", "LC-name", "Karl"], "asks": ["<other verbatim operator lines that belong to this goal, ≤3>"]}`.
> Rules: judge status from the LAST evidence, never from a plan or a promise. The operator changing their mind = status_hint dropped/parked with the quote in evidence. Merge repeats of the same outcome within this pack. Never invent intent — no operator words, no goal.
> Write the JSON array to `D/candidates/pack-NN.json` with `python3` + `json.dump` via a Bash heredoc. Reply with exactly one line: `pack-NN: <count> goals`. No goals in the reply.

If a reader cannot write the file, ask it to return the JSON and save it yourself with a heredoc.

## Reader prompt — FULL pass (one per pack incl. pack-00; fill `D` and `NN`, keep the rest verbatim)

> Read `D/pack-NN.md`. `pack-00` = the operator-facing FILES of one repo (coordinator board lanes + northstar, effective decisions with the operator's verbatim words, the goal ledger as it stands, the newest seat handoff, memory notes); `pack-01…` = chronological excerpts of every Claude Code session in that repo — `## S<n> · <id> · <seat> · <title>` blocks, then `**operator**` prompts and clipped `**agent**` replies with timestamps.
> Extract EVERY outcome the operator wanted, as if there were no limits — no time, no capacity, no cost, no train windows: what would be true if everything they asked for or wished for got built. Include the big and the small, the repeated and the once-mentioned, "would be nice", "eventually", "someday", "I hate that X" (= wants X gone), ideas they floated and never followed up, and outcomes already reached. Exclude: the agent's own tasks and plans; questions; pure constraints and rulings ("never X", "keep Y file-only" — decisions, not goals); a one-off instruction ("restart the deck") unless it reveals a wanted outcome (then name the outcome). If `coordinator/README.md` says the coordinator instance is not live in this repo, its board lanes are a fixture — skip them.
> For EVERY goal produce `{"goal": "<≤12 words, verb-first outcome>", "why": "<operator's own words, verbatim, ≤30 words>", "theme": "<1–2 words: deck | fleet | workers | coordinator | git | costs | docs | …>", "asked": "<MM-DD HH:MM of the first ask, or the file's date>", "session": "<8-char id, or 'files'>", "seat": "<seat, or 'files'>", "status_hint": "mentioned" | "active" | "done" | "parked" | "dropped" | "unclear", "health_hint": "moving" | "stalled" | "blocked" | "unknown", "evidence": "<one line: the LATEST message or file line that shows where it stands, with its timestamp>", "refs": ["XYZ-1742", "claude/branch", "LC-name", "Karl", "G3"], "asks": ["<other verbatim operator lines for this goal, ≤3>"]}`. `mentioned` = voiced, no evidence anyone picked it up; `active` = someone is on it; `done` only when the outcome is shown true; `parked`/`dropped` only when the operator said later/stop. A want that restates a ledger goal (`G<n>` in pack-00) → put that ID in `refs`.
> Rules: `why` is verbatim, never paraphrased. Merge repeats of one outcome within this pack. Never invent intent — no operator words, no goal.
> Write the JSON array to `D/candidates/pack-NN.json` with `python3` + `json.dump` via a Bash heredoc. Reply with exactly one line: `pack-NN: <count> goals (<m> mentioned)`. No goals in the reply.

## Ask the seat (full pass, step 3)

Target = the live `🧭 COORDINATOR <N>` of this repo, else the live `🎛 ORCHESTRATOR <N> · <project>`;
never a seat of another project. Route: `/notify` (`coordinator <N>` / `orchestrator <project>`,
`--timeout 120`) or, from a desktop session, `SendMessage` to the exact `ListAgents` row. Message:

> `[adhd-full-goals] from <badge or session>: building the NO-LIMITS goal list for <project> — every outcome the operator ever wanted, as if nothing constrained us. Draft: <G1 goal · G2 goal · … · +N 💭 mentioned: …>. Reply in ONE message: (a) wants the operator voiced that are MISSING, one per line as `goal | why (operator's words, verbatim) | when`; (b) any draft line that is wrong and why. Nothing to add → reply `none`.`

Save the reply as `D/candidates/seat.json` (same record shape, `"session": "seat"`, `"seat": "<🧭|🎛>"`,
`why` verbatim as the seat quoted it). No live seat, 409, or no ACK in 120 s → `⚠️ seat not asked
(<reason>)` in the closing line; the files it would have read are already in pack-00.

## Reconcile rules (driver)

1. Load `docs/operator-goals/ledger.json` (may be absent) and every `D/candidates/*.json`
   (`python3 -c 'import json,glob;[print(json.dumps(r,ensure_ascii=False)) for f in sorted(glob.glob("D/candidates/*.json")) for r in json.load(open(f))]'`).
2. Cluster candidates by outcome across packs. One ledger goal per outcome. Existing ledger goal
   wins its ID; a candidate that restates it only updates `progress` / `next` / `health` / `sources`.
3. `asked` = earliest first ask. `why` = the earliest verbatim quote (keep the operator's words).
4. `status`: newest evidence rules — `done` only when the last message shows the outcome true
   (landed, deployed, verified), otherwise `active`; operator said stop/later → `dropped`/`parked`.
   `health`: `blocked` if the last evidence is a wait on the operator or an external gate;
   `stalled` if no evidence for > 24 h in an active goal; else `moving`.
5. `progress` ≤ 12 words, countable where possible ("2 of 3 lanes landed"). `next` ≤ 10 words,
   names who acts ("Karl: land request lane", "operator: deploy word").
6. Write with `goals.py add` / `status` / `health` / `attach` — or edit the JSON directly for
   bulk changes (docs path, allowed in every seat). Then `goals.py check`.
7. Anything a reader marked `unclear` becomes a question in the closing "confirm" line, not a goal.

## Reconcile rules — FULL pass (deltas; everything else as above)

1. Load the ledger and every `D/candidates/*.json` incl. `seat.json`.
2. An existing goal keeps its ID and its `status` — the full pass never demotes `active`, never
   touches `done` / `parked` / `dropped`. It only ADDS goals and fills `theme`, `why` (earliest
   verbatim), `sources`, `tasks`.
3. New candidate: evidence of a lane / issue / worker / seat on it → `active`; voiced and never
   picked up → `mentioned` (`goals.py add "…" --why "…" --theme deck --status mentioned`); the
   outcome shown true → `done`. `parked` / `dropped` only with the operator's own words.
4. No size rule: a one-sitting outcome the operator wanted stays. An instruction that names no
   outcome is still not a goal.
5. `theme` on every goal (`goals.py theme G3 deck`): reuse the ledger's themes, ≤ 8 per repo, 1–2 words.
6. Candidates carrying `G<n>` in `refs` merge into that goal, never a new one.
7. `goals.py check`, then `list --full` — read it once as the operator would: two rows that are one
   outcome → merge (drop the newer with note "dup of G<n>").

## Hunter prompt (optional, `--hunters N`; scope = run dir + ledger)

> Scope: `D/pack-*.md` (session excerpts) and `<repo>/docs/operator-goals/ledger.json` (the goal ledger drafted from them). Hunt for defects in the ledger: (1) operator asks in the packs that are outcome-level and MISSING from the ledger; (2) goals marked `done` whose last evidence does not show the outcome true; (3) goals whose `why` is not the operator's words; (4) two ledger goals that are one outcome, or one ledger goal that is two. Return severity-ranked findings, each with the pack + timestamp quote and the ledger ID. Read-only; do not edit.

Fold findings back with `add` / `status` / `attach`, then re-run `check` and `render`.

## Ledger schema

```json
{"project": "remote-system", "updated": "2026-09-05",
 "goals": [{"id": "G1", "goal": "…", "why": "…", "asks": ["…"], "theme": "deck", "asked": "2026-09-03", "status": "active",
            "health": "moving", "progress": "…", "next": "…",
            "tasks": [{"ref": "XYZ-1742", "title": "", "who": "", "lane": "", "state": "", "emoji": "🟢"}],
            "sources": ["session 7cb2e629 09-03"], "updated": "2026-09-05",
            "log": [{"at": "2026-09-05", "note": "added"}]}]}
```

Optional `"asks": ["…"]` keeps the operator's other verbatim lines for the goal (the board shows
them under the quote). `goals.py --help` lists every sub-command. IDs are `G<n>`, never reused; a wrong goal is
`dropped` with a note, so the history stays readable. Optional `"theme": "deck"` groups the full
list; `status` `mentioned` (💭) = voiced by the operator, not picked up — only the full pass and
`add --status mentioned` create it.
