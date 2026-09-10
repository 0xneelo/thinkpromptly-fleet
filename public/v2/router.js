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
    'goals',
    'docs',
    'desktop',
  ]);
  const DEFAULT_VIEW = 'app'; // inside /v2/; '/' becomes the landing page in L11
  const DEFAULT_SCREEN = 'windows';

  // Every location read is guarded so the module can be required under Node.
  const loc = () => (typeof root.location === 'object' ? root.location : null);

  // A screen may carry filters: '#docs?session=<uuid>&day=2026-09-10'. They live on the
  // hash so a filtered screen is a link the operator can copy, and so a param-only change
  // never touches the query string the view is read from.
  function params(search) {
    const out = {};
    new URLSearchParams(search).forEach(function (v, k) { out[k] = v; });
    return out;
  }

  function route() {
    const here = loc();
    const view = new URLSearchParams((here && here.search) || '').get('view');
    const hash = String((here && here.hash) || '').replace(/^#/, '');
    const cut = hash.indexOf('?');
    const screen = cut < 0 ? hash : hash.slice(0, cut);
    const known = SCREENS.includes(screen);
    return {
      view: VIEWS.includes(view) ? view : DEFAULT_VIEW,
      screen: known ? screen : DEFAULT_SCREEN,
      // An unknown screen's params die with it: the default screen must not inherit them.
      params: known && cut >= 0 ? params(hash.slice(cut + 1)) : {},
    };
  }

  // Sorted, so the same filters in another key order are the same hash and the same key().
  const query = (p) => new URLSearchParams(Object.keys(p || {}).sort().map((k) => [k, p[k]])).toString();

  function navigate(screen, p) {
    if (!SCREENS.includes(screen)) throw new Error('unknown screen: ' + screen);
    const q = query(p);
    const hash = screen + (q ? '?' + q : '');
    const here = loc();
    if (here) {
      const history = root.history;
      // pushState keeps programmatic navigation and popstate on one path; the
      // hash fallback fires hashchange instead, which emit() de-duplicates.
      if (history && typeof history.pushState === 'function') {
        history.pushState(null, '', here.pathname + here.search + '#' + hash);
      } else {
        here.hash = hash;
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

  // The params are part of the key: changing a filter and nothing else still has to emit.
  const key = (r) => r.view + '\0' + r.screen + '\0' + query(r.params);

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
