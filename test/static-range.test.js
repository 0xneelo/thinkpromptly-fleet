// Range support for the static handler: the landing hero is a 5 MB mp4, and a browser that
// gets no 206 back reports video.seekable as [0,0] and refuses to scrub. test/http.js's get()
// accumulates the body as a string, which mangles mp4 bytes, so this file collects Buffers.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { startServer } = require('./http');

const MEDIA = path.join(__dirname, '..', 'public', 'v2', 'media');
const VIDEO = path.join(MEDIA, 'hero-dark.mp4');
const VIDEO_URL = '/v2/media/hero-dark.mp4';
const SVG = path.join(MEDIA, 'fleetdeck-eye-minimal.svg');

const diskBuf = fs.readFileSync(VIDEO);
const size = fs.statSync(VIDEO).size;

function rawGet(port, p, headers = {}, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: p, method, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      // complete is false when the peer reset the connection before the body finished,
      // which is exactly the truncated-200 failure these tests have to be able to see.
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks), complete: res.complete }));
    });
    req.on('error', reject);
    req.end();
  });
}

// One server for the whole file: every case here is a read-only GET, so they cannot collide.
let s;
test.before(async () => { s = await startServer(); });
test.after(async () => { await s.stop(); });

test('no Range serves the whole file with Accept-Ranges', async () => {
  const r = await rawGet(s.port, VIDEO_URL);
  assert.equal(r.status, 200);
  assert.equal(r.headers['accept-ranges'], 'bytes');
  assert.equal(r.headers['content-length'], String(size));
  assert.equal(r.headers['content-range'], undefined);
  assert.ok(r.body.equals(diskBuf));
});

test('bytes=0-99 returns the first 100 bytes as 206', async () => {
  const r = await rawGet(s.port, VIDEO_URL, { range: 'bytes=0-99' });
  assert.equal(r.status, 206);
  assert.equal(r.headers['content-range'], 'bytes 0-99/' + size);
  assert.equal(r.headers['content-length'], '100');
  assert.equal(r.body.length, 100);
  assert.ok(r.body.equals(diskBuf.subarray(0, 100)));
});

test('an open-ended range runs to the last byte', async () => {
  const r = await rawGet(s.port, VIDEO_URL, { range: 'bytes=' + (size - 50) + '-' });
  assert.equal(r.status, 206);
  assert.equal(r.headers['content-range'], 'bytes ' + (size - 50) + '-' + (size - 1) + '/' + size);
  assert.ok(r.body.equals(diskBuf.subarray(size - 50)));
});

test('a suffix range returns the last N bytes', async () => {
  const r = await rawGet(s.port, VIDEO_URL, { range: 'bytes=-50' });
  assert.equal(r.status, 206);
  assert.equal(r.headers['content-range'], 'bytes ' + (size - 50) + '-' + (size - 1) + '/' + size);
  assert.ok(r.body.equals(diskBuf.subarray(size - 50)));
});

test('an end past EOF clamps to the last byte', async () => {
  const r = await rawGet(s.port, VIDEO_URL, { range: 'bytes=0-' + (size + 1000) });
  assert.equal(r.status, 206);
  assert.equal(r.headers['content-range'], 'bytes 0-' + (size - 1) + '/' + size);
  assert.ok(r.body.equals(diskBuf));
});

test('a start past EOF is 416', async () => {
  const r = await rawGet(s.port, VIDEO_URL, { range: 'bytes=' + size + '-' });
  assert.equal(r.status, 416);
  assert.equal(r.headers['content-range'], 'bytes */' + size);
  assert.equal(r.body.length, 0);
});

test('a reversed range is 416', async () => {
  const r = await rawGet(s.port, VIDEO_URL, { range: 'bytes=100-50' });
  assert.equal(r.status, 416);
  assert.equal(r.headers['content-range'], 'bytes */' + size);
});

test('a zero-length suffix is 416', async () => {
  const r = await rawGet(s.port, VIDEO_URL, { range: 'bytes=-0' });
  assert.equal(r.status, 416);
  assert.equal(r.headers['content-range'], 'bytes */' + size);
});

test('a multi-range is ignored and serves the whole file', async () => {
  const r = await rawGet(s.port, VIDEO_URL, { range: 'bytes=0-9,20-29' });
  assert.equal(r.status, 200);
  assert.equal(r.headers['accept-ranges'], 'bytes');
  assert.equal(r.headers['content-range'], undefined);
  assert.ok(r.body.equals(diskBuf));
});

test('a non-bytes unit is ignored and serves the whole file', async () => {
  const r = await rawGet(s.port, VIDEO_URL, { range: 'bananas=0-9' });
  assert.equal(r.status, 200);
  assert.equal(r.headers['content-range'], undefined);
  assert.ok(r.body.equals(diskBuf));
});

