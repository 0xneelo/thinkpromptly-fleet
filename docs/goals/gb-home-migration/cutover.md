# fleet.db cutover — Mac → german-box (XYZ-1890 M3, seam 1)

Moves the fleet's lease state to the new home with **zero epoch regressions**. Every step is a
command; the prose says only what the command proves.

Tool: `scripts/fleet-db-migrate.js` (`--check`, `--migrate`, `--verify`, `--compare-live`).
Exit 0 = pass, 1 = act on it, 2 = bad usage. Nothing below runs unattended: steps 2, 6 and 7
are operator gates.

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
problems. That pragma line is `assertPragmas()` (server.js:109-115) asked in advance — a db
that fails it makes the deck throw at boot instead of serving.

Paste step 1, step 3 and step 6 output into the Linear proof comment. Those three together are
the acceptance evidence: same rows, same epochs, boot-clean pragmas.

## 7. operator:gate — start the box as home

    ssh german-box "wsl bash -lc 'cd \$(dirname $BOX_DB) && FLEET_ROLE=home FLEET_DB=$BOX_DB ./up.sh'"

Then leave the Mac deck as a satellite (`FLEET_ROLE=satellite`) — it must never open the old
`fleet.db` again. Two homes is split-brain: both would raise epochs, and neither's fence would
mean anything.

Smoke, from the Mac:

    curl -s http://german-box:3131/api/health
    curl -s http://german-box:3131/api/seats | head

Seat epochs must be at or above step 1's max. A seat epoch of 1 means the box booted an empty
db — stop, and check `FLEET_DB`.

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
