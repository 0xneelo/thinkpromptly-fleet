# Cutover — Mac → german-box (XYZ-1890 M3 seam 1, M6 seams 3/4/6/7)

Moves the fleet's lease state to the new home with **zero epoch regressions**. Every step is a
command; the prose says only what the command proves.

Tool: `scripts/fleet-db-migrate.js` (`--check`, `--migrate`, `--verify`, `--compare-live`).
Exit 0 = pass, 1 = act on it, 2 = bad usage. Nothing below runs unattended: steps 2, 6, 6b, 6c,
6d, 7 and 8 are operator gates. Step 9 and §The satellite does not serve the UI are decisions,
not commands.

Flags: `--force` overwrites a destination (moving the old one aside, never deleting it),
`--allow-empty` states that a source holding no fleet is intended, `--strict` turns "rows in the
destination that the source never had" from a warning into a failure. The tool refuses an empty
source by default — a proof over zero rows proves nothing, so it can never pass silently.

Paths used here:

    MAC_DB=~/projects/remote-system/fleet.db          # confirm before you start
    CUT=~/fleet.db.cutover                            # the artifact you ship
    BOX_DB=/home/vibe/projects/remote-system/fleet.db # confirm the box checkout path

## Why the sequence matters

Epoch is the fence. `claimStmt` raises it, `fenceCheck` rejects on it, and a holder whose epoch
is behind the row's cannot kill, delete, write registry status or take a seat. So the one thing
this cutover may never do is let a row's epoch come out lower than it went in — that hands a
superseded holder its powers back. The tool proves the file; **the ordering below is what keeps
the file true**, because a Mac deck that keeps serving after the snapshot invalidates it.

## 1. Preflight — while the Mac deck is still up

    node scripts/fleet-db-migrate.js --check "$MAC_DB"

Read-only; safe against the live deck. Record the output — it is the "before" half of the proof.

Proves: `OK — no consistency problems`, and gives you `sessions: N rows, max epoch E`,
`seats: N rows, max epoch E`, `journal_mode=wal synchronous=2 quick_check=ok`.

Stop here if it prints `FAIL` — a db that is already inconsistent stays inconsistent after a
faithful copy, and the fault is upstream of this lane. `this db holds no fleet` means the path is
wrong, not that the fleet is empty: check `$MAC_DB` before anything else.

## 2. operator:gate — stop the Mac deck

    lsof -ti tcp:3131 -sTCP:LISTEN | xargs -r kill
    lsof -ti tcp:3131 -sTCP:LISTEN || echo "deck down"

Nothing may write `fleet.db` from here to step 7. The train broker on :3132 is a separate Mac
service and stays up (XYZ-1854) — it does not touch fleet.db.

Take the forensic copy now, before anything else touches the file:

    cp "$MAC_DB" ~/fleet.db.pre-cutover

Keep it for evidence. **It is not a rollback source** — see §Rollback.

## 3. Snapshot and checkpoint

    node scripts/fleet-db-migrate.js --migrate "$MAC_DB" "$CUT"

Does: copies `fleet.db` + `-wal` + `-shm`, checkpoints the **copy** (`wal_checkpoint(TRUNCATE)`,
never the live source), then runs `--verify` and deletes the target if the proof fails.

Proves: `PASS — examined N fenced src rows (sessions N, seats N), zero epoch regressions,
consistency clean on both sides, 0 dst rows absent from src (dst max epoch: sessions E, seats
E)`. The verdict names what it examined, so read those counts against step 1's — they must
match. `$CUT` is now a single file with no sidecars.

`WARN ... present in dst, absent from src` on a fresh destination means you are not migrating
into the file you think you are. Re-run with `--strict` to make it a failure.

## 4. Confirm the Mac really stopped serving

    node scripts/fleet-db-migrate.js --compare-live "$CUT" "$MAC_DB"

Proves: `NO DRIFT — the source has not claimed since the snapshot`.

`DRIFT` means the deck was still up (or came back) and issued claims the snapshot never saw.
Do not ship that snapshot: fix the gate in step 2 and redo from step 3.

