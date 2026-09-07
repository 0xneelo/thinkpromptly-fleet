// fd-v2 L8 accounts: owned by that slice.
//
// The Accounts (credits) screen. Behaviour spec: docs/goals/fd-v2-l8/BEHAVIOUR.md,
// ledger row D15. Today's screen is public/accounts.html + public/accounts.js; this
// file reproduces it inside the mock's markup.
//
// Cross-slice contract:
//   Hooks PROVIDED by L8: none. The namespace below is defined anyway so a peer
//     slice that probes FD.screens.accounts finds an object, never undefined.
//   Hooks USED by L8: none. (Every call this file makes into another slice would be
//     written guarded — FD.screens?.x?.y?.() — but there are none.)
//
// Data enters the UI ONLY through FD.setData. In fixture mode (?fixture=1) this file
// does nothing at all: the compiled logic renders FD.fixture as-is and the pixel gate
// runs there, so setData is never called (DESIGN-35 broadcast, 2026-09-07).
(function (global) {
  'use strict';

  var FD = global.FD = global.FD || {};
  FD.screens = FD.screens || {};

  // L8 provides no hooks. Defined as no-ops so the shape is stable for probes.
  var accounts = FD.screens.accounts = FD.screens.accounts || {};

  accounts.slice = 'l8';
})(window);
