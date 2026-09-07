// fd-v2 L4 registry: owned by that slice.
//
// Screen module for the Registry (ledger row D12). Behaviour spec:
// docs/goals/fd-v2-l4/BEHAVIOUR.md — every string, confirm, localStorage key and
// timer in here is quoted from it, which is why they are written out in full
// rather than composed.
//
// This first commit only declares the seam:
//   * provided  — FD.screens.registry.open({q, host}), a no-op until the screen lands;
//   * consumed  — FD.screens.windows.openMax (L3) and FD.screens.bus.open (L6), both
//                 called through guards so this screen works while those slices are
//                 still one-line stubs.
(function (global) {
  'use strict';

  var FD = (global.FD = global.FD || {});
  FD.screens = FD.screens || {};

  var registry = (FD.screens.registry = FD.screens.registry || {});

  // --- hooks this screen PROVIDES ------------------------------------------
  // Other slices deep-link into the Registry: the sidebar (L2) and the machines
  // card "Open in Registry" (L9) both want a screen switch with a pre-filled
  // search. Defined now so those slices can call it against a stub.
  registry.open = function (opts) {
    void opts; // {q, host} — honoured once the screen owns its filter state
  };

  // --- hooks this screen CONSUMES, always guarded ---------------------------
  // L3 owns the maximised session view; until it lands, "Show" must not throw.
  registry.openMax = function (host, name) {
    var windows = FD.screens.windows;
    if (windows && typeof windows.openMax === 'function') {
      windows.openMax(host, name);
      return true;
    }
    return false;
  };

  // L6 owns the bus; ruling O8 says "Message" deep-links into the thread for
  // this session. Until L6 lands the screen falls back to plain navigation.
  registry.openBus = function (target) {
    var bus = FD.screens.bus;
    if (bus && typeof bus.open === 'function') {
      bus.open(target);
      return true;
    }
    return false;
  };
})(window);
