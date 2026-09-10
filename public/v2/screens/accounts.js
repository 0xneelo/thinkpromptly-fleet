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

  // A pause has an end, and a clock time is the one form of it a reader can act on.
  function hhmm(epoch) {
    const d = new Date(epoch * 1000);
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
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
  // A desktop sample newer than the live read supplies the windows it covers (server.js
  // freshen); the row stays the live read's, so the header names exactly those windows.
  // A held live read is named here too: a collapsed card shows its header and nothing
  // else, and 'desktop snapshot' alone reads as if nobody had tried.
  function sourceText(r, now) {
    if (!r.source) return '';
    return (SOURCE[r.source] || r.source) +
      (r.windows_from ? ' · usage from ' + (SOURCE[r.windows_from] || r.windows_from) : '') +
      (r.fresh ? ' · ' + r.fresh.windows.map(label).join(', ') + ' from a desktop sample ' + ago(r.fresh.t, now).text : '') +
      (r.hold ? ' · live read ' + (r.hold.state === 'rate_limited' ? 'throttled' : 'refused') + ' on ' + r.hold.host +
        (r.hold.until ? ' until ' + hhmm(r.hold.until) : '') : '');
  }

  // accounts.js:154-166. An expired token still leaves whatever another source reported,
  // so the notice sits above the bars rather than replacing them; rate limiting says
  // nothing about the account, so it must not read like a fault ('muted', not 'notice').
  // A held read leaves the row's own state 'ok' — the numbers are the last good ones and a
  // better source may even have supplied them. `hold` is the only sign the live call is not
  // being made, so it speaks first.
  function banner(r) {
    // A row that never got a good read has no figures to point at.
    const below = r.windows && Object.keys(r.windows).length ? ' — figures below are the last good read' : '';
    if (r.hold)
      return {
        text: 'usage call ' +
          (r.hold.state === 'rate_limited' ? 'throttled' : r.hold.state === 'token_expired' ? 'refused, token expired' : 'failed') +
          ' on ' + r.hold.host + (r.hold.until ? ' until ' + hhmm(r.hold.until) : '') + below,
        tone: r.hold.state === 'rate_limited' ? 'muted' : 'notice',
      };
    if (r.state === 'token_expired') return { text: 'token expired — open Claude Code on ' + r.host, tone: 'notice' };
    if (r.state === 'rate_limited') return { text: 'usage endpoint busy on ' + r.host + below, tone: 'muted' };
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
  // An aged-out window keeps the number it last held (server.js agedOut): shown as "was 42%"
  // and drawn grey, it says more than "—" without claiming to be a current figure.
  function barOf(name, w, now) {
    const pct = w && typeof w.pct === 'number' ? w.pct : null;
    const last = pct === null && w && typeof w.last === 'number' ? w.last : null;
    return {
      label: name,
      pct,
      ...(last === null ? {} : { last }),
      right: pct !== null ? pct + '%' : last !== null ? 'was ' + last + '%' : '—',
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
      live: sourceText(r, now),
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

  // A machines view -> the progress popup's rows. A Refresh runs the logins sweep first
  // (server.js: GET /api/credits?refresh=1), and `sweep` is how that sweep says which box it
  // is still waiting on. An unknown status reads as pending: a row is never claimed done on
  // a word this file does not know.
  const ERR_MAX = 60;
  function progressRows(view) {
    const list = (view && view.sweep && view.sweep.machines) || [];
    return list.map((m) => ({
      id: m.id,
      label: m.label || m.id,
      status: m.status === 'ok' || m.status === 'error' ? m.status : 'pending',
      // Tenths, from the server's milliseconds: a pending row ticks and a fast one is not 0.
      secs: Math.round(Math.max(0, Number(m.ms) || 0) / 100) / 10,
      error: typeof m.error === 'string' && m.error
        ? (m.error.length > ERR_MAX ? m.error.slice(0, ERR_MAX - 1) + '…' : m.error)
        : '',
    }));
  }

  // The one line the popup closes on. Counts what was polled, not what is configured: a
  // push-only machine is nothing this sweep waited for.
  function progressSummary(rows, accounts) {
    if (!rows.length) return 'no machines polled';
    const ok = rows.filter((r) => r.status === 'ok').length;
    const bad = rows.filter((r) => r.status === 'error').length;
    const live = (accounts || []).filter((a) => a.status === 'live').length;
    const held = (accounts || []).length - live;
    return [rows.length + (rows.length === 1 ? ' machine' : ' machines'), ok + ' ok']
      .concat(bad ? [bad + ' failed'] : [])
      .concat(accounts && accounts.length ? [live + (live === 1 ? ' account' : ' accounts') + ' read live'] : [])
      .concat(held ? [held + ' not read'] : [])
      .join(' · ');
  }

  // Which accounts the sweep actually read, from the machines view the popup already polls:
  // every profile-proved Claude login, with the collector's own words when its usage call
  // was skipped or refused. "6 machines ok" says nothing about accounts; this does.
  const NOT_READ = /refused|skipped|rate-limited|no answer|not the object/;
  function accountLines(view) {
    const out = [];
    for (const m of (view && view.machines) || []) {
      for (const c of m.clients || []) {
        if (!c || c.client !== 'claude_cli' || c.proof !== 'profile' || !c.email) continue;
        const note = typeof c.note === 'string' ? c.note : '';
        const read = !NOT_READ.test(note);
        out.push({ email: c.email, host: m.label || m.id, status: read ? 'live' : 'held', text: read ? 'usage read live' : note });
      }
    }
    return out;
  }

  // Every call the deck made to the usage endpoint, as the deck stored it: a client row's
  // `note` is one sentence the next sweep overwrites, so this is the only place a run of
  // refusals can be read back. Three shapes — a read that answered, one the endpoint
  // refused, one the deck did not make because a pause was still standing.
  const LOG_PCT = [['fh', '5h'], ['sd', '7d'], ['sf', 'Fable']];
  function usageLogLines(payload, now) {
    const out = [];
    for (const r of (payload && payload.usage_log) || []) {
      if (!r || typeof r !== 'object') continue;
      // A skewed box clock would put its lines at the top of the list forever.
      if (typeof r.t !== 'number' || r.t > now) continue;
      const note = typeof r.note === 'string' ? r.note : '';
      let text, tone;
      if (r.skipped) {
        text = 'skipped · ' + note;
        tone = 'muted';
      } else if (r.state === 'ok') {
        text = [String(r.code || 200)]
          .concat(LOG_PCT.filter(([k]) => typeof r[k] === 'number').map(([k, l]) => l + ' ' + r[k] + '%'))
          .join(' · ');
        tone = 'ok';
      } else {
        // The structured columns carry everything but the streak, which only the note says.
        const ord = /\((\d+\w+ refusal)\)/.exec(note);
        text =
          [r.code ? 'HTTP ' + r.code : 'no answer']
            .concat(r.retry_after ? ['retry-after ' + r.retry_after + 's'] : [])
            .concat(r.pause ? ['paused ' + r.pause + 's'] : [])
            .join(' · ') + (ord ? ' (' + ord[1] + ')' : '');
        tone = 'bad';
      }
      out.push({ time: hhmm(r.t), host: r.host || '', email: r.email || '', text, tone });
    }
    return out;
  }

  const pure = {
    ago, until, hhmm, level, worst, atLimit, order, summary, creditsLine, trend,
    sourceText, banner, staleNote, bars, barOf, enrich, note, toRows, toErrors, label,
    progressRows, progressSummary, accountLines, usageLogLines,
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

  const state = { rows: [], errors: [], error: '', loading: false, loaded: false, log: [] };

  // The tokens the mock's own theme built this render, published by the L8 method in
  // logic.js. The improvised chrome paints in these and follows the theme toggle.
  const tok = () => (root.FD.screens.accounts.tokens || {});

  // The ruling of 2026-09-08: style writes onto compiled nodes are allowed when they are
  // re-applied idempotently on every render and listed in improvised.md, but a data-*
  // hook driven by a stylesheet rule is preferred to a per-node inline write. So this
  // file writes exactly three ATTRIBUTES onto compiled nodes and nothing else; the
  // colours and the reserved height arrive as custom properties on <html>, which the
  // runtime does not manage.
  const STYLE_ID = 'fd-l8-style';
  const RULES = [
    '[data-fd-l8-hidden="1"]{visibility:hidden!important}',
    '[data-fd-l8-bar="1"]{min-height:var(--fd-l8-bar-h,0px)!important}',
    '[data-fd-l8-note="bad"]{color:var(--fd-l8-bad)!important}',
    '[data-fd-l8-note="warn"]{color:var(--fd-l8-warn)!important}',
    '[data-fd-l8-note="muted"]{color:var(--fd-l8-muted)!important}',
  ].join('\n');

  function rules() {
    let tag = document.getElementById(STYLE_ID);
    if (!tag) {
      tag = document.createElement('style');
      tag.id = STYLE_ID;
      tag.textContent = RULES;
      document.head.appendChild(tag);
    }
    return tag;
  }

  // Setting an attribute that already holds the value still queues a mutation record in
  // some engines, and every record wakes the observer, so each write is guarded.
  function attr(node, name, value) {
    if (node.getAttribute(name) !== value) node.setAttribute(name, value);
  }

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
      box.append(el('div'));                  // the usage-call log, below the last card
      box.children[1].id = 'fd-l8-usage-log';
      document.body.appendChild(box);
    }
    return box;
  }

  const show = (n, on) => { n.style.display = on ? '' : 'none'; };

  // The screen's children are the summary row followed by one node per account. Taken
  // structurally so no compiled template id is baked into this file.
  const cardEls = (screen) => Array.prototype.slice.call(screen.children, 1);

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

    // Reserve the room the block needs, as a custom property on <html> that the
    // stylesheet rule reads — the compiled row itself only carries the hook. Settles in
    // one more frame: the change wakes the observer, the next pass measures the same
    // height and writes nothing.
    const need = Math.ceil(over.getBoundingClientRect().height) + 'px';
    if (document.documentElement.style.getPropertyValue('--fd-l8-bar-h') !== need) {
      document.documentElement.style.setProperty('--fd-l8-bar-h', need);
    }
  }

  // The usage-call log sits BELOW the last account card, so it is placed in document
  // coordinates rather than in the chrome's fixed frame — it scrolls with the cards it
  // belongs to. Its own node in the container this file owns; nothing compiled is touched.
  // Long by nature, so it folds, and the fold is remembered.
  const LOG_OPEN = 'fd-usage-log-open';
  const LOG_MAX = 100; // what one screen can be read from; the payload carries more
  // Private browsing throws on both, and a log that cannot remember its fold still works.
  // Folded until the operator opens it: the cards are the page, the log is the receipts.
  const logOpen = () => {
    try {
      return localStorage.getItem(LOG_OPEN) === '1';
    } catch (e) {
      return false;
    }
  };
  const setLogOpen = (on) => {
    try {
      localStorage.setItem(LOG_OPEN, on ? '1' : '0');
    } catch (e) {}
  };

  function paintUsageLog(box, cards, screen) {
    const t = tok();
    const lines = state.log.slice(0, LOG_MAX);
    const open = logOpen();
    const last = cards[cards.length - 1] || screen;
    const r = last.getBoundingClientRect();
    const s = screen.getBoundingClientRect();
    // The same box the cards are: a bordered panel, below the last card, at the cards' width.
    box.setAttribute('style', 'position:absolute;z-index:4;display:flex;flex-direction:column;gap:3px;left:' +
      (s.left + scrollX) + 'px;top:' + (r.bottom + scrollY + 18) + 'px;width:' + s.width + 'px;box-sizing:border-box;' +
      'border-radius:12px;border:1px solid ' + t.line + ';background:' + t.panel + ';box-shadow:' + t.panelShadow +
      ';padding:' + (t.cardPad || '18px 20px') + ';');
    // The box floats, so the screen must leave room to scroll to it.
    screen.style.paddingBottom = (open ? Math.min(lines.length, LOG_MAX) * 17 + 90 : 70) + 'px';
    box.replaceChildren();
    if (!lines.length) return; // nothing called yet: a header alone says less than no header
    const head = el('div', 'display:flex;align-items:baseline;gap:10px;font-size:11px;letter-spacing:.06em;' +
      'text-transform:uppercase;color:' + t.ink45 + ';');
    head.append(el('span', '', 'usage calls · newest first · ' + lines.length + ' shown'));
    const toggle = el('button', 'border:0;background:transparent;padding:0;cursor:pointer;font:inherit;' +
      'letter-spacing:inherit;text-transform:inherit;color:' + t.ink60 + ';', open ? 'hide' : 'show');
    toggle.onclick = () => {
      setLogOpen(!open);
      paint();
    };
    head.append(toggle);
    box.append(head);
    if (!open) return;
    const TONE = { ok: t.ink60, bad: t.bad, muted: t.ink45 };
    lines.forEach((l) => {
      box.append(el('div', 'font-size:11.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:' +
        (TONE[l.tone] || t.ink60) + ';', [l.time, l.host, l.email, l.text].filter(Boolean).join(' · ')));
    });
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
      rules();
      const t = tok();
      const html = document.documentElement.style;
      html.setProperty('--fd-l8-bad', t.bad || '');
      html.setProperty('--fd-l8-warn', t.warn || '');
      html.setProperty('--fd-l8-muted', t.ink60 || '');

      const bar = screen.children[0];
      if (bar) {
        // visibility, not display: the row keeps its box, so the overlay lands on it.
        attr(bar, 'data-fd-l8-bar', '1');
        for (const c of bar.children) attr(c, 'data-fd-l8-hidden', '1');
        paintChrome(box.children[0], bar, screen);
      }

      // The cards are found by STRUCTURE — the screen's element children after the
      // summary row — never by a compiled data-dc-tpl id, which changes on any template
      // regeneration and would fail silently. Each card is then marked with this slice's
      // own hook, which is what the live proof asserts against.
      const cards = cardEls(screen);
      let notes = 0;
      cards.forEach((card, i) => {
        const row = state.rows[i];
        if (!row) return;
        attr(card, 'data-fd-l8-card', String(i));
        // The note line's tone: muted until the sample is old, amber past a day, red
        // past three (accounts.js:44-46, 171). The template paints every one of them
        // warn, so the tone is restored by the hook, not by an inline colour.
        const p = card.querySelector('p');
        if (!p) return;
        attr(p, 'data-fd-l8-note', row.noteTone || 'muted');
        notes++;
      });
      paintUsageLog(box.children[1], cards, screen);
      // Published so the live proof can fail loudly if a paint ever matches nothing.
      root.FD.screens.accounts.painted = { cards: cards.length, notes: notes, rows: state.rows.length };
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
    observer.observe(document.getElementById('dc-root') || document.body, {
      childList: true, subtree: true, attributes: true,
      // 'style' catches the theme swap rewriting a bound colour; the three hooks catch a
      // reconciler pass resetting one of them, so every render re-applies idempotently.
      attributeFilter: ['style', 'data-fd-l8-note', 'data-fd-l8-hidden', 'data-fd-l8-bar'],
    });
  }

  // The compiled header carries its own "Refresh" button with a null onclick, rendered for
  // every screen with per-screen copy — so it is wired by delegation rather than by editing
  // anything compiled: on Accounts it runs the same load(true), on every other screen it
  // stays the no-op it is today.
  let delegated = false;
  function delegate() {
    if (delegated) return;
    delegated = true;
    document.addEventListener('click', (e) => {
      const btn = e.target && e.target.closest && e.target.closest('button');
      if (!btn || btn.id === 'accounts-refresh') return; // the chrome's own pill wires itself
      if (btn.textContent.trim() !== 'Refresh' || !btn.closest('main header')) return;
      const router = root.FD && root.FD.router;
      if (!router || router.route().screen !== 'accounts') return;
      load(true);
    });
  }

  // ---------------------------------------------------------------------------
  // Refresh progress popup. A forced refresh sweeps every polled machine over ssh
  // before it merges the readings, which takes tens of seconds — so it says what it
  // is waiting on. Its own fixed panel on document.body, in the same theme tokens as
  // the chrome above, and nothing compiled is touched.
  // ---------------------------------------------------------------------------

  const PROGRESS = 'accounts-progress';
  const GLYPH = { pending: '○', ok: '●', error: '✕' };
  const progress = { open: false, title: '', rows: [], accounts: [], merging: false, note: '', failed: false };
  let poller = null;
  let closeTimer = null;
  // One generation per opening. `load` is exported, so a second refresh can open the popup
  // while the first is still awaiting the API; the first's ticks and its finish must then
  // write nothing into the popup the second now owns.
  let gen = 0;

  function paintProgress() {
    const old = document.getElementById(PROGRESS);
    if (!progress.open) {
      if (old) old.remove();
      return;
    }
    const t = tok();
    let box = old;
    if (!box) {
      box = el('div');
      box.id = PROGRESS;
      // A live region: the sweep's state is announced as it changes, not only on close.
      box.setAttribute('role', 'status');
      box.setAttribute('aria-live', 'polite');
      document.body.appendChild(box);
    }
    box.setAttribute('style', 'position:fixed;z-index:6;top:76px;right:24px;width:300px;' +
      'border-radius:12px;border:1px solid ' + t.line + ';background:' + t.panel +
      ';box-shadow:' + t.panelShadow +
      ';backdrop-filter:blur(28px) saturate(150%);-webkit-backdrop-filter:blur(28px) saturate(150%);padding:' +
      (t.cardPad || '18px 20px') + ';display:flex;flex-direction:column;gap:8px;');
    box.replaceChildren();
    box.append(el('span', 'font-size:12.5px;font-weight:500;color:' + t.ink + ';', progress.title));

    progress.rows.forEach((r) => {
      const line = el('div', 'display:flex;align-items:baseline;gap:8px;font-size:12px;color:' + t.ink60 + ';');
      line.append(el('span', 'color:' + (r.status === 'error' ? t.bad : r.status === 'ok' ? t.ink : t.ink35) + ';',
        GLYPH[r.status]));
      line.append(el('span', 'color:' + t.ink + ';', r.label));
      line.append(el('span', 'margin-left:auto;', r.secs + 's'));
      box.append(line);
      if (r.error) box.append(el('p', 'margin:0 0 0 20px;font-size:11.5px;color:' + t.bad + ';', r.error));
    });

    if (progress.accounts.length) {
      box.append(el('span', 'margin-top:4px;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:' + t.ink45 + ';', 'accounts'));
      progress.accounts.forEach((a) => {
        const line = el('div', 'display:flex;align-items:baseline;gap:8px;font-size:12px;color:' + t.ink60 + ';');
        line.append(el('span', 'color:' + (a.status === 'live' ? t.ink : t.ink35) + ';', a.status === 'live' ? '●' : '○'));
        line.append(el('span', 'color:' + t.ink + ';overflow:hidden;text-overflow:ellipsis;white-space:nowrap;', a.email));
        line.append(el('span', 'margin-left:auto;white-space:nowrap;', a.host));
        box.append(line);
        box.append(el('p', 'margin:0 0 0 20px;font-size:11.5px;color:' + t.ink60 + ';', a.text));
      });
    }
    if (progress.merging) box.append(el('p', 'margin:0;font-size:12px;color:' + t.ink60 + ';', 'merging readings…'));
    if (progress.note)
      box.append(el('p', 'margin:0;font-size:12px;color:' + (progress.failed ? t.bad : t.ink60) + ';', progress.note));

    const close = el('button', 'align-self:flex-start;border-radius:9999px;border:1px solid ' + t.line +
      ';background:transparent;color:' + t.ink75 + ';padding:4px 14px;font-size:12px;cursor:pointer;', 'Close');
    close.onclick = closeProgress;
    box.append(close);
  }

  function closeProgress() {
    clearTimeout(closeTimer);
    clearInterval(poller);
    poller = null;
    progress.open = false;
    paintProgress();
    sync(); // the log below the cards is re-placed once the popup stops covering it
  }

  // A poll that fails leaves the last rows standing: the refresh itself is what reports the
  // failure. A plain GET never starts a sweep, so this stays cheap while one is running.
  const pollProgress = (api, myGen) =>
    api.machines().then(
      (view) => {
        if (!progress.open || gen !== myGen) return;
        progress.rows = progressRows(view);
        progress.accounts = accountLines(view);
        progress.merging = !!(view.sweep && view.sweep.credits_collecting);
        paintProgress();
      },
      () => {}
    );

  function openProgress(api) {
    clearTimeout(closeTimer);
    clearInterval(poller);
    const myGen = ++gen;
    Object.assign(progress, { open: true, title: 'Querying live usage…', rows: [], accounts: [], merging: false, note: '', failed: false });
    paintProgress();
    poller = setInterval(() => pollProgress(api, myGen), 800);
    pollProgress(api, myGen);
    return myGen;
  }

  // One last read before the summary: the sweep settles between two polls, and rows left
  // reading "pending" would be counted as neither ok nor failed.
  async function finishProgress(api, myGen, error) {
    if (gen !== myGen) return; // a newer refresh owns the popup now
    clearInterval(poller);
    poller = null;
    if (!progress.open) return;
    await pollProgress(api, myGen);
    if (!progress.open || gen !== myGen) return;
    progress.merging = false;
    progress.failed = !!error;
    progress.title = error ? 'Refresh failed' : 'Live usage updated';
    progress.note = error || progressSummary(progress.rows, progress.accounts);
    paintProgress();
    // A clean run gets out of the way on its own; a failure stays until it is read.
    if (!error) closeTimer = setTimeout(closeProgress, 2500);
  }

  // ---------------------------------------------------------------------------
  // Load. No polling: a collect fans out over ssh, so it runs only when the page or
  // the operator asks for it (accounts.js:234-250).
  // ---------------------------------------------------------------------------

  async function load(force) {
    // Synchronous, before any await: `load` is exported and the pill's disabled state only
    // lands on the next frame, so a second call can arrive while the first is still out.
    if (state.loading) return;
    const api = data();
    if (!api) return;
    state.loading = true;
    state.error = '';
    push();
    const myGen = force ? openProgress(api) : 0;
    try {
      const payload = await api.credits(force ? { refresh: true } : {});
      state.rows = toRows(payload, undefined, api.toAccounts);
      state.errors = toErrors(payload);
      state.log = usageLogLines(payload, Date.now() / 1000);
      state.loaded = true;
      if (force) await finishProgress(api, myGen, '');
    } catch (e) {
      // accounts.js:243 — the whole list is replaced by the failure, verbatim.
      state.error = 'cannot reach fleetdeck';
      state.rows = [];
      state.errors = [];
      state.log = [];
      if (force) await finishProgress(api, myGen, 'cannot reach fleetdeck' + (e && e.message ? ' — ' + String(e.message).slice(0, 120) : ''));
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

  // The shell's index.html loads public/v2/data.js before the screen files, so
  // FD.data is already there when start() runs. data() can still answer null under
  // a bare harness that loads only this file, hence the guard below.
  function start() {
    const api = data();
    // Fixture mode renders FD.fixture as-is: never call setData there.
    if (!api || api.isFixture()) return;
    watch();
    delegate();
    load(false);
  }

  const screen = Object.assign({ slice: 'l8', start, load, paint, state }, pure);

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else Promise.resolve().then(start);

  return screen;
});
