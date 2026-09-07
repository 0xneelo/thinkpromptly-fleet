// fd-v2 L10 desktop: owned by that slice.
//
// Desktop sessions — live data for the mock's Desktop sessions screen (ledger D17).
// Spec: docs/goals/fd-v2-l10/BEHAVIOUR.md. The mock is the look; today's app is the
// behaviour. Data enters only through FD.setData('dsData', …); the template and the
// shell are never touched from here.
//
// Hooks PROVIDED: FD.screens.desktop.rowAction(kind, row, el) — logic.js calls it for
// the four row buttons when it exists and falls back to the mock's own behaviour when
// it does not. Registered in live mode only (see the fixture guard below).
//
// Hooks USED: FD.screens.bus.open(messageTarget) — L6, ruling O8. Guarded at every
// call site: until L6 lands, Message falls back to the router so the click still
// leaves the user somewhere sensible instead of throwing.
//
// This file also enhances the rendered DOM imperatively. The mock's markup cannot
// express four filter selects bound to live options, a Refresh button, a second
// status chip, a machine-notes panel or a copy-progress label, and the template is
// not ours to edit — so every one of those is a find-or-create DOM patch guarded by
// a data-fd-l10 attribute. Improvisations I-L10-02..07; see the report in the goal.
(function (root) {
  'use strict';

  const FD = (root.FD = root.FD || {});
  FD.screens = FD.screens || {};

  // ---- hooks we USE, always guarded -----------------------------------------
  // L6 owns FD.screens.bus.open. Optional chaining all the way down, and a return
  // value that says whether the bus actually took it.
  function openBus(target) {
    if (!target) return false;
    const open = FD.screens && FD.screens.bus && FD.screens.bus.open;
    if (typeof open !== 'function') return false;
    try {
      open.call(FD.screens.bus, target);
      return true;
    } catch (err) {
      // A hook that throws is the other slice's bug, not a reason to break this row.
      if (root.console) root.console.error('[fd-v2 l10] FD.screens.bus.open threw', err);
      return false;
    }
  }

  // ---- hooks we PROVIDE ------------------------------------------------------
  FD.screens.desktop = FD.screens.desktop || {};
  FD.screens.desktop.slice = 'l10';
  FD.screens.desktop.openBus = openBus; // internal; not a cross-slice promise

  // ---- fixture guard: FIRST and ABSOLUTE -------------------------------------
  // In ?fixture=1 the compiled logic renders FD.fixture as seeded and a pixel gate
  // screenshots it. One setData, one injected node or one registered rowAction here
  // would change 36 screenshots, so this file does nothing at all: no fetch, no
  // listener, no poll, and no rowAction for logic.js to prefer over the mock's own
  // handlers. A missing FD.data means the data layer is not on the page yet, which
  // is the same "nothing live to do" case, so it takes the same exit.
  if (!FD.data || (typeof FD.data.isFixture === 'function' && FD.data.isFixture())) return;

  const NOOP_MACHINE_NOTE = 'Cached metadata. Refresh to collect the latest sessions.';
  const MACHINE_NOTES = {
    no_report: 'Waiting for a first collection.',
    not_found: 'No Desktop session directory found.',
    unavailable: 'Collection failed. Previously collected sessions are still shown.',
    partial: 'Some session files could not be read. Previously collected sessions are still shown.',
  };
  const UNAVAILABLE_OPTION = 'Previously selected (unavailable)';
  const COPY_REVERT_MS = 1500;
  const POLL_MS = 30000;
  const DOT = ' · '; // U+00B7, the separator today's sessionContext() uses

  // ---- state: this file owns every live-mode filter and the last response ------
  const filters = { account: '', machine: '', live: '', archived: '' };
  let groups = [];        // every collected group/row, before OUR filters
  let response = null;    // last successful /api/desktop-sessions body
  let loadFailed = false; // the most recent load rejected
  let everLoaded = false; // at least one load has succeeded
  let inFlight = false;
  let collecting = false; // a forced (refresh=1) load is in flight
  let pollHandle = null;
  let observer = null;
  let applyQueued = false;

  // ---------------------------------------------------------------------------
  // Formatting
  // ---------------------------------------------------------------------------

  // Today's age() from sessions.js. NOT FD.data.ago — that one says 'just now' and
  // '—', this screen says 'Just now' and 'Unknown', and the strings are the spec.
  function age(stamp) {
    if (!stamp) return 'Unknown';
    const date = typeof stamp === 'number' ? stamp : Date.parse(stamp);
    if (!Number.isFinite(date)) return 'Unknown';
    const minutes = Math.floor(Math.max(0, Date.now() - date) / 60000);
    if (minutes < 1) return 'Just now';
    if (minutes < 60) return minutes + 'm ago';
    if (minutes < 1440) return Math.floor(minutes / 60) + 'h ago';
    return Math.floor(minutes / 1440) + 'd ago';
  }

  const accountKey = (g) => g.accountUuid + ':' + g.orgUuid;
  const machineLabel = (id) => {
    const found = ((response && response.machines) || []).filter((m) => m.id === id)[0];
    return (found && found.label) || id || '';
  };

  // ---------------------------------------------------------------------------
  // Load and shape
  // ---------------------------------------------------------------------------

  function load(force) {
    if (inFlight) return;
    inFlight = true;
    if (force) {
      collecting = true;
      scheduleApply(); // the Refresh button says 'Collecting…' while the call is out
    }
    FD.data.desktopSessions(force ? { refresh: true } : {})
      .then((res) => {
        response = res;
        groups = build(res);
        everLoaded = true;
        loadFailed = false;
      })
      .catch((err) => {
        // Keep the previous groups: the note says "The last view is still shown."
        loadFailed = true;
        if (root.console) root.console.error('[fd-v2 l10] desktop sessions load failed', err);
      })
      .then(() => {
        inFlight = false;
        collecting = false;
        push();
      });
  }

  // FD.data.toDesktop is L1's adapter and it is right about the mock's keys, but it
  // has three gaps this screen has to close:
  //   a) it DROPS every archived session, and we need archived rows for the Archived
  //      filter and the Archived chip — so archived rows are built here by hand;
  //   b) it prepends an empty {name:'Live now'} head group, and logic.js builds its
  //      own "Live now" group from the rows' live flags — passing L1's through would
  //      render two of them, so it is sliced off;
  //   c) it renders a null completedTurns as '0 turns' where BEHAVIOUR.md §3 says
  //      'Turns unknown' — overridden below, together with the title/path/branch/model
  //      fallbacks §3 requires (logic.js also calls r.path.lastIndexOf unguarded).
  function build(res) {
    const adapted = FD.data.toDesktop(res).slice(1);
    return (res.groups || []).map((g, gi) => {
      const seeds = (adapted[gi] && adapted[gi].rows) || [];
      let si = 0;
      const rows = (g.sessions || []).map((s) => {
        const seed = s.isArchived ? null : seeds[si++]; // (a): adapted rows skip archived
        return row(g, s, seed);
      });
      rows.sort(
        (a, b) =>
          (b.lastActivityAt || '').localeCompare(a.lastActivityAt || '') ||
          String(a.id).localeCompare(String(b.id))
      );
      return {
        name: g.label,
        email: g.email,
        acct: 'Account ' + String(g.accountUuid || '').slice(0, 8),
        machine: g.machine,
        label: g.label,
        accountUuid: g.accountUuid,
        orgUuid: g.orgUuid,
        rows,
      };
    }).sort(
      (a, b) =>
        String(a.label).localeCompare(String(b.label)) ||
        String(a.accountUuid).localeCompare(String(b.accountUuid)) ||
        String(a.machine).localeCompare(String(b.machine)) ||
        String(a.orgUuid).localeCompare(String(b.orgUuid))
    );
  }

  function row(g, s, seed) {
    const out = seed
      ? Object.assign({}, seed)
      : { created: s.createdAt, cli: s.cliSessionId, sid: s.id, live: !!s.live };
    // Mock keys, with BEHAVIOUR.md §3's fallbacks baked in — the template prints
    // r.branch and r.model straight, so an empty value has to be the label already.
    //
    // TODO(L1.2, DESIGN-35 2026-09-07): Juergen is moving 'Turns unknown' / 'No
    // branch' / 'Model unknown' into FD.data.toDesktop. These three lines are then
    // redundant for NON-archived rows — but not removable: they are computed from
    // the raw session, and archived rows never reach toDesktop (it drops them), so
    // this is the only place they get their fallbacks. Recomputing the same string
    // from the same source is idempotent, so landing L1.2 changes nothing here;
    // re-check this comment when it merges.
    out.title = s.title || 'Untitled session';
    out.path = s.cwd || '';
    out.branch = s.branch || 'No branch';
    out.model = s.model || 'Model unknown';
    out.when = age(s.lastActivityAt);
    out.turns = s.completedTurns === null || s.completedTurns === undefined
      ? 'Turns unknown'
      : s.completedTurns + ' turns';
    // Enrichment. logic.js ignores keys it does not know, so extras are free.
    out.liveState = s.liveState;
    out.isArchived = !!s.isArchived;
    out.stale = !!s.stale;
    out.worktree = s.worktree;
    out.machine = g.machine;
    out.accountUuid = s.accountUuid || g.accountUuid;
    out.orgUuid = s.orgUuid || g.orgUuid;
    out.id = s.id;
    out.messageTarget = s.messageTarget;
    out.groupLabel = g.label;
    out.email = g.email;
    out.acct = 'Account ' + String(g.accountUuid || '').slice(0, 8);
    out.lastActivityAt = s.lastActivityAt;
    out.completedTurns = s.completedTurns;
    // Raw copies of the values the fallbacks above overwrite: the clipboard context
    // must omit an unknown branch, not claim 'No branch'.
    out.cwd = s.cwd;
    out.rawBranch = s.branch;
    out.rawModel = s.model;
    return out;
  }

  function keep(g, r) {
    if (filters.account && accountKey(g) !== filters.account) return false;
    if (filters.machine && g.machine !== filters.machine) return false;
    if (filters.live && r.liveState !== filters.live) return false;
    if (filters.archived && r.isArchived !== (filters.archived === 'archived')) return false;
    return true;
  }

  // Our four filters are applied here; the search box stays logic.js's (A_setDq).
  // An emptied group is dropped, exactly as logic.js drops it.
  function filtered() {
    const out = [];
    groups.forEach((g) => {
      const rows = g.rows.filter((r) => keep(g, r));
      if (rows.length) out.push(Object.assign({}, g, { rows }));
    });
    return out;
  }

  function push() {
    FD.setData('dsData', filtered());
    scheduleApply();
  }

  // ---------------------------------------------------------------------------
  // Row actions. logic.js calls this for Show / Message / Copy context / Copy
  // conversation and passes the enriched row plus the button that was clicked.
  // ---------------------------------------------------------------------------

  FD.screens.desktop.rowAction = function (kind, r, el) {
    try {
      if (kind === 'show') actShow(el);
      else if (kind === 'message') actMessage(r);
      else if (kind === 'copy') actCopy(r, el);
      else if (kind === 'copyConv') actCopyConv(r, el);
    } catch (err) {
      // Never throw into the runtime's event dispatch.
      if (root.console) root.console.error('[fd-v2 l10] rowAction ' + kind + ' failed', err);
    }
  };

  // I-L10-03. The mock has no session tile to open, so Show expands the row's own
  // details panel and scrolls it into view. Expand, never toggle — read the panel
  // out of the DOM rather than mirroring logic.js's dsExp state.
  function actShow(el) {
    const rowEl = el && el.closest ? el.closest('[data-fd-l10-row]') : null;
    if (!rowEl) return;
    if (!detailsOpen(rowEl)) rowEl.click(); // the row div's own onClick is the toggle
    const scroll = () => {
      try {
        rowEl.scrollIntoView({ block: 'nearest' });
      } catch (err) {
        rowEl.scrollIntoView();
      }
    };
    if (typeof root.requestAnimationFrame === 'function') root.requestAnimationFrame(scroll);
    else scroll();
  }

  // Collapsed the row holds two divs (conversation, activity); the details panel is
  // a third. Counting them beats matching a style string the runtime re-serialises.
  function detailsOpen(rowEl) {
    return kids(rowEl).filter((n) => n.tagName === 'DIV').length > 2;
  }

  // Ruling O8: the bus thread replaces the page-level composer.
  function actMessage(r) {
    if (!r || !r.live || !r.messageTarget) return;
    if (openBus(r.messageTarget)) return;
    const navigate = FD.router && FD.router.navigate;
    if (typeof navigate !== 'function') return;
    try {
      navigate.call(FD.router, 'bus');
    } catch (err) {
      if (root.console) root.console.error('[fd-v2 l10] router.navigate threw', err);
    }
  }

  function actCopy(r, el) {
    if (!r) return;
    labelPill(el, 'Copying…');
    clipboard(sessionContext(r)).then((done) => {
      labelPill(el, done ? 'Copied' : 'Copy failed', true);
    });
  }

  function actCopyConv(r, el) {
    if (!r) return;
    labelPill(el, 'Copying…');
    FD.data
      .transcript({ machine: r.machine, account: r.accountUuid, org: r.orgUuid, id: r.id })
      .then(
        (text) => clipboard(sessionContext(r) + '\n' + text).then((done) => (done ? 'Copied' : 'Copy failed')),
        (err) => (err && err.status === 404 ? 'No transcript' : 'Copy failed')
      )
      .then((text) => labelPill(el, text, true));
  }

  // Today's sessionContext(): 'Label: value' lines, empties skipped, trailing \n.
  function sessionContext(r) {
    const pairs = [
      ['Title', r.title],
      ['Account', [r.groupLabel, r.email, r.accountUuid].filter(Boolean).join(DOT)],
      ['Machine', machineLabel(r.machine)],
      ['Directory', r.cwd],
      ['Worktree', r.worktree],
      ['Branch', r.rawBranch],
      ['Model', r.rawModel],
      ['Created', r.created],
      ['Last activity', r.lastActivityAt],
      ['Turns', r.completedTurns],
      ['Status', String(r.liveState || '') + (r.isArchived ? ', archived' : '')],
      ['CLI session', r.cli],
      ['Session', r.id],
    ];
    return pairs
      .filter(([, v]) => v !== null && v !== undefined && v !== '')
      .map(([k, v]) => k + ': ' + v)
      .join('\n') + '\n';
  }

  function clipboard(text) {
    const nav = root.navigator;
    const write = nav && nav.clipboard && nav.clipboard.writeText;
    if (typeof write !== 'function') return Promise.resolve(false);
    return Promise.resolve()
      .then(() => write.call(nav.clipboard, text))
      .then(() => true, () => false);
  }

  // ---------------------------------------------------------------------------
  // DOM enhancement. Idempotent: every injected node is found before it is made,
  // and every write is skipped when the value already matches, so re-applying on
  // each render neither duplicates nodes nor loops the MutationObserver.
  // ---------------------------------------------------------------------------

  const kids = (el) => (el ? Array.prototype.slice.call(el.children) : []);
  const screenRoot = () => document.querySelector('[data-screen-label="Desktop sessions"]');
  // Template-rendered children only: our own injections carry no data-dc-tpl.
  const rendered = (el) => kids(el).filter((n) => n.hasAttribute('data-dc-tpl'));

  function apply() {
    const el = screenRoot();
    polling(!!el); // the screen root exists only while this screen is the active one
    if (!el) return;
    const parts = rendered(el);
    const bar = parts[0];
    if (!bar) return;
    const cards = parts.slice(1);
    const view = visibleRows();
    syncSelects(bar);
    syncRefresh(bar);
    syncCount(bar, view);
    syncNotes(el, bar, cards, view);
    syncRows(cards, view.groups);
  }

  // What logic.js will actually render: our filters, then its search box, then its
  // live-first sort and its pinned "Live now" group. Recomputed here so the counts
  // and the injected chips line up with the rows on screen by index.
  function visibleRows() {
    const bar = screenRoot() && rendered(screenRoot())[0];
    const input = bar && bar.querySelector('input');
    // The same predicate logic.js applies (title/path/worktree/branch/model,
    // toLocaleLowerCase on both sides), so the counts and the injected chips line
    // up with the rows the runtime actually drew.
    const dq = ((input && input.value) || '').toLocaleLowerCase();
    const hit = (r) =>
      [r.title, r.path, r.worktree, r.branch, r.model]
        .filter((v) => typeof v === 'string')
        .join(' ')
        .toLocaleLowerCase()
        .indexOf(dq) >= 0;
    const live = [];
    const out = [];
    let count = 0;
    let total = 0;
    groups.forEach((g) => {
      total += g.rows.length;
    });
    filtered().forEach((g) => {
      const kept = g.rows.filter((r) => !dq || hit(r));
      kept.forEach((r) => {
        count++;
        if (r.live) live.push(r);
      });
      const rows = kept.slice().sort((a, b) => (b.live ? 1 : 0) - (a.live ? 1 : 0));
      if (rows.length) out.push(rows);
    });
    if (live.length) out.unshift(live);
    return { groups: out, count, total, live: live.length };
  }

  // -- 5.1 filter selects ------------------------------------------------------

  const SELECTS = ['account', 'machine', 'live', 'archived'];

  function syncSelects(bar) {
    const els = bar.querySelectorAll('select');
    SELECTS.forEach((kind, i) => {
      const sel = els[i];
      if (!sel) return;
      if (sel.getAttribute('data-fd-l10') !== 'filter-' + kind) {
        sel.setAttribute('data-fd-l10', 'filter-' + kind);
        sel.addEventListener('change', () => {
          filters[kind] = sel.value;
          push();
        });
      }
      setOptions(sel, optionsFor(kind), filters[kind]);
    });
  }

  function optionsFor(kind) {
    if (kind === 'account') {
      const seen = {};
      const opts = [];
      groups.forEach((g) => {
        const key = accountKey(g);
        if (seen[key]) return;
        seen[key] = true;
        opts.push([key, g.label + DOT + String(g.accountUuid || '').slice(0, 8)]);
      });
      opts.sort((a, b) => a[1].localeCompare(b[1]));
      return [['', 'All accounts']].concat(opts);
    }
    if (kind === 'machine') {
      // Machine order is the API's, not alphabetical — that is today's behaviour.
      const opts = ((response && response.machines) || []).map((m) => [m.id, m.label]);
      return [['', 'All machines']].concat(opts);
    }
    if (kind === 'live') {
      return [['', 'Any live status'], ['live', 'Live'], ['offline', 'Offline'], ['unknown', 'Unknown']];
    }
    // 'active' means NOT archived: the predicate compares isArchived to === 'archived'.
    return [['', 'All sessions'], ['active', 'Not archived'], ['archived', 'Archived']];
  }

  // The mock's hard-coded <option>s are replaced wholesale. Safe: a <select> here has
  // a fixed child list, so the runtime's syncChildren sees no change and never puts
  // them back. A selection that vanished from the data keeps a synthetic option, or
  // the user would see the filter silently reset to "All".
  function setOptions(sel, opts, value) {
    let list = opts;
    if (value && !list.some((o) => o[0] === value)) list = list.concat([[value, UNAVAILABLE_OPTION]]);
    const stamp = list.map((o) => o[0] + ' ' + o[1]).join('\n');
    if (sel.getAttribute('data-fd-l10-opts') !== stamp) {
      sel.textContent = '';
      list.forEach((o) => {
        const option = document.createElement('option');
        option.value = o[0];
        option.textContent = o[1];
        sel.appendChild(option);
      });
      sel.setAttribute('data-fd-l10-opts', stamp);
    }
    if (sel.value !== value) sel.value = value;
  }

  // -- 5.2 Refresh button (I-L10-07) + 5.7 Reset --------------------------------

  function syncRefresh(bar) {
    const reset = bar.querySelector('button:not([data-fd-l10])');
    if (reset && !reset.hasAttribute('data-fd-l10-reset')) {
      reset.setAttribute('data-fd-l10-reset', '');
      // logic.js clears dq and dsExp; our own filter state is ours to clear.
      reset.addEventListener('click', () => {
        SELECTS.forEach((k) => { filters[k] = ''; });
        push();
      });
    }
    let btn = bar.querySelector('[data-fd-l10="refresh"]');
    if (!btn) {
      if (!reset) return;
      btn = document.createElement('button');
      btn.type = 'button';
      btn.setAttribute('data-fd-l10', 'refresh');
      btn.style.cssText = reset.style.cssText; // visually identical to Reset
      btn.addEventListener('click', () => load(true));
      reset.parentNode.insertBefore(btn, reset);
    }
    const text = collecting ? 'Collecting…' : 'Refresh';
    if (btn.textContent !== text) btn.textContent = text;
    if (btn.disabled !== collecting) btn.disabled = collecting;
  }

  // -- 5.3 count + last collection (I-L10-05) ------------------------------------

  function syncCount(bar, view) {
    const span = bar.querySelector('span:not([data-fd-l10])');
    if (!span) return;
    const text = loadFailed && !everLoaded
      ? 'Sessions unavailable'
      : view.count + ' of ' + view.total + ' sessions' + DOT + view.live + ' live';
    if (span.textContent !== text) span.textContent = text;
    let when = bar.querySelector('[data-fd-l10="collected"]');
    if (!when) {
      when = document.createElement('span');
      when.setAttribute('data-fd-l10', 'collected');
      when.style.cssText = span.style.cssText; // the same muted token as the count
      span.parentNode.insertBefore(when, span.nextSibling);
    }
    const collected = response && response.collected_at;
    const label = collected ? 'Last collection: ' + age(collected) : 'No completed collection';
    if (when.textContent !== label) when.textContent = label;
  }

  // -- 5.6 machine notes, load errors and empty states (I-L10-06) ----------------

  function noteLines(view) {
    const lines = [];
    if (loadFailed) {
      lines.push(
        'Sessions could not be refreshed.' +
          (everLoaded ? ' The last view is still shown.' : ' Try Refresh to reconnect.')
      );
    }
    ((response && response.machines) || []).forEach((m) => {
      if (m.state === 'ok' && !m.stale) return;
      lines.push(m.label + ': ' + (MACHINE_NOTES[m.state] || NOOP_MACHINE_NOTE));
    });
    if (!view.groups.length) {
      if (loadFailed && !everLoaded) lines.push('Could not load desktop sessions.');
      else if (view.total) lines.push('No sessions match these filters. Reset filters to see all conversations.');
      else lines.push('No Desktop sessions collected yet. Open a Code tab on a configured machine, then refresh.');
    }
    return lines;
  }

  function syncNotes(el, bar, cards, view) {
    const lines = noteLines(view);
    let panel = el.querySelector('[data-fd-l10="notes"]');
    if (!lines.length) {
      if (panel) panel.parentNode.removeChild(panel);
      return;
    }
    if (!panel) {
      panel = document.createElement('div');
      panel.setAttribute('data-fd-l10', 'notes');
      // Panel tokens are read off a live group card so light and dark both follow the
      // theme. With no card on screen (the empty states) fall back to the Reset
      // button's border, which is the same A_line token.
      const card = cards[0];
      const reset = bar.querySelector('[data-fd-l10-reset]');
      panel.style.cssText = card
        ? card.style.cssText
        : 'border-radius:12px;border:1px solid ' + ((reset && reset.style.borderColor) || 'currentColor') + ';';
      panel.style.padding = '12px 16px';
      panel.style.display = 'flex';
      panel.style.flexDirection = 'column';
      panel.style.gap = '6px';
      panel.style.overflow = 'visible';
    }
    // The card list is an sc-for, so a group count change makes the runtime sweep
    // this foreign node away; re-inserting it here is the re-apply doing its job.
    if (panel.parentNode !== el || panel.previousElementSibling !== bar) {
      el.insertBefore(panel, bar.nextSibling);
    }
    const muted = (bar.querySelector('span:not([data-fd-l10])') || {}).style;
    while (panel.children.length > lines.length) panel.removeChild(panel.lastChild);
    lines.forEach((line, i) => {
      let p = panel.children[i];
      if (!p) {
        p = document.createElement('p');
        p.style.margin = '0';
        p.style.fontSize = '12px';
        p.style.lineHeight = '1.55';
        if (muted && muted.color) p.style.color = muted.color;
        panel.appendChild(p);
      }
      if (p.textContent !== line) p.textContent = line;
    });
  }

  // -- 5.5 status chips (I-L10-02) + row tagging ---------------------------------

  function syncRows(cards, shape) {
    cards.forEach((card, gi) => {
      const rows = rowEls(card);
      const data = shape[gi] || [];
      rows.forEach((el, ri) => {
        el.setAttribute('data-fd-l10-row', '');
        chips(el, data[ri]);
      });
    });
  }

  // card > [group header, scroller > table > [column header, ...rows]]
  function rowEls(card) {
    const scroller = kids(card)[1];
    const table = kids(scroller)[0];
    return kids(table).slice(1);
  }

  function chips(el, r) {
    const cells = kids(el).filter((n) => n.tagName === 'SPAN');
    const status = cells[0];
    if (!status) return;
    // The mock's status cell holds one pill. Extra pills are cloned from the row's
    // model chip, which is the mock's own neutral chip token — no colour guessing.
    const conv = kids(el).filter((n) => n.tagName === 'DIV')[0];
    const meta = kids(conv)[1];
    const model = kids(meta)[1];
    status.style.gap = '5px';
    status.style.flexWrap = 'wrap';
    chip(status, 'archived', r && r.isArchived ? 'Archived' : '', model);
    chip(status, 'cached', r && r.stale ? 'Cached' : '', model);
  }

  function chip(cell, key, text, styleSrc) {
    let pill = cell.querySelector('[data-fd-l10="' + key + '"]');
    if (!text) {
      if (pill) cell.removeChild(pill);
      return;
    }
    if (!pill) {
      pill = document.createElement('span');
      pill.setAttribute('data-fd-l10', key);
      if (styleSrc) pill.style.cssText = styleSrc.style.cssText;
      cell.appendChild(pill);
    }
    if (pill.textContent !== text) pill.textContent = text;
  }

  // -- 5.4 copy label feedback (I-L10-04) ----------------------------------------

  // The mock's copy buttons are icon-only, so the label cycle lives in a chip beside
  // the button and is mirrored into the title for anyone reading the tooltip.
  function labelPill(btn, text, revert) {
    if (!btn || !btn.parentNode) return;
    const cell = btn.parentNode;
    if (btn.__fdL10Timer) {
      clearTimeout(btn.__fdL10Timer);
      btn.__fdL10Timer = null;
    }
    if (btn.__fdL10Title === undefined) btn.__fdL10Title = btn.getAttribute('title') || '';
    let pill = cell.querySelector('[data-fd-l10="copylabel"]');
    if (!text) {
      if (pill) cell.removeChild(pill);
      btn.setAttribute('title', btn.__fdL10Title);
      return;
    }
    if (!pill) {
      const row = btn.closest ? btn.closest('[data-fd-l10-row]') : null;
      const conv = row ? kids(row).filter((n) => n.tagName === 'DIV')[0] : null;
      const model = conv ? kids(kids(conv)[1])[1] : null;
      pill = document.createElement('span');
      pill.setAttribute('data-fd-l10', 'copylabel');
      if (model) pill.style.cssText = model.style.cssText;
      pill.style.whiteSpace = 'nowrap';
      pill.style.flexShrink = '0';
      cell.insertBefore(pill, btn.nextSibling);
    }
    if (pill.textContent !== text) pill.textContent = text;
    btn.setAttribute('title', text);
    if (revert) btn.__fdL10Timer = setTimeout(() => labelPill(btn, ''), COPY_REVERT_MS);
  }

  // ---------------------------------------------------------------------------
  // Scheduling: re-apply after every render, poll while the screen is on screen.
  // ---------------------------------------------------------------------------

  function scheduleApply() {
    if (applyQueued) return;
    applyQueued = true;
    // A microtask, so it lands after the runtime's own flush (queued first by setData).
    Promise.resolve().then(() => {
      applyQueued = false;
      safeApply();
    });
  }

  function safeApply() {
    if (observer) observer.disconnect(); // our own writes must not re-trigger us
    try {
      apply();
    } catch (err) {
      if (root.console) root.console.error('[fd-v2 l10] DOM enhancement failed', err);
    }
    if (observer) observe();
  }

  function polling(present) {
    if (present && !pollHandle) {
      load(false); // first load happens when the screen first appears, not at file load
      if (typeof FD.data.poll === 'function') {
        pollHandle = FD.data.poll(() => load(false), POLL_MS, { whileVisible: true });
      }
    } else if (!present && pollHandle) {
      pollHandle.stop();
      pollHandle = null;
    }
  }

  function observe() {
    const host = document.getElementById('dc-root') || document.body;
    if (host && observer) observer.observe(host, { childList: true, subtree: true });
  }

  if (typeof MutationObserver === 'function' && typeof document !== 'undefined') {
    observer = new MutationObserver(scheduleApply);
    observe();
  }
  scheduleApply();
})(typeof globalThis === 'object' ? globalThis : this);
