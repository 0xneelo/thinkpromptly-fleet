# Boot-read gate (`boot-gate.py`)

A PreToolUse hook. It denies work by a coordinator orchestrator seat until that seat has read the
board and restated which lanes it owns.

Operator ruling, [DESIGN-v1](../../docs/coordinator/DESIGN-v1.md) §9.2, verbatim:

> **Boot-read gate: HARD.** PreToolUse-style hook denies orchestrator-seat work until the seat has
> read `board.json` and restated lane ownership. Advisory gates are proven failures (Class C/E).

## NOT ARMED

**This ships disarmed on purpose.** Nothing in this repo installs it. Arming a hook is an operator
step: session-kind hooks are operator-owned and live in the Mac-side `settings.json`. The gate also
stays inert until `COORDINATOR_SEAT_KIND=orchestrator` is set, so even an installed stanza does
nothing to a worker seat.

## Arm it

Add this stanza to the operator's `settings.json` and replace the absolute path with the real
checkout path:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "*",
        "hooks": [
          { "type": "command", "command": "python3 /ABSOLUTE/PATH/TO/repo/coordinator/hooks/boot-gate.py" }
        ]
      }
    ]
  }
}
```

## Environment contract

| Variable | Role |
|---|---|
| `COORDINATOR_SEAT_KIND` | The arming switch. The gate acts only when this equals `orchestrator` (case-insensitive). Unset or any other value = allow everything. |
| `COORDINATOR_SEAT` | The seat id. It names the marker file. Falls back to `CLAUDE_SESSION_ID`. |
| `COORDINATOR_REPO` | Optional repo-root override. Without it the gate walks up from the payload `cwd` (max 6 levels) to find `coordinator/`. |

## Lifecycle

1. The seat boots. No marker exists, so the gate is closed.
2. The seat reads `coordinator/board.json` with `Read`.
3. The seat posts a lane-ownership restatement sitrep with `Write` into `coordinator/inbox/`.
4. The coordinator-run or coordinator-portal skill writes `coordinator/.seat-ack/<seat-id>`.
   Never create that marker by hand — it is the record that the restatement landed.
5. The seat can act.

## Fail open

Any unexpected error exits 0 and allows the call, with one `boot-gate: <error>` line on stderr. A
broken gate must never wedge the fleet. The gate also allows when no `coordinator/` dir is found
and when the hook payload names no tool.

The write-target check runs the other way. An unresolvable `Write`/`Edit` path is a policy
question, not a bug, so it **denies**; only errors unrelated to a decision allow.

## What a gated seat may do

Deciding that a shell command does not write is not reliably decidable — `git log
--output=coordinator/.seat-ack/<seat>` forges the ack marker in one command with no metacharacter,
and every fix invited the next flag. So the gate allows by **target**, never by command shape.

While the gate is closed:

1. **Read-only tools are allowed**: `Read`, `Glob`, `Grep`, `NotebookRead`, `TodoWrite`,
   `WebFetch`, `WebSearch`, `ListMcpResources`, `ReadMcpResource`. This is how the seat reads the
   board.
2. **`Bash` is denied outright.** No shell runs while the gate is closed. It returns once the
   marker exists. **`Task` is denied too**: a subagent's own tool calls may not re-enter this
   hook, so spawning one would bypass the gate entirely.
3. **`Write` and `Edit` are allowed only into `coordinator/inbox/`** — the one write the design
   asks of a gated seat. The path comes from `file_path`, `path` or `notebook_path`; a write with
   no recognizable path denies. Both the target and the inbox go through `os.path.realpath()`
   before an `os.path.commonpath()` containment test, so `coordinator/inbox/../../server.js` and
   any symlink out of the inbox fail. A resolved path inside `coordinator/.seat-ack/` is rejected
   explicitly: a seat never writes its own marker. A target that cannot be resolved at all — an
   embedded NUL byte, a symlink loop, an overlong component — denies.
4. **Everything else denies** — `MultiEdit`, `NotebookEdit`, any unknown tool.

The seat id must match `[A-Za-z0-9][A-Za-z0-9._-]{0,63}`. An armed gate with a malformed seat id,
or with no seat id at all, denies: there is no marker path, so the gate could never open, and
silently allowing would defeat a ruling the operator armed on purpose. Read-only tools still pass,
so the seat is never blind. Only the operator can fix it — set `COORDINATOR_SEAT`, or disarm.

Self-test:

```
python3 coordinator/hooks/boot-gate.py --selftest
```

## Disarm

Remove the `PreToolUse` stanza from `settings.json`, or unset `COORDINATOR_SEAT_KIND`.
