/* fleetdeck v2 — pass-2 runtime shim. Plain JS, zero dependencies.
 * Replaces dc-runtime.js + React + ReactDOM + Babel for the compiled template.
 * The expression evaluator, attribute compiler, CSS helpers and event map below are
 * PORTED VERBATIM from public/v2/vendor/dc-runtime.js (line refs in the comments) so
 * that their documented bugs are reproduced, not fixed. See S2-runtime-spec.md. */
(function (global) {
  "use strict";

  /* ---- src/expr.ts L203-294 (verbatim) ---------------------------------- */
  var IDENT_RE = /^[A-Za-z_$][A-Za-z0-9_$]*/;
  var NUMBER_RE = /^-?\d+(\.\d+)?$/;
  function resolve(vals, src) {
    var expr = String(src).trim();
    if (!expr) return void 0;
    if (expr[0] === "(" && expr[expr.length - 1] === ")" && parensWrapWhole(expr)) {
      return resolve(vals, expr.slice(1, -1));
    }
    var eq = findTopLevelEquality(expr);
    if (eq) {
      var lv = resolve(vals, expr.slice(0, eq.index));
      var rv = resolve(vals, expr.slice(eq.index + eq.op.length));
      switch (eq.op) {
        case "===": return lv === rv;
        case "!==": return lv !== rv;
        case "==": return lv == rv;
        default: return lv != rv;
      }
    }
    if (expr[0] === "!") return !resolve(vals, expr.slice(1));
    if (expr === "true") return true;
    if (expr === "false") return false;
    if (expr === "null") return null;
    if (expr === "undefined") return void 0;
    if (NUMBER_RE.test(expr)) return Number(expr);
    if (expr.length >= 2 && (expr[0] === '"' || expr[0] === "'") && expr[expr.length - 1] === expr[0]) {
      return expr.slice(1, -1);
    }
    return resolvePath(vals, expr);
  }
  function parensWrapWhole(expr) {
    var depth = 0;
    for (var i = 0; i < expr.length - 1; i++) {
      if (expr[i] === "(") depth++;
      else if (expr[i] === ")") { depth--; if (depth === 0) return false; }
    }
    return true;
  }
  function findTopLevelEquality(expr) {
    var depth = 0;
    for (var i = 0; i < expr.length; i++) {
      var c = expr[i];
      if (c === "[" || c === "(") depth++;
      else if (c === "]" || c === ")") depth--;
      else if (depth === 0 && (c === "=" || c === "!") && expr[i + 1] === "=") {
        if (i > 0 && (expr[i - 1] === "=" || expr[i - 1] === "!")) continue;
        if (!expr.slice(0, i).trim()) continue;
        return { index: i, op: expr[i + 2] === "=" ? c + "==" : c + "=" };
      }
    }
    return null;
  }
  function resolvePath(vals, expr) {
    var head = expr.match(IDENT_RE);
    if (!head) return void 0;
    var cur = vals == null ? void 0 : vals[head[0]];
    var i = head[0].length;
    while (i < expr.length) {
      if (expr[i] === ".") {
        var m = expr.slice(i + 1).match(IDENT_RE) || expr.slice(i + 1).match(/^\d+/);
        if (!m) return void 0;
        cur = cur == null ? void 0 : cur[m[0]];
        i += 1 + m[0].length;
      } else if (expr[i] === "[") {
        var depth = 1, j = i + 1;
        while (j < expr.length && depth > 0) {
          if (expr[j] === "[") depth++;
          else if (expr[j] === "]") { depth--; if (depth === 0) break; }
          j++;
        }
        if (depth !== 0) return void 0;
        cur = cur == null ? void 0 : cur[resolve(vals, expr.slice(i + 1, j))];
        i = j + 1;
      } else return void 0;
    }
    return cur;
  }

  /* ---- src/encode.ts L317-409 ------------------------------------------- */
  /* EVENT_MAP (L317-358) compressed: in all 41 entries key === value.toLowerCase(),
   * so rebuilding it from the values alone is provably the same object, same order. */
  var EVENT_NAMES = ("onClick onChange onInput onSubmit onKeyDown onKeyUp onKeyPress onMouseDown onMouseUp onMouseEnter onMouseLeave onFocus onBlur onDoubleClick onContextMenu onMouseMove onMouseOver onMouseOut " +
    "onPointerDown onPointerUp onPointerMove onPointerEnter onPointerLeave onPointerCancel onPointerOver onPointerOut onGotPointerCapture onLostPointerCapture onTouchStart onTouchEnd onTouchMove onTouchCancel " +
    "onDragStart onDragEnd onDragEnter onDragLeave onDragOver onAnimationStart onAnimationEnd onAnimationIteration onTransitionEnd").split(" ");
  var EVENT_MAP = {};
  EVENT_NAMES.forEach(function (v) { EVENT_MAP[v.toLowerCase()] = v; });
  function kebabToCamel(s) { return s.replace(/-([a-z])/g, function (_, c) { return c.toUpperCase(); }); }
  function cssToObj(css) {
    var o = {};
    css.split(";").forEach(function (decl) {
      var i = decl.indexOf(":");
      if (i < 0) return;
      var prop = decl.slice(0, i).trim();
      o[prop.startsWith("--") ? prop : kebabToCamel(prop)] = decl.slice(i + 1).trim();
    });
    return o;
  }
  function compileAttr(raw) {
    var whole = raw.match(/^\s*\{\{([\s\S]+?)\}\}\s*$/);
    if (whole) { var path = whole[1]; return function (vals) { return resolve(vals, path); }; }
    if (raw.includes("{{")) {
      var parts = raw.split(/\{\{([\s\S]+?)\}\}/g);
      return function (vals) {
        return parts.map(function (s, i) { return i & 1 ? resolve(vals, s) ?? "" : s; }).join("");
      };
    }
    return function () { return raw; };
  }

  /* ---- src/pseudo.ts L1498-1588 (verbatim) ------------------------------ */
  function scanUnquotedUrl(css, i) {
    if (css[i] !== "u" && css[i] !== "U" || css.slice(i, i + 4).toLowerCase() !== "url(" || /[a-z0-9_-]/i.test(css[i - 1] ?? "")) return -1;
    var j = i + 4;
    while (j < css.length && /\s/.test(css[j])) j++;
    if (css[j] === '"' || css[j] === "'") return -1;
    while (j < css.length && css[j] !== ")") { if (css[j] === "\\") j++; j++; }
    return j < css.length ? j + 1 : css.length;
  }
  function stripComments(css) {
    var out = "", quote = "";
    for (var i = 0; i < css.length; i++) {
      var c = css[i];
      if (quote) {
        if (c === "\\") { out += c + (css[i + 1] ?? ""); i++; continue; }
        if (c === quote) quote = "";
        out += c;
      } else if (c === "'" || c === '"') { quote = c; out += c; }
      else if (c === "/" && css[i + 1] === "*") {
        var end = css.indexOf("*/", i + 2);
        i = end === -1 ? css.length : end + 1;
        out += " ";
      } else {
        var e2 = scanUnquotedUrl(css, i);
        if (e2 === -1) out += c;
        else { out += css.slice(i, e2); i = e2 - 1; }
      }
    }
    return out;
  }
  function importantify(css) {
    css = stripComments(css);
    var decls = [], start = 0, depth = 0, quote = "";
    for (var i = 0; i < css.length; i++) {
      var c = css[i];
      if (quote) { if (c === "\\") i++; else if (c === quote) quote = ""; }
      else if (c === "'" || c === '"') quote = c;
      else if (c === "(") depth++;
      else if (c === ")") depth = Math.max(0, depth - 1);
      else if (c === ";" && depth === 0) { decls.push(css.slice(start, i)); start = i + 1; }
      else { var end = scanUnquotedUrl(css, i); if (end !== -1) i = end - 1; }
    }
    decls.push(css.slice(start));
    return decls.map(function (d) { return d.trim(); }).filter(Boolean)
      .map(function (d) { return /!\s*important$/i.test(d) ? d : d + " !important"; }).join(";");
  }
  var sheetEl = null, pseudoCache = new Map(), pseudoN = 0;
  function pseudoClass(pseudo, css) {
    var k = pseudo + "|" + css, hit = pseudoCache.get(k);
    if (hit) return hit;
    if (!sheetEl) { sheetEl = document.createElement("style"); document.head.appendChild(sheetEl); }
    var cls = "scp" + (pseudoN++).toString(36);
    var isPseudoElement = pseudo === "before" || pseudo === "after";
    var sel = isPseudoElement ? "." + cls + "::" + pseudo : "." + cls + ":" + pseudo;
    sheetEl.sheet.insertRule(sel + "{" + (isPseudoElement ? css : importantify(css)) + "}", sheetEl.sheet.cssRules.length);
    pseudoCache.set(k, cls);
    return cls;
  }

  /* ---- DOM builder + keyed reconciliation -------------------------------- */
  /* Identity is the compiled key (static template path + sc-for index), so a node is
   * reused whenever tag and key match — <video> survives a re-render, refs stay stable. */
  var SVG = "http://www.w3.org/2000/svg", ATTR = { className: "class", htmlFor: "for" };
  var nodes = new Map(), pass = 0, detach = [], attach = [];

  function setRef(r, el) { if (typeof r === "function") r(el); else if (r) r.current = el; }

  function setProp(el, k, v, pv) {
    if (k === "ref") { if (pv) detach.push(pv); if (v) attach.push([v, el]); return; }
    if (k === "style") {
      if (typeof v === "string") v = cssToObj(v);
      var nv = v || {}, ov = (typeof pv === "string" ? cssToObj(pv) : pv) || {}, p;
      for (p in ov) if (!(p in nv)) { if (p.charCodeAt(0) === 45) el.style.removeProperty(p); else el.style[p] = ""; }
      for (p in nv) if (nv[p] !== ov[p]) { if (p.charCodeAt(0) === 45) el.style.setProperty(p, nv[p]); else el.style[p] = nv[p]; }
      return;
    }
    if (k.charCodeAt(0) === 111 && k.charCodeAt(1) === 110 && k[2] >= "A" && k[2] <= "Z") {
      /* React's onChange is per-keystroke on text controls; onDoubleClick is `dblclick`. */
      var type = k === "onChange" && el.tagName !== "SELECT" ? "input" : k === "onDoubleClick" ? "dblclick" : k.slice(2).toLowerCase();
      if (pv) el.removeEventListener(type, pv);
      if (typeof v === "function") el.addEventListener(type, v);
      return;
    }
    /* React's polyfill: autoFocus is never serialised, the node is focused on mount. */
    if (k === "autoFocus") { if (v && pv === void 0) attach.push([function () { el.focus(); }, el]); return; }
    if ((k === "value" || k === "checked") && v === void 0) v = k === "checked" ? false : "";
    if (k === "muted" || k === "checked" || k === "multiple" || k === "selected") { el[k] = v; return; }
    if (k === "value") {
      var s = v == null ? "" : String(v);
      if (el.value !== s) el.value = s;                    // controlled-input semantics
      if (el.tagName === "TEXTAREA") el.defaultValue = s;
      /* <option>'s value property does not reflect to the attribute, and React keeps
       * <option value> on the attribute path — so reflect it or it never serialises. */
      else if (el.tagName === "INPUT" || el.tagName === "OPTION") el.setAttribute("value", s);
      return;
    }
    var name = ATTR[k] || (el.namespaceURI === SVG ? k : k.toLowerCase());
    if (v === void 0 || v === null || v === false || typeof v === "function") el.removeAttribute(name);
    else el.setAttribute(name, v === true ? "" : v);
  }

  function h(tag, props) {
    var key = props.key, el = nodes.get(key);
    if (!el || el.__dcTag !== tag) {
      var i = tag.indexOf("|");
      el = i < 0 ? document.createElement(tag) : document.createElementNS(SVG, tag.slice(i + 1));
      el.__dcTag = tag; el.__dcProps = null; nodes.set(key, el);
    }
    el.__dcPass = pass;
    var kids = [];
    for (var a = 2; a < arguments.length; a++) flat(arguments[a], kids);
    syncChildren(el, kids);
    var prev = el.__dcProps, k;
    if (prev) for (k in prev) if (!(k in props)) setProp(el, k, void 0, prev[k]);
    for (k in props) if (k !== "key" && (!prev || props[k] !== prev[k] || k === "style")) setProp(el, k, props[k], prev ? prev[k] : void 0);
    el.__dcProps = props;
    return el;
  }

  function t(key, s) {
    var n = nodes.get(key);
    if (!n || n.nodeType !== 3) { n = document.createTextNode(s); nodes.set(key, n); }
    else if (n.data !== s) n.data = s;
    n.__dcPass = pass;
    return n;
  }

  /* Text interpolation, dc-runtime walkText L569-609: undefined/null/boolean render
   * nothing, everything else (incl. 0 and "") gets a span.sc-interp. */
  function I(key, vals, parts) {
    var out = [];
    for (var i = 0; i < parts.length; i++) {
      if (!(i & 1)) { if (parts[i]) out.push(t(key + "$" + i, parts[i])); continue; }
      var v = resolve(vals, parts[i]);
      if (v === void 0 || v === null || typeof v === "boolean") continue;
      out.push(h("span", { key: key + "$" + i, className: "sc-interp" }, t(key + "$" + i + "t", String(v))));
    }
    return out;
  }

  function A(list) { return Array.isArray(list) ? list : []; }
  /* sc-for scope, walkFor L636: flat overwrite, $index assigned last and therefore wins. */
  function O(vals, name, item, i) { var o = Object.assign({}, vals); o[name] = item; o.$index = i; return o; }

  function flat(x, out) {
    if (x == null || x === false) return out;
    if (Array.isArray(x)) { for (var i = 0; i < x.length; i++) flat(x[i], out); return out; }
    out.push(x); return out;
  }

  function syncChildren(el, kids) {
    /* React only writes children when the child set actually changes, which is why the
     * deck's imperative splitWords()/innerHTML edits survive a re-render. Same rule here:
     * an unchanged list is a no-op, foreign nodes included. */
    var last = el.__dcKids, i;
    if (last && last.length === kids.length) {
      for (i = 0; i < kids.length && last[i] === kids[i]; i++);
      if (i === kids.length) return;
    }
    el.__dcKids = kids;
    var cur = el.firstChild;
    for (i = 0; i < kids.length; i++) {
      if (cur === kids[i]) { cur = cur.nextSibling; continue; }
      el.insertBefore(kids[i], cur);
    }
    while (cur) { var next = cur.nextSibling; el.removeChild(cur); cur = next; }
  }

  function sweep() {
    nodes.forEach(function (n, k) {
      if (n.__dcPass === pass) return;
      nodes.delete(k);
      if (n.__dcProps && n.__dcProps.ref) detach.push(n.__dcProps.ref);   // unmount ref(null)
    });
  }

  /* ---- logic base class + mount ----------------------------------------- */
  function DCLogic(props) { this.props = props || {}; this.state = {}; }
  DCLogic.prototype.setState = function (update, cb) { this.__host && this.__host.__setLogicState(update, cb); };
  DCLogic.prototype.forceUpdate = function (cb) { this.__host && this.__host.forceUpdate(cb); };
  DCLogic.prototype.componentDidMount = DCLogic.prototype.componentDidUpdate = DCLogic.prototype.componentWillUnmount = function () {};
  DCLogic.prototype.renderVals = function () { return {}; };

  var logic = null, renderRoot = null, hostEl = null, mounted = false, queued = false, cbs = [];
  var host = {
    props: {},
    /* dc-runtime __setLogicState L825-829: the updater runs synchronously and the
     * merge is shallow, so logic.state is readable right after setState returns. */
    __setLogicState: function (update, cb) {
      var prev = logic.state;
      logic.state = Object.assign({}, prev, typeof update === "function" ? update(prev) : update);
      schedule(cb);
    },
    forceUpdate: function (cb) { schedule(cb); }
  };
  function schedule(cb) {
    if (cb) cbs.push(cb);
    if (queued) return;
    queued = true; Promise.resolve().then(function () { queued = false; flush(); });
  }
  function flush() {
    pass++; detach = []; attach = [];
    logic.props = host.props;
    var vals = host.props;
    try { vals = Object.assign({}, host.props, logic.renderVals() || {}); } catch (e) { console.error(e); }
    syncChildren(hostEl, flat(renderRoot(vals, ""), []));
    sweep();
    /* React commit order: every detach fires before any attach, then the lifecycle hook. */
    for (var i = 0; i < detach.length; i++) setRef(detach[i], null);
    for (i = 0; i < attach.length; i++) setRef(attach[i][0], attach[i][1]);
    try { if (mounted) logic.componentDidUpdate(host.props); else { mounted = true; logic.componentDidMount(); } }
    catch (e2) { console.error(e2); }
    var run = cbs; cbs = [];
    for (i = 0; i < run.length; i++) run[i]();
  }
  function mount(render, props) {
    var slot = document.getElementById("root"), rootEl = document.createElement("div");
    rootEl.id = "dc-root";
    hostEl = document.createElement("div");
    hostEl.className = "sc-host";
    /* dcNameFromPath L67-73 — /v2/index.html -> "index". */
    hostEl.setAttribute("data-sc-name", location.pathname.split("/").pop().replace(/\.dc\.html$/, "").replace(/\.html?$/, "") || "Root");
    rootEl.appendChild(hostEl);
    if (slot) slot.replaceWith(rootEl); else document.body.appendChild(rootEl);
    renderRoot = render; host.props = props || {};
    /* evalDcLogic L866-874: the logic script declares `Component` as a global lexical binding. */
    var L = (typeof Component !== "undefined" && Component) || DCLogic;
    logic = new L(host.props); logic.__host = host;
    flush();
  }

  /* Data seam for the L2-L10 logic slices: swap a fixture and re-render. */
  var FD = global.FD = global.FD || {};
  FD.fixture = FD.fixture || {};
  FD.screens = FD.screens || {};
  FD.shell = FD.shell || {};
  FD.setData = function (name, value) { FD.fixture[name] = value; if (logic) schedule(); };

  global.DCLogic = DCLogic;
  global.StreamableLogic = DCLogic;
  global.DC = { h: h, t: t, I: I, A: A, O: O, P: pseudoClass, C: compileAttr, mount: mount,
    resolve: resolve, cssToObj: cssToObj, kebabToCamel: kebabToCamel, importantify: importantify, EVENT_MAP: EVENT_MAP };
})(window);
