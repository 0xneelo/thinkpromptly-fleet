<<<<<<< HEAD
# fd-v2-l12 — HTTP Range support for static media in `server.js`

> **Pack provenance.** This README was **reconstructed by Hadwig on 2026-09-07** from the
> `/goal` launch prompt. No `docs/goals/fd-v2-l12/` pack was ever committed to any ref
> (checked: every remote branch, `origin/claude/fleetdeck-v2-redesign-plan-5a5cd5` where the
> L1–L11 packs live, and the filesystem). An `operator:gate` records the missing pack; it did
> **not** block the work, because the launch prompt carried the full spec.
> `PROTOCOL.md` here is copied verbatim from the `fd-v2-l11` pack.

| | |
|---|---|
| Project / sub-project | `remote-system` / `fleetdeck-v2` |
| Worker | **Hadwig** · `backend-developer` · tag `agent-hadwig` · Claude, Opus 5 · `/goal` |
| Branch | `agent-v2-l12` off `origin/weave/fd-v2` |
| Owned file | `server.js` (`sendFile` + at most one helper) |
| Registry group | `fd-v2` |
| Design seat | 🎨 DESIGN 35 — fleetdeck v2 redesign |

## Goal (one line)

Make `sendFile` in `server.js` speak HTTP Range so a browser can **seek** the vendored
`/v2/media/*.mp4`, which makes the landing hero video scroll-scrubbable.

## Problem

`sendFile` answers `200` with only a `Content-Type` header. It sets no `Accept-Ranges`, no
`Content-Length`, no `Content-Range`, and ignores the request's `Range` header entirely.
Chrome therefore treats `hero-light.mp4` / `hero-dark.mp4` as non-seekable: `video.seekable`
reports `[0, 0]`, every seek snaps back to 0, and the scroll-scrub canvas draws frame 0
forever.

## Scope (In)

1. `server.js` only — `sendFile` plus **at most one** helper function. Minimal diff.
2. On a plain `200` (no `Range`, or a `Range` we decline): add `Content-Length` and
   `Accept-Ranges: bytes`. **The response body must stay byte-identical to today's.**
3. Honour a single-range `Range: bytes=…` request with `206 Partial Content`.
4. Answer an unsatisfiable range with `416 Range Not Satisfiable`.
5. Stream range bodies with `fs.createReadStream(path, { start, end })` — never read whole
   files into memory (`hero-light.mp4` is 10.3 MB).
6. `test/static-range.test.js` covering 200 / 206 / 416 / multi-range.

**Out**: `public/v2/**` (untouched), every other route, every other screen, the v2 shell,
caching/ETag/conditional-request work, and any change to what `sendFile`'s callers pass —
unless a caller must be given `req` to reach `req.headers.range`.

## Wire spec

Let `size` be the file size in bytes.

| Request | Response |
|---|---|
| No `Range` header | `200`, `Content-Length: size`, `Accept-Ranges: bytes`, full body |
| `Range: bytes=a-b` (`a ≤ b < size`) | `206`, `Content-Range: bytes a-b/size`, `Content-Length: b-a+1`, `Accept-Ranges: bytes` |
| `Range: bytes=a-` | `206` over `a … size-1` |
| `Range: bytes=a-b` with `b ≥ size` | `206` over `a … size-1` (end clamped) |
| `Range: bytes=-n` (suffix) | `206` over the last `min(n, size)` bytes |
| `Range: bytes=-0` | `416`, `Content-Range: bytes */size` |
| `Range: bytes=a-` with `a ≥ size` | `416`, `Content-Range: bytes */size` |
| `Range: bytes=a-b` with `b < a` | `416`, `Content-Range: bytes */size` |
| Malformed, or a unit other than `bytes` | **ignored** → `200` full body (RFC 9110 §14.2) |
| Multi-range (`bytes=0-9,20-29`) | **ignored** → `200` full body (a server MAY ignore; no `multipart/byteranges`) |
| `size === 0`, any range | `416`, `Content-Range: bytes */0` |

Multi-range answering `200` is a deliberate, spec-legal choice: `multipart/byteranges` is
pure cost here (no client the deck serves needs it) and would grow the diff well past
"minimal". Media players issue single ranges.

## Acceptance (definition of done)

- [x] `sendFile` sets `Accept-Ranges: bytes` and `Content-Length` on every `200`.
- [x] A `200` body is **byte-identical** to the pre-change body (proved by a hash comparison in `REPORT.md`).
- [x] Single-range requests answer `206` with a correct `Content-Range` and `Content-Length`, per the wire spec above.
- [x] Unsatisfiable ranges answer `416` with `Content-Range: bytes */size`.
- [x] Malformed and multi-range requests fall back to a full `200`.
- [x] Range bodies are streamed with `fs.createReadStream` (no whole-file buffering).
- [x] `test/static-range.test.js` exists and covers 200 / 206 / 416 / multi-range; it passes.
- [x] `npm test` green (counts quoted in `REPORT.md`).
- [x] The diff touches `server.js` only (plus the new test + this pack). `public/v2/**` untouched.
- [x] Headless proof: `probe-scroll.cjs` reports `s0`/`s1`/`s2` hashes all different and `rafs > 30`; the raw JSON line pasted into `REPORT.md`.
- [x] `reviewer` ran on the diff; findings quoted in `REPORT.md`.
- [x] Branch `agent-v2-l12` pushed; `REPORT.md` signed **Hadwig**; registry row `done`; bus reply sent.

## Gate and proof (mandatory)

1. `npm test` green — quote pass/fail counts, and re-run any file that fails alone before
   blaming the diff (shared-box port contention is a known flake).
2. `node probe-scroll.cjs` against a static server on this worktree — `s0`/`s1`/`s2` frame
   hashes must differ and `rafs > 30`. Paste the JSON line verbatim.
3. `curl -r` transcripts for 200 / 206 / 416 in `REPORT.md`.

## Constraints

- Minimal diff: `sendFile` + at most one helper.
- Never `git stash`; never touch `main` or `weave/fd-v2`.
- Linear unreachable (`oauth_token_invalid_grant` or any MCP error) is NEVER a blocker: log
  the would-be issue in `LINEAR-PENDING.md` here, register with `task: "PENDING"`, keep working.
- Push with a fresh train-broker token per push, env only, never stored or logged:
  `tok=$(curl -sf http://100.125.231.25:3131/api/ghtoken | python3 -c 'import json,sys;print(json.load(sys.stdin)["token"])'); GH_TOKEN=$tok git push origin agent-v2-l12`
  — curl 503 = no GitHub train: file `operator:gate` and block on that step only.
- You EXECUTE, you never orchestrate: no `/introduce-goal`, no second worker session, no
  re-scoping; out-of-scope work → Linear issue for the operator.

## Execution protocol

`PROTOCOL.md` in this directory.
=======
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
>>>>>>> claude/fleetdeck-v2-redesign-plan-5a5cd5
