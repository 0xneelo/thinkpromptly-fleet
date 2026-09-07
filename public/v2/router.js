// The v2 URL scheme: view on the query string, screen on the hash. No DOM
// listeners exist until something subscribes, and nothing here touches a template.
(function (root, factory) {
  const api = factory(root);
  root.FD = root.FD || {};
  root.FD.router = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof globalThis === 'object' ? globalThis : this, function (root) {
  const VIEWS = Object.freeze(['land', 'app', 'deck']);
  const SCREENS = Object.freeze([
    'windows',
    'org',
    'registry',
    'bus',
    'keys',
    'accounts',
    'machines',
    'desktop',
  ]);
  const DEFAULT_VIEW = 'app'; // inside /v2/; '/' becomes the landing page in L11
  const DEFAULT_SCREEN = 'windows';

  // Every location read is guarded so the module can be required under Node.
  const loc = () => (typeof root.location === 'object' ? root.location : null);

  function route() {
    const here = loc();
    const view = new URLSearchParams((here && here.search) || '').get('view');
    const screen = String((here && here.hash) || '').replace(/^#/, '');
    return {
      view: VIEWS.includes(view) ? view : DEFAULT_VIEW,
      screen: SCREENS.includes(screen) ? screen : DEFAULT_SCREEN,
    };
  }

  function navigate(screen) {
    if (!SCREENS.includes(screen)) throw new Error('unknown screen: ' + screen);
    const here = loc();
    if (here) {
      const history = root.history;
      // pushState keeps programmatic navigation and popstate on one path; the
      // hash fallback fires hashchange instead, which emit() de-duplicates.
      if (history && typeof history.pushState === 'function') {
        history.pushState(null, '', here.pathname + here.search + '#' + screen);
      } else {
        here.hash = screen;
      }
    }
    emit();
    return route();
  }

  const subscribers = new Set();
  let last = null;
  const listener = () => emit();

  function onChange(cb) {
    if (typeof cb !== 'function') throw new TypeError('onChange needs a function');
    if (!subscribers.size) {
      last = key(route());
      addListeners();
    }
    subscribers.add(cb);
    return () => {
      subscribers.delete(cb);
      if (!subscribers.size) removeListeners();
    };
  }

  const key = (r) => r.view + '\0' + r.screen;

  // One user action can produce both a popstate and a hashchange; subscribers
  // only ever see a route that differs from the one they last saw.
  function emit() {
    const next = route();
    if (key(next) === last) return;
    last = key(next);
    for (const cb of subscribers) cb(next);
  }

  function addListeners() {
    if (typeof root.addEventListener !== 'function') return;
    root.addEventListener('popstate', listener);
    root.addEventListener('hashchange', listener);
  }

  function removeListeners() {
    if (typeof root.removeEventListener !== 'function') return;
    root.removeEventListener('popstate', listener);
    root.removeEventListener('hashchange', listener);
  }

  return { VIEWS, SCREENS, route, navigate, onChange };
});
