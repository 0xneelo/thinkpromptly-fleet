# XYZ-1742 — Org-chart tree rework

**Worker:** Dagmar · frontend-developer · german-box
**Branch:** `agent-dagmar` · **Tag:** `agent-dagmar`
**Date:** 2026-08-29
**Status:** DONE — acceptance 1-4 green.

## Operator ruling applied

> "the goal was to have an org chart like a tree"
> "separating them by machines doesn't make sense, it's just about their parent-child
> relationship, not related to physical machines."

The old render grouped indented card lists under host headings. That is gone. The Org chart
is now a classic node-link tree: root at top, children below, CSS connector lines between
levels. A host is a text label on a node card. It is never a container.

## What changed

Five files, all under `public/`. No server, hook, or coordinator file was touched. No new
package, no build step, no external asset.

| File | Change |
|---|---|
| `public/orgchart.js` | `buildTree` rewritten. Returns `{roots, unattached}`. The `'host'` node type, `hostKey()` and `orphanUnderHost()` are deleted. |
| `public/app.js` | `orgSessionCard`/`orgBranch`/`orgRoot` replaced by `orgNodeCard`/`orgTreeNode`/`orgRootTree`. `renderOrg` builds a forest plus one collapsed unattached strip. |
| `public/index.html` | New panel copy; added `#org-unattached`. |
| `public/style.css` | Node-link tree layout (`.org-forest`/`.org-level`/`.org-cell`), compact 236px node card, seat badge, unattached strip. Dead host/branch/item rules removed. New `--org-link` connector token per theme. |
| `public/orgchart-m11.fixture.json` | Now a 4-level fixture. Added the grandchild reader `RD-hilde`; reparented the Mac tombstone under the coordinator. |

### Hierarchy rules

- Roots are seat holders, coordinator above orchestrator. The seat is a badge on the owner's
  own card, so the owner session *is* the root.
- A seat with no owner row renders a dashed `seat-vacant` root that says "No current owner row".
- Children hang from `(parent_host, parent_name)`. Depth is unbounded; the fixture proves 4 levels.
- A session with no resolvable parent — missing row, or a cycle — goes into ONE flat
  `<details>` strip below the tree. The strip is collapsed by default and is never split by host.
- The cycle guard from the old build is kept, so a malformed parent loop cannot hide its members.

### Semantics kept, unchanged

Liveness stays `tmux-live OR lease_state === 'active'`. Every state cue survives: active green
dot and glow, suspect amber pulse, reaped grey, Mac-reaped tombstone with `🪦 close me`,
`pinger_dead` blue dot, `idle 15m+`. Each node still carries epoch, lease state, lease age,
expires countdown, worker Name, role, and group/task.

One live-mode fix: `GET /api/seats` returns no `epoch` field (only the committed fixture has
one), so the seat badge now prints `#<epoch>` only when the value exists. It used to be able to
print `#null`. The API is frozen and was not touched.

## Acceptance

### 1. Fixture renders the full tree with connecting lines, both themes — GREEN

`?orgFixture=1`. Measured in the page: 2 roots, 8 nodes, max nesting depth 3 `.org-level`
generations (4 card levels), 1 unattached, strip collapsed, no `#null` anywhere.

Tree shape from `buildTree`:

```
coordinator seat -> mac/FD-coordinator
                     └── mac/FD-old-desktop        (tombstone, close me)
orchestrator seat -> german-box/FD-orchestrator
                     ├── german-box/FD-alfons
                     │    ├── german-box/RD-hilde  (grandchild reader)
                     │    └── german-box/LC-konrad (pinger_dead, idle 15m+)
                     └── german-box/LC-edith       (suspect)
unattached: german-box/FD-stray
```

Screenshots, all 1440 wide, visually inspected after capture:

| File | Size | SHA-256 |
|---|---|---|
| `public/screenshots/xyz-1742-orgtree-fixture-dark.png` | 1440×1342 | `ab18425985cb2a08bc6908d0df03e2b09787ddbaf7042b8d4671a8a88da04490` |
| `public/screenshots/xyz-1742-orgtree-fixture-light.png` | 1440×1342 | `d281535ba3cf67321ad2801895897e969c7039b46f7a6514495b91517c3ed48e` |
| `public/screenshots/xyz-1742-orgtree-fixture-dark-unattached.png` | 1440×1508 | `b6078797a039a6a57f0f23d31e43951a9fc7b38bb3afe6d2252db070995a3cce` |

The third shot has the unattached strip expanded, since it is collapsed by default.

### 2. Live mode shows the real parent edges — GREEN

Ran a disposable instance on my own box, own port, own scratch DB, empty hosts file, reaper
off. Nothing could reach the operator's deck:

