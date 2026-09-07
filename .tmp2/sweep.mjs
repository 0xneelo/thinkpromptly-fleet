import { chromium } from "playwright";
const url = process.argv[2];
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1600, height: 1000 } });
const errs = [];
p.on("pageerror", (e) => errs.push("pageerror: " + e.message.slice(0, 160)));
p.on("console", (m) => { if (m.type() === "error") errs.push("console: " + m.text().slice(0, 160)); });
await p.goto(url, { waitUntil: "networkidle" });
await p.waitForTimeout(600);
const hit = (sel, n = 0) => p.evaluate(([s, i]) => { const e = document.querySelectorAll(s)[i]; if (!e) throw new Error("missing " + s + "#" + i); e.click(); }, [sel, n]);
const T = () => p.waitForTimeout(250);
try {
  await hit('[data-fd-view="land"] a[href="#"]'); await T();          // goApp / goDeck
  for (const t of ["Registry", "Org chart", "Message bus", "SSH keys", "Accounts", "Machines", "Desktop sessions"]) { await hit(`button[title="${t}"]`); await T(); }
  await hit('button[title="Collapse / expand sidebar"]'); await T();
  await hit('button[title="Toggle accounts panel"]'); await T();
  await hit('[data-fd-view="app"] div[role="button"]', 1); await T();
  await p.evaluate(() => { const ta = document.querySelector('[data-fd-view="app"] textarea'); if (ta) { ta.value = "probe"; ta.dispatchEvent(new Event("input", { bubbles: true })); } }); await T();
  await p.keyboard.press("ArrowRight"); await p.keyboard.press("ArrowRight"); await T();
  await p.keyboard.press("Escape"); await T();
} catch (e) { errs.push("step: " + e.message.slice(0, 140)); }
const st = await p.evaluate(() => ({ els: document.getElementById("dc-root").querySelectorAll("*").length, interp: document.querySelectorAll("span.sc-interp").length }));
console.log(JSON.stringify({ url: url.includes("pass1") ? "pass1" : "pass2", ...st, errs }));
await b.close();
