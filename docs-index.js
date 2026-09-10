// The deck's docs index: every .html/.md an operator session leaves behind -- artifacts,
// ELI5 explainers, unblock sheets, session summaries, reports -- in one table, listable by
// day and by session. Two writers: a TTL-guarded sweep over known roots (the collector
// shape desktop-sessions.js uses), and add() for the PostToolUse hook, which registers a
// doc the moment it is written and is the only source that can hold a published Artifact
// URL, since that has no file to sweep.
const fs = require('fs');
const os = require('os');
const path = require('path');

const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const isUuid = (s) => typeof s === 'string' && UUID.test(s);
const DAY = /\d{4}-\d\d-\d\d/g;
const EXT = new Set(['.html', '.md']);
const KINDS = new Set(['artifact', 'eli5', 'unblock', 'goals', 'session', 'report', 'research', 'html', 'md']);
// A build output tree, a vendored copy or a visual-diff baseline is not an operator doc.
const SKIP_DIRS = new Set(['node_modules', '.git', 'vendor', 'verify', 'mock', 'baseline', 'fixtures']);
// secrets-form: the operator's standing rule from the lowcap docs hub — never served, by any deck.
const SKIP_NAME = /fixture|secrets-form|\.dc\.html$/i;
const MAX_BYTES = 8 * 1024 * 1024;
const HEAD_BYTES = 8192;
const MAX_DEPTH = 8;
// Both the row projection a reader sees and the row add() returns. seen_at/gone are the
// sweep's own bookkeeping and stay inside.
const COLS = 'id, path, title, kind, day, ts, session, cwd, project, source, size';

const text = (v, n) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : null);

function localDay(ms) {
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

// A checkout rewrites mtimes, so a date in the file name is the stronger evidence of when
// the doc was made. The LAST one wins: `2026-09-01-sessions-2026-09-07.md` is a doc about
// the 7th, written on the 7th.
function dayOf(name, mtimeMs) {
  const found = String(name).match(DAY);
  return found ? found[found.length - 1] : localDay(mtimeMs);
}

// The sort key. mtime is the precise time when it agrees with the name's day; otherwise it
// is evidence about a checkout, not about the doc, and noon keeps the row inside its day.
function tsOf(name, mtimeMs) {
  const day = dayOf(name, mtimeMs);
  if (localDay(mtimeMs) === day) return Math.round(mtimeMs);
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d, 12).getTime();
}

function kindOf(p, source) {
  const s = String(p).toLowerCase();
  if (s.includes('/eli5')) return 'eli5';
  if (s.includes('unblock')) return 'unblock';
  if (s.includes('/goals/') || s.includes('board-')) return 'goals';
  if (s.includes('/summary/') || s.includes('/sessions-')) return 'session';
  if (s.includes('/docs/reports/')) return 'report';
  if (s.includes('/docs/research/')) return 'research';
  if (s.startsWith('https://')) return 'artifact';
  return path.extname(s) === '.html' ? 'html' : 'md';
}

const ENTITIES = { '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&amp;': '&' };

