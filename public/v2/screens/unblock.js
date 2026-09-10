// fd-v2 unblock: the 🧠 Unblock screen.
//
// The deck's version of ~/.claude/skills/adhd-unblock/template.html. A seat posts a decision
// sheet, the operator answers it here, and the answers travel back to that seat over the message
// bus — the standalone template's copy-and-paste loop, closed.
//
// The mock has no counterpart for this screen, so the template carries only the mount node
// (#fd-unblock-root) and everything below draws into it in plain DOM — createElement and
// textContent only, never an HTML string. The one exception is `explain`, which the authoring
// agent writes as HTML: it goes through explainTokens() below, which honours six inline tags and
// shows every other tag, and every attribute, as the text it is.
//
// Reads GET /api/unblock and GET /api/unblock/:id. Writes go to PUT …/answers/:qid (the server
// owns every timestamp), POST …/send (the bus message) and POST …/close|reopen. A sheet with no
// reply target answers 409 with the payload, which the screen puts in a textarea for the operator
// to paste in chat by hand — the template's original way out, kept.
//
// Data enters the UI ONLY through FD.setData('unblockLive', view) — this slice's own key, the
// same seam convention as goalsLive / accountsLive.
(function (root) {
  'use strict';

  var FD = (root.FD = root.FD || {});
  FD.screens = FD.screens || {};

  // --- pure helpers ------------------------------------------------------------

  // Every value that becomes a text node goes through this, so a shape change on the API
  // cannot throw mid-render and blank the screen.
  function safeText(v) {
    return typeof v === 'string' ? v : v === null || v === undefined ? '' : String(v);
  }

  // Appended to every card, exactly as the standalone template appends them: the operator can
  // always defer to the recommendation or ask for the question to be explained first.
  var STANDARD = [
    { key: 'you-decide', label: '🤷 You decide', detail: 'Go with the ⭐ recommendation.' },
    { key: 'more-info', label: '❓ Explain more', detail: 'The agent explains in chat before this gets decided.' },
  ];

  function options(q) {
    return (Array.isArray(q && q.options) ? q.options : []).concat(STANDARD);
  }

  // `explain` is agent-authored HTML. Six inline tags carry meaning in it and nothing else is
  // allowed to: a tag with attributes, or any tag outside the list, is not a tag here — it is
  // characters the operator should see. The tokens are text plus the inline tags wrapping it,
  // so the DOM half never parses a string.
  var INLINE = { b: 1, strong: 1, i: 1, em: 1, code: 1 };

  function explainTokens(html) {
    var s = safeText(html);
    var out = [];
    var open = [];
    var re = /<[^>]*>/g;
    var at = 0;
    var m;
    var text = function (t) { if (t) out.push({ text: t, tags: open.slice() }); };
    while ((m = re.exec(s))) {
      text(s.slice(at, m.index));
      at = re.lastIndex;
      // A bare tag and nothing else: any attribute at all drops it back to being text.
      var name = /^<\/?([a-zA-Z][a-zA-Z0-9]*)\s*\/?>$/.exec(m[0]);
      var lower = name && name[1].toLowerCase();
      var closing = m[0].charAt(1) === '/';
      if (lower === 'br') out.push({ br: true });
      else if (lower && INLINE[lower] && !closing) open.push(lower);
      else if (lower && INLINE[lower] && open[open.length - 1] === lower) open.pop();
      else text(m[0]);
    }
    text(s.slice(at));
    return out;
  }

  // The server owns `dirty` — it knows what the last send carried. The screen only reads it,
  // so a reload and a second tab agree about what is still waiting to go.
  function isDirty(answer) {
    return !!(answer && answer.choice && answer.dirty);
  }

  function answeredIds(questions, answers) {
    return (questions || []).filter(function (q) {
      var a = answers && answers[q.id];
      return !!(a && a.choice);
    }).map(function (q) { return q.id; });
  }

  function pendingIds(questions, answers) {
    return (questions || []).filter(function (q) {
      return isDirty(answers && answers[q.id]);
    }).map(function (q) { return q.id; });
  }

  // `3/7 · Deploy route` — plus the two suffixes the template draws with CSS: answered, and
  // answered but not yet sent.
  function chipText(n, total, topic, answer) {
    var tail = isDirty(answer) ? ' ✓ · not sent' : answer && answer.choice ? ' ✓' : '';
    return n + '/' + total + ' · ' + safeText(topic) + tail;
  }

  function fmt(iso) {
    var at = Date.parse(iso || '');
    if (isNaN(at)) return '';
    return new Date(at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
  }

  // The card's time line: when the choice was clicked, when the note was last edited. Both
  // stamps come from the server, so two tabs and a reload all read the same clock.
  function whenLine(answer) {
    var a = answer || {};
    return [
      a.answeredAt && '🕒 answered ' + fmt(a.answeredAt),
      a.noteAt && '✏️ note ' + fmt(a.noteAt),
    ].filter(Boolean).join(' · ');
  }

  // What a send would carry, in the standalone template's envelope. The server builds its own
  // copy and returns it; this is what fills the textarea when the sheet has no reply target and
  // the server could not, so the operator always has something to paste.
  function payloadText(sheet, questions, answers, ids) {
    var list = questions || [];
    var total = list.length;
    var picked = ids || [];
    return JSON.stringify({
      sheet: 'adhd-unblock',
      title: safeText(sheet && sheet.title),
      answered: answeredIds(list, answers || {}).length + '/' + total,
      partial: picked.length < total || undefined,
      answers: list.filter(function (q) { return picked.indexOf(q.id) >= 0; }).map(function (q) {
        var a = (answers && answers[q.id]) || {};
        return {
          id: q.id, decision: q.decision,
          choice: a.choice || null, choiceLabel: a.choiceLabel || null, answeredAt: a.answeredAt || null,
          note: a.note || '', noteAt: a.noteAt || null,
        };
      }),
    }, null, 2);
  }

  // Open sheets are the work; closed ones are history, behind a toggle. The API already sends
  // them newest first, so the order is its order.
  function visibleSheets(sheets, showClosed) {
    return (Array.isArray(sheets) ? sheets : []).filter(function (s) {
      return showClosed || (s && s.status !== 'closed');
    });
  }

  var HIDE_KEY = 'adhd-unblock:hide';

  // The sample the pixel gate renders: one open sheet, two questions, one of them answered and
  // not yet sent. Deterministic — no clock, no fetch.
  var FIXTURE_VIEW = {
    sheets: [{
      id: 'u-2026-09-10-1', title: 'Unblock — the deck train', status: 'open',
      source: { seat: 'ORCHESTRATOR 3', project: 'remote-system' },
      created_at: '2026-09-10T06:00:00Z', updated_at: '2026-09-10T06:20:00Z',
      total: 2, answered: 1, pending: 1,
    }],
    sheet: {
      id: 'u-2026-09-10-1', title: 'Unblock — the deck train',
      intro: 'One click per card. ⭐ = my recommendation — safe default if unsure.',
      status: 'open', source: { seat: 'ORCHESTRATOR 3', project: 'remote-system' },
      total: 2, answered: 1, pending: 1,
      questions: [
        {
          id: 'deploy-route', topic: 'Deploy route',
          decision: 'Do we deploy the deck from the train, or by hand after review?',
          why: 'Two branches are waiting on the answer and neither can merge until it is settled.',
          explain: '<b>The train merges every green branch in one pass.</b> By hand means one <code>up.sh</code> per branch.',
          options: [
            { key: 'train', label: 'Deploy from the train', detail: 'One pass, one restart.', recommended: true },
            { key: 'hand', label: 'By hand, after review', detail: 'Slower, one restart per branch.' },
          ],
        },
        {
          id: 'poll-cadence', topic: 'Poll cadence',
          decision: 'How often should the screen re-read an open sheet?',
          why: 'A seat can add a question while the sheet is open.',
          explain: 'Every poll is one cheap read of the deck database. <i>Nothing leaves the machine.</i>',
          options: [
            { key: 'twenty', label: 'Every 20 seconds', detail: 'Fast enough to feel live.', recommended: true },
            { key: 'manual', label: 'Only on Refresh', detail: 'Quietest, but stale.' },
          ],
        },
      ],
    },
    answers: {
      'deploy-route': {
        choice: 'train', choiceLabel: 'Deploy from the train', answeredAt: '2026-09-10T06:20:00Z',
        note: '', noteAt: null, sentAt: null, dirty: true,
      },
    },
  };

  var pure = {
    safeText: safeText, explainTokens: explainTokens, isDirty: isDirty, answeredIds: answeredIds,
    pendingIds: pendingIds, chipText: chipText, fmt: fmt, whenLine: whenLine, payloadText: payloadText,
    visibleSheets: visibleSheets, options: options,
    STANDARD: STANDARD, INLINE: INLINE, HIDE_KEY: HIDE_KEY, FIXTURE_VIEW: FIXTURE_VIEW,
  };

  FD.screens.unblock = Object.assign(FD.screens.unblock || {}, { _: pure });
  if (typeof module === 'object' && module.exports) module.exports = FD.screens.unblock;

  // In Node (the unit tests) there is no document and nothing below this point runs.
  if (typeof document === 'undefined') return;

  // ---------------------------------------------------------------------------
  // Live mode.
  // ---------------------------------------------------------------------------

  var MOUNT = 'fd-unblock-root';
  var POLL_MS = 20000;
  var NOTE_MS = 400;

  // Mirrors FD.data.isFixture() so this file can still decide when FD.data is absent.
  function isFixture() {
    if (FD.data && typeof FD.data.isFixture === 'function') return FD.data.isFixture();
    try { if (root.localStorage.getItem('fd-fixture') === '1') return true; } catch (e) { /* no storage */ }
    var search = root.location && root.location.search;
    return typeof search === 'string' && /[?&]fixture=1(&|$)/.test(search);
  }

  // Published by logic.js on every render, so the screen follows the theme toggle.
  function tok() {
    return FD.screens.unblock.tokens || {
      ink: '#111', ink75: '#333', ink60: '#666', ink45: '#888', ink35: '#aaa',
      warn: '#b26a00', bad: '#c0392b', good: '#2e7d32', line: 'rgba(128,128,128,.28)',
      panel: 'transparent', panelShadow: 'none', hoverBg: 'rgba(128,128,128,.12)',
      track: 'rgba(128,128,128,.2)', cardPad: '18px 20px',
    };
  }

  var state = {
    sheets: [], sheet: null, answers: {}, id: '',
    error: '', loading: false, sending: false, blocked: null,
    showClosed: false, hideAnswered: false, fresh: '', noteDraft: {}, noteTimer: {},
  };

  try { state.hideAnswered = root.localStorage.getItem(HIDE_KEY) === '1'; } catch (e) { /* no storage */ }

  function questions() {
    return (state.sheet && Array.isArray(state.sheet.questions) && state.sheet.questions) || [];
  }

  // --- DOM helpers -------------------------------------------------------------
  function el(tag, style, text) {
    var n = document.createElement(tag);
    if (style) n.setAttribute('style', style);
    if (text !== undefined) n.textContent = safeText(text);
    return n;
  }

  function chip(text, colour) {
    var t = tok();
    return el('span', 'border-radius:9999px;border:1px solid ' + t.line + ';padding:2px 9px;font-size:11px;color:' +
      colour + ';white-space:nowrap;', text);
  }

  function button(text, onclick, opts) {
    var t = tok();
    var b = el('button', 'border-radius:9999px;border:1px solid ' + ((opts && opts.border) || t.line) +
      ';background:' + ((opts && opts.bg) || 'transparent') + ';color:' + ((opts && opts.colour) || t.ink75) +
      ';padding:4px 12px;font-size:12px;cursor:pointer;white-space:nowrap;' + ((opts && opts.tail) || ''), text);
    b.onclick = onclick;
    return b;
  }

  function card(tail) {
    var t = tok();
    return el('div', 'border-radius:12px;border:1px solid ' + t.line + ';background:' + t.panel + ';box-shadow:' +
      t.panelShadow + ';backdrop-filter:blur(28px) saturate(150%);-webkit-backdrop-filter:blur(28px) saturate(150%);padding:' +
      (t.cardPad || '18px 20px') + ';display:flex;flex-direction:column;gap:10px;' + (tail || ''));
  }

  var MONO = "font-family:ui-monospace,'SF Mono',Menlo,monospace;";
  var ROW = 'display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;';

  function sectionTitle(text) {
    return el('span', 'font-size:13px;font-weight:600;color:' + tok().ink + ';', text);
  }

  // --- network -----------------------------------------------------------------
  // Same-origin, always: the server checks the browser Origin on every write, which is what
  // keeps a seat or a box worker from answering the operator's own sheet through the deck.

  function ask(url, method, body) {
    var init = { credentials: 'same-origin', headers: { 'content-type': 'application/json' } };
    if (method) init.method = method;
    if (body !== undefined) init.body = JSON.stringify(body);
    return fetch(url, init).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (b) { return { status: r.status, body: b }; });
    });
  }

  function fail(r, fallback) {
    return new Error(safeText((r && r.body && r.body.error) || fallback));
  }

  function loadList(then) {
    if (isFixture()) return Promise.resolve();
    state.loading = true;
    return ask('/api/unblock')
      .then(function (r) {
        if (r.status !== 200) throw fail(r, 'cannot read the unblock sheets');
        state.sheets = Array.isArray(r.body && r.body.sheets) ? r.body.sheets : [];
        state.error = '';
        publish();
        // Nothing asked for yet: open the newest sheet that still wants answers.
        var open = visibleSheets(state.sheets, false)[0];
        if (!state.id && open) return select(open.id, true);
        if (then) return then();
      })
      .catch(function (e) { state.error = safeText(e && e.message) || 'cannot reach fleetdeck'; })
      .then(function () { state.loading = false; paint(); });
  }

  function loadSheet(id, quiet) {
    if (isFixture() || !id) return Promise.resolve();
    if (!quiet) state.loading = true;
    return ask('/api/unblock/' + encodeURIComponent(id))
      .then(function (r) {
        if (r.status !== 200) throw fail(r, 'cannot read that sheet');
        state.id = id;
        state.sheet = (r.body && r.body.sheet) || null;
        state.answers = (r.body && r.body.answers) || {};
        state.error = '';
        publish();
      })
      .catch(function (e) { state.error = safeText(e && e.message) || 'cannot reach fleetdeck'; })
      .then(function () { state.loading = false; paint(); });
  }

  // One answer at a time: the response is the row the server wrote, timestamps and all, so the
  // card repaints from the database rather than from what the click hoped happened.
  function putAnswer(qid, body, quiet) {
    if (isFixture()) return Promise.resolve();
    return ask('/api/unblock/' + encodeURIComponent(state.id) + '/answers/' + encodeURIComponent(qid), 'PUT', body)
      .then(function (r) {
        if (r.status !== 200) throw fail(r, 'the answer did not save');
        state.answers[qid] = r.body;
        state.error = '';
        refreshList();
        publish();
      })
      .catch(function (e) { state.error = safeText(e && e.message) || 'the answer did not save'; })
      .then(function () { if (!quiet) paint(); else stampCard(qid); });
  }

  function send(ids) {
    if (isFixture() || state.sending) return Promise.resolve();
    state.sending = true;
    state.blocked = null;
    paint();
    var body = ids ? { ids: ids } : {};
    return ask('/api/unblock/' + encodeURIComponent(state.id) + '/send', 'POST', body)
      .then(function (r) {
        // 409: the sheet names no seat to answer. The payload is the way out — by hand, in chat.
        if (r.status === 409) {
          var given = r.body && r.body.payload;
          state.blocked = {
            error: safeText((r.body && r.body.error) || 'this sheet has no reply target'),
            // The route sends the payload as an object; the operator pastes text.
            payload: given && typeof given === 'object' ? JSON.stringify(given, null, 2)
              : safeText(given) ||
                payloadText(state.sheet, questions(), state.answers, ids || pendingIds(questions(), state.answers)),
          };
          return;
        }
        if (r.status !== 200) throw fail(r, 'the send failed');
        state.error = '';
        return loadSheet(state.id, true);
      })
      .catch(function (e) { state.error = safeText(e && e.message) || 'the send failed'; })
      .then(function () { state.sending = false; refreshList(); paint(); });
  }

  function setStatus(op) {
    if (isFixture()) return Promise.resolve();
    return ask('/api/unblock/' + encodeURIComponent(state.id) + '/' + op, 'POST', {})
      .then(function (r) {
        if (r.status !== 200) throw fail(r, 'the sheet did not ' + op);
        state.error = '';
        return loadList(function () { return loadSheet(state.id, true); });
      })
      .catch(function (e) { state.error = safeText(e && e.message) || 'the sheet did not ' + op; })
      .then(function () { paint(); });
  }

  // The list row's counts move with every answer, so it is re-read after a write. Quiet: a
  // failure here is not worth a banner over an answer that did save.
  function refreshList() {
    if (isFixture()) return Promise.resolve();
    return ask('/api/unblock').then(function (r) {
      if (r.status === 200 && Array.isArray(r.body && r.body.sheets)) state.sheets = r.body.sheets;
    }).catch(function () { /* the counts wait for the next poll */ });
  }

  function select(id, quiet) {
    state.blocked = null;
    state.fresh = '';
    if (FD.router && typeof FD.router.navigate === 'function' && !quiet) {
      try { FD.router.navigate('unblock', { sheet: id }); } catch (e) { /* the hash is a nicety */ }
    }
    return loadSheet(id);
  }

  // The ONLY data entry point.
  function publish() {
    if (typeof FD.setData === 'function')
      FD.setData('unblockLive', { sheets: state.sheets, sheet: state.sheet, answers: state.answers });
  }

  // --- render ------------------------------------------------------------------

  function mount() {
    return document.getElementById(MOUNT);
  }

  function view() {
    if (!isFixture()) return { sheets: state.sheets, sheet: state.sheet, answers: state.answers };
    return { sheets: FIXTURE_VIEW.sheets, sheet: FIXTURE_VIEW.sheet, answers: FIXTURE_VIEW.answers };
  }

  function banner(box) {
    if (!state.error) return;
    var t = tok();
    var b = el('div', 'border-radius:10px;border:1px solid ' + t.bad + ';color:' + t.bad + ';padding:9px 14px;font-size:12.5px;' + ROW);
    b.appendChild(el('span', 'flex:1;', state.error));
    b.appendChild(button('Dismiss', function () { state.error = ''; paint(); }, { colour: t.bad, border: t.bad }));
    box.appendChild(b);
  }

  function sheetList(box, v) {
    var t = tok();
    var c = card();
    var head = el('div', ROW);
    head.appendChild(sectionTitle('🧠 Unblock'));
    head.appendChild(el('span', 'font-size:12.5px;color:' + t.ink60 + ';', 'decision sheets the seats are waiting on'));
    var right = el('span', 'margin-left:auto;' + ROW);
    right.appendChild(button(state.showClosed ? 'Hide closed' : 'Show closed', function () {
      state.showClosed = !state.showClosed;
      paint();
    }, { colour: t.ink60 }));
    var refresh = button(state.loading ? 'Refreshing…' : 'Refresh', function () {
      loadList(function () { return loadSheet(state.id, true); });
    });
    refresh.disabled = !!state.loading || isFixture();
    right.appendChild(refresh);
    head.appendChild(right);
    c.appendChild(head);

    var rows = visibleSheets(v.sheets, state.showClosed);
    if (!rows.length) {
      c.appendChild(el('p', 'margin:0;font-size:12.5px;color:' + t.ink45 + ';',
        'No open unblock sheets. Seats post them with `POST /api/unblock`.'));
      box.appendChild(c);
      return;
    }

    rows.forEach(function (s) {
      var here = s.id === (v.sheet && v.sheet.id);
      var row = el('div', 'display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;padding:8px 10px;border-top:1px solid ' +
        t.line + ';cursor:pointer;border-radius:8px;' + (here ? 'background:' + t.hoverBg + ';' : ''));
      row.onclick = function () { select(s.id); };
      row.appendChild(el('span', 'font-size:12.5px;color:' + t.ink + ';flex:1;min-width:200px;', safeText(s.title)));
      if (s.source && s.source.seat) row.appendChild(chip(safeText(s.source.seat), t.ink60));
      if (s.source && s.source.project) row.appendChild(chip(safeText(s.source.project), t.ink45));
      row.appendChild(el('span', 'font-size:11.5px;color:' + t.ink45 + ';', safeText(s.answered) + '/' + safeText(s.total)));
      if (s.pending) row.appendChild(chip(s.pending + ' not sent', t.warn));
      if (s.status === 'closed') row.appendChild(chip('closed', t.ink45));
      c.appendChild(row);
    });
    box.appendChild(c);
  }

  // The sticky header, card for card with the standalone template: title, intro, progress,
  // count, Hide answered, Send new (N), Send all, Close sheet.
  function sheetHeader(box, v) {
    var t = tok();
    var qs = (v.sheet && v.sheet.questions) || [];
    var total = qs.length;
    var done = answeredIds(qs, v.answers).length;
    var pending = pendingIds(qs, v.answers);
    var c = card('position:sticky;top:8px;z-index:3;');
    c.appendChild(el('span', 'font-size:15px;font-weight:600;color:' + t.ink + ';', safeText(v.sheet.title)));
    if (v.sheet.intro)
      c.appendChild(el('p', 'margin:0;font-size:12.5px;color:' + t.ink60 + ';', safeText(v.sheet.intro)));

    var row = el('div', 'display:flex;align-items:center;gap:10px;flex-wrap:wrap;');
    var bar = el('div', 'flex:1;min-width:120px;height:8px;border-radius:4px;overflow:hidden;background:' +
      (t.track || t.line) + ';');
    bar.appendChild(el('div', 'height:100%;width:' + (total ? (done / total) * 100 : 0) +
      '%;background:' + t.good + ';transition:width .25s;'));
    row.appendChild(bar);
    row.appendChild(el('span', 'font-size:11.5px;color:' + t.ink45 + ';white-space:nowrap;', done + '/' + total));
    row.appendChild(button(state.hideAnswered ? 'Show all' : 'Hide answered', function () {
      state.hideAnswered = !state.hideAnswered;
      state.fresh = '';
      try { root.localStorage.setItem(HIDE_KEY, state.hideAnswered ? '1' : '0'); } catch (e) { /* no storage */ }
      paint();
    }, state.hideAnswered ? { colour: t.ink, bg: t.hoverBg } : { colour: t.ink60 }));

    var newBtn = button(pending.length ? 'Send new (' + pending.length + ')' : 'Send new',
      function () { send(pending); }, { colour: t.warn, border: t.warn });
    newBtn.disabled = !pending.length || state.sending || isFixture();
    if (newBtn.disabled) newBtn.setAttribute('style', newBtn.getAttribute('style') + 'opacity:.45;cursor:default;');
    row.appendChild(newBtn);

    var allBtn = button('Send all', function () { send(answeredIds(qs, v.answers)); }, { colour: t.ink });
    allBtn.disabled = !done || state.sending || isFixture();
    if (allBtn.disabled) allBtn.setAttribute('style', allBtn.getAttribute('style') + 'opacity:.45;cursor:default;');
    row.appendChild(allBtn);

    var closed = v.sheet.status === 'closed';
    var closeBtn = button(closed ? 'Reopen sheet' : 'Close sheet', function () { setStatus(closed ? 'reopen' : 'close'); },
      { colour: t.ink45 });
    closeBtn.disabled = isFixture();
    row.appendChild(closeBtn);
    c.appendChild(row);
    box.appendChild(c);
  }

  function explainBox(q) {
    var t = tok();
    var box = el('div', 'border-radius:8px;background:' + t.hoverBg + ';padding:10px 12px;font-size:12.5px;color:' +
      t.ink75 + ';line-height:1.6;');
    box.appendChild(el('span', 'display:block;font-weight:700;font-size:11.5px;color:' + t.ink + ';margin-bottom:4px;',
      '🧠 Need to know'));
    var body = el('span', 'white-space:pre-wrap;');
    explainTokens(q.explain).forEach(function (tokn) {
      if (tokn.br) return body.appendChild(document.createElement('br'));
      var node = document.createTextNode(tokn.text);
      for (var i = tokn.tags.length - 1; i >= 0; i--) {
        var wrap = document.createElement(tokn.tags[i]);
        wrap.appendChild(node);
        node = wrap;
      }
      body.appendChild(node);
    });
    box.appendChild(body);
    return box;
  }

  function optionButton(q, o, answer) {
    var t = tok();
    var selected = answer && answer.choice === o.key;
    var label = (o.recommended ? '⭐ ' : '') + safeText(o.label) + (selected ? '  ✓' : '');
    var b = el('button', 'display:block;width:100%;text-align:left;border-radius:8px;border:1.5px solid ' +
      (selected ? t.good : o.recommended ? t.warn : t.line) + ';background:' + (selected ? t.hoverBg : 'transparent') +
      ';color:' + t.ink + ';padding:9px 12px;font:inherit;cursor:pointer;' +
      (answer && answer.choice && !selected ? 'opacity:.45;' : ''));
    b.appendChild(el('span', 'display:block;font-weight:600;font-size:13px;color:' +
      (selected ? t.good : o.recommended ? t.warn : t.ink) + ';', label));
    if (o.detail) b.appendChild(el('span', 'display:block;font-size:12px;color:' + t.ink60 + ';margin-top:1px;', safeText(o.detail)));
    b.onclick = function () {
      state.fresh = q.id;
      putAnswer(q.id, { choice: o.key, choiceLabel: safeText(o.label) });
    };
    b.disabled = isFixture();
    return b;
  }

  // A note PUT lands while the operator is still typing, so the card is not rebuilt for it: only
  // the chip and the time line move, and the caret stays where it was.
  function stampCard(qid) {
    var c = document.getElementById('fd-unblock-card-' + qid);
    if (!c) return;
    var qs = questions();
    var n = qs.map(function (q) { return q.id; }).indexOf(qid);
    var chipEl = c.querySelector('[data-fd-chip]');
    var whenEl = c.querySelector('[data-fd-when]');
    if (chipEl) chipEl.textContent = chipText(n + 1, qs.length, (qs[n] || {}).topic, state.answers[qid]);
    if (whenEl) whenEl.textContent = whenLine(state.answers[qid]);
  }

  function questionCard(box, q, n, total, answer) {
    var t = tok();
    var answered = !!(answer && answer.choice);
    if (state.hideAnswered && answered && state.fresh !== q.id) return;
    var c = card('gap:8px;border-color:' + (answered ? t.good : t.line) + ';');
    c.id = 'fd-unblock-card-' + q.id;

    var chipEl = chip(chipText(n, total, q.topic, answer), isDirty(answer) ? t.warn : answered ? t.good : t.ink60);
    chipEl.setAttribute('data-fd-chip', '1');
    var chipRow = el('div', ROW);
    chipRow.appendChild(chipEl);
    c.appendChild(chipRow);

    c.appendChild(el('p', 'margin:0;font-size:14px;font-weight:700;color:' + t.ink + ';', safeText(q.decision)));
    c.appendChild(el('p', 'margin:0;font-size:12.5px;color:' + t.ink60 + ';', safeText(q.why)));
    if (q.explain) c.appendChild(explainBox(q));

    options(q).forEach(function (o) { c.appendChild(optionButton(q, o, answer)); });

    var when = el('span', 'font-size:11.5px;color:' + t.ink45 + ';', whenLine(answer));
    when.setAttribute('data-fd-when', '1');
    c.appendChild(when);

    var row = el('div', 'display:flex;align-items:center;gap:8px;flex-wrap:wrap;');
    var note = el('input', 'flex:1;min-width:180px;border-radius:9999px;border:1px solid ' + t.line +
      ';background:transparent;color:' + t.ink + ';padding:8px 12px;font-size:12.5px;');
    note.placeholder = 'Optional note for the agent…';
    note.setAttribute('data-fd-note', q.id);
    note.value = state.noteDraft[q.id] !== undefined ? state.noteDraft[q.id] : safeText(answer && answer.note);
    note.disabled = isFixture();
    // Debounced: one PUT per pause, not one per keystroke, and the server stamps noteAt. The
    // draft outlives the PUT: a repaint in flight would otherwise show the row's old note.
    note.addEventListener('input', function () {
      state.noteDraft[q.id] = note.value;
      root.clearTimeout(state.noteTimer[q.id]);
      state.noteTimer[q.id] = root.setTimeout(function () {
        var sent = note.value;
        putAnswer(q.id, { note: sent }, true).then(function () {
          if (state.noteDraft[q.id] === sent) delete state.noteDraft[q.id];
        });
      }, NOTE_MS);
    });
    row.appendChild(note);
    var one = button('📤 Send this', function () { send([q.id]); }, { colour: t.ink60 });
    one.disabled = !isDirty(answer) || state.sending || isFixture();
    if (one.disabled) one.setAttribute('style', one.getAttribute('style') + 'opacity:.45;cursor:default;');
    row.appendChild(one);
    c.appendChild(row);
    box.appendChild(c);
  }

  // A sheet with no reply target: the send is refused and the payload is what the operator
  // pastes into the seat's chat by hand.
  function blockedBox(box) {
    if (!state.blocked) return;
    var t = tok();
    var c = card('border-color:' + t.warn + ';');
    c.appendChild(el('span', 'font-size:12.5px;color:' + t.warn + ';', state.blocked.error));
    c.appendChild(el('p', 'margin:0;font-size:11.5px;color:' + t.ink60 + ';',
      'Nothing was sent. Copy this and paste it in the seat\'s chat.'));
    var ta = el('textarea', 'width:100%;min-height:160px;box-sizing:border-box;border-radius:10px;border:1px solid ' +
      t.line + ';background:transparent;color:' + t.ink + ';padding:12px;font-size:12px;resize:vertical;' + MONO);
    ta.readOnly = true;
    ta.value = state.blocked.payload;
    c.appendChild(ta);
    var row = el('div', ROW);
    row.appendChild(button('Copy', function () {
      if (root.navigator && root.navigator.clipboard) root.navigator.clipboard.writeText(state.blocked.payload);
      else { ta.focus(); ta.select(); }
    }));
    row.appendChild(button('Dismiss', function () { state.blocked = null; paint(); }, { colour: t.ink45 }));
    c.appendChild(row);
    box.appendChild(c);
  }

  var painting = false;
  // A repaint replaces every node, and the caret in a note would go with them: remember which
  // note has it and where, and put it back in the new input once the cards stand again.
  function keepCaret() {
    var a = document.activeElement;
    var qid = typing() && a.getAttribute('data-fd-note');
    if (!qid) return function () {};
    var start = a.selectionStart, end = a.selectionEnd;
    return function () {
      var c = document.getElementById('fd-unblock-card-' + qid);
      var n = c && c.querySelector('[data-fd-note]');
      if (!n) return;
      n.focus();
      try { n.setSelectionRange(start, end); } catch (e) { /* not every input type has a range */ }
    };
  }

  function paint() {
    var box = mount();
    if (!box) return;
    var restore = keepCaret();
    painting = true;
    box.replaceChildren();
    var v = view();
    var t = tok();
    banner(box);
    sheetList(box, v);
    if (v.sheet) {
      sheetHeader(box, v);
      var qs = (v.sheet.questions || []);
      var shown = 0;
      qs.forEach(function (q, i) {
        var before = box.childElementCount;
        questionCard(box, q, i + 1, qs.length, v.answers[q.id]);
        if (box.childElementCount > before) shown++;
      });
      if (!shown && qs.length)
        box.appendChild(el('p', 'margin:0;font-size:12.5px;color:' + t.ink45 + ';text-align:center;',
          '✅ All ' + qs.length + ' answered and hidden. Send new, or Show all to review.'));
      blockedBox(box);
    } else if (state.loading) {
      box.appendChild(el('p', 'margin:0;font-size:12.5px;color:' + t.ink45 + ';', 'reading the unblock sheets…'));
    }
    restore();
    if (observer) observer.takeRecords();
    painting = false;
  }

  // --- activation ---------------------------------------------------------------

  var observer = null;
  var sig = '';
  var poller = null;

  // The theme toggle rewrites every bound colour in the compiled tree; this screen's nodes are
  // its own, so it repaints when the tokens actually changed — never on its own writes.
  function watch() {
    if (observer || typeof MutationObserver !== 'function') return;
    observer = new MutationObserver(function () {
      if (painting) return;
      var next = JSON.stringify(tok());
      if (next === sig && mount() && mount().childElementCount) return;
      sig = next;
      paint();
    });
    observer.observe(document.getElementById('dc-root') || document.body, {
      childList: true, subtree: true, attributes: true, attributeFilter: ['style'],
    });
  }

  function active() {
    return !FD.router || FD.router.route().screen === 'unblock';
  }

  function asked() {
    var r = FD.router && FD.router.route();
    return (r && r.params && r.params.sheet) || '';
  }

  // A repaint while a note has the caret would throw the half-typed words away, so the poll
  // yields to whoever is typing and picks the sheet up 20 seconds later.
  function typing() {
    var a = document.activeElement;
    var box = mount();
    return !!(a && box && box.contains(a) && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA'));
  }

  function tick() {
    if (!active() || isFixture() || state.loading || state.sending || typing()) return;
    loadList(function () { return loadSheet(state.id, true); });
  }

  function enter() {
    if (!active()) {
      if (poller) { root.clearInterval(poller); poller = null; }
      return;
    }
    if (isFixture()) return paint();
    if (!poller) poller = root.setInterval(tick, POLL_MS);
    // A deep link names its sheet, so that one is read first and the list follows: loadList
    // only picks a sheet of its own while none is open.
    var want = asked();
    if (want && want !== state.id) loadSheet(want).then(function () { if (!state.sheets.length) loadList(); });
    else if (!state.sheets.length && !state.loading) loadList();
    else paint();
  }

  function start() {
    sig = JSON.stringify(tok());
    watch();
    if (FD.router && typeof FD.router.onChange === 'function') FD.router.onChange(function () { enter(); });
    enter();
  }

  FD.screens.unblock = Object.assign(FD.screens.unblock || {}, {
    start: start, paint: paint, enter: enter, loadList: loadList, loadSheet: loadSheet, send: send, state: state, _: pure,
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else Promise.resolve().then(start);
})(typeof globalThis === 'object' ? globalThis : this);
