# fd-v2 S1 execution report

Status: **COMPLETE — all seven Acceptance checkboxes are satisfied under the DESIGN-35 Linear-pending ruling.**

Worker: **Waldemar** (`frontend-developer`, `agent:waldemar`). Project: `remote-system` / `fleetdeck-v2`.
Updated: 2026-09-06T23:34:53.014405+00:00.

## What landed

The source artboard is copied mechanically into `public/v2/index.html`. Reversing its seven T1/T2 substitution kinds (19 occurrences) reproduces the source byte-for-byte. The runtime differs by exactly three dependency URLs. Independent review verified all 25 protected mock/oldUI files remain byte-identical to base `76c859cd96506f8686febe47741845f5870b5813`.

All runtime, fonts and media are vendored: React 18.3.1, ReactDOM 18.3.1, Babel 7.29.0, design dc-runtime, Inter Latin 400/500/600/700, the eye SVG, both videos and both provider PNG logos. `public/v2/vendor/MANIFEST.md` covers 15 files, 19,151,780 bytes, with SHA256, sizes, sources and licenses. All three runtime dependencies match the original SRI digests. The two videos are 5,328,811 and 10,321,675 bytes; neither was transcoded.

The artifact README has exactly 10 lines. `server.js` contains only the five allowed MIME additions. All verification URLs use `/v2/index.html`. DESIGN-35 decided S1-ROUTING on 2026-09-07: directory routing is deferred to L1; no S1 routing edit.

## DESIGN-35 final review fixes

Both `package.json` and `package-lock.json` were checked out verbatim from `origin/agent-v2-s0` again at `cf88d293b058fa87c4e43511393a4acbc365acad`, followed by a successful `npm ci` (10 packages added, zero vulnerabilities). Source-byte equality was verified for both files: package SHA256 `843e226af2941908936bcd28ef5d7fe7146e93c0c960cb1975989b27004c149f`; lock SHA256 `08a19654f09d1dce931a6d435459bf8f7d4bc2451e4a3c347b84d02b3e5d3b28`. The final files use Gisbert's dependency resolution and package script verbatim.

Inter's shared WOFF2 was parsed directly using fontTools 4.64.0 and Brotli 1.2.0: `fvar` defines the `wght` axis from 100 through 900 (default 400), covering 400/500/600/700. `gvar` contains 518 entries, 511 varying glyphs and 1,019 variation tuples. This is structural proof of a variable font; the font bytes and SHA256 remain unchanged. `MANIFEST.md` records the proof and command. No replacement font was needed.

The S1 gate was rerun after these checks; the final report below is from that rerun. The artifact README now uses `S1-recheck` for safe later repeats, preserving the committed S1 evidence directory. MIME checks were refreshed after the README/manifest updates: 19/19 pass against the final public files.

## Substitution table as applied

Strings below use JSON notation so the font-block newline is explicit. All pairs are quoted in the corresponding commit bodies. Raw `diff -u` output is committed as `verify/S1/port-diff.txt` (15,690 bytes); an independent reconstruction matched it exactly.

