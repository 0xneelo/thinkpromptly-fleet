#!/usr/bin/env node
// A fake host poller, used as FLEET_SSH_BIN. It is invoked exactly as the real ssh is —
// `-o BatchMode=yes -o ConnectTimeout=8 <host> <remote command>` — and answers from a JSON
// state file named by FLEET_FAKE_SSH_STATE, so a test can hold a whole fleet still, make one
// host's poll fail, or let a kill fail, without a network or a second machine.
//
// state = {
//   hosts: { "<host>": { pollFail?: bool, killFail?: bool,
//                        sessions: { "<name>": { activity: <unix s>, created: <unix s> } } } },
//   local: bool,            // run the remote command against this machine's real tmux instead
//   killDelayMs: number,    // hold a kill-session open this long, to open a race window
//   killHard: bool,         // kill-session fails the way an unreachable host does, not the way
//                           // tmux does when the session is already gone (which counts as done)
//   calls: [ { host, cmd, at } ]   // appended by every invocation, for ordering assertions
// }
// A session entry may carry `appearAfterLs: n` — it stays invisible for the first n `tmux ls`
// calls to its host and shows up from the (n+1)th onward, which is how a test makes a session
// come back to life between one sample and the next.
//
// `activity` (and `created`) may be the string 'now' instead of a number: the timestamp is then
// taken when this sample is answered, and rounded UP to the next whole second. tmux reports
// activity in whole seconds, so a literal `Math.floor(Date.now()/1000)` written by the test
// arrives at the deck already up to 999ms stale — against a suspect window of a second or two
// that stale-by-truncation alone decided whether a session read as live. 'now' means what the
// test means, "this session is active as the deck looks at it", and costs no margin.
const fs = require('fs');
const { execFileSync } = require('child_process');

const STATE = process.env.FLEET_FAKE_SSH_STATE;
// `.fixture.lock`, not `.lock`: test/reaper.test.js wraps every call to this file in a lock of
// its own at `<state>.lock`, and a second lock on that same path taken inside the wrapper's
// would be waiting for a lock its own caller already holds.
const LOCK = STATE + '.fixture.lock';
const HOLDER = LOCK + '/pid';
const args = process.argv.slice(2);
const host = args[args.length - 2];
const cmd = args[args.length - 1];

// The deck polls two commands at once — health() runs qwinsta and pgrep in a Promise.all — so
// two copies of this fixture read-modify-write one state file concurrently. Unserialised, one
// of them reads a half-written file, dies on the parse, and the deck reads that as "the ssh
// itself failed" (holderOk: null): measured at 8.5% of /api/health calls, which is what made
// M14 flake. mkdir is the atomic create every filesystem has, and the write lands by rename,
// so a reader outside the lock — a test calling `i.ssh()` — never sees a partial file either.
const nap = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const STALE_LOCK_MS = 10000;

// A fixture SIGKILLed while holding the lock (execFile's own timeout is a SIGKILL) would wedge
// every later call in that test, so the lock is reclaimable — but on the holder's LIVENESS, not
// on its age. Reclaiming a slow-but-alive holder would put two writers inside the same critical
// section, which is the corruption this lock exists to stop. Age is the fallback for one narrow
// case only: a holder that died between taking the directory and naming itself in it.
function reclaimIfDead() {
  let pid = 0;
  try {
    pid = Number(fs.readFileSync(HOLDER, 'utf8'));
  } catch {
    // No pid yet: either the holder is still writing it, or it died before it could.
    try {
      if (Date.now() - fs.statSync(LOCK).mtimeMs > STALE_LOCK_MS) fs.rmSync(LOCK, { recursive: true, force: true });
    } catch { /* someone else got there first */ }
    return;
  }
  if (!pid) return;
  try {
    process.kill(pid, 0); // alive (EPERM counts as alive too) — it keeps the lock
    return;
  } catch (e) {
    if (e.code !== 'ESRCH') return;
  }
  try { fs.rmSync(LOCK, { recursive: true, force: true }); } catch { /* someone else got there first */ }
}

// The bound is under the deck's own 15s ssh timeout, so a stuck lock says so instead of being
// SIGKILLed halfway and looking like an unreachable host.
function lock() {
  const deadline = Date.now() + 10000;
  for (;;) {
    try {
      fs.mkdirSync(LOCK);
      fs.writeFileSync(HOLDER, String(process.pid));
      return;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      reclaimIfDead();
      if (Date.now() > deadline) throw new Error('fake-ssh: state lock stuck at ' + LOCK);
      nap(2);
    }
  }
}

// Read, mutate, write, all inside the lock. Returns whatever `fn` returns; the caller gets the
// state it just wrote, so nothing outside re-reads a file another fixture may already own.
function withState(fn) {
  lock();
  try {
    const s = JSON.parse(fs.readFileSync(STATE, 'utf8'));
    const r = fn(s);
    const tmp = STATE + '.' + process.pid + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(s, null, 2));
    fs.renameSync(tmp, STATE);
    return r === undefined ? s : r;
  } finally {
    try { fs.rmSync(LOCK, { recursive: true, force: true }); } catch { /* best effort */ }
  }
}

