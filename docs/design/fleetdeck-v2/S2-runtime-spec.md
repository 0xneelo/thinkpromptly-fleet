# S2 — dc-runtime behavioural spec (the contract the compiler must reproduce)

Source: `public/v2/vendor/dc-runtime.js`, sha256 `42c5f39fe6fafdbec2854092dafaa85aff6ab452334da4b244fc27b526bd686c`.
Audited line-by-line (adversarial read + live probes in a node `vm`) before any S2 code was written.
Line refs are that file. Anything marked **BUG** must be reproduced bug-compatibly, not fixed.

## 0. What the runtime actually is

It builds **React element trees** — `h()` is `window.React.createElement` (L9-21); ReactDOM commits (L195-198).
dc-runtime injects React, ReactDOM and Babel itself from `/v2/vendor/` (`REACT_URL` L1143-1147, script
injection L1826); the page never references them. S2 replaces all of it.

Mount shape: `<div id="dc-root"><div class="sc-host" data-sc-name="…">…template…</div></div>` (L165-198, L1029-1105),
replacing the original `<x-dc>`.

## 1. Expression evaluation — port, do not reimplement

`resolve(vals, src)` (L203-294) is a **restricted evaluator**, not JS:
trim (empty -> `undefined`) -> strip one wrapping `(...)` -> first top-level `===`/`!==`/`==`/`!=` ->
leading `!` -> `true`/`false`/`null`/`undefined` -> `/^-?\d+(\.\d+)?$/` -> matched quotes (no escapes) ->
property path (`[A-Za-z_$][A-Za-z0-9_$]*`, `.ident`, `.digits`, `[expr]`; nullish intermediate -> `undefined`).
**No calls, arithmetic, `&&`, `||`, `??`, ternaries, or optional chaining.**

**BUG (reproduce):** the delimiter scanners are not quote-aware and equality splitting happens before
string-literal recognition. `1 === 1 === true` -> `false`; `'a==b'` -> `true`; `'a!=b'` -> `false`.

Scope: `vals = { ...userProps, ...(logic.renderVals() || {}) }` (L1085). Loop scope is a **flat overwrite**,
`{ ...vals, [asName]: item, $index: i }` (L636) — not a lexical chain; inner shadows outer.

`compileAttr` (L402-409): if the whole value matches `/^\s*\{\{([\s\S]+?)\}\}\s*$/` return the **typed**
value; otherwise join mixed parts with `resolve(...) ?? ""`.
**BUG (reproduce):** that regex spans multiple holes, so `"{{ a }} {{ b }}"` resolves the single expression
`" a }} {{ b "` (normally `undefined`) instead of concatenating. `{{}}` does not match; `{{ }}` -> `undefined`.

**Decision: `resolve`, `compileAttr`, `cssToObj`, `importantify`, `kebabToCamel` and `EVENT_MAP` are ported
verbatim into `runtime.js`.** Reimplementing them would mean reimplementing their bugs.

## 2. Text interpolation — exact span rules (L569-609)

A text node containing `{{` becomes a keyed fragment, split left to right. Per resolved value:

| Value | Output |
|---|---|
| `undefined` (not streaming, editor off) | **nothing** |
| `null`, `true`, `false` | **nothing** |
| React element or Array | inserted directly, **no span** |
| everything else, incl. `0`, `""`, objects | `<span class="sc-interp">String(v)</span>` (L607) |

`sc-unresolved` (L587) and `sc-missing` (L599) are editor/streaming only — not reachable in our build.
Text without `{{`: `if (!txt.trim() && !txt.includes(" ")) return null` (L571-573) — newline/tab-only nodes are
dropped; whitespace-only nodes containing at least one ASCII space are preserved verbatim.

Measured on our render: 74 `span.sc-interp` and 549 `data-dc-tpl` in the landing view.

## 3. `sc-if` and `sc-for` are TAGS, not attributes

`sc-if` (L646-660): `<sc-if value="…">`. Plain JS truthiness of the resolved value. Falsy -> **no node at all**,
no placeholder or comment. Literal `value="false"` / `value="0"` are non-empty strings and therefore **true**;
only `{{ false }}` / `{{ 0 }}` are false (probe-confirmed). `sc-else` / `sc-elif` **do not exist** — an
`<sc-else>` renders as a literal custom element whose children always render.

