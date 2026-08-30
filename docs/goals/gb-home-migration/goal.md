# Goal — GB-home migration (worker TBD at launch)

Project **remote-system (fleetdeck)**. Operator proposal + O12 endorsement + confirm:
XYZ-1850 comments (2026-08-29). **Launch gates: XYZ-1854 woven (Zita) AND XYZ-1851 Done
(Lorenz).** Worker name claimed at launch.

**One line:** the coordinator's home — checkout, inbox, coordinator-run commits,
`/api/coordinator/*`, registry/lease backend — moves to the german-box (always online);
the Mac becomes a satellite for Mac-hardware duties. ONE writable home, no split-brain.

## Shape (ruled + census-backed)

**Single codebase, mode flag** (census verdict, reader over server.js @ 509e80f): the
mac-bound surface is a small isolated set — sshkeys/mint routes + `OP_AGENT_SOCK`
(server.js:478,1471-1560) — sharing no fleet.db tables and no in-memory state with the
gb-native reaper/registry/bus. Two instances would mean two fleet.db writers; refused.

- **GB (home, e.g. `FLEET_ROLE=home`):** sole fleet.db writer; leases/heartbeat/reaper
  (tmux polls become LOCAL — the ssh-poll failure class disappears for GB sessions);
  registry; message bus; coordinator home + API; tiles/`/term` (ssh direction flips
  box→mac for Mac lanes; keep excluding `mac` as a kill target, server.js:221,1795).
- **Mac (satellite):** cert-mint keys page (1Password/Touch ID), Desktop bridge; the
  train broker is ALREADY its own Mac service post-XYZ-1854 with its own tailnet
  `/api/ghtoken` surface — unchanged by this migration.

## Seams the lane must solve (census, server.js refs)

1. **fleet.db one-time migration** with lease epochs + seat fencing intact (215-970).
2. **Tailnet listener ownership** (2091-2120): GB home owns the deck tailnet listener;
   mac-only routes (sshkeys/mint) exist only on the Mac satellite; ghtoken/ghtrain live
   in Zita's broker. No route may exist on a host that cannot honor it.
3. **Worker name pool** (772-793: reaper closes names via a Mac-side script) — the pool
   (`~/.claude/workers/`) moves with the home to GB, or the close call becomes an RPC to
   the Mac; recommend MOVE (it is fleet state; Mac orchestrator claims go over tailnet).
4. **Mac-session heartbeats** repoint to the GB deck URL; Mac deck UI habit
   (`localhost:3131`) — satellite serves the UI or proxies to home; decide in-lane.
5. **hosts.json semantics**: mac becomes a probed satellite host; GB stops probing itself.
6. **`FLEET_TAILNET_KEY`** armed on the GB home from day one (key exists:
   Mac `deploy-keys/fleet-tailnet.env`, distributed to box by XYZ-1854 rider).
7. Coordinator-run push cadence from GB: commits local, pushes only while a train is
   open — board/API serve live regardless; document the staleness window.

## Acceptance (sketch — finalize at packaging review)

Deck home runs on GB under the holder invariant; all lease/registry/bus/coordinator
routes green from Mac + box; Mac satellite mints certs; fleet.db migrated with zero
epoch regressions (fencing proofs); ssh-poll alert class gone for GB sessions; rollback
path documented (the Mac can resume home from a db snapshot).

## Protocol

Standard CLI-worker protocol (see sibling packs) — reviewer on every diff, never
orchestrate, broker token pushes, `operator:gate` for every Mac-side or GB-service
activation step. This lane will carry several operator gates by nature; batch them.

## O13 addendum (2026-08-30) — coordinator re-frame + M0 folded in

Supersedes nothing above; re-scopes "coordinator" and adds M0. Operator rulings, verbatim
(2026-08-30, O13 seat):

> "you are the thinkpromptly orchestrator. you dont care about lowcap-connector stuff :)
> i opened a coordinator in the lowcap-connector repo"
> "you are building the coordinator, you arent using it :D"

**Consequences for this pack:**

1. **This repo is the coordinator VENDOR, not a coordinator instance.** Wherever this pack
   says "coordinator home + API", read: the deck's coordinator MACHINERY (code +
   `/api/coordinator/*` serving). No `/coordinator-init` ever runs in this repo; the boot
   gate is permanently disarmed here by design (XYZ-1889 closed on this ruling). This
   repo's `coordinator/` dir is machinery + dev fixture — see `coordinator/README.md`.
2. **New seam 8 — instance-aware board root.** The deck today serves its own checkout's
   `coordinator/board.json` (the stale fixture). The first real customer is the
   lowcap-connector repo's instance (opened by the operator 2026-08-30). The lane must
   make the board root configurable (or multi-tenant) so `/api/coordinator/*` serves
   customer instances, never the vendor fixture. Tracked as its own issue; see the
   XYZ-1890 Linear thread for the ID.
3. **M0 (was Linear-only, now in-pack): `up.sh` becomes versioned and stays the single
   operator command.** `up.sh` is currently UNTRACKED on the Mac (`git ls-files
   --error-unmatch up.sh` fails) — M0 decides how it enters git (vendor as-is vs generate)
   and lands it, including a peer's uncommitted fix to its stale "train dies with it"
   comment. Add the `127.0.0.2` preflight (XYZ-1896 ruling: KEEP the two-address test
   topology; suite fails fast when the alias is missing; up.sh prints the sudo one-liner).
4. **Launch gates: both MET** — XYZ-1854 woven (`ebce6e6`, broker live since 2026-08-29
   22:51) and XYZ-1851 Done. Lane awaits only the operator's run-mode word.
