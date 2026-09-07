#!/usr/bin/env node
// S2 — compile public/v2/template.dc.html to plain JS render functions.
//
//   node tools/dc-compile.mjs           write app.js / logic.js / props.json / index.html
//   node tools/dc-compile.mjs --check   exit 1 when any generated file is stale
//
// The markup is parsed inside headless Chromium (`template.innerHTML`) after
// dc-runtime's own `encodeCase` preprocessing, so the parse is byte-for-byte the
// parse the runtime performs. The walk mirrors src/compile.ts: `sc-if` / `sc-for`
// tags, `{{ }}` holes via the ported `compileAttr`/`resolve`, `style-<pseudo>`
// classes allocated in document order, `class`/`for`/`on*` renames.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const R = (...p) => path.join(ROOT, ...p);
const CHECK = process.argv.includes("--check");
const fail = (m) => { console.error("dc-compile: " + m); process.exit(1); };
const sha = (s) => createHash("sha256").update(s).digest("hex");

// ---------------------------------------------------------------- extraction
const SRC = readFileSync(R("public/v2/template.dc.html"), "utf8");

// <x-dc> body, sliced from the raw text exactly like dc-runtime's parseDcText
// (L36-53). That is the version the runtime ends up compiling: boot() re-fetches
// the page and calls updateHtml() with this raw slice, so camelCase attribute
// names survive into encodeCase instead of being lowercased by a first parse.
const open = /<x-dc(?:\s[^>]*)?>/.exec(SRC);
if (!open) fail("<x-dc> not found");
const closeAt = SRC.lastIndexOf("</x-dc>");
if (closeAt === -1 || closeAt < open.index) fail("</x-dc> not found");
const INNER = SRC.slice(open.index + open[0].length, closeAt);

// script[data-dc-script]: located by tag, never by line number, and round-tripped.
const scriptOpen = /<script(?=[^>]*\sdata-dc-script)[^>]*>/.exec(SRC);
if (!scriptOpen) fail("script[data-dc-script] not found");
const bodyFrom = scriptOpen.index + scriptOpen[0].length;
const bodyTo = SRC.indexOf("</script>", bodyFrom);
if (bodyTo === -1) fail("unterminated data-dc-script");
const LOGIC = SRC.slice(bodyFrom, bodyTo);
const roundTrip = SRC.slice(0, bodyFrom) + LOGIC + SRC.slice(bodyTo);
if (roundTrip !== SRC) fail("logic round trip is not byte-identical");
const openTagLine = SRC.slice(0, scriptOpen.index).split("\n").length;
const closeTagLine = SRC.slice(0, bodyTo).split("\n").length;

// helmet children go into the shell's <head> verbatim: they are raw and never walked.
const helmet = /<helmet>([\s\S]*?)<\/helmet>/.exec(INNER);
if (!helmet) fail("<helmet> not found");

// ------------------------------------------------------------------------ T3
// The seed data moves out of the logic into public/v2/fixture.js so the L2-L10
// slices can swap it with FD.setData(). Literals are MOVED, never retyped: each
// one is sliced out by a balanced scan and written to the fixture byte-for-byte.
const T3_NAMES = ["regData", "busSessions", "busGroups", "seedThreads", "orgScopeData",
  "keyRows", "accounts", "machines", "dsData", "tiles", "groups", "titles", "termLinesFor"];

// Balanced scan that skips strings, template literals, regexes-as-strings and comments.
function literalEnd(src, from) {
  const openCh = src[from];
  const close = openCh === "[" ? "]" : "}";
  let depth = 0;
  for (let i = from; i < src.length; i++) {
    const c = src[i];
    if (c === "'" || c === '"' || c === "`") {
      const q = c;
      for (i++; i < src.length; i++) {
        if (src[i] === "\\") { i++; continue; }
        if (src[i] === q) break;
      }
      continue;
    }
    if (c === "/" && src[i + 1] === "/") { i = src.indexOf("\n", i); if (i === -1) return -1; continue; }
    if (c === "/" && src[i + 1] === "*") { i = src.indexOf("*/", i + 2); if (i === -1) return -1; i++; continue; }
    if (c === "[" || c === "{" || c === "(") depth++;
    else if (c === "]" || c === "}" || c === ")") { depth--; if (depth === 0) return c === close ? i + 1 : -1; }
  }
  return -1;
}