function titleOf(p, head = '') {
  const ext = path.extname(p).toLowerCase();
  const body = String(head).slice(0, HEAD_BYTES);
  if (ext === '.html') {
    const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(body);
    // &amp; last, so a literal `&amp;lt;` does not decode twice.
    const t = m && m[1].replace(/&lt;|&gt;|&quot;|&#39;|&amp;/g, (e) => ENTITIES[e]).replace(/\s+/g, ' ').trim();
    if (t) return t.slice(0, 1000);
  } else if (ext === '.md') {
    const m = /^#[ \t]+(.+)$/m.exec(body);
    if (m) return m[1].replace(/\s+/g, ' ').trim().slice(0, 1000);
  }
  const name = path.basename(p, ext).replace(/^\d{4}-\d\d-\d\d[-_]?/, '').replace(/[-_]+/g, ' ').trim();
  return (name || path.basename(p)).slice(0, 1000);
}

// `-Users-misterislez-remote-system--claude-worktrees-fleetdeck-docs-89b48e` -> remote-system
// `-Users-x-projects-lowcap-connector` -> lowcap-connector
// Best effort: the encoding is lossy (a `-` in a directory name is indistinguishable from
// a separator), so a miss is a null project, never a wrong one that filters wrongly.
function projectOf(encoded) {
  if (typeof encoded !== 'string') return null;
  const s = encoded.replace(/--claude-worktrees-.*$/, '');
  const at = s.lastIndexOf('-projects-');
  if (at >= 0) return s.slice(at + 10) || null;
  const m = /^-Users-[^-]+-(.+)$/.exec(s);
  return m ? m[1] : null;
}

// The sweep's roots. FLEET_DOCS_ROOTS_JSON replaces them outright (the test seam -- the
// defaults point at the operator's real home); FLEET_DOCS_ROOTS adds repo dirs.
function defaultRoots(home = os.homedir()) {
  if (process.env.FLEET_DOCS_ROOTS_JSON)
    try {
      const parsed = JSON.parse(process.env.FLEET_DOCS_ROOTS_JSON);
      if (Array.isArray(parsed)) return parsed.filter((r) => r && typeof r.dir === 'string' && typeof r.source === 'string');
    } catch (e) {
      return [];
    }
  const project = path.basename(__dirname);
  return [
    { dir: path.join(home, '.claude', 'session-exports'), source: 'exports' },
    { dir: '/private/tmp/claude-501', source: 'scratchpad' },
    ...['reports', 'research', 'unblocks'].map((d) => ({ dir: path.join(__dirname, 'docs', d), source: 'repo', project })),
    ...(process.env.FLEET_DOCS_ROOTS || '').split(':').filter(Boolean)
      .map((dir) => ({ dir, source: 'repo', project: path.basename(dir) })),
  ];
}

// A root that is not on this machine, or a directory that cannot be read, is not an error:
// the index is a best-effort mirror of what happens to be there.
async function walk(dir, depth = MAX_DEPTH, out = []) {
  let entries;
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true });
  } catch (e) {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (depth > 0 && !SKIP_DIRS.has(entry.name)) await walk(full, depth - 1, out);
    } else if (entry.isFile() && EXT.has(path.extname(entry.name).toLowerCase()) && !SKIP_NAME.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

// The scratchpad root is `<encoded cwd>/<session uuid>/scratchpad/...`, and only that:
// everything else under /private/tmp/claude-501 is a subagent's or a tool's own scratch.
// The two path segments are the only place the deck learns which session wrote a doc.
async function scratchpadFiles(root) {
  const found = [];
  let cwds;
  try {
    cwds = await fs.promises.readdir(root, { withFileTypes: true });
  } catch (e) {
    return found;
  }
  for (const cwd of cwds) {
    if (!cwd.isDirectory()) continue;
    let sessions;
    try {
      sessions = await fs.promises.readdir(path.join(root, cwd.name), { withFileTypes: true });
    } catch (e) {
      continue;
    }
    for (const session of sessions) {
      if (!session.isDirectory() || !isUuid(session.name)) continue;
      const dir = path.join(root, cwd.name, session.name, 'scratchpad');
      for (const file of await walk(dir, 3))
        found.push({ file, session: session.name.toLowerCase(), cwd: cwd.name, project: projectOf(cwd.name) });
    }
  }
  return found;
}

function headSync(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(HEAD_BYTES);
    return buf.subarray(0, fs.readSync(fd, buf, 0, HEAD_BYTES, 0)).toString('utf8');
  } finally {
    fs.closeSync(fd);
  }
}

async function head(file) {
  const fh = await fs.promises.open(file, 'r');
  try {
    const buf = Buffer.alloc(HEAD_BYTES);
    const { bytesRead } = await fh.read(buf, 0, HEAD_BYTES, 0);
    return buf.subarray(0, bytesRead).toString('utf8');
  } finally {
    await fh.close();
  }
}

