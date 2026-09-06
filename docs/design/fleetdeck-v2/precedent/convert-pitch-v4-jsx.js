#!/usr/bin/env node
// S2 (VIB-248): mechanically convert the S1 template to JSX.
//
// Usage:
//   PATH="/opt/homebrew/bin:$PATH" node server/scripts/convert-pitch-v4-jsx.js [repo-root]
//
// Reads src/pitch-v4/pitch-mobile.template.html, applies the same documented wrapper
// swap as build-pitch-v4.js, parses the markup with a real browser DOM (headless
// Chrome via puppeteer-core — byte-identical parsing to the runtime), and emits:
//
//   src/pitch-v4/pitch-mobile.view.jsx    dcRender(V) — the whole template as JSX
//   src/pitch-v4/pitch-mobile.pseudo.css  style-hover/style-focus rules as .scpN
//                                         classes (same names/order the runtime's
//                                         createPseudoSheet would generate)
//   src/pitch-v4/pitch-mobile.helmet.css  the helmet's base <style> block
//
// The transform mirrors vendor/dc-runtime.js compile semantics exactly:
//   {{ expr }} in text  -> {I(expr)}  (span.sc-interp wrapper, element/array/null rules)
//   {{ expr }} DSL      -> nil-safe JS (optional chaining), ==/!=/===/!==, !, literals
//   style="..."         -> static: precompiled object; bound: S(`...`) (cssToObj)
//   sc-if               -> {(cond) ? <>…</> : null}
//   sc-for list as      -> {A(list).map((as, $index) => <Fragment key={$index}>…)}
//   class/for/on*       -> className/htmlFor/EVENT_MAP React names
//   camelCase attrs     -> restored from sc-camel-* (viewBox, refX, onScroll, …)
//   value/checked       -> undefined coerced to ""/false (runtime walkElement rule)
//   style-<pseudo>      -> generated .scpN class appended to className
//
// KNOWN DEVIATION (documented in qa-shots/s2/QA-NOTES.md): the runtime remounts
// elements whose inline-only text content changed (contentKey suffix) — an
// editor/streaming artifact; the JSX version updates text in place (plain React).

const fs = require("fs");
const path = require("path");