// A literal is movable only if, once strings and comments are gone, it contains no
// identifier that is not a property key — anything else is a closure over a local
// (chipTone, dot, bar, mSec, t, leaf, L) and must stay in the logic.
function isPureData(lit) {
  let bare = "";
  for (let i = 0; i < lit.length; i++) {
    const c = lit[i];
    if (c === "'" || c === '"' || c === "`") {
      const q = c;
      for (i++; i < lit.length; i++) { if (lit[i] === "\\") { i++; continue; } if (lit[i] === q) break; }
      bare += '""';
      continue;
    }
    if (c === "/" && lit[i + 1] === "/") { i = lit.indexOf("\n", i); if (i === -1) break; continue; }
    if (c === "/" && lit[i + 1] === "*") { i = lit.indexOf("*/", i + 2); if (i === -1) break; i++; continue; }
    bare += c;
  }
  const re = /([A-Za-z_$][A-Za-z0-9_$]*)(\s*:)?/g;
  let m;
  while ((m = re.exec(bare))) {
    if (m[2]) continue;                                   // property key
    if (m[1] === "true" || m[1] === "false" || m[1] === "null") continue;
    return false;
  }
  return true;
}

const subs = [], skipped = [];
let LOGIC_OUT = LOGIC;
for (const name of T3_NAMES) {
  // The anchor must be unique: `accounts` and `machines` are also keys inside the
  // `titles` map, and substituting the wrong one silently swaps a screen's heading.
  const decl = new RegExp("(^[ \\t]*)(const " + name + " = |" + name + ": )", "gm");
  const hits = [...LOGIC_OUT.matchAll(decl)];
  if (!hits.length) { skipped.push([name, "no declaration found"]); continue; }
  if (hits.length > 1) {
    skipped.push([name, "ambiguous — " + hits.length + " declarations at lines " +
      hits.map((x) => LOGIC_OUT.slice(0, x.index).split("\n").length).join(", ") + "; left in place"]);
    continue;
  }
  const m = hits[0];
  const from = m.index + m[0].length;
  if (LOGIC_OUT[from] !== "[" && LOGIC_OUT[from] !== "{") {
    skipped.push([name, "value is not an array/object literal (starts `" + LOGIC_OUT.slice(from, from + 24).split("\n")[0] + "`)"]);
    continue;
  }
  const to = literalEnd(LOGIC_OUT, from);
  if (to === -1) { skipped.push([name, "unbalanced literal"]); continue; }
  const lit = LOGIC_OUT.slice(from, to);
  if (!isPureData(lit)) { skipped.push([name, "literal closes over locals in the logic — left in place"]); continue; }
  subs.push({ name, out: m[0] + lit, in: m[0] + "FD.fixture." + name, lit });
  LOGIC_OUT = LOGIC_OUT.slice(0, from) + "FD.fixture." + name + LOGIC_OUT.slice(to);
}

const FIXTURE = `/* GENERATED by tools/dc-compile.mjs from public/v2/template.dc.html — do not edit.
 * The mock's seed data, moved out of the logic byte-for-byte and in source order.
 * Swap any entry at runtime with FD.setData("<name>", value). */
window.FD = window.FD || {};
FD.fixture = Object.assign(FD.fixture || {}, {
${subs.map((x) => "  " + x.name + ": " + x.lit + ",").join("\n")}
});
`;

