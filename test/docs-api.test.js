// /api/docs — the deck's index of what the operator's sessions wrote.
//
// The roots the sweep walks default to the operator's real home, so every test replaces
// them with FLEET_DOCS_ROOTS_JSON over a seeded temp tree: no test may read, or index,
// the operator's actual docs.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { tmpdir, hostsFile, load, unload } = require('./helpers');
const { dayOf, tsOf, kindOf, titleOf, projectOf, exportProjectOf, localDay } = require('../docs-index');

// Sibling worktrees run this file at the same time, so the band is per process.
let port = 22000 + Math.floor(Math.random() * 15000);

const SESSION_A = '6f2b3c1e-1111-4222-8333-944444444444';
const SESSION_B = '7a3c4d2f-2222-4333-8444-955555555555';
const CWD_A = '-Users-x-projects-lowcap-connector';
const CWD_B = '-Users-x-remote-system--claude-worktrees-foo-1a2b3c';

// Fixed times today, so the sort order is the file's and not the clock's.
const now = new Date();
const at = (h) => new Date(now.getFullYear(), now.getMonth(), now.getDate(), h).getTime();
const TODAY = localDay(Date.now());

// One exports root and one scratchpad root, with the two files that must be skipped.

// A real .md under a dot-directory that no root sweeps: what add() must refuse.
function hiddenDoc(name = 'notes.md') {
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'fd-hidden-')), '.secrets');
  fs.mkdirSync(dir);
  const file = path.join(dir, name);
  fs.writeFileSync(file, '# not a doc\n');
  return file;
}

function seedTree() {
  const dir = tmpdir('docs');
  const write = (rel, text, mtime) => {
    const file = path.join(dir, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
    if (mtime) fs.utimesSync(file, new Date(mtime), new Date(mtime));
    return file;
  };
  const files = {
    eli5: write(
      'exports/eli5-explainers/2026-09-07_eli5-market-walk.html',
      '<!doctype html><html><head><title>ELI5 · market walk</title></head><body>x</body></html>'
    ),
    unblock: write(
      `scratch/${CWD_A}/${SESSION_A}/scratchpad/portal-unblock-sheet.html`,
      '<html><body><h1>no title element here</h1></body></html>',
      at(9)
    ),
    notes: write(`scratch/${CWD_B}/${SESSION_B}/scratchpad/notes.md`, '# Notes for the deck\n\nbody\n', at(10)),
    // Under the exports root the folder is the only evidence of the repo: a named one, and a
    // shared bucket whose leaf still names one.
    digest: write('exports/lowcap-connector/sessions-2026-09-08-1010.md', '# Sessions on the 8th\n'),
    board: write('exports/goals/board-remote-system.html', '<title>Goals board</title>', at(8)),
  };
  write('exports/fixture.html', '<title>a visual-diff fixture</title>');
  write('exports/node_modules/x.html', '<title>vendored</title>');
  write('exports/secrets-form.html', '<title>Secrets form</title>');
  // Not under <encoded cwd>/<uuid>/scratchpad: a tool's own scratch, not an operator doc.
  write(`scratch/${CWD_A}/not-a-uuid/scratchpad/stray.md`, '# stray\n');
  return { dir, files, roots: [
    { dir: path.join(dir, 'exports'), source: 'exports' },
    { dir: path.join(dir, 'scratch'), source: 'scratchpad' },
  ] };
}

// One deck per test, on its own port and db, sweeping only the seeded tree. ssh is the fake
// one: this route never shells out, but a real ssh to the fleet would both reach the
// operator's machines and keep the test process alive.
function deck(t, tree) {
  const dir = tmpdir('docs-deck');
  const PORT = port++;
  const state = path.join(dir, 'ssh.json');
  fs.writeFileSync(state, JSON.stringify({ hosts: {}, calls: [] }));
  const m = load(
    {
      PORT,
      FLEET_DB: path.join(dir, 'fleet.db'),
      FLEET_HOSTS_FILE: hostsFile(dir),
      FLEET_SSH_BIN: path.join(__dirname, 'fake-ssh.js'),
      FLEET_FAKE_SSH_STATE: state,
      FLEET_DOCS_ROOTS_JSON: JSON.stringify(tree.roots),
    },
    { listen: true }
  );
  t.after(() => unload(m));
  const base = 'http://127.0.0.1:' + PORT;
  const read = async (r) => ({ status: r.status, body: await r.json().catch(() => null) });
  return {
    m,
    origin: base,
    get: (q = '') => fetch(base + '/api/docs' + q).then(read),
    open: (q) => fetch(base + '/api/docs/open' + q),
    post: (b, headers = {}) =>
      fetch(base + '/api/docs', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify(b),
      }).then(read),
  };
}

