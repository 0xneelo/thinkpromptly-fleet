// L11 cut-over: the routes that replaced the old multi-page UI. The v2 shell reads
// its view from the query string only (public/v2/router.js:28), so each pretty path
// has to canonicalise itself into the query the router understands. These tests pin
// that mapping, the legacy 302s, and the fact that the deleted pages are really gone.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { startServer } = require('./http');

const ROOT = path.join(__dirname, '..');
const SHELL = fs.readFileSync(path.join(ROOT, 'public/v2/index.html'), 'utf8');

// One server for the whole file: every case here is a plain GET with no shared state.
// startServer picks a random port, and sibling worktrees run this suite at the same
// time, so a collision is normal rather than exceptional -- and here it would take all
// of the tests down with it instead of one. Retry a few times before giving up.
let srv;
test.before(async () => {
  let last;
  for (let attempt = 0; attempt < 5; attempt++) {
    try { srv = await startServer(); return; } catch (error) { last = error; }
  }
  throw last;
});
test.after(async () => { await srv.stop(); });

test('/app serves the v2 shell without a redirect', async () => {
  const r = await srv.get('/app');
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.text, SHELL, '/app serves public/v2/index.html verbatim');
});

test("/ redirects once to the landing view, then serves the shell", async () => {
  const r = await srv.get('/');
  assert.strictEqual(r.status, 302);
  assert.strictEqual(r.headers.location, '/?view=land');
  const landed = await srv.get(r.headers.location);
  assert.strictEqual(landed.status, 200);
  assert.strictEqual(landed.text, SHELL);
});

test('/deck redirects once to the deck view, then serves the shell', async () => {
  const r = await srv.get('/deck');
  assert.strictEqual(r.status, 302);
  assert.strictEqual(r.headers.location, '/deck?view=deck');
  const landed = await srv.get(r.headers.location);
  assert.strictEqual(landed.status, 200);
  assert.strictEqual(landed.text, SHELL);
});

test('a path and a view that disagree are corrected to the path', async () => {
  // The path is what the operator typed, so it wins over a stale query parameter.
  const r = await srv.get('/app?view=deck');
  assert.strictEqual(r.status, 302);
  assert.strictEqual(r.headers.location, '/app?view=app');
});

test('an unknown view falls back to the path, not to the router default', async () => {
  assert.strictEqual((await srv.get('/deck?view=nonsense')).headers.location, '/deck?view=deck');
});

test('every other query parameter survives the redirect', async () => {
  // Fixture mode is how the design gate drives these URLs; losing it would make the
  // landing view call the live API during a capture.
  const r = await srv.get('/?fixture=1');
  assert.strictEqual(r.status, 302);
  assert.strictEqual(r.headers.location, '/?fixture=1&view=land');
  assert.strictEqual((await srv.get(r.headers.location)).status, 200);
});

test('each old page URL becomes one hop to the screen that replaced it', async () => {
  const moved = {
    '/index.html': '/app#windows',
    '/keys.html': '/app#keys',
    '/accounts.html': '/app#accounts',
    '/machines.html': '/app#machines',
    '/sessions.html': '/app#desktop',
  };
  for (const [from, to] of Object.entries(moved)) {
    const r = await srv.get(from);
    assert.strictEqual(r.status, 302, from + ' redirects');
    assert.strictEqual(r.headers.location, to, from + ' -> ' + to);
  }
});

test('a repeated view parameter is first-wins, like the client router', async () => {
  // public/v2/router.js:28 reads it with URLSearchParams.get, which takes the first.
  // The server has to agree, or the redirect it sends disagrees with what the shell
  // then reads out of the URL it was sent to.
  assert.strictEqual((await srv.get('/app?view=deck&view=app')).headers.location, '/app?view=app');
  assert.strictEqual((await srv.get('/app?view=app&view=deck')).status, 200);
});

test('a page route answers reads only', async () => {
  // A POST falls through to the static handler, where the deleted page is a 404 --
  // it must not be served or redirected as though it were a GET.
  const r = await srv.post('/app', {});
  assert.strictEqual(r.status, 404);
  assert.strictEqual((await srv.post('/keys.html', {})).status, 404);
});

test('the old UI files are gone from disk, not merely unrouted', async () => {
  for (const gone of ['index.html', 'app.js', 'style.css', 'keys.html', 'keys.js',
    'accounts.html', 'accounts.js', 'machines.html', 'machines.js',
    'sessions.html', 'sessions.js', 'orgchart.js', 'v2/pass1']) {
    assert.ok(!fs.existsSync(path.join(ROOT, 'public', gone)), 'public/' + gone + ' is deleted');
  }
  // A deleted asset must 404 rather than resolve to something else.
  assert.strictEqual((await srv.get('/style.css')).status, 404);
  assert.strictEqual((await srv.get('/orgchart.js')).status, 404);
});

test('the design gate URL and the kept pages still work', async () => {
  assert.strictEqual((await srv.get('/v2/')).status, 200, '/v2/ is what the gate captures');
  assert.strictEqual((await srv.get('/v2/index.html')).status, 200);
  assert.strictEqual((await srv.get('/board.html')).status, 200, 'board.html is kept');
  assert.strictEqual((await srv.get('/orgchart-m11.fixture.json')).status, 200);
});

test('a page route never shadows the API', async () => {
  // The routes live at the end of the same try block, so this pins the ordering.
  const r = await srv.get('/api/health');
  assert.strictEqual(r.status, 200);
  assert.ok(r.body && typeof r.body === 'object', '/api/health still answers JSON');
});
