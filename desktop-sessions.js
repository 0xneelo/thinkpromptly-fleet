// The Machines collector/cache pattern, scoped to Desktop Code-tab metadata. The writer
// and reader both project an allowlist; transport diagnostics and raw JSON never escape.
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const LOCAL = /^local_[A-Za-z0-9_-]{1,160}$/;
const MAX_ROWS = 20000;
const MAX_BYTES = 16 * 1024 * 1024;
const text = (v, n) => typeof v === 'string' ? v.slice(0, n) : null;
const uuid = (v) => typeof v === 'string' && UUID.test(v) ? v.toLowerCase() : null;

function stamp(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  if (typeof value === 'number' && (!Number.isFinite(value) || value < 0)) return null;
  if (typeof value === 'string' && !/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(value)) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function sessionRow(value) {
  if (!value || typeof value !== 'object') return null;
  const accountUuid = uuid(value.accountUuid), orgUuid = uuid(value.orgUuid);
  if (!accountUuid || !orgUuid || typeof value.id !== 'string' || !LOCAL.test(value.id)) return null;
  return {
    accountUuid, orgUuid, id: value.id,
    title: text(value.title, 1000), cwd: text(value.cwd, 4096), worktree: text(value.worktree, 4096),
    branch: text(value.branch, 300), model: text(value.model, 100),
    createdAt: stamp(value.createdAt), lastActivityAt: stamp(value.lastActivityAt),
    isArchived: value.isArchived === true,
    completedTurns: Number.isSafeInteger(value.completedTurns) && value.completedTurns >= 0 ? value.completedTurns : null,
    cliSessionId: uuid(value.cliSessionId),
  };
}

class DesktopSessions {
  constructor({ db, config, accounts, collect, ttl = 300000, clock = Date.now }) {
    this.db = db;
    this.config = config;
    this.accounts = accounts;
    this.collectMachine = collect;
    this.ttl = ttl;
    this.clock = clock;
    this.at = null;
    this.inflight = null;
    db.exec(`CREATE TABLE IF NOT EXISTS desktop_sessions (
      machine TEXT NOT NULL, account TEXT NOT NULL, org TEXT NOT NULL, id TEXT NOT NULL,
      payload TEXT NOT NULL, updated_at INTEGER NOT NULL,
      PRIMARY KEY(machine, account, org, id)
    );
    CREATE TABLE IF NOT EXISTS desktop_session_sources (
      machine TEXT PRIMARY KEY, collected_at INTEGER, attempted_at INTEGER NOT NULL,
      state TEXT NOT NULL, skipped INTEGER NOT NULL DEFAULT 0
    )`);
    this.all = db.prepare('SELECT machine, payload, updated_at FROM desktop_sessions');
    this.one = db.prepare('SELECT payload FROM desktop_sessions WHERE machine = ? AND account = ? AND org = ? AND id = ?');
    this.sources = db.prepare('SELECT * FROM desktop_session_sources');
    this.drop = db.prepare('DELETE FROM desktop_sessions WHERE machine = ?');
    this.put = db.prepare(`INSERT INTO desktop_sessions VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(machine, account, org, id) DO UPDATE SET payload=excluded.payload, updated_at=excluded.updated_at`);
    this.source = db.prepare(`INSERT INTO desktop_session_sources VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(machine) DO UPDATE SET collected_at=COALESCE(excluded.collected_at, desktop_session_sources.collected_at),
      attempted_at=excluded.attempted_at, state=excluded.state, skipped=excluded.skipped`);
  }

  row(machine, account, org, id) {
    if (typeof machine !== 'string' || !uuid(account) || !uuid(org) || typeof id !== 'string' || !LOCAL.test(id)) return null;
    const stored = this.one.get(machine, uuid(account), uuid(org), id);
    if (!stored) return null;
    try { return sessionRow(JSON.parse(stored.payload)); } catch { return null; }
  }

  // The freshest stored row for one CLI session UUID, with the machine that owns it, so a
  // caller holding only the id the message bus knows can reach the transcript.
  byCli(id) {
    const cli = uuid(id);
    if (!cli) return null;
    const machines = new Map(this.machines().map((m) => [m.id, m]));
    let best = null;
    for (const stored of this.all.all()) {
      const machine = machines.get(stored.machine);
      if (!machine || (best && stored.updated_at <= best.at)) continue;
      let row;
      try { row = sessionRow(JSON.parse(stored.payload)); } catch { continue; }
      if (row && row.cliSessionId === cli) best = { row, machine, at: stored.updated_at };
    }
    return best ? { row: best.row, machine: best.machine } : null;
  }

  // The freshest stored row whose title is this one, with its machine. The message bus
  // holds a seat's display name, and a seat that has gone offline is no longer in the live
  // registry -- but its transcript is still on the machine that ran it. Two live tabs can
  // share a title, so an ambiguous name resolves to nothing rather than to a coin flip.
  byTitle(title) {
    if (typeof title !== 'string' || !title) return null;
    const machines = new Map(this.machines().map((m) => [m.id, m]));
    let best = null;
    let ambiguous = false;
    for (const stored of this.all.all()) {
      const machine = machines.get(stored.machine);
      if (!machine) continue;
      let row;
      try { row = sessionRow(JSON.parse(stored.payload)); } catch { continue; }
      if (!row || !row.cliSessionId || row.title !== title) continue;
      if (best && row.cliSessionId !== best.row.cliSessionId) ambiguous = true;
      if (!best || stored.updated_at > best.at) best = { row, machine, at: stored.updated_at };
    }
    return best && !ambiguous ? { row: best.row, machine: best.machine } : null;
  }

  machines() {
    return this.config().filter((m) => m.desktop_sessions === true && ['local', 'ssh'].includes(m.route));
  }

  async collect(force = false) {
    // A forced refresh joins the running sweep too: an older sweep can never overwrite a
    // newer one, and parallel requests receive the same finished snapshot on first load.
    if (this.inflight) return this.inflight;
    if (!force && this.at !== null && this.clock() - this.at < this.ttl) return;
    this.at = this.clock();
    this.inflight = Promise.allSettled(this.machines().map((m) => this.refreshMachine(m)));
    try { await this.inflight; } finally { this.inflight = null; }
  }

  async refreshMachine(machine) {
    const now = this.clock();
    try {
      const result = await this.collectMachine(machine);
      if (result.err) {
        this.source.run(machine.id, null, now, 'unavailable', 0);
        return;
      }
      if (Buffer.byteLength(result.stdout || '') > MAX_BYTES) throw new Error();
      const line = (result.stdout || '').trim().split(/\r?\n/).filter(Boolean).pop();
      const data = JSON.parse(line);
      if (!data || data.v !== 1 || !['ok', 'not_found', 'unavailable'].includes(data.state)) throw new Error();
      if (data.state !== 'ok') {
        this.source.run(machine.id, null, now, data.state, 0);
        return;
      }
      if (!Array.isArray(data.sessions) || data.sessions.length > MAX_ROWS || typeof data.complete !== 'boolean') throw new Error();
      const rows = data.sessions.map(sessionRow);
      let skipped = Number.isSafeInteger(data.skipped) && data.skipped >= 0 ? data.skipped : 0;
      skipped += rows.filter((r) => !r).length;
      const complete = data.complete && skipped === 0;
      this.db.exec('BEGIN');
      try {
        // Partial scans upsert what was readable and retain missing rows. Only a complete
        // snapshot is evidence that a previously stored tab was removed.
        if (complete) this.drop.run(machine.id);
        for (const row of rows.filter(Boolean))
          this.put.run(machine.id, row.accountUuid, row.orgUuid, row.id, JSON.stringify(row), now);
        this.source.run(machine.id, now, now, complete ? 'ok' : 'partial', skipped);
        this.db.exec('COMMIT');
      } catch (error) {
        this.db.exec('ROLLBACK');
        throw error;
      }
    } catch {
      this.source.run(machine.id, null, now, 'unavailable', 0);
    }
  }

  view(liveSessions = []) {
    const now = this.clock();
    const orgs = this.accounts().orgs || {};
    const sources = new Map(this.sources.all().map((s) => [s.machine, s]));
    const machines = this.machines().map((m) => {
      const source = sources.get(m.id);
      return {
        id: m.id, label: text(m.label, 100) || m.id, host: text(m.host, 100),
        local: m.route === 'local', state: source?.state || 'no_report',
        collected_at: source?.collected_at ?? null, attempted_at: source?.attempted_at ?? null,
        stale: !source?.collected_at || source.state !== 'ok' || now - source.collected_at >= this.ttl,
        skipped: source?.skipped || 0,
      };
    });
    const byMachine = new Map(machines.map((m) => [m.id, m]));
    const live = new Map();
    for (const session of liveSessions) {
      const id = uuid(session.sessionId);
      if (id) live.set(id, [...(live.get(id) || []), session]);
    }
    const groups = new Map();
    for (const stored of this.all.all()) {
      const machine = byMachine.get(stored.machine);
      if (!machine) continue;
      let row;
      try { row = sessionRow(JSON.parse(stored.payload)); } catch { continue; }
      if (!row) continue;
      const key = [row.accountUuid, row.orgUuid, machine.id].join(':');
      if (!groups.has(key)) {
        const label = orgs[row.orgUuid] || {};
        groups.set(key, {
          accountUuid: row.accountUuid, orgUuid: row.orgUuid, machine: machine.id,
          label: text(label.label, 100) || 'Unmapped account', email: text(label.email, 254), sessions: [],
        });
      }
      const matches = machine.local ? live.get(row.cliSessionId) || [] : [];
      const isLive = matches.length === 1;
      groups.get(key).sessions.push({
        ...row, live: isLive,
        // The deck can inspect its own process/socket registry. A remote Desktop process
        // has no proof here; never join a remote row to a local PID by a copied ID.
        liveState: machine.local ? isLive ? 'live' : 'offline' : 'unknown',
        liveName: isLive ? text(matches[0].name, 300) : null,
        messageTarget: isLive ? { type: 'claude-desktop', session: 'id:' + row.cliSessionId } : null,
        collected_at: stored.updated_at, stale: machine.stale || now - stored.updated_at >= this.ttl,
      });
    }
    const result = [...groups.values()];
    for (const group of result) group.sessions.sort((a, b) =>
      (b.lastActivityAt || '').localeCompare(a.lastActivityAt || '') || a.id.localeCompare(b.id));
    result.sort((a, b) => a.label.localeCompare(b.label) || a.accountUuid.localeCompare(b.accountUuid) ||
      a.machine.localeCompare(b.machine) || a.orgUuid.localeCompare(b.orgUuid));
    return { groups: result, machines, collected_at: this.at, collecting: !!this.inflight, ttl_ms: this.ttl };
  }
}

module.exports = { DesktopSessions, sessionRow, uuid };