const tailnetGet = (m, p) =>
  new Promise((resolve) => {
    const res = {
      statusCode: 0,
      writeHead(code) { this.statusCode = code; },
      end(data) { resolve({ status: this.statusCode, text: data || '' }); },
    };
    m.tailnetHandler({ method: 'GET', url: p, headers: { host: process.env.FLEET_TAILNET_HOST } }, res);
  });

// --- the pure helpers

test('the day comes from the file name when it has one, and the last one wins', () => {
  const mtime = at(9);
  assert.equal(dayOf('2026-09-07_eli5-market-walk.html', mtime), '2026-09-07');
  assert.equal(dayOf('2026-09-01-summary-2026-09-07.md', mtime), '2026-09-07', 'a checkout mtime cannot beat the name');
  assert.equal(dayOf('notes.md', mtime), TODAY, 'no date in the name: the mtime day');
});

test('the sort key is the mtime inside its own day, and noon in a day the mtime contradicts', () => {
  assert.equal(tsOf('notes.md', at(10)), at(10));
  assert.equal(tsOf('2026-09-07_eli5-market-walk.html', at(10)), new Date(2026, 8, 7, 12).getTime());
});

test('the kind is read off the path, with the extension as the fallback', () => {
  assert.equal(kindOf('/x/eli5-explainers/a.html', 'exports'), 'eli5');
  assert.equal(kindOf('/x/y/portal-unblock-sheet.html', 'scratchpad'), 'unblock');
  assert.equal(kindOf('/x/goals/board.md', 'exports'), 'goals');
  assert.equal(kindOf('/x/summary/2026-09-07/a.md', 'exports'), 'session');
  assert.equal(kindOf('/x/remote-system/sessions-2026-09-07.md', 'exports'), 'session');
  assert.equal(kindOf('/r/docs/reports/a.md', 'repo'), 'report');
  assert.equal(kindOf('/r/docs/research/a.md', 'repo'), 'research');
  assert.equal(kindOf('https://claude.ai/public/artifacts/abc', 'hook'), 'artifact');
  assert.equal(kindOf('/x/y/notes.md', 'scratchpad'), 'md');
  assert.equal(kindOf('/x/y/page.html', 'scratchpad'), 'html');
});

test('the title is the html <title>, the first md heading, or the name made readable', () => {
  assert.equal(titleOf('/x/a.html', '<head><title>ELI5 &amp; the market\n  walk</title></head>'), 'ELI5 & the market walk');
  assert.equal(titleOf('/x/a.md', '# Notes for the deck\n\nbody'), 'Notes for the deck');
  assert.equal(titleOf('/x/2026-09-07_eli5-market-walk.html', '<html>no title</html>'), 'eli5 market walk');
  assert.equal(titleOf('/x/portal-unblock-sheet.html', ''), 'portal unblock sheet');
});

test('under the exports root the folder names the repo, and a shared bucket names none', () => {
  assert.equal(exportProjectOf('lowcap-connector/sessions-x.md'), 'lowcap-connector');
  assert.equal(exportProjectOf('eli5-explainers/x.html'), null);
  assert.equal(exportProjectOf('goals/board-remote-system.html'), 'remote-system');
  assert.equal(exportProjectOf('summary/2026-09-04-1428-fleetdeck/a.md'), 'fleetdeck');
  assert.equal(exportProjectOf('unblock-sheets/x.html'), null);
});

test('the project is decoded from the tmp directory name, worktree tail dropped', () => {
  assert.equal(projectOf(CWD_A), 'lowcap-connector');
  assert.equal(projectOf(CWD_B), 'remote-system');
  assert.equal(projectOf('-Users-misterislez-remote-system'), 'remote-system');
  assert.equal(projectOf('nonsense'), null);
});

// --- the swept list

