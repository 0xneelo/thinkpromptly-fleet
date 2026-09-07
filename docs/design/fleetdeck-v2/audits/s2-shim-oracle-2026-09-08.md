# S2 runtime shim — oracle audit (2026-09-08, design seat, stands in for the hunter pass)

Audited `origin/agent-v2-s2` @ `3e64200`; every finding reproduced in Chromium against the branch's real
`runtime.js` / `fixture.js` / `logic.js` / `app.js`. Verdict **SPLIT**: faithful, bounded, fast port; safe as the base
for nine parallel logic slices only under the three binding instructions at the end. Fixes are S2.2 (Julius).

| # | Sev | Where | Failure | Fix |
|---|---|---|---|---|
| F1 | CRITICAL | `tools/dc-compile.mjs:282` (`k + "/nid:" + i`), `runtime.js:220` | Positional row identity. Tiles [A,B,C,D] with an xterm mounted in each body; `setData("tiles",[A,C,D])` → headers A,C,D hold terminals A,B,C; D's terminal detached and leaked. Same for every `sc-for` a poll can reorder. | `sc-for` accepts `key="{{ tl.id }}"`; emit `+ (keyGet(sub) ?? i)` (3 lines, runtime unchanged) |
| F2 | CRITICAL | `runtime.js:336-337` | A throw in `renderVals` renders with `vals = host.props` → every `sc-if` false, every list empty, the composer textarea removed and later recreated (focus lost). One malformed row from one slice blanks all nine screens until the next poll. | On catch: `return` without rendering (keep last DOM); each slice wraps its section in try/catch falling back to last good values |
| F3 | HIGH | `runtime.js:282-297` | Any child-list change deletes foreign nodes in that parent → xterm in a tile body dies when `tl.lines` changes length. No skip marker exists. | Honour `data-dc-raw` in `syncChildren` (skip the parent) |
| F4 | MEDIUM | `runtime.js:208` | `<select>` value written only when the prop changed; options reused by index → DOM shows a value the page is not rendering (reproduced with `orgScopeData`). | For `SELECT` always run the `el.value !== s` compare |
| F5 | MEDIUM | `runtime.js:327-342` | No update-depth guard: `setState` in `componentDidUpdate` loops at microtask speed and hangs the tab. | Count flushes per macrotask; `console.error` + bail above 50 |
| F6 | LOW | `runtime.js:205` | Controlled `checked` does not revert on a rejected toggle. | Always assign `el.checked = v` |
| F7 | LOW | `dc-compile.mjs:86` | `isPureData` treats ternary consequents as property keys → literal moved to fixture throws `ReferenceError`. | `?` poisons the literal |

Verified non-findings: caret/focus survive poll-driven renders when the bound value is unchanged (a slice that
normalises the bound value breaks it); handlers rebound every render (vendor parity); `preventDefault`/`stopPropagation`
match React 17+ semantics; pseudo sheet bounded (12 rules, no growth); `{{ }}` inside `style-hover` is baked raw at
compile time exactly as the vendor does (hover rules empty on both sides — parity, not a bug); `$index` re-assigned
per render; full-tree render ≈ 5 ms at 100 registry rows, ≈ 4.5 ms per composer keystroke with 50 threads.
Not verified: IME composition; whether S2's gates were regenerated after the two head fixes.

## Three binding instructions for L2–L11 (broadcast 2026-09-08)

1. **Never mount foreign DOM inside a compiled node** (L3 especially): mount xterm in a container you own outside
   `#dc-root` positioned over the tile, or wait for `key="{{ tl.id }}"` support (F1) and keep the tile body's list
   permanently `[]` so its child list never changes (F3). Positional `sc-for` rows are not stable identities; never keep
   per-row state in the DOM.
2. **Validate before `setData` and make your `renderVals` section throw-proof**: guard every field access on incoming
   rows; wrap your slice's block in try/catch returning the last good values. One throw blanks all nine screens (F2).
3. **Bind raw input state, never a derived value; never `setState` unconditionally in `componentDidUpdate`**: store
   what the user typed verbatim, normalise only for filtering; compare before `setState` in lifecycle hooks (F5).
   A `<select>` fed from live data shows F4 until fixed.