test('a plain asset still serves as 200 and advertises ranges', async () => {
  const r = await rawGet(s.port, '/v2/media/fleetdeck-eye-minimal.svg');
  assert.equal(r.status, 200);
  assert.ok(r.headers['content-type'].startsWith('image/svg+xml'), r.headers['content-type']);
  assert.equal(r.headers['accept-ranges'], 'bytes');
  assert.equal(r.headers['content-length'], String(fs.statSync(SVG).size));
});

test('a HEAD gets the headers and no body', async () => {
  const r = await rawGet(s.port, VIDEO_URL, {}, 'HEAD');
  assert.equal(r.status, 200);
  assert.equal(r.headers['accept-ranges'], 'bytes');
  assert.equal(r.headers['content-length'], String(size));
  assert.equal(r.body.length, 0);
});

test('a HEAD with a Range gets the 206 headers and no body', async () => {
  const r = await rawGet(s.port, VIDEO_URL, { range: 'bytes=0-99' }, 'HEAD');
  assert.equal(r.status, 206);
  assert.equal(r.headers['content-range'], 'bytes 0-99/' + size);
  assert.equal(r.headers['content-length'], '100');
  assert.equal(r.body.length, 0);
});

test('an absurdly large end still clamps to the last byte', async () => {
  const r = await rawGet(s.port, VIDEO_URL, { range: 'bytes=0-99999999999999999999' });
  assert.equal(r.status, 206);
  assert.equal(r.headers['content-range'], 'bytes 0-' + (size - 1) + '/' + size);
  assert.ok(r.body.equals(diskBuf));
});

test('the bytes unit is matched case-insensitively', async () => {
  const r = await rawGet(s.port, VIDEO_URL, { range: 'Bytes=0-99' });
  assert.equal(r.status, 206);
  assert.equal(r.headers['content-range'], 'bytes 0-99/' + size);
  assert.ok(r.body.equals(diskBuf.subarray(0, 100)));
});

// The server runs in a child process, so a temp asset has to live under public/ to be
// reachable. Every one of these names is unique per process and removed in t.after,
// pass or fail, so a sibling worktree and git status both stay clean.
function tempAsset(t, name, write) {
  const p = path.join(MEDIA, 'tmp-' + process.pid + '-' + name);
  t.after(() => {
    try { fs.chmodSync(p, 0o644); } catch {}
    try { fs.unlinkSync(p); } catch {}
  });
  write(p);
  return p;
}

test('a zero-byte file serves 200 with no body, and 416 for any range', async (t) => {
  const p = tempAsset(t, 'zero.bin', (f) => fs.writeFileSync(f, ''));
  const url = '/v2/media/' + path.basename(p);

  const whole = await rawGet(s.port, url);
  assert.equal(whole.status, 200);
  assert.equal(whole.headers['content-length'], '0');
  assert.equal(whole.body.length, 0);

  // Nothing to return means nothing can satisfy the ask, so even bytes=0- is a 416.
  const ranged = await rawGet(s.port, url, { range: 'bytes=0-' });
  assert.equal(ranged.status, 416);
  assert.equal(ranged.headers['content-range'], 'bytes */0');
});

test('a file that stats but will not open answers 404, not a truncated 200', async (t) => {
  if (process.getuid && process.getuid() === 0) return t.skip('root ignores permission bits');
  const p = tempAsset(t, 'unreadable.txt', (f) => {
    fs.writeFileSync(f, 'secret');
    fs.chmodSync(f, 0o000);
  });

  const r = await rawGet(s.port, '/v2/media/' + path.basename(p));
  assert.equal(r.status, 404);
  assert.equal(r.body.toString(), 'not found');
  assert.equal(r.complete, true); // a reset mid-body would leave this false
});

test('a client that aborts mid-stream leaves the server healthy', async () => {
  await new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port: s.port, path: VIDEO_URL, method: 'GET', headers: { range: 'bytes=0-' + (size - 1) } },
      (res) => {
        assert.equal(res.statusCode, 206);
        res.once('data', () => { req.destroy(); resolve(); });
      }
    );
    // The destroy above makes the request emit ECONNRESET; that is the point of the test.
    req.on('error', () => resolve());
    req.setTimeout(10000, () => reject(new Error('no data before timeout')));
    req.end();
  });
  await new Promise((r) => setTimeout(r, 100));

  const after = await rawGet(s.port, VIDEO_URL);
  assert.equal(after.status, 200);
  assert.equal(after.headers['content-length'], String(size));
  assert.ok(after.body.equals(diskBuf));
});
