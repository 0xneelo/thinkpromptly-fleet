#!/usr/bin/env node
// tools/compile-dc.js — pass-2 mechanical compiler (XYZ-1046/XYZ-1048; D15 pass-2
// transform; PLAN §E0/§E2/§E4).
//
// Usage:
//   node tools/compile-dc.js <landing|app>
//
// Compiles the surface's split parts (apps/dashboard/editorial/<surface>/) to a static
// plain-HTML document at data-props defaults, written to
// apps/dashboard/editorial/<surface>/static.html.
//
// Method — the repo's harness philosophy ("the subject is the REAL shipping code,
// never a reimplementation", cf. apps/dashboard/tests/verify-card-harness.mjs):
// instead of re-implementing the dc-runtime's walk (support.js compileTemplate/
// resolve/walkText/walkIf/walkFor, :467-482/:205-294/:569-659), the compiler renders
// the REAL runtime in headless Chrome against the T1/T2-composed page with the clock
// frozen (setInterval no-op'd before support.js loads, so DCLogic demo tickers hold
// their deterministic initial state — landing logic starts at tick 0 by construction)
// and serializes the mounted DOM. Fidelity to runtime semantics is by construction,
// not by porting. The DCLogic demo state machines are NOT carried into pass 2: live
// behavior comes from the shipped surface JS re-pointed at this DOM (F3), per D5
// ("nothing is hardcoded") and D14 carve-outs 1/3.
//
// Serialization normalization — runtime artifacts erased, never design (same rule
// list as tools/f2-parity.mjs; F2 verifies the result independently):
//   n1. <div id="dc-root"><div class="sc-host" …> unwrapped (mount scaffolding).
//   n2. data-dc-tpl attributes stripped (editor instrumentation).
//   n3. every <script> dropped: the dc-script props block and the support.js tag are
//       design-tool scaffolding (D14 carve-out 1 — shipping the props block would
//       hardcode feedHealth, which D5 forbids); pass 2 has no runtime.
//
// Deterministic: same inputs → byte-identical static.html (clock frozen; the compile
// re-runs the compose step in-memory from the committed split parts).

"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const { recompose } = require("./split-dc");
const { T1_OUT, T1_IN, SURFACES, applySwaps, applyT1v2, applyD9 } = require("./compose-editorial");

const CHROME = process.env.CHROME_BIN || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

// Offline build (PLAN §Phase 2c). compile-dc.js makes no network call itself, but
// support.js does at mount time: it injects <script> tags for React/ReactDOM/Babel
// from unpkg (support.js:1143-1148, injected at :1181-1189/:1823-1836). Those three
// files are vendored under tools/vendor/, byte-verified against the SRI pins below,
// and the TMP COPY of support.js is re-pointed at them — the pinned corpus under
// _design-reference/ and the shipped apps/dashboard/editorial/support.js are never
// modified. Chrome then runs with egress denied (see the flags in main), so a
// silently-online build cannot pass.
// [url, vendored filename, SRI pin] — the pin doubles as the swap key that blanks it.
const VENDOR = [
  ["https://unpkg.com/react@18.3.1/umd/react.production.min.js",
   "react-18.3.1.umd.production.min.js",
   "sha384-DGyLxAyjq0f9SPpVevD6IgztCFlnMF6oW/XQGmfe+IsZ8TqEiDrcHkMLKI6fiB/Z"],
  ["https://unpkg.com/react-dom@18.3.1/umd/react-dom.production.min.js",
   "react-dom-18.3.1.umd.production.min.js",
   "sha384-gTGxhz21lVGYNMcdJOyq01Edg0jhn/c22nsx0kyqP0TxaV5WVdsSH1fSDUf5YJj1"],
  ["https://unpkg.com/@babel/standalone@7.29.0/babel.min.js",
   "babel-standalone-7.29.0.min.js",
   "sha384-m08KidiNqLdpJqLq95G/LEi8Qvjl/xUYll3QILypMoQ65QorJ9Lvtp2RXYGBFj1y"],
];

