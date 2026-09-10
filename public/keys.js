const TTLS = ['1h', '4h', '8h'];
// root = the VPS boxes' login (think-box, onboarding-app-box, ivy-box), vibe = german-box login.
const PRINCIPALS = ['root', 'vibe'];
// Exactly what you paste after `ssh` to use this cert and nothing else from the agent.
const sshOpts = (dir) =>
  `-o IdentitiesOnly=yes -o IdentityAgent=none -i ${dir}/deployer -o CertificateFile=${dir}/deployer-cert.pub`;

const certsEl = document.getElementById('certs');
const pubkeysEl = document.getElementById('pubkeys');
const errEl = document.getElementById('mint-error');
const mintBtn = document.getElementById('mint');
const trainStatusEl = document.getElementById('train-status');
const trainErrEl = document.getElementById('train-error');
const trainEndBtn = document.getElementById('train-end');

let state = { certs: [], keys: [] };
let train = { active: false, expiresAt: null };
let ttl = '1h';
// Both by default — one cert serves the vps-deploy and gb-deploy aliases.
let principals = new Set(PRINCIPALS);
let flashDir = null; // the dir just minted — its card gets the flash animation once
let ticks = []; // {epoch, cd} per live countdown, refreshed on every render

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text) n.textContent = text;
  return n;
};

function pill(color, text) {
  const p = el('div', 'pill');
  p.append(el('span', 'dot ' + color), el('span', null, text));
  return p;
}

// mm:ss under an hour, h:mm above it
function left(epoch) {
  const s = Math.floor((epoch - Date.now()) / 1000);
  if (s <= 0) return null;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const pad = (n) => String(n).padStart(2, '0');
  return h ? h + ':' + pad(m) : pad(m) + ':' + pad(s % 60);
}

function copyLine(text) {
  const line = el('div', 'copyline');
  const code = el('code', null, text);
  const copy = el('button', 'ghost', 'Copy');
  copy.onclick = () =>
    navigator.clipboard.writeText(code.textContent).then(
      () => {
        copy.textContent = 'Copied';
        setTimeout(() => (copy.textContent = 'Copy'), 1500);
      },
      () => {}
    );
  line.append(code, copy);
  return line;
}

function certCard(c) {
  const live = !!c.validToEpoch && c.validToEpoch > Date.now();
  const card = el('div', 'cert' + (c.dir === flashDir ? ' flash' : ''));
  const head = el('div', 'row');
  head.append(
    pill(live ? 'green' : '', live ? 'ACTIVE' : 'EXPIRED'),
    el('span', 'mono', c.keyId || c.dir),
    el('span', 'muted', (c.principals.join(', ') || 'no principals') + ' · until ' + (c.validTo || '?'))
  );
  if (live) {
    const cd = el('span', 'cd', left(c.validToEpoch));
    ticks.push({ epoch: c.validToEpoch, cd });
    head.append(cd);
  }
  const del = el('button', 'ghost del', live ? 'Kill now' : 'Delete');
  del.onclick = async () => {
    if (live && !confirm('Kill this cert now? Agents using it lose access immediately.')) return;
    errEl.hidden = true;
    del.disabled = true;
    const r = await post('/api/sshkeys/delete', { dir: c.dir });
    if (!r.ok) {
      errEl.textContent = r.error || 'delete failed';
      errEl.hidden = false;
      del.disabled = false;
    }
    load();
  };
  head.append(del);
  card.append(head);
  if (live) card.append(copyLine(sshOpts(c.dir)));
  return card;
}

function keysTable(keys) {
  const t = el('table');
  const head = el('tr');
  for (const h of ['Name', 'Type', 'Fingerprint', 'Comment']) head.append(el('th', null, h));
  t.append(head);
  for (const k of keys) {
    const row = el('tr');
    row.append(
      el('td', 'mono', k.name),
      el('td', null, k.type || '?'),
      el('td', 'mono', k.fingerprint || '?'),
      el('td', 'muted', k.comment)
    );
    t.append(row);
  }
  return t;
}

