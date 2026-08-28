const crypto = require('crypto');

const SOURCE_RE = /^[A-Za-z0-9._:@/-]{1,80}$/;
const ID_RE = /^[A-Za-z0-9_-]{8,80}$/;
const MAX_BODY_BYTES = 64 * 1024;

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function rowMessage(row) {
  if (!row) return null;
  return {
    id: row.id,
    source: row.source,
    target: {
      type: row.target_type,
      ...(row.target_host ? { host: row.target_host } : {}),
      session: row.target_session,
    },
    text: row.body,
    status: row.status,
    error: row.error || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
    delivered_at: row.delivered_at || null,
  };
}

class MessageBus {
  constructor(db, deliver, validateTarget, clock = () => new Date().toISOString()) {
    this.db = db;
    this.deliver = deliver;
    this.validateTarget = validateTarget;
    this.clock = clock;
    this.queues = new Map();

    db.exec(`CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_host TEXT NOT NULL DEFAULT '',
      target_session TEXT NOT NULL,
      body TEXT NOT NULL,
      status TEXT NOT NULL,
      error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      delivered_at TEXT
    )`);
    db.exec('CREATE INDEX IF NOT EXISTS messages_created_at ON messages(created_at DESC)');
    db.prepare(
      `UPDATE messages SET status = 'failed', error = 'delivery interrupted by Fleetdeck restart', updated_at = ?
       WHERE status IN ('queued', 'sending')`
    ).run(clock());

    this.insert = db.prepare(
      `INSERT OR IGNORE INTO messages
       (id, source, target_type, target_host, target_session, body, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'queued', ?, ?)`
    );
    this.getStatement = db.prepare('SELECT * FROM messages WHERE id = ?');
    this.listStatement = db.prepare('SELECT * FROM messages ORDER BY created_at DESC LIMIT ?');
    this.markSending = db.prepare(
      `UPDATE messages SET status = 'sending', error = NULL, updated_at = ? WHERE id = ?`
    );
    this.markDelivered = db.prepare(
      `UPDATE messages SET status = 'delivered', error = NULL, updated_at = ?, delivered_at = ? WHERE id = ?`
    );
    this.markFailed = db.prepare(
      `UPDATE messages SET status = 'failed', error = ?, updated_at = ? WHERE id = ?`
    );
    this.markQueued = db.prepare(
      `UPDATE messages SET status = 'queued', error = NULL, updated_at = ?, delivered_at = NULL WHERE id = ?`
    );
  }

  normalize(input) {
    if (!input || typeof input !== 'object') fail(400, 'message must be an object');
    const source = input.source === undefined ? 'unknown' : input.source;
    if (typeof source !== 'string' || !SOURCE_RE.test(source))
      fail(400, 'source must be 1-80 safe identifier characters');
    const id = input.id || crypto.randomUUID();
    if (typeof id !== 'string' || !ID_RE.test(id)) fail(400, 'id must be 8-80 safe identifier characters');
    const text = input.text;
    if (typeof text !== 'string' || !text.trim()) fail(400, 'text must be a non-empty string');
    if (Buffer.byteLength(text) > MAX_BODY_BYTES) fail(413, 'text exceeds 64 KiB');
    const target = this.validateTarget(input.target);
    return { id, source, target, text };
  }

  get(id) {
    return rowMessage(this.getStatement.get(id));
  }

  list(limit = 50) {
    const n = Number.isInteger(limit) && limit > 0 ? Math.min(limit, 100) : 50;
    return this.listStatement.all(n).map(rowMessage);
  }

  async send(input) {
    const message = this.normalize(input);
    const stamp = this.clock();
    const result = this.insert.run(
      message.id,
      message.source,
      message.target.type,
      message.target.host || '',
      message.target.session,
      message.text,
      stamp,
      stamp
    );
    if (!result.changes) return { ...this.get(message.id), duplicate: true };
    return this.enqueue(message);
  }

  async retry(id) {
    const message = this.get(id);
    if (!message) fail(404, 'message not found');
    if (message.status !== 'failed') fail(409, 'only failed messages can be retried');
    this.markQueued.run(this.clock(), id);
    return this.enqueue(message);
  }

  enqueue(message) {
    const key = [message.target.type, message.target.host || '', message.target.session].join('\0');
    const previous = this.queues.get(key) || Promise.resolve();
    const task = previous.catch(() => {}).then(() => this.deliverOne(message));
    this.queues.set(key, task);
    task.finally(() => this.queues.get(key) === task && this.queues.delete(key));
    return task;
  }

  async deliverOne(message) {
    this.markSending.run(this.clock(), message.id);
    try {
      await this.deliver(message);
      const stamp = this.clock();
      this.markDelivered.run(stamp, stamp, message.id);
    } catch (error) {
      this.markFailed.run(String(error.message || error).slice(0, 1000), this.clock(), message.id);
    }
    return this.get(message.id);
  }
}

module.exports = { MessageBus, MAX_BODY_BYTES };
