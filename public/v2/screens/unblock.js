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
// owns every timestamp), POST …/send (the bus message), POST …/close|reopen and, for a deploy-class
// card, POST …/answers/:qid/sign (the operator's Touch ID, through 1Password). A sheet with no
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
      var a = shownAnswer(q, answers && answers[q.id]);
      return !!(a && a.choice);
    }).map(function (q) { return q.id; });
  }

  function pendingIds(questions, answers) {
    return (questions || []).filter(function (q) {
      return isDirty(shownAnswer(q, answers && answers[q.id]));
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

  // DECK-108: a deploy-class card is one whose answer can start a deploy, so its click is signed.
  // The server's own rule, so the two never disagree about which cards those are.
  function isDeployClass(q) {
    return !!q && (q.deployClass === true || (Array.isArray(q.options) ? q.options : []).some(function (o) {
      return !!o && String(o.key).startsWith('deploy-');
    }));
  }

  // DECK-108 H1: an agent can write a row into fleet.db. On a deploy-class card, a choice the
  // server did not see clicked by a signed-in operator (`clickSeen !== true`) is not the
  // operator's: the card draws it unanswered — no ✓, no answered line — and it is neither counted
  // nor sent. Only the badge says a choice is stored. Every other row is drawn as stored.
  function shownAnswer(q, answer) {
    if (!answer || !answer.choice || answer.clickSeen === true || !isDeployClass(q)) return answer;
    return Object.assign({}, answer, { choice: null, choiceLabel: null, answeredAt: null });
  }

  // A PUT that set a choice on a deploy-class card is signed next — unless the row the server
  // wrote already carries a valid signature, which a second click on the same option can keep.
  function wantsSign(q, sent, row) {
    return isDeployClass(q) && !!(sent && sent.choice) && !!(row && row.choice) && row.sigValid !== true;
  }

  var SIG_REASONS = ['dismissed', 'timeout', 'error', 'agent-shell'];
  // The reasons a second Touch ID prompt can fix. An agent shell stays one.
  var RETRY_REASONS = ['dismissed', 'timeout', 'error'];

  // One click: the choice and the stamp the server gave it. What `local.click` names.
  function clickOf(answer) {
    return safeText(answer && answer.choice) + ' ' + safeText(answer && answer.answeredAt);
  }

  // Beside the time line, on a deploy-class card only: an unsigned ordinary answer is normal and
  // says nothing. `local` is the screen's own state for the card — a sign in flight, signing this
  // deck cannot do, a click the deck never saw (`unseen`), or the click a sign this page started
  // was for (`click`). Sign now is offered only for that click: an answer merely loaded from the
  // deck is signed by clicking it, and one the deck never saw clicked is chosen again (shownAnswer).
  // Signed is strictly `sigValid === true`: an odd field never reads signed.
  function sigBadge(q, answer, local) {
    if (!answer || !answer.choice || !isDeployClass(q)) return null;
    var l = local || {};
    if (l.pending) return { text: '🔐 Approve in 1Password…', tone: 'wait' };
    if (answer.clickSeen !== true) return { text: '⚠ not clicked in this deck session — choose again', tone: 'warn' };
    if (answer.sigValid === true) {
      var key = safeText(answer.sigKey).replace(/^SHA256:/, '').slice(0, 12);
      return { text: ['✅ signed', key, fmt(answer.sigStateAt)].filter(Boolean).join(' · '), tone: 'good' };
    }
    if (l.quiet) return { text: l.quiet, tone: 'quiet' };
    if (l.unseen) return { text: '⚠ not signed — click your answer again, then sign', tone: 'warn' };
    if (l.click === clickOf(answer) && SIG_REASONS.indexOf(answer.sigState) >= 0) {
      var b = { text: '⚠ not signed (' + answer.sigState + ') — this click is a record, not a trigger', tone: 'warn' };
      if (RETRY_REASONS.indexOf(answer.sigState) >= 0) b.signNow = true;
      return b;
    }
    return { text: '⚠ not signed — click it again to sign', tone: 'warn' };
  }

  // The sign-in bar at the top: 'in' (who, and sign out), 'out' (the password form), 'off' (the
  // deck has no sign-in set up, so the server refuses every write and the sheet is read-only) or
  // '' (the session read failed — nothing, rather than a guess). A write refused for want of a
  // sign-in forces the form open; one refused because none is set up (`unset`) forces 'off'.
  function signinMode(session, needed, unset) {
    if (unset || (session && !session.configured)) return 'off';
    if (session && session.signedIn) return 'in';
    if (needed) return 'out';
    return session ? 'out' : '';
  }

  var SIGNIN_LINE = '🔒 Sign in to answer — sign-in lasts until this page reloads';
  var SIGNIN_REQUIRED = 'sign in required — your click was not saved';
  var QUESTION_CHANGED = 'the question changed on the deck — read it again before you sign';
  var READ_ONLY = '🔒 sign-in not set up — this sheet is read-only until the operator runs the deck set-up';

  // The line under a refused sign-in. Built from the response only — the password is never in it.
  // A 429's wait is the body's `retryAfter`, else the Retry-After header.
  function signinError(r) {
    var b = (r && r.body) || {};
    if (r && r.status === 401) return 'wrong password';
    if (r && r.status === 429) {
      var s = Math.ceil(Number(b.retryAfter));
      if (!(s > 0)) s = Math.ceil(Number(r.retryAfter));
      return 'too many tries — wait ' + (s > 0 ? s + 's' : 'a moment');
    }
    return safeText(b.error) || 'sign-in failed';
  }

  // A write the server refused before writing anything: 401 wants a sign-in, 503 means the deck
  // has none set up. '' is any other status.
  function refusal(status) {
    return status === 401 ? 'signin' : status === 503 ? 'unset' : '';
  }

  // An answer write, applied to the card. A 200 is the row the server wrote, and the note draft it
  // carried is done with (a draft typed since is not). A 401 or 503 wrote nothing: the card keeps
  // the last row the server sent, so the choice snaps back — but a note the operator typed stays
  // in its box. Anything else is the caller's error banner.
  function settleAnswer(answers, drafts, qid, r, sent) {
    if (r.status === 200) {
      answers[qid] = r.body;
      if (sent && drafts[qid] === sent.note) delete drafts[qid];
      return 'saved';
    }
    return refusal(r.status) || 'failed';
  }

  // A POST …/sign, applied to the card. A 200 is the answer view, signed or saying why not. The
  // answer moving under the signature means the sheet is re-read; the question moving means it is
  // re-read under QUESTION_CHANGED; a deck that cannot sign says so quietly on the card; a click
  // this deck process never saw (a restart, a row written into fleet.db) wants a fresh click.
  // Anything else is the caller's error banner.
  function settleSign(answers, qid, r) {
    var err = safeText(r.body && r.body.error);
    if (r.status === 200) { answers[qid] = r.body; return 'saved'; }
    if (r.status === 409 && err.indexOf('answer changed') === 0) return 'reload';
    if (r.status === 409 && err === 'question changed') return 'question';
    if (r.status === 409 && err === 'signing not configured') return 'quiet';
    if (r.status === 409 && err === 'click not seen by this deck') return 'unseen';
    return refusal(r.status) || 'failed';
  }

  // The operator's session is the cookie AND this token, sent back as a header: the server counts
  // the operator signed in only when both match. The token lives in this closure and nowhere
  // else: Chromium writes localStorage and sessionStorage to the profile on disk in plaintext,
  // and the cookie reaches every port on the host, so a stored token plus the cookie is a whole
  // session without the password. A reload forgets it and the operator signs in again.
  // Earlier builds stored it under this key; the live half removes it on load.
  var OLD_SESSION_KEY = 'fleetdeck.operatorSession';

  // Every request the screen makes. The token rides on the operator routes and on every write;
  // a sign-in holds it, a sign-out and any 401 drop it. It is never logged.
  function makeAsk(fetchFn) {
    var token = '';
    return function ask(url, method, body) {
      var headers = { 'content-type': 'application/json' };
      if (token && (method || url.indexOf('/api/operator/') === 0)) headers['x-fleetdeck-session'] = token;
      if (url === '/api/operator/signout') token = '';
      var init = { credentials: 'same-origin', headers: headers };
      if (method) init.method = method;
      if (body !== undefined) init.body = JSON.stringify(body);
      return fetchFn(url, init).then(function (r) {
        var retryAfter = r.headers && typeof r.headers.get === 'function' ? r.headers.get('retry-after') : null;
        return r.json().catch(function () { return {}; }).then(function (b) {
          if (r.status === 401) token = '';
          else if (r.status === 200 && url === '/api/operator/signin' && b && typeof b.sessionToken === 'string')
            token = b.sessionToken;
          return { status: r.status, body: b, retryAfter: retryAfter };
        });
      });
    };
  }

  // Each question of a GET, frozen to its JSON text on arrival: what the sign request hashes. A
  // string, so nothing the screen later adds to state.sheet can move the hash.
  function questionTexts(sheet) {
    var out = Object.create(null);
    (sheet && Array.isArray(sheet.questions) ? sheet.questions : []).forEach(function (q) {
      if (q && typeof q.id === 'string') out[q.id] = JSON.stringify(q);
    });
    return out;
  }

  // Signs exactly what the server stamped — the choice and its answeredAt — plus the lowercase hex
  // SHA-256 of the question as it was loaded (`text`, from questionTexts), the server's own
  // questionSha256. Nothing the screen could have made up.
  function requestSign(ask, sheetId, qid, answer, text) {
    var a = answer || {};
    return root.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)).then(function (buf) {
      var hex = Array.prototype.map.call(new Uint8Array(buf), function (n) { return (n < 16 ? '0' : '') + n.toString(16); }).join('');
      return ask('/api/unblock/' + encodeURIComponent(sheetId) + '/answers/' + encodeURIComponent(qid) + '/sign', 'POST',
        { choice: a.choice, answeredAt: a.answeredAt, questionSha256: hex });
    });
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
  var REPO_KEY = 'adhd-unblock:repo';

  // The list pages by the operator's calendar day, not by UTC: a sheet posted at 23:30 belongs
  // to the evening the operator remembers, not to tomorrow.
  function pad(n) { return (n < 10 ? '0' : '') + n; }

  function keyOf(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }

  function dayKey(iso) {
    var at = Date.parse(iso || '');
    return isNaN(at) ? '' : keyOf(new Date(at));
  }

  function repoOf(sheet) {
    var p = sheet && sheet.source && sheet.source.project;
    return typeof p === 'string' ? p : '';
  }

  // Every repo the seats post from, plus whether any sheet names none. Built from ALL sheets, so
  // the selector keeps offering a repo whose sheets the day pager happens to be past.
  function repoOptions(sheets) {
    var repos = [];
    var none = false;
    (Array.isArray(sheets) ? sheets : []).forEach(function (s) {
      var r = repoOf(s);
      if (!r) none = true;
      else if (repos.indexOf(r) < 0) repos.push(r);
    });
    return { repos: repos.sort(function (a, b) { return a.localeCompare(b, undefined, { sensitivity: 'base' }); }), none: none };
  }

  // The days the paginator walks, newest first, and how many sheets each holds. A sheet with no
  // stamp has no day and no page — the server stamps every one it accepts.
  function dayPages(sheets) {
    var pages = [];
    (Array.isArray(sheets) ? sheets : []).forEach(function (s) {
      var k = dayKey(s && s.created_at);
      if (!k) return;
      var hit = pages.filter(function (p) { return p.key === k; })[0];
      if (hit) hit.count++;
      else pages.push({ key: k, count: 1 });
    });
    return pages.sort(function (a, b) { return a.key < b.key ? 1 : a.key > b.key ? -1 : 0; });
  }

  // A filter change, a poll or a new day can take the chosen day away. The newest one steps in
  // quietly rather than leaving the operator on a page that no longer exists.
  function pickDay(pages, wanted) {
    var list = pages || [];
    var here = list.filter(function (p) { return p.key === wanted; })[0];
    return here ? here.key : list[0] ? list[0].key : '';
  }

  function dayLabel(key, nowIso) {
    if (!key) return '';
    var at = nowIso ? Date.parse(nowIso) : Date.now();
    var now = new Date(isNaN(at) ? Date.now() : at);
    if (key === keyOf(now)) return 'Today';
    // From the calendar, not from minus 24 hours: across a DST change that is still one day back.
    if (key === keyOf(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1))) return 'Yesterday';
    var p = key.split('-');
    return new Date(+p[0], +p[1] - 1, +p[2])
      .toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
  }

  // Every page the arrows walk, as the select reads them: newest first, each labelled the way the
  // label between the arrows used to read. No days is still one option, so the select is never blank.
  function dayOptions(pages, nowIso) {
    var list = pages || [];
    if (!list.length) return [{ value: '', label: 'No days' }];
    return list.map(function (p) {
      return { value: p.key, label: dayLabel(p.key, nowIso) + ' \u00b7 ' + p.count };
    });
  }

  // What the list rows pass: the closed toggle, then one repo, then one day. repo '' is every
  // repo and '-' is the sheets that name none; day '' is every day.
  function filterSheets(sheets, opts) {
    var o = opts || {};
    return visibleSheets(sheets, o.showClosed).filter(function (s) {
      var r = repoOf(s);
      if (o.repo === '-' && r) return false;
      if (o.repo && o.repo !== '-' && r !== o.repo) return false;
      return !o.day || dayKey(s && s.created_at) === o.day;
    });
  }

  // The rail's group header, and the bucket a sheet that names no repository falls into.
  var NO_REPO = '(no repository)';

  // The rail groups by project the way the bus groups sessions: named repos first, in the
  // selector's own order, and the sheets that name none last. Row order inside a group is the
  // order it was handed, which is the API's newest-first.
  function groupByRepo(sheets) {
    var by = {};
    var names = [];
    (Array.isArray(sheets) ? sheets : []).forEach(function (s) {
      var r = repoOf(s) || NO_REPO;
      if (!by[r]) { by[r] = []; names.push(r); }
      by[r].push(s);
    });
    names.sort(function (a, b) {
      if (a === NO_REPO) return 1;
      if (b === NO_REPO) return -1;
      return a.localeCompare(b, undefined, { sensitivity: 'base' });
    });
    return names.map(function (r) { return { repo: r, rows: by[r] }; });
  }

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
    dayKey: dayKey, repoOf: repoOf, repoOptions: repoOptions, dayPages: dayPages, pickDay: pickDay,
    dayLabel: dayLabel, dayOptions: dayOptions, filterSheets: filterSheets, groupByRepo: groupByRepo,
    signinMode: signinMode, signinError: signinError, settleAnswer: settleAnswer,
    isDeployClass: isDeployClass, shownAnswer: shownAnswer, wantsSign: wantsSign, sigBadge: sigBadge, settleSign: settleSign,
    makeAsk: makeAsk, requestSign: requestSign, questionTexts: questionTexts, SIGNIN_LINE: SIGNIN_LINE, READ_ONLY: READ_ONLY,
    SIGNIN_REQUIRED: SIGNIN_REQUIRED, QUESTION_CHANGED: QUESTION_CHANGED, STANDARD: STANDARD, INLINE: INLINE, HIDE_KEY: HIDE_KEY, REPO_KEY: REPO_KEY, NO_REPO: NO_REPO,
    FIXTURE_VIEW: FIXTURE_VIEW,
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
    // '' is every repo, '-' the sheets that name none. The day is not remembered: a new session
    // starts on the newest day there is.
    repo: '', day: '',
    // Set by the card's own ResizeObserver, exactly as the bus sets busNarrow.
    narrow: false,
    // DECK-108. `session` is GET /api/operator/session, or null until it answers (and after it
    // fails). `signin.needed`: a write came back 401; `signin.note`: the line the bar shows;
    // `signin.unset`: a write came back 503, the deck has no sign-in set up.
    session: null, signin: { needed: false, note: '', unset: false },
    // Per `<sheet id> <qid>`: { pending } while 1Password asks, { quiet } when the deck cannot sign,
    // { unseen } when the deck never saw the click, { click } after this page's own sign came back.
    sign: {},
    // The open sheet's questions as the GET returned them, as JSON text (questionTexts).
    questionText: {},
  };

  try { state.hideAnswered = root.localStorage.getItem(HIDE_KEY) === '1'; } catch (e) { /* no storage */ }
  try { state.repo = root.localStorage.getItem(REPO_KEY) || ''; } catch (e) { /* no storage */ }

  function setRepo(repo) {
    state.repo = repo;
    if (isFixture()) return;   // the fixture's sheets must never rewrite the operator's saved filter
    try { root.localStorage.setItem(REPO_KEY, repo); } catch (e) { /* no storage */ }
  }

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

  // --- the two-pane card -------------------------------------------------------
  // Token for token the Message bus's own layout (logic.js busGridStyle / railStyle /
  // threadBodyStyle): a rail of sheets on the left, the open sheet on the right. Under 620px of
  // CARD — not of window — the rail folds into a 160px strip above the pane, which is the rule
  // the bus's busRef measures. tok() carries no lineSoft/navAct*, so the rail divider is t.line
  // and the selected row is t.hoverBg behind it.
  var NARROW_AT = 620;

  function gridStyle(above) {
    var t = tok();
    var n = state.narrow;
    return 'display:grid;min-width:0;overflow:hidden;min-height:' + (n ? '0' : '520px') +
      ';height:' + (n ? 'auto' : 'calc(100vh - ' + (146 + (above || 0)) + 'px)') +
      ';grid-template-columns:' + (n ? 'minmax(0,1fr)' : 'minmax(200px,28%) minmax(0,1fr)') +
      ';grid-template-rows:' + (n ? '160px auto' : 'minmax(0,1fr)') +
      ';border-radius:12px;border:1px solid ' + t.line + ';background:' + t.panel +
      ';box-shadow:' + t.panelShadow +
      ';backdrop-filter:blur(28px) saturate(150%);-webkit-backdrop-filter:blur(28px) saturate(150%);';
  }

  function railStyle() {
    var t = tok();
    return 'display:flex;flex-direction:column;min-height:0;min-width:0;' +
      (state.narrow ? 'border-bottom:1px solid ' + t.line + ';' : 'border-right:1px solid ' + t.line + ';');
  }

  function paneBodyStyle() {
    var n = state.narrow;
    return 'flex:1;min-height:' + (n ? '260px' : '0') + ';max-height:' + (n ? '60vh' : 'none') +
      ';overflow-y:auto;padding:18px 18px 10px 18px;display:flex;flex-direction:column;gap:10px;';
  }

  var sizer = null;

  // The card is rebuilt by every repaint, so the observer follows it rather than outliving it.
  function measure(node) {
    if (sizer) { sizer.disconnect(); sizer = null; }
    if (typeof ResizeObserver !== 'function') return;
    sizer = new ResizeObserver(function () {
      var n = node.clientWidth < NARROW_AT;
      if (n === state.narrow) return;
      state.narrow = n;
      paint();
    });
    sizer.observe(node);
  }

  // --- network -----------------------------------------------------------------
  // Same-origin, always: the server checks the browser Origin on every write, which is what
  // keeps a seat or a box worker from answering the operator's own sheet through the deck.

  var ask = makeAsk(function (url, init) { return fetch(url, init); });
  try { root.localStorage.removeItem(OLD_SESSION_KEY); } catch (e) { /* no storage */ }

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

  // A rail click while the poll's re-read of the old sheet is still in flight: whichever read
  // was asked for last wins, the other is dropped on arrival.
  var gen = 0;

  function loadSheet(id, quiet) {
    if (isFixture() || !id) return Promise.resolve();
    var my = ++gen;
    if (!quiet) state.loading = true;
    return ask('/api/unblock/' + encodeURIComponent(id))
      .then(function (r) {
        if (my !== gen) return;
        if (r.status !== 200) throw fail(r, 'cannot read that sheet');
        state.id = id;
        state.sheet = (r.body && r.body.sheet) || null;
        state.questionText = questionTexts(state.sheet);   // before anything else can touch the objects
        state.answers = (r.body && r.body.answers) || {};
        state.error = '';
        publish();
      })
      .catch(function (e) { state.error = safeText(e && e.message) || 'cannot reach fleetdeck'; })
      .then(function () { if (my !== gen) return; state.loading = false; paint(); });
  }

  // One answer at a time: the response is the row the server wrote, timestamps and all, so the
  // card repaints from the database rather than from what the click hoped happened.
  function putAnswer(q, body, quiet) {
    if (isFixture()) return Promise.resolve();
    var qid = q.id;
    return ask('/api/unblock/' + encodeURIComponent(state.id) + '/answers/' + encodeURIComponent(qid), 'PUT', body)
      .then(function (r) {
        var got = settleAnswer(state.answers, state.noteDraft, qid, r, body);
        // Refused (no sign-in, or none set up): the whole card repaints from the last server row.
        if (refusal(r.status)) { quiet = false; return refused(r.status); }
        if (got !== 'saved') throw fail(r, 'the answer did not save');
        state.error = '';
        // A deploy-class click is signed with exactly the choice and answeredAt the server stamped.
        if (wantsSign(q, body, r.body)) signCard(qid);
        if (!quiet) paint(); else stampCard(qid);   // the click shows at once…
        return refreshList().then(publish);         // …and the rail's n/N follows on its own read
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
        if (refusal(r.status)) return refused(r.status);
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
        if (refusal(r.status)) return refused(r.status);
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

  // DECK-108: who the deck thinks is answering. A failed read is null, and the bar draws nothing;
  // a good one replaces whatever a 503 made the screen assume.
  function loadSession() {
    if (isFixture()) return Promise.resolve();
    return ask('/api/operator/session')
      .then(function (r) {
        state.session = r.status === 200 && r.body && typeof r.body === 'object' ? r.body : null;
        if (state.session) state.signin.unset = false;
      })
      .catch(function () { state.session = null; })
      .then(function () { paint(); });
  }

  // A write came back 401 or 503: nothing was saved. A 401 opens the form with `note`, a 503 the
  // read-only bar, and the session is re-read either way.
  function refused(status, note) {
    if (status === 503) state.signin.unset = true;
    else state.signin = { needed: true, note: note || SIGNIN_REQUIRED, unset: state.signin.unset };
    return loadSession();
  }

  // With no sign-in set up the server refuses every write, so the screen offers none.
  function readOnly() {
    return isFixture() || signinMode(state.session, state.signin.needed, state.signin.unset) === 'off';
  }

  function signKey(qid) { return state.id + ' ' + qid; }

  // The Touch ID prompt can take two minutes, so only this card waits: its options are held
  // until 1Password answers, and every other card stays live.
  function signCard(qid) {
    if (isFixture()) return Promise.resolve();
    var id = state.id;
    var key = signKey(qid);
    state.sign[key] = { pending: true };
    paint();
    return requestSign(ask, id, qid, state.answers[qid], state.questionText[qid])
      .then(function (r) {
        delete state.sign[key];
        if (id !== state.id) return;   // another sheet is open; this one is re-read when it comes back
        var got = settleSign(state.answers, qid, r);
        // Only a click of this page is signed here (its PUT, or Sign now on it), so a 200 names
        // the click Sign now may retry; 'unseen' holds Sign now back until a fresh click.
        if (got === 'saved') state.sign[key] = { click: clickOf(state.answers[qid]) };
        else if (got === 'unseen') state.sign[key] = { unseen: true };
        else if (got === 'quiet') state.sign[key] = { quiet: safeText(r.body.error) };
        else if (got === 'reload') return loadSheet(id, true);
        else if (got === 'question') return loadSheet(id, true).then(function () { state.error = QUESTION_CHANGED; });
        else if (refusal(r.status)) return refused(r.status, 'sign in required — the answer is saved but not signed');
        else if (got !== 'saved') throw fail(r, 'the answer was not signed');
      })
      .catch(function (e) { delete state.sign[key]; state.error = safeText(e && e.message) || 'the answer was not signed'; })
      .then(function () { paint(); });
  }

  // The password leaves the input for this one request and is held nowhere else: not in state,
  // not in a log. The field is empty again whatever the answer.
  function signIn(input) {
    var password = input.value;
    input.value = '';
    if (!password) return Promise.resolve();
    return ask('/api/operator/signin', 'POST', { password: password })
      .then(function (r) {
        state.signin = r.status === 200 ? { needed: false, note: '' } : { needed: state.signin.needed, note: signinError(r) };
      })
      .catch(function () { state.signin.note = 'cannot reach fleetdeck'; })
      .then(loadSession);
  }

  function signOut() {
    state.signin = { needed: false, note: '' };
    ask('/api/operator/signout', 'POST', {})
      .catch(function () { /* the session read says what stuck */ })
      .then(loadSession);
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

  // DECK-108: who is answering, one line at the top. After a refused write it is the one thing on
  // the screen asking for attention. The form is a real <form> with a current-password field, so
  // the operator's password manager fills it and Enter submits it.
  function signinBar(box) {
    var mode = signinMode(state.session, state.signin.needed, state.signin.unset);
    if (!mode) return;
    var t = tok();
    if (mode === 'off') {
      box.appendChild(el('div', 'border-radius:10px;border:1px solid ' + t.warn + ';color:' + t.warn +
        ';padding:8px 14px;font-size:12.5px;font-weight:600;', READ_ONLY));
      return;
    }
    if (mode === 'in') {
      var row = el('div', ROW + 'font-size:12px;color:' + t.ink60 + ';');
      row.appendChild(el('span', null, 'signed in as ' + safeText(state.session.operatorId) + ' ·'));
      var out = el('button', 'border:0;background:transparent;padding:0;font:inherit;color:' + t.ink60 +
        ';text-decoration:underline;cursor:pointer;', 'sign out');
      out.onclick = signOut;
      row.appendChild(out);
      box.appendChild(row);
      return;
    }
    var needed = state.signin.needed;
    var f = el('form', 'margin:0;border-radius:10px;border:1px solid ' + (needed ? t.bad : t.line) +
      ';padding:8px 14px;font-size:12.5px;' + ROW + 'align-items:center;');
    f.appendChild(el('span', 'font-weight:600;color:' + (needed ? t.bad : t.ink75) + ';', SIGNIN_LINE));
    var pw = el('input', 'min-width:180px;border-radius:9999px;border:1px solid ' + t.line +
      ';background:transparent;color:' + t.ink + ';padding:5px 12px;font-size:12.5px;');
    pw.type = 'password';
    pw.setAttribute('autocomplete', 'current-password');
    pw.setAttribute('aria-label', 'Deck password');
    pw.placeholder = 'Deck password';
    f.appendChild(pw);
    f.appendChild(button('Sign in', null, { colour: t.ink }));
    if (state.signin.note) f.appendChild(el('span', 'color:' + t.bad + ';', state.signin.note));
    f.onsubmit = function (e) { e.preventDefault(); signIn(pw); };
    box.appendChild(f);
  }

  // The rail head, in the bus's own head row: one repo, one day, then the two list controls.
  // None of them touch the open sheet on the right — a deep link stays readable however the rail
  // is filtered.
  function railHead(opts, pages, day) {
    var t = tok();
    var row = el('div', 'display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding:12px 12px 6px 12px;');

    var pill = 'border-radius:9999px;border:1px solid ' + t.line + ';background:transparent;color:' +
      t.ink75 + ';padding:4px 10px;font-size:12px;cursor:pointer;';
    var add = function (sel, label, value) {
      var o = el('option', null, label);
      o.value = value;
      sel.appendChild(o);
    };

    var repo = el('select', pill);
    add(repo, 'All repositories', '');
    opts.repos.forEach(function (r) { add(repo, r, r); });
    if (opts.none) add(repo, NO_REPO, '-');
    repo.value = state.repo;
    repo.disabled = isFixture();
    repo.onchange = function () { setRepo(repo.value); paint(); };
    row.appendChild(repo);

    var at = pages.map(function (p) { return p.key; }).indexOf(day);
    var arrow = function (glyph, to) {
      var b = button(glyph, function () {
        if (!pages[to]) return;
        state.day = pages[to].key;
        paint();
      }, { colour: t.ink60 });
      b.disabled = !pages[to] || isFixture();
      if (b.disabled) b.setAttribute('style', b.getAttribute('style') + 'opacity:.45;cursor:default;');
      return b;
    };
    // The pager is one control in three parts, so it wraps as a whole rather than leaving an
    // arrow stranded on the line above in a rail this narrow.
    var pager = el('span', 'display:inline-flex;align-items:center;gap:6px;flex-shrink:0;');
    // Newest first, so the newer day is one step back up the list.
    pager.appendChild(arrow('‹', at - 1));

    // The day between the arrows is a jump as well as a step: the arrows walk it one page at a
    // time, the select goes straight there. Not remembered — a new day is the one to land on.
    var days = el('select', pill);
    dayOptions(pages).forEach(function (o) { add(days, o.label, o.value); });
    if (!pages.length) days.firstChild.disabled = true;
    days.value = day;
    days.disabled = !pages.length || isFixture();
    days.onchange = function () { state.day = days.value; paint(); };
    pager.appendChild(days);

    pager.appendChild(arrow('›', at + 1));
    row.appendChild(pager);

    row.appendChild(button(state.showClosed ? 'Hide closed' : 'Show closed', function () {
      state.showClosed = !state.showClosed;
      paint();
    }, { colour: t.ink60 }));
    var refresh = button(state.loading ? 'Refreshing…' : 'Refresh', function () {
      loadList(function () { return loadSheet(state.id, true); });
    });
    refresh.disabled = !!state.loading || isFixture();
    row.appendChild(refresh);
    return row;
  }

  // The bus's group header: the bucket's name in small caps, its count on the far right.
  function groupHead(label, count) {
    var t = tok();
    var h = el('div', 'display:flex;align-items:center;gap:6px;font-size:10px;text-transform:uppercase;' +
      'letter-spacing:0.14em;color:' + t.ink45 + ';padding:12px 8px 6px 8px;');
    h.appendChild(el('span', 'flex:1;min-width:0;', label));
    h.appendChild(el('span', 'opacity:.55;', String(count)));
    return h;
  }

  // One sheet, in the bus rail's two-line row: the title and the progress on top, the seat and
  // what the sheet still owes underneath.
  function sheetRow(s, here) {
    var t = tok();
    var row = el('div', 'display:flex;align-items:flex-start;gap:9px;width:100%;text-align:left;' +
      'border-radius:10px;border:1px solid ' + (here ? t.line : 'transparent') + ';background:' +
      (here ? t.hoverBg : 'transparent') + ';padding:8px 8px;cursor:pointer;box-sizing:border-box;color:' +
      t.ink + ';transition:background .15s;');
    row.setAttribute('role', 'button');
    row.tabIndex = 0;
    row.onclick = function () { select(s.id); };

    var col = el('span', 'flex:1;min-width:0;display:flex;flex-direction:column;gap:3px;');
    var top = el('span', 'display:flex;align-items:baseline;gap:6px;min-width:0;');
    top.appendChild(el('span', 'flex:1;min-width:0;font-size:12.5px;font-weight:500;color:' + t.ink +
      ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis;', safeText(s.title)));
    top.appendChild(el('span', 'margin-left:auto;font-size:10.5px;color:' + t.ink45 +
      ';white-space:nowrap;flex-shrink:0;', safeText(s.answered) + '/' + safeText(s.total)));
    col.appendChild(top);

    var meta = el('span', 'display:flex;align-items:center;gap:6px;min-width:0;flex-wrap:wrap;');
    if (s.source && s.source.seat) meta.appendChild(chip(safeText(s.source.seat), t.ink60));
    if (s.pending) meta.appendChild(chip(s.pending + ' not sent', t.warn));
    if (s.status === 'closed') meta.appendChild(chip('closed', t.ink45));
    if (meta.childElementCount) col.appendChild(meta);

    row.appendChild(col);
    return row;
  }

  // The left half: the head, then the sheets the filters left, grouped by the repository that
  // posted them.
  function railPane(v) {
    var t = tok();
    var rail = el('div', railStyle());

    var opts = repoOptions(v.sheets);
    // A remembered repo that no sheet uses any more would empty the rail with nothing to say why.
    // Only once there are sheets to judge it against: the first paint runs before the list lands.
    if ((v.sheets || []).length && state.repo &&
      (state.repo === '-' ? !opts.none : opts.repos.indexOf(state.repo) < 0)) setRepo('');
    // The pager reads the repo-filtered set, so the count beside the day is the count of the rows.
    var pages = dayPages(filterSheets(v.sheets, { showClosed: state.showClosed, repo: state.repo }));
    var day = pickDay(pages, state.day);
    rail.appendChild(railHead(opts, pages, day));

    var body = el('div', 'flex:1;min-height:0;overflow-y:auto;padding:0 8px 10px 8px;' +
      'display:flex;flex-direction:column;gap:1px;');
    body.setAttribute('data-fd-scroll', 'rail');
    rail.appendChild(body);

    var note = function (text) {
      body.appendChild(el('p', 'margin:8px;font-size:12.5px;color:' + t.ink45 + ';', text));
    };
    var pool = visibleSheets(v.sheets, state.showClosed);
    var rows = filterSheets(v.sheets, { showClosed: state.showClosed, repo: state.repo, day: day });
    if (!pool.length) {
      note('No open unblock sheets. Seats post them with `POST /api/unblock`.');
      return rail;
    }
    if (!rows.length) {
      note(state.repo ? 'No sheets for this repository on this day.' : 'No sheets on this day.');
      return rail;
    }

    groupByRepo(rows).forEach(function (g) {
      body.appendChild(groupHead(g.repo, g.rows.length));
      g.rows.forEach(function (s) { body.appendChild(sheetRow(s, s.id === (v.sheet && v.sheet.id))); });
    });
    return rail;
  }

  // The right half with nothing open. The bus says "No messages yet" in the same place.
  function pickState(body) {
    var t = tok();
    var c = el('div', 'margin:auto;text-align:center;display:flex;flex-direction:column;gap:6px;max-width:320px;');
    c.appendChild(el('span', 'font-size:13px;color:' + t.ink60 + ';', 'Pick a sheet'));
    c.appendChild(el('span', 'font-size:12px;color:' + t.ink45 + ';line-height:1.5;',
      'Sheets the seats post appear on the left; the one you open lands here.'));
    body.appendChild(c);
  }

  // The sticky header, card for card with the standalone template: title, intro, progress,
  // count, Hide answered, Send new (N), Send all, Close sheet.
  function sheetHeader(box, v) {
    var t = tok();
    var qs = (v.sheet && v.sheet.questions) || [];
    var total = qs.length;
    var done = answeredIds(qs, v.answers).length;
    var pending = pendingIds(qs, v.answers);
    // Lives in the pane's head, above the scroll body, so no card ever rolls behind it.
    var c = card('');
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
    newBtn.disabled = !pending.length || state.sending || readOnly();
    if (newBtn.disabled) newBtn.setAttribute('style', newBtn.getAttribute('style') + 'opacity:.45;cursor:default;');
    row.appendChild(newBtn);

    var allBtn = button('Send all', function () { send(answeredIds(qs, v.answers)); }, { colour: t.ink });
    allBtn.disabled = !done || state.sending || readOnly();
    if (allBtn.disabled) allBtn.setAttribute('style', allBtn.getAttribute('style') + 'opacity:.45;cursor:default;');
    row.appendChild(allBtn);

    var closed = v.sheet.status === 'closed';
    var closeBtn = button(closed ? 'Reopen sheet' : 'Close sheet', function () { setStatus(closed ? 'reopen' : 'close'); },
      { colour: t.ink45 });
    closeBtn.disabled = readOnly();
    if (closeBtn.disabled && !isFixture()) closeBtn.setAttribute('style', closeBtn.getAttribute('style') + 'opacity:.45;cursor:default;');
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
      putAnswer(q, { choice: o.key, choiceLabel: safeText(o.label) });
    };
    // Held while this card's signature is in flight: a new click would change what is being signed.
    var signing = !!(state.sign[signKey(q.id)] || {}).pending;
    b.disabled = readOnly() || signing;
    if (signing) b.style.cursor = 'progress';
    return b;
  }

  // Beside the time line: the signature badge on a deploy-class card, and Sign now where this
  // page's own sign was dismissed or failed. An ordinary card gets the empty span, so stampCard can fill it.
  function sigNode(q, answer) {
    var t = tok();
    var b = sigBadge(q, answer, state.sign[signKey(q.id)]);
    var tone = { good: t.good, warn: t.warn, wait: t.ink60, quiet: t.ink45 };
    var n = el('span', 'display:inline-flex;align-items:baseline;gap:8px;flex-wrap:wrap;font-size:11.5px;color:' +
      (b ? tone[b.tone] : t.ink45) + ';');
    n.setAttribute('data-fd-sig', '1');
    if (!b) return n;
    n.appendChild(el('span', null, b.text));
    if (b.signNow) {
      var go = button('Sign now', function () { signCard(q.id); }, { colour: t.warn, border: t.warn });
      go.disabled = readOnly();
      if (go.disabled && !isFixture()) go.setAttribute('style', go.getAttribute('style') + 'opacity:.45;cursor:default;');
      n.appendChild(go);
    }
    return n;
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
    var shown = shownAnswer(qs[n], state.answers[qid]);
    if (chipEl) chipEl.textContent = chipText(n + 1, qs.length, (qs[n] || {}).topic, shown);
    if (whenEl) whenEl.textContent = whenLine(shown);
    var sigEl = c.querySelector('[data-fd-sig]');
    if (sigEl && qs[n]) sigEl.replaceWith(sigNode(qs[n], state.answers[qid]));
  }

  function questionCard(box, q, n, total, stored) {
    var t = tok();
    var answer = shownAnswer(q, stored);
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

    var whenRow = el('div', ROW);
    var when = el('span', 'font-size:11.5px;color:' + t.ink45 + ';', whenLine(answer));
    when.setAttribute('data-fd-when', '1');
    whenRow.appendChild(when);
    whenRow.appendChild(sigNode(q, stored));
    c.appendChild(whenRow);

    var row = el('div', 'display:flex;align-items:center;gap:8px;flex-wrap:wrap;');
    var note = el('input', 'flex:1;min-width:180px;border-radius:9999px;border:1px solid ' + t.line +
      ';background:transparent;color:' + t.ink + ';padding:8px 12px;font-size:12.5px;');
    note.placeholder = 'Optional note for the agent…';
    note.setAttribute('data-fd-note', q.id);
    note.value = state.noteDraft[q.id] !== undefined ? state.noteDraft[q.id] : safeText(answer && answer.note);
    note.disabled = readOnly();
    // Debounced: one PUT per pause, not one per keystroke, and the server stamps noteAt. The
    // draft outlives the PUT until the server has the same words (settleAnswer drops it then): a
    // repaint in flight would otherwise show the row's old note, and a refused write loses nothing.
    note.addEventListener('input', function () {
      state.noteDraft[q.id] = note.value;
      root.clearTimeout(state.noteTimer[q.id]);
      state.noteTimer[q.id] = root.setTimeout(function () {
        putAnswer(q, { note: note.value }, true);
      }, NOTE_MS);
    });
    row.appendChild(note);
    var one = button('📤 Send this', function () { send([q.id]); }, { colour: t.ink60 });
    one.disabled = !isDirty(answer) || state.sending || readOnly();
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

  // The rail list and the pane body are scroll containers that every repaint rebuilds; their
  // offsets are carried across, or the 20 s poll would throw a long sheet back to its top. The
  // pane's key carries the sheet id, so opening another sheet still starts at the top.
  function keepScroll() {
    var tops = {};
    var box = mount();
    if (box) box.querySelectorAll('[data-fd-scroll]').forEach(function (n) {
      tops[n.getAttribute('data-fd-scroll')] = n.scrollTop;
    });
    return function () {
      var b = mount();
      if (b) b.querySelectorAll('[data-fd-scroll]').forEach(function (n) {
        var top = tops[n.getAttribute('data-fd-scroll')];
        if (top) n.scrollTop = top;
      });
    };
  }

  function paint() {
    var box = mount();
    if (!box) return;
    var restore = keepCaret();
    var rescroll = keepScroll();
    painting = true;
    box.replaceChildren();
    var v = view();
    var t = tok();
    signinBar(box);
    banner(box);
    // The grid fills the viewport under whatever stands above it — the sign-in bar, an error — so
    // neither pushes the page into a scroll. 14px is the mount's own gap.
    var above = Array.prototype.reduce.call(box.children, function (h, k) { return h + k.offsetHeight + 14; }, 0);

    // One card, two panes: which sheet on the left, that sheet on the right.
    var grid = el('div', gridStyle(above));
    grid.appendChild(railPane(v));
    var pane = el('div', 'display:flex;flex-direction:column;min-height:0;min-width:0;');
    // The sheet header sits in a head of its own, like the bus's thread toolbar: only the cards
    // scroll, so nothing ever rolls behind the title, the progress and the Send buttons.
    var head = el('div', 'flex:none;padding:18px 18px 0 18px;');
    pane.appendChild(head);
    var body = el('div', paneBodyStyle());
    body.setAttribute('data-fd-scroll', 'pane:' + (state.id || ''));
    pane.appendChild(body);
    grid.appendChild(pane);
    box.appendChild(grid);
    measure(grid);

    if (v.sheet) {
      sheetHeader(head, v);
      var qs = (v.sheet.questions || []);
      var shown = 0;
      qs.forEach(function (q, i) {
        var before = body.childElementCount;
        questionCard(body, q, i + 1, qs.length, v.answers[q.id]);
        if (body.childElementCount > before) shown++;
      });
      if (!shown && qs.length)
        body.appendChild(el('p', 'margin:0;font-size:12.5px;color:' + t.ink45 + ';text-align:center;',
          '✅ All ' + qs.length + ' answered and hidden. Send new, or Show all to review.'));
      blockedBox(body);
    } else if (state.loading) {
      body.appendChild(el('p', 'margin:0;font-size:12.5px;color:' + t.ink45 + ';', 'reading the unblock sheets…'));
    } else {
      pickState(body);
    }
    restore();
    rescroll();
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
    return !!(a && box && box.contains(a) && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT'));
  }

  function tick() {
    if (!active() || isFixture() || state.loading || state.sending || typing()) return;
    loadList(function () { return loadSheet(state.id, true); });
  }

  function enter() {
    if (!active()) {
      if (poller) { root.clearInterval(poller); poller = null; }
      if (sizer) { sizer.disconnect(); sizer = null; }   // the card is gone with the screen
      return;
    }
    if (isFixture()) return paint();
    if (!poller) poller = root.setInterval(tick, POLL_MS);
    if (!state.session) loadSession();   // a failed read is retried on the next visit
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
    start: start, paint: paint, enter: enter, loadList: loadList, loadSheet: loadSheet, send: send, signCard: signCard,
    putAnswer: putAnswer, signIn: signIn, state: state, _: pure,
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else Promise.resolve().then(start);
})(typeof globalThis === 'object' ? globalThis : this);
