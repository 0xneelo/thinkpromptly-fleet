# Lane 2 — session hooks + detached pinger (Konrad · devops-engineer)

**Goal (one line):** every fleet session registers itself at start (lease-claim with
parent edge), heartbeats via a **detached** pinger obeying the M8 contract, and
deregisters at end — shipped in-repo under `box/hooks/`, installed box-side, with a
documented Mac install step for the operator.

## Scope

**In:** new `box/hooks/` in this repo: `lease-claim.sh`, `fd-pinger.sh`,
`deregister.sh`, `install-box.sh`, `INSTALL-MAC.md`; wiring into the **box's**
`~/.claude` (SessionStart/SessionEnd hooks + `mark.sh --worker` integration) and a
Codex-breed wrapper (Codex has no hooks — wrap the launch line or piggyback the
launcher). **Out:** `server.js` (Lane 1), UI (Lane 3), the operator's Mac `~/.claude`
(deliver `INSTALL-MAC.md` instead — the orchestrator/desktop sessions there install it
manually), editing `gb-launch-fd.sh`'s Mac-side copy.

## The pinger contract is FROZEN (CONTRACT.md + audit M8)

- Detached process spawned by SessionStart (a hook-only heartbeat false-positives during
  long Bash calls — handoff §5 caveat). Statusline ping may supplement, never replace.
- Before every beat: `tmux has-session -t <ses>` (box) / `kill -0 <pid>` (mac); check
  fails ⇒ exit silently. Transient curl failure ⇒ keep beating. HTTP `410` ⇒ stop +
  tombstone note to `~/launch/tombstones/<ses>.txt`. `409` ⇒ stop pinging, surface.
- Cadence from the server's `ttl_s/3` — parse the claim/beat response, no hardcoded 30.
- Target `http://100.125.231.25:3131` from the box, `http://localhost:3131` on mac —
  one env var, no other difference.

## Acceptance

1. A launcher-started Claude session on the box: lease row appears with correct
   `worker/role/pid/parent_*` within one TTL; survives a 10-min busy Bash call without
   going suspect; row expires within one TTL of `tmux kill-session`.
2. Same for a Codex-breed session (wrapper path).
3. Kill the pinger only → session flagged `pinger_dead`, not reaped (M5 behavior,
   verified against Lane 1's instance once landed; stub server until then).
4. `install-box.sh` idempotent (run twice = no dupes); `INSTALL-MAC.md` complete enough
   that the operator needs no other doc.
5. No secrets in any hook; zero-quote-safe strings; nothing writes the Mac from the box.

## Milestones

**A** stub server harness (contract mock) · **B** pinger + tests · **C** SessionStart/End
wiring, box install · **D** Codex wrapper · **E** integration vs Lane 1's landed branch ·
**F** report → `reports/konrad.md`

## Conditions

Test against your own stub/instance, never the operator's deck. Coordinate with Edith
only through the contract + Linear — if her branch isn't landed by milestone E, checkpoint
and finish everything stub-verified rather than waiting idle.
