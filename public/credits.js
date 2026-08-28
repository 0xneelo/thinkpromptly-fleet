// Labels, order and account identity all come from the API (credits-accounts.json is the
// operator's copy); this page renders whatever it is handed.
const WIN_LABEL = { five_hour: '5 hour', seven_day: '7 day', extra: 'extra usage', weekly: 'weekly', secondary: 'session' };
// Claude's own windows lead; anything model-specific follows in reported order.
const WIN_ORDER = ['five_hour', 'seven_day', 'extra'];
// What each row's numbers actually are, so a stale snapshot is never read as live usage.
const SOURCE = { oauth: 'live', desktop: 'desktop snapshot', push: 'push', codex: 'live' };

const accountsEl = document.getElementById('accounts');
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

// A window with no percentage still gets a row — an empty bar says "reported, unknown".
function bar(name, w) {
  const row = el('div', 'bar-row');
  const track = el('div', 'bar-track');
  const fill = el('div', 'bar-fill' + (w.pct > 90 ? ' red' : w.pct >= 70 ? ' amber' : ''));
  fill.style.width = Math.max(0, Math.min(100, w.pct || 0)) + '%';
  track.append(fill);
  row.append(
    el('span', 'muted', WIN_LABEL[name] || name.replace(/_/g, ' ')),
    track,
    el('span', 'pct', typeof w.pct === 'number' ? w.pct + '%' : '—'),
    el('span', 'muted', until(w.resets_at))
  );
  return row;
}

function card(r) {
  const acct = el('div', 'acct');
  const head = el('div', 'row');
  const live = r.source && r.state === 'ok';
  head.append(
    pill(live ? 'green' : r.source ? 'amber' : '', r.kind),
    el('span', 'who', r.label || r.email || r.id),
    el('span', 'muted', r.email || r.org || '')
  );
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
    acct.append(el('div', 'muted ' + a.cls, 'sampled ' + a.text + ' — no reset times in this source'));
  }
  if (r.kind === 'claude') {
    const names = Object.keys(r.windows || {}).sort(
      (a, b) => (WIN_ORDER.indexOf(a) + 1 || 99) - (WIN_ORDER.indexOf(b) + 1 || 99)
    );
    if (!names.length) acct.append(el('div', 'muted', 'no usage windows reported'));
    for (const n of names) acct.append(bar(n, r.windows[n]));
    // The paid pool in money rather than percent — what "out of credits" actually means.
    if (r.credit && typeof r.credit.limit === 'number' && typeof r.credit.used === 'number') {
      const c = r.credit;
      const d = Number.isInteger(c.decimals) ? c.decimals : 2;
      const cur = c.currency ? ' ' + c.currency : '';
      const line = el('div', c.capped ? 'notice' : 'muted',
        'credits: ' + c.used.toFixed(d) + ' / ' + c.limit.toFixed(d) + cur +
        (c.capped ? ' · spend limit reached' : '') + (c.enabled ? '' : ' · extra usage off'));
      acct.append(line);
    }
  } else {
    if (r.weekly) acct.append(bar('weekly', r.weekly));
    if (r.secondary) acct.append(bar('secondary', r.secondary));
    if (r.credits && r.credits.has_credits)
      acct.append(el('div', 'muted', 'credits: ' + (r.credits.unlimited ? 'unlimited' : r.credits.balance)));
  }
  return acct;
}

function render() {
  accountsEl.replaceChildren(...rows.map(card));
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