class DocsIndex {
  constructor({ db, roots, clock = Date.now, ttl = 300000 }) {
    this.db = db;
    this.roots = Array.isArray(roots) ? roots : [];
    this.clock = clock;
    this.ttl = ttl;
    this.at = null;
    this.inflight = null;
    db.exec(`CREATE TABLE IF NOT EXISTS docs (
      id INTEGER PRIMARY KEY,
      path TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      kind TEXT NOT NULL,
      day TEXT NOT NULL,
      ts INTEGER NOT NULL,
      session TEXT,
      cwd TEXT,
      project TEXT,
      source TEXT NOT NULL,
      size INTEGER,
      seen_at INTEGER NOT NULL,
      gone INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS docs_day ON docs(day);
    CREATE INDEX IF NOT EXISTS docs_session ON docs(session)`);
    // kind and source are the first writer's: a hook knows a doc is an artifact, and a
    // later sweep of the same file must not demote it to plain html. session/cwd/project
    // survive a sweep that found the file without knowing who wrote it.
    this.put = db.prepare(`INSERT INTO docs (path, title, kind, day, ts, session, cwd, project, source, size, seen_at, gone)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
      ON CONFLICT(path) DO UPDATE SET title=excluded.title, size=excluded.size, ts=excluded.ts,
        day=excluded.day, seen_at=excluded.seen_at, gone=0,
        session=COALESCE(excluded.session, docs.session),
        cwd=COALESCE(excluded.cwd, docs.cwd),
        project=COALESCE(excluded.project, docs.project)`);
    this.byPath = db.prepare(`SELECT ${COLS} FROM docs WHERE path = ?`);
    this.byId = db.prepare('SELECT * FROM docs WHERE id = ?');
    this.stale = db.prepare("UPDATE docs SET gone = 1 WHERE source != 'hook' AND seen_at < ?");
    this.hooks = db.prepare("SELECT id, path FROM docs WHERE source = 'hook' AND gone = 0");
    this.markGone = db.prepare('UPDATE docs SET gone = 1 WHERE id = ?');
    this.days = db.prepare('SELECT day, COUNT(*) AS n FROM docs WHERE gone = 0 GROUP BY day ORDER BY day DESC');
    this.kinds = db.prepare('SELECT kind, COUNT(*) AS n FROM docs WHERE gone = 0 GROUP BY kind ORDER BY kind');
    this.sources = db.prepare('SELECT source, COUNT(*) AS n FROM docs WHERE gone = 0 GROUP BY source ORDER BY source');
  }

  async sweep(force = false) {
    // A forced refresh joins a running sweep rather than starting a second one; the TTL is
    // what keeps a page load off the filesystem.
    if (this.inflight) return this.inflight;
    if (!force && this.at !== null && this.clock() - this.at < this.ttl) return;
    this.inflight = this.run(this.clock());
    try {
      await this.inflight;
      // Stamped only on success: a sweep that failed halfway must not count as fresh.
      this.at = this.clock();
    } finally {
      this.inflight = null;
    }
  }

  async run(started) {
    for (const root of this.roots) {
      const found = root.source === 'scratchpad'
        ? await scratchpadFiles(root.dir)
        : (await walk(root.dir)).map((file) => ({ file, session: null, cwd: null, project: root.project || null }));
      for (const doc of found) {
        let st;
        try {
          st = await fs.promises.stat(doc.file);
        } catch (e) {
          continue; // written and removed inside one sweep
        }
        if (!st.isFile() || st.size > MAX_BYTES) continue;
        const name = path.basename(doc.file);
        let title;
        try {
          title = titleOf(doc.file, await head(doc.file));
        } catch (e) {
          continue;
        }
        this.put.run(doc.file, title, kindOf(doc.file, root.source), dayOf(name, st.mtimeMs),
          tsOf(name, st.mtimeMs), doc.session, doc.cwd, doc.project, root.source, st.size, started);
      }
    }
    // Anything a root should have offered and did not is gone. Hook rows are exempt: no
    // root covers them, so the sweep has no evidence about them beyond the file itself,
    // and a published Artifact URL has no file at all and never goes.
    this.stale.run(started);
    for (const row of this.hooks.all())
      if (!row.path.startsWith('https://') && !fs.existsSync(row.path)) this.markGone.run(row.id);
  }

