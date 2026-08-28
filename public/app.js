const HOLDER_TIP =
  'Open Windows App → RDP to the box as Vibe → run: wsl -e sleep infinity → close (disconnect, never sign out)';
const AGENT_LOCKED = 'communication with agent failed';
const XTERM_THEME = {
  background: '#1a1915',
  foreground: '#e8e6dc',
  cursor: '#d97757',
  selectionBackground: 'rgba(217,119,87,0.3)',
};

const grid = document.getElementById('grid');
const emptyEl = document.getElementById('empty');
const fleetEl = document.getElementById('fleet');
const fleetRows = document.getElementById('fleet-rows');
const listEl = document.getElementById('sessions');
const healthEl = document.getElementById('health');
const tiles = new Map(); // key -> tile element
const rows = new Map(); // key -> sidebar row element

// Sessions the registry marks hidden stay out of the sidebar until this toggle flips.
let showHidden = localStorage.getItem('showHidden') === '1';
// The fleet table is fullscreen above the grid: tiles keep their websockets while it is
// open, so closing it shows them exactly as they were.
let fleetOpen = false;

const key = (host, session) => host + '\0' + session;
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text) n.textContent = text;
  return n;
};

function sync() {
  if (emptyEl) emptyEl.hidden = tiles.size > 0;
  fleetEl.hidden = !fleetOpen;
  document.getElementById('nav-windows')?.classList.toggle('sel', !fleetOpen);
  document.getElementById('fleet-btn').classList.toggle('sel', fleetOpen);
  for (const [k, row] of rows) row.classList.toggle('open', tiles.has(k));
}

function pill(color, text, tip) {
  const p = el('div', 'pill');
  p.append(el('span', 'dot ' + color), el('span', null, text));
  if (tip) p.title = tip;
  return p;
}

async function loadHealth() {
  let hosts;
  try {
    hosts = await (await fetch('/api/health')).json();
  } catch {
    healthEl.replaceChildren(pill('red', 'health unreachable'));
    return;
  }
  healthEl.replaceChildren();
  for (const h of hosts) {
    if (h.agentLocked)
      healthEl.append(
        pill('amber', h.host + ' · 1Password locked', 'Unlock 1Password on this Mac, then Refresh')
      );
    else if (h.holderOk === null || h.wslAlive === null)
      healthEl.append(
        pill('amber', h.host + ' · unreachable', 'ssh to the box failed — network or 1Password')
      );
    else
      healthEl.append(
        h.holderOk && h.wslAlive
          ? pill('green', h.host + ' · holder OK', HOLDER_TIP)
          : pill('red', h.host + ' · HOLDER DOWN', HOLDER_TIP)
      );
  }
}

// Whichever window is furthest along is the one that will actually stop the account, so
// that is the number worth a sidebar row; /accounts.html carries the rest.
function accountMini(r) {
  const w = r.windows || {};
  const pcts = (r.kind === 'codex' ? [w.weekly, r.weekly, r.secondary] : [w.five_hour, w.seven_day])
    .filter((x) => x && typeof x.pct === 'number')
    .map((x) => x.pct);
  const pct = pcts.length ? Math.max(...pcts) : null;
  const c = r.credit;
  const spent = c && typeof c.used === 'number' && typeof c.limit === 'number';
  const row = el('div', 'acct-mini');
  row.title = [
    (r.label || r.id) + (r.email ? ' · ' + r.email : ''),
    pct === null ? 'no usage reported' : 'highest window ' + pct + '%',
    spent ? 'credits ' + c.used.toFixed(c.decimals ?? 2) + ' / ' + c.limit.toFixed(c.decimals ?? 2) + ' ' + (c.currency || '') : null,
    r.source ? 'source: ' + r.source : 'no data yet',
  ]
    .filter(Boolean)
    .join('\n');
  const track = el('div', 'bar-track');
  const fill = el('div', 'bar-fill' + (pct > 90 ? ' red' : pct >= 70 ? ' amber' : ''));
  fill.style.width = Math.max(0, Math.min(100, pct || 0)) + '%';
  track.append(fill);
  // The strip is one sidebar wide: a first name fits where a full label does not, and the
  // Codex account needs the suffix or it reads as a second row for the same person.
  const full = r.label || r.email || r.id;
  const short = String(full).split(' ')[0] + (r.kind === 'codex' ? ' ·gpt' : '');
  row.append(el('span', 'mini-who', short), track, el('span', 'pct', pct === null ? '—' : pct + '%'));
  // A spent pool does not show up in the windows above, so it needs its own mark.
  if (c && c.capped) row.append(el('span', 'mini-flag', '€'));
  return row;
}

