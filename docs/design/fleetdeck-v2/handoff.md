# Fleetdeck v2 redesign — handoff inventory

Seat: 🎨 DESIGN 35 · started 2026-09-07. Operator rule for this design (memory `design-copy-must-be-verbatim`):
**step 1 = verbatim 1:1 copy of the mock, pixel-diff gated; step 2 = wire the existing logic, behaviour unchanged.**

## Source

| Item | Value |
|---|---|
| Handoff folder | `/Users/misterislez/Downloads/final Fleetdeck design/` (operator, 2026-09-07 01:21) |
| Shape | Claude Design export: ONE artboard `Fleetdeck Final.dc.html` (2176 lines, 207 KB) + `support.js` (dc-runtime, generated) + `.thumbnail` + `uploads/` |
| Superseded | `/Users/misterislez/Downloads/Fleetdeck landing page redesign/` (App v1/v2/v3/Light, Landing v1/v2, Investor Deck as separate artboards) — **dropped by the operator, not the spec** |
| Repo copy | `docs/design/fleetdeck-v2/mock/` — html, support.js, thumbnail.webp, `uploads/fleetdeck-eye-minimal.svg` (the only referenced upload) |
| Render locally | launch config `mock` → http://localhost:4173/Fleetdeck%20Final.dc.html (python http.server over the mock dir). Runtime pulls React 18 UMD from unpkg, so it needs network. |

## Uploads

| File | Referenced by artboard | Role |
|---|---|---|
| `fleetdeck-eye-minimal.svg` | yes (6×: landing nav, deck slide headers) | logo — copied to repo |
| `blue-eye-logo 1.svg` | no | unused alt logo |
| `My Project_1.mp4` (19 MB) | no | unused; artboard uses CloudFront videos |
| `draw-e17a711b….png` | no | operator's annotated screenshot of the Message bus screen (design-iteration note) |
| `pasted-1788727246998-0.png` | no | scrollbar crop (design-iteration note) |

External assets the artboard loads (verbatim port keeps them; see open item O5):
- videos: `https://d8j0ntlcm91z4.cloudfront.net/…/hf_20260611_104107_….mp4` (dark), `…/hf_20260729_102822_….mp4` (light)
- provider logos in the Accounts rail: wikimedia `Claude_AI_symbol.svg` and `ChatGPT-Logo.svg` PNG thumbs
- font: Inter 400–700 from Google Fonts; deck uses `'Aeonik'` with Helvetica Neue fallback (Aeonik is not loaded anywhere)

## Runtime (what "verbatim" means here)

`support.js` is the Claude Design `dc-runtime`: it takes the `<x-dc>` innerHTML as a template, evaluates the `<script data-dc-script>` class (`extends DCLogic`), and renders with React 18 (`window.React` from unpkg). Bindings: `{{ expr }}` from `renderVals()`, `sc-if` conditional, `style-hover` / `style-focus` pseudo-states, `ref="{{ x }}"` DOM refs. One root component switches `state.view` between `land` / `app` / `deck` (L2124-2133).

## Screens (18 `data-screen-label`s) → current surface

| # | View | Screen label | Mock lines | Current implementation |
|---|---|---|---|---|
| 1 | land | Landing (shell: fixed nav, video/canvas bg) | 37-65 | none — no landing page exists |
| 2 | land | Hero | 66-95 | none |
| 3 | land | Capability | 97-135 | none |
| 4 | app | Fleetdeck app (shell: bg video, sidebar 252/64, main, right rail 222, toast, back pill) | 140-220, 738-780, 965 | `public/index.html` `#sidebar`/`#grid`, `style.css` |
| 5 | app | Windows | 222-249 | `#grid` `.tile` (app.js:1020-1179) |
| 6 | app | Org chart | 251-344 | `#orgchart` overlay (app.js:253-392, orgchart.js) |
| 7 | app | Registry | 346-395 | `#fleet` overlay (app.js:614-830) |
| 8 | app | Message bus | 397-501 | `#bus` overlay (app.js:911-979, 1214-1233) |
| 9 | app | SSH keys | 503-566 | `public/keys.html` + `keys.js` |
| 10 | app | Accounts | 568-615 | `public/accounts.html` + `accounts.js` |
| 11 | app | Machines | 617-668 | `public/machines.html` + `machines.js` |
| 12 | app | Desktop sessions | 670-735 | `public/sessions.html` + `sessions.js` |
| 13 | app | Session full screen | 781-815 | `.tile.max` + `body.has-max` drawer switcher (app.js:860-863, 1007-1011, 1140-1145) |
| 14-18 | deck | 01 Title … 05 Expansion | 819-963 | none — investor deck is a new surface |

Every screen above has a diff-ledger row in `diff.md`; nothing in the artboard is left uninventoried.

## Seed data in the artboard (becomes the fixture for the pixel gate in step 2)

`tiles[]` (4), `groups[]` (2 boxes), `regData[]` (12), `busSessions[]` (8) + `busGroups[]` + `seedThreads{}`, `orgScopeData` + `orgCard()` (3 spine + kids + 9 unattached), `keyRows[]` (9), `accounts[]` (5), `machines[]` (2), `dsData[]` (2 people, 10 rows), `termLinesFor()` (canned transcript). Field shapes are listed in `diff.md` §"Binding map".

## Current implementation (for the diff)

Static, no build step: `public/index.html` + `app.js` (1260 lines, monolith) + `orgchart.js` + `style.css` (933 lines, dark default + `:root[data-theme='light']`), plus four standalone pages (`keys`, `accounts`, `machines`, `sessions`). Vendored xterm via the `VENDOR` map in `server.js:2361`. localStorage keys: `fleetTheme`, `showHidden`, `fleetTab`, `fleetSort`, `fleetFilter`. Polling: org 30s + 1s ticker, desktop sessions 30s, machines 60s, keys 30s; one WebSocket per tile on `/term`. API surface: see `diff.md` §"Behaviour contract".
