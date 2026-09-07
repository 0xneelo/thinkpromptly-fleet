const { chromium } = require('playwright');
(async () => {
  const url = process.argv[2];
  const b = await chromium.launch({ headless: true });
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  const errs = [];
  p.on('pageerror', e => errs.push('pageerror: ' + e.message));
  p.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.type() + ': ' + m.text().slice(0, 200)); });
  await p.goto(url, { waitUntil: 'load' });
  await p.waitForTimeout(5000);
  const r = await p.evaluate(async () => {
    const c = document.querySelector('canvas'), v = document.querySelector('video');
    const hash = () => { if (!c) return null; const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let h = 0, nz = 0; for (let i = 0; i < d.length; i += 4013) { h = (h * 31 + d[i]) >>> 0; if (d[i]) nz++; } return h + ':' + nz; };
    const P = CanvasRenderingContext2D.prototype, od = P.drawImage; let draws = 0; P.drawImage = function () { draws++; return od.apply(this, arguments); };
    const orf = window.requestAnimationFrame; let rafs = 0; window.requestAnimationFrame = function (f) { rafs++; return orf.call(window, f); };
    await new Promise(r => setTimeout(r, 1000));
    P.drawImage = od; window.requestAnimationFrame = orf;
    const rev = () => { const a = [...document.querySelectorAll('[data-reveal]')]; return a.filter(e => e.getAttribute('data-shown') === '1').length + '/' + a.length; };
    const at = async (y) => { window.scrollTo(0, y); await new Promise(r => setTimeout(r, 1800)); return { y: scrollY, hash: hash(), reveal: rev(), vt: v && +v.currentTime.toFixed(2) }; };
    const s0 = await at(0), s1 = await at(Math.round((document.documentElement.scrollHeight - innerHeight) / 2)), s2 = await at(99999), s3 = await at(0);
    return { vis: document.visibilityState, docSH: document.documentElement.scrollHeight, innerH: innerHeight, rafs, draws, canvasOp: c && getComputedStyle(c).opacity, canvasStyleOp: c && c.style.opacity, videoOp: v && getComputedStyle(v).opacity, vidRS: v && v.readyState, vidDur: v && v.duration, vidSrc: v && v.currentSrc.slice(-60), s0, s1, s2, s3 };
  });
  console.log(JSON.stringify({ url, errs: errs.slice(0, 10), ...r }));
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