| File | Tag | OUT | IN | Count |
|---|---|---|---|---:|
| `public/v2/index.html` | T1 runtime | `"<script src=\"./support.js\">"` | `"<script src=\"/v2/vendor/dc-runtime.js\">"` | 1 |
| `public/v2/index.html` | T1 fonts | `"<link rel=\"preconnect\" href=\"https://fonts.googleapis.com\">\n<link href=\"https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&amp;display=swap\" rel=\"stylesheet\">"` | `"<link rel=\"stylesheet\" href=\"/v2/vendor/inter.css\">"` | 1 |
| `public/v2/index.html` | T2 asset | `"uploads/fleetdeck-eye-minimal.svg"` | `"/v2/media/fleetdeck-eye-minimal.svg"` | 6 |
| `public/v2/index.html` | T2 asset | `"https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260611_104107_121bfb5a-b1df-4e0d-8240-25b81f7cc85d.mp4"` | `"/v2/media/hero-dark.mp4"` | 7 |
| `public/v2/index.html` | T2 asset | `"https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260729_102822_0e6c87e8-c141-4744-bf32-ad30db296371.mp4"` | `"/v2/media/hero-light.mp4"` | 2 |
| `public/v2/index.html` | T2 asset | `"https://thumb.wikimedia.org/wikipedia/commons/thumb/b/b0/Claude_AI_symbol.svg/1280px-Claude_AI_symbol.svg.png"` | `"/v2/media/claude-logo.png"` | 1 |
| `public/v2/index.html` | T2 asset | `"https://thumb.wikimedia.org/wikipedia/commons/thumb/e/ef/ChatGPT-Logo.svg/1280px-ChatGPT-Logo.svg.png"` | `"/v2/media/chatgpt-logo.png"` | 1 |
| `public/v2/vendor/dc-runtime.js` | T1 runtime | `"https://unpkg.com/react@18.3.1/umd/react.production.min.js"` | `"/v2/vendor/react.production.min.js"` | 1 |
| `public/v2/vendor/dc-runtime.js` | T1 runtime | `"https://unpkg.com/react-dom@18.3.1/umd/react-dom.production.min.js"` | `"/v2/vendor/react-dom.production.min.js"` | 1 |
| `public/v2/vendor/dc-runtime.js` | T1 runtime | `"https://unpkg.com/@babel/standalone@7.29.0/babel.min.js"` | `"/v2/vendor/babel.min.js"` | 1 |

The extracted Latin CSS additionally substitutes the same Google WOFF2 URL in all four faces: OUT `https://fonts.gstatic.com/s/inter/v20/UcC73FwrK3iLTeHuS_nVMrMxCp50SjIa1ZL7.woff2` → IN `/v2/vendor/fonts/inter-latin-v20.woff2`. The font commit quotes this 4-occurrence substitution. Other Latin face declarations are preserved. The embedded SVG namespace remains unchanged.

## Browser and network proof

`verify/S1/network.json`: **50/50 recorded checks pass**, **zero external hosts/origins**, 56 CDP entries (54 HTTP requests and 2 inline data resources; 54 Playwright requests), zero page exceptions. Actual clicks cover landing, all eight app nav screens, session full screen, bus maximization, all five deck slides, dark/light and video toggles. No request interception or app-state injection was used. Required assets load and final videos decode successfully. Browser: Chromium 153.0.8010.12, Playwright 1.63.0.

The browser traversal used 1440×1000; it is separate from the required 1440×900 pixel gate. Weight 700 is declared and its binary verified, but was not exercised by this traversal.

Four console errors remain from the original parser-visible template: one unresolved video binding causes a local 404 and one unresolved SVG points binding causes a parser error per theme. Eleven canceled repeated video requests are retained in the raw evidence. DESIGN-35 decided S1-MOCK-PARSER on 2026-09-07: preserve these known pass-1 artifacts exactly under D15; S2 eliminates the parser diagnostics by construction.

## MIME curl results

An isolated `node server.js` ran on scratch port 3199 with train target 3198, temporary database/empty hosts/token paths, disabled reaper and loopback listeners. **19/19** requests returned HTTP 200, expected Content-Type and byte-identical body. The transient WebP probe was removed. The owned server stopped and ports 3199/3198 were verified available afterwards.