`sc-for` (L611-644): `<sc-for list="{{ rows }}" as="row">`. `as` is a literal attribute, default `"item"`.
Only `Array.isArray` iterates; anything else -> `[]`. Output is outer fragment -> per-iteration fragment keyed
by `i` -> children. **Positional keying only**; a `key` attribute on `sc-for` is ignored. Inter-child
whitespace repeats each iteration.
**BUG (reproduce):** `as="$index"` loses the item, because `$index: i` is assigned last and wins.

## 4. Pseudo-class sheet (L428-431, L809-811, L1498-1588)

Any attribute starting `style-` calls `host.pseudoClass(pseudo, rawValue)` at **compile time** using the
**raw, uninterpolated** string — `{{ }}` inside `style-hover` never resolves.

    const cls = "scp" + (n++).toString(36);      // scp0..scp9, scpa..scpz, scp10, …

One counter shared across the whole runtime. Cache key is `pseudo + "|" + css`, exact string — whitespace
differences allocate a new class. Allocation order is: parse and stamp all ids first, then walk in document
order, each element's own attributes in DOM order before its descendants — **including inside `sc-if`/`sc-for`
branches that never render**. Getting this order wrong shifts every later class name.

    isPseudoElement = (pseudo === "before" || pseudo === "after")
    sel = isPseudoElement ? "." + cls + "::" + pseudo : "." + cls + ":" + pseudo
    rule = sel + "{" + (isPseudoElement ? css : importantify(css)) + "}"

So `style-hover="color:red;"` -> `.scp0:hover{color:red !important}`. Our template uses only `style-hover`
(73) and `style-focus` (3), so every rule is importantified.

`className` = `[props.className, ...pseudoClasses].filter(Boolean).join(" ")` — existing class first, in
attribute order.

Rules are inserted with `insertRule` (CSSOM), so the `<style>` element's `textContent` stays **empty**. A
compiler that emits a textual `<style>` is visually identical but DOM-different — which is why the DOM parity
dump is scoped to the `#dc-root` subtree, not the head.

## 5. Events (L317-358, L436-441, L801-807)

41-entry `EVENT_MAP`; unmapped `on*` falls back to `"on" + key[2].toUpperCase() + key.slice(3)`.
**There is no handler-string-to-function conversion.** `onClick="{{ handler }}"` passes the resolved function;
`onClick="handler()"` passes the literal string; `onClick="{{ handler() }}"` is `undefined` (calls unsupported).
Handlers receive one event, no bound `this`, no extra args.

Our template uses only `onClick` (65), `onChange` (6), `onBlur`, `onKeyDown`, `onMouseEnter`, `onMouseLeave`.

## 6. Attributes

Renames are exactly `class`->`className`, `for`->`htmlFor`, plus the event map (L436-441).
A pre-parse regex `/(\s)([a-z]+[A-Z][A-Za-z0-9]*)(\s*=)/g` rewrites camelCase attributes to `sc-camel-…`
(L365-370), decoded later — **regex-based, so it can also match inside quoted values and text.** The compiler
must replicate this `encodeCase` step or the HTML parser will lowercase `playsInline`, `autoPlay`, `viewBox`,
`strokeWidth` and friends and the DOM will diverge.

`encodeCase` also rewrites `<helmet>` -> `<sc-helmet>` and renames `select/table/tbody/thead/tfoot/tr/td/th/
caption` to `sc-raw-*` so the HTML parser cannot foster-parent them, restoring afterwards. **Replicate this.**

`style`: string values go through `cssToObj` (L391-400) — split on every `;`, first `:` per piece, keep `--`
custom properties, else kebab->camel. No quote/URL awareness, so semicolons inside quoted values or data-URIs
split wrongly. Reproduce.

No presence-to-`true` boolean normalisation: a bare attribute is `""`. Our template binds
`muted`/`playsInline`/`autoPlay`/`loop`/`autoFocus` as `{{ true }}`, which resolves to real `true`.

`value`/`checked` (L801-807): coerced only when the resolved value is exactly `undefined` — to `""` and `false`
respectively. `null`/`false`/`0` pass through untouched.

## 7. `ref` — definitive

