# S1 vendored file manifest

Recorded 2026-09-07. Paths are relative to public/v2/. SHA256 and sizes cover every runtime, font, media and license file; this manifest excludes itself. No media was transcoded.

| File | Version | Bytes | SHA256 | License / provenance |
|---|---|---:|---|---|
| `media/chatgpt-logo.png` | 1280px PNG from exact design URL | 53129 | `ef8d1611f1a992421c64ddd93e688113c41175e9d5da8957b88711eb9e5261ff` | Public domain (PD-shape); Wikimedia Commons file page also notes trademarks |
| `media/claude-logo.png` | 1280px PNG from exact design URL | 32886 | `fdb2d6472a04530008f8b9fb112f943f08b4a1e3f6aabc3e938a3f207fecf0dd` | CC0 1.0 Universal per Wikimedia Commons file page |
| `media/fleetdeck-eye-minimal.svg` | design-supplied snapshot | 8476 | `093ce974b6edf331d8e45958609301817e6d5d685ed857755ee9d738fead8b18` | No standalone license supplied with design asset; copied under operator authorization |
| `media/hero-dark.mp4` | design-linked original bytes | 5328811 | `9c6a28ba06499df3b66ce6cb5efe8f78a0b3aa305a9f4976a1eb64c5fa3d7d33` | No standalone license supplied at the design-linked media URL; vendored under explicit operator instruction |
| `media/hero-light.mp4` | design-linked original bytes | 10321675 | `9706ce8a7a83047654c0fb4833a413e6a7d164df09d1f7ae6b0d26f9d1d5e18e` | No standalone license supplied at the design-linked media URL; vendored under explicit operator instruction |
| `vendor/babel.min.js` | 7.29.0 | 3137752 | `2623a9e22809915ce789b4461154e277ddce520d5a4320c14d44332a5d0dcea0` | MIT; licenses/babel-standalone-7.29.0-LICENSE |
| `vendor/dc-runtime.js` | design-supplied snapshot | 69066 | `42c5f39fe6fafdbec2854092dafaa85aff6ab452334da4b244fc27b526bd686c` | No standalone license supplied with design runtime; copied under operator authorization |
| `vendor/fonts/inter-latin-v20.woff2` | Inter v20; latin 400/500/600/700 | 48256 | `3100e775e8616cd2611beecfa23a4263d7037586789b43f035236a2e6fbd4c62` | SIL Open Font License 1.1; licenses/Inter-OFL.txt |
| `vendor/inter.css` | Inter v20; latin 400/500/600/700 | 1488 | `59063cabc29d7d60875d834f32f8947d0e0d89ebc1385701000d66e566080dde` | SIL Open Font License 1.1; licenses/Inter-OFL.txt |
| `vendor/licenses/Inter-OFL.txt` | Inter v20; latin 400/500/600/700 | 4377 | `5b9321a4298cfeb6b34354164a1c3afc3db114569984c502b9b35d988fd58c57` | SIL Open Font License 1.1; licenses/Inter-OFL.txt |
| `vendor/licenses/babel-standalone-7.29.0-LICENSE` | license text | 1106 | `117da2af0d4ce0fe1c8e19b5cff9dcd806adf973d328d27b11d4448c4ff24f76` | MIT |
| `vendor/licenses/react-18.3.1-LICENSE` | license text | 1086 | `52412d7bc7ce4157ea628bbaacb8829e0a9cb3c58f57f99176126bc8cf2bfc85` | MIT |
| `vendor/licenses/react-dom-18.3.1-LICENSE` | license text | 1086 | `52412d7bc7ce4157ea628bbaacb8829e0a9cb3c58f57f99176126bc8cf2bfc85` | MIT |
| `vendor/react-dom.production.min.js` | 18.3.1 | 131835 | `35f4f974f4b2bcd44da73963347f8952e341f83909e4498227d4e26b98f66f0d` | MIT; licenses/react-dom-18.3.1-LICENSE |
| `vendor/react.production.min.js` | 18.3.1 | 10751 | `d949f1c3687aedadcedac85261865f29b17cd273997e7f6b2bfc53b2f9d4c4dd` | MIT; licenses/react-18.3.1-LICENSE |

## Sources

- `vendor/dc-runtime.js`: docs/design/fleetdeck-v2/mock/support.js
- `vendor/react.production.min.js`: https://unpkg.com/react@18.3.1/umd/react.production.min.js; license source: https://unpkg.com/react@18.3.1/LICENSE
- `vendor/react-dom.production.min.js`: https://unpkg.com/react-dom@18.3.1/umd/react-dom.production.min.js; license source: https://unpkg.com/react-dom@18.3.1/LICENSE
- `vendor/babel.min.js`: https://unpkg.com/@babel/standalone@7.29.0/babel.min.js; license source: https://unpkg.com/@babel/standalone@7.29.0/LICENSE
- `vendor/licenses/react-18.3.1-LICENSE`: https://unpkg.com/react@18.3.1/LICENSE
- `vendor/licenses/react-dom-18.3.1-LICENSE`: https://unpkg.com/react-dom@18.3.1/LICENSE
- `vendor/licenses/babel-standalone-7.29.0-LICENSE`: https://unpkg.com/@babel/standalone@7.29.0/LICENSE
- `media/fleetdeck-eye-minimal.svg`: docs/design/fleetdeck-v2/mock/uploads/fleetdeck-eye-minimal.svg
- `media/hero-dark.mp4`: https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260611_104107_121bfb5a-b1df-4e0d-8240-25b81f7cc85d.mp4
- `media/hero-light.mp4`: https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260729_102822_0e6c87e8-c141-4744-bf32-ad30db296371.mp4
- `media/claude-logo.png`: https://thumb.wikimedia.org/wikipedia/commons/thumb/b/b0/Claude_AI_symbol.svg/1280px-Claude_AI_symbol.svg.png; license source: https://commons.wikimedia.org/wiki/File:Claude_AI_symbol.svg
- `media/chatgpt-logo.png`: https://thumb.wikimedia.org/wikipedia/commons/thumb/e/ef/ChatGPT-Logo.svg/1280px-ChatGPT-Logo.svg.png; license source: https://commons.wikimedia.org/wiki/File:ChatGPT-Logo.svg
- `vendor/inter.css`: https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap
- `vendor/fonts/inter-latin-v20.woff2`: https://fonts.gstatic.com/s/inter/v20/UcC73FwrK3iLTeHuS_nVMrMxCp50SjIa1ZL7.woff2
- `vendor/licenses/Inter-OFL.txt`: https://raw.githubusercontent.com/google/fonts/main/ofl/inter/OFL.txt

## Inter

Google Fonts request: `https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap`. The four explicit Latin faces preserve Google CSS font-family, style, weight, display and Unicode ranges; only their src URLs become local. All four weights use the same unmodified variable WOFF2. The original CSS SHA256 is `5682df055e3bc3420ab5065274d8b14caeee02857f0af6c07d0995b8d6271077`. License: SIL OFL 1.1, The Inter Project Authors; local license text is included. No Aeonik file was supplied or loaded by the mock; its original fallback remains unchanged.

## Runtime substitutions

- OUT `https://unpkg.com/react@18.3.1/umd/react.production.min.js` → IN `/v2/vendor/react.production.min.js` (count 1).
- OUT `https://unpkg.com/react-dom@18.3.1/umd/react-dom.production.min.js` → IN `/v2/vendor/react-dom.production.min.js` (count 1).
- OUT `https://unpkg.com/@babel/standalone@7.29.0/babel.min.js` → IN `/v2/vendor/babel.min.js` (count 1).

Signed **Waldemar**.