const fail = (msg) => {
  throw new Error(`compile-dc: ${msg}`);
};

if (!fs.existsSync(CHROME)) fail(`Chrome not found at ${CHROME} — set CHROME_BIN`);

// Re-point the tmp support.js at the vendored runtimes. Count-asserted swaps
// (tools/compose-editorial.js applySwaps idiom): an unrewritten URL would be a
// silently-online build, so a wrong count is a hard fail, never a warning.
// The SRI pin is blanked alongside its URL because a file:// script carrying
// integrity=… + crossOrigin="anonymous" is a CORS failure in Chrome; support.js's
// `if (integrity)` guard (:1183/:1828) then sets neither attribute. Integrity is
// not lost, only moved earlier: tools/vendor/ was verified against these exact
// pins at download time. BUILD-TIME ONLY — this rewrite lives and dies in the tmp
// dir and is never written back to any tracked support.js.
function vendorSupport(src) {
  const swap = (out, into) => {
    const n = src.split(out).length - 1;
    if (n !== 1) fail(`expected 1× ${out} in support.js, found ${n} — CDN pins moved; re-vendor tools/vendor/`);
    src = src.split(out).join(into);
  };
  for (const [url, file, sri] of VENDOR) {
    swap(url, "./" + file);
    swap(sri, "");
  }
  if (src.includes("unpkg.com")) fail("un-vendored unpkg reference survived in the tmp support.js");
  return src;
}

