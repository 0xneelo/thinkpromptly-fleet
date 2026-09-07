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

function rawGet(port, p, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: p, method: 'GET', headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
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