// --- browser-side conversion ------------------------------------------------------------
const CONVERT = String(function convert(src) {
  // ported from dc-runtime encode.ts (unminified, byte-equivalent transforms)
  const CAMEL_ATTR = "sc-camel-";
  const RAW_WRAP = { select: "sc-raw-select", table: "sc-raw-table", tbody: "sc-raw-tbody",
    thead: "sc-raw-thead", tfoot: "sc-raw-tfoot", tr: "sc-raw-tr", td: "sc-raw-td",
    th: "sc-raw-th", caption: "sc-raw-caption" };
  const RAW_UNWRAP = Object.fromEntries(Object.entries(RAW_WRAP).map(([k, v]) => [v, k]));
  const EVENT_MAP = { onclick: "onClick", onchange: "onChange", oninput: "onInput",
    onsubmit: "onSubmit", onkeydown: "onKeyDown", onkeyup: "onKeyUp", onkeypress: "onKeyPress",
    onmousedown: "onMouseDown", onmouseup: "onMouseUp", onmouseenter: "onMouseEnter",
    onmouseleave: "onMouseLeave", onfocus: "onFocus", onblur: "onBlur",
    ondoubleclick: "onDoubleClick", oncontextmenu: "onContextMenu", onmousemove: "onMouseMove",
    onmouseover: "onMouseOver", onmouseout: "onMouseOut", onpointerdown: "onPointerDown",
    onpointerup: "onPointerUp", onpointermove: "onPointerMove", onpointerenter: "onPointerEnter",
    onpointerleave: "onPointerLeave", onpointercancel: "onPointerCancel",
    onpointerover: "onPointerOver", onpointerout: "onPointerOut",
    ongotpointercapture: "onGotPointerCapture", onlostpointercapture: "onLostPointerCapture",
    ontouchstart: "onTouchStart", ontouchend: "onTouchEnd", ontouchmove: "onTouchMove",
    ontouchcancel: "onTouchCancel", ondragstart: "onDragStart", ondragend: "onDragEnd",
    ondragenter: "onDragEnter", ondragleave: "onDragLeave", ondragover: "onDragOver",
    onanimationstart: "onAnimationStart", onanimationend: "onAnimationEnd",
    onanimationiteration: "onAnimationIteration", ontransitionend: "onTransitionEnd" };
  const kebabToCamel = (s) => s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
  function encodeCase(html) {
    html = html.replace(/<helmet(\s|>)/gi, "<sc-helmet$1").replace(/<\/helmet\s*>/gi, "</sc-helmet>");
    html = html.replace(/(\s)([a-z]+[A-Z][A-Za-z0-9]*)(\s*=)/g,
      (_, sp, name, eq) => sp + CAMEL_ATTR + name.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase()) + eq);
    for (const [real, alias] of Object.entries(RAW_WRAP))
      html = html.replace(new RegExp("(</?)" + real + "(?=[\\s>])", "gi"), "$1" + alias);
    return html;
  }

  // ---- expression DSL -> JS (mirrors expr.ts resolve/resolvePath, nil-safe) ----
  const IDENT_RE = /^[A-Za-z_$][A-Za-z0-9_$]*/;
  const NUMBER_RE = /^-?\d+(\.\d+)?$/;
  function parensWrapWhole(e) {
    let d = 0;
    for (let i = 0; i < e.length - 1; i++) {
      if (e[i] === "(") d++;
      else if (e[i] === ")") { d--; if (d === 0) return false; }
    }
    return true;
  }
  function findEq(e) {
    let d = 0;
    for (let i = 0; i < e.length; i++) {
      const c = e[i];
      if (c === "[" || c === "(") d++;
      else if (c === "]" || c === ")") d--;
      else if (d === 0 && (c === "=" || c === "!") && e[i + 1] === "=") {
        if (i > 0 && (e[i - 1] === "=" || e[i - 1] === "!")) continue;
        if (!e.slice(0, i).trim()) continue;
        return { index: i, op: e[i + 2] === "=" ? c + "==" : c + "=" };
      }
    }
    return null;
  }
  function compileExpr(src, scope) {
    const e = String(src).trim();
    if (!e) return "undefined";
    if (e[0] === "(" && e[e.length - 1] === ")" && parensWrapWhole(e))
      return "(" + compileExpr(e.slice(1, -1), scope) + ")";
    const eq = findEq(e);
    if (eq)
      return "(" + compileExpr(e.slice(0, eq.index), scope) + " " + eq.op + " " +
        compileExpr(e.slice(eq.index + eq.op.length), scope) + ")";
    if (e[0] === "!") return "!(" + compileExpr(e.slice(1), scope) + ")";
    if (["true", "false", "null", "undefined"].includes(e)) return e;
    if (NUMBER_RE.test(e)) return e;
    if (e.length >= 2 && (e[0] === '"' || e[0] === "'") && e[e.length - 1] === e[0])
      return JSON.stringify(e.slice(1, -1));
    // path
    const head = e.match(IDENT_RE);
    if (!head) return "undefined";
    let out = scope.has(head[0]) ? head[0] : "V." + head[0];
    let i = head[0].length;
    while (i < e.length) {
      if (e[i] === ".") {
        const m = e.slice(i + 1).match(IDENT_RE) || e.slice(i + 1).match(/^\d+/);
        if (!m) return "undefined";
        out += "?." + (/^\d/.test(m[0]) ? "[" + m[0] + "]" : m[0]);
        i += 1 + m[0].length;
      } else if (e[i] === "[") {
        let d = 1, j = i + 1;
        while (j < e.length && d > 0) {
          if (e[j] === "[") d++;
          else if (e[j] === "]") { d--; if (d === 0) break; }
          j++;
        }
        if (d !== 0) return "undefined";
        out += "?.[" + compileExpr(e.slice(i + 1, j), scope) + "]";
        i = j + 1;
      } else return "undefined";
    }
    return out;
  }
  // attr value -> {kind:'static'|'whole'|'mixed', js}
  function compileAttrSrc(raw, scope) {
    const whole = raw.match(/^\s*\{\{([\s\S]+?)\}\}\s*$/);
    if (whole) return { kind: "whole", js: compileExpr(whole[1], scope) };
    if (raw.includes("{{")) {
      const parts = raw.split(/\{\{([\s\S]+?)\}\}/g);
      const tpl = parts
        .map((s, i) => (i & 1 ? "${(" + compileExpr(s, scope) + ") ?? \"\"}" : s.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${")))
        .join("");
      return { kind: "mixed", js: "`" + tpl + "`" };
    }
    return { kind: "static", js: raw };
  }
  function cssToObjSrc(css) {
    const props = [];
    for (const decl of css.split(";")) {
      const i = decl.indexOf(":");
      if (i < 0) continue;
      const prop = decl.slice(0, i).trim();
      const key = prop.startsWith("--") ? prop : kebabToCamel(prop);
      props.push(JSON.stringify(key) + ": " + JSON.stringify(decl.slice(i + 1).trim()));
    }
    return "{" + props.join(", ") + "}";
  }

  // pseudo classes — same naming scheme/order as createPseudoSheet
  const pseudoCache = new Map();
  const pseudoRules = [];
  function pseudoClass(pseudo, css) {
    const k = pseudo + "|" + css;
    if (pseudoCache.has(k)) return pseudoCache.get(k);
    const cls = "scp" + pseudoCache.size.toString(36);
    const sel = pseudo === "before" || pseudo === "after" ? "." + cls + "::" + pseudo : "." + cls + ":" + pseudo;
    pseudoRules.push(sel + "{" + css + "}");
    pseudoCache.set(k, cls);
    return cls;
  }

  const VOID = new Set("area base br col embed hr img input link meta param source track wbr".split(" "));
  const jsxText = (s) => "{" + JSON.stringify(s) + "}";

  function emitText(node, scope, out, ind) {
    const txt = node.nodeValue ?? "";
    if (!txt.includes("{{")) {
      if (!txt.trim() && !txt.includes(" ")) return; // runtime drops newline-only nodes
      out.push(ind + jsxText(txt));
      return;
    }
    const parts = txt.split(/\{\{([\s\S]+?)\}\}/g);
    const bits = parts
      .map((p, i) => (i & 1 ? "{I(" + compileExpr(p, scope) + ")}" : p ? jsxText(p) : ""))
      .filter(Boolean);
    out.push(ind + bits.join(""));
  }

  function attrJsx(el, scope) {
    const attrs = [];
    const pseudos = [];
    for (const { name, value } of [...el.attributes]) {
      if (name === "sc-name" || name === "data-dc-tpl") continue;
      let key = name;
      if (key.startsWith(CAMEL_ATTR)) key = kebabToCamel(key.slice(CAMEL_ATTR.length));
      if (key === "hint-size") continue;
      if (key.startsWith("style-")) { pseudos.push(pseudoClass(key.slice(6), value)); continue; }
      if (key === "class") key = "className";
      else if (key === "for") key = "htmlFor";
      else if (/^on[a-z]/.test(key)) key = EVENT_MAP[key] || "on" + key[2].toUpperCase() + key.slice(3);
      const a = compileAttrSrc(value, scope);
      if (key === "style") {
        attrs.push(["style", a.kind === "static" ? cssToObjSrc(a.js) : "S(" + a.js + ")"]);
      } else if (key === "value" || key === "checked") {
        const fb = key === "checked" ? "false" : '""';
        attrs.push([key, a.kind === "static" ? JSON.stringify(a.js)
          : "((" + a.js + ") === undefined ? " + fb + " : (" + a.js + "))"]);
      } else if (a.kind === "static") {
        attrs.push([key, JSON.stringify(a.js)]);
      } else {
        attrs.push([key, "(" + a.js + ")"]);
      }
    }
    if (pseudos.length) {
      const cn = attrs.find(([k]) => k === "className");
      const extra = pseudos.join(" ");
      if (!cn) attrs.push(["className", JSON.stringify(extra)]);
      else if (cn[1].startsWith('"')) cn[1] = JSON.stringify(JSON.parse(cn[1]) + " " + extra);
      else cn[1] = "[(" + cn[1] + "), " + JSON.stringify(extra) + "].filter(Boolean).join(\" \")";
    }
    return attrs
      .map(([k, v]) => (v.startsWith('"') && !k.startsWith("on") && k !== "style" && k !== "ref"
        ? k + "=" + v
        : k + "={" + v + "}"))
      .join(" ");
  }

  function emit(node, scope, out, ind) {
    if (node.nodeType === Node.TEXT_NODE) return emitText(node, scope, out, ind);
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node;
    // localName, NOT tagName.toLowerCase(): SVG-namespace tags are case-adjusted by
    // the HTML parser (clipPath, linearGradient, …) and the runtime renders localName
    const tag = el.localName;
    if (tag === "sc-helmet") return; // handled statically in the entry head
    if (tag === "sc-if") {
      const cond = compileExpr((el.getAttribute("value") || "").replace(/^\s*\{\{|\}\}\s*$/g, ""), scope);
      out.push(ind + "{(" + cond + ") ? <React.Fragment>");
      for (const c of el.childNodes) emit(c, scope, out, ind + "  ");
      out.push(ind + "</React.Fragment> : null}");
      return;
    }
    if (tag === "sc-for") {
      const listExpr = compileExpr((el.getAttribute("list") || "").replace(/^\s*\{\{|\}\}\s*$/g, ""), scope);
      const asName = el.getAttribute("as") || "item";
      const sub = new Set(scope); sub.add(asName); sub.add("$index");
      out.push(ind + "{A(" + listExpr + ").map((" + asName + ", $index) => <React.Fragment key={$index}>");
      for (const c of el.childNodes) emit(c, sub, out, ind + "  ");
      out.push(ind + "</React.Fragment>)}");
      return;
    }
    const realTag = RAW_UNWRAP[tag] || tag;
    const attrs = attrJsx(el, scope);
    const open = "<" + realTag + (attrs ? " " + attrs : "");
    if (VOID.has(realTag) || !el.childNodes.length) {
      out.push(ind + open + " />");
      return;
    }
    out.push(ind + open + ">");
    for (const c of el.childNodes) emit(c, scope, out, ind + "  ");
    out.push(ind + "</" + realTag + ">");
  }

  const tpl = document.createElement("template");
  tpl.innerHTML = encodeCase(src);
  const out = [];
  const scope = new Set();
  for (const c of tpl.content.childNodes) emit(c, scope, out, "      ");
  return { jsx: out.join("\n"), pseudoCss: pseudoRules.join("\n") };
});

// Extract the <x-dc> inner markup + helmet base style from an S0 template.
// Shared by the desktop converter (which applies no wrapper swap).
function splitTemplate(page, fail) {
  const xdcStart = page.indexOf("<x-dc>");
  const xdcEnd = page.indexOf("</x-dc>");
  if (xdcStart < 0 || xdcEnd < 0) fail("x-dc not found");
  let inner = page.slice(xdcStart + 6, xdcEnd);
  const helmetM = inner.match(/<helmet>([\s\S]*?)<\/helmet>/);
  if (!helmetM) fail("helmet not found");
  const baseStyle = helmetM[1].match(/<style>\s*\n?([\s\S]*?)<\/style>\s*$/);
  if (!baseStyle) fail("helmet base style not found");
  inner = inner.replace(/<helmet>[\s\S]*?<\/helmet>/, "");
  return { inner, baseCss: baseStyle[1] };
}

// Run the browser-side CONVERT over markup in headless Chrome.
async function runConvert(puppeteer, inner) {
  const browser = await puppeteer.launch({
    executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    headless: "new",
  });
  const p = await browser.newPage();
  await p.goto("data:text/html,<title>convert</title>", { waitUntil: "load" });
  const res = await p.evaluate(
    (fnSrc, src) => new Function("return (" + fnSrc + ")")()(src),
    CONVERT,
    inner
  );
  await browser.close();
  return res;
}

module.exports = { CONVERT, splitTemplate, runConvert };

if (require.main === module) (async () => {
  const repoRoot = path.resolve(process.argv[2] || process.cwd());
  const R = (...p) => path.join(repoRoot, ...p);
  const puppeteer = require(R("node_modules/puppeteer-core"));
  const fail = (m) => { throw new Error("convert-pitch-v4-jsx: " + m); };

  // --- compose the swapped markup exactly like build-pitch-v4.js -----------------------
  const template = fs.readFileSync(R("src/pitch-v4/pitch-mobile.template.html"), "utf8");
  let lines = template.split("\n");
  const openIdx = lines.findIndex((l) => l.startsWith('<div data-screen-label="Pitch · Mobile"'));
  if (openIdx < 0) fail("wrapper open not found");
  lines.splice(
    openIdx, 6,
    '<div style="height:100dvh; box-sizing:border-box; position:relative; overflow:hidden; background:#070A1C;">'
  );
  const closeIdx = lines.findIndex((l) => l.trim() === "</x-import>");
  if (closeIdx < 0) fail("</x-import> not found");
  lines.splice(closeIdx, 3, "</div>");

  const { inner, baseCss } = splitTemplate(lines.join("\n"), fail);
  const baseStyle = [null, baseCss];
  const { jsx, pseudoCss } = await runConvert(puppeteer, inner);

  const view = `// GENERATED by server/scripts/convert-pitch-v4-jsx.js — do not edit (S2, VIB-248)
// dcRender(V): the pitch-mobile template as JSX. V = { ...props, ...logic.renderVals() }.
// Helpers (window.__dcJsx): I = text interpolation (span.sc-interp semantics),
// S = css string -> style object, A = sc-for list coercion.
function dcRender(V) {
  const { I, S, A } = window.__dcJsx;
  return (
    <React.Fragment>
${jsx}
    </React.Fragment>
  );
}
window.__pitchPorts = window.__pitchPorts || {};
window.__pitchPorts.mobile = { render: dcRender };
`;
  fs.writeFileSync(R("src/pitch-v4/pitch-mobile.view.jsx"), view);
  fs.writeFileSync(
    R("src/pitch-v4/pitch-mobile.pseudo.css"),
    "/* GENERATED by convert-pitch-v4-jsx.js — style-hover/style-focus classes (VIB-248) */\n" + pseudoCss + "\n"
  );
  fs.writeFileSync(
    R("src/pitch-v4/pitch-mobile.helmet.css"),
    "/* GENERATED by convert-pitch-v4-jsx.js — helmet base style block (VIB-248) */\n" + baseStyle[1]
  );
  console.log(
    `view.jsx ${view.length} bytes, pseudo.css ${pseudoCss.length} bytes, helmet.css ${baseStyle[1].length} bytes`
  );
})();
