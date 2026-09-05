// One row per machine, four cells: who each AI client is signed in as. Everything shown
// here comes from the API; this page only says how a fact was proved and how old it is.
const CLIENTS = [
  ['claude_cli', 'Claude CLI'],
  ['codex_cli', 'Codex CLI'],
  ['claude_desktop', 'Claude desktop'],
  ['codex_desktop', 'Codex desktop'],
];
// How the identity was established. A live token beats a config file that may name someone
// else, and a desktop sample only says who the app was last used as.
const PROOF = { profile: ['token-proved', 'ok'], jwt: ['token-proved', 'ok'], config: ['config only', 'warn'], history: ['last active', ''] };
const STATE = {
  token_expired: ['token expired', 'bad'],
  rate_limited: ['busy (429)', 'warn'],
  signed_out: ['signed out', 'warn'],
  api_key: ['api key', ''],
  no_samples: ['never used', ''],
  error: ['read failed', 'bad'],
};
const TIER = { default_claude_max_20x: 'Max 20×', claude_max: 'Max' };

const machinesEl = document.getElementById('machines');
const refreshBtn = document.getElementById('refresh');

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text) n.textContent = text;
  return n;
};

// Both directions: a token expires ahead, a refresh happened behind.
function ago(epoch) {
  const ms = Date.now() - epoch * 1000;
  const m = Math.floor(Math.abs(ms) / 60000);
  const t = m < 60 ? m + ' min' : m < 1440 ? Math.floor(m / 60) + ' h' : Math.floor(m / 1440) + ' d';
  return ms >= 0 ? (m < 1 ? 'just now' : t + ' ago') : 'in ' + t;
}

const chip = (text, kind) => el('span', ('chip ' + (kind || '')).trim(), text);

// The line under the badges: what would go stale first for this client.
function freshness(c) {
  if (c.client === 'claude_cli' && c.expires_at)
    return (c.expires_at * 1000 > Date.now() ? 'token valid ' : 'token expired ') + ago(c.expires_at);
  if (c.client.startsWith('codex') && c.last_refresh) {
    const t = Date.parse(c.last_refresh);
    if (!Number.isNaN(t)) return 'refreshed ' + ago(t / 1000);
  }
  if (c.last_active) return 'last active ' + ago(c.last_active);
  return '';
}

// A signed-in client is a person, an address and the proof behind them; anything else is a
// short reason why not.
function clientEntry(c, wsl) {
  const box = el('div', 'login');
  if (c.where === 'windows' || wsl) box.append(el('span', 'tag', c.where === 'windows' ? 'Windows' : 'WSL'));
  if (!c.installed && c.state === 'not_installed') {
    box.append(el('span', 'muted dim', '—'));
    return box;
  }
  const email = c.email || c.config_email;
  if (c.label) box.append(el('div', 'who', c.label));
  else if (!email) box.append(el('div', 'muted', c.org ? c.org.slice(0, 8) + ' · unmapped org' : 'signed in, account unknown'));
  if (email) box.append(el('div', 'mono muted addr', email));
  const chips = el('div', 'row chips');
  const plan = c.plan && c.plan !== 'business' ? c.plan : null;
  if (plan) chips.append(chip(plan));
  if (c.tier) chips.append(chip(TIER[c.tier] || c.tier));
  const proof = PROOF[c.proof];
  if (proof) chips.append(chip(proof[0], proof[1]));
  const state = STATE[c.state];
  if (state) chips.append(chip(state[0], state[1]));
  if (chips.children.length) box.append(chips);
  const f = freshness(c);
  if (f) box.append(el('div', 'muted fresh', f));
  // The Codex app has no login of its own; saying so is the whole fact.
  if (c.shares) box.append(el('div', 'muted fresh', 'same login as CLI'));
  if (c.note) box.append(el('div', 'muted fresh', c.note));
  return box;
}

function copyable(text) {
  const c = el('code', 'mono copy', text);
  c.title = 'click to copy';
  c.onclick = () => navigator.clipboard && navigator.clipboard.writeText(text);
  return c;
}

function machineCell(m, pushUrl) {
  const td = el('td', 'machine');
  td.append(el('div', 'who', m.label));
  const tags = el('div', 'row chips');
  if (m.os) tags.append(el('span', 'muted', m.os));
  tags.append(el('span', 'tag', m.route === 'ssh' ? 'ssh ' + m.ssh : m.route));
  td.append(tags);
  if (m.error) td.append(el('div', 'err', m.error));
  // A machine the deck cannot reach is not broken — it just has to call in itself.
  else if (m.state === 'no_report' && m.route === 'push')
    td.append(el('div', 'muted', 'no report yet — cron this on that machine:'),
      copyable('sh fleet-logins.sh push ' + pushUrl + ' ' + m.id));
  else if (m.state === 'no_report') td.append(el('div', 'muted', 'no report yet'));
  if (m.reported_at) td.append(el('div', 'muted fresh', 'reported ' + ago(m.reported_at)));
  return td;
}

function render(d) {
  const table = el('table', 'machines');
  const head = el('tr');
  head.append(el('th', null, 'Machine'), ...CLIENTS.map(([, name]) => el('th', null, name)));
  table.append(head);
  for (const m of d.machines || []) {
    const tr = el('tr');
    tr.append(machineCell(m, d.push_url));
    // A WSL box reports its Linux side as `local`; on that machine that side is the WSL one.
    const wsl = (m.os || '').includes('wsl');
    for (const [client] of CLIENTS) {
      const td = el('td');
      const entries = (m.clients || []).filter((c) => c.client === client);
      if (!entries.length) td.append(el('span', 'muted dim', m.state === 'no_report' ? '' : '—'));
      for (const c of entries) td.append(clientEntry(c, wsl && c.where !== 'windows'));
      tr.append(td);
    }
    table.append(tr);
  }
  machinesEl.replaceChildren(table);
}

async function load(force) {
  refreshBtn.disabled = true;
  try {
    render(await fetch('/api/machines' + (force ? '?refresh=1' : '')).then((r) => r.json()));
  } catch {
    machinesEl.replaceChildren(el('div', 'err', 'cannot reach fleetdeck'));
  } finally {
    refreshBtn.disabled = false;
  }
}

refreshBtn.onclick = () => load(true);
// The poll never forces a collect: the deck's own TTL decides when the ssh fan-out reruns.
setInterval(() => load(false), 60000);
load();