| Path | HTTP | Expected Content-Type | Actual Content-Type | Body identical |
|---|---:|---|---|---|
| `public/v2/README.md` | 200 | `application/octet-stream` | `application/octet-stream` | True |
| `public/v2/index.html` | 200 | `text/html; charset=utf-8` | `text/html; charset=utf-8` | True |
| `public/v2/media/__mime-probe.webp` (transient) | 200 | `image/webp` | `image/webp` | True |
| `public/v2/media/chatgpt-logo.png` | 200 | `image/png` | `image/png` | True |
| `public/v2/media/claude-logo.png` | 200 | `image/png` | `image/png` | True |
| `public/v2/media/fleetdeck-eye-minimal.svg` | 200 | `image/svg+xml` | `image/svg+xml` | True |
| `public/v2/media/hero-dark.mp4` | 200 | `video/mp4` | `video/mp4` | True |
| `public/v2/media/hero-light.mp4` | 200 | `video/mp4` | `video/mp4` | True |
| `public/v2/vendor/MANIFEST.md` | 200 | `application/octet-stream` | `application/octet-stream` | True |
| `public/v2/vendor/babel.min.js` | 200 | `text/javascript; charset=utf-8` | `text/javascript; charset=utf-8` | True |
| `public/v2/vendor/dc-runtime.js` | 200 | `text/javascript; charset=utf-8` | `text/javascript; charset=utf-8` | True |
| `public/v2/vendor/fonts/inter-latin-v20.woff2` | 200 | `font/woff2` | `font/woff2` | True |
| `public/v2/vendor/inter.css` | 200 | `text/css; charset=utf-8` | `text/css; charset=utf-8` | True |
| `public/v2/vendor/licenses/Inter-OFL.txt` | 200 | `application/octet-stream` | `application/octet-stream` | True |
| `public/v2/vendor/licenses/babel-standalone-7.29.0-LICENSE` | 200 | `application/octet-stream` | `application/octet-stream` | True |
| `public/v2/vendor/licenses/react-18.3.1-LICENSE` | 200 | `application/octet-stream` | `application/octet-stream` | True |
| `public/v2/vendor/licenses/react-dom-18.3.1-LICENSE` | 200 | `application/octet-stream` | `application/octet-stream` | True |
| `public/v2/vendor/react-dom.production.min.js` | 200 | `text/javascript; charset=utf-8` | `text/javascript; charset=utf-8` | True |
| `public/v2/vendor/react.production.min.js` | 200 | `text/javascript; charset=utf-8` | `text/javascript; charset=utf-8` | True |

All five new extensions were exercised: `.svg`, `.png`, `.woff2`, `.mp4`, `.webp`. Existing default Content-Type for license/Markdown files remains `application/octet-stream`.

## Pixel gate

**allPass: true on 36/36 screens**, with 72 committed capture/diff PNGs at 1440×900, scale 1. Pixelmatch threshold 0.1, includeAA false, mismatch limit 0.5%; no threshold changes. Maximum: **0.03294753086419753% (427 pixels)** on Registry dark; the other 35 screen/theme pairs have zero mismatched pixels.

Command: `npm run design:diff -- --app http://127.0.0.1:4181/v2/index.html --slice S1`.

Published script/package provenance: S0 `f94b5f2`, byte-identical at fetched head `f17f1b5be614f921bd70dc4d190c50f66537b4c0`. Its 36 baseline PNGs were temporary comparison inputs; they are not included in S1 commits. S0 baseline and S1 environments match: Linux x64, Node 24.14.1, Playwright 1.63.0, Chromium 153.0.8010.12. Reviewer independently reproduced all 36 pixel counts and all 36 diff PNGs.

The S0 visual contract uses reduced motion, identical theme storage, disabled animations/caret, hidden video/canvas and blocked media. Live video/canvas appearance is outside this pixel gate; the independent network/UI run verifies video decoding and toggles without media interception. The gate replaces its output directory, so port-diff.txt and network.json were preserved and restored byte-identically.

| Screen | Dark mismatch % | Light mismatch % |
|---|---:|---:|
| Landing | 0.000000000000 | 0.000000000000 |
| Hero | 0.000000000000 | 0.000000000000 |
| Capability | 0.000000000000 | 0.000000000000 |
| Fleetdeck app | 0.000000000000 | 0.000000000000 |
| Windows | 0.000000000000 | 0.000000000000 |
| Org chart | 0.000000000000 | 0.000000000000 |
| Registry | 0.032947530864 | 0.000000000000 |
| Message bus | 0.000000000000 | 0.000000000000 |
| SSH keys | 0.000000000000 | 0.000000000000 |
| Accounts | 0.000000000000 | 0.000000000000 |
| Machines | 0.000000000000 | 0.000000000000 |
| Desktop sessions | 0.000000000000 | 0.000000000000 |
| Session full screen | 0.000000000000 | 0.000000000000 |
| 01 Title | 0.000000000000 | 0.000000000000 |
| 02 Problem | 0.000000000000 | 0.000000000000 |
| 03 Market | 0.000000000000 | 0.000000000000 |
| 04 Sales | 0.000000000000 | 0.000000000000 |
| 05 Expansion | 0.000000000000 | 0.000000000000 |

