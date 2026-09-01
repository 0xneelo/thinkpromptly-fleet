#!/usr/bin/env node

const fs = require('fs');

function usage(message) {
  if (message) console.error('error: ' + message);
  console.error('usage: fleet-notify send --to ALIAS --from SENDER [--no-ack] [--timeout SEC] [TEXT]');
  console.error('       fleet-notify ack ID --from NAME [RESPONSE]');
  process.exit(2);
}

const args = process.argv.slice(2);
const command = args.shift();
if (command !== 'send' && command !== 'ack') usage('first argument must be send or ack');

let to;
let from;
let expectAck = true;
let timeout = 120;
const words = [];
// A swallowed flag would silently become the value of the previous one — a notify sent --to
// "--from" is a misdelivery, so a missing or flag-shaped value is a usage error.
function value(i) {
  const v = args[i];
  if (v === undefined || v.startsWith('--')) usage(args[i - 1] + ' requires a value');
  return v;
}
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--to') to = value(++i);
  else if (args[i] === '--from') from = value(++i);
  else if (args[i] === '--no-ack') expectAck = false;
  else if (args[i] === '--timeout') timeout = Number(value(++i));
  else if (args[i] === '--help' || args[i] === '-h') usage();
  else words.push(args[i]);
}
// Never defaulted: an ACK or a notify attributed to the wrong agent is worse than a failed send.
if (!from) usage('--from is required');

const base = process.env.FLEETDECK_URL || 'http://127.0.0.1:3131';
const headers = { 'content-type': 'application/json' };
if (process.env.FLEETDECK_BUS_TOKEN)
  headers.authorization = 'Bearer ' + process.env.FLEETDECK_BUS_TOKEN;

async function call(method, route, payload) {
  const response = await fetch(new URL(route, base), {
    method,
    headers,
    ...(payload ? { body: JSON.stringify(payload) } : {}),
  });
  const result = await response.json().catch(() => ({ error: 'HTTP ' + response.status }));
  return { ok: response.ok, result };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function send() {
  if (!to) usage('--to is required');
  if (!Number.isFinite(timeout) || timeout <= 0) usage('--timeout must be a positive number of seconds');
  const text = words.length ? words.join(' ') : fs.readFileSync(0, 'utf8');
  if (!text.trim()) usage('message text is required as arguments or stdin');

  const posted = await call('POST', '/api/notify', { to, from, text, expectAck });
  if (!posted.ok) {
    console.log(JSON.stringify(posted.result));
    return 2;
  }
  const { id, resolvedTarget } = posted.result;
  let delivered = posted.result.status === 'delivered';
  let row = null;
  // Delivery may still be retrying after the POST answered, so poll for both facts at once.
  const deadline = Date.now() + timeout * 1000;
  let failures = 0;
  while ((expectAck || !delivered) && Date.now() < deadline) {
    await sleep(5000);
    const got = await call('GET', '/api/notify/' + id);
    if (!got.ok) break;
    row = got.result;
    delivered = row.delivery === 'delivered';
    if (row.ack_at) break;
    // Two server-side auto-retries, ~5s apart: still failed after that is final, not just slow.
    if (row.delivery === 'failed' && ++failures >= 3) break;
  }
  const acked = !!(row && row.ack_at);
  console.log(
    JSON.stringify({
      id,
      resolvedTarget,
      delivered,
      acked,
      ackFrom: (row && row.ack_from) || null,
      ackResponse: (row && row.ack_response) || null,
    })
  );
  if (!delivered) return 2;
  return expectAck && !acked ? 1 : 0;
}

async function ack() {
  const id = words.shift();
  if (!id) usage('ack requires a notify id');
  const response = words.join(' ');
  const posted = await call('POST', '/api/notify/' + id + '/ack', { from, response });
  console.log(JSON.stringify(posted.result));
  return posted.ok ? 0 : 2;
}

(command === 'send' ? send() : ack())
  .then((code) => (process.exitCode = code))
  .catch((error) => {
    console.error('error: ' + error.message);
    process.exitCode = 2;
  });
