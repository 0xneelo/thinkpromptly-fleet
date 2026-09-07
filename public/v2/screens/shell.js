// fd-v2 L2 shell: owned by that slice
/* App shell — sidebar, page header, right rail. Ledger rows D03, D04, D05.
 * Spec: docs/goals/fd-v2-l2/BEHAVIOUR.md. Worker: Renate.
 *
 * This first commit only declares the seam: the hooks L2 promises the other
 * slices, as no-ops, plus guarded stubs for the hooks L2 will call. Nothing
 * fetches yet, so fixture mode is untouched. */
(function (global) {
  'use strict';

  var FD = (global.FD = global.FD || {});
  FD.screens = FD.screens || {};
  FD.shell = FD.shell || {};

  /* ---- hooks L2 PROVIDES (no-ops until the slice is wired) ---------------- */

  /* L6 reports the message-bus unread count; it lands on the sidebar nav badge. */
  FD.shell.setBadge = function (n) {};

  /* L5 reports the org-chart source badge; ruling O4 folds it into the page
   * header "Live API" pill. */
  FD.shell.setLiveApi = function (text) {};

  /* The page-header Refresh button: sessions + health + credits, today's three
   * loads (BEHAVIOUR §1). */
  FD.shell.refresh = function () {};

  /* A sidebar session row was picked. L3 decides tile vs full screen. */
  FD.shell.selectSession = function (host, name) {};

  /* ---- hooks L2 USES, always guarded (L3 owns the terminal engine) -------- */

  FD.shell._windows = function () {
    return (FD.screens && FD.screens.windows) || null;
  };
})(window);
