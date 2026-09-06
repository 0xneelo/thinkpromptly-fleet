// Labels and account identity all come from the API (credits-accounts.json is the
// operator's copy); this page renders whatever it is handed, most constrained first.
const WIN_LABEL = { five_hour: '5 hour', seven_day: '7 day', extra: 'extra usage', weekly: 'weekly', secondary: 'session' };
// Claude's own windows lead, model-scoped weeklies (seven_day_fable) follow, paid extra last.
const WIN_ORDER = ['five_hour', 'seven_day'];
const rank = (n) => WIN_ORDER.indexOf(n) + 1 || (n === 'extra' ? 99 : 50);
// seven_day_fable is the desktop app's "Weekly · Fable": shown as "7 day Fable".
const label = (n) =>
  WIN_LABEL[n] ||
  (n.startsWith('seven_day_') ? '7 day ' + n.slice(10).replace(/(^|_)(\w)/g, (m, s, c) => (s && ' ') + c.toUpperCase()) : n.replace(/_/g, ' '));
// What each row's numbers actually are, so a stale snapshot is never read as live usage.
const SOURCE = { oauth: 'live', desktop: 'desktop snapshot', push: 'push', codex: 'live' };
// The plan behind the windows. An unknown tier shows verbatim rather than as nothing.
const TIER = { default_claude_max_20x: 'Max 20×', claude_max: 'Max' };
const SVG = 'http://www.w3.org/2000/svg';

const accountsEl = document.getElementById('accounts');
const summaryEl = document.getElementById('summary');
const errorsEl = document.getElementById('errors');
const errorsPanel = document.getElementById('errors-panel');
const refreshBtn = document.getElementById('refresh');

let rows = [];
let errors = [];

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

