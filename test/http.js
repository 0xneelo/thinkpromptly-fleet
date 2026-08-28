// Boots a real fleetdeck in a child process on a private pair of loopback addresses, so the
// listener split (loopback vs tailnet) is exercised for real and never touches the operator's
// deck: its own port, its own fleet.db, its own hosts.json.
const fs = require('fs');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');
const { tmpdir, hostsFile } = require('./helpers');

const ROOT = path.join(__dirname, '..');
const TAILNET_BIND = '127.0.0.2'; // second loopback address, so both listeners can share a port

// Sibling worktrees run this same file at the same time, so the band is picked per process
// rather than derived from a pid that lands in the same range on every one of them.
let nextPort = 20000 + Math.floor(Math.random() * 20000);

// Resolves once the child has printed both listener lines, rejects if it dies first.
async function startServer(env = {}, opts = {}) {
  const dir = opts.dir || tmpdir('http');
  const port = env.PORT ? Number(env.PORT) : nextPort++;
  const file = env.FLEET_DB || path.join(dir, 'fleet.db');
  const hosts = env.FLEET_HOSTS_FILE || hostsFile(dir, opts.hosts);
  const child = spawn(
    process.execPath,
    [path.join(ROOT, 'server.js')],
    {
      env: {
        ...process.env,
        PORT: String(port),
        FLEET_DB: file,
        FLEET_HOSTS_FILE: hosts,
        FLEET_TAILNET_BIND: TAILNET_BIND,
        FLEET_TAILNET_HOST: TAILNET_BIND + ':' + port,
        FLEET_NO_REAPER: '1', // reaper tests drive the tick by hand
        ...env,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );
  let out = '';
  child.stdout.on('data', (c) => (out += c));
  child.stderr.on('data', (c) => (out += c));

  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('server did not start:\n' + out)), 15000);
    const check = () => {
      if (/tailnet broker http/.test(out)) {
        clearTimeout(timer);
        clearInterval(poll);
        resolve();
      }
    };
    const poll = setInterval(check, 20);
    child.on('exit', (code) => {
      clearTimeout(timer);
      clearInterval(poll);
      reject(new Error('server exited ' + code + ':\n' + out));
    });
  });
  await ready;

  // Host header is set explicitly: the loopback listener allow-lists it and the tailnet
  // listener matches it against its own authority, so both gates are really under test.
  const call = (addr, authority) => (method, p, bodyObj, headers = {}) =>
    new Promise((resolve, reject) => {
      const payload = bodyObj === undefined ? null : JSON.stringify(bodyObj);
      const req = http.request(
        {
          host: addr,
          port,
          path: p,
          method,
          headers: {
            host: authority,
            ...(payload ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } : {}),
            ...headers,
          },
        },
        (res) => {
          let data = '';
          res.on('data', (c) => (data += c));
          res.on('end', () => {
            let json = null;
            try { json = JSON.parse(data); } catch { /* text body (403/404/405) */ }
            resolve({ status: res.statusCode, body: json, text: data });
          });
        }
      );
      req.on('error', reject);
      if (payload) req.write(payload);
      req.end();
    });

  const local = call('127.0.0.1', '127.0.0.1:' + port);
  const tail = call(TAILNET_BIND, TAILNET_BIND + ':' + port);

  return {
    port, dir, file, hosts, child,
    log: () => out,
    post: (p, b, h) => local('POST', p, b, h),
    get: (p, h) => local('GET', p, undefined, h),
    tailPost: (p, b, h) => tail('POST', p, b, h),
    tailGet: (p, h) => tail('GET', p, undefined, h),
    // The db this instance writes, opened read-only-ish for assertions between calls.
    open: () => new (require('node:sqlite').DatabaseSync)(file),
    async stop() {
      if (child.exitCode !== null) return;
      child.kill('SIGKILL');
      await new Promise((r) => child.on('exit', r));
    },
  };
}

module.exports = { startServer, TAILNET_BIND };