// Reads stored rows; the server decides when a collect is due, so opening the deck does
// not fan out over ssh every time.
async function loadAccounts() {
  const box = document.getElementById('accounts-mini');
  if (!box) return;
  try {
    const d = await (await fetch('/api/credits')).json();
    box.replaceChildren(...(d.rows || []).map(accountMini));
  } catch {
    box.replaceChildren(el('div', 'hint', 'accounts unavailable'));
  }
}

// A server without the registry (or a row it has never classified) still lists sessions:
// only host+name are ever required, everything else falls back.
const norm = (s) => ({ label: '', role: '', worker: '', note: '', group: '', task: '', status: 'active', live: true, ...s });

const fetchSessions = async () => {
  const d = await (await fetch('/api/sessions')).json();
  return { sessions: (d.sessions || []).map(norm), errors: d.errors || [] };
};

const post = (url, body) =>
  fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }).then((r) => r.json());

// Registry writes cross an ssh round trip (seconds), so every action opens a 'pending'
// toast and resolves it in place. The returned function replaces the text and kind and
// restarts the dismiss timer: pending never auto-dismisses, ok goes at 3s, err at 6s.
const toastStack = el('div', 'toasts');
document.body.append(toastStack);
function toast(msg, kind) {
  const t = el('div');
  let timer;
  const set = (text, k) => {
    t.className = 'toast ' + k;
    t.textContent = text;
    clearTimeout(timer);
    if (k !== 'pending') timer = setTimeout(() => t.remove(), k === 'err' ? 6000 : 3000);
  };
  t.onclick = () => t.remove(); // an error toast can be cleared before its 6s are up
  toastStack.append(t);
  set(msg, kind);
  return set;
}

// Pane activity ages into amber past an hour and red past a day — a worker nobody has
// touched in days is the thing worth spotting in the table.
function ago(iso) {
  if (!iso) return { text: '—', cls: 'muted' };
  const ms = Date.now() - Date.parse(iso);
  const m = Math.floor(ms / 60000);
  return {
    text:
      m < 1 ? 'just now' : m < 60 ? m + 'm ago' : m < 1440 ? Math.floor(m / 60) + 'h ago' : Math.floor(m / 1440) + 'd ago',
    cls: ms > 864e5 ? 'age-red' : ms > 36e5 ? 'age-amber' : '',
  };
}

// Click-to-edit registry text cell; `field` is the API key (label, group, note or task).
// `view` optionally renders the display state — Task shows a link, which must stay a link.
function editCell(s, field, view) {
  const td = el('td', 'label-cell', view ? null : s[field] || '—');
  if (view) td.append(...view(s));
  td.onclick = (e) => {
    if (e.target.closest('a') || td.querySelector('input')) return;
    const inp = el('input');
    inp.value = s[field] || '';
    td.replaceChildren(inp);
    inp.focus();
    let done = false; // Enter blurs, so without this the save would fire twice
    const save = async () => {
      if (done) return;
      done = true;
      // Without this the cell would silently snap back to the old value on a rejected write.
      const r = await post('/api/registry', { host: s.host, name: s.name, [field]: inp.value });
      if (r.ok) toast('Saved ' + field, 'ok');
      else toast(field + ' not saved: ' + (r.error || 'unknown error'), 'err');
      loadSessions();
    };
    inp.onblur = save;
    inp.onkeydown = (e) => {
      if (e.key === 'Enter') inp.blur();
      else if (e.key === 'Escape') {
        done = true;
        loadSessions();
      }
    };
  };
  return td;
}