// Past a day amber, past three red — a desktop sample only refreshes while that account is
// actually being used, so its age is the whole story.
function ago(epoch) {
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

// The windows that say whether this account is about to hit a wall — every rate window,
// the per-model weeklies included (the driver runs on Fable); paid credits are not a wall.
const MAIN = {
  claude: (r) => Object.entries(r.windows || {}).filter(([n]) => /^(five_hour|seven_day)/.test(n)).map(([, w]) => w),
  codex: (r) => [r.weekly, r.secondary],
};
const worst = (r) => {
  const p = (MAIN[r.kind] || MAIN.claude)(r).filter((w) => w && typeof w.pct === 'number').map((w) => w.pct);
  return p.length ? Math.max(...p) : null;
};

// A window with no percentage still gets a row — an empty bar says "reported, unknown".
function bar(name, w) {
  const row = el('div', 'bar-row');
  const track = el('div', 'bar-track');
  const fill = el('div', ('bar-fill ' + level(w.pct)).trim());
  fill.style.width = Math.max(0, Math.min(100, w.pct || 0)) + '%';
  track.append(fill);
  row.append(
    el('span', 'muted', label(name)),
    track,
    el('span', 'pct', typeof w.pct === 'number' ? w.pct + '%' : '—'),
    el('span', 'muted', until(w.resets_at))
  );
  return row;
}

// The 7-day series the Claude desktop app has been sampling. Inline SVG, no library: a
// polyline over a faint area, scaled to the sampled span so gaps in sampling read as gaps.
function spark(history) {
  const pts = history.filter((s) => typeof s.sd === 'number');
  const row = el('div', 'bar-row');
  row.append(el('span', 'muted', '7 day trend'));
  if (pts.length < 2) {
    row.append(el('span', 'muted', 'no history yet'), el('span', 'pct', ''), el('span', 'muted', ''));
    return row;
  }
  const t0 = pts[0].t;
  const span = pts[pts.length - 1].t - t0;
  const xy = pts.map((s, i) => {
    // All samples in the same second (or a one-point span) would divide by zero, so the
    // fallback spreads them evenly by index instead.
    const x = span > 0 ? ((s.t - t0) / span) * 100 : (i / (pts.length - 1)) * 100;
    return x.toFixed(2) + ',' + (28 - (Math.max(0, Math.min(100, s.sd)) / 100) * 28).toFixed(2);
  });
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('class', ('spark ' + level(pts[pts.length - 1].sd)).trim());
  svg.setAttribute('viewBox', '0 0 100 28');
  svg.setAttribute('preserveAspectRatio', 'none');
  const area = document.createElementNS(SVG, 'polygon');
  area.setAttribute('points', '0,28 ' + xy.join(' ') + ' 100,28');
  const line = document.createElementNS(SVG, 'polyline');
  line.setAttribute('points', xy.join(' '));
  const title = document.createElementNS(SVG, 'title');
  title.textContent = Math.max(1, Math.round(span / 86400)) + ' days, ' + pts.length + ' samples';
  svg.append(area, line, title);
  row.append(svg, el('span', 'pct', pts[pts.length - 1].sd + '%'), el('span', 'muted', ''));
  return row;
}

function card(r) {
  const acct = el('div', 'acct');
  const head = el('div', 'row');
  const live = r.source && r.state === 'ok';
  head.append(
    pill(live ? 'green' : r.source ? 'amber' : '', r.kind),
    el('span', 'who', r.label || r.email || r.id),
    el('span', 'muted', r.email || '')
  );
  // The uuid the desktop app and the accounts file both key on — eight characters is
  // enough to match a row against the file by eye.
  if (r.org) head.append(el('span', 'mono muted', r.org.slice(0, 8)));
  const tier = TIER[r.tier] || r.tier || TIER[r.type] || r.type;
  if (tier) head.append(pill('', tier));
  if (r.kind === 'codex' && r.plan) head.append(pill('', r.plan));
  // When the live reply carried no percentages, say whose numbers are on show.
  if (r.source)
    head.append(el('span', 'muted', (SOURCE[r.source] || r.source) +
      (r.windows_from ? ' · usage from ' + (SOURCE[r.windows_from] || r.windows_from) : '')));
  // The operator has not verified which account this org belongs to.
  if (!r.confirmed) head.append(el('span', 'age-amber', 'unconfirmed mapping'));
  if (r.updated_at) {
    const a = ago(r.updated_at);
    head.append(el('span', 'fresh', a.text + ' · ' + (r.source === 'push' ? 'push' : r.host)));
  }
  acct.append(head);

  if (!r.source) {
    acct.append(el('div', 'muted', 'no data yet — run push from their machine'));
    return acct;
  }
  // An expired token still leaves whatever another source reported, so the notice sits
  // above the bars rather than replacing them.
  if (r.state === 'token_expired')
    acct.append(el('div', 'notice', 'token expired — open Claude Code on ' + r.host));
  // Rate limiting says nothing about the account, so it must not read like a fault.
  if (r.state === 'rate_limited')
    acct.append(el('div', 'muted', 'usage endpoint busy on ' + r.host + ' — figures below are the last good read'));
  if (r.state === 'error') acct.append(el('div', 'notice', 'could not read usage on ' + r.host));

  // A desktop sample is only as fresh as the last time that account was used in the app.
  if (r.sample_ts) {
    const a = ago(r.sample_ts);
    acct.append(
      el('div', 'muted ' + a.cls, r.stale_windows
        // Older than the window it measured: that window has reset since, so the reading
        // is history, not a current figure, and the bars say so rather than guessing.
        ? 'sampled ' + a.text + ' — older than the window it measured, so these have reset since'
        : 'sampled ' + a.text + ' — no reset times in this source')
    );
  }
  if (r.kind === 'claude') {
    const names = Object.keys(r.windows || {}).sort((a, b) => rank(a) - rank(b));
    if (!names.length) acct.append(el('div', 'muted', 'no usage windows reported'));
    for (const n of names) acct.append(bar(n, r.windows[n]));
    // The paid pool in money rather than percent — what "out of credits" actually means.
    if (r.credit && typeof r.credit.limit === 'number' && typeof r.credit.used === 'number') {
      const c = r.credit;
      const d = Number.isInteger(c.decimals) ? c.decimals : 2;
      const cur = c.currency ? ' ' + c.currency : '';
      acct.append(el('div', c.capped ? 'notice' : 'muted',
        'credits: ' + c.used.toFixed(d) + ' / ' + c.limit.toFixed(d) + cur +
        (c.capped ? ' · spend limit reached' : '') + (c.enabled ? '' : ' · extra usage off')));
    }
    acct.append(spark(r.history || []));
  } else {
    if (r.weekly) acct.append(bar('weekly', r.weekly));
    if (r.secondary) acct.append(bar('secondary', r.secondary));
    if (r.credits && r.credits.has_credits)
      acct.append(el('div', 'muted', 'credits: ' + (r.credits.unlimited ? 'unlimited' : r.credits.balance)));
  }
  // Which machines report this account and how: an account signed in nowhere is only ever
  // seen through the desktop app, which is why its numbers carry no reset times.
  if (r.seen && r.seen.length)
    acct.append(el('div', 'muted seen', 'seen on ' + r.seen.map((s) => s.host + ' · ' + (SOURCE[s.source] || s.source)).join(', ')));
  return acct;
}

// Count and money, not percentages: how many accounts are out of room, and what the fleet
// has actually spent. Currencies are listed side by side — adding them would invent a rate.
function summary() {
  const spend = new Map();
  let hit = 0;
  for (const r of rows) {
    const w = Object.values(r.windows || {}).concat(r.weekly || [], r.secondary || []);
    const c = r.credit;
    if (w.some((x) => x && x.pct >= 100) || (c && c.capped)) hit++;
    if (c && typeof c.used === 'number') {
      const cur = c.currency || '';
      spend.set(cur, (spend.get(cur) || 0) + c.used);
    }
  }
  const money = [...spend].map(([cur, v]) => v.toFixed(2) + (cur ? ' ' + cur : ''));
  return [
    rows.length + (rows.length === 1 ? ' account' : ' accounts'),
    hit + ' at or over a limit',
    money.length ? 'spent ' + money.join(' · ') : 'no credits spent',
  ];
}

function render() {
  // Most constrained first, so whoever is about to hit a wall is at the top; an account
  // nothing has reported has nothing to say and sorts last.
  const sorted = rows.slice().sort((a, b) => {
    const x = worst(a);
    const y = worst(b);
    if (x === null || y === null) return (x === null) - (y === null);
    return y - x;
  });
  summaryEl.replaceChildren(...summary().map((t) => el('span', 'muted', t)));
  accountsEl.replaceChildren(...sorted.map(card));
  errorsPanel.hidden = !errors.length;
  errorsEl.replaceChildren(...errors.map((e) => el('div', 'err', e.host + ': ' + e.message)));
}

// No polling: a collect fans out over ssh, so it runs only when the page or the operator
// asks for it.
async function load(force) {
  refreshBtn.disabled = true;
  try {
    const d = await fetch('/api/credits' + (force ? '?refresh=1' : '')).then((r) => r.json());
    rows = d.rows || [];
    errors = d.errors || [];
  } catch {
    accountsEl.replaceChildren(el('div', 'err', 'cannot reach fleetdeck'));
    return;
  } finally {
    refreshBtn.disabled = false;
  }
  render();
}

refreshBtn.onclick = () => load(true);
load();
