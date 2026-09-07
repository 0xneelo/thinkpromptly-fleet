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

  // Fixture mode renders the mock verbatim. Register nothing, start no timers,
  // touch no DOM — this is what keeps the pixel gate at 36/36.
  if (!FD.data || FD.data.isFixture()) return;

  // ---- constants, verbatim from today's keys.js ---------------------------
  var TTLS = ['1h', '4h', '8h'];
  // root = the VPS boxes' login (think-box, onboarding-app-box, ivy-box),
  // vibe = german-box login. Ruling O9 wanted these from hosts.json, but
  // hosts.json carries no user field — see improvised.md I-L7-01.
  var PRINCIPALS = ['root', 'vibe'];
  var PRINCIPAL_TITLE = { root: 'VPS boxes: think · onboarding · ivy', vibe: 'german-box' };
  var KILL_CONFIRM = 'Kill this cert now? Agents using it lose access immediately.';
  var POLL_MS = 30000;
  var TICK_MS = 1000;
  var COPIED_MS = 1500;

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

  // ---- module state -------------------------------------------------------
  var state = { certs: [], keys: [] };
  var train = { active: false, expiresAt: null };
  var ttl = '1h';
  var principals = {};
  PRINCIPALS.forEach(function (p) { principals[p] = true; });
  var flashDir = null;   // the dir just minted — its card flashes once
  var mintError = '';
  var trainError = '';
  var loadError = '';
  var minting = false;
  var ticks = [];        // {epoch, node} per live countdown, rebuilt each paint

  var theme = null;      // handed over by logic.js sync()
  var painting = false;
  var repaintQueued = false;

  // ---- the seam with logic.js --------------------------------------------
  // logic.js calls this from its keys section on every render, before the
  // reconciler runs. Repainting in a microtask therefore lands immediately
  // after flush() has restored the template's static nodes.
  FD.screens.keys = {
    sync: function (ctx) {
      theme = ctx && ctx.t ? ctx.t : theme;
      queueRepaint();
    },
    // Exposed for verify/l7 and test/v2-keys.test.js.
    _debug: {
      left: left,
      sshOpts: sshOpts,
      get state() { return state; },
      get train() { return train; },
    },
  };

  function queueRepaint() {
    if (repaintQueued) return;
    repaintQueued = true;
    Promise.resolve().then(function () { repaintQueued = false; paint(); });
  }

  function paint() { /* filled in by the card milestones */ }

  // ---- load + poll --------------------------------------------------------
  function load() {
    return Promise.all([FD.data.sshkeys(), FD.data.ghtrain()]).then(function (r) {
      state = r[0] || { certs: [], keys: [] };
      train = r[1] || { active: false, expiresAt: null };
      loadError = '';
      paint();
    }, function () {
      // keys.js:170 — the whole certs area is replaced by one line.
      loadError = 'cannot reach fleetdeck';
      paint();
    });
  }

  FD.screens.keys.load = load;

  // Countdowns tick locally between the 30 s polls; a cert crossing zero
  // repaints so the badge flips and the Delete button appears (keys.js:158-166).
  setInterval(function () {
    var expired = false;
    for (var i = 0; i < ticks.length; i++) {
      var s = left(ticks[i].epoch);
      if (s) ticks[i].node.textContent = s;
      else expired = true;
    }
    if (expired) paint();
  }, TICK_MS);

  FD.data.poll(load, POLL_MS);
  load();
})(window);
