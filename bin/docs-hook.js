#!/usr/bin/env node

// A Claude Code PostToolUse hook: every .html/.md a session writes, and every Artifact it
// publishes, lands in the deck's docs index (/api/docs). A published Artifact has no file
// to sweep, so this is the only way its claude.ai URL is ever recorded.
//
// Two rules: hook stdout is fed back into the session, so this prints nothing at all; and
// a docs row is never worth breaking a turn for, so every error is swallowed and the exit
// code is always 0.
const fs = require('fs');
const http = require('http');
const { titleOf } = require('../docs-index');

const DOC = /\.(?:html|md)$/i;
const HEAD_BYTES = 8192;

function post(doc) {
  return new Promise((done) => {
    const data = JSON.stringify(doc);
    const req = http.request(
      {
        host: '127.0.0.1',
        port: Number(process.env.FLEETDECK_PORT) || 3131,
        path: '/api/docs',
        method: 'POST',
        headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) },
        timeout: 1500,
      },
      (res) => {
        res.resume();
        res.on('end', done);
        res.on('error', done);
      }
    );
    req.on('timeout', () => req.destroy());
    req.on('error', () => done());
    req.end(data);
  });
}

function head(file) {
  try {
    const fd = fs.openSync(file, 'r');
    try {
      const buf = Buffer.alloc(HEAD_BYTES);
      return buf.subarray(0, fs.readSync(fd, buf, 0, HEAD_BYTES, 0)).toString('utf8');
    } finally {
      fs.closeSync(fd);
    }
  } catch (e) {
    return null;
  }
}

async function main() {
  let hook;
  try {
    hook = JSON.parse(fs.readFileSync(0, 'utf8'));
  } catch (e) {
    return;
  }
  const session = hook.session_id;
  const cwd = hook.cwd;
  const input = hook.tool_input && typeof hook.tool_input === 'object' ? hook.tool_input : {};
  const file = typeof input.file_path === 'string' ? input.file_path : null;

  if (hook.tool_name === 'Write') {
    if (file && DOC.test(file)) await post({ path: file, session, cwd });
    return;
  }
  // An asset upload or a non-publish action produces no shareable doc.
  if (hook.tool_name !== 'Artifact' || (input.action && input.action !== 'publish') || input.asset) return;
  const url = String(JSON.stringify(hook.tool_response) || '').match(/https:\/\/claude\.ai\/[^\s"'\\]+/);
  if (url) {
    const first = file && head(file);
    const title = (first && titleOf(file, first)) || (typeof input.title === 'string' && input.title) || url[0];
    await post({ url: url[0], title, kind: 'artifact', session, cwd });
  }
  // The published copy and the local source are two docs: the URL survives the worktree.
  if (file && DOC.test(file)) await post({ path: file, session, cwd });
}

main().catch(() => {}).then(() => process.exit(0));
