// Local app-title metadata for notify aliases. No collector, remote I/O, or database writes:
// the index is loaded only when the existing live desktop registry is consulted.
const fs = require('node:fs');
const path = require('node:path');
const { uuid } = require('./desktop-sessions');
const MAX_BYTES = 16 * 1024 * 1024; // same byte ceiling as the desktop metadata collector

function entries(dir) {
  try { return fs.readdirSync(dir, { withFileTypes: true }); }
  catch { return []; } // absent store, removed directory, or unreadable account
}

class DesktopSeatTitles {
  constructor({ dir, clock = () => performance.now() }) {
    this.dir = dir;
    this.clock = clock;
    this.at = null;
    this.index = new Map();
  }

  get() {
    const now = this.clock();
    if (this.at !== null && now - this.at < 5000) return this.index;
    const index = new Map();
    // Exactly <account>/<org>/local_*.json. Dirents exclude symlink directories/files;
    // config, credentials, transcripts and peer keys are never part of this scan.
    for (const account of entries(this.dir).filter((e) => e.isDirectory())) {
      const accountDir = path.join(this.dir, account.name);
      for (const org of entries(accountDir).filter((e) => e.isDirectory())) {
        const orgDir = path.join(accountDir, org.name);
        for (const file of entries(orgDir)) {
          if (!file.isFile() || !/^local_[A-Za-z0-9_-]{1,160}\.json$/.test(file.name)) continue;
          try {
            const full = path.join(orgDir, file.name);
            if (fs.statSync(full).size > MAX_BYTES) continue;
            const raw = fs.readFileSync(full);
            if (raw.length > MAX_BYTES) continue; // a writer may grow it after stat
            const row = JSON.parse(raw.toString('utf8'));
            const id = uuid(row?.cliSessionId);
            if (!id || row.isArchived === true) continue;
            // A duplicated CLI identity cannot safely choose one app title.
            index.set(id, index.has(id) ? null : {
              title: typeof row.title === 'string' ? row.title : null,
              cwd: typeof row.cwd === 'string' ? row.cwd : null,
              lastActivityAt: typeof row.lastActivityAt === 'string' ? row.lastActivityAt : null,
              isArchived: false,
            });
          } catch {} // partial writes and stale files are retried at the next refresh
        }
      }
    }
    this.index = index;
    this.at = now;
    return index;
  }
}

module.exports = { DesktopSeatTitles };
