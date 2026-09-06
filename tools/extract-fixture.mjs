#!/usr/bin/env node
// Extracts the mock's seed arrays into public/v2/fixture.js.
//
// The seeds are not JSON: they live inside AppLogic.renderVals() and mix plain data with theme
// helpers (dot/chipTone/t.*) and behaviour (arrow functions). We slice each literal's source text
// by bracket matching, evaluate it in a vm sandbox whose helpers are stubs, then drop everything
// that came from a helper or is a function — leaving layer 1, the data, only.
//
// Usage: node tools/extract-fixture.mjs [--check]

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MOCK = 'docs/design/fleetdeck-v2/mock/Fleetdeck Final.dc.html';
const OUT = 'public/v2/fixture.js';

// name -> declaration text to locate. Must occur exactly once in the mock; the slice starts at the
// first '[' or '{' at or after the match and ends at its bracket match. For the .map()-chained
// seeds (tiles, accounts, machines) that stops at the ']' before .map(, dropping the behaviour layer.
const SEEDS = {
  gbSessions: 'const gbSessions = [', // first: `groups` references it
  tiles: 'tiles: [\n',
  groups: 'groups: [\n',
  regData: 'const regData = [',
  busSessions: 'const busSessions = [',
  busGroups: 'const busGroups = [',
  seedThreads: 'const seedThreads = {',
  orgScopeData: 'const orgScopeData = {',
  keyRows: 'keyRows: [\n',
  accounts: 'accounts: [\n',
  machines: 'machines: [\n',
  dsData: 'const dsData = [',
  titles: 'const titles = {',
};

// Emitted key order of fixture.js.
const ORDER = ['tiles', 'groups', 'regData', 'busSessions', 'busGroups', 'seedThreads',
  'orgScopeData', 'keyRows', 'accounts', 'machines', 'dsData', 'titles', 'gbSessions'];

const OPEN = { '[': ']', '{': '}' };

// Bracket-match from `start` (an index of '[' or '{'), skipping strings, template literals and
// comments. Regex literals are not handled — none occur inside the seed literals.
function matchBracket(src, start) {
  const stack = [];
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') { i = src.indexOf('\n', i); if (i < 0) break; continue; }
    if (c === '/' && src[i + 1] === '*') { i = src.indexOf('*/', i + 2) + 1; if (i < 1) break; continue; }
    if (c === "'" || c === '"' || c === '`') { i = skipString(src, i); continue; }
    if (OPEN[c]) { stack.push(OPEN[c]); continue; }
    if (c === ']' || c === '}') {
      if (stack.pop() !== c) throw new Error(`unbalanced bracket at offset ${i} in ${MOCK}`);
      if (!stack.length) return i;
    }
  }
  throw new Error(`no closing bracket for the literal at offset ${start} in ${MOCK}`);
}

// Returns the index of the closing quote of the string starting at `i`.
function skipString(src, i) {
  const quote = src[i];
  for (let j = i + 1; j < src.length; j++) {
    const c = src[j];
    if (c === '\\') { j++; continue; }
    if (c === quote) return j;
    if (quote === '`' && c === '$' && src[j + 1] === '{') { j = matchBracket(src, j + 1); continue; }
  }
  throw new Error(`unterminated string at offset ${i} in ${MOCK}`);
}

function sliceLiteral(src, name, decl) {
  const at = src.indexOf(decl);
  if (at < 0) throw new Error(`seed "${name}": declaration ${JSON.stringify(decl)} not found in ${MOCK} — the mock changed, fix tools/extract-fixture.mjs`);
  if (src.indexOf(decl, at + 1) >= 0) throw new Error(`seed "${name}": declaration ${JSON.stringify(decl)} is ambiguous (occurs more than once) in ${MOCK}`);
  let open = at;
  while (open < src.length && !OPEN[src[open]]) open++;
  if (open >= src.length) throw new Error(`seed "${name}": no '[' or '{' after its declaration in ${MOCK}`);
  return src.slice(open, matchBracket(src, open) + 1);
}

// Anything a presentation helper returns. Every key holding it is dropped.
const STYLE = Object.freeze({ __style: true });