const T3REPORT = `S2 / T3 — seed data moved from logic.js to fixture.js
generated by tools/dc-compile.mjs

logic.js after substitution   ${LOGIC_OUT.length} bytes (was ${LOGIC.length})
fixture.js                    ${FIXTURE.length} bytes
substitutions                 ${subs.length} of ${T3_NAMES.length}

${subs.map((x) => `--- ${x.name} -------------------------------------------------------------
OUT (${x.out.length} bytes, moved verbatim into fixture.js):
${x.out}
IN:
${x.in}
`).join("\n")}
${skipped.length ? "NOT SUBSTITUTED\n" + skipped.map(([n, why]) => "  " + n + ": " + why).join("\n") + "\n" : ""}`;


// ------------------------------------------------------------------- browser
const RUNTIME_SRC = readFileSync(R("public/v2/runtime.js"), "utf8");

async function compileInBrowser(walker, inner, scriptOpenTag) {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent("<!doctype html><html><head></head><body></body></html>");
    await page.addScriptTag({ content: RUNTIME_SRC });
    await page.addScriptTag({ content: walker });
    return await page.evaluate(({ src, tag }) => window.__dcCompile(src, tag), { src: inner, tag: scriptOpenTag });
  } finally {
    await browser.close();
  }
}

// The walker runs in the page (it needs a real HTML parser and window.DC's ported
// helpers). Serialised as a function body appended to runtime.js's exports.
const WALKER = `window.__dcCompile = ${String(function (src, scriptTag) {
  const D = window.DC;
  const CAMEL_ATTR = "sc-camel-";
  const RAW_WRAP = { select: "sc-raw-select", table: "sc-raw-table", tbody: "sc-raw-tbody",
    thead: "sc-raw-thead", tfoot: "sc-raw-tfoot", tr: "sc-raw-tr", td: "sc-raw-td",
    th: "sc-raw-th", caption: "sc-raw-caption" };
  const RAW_UNWRAP = Object.fromEntries(Object.entries(RAW_WRAP).map(([k, v]) => [v, k]));
  const ATTRS = `(?:[^>"']|"[^"]*"|'[^']*')*`;
  const IMPORT_SELF_CLOSE_RE = new RegExp("<(x-import|dc-import)(" + ATTRS + ")/>", "gi");
  const CAMEL_ATTR_RE = /(\s)([a-z]+[A-Z][A-Za-z0-9]*)(\s*=)/g;

  // src/encode.ts L360-388, verbatim
  function encodeCase(html) {
    html = html.replace(IMPORT_SELF_CLOSE_RE, (_, t, a) => "<" + t + a + "></" + t + ">");
    html = html.replace(/<helmet(\s|>)/gi, "<sc-helmet$1");
    html = html.replace(/<\/helmet\s*>/gi, "</sc-helmet>");
    html = html.replace(CAMEL_ATTR_RE,
      (_, sp, name, eq) => sp + CAMEL_ATTR + name.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase()) + eq);
    for (const [real, alias] of Object.entries(RAW_WRAP))
      html = html.replace(new RegExp("(</?)" + real + "(?=[\\s>])", "gi"), "$1" + alias);
    return html;
  }

  const J = JSON.stringify;
  const getters = new Map();   // raw attr value -> aN
  const pseudos = new Map();   // "pseudo|css"   -> { v: pN, pseudo, css }
  const G = (raw) => {
    let v = getters.get(raw);
    if (!v) { v = "a" + getters.size; getters.set(raw, v); }
    return v;
  };
  const allocPseudo = (pseudo, css) => {
    const k = pseudo + "|" + css;
    let hit = pseudos.get(k);
    if (!hit) { hit = { v: "p" + pseudos.size, pseudo, css }; pseudos.set(k, hit); }
    return hit.v;
  };

  const tpl = document.createElement("template");
  tpl.innerHTML = encodeCase(src);
  // compileTemplate L470-477: preorder stamp of every element, before any walking.
  // `nid` is ours — a stable reconciliation key for every node, text included.
  let tplN = 0, nid = 0;
  (function stamp(node) {
    if (node.nodeType === Node.ELEMENT_NODE) node.__tpl = tplN++;
    node.__nid = nid++;
    for (const c of node.childNodes) stamp(c);
  })(tpl.content);

  const isStatic = (raw) => !raw.includes("{{");
  const realTagOf = (tag) => RAW_UNWRAP[tag] || tag;
  const styleObj = (css) => {
    const o = D.cssToObj(css);
    return "{" + Object.keys(o).map((k) => J(k) + ": " + J(o[k])).join(", ") + "}";
  };

  function emitChildren(node, s, ind) {
    const out = [];
    for (const c of node.childNodes) {
      const e = emit(c, s, ind);
      if (e !== null) out.push(ind + e);
    }
    return out;
  }
  const arr = (items, ind) => items.length ? "[\n" + items.join(",\n") + "\n" + ind.slice(2) + "]" : "[]";

  function emitText(node, s) {
    const txt = node.nodeValue ?? "";
    // walkText L570-575
    if (!txt.includes("{{")) {
      if (!txt.trim() && !txt.includes(" ")) return null;
      return "t(" + s.k + "+" + J("|" + node.__nid) + ", " + J(txt) + ")";
    }
    const parts = txt.split(/\{\{([\s\S]+?)\}\}/g);
    return "I(" + s.k + "+" + J("|" + node.__nid) + ", " + s.v + ", [" + parts.map(J).join(", ") + "])";
  }

  function emit(node, s, ind) {
    if (node.nodeType === Node.TEXT_NODE) return emitText(node, s);
    if (node.nodeType !== Node.ELEMENT_NODE) return null;
    const el = node;
    const tag = el.localName;
    if (tag === "sc-helmet") return null;             // head side effect only, no body node
    const key = s.k + "+" + J("|" + el.__nid);

    if (tag === "sc-if") {                            // walkIf L646-660
      const raw = el.getAttribute("value") || "";
      const cond = isStatic(raw) ? J(raw) : G(raw) + "(" + s.v + ")";
      return "(" + cond + " ? " + arr(emitChildren(el, s, ind + "  "), ind + "  ") + " : null)";
    }
    if (tag === "sc-for") {                           // walkFor L611-644
      const raw = el.getAttribute("list") || "";
      const list = isStatic(raw) ? J(raw) : G(raw) + "(" + s.v + ")";
      const asName = el.getAttribute("as") || "item";
      const d = s.d + 1, sub = { v: "v" + d, k: "k" + d, d };
      const body = arr(emitChildren(el, sub, ind + "  "), ind + "  ");
      return "A(" + list + ").map(function (it, i) { var " + sub.v + " = O(" + s.v + ", " + J(asName) +
        ", it, i), " + sub.k + " = " + s.k + "+" + J("/" + el.__nid + ":") + "+i;\n" +
        ind + "  return " + body + ";\n" + ind + "})";
    }

    // walkElement L784-815 + collectProps L415-443
    const isSvg = el.namespaceURI === "http://www.w3.org/2000/svg";
    const props = [["key", key], ["data-dc-tpl", J(String(el.__tpl))]];
    const pseudoVars = [], tail = [];
    for (const { name, value } of [...el.attributes]) {
      if (name === "sc-name" || name === "data-dc-tpl") continue;
      let k = name;
      const camel = k.startsWith(CAMEL_ATTR);
      if (camel) k = D.kebabToCamel(k.slice(CAMEL_ATTR.length));
      if (k === "hint-size") continue;
      if (k.startsWith("style-")) { pseudoVars.push(allocPseudo(k.slice(6), value)); continue; }
      if (k === "class") k = "className";
      else if (k === "for") k = "htmlFor";
      else if (k.startsWith("on")) k = D.EVENT_MAP[k] || "on" + k[2].toUpperCase() + k.slice(3);
      let js;
      if (!isStatic(value)) js = G(value) + "(" + s.v + ")";
      else if (k === "style") js = styleObj(value);
      else js = J(value);
      // Attribute ORDER, matching pass 1. dc-runtime compiles the template twice: once
      // from the already-parsed document (camelCase attribute names lowercased, so React
      // discards them or names them differently) and once from the raw text. A camelCase
      // attribute therefore only reaches the DOM on the second pass, i.e. after every
      // plain attribute and after className. SVG keeps source order (those subtrees are
      // remounted on the second pass, so pass 1 shows them unreordered).
      const at = props.findIndex((p) => p[0] === k);
      if (at >= 0) props[at][1] = js;
      else if (camel && !isSvg) tail.push([k, js]);
      else props.push([k, js]);
    }
    if (pseudoVars.length) {
      const at = props.findIndex((p) => p[0] === "className");
      const list = (at >= 0 ? [props[at][1]] : []).concat(pseudoVars);
      const js = at >= 0 ? "[" + list.join(", ") + '].filter(Boolean).join(" ")' : pseudoVars.join(' + " " + ');
      if (at >= 0) props[at][1] = js; else props.push(["className", js]);
    }
    props.push(...tail);
    // React's ReactDOMInput/Textarea/Select getHostProps blanks `value`/`checked` during
    // the initial property pass and writes them back in postMountWrapper, so they always
    // serialise last on a form control.
    if (realTagOf(tag) === "input" || realTagOf(tag) === "textarea" || realTagOf(tag) === "select") {
      for (const name of ["value", "checked"]) {
        const at = props.findIndex((p) => p[0] === name);
        if (at >= 0) props.push(props.splice(at, 1)[0]);
      }
    }
    const p = "{ " + props.map(([k, v]) => (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(k) ? k : J(k)) + ": " + v).join(", ") + " }";
    const realTag = realTagOf(tag);
    const tagJs = J(el.namespaceURI === "http://www.w3.org/2000/svg" ? "svg|" + realTag : realTag);
    const kids = emitChildren(el, s, ind + "  ");
    if (!kids.length) return "h(" + tagJs + ", " + p + ")";
    return "h(" + tagJs + ", " + p + ",\n" + kids.join(",\n") + "\n" + ind + ")";
  }

  const top = emitChildren(tpl.content, { v: "v", k: "k", d: 0 }, "    ");

  // data-props: decoded by the HTML parser itself, never by a hand-rolled entity table.
  const st = document.createElement("template");
  st.innerHTML = scriptTag + "</script>";
  const propsRaw = st.content.querySelector("script").getAttribute("data-props");

  return {
    top: top.join(",\n"),
    getters: [...getters.keys()].map((raw, i) => "a" + i + " = C(" + J(raw) + ")"),
    pseudos: [...pseudos.values()].map((x) => x.v + " = P(" + J(x.pseudo) + ", " + J(x.css) + ")"),
    propsRaw,
    tplN, nid,
  };
})}`;

// The nine per-screen slice files. L2..L10 map to this order, confirmed against
// docs/goals/fd-v2-l2..l4 (l2 = app shell, l3 = terminal tiles/windows, l4 = registry).
const SCREENS = ["shell", "windows", "registry", "org", "bus", "keys", "accounts", "machines", "desktop"]
  .map((name, i) => ({ name, file: name + ".js", body: `// fd-v2 L${i + 2} ${name}: owned by that slice\n` }));

