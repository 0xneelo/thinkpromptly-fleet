# fd-v2-l12 — static HTTP Range support (fixes the landing scroll-scrub video)

Worker **Hadwig** (`backend-developer`). Branch `agent-v2-l12` from `origin/weave/fd-v2` (`79cd53a`, the
deployed candidate). **server.js only** — nothing under `public/v2/` changes. Ledger D18 rider L11.3
(reassigned from Alrun, who is finishing L11.2 client work; no overlap).

## Root cause (proven 2026-09-07, decisions.md "live defect 3")

`sendFile` (`server.js:2395`) reads the whole file and answers `200` with only `content-type` — no
`Accept-Ranges`, `Content-Length`, `Content-Range`; the `Range` request header is ignored. Chrome therefore
treats `/v2/media/hero-*.mp4` as non-seekable (`video.seekable` = [0, 0]); every `currentTime` seek snaps
to 0, `LandLogic.extractFrames` caches 90 identical frames and the scroll scrub draws frame 0 at every
scroll position. The mock worked because CloudFront serves byte ranges. Proofs:

```
curl -s -o /dev/null -D - -H 'Range: bytes=0-99' http://localhost:3131/v2/media/hero-light.mp4
# HTTP/1.1 200 OK / content-type: video/mp4   ← no content-range, no content-length
```
`probe-seek.cjs`: seeks to 3 s and 6 s both report `currentTime 0`, three identical frame hashes.
`probe-scroll.cjs`: draw loop alive (58 rAF/s, 174 drawImage/s), canvas hash identical at scroll 0 / 50 % / 100 %.

## Spec

- Every static `GET` (and `HEAD` if the handler serves it) answers with `Content-Type`, `Content-Length`
  and `Accept-Ranges: bytes`. The 200 body is byte-identical to today's.
- `Range: bytes=<s>-<e>` (single range): `206 Partial Content`, `Content-Range: bytes <s>-<e>/<total>`,
  `Content-Length: <e-s+1>`, body streamed with `fs.createReadStream(file, { start, end })`. Clamp `e` to
  `total-1`. Support `bytes=<s>-` (open end) and `bytes=-<n>` (suffix). Size from `fs.stat`.
- `s >= total` or `s > e` → `416` with `Content-Range: bytes */<total>` and an empty body.
- Multi-range (`bytes=0-1,5-6`) or a malformed header → ignore `Range`, serve the full `200`.
- 404 path and the `MIME` map unchanged. No new dependencies. Keep the change inside `sendFile` plus at
  most one helper; do not touch other handlers or the `/api/*` routes.

## Acceptance (tick in REPORT.md)

- [ ] `curl -s -o /dev/null -D - -H 'Range: bytes=0-99' http://localhost:<port>/v2/media/hero-light.mp4`
      → `206`, `content-range: bytes 0-99/<size>`, `content-length: 100`, `accept-ranges: bytes`.
- [ ] Plain GET → `200` with `content-length` = file size and `accept-ranges: bytes`; body sha256 equals
      the file's sha256.
- [ ] `test/static-range.test.js` (node:test, same harness as `test/http.js`): 200 headers + body,
      206 (explicit, open-ended, suffix), 416, multi-range → 200. `npm test` fully green.
- [ ] Headless proof: copy `/home/vibe/launch/probe-scroll.cjs` into the worktree root (so
      `require('playwright')` resolves from `node_modules`), run
      `node probe-scroll.cjs 'http://localhost:<port>/?view=land'` against your own server started from the
      worktree — the JSON line must show `s0`, `s1`, `s2` with three **different** `hash` values and
      `rafs > 30`. Paste the line into REPORT.md. (Before the fix all four hashes are identical.)
- [ ] `reviewer` on the diff; findings fixed or ruled in REPORT.md.
- [ ] Commit message body names the root cause; branch `agent-v2-l12` pushed; REPORT.md signed Hadwig;
      registry `done`; bus reply to the design seat with the tip SHA.

## Out of scope (Linear issue for the operator if you spot it)

Anything in `public/`, the L11.2 nav-hash work, ETag/If-Range/caching, gzip, the pixel gate.
