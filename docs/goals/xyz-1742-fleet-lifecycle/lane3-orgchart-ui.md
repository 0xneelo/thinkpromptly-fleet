# Lane 3 — org-chart UI (Alfons · frontend-developer)

**Goal (one line):** replace fleetdeck's flat session list with a live org **tree** —
seats at the roots, sessions under their parents, status glows, 🪦 stale rows — rendered
from `GET /api/sessions` + `GET /api/seats` exactly as `CONTRACT.md` M11 defines them.

## Scope

**In:** `public/` only (deck client: new org-chart view alongside the existing
Windows/Registry/SSH-keys views; shared CSS as needed). **Out:** `server.js` and any API
change (Lane 1), hooks (Lane 2). Until Lane 1 lands, develop against a static fixture
JSON implementing the M11 row shape — commit the fixture; switch to the live endpoint at
integration.

## Render rules (frozen)

- Tree: seat rows (coordinator, orchestrator) as roots; each session under
  `(parent_host,parent_name)`; orphans grouped under their host node. v1 shows tmux
  sessions + mac desktop rows only — no leaf subagents (S6).
- Liveness: `live := tmux-live OR lease_state='active'` (M11 — mac rows are never in
  tmux ls; a fresh lease must render live).
- States: active=green glow · suspect=amber pulse · reaped/box=grey until gone ·
  reaped/mac=🪦 + "close me" affordance · `pinger_dead` flag=blue dot ·
  `needsAttention` after 15 idle minutes (handoff §6, office-panel concept).
- Show per node: worker Name, role, group/task (Linear key), epoch, lease age,
  `expires_at` countdown. Keep the existing views working; org chart is a new tab.

## Acceptance

1. Fixture covering: both seats, a 3-level chain, an orphan, a mac 🪦, a suspect, a
   `pinger_dead` — renders correctly (screenshot in report) in light + dark.
2. Zero layout breakage of existing views; no new build step (deck is plain static
   files); no external CDN.
3. Poll cadence ≤ the existing sessions poll; tree stable across refreshes (no
   re-ordering jitter).
4. Integration pass against Lane 1's branch once landed (or documented as pending with
   the fixture proof if Lane 1 hasn't landed at your finish).

## Milestones

**A** fixture + row-shape module · **B** tree layout + states · **C** countdowns/glows/
🪦 affordance · **D** integration + dark mode · **E** report → `reports/alfons.md`
(screenshots committed).