## 5. Ship it, and prove the bytes arrived

    shasum -a 256 "$CUT"
    scp "$CUT" german-box:/tmp/fleet.db.cutover     # any channel works; the checksum is the gate
    ssh german-box "wsl sha256sum /tmp/fleet.db.cutover"

Both digests must match. The box is reached through Windows CMD → wsl (README §Quote-free
rule), so a mangling transfer is a real failure mode — the checksum is what rules it out, not
the transfer command.

Then place it, refusing to clobber:

    ssh german-box "wsl ls -l $BOX_DB $BOX_DB-wal $BOX_DB-shm"   # must be: no such file
    ssh german-box "wsl mv /tmp/fleet.db.cutover $BOX_DB"

## 6. operator:gate — prove it on the box before the box serves from it

    ssh german-box "wsl bash -lc 'cd \$(dirname $BOX_DB) && node scripts/fleet-db-migrate.js --check $BOX_DB'"

Proves, on the runtime that will actually host the db: the same row counts and the same max
epoch per table as step 1, `journal_mode=wal synchronous=2`, `quick_check=ok`, no consistency
problems. That pragma line is `assertPragmas()` (server.js:192-197) asked in advance — a db
that fails it makes the deck throw at boot instead of serving.

Paste step 1, step 3 and step 6 output into the Linear proof comment. Those three together are
the acceptance evidence: same rows, same epochs, boot-clean pragmas.

## 6b. operator:gate — name the box as self, and list the Mac as a probed host

`hosts.json` is a tracked file: the Mac and the box check out the same tree, so editing it is
an activation, not a code change. It is left alone by M5 on purpose — changing it would alter
the live Mac deck's behaviour at its next restart. Do it here, on the box, once step 6 has
passed.

`FLEET_SELF_HOST` is the deck's name for **itself**: the one host it reaches locally and never
ssh-es to. It defaults to `mac`, which is why today's Mac is unaffected. The box must set it,
or it will ssh into itself on every poll.

    # on the box, before step 7
    ssh german-box "wsl bash -lc 'cd \$(dirname $BOX_DB) && cat hosts.json'"

Required contents for a box-hosted home:

    ["mac", { "name": "onboarding-box", "kind": "linux" }, "german-box"]

- **`mac` must be present.** The Mac becomes an ordinary remote fleet host once it is a
  satellite: the box ssh-polls it for tmux sessions, health and credits, and `mac` rows are
  ssh-killable there. Omit it and the box simply stops seeing the Mac's lanes.
- **`german-box` may stay listed.** `PROBE_HOSTS()` (server.js:112) removes `FLEET_SELF_HOST`
  from every ssh fan-out, so self appearing in `hosts.json` is harmless by construction — it
  keeps membership (registry, message targets, kill validation) working for box rows.
- **Do not remove `onboarding-box`** unless it is genuinely gone; it is a real fleet member.

Whichever way the Mac is named in `hosts.json` must be an ssh target the box can actually
reach (`ssh mac true` from the box), or every poll of it reports unreachable.

Two guards, and neither is a substitute for the smoke below. A **blank** `FLEET_SELF_HOST` (a
launch line whose variable never expanded) refuses to boot. An **unset** one still defaults to
`mac`, which cannot be right on a Linux box — so the deck prints a `WARNING: FLEET_SELF_HOST is
'mac' on platform linux` line and serves anyway. Grep `deck.log` for it after step 7:

    ssh german-box "wsl bash -lc 'grep -c \"WARNING: FLEET_SELF_HOST\" deck.log'"

`0` is the answer you want.

The proof that the box does not probe itself is step 7's own smoke: the boot line reports
`self=german-box`, and `/api/health` must list `mac` under `hosts` and must **not** list
`german-box`.

## 6c. operator:gate — arm the tailnet key, before the box ever serves

