// tools/f2-parity.mjs — F2 pass-2 parity gate (XYZ-1046/XYZ-1048;
// docs/goals/editorial-clean-port/ACCEPTANCE.md §F2).
//
//   node tools/f2-parity.mjs <landing|app>
//
// Independently verifies the compiled static output against the pass-1 runtime
// render: the committed pass-1 page (apps/dashboard/editorial/<surface>/index.html)
// is rendered LIVE in headless Chrome — real runtime, demo clock ticking, exactly
// what the parked route serves — and its DOM is compared against the committed
// static.html (tools/compile-dc.js output) rendered the same way. The pass-1 side
// deliberately does NOT reuse the compiler's frozen-clock pipeline, so this check
// can catch compiler defects instead of replaying them.
//
// "DOM-equivalent" is defined by these documented normalizations — each erases a
// RUNTIME ARTIFACT or a declared VOLATILE slot, never design:
//   n1. pass-1's <div id="dc-root"><div class="sc-host" …> wrapper unwrapped.
//   n2. data-dc-tpl attributes stripped (editor instrumentation).
//   n3. every <script> dropped (dc-script props block, support.js, React CDN — the
//       D14 carve-out-1 scaffolding; pass 2 ships none of it).
//   n4. VOLATILE demo-clock slots masked on BOTH sides, per surface:
//         landing — the SpotCard <aside>'s sc-interp span texts (spot.* ticker:
//         pair/price/state/block/tx/"Ns ago" rotate on a 1s clock). Structure,
//         attributes and span positions still compare exactly.
//
// Prints the construct census (sc-if / sc-for / {{ }} from the split template) as
// the parity denominator, precedent-style ("N/N parity").

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const CHROME = process.env.CHROME_BIN || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// Landing's single <aside> (the SpotCard) holds 12 sc-interp spans: 7 tick-volatile
// (pair/price/block/tx and the 3 row values) interleaved with 5 stable ones (row
// labels, state, stream label). The mask blankets ALL 12 — a deliberate trade: the
// 5 stable strings lose text comparison (structure/attrs/positions still compare),
// in exchange for a mask that can't silently drift when the template's span order
// changes. The stable strings' correctness is still pinned by compile-dc's frozen
// tick-0 render assertions.
const VOLATILE_MASK = {
  landing: (s) =>
    s.replace(/(<aside[\s\S]*?<\/aside>)/, (aside) =>
      aside.replace(/(<span class="sc-interp">)[^<]*(<\/span>)/g, "$1◌$2")
    ),
  app: (s) => s,
};

const surface = process.argv[2];
if (!VOLATILE_MASK[surface]) {
  console.error("usage: node tools/f2-parity.mjs <landing|app>");
  process.exit(1);
}
const dir = join(root, "apps/dashboard/editorial", surface);

const dump = (url) =>
  execFileSync(
    CHROME,
    ["--headless=new", "--disable-gpu", "--no-first-run", "--virtual-time-budget=8000", "--dump-dom", url],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }
  );

function normalize(html, { unwrapRuntime }) {
  // n3 FIRST: the dc-script sibling carries logic.js's raw text, which may contain
  // any substring (incl. "</div></div>") — strip scripts before the tail search.
  let s = html.replace(/<script[\s\S]*?<\/script>/g, "");
  if (unwrapRuntime) {
    const open = s.match(/<div id="dc-root"><div class="sc-host"[^>]*>/);
    if (!open) throw new Error("f2-parity: dc-root/sc-host wrapper not found in pass-1 dump");
    s = s.replace(open[0], "");
    const tail = s.lastIndexOf("</div></div>");
    if (tail < 0) throw new Error("f2-parity: dc-root close not found");
    if (s.slice(tail + "</div></div>".length).replace(/\s+/g, "") !== "</body></html>")
      throw new Error("f2-parity: dc-root close is not the last body content — unwrap would corrupt");
    s = s.slice(0, tail) + s.slice(tail + "</div></div>".length);
  }
  s = s.replace(/ data-dc-tpl="\d+"/g, "");
  s = s.replace(/\n\s*\n/g, "\n");
  return VOLATILE_MASK[surface](s);
}

const template = readFileSync(join(dir, "template.html"), "utf8");
const c = {
  scIf: (template.match(/<sc-if/g) || []).length,
  scFor: (template.match(/<sc-for/g) || []).length,
  bindings: (template.match(/\{\{/g) || []).length,
};
const total = c.scIf + c.scFor + c.bindings;

// pass-1 needs ./support.js next to the page (the served layout, not the disk layout).
const tmp = mkdtempSync(join(tmpdir(), "f2-parity-"));
let a, b;
try {
  copyFileSync(join(dir, "index.html"), join(tmp, "index.html"));
  copyFileSync(join(dir, "..", "support.js"), join(tmp, "support.js"));
  a = normalize(dump("file://" + join(tmp, "index.html")), { unwrapRuntime: true });
  b = normalize(dump("file://" + join(dir, "static.html")), { unwrapRuntime: false });
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

if (a === b) {
  console.log(
    `F2 PARITY OK (${surface}) — ${total}/${total} constructs (sc-if ${c.scIf}, sc-for ${c.scFor}, bindings ${c.bindings}); normalized DOM byte-identical`
  );
  process.exit(0);
}
let i = 0;
while (i < a.length && i < b.length && a[i] === b[i]) i++;
console.error(`F2 PARITY FAIL (${surface}) — first divergence at offset ${i}:`);
console.error(`  pass1: …${JSON.stringify(a.slice(Math.max(0, i - 80), i + 120))}…`);
console.error(`  pass2: …${JSON.stringify(b.slice(Math.max(0, i - 80), i + 120))}…`);
process.exit(1);
