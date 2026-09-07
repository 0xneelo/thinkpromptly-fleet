// fd-v2 L3 windows: owned by that slice
//
// Windows tiles + Session full screen (xterm engine). Ledger rows D09, D10.
// Spec: docs/goals/fd-v2-l3/BEHAVIOUR.md. Data enters through FD.setData only.
//
// This first commit publishes the cross-slice seam and nothing else: the four
// hooks this slice PROVIDES exist as no-ops so L2/L4/L6 can call them today,
// and the two hooks this slice USES are reached through guards so a missing
// slice degrades to a no-op instead of a TypeError.
(function (global) {
  'use strict';

  var FD = (global.FD = global.FD || {});
  FD.screens = FD.screens || {};

  // --- hooks this slice USES (guarded; owners land later) -------------------
  // L6 message bus: open a thread for a tmux session.
  function busOpen(target) {
    return FD.screens && FD.screens.bus && FD.screens.bus.open
      ? FD.screens.bus.open(target)
      : undefined;
  }

  // L2 shell: mark a session selected in the sidebar.
  function shellSelectSession(host, name) {
    return FD.shell && FD.shell.selectSession
      ? FD.shell.selectSession(host, name)
      : undefined;
  }

  // --- hooks this slice PROVIDES -------------------------------------------
  // No-ops until the engine lands; the signatures are the contract.
  var windows = {
    // Open a tile for host/name. Dedupes on host + "\0" + name.
    openTile: function (host, name) {},
    // Open a tile and maximize it (the Session full screen overlay).
    openMax: function (host, name) {},
    // Open every live, non-hidden session, 500 ms apart.
    connectAll: function () {},
    // Close one tile. Never kills the remote session.
    closeTile: function (host, name) {},
  };

  windows._busOpen = busOpen;
  windows._selectSession = shellSelectSession;

  FD.screens.windows = windows;
})(window);