test('a refreshed GET lists every swept doc newest first, with its session and project', async (t) => {
  const tree = seedTree();
  const { status, body } = await deck(t, tree).get('?refresh=1');
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.docs.length, 5, 'the fixture, the node_modules copy and the secrets form are not docs');
  assert.equal(body.total, 5, 'the filtered count travels with the capped list');
  assert.deepEqual(body.docs.map((d) => d.title),
    ['Notes for the deck', 'portal unblock sheet', 'Goals board', 'Sessions on the 8th', 'ELI5 · market walk']);

  const [notes, unblock, board, digest, eli5] = body.docs;
  assert.deepEqual(
    { kind: notes.kind, day: notes.day, ts: notes.ts, session: notes.session, cwd: notes.cwd, project: notes.project, source: notes.source },
    { kind: 'md', day: TODAY, ts: at(10), session: SESSION_B, cwd: CWD_B, project: 'remote-system', source: 'scratchpad' }
  );
  assert.deepEqual(
    { kind: unblock.kind, day: unblock.day, session: unblock.session, project: unblock.project },
    { kind: 'unblock', day: TODAY, session: SESSION_A, project: 'lowcap-connector' }
  );
  assert.deepEqual(
    { kind: eli5.kind, day: eli5.day, session: eli5.session, project: eli5.project, source: eli5.source },
    { kind: 'eli5', day: '2026-09-07', session: null, project: null, source: 'exports' }
  );
  assert.deepEqual(
    { kind: digest.kind, project: digest.project, source: digest.source },
    { kind: 'session', project: 'lowcap-connector', source: 'exports' },
    'the first folder under the exports root is the repo'
  );
  assert.deepEqual(
    { kind: board.kind, project: board.project, source: board.source },
    { kind: 'goals', project: 'remote-system', source: 'exports' },
    'a shared bucket is not a repo, but board-<repo>.html names one'
  );
  assert.equal(eli5.path, tree.files.eli5);
  assert.ok(notes.size > 0 && Number.isInteger(notes.id));

  assert.deepEqual(body.days, [{ day: TODAY, n: 3 }, { day: '2026-09-08', n: 1 }, { day: '2026-09-07', n: 1 }]);
  assert.deepEqual(body.kinds, [{ kind: 'eli5', n: 1 }, { kind: 'goals', n: 1 }, { kind: 'md', n: 1 },
    { kind: 'session', n: 1 }, { kind: 'unblock', n: 1 }]);
  assert.deepEqual(body.sources, [{ source: 'exports', n: 3 }, { source: 'scratchpad', n: 2 }]);
  assert.ok(body.swept_at > 0);
  assert.equal(body.sweeping, false);
});

test('day and session are filters; the pickers keep offering every day and kind', async (t) => {
  const d = deck(t, seedTree());
  await d.get('?refresh=1');
  const day = await d.get('?day=2026-09-07');
  assert.deepEqual(day.body.docs.map((x) => x.kind), ['eli5']);
  assert.equal(day.body.days.length, 3, 'a day picker that hid the other days could never leave this one');

  const session = await d.get('?session=' + SESSION_A);
  assert.deepEqual(session.body.docs.map((x) => x.kind), ['unblock']);
  assert.deepEqual((await d.get('?kind=md')).body.docs.map((x) => x.title), ['Notes for the deck']);
  assert.deepEqual((await d.get('?q=market')).body.docs.map((x) => x.kind), ['eli5']);
  assert.equal((await d.get('?day=1999-01-01')).body.docs.length, 0);
});

test('source is a filter a leading dash negates, and a value that is not a source name is ignored', async (t) => {
  const d = deck(t, seedTree());
  await d.get('?refresh=1');
  assert.deepEqual((await d.get('?source=scratchpad')).body.docs.map((x) => x.kind), ['md', 'unblock']);
  assert.deepEqual((await d.get('?source=-scratchpad')).body.docs.map((x) => x.kind), ['goals', 'session', 'eli5'],
    'the operator hiding the scratchpads still sees the exports');
  assert.equal((await d.get('?source=bogus!')).body.docs.length, 5, 'not a source name: no filter at all');
  const facet = [{ source: 'exports', n: 3 }, { source: 'scratchpad', n: 2 }];
  assert.deepEqual((await d.get('?source=scratchpad')).body.sources, facet,
    'a source picker that hid the other sources could never leave this one');
});

test('project is an exact filter, and the picker keeps offering every project', async (t) => {
  const d = deck(t, seedTree());
  await d.get('?refresh=1');
  assert.deepEqual((await d.get('?project=lowcap-connector')).body.docs.map((x) => x.kind), ['unblock', 'session'],
    'the scratchpad cwd and the exports folder name the same repo');
  assert.equal((await d.get('?project=nope')).body.docs.length, 0);
  assert.equal((await d.get('?project=bad!')).body.docs.length, 5, 'not a project name: no filter at all');
  const facet = [{ project: 'lowcap-connector', n: 2 }, { project: 'remote-system', n: 2 }];
  assert.deepEqual((await d.get('?project=lowcap-connector')).body.projects, facet,
    'a project picker that hid the other projects could never leave this one');
});

test('the tailnet listener has no /api/docs at all', async (t) => {
  const d = deck(t, seedTree());
  assert.equal((await d.get('?refresh=1')).status, 200, 'the same deck answers on loopback');
  assert.equal((await tailnetGet(d.m, '/api/docs')).status, 404, 'a box worker must not read the operator docs');
  assert.equal((await tailnetGet(d.m, '/api/docs/open?id=1')).status, 404);
});

// --- the hook's POST

