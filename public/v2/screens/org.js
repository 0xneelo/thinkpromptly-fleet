/* fleetdeck v2 — L5 · Org chart on live seats + sessions (Dietlind, agent-v2-l5).
 *
 * Owns: this file and the org methods in logic.js. Nothing else.
 *
 * HOOKS PROVIDED: none. L5 exposes no cross-slice hook; other slices need
 *   nothing from the org screen. FD.screens.org below is this screen's OWN
 *   surface (logic.js reads it, the verify script drives it) — not a contract
 *   any other slice may call.
 *
 * HOOKS USED (both guarded — the owning slice may not have landed yet):
 *   FD.shell.setLiveApi(text, tone)      L2 — folds the source badge into the
 *                                        header "Live API" pill (ruling O4).
 *   FD.screens.bus.open({type,host,session})
 *                                        L6 — "Send a message" deep-links into
 *                                        the bus thread (ruling O8 pattern).
 *
 * DATA SEAM: FD.setData only, and never in fixture mode (DESIGN-35 point 2).
 *   'orgScopeData' — the mock identifier, from FD.data.toOrg().scope.
 *   'orgLive'      — a NEW key (DESIGN-35 point 4) carrying everything the mock
 *                    left unbound. When it is absent the org methods in logic.js
 *                    fall back to the mock's literals, so fixture mode is
 *                    byte-for-byte the mock. See REPORT.md.
 */
(function (global) {
  'use strict';

  var FD = (global.FD = global.FD || {});
  FD.screens = FD.screens || {};
  FD.shell = FD.shell || {};

  /* ---- guarded hooks into other slices ---------------------------------- */

  // L2 owns the header pill. Until it lands this is a no-op, by design.
  function setLiveApi(text, tone) {
    try {
      FD.shell && FD.shell.setLiveApi && FD.shell.setLiveApi(text, tone);
    } catch (e) {
      console.error('[org] setLiveApi hook failed', e);
    }
  }

  // L6 owns the bus. Until it lands "Send a message" is inert, by design.
  function openBus(target) {
    try {
      return !!(FD.screens && FD.screens.bus && FD.screens.bus.open && (FD.screens.bus.open(target), true));
    } catch (e) {
      console.error('[org] bus.open hook failed', e);
      return false;
    }
  }

  FD.screens.org = { setLiveApi: setLiveApi, openBus: openBus };
})(typeof globalThis === 'object' ? globalThis : this);