function actionCell(s) {
  const td = el('td');
  const acts = el('div', 'acts');
  // Every action is an ssh round trip of seconds. The row's buttons stay disabled until
  // the re-fetch lands, so a second click cannot fire a duplicate kill.
  const run = async (pending, ok, fail, req) => {
    const done = toast(pending, 'pending');
    for (const b of acts.children) b.disabled = true;
    const r = await req();
    done(r.ok ? ok : fail + (r.stderr || r.error || 'unknown error'), r.ok ? 'ok' : 'err');
    await loadSessions();
    for (const b of acts.children) b.disabled = false;
  };
  const set = (status, pending, ok) =>
    run(pending, ok, 'status not saved: ', () =>
      post('/api/registry', { host: s.host, name: s.name, status })
    );
  const kill = el('button', 'ghost', 'Kill');
  kill.onclick = () => {
    if (
      !confirm(
        'Kill tmux session ' + s.name + ' on ' + s.host + '?\n\nIrreversible — everything running in it dies.'
      )
    )
      return;
    run('Killing ' + s.name + '…', 'Killed ' + s.name, 'kill failed: ', () =>
      post('/api/kill', { host: s.host, name: s.name })
    );
  };
  const tagged = s.status === 'kill-requested';
  const tag = el('button', 'ghost', tagged ? 'Untag' : 'Tag kill');
  tag.title = tagged ? 'Cancel the kill request' : 'Mark kill-requested — nothing is killed';
  tag.onclick = () =>
    tagged
      ? set('active', 'Untagging ' + s.name + '…', 'Untagged ' + s.name)
      : set('kill-requested', 'Tagging ' + s.name + '…', 'Tagged ' + s.name + ' for kill');
  const hidden = s.status === 'hidden';
  const hide = el('button', 'ghost', hidden ? 'Unhide' : 'Hide');
  hide.onclick = () =>
    set(
      hidden ? 'active' : 'hidden',
      (hidden ? 'Unhiding ' : 'Hiding ') + s.name + '…',
      (hidden ? 'Unhidden ' : 'Hidden ') + s.name
    );
  if (s.live) {
    const show = el('button', 'ghost', 'Show');
    show.title = 'Open this session fullscreen';
    show.onclick = () => {
      toggleFleet(false);
      openMax(s.host, s.name);
    };
    acts.append(show);
  }
  acts.append(kill, tag, hide);
  if (!s.live) {
    const forget = el('button', 'ghost', 'Forget');
    forget.title = 'Drop the registry row';
    forget.onclick = () =>
      run('Forgetting ' + s.name + '…', 'Forgot ' + s.name, 'forget failed: ', () =>
        post('/api/registry/delete', { host: s.host, name: s.name })
      );
    acts.append(forget);
  }
  td.append(acts);
  return td;
}

// The server already rejects anything but a single Linear key; re-testing here means no
// stored value can ever become an arbitrary href. The ✎ bubbles to the cell's edit handler.
const TASK_RE = /^[A-Z][A-Z0-9]*-\d+$/;
function taskView(s) {
  if (!TASK_RE.test(s.task || '')) return [document.createTextNode(s.task || '—')];
  const a = el('a', null, s.task);
  a.href = 'https://linear.app/synchronicity/issue/' + s.task;
  a.target = '_blank';
  a.rel = 'noopener';
  const ed = el('button', 'ghost edit', '✎');
  ed.title = 'Edit task';
  return [a, ed];
}

