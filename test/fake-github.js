// A stand-in for api.github.com, named by FLEET_GH_API. It answers the one endpoint the broker
// calls — POST /app/installations/:id/access_tokens — and records the JWT it was handed, so a
// test can prove the broker really signed with the App PEM instead of just asserting it did.
//
// It is the only "GitHub" in the suite: no test ever reaches the network.
const http = require('http');

// Same random band as test/http.js, for the same reason: sibling worktrees run this file at
// the same time and a pid-derived port lands in the same place on every one of them.
let nextPort = 20000 + Math.floor(Math.random() * 20000);

// mode: 'ok' (201 with a fresh token), '401' (GitHub's own rejection shape), 'hang' (never
// answers, for the fetch-timeout path).
async function startFakeGitHub(opts = {}) {
  const calls = [];
  let n = 0;
  const state = { mode: opts.mode || 'ok' };

  const server = http.createServer((req, res) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => {
      const m = req.url.match(/^\/app\/installations\/(\d+)\/access_tokens$/);
      if (!m || req.method !== 'POST') {
        res.writeHead(404, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ message: 'Not Found' }));
      }
      // The header is the assertion surface: a Bearer JWT signed by the App PEM. It is kept in
      // memory for the test to verify and is never logged.
      calls.push({
        installation: m[1],
        authorization: req.headers.authorization || '',
        accept: req.headers.accept || '',
        userAgent: req.headers['user-agent'] || '',
      });
      if (state.mode === 'hang') return; // socket held open: the broker's own timeout must fire
      if (state.mode === '401') {
        res.writeHead(401, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ message: 'A JSON web token could not be decoded' }));
      }
      // A new token per call, so a test can prove each GET really mints rather than caching.
      n += 1;
      res.writeHead(201, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          token: 'ghs_faketoken_' + n,
          expires_at: new Date(Date.now() + 3600e3).toISOString(),
        })
      );
    });
  });

  const port = nextPort++;
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });

  return {
    url: 'http://127.0.0.1:' + port,
    port,
    calls,
    mode: (m) => (state.mode = m),
    close: () => new Promise((r) => server.close(r)),
  };
}

module.exports = { startFakeGitHub };