Seam 6. `up.sh:28-31` sources `deploy-keys/fleet-tailnet.env` if it is there and warns if it is
not. **It is not there on the box today.** Until it is, the box's tailnet listener accepts
`POST /sitrep` — and every other tailnet write — from any peer on the tailnet, unauthenticated.
Loopback is exempt either way, so this gap is invisible from the deck's own machine.

The file is git-ignored (`.gitignore:7`) and mode `600`. **It never enters a commit, and its
value is never pasted into a Linear comment, a log or this runbook.** Copy the operator's
existing key from the Mac, out of band:

    # from the Mac, like every command in this runbook. Stage, then place — the same two-hop
    # shape step 5 uses to ship the db, because /tmp is the one path both sides of the bridge see.
    scp deploy-keys/fleet-tailnet.env german-box:/tmp/ft.env
    ssh german-box "wsl ls -l /tmp/ft.env"
    ssh german-box "wsl bash -lc 'cd \$(dirname $BOX_DB) && install -m 600 /tmp/ft.env deploy-keys/fleet-tailnet.env && rm -f /tmp/ft.env'"

The middle line is not decoration. Both host prefixes are explicit because a `scp` whose
destination carries no host resolves on whichever machine ran it — pasted from the Mac, that
copies the key onto the Mac and the box never sees it. **If the `install` line says `no such
file`, that is exactly what happened:** the file did not arrive. Re-run the `scp` from the Mac
(check your prompt), confirm with the `wsl ls -l`, then re-run the `install`. Nothing is armed
and nothing is lost — the box is simply still unauthenticated, which is where it started.

Shape only, no value: one `export FLEET_TAILNET_KEY=<key>` line (`mac/provision-fleet-secrets.sh:72`
parses `export`-prefixed and bare forms, quoted or not). If you cannot confirm the file's
contents, copy the file — do not retype it.

Verify, before step 7:

    ssh german-box "wsl bash -lc 'cd \$(dirname $BOX_DB) && ls -l deploy-keys/fleet-tailnet.env'"

Must be `-rw-------`. Then, after step 7, the deck's own boot line is the proof:

    ssh german-box "wsl bash -lc 'cd \$(dirname $BOX_DB) && grep lifecycle: deck.log | tail -1'"

Must end `tailnet_key=armed`. `tailnet_key=unset` means the deck did not inherit the key —
`up.sh` sources the file into its own shell, so the deck must be started **by `up.sh`**, not by
a bare `node server.js`.

The detector for the whole seam is `up.sh`'s own line on stdout at start time:

    warn: deploy-keys/fleet-tailnet.env missing — tailnet POST /sitrep runs UNAUTHENTICATED

It goes to the terminal, not to `deck.log`. Read step 7's output; do not grep for it afterwards.

**Arming the key breaks every box hook whose `FD_TAILNET_KEY` does not match** — see step 8,
which is where both sides' hook config is settled. Sequence 6c → 7 → 8 in that order and the
window is one step wide.

## 6d. operator:gate — move the worker Name pool to the box

