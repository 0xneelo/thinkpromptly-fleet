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
    'unblock',
    'desktop',
  ]);
  const DEFAULT_VIEW = 'app'; // inside /v2/; '/' becomes the landing page in L11
  const DEFAULT_SCREEN = 'windows';

  // Every location read is guarded so the module can be required under Node.
  const loc = () => (typeof root.location === 'object' ? root.location : null);

  // `#screen?a=b`: the screen owns whatever follows its name, so one sheet, one row or one
  // window can have a URL of its own without a second query string. A screen that asks for
  // nothing reads an empty params object.
  function hashParts(hash) {
    const raw = String(hash || '').replace(/^#/, '');
    const cut = raw.indexOf('?');
    return cut < 0 ? [raw, ''] : [raw.slice(0, cut), raw.slice(cut + 1)];
  }

  function route() {
    const here = loc();
    const view = new URLSearchParams((here && here.search) || '').get('view');
    const [screen, query] = hashParts(here && here.hash);
    const params = {};
    new URLSearchParams(query).forEach((v, k) => { params[k] = v; });
    const known = SCREENS.includes(screen);
    return {
      view: VIEWS.includes(view) ? view : DEFAULT_VIEW,
      screen: known ? screen : DEFAULT_SCREEN,
      // An unknown screen's params die with it: the default screen must not inherit a stranger's params.
      params: known ? params : {},
    };
  }

  function query(params) {
    const q = new URLSearchParams();
    Object.keys(params || {}).forEach((k) => {
      const v = params[k];
      if (v !== null && v !== undefined && v !== '') q.set(k, String(v));
    });
    const s = q.toString();
    return s ? '?' + s : '';
  }

  function navigate(screen, params) {
    if (!SCREENS.includes(screen)) throw new Error('unknown screen: ' + screen);
    const here = loc();
    const hash = screen + query(params);
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

  // The params are part of the route: moving from one sheet to the next changes nothing else,
  // and a subscriber that never saw it would keep painting the sheet before it.
  const key = (r) =>
    r.view + '\0' + r.screen + '\0' +
    Object.keys(r.params).sort().map((k) => k + '=' + r.params[k]).join('&');

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