const statusCell = (s) => {
  const td = el('td');
  td.append(el('span', 'spill ' + s.status, s.status));
  return td;
};
const agoCell = (iso) => {
  const a = ago(iso);
  return el('td', a.cls, a.text);
};

// Registry columns. `get` is the sort accessor (a column without one is not sortable);
// time columns sort on the raw ISO stamps, not the "3m ago" text the cell shows.
// Last msg = last assistant turn in the worker's Claude Code transcript; pane activity
// (Active) also moves for scrollback and input, so this is the truer idle signal.
const COL = {
  name: { key: 'name', label: 'Session', get: (s) => s.name, cell: (s) => el('td', 'mono', s.name) },
  host: { key: 'host', label: 'Host', get: (s) => s.host, cell: (s) => el('td', 'muted', s.host) },
  label: { key: 'label', label: 'Label', get: (s) => s.label, cell: (s) => editCell(s, 'label') },
  role: {
    key: 'role',
    label: 'Role/Worker',
    get: (s) => (s.role || s.worker) && s.role + '\t' + s.worker,
    cell: (s) => el('td', 'muted', [s.role, s.worker].filter(Boolean).join(' · ') || '—'),
  },
  group: { key: 'group', label: 'Group', get: (s) => s.group, cell: (s) => editCell(s, 'group') },
  task: { key: 'task', label: 'Task', get: (s) => s.task, cell: (s) => editCell(s, 'task', taskView) },
  note: { key: 'note', label: 'Note', get: (s) => s.note, cell: (s) => editCell(s, 'note') },
  status: { key: 'status', label: 'Status', get: (s) => s.status, cell: statusCell },
  active: { key: 'active_at', label: 'Active', get: (s) => s.active_at, time: true, cell: (s) => agoCell(s.active_at) },
  msg: { key: 'msg_at', label: 'Last msg', get: (s) => s.msg_at, time: true, cell: (s) => agoCell(s.msg_at) },
  seen: {
    key: 'last_seen_at',
    label: 'Last seen',
    get: (s) => s.last_seen_at,
    time: true,
    cell: (s) => el('td', 'muted', (s.live ? '' : 'gone · last seen ') + ago(s.last_seen_at).text),
  },
  actions: { label: 'Actions', cell: actionCell },
};

// Sub-tabs: the same rows, narrow triage columns vs. the wide classification ones.
const TABS = {
  overview: [COL.name, COL.group, COL.task, COL.status, COL.active, COL.msg, COL.seen, COL.actions],
  details: [COL.name, COL.host, COL.label, COL.role, COL.group, COL.task, COL.note, COL.status, COL.actions],
};

const fleetHead = document.getElementById('fleet-head');
let fleetSessions = []; // last fetch, so a header click re-sorts without a round trip
let fleetTab = localStorage.getItem('fleetTab') === 'details' ? 'details' : 'overview';
let fleetSort = {}; // per tab: { overview: { key, dir }, ... }; a missing entry = API order
try {
  const saved = JSON.parse(localStorage.getItem('fleetSort'));
  // Also swallows the pre-tab { key, dir } shape: its tab entries are simply absent.
  if (saved && typeof saved === 'object') fleetSort = saved;
} catch {} // a hand-mangled key must not take the table down

function sortSessions(list, cols, sort) {
  const col = cols.find((c) => c.get && c.key === sort?.key);
  if (!col) return list;
  const sign = sort.dir === 'desc' ? -1 : 1;
  return [...list].sort((a, b) => {
    const x = col.get(a);
    const y = col.get(b);
    // Unset values sink to the bottom in both directions — an unlabelled row is not "first".
    if (!x || !y) return x ? -1 : y ? 1 : 0;
    if (col.time) return sign * (Date.parse(x) - Date.parse(y));
    const l = String(x).toLowerCase();
    const r = String(y).toLowerCase();
    return sign * (l < r ? -1 : l > r ? 1 : 0);
  });
}

