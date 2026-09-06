# fd-v2 S1 execution report

Status: **implementation, network and MIME proof complete; pixel gate and registry completion pending**.

Worker: **Waldemar** (`frontend-developer`, `agent:waldemar`). Project: `remote-system` / `fleetdeck-v2`.
Updated: 2026-09-06T23:21:20.429743+00:00.

## What landed

The source artboard is copied mechanically into `public/v2/index.html`. Reversing its seven T1/T2 substitution kinds (19 occurrences) reproduces the source byte-for-byte. The runtime differs by exactly three dependency URLs. Independent review verified all 25 protected mock/oldUI files remain byte-identical to base `76c859cd96506f8686febe47741845f5870b5813`.

All runtime, fonts and media are vendored: React 18.3.1, ReactDOM 18.3.1, Babel 7.29.0, design dc-runtime, Inter Latin 400/500/600/700, the eye SVG, both videos and both provider PNG logos. `public/v2/vendor/MANIFEST.md` covers 15 files, 19,151,780 bytes, with SHA256, sizes, sources and licenses. All three runtime dependencies match the original SRI digests. The two videos are 5,328,811 and 10,321,675 bytes; neither was transcoded.

The artifact README has exactly 10 lines. `server.js` contains only the five allowed MIME additions. The application server serves `/v2/index.html`; the specified static server resolves `/v2/`. Application directory routing is recorded separately as S1-ROUTING, with no out-of-scope edit.

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

`verify/S1/network.json`: **50/50 recorded checks pass**, **zero external hosts/origins**, 60 CDP entries (58 HTTP requests and 2 inline data resources; 58 Playwright requests), zero page exceptions. Actual clicks cover landing, all eight app nav screens, session full screen, bus maximization, all five deck slides, dark/light and video toggles. No request interception or app-state injection was used. Required assets load and final videos decode successfully. Browser: Chromium 153.0.8010.12, Playwright 1.63.0.

The browser traversal used 1440×1000; it is separate from the required 1440×900 pixel gate. Weight 700 is declared and its binary verified, but was not exercised by this traversal.

Four console errors remain from the original parser-visible template: one unresolved video binding causes a local 404 and one unresolved SVG points binding causes a parser error per theme. Ten canceled repeated video requests are retained in the raw evidence. These were not hidden or fixed; S1-MOCK-PARSER records the permitted follow-up decision.

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

**NOT RUN; no allPass claim.** S0 ref `47dbabb20855242bc7e0b421e52b0fbbab801df1` published the three devDependencies but had no `scripts/design-diff.mjs`. The dependencies are imported without other S0 files; the script is polled at the required 30-minute interval. No threshold has been changed. Required screen results are pending:

| Screen | Dark mismatch | Light mismatch |
|---|---|---|
| Landing | not run | not run |
| Hero | not run | not run |
| Capability | not run | not run |
| Fleetdeck app | not run | not run |
| Windows | not run | not run |
| Org chart | not run | not run |
| Registry | not run | not run |
| Message bus | not run | not run |
| SSH keys | not run | not run |
| Accounts | not run | not run |
| Machines | not run | not run |
| Desktop sessions | not run | not run |
| Session full screen | not run | not run |
| 01 Title | not run | not run |
| 02 Problem | not run | not run |
| 03 Market | not run | not run |
| 04 Sales | not run | not run |
| 05 Expansion | not run | not run |

## Review

Independent reviewer: **CLEAN; T1/T2-only; zero implementation findings**. Results: 7/7 HTML substitution kinds, 19 occurrences ; 3 runtime swaps; 25/25 protected files; 15/15 manifest entries; 3/3 SRI matches; 4/4 media signatures; byte-identical raw diff; exactly five MIME additions; 10-line artifact README. Dynamic-proof and final gate/delivery review is recorded as it completes in LINEAR-PENDING.md.

## Lifecycle, delivery and open issues

DESIGN-35's current ruling makes Linear OAuth expiry non-blocking. Every intended issue/comment is in `LINEAR-PENDING.md`, signed Waldemar, using stable local IDs for milestone commits; these are not fabricated Linear issue keys. Retries remain `oauth_token_invalid_grant`; the design seat mirrors entries later.

The exact registry POST with `task:PENDING` returned HTTP 401 `unauthorized`. No registry success/done status is claimed. S1-REGISTRY requests the supported authorization or design-seat update. S1-ROUTING and S1-MOCK-PARSER are recorded decisions, preserving the strict S1 scope.

Each completed milestone is pushed with a freshly obtained train-broker token, held only in the subprocess environment. Separate fresh-token `git ls-remote` checks verify the remote SHA. Final delivery receipt is pending the gate/report commit and registry completion. Latest committed milestone at report generation: `d3cf5b4bc746100dd6fa5e96af84149eace4a136`.

Commits so far:

```
d3cf5b4 fix(fleetdeck): serve vendored design media MIME types (S1-05)
0bca650 feat(fleetdeck): land mechanical pass-one artboard (S1-04)
16123f3 feat(fleetdeck): vendor every design media asset and manifest (S1-03)
684a62d feat(fleetdeck): vendor Inter Latin faces and license (S1-02)
6317a2a feat(fleetdeck): vendor pinned design runtime (S1-01)
aa07bbc docs(fleetdeck): record S1 pending lifecycle authority (S1-MAIN)
```

Signed **Waldemar**.
