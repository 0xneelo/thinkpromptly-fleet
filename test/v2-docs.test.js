// The Docs screen's pure half: the id and time formatting, how a row is opened, and which hash
// params count as filters. The DOM half is asserted by the pixel gate, which renders the fixture
// sample below.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

// data.js first, exactly as public/v2/index.html loads it: both files publish onto globalThis.FD.
require(path.join(ROOT, 'public/v2/data.js'));
const SOURCE = fs.readFileSync(path.join(ROOT, 'public/v2/screens/docs.js'), 'utf8');
const screen = require(path.join(ROOT, 'public/v2/screens/docs.js'));
const _ = screen._;

test('a session is named by the head of its uuid', () => {
  assert.strictEqual(_.shortId('6f2b3c1e-6b0e-4a41-9d2e-2f0c8a1b7d55'), '6f2b3c1e…');
  assert.strictEqual(_.shortId('short'), 'short', 'nothing to elide is left alone');
  assert.strictEqual(_.shortId(undefined), '', 'a row with no session still renders');
});

test('the time column is local wall-clock, from millis or an ISO string', () => {
  // Built from local components and read back the same way, so the assertion holds in any TZ.
  const noon = new Date(2026, 8, 10, 14, 5, 0);
  assert.strictEqual(_.fmtTime(noon.getTime()), '14:05');
  assert.strictEqual(_.fmtTime(noon.toISOString()), '14:05');
  assert.strictEqual(_.fmtTime(Math.floor(noon.getTime() / 1000)), '14:05', 'seconds are not 1970');
  assert.strictEqual(_.fmtTime('not a date'), '', 'an unparseable row shows no time, never NaN');
});

test('the sweep age reads in the largest unit that still says something', () => {
  assert.strictEqual(_.fmtAge(20 * 1000), 'just now');
  assert.strictEqual(_.fmtAge(2 * 60000), '2 min ago');
  assert.strictEqual(_.fmtAge(3 * 3600000), '3 h ago');
  assert.strictEqual(_.fmtAge(2 * 86400000), '2 d ago');
  assert.strictEqual(_.fmtAge(undefined), '');
});

test('an artifact opens at its own URL; every other row opens by id', () => {
  const artifact = { id: 'd1', kind: 'artifact', path: 'https://claude.ai/public/artifacts/1f0c8a1b' };
  assert.strictEqual(_.openHref(artifact), 'https://claude.ai/public/artifacts/1f0c8a1b');
  // The path never reaches the URL for a local file: the deck serves it by id only.
  assert.strictEqual(_.openHref({ id: 'd 2', kind: 'md', path: '/Users/operator/x.md' }), '/api/docs/open?id=d%202');
  assert.strictEqual(_.openHref(null), '/api/docs/open?id=');
});

test('only the filters this screen owns are read off the hash', () => {
  const params = { session: 'abc', day: '2026-09-10', kind: 'eli5', source: '-scratchpad', q: 'train', view: 'deck', evil: '1' };
  assert.deepStrictEqual(_.paramsOf({ params }),
    { session: 'abc', day: '2026-09-10', kind: 'eli5', source: '-scratchpad', q: 'train' });
  assert.deepStrictEqual(_.paramsOf({ params: { session: '  ', kind: 'md' } }), { kind: 'md' },
    'a cleared filter leaves the hash instead of naming itself empty');
  assert.deepStrictEqual(_.paramsOf(null), {}, 'no route is no filter, never a throw');
});

// A title comes from a file some session wrote, so it stays text. This screen has no innerHTML
// at all — every string becomes a text node.
test('a document title is never treated as markup', () => {
  const evil = '<img src=x onerror=alert(1)>';
  assert.strictEqual(_.safeText(evil), evil, 'the value is carried through unchanged, as text');
  assert.doesNotMatch(SOURCE, /innerHTML|outerHTML|insertAdjacentHTML|document\.write/,
    'docs.js must build the screen with createElement and textContent only');
});

test('the fixture sample is the deterministic screen the pixel gate renders', () => {
  const v = _.FIXTURE_VIEW;
  assert.strictEqual(v.docs.length, 6);
  assert.strictEqual(v.total, 6);
  assert.strictEqual(_.countText(v), '6 docs');
  assert.strictEqual(_.countText({ docs: v.docs, total: 593 }), '6 of 593 docs', 'a capped list says so');
  assert.strictEqual(new Set(v.docs.map((d) => d.session)).size, 2, 'two sessions');
  assert.deepStrictEqual(v.docs.map((d) => d.ts).slice().sort().reverse(), v.docs.map((d) => d.ts),
    'the list is newest first, like the API');
  const perDay = {};
  const perKind = {};
  for (const d of v.docs) {
    perDay[d.day] = (perDay[d.day] || 0) + 1;
    perKind[d.kind] = (perKind[d.kind] || 0) + 1;
  }
  assert.deepStrictEqual(v.days.map((d) => [d.day, d.n]), [['2026-09-10', 3], ['2026-09-09', 2], ['2026-09-08', 1]]);
  assert.deepStrictEqual(Object.fromEntries(v.days.map((d) => [d.day, d.n])), perDay, 'the day counts match the rows');
  assert.deepStrictEqual(Object.fromEntries(v.kinds.map((k) => [k.kind, k.n])), perKind, 'the kind counts match the rows');
  const perSource = {};
  for (const d of v.docs) perSource[d.source] = (perSource[d.source] || 0) + 1;
  assert.deepStrictEqual(Object.fromEntries(v.sources.map((x) => [x.source, x.n])), perSource,
    'the source counts match the rows the source picker filters');
  assert.strictEqual(v.sources.reduce((n, x) => n + x.n, 0), 6);
  assert.deepStrictEqual(v.kinds.map((k) => k.kind), ['artifact', 'eli5', 'md', 'report', 'session', 'unblock']);
});

// The hash carries the filters, so the router has to split them off the screen name. No
// test/*router*.test.js exists, so the param half is pinned here, next to its only caller.
test('the router reads and writes the filters on the hash', () => {
  const here = { pathname: '/app', search: '', hash: '' };
  globalThis.location = here;
  globalThis.history = { pushState: (_s, _t, url) => { here.hash = String(url).replace(/^[^#]*/, ''); } };
  const router = require(path.join(ROOT, 'public/v2/router.js'));

  here.hash = '#docs?session=abc';
  assert.strictEqual(router.route().screen, 'docs');
  assert.deepStrictEqual(router.route().params, { session: 'abc' });

  here.hash = '#docs';
  assert.deepStrictEqual(router.route().params, {}, 'no params is an empty object, never undefined');

  here.hash = '#nope?x=1';
  assert.strictEqual(router.route().screen, 'windows', 'an unknown screen falls back to the default');
  assert.deepStrictEqual(router.route().params, {}, 'and its params do not leak onto the default screen');

  // query() keeps insertion order, so the hash differs; the route it reads back does not.
  const a = router.navigate('docs', { session: 's', day: 'd' }).params;
  const b = router.navigate('docs', { day: 'd', session: 's' }).params;
  assert.deepStrictEqual(a, { session: 's', day: 'd' });
  assert.deepStrictEqual(b, a, 'the same filters in another order are the same route');

  router.navigate('docs', { session: 'abc' });
  assert.strictEqual(here.hash, '#docs?session=abc');
  router.navigate('docs');
  assert.strictEqual(here.hash, '#docs', 'no params writes no question mark');
});