test('a POST registers an Artifact URL and a local file, and both list as source hook', async (t) => {
  const tree = seedTree();
  const d = deck(t, tree);
  const file = path.join(tree.dir, 'hook', 'REPORT-lane1.md');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '# Lane 1 report\n');

  const url = await d.post({
    url: 'https://claude.ai/public/artifacts/abc-123',
    title: 'The unblock sheet',
    kind: 'artifact',
    session: SESSION_A,
    cwd: CWD_A,
  });
  assert.equal(url.status, 200);
  assert.deepEqual(
    { ...url.body.doc, id: 0, ts: 0 },
    {
      id: 0, ts: 0, path: 'https://claude.ai/public/artifacts/abc-123', title: 'The unblock sheet',
      kind: 'artifact', day: TODAY, session: SESSION_A, cwd: CWD_A, project: 'lowcap-connector',
      source: 'hook', size: null,
    }
  );

  const local = await d.post({ path: file, session: SESSION_B, cwd: CWD_B });
  assert.equal(local.status, 200);
  assert.equal(local.body.doc.title, 'Lane 1 report', 'the first md heading is the title');
  assert.equal(local.body.doc.kind, 'md', 'nothing in the path says report, so the extension decides');
  assert.equal(local.body.doc.project, 'remote-system');

  // A sweep that never saw either of them must not retire them.
  const list = await d.get('?refresh=1');
  assert.equal(list.body.docs.length, 7);
  const hooks = list.body.docs.filter((x) => x.source === 'hook');
  assert.equal(hooks.length, 2, 'no root covers a hook row, so the sweep has no evidence against it');
});

test('a POST with a bad body is a 400 that says why, and a foreign Origin is a 403', async (t) => {
  const d = deck(t, seedTree());
  const cases = [
    [{}, /exactly one of path or url/],
    [{ path: '/x/a.md', url: 'https://claude.ai/a' }, /exactly one of path or url/],
    [{ path: 'relative/a.md' }, /must be absolute/],
    [{ path: '/etc/passwd' }, /\.html or \.md/],
    [{ path: '/nope/gone-' + Date.now() + '.md' }, /does not exist/],
    [{ url: 'http://claude.ai/a' }, /https:\/\//],
    [{ url: 'https://claude.ai/a', kind: 'invoice' }, /unknown kind/],
    [{ path: hiddenDoc() }, /hidden directory/],
    [{ path: hiddenDoc('secrets-form.html') }, /never indexed/],
  ];
  for (const [payload, message] of cases) {
    const r = await d.post(payload);
    assert.equal(r.status, 400, JSON.stringify(payload));
    assert.equal(r.body.ok, false);
    assert.match(r.body.error, message);
  }
  const foreign = await d.post({ url: 'https://claude.ai/a' }, { origin: 'http://evil.example' });
  assert.equal(foreign.status, 403);
  assert.equal((await d.post({ url: 'https://claude.ai/a' }, { origin: d.origin })).status, 200, 'the deck page may post');
});

// --- open

test('open serves the indexed file by id, and nothing else', async (t) => {
  const d = deck(t, seedTree());
  const { body } = await d.get('?refresh=1');
  const eli5 = body.docs.find((x) => x.kind === 'eli5');
  const notes = body.docs.find((x) => x.kind === 'md');

  const html = await d.open('?id=' + eli5.id);
  assert.equal(html.status, 200);
  assert.equal(html.headers.get('content-type'), 'text/html; charset=utf-8');
  assert.match(await html.text(), /market walk/);

  const md = await d.open('?id=' + notes.id);
  assert.equal(md.headers.get('content-type'), 'text/markdown; charset=utf-8');

  const artifact = await d.post({ url: 'https://claude.ai/public/artifacts/abc-123', kind: 'artifact' });
  assert.equal((await d.open('?id=' + artifact.body.doc.id)).status, 404, 'an Artifact URL has no file to serve');
  assert.equal((await d.open('?id=99999')).status, 404);
  assert.equal((await d.open('?id=nope')).status, 404);
  assert.equal((await d.open('')).status, 404);
});

// --- retirement

test('a deleted file leaves the list on the next refresh', async (t) => {
  const tree = seedTree();
  const d = deck(t, tree);
  assert.equal((await d.get('?refresh=1')).body.docs.length, 5);
  fs.rmSync(tree.files.notes);
  const stale = await d.get();
  assert.equal(stale.body.docs.length, 5, 'a plain GET inside the TTL answers from the table');
  const fresh = await d.get('?refresh=1');
  assert.deepEqual(fresh.body.docs.map((x) => x.kind), ['unblock', 'goals', 'session', 'eli5']);
  assert.deepEqual(fresh.body.days, [{ day: TODAY, n: 2 }, { day: '2026-09-08', n: 1 }, { day: '2026-09-07', n: 1 }]);
});
