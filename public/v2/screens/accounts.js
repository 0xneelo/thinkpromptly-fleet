// fd-v2 L8 accounts: owned by that slice.
//
// The Accounts (credits) screen. Behaviour spec: docs/goals/fd-v2-l8/BEHAVIOUR.md,
// ledger row D15. Today's screen is public/accounts.html + public/accounts.js; every
// text, threshold and ordering below is copied from there, not re-invented.
//
// Cross-slice contract:
//   Hooks PROVIDED by L8: none. The namespace below is defined anyway so a peer
//     slice that probes FD.screens.accounts finds an object, never undefined.
//   Hooks USED by L8: none. (A call into another slice would be written guarded —
//     FD.screens?.x?.y?.() — but there are none.)
//
// Data enters the UI ONLY through FD.setData('accountsLive', rows). S2 did not
// substitute the mock's `accounts` seed into fixture.js (it is one of the four seeds
// that are not byte-safe: the mock literal calls the theme helpers bar()/chipTone()/
// spark() on it), so per the DESIGN-35 broadcast this slice feeds a NEW key that its
// own logic.js method reads. In fixture mode (?fixture=1) this file does nothing at
// all: the compiled logic renders FD.fixture as-is and the pixel gate runs there.
(function (root, factory) {
  const screen = factory(root);
  root.FD = root.FD || {};
  root.FD.screens = root.FD.screens || {};
  // Preserve anything already on the namespace rather than replacing it.
  root.FD.screens.accounts = Object.assign(root.FD.screens.accounts || {}, screen);
  if (typeof module === 'object' && module.exports) module.exports = root.FD.screens.accounts;
})(typeof globalThis === 'object' ? globalThis : this, function (root) {
  'use strict';

  // ---------------------------------------------------------------------------
  // Vocabulary — accounts.js:3-14, verbatim.
  // ---------------------------------------------------------------------------

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

  // The windows that say whether this account is about to hit a wall — every rate window,
  // the per-model weeklies included (the driver runs on Fable); paid credits are not a wall.
  const MAIN = {
    claude: (r) => Object.entries(r.windows || {}).filter(([n]) => /^(five_hour|seven_day)/.test(n)).map(([, w]) => w),
    codex: (r) => [r.weekly, r.secondary],
  };

  // ---------------------------------------------------------------------------
  // Pure helpers. `now` is an argument throughout so the tests are deterministic;
  // the API stores epoch SECONDS on this endpoint (accounts.js:41,52).
  // ---------------------------------------------------------------------------

  const nowMs = (now) => (now === undefined ? Date.now() : now);

  // Past a day amber, past three red — a desktop sample only refreshes while that account
  // is actually being used, so its age is the whole story. accounts.js:40-47.
  function ago(epoch, now) {
    const ms = nowMs(now) - epoch * 1000;
    const m = Math.floor(ms / 60000);
    return {
      text: m < 1 ? 'just now' : m < 60 ? m + 'm ago' : m < 1440 ? Math.floor(m / 60) + 'h ago' : Math.floor(m / 1440) + 'd ago',
      cls: ms > 3 * 864e5 ? 'age-red' : ms > 864e5 ? 'age-amber' : '',
    };
  }

  // accounts.js:49-55. '' when the source carries no reset time at all.
  function until(epoch, now) {
    if (!epoch) return '';
    const m = Math.round((epoch * 1000 - nowMs(now)) / 60000);
    if (m <= 0) return 'resets now';
    return 'resets in ' + (m < 60 ? m + 'm' : Math.floor(m / 60) + 'h ' + (m % 60) + 'm');
  }

  // accounts.js:57. Red over 90, amber from 70 — the mock's own bar() stops at amber,
  // so L8 keeps its own copy rather than changing a helper the Machines screen shares.
  const level = (pct) => (pct > 90 ? 'red' : pct >= 70 ? 'amber' : '');

  // accounts.js:66-69. null when nothing reported a percentage: those sort last.
  function worst(r) {
    const p = (MAIN[r.kind] || MAIN.claude)(r).filter((w) => w && typeof w.pct === 'number').map((w) => w.pct);
    return p.length ? Math.max(...p) : null;
  }

  // accounts.js:196-199 — any main window at or over 100, or a capped credit pool.
  function atLimit(r) {
    const w = Object.values(r.windows || {}).concat(r.weekly || [], r.secondary || []);
    const c = r.credit;
    return w.some((x) => x && x.pct >= 100) || !!(c && c.capped);
  }

  // Most constrained first; an account nothing has reported has nothing to say and
  // sorts last. accounts.js:225-230, a stable sort over the paired rows.
  function order(pairs) {
    return pairs.slice().sort((a, b) => {
      const x = worst(a.raw);
      const y = worst(b.raw);
      if (x === null || y === null) return (x === null) - (y === null);
      return y - x;
    });
  }

  // Count and money, not percentages. Currencies are listed side by side — adding them
  // would invent a rate. accounts.js:193-211, verbatim.
  function summary(rows) {
    const spend = new Map();
    let hit = 0;
    for (const r of rows) {
      if (atLimit(r)) hit++;
      const c = r.credit;
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

  // accounts.js:171-186. Claude rows show the paid pool in money; codex rows show the
  // balance. Returns null when the row has no credit block to talk about.
  function creditsLine(r) {
    if (r.kind === 'claude') {
      const c = r.credit;
      if (!c || typeof c.limit !== 'number' || typeof c.used !== 'number') return null;
      const d = Number.isInteger(c.decimals) ? c.decimals : 2;
      const cur = c.currency ? ' ' + c.currency : '';
      return {
        text: 'credits: ' + c.used.toFixed(d) + ' / ' + c.limit.toFixed(d) + cur +
          (c.capped ? ' · spend limit reached' : '') + (c.enabled ? '' : ' · extra usage off'),
        notice: !!c.capped,
      };
    }
    const c = r.credits;
    if (!c || !c.has_credits) return null;
    return { text: 'credits: ' + (c.unlimited ? 'unlimited' : c.balance), notice: false };
  }

  // accounts.js:107-115. The polyline the mock's trend svg draws. The mock's viewBox is
  // 0 0 100 24 (the old page used 0 0 100 28), so the y scale follows the mock —
  // improvised.md I-L8-05. x is time-scaled so gaps in sampling read as gaps.
  const TREND_H = 24;
  function trend(history) {
    const pts = (history || []).filter((s) => s && typeof s.sd === 'number');
    if (pts.length < 2) return null;
    const t0 = pts[0].t;
    const span = pts[pts.length - 1].t - t0;
    const points = pts.map((s, i) => {
      // All samples in the same second (or a one-point span) would divide by zero, so
      // the fallback spreads them evenly by index instead.
      const x = span > 0 ? ((s.t - t0) / span) * 100 : (i / (pts.length - 1)) * 100;
      return x.toFixed(2) + ',' + (TREND_H - (Math.max(0, Math.min(100, s.sd)) / 100) * TREND_H).toFixed(2);
    });
    const last = pts[pts.length - 1].sd;
    return {
      points: points.join(' '),
      pct: last + '%',
      level: level(last),
      // accounts.js:113 — the svg <title> the old page carried.
      title: Math.max(1, Math.round(span / 86400)) + ' days, ' + pts.length + ' samples',
    };
  }

  // The header's source text: 'live' / 'desktop snapshot' / 'push', plus whose numbers
  // are actually on show when the live reply carried none. accounts.js:135-137.
  function sourceText(r) {
    if (!r.source) return '';
    return (SOURCE[r.source] || r.source) +
      (r.windows_from ? ' · usage from ' + (SOURCE[r.windows_from] || r.windows_from) : '');
  }

  // accounts.js:154-166. An expired token still leaves whatever another source reported,
  // so the notice sits above the bars rather than replacing them; rate limiting says
  // nothing about the account, so it must not read like a fault ('muted', not 'notice').
  function banner(r) {
    if (r.state === 'token_expired') return { text: 'token expired — open Claude Code on ' + r.host, tone: 'notice' };
    if (r.state === 'rate_limited') return { text: 'usage endpoint busy on ' + r.host + ' — figures below are the last good read', tone: 'muted' };
    if (r.state === 'error') return { text: 'could not read usage on ' + r.host, tone: 'notice' };
    return null;
  }

  // accounts.js:168-178. Older than the window it measured means that window has reset
  // since, so the reading is history, not a current figure.
  function staleNote(r, now) {
    if (!r.sample_ts) return null;
    const a = ago(r.sample_ts, now);
    return {
      text: r.stale_windows
        ? 'sampled ' + a.text + ' — older than the window it measured, so these have reset since'
        : 'sampled ' + a.text + ' — no reset times in this source',
      cls: a.cls,
    };
  }

  // The bars, in the order the old page sorted them: five_hour, seven_day, the model
  // weeklies, extra last. accounts.js:180-183 for claude, :186-189 for codex.
  function bars(r, now) {
    const out = [];
    if (r.kind === 'claude') {
      Object.keys(r.windows || {})
        .sort((a, b) => rank(a) - rank(b))
        .forEach((n) => out.push(barOf(label(n), r.windows[n], now)));
      return out;
    }
    if (r.weekly) out.push(barOf(label('weekly'), r.weekly, now));
    if (r.secondary) out.push(barOf(label('secondary'), r.secondary, now));
    return out;
  }

  // accounts.js:72-84: a window with no percentage still gets a row — an empty bar says
  // "reported, unknown".
  function barOf(name, w, now) {
    const pct = w && typeof w.pct === 'number' ? w.pct : null;
    return {
      label: name,
      pct,
      right: pct === null ? '—' : pct + '%',
      level: pct === null ? '' : level(pct),
      resets: until(w && w.resets_at, now),
    };
  }

  // ---------------------------------------------------------------------------
  // The row the logic.js accounts method renders. FD.data.toAccounts supplies the
  // base identity fields; L8 overlays every field whose text the adapter does not
  // reproduce verbatim (see REPORT.md "adapter deltas") and adds the ones the mock
  // has no slot for at all.
  // ---------------------------------------------------------------------------

  function enrich(base, r, now) {
    const a = ago(r.updated_at, now);
    const t = r.kind === 'claude' ? trend(r.history) : null;
    const b = banner(r);
    const s = staleNote(r, now);
    const credits = creditsLine(r);
    const tier = TIER[r.tier] || r.tier || TIER[r.type] || r.type;
    const rowBars = bars(r, now);
    return Object.assign({}, base, {
      // Header. The pill is green only when a source reported and the read was clean.
      pillTone: r.source && r.state === 'ok' ? 'green' : r.source ? 'amber' : '',
      prov: r.kind,
      name: r.label || r.email || r.id,
      email: r.email || '',
      // Eight characters is enough to match a row against credits-accounts.json by eye.
      id: r.org ? String(r.org).slice(0, 8) : '',
      plan: (tier || '') + (r.kind === 'codex' && r.plan ? (tier ? ' ' : '') + r.plan : ''),
      live: sourceText(r),
      unconfirmed: !r.confirmed,
      right: r.updated_at ? a.text + ' · ' + (r.source === 'push' ? 'push' : r.host) : '',
      // Body.
      noData: !r.source,
      banner: b ? b.text : '',
      bannerTone: b ? b.tone : '',
      staleNote: s ? s.text : '',
      staleCls: s ? s.cls : '',
      bars: rowBars,
      noWindows: !!r.source && r.kind === 'claude' && rowBars.length === 0,
      creditsText: credits ? credits.text : '',
      creditsNotice: !!(credits && credits.notice),
      note: '', noteTone: '',
      trendPts: t ? t.points : '',
      trendPct: t ? t.pct : '',
      trendLevel: t ? t.level : '',
      // A claude row with nothing to plot still says so, as the old page did.
      noHistory: r.kind === 'claude' && !!r.source && !t,
      seen: (r.seen || []).map((x) => x.host + ' · ' + (SOURCE[x.source] || x.source)).join(', '),
      // Rows at or over a limit open by default in live mode — improvised.md I-L8-02.
      atLimit: atLimit(r),
    });
  }

  // The mock's card carries exactly ONE free text line (the sampled note). Today's page
  // has up to five, so L8 joins them into that one line with the mock's own separator,
  // each sentence verbatim, and colours the line by the strongest tone present.
  // improvised.md I-L8-03. Foreign DOM inside a compiled card is not an option
  // (DESIGN-35 binding, 2026-09-08): a card is an sc-for row with a positional
  // identity, and the runtime deletes foreign children whenever it reconciles one.
  function note(a) {
    const parts = [];
    if (a.noData) parts.push('no data yet — run push from their machine');
    else {
      if (a.staleNote) parts.push(a.staleNote);
      if (a.noWindows) parts.push('no usage windows reported');
      if (a.creditsText) parts.push(a.creditsText);
      if (a.noHistory) parts.push('no history yet');
    }
    if (a.unconfirmed) parts.push('unconfirmed mapping');
    a.note = parts.join(' · ');
    a.noteTone = a.staleCls === 'age-red' ? 'bad'
      : (a.staleCls === 'age-amber' || a.unconfirmed || a.creditsNotice) ? 'warn'
      : 'muted';
    return a;
  }

  // credits payload -> the rows logic.js renders, most constrained first.
  function toRows(payload, now, toAccounts) {
    const raw = (payload && payload.rows) || [];
    const base = toAccounts ? toAccounts(payload, now) : raw.map(() => ({}));
    const pairs = raw.map((r, i) => ({ raw: r, base: base[i] || {} }));
    // The raw row travels with its view row: the summary bar counts limits and money
    // from the API's own numbers, never from rendered text.
    return order(pairs).map((p) => Object.assign(note(enrich(p.base, p.raw, now)), { __raw: p.raw }));
  }

  // accounts.js:219 — '<host>: <message>' per collector error.
  const toErrors = (payload) => ((payload && payload.errors) || []).map((e) => e.host + ': ' + e.message);

  const pure = {
    ago, until, level, worst, atLimit, order, summary, creditsLine, trend,
    sourceText, banner, staleNote, bars, barOf, enrich, note, toRows, toErrors, label,
    WIN_LABEL, SOURCE, TIER,
  };

  // In Node (the unit tests) there is no document and nothing below this point runs.
  if (typeof document === 'undefined') return Object.assign({ slice: 'l8' }, pure);

  // ---------------------------------------------------------------------------
  // Live mode. Fixture mode never reaches any of this.
  // ---------------------------------------------------------------------------

  const SCREEN = '[data-screen-label="Accounts"]';
  const CHROME = 'fd-l8-chrome';
  const data = () => (root.FD && root.FD.data) || null;

  const state = { rows: [], errors: [], error: '', loading: false, loaded: false };

  // The tokens the mock's own theme built this render, published by the L8 method in
  // logic.js. The improvised chrome paints in these and follows the theme toggle.
  const tok = () => (root.FD.screens.accounts.tokens || {});

  function el(tag, style, text) {
    const n = document.createElement(tag);
    if (style) n.setAttribute('style', style);
    if (text !== undefined) n.textContent = text;
    return n;
  }

  // ---------------------------------------------------------------------------
  // Improvised chrome.
  //
  // The mock's Accounts screen has no counterpart for the summary counts, the full
  // privacy note, the collector-errors panel or Refresh; its summary bar is static
  // text compiled into app.js, and the runtime rewrites a text node on every flush,
  // so those counts cannot be bound. None of it may be mounted inside a compiled
  // node (DESIGN-35 binding, 2026-09-08), so all of it lives in one container this
  // file owns, appended to document.body OUTSIDE #dc-root, and tracks the mock's own
  // summary row. improvised.md I-L8-01 and I-L8-04.
  //
  // The compiled nodes themselves are only ever RESTYLED, never given children: the
  // four static summary spans are hidden with visibility (which keeps the row's box,
  // so the overlay lands on it), and the note line is recoloured. Neither property
  // appears in the styles the template binds, and setProp only writes the properties
  // present in the new style object, so neither write is undone by a re-render.
  // ---------------------------------------------------------------------------
  const PRIVACY = "Usage per AI account, most constrained first. Every machine reads its own token locally and reports only percentages — no access token ever leaves the machine that owns it. The trend line is the Claude desktop app's own samples, merged across machines. Names and org mapping live in credits-accounts.json.";

  function chrome() {
    let box = document.getElementById(CHROME);
    if (!box) {
      box = el('div');
      box.id = CHROME;
      box.append(el('div'));                  // the one improvised block
      box.children[0].id = 'fd-l8-summary';
      document.body.appendChild(box);
    }
    return box;
  }

  const show = (n, on) => { n.style.display = on ? '' : 'none'; };

  // Everything improvised sits in ONE block anchored to the mock's summary row: the
  // counts, the full privacy note, the collector errors and Refresh. The mock's row is
  // one line high and the real privacy note is four, so the compiled row's minHeight is
  // set to the block's height and the cards sit below it — a style write on a compiled
  // node, never a child. minHeight is not among the properties the template binds on
  // that row, and setProp only writes the properties present in the new style object,
  // so a re-render never undoes it.
  function paintChrome(over, bar, screen) {
    const t = tok();
    const r = bar.getBoundingClientRect();
    over.setAttribute('style', 'position:fixed;z-index:5;pointer-events:none;display:flex;' +
      'flex-direction:column;gap:10px;left:' + r.left + 'px;top:' + r.top + 'px;width:' + r.width + 'px;');
    over.replaceChildren();

    const counts = el('div', 'display:flex;gap:24px;align-items:baseline;font-size:12.5px;color:' + t.ink60 + ';');
    summary(state.rows.map((x) => x.__raw)).forEach((text, i) => {
      const span = el('span');
      if (i < 2) {
        // '<N> accounts' — the count in ink, the word muted, as the mock has it.
        const cut = text.indexOf(' ');
        span.append(el('span', 'color:' + t.ink + ';font-weight:500;', text.slice(0, cut)));
        span.append(document.createTextNode(text.slice(cut)));
      } else span.textContent = text;
      counts.append(span);
    });
    counts.append(el('span', 'margin-left:auto;font-size:11.5px;color:' + t.ink35 +
      ';max-width:420px;text-align:right;', PRIVACY));
    over.append(counts);

    if (state.errors.length) {
      const panel = el('div', 'pointer-events:auto;border-radius:12px;border:1px solid ' + t.line +
        ';background:' + t.panel + ';box-shadow:' + t.panelShadow +
        ';backdrop-filter:blur(28px) saturate(150%);-webkit-backdrop-filter:blur(28px) saturate(150%);padding:' +
        (t.cardPad || '18px 20px') + ';display:flex;flex-direction:column;gap:8px;');
      panel.append(el('span', 'font-size:12.5px;font-weight:500;color:' + t.ink + ';', 'Collector errors'));
      state.errors.forEach((e) => panel.append(el('p', 'margin:0;font-size:12px;color:' + t.bad + ';', e)));
      over.append(panel);
    }

    const row = el('div', 'display:flex;align-items:center;gap:12px;');
    const btn = el('button', 'pointer-events:auto;border-radius:9999px;border:1px solid ' + t.line +
      ';background:transparent;color:' + t.ink75 + ';padding:6px 16px;font-size:12.5px;cursor:pointer;' +
      'transition:background .2s;', 'Refresh');
    btn.id = 'accounts-refresh';
    btn.disabled = state.loading;
    btn.onclick = () => load(true);
    row.append(btn);
    if (state.error) row.append(el('span', 'font-size:12px;color:' + t.bad + ';', state.error));
    over.append(row);

    // Reserve the room the block needs. Writing it back settles in one more frame:
    // the style mutation wakes the observer, the next pass measures the same height
    // and writes nothing.
    const need = Math.ceil(over.getBoundingClientRect().height) + 'px';
    if (bar.style.minHeight !== need) bar.style.minHeight = need;
  }

  // One idempotent pass. Cheap enough to run on scroll: it reads one rect and writes
  // text it has already computed.
  let painting = false;
  function paint() {
    if (painting) return;
    painting = true;
    try {
      const screen = document.querySelector(SCREEN);
      const box = chrome();
      // offsetParent is null while the screen is display:none behind another tab. A
      // failed load has no rows but still has something to say, so it shows too.
      const live = !!(screen && screen.offsetParent && (state.loaded || state.error));
      show(box, live);
      if (!live) return;
      const bar = screen.children[0];
      if (bar) {
        // visibility, not display: the row keeps its box, so the overlay lands on it.
        for (const c of bar.children) c.style.visibility = 'hidden';
        paintChrome(box.children[0], bar, screen);
      }
      // The note line's tone: muted until the sample is old, amber past a day, red
      // past three (accounts.js:44-46, 171). The template paints every one of them
      // warn, so the tone is restored here.
      const t = tok();
      const cards = document.querySelectorAll(SCREEN + ' div[data-dc-tpl="573"]');
      cards.forEach((card, i) => {
        const row = state.rows[i];
        const p = card.querySelector('p');
        if (!row || !p) return;
        p.style.color = row.noteTone === 'bad' ? t.bad : row.noteTone === 'warn' ? t.warn : t.ink60;
      });
    } catch (e) {
      console.error(e);
    } finally {
      painting = false;
    }
  }

  // The chrome tracks the mock's own layout, so it is re-placed whenever the page
  // moves under it. The root is watched, not the screen: the app opens on the landing
  // view, so the Accounts screen does not exist yet when the first response lands.
  let queued = false;
  function sync() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; paint(); });
  }

  let observer = null;
  function watch() {
    if (observer) return;
    addEventListener('scroll', sync, true);
    addEventListener('resize', sync);
    if (typeof MutationObserver !== 'function') return;
    observer = new MutationObserver(sync);
    observer.observe(document.getElementById('dc-root') || document.body,
      { childList: true, subtree: true, attributes: true, attributeFilter: ['style'] });
  }

  // ---------------------------------------------------------------------------
  // Load. No polling: a collect fans out over ssh, so it runs only when the page or
  // the operator asks for it (accounts.js:234-250).
  // ---------------------------------------------------------------------------

  async function load(force) {
    const api = data();
    if (!api) return;
    state.loading = true;
    state.error = '';
    push();
    try {
      const payload = await api.credits(force ? { refresh: true } : {});
      state.rows = toRows(payload, undefined, api.toAccounts);
      state.errors = toErrors(payload);
      state.loaded = true;
    } catch (e) {
      // accounts.js:243 — the whole list is replaced by the failure, verbatim.
      state.error = 'cannot reach fleetdeck';
      state.rows = [];
      state.errors = [];
    } finally {
      state.loading = false;
      push();
    }
  }

  // The ONLY data entry point.
  function push() {
    root.FD.setData('accountsLive', state.rows);
    // setData re-renders on a microtask; the chrome follows on the next frame.
    sync();
  }

  // The shell's index.html loads runtime, fixture, logic, app and the screen files —
  // not public/v2/data.js, so FD.data is absent on a plain page load. index.html is
  // S2's file and no slice may edit it, so the screen fetches its own data layer. The
  // id is shared, so nine slices asking for it still load it exactly once.
  function withData(cb) {
    if (data()) return cb();
    let tag = document.getElementById('fd-data-js');
    if (!tag) {
      tag = document.createElement('script');
      tag.id = 'fd-data-js';
      tag.src = '/v2/data.js';
      document.head.appendChild(tag);
    }
    tag.addEventListener('load', cb, { once: true });
    tag.addEventListener('error', cb, { once: true });
  }

  function start() {
    withData(() => {
      const api = data();
      // Fixture mode renders FD.fixture as-is: never call setData there.
      if (!api || api.isFixture()) return;
      watch();
      load(false);
    });
  }

  const screen = Object.assign({ slice: 'l8', start, load, paint, state }, pure);

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else Promise.resolve().then(start);

  return screen;
});
