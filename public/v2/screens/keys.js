// fd-v2 L7 keys: owned by that slice.
//
// SSH keys + GitHub train, live. BEHAVIOUR.md is the spec; the mock is the look.
//
// Why this file paints DOM instead of only feeding FD.setData
// -----------------------------------------------------------
// The compiled template binds exactly five names for this screen: A_isKeys,
// A_ttlChips, A_prinChips, A_keyRows and A_copyCmd (template.dc.html:502-565).
// The GitHub-train card and the Certificates card carry NO bindings at all —
// their pill, countdown, TTL chips, End train button, cert rows, copy line and
// Kill now / Delete buttons are literal markup. The Keys table's Type column is
// the literal string "ED25519". Feeding data through FD.setData therefore cannot
// reach them, and the template is out of this slice's scope (README.md:47).
//
// So live mode paints those cards here, by CLONING the mock's own nodes as row
// prototypes — never by hand-typing markup. Every colour comes from the theme
// object the app already computed, handed over by logic.js through sync().
// Improvisations are recorded in docs/design/fleetdeck-v2/improvised.md as
// I-L7-01..I-L7-07.
//
// Fixture mode (?fixture=1) is untouched: the whole module returns before it
// registers anything, so logic.js's guarded hook stays a no-op, renderVals()
// returns exactly what S2 compiled, and the pixel gate diffs the mock as-is.
//
// Hooks this slice PROVIDES to other slices: none.
// Hooks this slice USES from other slices: none.
// FD.screens.keys.sync() is an internal seam between this file and this
// screen's own methods in logic.js, not a cross-slice hook. logic.js guards it.
(function (global) {
  'use strict';

  var FD = global.FD = global.FD || {};
  FD.screens = FD.screens || {};

  // ---- constants, verbatim from today's keys.js ---------------------------
  var TTLS = ['1h', '4h', '8h'];
  // Optional Admin tags are additive: admin itself grants every approved host.
  // vibes-asus stays visible as unknown and cannot contribute a principal.
  var PROFILES = { daily: { label: 'Daily cert', ttl: '8h' }, admin: { label: 'Admin cert', ttl: '1h' } };
  var BOXES = [
    { id: 'rog-strix', user: 'misterisley', tag: 'rog-only', title: 'rog-strix, adds rog-only; admin still reaches all five hosts' },
    { id: 'vibes-asus', user: 'tabor', tag: null, title: 'vibes-asus: trust unknown, owner decision pending' },
    { id: 'german', user: 'vibe', tag: 'german-only', title: 'german-box, adds german-only; admin still reaches all five hosts' },
    { id: 'onboarding', user: 'root', tag: 'onboarding-only', title: 'onboarding-app-box, adds onboarding-only; admin still reaches all five hosts' },
    { id: 'promptly', user: 'root', tag: 'promptly-only', title: 'think-box, adds promptly-only; admin still reaches all five hosts' },
    { id: 'ivy', user: 'root', tag: 'ivy-only', title: 'ivy-box, adds ivy-only; admin still reaches all five hosts' },
  ];
  var BOX_IDS = BOXES.map(function (b) { return b.id; });
  var BOX_BY_ID = {};
  BOXES.forEach(function (b) { BOX_BY_ID[b.tag || b.id] = b; });

  function principalsFor(chosen, profile) {
    if (profile !== 'admin') return ['deploy'];
    var out = ['admin'];
    BOXES.forEach(function (b) { if (b.tag && chosen && chosen[b.id]) out.push(b.tag); });
    return out;
  }
  function mintRequest(profile, chosen) {
    profile = profile === 'admin' ? 'admin' : 'daily';
    return { profile: profile, ttl: PROFILES[profile].ttl, extraTags: profile === 'admin' ? principalsFor(chosen, profile).slice(1) : [] };
  }
  var KILL_CONFIRM = 'Kill this cert now? Agents using it lose access immediately.';
  var POLL_MS = 30000;
  var TICK_MS = 1000;
  var COPIED_MS = 1500;
  var FLASH_MS = 1200;      // how long a freshly minted cert stays tinted

  // Exactly what you paste after `ssh` to use this cert and nothing else from
  // the agent (keys.js:5-6).
  function sshOpts(dir) {
    return '-o IdentitiesOnly=yes -o IdentityAgent=none -i ' + dir +
      '/deployer -o CertificateFile=' + dir + '/deployer-cert.pub';
  }

  // mm:ss under an hour, h:mm above it (keys.js:37-44).
  function left(epoch) {
    var s = Math.floor((epoch - Date.now()) / 1000);
    if (s <= 0) return null;
    var h = Math.floor(s / 3600);
    var m = Math.floor((s % 3600) / 60);
    return h ? h + ':' + pad(m) : pad(m) + ':' + pad(s % 60);
  }
  function pad(n) { return String(n).padStart(2, '0'); }

  // Today's post() reads the body whatever the status: a 400 hands back the
  // server's {ok:false,error}, and a body that will not parse becomes
  // 'HTTP <status>' (keys.js:178-186). FD.data throws on any non-2xx instead,
  // so unwrap it back into that shape rather than losing the server's message.
  function unwrapError(e) {
    if (e && e.status) {
      if (e.body && typeof e.body === 'object') return e.body;
      return { ok: false, error: 'HTTP ' + e.status };
    }
    // No status means the request never landed; the caller's own default text
    // then applies, exactly as `r.error || '<default>'` does today.
    return { ok: false };
  }

  // A status means the deck answered and today's fetch().json() would have read
  // this body — a 503 from a dead broker is data, not a transport failure.
  // Without a status nothing landed, which is the 'cannot reach fleetdeck' case.
  function httpBody(e) { if (e && e.status) return e.body; throw e; }

  // The pure half is exported for test/v2-keys.test.js, which runs in Node with
  // no DOM. Everything below the guard needs a document and never loads there.
  if (typeof module === 'object' && module.exports) {
    module.exports = { left: left, pad: pad, sshOpts: sshOpts, unwrapError: unwrapError, httpBody: httpBody, TTLS: TTLS, BOXES: BOXES, BOX_IDS: BOX_IDS, principalsFor: principalsFor, mintRequest: mintRequest, PROFILES: PROFILES, KILL_CONFIRM: KILL_CONFIRM, POLL_MS: POLL_MS, TICK_MS: TICK_MS, COPIED_MS: COPIED_MS };
  }

  // Fixture mode renders the mock verbatim. Register nothing, start no timers,
  // load no script, touch no DOM — this is what keeps the pixel gate at 36/36.
  // touch no DOM — this is what keeps the pixel gate at 36/36.
  // No document means Node, where only the exports above are wanted.
  //
  // The fixture test is inlined rather than delegated to FD.data.isFixture()
  // so it answers without depending on FD.data at all; it mirrors
  // data.js:563-567 exactly. Getting this wrong would put a network request on
  // the pixel-gate page, so it is deliberately the first thing decided.
  //
  // Node is NOT excluded here. Everything below touches the DOM only from a
  // function, and the bootstrap guards on `document`, so requiring this file
  // under Node registers FD.screens.keys and starts nothing — which is what
  // lets test/v2-keys.test.js drive start()/stop() the way v2-org.test.js does.
  if (isFixtureMode()) return;

  function isFixtureMode() {
    try { if (localStorage.getItem('fd-fixture') === '1') return true; } catch (e) { /* storage off */ }
    var search = global.location && global.location.search;
    return typeof search === 'string' && /[?&]fixture=1(&|$)/.test(search);
  }

  // The shell (public/v2/index.html) loads public/v2/data.js before the screen
  // files, so FD.data — which L1 built and every live screen needs — is already
  // there when this file runs (DECK-84 cut-over). The FD.data guard at the foot
  // of the file stays: without it, a page missing the data layer would throw.
  // ---- module state -------------------------------------------------------
  var state = { certs: [], keys: [] };
  var train = { active: false, expiresAt: null };
  var profile = 'daily';
  var chosen = {};                  // box id -> selected, the chip state this screen reads

  var flashDir = null;   // the dir just minted — its card flashes once
  var mintError = '';
  var trainError = '';
  var loadError = '';
  var minting = false;
  var deletingDir = null;   // the cert dir whose delete is in flight
  var startingTtl = null;   // the train TTL whose start is in flight
  var ending = false;       // an End train is in flight
  var flashUntil = 0;       // the flash is a deadline, not a one-shot (see mint)
  var ticks = [];        // {epoch, node} per live countdown, rebuilt each paint

  var ctx = null;        // theme tokens + mock style objects, handed over by logic.js
  var repaintQueued = false;
  var proto = null;      // deep clones of the mock's own nodes, used as row prototypes
  var seeded = false;    // live mode has restored today's principal default
  var tickTimer = null;  // the 1 s countdown ticker, only while the screen is up
  var pollHandle = null; // the 30 s sshkeys/ghtrain poll, same
  var onScreen = false;  // the keys screen is the one currently rendered
  var booted = false;    // FD.data is present, so the timers may run

  // ---- the seam with logic.js --------------------------------------------
  // logic.js calls this from its keys section on every render, before the
  // reconciler runs. Repainting in a microtask therefore lands immediately
  // after flush() has restored the template's static nodes.
  FD.screens.keys = {
    sync: function (next) {
      if (!next) return;
      ctx = next;
      profile = next.profile === 'admin' ? 'admin' : 'daily';
      if (!seeded && next.logic && next.prin) {
        seeded = true;
        next.logic.setState({ prin: {} });
        return;
      }
      if (next.prin) chosen = next.prin;
      // BEHAVIOUR §3/§6: the 30 s poll and the 1 s tick belong to this screen,
      // not to the app. Today's keys.js is a page that only exists while you
      // are on it; in a SPA that means starting on enter and stopping on leave,
      // or the deck polls /api/sshkeys forever from whatever screen you are on.
      var was = onScreen;
      onScreen = !!next.isKeys;
      if (onScreen && !was) start();
      else if (!onScreen && was) stop();
      if (onScreen) queueRepaint();
    },
    boxes: BOXES,
    // Exposed for verify/l7 and test/v2-keys.test.js, as org.js does.
    start: start,
    stop: stop,
    // Exposed for verify/l7 and test/v2-keys.test.js.
    _debug: {
      left: left,
      sshOpts: sshOpts,
      get state() { return state; },
      get train() { return train; },
      get errors() { return { mint: mintError, train: trainError, load: loadError }; },
      // The last sync payload, which carries the AppLogic handle. verify/l7 uses
      // it to flip the theme mid-session — the app has no theme toggle in its
      // markup, so there is no other way to drive that path from a test.
      get ctx() { return ctx; },
      get timers() { return { tick: !!tickTimer, poll: !!pollHandle, onScreen: onScreen }; },
    },
  };

  function queueRepaint() {
    if (repaintQueued) return;
    repaintQueued = true;
    Promise.resolve().then(function () { repaintQueued = false; paint(); });
  }

  // ---- DOM helpers --------------------------------------------------------
  function css(node, style) { if (node && style) Object.assign(node.style, style); }
  function kids(node) { return node ? Array.prototype.slice.call(node.children) : []; }
  // No document means Node, where this module is required for its pure half
  // and its lifecycle; every painter then no-ops instead of throwing.
  function screenEl() {
    return typeof document === 'undefined' ? null : document.querySelector('[data-screen-label="SSH keys"]');
  }

  // The pill is <span style=pill><span style=dot></span>TEXT</span>: set the
  // wrapper style, the dot style, and the trailing text node.
  function setPill(node, style, dotStyle, text) {
    if (!node) return;
    css(node, style);
    var dot = node.firstElementChild;
    if (dot) { dot.removeAttribute('style'); css(dot, dotStyle); }
    var last = node.lastChild;
    if (last && last.nodeType === 3) last.nodeValue = text;
  }

  // A notice line, cloned from the mock's own hint paragraph so the type scale,
  // margins and font all come from the mock. Improvised: this screen's mock has
  // no error or empty-state design at all (improvised.md I-L7-04).
  function notice(text, colour) {
    if (!proto || !proto.hint) return null;
    var p = proto.hint.cloneNode(true);
    p.replaceChildren(document.createTextNode(text));
    p.style.color = colour;
    p.setAttribute('data-l7-notice', '1');
    return p;
  }

  // Capture the mock's own nodes once, before anything is rewritten, and reuse
  // them as prototypes for every painted row. This is why no markup is typed by
  // hand anywhere in this slice.
  function capture(root) {
    var cards = kids(root);
    if (cards.length < 4) return false;
    // Re-applied on EVERY capture. The sc-if wrapping this screen tears the
    // whole subtree down when you navigate away, so a later visit gets fresh
    // nodes carrying none of our attributes — setting it once on first capture
    // left every visit after the first with no guard at all. Only ever set on
    // a card the reconciler has already populated, so an empty card is never
    // frozen empty.
    if (kids(cards[2]).length && !cards[2].hasAttribute('data-dc-raw')) {
      cards[2].setAttribute('data-dc-raw', '');
    }
    if (proto) return true;
    var mintRow = kids(cards[0])[1];
    var certRows = kids(cards[2]);
    if (!mintRow || certRows.length < 4) return false;
    proto = {
      hint: kids(cards[0])[2].cloneNode(true),        // <p> hint under Mint
      certLive: certRows[1].cloneNode(true),          // active cert row
      certCopy: certRows[2].cloneNode(true),          // copy line + Copy button
      certDead: certRows[3].cloneNode(true),          // expired cert row
    };
    return true;
  }

  // ---- paint --------------------------------------------------------------
  // Never throws: it runs from a microtask the shared render schedules, and an
  // unhandled rejection there is exactly the cross-screen blast radius the
  // DESIGN-35 audit warns about. A failed paint leaves the mock's own cards up.
  function paint() {
    try { repaint(); } catch (e) { console.error('L7 keys paint failed', e); }
  }

  function repaint() {
    var root = screenEl();
    if (!root || !ctx || !capture(root)) return;
    var cards = kids(root);
    if (cards.length < 4) return;
    ticks = [];
    if (flashDir && Date.now() >= flashUntil) flashDir = null;
    paintMint(cards[0]);
    paintTrain(cards[1]);
    paintCerts(cards[2]);
    paintKeys(cards[3]);
  }

  // §2 Mint ­— the TTL and principal chips are already bound to logic.js; this
  // adds the titles, the aria state, the Mint click and the error line.
  function paintMint(card) {
    var row = kids(card)[1];
    if (!row) return;
    var btns = kids(row).filter(function (n) { return n.tagName === 'BUTTON'; });
    // Joined by label — logic.js renders each chip's text as the box id — not
    // by position. A positional slice mislabelled every chip the day a box was
    // added to BOXES and not to logic.js's prinChips (2026-09-10); the label
    // join cannot shift, and test/v2-keys.test.js pins the two lists equal.
    btns.forEach(function (b) {
      var label = b.textContent.trim();
      if (label === 'Daily cert' || label === 'Admin cert') {
        b.setAttribute('aria-pressed', String(label === PROFILES[profile].label));
        b.disabled = minting;
        return;
      }
      var box = BOX_BY_ID[label];
      if (!box) return;
      b.title = box.title;
      b.hidden = profile !== 'admin';
      b.disabled = minting || !box.tag;
      b.setAttribute('aria-pressed', String(!!box.tag && !!chosen[box.id]));
    });
    kids(row).filter(function (n) { return n.tagName === 'SPAN'; }).forEach(function (n) { n.hidden = true; });
    var hint = kids(card)[2];
    if (hint) hint.textContent = profile === 'daily'
      ? '8 hours. Deploy user on five approved hosts, PTY only. Approve in 1Password on the Mac.'
      : '1 hour. Admin access on all five hosts. Extra tags add principals; they do not restrict access. Approve in 1Password on the Mac.';
    var mintBtn = btns[btns.length - 1];
    if (mintBtn) {
      mintBtn.textContent = minting ? 'Minting…' : 'Mint ' + (profile === 'admin' ? 'admin' : 'daily') + ' cert';
      mintBtn.disabled = minting;
      mintBtn.onclick = mint;
    }
    dropNotices(card);
    if (mintError) card.appendChild(notice(mintError, ctx.t.bad));
  }

  // §3 GitHub train — three states, countdown, start chips, End train.
  function paintTrain(card) {
    var row = kids(card)[1];
    if (!row) return;
    var parts = kids(row);
    var tr = train || {};
    var down = tr.ok === false;
    var live = !down && !!tr.active && tr.expiresAt > Date.now();

    if (down) setPill(parts[0], ctx.pills.warn, ctx.pills.warnDot, 'BROKER DOWN');
    else if (live) setPill(parts[0], ctx.pills.good, ctx.pills.goodDot, 'ACTIVE');
    else setPill(parts[0], ctx.pills.dim, ctx.pills.dimDot, 'INACTIVE');

    var cd = parts[1];
    if (cd) {
      cd.hidden = !live;
      if (live) { cd.textContent = left(tr.expiresAt); ticks.push({ epoch: tr.expiresAt, node: cd }); }
    }

    var btns = kids(row).filter(function (n) { return n.tagName === 'BUTTON'; });
    btns.slice(0, TTLS.length).forEach(function (b, i) {
      var v = TTLS[i];
      var busy = startingTtl === v;
      b.textContent = busy ? 'Touch ID…' : v;
      b.disabled = busy;
      b.onclick = function () { startTrain(v); };
    });
    var endBtn = btns[TTLS.length];
    if (endBtn) { endBtn.hidden = !live; endBtn.disabled = ending; endBtn.onclick = endTrain; }

    dropNotices(card);
    if (down || trainError) {
      // keys.js:139 — a broker that is down explains itself even with no click yet.
      card.appendChild(notice(trainError || tr.error || 'the train broker is not answering', ctx.t.bad));
    }
  }

  // §4 Certificates — rebuilt from the mock's own active / expired / copy rows.
  function paintCerts(card) {
    var head = kids(card)[0];
    card.replaceChildren(head);
    if (loadError) { card.appendChild(notice(loadError, ctx.t.bad)); return; }

    // The `current` alias symlink duplicates the newest cert; hide it so Kill
    // always hits a real dir (keys.js:141).
    var certs = (state.certs || []).filter(function (c) { return c && c.dir && !/\/current$/.test(c.dir); });
    if (!certs.length) { card.appendChild(notice('no certs yet — mint one above', ctx.t.ink45)); return; }

    certs.forEach(function (c, i) {
      var live = !!c.validToEpoch && c.validToEpoch > Date.now();
      var row = (live ? proto.certLive : proto.certDead).cloneNode(true);
      var parts = kids(row);
      // The mock's expired row carries the separator; give it to every row but
      // the first so a list of any length reads like the mock's two-row card.
      row.style.borderTop = i ? '1px solid ' + ctx.t.lineSoft : 'none';
      row.style.paddingTop = i ? '14px' : '0';

      setPill(parts[0], live ? ctx.pills.good : ctx.pills.dim,
        live ? ctx.pills.goodDot : ctx.pills.dimDot, live ? 'ACTIVE' : 'EXPIRED');
      parts[1].textContent = c.keyId || c.dir;
      parts[2].textContent = ((c.principals || []).join(', ') || 'no principals') +
        ' · until ' + (c.validTo || '?');
      // A clone carries the palette of whichever theme was live when the
      // prototype was captured. Re-derive every theme-dependent colour from
      // this render's tokens, or switching theme leaves the old one behind.
      if (!live) parts[1].style.color = ctx.t.ink60;
      parts[2].style.color = live ? ctx.t.ink60 : ctx.t.ink45;
      if (live && parts[3]) parts[3].style.color = ctx.t.ink75;

      var btn = kids(row).filter(function (n) { return n.tagName === 'BUTTON'; })[0];
      if (live) {
        var cd = parts[3];
        cd.textContent = left(c.validToEpoch);
        ticks.push({ epoch: c.validToEpoch, node: cd });
      }
      if (btn) {
        btn.textContent = live ? 'Kill now' : 'Delete';
        btn.disabled = deletingDir === c.dir;
        btn.style.borderColor = ctx.t.line;
        btn.style.color = live ? ctx.t.ink : ctx.t.ink75;
        btn.onclick = function () { removeCert(c, live); };
      }
      if (flashDir && c.dir === flashDir && Date.now() < flashUntil) flash(row);
      card.appendChild(row);

      if (live) {
        var copy = proto.certCopy.cloneNode(true);
        var code = copy.querySelector('code');
        var copyBtn = copy.querySelector('button');
        if (code) {
          code.textContent = sshOpts(c.dir);
          code.style.borderColor = ctx.t.lineSoft;
          code.style.background = ctx.t.codeBg;
          code.style.color = ctx.t.ink75;
        }
        if (copyBtn) {
          copyBtn.textContent = 'Copy';
          copyBtn.style.borderColor = ctx.t.line;
          copyBtn.style.color = ctx.t.ink;
          copyBtn.onclick = function () {
            navigator.clipboard.writeText(code ? code.textContent : '').then(function () {
              copyBtn.textContent = 'Copied';
              setTimeout(function () { copyBtn.textContent = 'Copy'; }, COPIED_MS);
            }, function () {});
          };
        }
        card.appendChild(copy);
      }
    });
  }

  // §5 Keys table — the mock hard-codes ED25519 in the Type cell and the
  // template is out of scope, so the real algorithm is written in after render
  // (improvised.md I-L7-05). Row order matches toKeys(), which maps in order.
  function paintKeys(card) {
    var rows = kids(card).slice(2);
    var keys = state.keys || [];
    rows.forEach(function (row, i) {
      var k = keys[i];
      if (!k) return;
      var cell = kids(row)[1];
      if (cell) cell.textContent = k.type || '?';
      var fp = kids(row)[2];
      if (fp && !k.fingerprint) fp.textContent = '?';
    });
  }

  function dropNotices(card) {
    kids(card).forEach(function (n) { if (n.getAttribute('data-l7-notice')) card.removeChild(n); });
  }

  // The mock has no flash design; a brief tint in its own goodBg token marks the
  // cert that was just minted (improvised.md I-L7-06).
  //
  // Applied from a DEADLINE rather than set once and cleared on a timer. The
  // rows are rebuilt on every paint, and a mint triggers several in quick
  // succession (the optimistic paint, the FD.setData flush, the reload) — a
  // one-shot tint was painted onto a row that the very next repaint replaced,
  // so the flash never survived long enough to be seen.
  function flash(row) {
    row.style.background = ctx.t.goodBg;
    row.style.borderRadius = '8px';
  }

  // Incoming rows are guarded before anything renders them: the deck can answer
  // with a null, an object, or a list with holes in it.
  function rows(v) { return Array.isArray(v) ? v.filter(Boolean) : []; }
  function str(v) { return v == null ? '' : String(v); }

  // ---- talking to the API -------------------------------------------------
  function post(call) {
    return call().then(function (r) {
      return r && typeof r === 'object' ? r : { ok: false };
    }, unwrapError);
  }

  // ---- load + poll --------------------------------------------------------
  function load() {
    return Promise.all([
      FD.data.sshkeys().catch(httpBody),
      FD.data.ghtrain().catch(httpBody),
    ]).then(function (r) {
      var s = r[0], tr = r[1];
      if (!s || typeof s !== 'object' || (!s.certs && !s.keys)) return fail();
      state = { certs: rows(s.certs), keys: rows(s.keys) };
      // The deck answers /api/ghtrain as JSON today, but a proxy that hands back
      // a plain-text 503 would otherwise lose the broker's own sentence. Keep it.
      train = tr && typeof tr === 'object' ? tr
        : { ok: false, error: typeof tr === 'string' ? tr.trim() : '' };
      loadError = '';
      // The one identifier this screen owns in the mock's seed data. Every field
      // is coerced to the string the template expects: one undefined row here
      // renders as 'undefined' across the table, and a non-array would throw
      // inside the shared renderVals and blank every screen (DESIGN-35 rule 2).
      FD.setData('keyRows', rows(FD.data.toKeys(s, train).keyRows).map(function (k) {
        return { name: str(k.name), fp: str(k.fp), comment: str(k.comment) };
      }));
      paint();
    }, fail);
  }

  // keys.js:170 — the whole certificates area is replaced by one line.
  function fail() { loadError = 'cannot reach fleetdeck'; paint(); }

  // ---- actions ------------------------------------------------------------
  function mint() {
    mintError = '';
    if (minting) return;
    var request = mintRequest(profile, chosen);
    minting = true;
    paint();
    post(function () { return FD.data.mintCert(request); })
      .then(function (r) {
        minting = false;
        if (r.ok) {
          flashDir = r.outdir;
          flashUntil = Date.now() + FLASH_MS;
          // Nothing else repaints once the tint expires, so ask for one.
          setTimeout(paint, FLASH_MS + 30);
        } else {
          mintError = r.error || 'mint failed';
        }
        paint();
        load();
      });
  }

  // Today's handlers hide the error line the moment you click (keys.js:231,
  // 249), not when the response lands — so a stale 'could not start train'
  // does not sit under a button you have already pressed again.
  function startTrain(v) {
    trainError = '';
    startingTtl = v;
    paint();
    post(function () { return FD.data.startTrain({ ttl: v }); }).then(function (r) {
      startingTtl = null;
      if (!r.ok) trainError = r.error || 'could not start train';
      paint();
      load();
    });
  }

  function endTrain() {
    trainError = '';
    ending = true;
    paint();
    post(function () { return FD.data.endTrain(); }).then(function (r) {
      ending = false;
      if (!r.ok) trainError = r.error || 'could not end train';
      paint();
      load();
    });
  }

  // Ruling O9: "Kill now" is this delete. Today's delete error lands in the
  // mint error line (keys.js:66 reuses errEl), so it stays there.
  function removeCert(c, live) {
    if (live && !confirm(KILL_CONFIRM)) return;
    mintError = '';
    deletingDir = c.dir;
    paint();
    post(function () { return FD.data.deleteKey({ dir: c.dir }); }).then(function (r) {
      deletingDir = null;
      if (!r.ok) mintError = r.error || 'delete failed';
      paint();
      load();
    });
  }

  FD.screens.keys.load = load;

  // ---- lifecycle ----------------------------------------------------------
  function start() {
    if (!booted || !FD.data || tickTimer) return;
    // Countdowns tick locally between the 30 s polls; a cert crossing zero
    // repaints so the badge flips and the Delete button appears (keys.js:158-166).
    tickTimer = setInterval(function () {
      var expired = false;
      for (var i = 0; i < ticks.length; i++) {
        var s = left(ticks[i].epoch);
        if (s) ticks[i].node.textContent = s;
        else expired = true;
      }
      if (expired) paint();
    }, TICK_MS);
    pollHandle = FD.data.poll(load, POLL_MS);
    load();
  }

  function stop() {
    if (tickTimer) clearInterval(tickTimer);
    if (pollHandle && pollHandle.stop) pollHandle.stop();
    tickTimer = pollHandle = null;
    // The nodes these point at are about to be torn down by the sc-if.
    ticks = [];
  }

  function boot() {
    booted = true;
    // sync() may already have told us the keys screen is up — data.js can land
    // after the first render.
    if (onScreen) start();
  }

  // Last statement in the file, so every declaration above has already run. The shell
  // loads data.js before the screens (index.html), so it is here; the guard stays
  // because start() must never run without it, and this file bails on fixture mode
  // at the top anyway.
  if (FD.data) boot();
})(typeof globalThis === 'object' ? globalThis : this);