function main() {
  const surface = process.argv[2];
  // Optional third arg: a hash route to pin before mount (the app mock's demo
  // router reads location.hash at construction), e.g. "#/admin/budgets" —
  // output lands in static-<slug>.html instead of static.html.
  const hash = process.argv[3] || "";
  const cfg = SURFACES[surface];
  if (!cfg) {
    console.error("usage: node tools/compile-dc.js <landing|app> [#/hash]");
    process.exit(1);
  }
  const dir = path.join(__dirname, "..", "apps/dashboard/editorial", surface);
  const read = (f) => fs.readFileSync(path.join(dir, f), "utf8");

  // Compose the T1/T2 page in-memory (identical to tools/compose-editorial.js), then
  // freeze the clock BEFORE support.js loads so componentDidMount tickers never fire.
  const shell = JSON.parse(read("shell.json")).shell;
  let template = read("template.html");
  if (shell === "v1") {
    if ((template.split(T1_OUT).length - 1) !== 1) fail("helmet font lines not found exactly once");
    // cfg.fonts: the v2 lanes carry their own helmet (D4 adds the two self-hosted
    // Helvetica Neue Light faces). Falling back to T1_IN here would render side A
    // without them and every parity run would report font-family diffs that the
    // served page does not actually have.
    template = template.replace(T1_OUT, cfg.fonts || T1_IN);
  } else {
    template = applyT1v2(template);
  }
  // cfg.grids: D9 minmax(0,…) wrapping, count-asserted. getComputedStyle returns USED
  // px for grid-template-columns, so an unwrapped side A diverges numerically from the
  // wrapped served page — a false mismatch that would look like a port defect.
  if (cfg.grids !== undefined) template = applyD9(template, cfg.grids, "template.html");
  template = applySwaps(template, cfg.template, "template.html");
  const logic = applySwaps(read("logic.js"), cfg.logic, "logic.js");
  const page = recompose({ template, logic, props: read("props.json"), shell }).replace(
    '<script src="./support.js"></script>',
    '<script>window.setInterval = () => 0; window.__compileDc = true;</script>\n<script src="./support.js"></script>'
  );
  if (!page.includes("__compileDc")) fail("clock-freeze prelude not injected");

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "compile-dc-"));
  try {
    fs.writeFileSync(path.join(tmp, "page.html"), page);
    fs.writeFileSync(
      path.join(tmp, "support.js"),
      vendorSupport(fs.readFileSync(path.join(dir, "..", "support.js"), "utf8"))
    );
    for (const [, file] of VENDOR) {
      fs.copyFileSync(path.join(__dirname, "vendor", file), path.join(tmp, file));
    }
    // Keyed off the lane's own logic rather than a surface allowlist: the v2 desktop
    // and mobile lanes each carry the docs view, so both import docs-content.js too.
    // Copied from the LANE dir, never from one level up: the lane's ensureDocs does a
    // dynamic `import("./docs-content.js")` and reads `m.DOCS`, so the tmp page needs
    // the MODULE form that sits beside it. The copy one level up is the GLOBAL form
    // (window.__LC_DOCS) that the v1 app shell loads as a plain <script> and that
    // apps/dashboard/docs/index.html depends on at runtime; feeding it to the import
    // resolves but yields m.DOCS === undefined, which compiles an EMPTY docs shell.
    if (logic.includes("docs-content.js")) {
      fs.copyFileSync(path.join(dir, "docs-content.js"), path.join(tmp, "docs-content.js"));
    }
    const dom = execFileSync(
      CHROME,
      ["--headless=new", "--disable-gpu", "--no-first-run", "--virtual-time-budget=8000",
       // The lane logic is evaluated through support.js's `new Function` (:1218), whose
       // dynamic import() Chrome classifies as coming from a CORS-cross-origin script on
       // a file:// page — "Failed to resolve module specifier './docs-content.js'. The
       // base URL is about:blank". ensureDocs() then swallows it into a console.error and
       // the docs view compiles as an EMPTY shell. This flag restores the file:// base
       // URL so the import resolves against the tmp dir. Egress stays denied by the two
       // flags below, so the widened reach is local-only and build-time only.
       "--allow-file-access-from-files",
       // Egress denied: every hostname fails to resolve and the only proxy is a
       // dead port. If the compile ever needs the network again it fails here
       // instead of quietly reaching unpkg. file:// is unaffected by both.
       "--host-resolver-rules=MAP * ~NOTFOUND", "--proxy-server=http://127.0.0.1:1",
       "--dump-dom", "file://" + path.join(tmp, "page.html") + hash],
      { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }
    );

    // n3 FIRST — strip every script (dc-script props block, support.js tag, React CDN
    // tags) BEFORE the structural unwrap: the dc-script sibling carries logic.js's raw
    // text, which may contain any substring (including "</div></div>"), so the tail
    // search below must never see it (reviewer-reproduced corruption hazard).
    let s = dom.replace(/<script[\s\S]*?<\/script>/g, "");
    // n1 — unwrap the runtime mount scaffolding; the wrapper close must be the LAST
    // content before </body> or the unwrap grabbed the wrong occurrence.
    const open = s.match(/<div id="dc-root"><div class="sc-host"[^>]*>/);
    if (!open) fail("dc-root/sc-host wrapper not found — did the runtime mount?");
    s = s.replace(open[0], "");
    const tail = s.lastIndexOf("</div></div>");
    if (tail < 0) fail("dc-root close not found");
    if (s.slice(tail + "</div></div>".length).replace(/\s+/g, "") !== "</body></html>")
      fail("dc-root close is not the last body content — unwrap would corrupt");
    s = s.slice(0, tail) + s.slice(tail + "</div></div>".length);
    // n2 — strip editor instrumentation.
    s = s.replace(/ data-dc-tpl="\d+"/g, "");
    s = s.replace(/\n\s*\n/g, "\n");

    if (s.includes("{{")) fail("unresolved {{ }} binding survived the compile");
    if (/<sc-if|<sc-for|<x-dc|<helmet/.test(s)) fail("uncompiled template construct survived");

    const slug = hash ? "-" + hash.replace(/^#\/?/, "").replace(/\//g, "-") : "";
    const out = path.join(dir, `static${slug}.html`);
    fs.writeFileSync(out, s);
    console.log(`${out} written (${Buffer.byteLength(s)} bytes)`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

main();