Seam 3. The pool is fleet state, and only the home reaps, so the pool belongs with the home
(the Mac orchestrator's claims then travel over the tailnet like every other fleet call). On
this box `~/.claude/workers/` holds `roles.md` and nothing else — no `name.py`, no names db.

    # from the Mac, out of band — names.db is operator state, not repo state. Bridged through
    # wsl for the same reason every other box command here is: a bare `rsync`/`scp` to
    # german-box:~/... lands wherever the box's default remote shell puts it, which is the
    # Windows side — not the WSL $HOME that step 7's FLEET_NAME_CLOSE_SCRIPT is evaluated in.
    tar -C ~/.claude -czf /tmp/workers.tgz workers
    scp /tmp/workers.tgz german-box:/tmp/workers.tgz
    ssh german-box "wsl bash -lc 'tar -C \$HOME/.claude -xzf /tmp/workers.tgz && rm -f /tmp/workers.tgz'"
    ssh german-box "wsl ls -l \$HOME/.claude/workers/name.py \$HOME/.claude/workers/names.db"
    rm -f /tmp/workers.tgz    # on the Mac

The last `ls` is the gate: it must name both files, under WSL's `$HOME`. A pool that landed on
the Windows side leaves that `ls` failing while everything else looks done.

Then the box's deck must be told where it went — step 7's launch line carries it.

**Detector.** A `home` deck with `FLEET_NAME_CLOSE_SCRIPT` unset prints, at boot:

    WARNING: FLEET_NAME_CLOSE_SCRIPT is unset on the fleet home — ...

Without it, `nameClose()` (server.js:976-980) logs `name-skip … no FLEET_NAME_CLOSE_SCRIPT set`
and returns. That is fail-safe — it never closes a Name it cannot see — but it leaks one claim
per reap, and names only rotate back after thirty days. The symptom is a pool that looks slowly
exhausted, months later, which is why the boot line exists.

    ssh german-box "wsl bash -lc 'cd \$(dirname $BOX_DB) && grep -c \"WARNING: FLEET_NAME_CLOSE_SCRIPT\" deck.log'"

`0` is the answer you want.

**Fallback, if you overrule the move:** leave the pool on the Mac and make the close call a
tailnet RPC — the box would POST to a Mac-side route that runs `name.py close`. It is rejected
here for three reasons: it invents a new authenticated route for one call, it makes every reap
depend on the Mac being awake (the whole point of moving home to an always-on box), and a
partition then silently leaks exactly the claims this seam exists to release. MOVE has one
cost in exchange — the Mac orchestrator can no longer claim a Name while the tailnet is down.
Overrule with that tradeoff in view.

## 7. operator:gate — start the box as home

    ssh german-box "wsl bash -lc 'cd \$(dirname $BOX_DB) && FLEET_ROLE=home FLEET_SELF_HOST=german-box FLEET_DB=$BOX_DB TAILNET_IP=100.85.213.20 FLEET_NAME_CLOSE_SCRIPT=\$HOME/.claude/workers/name.py ./up.sh'"

All five, every time. Each one is a different silent failure:

- **`FLEET_ROLE=home`** without **`FLEET_SELF_HOST=german-box`** is a deck that ssh-es to itself
  on every poll loop and treats its own lanes as remote, ssh-killable rows.
- **`TAILNET_IP=100.85.213.20`** is the box's own tailnet address. The default is the **Mac's**
  `100.125.231.25` (server.js:14) — right for exactly one host in the fleet, and wrong for the
  one we are moving to. Both `FLEET_TAILNET_BIND` and `FLEET_TAILNET_HOST` derive from it
  (server.js:17-18), so set this one variable rather than those two: one variable cannot
  disagree with itself. Omit it and the box binds an address it does not have, the bind fails
  non-fatally, and the deck serves **loopback only** — see the tailnet check in the smoke below.
- **`FLEET_NAME_CLOSE_SCRIPT`** is step 6d's; drop it and the Name pool leaks one claim per reap.

Every variable here is read once at boot — `docs/fleet-env.md` is the full reference.

Then leave the Mac deck as a satellite (`FLEET_ROLE=satellite`) — it must never open the old
`fleet.db` again. Two homes is split-brain: both would raise epochs, and neither's fence would
mean anything. A satellite probes nothing at all (`PROBE_HOSTS()` is empty off the home role),
so the Mac's `/api/health` comes back with `hosts: []` — that is correct, not a failure.

Smoke, from the Mac:

    curl -s http://german-box:3131/api/health
    curl -s http://german-box:3131/api/seats | head

Seat epochs must be at or above step 1's max. A seat epoch of 1 means the box booted an empty
db — stop, and check `FLEET_DB`.

`/api/health` must name `mac` under `hosts` and must not name `german-box`. Seeing
`german-box` there means `FLEET_SELF_HOST` was not set: stop the deck and redo step 7.

**The tailnet listener, separately — loopback health does not prove it.** A failed tailnet bind
is non-fatal by design (server.js:2413-2430), so the deck above answers everything on loopback
while every route the fleet reaches it by is absent. Three checks, in this order:

    # 1. the deck says it bound. Run this ON the box; the line is the deck's own.
    ssh german-box "wsl bash -lc 'cd \$(dirname $BOX_DB) && grep \"tailnet broker http\" deck.log | tail -1'"

Must read `tailnet broker http://100.85.213.20:3131`. The **address in that line** is the check —
`http://100.125.231.25:3131` means `TAILNET_IP` was not set and the bind was attempted against
the Mac.

    # 2. the negative: nothing swallowed a bind failure
    ssh german-box "wsl bash -lc 'cd \$(dirname $BOX_DB) && grep -c \"tailnet listener unavailable\" deck.log'"

`0` is the answer you want, the same way step 6b's `FLEET_SELF_HOST` grep is.

    # 3. FROM THE MAC, by address — this is the only check that proves reachability
    curl -s http://100.85.213.20:3131/api/health

Run it from the Mac and against the **address**, never from the box and never via `localhost`:
loopback answers identically whether the tailnet listener bound or not, so a check run on the
box proves nothing at all. `german-box:3131` is fine once you trust MagicDNS, but the literal
address is what rules out a name resolving somewhere unexpected.

## 8. operator:gate — repoint the heartbeats (seam 4)

One variable, inverted on each machine. `FD_BASE_URL` is where a session's claim and heartbeat
POSTs go, and nothing in the code needs to change for this: the default lives in
`box/hooks/fd-common.sh:54` and the real value is the `fleet.env` line each host already
carries.

| | before | after |
|---|---|---|
| box (`german-box`) | `http://100.125.231.25:3131` — the Mac, over tailnet | `http://localhost:3131` — home is now local |
| Mac | `http://localhost:3131` | `http://100.85.213.20:3131` — the box, over tailnet |

`100.85.213.20` is the box's tailnet address (node `poppy-worker`); `100.125.231.25` is the
Mac's (`misters-macbook-pro`). The fleet names — `german-box`, `mac` — are a different
namespace and stay exactly as they are in `hosts.json` and `FD_HOST`.

Files that carry it:

- **box** — `~/.claude/fleet/fleet.env`, seeded once by `box/hooks/install-box.sh:177` and never
  rewritten. Edit it in place, or use `box/fleet-env-set.sh`.
- **Mac** — `~/.claude/fleet/fleet.env` on the Mac, per `box/hooks/INSTALL-MAC.md:135`. The
  three documented Mac/box differences are tabulated at `INSTALL-MAC.md:63`; this cutover
  inverts the first and the third of them.

Commands:

    # box
    ssh german-box "wsl bash -lc 'sed -i s#^FD_BASE_URL=.*#FD_BASE_URL=http://localhost:3131# ~/.claude/fleet/fleet.env'"
    ssh german-box "wsl bash -lc 'grep FD_BASE_URL ~/.claude/fleet/fleet.env'"

    # Mac
    sed -i '' 's#^FD_BASE_URL=.*#FD_BASE_URL=http://100.85.213.20:3131#' ~/.claude/fleet/fleet.env
    grep FD_BASE_URL ~/.claude/fleet/fleet.env

The environment wins over the file (`fd-common.sh:35-53`), so a shell that exports
`FD_BASE_URL` overrides both. Check for one before blaming the file.

**`FD_TAILNET_KEY` inverts with it.** The key gates writes on the *tailnet* listener only;
loopback is exempt. So after step 6c and this step:

- the **Mac** now needs `FD_TAILNET_KEY` in its `fleet.env` — it did not before, and
  `INSTALL-MAC.md:63` still says "never needed", which is true only while home is the Mac.
  Without it every Mac lane's claim and heartbeat gets `401`.
- the **box** no longer needs it. Leave it; it costs nothing and it is what rollback needs.

**Copy the value, do not retype it** — the same rule step 6c states, for the same secret. Read
it out of the file the Mac already holds, with the parser `mac/provision-fleet-secrets.sh:72`
uses, so it never becomes a shell word and never lands in history:

    # on the Mac, from the repo root. This is mac/provision-fleet-secrets.sh:71-76's own
    # read_key, verbatim — it never sources the file and never echoes it. The seeded
    # FD_TAILNET_KEY line is commented out, and a sourced file takes the last assignment,
    # so appending is the whole edit.
    read_key() {
      sed -n 's/^[[:space:]]*\(export[[:space:]][[:space:]]*\)\{0,1\}FLEET_TAILNET_KEY=//p' \
        deploy-keys/fleet-tailnet.env |
        tail -n 1 |
        sed -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'\$/\1/" |
        tr -d '\r\n'
    }
    { printf 'FD_TAILNET_KEY='; read_key; printf '\n'; } >> ~/.claude/fleet/fleet.env
    chmod 600 ~/.claude/fleet/fleet.env

Verify by length, never by eye — the same reason step 5 compares checksums instead of reading
bytes. The two numbers must match, and neither prints the key:

    sed -n 's/^FD_TAILNET_KEY=//p' ~/.claude/fleet/fleet.env | tail -n 1 | tr -d '\r\n' | wc -c
    read_key | wc -c

A wrong `FD_BASE_URL` is silent by contract — a hook may never break its session — so the
detector is behavioural: claim a lane and look for its row.

    curl -s http://100.85.213.20:3131/api/sessions | head        # from the Mac
    tail -5 ~/.claude/fleet/logs/*.log                           # on the host that went quiet

A `401` is loud, by contrast: it is logged by name and written to `~/launch/fd-alerts/<session>.txt`.

### Why this is the acceptance criterion, not a nice-to-have

**The ssh-poll alert class is gone for GB sessions by construction, not by suppression** — and
the step that does it is **step 7**, not this one. `FLEET_SELF_HOST=german-box` is what removes
self from every ssh fan-out: `PROBE_HOSTS()` (server.js:112) filters it out, and the cascade
guard's poll trip is guarded by `host !== FLEET_SELF_HOST` (server.js:1097). From the moment the
box boots with that variable, no ssh is opened towards `german-box` at all, so
`cascade guard: ssh poll is failing` and every alert derived from a GB poll have no code path to
fire from. Nothing filters them; the branch is unreachable.

This step completes the other half. The deck's poll of a GB lane became local at step 7; the
lane's own heartbeat becomes local here, when `FD_BASE_URL` turns into `http://localhost:3131`.
After both, nothing about a GB session crosses an ssh or a tailnet hop — which is why the
acceptance check below is run after step 8, even though the alert class died at step 7.

The proof is an absence, so measure it against a positive control:

    curl -s http://100.85.213.20:3131/api/health | jq '.alerts, .hosts'

`hosts` must list `mac` and must not list `german-box`; `alerts` must carry no `german-box`
entry. The Mac's own ssh-poll alerts remain possible — that class moved, it did not vanish —
which is what makes the absence of the GB ones meaningful rather than a broken poller.

## 9. Coordinator-run push cadence from GB (seam 7 — documentation only)

Nothing to run. This states the staleness window so it is a known quantity rather than a
surprise.

A coordinator run on the box commits **locally**. It pushes only while a GitHub train is open —
the train broker holds the installation token, and the token is the only way to push. The board
and `/api/coordinator/*` read the **working tree** on every request, so they are never behind
the commits, train or no train.

Two readers, two different truths:

| Reader | Sees | Freshness |
|---|---|---|
| `/api/coordinator/*`, the deck's board UI | the working tree, read per request | live — no staleness window at all |
| the GitHub remote (web UI, a `git fetch`, CI) | the last commit that was pushed | stale until the next train |

**How long they can diverge:** for as long as no train is opened. A train is an operator action,
so the window is bounded by operator attention, not by a timer — minutes when someone is
working, and open-ended overnight or across a weekend. A run finished at 02:00 with no train
until Monday is not on GitHub until Monday, and this is intended: the commits exist, they are
fenced, and nothing is lost.

Consequences worth stating plainly:

- **A reader on GitHub is not a reader of fleet state.** Anyone diagnosing "the coordinator did
  not do X" from the remote may be reading a stale tree. Ask the API.
- **No caller is ever blocked by an unpushed commit.** The API does not consult the remote.
- **Local commits are the durable record**, and the box is always on — the reason home moved
  there. A pending push is a distribution delay, not a data risk.

## The satellite does not serve the fleet UI — decision, XYZ-1890 M6

**Point the browser at the box's deck.** `http://100.85.213.20:3131` (or `http://german-box:3131`
if the tailnet MagicDNS name resolves). The Mac satellite is not made a fleet UI and does not
proxy to home. Its static files stay ungated, so the page still loads there — it is simply not
the board any more.

Reasoning:

1. **A satellite's fleet data is legitimately empty.** M5 made `PROBE_HOSTS()` empty off the
   home role (server.js:112), so `/api/sessions` on the Mac is empty because a satellite has no
   business ssh-polling the fleet — not because anything failed. Serving a UI over that would
   render an empty board that looks broken.
2. **A proxy is a bigger change than this lane should make blind.** Forwarding to home means
   carrying credentials across the tailnet boundary: the loopback listener is exempt from the
   tailnet key precisely because reaching it means being on that machine already, and a proxy
   would break that assumption for every privileged local route at once. That is a security
   design, not a plumbing change.

Costs, honestly:

- **The `localhost:3131` habit breaks.** The Mac's deck still answers there — the page, the key
  routes, `/api/health` — but every fleet route is a 404 and the board has nothing in it.
  Bookmark the box.
- **A satellite's UI looks empty rather than explaining itself.** It renders, it just has no
  fleet in it, and today nothing on the page says why.

That second cost is tracked as **XYZ-1911** — a "this deck is a satellite, home is at X" banner.
It is filed separately because it needs the deck to tell the browser what it is, which no route
does yet; the role is a server-side constant that never reaches the client.

## Rollback — the Mac resumes home

**Rollback carries the BOX's current db back. Never `~/fleet.db.pre-cutover`.**

The moment the box serves one claim, the pre-cutover file is behind: it lacks every epoch the
box raised. Booting the Mac on it regresses those rows, and every holder the box superseded is
un-fenced — the exact break this milestone exists to prevent. The pre-cutover file is evidence,
not a database. To see precisely what reusing it would cost:

    node scripts/fleet-db-migrate.js --compare-live ~/fleet.db.pre-cutover ./fleet.db.from-box

Every `DRIFT` line is a fence that reusing the old file would drop.

Steps:

    # 1. stop the box deck (operator gate) — no writer, same rule as step 2
    ssh german-box "wsl bash -lc 'pkill -f \"node server.js\" || true'"
    ssh german-box "wsl bash -lc 'pgrep -f \"node server.js\" || echo box deck down'"

    # 2. carry the box's db back, with its wal
    ssh german-box "wsl sha256sum $BOX_DB"
    scp german-box:$BOX_DB ./fleet.db.from-box
    scp german-box:$BOX_DB-wal ./fleet.db.from-box-wal    # only if the box deck died uncleanly
    shasum -a 256 ./fleet.db.from-box

    # 3. install it as the Mac's db, keeping whatever is there
    node scripts/fleet-db-migrate.js --migrate ./fleet.db.from-box "$MAC_DB" --force

`--force` moves the existing `$MAC_DB` aside to `$MAC_DB.pre-migrate-<stamp>` and prints the
path it used — it overwrites, it never deletes, and a repeated `--force` gets its own backup
name rather than replacing the previous one. The run ends in the same `PASS` proof as step 3; if
it fails, the target is removed and the moved-aside file is named in the error, so nothing is
lost either way.

    # 4. start the Mac as home again
    FLEET_ROLE=home ./up.sh
    node scripts/fleet-db-migrate.js --check "$MAC_DB"

Max epoch per table must be at or above what the box reported in step 6. Lower means you
rolled back onto a stale file: stop the deck and redo from rollback step 2.
