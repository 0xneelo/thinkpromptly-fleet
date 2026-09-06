// tools/style-parity.mjs — R2 style-parity gate (XYZ-1107;
// docs/goals/editorial-v2-port/PLAN.md §2d, ACCEPTANCE.md G2).
//
//   node tools/style-parity.mjs --surface <name> --lane <desktop|mobile> \
//     --theme <dark|light> --mock <path[#hash]> --served <path[#hash]> \
//     [--mock-root <sel>] [--served-root <sel>] [--hooks a.js,b.js] [--seed on|off] \
//     [--out <path>]
//
// The check three previous ports of this design did not have. Side A = the pass-1
// mock page rendered through the dc-runtime; side B = the page the port actually
// ships. Both are rendered in the SAME headless Chrome, at the SAME viewport, with the
// SAME theme driven through the page's OWN theme control (never a bare setAttribute —
// see driveTheme), and their getComputedStyle values are diffed element by element. Zero
// mismatches = pass. Exit is non-zero on any unruled mismatch, any element present on one
// side and absent on the other, any structurally divergent pair, and any comparison too
// small to certify anything — this is a build gate, not a report. A false GREEN certifies
// a broken port; a false RED only costs a re-run, so every ambiguity fails.
//
// Computed-style extraction route (a): a sampler <script> is injected into a tmp
// copy of each page written NEXT TO the original, so relative URLs (assets/, fonts/,
// stylesheets) still resolve — see siblingRuntimes() for the one exception — and the
// result is read back out of the rendered page. That read used to be --dump-dom, the
// synchronous execFileSync idiom this repo already had (tools/compile-dc.js,
// tools/f2-parity.mjs); XYZ-1171 made it CDP instead, because --dump-dom navigates before
// a device-metrics override can be installed and the mobile lane cannot be expressed
// without one. See chromeSample(). Still no dependency — Node built-ins only.
//
// Normalizations — each erases a RUNTIME or PATH artifact, never design, and is
// applied SYMMETRICALLY to both sides:
//   n1. url(…) reduced to its basename: the T2 asset-path transform (mock-relative →
//       committed apps/dashboard/editorial/assets/) is deliberate; a renamed file
//       still fails.
//   n2. window.setInterval no-op'd before any page script runs (same freeze as
//       compile-dc.js) — both sides are compared at their initial, deterministic
//       state instead of at whatever tick the virtual clock landed on.
//   n3. animations/transitions disabled, so no allowlisted property is sampled
//       mid-interpolation.
//   n4. the dc-runtime mount scaffolding (<div id="dc-root"><div class="sc-host">) is
//       not walked: mock <body> joins served <body>, and the mock's mounted subtree
//       joins the served body's subtree (same unwrap rule as compile-dc.js n1).
//   n5. <span class="sc-interp"> wrapper spans are unwrapped (children hoisted) before the
//       walk — the mock's template compiler wraps every interpolated text run in one, and
//       the served side renders the same text without it. See unwrapInterp().
//
// SEEDED SAMPLING (side B only; --seed on, the default) — deliberately NOT a normalization,
// because it is asymmetric. The mock HARDCODES populated demo values ("Base · 8453", "Live
// API", ten chain <option>s); the served page rendered on file:// has no API behind it and
// renders its NO-DATA state (the em dash "—", one placeholder <option>). The two sides were
// therefore sampled in DIFFERENT STATES, and every real style defect sat buried under text
// and element-count noise that says nothing about styling. G2 compares STYLE; so before the
// walk, side B's no-data placeholders are populated with side A's own values. See seed().
// Four bounds, and they matter more than the feature:
//   s1. The values come from the MOCK AT RUNTIME (side A's walk emits them), never from a
//       hand-written fixture — a fixture would drift from the corpus and end up asserting
//       against itself.
//   s2. A seed may only REPLACE A PLACEHOLDER: the served element's own text must contain
//       the em dash, or every <option> of a <select> must. A rendered value is never
//       overwritten, so a port that renders the WRONG value still fails. Anything else —
//       an empty container the mock fills with rows, a differing rendered number — is left
//       exactly as it is and still fails the diff. Seeding populates; it never excuses. In
//       particular NOTHING is ever cloned out of the mock's DOM: manufacturing side B's
//       markup from side A is precisely the vacuous pass this gate exists to prevent.
//   s3. Seeding is VERIFIED, never assumed. Every applied seed is re-read after the page
//       has had a chance to write over it, and any target that reverted, vanished or never
//       took the value aborts the run naming the element. A seeded run that silently
//       no-ops would certify nothing while looking green.
//   s4. Every substitution is REPORTED — artifact `seeding` block (before/after per element,
//       plus the placeholders that found no counterpart and stayed in the diff) and a
//       stderr line on every run, seeded or not. An evidence artifact must never look the
//       same whether or not seeding ran.
// Surface-agnostic on purpose: the chain <select> and the live-state pills recur on
// dashboard, compare and admin, so the rule is stated once over placeholders and paths
// rather than five times over per-surface selectors. Seed identity IS join identity (key,
// then path, same precedence and same duplicate-key disambiguation), so a seeded element
// and the element it is later compared against cannot be two different nodes.
//
// Element join, in precedence order: (1) id / data-lc-* attribute hooks, (2) the F3
// hook inventory from tools/hook-inventory.js (generated, never recalled), (3) DOM path
// + a depth-1 structural/content fingerprint, so hookless elements still compare without
// ordinal position alone deciding identity, (4) n4's <body> axiom, which is construction
// rather than inference and is enforced as such — see the joinOn("root") call in compare().
//
// The ONLY legal diffs are the ruled transforms in DECISIONS.md. Every RULED_TRANSFORMS
// entry must cite a D-number that RESOLVES IN DECISIONS.md — the tool refuses to run
// otherwise, so a waiver cannot exist without a ruling behind it. RULED_ELEMENTS applies
// the same discipline to a ruled transform that ADDS or DROPS an ELEMENT (D14's 8th admin
// tab; the #skip-link restored under D17's accessibility precedent), which the property
// allowlist structurally cannot express. An exempted element is still walked, still
// sampled and still reported — it moves from `missing` into the artifact's `exempt`
// bucket carrying its D-number, never out of the comparison.
//
// REEXPRESSED is a THIRD category and neither of those two (freeze exception #6, this one
// change only). An element the mock draws inside a region the port RE-EXPRESSES as a different
// element is not `missing` — the port drops nothing — and it is not `exempt` either, because
// nothing about it is excused. D20's `<dialog>`/`<aside>` swap is the case that forced it: the
// tag change puts each region in its own path-ordinal namespace, so neither subtree joins and
// the mock's own members had nowhere legal to go. They are reported as what they are, under
// their D-number and pointing at the served element they are re-expressed as, and each region's
// membership is PINNED — see REEXPRESSED.