function makeContext() {
  // t.<anything> is a theme token: presentation, never data.
  const t = new Proxy({}, { get: () => STYLE });
  const ctx = {
    t,
    mono: STYLE,
    goneName: STYLE,
    dot: () => STYLE,
    pill: () => STYLE,
    chipTone: () => STYLE,
    check: () => STYLE,
    barFill: () => STYLE,
    navBtn: () => STYLE,
    selChip: () => STYLE,
    iconBtn: STYLE,
    // Data-bearing helpers: return their arguments, keyed by the real parameter names.
    bar: (label, pct, resets, stale) => ({ label, pct, resets, stale }),
    spark: (arr) => arr, // the polyline it builds is presentation; the numbers are the data
    mSec: (env, name, email, chips, bars, note) => ({ env, name, email, chips, bars, note }),
    orgMeta: (epoch, lease, leaseTone, age, exp, expTone) => ({ epoch, lease, leaseTone, age, exp, expTone }),
    orgCard: (name, on, role, path, grp, epoch, lease, leaseTone, age, exp, expTone) =>
      ({ name, on, role, path, grp, epoch, lease, leaseTone, age, exp, expTone }),
  };
  return vm.createContext(ctx);
}

function evaluate(ctx, name, src) {
  const fn = vm.runInContext(`(function () { return (${src}); })`, ctx, { filename: `mock:${name}` });
  // `this.state` is empty, so spreads of component state (busGroups) contribute nothing.
  return fn.call({ state: {}, props: {} });
}

const DROP = Symbol('drop');

// Inline CSS objects the mock builds from literals plus concatenated theme tokens (accounts[].
// bannerStyle) never equal the sentinel, so they are also caught by the mock's naming convention:
// every presentation key is named `style` or `<something>Style`, and no data key is.
const STYLE_KEY = /^style$|Style$/;

// Keeps data, drops presentation and behaviour: any value that is a style sentinel, a function or
// undefined, plus any object left empty once its own keys were dropped (e.g. `style: {color: t.ink75}`).
function clean(value, path) {
  if (value === STYLE || typeof value === 'function' || value === undefined) return DROP;
  if (Array.isArray(value)) {
    return value.map((v, i) => {
      const c = clean(v, `${path}[${i}]`);
      if (c === DROP) throw new Error(`${path}[${i}] reduced to nothing — a data element looks like presentation; check the stubs`);
      return c;
    });
  }
  if (value && typeof value === 'object') {
    const out = {};
    let kept = 0;
    for (const [k, v] of Object.entries(value)) {
      const c = STYLE_KEY.test(k) ? DROP : clean(v, `${path}.${k}`);
      if (c === DROP) continue;
      out[k] = c;
      kept++;
    }
    return Object.keys(value).length > 0 && kept === 0 ? DROP : out;
  }
  return value;
}

function extract() {
  const src = readFileSync(join(ROOT, MOCK), 'utf8');
  const ctx = makeContext();
  const out = {};
  for (const [name, decl] of Object.entries(SEEDS)) {
    const value = clean(evaluate(ctx, name, sliceLiteral(src, name, decl)), name);
    if (value === DROP) throw new Error(`seed "${name}" extracted to nothing — check the stubs`);
    out[name] = value;
    ctx[name] = value; // later seeds may reference earlier ones (groups uses gbSessions)
  }
  return out;
}

function render(seeds) {
  const body = ORDER.map((k) => {
    if (!(k in seeds)) throw new Error(`seed "${k}" is in the output order but was not extracted`);
    return `    ${k}: ${JSON.stringify(seeds[k], null, 2).split('\n').join('\n    ')},`;
  }).join('\n');
  return `// GENERATED FILE — DO NOT EDIT BY HAND.
// Source: ${MOCK}
// Tool:   tools/extract-fixture.mjs   ·   regenerate with: npm run v2:fixture
// Seed data only: theme styles and behaviour handlers from the mock are deliberately not extracted.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.FD = root.FD || {};
  root.FD.fixture = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  return {
${body}
  };
});
`;
}

const text = render(extract());
const outPath = join(ROOT, OUT);

if (process.argv.includes('--check')) {
  let onDisk = null;
  try { onDisk = readFileSync(outPath, 'utf8'); } catch (e) { onDisk = null; }
  if (onDisk !== text) {
    console.error(`${OUT} is stale${onDisk === null ? ' (missing)' : ''} — run: npm run v2:fixture`);
    process.exit(1);
  }
  console.log(`${OUT} is up to date`);
} else {
  writeFileSync(outPath, text);
  console.log(`wrote ${OUT}`);
}