```
PORT=48212 FLEET_DB=/tmp/fd-dagmar-check/fleet.db \
FLEET_HOSTS_FILE=/tmp/fd-dagmar-check/hosts.empty.json \
FLEET_TAILNET_BIND=127.0.0.3 FLEET_TAILNET_HOST=127.0.0.3:48212 \
FLEET_NO_REAPER=1 node server.js
```

The UI fetched the real `/api/seats` and `/api/sessions`. Measured in the page:

- roots: `mac/FD-coordinator`, `mac/FD-orchestrator`
- children of the orchestrator root: `german-box/FD-alfons`, `german-box/FD-dagmar`,
  `german-box/FD-edith`, `german-box/FD-konrad` — the four FD-\* workers, via their real
  `(parent_host, parent_name)` edges
- suspect and `pinger_dead` cues rendered from live lease state
- zero page errors and zero console errors

| File | Size | SHA-256 |
|---|---|---|
| `public/screenshots/xyz-1742-orgtree-live-dark.png` | 1440×940 | `9b5badb658d68b442851ea8371c0e7da4677de3984f074e2169e361324467ca5` |
| `public/screenshots/xyz-1742-orgtree-live-light.png` | 1440×940 | `9ca7f645b8f8328cdb3dc8e77e6f782a4984c9ccf62270b43b1b93fb2d716709` |

### 3. Other views and tests untouched — GREEN

`npm test` → `tests 76 / pass 76 / fail 0`. No test file was edited. Windows, Registry and Bus
markup and code paths are untouched; the diff is five files, all under `public/`, and the org
panel keeps the same fixed-overlay model, so open terminal tiles keep their websockets.

### 4. No horizontal page scroll — GREEN

Measured `documentElement.scrollWidth > clientWidth` and the same on `body` and on the org
panel, at three widths, in both fixture and live mode:

| Width | Page overflow | Body overflow | Panel overflow | Tree scrolls in its panel |
|---|---|---|---|---|
| 390×844 | no | no | no | yes |
| 1024×800 | no | no | no | yes (live) |
| 1440×900 | no | no | no | no |

`#org-tree` carries `overflow-x: auto`, so a wide tree scrolls inside the panel only.

## Review and hardening

I fuzzed `buildTree` before review and ran a Sonnet reviewer over the diff. Six defects were
found and all six are fixed. Four of them predate this rework or were introduced by it; each
one could hide a session or a seat from the operator, which is exactly what this panel exists
to prevent.

| # | Severity | Defect | Fix |
|---|---|---|---|
| 1 | high | A session whose parent row is absent lands in the strip. Its own children had already attached to it, and the flat strip rendered only the entry's card — so whole subtrees never reached the DOM. With an empty seats table this drops real workers. | The strip renders each entry with the same `orgRootTree` used for the roots, so children survive. The count badge and the status line count the whole subtree. |
| 2 | medium | `wouldCycle` walked the raw parent chain and ignored that a seat root's own parent edge is unused. A stale parent pointer on a seat owner refused every legitimate child of that root. | The walk stops at seat-root keys. Genuine cycles still land in the strip. |
| 3 | medium | Two seat rows resolving to the same owner session dropped the second seat entirely — no root, no card, no trace of the conflict. | The seat loop is now exhaustive. The losing seat renders a dashed root reading "Owner row already holds another seat". |
| 4 | low | The live seat badge could print `#null`, since `/api/seats` carries no `epoch`. | The epoch span renders only when the value exists. |
| 5 | low (pre-existing) | `loadOrg`'s catch cleared the DOM but never reset `orgTicks`, so the ticker kept writing into detached nodes every second. | `orgTicks` is reset on the error path. |
| 6 | low | `.org-empty-state` still carried `grid-column: 1 / -1` from the deleted grid layout. | Removed. |

Invariants now proven by direct fuzzing: every input session appears exactly once across
roots, children and the strip; a self-parent, a mutual cycle, a missing owner row, a duplicate
seat owner and a fleet with no seats at all all render without losing a row.

The reviewer confirmed no `innerHTML` use anywhere in the new render path — it is built
entirely from `textContent` and element helpers — and no host grouping reintroduced.

## Notes for the next worker

- `node_modules` is not present in this worktree. I symlinked
  `../edith/node_modules` to run the suite and removed the symlink before committing.
  A symlink does not match the `node_modules/` gitignore rule, so it shows as untracked — do
  not commit it.
- The screenshot harness lives in this session's scratchpad, not in the repo. It serves
  `public/` from a throwaway static server for fixture mode and drives Chromium through the
  Playwright copy in the npx cache. Nothing was added to `package.json`.
- The org panel is `position: fixed` and scrolls internally, so a Playwright `fullPage`
  screenshot only ever captures the viewport. Grow the viewport to `#orgchart.scrollHeight`
  instead.

— Dagmar
