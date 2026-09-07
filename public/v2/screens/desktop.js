// fd-v2 L10 desktop: owned by that slice.
//
// Desktop sessions — live data for the mock's Desktop sessions screen (ledger D17).
// Spec: docs/goals/fd-v2-l10/BEHAVIOUR.md. The mock is the look; today's app is the
// behaviour. Data enters only through FD.setData('dsData', …); the template and the
// shell are never touched from here.
//
// Hooks PROVIDED: none. FD.screens.desktop exists so the shell can see the slice is
// loaded, and so a later slice has a stable place to reach; it carries no hook the
// cross-slice contract promises to anyone.
//
// Hooks USED: FD.screens.bus.open(messageTarget) — L6, ruling O8. Guarded at every
// call site: until L6 lands, Message falls back to the router so the click still
// leaves the user somewhere sensible instead of throwing.
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

  // ---- hooks we PROVIDE: none ------------------------------------------------
  FD.screens.desktop = FD.screens.desktop || {};
  FD.screens.desktop.slice = 'l10';
  FD.screens.desktop.openBus = openBus; // internal; not a cross-slice promise
})(typeof globalThis === 'object' ? globalThis : this);
