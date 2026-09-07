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
//
// S2 runtime shim oracle audit — docs/design/fleetdeck-v2/audits/s2-shim-oracle-2026-09-08.md
// (F1 positional row identity, F2 a throw in renderVals blanks every screen, F4 a select
// shows a value the page is not rendering, F5 no update-depth guard). This file honours
// all three of the audit's binding instructions but one, and that one it breaks openly:
// it DOES mount foreign DOM inside compiled nodes — the Refresh button and the count line
// in the filter row, the notes panel under it, the status chips and the copy label inside
// each row. Those sit inline in the mock's own layout, and an overlay outside #dc-root
// cannot express a chip that wraps inside a table cell or a button in a flex bar.
// The mitigation is that no state is kept in those nodes: every injected node is
// re-derived from data on each apply(), and the copy label lives in module state keyed by
// session id. So an F3 sweep that deletes an injection, or an F1 positional reuse that
// hands one session's row element to another session, self-heals on the next render
// instead of persisting.
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

  // ---- fixture guard: FIRST and ABSOLUTE -------------------------------------
  // In ?fixture=1 the compiled logic renders FD.fixture as seeded and a pixel gate
  // screenshots it. One setData, one injected node or one registered rowAction here
  // would change 36 screenshots, so this file does nothing at all: no fetch, no
  // listener, no poll, and no rowAction for logic.js to prefer over the mock's own
  // handlers. A missing FD.data means the data layer is not on the page yet, which
  // is the same "nothing live to do" case, so it takes the same exit.
  if (!FD.data || (typeof FD.data.isFixture === 'function' && FD.data.isFixture())) return;

  // ---- hooks we PROVIDE ------------------------------------------------------
  // Below the guard on purpose: in ?fixture=1 FD.screens.desktop stays undefined, so a
  // later slice can read it as "L10 is live" and the claim above stays literally true.
  FD.screens.desktop = FD.screens.desktop || {};
  FD.screens.desktop.slice = 'l10';
  FD.screens.desktop.openBus = openBus; // internal; not a cross-slice promise

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
    // L1.2 has landed: FD.data.toDesktop now emits 'No branch' / 'Model unknown' /
    // 'Turns unknown' itself, so for NON-archived rows these three recompute the same
    // strings from the same source and are simply redundant. They stay because they
    // are not redundant for archived rows: toDesktop drops those, so this is the only
    // place they get any fallback at all. `title` is load-bearing for every row —
    // the adapter passes s.title through raw, with no 'Untitled session' fallback.
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

  // Audit F2 / binding instruction 2. A throw inside renderVals makes the runtime render
  // with vals = host.props: every sc-if false, every list empty, all nine screens blank
  // until the next poll. logic.js guards its own field access now; this is the other half
  // of the contract — this slice never hands it a shape that can throw. Malformed groups
  // and rows are dropped, never thrown on.
  function stringish(v) {
    if (typeof v === 'string') return v;
    if (v === null || v === undefined) return '';
    if (typeof v === 'number') return Number.isFinite(v) ? String(v) : null;
    if (typeof v === 'boolean') return String(v);
    return null; // an object, array or function is not a label: drop the group
  }

  // `quiet` is for the recount in visibleRows(), which must see exactly the groups and
  // rows the runtime draws but must not re-log what push() already reported.
  function wellFormed(list, quiet) {
    let dropped = 0;
    const out = [];
    (Array.isArray(list) ? list : []).forEach((g) => {
      const name = g && typeof g === 'object' && !Array.isArray(g) ? stringish(g.name) : null;
      if (name === null || !Array.isArray(g.rows)) {
        dropped++;
        return;
      }
      const rows = g.rows.filter((r) => {
        const ok = !!r && typeof r === 'object' && !Array.isArray(r);
        if (!ok) dropped++;
        return ok;
      });
      out.push(Object.assign({}, g, { name, rows }));
    });
    if (dropped && !quiet && root.console) {
      root.console.error('[fd-v2 l10] dropped ' + dropped + ' malformed group(s)/row(s) before setData');
    }
    return out;
  }

  function push() {
    FD.setData('dsData', wellFormed(filtered()));
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
      else if (kind === 'copy') actCopy(r);
      else if (kind === 'copyConv') actCopyConv(r);
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

  function actCopy(r) {
    if (!r) return;
    setCopyLabel(r, 'copy', 'Copying…', false);
    clipboard(sessionContext(r)).then((done) => {
      setCopyLabel(r, 'copy', done ? 'Copied' : 'Copy failed', true);
    });
  }

  function actCopyConv(r) {
    if (!r) return;
    setCopyLabel(r, 'copyConv', 'Copying…', false);
    FD.data
      .transcript({ machine: r.machine, account: r.accountUuid, org: r.orgUuid, id: r.id })
      .then(
        (text) => clipboard(sessionContext(r) + '\n' + text).then((done) => (done ? 'Copied' : 'Copy failed')),
        (err) => (err && err.status === 404 ? 'No transcript' : 'Copy failed')
      )
      .then((text) => setCopyLabel(r, 'copyConv', text, true));
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
  const styleOf = (el) => (el && el.style ? el.style.cssText : null);

  // Theme tokens live in the template's inline styles, and a light/dark toggle rewrites
  // every one of them. An injected node that copied its source's style once at creation
  // would stay on the old theme and go near-invisible, so the source style is re-read on
  // EVERY apply() and re-applied when it changed — the same re-derive rule the chips and
  // the copy label follow. The two markers are a dirty check only, never the value: one
  // holds the source css last seen, the other what this node ended up with, so both a
  // theme flip and an outside write to our node are corrected on the next render.
  function restyle(node, css, extra) {
    if (css === null || css === undefined) return;
    if (node.__fdL10Src === css && node.style.cssText === node.__fdL10Out) return;
    node.style.cssText = css;
    if (extra) extra(node);
    node.__fdL10Src = css;
    node.__fdL10Out = node.style.cssText;
  }
  const screenRoot = () => document.querySelector('[data-screen-label="Desktop sessions"]');
  // Template-rendered children only: our own injections carry no data-dc-tpl.
  const rendered = (el) => kids(el).filter((n) => n.hasAttribute('data-dc-tpl'));

  function apply() {
    expireCopyLabels(); // a lost timer must never leave a label on screen for good
    const el = screenRoot();
    polling(!!el); // the screen root exists only while this screen is the active one
    if (!el) return;
    const parts = rendered(el);
    const bar = parts[0];
    if (!bar) return;
    // S2.2 closes audit F3 with data-dc-raw: an element carrying it owns its own
    // children, and the reconciler neither inserts nor removes inside it. The filter
    // row is the one place this slice can take that offer — its template children are
    // static (an input, four selects, a span, Reset), so opting out of reconciliation
    // there costs nothing and stops our Refresh button and collected line from
    // depending on the reconciler merely happening not to touch them.
    // The screen root deliberately does NOT get it: its children are the group cards,
    // which must keep reconciling, so the notes panel still relies on being re-derived
    // every apply(). That is the part of DECK-78 that stands.
    if (!bar.hasAttribute('data-dc-raw')) bar.setAttribute('data-dc-raw', '');
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
    // trimmed and toLocaleLowerCase on both sides), so the counts and the injected
    // chips line up with the rows the runtime actually drew. Keep this in step with
    // logic.js's dsGroups filter — a drift here misaligns the chips by one row.
    const dq = ((input && input.value) || '').trim().toLocaleLowerCase();
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
    wellFormed(filtered(), true).forEach((g) => {
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
  //
  // Audit F4: the shim writes a <select>'s value only when the bound prop changed, so a
  // select fed from live data can display a value the page is not rendering. This slice
  // owns these four selects' options outright, so it keeps DOM and state in step itself.
  // Every write is compare-then-set, and the option comparison reads the live options
  // rather than a stamp written earlier — a stamp cannot notice the runtime putting the
  // template's own options back.
  function setOptions(sel, opts, value) {
    let list = opts;
    if (value && !list.some((o) => o[0] === value)) list = list.concat([[value, UNAVAILABLE_OPTION]]);
    const cur = kids(sel).filter((n) => n.tagName === 'OPTION');
    let same = cur.length === list.length;
    for (let i = 0; same && i < list.length; i++) {
      same = cur[i].value === list[i][0] && cur[i].textContent === list[i][1];
    }
    if (!same) {
      sel.textContent = '';
      list.forEach((o) => {
        const option = document.createElement('option');
        option.value = o[0];
        option.textContent = o[1];
        sel.appendChild(option);
      });
    }
    // After the options are settled, never before: rebuilding them resets the selection.
    if (sel.value !== value) sel.value = value;
  }

  // -- 5.2 Refresh button (I-L10-07) + 5.7 Reset --------------------------------

  function syncRefresh(bar) {
    const reset = bar.querySelector('button:not([data-fd-l10])');
    if (reset && !reset.hasAttribute('data-fd-l10-reset')) {
      reset.setAttribute('data-fd-l10-reset', '');
      // logic.js clears dq and dsExp; our own filter state is ours to clear.
      //
      // The push() is deferred by a macrotask ON PURPOSE, and Reset is the one
      // button where it matters. This listener shares the node with the runtime's
      // own onClick. Pushing here would queue a render, the HTML spec runs a
      // microtask checkpoint after *each* listener callback, that render re-binds
      // the button's onClick (removeEventListener + addEventListener on every
      // pass), and the DOM spec skips a listener removed mid-dispatch — so
      // logic.js's resetDs never runs and the search box never clears. Verified:
      // a trusted click reproduced it every time, a synthetic el.click() (no
      // checkpoint, the stack is not empty) hid it.
      reset.addEventListener('click', () => {
        SELECTS.forEach((k) => { filters[k] = ''; });
        setTimeout(push, 0);
      });
    }
    let btn = bar.querySelector('[data-fd-l10="refresh"]');
    if (!btn) {
      if (!reset) return;
      btn = document.createElement('button');
      btn.type = 'button';
      btn.setAttribute('data-fd-l10', 'refresh');
      btn.addEventListener('click', () => load(true));
      reset.parentNode.insertBefore(btn, reset);
    }
    restyle(btn, styleOf(reset)); // visually identical to Reset, in the theme on now
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
      span.parentNode.insertBefore(when, span.nextSibling);
    }
    restyle(when, styleOf(span)); // the same muted token as the count
    // Ground truth sessions.js:292: the newest per-machine collected_at, NOT the
    // response's own collected_at — that one is stamped when the sweep STARTS, so it
    // would claim 'Last collection: Just now' while a sweep is still out, or when every
    // machine failed. A machine that never reported carries null, hence the || 0.
    const collected = ((response && response.machines) || [])
      .reduce((max, m) => Math.max(max, (m && m.collected_at) || 0), 0);
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
    }
    // Panel tokens are read off a live group card on every apply, so a theme toggle
    // carries the panel with it. With no card on screen (the empty states) fall back to
    // the Reset button's border, which is the same A_line token.
    const card = cards[0];
    const resetBtn = bar.querySelector('[data-fd-l10-reset]');
    const panelCss = card
      ? styleOf(card)
      : 'border-radius:12px;border:1px solid ' + ((resetBtn && resetBtn.style.borderColor) || 'currentColor') + ';';
    restyle(panel, panelCss, notesLayout);
    // The card list is an sc-for, so a group count change makes the runtime sweep
    // this foreign node away; re-inserting it here is the re-apply doing its job.
    if (panel.parentNode !== el || panel.previousElementSibling !== bar) {
      el.insertBefore(panel, bar.nextSibling);
    }
    const muted = (bar.querySelector('span:not([data-fd-l10])') || {}).style;
    const lineCss = 'margin:0;font-size:12px;line-height:1.55;' +
      (muted && muted.color ? 'color:' + muted.color + ';' : '');
    while (panel.children.length > lines.length) panel.removeChild(panel.lastChild);
    lines.forEach((line, i) => {
      let p = panel.children[i];
      if (!p) {
        p = document.createElement('p');
        panel.appendChild(p);
      }
      restyle(p, lineCss); // the muted token again, re-read on every apply
      if (p.textContent !== line) p.textContent = line;
    });
  }

  // The panel's own layout, re-applied whenever its themed tokens are rewritten.
  function notesLayout(panel) {
    panel.style.padding = '12px 16px';
    panel.style.display = 'flex';
    panel.style.flexDirection = 'column';
    panel.style.gap = '6px';
    panel.style.overflow = 'visible';
  }

  // -- 5.5 status chips (I-L10-02) + row tagging ---------------------------------

  const rowId = (r) => (r && r.id !== null && r.id !== undefined ? String(r.id) : '');

  function syncRows(cards, shape) {
    cards.forEach((card, gi) => {
      const rows = rowEls(card);
      const data = shape[gi] || [];
      rows.forEach((el, ri) => {
        const r = data[ri];
        // Audit F1: sc-for rows are positional, so this element can be showing a
        // different session than it did a render ago. Re-stamp it with the id it
        // carries NOW, then re-derive every injection from that row's own data.
        if (!el.hasAttribute('data-fd-l10-row')) el.setAttribute('data-fd-l10-row', '');
        const id = rowId(r);
        if (el.getAttribute('data-fd-l10-id') !== id) el.setAttribute('data-fd-l10-id', id);
        chips(el, r);
        copyLabel(el, id);
      });
    });
  }

  // card > [group header, scroller > table > [column header, ...rows]]
  function rowEls(card) {
    const scroller = kids(card)[1];
    const table = kids(scroller)[0];
    return kids(table).slice(1);
  }

  const CHIP_KEYS = ['archived', 'cached'];

  // Re-derived, never accumulated. The desired chip set is computed from this row's
  // data on every apply(), and the injected chips are reconciled to it: an injected
  // chip that is not wanted is removed, a missing one is added, a correct one is left
  // alone. So a positionally reused row (audit F1) cannot keep another session's
  // 'Archived' or 'Cached'. The template's own live/offline pill carries no
  // data-fd-l10 and is never read, moved or removed.
  function chips(el, r) {
    const cells = kids(el).filter((n) => n.tagName === 'SPAN');
    const status = cells[0];
    if (!status) return;
    const want = {
      archived: r && r.isArchived ? 'Archived' : '',
      cached: r && r.stale ? 'Cached' : '',
    };
    if (status.style.gap !== '5px') status.style.gap = '5px';
    if (status.style.flexWrap !== 'wrap') status.style.flexWrap = 'wrap';
    const found = {};
    kids(status).forEach((n) => {
      const key = n.getAttribute ? n.getAttribute('data-fd-l10') : null;
      if (!key || CHIP_KEYS.indexOf(key) < 0) return; // not ours: leave it alone
      if (want[key] && !found[key]) found[key] = n;
      else status.removeChild(n); // stale for this session, or a duplicate
    });
    // Extra pills are cloned from the row's model chip, which is the mock's own
    // neutral chip token — no colour guessing.
    const conv = kids(el).filter((n) => n.tagName === 'DIV')[0];
    const meta = kids(conv)[1];
    const model = kids(meta)[1];
    let prev = null;
    CHIP_KEYS.forEach((key) => {
      const text = want[key];
      if (!text) return;
      let pill = found[key];
      if (!pill) {
        pill = document.createElement('span');
        pill.setAttribute('data-fd-l10', key);
        status.appendChild(pill);
      } else if (prev && pill.previousSibling !== prev) {
        status.appendChild(pill); // keep CHIP_KEYS order after a reconcile
      }
      restyle(pill, styleOf(model)); // the mock's neutral chip token, in today's theme
      if (pill.textContent !== text) pill.textContent = text;
      prev = pill;
    });
  }

  // -- 5.4 copy label feedback (I-L10-04) ----------------------------------------

  // Audit F1 / binding instruction 1: per-row state must never live in the DOM. The
  // transient label is held here, keyed by the session id, and apply() paints it onto
  // whichever row element currently carries that id. A poll landing inside the 1500 ms
  // window can hand this row's node to another session; the label follows the session,
  // not the node. The timer only ever mutates this map and asks for a re-apply — it
  // never touches a DOM node captured when the click happened.
  const copyLabels = new Map(); // sessionId -> { kind, text, until, timer }

  function setCopyLabel(r, kind, text, revert) {
    const id = rowId(r);
    if (!id) return; // no stable identity: no label at all beats a label on a guess
    const prev = copyLabels.get(id);
    if (prev && prev.timer) clearTimeout(prev.timer);
    const entry = { kind, text, until: revert ? Date.now() + COPY_REVERT_MS : 0, timer: null };
    copyLabels.set(id, entry);
    if (revert) {
      entry.timer = setTimeout(() => {
        if (copyLabels.get(id) === entry) copyLabels.delete(id); // never clear a newer label
        scheduleApply();
      }, COPY_REVERT_MS);
    }
    scheduleApply();
  }

  function labelLayout(pill) {
    pill.style.whiteSpace = 'nowrap';
    pill.style.flexShrink = '0';
  }

  function expireCopyLabels() {
    const now = Date.now();
    copyLabels.forEach((entry, id) => {
      if (!entry.until || entry.until > now) return;
      if (entry.timer) clearTimeout(entry.timer);
      copyLabels.delete(id);
    });
  }

  // The mock's copy buttons are icon-only, so the label cycle lives in a chip beside
  // the button and is mirrored into the title for anyone reading the tooltip.
  // Rendered from copyLabels on every apply(), so an absent entry actively clears the
  // pill and restores the title — a reused row heals itself on the next render.
  function copyLabel(rowEl, id) {
    const cell = kids(rowEl).filter((n) => n.tagName === 'SPAN')[1];
    if (!cell) return;
    // Action cell buttons in template order: Show, Message, Copy context, Copy
    // conversation. Only the last two ever carry a label.
    const buttons = kids(cell).filter((n) => n.tagName === 'BUTTON');
    const copyBtns = [buttons[2], buttons[3]];
    // Their titles are template constants, not per-row state, so the first sighting of
    // a button is always its real title — captured here, before any write below.
    copyBtns.forEach((b) => {
      if (b && b.__fdL10Title === undefined) b.__fdL10Title = b.getAttribute('title') || '';
    });
    const entry = id ? copyLabels.get(id) : null;
    const btn = entry ? copyBtns[entry.kind === 'copyConv' ? 1 : 0] : null;
    copyBtns.forEach((b) => {
      if (!b) return;
      const title = b === btn ? entry.text : b.__fdL10Title;
      if (b.getAttribute('title') !== title) b.setAttribute('title', title);
    });
    let pill = kids(cell).filter((n) => n.getAttribute && n.getAttribute('data-fd-l10') === 'copylabel')[0];
    if (!btn) {
      if (pill) cell.removeChild(pill);
      return;
    }
    if (!pill) {
      pill = document.createElement('span');
      pill.setAttribute('data-fd-l10', 'copylabel');
    }
    const conv = kids(rowEl).filter((n) => n.tagName === 'DIV')[0];
    const model = kids(kids(conv)[1])[1];
    restyle(pill, styleOf(model) || '', labelLayout); // no model chip: layout still applies
    if (pill.previousSibling !== btn) cell.insertBefore(pill, btn.nextSibling);
    if (pill.textContent !== entry.text) pill.textContent = entry.text;
  }

  // ---------------------------------------------------------------------------
  // Scheduling: re-apply after every render, poll while the screen is on screen.
  // ---------------------------------------------------------------------------

  // Audit F5's remedy, applied to this file's own loop: apply() writes DOM and the
  // observer schedules apply() on DOM writes. Idempotence alone is not a guard, so the
  // observer is disconnected around our mutations AND honours an explicit flag, and
  // applies are counted per macrotask. Above the ceiling this file stops scheduling
  // until the next task, so it cannot spin the tab.
  const MAX_APPLIES_PER_TASK = 50;
  let applying = false;
  let applyCount = 0;
  let applyHalted = false;

  function scheduleApply() {
    if (applying || applyHalted || applyQueued) return;
    applyQueued = true;
    // A microtask, so it lands after the runtime's own flush (queued first by setData).
    Promise.resolve().then(() => {
      applyQueued = false;
      safeApply();
    });
  }

  function safeApply() {
    if (applying || applyHalted) return;
    if (applyCount === 0) {
      // The budget refills on the next macrotask; 50 applies inside one task is a loop,
      // not a busy screen.
      setTimeout(() => {
        applyCount = 0;
        applyHalted = false;
      }, 0);
    }
    if (++applyCount > MAX_APPLIES_PER_TASK) {
      applyHalted = true;
      if (root.console) {
        root.console.error('[fd-v2 l10] apply() ran ' + MAX_APPLIES_PER_TASK +
          ' times in one task; stopping until the next task (audit F5)');
      }
      return;
    }
    applying = true;
    if (observer) observer.disconnect(); // our own writes must not re-trigger us
    try {
      apply();
    } catch (err) {
      if (root.console) root.console.error('[fd-v2 l10] DOM enhancement failed', err);
    }
    applying = false;
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
    // The callback ignores records raised by our own writes; disconnect() already
    // empties the queue, this is the belt to that pair of braces.
    observer = new MutationObserver(() => {
      if (!applying) scheduleApply();
    });
    observe();
  }
  scheduleApply();
})(typeof globalThis === 'object' ? globalThis : this);
