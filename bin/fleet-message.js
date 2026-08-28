#!/usr/bin/env node

const fs = require('fs');

function usage(message) {
  if (message) console.error('error: ' + message);
  console.error('usage: fleet-message --to claude-desktop:current|HOST:SESSION [--from SOURCE] [--for RECIPIENT] [TEXT]');
  process.exit(2);
}

const args = process.argv.slice(2);
let to;
let source = process.env.FLEETDECK_SOURCE || 'cli';
let id;
let recipient;
const words = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--to') to = args[++i];
  else if (args[i] === '--from') source = args[++i];
  else if (args[i] === '--id') id = args[++i];
  else if (args[i] === '--for') recipient = args[++i];
  else if (args[i] === '--help' || args[i] === '-h') usage();
  else words.push(args[i]);
}
if (!to) usage('--to is required');

let target;
if (to === 'claude-desktop:current')
  target = { type: 'claude-desktop', session: 'current', ...(recipient ? { label: recipient } : {}) };
else {
  const split = to.indexOf(':');
  if (split < 1 || split === to.length - 1) usage('--to must be claude-desktop:current or HOST:SESSION');
  target = { type: 'tmux', host: to.slice(0, split), session: to.slice(split + 1) };
}

const text = words.length ? words.join(' ') : fs.readFileSync(0, 'utf8');
if (!text.trim()) usage('message text is required as arguments or stdin');

const endpoint = new URL('/api/messages', process.env.FLEETDECK_URL || 'http://127.0.0.1:3131');
const headers = { 'content-type': 'application/json' };
if (process.env.FLEETDECK_BUS_TOKEN)
  headers.authorization = 'Bearer ' + process.env.FLEETDECK_BUS_TOKEN;

fetch(endpoint, {
  method: 'POST',
  headers,
  body: JSON.stringify({ ...(id ? { id } : {}), source, target, text }),
})
  .then(async (response) => {
    const result = await response.json().catch(() => ({ error: 'HTTP ' + response.status }));
    console.log(JSON.stringify(result));
    if (!response.ok || result.status === 'failed') process.exitCode = 1;
  })
  .catch((error) => {
    console.error('error: ' + error.message);
    process.exitCode = 1;
  });
