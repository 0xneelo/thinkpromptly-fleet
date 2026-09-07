// fd-v2 L6 bus: owned by that slice.
//
// Message bus threads + reply toast (ledger D13, D08). This file is the live
// controller: it fetches, adapts and pushes data in through FD.setData, and it
// owns every side effect the mock only simulates (send, retry, poll, unread,
// pins, badge). In fixture mode it does nothing at all — the compiled logic
// renders FD.fixture as-is and the pixel gate runs there (DESIGN-35, 2026-09-07).
//
// Hooks PROVIDED: FD.screens.bus.open(target)
// Hooks USED (always guarded): FD.shell.setBadge (L2), FD.screens.windows.openMax (L3)
(function (global) {
  'use strict';

  var FD = global.FD = global.FD || {};
  FD.screens = FD.screens || {};
  var bus = FD.screens.bus = FD.screens.bus || {};

  // `live` is the seam logic.js branches on. It stays false until attach()
  // proves we are outside fixture mode, so nothing below can move a pixel of
  // the fixture render.
  bus.live = false;

  // ---- hooks this slice PROVIDES ------------------------------------------
  // Deep-link into a thread for {type, host?, session} (BEHAVIOUR §5, ruling O8).
  // No-op until the live controller lands.
  bus.open = function (target) {};

  // ---- seam the bus block in logic.js calls (all no-ops for now) ----------
  bus.attach = function (host) {};
  bus.detach = function (host) {};
  bus.deliver = function (req) { return false; };
  bus.retry = function (req) { return false; };
  bus.markSeen = function (id) {};
  bus.setPinned = function (id, on) {};

  // ---- hooks this slice USES, wrapped once so every call site is guarded ---
  bus.setBadge = function (n) {
    var shell = FD.shell;
    if (shell && typeof shell.setBadge === 'function') { try { shell.setBadge(n); } catch (e) {} }
  };
  // tmux rows open the live terminal through L3; until L3 lands the caller
  // falls back to the mock's own full-screen terminal.
  bus.openMax = function (host, session) {
    var w = FD.screens && FD.screens.windows;
    if (w && typeof w.openMax === 'function') { try { w.openMax(host, session); return true; } catch (e) {} }
    return false;
  };
})(window);