// ---------------------------------------------------------------- generation
const out = await compileInBrowser(WALKER, INNER, scriptOpen[0]);
const propsMeta = JSON.parse(out.propsRaw);
const defaults = {};
for (const k of Object.keys(propsMeta)) {
  if (k[0] === "$") continue;
  const d = propsMeta[k] && propsMeta[k].default;
  if (d !== undefined) defaults[k] = d;
}

const chunk = (decls) => decls.length ? "  var " + decls.join(",\n    ") + ";\n" : "";
const APP = `/* GENERATED by tools/dc-compile.mjs from public/v2/template.dc.html — do not edit.
 * ${out.tplN} template elements, ${out.nid} nodes, ${out.getters.length} bound values,
 * ${out.pseudos.length} pseudo-class rules. Runs on public/v2/runtime.js. */
(function () {
  "use strict";
  var D = window.DC, h = D.h, t = D.t, I = D.I, A = D.A, O = D.O, C = D.C, P = D.P;
${chunk(out.pseudos)}${chunk(out.getters)}  var PROPS = ${JSON.stringify(defaults, null, 2).replace(/\n/g, "\n  ")};

  function main(v, k) {
    return [
${out.top}
    ];
  }

  D.mount(main, PROPS);
})();
`;

const SHELL = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<!-- GENERATED by tools/dc-compile.mjs — the mock's <helmet> children, verbatim. -->
${helmet[1].trim()}
<!-- dc-runtime FULL_PAGE_CSS (boot.ts L127): kept because it drives the page height. -->
<style>html,body{height:100%;margin:0}#dc-root,#dc-root>.sc-host{height:100%}</style>
</head>
<body>
<div id="root"></div>
<script src="/v2/runtime.js"></script>
<script src="/v2/fixture.js"></script>
<script src="/v2/logic.js"></script>
<script src="/v2/app.js"></script>
${SCREENS.map((f) => '<script src="/v2/screens/' + f.file + '"></script>').join("\n")}
</body>
</html>
`;

const PROOF = `S2 — data-dc-script round-trip proof
generated by tools/dc-compile.mjs