  // One doc a hook (or a POST) registers by hand. Throws on bad input; the route turns the
  // message into a 400.
  add(doc) {
    const d = doc && typeof doc === 'object' ? doc : {};
    const p = typeof d.path === 'string' ? d.path : null;
    const url = typeof d.url === 'string' ? d.url : null;
    if (!p === !url) throw new Error('exactly one of path or url is required');
    let target = url, size = null, at = null, first = '';
    if (p) {
      if (!path.isAbsolute(p)) throw new Error('path must be absolute');
      if (!EXT.has(path.extname(p).toLowerCase())) throw new Error('path must be a .html or .md file');
      if (SKIP_NAME.test(path.basename(p))) throw new Error('that file is never indexed');
      let st;
      try {
        st = fs.statSync(p);
      } catch (e) {
        throw new Error('path does not exist');
      }
      if (!st.isFile()) throw new Error('path does not exist');
      if (st.size > MAX_BYTES) throw new Error('file is too large to index');
      // The open route serves whatever is stored, so the stored path is the real one, and a
      // file hidden under a dot-directory (~/.ssh, .secrets, ~/.claude/*.json) is refused
      // unless a swept root owns it — ~/.claude/session-exports is one.
      const real = fs.realpathSync(p);
      const roots = this.roots.map((r) => { try { return fs.realpathSync(r.dir); } catch (e) { return r.dir; } });
      const owned = roots.some((dir) => real === dir || real.startsWith(dir + path.sep));
      if (!owned && real.split(path.sep).slice(0, -1).some((seg) => seg.startsWith('.')))
        throw new Error('path is under a hidden directory');
      size = st.size;
      at = Math.round(st.mtimeMs);
      first = headSync(real);
      target = real;
    } else if (!/^https:\/\/[^\s]+$/.test(url)) {
      throw new Error('url must be an https:// URL');
    }
    if (d.kind !== undefined && !KINDS.has(d.kind)) throw new Error('unknown kind');
    const ts = Number.isSafeInteger(d.ts) && d.ts > 0 ? d.ts : at ?? Date.now();
    const cwd = text(d.cwd, 4096);
    const project = text(d.project, 300)
      || (cwd ? (cwd.startsWith('-') ? projectOf(cwd) : path.basename(cwd)) : null);
    this.put.run(target, text(d.title, 1000) || titleOf(target, first), d.kind || kindOf(target, 'hook'),
      localDay(ts), ts, isUuid(d.session) ? d.session.toLowerCase() : null, cwd, project,
      'hook', size, this.clock());
    return this.byPath.get(target);
  }

  list({ day, session, kind, source, q, limit = 500 } = {}) {
    const where = ['gone = 0'];
    const args = [];
    for (const [col, value] of [['day', day], ['session', session], ['kind', kind]])
      if (typeof value === 'string' && value) {
        where.push(col + ' = ?');
        args.push(col === 'session' ? value.toLowerCase() : value);
      }
    // A leading `-` negates, which is what the screen's "No scratchpads" choice sends. Anything
    // that is not a source name is ignored rather than answered with an empty list.
    if (typeof source === 'string' && /^-?[a-z]+$/.test(source)) {
      where.push(source[0] === '-' ? 'source != ?' : 'source = ?');
      args.push(source.replace(/^-/, ''));
    }
    if (typeof q === 'string' && q.trim()) {
      where.push('(lower(title) LIKE ? OR lower(path) LIKE ?)');
      const like = '%' + q.trim().toLowerCase() + '%';
      args.push(like, like);
    }
    const n = Number.isFinite(Number(limit)) ? Math.min(Math.max(Math.trunc(Number(limit)), 1), 2000) : 500;
    const docs = this.db
      .prepare(`SELECT ${COLS} FROM docs WHERE ${where.join(' AND ')} ORDER BY ts DESC, id DESC LIMIT ?`)
      .all(...args, n);
    // The list is capped, so the screen needs the filtered count to say what it cut.
    const { total } = this.db.prepare(`SELECT COUNT(*) AS total FROM docs WHERE ${where.join(' AND ')}`).get(...args);
    // The facets are unfiltered on purpose: they are the pickers, and a day picker that
    // only ever offered the day already selected could never leave it.
    return { docs, total, days: this.days.all(), kinds: this.kinds.all(), sources: this.sources.all() };
  }

  get(id) {
    return this.byId.get(id) || null;
  }

  view(filters) {
    return { ok: true, ...this.list(filters), swept_at: this.at, sweeping: !!this.inflight };
  }
}

module.exports = { DocsIndex, defaultRoots, dayOf, tsOf, kindOf, titleOf, projectOf, isUuid, localDay };