// Called from render() only, so its countdown registers in the same fresh ticks list.
function renderTrain() {
  const live = train.active && train.expiresAt > Date.now();
  trainStatusEl.replaceChildren(pill(live ? 'green' : '', live ? 'ACTIVE' : 'INACTIVE'));
  if (live) {
    const cd = el('span', 'mono', left(train.expiresAt));
    ticks.push({ epoch: train.expiresAt, cd });
    trainStatusEl.append(cd);
  }
  trainEndBtn.hidden = !live;
}

function render() {
  ticks = [];
  certsEl.replaceChildren();
  // The `current` alias symlink shows up as a duplicate of the newest cert until the
  // server-side filter is picked up by a restart; hide it here so Kill always hits a real dir.
  const certs = state.certs.filter((c) => !c.dir.endsWith('/current'));
  if (!certs.length) certsEl.append(el('div', 'muted', 'no certs yet — mint one above'));
  for (const c of certs) certsEl.append(certCard(c));
  flashDir = null;
  pubkeysEl.replaceChildren(keysTable(state.keys));
  renderTrain();
}

// Countdowns tick locally between the 30s polls; a cert crossing zero re-renders so the
// badge flips and the Delete button appears.
setInterval(() => {
  let expired = false;
  for (const t of ticks) {
    const s = left(t.epoch);
    if (s) t.cd.textContent = s;
    else expired = true;
  }
  if (expired) render();
}, 1000);

async function load() {
  try {
    [state, train] = await Promise.all([
      fetch('/api/sshkeys').then((r) => r.json()),
      fetch('/api/ghtrain').then((r) => r.json()),
    ]);
  } catch {
    certsEl.replaceChildren(el('div', 'err', 'cannot reach fleetdeck'));
    return;
  }
  render();
}

const post = async (url, payload) => {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return r.json().catch(() => ({ ok: false, error: 'HTTP ' + r.status }));
};

const ttlsEl = document.getElementById('ttls');
const ttlBtns = TTLS.map((v) => {
  const b = el('button', 'ghost ttl' + (v === ttl ? ' sel' : ''), v);
  b.onclick = () => {
    ttl = v;
    for (const o of ttlBtns) o.classList.toggle('sel', o === b);
  };
  return b;
});
ttlsEl.append(...ttlBtns);

const principalsEl = document.getElementById('principals');
for (const p of PRINCIPALS) {
  const b = el('button', 'ghost ttl sel', p);
  b.title = p === 'root' ? 'VPS boxes: think · onboarding · ivy' : 'german-box';
  b.setAttribute('aria-pressed', 'true');
  b.onclick = () => {
    if (principals.has(p)) principals.delete(p);
    else principals.add(p);
    b.classList.toggle('sel', principals.has(p));
    b.setAttribute('aria-pressed', String(principals.has(p)));
  };
  principalsEl.append(b);
}

// --- Mint popup: the script's stderr `::phase` markers, live, one row each ---
// Most of a mint is the `signing` step, waiting on a human at the 1Password prompt.
const MINT_STEPS = [
  ['start', 'Sending request to fleetdeck'],
  ['agent-ok', '1Password SSH agent found'],
  ['keygen', 'Generating ephemeral ed25519 key'],
  ['signing', '1Password approval — click Allow on the Mac'],
  ['signed', 'Certificate signed'],
  ['linked', 'deploy alias updated'],
];
const dialogEl = document.getElementById('mint-dialog');
const stepsEl = document.getElementById('mint-steps');
const resultEl = document.getElementById('mint-result');
const dialogErrEl = document.getElementById('mint-dialog-error');
const elapsedEl = document.getElementById('mint-elapsed');
let stepEls = [];
let activeIdx = 0;
let mintTimer = null;
let minting = false;

// idx = the step in flight; everything above it is finished by definition, so a
// marker lost to a partial read never leaves an earlier step stuck on the spinner.
function markSteps(idx, failed) {
  stepEls.forEach((s, j) => {
    const state = j < idx ? 'done' : j === idx ? (failed ? 'failed' : 'active') : 'pending';
    s.className = 'step ' + state + (MINT_STEPS[j][0] === 'signing' ? ' sign' : '');
    s.firstChild.textContent = state === 'done' ? '✓' : state === 'failed' ? '✗' : '';
  });
}