// Every invocation is recorded, for the ordering assertions; the snapshot it returns is this
// process's view of the fleet for the rest of the run.
const state = withState((s) => {
  s.calls = s.calls || [];
  s.calls.push({ host, cmd, at: Date.now() });
});

// The zero-quote rule is a property of every command this fixture ever sees, so it is
// enforced here rather than only asserted in one test (server.js:95-99).
if (/['"`]/.test(cmd)) {
  process.stderr.write('fake-ssh: remote command contains a quote character: ' + cmd + '\n');
  process.exit(99);
}

const h = (state.hosts || {})[host];
if (!h) {
  process.stderr.write('ssh: Could not resolve hostname ' + host + '\n');
  process.exit(255);
}

// Authentication happens before the remote command runs, so this fails every call to the
// host, not just its poll — the way an expired deploy cert does. `pollFail` is the other
// half of the pair: a transport failure, which says nothing about the credential.
if (h.authFail) {
  process.stderr.write('deployer@' + host + ': Permission denied (publickey).\n');
  process.exit(255);
}

// A killed session must be one of this worker's own throwaways. The prefix guard lives in the
// fixture so no test, however written, can reach an FD-* or LC-* session on this machine.
const localTarget = (c) => {
  const m = c.match(/-t\s+(\S+)/);
  return m ? m[1] : null;
};

function runLocal(c) {
  const bare = c.replace(/^wsl\s+/, '');
  const target = localTarget(bare);
  if (target && !/^EDITH-T-/.test(target))
    throw new Error('fake-ssh refuses to touch a session that is not EDITH-T-*: ' + target);
  return execFileSync('bash', ['-lc', bare], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

// tmux prints whole seconds. 'now' is rounded up so the truncation costs the test no margin,
// and it is sampled once per invocation so every field of one answer agrees with the others.
let nowStamp = null;
const stamp = (v) => (v === 'now' ? (nowStamp ??= Math.ceil(Date.now() / 1000)) : v);

function out(s) {
  process.stdout.write(s);
  process.exit(0);
}

try {
  if (/tmux ls /.test(cmd)) {
    if (h.pollFail) {
      process.stderr.write('ssh: connect to host ' + host + ' port 22: Connection timed out\n');
      process.exit(255);
    }
    if (state.local) return out(runLocal(cmd));
    // Counted only once the poll actually answers, so a failing host does not advance
    // anybody's appearAfterLs.
    const { nth, sessions } = withState((s) => {
      const seen = (s.lsCount = s.lsCount || {});
      return {
        nth: (seen[host] = (seen[host] || 0) + 1),
        sessions: ((s.hosts || {})[host] || {}).sessions || {},
      };
    });
    const rows = Object.entries(sessions)
      .filter(([, s]) => !s.appearAfterLs || nth > s.appearAfterLs)
      .map(([n, s]) => 'n=' + n + ',a=' + stamp(s.activity) + ',c=' + stamp(s.created || s.activity));
    if (!rows.length) {
      process.stderr.write('no server running on /tmp/tmux-1000/default\n');
      process.exit(1);
    }
    return out(rows.join('\n') + '\n');
  }

  if (/fleet-lastmsg/.test(cmd)) {
    // The box may not have the helper installed; a soft failure must leave stored values alone.
    if (state.local || !h.lastMsg) return out('');
    return out(
      Object.entries(h.lastMsg).map(([n, iso]) => n + '\t' + iso + '\t').join('\n') + '\n'
    );
  }

  if (/tmux kill-session/.test(cmd)) {
    const target = localTarget(cmd);
    // Block the whole child: this is a separate process, so stopping it dead is exactly the
    // stall a slow ssh is. The lock is not held across it — a test watches `calls` for this
    // kill to know the window is open, and that read must not block behind the stall it is
    // waiting for. (It used to spin on `execFileSync('true')`, which spent the stall spawning
    // a process per millisecond and loaded the box it was supposed to be idle on.)
    if (state.killDelayMs) nap(state.killDelayMs);
    if (h.killHard || state.killHard) {
      process.stderr.write('ssh: connect to host ' + host + ' port 22: Connection timed out\n');
      process.exit(255);
    }
    if (h.killFail) {
      process.stderr.write('cant find session: ' + target + '\n');
      process.exit(1);
    }
    if (state.local) return out(runLocal(cmd));
    const gone = withState((s) => {
      const sess = s.hosts[host].sessions || {};
      if (!(target in sess)) return false;
      delete sess[target];
      return true;
    });
    if (!gone) {
      process.stderr.write("can't find session: " + target + '\n');
      process.exit(1);
    }
    return out('');
  }

  if (/tmux display-message/.test(cmd)) {
    if (state.local) return out(runLocal(cmd));
    return out('');
  }

  if (/qwinsta/.test(cmd)) return out(' console           Vibe                      1  Disc\n');
  if (/pgrep/.test(cmd)) return out('4242\n');
} catch (e) {
  process.stderr.write(String(e.message) + '\n');
  process.exit(1);
}

process.stderr.write('fake-ssh: unhandled remote command: ' + cmd + '\n');
process.exit(127);
