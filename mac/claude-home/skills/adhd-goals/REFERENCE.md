# adhd-goals — prompts and rules

## Reader prompt (one per pack, fill `D` and `NN`, keep the rest verbatim)

> Read `D/pack-NN.md`: chronological excerpts of Claude Code sessions in ONE repo — `## S<n> · <id> · <seat> · <title>` blocks, then `**operator**` prompts and clipped `**agent**` replies with timestamps.
> Extract the OPERATOR'S GOALS: outcomes the operator asked for, agreed to, or steered toward. Not the agent's tasks, not questions, not chat. A goal is outcome-phrased and outlives one sitting; a one-off instruction ("launch Karl on XYZ-1742", "restart the deck") is a task — attach it to the goal it serves instead.
> For EVERY goal produce `{"goal": "<≤12 words, verb-first outcome>", "why": "<operator's own words, verbatim, ≤30 words>", "asked": "<MM-DD HH:MM of the first ask>", "session": "<8-char id>", "seat": "<seat>", "status_hint": "active" | "done" | "parked" | "dropped" | "unclear", "health_hint": "moving" | "stalled" | "blocked" | "unknown", "evidence": "<one line: the LATEST agent/operator message that shows where it stands, with its timestamp>", "refs": ["XYZ-1742", "claude/branch", "LC-name", "Karl"], "asks": ["<other verbatim operator lines that belong to this goal, ≤3>"]}`.
> Rules: judge status from the LAST evidence, never from a plan or a promise. The operator changing their mind = status_hint dropped/parked with the quote in evidence. Merge repeats of the same outcome within this pack. Never invent intent — no operator words, no goal.
> Write the JSON array to `D/candidates/pack-NN.json` with `python3` + `json.dump` via a Bash heredoc. Reply with exactly one line: `pack-NN: <count> goals`. No goals in the reply.

If a reader cannot write the file, ask it to return the JSON and save it yourself with a heredoc.

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

## Hunter prompt (optional, `--hunters N`; scope = run dir + ledger)

> Scope: `D/pack-*.md` (session excerpts) and `<repo>/docs/operator-goals/ledger.json` (the goal ledger drafted from them). Hunt for defects in the ledger: (1) operator asks in the packs that are outcome-level and MISSING from the ledger; (2) goals marked `done` whose last evidence does not show the outcome true; (3) goals whose `why` is not the operator's words; (4) two ledger goals that are one outcome, or one ledger goal that is two. Return severity-ranked findings, each with the pack + timestamp quote and the ledger ID. Read-only; do not edit.

Fold findings back with `add` / `status` / `attach`, then re-run `check` and `render`.

## Ledger schema

```json
{"project": "remote-system", "updated": "2026-09-05",
 "goals": [{"id": "G1", "goal": "…", "why": "…", "asked": "2026-09-03", "status": "active",
            "health": "moving", "progress": "…", "next": "…",
            "tasks": [{"ref": "XYZ-1742", "title": "", "who": "", "lane": "", "state": "", "emoji": "🟢"}],
            "sources": ["session 7cb2e629 09-03"], "updated": "2026-09-05",
            "log": [{"at": "2026-09-05", "note": "added"}]}]}
```

`goals.py --help` lists every sub-command. IDs are `G<n>`, never reused; a wrong goal is
`dropped` with a note, so the history stays readable.