function renderFleet(sessions) {
  fleetSessions = sessions;
  const cols = TABS[fleetTab];
  const sort = fleetSort[fleetTab];
  fleetHead.replaceChildren();
  for (const c of cols) {
    const th = el(
      'th',
      c.get ? 'sortable' : null,
      c.label + (c.key && sort?.key === c.key ? (sort.dir === 'desc' ? ' ▼' : ' ▲') : '')
    );
    if (c.get) {
      th.title = 'Sort by ' + c.label;
      th.onclick = () => {
        fleetSort[fleetTab] = {
          key: c.key,
          dir: sort?.key === c.key && sort.dir === 'asc' ? 'desc' : 'asc',
        };
        localStorage.setItem('fleetSort', JSON.stringify(fleetSort));
        renderFleet(fleetSessions);
      };
    }
    fleetHead.append(th);
  }
  fleetRows.replaceChildren();
  for (const s of sortSessions(sessions, cols, sort)) {
    const tr = el('tr', s.live ? null : 'gone');
    for (const c of cols) tr.append(c.cell(s));
    fleetRows.append(tr);
  }
}

function setTab(tab) {
  fleetTab = tab;
  localStorage.setItem('fleetTab', tab);
  for (const t of Object.keys(TABS))
    document.getElementById('tab-' + t).classList.toggle('sel', t === tab);
  renderFleet(fleetSessions);
}
for (const t of Object.keys(TABS)) document.getElementById('tab-' + t).onclick = () => setTab(t);
setTab(fleetTab);

async function loadSessions() {
  const { sessions, errors } = await fetchSessions();
  renderFleet(sessions);
  listEl.replaceChildren();
  rows.clear();
  // The sidebar attaches terminals, so only live sessions belong in it.
  const liveSessions = sessions.filter((s) => s.live);
  const hiddenCount = liveSessions.filter((s) => s.status === 'hidden').length;
  const shown = showHidden ? liveSessions : liveSessions.filter((s) => s.status !== 'hidden');
  const multiHost = new Set(shown.map((s) => s.host)).size > 1;
  let host = null;
  for (const s of shown) {
    if (multiHost && s.host !== host) {
      host = s.host;
      listEl.append(el('div', 'host-label', host));
    }
    const row = el('div', s.status === 'hidden' ? 'session inactive' : 'session');
    row.title = s.name + (s.label ? ' · ' + s.label : '') + ' · active ' + ago(s.active_at).text;
    const go = el('button', 'ghost rowmax', '⤢');
    go.setAttribute('aria-label', 'Open fullscreen');
    go.title = 'Open fullscreen';
    go.onclick = (e) => {
      e.stopPropagation();
      openMax(s.host, s.name);
    };
    // Amber dot: someone tagged this session for killing, so it is visible without the table.
    row.append(el('span', 'dot' + (s.status === 'kill-requested' ? ' amber' : '')), el('span', 'name', s.name), go);
    // In fullscreen the drawer is a session switcher; in grid mode a row just adds a tile.
    row.onclick = () =>
      document.body.classList.contains('has-max')
        ? openMax(s.host, s.name)
        : openTile(s.host, s.name);
    listEl.append(row);
    rows.set(key(s.host, s.name), row);
  }
  if (hiddenCount) {
    const t = el(
      'div',
      'inactive-toggle',
      showHidden ? 'hide hidden' : 'show ' + hiddenCount + ' hidden'
    );
    t.onclick = () => {
      showHidden = !showHidden;
      localStorage.setItem('showHidden', showHidden ? '1' : '0');
      loadSessions();
    };
    listEl.append(t);
  }
  for (const e of errors) listEl.append(el('div', 'err', e.host + ': ' + e.message));
  if (!liveSessions.length && !errors.length) listEl.append(el('div', 'err', 'no sessions'));
  sync();
}

// The drawer only exists in fullscreen, so it closes whenever the last maximized tile goes.
function syncMaxBody() {
  const any = !!document.querySelector('.tile.max');
  document.body.classList.toggle('has-max', any);
  if (!any) document.body.classList.remove('drawer-open');
}