function openMintDialog() {
  resultEl.replaceChildren();
  resultEl.hidden = true;
  dialogErrEl.hidden = true;
  stepEls = MINT_STEPS.map(([, label]) => {
    const s = el('div', 'step');
    s.append(el('span', 'step-dot'), el('span', null, label));
    return s;
  });
  stepsEl.replaceChildren(...stepEls);
  markSteps((activeIdx = 0));
  const t0 = Date.now();
  elapsedEl.textContent = '0:00';
  mintTimer = setInterval(() => {
    const s = Math.floor((Date.now() - t0) / 1000);
    elapsedEl.textContent = Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }, 1000);
  dialogEl.showModal();
}

// Closing the dialog does not cancel the mint, so these writes may land on a hidden
// dialog — harmless, and the cert list still refreshes when the stream ends.
function endMint(ev) {
  if (!minting) return;
  minting = false;
  clearInterval(mintTimer);
  mintBtn.disabled = false;
  mintBtn.textContent = 'Mint';
  if (ev.ok) {
    markSteps(MINT_STEPS.length);
    if (ev.valid) resultEl.append(el('div', 'muted', ev.valid));
    resultEl.append(copyLine(sshOpts(ev.outdir)));
    resultEl.hidden = false;
    flashDir = ev.outdir;
  } else {
    markSteps(activeIdx, true);
    dialogErrEl.textContent = ev.error || 'mint failed';
    dialogErrEl.hidden = false;
  }
  load();
}

document.getElementById('mint-close').onclick = () => dialogEl.close();

mintBtn.onclick = async () => {
  errEl.hidden = true;
  const picked = PRINCIPALS.filter((p) => principals.has(p));
  if (!picked.length) {
    errEl.textContent = 'pick at least one principal';
    errEl.hidden = false;
    return;
  }
  mintBtn.disabled = true;
  mintBtn.textContent = 'Minting…';
  minting = true;
  openMintDialog();
  try {
    const res = await fetch('/api/sshkeys/mint/stream', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ttl, principals: picked.join(',') }),
    });
    if (!res.ok) {
      // The Origin/validation rejections answer plain JSON before the stream starts.
      const b = await res.json().catch(() => null);
      throw new Error((b && b.error) || 'HTTP ' + res.status);
    }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const l of lines) {
        if (!l.trim()) continue;
        const ev = JSON.parse(l);
        if (ev.phase === 'done' || ev.phase === 'error') endMint(ev);
        else {
          const i = MINT_STEPS.findIndex(([n]) => n === ev.phase);
          if (i >= 0) markSteps((activeIdx = i));
        }
      }
    }
    // A cut connection can drop the final newline; the tail may still hold the result.
    const tail = (buf + dec.decode()).trim();
    if (tail) {
      try {
        const ev = JSON.parse(tail);
        if (ev.phase === 'done' || ev.phase === 'error') endMint(ev);
      } catch {}
    }
    endMint({ ok: false, error: 'mint stream ended without a result' });
  } catch (e) {
    endMint({ ok: false, error: e.message || 'mint failed' });
  }
};

const trainTtlsEl = document.getElementById('train-ttls');
for (const v of TTLS) {
  const b = el('button', 'ghost ttl', v);
  b.onclick = async () => {
    trainErrEl.hidden = true;
    b.disabled = true;
    b.textContent = 'Touch ID…';
    const r = await post('/api/ghtrain', { ttl: v });
    b.disabled = false;
    b.textContent = v;
    if (!r.ok) {
      trainErrEl.textContent = r.error || 'could not start train';
      trainErrEl.hidden = false;
    }
    load();
  };
  trainTtlsEl.append(b);
}

trainEndBtn.onclick = async () => {
  trainErrEl.hidden = true;
  trainEndBtn.disabled = true;
  const r = await post('/api/ghtrain/end', {});
  trainEndBtn.disabled = false;
  if (!r.ok) {
    trainErrEl.textContent = r.error || 'could not end train';
    trainErrEl.hidden = false;
  }
  load();
};

document.getElementById('refresh').onclick = load;
setInterval(load, 30000);
load();
