# fd-v2-l12 — REPORT

**Worker** Hadwig · `backend-developer` · tag `agent-hadwig` · Claude Opus 5
**Project / sub-project** `remote-system` / `fleetdeck-v2`
**Branch** `agent-v2-l12` off `origin/weave/fd-v2` (base `79cd53a`)
**Linear** [DECK-106](https://linear.app/synchronicity/issue/DECK-106) (main) · [DECK-107](https://linear.app/synchronicity/issue/DECK-107) (`operator:gate`, missing pack)
**Date** 2026-09-07

## What changed

`sendFile` in `server.js` now speaks HTTP Range. It was answering `200` with a
`Content-Type` and nothing else — no `Accept-Ranges`, no `Content-Length`, and the request's
`Range` header ignored outright — so Chrome classed `/v2/media/hero-*.mp4` as non-seekable.

One helper (`parseByteRange`) and the rewritten `sendFile`; the three call sites pass `req`
through so the header is reachable. `public/v2/**` untouched.

| | |
|---|---|
| `server.js` | `parseByteRange` helper + `sendFile` rewritten; `req` threaded to 3 call sites |
| `test/static-range.test.js` | new, 18 tests |
| `docs/goals/fd-v2-l12/` | reconstructed pack (README, PROTOCOL) + this report |
| `probe-scroll.cjs` | the headless proof tool, copied in as instructed |

`sendFile` now `fs.stat`s instead of buffering the whole file, and streams every body
through `fs.createReadStream` — the old code read all 10.3 MB of `hero-light.mp4` into a
Buffer to serve any part of it. `sendFile` is internal: three call sites, not exported,
no other consumer in the repo.

Two commits: `69fff35` (the feature) and `5770d27` (the review fixes, below).

## The pack was missing (DECK-107)

`docs/goals/fd-v2-l12/` **did not exist** — not on any remote branch, not on
`origin/claude/fleetdeck-v2-redesign-plan-5a5cd5` where the L1–L11 packs live, not on the
filesystem, and nothing on the bus (`/api/messages?target=FD-v2-l12` → `not found`).

The launch prompt carried a complete spec, so this was recorded as `operator:gate`
**DECK-107** and the work continued rather than stalling. `README.md` here is reconstructed
from the launch prompt and labelled as such; `PROTOCOL.md` is copied verbatim from the
`fd-v2-l11` pack. Two judgement calls had no authored spec behind them and are flagged in
DECK-107 for the design seat to confirm: multi-range and malformed ranges both fall back to
a full `200`.

## Proof

### 1. Before / after, headless (`probe-scroll.cjs`)

The same probe against the same tree, with only `server.js` swapped between its pre-fix
(`HEAD~1`) and post-fix versions. `vt` is `video.currentTime`; `hash` is the canvas frame
hash at that scroll position.

**BEFORE** — `Range` ignored, video pinned at frame 0:

```
RANGEPROBE {"status":200,"h":{"content-type":"video/mp4","transfer-encoding":"chunked"}}
{"url":"http://127.0.0.1:22443/","errs":["warning: Canvas2D: Multiple readback operations using getImageData are faster with the willReadFrequently attribute set to true. See: https://html.spec.whatwg.org/multipage/canvas.html#concept-canvas-will-read"],"vis":"visible","docSH":2520,"innerH":900,"rafs":60,"draws":0,"canvasOp":"1","canvasStyleOp":"1","videoOp":"0","vidRS":4,"vidDur":10.041667,"vidSrc":"http://127.0.0.1:22443/v2/media/hero-light.mp4","s0":{"y":0,"hash":"1159437873:1292","reveal":"15/23","vt":0},"s1":{"y":810,"hash":"3941201218:1292","reveal":"10/23","vt":0},"s2":{"y":1620,"hash":"3941201218:1292","reveal":"16/23","vt":0},"s3":{"y":0,"hash":"3941201218:1292","reveal":"15/23","vt":0}}
```

`vt` is `0` at every scroll position, and `s1`, `s2`, `s3` all share one hash
(`3941201218`) — the frozen frame. This is the reported bug, reproduced.

**AFTER** — the accepted proof line, taken against the final shipped code:

```
RANGEPROBE {"status":206,"h":{"content-type":"video/mp4","accept-ranges":"bytes","content-length":"100","content-range":"bytes 0-99/5328811"}}
{"url":"http://127.0.0.1:30368/","errs":["warning: Canvas2D: Multiple readback operations using getImageData are faster with the willReadFrequently attribute set to true. See: https://html.spec.whatwg.org/multipage/canvas.html#concept-canvas-will-read"],"vis":"visible","docSH":2520,"innerH":900,"rafs":60,"draws":0,"canvasOp":"1","canvasStyleOp":"1","videoOp":"0","vidRS":4,"vidDur":10.041667,"vidSrc":"http://127.0.0.1:30368/v2/media/hero-light.mp4","s0":{"y":0,"hash":"1159437873:1292","reveal":"15/23","vt":0},"s1":{"y":810,"hash":"1087452512:1292","reveal":"10/23","vt":4.99},"s2":{"y":1620,"hash":"4039865814:1292","reveal":"16/23","vt":9.98},"s3":{"y":0,"hash":"1159437873:1292","reveal":"15/23","vt":0.02}}
```

| | required | before | after |
|---|---|---|---|
| `s0` / `s1` / `s2` hashes differ | yes | **no** — `s1` = `s2` | **yes** — `1159437873` / `1087452512` / `4039865814` |
| `rafs` | > 30 | 60 | **60** |
| `video.currentTime` tracks scroll | — | `0, 0, 0` | **`0, 4.99, 9.98`** over a 10.04 s clip |

`s3` returns to `y=0` and reproduces `s0`'s hash exactly, so the scrub is deterministic in
both directions. The run was repeated after the review fixes, on a different port, and
returned byte-for-byte the same three hashes — the measurement is stable, not a lucky
frame. The only console message is a pre-existing Canvas2D `willReadFrequently` performance
hint from the page, not an error.

The port in each run is the one the harness itself spawned and returned, so neither probe
can have measured another session's server.

### 2. Wire transcripts

`curl -D -` against `/v2/media/hero-dark.mp4` (5 328 811 bytes); `date`/`connection`
elided:

```
### no Range (200)
HTTP/1.1 200 OK
content-type: video/mp4
accept-ranges: bytes
content-length: 5328811

### bytes=0-99 (206)
HTTP/1.1 206 Partial Content
content-type: video/mp4
accept-ranges: bytes
content-length: 100
content-range: bytes 0-99/5328811

### bytes=-50 suffix (206)
HTTP/1.1 206 Partial Content
content-type: video/mp4
accept-ranges: bytes
content-length: 50
content-range: bytes 5328761-5328810/5328811

### bytes=5328811- past EOF (416)
HTTP/1.1 416 Range Not Satisfiable
content-type: video/mp4
accept-ranges: bytes
content-range: bytes */5328811

### bytes=0-9,20-29 multi (200)
HTTP/1.1 200 OK
content-type: video/mp4
accept-ranges: bytes
content-length: 5328811
```

### 3. The 200 body is byte-identical

```
served sha256 9c6a28ba06499df3b66ce6cb5efe8f78a0b3aa305a9f4976a1eb64c5fa3d7d33 (5328811 bytes)
disk   sha256 9c6a28ba06499df3b66ce6cb5efe8f78a0b3aa305a9f4976a1eb64c5fa3d7d33 (5328811 bytes)
equal: true
```

The disk hash was captured **before** the edit, so this compares the post-change response
against the pre-change baseline, not merely against itself. The pre-change `sendFile` was a
plain `fs.readFile` of the same path, so the disk bytes are exactly what it used to send.

### 4. Tests

`npm test` → **569 pass, 0 fail, 0 skipped**, exit 0, 132 s. Green on the first run, both
before and after the review fixes — no port-contention flake, so nothing needed a re-run.

`node --test test/static-range.test.js` → **18 pass, 0 fail**, re-run by me independently of
the builders that wrote it:

```
✔ no Range serves the whole file with Accept-Ranges
✔ bytes=0-99 returns the first 100 bytes as 206
✔ an open-ended range runs to the last byte
✔ a suffix range returns the last N bytes
✔ an end past EOF clamps to the last byte
✔ a start past EOF is 416
✔ a reversed range is 416
✔ a zero-length suffix is 416
✔ a multi-range is ignored and serves the whole file
✔ a non-bytes unit is ignored and serves the whole file
✔ a plain asset still serves as 200 and advertises ranges
✔ a HEAD gets the headers and no body
✔ a HEAD with a Range gets the 206 headers and no body
✔ an absurdly large end still clamps to the last byte
✔ the bytes unit is matched case-insensitively
✔ a zero-byte file serves 200 with no body, and 416 for any range
✔ a file that stats but will not open answers 404, not a truncated 200
✔ a client that aborts mid-stream leaves the server healthy
```

The tests compare against the real bytes on disk through a local Buffer-collecting request
helper, because `test/http.js`'s `get()` accumulates the body as a string and mangles binary
— `test/http.js` itself was left untouched. The unreadable-file test skips under root; it
did **not** skip here, so it genuinely ran.

## Review

A `reviewer` pass ran on the `69fff35` diff. It checked `parseByteRange` against every
RFC 9110 §14.1.1 case (`0-0`, `0-`, `-1`, `-size`, `-size+1000`, `size-1 - size-1`, a
zero-byte file, `0-99999999999999999999`) and verified HEAD handling, `Content-Length`
correctness on 200/206, and normal client-abort cleanup by direct reproduction — all
correct. It confirmed none of the 11 tests were vacuous.

It found **one real regression**, now fixed, plus five test gaps and one nit:

| # | Sev | Finding | Resolution |
|---|---|---|---|
| 1 | **medium** | `fs.stat` succeeding does not mean the file will **open**. A stat-able but unreadable file (`chmod 000`) got `200`/`206` headers — with a `Content-Length` promising a full body — and only then failed with `EACCES` and reset the connection. The old `fs.readFile` path answered the same file with a clean `404`. A truncated 200 is a strictly worse failure than a 404. | **Fixed** in `5770d27`. `res.writeHead` is now driven by the stream's `'open'` event, so headers are sent only once the fd is known good; `stream.on('error')` sends a clean `404` while `res.headersSent` is false and only destroys after. The zero-byte branch moved above the stream (it must stay — `createReadStream` with `end: -1` throws). |
| 2 | low | No HEAD test, though the first call site sits in a `GET \|\| HEAD` branch. | **Fixed** — two tests added (plain and ranged). |
| 3 | low | No zero-byte-file test; that branch was dead code to the suite. | **Fixed** — 200-with-no-body and `416 bytes */0`. |
| 4 | low | The absurdly-large end value was untested. | **Fixed**. |
| 5 | low | Abort-mid-stream and post-`writeHead` read-error cleanup untested. | **Fixed** — a client aborts mid-stream, then a normal request is asserted still healthy. |
| 6 | nit | `parseByteRange` required a lowercase `bytes=`; the ABNF unit is case-insensitive, so `Bytes=0-99` silently fell through to a 200. | **Fixed** — `/i` flag, plus a case-insensitivity test. |

The regression fix is genuinely load-bearing, not just asserted: reverting `sendFile` to the
`writeHead`-first form makes the new test fail with `socket hang up / ECONNRESET`, which is
exactly the truncated-200 the reviewer described.

## Acceptance

All boxes in `README.md` are ticked. Restated here:

- [x] `Accept-Ranges: bytes` and `Content-Length` on every 200.
- [x] 200 body byte-identical to the pre-change body (sha256 above).
- [x] Single ranges answer 206 with correct `Content-Range` / `Content-Length`.
- [x] Unsatisfiable ranges answer 416 with `Content-Range: bytes */size`.
- [x] Malformed and multi-range requests fall back to a full 200.
- [x] Range bodies streamed with `fs.createReadStream`.
- [x] `test/static-range.test.js` covers 200 / 206 / 416 / multi-range; 18/18 pass.
- [x] `npm test` green — 569/569.
- [x] Diff is `server.js` + the new test + the pack. `public/v2/**` untouched.
- [x] `s0`/`s1`/`s2` hashes differ, `rafs` 60 > 30, JSON line pasted above.
- [x] `reviewer` ran on the diff; findings quoted above, all resolved.
- [x] Branch pushed (`453e57c`); report signed; registry `done`; bus reply sent — see
      *Bus delivery* below: accepted and queued by the bus, not delivered, because the
      DESIGN 35 seat is offline.

## Bus delivery

The reply to 🎨 DESIGN 35 was **posted twice and accepted twice**, and **delivered neither
time**. The bus resolved the session name — it echoes it back — and answered
`"status":"failed"`, `"delivered_at":null`,
`error: Claude Desktop session "🎨 DESIGN 35 · fleetdeck v2 redesign" is not live`.

| attempt | message id | outcome |
|---|---|---|
| 1 | `ad89d3e3-c679-4c2b-ab58-d6f0852e5d17` | accepted, not delivered — seat offline |
| 2 | `ea121733-0d1f-4a00-80b0-d30f13bb182a` | accepted, not delivered — seat offline |

So the name is right and the seat is simply down; nothing here is retryable from this
end. The same content is on DECK-106 as a comment, which is the durable channel the
protocol asks for anyway. **The design seat has not yet seen this — it needs a resend
once DESIGN 35 is live, or the operator can read DECK-106.**

## Deliberate limits

- **Multi-range** answers a full `200` rather than `multipart/byteranges`. RFC 9110 §14.2
  permits a server to ignore a Range it would rather not honour; no client the deck serves
  needs multipart, and it would cost far more diff than "minimal" allows. Flagged in DECK-107.
- **No ETag / `If-Range` / conditional requests.** Out of scope. A consequence worth naming:
  because there is no validator, a client that resumes a range across a file replacement
  cannot be told the file changed under it. The hero videos are vendored and static, so this
  is theory, not a live risk.
- **`416` carries no `Content-Length: 0`**, so Node falls back to `Transfer-Encoding:
  chunked` on an empty body. Legal and harmless; noted rather than fixed, to keep the diff
  minimal.

## Follow-ups

None blocking. DECK-107 stays open for the design seat to confirm the two reconstructed
spec choices.

---

**Hadwig** · `backend-developer` · `agent-hadwig` · 2026-09-07
