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

// Usage rendering is copied from accounts.js, not shared: that page is a plain page-local
// script with no exports, so sharing it would mean rewriting both pages as modules for the
// sake of five small functions.
const WIN_LABEL = { five_hour: '5 hour', seven_day: '7 day', extra: 'extra usage', weekly: 'weekly', secondary: 'session' };
// Claude's own windows lead, then the two a Codex client is normalized into; anything else
// sorts after them by name, so the order never depends on JSON key order.
const WIN_ORDER = ['five_hour', 'seven_day', 'extra', 'weekly', 'secondary'];

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

// The credits page's age text, kept apart from ago() above: this one carries the amber/red
// class a stale sample needs, and it never has to read a timestamp in the future.
function sampleAge(epoch) {
  const ms = Date.now() - epoch * 1000;
  const m = Math.floor(ms / 60000);
  return {
    text: m < 1 ? 'just now' : m < 60 ? m + 'm ago' : m < 1440 ? Math.floor(m / 60) + 'h ago' : Math.floor(m / 1440) + 'd ago',
    cls: ms > 3 * 864e5 ? 'age-red' : ms > 864e5 ? 'age-amber' : '',
  };
}

function until(epoch) {
  if (!epoch) return '';
  const m = Math.round((epoch * 1000 - Date.now()) / 60000);
  if (m <= 0) return 'resets now';
  return 'resets in ' + (m < 60 ? m + 'm' : Math.floor(m / 60) + 'h ' + (m % 60) + 'm');
}

const level = (pct) => (pct > 90 ? 'red' : pct >= 70 ? 'amber' : '');

// A window with no percentage still gets a row — an empty bar says "reported, unknown".
function bar(name, w) {
  const row = el('div', 'bar-row');
  const track = el('div', 'bar-track');
  const fill = el('div', ('bar-fill ' + level(w.pct)).trim());
  fill.style.width = Math.max(0, Math.min(100, w.pct || 0)) + '%';
  track.append(fill);
  row.append(
    el('span', 'muted', WIN_LABEL[name] || name.replace(/_/g, ' ')),
    track,
    el('span', 'pct', typeof w.pct === 'number' ? w.pct + '%' : '—')
  );
  // A window measured after it reset usually has no reset time left either, so both facts
  // share the tail slot; an empty tail is left out so the row stays one line in a cell.
  const tail = [until(w.resets_at), w.stale ? 'stale' : ''].filter(Boolean).join(' · ');
  if (tail) row.append(el('span', 'reset ' + (w.stale ? 'age-amber' : 'muted'), tail));
  return row;
}

// The Credits pipeline's numbers for this same login. Never sampled is the common case, so
// it says so quietly rather than leaving the cell looking broken.
function usageNodes(u) {
  if (!u) return [el('div', 'muted dim fresh', 'no usage data')];
  const names = Object.keys(u.windows || {}).sort(
    (a, b) => (WIN_ORDER.indexOf(a) + 1 || 99) - (WIN_ORDER.indexOf(b) + 1 || 99) || a.localeCompare(b)
  );
  const out = names.length ? names.map((n) => bar(n, u.windows[n])) : [el('div', 'muted dim fresh', 'no usage windows reported')];
  if (u.sample_ts) {
    const a = sampleAge(u.sample_ts);
    // Older than the window it measured: that window has reset since, so the bars are
    // history rather than a current figure, and the line has to say so.
    out.push(el('div', ('muted fresh ' + a.cls).trim(), 'sampled ' + a.text +
      (u.stale_windows ? ' — older than the window it measured, so these have reset since' : '')));
  }
  return out;
}

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
function clientEntry(c, wsl, sessions, runsSessions) {
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
  box.append(...usageNodes(c.usage));
  // The registry records a session, not which client started it, so this states the count
  // and the account only — it must never be read as "N Claude sessions". runsSessions keeps
  // it off every other row: a box with a WSL and a Windows login would otherwise credit the
  // same sessions to two different people.
  const n = (sessions || []).length;
  const login = c.label || c.email;
  if (runsSessions && n && login)
    box.append(el('div', 'muted fresh', n + (n === 1 ? ' session runs as ' : ' sessions run as ') + login));
  return box;
}

// Name, worker, what it is doing, where it got to. A null part is dropped rather than
// rendered, so a half-filled session never shows up as "a · · b".
const sessionLine = (s) =>
  el('div', 'muted fresh sess', [s.name, s.worker, s.role || s.label, s.status].filter(Boolean).join(' · '));

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
  const sessions = m.sessions || [];
  if (sessions.length) tags.append(chip(sessions.length + (sessions.length === 1 ? ' session' : ' sessions')));
  td.append(tags);
  if (m.error) td.append(el('div', 'err', m.error));
  // A machine the deck cannot reach is not broken — it just has to call in itself.
  else if (m.state === 'no_report' && m.route === 'push')
    td.append(el('div', 'muted', 'no report yet — cron this on that machine:'),
      copyable('sh fleet-logins.sh push ' + pushUrl + ' ' + m.id));
  else if (m.state === 'no_report') td.append(el('div', 'muted', 'no report yet'));
  if (m.reported_at) td.append(el('div', 'muted fresh', 'reported ' + ago(m.reported_at)));
  for (const s of sessions) td.append(sessionLine(s));
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
    // The sessions come from tmux on the side the deck reaches over ssh, which is the
    // `local` one — so only that Claude CLI row may name them, and only when it is the
    // single local one. More than one and the page says nothing rather than guessing.
    const local = (m.clients || []).filter((c) => c.client === 'claude_cli' && c.where === 'local');
    const runner = local.length === 1 ? local[0] : null;
    for (const [client] of CLIENTS) {
      const td = el('td');
      const entries = (m.clients || []).filter((c) => c.client === client);
      if (!entries.length) td.append(el('span', 'muted dim', m.state === 'no_report' ? '' : '—'));
      for (const c of entries) td.append(clientEntry(c, wsl && c.where !== 'windows', m.sessions, c === runner));
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
