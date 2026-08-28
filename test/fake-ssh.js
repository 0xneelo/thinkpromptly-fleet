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
const fs = require('fs');
const { execFileSync } = require('child_process');

const STATE = process.env.FLEET_FAKE_SSH_STATE;
const args = process.argv.slice(2);
const host = args[args.length - 2];
const cmd = args[args.length - 1];

const read = () => JSON.parse(fs.readFileSync(STATE, 'utf8'));
const write = (s) => fs.writeFileSync(STATE, JSON.stringify(s, null, 2));

const state = read();
state.calls = state.calls || [];
state.calls.push({ host, cmd, at: Date.now() });
write(state);

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
    const seen = (state.lsCount = state.lsCount || {});
    const nth = (seen[host] = (seen[host] || 0) + 1);
    write(state);
    const rows = Object.entries(h.sessions || {})
      .filter(([, s]) => !s.appearAfterLs || nth > s.appearAfterLs)
      .map(([n, s]) => 'n=' + n + ',a=' + s.activity + ',c=' + (s.created || s.activity));
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
    // Busy-wait: this is a child process, so blocking it is exactly the stall a slow ssh is.
    if (state.killDelayMs) {
      const until = Date.now() + state.killDelayMs;
      while (Date.now() < until) execFileSync('true');
    }
    if (h.killHard || state.killHard) {
      process.stderr.write('ssh: connect to host ' + host + ' port 22: Connection timed out\n');
      process.exit(255);
    }
    if (h.killFail) {
      process.stderr.write('cant find session: ' + target + '\n');
      process.exit(1);
    }
    if (state.local) return out(runLocal(cmd));
    const s = read();
    const sess = s.hosts[host].sessions || {};
    if (!(target in sess)) {
      process.stderr.write("can't find session: " + target + '\n');
      process.exit(1);
    }
    delete sess[target];
    write(s);
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
