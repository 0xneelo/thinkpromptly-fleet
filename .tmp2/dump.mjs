import { chromium } from "playwright";
import { writeFileSync } from "node:fs";
const [url, outf, org] = process.argv.slice(2);
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1600, height: 1000 } });
const errs = [], reqs = [], failed = [];
p.on("console", (m) => { if (m.type() === "error") errs.push(m.text().slice(0, 140)); });
p.on("pageerror", (e) => errs.push("pageerror: " + e.message.slice(0, 180)));
p.on("request", (r) => reqs.push(r.url()));
p.on("response", (r) => { if (r.status() >= 400) failed.push(r.status() + " " + r.url()); });
await p.goto(url, { waitUntil: "networkidle" });
await p.waitForTimeout(700);
if (org) {
  await p.evaluate(() => document.querySelector('[data-fd-view="land"] a[href="#"]').click());
  await p.waitForTimeout(400);
  await p.evaluate(() => document.querySelector('button[title="Org chart"]').click());
  await p.waitForTimeout(500);
}
const stats = await p.evaluate(() => ({
  dcRoot: !!document.getElementById("dc-root"),
  scHost: !!document.querySelector("#dc-root > .sc-host"),
  interp: document.querySelectorAll("span.sc-interp").length,
  tpl: document.querySelectorAll("[data-dc-tpl]").length,
  els: document.getElementById("dc-root").querySelectorAll("*").length,
  bodyLen: document.body.innerHTML.length,
  scp: document.querySelectorAll('[class*="scp"]').length,
  views: [...document.querySelectorAll("[data-fd-view]")].map((e) => e.getAttribute("data-fd-view") + "=" + getComputedStyle(e).display),
}));
let html = await p.evaluate(() => document.getElementById("dc-root").outerHTML);
html = html.replace(/></g, ">\n<").split("\n").map((line) => {
  const m = /^(\s*)<([a-zA-Z0-9-]+)\s([^>]*?)(\/?)>$/.exec(line);
  if (!m) return line;
  return `${m[1]}<${m[2]} ${(m[3].match(/[a-zA-Z0-9_:.-]+="[^"]*"|[a-zA-Z0-9_:.-]+/g) || []).sort().join(" ")}${m[4]}>`;
}).join("\n");
writeFileSync(outf, html);
console.log(JSON.stringify({ ...stats, engine: reqs.filter((u) => /react|babel|dc-runtime/i.test(u)).length, failed, errs, reqs: reqs.length }));
await b.close();