import { execFileSync, spawn } from "node:child_process";
import { readFileSync, writeFileSync, copyFileSync, rmSync, mkdirSync, mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const CHROME = process.env.CHROME_BIN || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const fail = (msg) => {
  throw new Error(`style-parity: ${msg}`);
};

// PLAN §2d allowlist, expanded to the per-corner / per-side longhands getComputedStyle
// actually serializes. Nothing outside this list is compared.
const PROPERTIES = [
  "border-top-left-radius", "border-top-right-radius", "border-bottom-right-radius", "border-bottom-left-radius",
  "font-family", "font-size", "font-weight", "font-style",
  "color", "background", "background-color",
  "padding-top", "padding-right", "padding-bottom", "padding-left",
  "margin-top", "margin-right", "margin-bottom", "margin-left",
  "gap", "row-gap", "column-gap",
  "display", "flex-direction", "flex-grow", "flex-shrink", "flex-basis",
  "align-items", "justify-content",
  "grid-template-columns", "grid-template-rows",
];

// Ruled transforms — the only accepted diffs (ACCEPTANCE.md G2). Each entry is
// {d, transform, property, selector: RegExp, mock: RegExp, served: RegExp} and is
// validated against DECISIONS.md before any page is rendered. `selector` is MANDATORY:
// a selector-less entry suppresses its property+value pattern on EVERY element, which is
// not a waiver but a hole — a waiver must name what it waives. EMPTY is the strictest
// state and the correct one until a Phase-3 surface produces a diff that a ruling
// actually covers; add entries only alongside the D-number that licenses them, e.g.
//   { d: "D4", transform: "T-fonts", property: "font-family", selector: /^#site-title$/,
//     mock: /^"Helvetica Neue"/, served: /^"Helvetica Neue Light"/ },
//
// D19 (XYZ-1148, "the Z-transform is recorded as a numbered transform"): the pipeline's Z
// transform empties the mock's fabricated sample values, and the masthead nav's alert dot is
// the ONE Z neutralization that leaves a computed-style trace — the mock paints the dot, the
// port paints nothing. The other four elements D19 names (rail health chip, Live-API pill,
// footer chain line, the ten-chain <select>) keep the mock's styling and only lose their
// fabricated TEXT, so they produce no diff in any artifact and get no entry: an allowlist
// row with nothing to suppress is dead config that hides the regression it would later mask.
// Measured, per lane, on the 2026-08-10 matrix run:
//   desktop `…>nav:1>div:1>a:1>span:2`  mock var(--lc-red)   → rgb(255,125,133) dark /
//     rgb(185,28,28) light, served rgba(0,0,0,0) — admin, compare, docs, signin.
//   mobile  `…>nav:1>div:2>a:1>span:1`  mock var(--lc-green) → rgb(77,213,164) dark /
//     rgb(21,128,61) light, served rgba(0,0,0,0) — dashboard, docs, signin.
// Two selectors because the two lanes' mastheads nest differently and the mobile label span
// is a bare sc-interp the sampler unwraps, which moves the dot from span:2 to span:1. Two
// colours because the mobile mock draws this dot green; both are the same fabricated alert
// state on the same nav entry, so both are the same Z transform under the same D-number.
// The value bounds enumerate exactly those four mock colours and the one served value — a
// dot that starts painting some OTHER colour, or a served side that starts painting at all,
// falls straight back into `mismatches`.
// The DESKTOP DASHBOARD was absent from that list, and no longer is. Its own document used to
// ship the mock's red dot un-neutralized, so both sides agreed and there was no diff at all —
// reported in the sweep as a port defect this gate cannot see. That defect is FIXED: the
// pipeline now applies the same Z swap the other nine documents already carried
// (promote-dashboard.js:169-176), apps/dashboard/index.html:134 ships `background: transparent`,
// and the first two entries below fire on that document too — 2 ruled diffs on each of its rows.
const RULED_TRANSFORMS = [
  { d: "D19", transform: "Z-alert-dot", property: "background",
    selector: /^body>div:1>div:1>nav:1>div:1>a:1>span:2$/,
    mock: /^rgb\((?:255, 125, 133|185, 28, 28)\) none repeat scroll 0% 0% \/ auto padding-box border-box$/,
    served: /^rgba\(0, 0, 0, 0\) none repeat scroll 0% 0% \/ auto padding-box border-box$/ },
  { d: "D19", transform: "Z-alert-dot", property: "background-color",
    selector: /^body>div:1>div:1>nav:1>div:1>a:1>span:2$/,
    mock: /^rgb\((?:255, 125, 133|185, 28, 28)\)$/, served: /^rgba\(0, 0, 0, 0\)$/ },
  { d: "D19", transform: "Z-alert-dot", property: "background",
    selector: /^body>div:1>div:1>div:1>nav:1>div:2>a:1>span:1$/,
    mock: /^rgb\((?:77, 213, 164|21, 128, 61)\) none repeat scroll 0% 0% \/ auto padding-box border-box$/,
    served: /^rgba\(0, 0, 0, 0\) none repeat scroll 0% 0% \/ auto padding-box border-box$/ },
  { d: "D19", transform: "Z-alert-dot", property: "background-color",
    selector: /^body>div:1>div:1>div:1>nav:1>div:2>a:1>span:1$/,
    mock: /^rgb\((?:77, 213, 164|21, 128, 61)\)$/, served: /^rgba\(0, 0, 0, 0\)$/ },
];

// Ruled ELEMENT exemptions — the same waiver discipline for an element that a ruling adds
// to, or drops from, one side. Each entry is {d, transform, selector|within: RegExp,
// absentFrom: "mock"|"served"} and is validated against DECISIONS.md before any page is
// rendered.
//   `selector`   names the ELEMENT, matched against its own identity (its hook key, or its
//                DOM path when it has none). The regex is the narrowing device and may
//                cover a family (/^#arch-/), but every element it matches is still
//                enumerated one by one in the artifact.
//   `within`     names a hook-keyed ANCESTOR instead, for a ruled element that carries no
//                hook of its own — see the paragraph below. Exactly ONE of selector/within
//                is MANDATORY: an entry with neither would excuse every absent element on
//                the page, which is a hole rather than a waiver, and an entry with both
//                would leave the artifact unable to say which device did the excusing.
//   `absentFrom` MANDATORY and single-valued: the side the element is expected to be
//                ABSENT from — "mock" for something the port adds, "served" for something
//                it drops. A dropped element is a completely different failure from an
//                added one, so one entry may never cover both directions; an entry that
//                names the wrong side does not suppress and the gate still fails.
// Element-level, not subtree-level, on purpose: "ignore everything under this node" is how
// a surface silently loses coverage, and the artifact's `missing` list already names every
// absent element individually, so a per-element (or per-pattern) entry costs one line and
// keeps each excused element named, counted and re-checked on every run. EMPTY is the
// strictest state and the correct one to ship; add entries only alongside the D-number
// that licenses them, e.g.
//   { d: "D14", transform: "T-arch-tab", selector: /^#tab-architecture$/, absentFrom: "mock" },
//
// `within` exists because a ruled element can be UNNAMEABLE. D14's five hookless descendants
// (the tab's count <span>; the panel's p:1, p:2, p:2>a:1, p:3) carry no id and no data-lc-*,
// so `selector` can only ever see their DOM path — and a bare path names a POSITION, which
// keeps matching after the position has moved under something else. `within` names the REGION
// instead: the anchor is resolved AT RUN TIME out of the side the element is present on, by
// matching an ancestor's own hook KEY (never a path), and the excuse reaches only elements
// strictly BELOW that ancestor's path. Move the region and the anchor moves with it; rename or
// delete the anchor and the exemption lapses to red instead of drifting onto whatever now
// occupies those coordinates. What it deliberately CANNOT do:
//   · excuse an element that has no hook-keyed ancestor at all — the only remaining device
//     would be a bare path, so that element stays red;
//   · excuse the anchor itself (strictly below, never equal) — an anchor needs its own entry;
//   · tell siblings apart under the anchor. EVERY element absent from `absentFrom` below it is
//     excused, including one added tomorrow, so `within` may only anchor on a region the other
//     side does not render AT ALL. That is the whole cost, and it is paid in the open: each
//     excused element is still listed individually in `exempt` by selector, path, D-number and
//     the anchor key that carried it, and printed on every run, green or red.
// D14 (XYZ-1110, "Keep as 8th tab"): three named elements plus their two hookless regions.
// Selectors verified against the PROMOTED apps/dashboard/admin.html — the rail entry is <a
// id="tab-architecture"> (:176), the panel a separate sibling <div id="panel-architecture">
// (:426) and the explorer <iframe id="architecture-frame"> (:435) inside it. One transform
// name for all five: D14 is one ruled transform, and splitting the name would imply several
// rulings. The `selector` entries are listed FIRST on purpose — exemptBy takes the first match,
// and #architecture-frame sits under #panel-architecture, so an element that has a name of its
// own is excused by that name rather than by its region.
// D17 (XYZ-1144, "Ring stays global; rest scoped"): the admin skip link. The element itself is
// recorded as W3, a WORKER INTERPRETATION and not a D-number, but W3 is ratified there as "a
// D17-precedent accessibility restoration", and D17 is the ruling that states accessibility is
// not a design detail the mock deletes by omission. D17 is therefore the authority AND the only
// citation that can resolve — validateWaivers() accepts /^D\d+$/ alone, so W3 could not be
// cited even if it were the right one. Verified against the promoted admin.html: <a
// id="skip-link" href="#admin-panels"> at :125, first child of <body>, served-only. Note
// DECISIONS.md:76's "Live G2 consequence" paragraph records that this entry does NOT exist and
// that the skip link stays red; that paragraph is stale as of this entry and the ruling behind
// it, and updating it is DECISIONS.md's edit, not this file's.
const RULED_ELEMENTS = [
  { d: "D14", transform: "T-arch-tab", selector: /^#tab-architecture$/, absentFrom: "mock" },
  { d: "D14", transform: "T-arch-tab", selector: /^#panel-architecture$/, absentFrom: "mock" },
  { d: "D14", transform: "T-arch-tab", selector: /^#architecture-frame$/, absentFrom: "mock" },
  { d: "D14", transform: "T-arch-tab", within: /^#tab-architecture$/, absentFrom: "mock" },
  { d: "D14", transform: "T-arch-tab", within: /^#panel-architecture$/, absentFrom: "mock" },
  { d: "D17", transform: "T-skip-link", selector: /^#skip-link$/, absentFrom: "mock" },
  // D16 (XYZ-1127 carryover + its XYZ-1148 "unmocked assembly" sub-class). Two different
  // shapes of the same ruling, and the difference decides whether an entry may use `within`:
  //   CARRIED REGIONS have no mock side AT ALL, which is exactly the precondition `within`
  //     documents, so the region root takes a `selector` entry and everything strictly below
  //     it takes one `within` entry.
  //   ASSEMBLY MEMBERS are individual controls the live surface needs and the mock does not
  //     draw. They sit INSIDE mock-derived markup, so `within` would reach mock-derived
  //     siblings; each is named by its own hook key instead.
  // The order matters — exemptBy takes the first match, so every `selector` is listed ahead
  // of the `within` that would otherwise swallow it, and #address-deep-check (region 4) is
  // listed before #address-view (region 1) so the artifact attributes it to its own region.
  // Region 3 (the Fix-dialog page 2 "Websocket pools" section) has no entry of its OWN: it sits
  // inside the Fix dialog, whose non-join XYZ-1175 has since ruled as D20, so its elements are
  // carried by that ruling's `#fix-dialog` anchor at the end of this list and are attributed to
  // D20 in the artifact. While the dialog was unruled it had no entry because one would have
  // suppressed part of an open defect. Region 6 (rulings.html) is a carried SURFACE with no G2
  // row at all.
  { d: "D16", transform: "T-deep-check", selector: /^#address-deep-check$/, absentFrom: "mock" },
  { d: "D16", transform: "T-address-view", selector: /^#address-view$/, absentFrom: "mock" },
  { d: "D16", transform: "T-tests-view", selector: /^#tests-view$/, absentFrom: "mock" },
  { d: "D16", transform: "T-arbiter", selector: /^#arbiter$/, absentFrom: "mock" },
  // Assembly · admin (~28). The 15 status lines are one enumerated regex rather than 15
  // lines: naming them individually would not narrow anything the alternation does not, and
  // a 16th `-status` id would NOT match, which is the property that keeps this a waiver.
  { d: "D16", transform: "T-assembly-status-lines", absentFrom: "mock",
    selector: /^#(?:api-keys|audit|background|chains|diag|erpc|head-source|ingest|log|request-cu|solana-cu|sweep|tracked|usage|whirlpool-depth)-status$/ },
  { d: "D16", transform: "T-assembly-refresh", selector: /^#(?:usage|chains)-refresh$/, absentFrom: "mock" },
  { d: "D16", transform: "T-assembly-breaker", selector: /^#breaker-banner$/, absentFrom: "mock" },
  { d: "D16", transform: "T-assembly-chains-env", selector: /^#chains-env-warning$/, absentFrom: "mock" },
  { d: "D16", transform: "T-assembly-chains-hidden", selector: /^#chains-hidden$/, absentFrom: "mock" },
  { d: "D16", transform: "T-assembly-chain-search", selector: /^#chain-search$/, absentFrom: "mock" },
  { d: "D16", transform: "T-assembly-chain-chips", selector: /^#chain-filter-chips$/, absentFrom: "mock" },
  // The head-source section's own wrapper and its two hookless <p> carry no key and no
  // hook-keyed ancestor of their own (the nearest is #panel-chains, which is the whole
  // chains panel — far wider than this group), so only its three keyed members are named
  // and the wrapper stays red. Same limit D14's five hookless descendants hit.
  { d: "D16", transform: "T-assembly-head-source", selector: /^#head-source-(?:note|chains)$/, absentFrom: "mock" },
  { d: "D16", transform: "T-assembly-background-zero", selector: /^#background-zero$/, absentFrom: "mock" },
  // The transparent wrapper itself (freeze exception #8, XYZ-1186). Its CHILDREN hoist a level
  // so the board actually gets compared; the wrapper element still exists, is still walked, and
  // is answered here like any other named assembly element rather than vanishing from the report.
  { d: "D16", transform: "T-assembly-table-body", selector: /^#token-table-body$/, absentFrom: "mock",
    surface: "compare", lane: "desktop" },
  // Assembly · docs (XYZ-1181, operator 2026-08-10: "the three text-hook spans enter D16's
  // enumeration for docs, entries citing D16"). The mock writes dynamic text through the
  // compiler's bare span.sc-interp instrumentation, which n5 unwraps; the port cannot ship
  // compiler instrumentation, so it ships a real ADDRESSABLE element to write the value into.
  // The asymmetry is therefore a direct consequence of the STRICT n5 predicate — a span is
  // transparent only when its sole attribute is class="sc-interp" — and that strictness stays.
  // It was loosened once in this lane and an id-selector font-weight diff then passed silently.
  { d: "D16", transform: "T-assembly-docs-text-hooks", selector: /^#docs-(?:count|sub)$/, absentFrom: "mock" },
  // Assembly · signin. The login error slot, which the mock does not draw at all — D16's own
  // text names "error and empty states". It ships as <output>, the semantically correct element
  // for a form result, and that tag is load-bearing rather than cosmetic: as a <p> it displaced
  // the mock's two note paragraphs by one (all 7 desktop mismatches and all 6 mobile
  // re-expressed ones came from that single offset), and as a <div> it would have landed on the
  // mock's `div:2` input/button row. `output` is unoccupied on BOTH sides of BOTH lanes, so it
  // displaces nothing and joins nothing.
  { d: "D16", transform: "T-assembly-login-error", selector: /^#login-error$/, absentFrom: "mock",
    surface: "signin" },
  // The third has no hook key of its own. Its path is the docs masthead's single topic button,
  // and it is DESKTOP-ONLY: the mobile document's nav nests differently and its row carries no
  // such element (docs·mobile has 2 missing, not 3). A path is the weakest device in this list,
  // so it is pinned to that one button's one span rather than any span under any nav button.
  // The masthead theme-toggle's label span. Reviewed 2026-08-11: this path is NOT the docs topic
  // button — it is the SHARED theme toggle, present on all five desktop documents. It is the
  // port's addressable hook for the "Dark"/"Light" label, in the same place n5 unwraps the
  // mock's compiler wrapper: identical element, identical cause, identical D16 class as docs'
  // other two text hooks.
  //
  // It was scoped `surface: "docs"` when XYZ-1181 named it under docs, because an unscoped path
  // selector had been silently excusing this divergence on four surfaces with no ruling behind
  // it. **XYZ-1181 EXTENSION GRANTED (operator, 2026-08-11)** — it now applies to every desktop
  // document, and the scoping stays `lane: "desktop"` rather than being dropped entirely: the
  // mobile documents nest their masthead differently and nothing at these coordinates there is
  // covered by this ruling.
  { d: "D16", transform: "T-assembly-theme-toggle-span", absentFrom: "mock", lane: "desktop",
    selector: /^body>div:1>div:1>nav:1>div:2>button:1>span:1$/ },
  // Assembly · compare. The sort buttons are the one enumerated group with no hook key at
  // all, so the only device left is their path — narrowed to a single <button> per header
  // cell of the one header row, which is as tight as a path gets. DECISIONS.md now says SIX and
  // so does the served document (`data-sort` on symbol, oursPrice, cgPrice, dexPrice, diff,
  // oursAge — compare.html's header row): the ruling's "16" was an enumeration error in that
  // document, corrected there 2026-08-10. This entry exempts exactly those six and always did.
  { d: "D16", transform: "T-assembly-sort-buttons", absentFrom: "mock",
    selector: /^body>div:1>main:1>div:1>div:4>div:1>div:1>div:1>span:\d+>button:1$/ },
  { d: "D16", transform: "T-assembly-token-error", selector: /^#token-error$/, absentFrom: "mock" },
  { d: "D16", transform: "T-assembly-overview-empty", selector: /^#overview-empty$/, absentFrom: "mock" },
  { d: "D16", transform: "T-assembly-source-badge", selector: /^#source-badge$/, absentFrom: "mock" },
  // Assembly · dashboard: the port-only <form>, and ONLY it. Its four descendants are the
  // mock's own input and buttons — promote-dashboard.js:226 retags the mock's <div> as the
  // form and keeps the row's contents — so they are absent-from-mock purely because the
  // retag broke their path join. Excusing them would drop mock-derived elements out of the
  // comparison, which is the opposite of what D16 licenses. They stay red.
  { d: "D16", transform: "T-assembly-address-form", selector: /^#address-search$/, absentFrom: "mock" },
  // Assembly · the mobile masthead drawer, 12-13 elements on each of three documents
  // (index-mobile, docs/index-mobile, login-mobile). The one assembly member that takes the
  // CARRIED-REGION shape — root by `selector`, interior by one `within` — and legally so: the
  // mobile mock declares the drawer but its compiler never renders it, so side A draws no drawer
  // at all and nothing mock-derived can sit under this anchor. Verified against the promoted
  // documents: <div id="lca-nav-menu"> at index-mobile.html:162, spliced from one definition in
  // promote-mobile-shared.js:284. Only two of its members carry a hook key (#chain-select, the
  // theme toggle), so naming members individually would leave the other ten on a bare path.
  // #source-badge also lives in this drawer and keeps its own T-assembly-source-badge entry
  // above — listed first, so it is still attributed to the compare group that enumerates it.
  { d: "D16", transform: "T-assembly-nav-drawer", selector: /^#lca-nav-menu$/, absentFrom: "mock" },
  { d: "D16", transform: "T-assembly-nav-drawer", within: /^#lca-nav-menu$/, absentFrom: "mock" },
  // The three assembly GROUPS whose members carry no key of their own — the breaker banner's
  // detail + ack, the chains-hidden line's detail + reset, and the six filter chips with their
  // six count spans. Each anchor is itself a port-only control the mock does not draw at all,
  // which is the precondition `within` requires; nothing mock-derived sits under any of them.
  { d: "D16", transform: "T-assembly-breaker", within: /^#breaker-banner$/, absentFrom: "mock" },
  { d: "D16", transform: "T-assembly-chains-hidden", within: /^#chains-hidden$/, absentFrom: "mock" },
  { d: "D16", transform: "T-assembly-chain-chips", within: /^#chain-filter-chips$/, absentFrom: "mock" },
  // The carried regions' interiors. Each anchor is a region the mock does not render at all,
  // which is the only shape `within` may be used on.
  { d: "D16", transform: "T-address-view", within: /^#address-view$/, absentFrom: "mock" },
  { d: "D16", transform: "T-tests-view", within: /^#tests-view$/, absentFrom: "mock" },
  { d: "D16", transform: "T-arbiter", within: /^#arbiter$/, absentFrom: "mock" },
  // D20 (XYZ-1175, "native <dialog>/<aside> stay"): the port ships the Fix dialog as
  // <dialog id="fix-dialog"> and the token drawer as <aside id="token-sidebar">, where the mock
  // draws both as plain <div>s in the same place. The swap is SEMANTIC, not visual — showModal()
  // gives the top layer, focus trapping, Esc and ::backdrop, and <aside> is the element for a
  // complementary drawer — so it belongs to the same accessibility family as D17 and the skip
  // link. Its gate consequence is structural: the tag change puts each region in its own
  // path-ordinal namespace (mock body>div:1>div:4 and >div:5 against served body>div:1>aside:1
  // and >dialog:1), so neither subtree joins and both sides' elements land in `missing`.
  // Selectors verified against the PROMOTED apps/dashboard/compare.html: <aside
  // id="token-sidebar" hidden> (:272) and <dialog id="fix-dialog"> (:288), both direct children
  // of the console wrapper alongside <main>. `within` is legal on both anchors for the reason it
  // requires: no served element under either root joins a mock element, so each anchors a region
  // the other side does not render at all. Roots first, interiors second, per the ordering rule.
  // ONE DIRECTION ONLY, and that is the ruling's shape rather than an oversight. absentFrom
  // "mock" excuses what the port ADDS; the mock-side elements of these two regions are NOT
  // excused here and never will be, because "served" means an element the port DROPS and the
  // port drops none of this — it renders it as a <dialog>/<aside>. That half is reported by
  // REEXPRESSED below instead, which is a category of its own rather than an entry in this list.
  // Both regions are sampled at all only because OPEN_REGIONS drives them open (XYZ-1150):
  // before that they were closed on both sides and neither was walked on either side.
  { d: "D20", transform: "T-native-dialog", selector: /^#fix-dialog$/, absentFrom: "mock" },
  { d: "D20", transform: "T-native-drawer", selector: /^#token-sidebar$/, absentFrom: "mock" },
  { d: "D20", transform: "T-native-dialog", within: /^#fix-dialog$/, absentFrom: "mock" },
  { d: "D20", transform: "T-native-drawer", within: /^#token-sidebar$/, absentFrom: "mock" },
  // Signin's panel, same family (XYZ-1180, operator 2026-08-10 — "D20-family re-expression",
  // option 1): the port ships <form id="login-form"> where the mock draws a <div>. Submit-on-
  // Enter, native validation and the correct accessibility tree are behaviour the mock's <div>
  // cannot express and does not get to delete by omission. Explicitly NOT folded into D16 —
  // a two-way non-join does not fit that vocabulary's `absentFrom`.
  { d: "D20", transform: "T-native-form", selector: /^#login-form$/, absentFrom: "mock" },
  { d: "D20", transform: "T-native-form", within: /^#login-form$/, absentFrom: "mock" },
];

// Ruled RE-EXPRESSIONS — freeze exception #6, this one change only (operator, 2026-08-10):
// "extend the gate's vocabulary with a `reexpressed` marker (exception #6, this only):
// mock-side entries for the two D20 regions, pinned counts (153 + 57 counterparts), citing
// D20, pointing at the served <dialog>/<aside>, and reported as their own category in the
// matrix — not `exempt`, not `missing`. A reader sees "re-expressed by ruling D20", which is
// neither a defect nor a closed gap — it is exactly what happened. Rows then green when their
// remaining categories are clean. Mechanism is yours; the pinned counts are the tripwire
// (structural drift in those regions breaks the pin and fails the build)."
//
// Why a third category rather than a RULED_ELEMENTS entry: `absentFrom: "served"` states that
// the port DROPS the element, and the port drops none of this — it renders the same region as
// a <dialog>/<aside>. Writing it as an exemption would be a false statement in the gate's own
// vocabulary; leaving 153 elements in `missing` inverts the matrix's meaning, because a red
// must mean an unresolved defect and D20 ruled this divergence legal and permanent.
//
// Each entry is {d, transform, region, surface, lane, mockRegion, servedAs, pin} and is
// validated against DECISIONS.md before any page is rendered.
//   `region`     the OPEN_REGIONS name, so the region's own sampled size is pinnable and a
//                region that stops being driven open (state "absent") breaks the pin.
//   `surface`    + `lane`: the entry applies to THAT ROW ONLY. `mockRegion` is a bare path,
//                and a bare path names a POSITION — `body>div:1>div:4` exists on documents
//                that have nothing to do with this ruling, so an unscoped entry would
//                reclassify whatever else happens to land on those coordinates.
//   `mockRegion` the mock-side region root, matched LITERALLY (equal, or a strict prefix of a
//                descendant path). Not a regex: a literal cannot widen by accident.
//   `servedAs`   the served element this region is re-expressed as — the thing a reader is
//                pointed at, and the anchor the RULED_ELEMENTS entries above exempt.
//   `pin`        the tripwire, and it is not decoration. THREE measured numbers per region:
//                `sampled`      what OPEN_REGIONS counted on the mock side when it drove the
//                               region open (structural drift in the region itself),
//                `elements`     how many of them the walk reclassifies (join drift: a member
//                               that starts joining leaves the category),
//                `counterparts` the served-side elements `exempt` under the same D-number and
//                               transform (drift in the port's own <dialog>/<aside>).
//                A drift in ANY of the three, in EITHER direction, fails the run AND
//                re-expresses nothing in that region — its members go straight back into
//                `missing`. A pattern that quietly matches more elements tomorrow is exactly
//                the hole this exists to prevent, so it may never absorb the drift it finds.
// Measured, not asserted, on the 2026-08-10 desktop compare rows (dark and light are
// identical): drawer 51 sampled / 34 reclassified / 7 counterparts, dialog 102 / 75 / 50.
// `sampled` totals the ruling's 153 and `counterparts` its 57. `elements` is lower than
// `sampled` because OPEN_REGIONS counts the region BEFORE n5 unwraps the mock's
// span.sc-interp wrappers (166 on this document) and the walk sees it after — 44 of the 153
// are compiler wrappers that no longer exist by the time anything is categorized.
const REEXPRESSED = [
  { d: "D20", transform: "T-native-drawer", region: "details drawer", surface: "compare", lane: "desktop",
    mockRegion: "body>div:1>div:4", servedAs: '<aside id="token-sidebar">', servedAsKey: "#token-sidebar",
    pin: { sampled: 51, elements: 34, counterparts: 7 } },
  { d: "D20", transform: "T-native-dialog", region: "fix dialog", surface: "compare", lane: "desktop",
    mockRegion: "body>div:1>div:5", servedAs: '<dialog id="fix-dialog">', servedAsKey: "#fix-dialog",
    pin: { sampled: 102, elements: 75, counterparts: 50 } },
  // Signin (XYZ-1180). No `region`: the panel is always visible, so OPEN_REGIONS never drives
  // it and there is no `sampled` figure — the two real tripwires still apply.
  //
  // The lanes are NOT the same shape, and the ruling's "13+14" is the MOBILE measurement. On
  // desktop the outer panel joins and only the input-and-button wrapper re-expresses (3 ↔ 3);
  // on mobile the whole panel re-expresses (13 ↔ 14, the extra counterpart being the port's own
  // #login-error). Pinning one lane's number on both would have been wrong in a way no test
  // would have caught, so each lane carries its own measurement.
  { d: "D20", transform: "T-native-form", surface: "signin", lane: "desktop",
    mockRegion: "body>div:1>main:1>div:2>div:2", servedAs: '<form id="login-form">', servedAsKey: "#login-form",
    pin: { elements: 3, counterparts: 3 } },
  { d: "D20", transform: "T-native-form", surface: "signin", lane: "mobile",
    mockRegion: "body>div:1>div:1>main:1>div:2", servedAs: '<form id="login-form">', servedAsKey: "#login-form",
    // RE-PINNED 2026-08-11: 14 -> 13. #login-error left this transform's membership when it got
    // its own D16 entry (T-assembly-login-error). The pin CAUGHT that drift and refused to
    // absorb it — re-expressing nothing until the number was re-measured, which is exactly what
    // it exists to do.
    pin: { elements: 13, counterparts: 13 } },
];

// Lane viewports, in CSS pixels, and they are now the width the page is actually laid out
// at — see chromeSample() for why that needed CDP and render() for the assertion that keeps
// it true.
// Freeze exception #7 (XYZ-1176, operator 2026-08-10, verbatim): *"extend exception #5's
// principle to the compare board AND the stats grid: drive data in symmetrically during
// sampling, so the gate measures design, not loading state. No change to when the live page
// unhides — user behavior untouched."*
//
// The problem it settles: the mock is DRAWN with demo data and has no empty state at all, while
// the served page renders zero rows on file:// and keeps `#token-grid`/`#feed-status` hidden
// until a payload arrives. Comparing those two measured STATE, not design — four of compare's
// five mismatches vanished when the two `hidden` attributes were stripped with zero CSS touched.
//
// What this does NOT do: it does not touch the shipped documents, and it does not change when
// the live page unhides. Both `hidden` attributes stay byte-identical to pre-port `main`.
//
// Mechanism, and it manufactures no markup: `apps/dashboard/compare.js` is a CLASSIC script
// (compare.html:443, no `type="module"`, no IIFE), so its own `renderTable()` (:1566),
// `renderDistribution()` (:1688), `renderFeedStatus()` (:1776), `tokenSet()` (:241) and its own
// demo generator `mockTokens()` (:2280) are all reachable from a CDP `Runtime.evaluate` in the
// same realm, as are the top-level `state`/`dom` bindings. Every row the served side draws is
// built by the PORT'S OWN render code from the PORT'S OWN demo data — this file supplies none of it.
//
// SYMMETRY is the whole point, and it is pinned rather than hoped for. The mock draws exactly
// `rows` data rows; the served side is driven with exactly `rows` tokens. If the mock's board
// ever draws a different number, the pin fails the run rather than quietly comparing a 9-row
// board against a 40-row one — which would invent a mismatch storm and call it a finding.
const DRIVEN_DATA = [
  {
    surface: "compare", lane: "desktop", exception: "#7", issue: "XYZ-1176",
    // The mock's board carries no id (the compiled corpus exposes only #lca-cmp-stats,
    // #lca-nav, #lca-nav-right), so its only handle is structural. That is the weakest kind of
    // selector in this file, which is exactly why `rows` is pinned: if the structure moves, the
    // count moves with it and the run fails naming the drift.
    mockGridPath: "div:1>main:1>div:1>div:4>div:1", // walk coordinates, relative to the mounted root
    mockHeaderRows: 1, // the header row joins on both sides already; only DATA rows are driven
    rows: 9,           // MEASURED on the pinned v3 corpus, not chosen
    servedGrid: "#token-grid", servedRows: "#token-table-body",
  },
];

// Freeze exception #8 (XYZ-1186, orchestrator ruling by precedent, 2026-08-11): named,
// D-cited grouping elements whose children hoist ONE path level for joining. See walkChildren().
//
// Why this and not the two obvious alternatives. Flattening `#token-table-body` out of the port
// would edit load-bearing markup (`renderTable`, `collapseDetail`, the detail-row re-attach) on
// the most complex surface in the lane, hours before a deploy — the regression risk this lane
// exists to avoid. Re-expressing the ~600 board elements would have repeated the mistake this
// same night exposed: a category that counts elements without comparing them is a hollow green.
// Hoisting instead makes the elements JOIN, so their 31 properties are genuinely compared.
//
// Scoped to one surface+lane and matched by ID, never by path: a path names a POSITION and would
// silently make some other document's element transparent.
const TRANSPARENT_WRAPPERS = [
  {
    d: "D16", transform: "T-assembly-table-body", key: "#token-table-body",
    surface: "compare", lane: "desktop", side: "served",
    why: "the <tbody>-equivalent grouping element renderTable() appends rows into; D16's own text " +
         "covers the section wrappers the app's own behaviour needs. The mock draws its 9 board rows " +
         "as direct children of the grid, so without hoisting ~600 board elements join nothing.",
  },
];

const LANES = { desktop: "1440,900", mobile: "390,844" };
const THEMES = ["dark", "light"];

// The theme control, in the two spellings this corpus has: D9's `data-lc-theme-toggle`
// rename on the ported side, and the mock's pre-rename aria-labelled button
// (Desktop.dc.html:270). Driving THIS is the only way the app's own theme state moves.
const TOGGLE = '[data-lc-theme-toggle],button[aria-label="Toggle color theme"]';

// Regions BOTH sides ship CLOSED, which the gate was therefore measuring on NEITHER side
// (XYZ-1150). The mock compiles them away behind a false default — desktop/template.html:904
// `<sc-if value="{{ fixOpen }}" hint-placeholder-val="{{ false }}">` for the dialog, :873 for
// the details drawer — while the port ships the same two regions present-but-closed
// (compare.html:288 `<dialog id="fix-dialog">`, :272 `<aside id="token-sidebar" hidden>`).
// That is a coverage hole, not a diff: 57 served elements and 153 mock ones that no row ever
// looked at, which is the exact shape a vacuous pass is made of.
//   `opener`  the app's OWN control, the way driveTheme() drives theme through the page's own
//             button rather than writing state itself. `openerText` narrows it where the
//             control carries no aria-label (the mock's Fix button is text-only).
//   `region`  ONE selector list covering both spellings, because it names the same region on
//             either side and each side matches only its own.
// Driving is symmetric in STATE, not in mechanism, and it cannot be: side A has live rows and
// therefore a control to click; side B renders no rows on file://, so it ships no opener at
// all and its shell is opened the way its own code opens it (compare.js:936 showModal(),
// :1515 `hidden = false`). Opening is ASSERTED on each side — a region that will not render,
// or an opener that clicks and produces nothing, aborts the run. Without that assertion this
// becomes another comparison of two empty states that prints numbers.
const OPEN_REGIONS = [
  { name: "details drawer", opener: 'button[aria-label="More details"]',
    region: '[data-screen-label="More details"],#token-sidebar' },
  { name: "fix dialog", opener: "button", openerText: "Fix",
    region: '[data-screen-label="Fix price"],#fix-dialog' },
];

// Coverage floors (V6). A wrong --mock-root/--served-root, or a side that shrank to a
// stub, yields a small-but-clean comparison that would otherwise print PASS. Every
// surface in this corpus renders 200+ elements and a page compared against itself joins
// 100% of them, so these floors sit an order of magnitude below anything legitimate:
// only a broken invocation or a collapsed render can trip them.
const MIN_ELEMENTS = 20, JOIN_RATIO = 0.9, SIDE_RATIO = 0.75;

// Both waiver lists take the SAME four checks — a resolving D-number, a transform name and
// a narrowing selector — from one body of code, so the element list cannot drift into a
// weaker discipline than the property list.
function validateWaivers() {
  const decisions = readFileSync(join(root, "docs/goals/editorial-v2-port/DECISIONS.md"), "utf8");
  const cite = (list, t, i) => {
    if (!/^D\d+$/.test(t.d || "")) fail(`${list}[${i}] has no D-number — a waiver without a ruling may not exist`);
    if (!decisions.includes(`**${t.d} ·`)) fail(`${list}[${i}] cites ${t.d}, which does not resolve in DECISIONS.md`);
    if (!t.transform) fail(`${list}[${i}] (${t.d}) has no transform name`);
    // Exactly one narrowing device — `selector` names the element, `within` names the
    // hook-keyed ancestor it must sit strictly under. Neither is a hole; both at once is
    // ambiguous, and the artifact records only the one that fired.
    if ((t.selector instanceof RegExp ? 1 : 0) + (t.within instanceof RegExp ? 1 : 0) !== 1)
      fail(`${list}[${i}] (${t.d}) needs exactly one of selector/within as a RegExp — a waiver must name what it ` +
        `waives, not every element`);
  };
  RULED_TRANSFORMS.forEach((t, i) => {
    cite("RULED_TRANSFORMS", t, i);
    if (!(t.selector instanceof RegExp))
      fail(`RULED_TRANSFORMS[${i}] (${t.d}) must use selector — a property waiver names the element whose value it ` +
        `waives, and ruledBy() has no ancestor to anchor a within to`);
    if (!PROPERTIES.includes(t.property)) fail(`RULED_TRANSFORMS[${i}] (${t.d}) names property ${t.property}, which is not compared`);
    if (!(t.mock instanceof RegExp) || !(t.served instanceof RegExp))
      fail(`RULED_TRANSFORMS[${i}] (${t.d}) needs mock+served RegExp bounds — an unbounded waiver is a hole`);
  });
  RULED_ELEMENTS.forEach((t, i) => {
    cite("RULED_ELEMENTS", t, i);
    if (t.absentFrom !== "mock" && t.absentFrom !== "served")
      fail(`RULED_ELEMENTS[${i}] (${t.d}) must declare absentFrom: "mock" or "served" — an exemption for an added ` +
        `element may not also excuse a dropped one`);
  });
  // Same resolving-ruling discipline, plus the three the pin needs. A re-expression reclassifies
  // elements out of `missing`, so an entry that cannot be scoped or cannot be counted is a hole.
  TRANSPARENT_WRAPPERS.forEach((t, i) => {
    if (!/^D\d+$/.test(t.d || "")) fail(`TRANSPARENT_WRAPPERS[${i}] has no D-number — a wrapper cannot be made transparent without a ruling`);
    if (!decisions.includes(`**${t.d} \u00b7`)) fail(`TRANSPARENT_WRAPPERS[${i}] cites ${t.d}, which does not resolve in DECISIONS.md`);
    if (!t.key || !t.key.startsWith("#"))
      fail(`TRANSPARENT_WRAPPERS[${i}] (${t.d}) must name an ID key — a path names a POSITION and would make some ` +
        `other document's element at those coordinates transparent too`);
    if (!t.surface || !LANES[t.lane] || (t.side !== "mock" && t.side !== "served"))
      fail(`TRANSPARENT_WRAPPERS[${i}] (${t.d}) needs surface, lane and side — hoisting is a per-document claim`);
    if (!RULED_ELEMENTS.some((r) => r.selector && r.selector.test(t.key)))
      fail(`TRANSPARENT_WRAPPERS[${i}] (${t.d}) makes ${t.key} transparent but no RULED_ELEMENTS entry answers the ` +
        `wrapper itself — it would be hoisted out of the numbering AND left as an unexplained missing element`);
  });
  REEXPRESSED.forEach((t, i) => {
    if (!/^D\d+$/.test(t.d || "")) fail(`REEXPRESSED[${i}] has no D-number — a re-expression without a ruling may not exist`);
    if (!decisions.includes(`**${t.d} ·`)) fail(`REEXPRESSED[${i}] cites ${t.d}, which does not resolve in DECISIONS.md`);
    if (!t.transform || !t.servedAs)
      fail(`REEXPRESSED[${i}] (${t.d}) needs a transform name and the servedAs element it is re-expressed as — a ` +
        `reader must be pointed at what the port renders instead`);
    // `region` is OPTIONAL, and only because some re-expressed regions are not closed-by-default.
    // The signin panel is always visible, so OPEN_REGIONS never drives it and there is no
    // `sampled` figure to pin — pinning a number nothing measures would be theatre. When a
    // region IS named it must be one OPEN_REGIONS actually drives, or its `sampled` pin is
    // measuring nothing. The two REAL tripwires (`elements`, `counterparts`) are required either way.
    if (t.region && !OPEN_REGIONS.some((r) => r.name === t.region))
      fail(`REEXPRESSED[${i}] (${t.d}) names region ${JSON.stringify(t.region)}, which OPEN_REGIONS does not drive — ` +
        `its sampled size could not be pinned`);
    if (!t.surface || !LANES[t.lane] || typeof t.mockRegion !== "string" || !t.mockRegion.startsWith("body>"))
      fail(`REEXPRESSED[${i}] (${t.d}) needs surface, lane and a mockRegion path rooted at body — a bare path names a ` +
        `POSITION, so an unscoped entry would reclassify whatever else lands on those coordinates`);
    for (const k of t.region ? ["sampled", "elements", "counterparts"] : ["elements", "counterparts"])
      if (!Number.isInteger(t.pin?.[k]) || t.pin[k] < 1)
        fail(`REEXPRESSED[${i}] (${t.d}) needs a positive integer pin.${k} — an unpinned re-expression widens itself`);
    if (!t.region && t.pin?.sampled !== undefined)
      fail(`REEXPRESSED[${i}] (${t.d}) pins sampled=${t.pin.sampled} but names no OPEN_REGIONS region — nothing ` +
        `measures that number, so the pin would read "held" forever and hide every drift it claims to catch`);
    // Pairwise NON-OVERLAP, and it is not theoretical: this tool has already shipped one
    // over-broad match (the loosened sc-interp predicate, which let a real id-selector diff
    // pass silently). The two live entries are sibling roots and disjoint, but nothing stopped
    // a future entry rooted at, say, `body>div:1` from swallowing both regions AND everything
    // else beneath that ancestor — reclassifying elements no ruling ever named, with the pins
    // still reading "held". A region that contains another is not a scope, it is a hole.
    REEXPRESSED.forEach((u, j) => {
      if (j <= i || u.surface !== t.surface || u.lane !== t.lane) return;
      const [a, b] = [t.mockRegion, u.mockRegion];
      if (a === b || a.startsWith(b + ">") || b.startsWith(a + ">"))
        fail(`REEXPRESSED[${i}] (${t.d}, ${a}) and REEXPRESSED[${j}] (${u.d}, ${b}) overlap on ${t.surface}/${t.lane} — ` +
          `one region contains the other, so their pinned memberships double-count and neither pin can detect drift`);
    });
  });
}

const ruledBy = (m) =>
  RULED_TRANSFORMS.find(
    (t) =>
      t.property === m.property &&
      t.selector.test(m.selector) &&
      t.mock.test(m.mock) &&
      t.served.test(m.served)
  );

// `absentFrom` is matched, never defaulted: an exemption written for an element the port
// ADDS must not silently excuse the same selector going MISSING from the served side.
// A `within` entry resolves its anchor at run time, out of the walk of the side the element is
// PRESENT on, and only against elements that carry a real hook key — so the excuse is tied to
// a live named ancestor rather than to a path this file hardcoded, and an anchor that no
// longer exists excuses nothing at all. Returns the D-number, the transform, and (for a
// `within` hit) the anchor key that carried it, so the artifact can name all three.
const exemptWith = (mock, served) => {
  const present = { mock: served, served: mock }; // absentFrom → the side it is present on
  return (m) => {
    for (const t of RULED_ELEMENTS) {
      if (t.absentFrom !== m.absentFrom) continue;
      // Optional surface/lane scoping. A bare PATH selector names a POSITION, and the same
      // coordinates exist on documents a ruling never mentioned — the docs nav-span entry was
      // written with a comment claiming "docs, desktop-only" and in fact fired on admin,
      // dashboard, compare and signin too, excusing a real structural divergence on four
      // surfaces with no ruling behind it. An entry that names a surface now applies to that
      // surface alone.
      if (t.surface && t.surface !== args.surface) continue;
      if (t.lane && t.lane !== args.lane) continue;
      if (t.selector) {
        if (t.selector.test(m.selector)) return { d: t.d, transform: t.transform };
        continue;
      }
      const a = present[m.absentFrom].elements.find(
        (r) => r.key && t.within.test(r.key) && m.path.startsWith(r.path + ">")
      );
      if (a) return { d: t.d, transform: t.transform, within: a.key };
    }
    return null;
  };
};

// The third category (exception #6). Runs AFTER compare(), over its output, so nothing about
// the join, the diff or the exemption logic moves: it only decides which of the elements that
// came back `missing` are in fact RE-EXPRESSED, and it checks the pins that license the move.
// A region whose pin drifted re-expresses NOTHING — its members stay exactly where compare()
// put them, in `missing`, and the drift is reported as a failure that fails the verdict.
function reexpress(missing, exempt, mockRegions, surface, lane, mockEls = [], servedEls = []) {
  const active = REEXPRESSED.filter((t) => t.surface === surface && t.lane === lane);
  const members = new Map(active.map((t) => [t, []]));
  for (const m of missing) {
    if (m.absentFrom !== "served") continue; // mock-side only: this is the half no exemption may name
    const t = active.find((x) => m.path === x.mockRegion || m.path.startsWith(x.mockRegion + ">"));
    if (t) members.get(t).push(m);
  }
  const regions = [], elements = [], pinFailures = [], moved = new Set();
  const reexpressedMismatches = [], unpaired = [];
  for (const t of active) {
    const found = {
      elements: members.get(t).length,
      counterparts: exempt.filter((e) => e.kind === "element" && e.d === t.d && e.transform === t.transform).length,
    };
    // Only a driven region has a `sampled` figure; an always-visible one (the signin panel) has
    // none, and inventing a zero would make the pin unfalsifiable.
    if (t.region) found.sampled = mockRegions.find((r) => r.region === t.region)?.elements ?? 0;
    const drift = Object.keys(found).filter((k) => found[k] !== t.pin[k]);
    regions.push({ d: t.d, transform: t.transform, region: t.region, mockRegion: t.mockRegion, servedAs: t.servedAs,
                   pinned: t.pin, found, pinHeld: drift.length === 0 });
    if (drift.length) {
      pinFailures.push(`the ${t.region} (${t.d} · ${t.transform}, mock ${t.mockRegion} → served ${t.servedAs}) ` +
        `drifted: ${drift.map((k) => `${k} pinned ${t.pin[k]}, measured ${found[k]}`).join("; ")} — the pinned ` +
        `membership is the tripwire, so this region re-expresses nothing on this run and its elements stay missing`);
      continue;
    }
    // STYLE-COMPARE the pair, do not merely count it. Reviewed 2026-08-11: without this, a
    // re-expressed element never enters `joined`, so not one property of it is ever compared —
    // signin·mobile reported "0 mismatches" while the panel's h1, both paragraphs, the API-key
    // input and the submit button went unmeasured, and the SAME content on desktop (where it
    // stayed joined) surfaced real font/colour/margin diffs. A category that only counts
    // elements would have turned a blind spot into a green row.
    //
    // The pairing is positional and derived, not declared: a member's path relative to the
    // mock region root is looked up under the served counterpart root. D20 ruled the two
    // regions equivalent — that is a claim about STRUCTURE, and it is exactly what makes the
    // relative paths line up. Anything that does not line up is left unpaired and named.
    const servedRoot = servedEls.find((e) => e.key && t.servedAsKey && e.key === t.servedAsKey);
    for (const m of members.get(t)) {
      if (servedRoot) {
        const mockRec = mockEls.find((e) => e.path === m.path);
        const rel = m.path === t.mockRegion ? "" : m.path.slice(t.mockRegion.length);
        const counterpart = servedEls.find((e) => e.path === servedRoot.path + rel);
        if (counterpart) {
          for (const property of PROPERTIES)
            if (mockRec?.styles?.[property] !== counterpart.styles?.[property])
              reexpressedMismatches.push({ selector: m.selector, property, mock: mockRec?.styles?.[property],
                served: counterpart.styles?.[property], join: "reexpressed", path: m.path,
                d: t.d, transform: t.transform });
        } else unpaired.push({ selector: m.selector, path: m.path, d: t.d, transform: t.transform,
          why: `no element at ${servedRoot.path + rel} under ${t.servedAs} — the two regions do not ` +
               `correspond positionally here, so this element's design is NOT verified` });
      }
      moved.add(m);
      // No `absentFrom`: the record must not repeat the very claim this category exists to
      // refuse. The element is PRESENT on the mock and re-expressed on the served side.
      elements.push({ kind: "element", selector: m.selector, path: m.path, tag: m.tag, presentOn: "mock",
                      d: t.d, transform: t.transform, region: t.region, reexpressedAs: t.servedAs });
    }
  }
  return { missing: missing.filter((m) => !moved.has(m)),
           reexpressed: { regions, pinFailures, elements, mismatches: reexpressedMismatches, unpaired } };
}

// The F3 hook inventory is GENERATED by the existing tool, never reimplemented here.
function hookSelectors(files) {
  if (!files.length) return [];
  let out;
  try {
    out = execFileSync(process.execPath, [join(root, "tools/hook-inventory.js"), ...files], { encoding: "utf8" });
  } catch (e) {
    fail(`hook-inventory failed (its selector list would be incomplete): ${e.stderr || e.message}`);
  }
  const { inventory } = JSON.parse(out);
  const sels = new Set();
  for (const hooks of Object.values(inventory)) {
    for (const { kind, hook } of hooks) {
      if (kind === "getElementById") sels.add("#" + CSS_escapeId(hook));
      else if (kind === "dataset") sels.add(`[data-${hook.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase())}]`);
      else if (kind === "getAttribute-data") sels.add(`[${hook}]`);
      else sels.add(hook);
    }
  }
  return [...sels];
}
const CSS_escapeId = (id) => id.replace(/([^\w-])/g, "\\$1");

// ---- the injected sampler (runs in the page) --------------------------------------

// Offline (PLAN §Phase 2c). Side A mounts the real dc-runtime, and support.js pulls
// React/ReactDOM/Babel from unpkg (support.js:1143-1148). support.js's OWN redirect
// hook — window.__resources[url] → local URL, cdnScriptFor() at :1149-1153 — is set in
// the prelude, pointing at the vendored copies tools/compile-dc.js downloaded and
// byte-verified against the SRI pins. No tracked file is rewritten, and Chrome runs
// with egress denied (flags in render()), so a silently-online gate cannot pass.
const VENDOR = [
  ["https://unpkg.com/react@18.3.1/umd/react.production.min.js", "react-18.3.1.umd.production.min.js"],
  ["https://unpkg.com/react-dom@18.3.1/umd/react-dom.production.min.js", "react-dom-18.3.1.umd.production.min.js"],
  ["https://unpkg.com/@babel/standalone@7.29.0/babel.min.js", "babel-standalone-7.29.0.min.js"],
];

function vendorResources() {
  const map = {};
  for (const [url, file] of VENDOR) {
    const p = join(root, "tools/vendor", file);
    if (!existsSync(p)) fail(`tools/vendor/${file} missing — run tools/compile-dc.js once to vendor the pinned runtimes`);
    map[url] = pathToFileURL(p).href;
  }
  return map;
}

const prelude = (resources) =>
  `<script>window.__resources = ${JSON.stringify(resources)}; window.setInterval = function () { return 0; }; window.__styleParity = true;</script>`;

// `<` is escaped to \\u003c throughout the seed payload: the values come from page text that
// legitimately contains markup and code samples, and a literal "</script>" inside the JSON
// literal would close the injected block.
const jsonForScript = (v) => JSON.stringify(v === undefined ? null : v).replace(/</g, "\\u003c");

const sampler = ({ theme, rootSel, hooks, emitSeed, seed, side, data, transparent }) => `
<style>*,*::before,*::after{animation:none!important;transition:none!important}</style>
<script>
(function () {
  var T = ${JSON.stringify(theme)}, ROOT_SEL = ${JSON.stringify(rootSel)};
  var PROPS = ${JSON.stringify(PROPERTIES)}, HOOKS = ${JSON.stringify(hooks)};
  var TOGGLE = ${JSON.stringify(TOGGLE)}, MIN_ELEMENTS = ${MIN_ELEMENTS};
  var REGIONS = ${JSON.stringify(OPEN_REGIONS)};
  var SIDE = ${JSON.stringify(side)}, DATA = ${data ? jsonForScript(data) : "null"};
  var TRANSPARENT = ${JSON.stringify(transparent || [])};
  // EMIT_SEED: this side is the seed SOURCE (side A). SEED: this side is the seed TARGET
  // (side B). Never both, and both null when --seed off.
  var EMIT_SEED = ${emitSeed ? "true" : "false"}, SEED = ${seed ? jsonForScript(seed) : "null"};
  var SKIP = { SCRIPT: 1, STYLE: 1, LINK: 1, META: 1, TITLE: 1, HEAD: 1, NOSCRIPT: 1, TEMPLATE: 1, BASE: 1 };

  function emit(o) {
    var bytes = new TextEncoder().encode(JSON.stringify(o)), bin = "";
    for (var i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    var s = document.createElement("script");
    s.id = "sp-result";
    s.type = "application/json";
    s.textContent = btoa(bin);
    document.documentElement.appendChild(s);
  }
  // Settle instead of requestAnimationFrame: once virtual time goes idle Chrome stops
  // producing frames and an rAF chain starves forever. Timers keep firing, so poll the
  // element count until it holds still, then read — getComputedStyle forces its own
  // style+layout flush, so no frame is needed to observe a theme change.
  function settle(done) {
    var last = -1, stable = 0, n = 0;
    (function tick() {
      var count = document.getElementsByTagName("*").length;
      stable = count === last ? stable + 1 : 0;
      last = count;
      n++;
      if ((n >= 5 && stable >= 3) || n > 40) return done();
      setTimeout(tick, 100);
    })();
  }
  // Theme drive (V2). setAttribute alone is NOT how this application changes theme:
  // applyTheme() (Desktop.dc.html:1152) is a one-way React→DOM push, so an attribute we
  // write ourselves sticks while state.theme — and everything renderVals() derives from
  // it (:1167; the accent video source at :1197) — stays frozen at the schema default
  // for BOTH runs. Click the control instead: the mock's is an onClick→setState (:1343),
  // the ported side's a 3-state system/light/dark cycle
  // (apps/dashboard/index.html:263-277), so click until the requested theme is reached,
  // up to one full cycle. A page with no control at all gets the attribute — and the
  // derived-value assertions below prove that was sufficient there.
  function themeNow() {
    return document.documentElement.getAttribute("data-theme") || document.body.getAttribute("data-lc-theme") || null;
  }
  // The control can sit inside a collapsed disclosure: on the mobile lane the theme
  // toggle lives in the hamburger menu (Mobile.dc.html:291-306) and is absent from the
  // DOM until the menu opens. Open collapsed disclosures the way a user does — standard
  // aria-expanded, no invented hook — and close them again before the walk so the state
  // that gets COMPARED is still the page's default one.
  function revealControl(done) {
    if (document.querySelector(TOGGLE)) return done([]);
    var d = document.querySelector('[aria-expanded="false"]');
    if (!d) return done([]);
    d.click();
    setTimeout(function () { done([d]); }, 80); // the re-render is not synchronous
  }
  function restoreDisclosures(opened, done) {
    if (!opened.length) return done(null);
    // Re-query: the re-render may have replaced the node we clicked.
    (document.querySelector('[aria-expanded="true"]') || opened[0]).click();
    setTimeout(function () {
      done(document.querySelector(TOGGLE)
        ? "the disclosure opened to reach the theme control did not close again — the sampled state would not be this page's default"
        : null);
    }, 80);
  }
  function driveTheme(t, control, done) {
    var tries = 0;
    (function step() {
      if (themeNow() === t) return setTimeout(function () { done(null); }, 60);
      if (control) {
        if (tries++ >= 4)
          return done("the theme control (" + TOGGLE + ") did not reach theme " + t +
            " in one full cycle (stuck at " + themeNow() + ") — the theme is not drivable on this page");
        control.click();
        return setTimeout(step, 80);
      }
      document.documentElement.setAttribute("data-theme", t);
      document.body.setAttribute("data-lc-theme", t);
      setTimeout(function () { done(null); }, 60);
    })();
  }
  // ---- closed-by-default regions (OPEN_REGIONS) --------------------------------------
  // Same discipline as driveTheme: use the page's own control where there is one, and where
  // there is not, use the page's own open mechanism. Never manufacture markup.
  function openerFor(r) {
    var c = document.querySelectorAll(r.opener);
    for (var i = 0; i < c.length; i++)
      if (!r.openerText || (c[i].textContent || "").replace(/\\s+/g, " ").trim() === r.openerText) return c[i];
    return null;
  }
  function reveal(el) {
    if (el.tagName === "DIALOG") { if (!el.open) el.showModal(); } // compare.js:936
    else if (el.hidden) el.hidden = false;                        // compare.js:1515
  }
  // ---- freeze exception #7: symmetric data (XYZ-1176) ---------------------------------
  // Mock side MEASURES and verifies its pin; served side DRIVES the same number of rows
  // through the page's own render path. Neither side manufactures markup.
  function driveData(done) {
    if (!DATA) return done(null);
    if (SIDE === "mock") {
      // Resolved with the WALK's own path vocabulary, relative to the mounted root — the same
      // "tag:n" coordinates the artifact prints. A CSS selector was tried first and was wrong:
      // the mock's markup sits under the dc-runtime mount, not under document.body directly,
      // so a document-rooted selector addressed nothing and the pin correctly refused to run.
      var g = mountedRoot(), segs = DATA.mockGridPath.split(">");
      for (var si = 0; si < segs.length && g; si++) {
        var bits = segs[si].split(":"), want = bits[0].toUpperCase(), nth = +bits[1], seen = 0, next = null;
        for (var ci = 0; ci < g.children.length; ci++)
          if (g.children[ci].tagName === want && ++seen === nth) { next = g.children[ci]; break; }
        g = next;
      }
      if (!g) return done("exception #7: the mock's board (" + DATA.mockGridPath + ", relative to the mounted " +
        "root) was not found — the path this pin hangs on has moved, and nothing else identifies that region");
      var n = g.children.length - DATA.mockHeaderRows;
      if (n !== DATA.rows) return done("exception #7: the mock's board draws " + n + " data row(s) but the " +
        "pin says " + DATA.rows + " — the served side would be driven to a DIFFERENT row count than the mock " +
        "draws, which invents mismatches instead of measuring design. Re-measure and re-pin together");
      return done({ side: "mock", rows: n, drivenBy: "none — the mock ships its own demo data" });
    }
    // Served. Every name below belongs to compare.js, not to this file.
    if (typeof mockTokens !== "function" || typeof tokenSet !== "function" ||
        typeof renderTable !== "function" || typeof renderDistribution !== "function")
      return done("exception #7: the page's own render path is not reachable (mockTokens/tokenSet/" +
        "renderTable/renderDistribution) — driving data would mean manufacturing markup, which this " +
        "gate does not do");
    var payload = mockTokens();
    payload.tokens = payload.tokens.slice(0, DATA.rows);
    // tokenSet() returns { total, tokens } (compare.js:241-247) — the page's own normalization,
    // not a bare array. Both fields are assigned from it so the count the board prints is the
    // page's own arithmetic rather than this file's.
    var set = tokenSet(payload);
    state.tokens = set.tokens;
    state.total = set.total;
    renderTable();
    renderDistribution();
    if (typeof renderFeedStatus === "function") renderFeedStatus(payload);
    var grid = document.querySelector(DATA.servedGrid), body = document.querySelector(DATA.servedRows);
    if (!grid || !body) return done("exception #7: served grid/rows (" + DATA.servedGrid + " / " +
      DATA.servedRows + ") not found after driving data");
    // The drive must be CHECKED, not assumed: a render that silently no-ops would leave the row
    // red for the very reason this exception exists to remove, and would look like a design defect.
    // Rows land in #token-table-body, NOT in #token-grid — the grid also holds the header row,
    // so counting its children reported 1 when nine had rendered. Counted where they actually go.
    var drawn = body.children.length;
    if (drawn !== DATA.rows) return done("exception #7: drove " + DATA.rows + " token(s) through the page's " +
      "own renderTable() but the served board drew " + drawn + " data row(s) — the two sides would be " +
      "compared at different row counts");
    if (grid.hidden) return done("exception #7: the served board is still hidden after its own render ran");
    return done({ side: "served", rows: drawn, drivenBy: "the page's own renderTable/renderDistribution" +
      "/renderFeedStatus, fed from its own mockTokens()" });
  }
  function openRegions(done) {
    var out = [], i = 0;
    (function step() {
      if (i >= REGIONS.length) return done(out);
      var r = REGIONS[i++], opener = openerFor(r);
      if (opener) opener.click();
      setTimeout(function () { // the mock's re-render is not synchronous
        var el = document.querySelector(r.region);
        if (!el) {
          // A region that has an opener but never appears cannot be driven, and would be
          // compared open on one side and absent on the other.
          if (opener) return done("clicked this page's own opener for the " + r.name + " (" + r.opener +
            ") and the region (" + r.region + ") never appeared — it is not drivable on this page");
          out.push({ region: r.name, state: "absent" });
          return step();
        }
        reveal(el);
        setTimeout(function () {
          if (!el.getClientRects().length)
            return done("the " + r.name + " (" + r.region + ") is in this document but did not render once " +
              "opened — sampling it would certify nothing");
          out.push({ region: r.name, state: "open", drivenBy: opener ? "opener" : "own open mechanism",
                     selector: el.id ? "#" + el.id : r.region, elements: el.getElementsByTagName("*").length + 1 });
          step();
        }, 80);
      }, 120);
    })();
  }

  // Theme probe: the resolved palette, never a hardcoded colour. dark and light MUST
  // resolve differently or the attribute is not driving this page's styles.
  function probe() {
    var cs = getComputedStyle(document.body);
    return cs.getPropertyValue("--lc-bg").trim() + "|" + cs.backgroundColor + "|" + cs.color;
  }
  // Theme-DERIVED render values — the half the palette probe cannot see. The accent
  // video's source and opacity are computed in JS from the theme (Desktop.dc.html:1197;
  // the ported side's boot script re-derives them from data-theme), so they move only if
  // the app's own theme state moved. Sources are basenamed so the T2 asset-path
  // transform stays invisible (same rule as n1).
  function derived() {
    var out = [], m = document.querySelectorAll("video,source,img,[data-lc-accent]");
    for (var i = 0; i < m.length; i++)
      out.push(String(m[i].getAttribute("src") || "").replace(/^.*\\//, "") + "@" + (m[i].style.opacity || ""));
    return out.sort().join(" ");
  }
  function norm(v) {
    return String(v).trim().replace(/url\\((["']?)([^"')]*)\\1\\)/g, function (_, q, u) {
      return "url(" + u.replace(/^.*\\//, "") + ")";
    });
  }
  function styles(el) {
    var cs = getComputedStyle(el), o = {};
    for (var i = 0; i < PROPS.length; i++) o[PROPS[i]] = norm(cs.getPropertyValue(PROPS[i]));
    return o;
  }
  // V5: validate every hook selector ONCE, before any element is tested. hook-inventory.js
  // extracts selectors by regex, not AST, so a truncated or dynamically-built one throws
  // on every element — silently disabling that hook page-wide and demoting its elements
  // to the weaker path join. Silence is the one unacceptable outcome, so this refuses to
  // run and names the offenders; keyOf() below then needs no try/catch.
  function checkHooks() {
    var bad = [];
    for (var h = 0; h < HOOKS.length; h++) {
      try { document.documentElement.matches(HOOKS[h]); }
      catch (e) { bad.push(JSON.stringify(HOOKS[h]) + " (" + ((e && e.message) || e) + ")"); }
    }
    if (bad.length)
      throw new Error("invalid selector(s) in the F3 hook inventory: " + bad.join("; ") +
        " — every listed hook must be a legal selector or the join silently weakens");
  }
  function keyOf(el) {
    if (el.id) return "#" + el.id;
    var d = [];
    for (var i = 0; i < el.attributes.length; i++) {
      var a = el.attributes[i];
      if (a.name.indexOf("data-lc-") === 0) d.push(a.value === "" ? "[" + a.name + "]" : "[" + a.name + '="' + a.value + '"]');
    }
    if (d.length) return d.sort().join("");
    for (var j = 0; j < HOOKS.length; j++) if (el.matches(HOOKS[j])) return "hook:" + HOOKS[j];
    return null;
  }
  // V3: the path join infers identity from same-tag ordinal position alone, so one
  // insertion/deletion/reorder re-pairs semantically unrelated siblings — and on a page
  // dominated by generic wrappers their sampled values can coincide, so a real structural
  // regression reports 0 mismatches. Carry a fingerprint the join can refuse on: the
  // element's direct child tags (in order) and its OWN text. Depth-1 on purpose — a
  // deep-subtree hash would make one changed leaf report on every ancestor, whereas this
  // reports exactly the parent whose children changed and the siblings that shifted.
  function fingerprint(el) {
    var kids = [], t = "";
    for (var c = el.firstElementChild; c; c = c.nextElementSibling) if (!SKIP[c.tagName]) kids.push(c.tagName);
    for (var n = el.firstChild; n; n = n.nextSibling) if (n.nodeType === 3) t += n.nodeValue;
    // all: the element's FULL subtree text. It is not part of the join fingerprint and is
    // used for ONE purpose: deciding whether a divergence caused solely by ruled children
    // merely RE-HOMED text or actually changed it. n5 unwraps the mock's interp wrappers, which
    // merges their text up into the parent, while the port keeps the same text inside its own
    // addressable span — same words, different owner. Comparing own-text alone calls that a
    // divergence; comparing full subtree text tells them apart.
    var allText = (el.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 400);
    return { kids: kids.join(","), own: t.replace(/\\s+/g, " ").trim().slice(0, 120), all: allText };
  }

  // n5. The mock's template compiler wraps every interpolated text run in an extra
  // <span class="sc-interp"> (support.js:607) — compile-dc bookkeeping, not design. The
  // docs mock carries 400 of them and the served page none, because docs-app.js renders the
  // same text with the same styled spans and no wrapper, deliberately, citing D2 ("a class
  // here would be a cascade the port does not own"). Unwrapping is applied to BOTH sides —
  // a no-op wherever none exist — and BEFORE the walk, so the two sides' DOM paths line up
  // instead of trading an element-count gap for a worse path-join gap.
  //
  // Unwrappability is STRICT: a span is transparent only when it carries exactly one
  // attribute and that attribute is class="sc-interp". Any second attribute — id,
  // data-lc-*, data-label, style, an extra class — blocks the unwrap and the span is
  // counted as "kept".
  //   · The CLASS SET matters because the same compiler also emits "sc-interp sc-missing"
  //     and "sc-interp sc-unresolved", and support.js:92-112 gives BOTH of those real CSS
  //     (inline-block sizing, a monospace shrink, a ::before animation) — "sc-interp
  //     carries no CSS" is true of the bare span and false of its siblings.
  //   · ANY OTHER ATTRIBUTE matters because it can carry a selector. An id-hooked span can
  //     be styled by an id selector, and interpRules() cannot see that: it only scans rules
  //     that MENTION sc-interp, and an id-selector rule such as #docs-count declaring
  //     font-weight 700 mentions no such thing. Unwrapping removes the element from the
  //     comparison outright, so a hook that looks like mere addressing still hides a real
  //     style difference.
  // This rule was briefly widened to ignore hook attributes, on the argument that a D2 hook
  // is addressing rather than style and the two sides were therefore structurally
  // identical. That argument was wrong, and an adversarial Chrome run proved it: an
  // id-hooked span with an id-selector font-weight difference (400 vs 700) FAILED under the
  // strict rule and passed SILENTLY under the widened one. Missing-element detection kept
  // working, which is what made the hole hard to see. Restored; do not widen it again.
  // Spans that fail the test are left in place, compared normally, and counted as "kept" —
  // an asymmetric "kept" count between the two sides is a reportable fact, not a defect to
  // normalize away.
  //
  // And styleless is VERIFIED, never assumed: every rule in the live stylesheets that even
  // mentions sc-interp is tested against each candidate span, and one match aborts the run
  // naming the rule. A stylesheet we cannot read aborts it too — an unprovable claim is not
  // a proof, and silently unwrapping a styled span would delete design from the comparison.
  function interpRules() {
    var out = [];
    function scan(list) {
      for (var i = 0; i < list.length; i++) {
        var r = list[i];
        // Pseudo-ELEMENTS never match an element; strip them so matches() judges the subject.
        if (r.selectorText && r.selectorText.indexOf("sc-interp") >= 0)
          out.push(r.selectorText.replace(/::[\\w-]+(\\([^)]*\\))?/g, ""));
        if (r.cssRules) scan(r.cssRules);
      }
    }
    for (var s = 0; s < document.styleSheets.length; s++) {
      var rules;
      try { rules = document.styleSheets[s].cssRules; }
      catch (e) {
        throw new Error("stylesheet " + (document.styleSheets[s].href || "(inline)") +
          " is unreadable, so span.sc-interp cannot be PROVEN styleless — refusing to unwrap");
      }
      scan(rules);
    }
    return out;
  }
  function unwrapInterp() {
    var spans = document.body.querySelectorAll("span.sc-interp");
    if (!spans.length) return { found: 0, unwrapped: 0, kept: 0 };
    var rules = interpRules(), n = 0, kept = 0;
    for (var i = spans.length - 1; i >= 0; i--) { // deepest/last first, so nesting unwraps cleanly
      var el = spans[i];
      // STRICT: any attribute beyond the single sc-interp class blocks the unwrap.
      // This was briefly widened to ignore id / data-lc-* hooks, on the reasoning that a
      // D2 hook is addressing rather than style. That reasoning was WRONG and the
      // widening opened a hole, proven adversarially in a real Chrome run: an id-hooked
      // span carrying an ID-SELECTOR style difference (font-weight 400 vs 700) failed
      // under this predicate and passed SILENTLY under the widened one. interpRules()
      // cannot catch it, because it only scans rules that mention sc-interp — an
      // id-selector rule such as #docs-count declaring font-weight 700 mentions no
      // such thing. Unwrapping an
      // element removes it from the comparison entirely, so ANY attribute that could
      // carry a selector must block. Do not widen this again.
      if (el.attributes.length !== 1 || el.getAttribute("class") !== "sc-interp") { kept++; continue; }
      for (var j = 0; j < rules.length; j++)
        if (el.matches(rules[j]))
          throw new Error("span.sc-interp is matched by the CSS rule {" + rules[j] +
            "} — it carries style, so unwrapping it would drop design out of the comparison");
      while (el.firstChild) el.parentNode.insertBefore(el.firstChild, el);
      el.parentNode.removeChild(el);
      n++;
    }
    return { found: spans.length, unwrapped: n, kept: kept };
  }

  // ---- seeded sampling (s1-s4) ------------------------------------------------------
  // The element's OWN text: its direct text nodes only, never a descendant's. Seeding
  // writes exactly this back, so a text run that lives in a child element is out of reach
  // by construction and stays in the diff.
  function ownText(el) {
    var t = "";
    for (var n = el.firstChild; n; n = n.nextSibling) if (n.nodeType === 3) t += n.nodeValue;
    return t;
  }
  function collapse(t) { return String(t).replace(/\\s+/g, " ").trim(); }
  function optionsOf(el) {
    var out = [];
    for (var i = 0; i < el.options.length; i++) out.push({ v: el.options[i].value, t: collapse(el.options[i].textContent) });
    return out;
  }
  // s2. The two spellings this corpus uses for "no value yet", and the ONLY things a seed
  // may overwrite:
  //   · the em dash STANDING AS THE VALUE — bare ("—") or after a static label
  //     ("Network · —"). NOT an em dash used as punctuation: "More than 1% apart — ours to
  //     fix" is a rendered label, and overwriting it would erase a real copy difference,
  //     which is the exact failure mode seeding must not have.
  //   · a "Loading …" progress string ("Loading chains…", "Loading tokens…", "Loading
  //     tracked pool count… · est. $2–5/day"). Anchored on both ends of the idiom — a
  //     leading "Loading" AND the ellipsis — so it cannot match prose.
  // Deliberately NOT "": an empty own text is what every structural wrapper on the page
  // has, and seeding those would write the mock's text into elements that never displayed
  // live state at all.
  var NO_DATA = [/^(?:.*·\\s*)?\\u2014$/, /^Loading\\b.*\\u2026/];
  function isPlaceholder(t) {
    var c = collapse(t);
    return NO_DATA.some(function (re) { return re.test(c); });
  }
  function replaceOwnText(el, text) {
    var first = null, kill = [];
    for (var n = el.firstChild; n; n = n.nextSibling) if (n.nodeType === 3) { if (!first) first = n; kill.push(n); }
    el.insertBefore(document.createTextNode(text), first); // in place: element children keep their order
    for (var i = 0; i < kill.length; i++) el.removeChild(kill[i]);
  }
  function seed(contentRoot, done) {
    if (!SEED) return done({ enabled: false, entries: 0, applied: [], unseeded: [] });
    var byKey = Object.create(null), byPath = Object.create(null);
    for (var i = 0; i < SEED.length; i++) {
      var e = SEED[i];
      if (e.k && !(e.k in byKey)) byKey[e.k] = e;
      if (!(e.p in byPath)) byPath[e.p] = e;
    }
    var applied = [], unseeded = [], targets = [], counts = Object.create(null);
    // Same key-then-path precedence as compare()'s join, so the element a seed lands on is
    // the element that seed is later compared against.
    walkChildren(contentRoot, "body", function (el, path) {
      var k = uniqueKey(el, counts), how = k && byKey[k] ? "key" : "path";
      var e = (k && byKey[k]) || byPath[path] || null;
      var isSel = el.tagName === "SELECT";
      var have = isSel ? optionsOf(el).map(function (o) { return o.t; }) : null;
      var text = isSel ? null : ownText(el);
      if (!(isSel ? have.every(isPlaceholder) : isPlaceholder(text))) return; // s2: never overwrite a rendered value
      var rec = { selector: k || path, path: path, tag: el.tagName.toLowerCase(), join: how,
                  before: isSel ? have.join(" | ") : collapse(text) };
      var why = !e ? "no counterpart in the mock"
        : (e.g === "SELECT") !== isSel ? "the mock's counterpart is a different kind of element"
        : isSel && !(e.o && e.o.length) ? "the mock's <select> has no options either"
        : !isSel && !collapse(e.t) ? "the mock renders no text here either"
        : null;
      if (why) { unseeded.push({ ...rec, reason: why }); return; } // s2/s4: stays in the diff, and is named
      var want;
      if (isSel) {
        want = e.o.map(function (o) { return o.t; });
        el.replaceChildren.apply(el, e.o.map(function (o) { return new Option(o.t, o.v); }));
        want = want.join(" | ");
      } else {
        want = collapse(e.t);
        if (want === rec.before) { unseeded.push({ ...rec, reason: "the mock renders the same placeholder" }); return; }
        replaceOwnText(el, e.t);
      }
      rec.after = want;
      applied.push(rec);
      targets.push({ el: el, rec: rec, want: want, isSel: isSel });
    });
    // s3. Verify AFTER giving the page a chance to write over us: the served page's own boot
    // script is what normally owns these nodes, and a seed it silently reverts (or a node it
    // replaces wholesale) would leave the run looking seeded while comparing the no-data
    // state again. Any target that did not hold aborts the run naming the element.
    setTimeout(function () {
      for (var j = 0; j < targets.length; j++) {
        var t = targets[j];
        if (!document.contains(t.el))
          return done("seeded element " + t.rec.selector + " was removed from the document after it was seeded — " +
            "the page's own render replaced the node, so the seed did not take effect");
        var now = t.isSel ? optionsOf(t.el).map(function (o) { return o.t; }).join(" | ") : collapse(ownText(t.el));
        if (now !== t.want)
          return done("seeding did not hold on " + t.rec.selector + ": expected " + JSON.stringify(t.want) +
            ", found " + JSON.stringify(now) + " — a seeded run that silently no-ops certifies nothing");
      }
      done({ enabled: true, entries: SEED.length, applied: applied, unseeded: unseeded });
    }, 150);
  }

  // The n-th element carrying an already-used key becomes key@n. The counter map is passed
  // in rather than closed over so the seed pass can re-derive the SAME keys the sampling
  // walk will derive, without consuming that walk's counters — seed identity must equal
  // join identity, or seeding and comparison address different nodes.
  function uniqueKey(el, counts) {
    var k = keyOf(el);
    if (!k) return null;
    counts[k] = (counts[k] || 0) + 1;
    return counts[k] > 1 ? k + "@" + counts[k] : k;
  }

  var recs = [], seen = Object.create(null), seedOut = [];
  function push(el, path) {
    var k = uniqueKey(el, seen), fp = fingerprint(el);
    recs.push({ key: k, path: path, tag: el.tagName.toLowerCase(), kids: fp.kids, own: fp.own, all: fp.all, styles: styles(el) });
    if (!EMIT_SEED) return;
    // s1: the seed payload IS this walk's own reading of the mock, carrying the element's
    // FULL own text (the fingerprint's own-text field is collapsed and clipped to 120, which
    // would seed a truncation). Only text-bearing elements and <select>s can seed anything.
    if (el.tagName === "SELECT") seedOut.push({ p: path, k: k, g: "SELECT", o: optionsOf(el) });
    else if (collapse(ownText(el))) seedOut.push({ p: path, k: k, g: el.tagName, t: ownText(el) });
  }
  // Freeze exception #8 (XYZ-1186): a TRANSPARENT WRAPPER is a named, D-cited element whose
  // children are numbered as if they were its parent's — one path level hoisted. Single pinned
  // use: #token-table-body, the <tbody>-equivalent grouping element renderTable() appends rows
  // into. The mock draws its 9 board rows as direct children of the grid; the port wraps them.
  // That one level shifted every descendant path, so ~600 board elements path-joined against
  // NOTHING on either side and the board's design went entirely uncompared.
  //
  // This is the opposite of a waiver: hoisting makes those ~600 elements JOIN, so all 31
  // properties of every board row are now actually compared. Strictly more verification than
  // before, with no markup change and no blind spot — which is exactly why it was chosen over
  // re-expressing the region (that would have repeated tonight's hollow-green mistake) and over
  // flattening load-bearing markup hours before a deploy.
  //
  // The wrapper itself is still walked and still recorded — it does NOT vanish. It simply does
  // not consume a sibling ordinal, and it carries a path suffixed ":w" so it can never collide
  // with a real sibling's coordinates. It has no mock counterpart, so it lands in missing and
  // is answered by its own D16 RULED_ELEMENTS entry, like any other named assembly element.
  function isTransparent(el) {
    for (var i = 0; i < TRANSPARENT.length; i++) if (el.id && ("#" + el.id) === TRANSPARENT[i]) return true;
    return false;
  }
  function walkChildren(el, path, visit) {
    var idx = Object.create(null);
    for (var c = el.firstElementChild; c; c = c.nextElementSibling) {
      if (SKIP[c.tagName]) continue;
      if (isTransparent(c)) {
        visit(c, path + ">" + c.tagName.toLowerCase() + ":w");
        // Its children continue THIS level's numbering, so they occupy the coordinates the
        // wrapper's own children would have had if the wrapper were not there.
        for (var g = c.firstElementChild; g; g = g.nextElementSibling) {
          if (SKIP[g.tagName]) continue;
          idx[g.tagName] = (idx[g.tagName] || 0) + 1;
          var gp = path + ">" + g.tagName.toLowerCase() + ":" + idx[g.tagName];
          visit(g, gp);
          walkChildren(g, gp, visit);
        }
        continue;
      }
      idx[c.tagName] = (idx[c.tagName] || 0) + 1;
      var p = path + ">" + c.tagName.toLowerCase() + ":" + idx[c.tagName];
      visit(c, p);
      walkChildren(c, p, visit);
    }
  }

  // n4: mock <body> joins served <body>; the dc-runtime mount scaffolding is not walked.
  // V1 — this is compile-dc.js:158-159's assertion, and it may NOT fall through to
  // document.body. The dc-runtime mounts into <div id="dc-root"><div class="sc-host">;
  // a page carrying #dc-root but no .sc-host never mounted, whatever the cause (runtime
  // 404, JS error, Babel parse failure, blocked resource). Falling back to body there
  // makes a total mount failure look like a 2-element page — which trivially matches an
  // identical copy of itself and prints OK. The served side legitimately has neither
  // wrapper (compile-dc.js unwraps them), so body stays the default only when #dc-root
  // is absent; the element floor at the end of run() is the result-shaped backstop that
  // catches every OTHER way a side can render nothing.
  function mountedRoot() {
    var dcRoot = document.getElementById("dc-root"), scHost = document.querySelector(".sc-host");
    if (dcRoot && !scHost)
      throw new Error("#dc-root > .sc-host wrapper not found — did the runtime mount?");
    var el = ROOT_SEL ? document.querySelector(ROOT_SEL) : (scHost || document.body);
    if (!el) throw new Error("content root matched nothing: " + (ROOT_SEL || "#dc-root > .sc-host | body"));
    return el;
  }
  // Every async step reports failure as a STRING first argument (a throw inside a
  // setTimeout would escape run()'s try and emit nothing at all, which reads as "the page
  // did not finish rendering"). Non-string arguments are values and pass through.
  function guard(fn) {
    return function (err) {
      try {
        if (typeof err === "string") throw new Error(err);
        fn(err);
      } catch (e) { emit({ error: String((e && e.message) || e) }); }
    };
  }

  function run() {
    guard(function () {
      checkHooks();
      mountedRoot();
      var other = T === "dark" ? "light" : "dark";
      revealControl(guard(function (opened) {
      var control = document.querySelector(TOGGLE);
      driveTheme(other, control, guard(function () {
        var pOther = probe(), dOther = derived();
        driveTheme(T, control, guard(function () {
          var pT = probe(), dT = derived();
          restoreDisclosures(opened, guard(function () {
            if (themeNow() !== T)
              throw new Error("theme attribute was overwritten after it was set — theme is not deterministic on this page");
            if (pT === pOther)
              throw new Error("dark and light resolve to the same palette (" + pT + ") — the theme attribute is not driving styles");
            // V2 — the attribute sticking proves nothing about the values the page DERIVES
            // from theme in JS. Assert those actually moved.
            var themed = document.querySelectorAll("[data-lc-accent]").length;
            if (themed && !control)
              throw new Error("this surface renders theme-derived content (" + themed + " [data-lc-accent]) but carries no theme control (" +
                TOGGLE + ") — the theme cannot be driven the way the application drives it");
            if (themed && dT === dOther)
              throw new Error("theme-derived render values are identical for dark and light (" + dT +
                ") — theme is frozen at the schema default; only the attribute changed");
            if (dT.indexOf("-" + other + ".") >= 0)
              throw new Error("a theme-named asset still resolves to " + other + " while rendering " + T +
                " (" + dT + ") — the app's theme state never moved");

            // Closed-by-default regions are driven open AFTER the theme is settled (so what
            // they render is this row's theme) and BEFORE the walk (so they are in it).
            openRegions(guard(function (regions) {
            // Exception #7 runs AFTER the regions are open and BEFORE the walk, for the same
            // reason they do: what it renders must be in the tree the walk sees, and at this
            // row's theme.
            driveData(guard(function (dataDriven) {
            var contentRoot = mountedRoot();
            // Scripts are cloned out first: the dc-script props block carries the
            // template's RAW text, {{ }} and all, and would mask an un-mounted page.
            var clone = contentRoot.cloneNode(true);
            Array.prototype.forEach.call(clone.querySelectorAll("script,style"), function (n) { n.remove(); });
            if (clone.textContent.indexOf("{{") >= 0)
              throw new Error("unresolved {{ }} binding at sample time — the dc-runtime never mounted this page");
            var interp = unwrapInterp();
            // Seeding runs AFTER unwrapInterp (so its paths are the paths the walk will
            // use) and BEFORE the walk (so what gets sampled is the populated state).
            seed(contentRoot, guard(function (seeding) {
              push(document.body, "body");
              walkChildren(contentRoot, "body", push);
              if (recs.length < MIN_ELEMENTS)
                throw new Error("content root <" + contentRoot.tagName.toLowerCase() + "> rendered " + recs.length +
                  " element(s), under the " + MIN_ELEMENTS + " floor — this side has effectively nothing to compare");

              emit({ theme: T, themeProbe: pT, themeProbeOther: pOther, themeDerived: dT, themeDerivedOther: dOther,
                     themeControl: !!control, disclosuresOpened: opened.length, interp: interp, seeding: seeding,
                     seed: EMIT_SEED ? seedOut : null, regions: regions, dataDriven: dataDriven,
                     // Read at SAMPLE time, so a page that resized itself is caught too.
                     viewport: { width: innerWidth, height: innerHeight },
                     contentRoot: contentRoot.tagName.toLowerCase(), elements: recs });
            }));
            }));
            }));
          }));
        }));
      }));
      }));
    })();
  }
  if (document.readyState === "complete") settle(run);
  else addEventListener("load", function () { settle(run); });
})();
</script>
`;

// ---- render one side ---------------------------------------------------------------

// A pass-1 mock page references ./support.js (and ./docs-content.js) in the SERVED
// layout; on disk those sit one directory up, so the page 404s them where it lies
// (tools/f2-parity.mjs solves the same mismatch by copying page+runtime into a tmp
// dir, which would strand ../assets/). Bring such a runtime DOWN to the page instead —
// a tmp copy beside the tmp page, removed with it — and leave every other relative URL
// alone. A ref that resolves nowhere is a hard fail: a silently un-mounted side A is
// exactly the failure this gate exists to catch.
//
// Beside the page, never an absolute file:// URL to where it really lives. A dynamic
// import's base URL follows the REFERENCING SCRIPT, and support.js is what evaluates the
// mock's dc-script blocks (support.js:1218's new Function), so the docs view's
// `import("./docs-content.js")` (desktop/index.html:1222) resolves next to support.js. An
// absolute src therefore reached editorial/docs-content.js — the GLOBAL form
// (window.__LC_DOCS), not the module form (export const DOCS) that sits in each lane dir.
// `m.DOCS` came back undefined, the docs view rendered as an empty shell, and NOTHING
// surfaced: the whole failure was one swallowed .catch. Resolved beside the tmp page, the
// import lands on the lane's module-form copy and side A renders real content.
function siblingRuntimes(side, file, dir, page, temps) {
  return page.replace(/(<script[^>]+src=")\.\/([\w.-]+\.js)(")/g, (m, pre, name, post) => {
    if (existsSync(join(dir, name))) return m;
    const up = join(dir, "..", name);
    if (!existsSync(up)) fail(`${side}: ${file} references ./${name}, found neither beside it nor one level up`);
    const local = `.style-parity.${process.pid}.${side}.${name}`;
    copyFileSync(up, join(dir, local));
    temps.push(join(dir, local));
    return pre + "./" + local + post;
  });
}

// XYZ-1171. LANES declares the mobile lane as 390x844, but Chrome clamps its BROWSER WINDOW
// to a 500px minimum: `--window-size=390,844` laid the page out at 500px, so every mobile row
// this gate ever produced measured a layout no user gets. Window sizing cannot express it —
// `--force-device-scale-factor` (the obvious second lever) makes Chrome ignore --window-size
// altogether, measured — so the VIEWPORT is set directly with Emulation.setDeviceMetricsOverride,
// which is not clamped. That means driving Chrome over CDP, and CDP is mutually exclusive with
// --dump-dom: --dump-dom navigates immediately, before an override can be installed.
// --virtual-time-budget goes with it (it is honoured only in the --dump-dom/--screenshot
// pipeline), replaced by the two Emulation calls it is implemented on top of — the same 8000ms
// budget, the same pause-before-navigate ordering, so page timing is unchanged.
// Still Node built-ins only: Node's own WebSocket, and the browser endpoint is READ out of the
// profile's DevToolsActivePort rather than guessed, so port 0 picks a free port and concurrent
// runs cannot collide. The mechanism is replaceable; the achieved-width assertion in render()
// is what stops a clamped viewport from coming back silently.
const VIRTUAL_TIME_MS = 8000, RENDER_TIMEOUT_MS = 120000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// unref'd: a timeout that lost its race must not hold the process open to fire into nothing.
const after = (ms, msg) => new Promise((_, rej) => setTimeout(() => rej(new Error(`style-parity: ${msg}`)), ms).unref());

async function chromeSample(url, size) {
  const [width, height] = size.split(",").map(Number);
  const profile = mkdtempSync(join(tmpdir(), "style-parity-"));
  const child = spawn(
    CHROME,
    ["--headless=new", "--disable-gpu", "--no-first-run", "--hide-scrollbars",
     // The window is only the frame now; setDeviceMetricsOverride below owns the viewport.
     "--force-device-scale-factor=1", `--window-size=${size}`,
     // Without this, Chrome treats a file:// script as CORS-cross-origin and gives the
     // dynamic import a base URL of about:blank ("Failed to resolve module specifier
     // './docs-content.js'"), which the docs view swallows into a console.error and
     // renders as an EMPTY shell. Same flag, same position as compile-dc.js:166 — egress
     // stays denied by the two below, so the widened reach is local- and build-time only.
     "--allow-file-access-from-files",
     // Egress denied (same flags as compile-dc.js): every hostname fails to resolve
     // and the only proxy is a dead port, so an un-redirected CDN fetch fails loudly
     // instead of quietly reaching unpkg. file:// is unaffected by both.
     "--host-resolver-rules=MAP * ~NOTFOUND", "--proxy-server=http://127.0.0.1:1",
     "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"],
    { stdio: "ignore" }
  );
  let ws = null;
  try {
    let endpoint = "";
    for (let i = 0; i < 750 && !endpoint; i++) {
      try { endpoint = readFileSync(join(profile, "DevToolsActivePort"), "utf8").trim(); } catch { await sleep(20); }
    }
    if (!endpoint) fail("Chrome never wrote a DevToolsActivePort file — the browser did not start");
    const [port, path] = endpoint.split("\n");

    ws = new WebSocket(`ws://127.0.0.1:${port}${path}`);
    const pending = new Map(), waits = new Map();
    let seq = 0, dropped = null;
    await Promise.race([
      new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error("style-parity: Chrome's CDP endpoint refused the connection")); }),
      after(15000, "Chrome's CDP endpoint did not accept a connection"),
    ]);
    // A dropped socket must reject every in-flight command; otherwise a crashed renderer
    // reads as a page that is still rendering, and the run hangs to its timeout.
    ws.onerror = ws.onclose = () => {
      dropped = "the CDP connection dropped before the sample came back — did Chrome crash?";
      for (const p of pending.values()) p.rej(new Error(`style-parity: ${dropped}`));
      pending.clear();
    };
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (!m.id) return waits.get(m.method)?.(m.params);
      const p = pending.get(m.id);
      pending.delete(m.id);
      if (p) m.error ? p.rej(new Error(`style-parity: CDP ${m.method || ""} failed: ${m.error.message}`)) : p.res(m.result);
    };
    const send = (method, params, sessionId) =>
      new Promise((res, rej) => {
        if (dropped) return rej(new Error(`style-parity: ${dropped}`));
        const id = ++seq;
        pending.set(id, { res, rej });
        ws.send(JSON.stringify({ id, method, params, sessionId }));
      });
    const once = (method) => new Promise((res) => waits.set(method, res));

    const { targetId } = await send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
    const S = (m, p) => send(m, p, sessionId);
    await S("Page.enable");
    await S("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
    const expired = once("Emulation.virtualTimeBudgetExpired");
    await S("Emulation.setVirtualTimePolicy", { policy: "pause" });
    // Not awaited: Page.navigate only resolves once virtual time advances, which is the very
    // next call. Its rejection is swallowed because the budget below is the real signal.
    S("Page.navigate", { url }).catch(() => {});
    await S("Emulation.setVirtualTimePolicy", {
      policy: "pauseIfNetworkFetchesPending", budget: VIRTUAL_TIME_MS, maxVirtualTimeTaskStarvationCount: 1e6,
    });
    await Promise.race([expired, after(RENDER_TIMEOUT_MS, `${url} did not finish rendering in ${RENDER_TIMEOUT_MS / 1000}s`)]);
    // Only the sampler's own payload is read back, never the whole serialized DOM: it is the
    // one thing this tool wants, and a docs page's outerHTML is several MB of frame we would
    // then throw away.
    const { result } = await S("Runtime.evaluate", {
      expression: "(document.getElementById('sp-result') || {}).textContent || ''",
      returnByValue: true,
    });
    return result.value;
  } finally {
    ws?.close();
    child.kill("SIGKILL");
    // BEST-EFFORT, and deliberately so. Chrome can still be releasing handles inside its own
    // profile directory when we tear it down, and that race made `docs-mobile-dark` exit 1 with
    // a clean 0/0/0/0 artifact — a PASS reported as a FAIL, with no verdict line at all. A
    // temp-directory cleanup is not a parity finding and must never be able to speak as one.
    try { rmSync(profile, { recursive: true, force: true }); }
    catch (e) { console.error(`  NOTE: could not remove the temp Chrome profile ${profile} (${e.code || e.message}) — ` +
      "harness cleanup only, it says nothing about this comparison"); }
  }
}

async function render(side, spec, { theme, rootSel, hooks, size, resources, emitSeed, seed, data, transparent }) {
  const [file, hash] = spec.split("#");
  const abs = resolve(root, file);
  const src = readFileSync(abs, "utf8");
  const head = src.match(/<head[^>]*>/);
  if (!head) fail(`${side}: no <head> in ${file}`);
  const close = src.lastIndexOf("</body>");
  if (close < 0) fail(`${side}: no </body> in ${file}`);

  // The tmp copy lives NEXT TO the original so every relative URL still resolves.
  const tmp = join(dirname(abs), `.style-parity.${process.pid}.${side}.html`);
  const temps = [];
  let payload;
  try {
    const page = siblingRuntimes(
      side,
      file,
      dirname(abs),
      src.slice(0, head.index + head[0].length) +
        prelude(resources) +
        src.slice(head.index + head[0].length, close) +
        sampler({ theme, rootSel, hooks, emitSeed, seed, side, data, transparent }) +
        src.slice(close),
      temps
    );
    writeFileSync(tmp, page);
    payload = await chromeSample("file://" + tmp + (hash ? "#" + hash : ""), size);
  } finally {
    rmSync(tmp, { force: true });
    for (const t of temps) rmSync(t, { force: true });
  }

  if (!payload) fail(`${side}: sampler produced no result — the page did not finish rendering (${file})`);
  const out = JSON.parse(Buffer.from(payload, "base64").toString("utf8"));
  if (out.error) fail(`${side}: ${out.error} (${file})`);
  // XYZ-1171: a lane is only a lane if the page was laid out at its width. Asserted per side,
  // from the page's OWN innerWidth at sample time — the emulation is the mechanism, this is
  // the guarantee, and without it a re-clamped viewport comes back as a silent 500px row.
  const want = Number(size.split(",")[0]);
  if (out.viewport.width !== want)
    fail(`${side}: sampled at ${out.viewport.width}px wide, but this lane declares ${want}px — the emulated ` +
      `viewport did not take, so every measurement here describes a layout no user gets (${file})`);
  return out;
}

// ---- join + diff --------------------------------------------------------------------

// V3: the depth-1 fingerprint the path join must agree on (child tag sequence + own
// text). Divergent fingerprints refuse to pair — a structural regression is reported,
// never ordinally aligned into a silent 0-mismatch diff.
const fpOf = (r) => `${r.kids}\u0000${r.own}`;
const fpSides = (a, b) => ({
  mock: { children: a.kids, text: a.own, textAll: a.all },
  served: { children: b.kids, text: b.own, textAll: b.all },
});

function compare(mock, served, reexpressedEntries = []) {
  const exemptBy = exemptWith(mock, served);
  const mismatches = [], ruled = [], missing = [], divergent = [], exempt = [];
  const pending = { mock: [...mock.elements], served: [...served.elements] };
  const joined = [];

  const joinOn = (idx, label) => {
    const bIdx = new Map();
    pending.served.forEach((r, i) => {
      const k = idx(r);
      if (k && !bIdx.has(k)) bIdx.set(k, i);
    });
    const usedA = new Set(), usedB = new Set();
    pending.mock.forEach((r, i) => {
      const k = idx(r);
      if (!k || !bIdx.has(k)) return;
      const j = bIdx.get(k);
      usedA.add(i);
      usedB.add(j);
      // The reported selector is the element's own identity, never the internal join key:
      // a RULED_TRANSFORMS `selector` regex has to be writable against it.
      joined.push({ selector: r.key || r.path, join: label, a: r, b: pending.served[j] });
    });
    pending.mock = pending.mock.filter((_, i) => !usedA.has(i));
    pending.served = pending.served.filter((_, i) => !usedB.has(i));
  };

  joinOn((r) => r.key, "key");                        // precedence 1+2: data-lc-*/id, then F3 hook inventory
  joinOn((r) => `${r.path}\u0000${fpOf(r)}`, "path"); // precedence 3: position AND fingerprint

  // Precedence 4 — n4's axiom, ENFORCED rather than left to the two joins above. "mock <body>
  // joins served <body>" is the walk's own construction: each side pushes exactly one record at
  // path "body", so this pairing is not an inference and cannot mis-pair anything. It WAS left
  // to inference, and inference dropped it. The served pages delete data-lc-theme from <body>
  // in light (`else delete document.body.dataset.lcTheme`, apps/dashboard/index.html:310 and
  // its six siblings) while the mock keeps data-lc-theme="light", so the served <body> has no
  // key to join on; and where the two bodies' child lists legitimately differ (admin's
  // #skip-link, the dashboard's two extra <section>s) the fingerprint join refuses as well.
  // <body> then fell through to the path-leftover `divergent` branch, which reports the
  // structure but never adds the pair to `joined` — so one element's styles silently stopped
  // being compared in the LIGHT row of exactly those three surfaces (joined 75→74, 75→74,
  // 58→57) while missing/divergent/exempt membership stayed identical. The divergence is still
  // reported below and still fails the verdict; only the silent loss of coverage is fixed.
  joinOn((r) => (r.path === "body" ? "root" : null), "root");

  // A hook-joined pair is the same element by explicit claim, and the two <body> elements are
  // the same element by construction, so both pair regardless — but their structure diverging
  // is a defect the style diff cannot see. Report it. A path-joined pair can never reach here:
  // its join key carries the fingerprint, so equal keys mean equal fingerprints.
  for (const j of joined) {
    if (fpOf(j.a) !== fpOf(j.b))
      divergent.push({ selector: j.selector, path: j.a.path, tag: j.a.tag, join: j.join, ...fpSides(j.a, j.b) });
  }
  // Leftovers sharing a path are the same slot with different content: structurally
  // divergent, not missing. Everything else really is absent from one side.
  //
  // XYZ-1170: such a pair is ALSO style-compared, exactly like a key-joined divergent pair.
  // Until now it was not, and that asymmetry meant whether an element's ~31 properties got
  // measured at all depended on whether it happened to carry a hook: a hook-joined pair whose
  // structure diverged was reported AND diffed, while a path-leftover pair was only described.
  // Nine admin elements per row sat in that gap. Joining here does NOT excuse the divergence —
  // it is still pushed above, still printed, still fails the verdict — it only stops the
  // structural report from standing in for a measurement it never was. Mismatch counts RISE:
  // properties nobody was looking at start being looked at.
  const servedLeft = new Map(pending.served.map((r) => [r.path, r]));
  for (const a of pending.mock) {
    const b = servedLeft.get(a.path);
    if (!b) continue;
    divergent.push({ selector: a.key || a.path, path: a.path, tag: a.tag, join: "path", ...fpSides(a, b) });
    joined.push({ selector: a.key || a.path, join: "path", a, b });
  }
  const dPaths = new Set(divergent.filter((d) => d.join === "path").map((d) => d.path));
  for (const side of ["mock", "served"]) {
    for (const r of pending[side]) {
      if (dPaths.has(r.path)) continue;
      const rec = { absentFrom: side === "mock" ? "served" : "mock", selector: r.key || r.path, path: r.path, tag: r.tag };
      const rule = exemptBy(rec);
      if (rule) exempt.push({ kind: "element", ...rec, ...rule });
      else missing.push(rec);
    }
  }

  // An exempted element necessarily changes its PARENT's child list too, so the same ruled
  // addition also lands one level up as a structural divergence — leaving the exemption
  // unable to license anything on its own. Excuse that consequence, and only it: the
  // parent's fingerprint is recomputed with exactly the exempted children removed, and if
  // anything else about the parent moved (another child, its own text) it still fails.
  // Paired parents only — but BOTH pairings count, hook-joined and path-joined alike. A
  // hookless <body> that exists on both sides at the same path is the same element, and
  // failing its exemption for the accident of having no hook would be arbitrary. What may
  // never be waived is an element that was never paired at all: that one is `missing`, not
  // `divergent`, and this loop never sees it.
  const byParent = new Map();
  // Ruled RE-EXPRESSIONS count here too, and they have to. A D20 region's root necessarily
  // changes its parent's child list — the mock's <div> becomes the port's <form>/<dialog>/
  // <aside> — so a divergence caused SOLELY by a ruled re-expression would otherwise be
  // reported as an unresolved defect, which is the exact inversion exception #6 exists to end.
  //
  // Membership is derived from the REEXPRESSED config's paths alone, not from the pin, because
  // this runs before the pins are checked. That is safe rather than convenient: a broken pin
  // fails the verdict outright via `reexpressed.pinFailures`, so no combination of drift and
  // generous attribution here can produce a PASS.
  const reexpressedKids = mock.elements
    .filter((el) => reexpressedEntries.some((t) => el.path === t.mockRegion || el.path.startsWith(t.mockRegion + ">")))
    .map((el) => {
      const t = reexpressedEntries.find((x) => el.path === x.mockRegion || el.path.startsWith(x.mockRegion + ">"));
      return { selector: el.key || el.path, path: el.path, tag: el.tag, presentOn: "mock", d: t.d, transform: t.transform };
    });
  for (const e of [...exempt, ...reexpressedKids]) {
    const p = e.path.slice(0, e.path.lastIndexOf(">"));
    byParent.set(p, [...(byParent.get(p) || []), e]);
  }
  // Highest ordinal first: the path ordinal is per-tag, so removing a low one would shift
  // every higher sibling of that tag out from under its own ordinal.
  const dropExempted = (children, kids, side) => {
    const out = children ? children.split(",") : [];
    const drops = kids
      // Two vocabularies meet here. An `exempt` entry says which side it is ABSENT from; a
      // re-expressed one says which side it is PRESENT on (deliberately — it must never restate
      // the absence claim the category exists to refuse). Both answer "is it on THIS side".
      .filter((e) => (e.presentOn ? e.presentOn === side : e.absentFrom !== side))
      .map((e) => e.path.slice(e.path.lastIndexOf(">") + 1).split(":"))
      .map(([tag, n]) => ({ tag: tag.toUpperCase(), n: +n }))
      .sort((x, y) => y.n - x.n);
    for (const { tag, n } of drops) {
      let seen = 0;
      const i = out.findIndex((k) => k === tag && ++seen === n);
      if (i < 0) return null;
      out.splice(i, 1);
    }
    return out.join(",");
  };
  const keptDivergent = [];
  for (const d of divergent) {
    const kids = byParent.get(d.path) || [];
    const adjM = kids.length ? dropExempted(d.mock.children, kids, "mock") : null;
    const adjS = kids.length ? dropExempted(d.served.children, kids, "served") : null;
    // The parent's own text may differ ONLY when the ruled children re-homed it and the FULL
    // subtree text is identical. n5 unwraps the mock's interp wrappers, merging their text into
    // the parent, while the port keeps the same words inside its own addressable span:
    // own-text "42 sections" vs "sections", subtree text identical on both sides.
    //
    // This is deliberately NOT a relaxation of the text check. Own-text equality still passes on
    // its own; the alternative below additionally requires (a) the divergence to be caused solely
    // by ruled children, already enforced above, and (b) every character of the subtree to match.
    // A parent whose text actually CHANGED fails both, so nothing that was catchable before is
    // catchable less. Without it the structural exemption could only ever fire for ruled children
    // that carry no text, which is an arbitrary line nobody drew on purpose.
    const textOk = d.mock.text === d.served.text ||
      (d.mock.textAll !== undefined && d.mock.textAll === d.served.textAll);
    if (adjM !== null && adjS !== null && adjM === adjS && textOk) {
      // Structural excuse only. The pair's styles are compared either way — a path divergence
      // is joined where it is detected (XYZ-1170) — so an exemption here moves the structure
      // report into `exempt` and changes nothing about the property diff.
      exempt.push({ kind: "structure", selector: d.selector, path: d.path, tag: d.tag, join: d.join,
                    mock: d.mock, served: d.served,
                    causedBy: kids.map((e) => ({ selector: e.selector, d: e.d, transform: e.transform })) });
    } else keptDivergent.push(d);
  }

  for (const { selector, join: how, a, b } of joined) {
    for (const property of PROPERTIES) {
      if (a.styles[property] === b.styles[property]) continue;
      const m = { selector, property, mock: a.styles[property], served: b.styles[property], join: how, path: a.path };
      const rule = ruledBy(m);
      if (rule) ruled.push({ ...m, d: rule.d, transform: rule.transform });
      else mismatches.push(m);
    }
  }
  return { joined, mismatches, ruled, missing, divergent: keptDivergent, exempt };
}

// V6: without a floor, `0 mismatches && 0 missing` is also what a comparison of two
// nearly-empty selections reports. A wrong --mock-root/--served-root, a collapsed
// render, or a shrunken page must not print PASS just because it compared almost
// nothing.
// `accounted` is joined + ruled re-expressions. A re-expressed element is NOT unexamined — it
// was walked, sampled, matched to a pinned membership and pointed at its served counterpart. The
// floor exists to catch a comparison that measured almost nothing, and an element carrying a
// D-number that resolves in DECISIONS.md is the opposite of unmeasured. Leaving it out of the
// denominator made a ruled row fail for having been ruled.
// It cannot be abused to pass vacuously: MIN_ELEMENTS is still checked against `joined` ALONE,
// so a run that joined nothing and re-expressed everything still fails here.
function coverageFailures(joined, mockN, servedN, reexpressed = 0) {
  const lo = Math.min(mockN, servedN), hi = Math.max(mockN, servedN), out = [];
  const accounted = joined + reexpressed;
  if (joined < MIN_ELEMENTS) out.push(`only ${joined} element(s) joined, under the ${MIN_ELEMENTS} floor`);
  else if (accounted < JOIN_RATIO * lo)
    out.push(`only ${accounted} of the smaller side's ${lo} element(s) joined or ruled re-expressed` +
      `${reexpressed ? ` (${joined} joined + ${reexpressed} re-expressed)` : ""}, under the ${JOIN_RATIO * 100}% floor`);
  if (hi && lo < SIDE_RATIO * hi)
    out.push(`element totals diverge implausibly: mock ${mockN} vs served ${servedN} (under the ${SIDE_RATIO * 100}% floor)`);
  return out;
}

// ---- main ---------------------------------------------------------------------------

const usage = () => {
  console.error(
    "usage: node tools/style-parity.mjs --surface <name> --lane <desktop|mobile> --theme <dark|light> \\\n" +
      "         --mock <path[#hash]> --served <path[#hash]> [--mock-root <sel>] [--served-root <sel>] \\\n" +
      "         [--hooks a.js,b.js] [--seed on|off] [--out <path>]"
  );
  process.exit(1);
};

const args = {};
for (let i = 2; i < process.argv.length; i += 2) {
  if (!process.argv[i].startsWith("--") || process.argv[i + 1] === undefined) usage();
  args[process.argv[i].slice(2)] = process.argv[i + 1];
}
for (const k of ["surface", "lane", "theme", "mock", "served"]) if (!args[k]) usage();
if (!LANES[args.lane] || !THEMES.includes(args.theme)) usage();
if (args.seed !== undefined && args.seed !== "on" && args.seed !== "off") usage();
if (!existsSync(CHROME)) fail(`Chrome not found at ${CHROME} — set CHROME_BIN`);

validateWaivers();

const seedOn = args.seed !== "off";
const size = LANES[args.lane];
const resources = vendorResources();
const hooks = hookSelectors(args.hooks ? args.hooks.split(",").filter(Boolean) : []);
// Exception #7: the entry for THIS row, or null. Scoped by surface+lane like every other
// ruled construct in this file — a bare "compare" would drive the mobile lane too, which has
// no such document.
const driven = DRIVEN_DATA.find((x) => x.surface === args.surface && x.lane === args.lane) || null;
// Exception #8, scoped per side as well as per surface+lane: the mock has no such wrapper, and
// making an element transparent on the side that does not have it would be a no-op that reads
// like a rule.
const transparentFor = (side) =>
  TRANSPARENT_WRAPPERS.filter((t) => t.surface === args.surface && t.lane === args.lane && t.side === side)
    .map((t) => t.key);
const mock = await render("mock", args.mock, { theme: args.theme, rootSel: args["mock-root"] || null, hooks, size, resources, emitSeed: seedOn, seed: null, data: driven, transparent: transparentFor("mock") });
// s1/s3: an empty payload means side B was never actually seeded, whatever its own report
// says. Every surface in this corpus renders text, so this can only be a broken source.
if (seedOn && !mock.seed?.length) fail(`--seed on, but the mock side emitted no seed values (${args.mock}) — side B would be compared unseeded`);
const served = await render("served", args.served, { theme: args.theme, rootSel: args["served-root"] || null, hooks, size, resources, emitSeed: false, seed: seedOn ? mock.seed : null, data: driven, transparent: transparentFor("served") });
const { joined, mismatches, ruled, missing: absent, divergent, exempt } = compare(mock, served,
  DRIVEN_DATA && REEXPRESSED.filter((t) => t.surface === args.surface && t.lane === args.lane));
const { missing, reexpressed } = reexpress(absent, exempt, mock.regions, args.surface, args.lane,
  mock.elements, served.elements);
const coverage = coverageFailures(joined.length, mock.elements.length, served.elements.length,
  reexpressed.elements.length);

const artifact = {
  generated: "tools/style-parity.mjs",
  surface: args.surface,
  lane: args.lane,
  theme: args.theme,
  mock: args.mock,
  served: args.served,
  // The lane's declared viewport AND the one each side was actually laid out at (XYZ-1171).
  // Both are recorded because "390x844" as a label is precisely what was true before and
  // false in fact; render() refuses to get here if the widths disagree.
  viewport: {
    lane: size.replace(",", "x"),
    mock: `${mock.viewport.width}x${mock.viewport.height}`,
    served: `${served.viewport.width}x${served.viewport.height}`,
  },
  // The closed-by-default regions this run drove open, per side, with the element count each
  // contributed (XYZ-1150). `absent` on one side while the other is `open` is the port not
  // rendering that region at all — the elements show up in `missing`, and the note on stderr
  // says which region they came from.
  regions: { mock: mock.regions, served: served.regions },
  // Exception #7 (XYZ-1176): what each side's board was sampled WITH. `null` on every row that
  // has no DRIVEN_DATA entry, so a reader can never confuse "not driven" with "driven to zero".
  dataDriven: { mock: mock.dataDriven ?? null, served: served.dataDriven ?? null },
  hookSelectors: hooks.length,
  // n5, per side: how many sc-interp wrappers were found, erased, and left alone as
  // load-bearing. `kept` is the number this normalization deliberately did NOT touch.
  interp: { mock: mock.interp, served: served.interp },
  // s4. Exactly what this run substituted into side B, before/after per element, plus every
  // placeholder it did NOT populate and why — those stayed in the diff. A raw run records
  // `enabled: false` here, so the two kinds of evidence are never confusable.
  seeding: { source: args.mock, ...served.seeding },
  properties: PROPERTIES,
  themeProbe: { mock: mock.themeProbe, served: served.themeProbe },
  // The theme-DERIVED render values, per theme, on each side: the evidence that the
  // app's own theme state moved and not just the attribute (V2).
  themeDerived: {
    mock: { [args.theme]: mock.themeDerived, [args.theme === "dark" ? "light" : "dark"]: mock.themeDerivedOther, control: mock.themeControl, disclosuresOpened: mock.disclosuresOpened },
    served: { [args.theme]: served.themeDerived, [args.theme === "dark" ? "light" : "dark"]: served.themeDerivedOther, control: served.themeControl, disclosuresOpened: served.disclosuresOpened },
  },
  elements: {
    mock: mock.elements.length,
    served: served.elements.length,
    joined: joined.length,
    byKey: joined.filter((j) => j.join === "key").length,
    byPath: joined.filter((j) => j.join === "path").length,
    // The <body> axiom, counted separately so byKey + byPath + byRoot === joined and the
    // artifact's own arithmetic closes. 1 only where the two joins above BOTH declined the
    // pairing — on this corpus, the light rows whose served page drops data-lc-theme from
    // <body> while the two bodies' child lists legitimately differ.
    byRoot: joined.filter((j) => j.join === "root").length,
    exempt: exempt.length,
    // Its own count, next to its two neighbours and never folded into either.
    reexpressed: reexpressed.elements.length,
  },
  coverage: { minElements: MIN_ELEMENTS, joinRatio: JOIN_RATIO, sideRatio: SIDE_RATIO, failures: coverage },
  missing,
  divergent,
  mismatches,
  ruled,
  // Excused, never dropped: every RULED_ELEMENTS hit is listed here with the D-number that
  // licensed it, so a reader can see exactly what this run did not hold against the port.
  exempt,
  // The THIRD category (freeze exception #6). Neither `exempt` nor `missing`, and folded into
  // neither: these mock-side elements are PRESENT on the mock and re-expressed on the served
  // side as the <dialog>/<aside> D20 ruled legal. `regions` carries the pinned-vs-measured
  // numbers whether or not they held, so a reader can audit the tripwire itself rather than
  // trusting that it fired. `pinFailures` is non-empty only when a pin drifted, and a drifted
  // region re-expresses NOTHING — its elements are back in `missing` above.
  reexpressed,
  verdict:
    mismatches.length === 0 && missing.length === 0 && divergent.length === 0 && coverage.length === 0 &&
    // Belt and braces: drift already fails via `missing`, but only while the region HAS members.
    // A region that drifted to zero members would otherwise fail silently — the one shape where
    // a broken pin could pass.
    reexpressed.pinFailures.length === 0 &&
    // A re-expressed pair that DIFFERS in design is a defect like any other. D20 ruled the two
    // regions equivalent in STRUCTURE; it did not license their styles to drift.
    reexpressed.mismatches.length === 0 && reexpressed.unpaired.length === 0 ? "PASS" : "FAIL",
};

const out = args.out
  ? resolve(root, args.out)
  : join(root, "docs/goals/editorial-v2-port/evidence/style-parity", `${args.surface}-${args.lane}-${args.theme}.json`);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(artifact, null, 2) + "\n");

const where = `${args.surface}/${args.lane}/${args.theme}`;
const counts =
  `${artifact.elements.joined} joined (${artifact.elements.byKey} by hook, ${artifact.elements.byPath} by path` +
  `${artifact.elements.byRoot ? `, ${artifact.elements.byRoot} by the <body> axiom` : ""}), ` +
  `${PROPERTIES.length} properties, ` +
  (artifact.seeding.enabled ? `${artifact.seeding.applied.length} seeded` : "UNSEEDED");
// Exemptions are printed on a GREEN run too: an excused element that nobody sees is the
// same hole as an unmeasured one.
const exemptLine = (e) =>
  e.kind === "element"
    ? `  EXEMPT element ${e.selector} (<${e.tag}> at ${e.path}) — absent from ${e.absentFrom}, ruled ${e.d} · ${e.transform}` +
      (e.within ? `, anchored under ${e.within}` : "")
    : `  EXEMPT structure ${e.selector} (<${e.tag}> at ${e.path}) — child list differs by exactly ` +
      e.causedBy.map((c) => `${c.selector} (${c.d} · ${c.transform})`).join(", ");
// The third category prints on every run, PASS or FAIL, for the same reason exemptions do:
// 109 elements that quietly left `missing` with nothing said would read as a closed gap, which
// is the precise misreading this category exists to prevent. Each line says what happened —
// re-expressed by ruling D20 — and points at the served element it is re-expressed AS.
const reexpressedLine = (e) =>
  `  REEXPRESSED element ${e.selector} (<${e.tag}> at ${e.path}) — present on mock, re-expressed as ` +
  `${e.reexpressedAs} in the ${e.region}, ruled ${e.d} · ${e.transform}`;
// The pin, printed whether or not it held. A tripwire nobody can see the state of is a claim.
const pinLine = (r) =>
  `  ${r.pinHeld ? "PIN HELD" : "PIN BROKEN"} ${r.d} · ${r.transform} (${r.region || "always-visible, no driven region"}): ` +
  (r.found.sampled === undefined ? "" : `sampled ${r.found.sampled}/${r.pinned.sampled}, `) +
  `re-expressed ${r.found.elements}/${r.pinned.elements}, ` +
  `counterparts ${r.found.counterparts}/${r.pinned.counterparts} — mock ${r.mockRegion} → served ${r.servedAs}`;
// A kept wrapper is one this normalization judged load-bearing and left in the tree. It is
// a legitimate diff source, so it is named rather than buried in the artifact.
// s4: printed on every run, seeded or raw, PASS or FAIL — a reader must be able to tell one
// from the other without opening the artifact, and an unseeded placeholder is a live-state
// element this comparison is still measuring in two different states.
// Printed on every run: the lane is a claim about layout, and a reader must be able to see
// the width the pages were MEASURED at without opening the artifact.
console.error(`  VIEWPORT: ${args.lane} lane ${artifact.viewport.lane} → mock ${artifact.viewport.mock}, ` +
  `served ${artifact.viewport.served} (device-metrics emulation)`);
for (const side of ["mock", "served"])
  for (const r of artifact.regions[side])
    console.error(r.state === "open"
      ? `  REGION ${side}: ${r.region} driven OPEN via ${r.drivenBy} (${r.selector}), ${r.elements} element(s) sampled`
      : `  REGION ${side}: ${r.region} ABSENT — this side renders no such region, so its counterpart's elements ` +
        `are counted missing`);
for (const side of ["mock", "served"]) {
  const dd = artifact.dataDriven[side];
  if (dd) console.error(`  DATA ${side}: ${dd.rows} board row(s) — ${dd.drivenBy} (exception #7, XYZ-1176)`);
}
const sd = artifact.seeding;
if (!sd.enabled) console.error("  NOTE: seeding DISABLED (--seed off) — side B is compared in its own no-data state");
else {
  console.error(`  SEEDED served: ${sd.applied.length} element(s) populated from ${args.mock} (${sd.entries} mock value(s) offered)`);
  for (const a of sd.applied)
    console.error(`    SEED [${a.join}] ${a.selector} (<${a.tag}>): ${JSON.stringify(a.before)} → ${JSON.stringify(a.after)}`);
  for (const u of sd.unseeded)
    console.error(`    UNSEEDED ${u.selector} (<${u.tag}> at ${u.path}) holds ${JSON.stringify(u.before)} — ${u.reason}; still compared`);
}
for (const side of ["mock", "served"])
  if (artifact.interp[side].kept)
    console.error(`  NOTE: ${side} keeps ${artifact.interp[side].kept} of ${artifact.interp[side].found} ` +
      `span.sc-interp — not bare wrappers (extra class/id/hook/style), so they stay in the comparison`);
if (artifact.verdict === "PASS") {
  console.log(
    `STYLE PARITY OK (${where}) — ${counts}; 0 mismatches${ruled.length ? `, ${ruled.length} ruled diff(s)` : ""}` +
      `${exempt.length ? `, ${exempt.length} ruled exemption(s)` : ""}` +
      `${reexpressed.elements.length ? `, ${reexpressed.elements.length} re-expressed` : ""} → ${out}`
  );
  for (const e of exempt) console.log(exemptLine(e));
  for (const r of reexpressed.regions) console.log(pinLine(r));
  for (const e of reexpressed.elements) console.log(reexpressedLine(e));
  process.exit(0);
}
console.error(
  `STYLE PARITY FAIL (${where}) — ${counts}; ${mismatches.length} mismatch(es), ${missing.length} missing element(s), ` +
    `${divergent.length} structurally divergent, ${coverage.length} coverage failure(s)` +
    `${exempt.length ? `, ${exempt.length} ruled exemption(s)` : ""}` +
    `${reexpressed.elements.length ? `, ${reexpressed.elements.length} re-expressed` : ""}` +
    `${reexpressed.mismatches.length ? `, ${reexpressed.mismatches.length} re-expressed mismatch(es)` : ""}` +
    `${reexpressed.unpaired.length ? `, ${reexpressed.unpaired.length} UNPAIRED re-expression(s)` : ""}` +
    `${reexpressed.pinFailures.length ? `, ${reexpressed.pinFailures.length} BROKEN PIN(S)` : ""} → ${out}`
);
for (const c of coverage) console.error(`  COVERAGE: ${c} — this comparison certifies nothing`);
// Loudest first: a broken pin means the gate's own tripwire tripped, and every number below it
// describes a run that may be classifying elements it no longer has a licence to classify.
for (const p of reexpressed.pinFailures) console.error(`  PIN BROKEN: ${p}`);
for (const u of reexpressed.unpaired) console.error(`  UNPAIRED ${u.selector} (${u.d} · ${u.transform}): ${u.why}`);
for (const m of reexpressed.mismatches)
  console.error(`  REEXPRESSED MISMATCH ${m.selector} ${m.property}: mock ${JSON.stringify(m.mock)} !== ` +
    `served ${JSON.stringify(m.served)} (${m.d} · ${m.transform}) — the pair was ruled equivalent, its design is not`);
for (const e of exempt) console.error(exemptLine(e));
for (const r of reexpressed.regions) console.error(pinLine(r));
for (const e of reexpressed.elements) console.error(reexpressedLine(e));
for (const d of divergent.slice(0, 20))
  console.error(
    `  DIVERGENT [${d.join}] ${d.selector} (<${d.tag}> at ${d.path}): children mock [${d.mock.children}] !== served [${d.served.children}]` +
      (d.mock.text === d.served.text ? "" : `; own text ${JSON.stringify(d.mock.text)} !== ${JSON.stringify(d.served.text)}`)
  );
for (const m of missing.slice(0, 20)) console.error(`  MISSING on ${m.absentFrom}: ${m.selector} (<${m.tag}> at ${m.path})`);
for (const m of mismatches.slice(0, 40)) console.error(`  ${m.selector} [${m.join}] ${m.property}: mock ${JSON.stringify(m.mock)} !== served ${JSON.stringify(m.served)}`);
if (missing.length > 20 || mismatches.length > 40 || divergent.length > 20) console.error(`  … full list in ${out}`);
process.exit(1);
