# session-kind

Marks a Claude session as a **desktop orchestrator** (plans, never builds), a **desktop
researcher** (researches a topic 1-on-1 with the operator, reports findings to the live
orchestrator, never builds), a **design implementation orchestrator** (`🎨 DESIGN <N>`,
diffs a Claude Design handoff against the current implementation, mints german-box workers
for the build, hands finished branches to the live orchestrator for train weaving — never
edits source itself), or a **CLI worker** (executes builds), then shows that in the
statusline and enforces it with a PreToolUse hook.

## Marker scheme

`~/.claude/session-kind/marks/<key>`, where `<key>` = first 12 hex chars of `shasum` (SHA-1) of the
session's absolute cwd, with no trailing newline in the hashed input. That derivation means an
in-session agent can stamp itself without knowing its own session id. File contents = one badge
line, e.g. `🎛 ORCHESTRATOR 2`, `🔬 RESEARCHER 3`, `🎨 DESIGN 4` (the desktop kinds carry a
session number claimed from `number.py` — ONE shared pool, so a number is unambiguous across
all desktop kinds; guard matches the `🎛 ORCHESTRATOR`, `🔬 RESEARCHER` and `🎨 DESIGN` prefixes) or
`🔨 WORKER · Greta`. `CLAUDE_CONFIG_DIR` overrides `~/.claude`.

## Commands

    sh ~/.claude/session-kind/mark.sh --orchestrator "topic"  # claim a number AND stamp; prints badge
    sh ~/.claude/session-kind/mark.sh --researcher "topic"    # same, badge 🔬 RESEARCHER <N> (same pool)
    sh ~/.claude/session-kind/mark.sh --design "topic"        # same, badge 🎨 DESIGN <N> (same pool)
    sh ~/.claude/session-kind/mark.sh --worker Greta          # stamp a worker (warns on reused worktree)
    sh ~/.claude/session-kind/mark.sh --show | --clear        # this cwd's badge
    sh ~/.claude/session-kind/mark.sh --list | --reap         # all badges (age, [DEAD CWD]) / drop dead ones
    python3 ~/.claude/session-kind/census.py [--reap]         # what is ACTUALLY running (see below)
    python3 ~/.claude/session-kind/number.py status           # active claims
    python3 ~/.claude/session-kind/number.py close <N>        # release a number
    python3 ~/.claude/session-kind/number.py reap [--days N]  # close claims whose cwd is gone / idle

Use the one-shot stamps; a hand-assembled badge is refused unless it has a valid shape, and
an explicit `🎛 ORCHESTRATOR <N>`, `🔬 RESEARCHER <N>` or `🎨 DESIGN <N>` is checked against the registry
(`number.py verify`) so it cannot duplicate a number another live directory holds. `claim` is idempotent per directory —
re-running it hands back the number that directory already holds.

`number.py` mirrors `workers/name.py` (sqlite registry, BEGIN IMMEDIATE serialises parallel
claims, unclosed claims rotate back after 7 idle days). Truth lives in `numbers.db`; never
hand-edit it.

## census.py — liveness by observation

Neither registry can say what is running: nothing closes a session reliably. `census.py` asks
the OS for live claude drivers and their working directories, then joins that with badges,
claims and session-transcript mtimes. It never kills anything.

Statuses: `LIVE`; `LIVE·WAITING` (alive but idle transcript — usually a permission prompt, which
looks "done" from outside); `LIVE·TWIN` (two INDEPENDENT drivers in one directory — two agents on
one worktree/branch; a desktop tab's host+child pair is collapsed by ppid ancestry, so this flag
is real); `UNSTAMPED` (live, no badge ⇒ no status-line identity and **no no-build guard**);
`GHOST` (registry entry with no process). `--reap` clears ghosts only, and skips any whose
transcript moved within the hour.

Detection detail worth keeping: a driver is a process whose executable **basename is `claude`**,
resolved by growing the command line token-by-token until a path exists on disk — the desktop
binary sits under `Application Support` (a path containing a space) and a cmux wrapper shell
carries `claude` inside its arguments, so neither a naive first-token split nor a substring match
is correct.

## Two surfaces: session title (everywhere) + status line (terminal only)

Verified 2026-08-03: **the Claude desktop app does not render a status line.** So the badge
reaches the desktop through the **session title** instead, via `title.js` registered as a
`SessionStart` hook. Marked sessions get the title `<badge> · <basename of cwd>` (≤60 chars);
**unmarked sessions emit nothing and keep Claude's normal AI-generated titles.**

`SessionStart` only — deliberately. A `UserPromptSubmit` registration also works and re-applies
every turn, but it then clobbers any manual `/rename`. Since `SessionStart` fires before anyone
knows what the session is about, the topic comes from the agent instead: the `desktop-orchestrator`
skill ends its first reply with a copyable `/rename 🎛 ORCHESTRATOR <N> · <topic>` line for the operator
to click (`desktop-researcher` does the same with `🔬 RESEARCHER <N>`), and nothing overwrites it
afterwards.

Known limitation (anthropics/claude-code#53023, open): a hook-set title is persisted as
`customTitle` but the live UI does not repaint — it shows up in the session list and after a resume.

`statusline.sh` still prepends the badge in terminal sessions — that is where CLI workers live.

## Auditing markers

`<key>` is a one-way hash, so `marks/<key>` alone cannot be traced back to a directory. `mark.sh`
therefore also writes `marks/<key>.cwd` recording the path it stamped, and `mark.sh --list` prints
every marker as `key<TAB>badge<TAB>cwd`. Readers (`guard.js`, `title.js`, `statusline.sh`) only
ever read `marks/<key>` — the sidecar is purely for humans.

## Staleness

`statusline.sh` only renders a marker modified within the last 24h (`find -mtime -1`). An older
marker prints nothing — a stale badge must not mislead. The guard has no such expiry: it keys off
the marker's existence, so `--clear` is the way to retire one.

## Disabling the guard

Either `mark.sh --clear` in that cwd (guard is inert without an orchestrator or researcher
marker), or delete the `hooks.PreToolUse` entry pointing at `guard.js` from
`~/.claude/settings.json`. A session with no marker, or a worker badge, is completely
unaffected either way. In researcher sessions the guard additionally denies the
`introduce-goal` skill — minting workers is the orchestrator's exit hatch; a researcher
reports findings to the live orchestrator instead.