// Only one tile is maximized at a time; state lives on the element so any tile can clear another.
function setMax(tile, on) {
  tile.classList.toggle('max', on);
  const b = tile.querySelector('.maxbtn');
  b.textContent = on ? '⤡' : '⤢';
  b.setAttribute('aria-label', on ? 'Restore' : 'Maximize');
  b.title = on ? 'Restore (shift+esc)' : 'Maximize (shift+esc restores)';
  syncMaxBody();
  tile.dispatchEvent(new Event('refit'));
}

function toggleMax(tile) {
  // New tile first, so has-max never flickers off mid-switch and kills the drawer transition.
  setMax(tile, !tile.classList.contains('max'));
  for (const t of document.querySelectorAll('.tile.max')) if (t !== tile) setMax(t, false);
}

function openMax(host, session) {
  openTile(host, session);
  const tile = tiles.get(key(host, session));
  if (tile && !tile.classList.contains('max')) toggleMax(tile);
  document.body.classList.remove('drawer-open');
}

function openTile(host, session) {
  const k = key(host, session);
  if (tiles.has(k)) return;

  const tile = el('div', 'tile');
  const bar = el('div', 'bar');
  const title = el('span', 'title', session);
  title.append(el('span', 'host', ' · ' + host));
  const menuBtn = el('button', 'ghost menubtn', '☰');
  menuBtn.setAttribute('aria-label', 'Sessions');
  menuBtn.title = 'Sessions';
  menuBtn.onclick = () => document.body.classList.toggle('drawer-open');
  const maxBtn = el('button', 'ghost maxbtn', '⤢');
  maxBtn.setAttribute('aria-label', 'Maximize');
  maxBtn.title = 'Maximize (shift+esc restores)';
  maxBtn.onclick = () => toggleMax(tile);
  const close = el('button', 'ghost x', '✕');
  bar.append(menuBtn, title, maxBtn, close);
  bar.ondblclick = (e) => {
    if (!e.target.closest('button')) toggleMax(tile);
  };
  const termEl = el('div', 'term');
  tile.append(bar, termEl);
  grid.append(tile);
  tiles.set(k, tile);
  sync();

  const term = new Terminal({
    scrollback: 5000,
    fontSize: 12,
    theme: XTERM_THEME,
    // tmux/Claude enable mouse tracking, which swallows drag-selection; option+drag overrides.
    macOptionClickForcesSelection: true,
  });
  const fit = new FitAddon.FitAddon();
  term.loadAddon(fit);
  term.loadAddon(new WebLinksAddon.WebLinksAddon()); // URLs become cmd-clickable
  term.open(termEl);
  // tmux-style copy-on-select, straight to the Mac clipboard
  term.onSelectionChange(() => {
    const s = term.getSelection();
    if (s) navigator.clipboard.writeText(s).catch(() => {});
  });

  let ws = null;
  let tail = ''; // last output before death — used to spot a locked 1Password agent

  let stallTimer = null;
  const clearStall = () => {
    clearTimeout(stallTimer);
    stallTimer = null;
    tile.querySelector('.stall')?.remove();
  };

  const connect = () => {
    fit.fit();
    tile.classList.remove('dead');
    tile.querySelector('.overlay')?.remove();
    tail = '';
    clearStall();
    // a silent hang here = ssh blocked on the 1Password agent (locked or approval pending)
    stallTimer = setTimeout(() => {
      if (!tile.querySelector('.overlay'))
        tile.append(
          el('div', 'stall', 'no output — 1Password on this Mac may be locked or waiting for approval')
        );
    }, 15000);
    ws = new WebSocket(
      `ws://${location.host}/term?host=${encodeURIComponent(host)}&session=${encodeURIComponent(
        session
      )}&cols=${term.cols}&rows=${term.rows}`
    );
    // A resize during the ssh handshake is dropped (socket not open yet), leaving tmux
    // narrower than xterm — several tmux rows then pack onto one row. Replay it on open.
    ws.onopen = sendResize;
    ws.onmessage = (e) => {
      if (stallTimer) clearStall();
      if (typeof e.data === 'string' && e.data.startsWith('{"type":"exit"')) return;
      term.write(e.data);
      tail = (tail + e.data).slice(-2000);
    };
    ws.onclose = die;
  };

  const die = () => {
    clearStall();
    if (tile.querySelector('.overlay')) return;
    tile.classList.add('dead');
    const card = el('div', 'card');
    card.append(el('h2', null, 'Disconnected'));
    if (tail.includes(AGENT_LOCKED) || tail.includes('agent refused operation'))
      card.append(el('div', 'note', '1Password locked — unlock it, then Reconnect'));
    const btn = el('button', 'primary', 'Reconnect');
    btn.onclick = () => {
      term.reset();
      connect();
    };
    card.append(btn);
    const ov = el('div', 'overlay');
    ov.append(card);
    tile.append(ov);
  };

  term.onData((d) => ws?.readyState === 1 && ws.send(JSON.stringify({ type: 'input', data: d })));

  // Plain Esc must reach tmux/vim in the worker; only shift+Esc restores.
  term.attachCustomKeyEventHandler((e) => {
    if (e.type === 'keydown' && e.key === 'Escape' && e.shiftKey && tile.classList.contains('max')) {
      toggleMax(tile);
      return false;
    }
    return true;
  });

  const sendResize = () => {
    fit.fit();
    if (ws?.readyState === 1)
      ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
  };

  const ro = new ResizeObserver(sendResize);
  ro.observe(tile);

  // A position:fixed toggle doesn't reliably trip the observer, so setMax fires this.
  tile.addEventListener('refit', () => {
    sendResize();
    if (tile.classList.contains('max')) term.focus();
  });

  close.onclick = () => {
    ro.disconnect();
    ws.onclose = null;
    ws.close();
    term.dispose();
    tile.remove();
    tiles.delete(k);
    syncMaxBody(); // tile.remove() bypasses setMax, so the body classes are refreshed here
    sync();
  };

  connect();
}