source            public/v2/template.dc.html
source bytes      ${SRC.length}
source sha256     ${sha(SRC)}

script open tag   line ${openTagLine} (located by /<script(?=[^>]*\\sdata-dc-script)[^>]*>/, not by line number)
</script>         line ${closeTagLine + 1}
body bytes        ${LOGIC.length}
body sha256       ${sha(LOGIC)}
logic.js sha256   ${sha(LOGIC)}

round trip        template.slice(0, bodyFrom) + logic.js + template.slice(bodyTo)
result            IDENTICAL to the source (${roundTrip.length} bytes, sha256 ${sha(roundTrip)})
diff              (empty — 0 differing bytes)

T3 substitution   ${subs.length} seed literal(s) moved to public/v2/fixture.js after the round-trip
                  check above; see t3-substitutions.txt for every OUT -> IN pair.
logic.js emitted  ${LOGIC_OUT.length} bytes, sha256 ${sha(LOGIC_OUT)}
`;

const files = [
  ["public/v2/app.js", APP],
  ["public/v2/fixture.js", FIXTURE],
  ["public/v2/logic.js", LOGIC_OUT],
  ["public/v2/props.json", JSON.stringify(propsMeta, null, 2) + "\n"],
  ["public/v2/index.html", SHELL],
  ["docs/design/fleetdeck-v2/verify/S2/logic-roundtrip.txt", PROOF],
  ["docs/design/fleetdeck-v2/verify/S2/t3-substitutions.txt", T3REPORT],
  ...SCREENS.map((f) => ["public/v2/screens/" + f.file, f.body]),
];

let stale = 0;
for (const [rel, body] of files) {
  const abs = R(rel);
  const same = existsSync(abs) && readFileSync(abs, "utf8") === body;
  if (CHECK) {
    if (!same) { stale++; console.error("stale: " + rel); }
    continue;
  }
  mkdirSync(path.dirname(abs), { recursive: true });
  if (!same) writeFileSync(abs, body);
  console.log(`${same ? "unchanged" : "wrote    "} ${rel} (${body.length} bytes)`);
}
if (CHECK) {
  if (stale) fail(stale + " generated file(s) stale versus template.dc.html — run `npm run v2:compile`");
  console.log("dc-compile: all generated files current");
}