## Review

`git diff --check` reports ten whitespace warnings confined to byte-verbatim SVG/license inputs and raw unified-diff context. These source/evidence bytes are preserved under D15; no whitespace normalization was applied.

Independent reviewer: **CLEAN; T1/T2-only; zero implementation findings**. Results: 7/7 HTML substitution kinds, 19 occurrences ; 3 runtime swaps; 25/25 protected files; 15/15 manifest entries; 3/3 SRI matches; 4/4 media signatures; byte-identical raw diff; exactly five MIME additions; 10-line artifact README. Final artifact reviewer confirms 36/36 unique screen/theme rows, 72/72 correctly sized PNGs, 36/36 capture hashes, 36/36 exact S0 baseline hashes, 36/36 recomputed pixel counts, 36/36 byte-identical diff PNGs, and restored port/network proof bytes. Zero findings remain. The authenticated push and successful registry receipt below close the delivery requirements.

## Lifecycle, delivery and open issues

DESIGN-35's current ruling makes Linear OAuth expiry non-blocking. Every intended issue/comment is in `LINEAR-PENDING.md`, signed Waldemar, using stable local IDs for milestone commits; these are not fabricated Linear issue keys. Retries remain `oauth_token_invalid_grant`; the design seat mirrors entries later.

The bare task-PENDING registry POST returned HTTP 401. The documented box fleet configuration supplied the supported bearer authentication without exposing its value; the authenticated task-PENDING POST returned HTTP 400 because the server requires one real Linear key or an empty task. No fabricated task key was sent. This compatibility limitation is recorded in S1-REGISTRY. The separately authorized status-only done update succeeded after the artifact push: HTTP 200, body `{"ok":true}`, at 2026-09-06T23:33:46.288220+00:00. S1-ROUTING and S1-MOCK-PARSER are decided by DESIGN-35 (2026-09-07): directory routing deferred to L1; parser diagnostics preserved for S1 and handled by S2.

Every milestone was pushed with a freshly obtained train-broker token held only in the subprocess environment. A separate fresh-token `git ls-remote` verified the full remote SHA. Reviewed implementation, manifest, final gate report and all 72 PNGs were delivered at **`793a84a82702eca0bca317cbc03e9693439afe59`**; independent remote verification matched at 2026-09-06T23:33:20.433939+00:00.

Registry completion receipt:

```json
{
  "timestamp": "2026-09-06T23:33:46.288220+00:00",
  "request": {
    "host": "german-box",
    "name": "FD-v2-s1",
    "status": "done"
  },
  "httpStatus": 200,
  "response": {
    "ok": true
  }
}
```

The registry row is done. The literal task value `PENDING` is unsupported by the live server and was not substituted with a fabricated issue key; the design seat can attach the real key when it mirrors the pending ledger. All nine sub-issues and the main issue have intended state Done in that ledger. No live Linear issue/comment/transition is claimed while OAuth is expired.

This completion report and final acceptance/ledger entries follow the artifact commit above. The final branch SHA is separately authenticated after their push and supplied in the completion response.

Artifact commits (completion-only documents follow):

```
793a84a test(fleetdeck): land reviewed 36-screen S1 pixel proof (S1-07)
39ae4ad docs(fleetdeck): publish S1 port evidence and pending acceptance (S1-08)
1dd2c56 build(fleetdeck): import S0 pixel gate dependencies (S1-07)
73bc2bc test(fleetdeck): prove local-only requests across S1 views (S1-06)
d3cf5b4 fix(fleetdeck): serve vendored design media MIME types (S1-05)
0bca650 feat(fleetdeck): land mechanical pass-one artboard (S1-04)
16123f3 feat(fleetdeck): vendor every design media asset and manifest (S1-03)
684a62d feat(fleetdeck): vendor Inter Latin faces and license (S1-02)
6317a2a feat(fleetdeck): vendor pinned design runtime (S1-01)
aa07bbc docs(fleetdeck): record S1 pending lifecycle authority (S1-MAIN)
```

Signed **Waldemar**.