document.getElementById('drawer-close').onclick = () =>
  document.body.classList.remove('drawer-open');
// Clicking anywhere outside the open drawer (e.g. the fullscreen terminal) closes it.
document.addEventListener('click', (e) => {
  if (
    document.body.classList.contains('drawer-open') &&
    !e.target.closest('#sidebar') &&
    !e.target.closest('.menubtn')
  )
    document.body.classList.remove('drawer-open');
});

document.getElementById('refresh').onclick = () => {
  loadSessions();
  loadHealth();
  loadAccounts();
};
const toggleFleet = (on = !fleetOpen) => {
  fleetOpen = on;
  if (fleetOpen) loadSessions();
  sync();
};
document.getElementById('fleet-btn').onclick = () => toggleFleet();
document.getElementById('nav-windows')?.addEventListener('click', () => toggleFleet(false));
document.getElementById('fleet-close')?.addEventListener('click', () => toggleFleet(false));
document.getElementById('empty-fleet')?.addEventListener('click', () => toggleFleet(true));
// Esc closes the table; tiles handle their own Esc inside xterm, which never bubbles here.
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && fleetOpen) toggleFleet(false);
});
document.getElementById('connect-all').onclick = async () => {
  const { sessions } = await fetchSessions();
  for (const s of sessions) {
    // hidden workers stay closed even while the toggle shows them; dead rows have nothing to attach to
    if (!s.live || s.status === 'hidden') continue;
    openTile(s.host, s.name);
    // stagger: concurrent ssh handshakes race the 1Password agent and one gets refused
    await new Promise((r) => setTimeout(r, 500));
  }
};

loadSessions();
loadHealth();
loadAccounts();