`ref` is **not** special-cased in `collectProps` (L415-443); it flows through as an ordinary prop into
`React.createElement`, which extracts it into the element's ref slot (`ba={key:!0,ref:!0,…}` in
react.production.min.js). **It is never serialised as a DOM attribute.**

Our logic supplies **callback refs** — `videoRef: (el) => {...}`, `canvasRef`, `busRef`, `termRef`,
`threadRef`, `rootRef`, `D_vid` (13 `ref=` sites). Video setup, bus autoscroll and terminal autoscroll all
depend on them. The shim must call function refs with the element on attach and `null` on detach, and must
reuse DOM nodes across re-renders rather than recreating them.

## 8. Lifecycle (L817-850, L888-1132)

Mount: wrapper ctor -> `new Logic(userProps)` -> `logic.__host = wrapper` -> render (`logic.props = userProps`,
`logic.renderVals()`, merge over user props, build tree) -> React commits -> wrapper `componentDidMount` ->
`logic.componentDidMount()`.

`setState` (L825-829): the updater runs **synchronously and immediately**, receives only current state, and the
merge is shallow — `this.logic.state = { ...prev, ...patch }` — then a wrapper re-render is enqueued. So logic
state is readable synchronously after `setState` returns, while the DOM update is scheduled.

**Caveat:** `__host` is set only after construction, so `setState` inside the logic constructor is a no-op;
direct `this.state = …` assignment works.

Update: merge -> re-render -> commit -> wrapper `componentDidUpdate(prevProps)` reassigns `logic.props` ->
`logic.componentDidUpdate(prevProps)`.
**BUG (reproduce):** `prevProps` is the *wrapper's* previous props (carrying internal keys) while `logic.props`
is the filtered set, and no prevState is ever forwarded.

Every render re-evaluates **all** builders — there is no dependency tracking — but the result is reconciled,
so unaffected nodes are reused. The shim must do the same: re-evaluate everything, diff, reuse.

## 9. `data-props` (L24-73, L175-193)

Read from `script[data-dc-script]`, JSON-parsed. **It does not merge into logic state.** Standalone boot builds
defaults from `propsMeta[k].default` (the value must be nested under `.default`) and applies
`{ ...defaults, ...propOverrides }`. Our blob has 13 top-level keys.

## 10. `hint-*` — not uniformly no-ops

`hint-placeholder-count` on `sc-for` and `hint-placeholder-val` on `sc-if` matter **only during streaming**,
which our build never enters; `hint-size` on an ordinary element is consumed and discarded. In our template
they are 1:1 with the 32 `sc-for` and 71 `sc-if` and are therefore inert — but they must be **dropped**, not
emitted as attributes.

## 11. `<helmet>`

Renders **no body node**; it mutates `document.head` directly, and its children are raw — not interpolated, no
`sc-if`/`sc-for`, no pseudo processing (L12d). Our block holds one stylesheet link and one inline `<style>`.
The compiled shell can therefore carry them statically in `<head>`.

## 12. Volatile surface (measured on our logic script)

Zero `Math.random`. Two `setInterval` — the reveal ticker (120 ms) and the deck auto-advance. Seven
`setTimeout` — the video setup poll (200 ms), the toast dismiss (7000 ms), and the message delivered/acked
transitions. One `requestAnimationFrame` — the video scrub loop. `Date.now()` appears only inside interaction
handlers, minting message and thread ids.

Timers are frozen and animations disabled **symmetrically on both sides** before any parity dump. The pixel
gate does not freeze JS timers — it blocks media and uses `reducedMotion: 'reduce'` — and pass 1 already scores
0.000000 % on 34 of 36 screens under it, so that path is left exactly as S0 built it.

## 13. Known pass-1 diagnostics that must vanish in pass 2

dc-runtime parses the raw template before binding, so the browser requests
`/v2/%7B%7B%20A_videoUrl%20%7D%7D` once per theme and logs an invalid `<polyline points>` for the unbound
`{{ a.trendPts }}` — four console errors, zero JS exceptions, preserved under D15 in S1 and reproduced in my
own smoke run. A compiled render has no pre-bind DOM, so pass 2 must show **zero** console errors and **zero**
404s.

Signed **Julius**.
