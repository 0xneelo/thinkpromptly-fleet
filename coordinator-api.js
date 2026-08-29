// The coordinator board over HTTP: seven read routes and one write.
//
// Every derived view — the bundle text, the live exceptions, the byte gate — is produced
// by spawning the Python that already computes it. There is no JavaScript copy of any of
// that arithmetic, because a second implementation is a second answer, and the whole point
// of the board is that there is one. The deck is a window onto the coordinator, not a
// reimplementation of it.
//
// The write surface is deliberately one file drop into `coordinator/inbox/`. Nothing here
// edits board.json, and nothing here commits: the board changes only through a run, which
// is what makes the board's history auditable.

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

// Data — board.json, the two prose files, inbox/ — is overridable so a test can point the
// routes at a fixture directory. The Python lives with the real board and imports its
// siblings by name, so the scripts are always resolved from the checkout and only the board
// path travels as an argument. A fixture therefore needs a board and an inbox, nothing else.
const COORDINATOR_DIR = process.env.FLEET_COORDINATOR_DIR || path.join(__dirname, 'coordinator');
const SCRIPT_DIR = path.join(__dirname, 'coordinator');

const BOARD = path.join(COORDINATOR_DIR, 'board.json');
const INBOX = path.join(COORDINATOR_DIR, 'inbox');
const NORTHSTAR = path.join(COORDINATOR_DIR, 'northstar.md');
const DECISIONS = path.join(COORDINATOR_DIR, 'decisions-effective.md');
// Overridable the same way FLEET_SSH_BIN is, so a test can stand in a script that fails the way a
// missing or dying python3 does — the branch that must not answer with our argv.
const PYTHON_BIN = process.env.FLEET_PYTHON_BIN || 'python3';
const BUNDLE_PY = path.join(SCRIPT_DIR, 'bundle.py');
const EXCEPTIONS_PY = path.join(SCRIPT_DIR, 'exceptions.py');
const GATE_PY = path.join(SCRIPT_DIR, 'gate.py');

// cwd is the script dir so `import board_lib` resolves the same way it does on the CLI.
// maxBuffer is generous: the bundle is gated at 8KB but the raw exceptions JSON is not.
const PY_OPTS = { timeout: 15000, killSignal: 'SIGKILL', maxBuffer: 4 * 1024 * 1024, cwd: SCRIPT_DIR };

// Never rejects: a Python that exits non-zero is a result to inspect, not an exception.
function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    execFile(cmd, args, opts, (err, stdout, stderr) =>
      resolve({ err, stdout: stdout || '', stderr: stderr || '' })
    );
  });
}

// The coordinator scripts report their own errors as `FAIL: <what>` lines, so those are the only
// stderr worth relaying. Anything else is a Python traceback, which carries absolute paths and line
// numbers of ours to a caller who has no business seeing them — a GET here is unauthenticated on
// both listeners, so a malformed board must not turn into a map of the box.
const why = (r) =>
  (r.stderr || '')
    .split('\n')
    .filter((line) => line.startsWith('FAIL:'))
    .join(' · ')
    // The scripts name the board by the path they were handed, which is an absolute path on this
    // box. The caller already knows which board it asked for; it does not need our layout.
    .split(BOARD)
    .join('board.json')
    .slice(0, 200);

// err.message from execFile is "Command failed: <the whole argv>\n<raw stderr>", so it can never
// be relayed: it carries this box's absolute paths and, on an uncaught exception, a traceback. When
// the script did not manage a FAIL: line of its own — it timed out, python3 is missing, something
// threw — the caller gets the shape of the failure and nothing else. The detail belongs in the
// deck's own log, not in an answer to an unauthenticated GET.
const reason = (r) =>
  why(r) ||
  (r.err.killed ? 'timed out' : 'exited ' + (r.err.code === undefined ? 'abnormally' : r.err.code));

const MARKDOWN = 'text/markdown; charset=utf-8';

// --- reads ----------------------------------------------------------------

function readText(res, file, type, deps) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return deps.json(res, { ok: false, error: 'cannot read ' + path.basename(file) }, 404);
  }
  return deps.send(res, 200, type, text);
}

// Spawn a coordinator script over the board. Returns null once it has already answered, so
// every caller must bail on null rather than send a second response.
//
// bundle.py prints a WARN to stderr when the board's stored exceptions snapshot has drifted
// from live state. That warning is the script working correctly — the snapshot is provenance
// and the bundle ignores it — so only a non-zero exit counts as a failure here.
async function runPython(res, script, deps) {
  if (!fs.existsSync(BOARD)) {
    deps.json(res, { ok: false, error: 'cannot read board.json' }, 404);
    return null;
  }
  const r = await run(PYTHON_BIN, [script, BOARD], PY_OPTS);
  if (r.err) {
    deps.json(res, { ok: false, error: path.basename(script) + ' failed: ' + reason(r) }, 500);
    return null;
  }
  return r;
}

async function pythonJson(res, script, deps) {
  const r = await runPython(res, script, deps);
  if (!r) return;
  let parsed;
  try {
    parsed = JSON.parse(r.stdout);
  } catch {
    return deps.json(
      res,
      { ok: false, error: path.basename(script) + ' did not print JSON: ' + why(r) },
      500
    );
  }
  return deps.json(res, parsed);
}

function boardRoute(res, deps) {
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(BOARD, 'utf8'));
  } catch (e) {
    const missing = e.code === 'ENOENT';
    return deps.json(
      res,
      { ok: false, error: missing ? 'cannot read board.json' : 'board.json is not valid JSON' },
      missing ? 404 : 500
    );
  }
  return deps.json(res, parsed);
}

// Listing metadata only. The scrape is best-effort by design: a file that does not yield a
// seat or lane still shows up as pending, because deciding what is malformed belongs to the
// run that applies it, not to a list view that would otherwise hide the file from everyone.
const HEAD_FIELD = /^(seat|lane|event):[ \t]*(.*)$/gm;

// Oldest-first is what the drain order depends on, so the cap keeps the oldest, never a sample.
const INBOX_LIST_CAP = 500;

// A run drains the inbox while the portal reads it, so any file named by the listing may be gone
// by the time we stat it. That is the normal case, not an error: the file was applied.
function inboxEntry(name) {
  const full = path.join(INBOX, name);
  const entry = { name, mtime: null, seat: null, lane: null, event: null };
  let head = '';
  try {
    entry.mtime = fs.statSync(full).mtime.toISOString();
    head = fs.readFileSync(full, 'utf8').slice(0, 2048);
  } catch {
    return null;
  }
  for (const m of head.matchAll(HEAD_FIELD)) {
    const value = m[2].trim();
    if (entry[m[1]] === null && value) entry[m[1]] = value;
  }
  return entry;
}

function inboxRoute(res, deps) {
  let names;
  try {
    names = fs
      .readdirSync(INBOX, { withFileTypes: true })
      .filter((d) => d.isFile() && d.name.endsWith('.md') && d.name !== 'README.md')
      .map((d) => d.name);
  } catch {
    return deps.json(res, { ok: false, error: 'cannot read inbox/' }, 404);
  }
  // The ISO time leads the filename and every accepted event_time is UTC, so a plain string sort
  // is genuinely oldest-first; mtime settles any file that did not come through this API.
  names.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  // Reading every pending file blocks the event loop, which this process also owes to the terminal
  // websockets. A healthy inbox holds a handful of files; a listing that has to page is already
  // telling the operator the thing they need to know, so cap it rather than stall the deck.
  const truncated = names.length > INBOX_LIST_CAP;
  const pending = names.slice(0, INBOX_LIST_CAP).map(inboxEntry).filter(Boolean);
  pending.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : (a.mtime || '') < (b.mtime || '') ? -1 : 1));
  return deps.json(res, { ok: true, pending, total: names.length, truncated });
}

// --- sitrep intake --------------------------------------------------------

const KEY_ORDER = ['seat', 'lane', 'event', 'event_time', 'state', 'delta', 'blockers',
  'evidence', 'ruled_out', 'next_report'];
const REQUIRED = ['seat', 'lane', 'event', 'event_time', 'state', 'blockers', 'next_report'];
const STATES = ['active', 'blocked', 'done-claimed', 'closed'];
// The filename is built from the seat id and the lane, so this character class is the entire
// path-traversal guard on the write path. There is no second one downstream.
const SAFE_TOKEN = /^[A-Za-z0-9._-]+$/;
// One form only: UTC, seconds, trailing Z — exactly what board_lib.to_iso writes. parse_iso is
// far more forgiving, but the event_time leads the filename and the drain reads filename order as
// chronological order, which anything wider breaks silently and in both directions.
// `...T23:00:00+05:00` happened two hours BEFORE `...T20:00:00Z` yet sorts after it; and
// `...T12:00Z` is a second BEFORE `...T12:00:01Z` yet also sorts after it, because ':' < 'Z'. A
// caller in another zone converts. Narrowing is safe — the run accepts a superset of this.
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const ISO_FORM = 'UTC ISO-8601, e.g. 2026-08-29T12:00:00Z';

const seatId = (seat) => String(seat).trim().split(/\s+/)[0];

const isoOk = (value) =>
  typeof value === 'string' && ISO.test(value.trim()) && Number.isFinite(Date.parse(value.trim()));

const present = (value) =>
  Array.isArray(value)
    ? true
    : typeof value === 'string'
      ? value.trim() !== ''
      : value !== undefined && value !== null;

// delta and ruled_out are the only fields the README describes as prose over several lines.
const MULTILINE = ['delta', 'ruled_out'];

// The file is a flat `key: value` block, so a line break inside a single-line value would write a
// second unindented line — and `blockers: "ok\nstate: closed"` becomes a forged `state:` header
// that a per-line parser reads as the seat's own declaration. Rejecting the break is the fix;
// renderSitrep indenting continuations is only the second line of defence. Reaches here already
// typed, so every value is a string or a list of them.
const flat = (value) => (Array.isArray(value) ? value : [value]).every((v) => !/[\r\n]/.test(v));

const nonEmpty = (value) =>
  Array.isArray(value)
    ? value.some((v) => typeof v === 'string' && v.trim() !== '')
    : typeof value === 'string' && value.trim() !== '';

// Reject, never best-effort parse (README, DESIGN §3): a sitrep that half-parses puts a
// half-truth on the board, and the seat that sent it never learns which half was dropped.
function validateSitrep(payload) {
  // Reasons interpolate the caller's own key names, so the collapse happens here rather than at
  // each site: a one-line reason has to stay one line even when the thing being named is not.
  const bad = (error) => ({ ok: false, error: String(error).replace(/\s+/g, ' ').slice(0, 200) });
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload))
    return bad('body must be a JSON object');

  for (const key of Object.keys(payload))
    if (!KEY_ORDER.includes(key)) return bad("unknown key '" + key + "'");

  for (const key of REQUIRED)
    // blockers is level-triggered and carries the full current list, so [] is a real answer
    // ("nothing blocks this lane") and must not read as a missing key.
    if (!(key in payload) || !present(payload[key]))
      return bad("missing required key '" + key + "'");

  // Every field is prose or a list of prose. Typing them all means flat() below only ever has to
  // reason about strings, and renderSitrep never String()s an object into the file.
  const textish = (v) =>
    typeof v === 'string' || (Array.isArray(v) && v.every((e) => typeof e === 'string'));
  for (const key of Object.keys(payload))
    if (!textish(payload[key])) return bad("'" + key + "' must be a string or an array of strings");

  if (!STATES.includes(payload.state)) return bad('state must be one of ' + STATES.join(', '));
  if (!isoOk(payload.event_time)) return bad('event_time must be ' + ISO_FORM);
  if (!isoOk(payload.next_report)) return bad('next_report must be ' + ISO_FORM);
  if (payload.state === 'done-claimed' && !nonEmpty(payload.evidence))
    return bad('evidence is required when state is done-claimed');

  for (const key of Object.keys(payload))
    if (!MULTILINE.includes(key) && !flat(payload[key]))
      return bad("'" + key + "' must not contain a line break");

  if (!SAFE_TOKEN.test(seatId(payload.seat))) return bad('seat id must be [A-Za-z0-9._-]');
  if (!SAFE_TOKEN.test(String(payload.lane).trim())) return bad('lane must be [A-Za-z0-9._-]');

  return { ok: true, value: payload };
}

// The event_time, not the write time: the file is named for when the thing happened, so two
// reports of the same event from the same seat collide instead of both landing.
const sitrepFilename = (value) =>
  String(value.event_time).trim() + '-' + seatId(value.seat) + '-' + String(value.lane).trim() + '.md';

const PAD = 13; // README block: every value starts at column 13, `seat:` plus eight spaces.

function lines(value) {
  if (Array.isArray(value)) return value.flatMap((v) => String(v).split('\n'));
  return String(value).split('\n');
}

function renderSitrep(value) {
  const out = [];
  for (const key of KEY_ORDER) {
    if (!(key in value)) continue;
    const label = (key + ':').padEnd(PAD, ' ');
    // blockers is one line: the FULL current list, or `none` when nothing blocks the lane. It
    // still goes through lines(), so even a value that slipped past validation cannot start a
    // line at column 0.
    const raw = key === 'blockers' && Array.isArray(value[key])
      ? value[key].join(', ') || 'none'
      : value[key];
    const body = lines(raw);
    out.push(label + body[0]);
    for (const cont of body.slice(1)) out.push(' '.repeat(PAD) + cont);
  }
  return out.join('\n') + '\n';
}

async function sitrepPost(req, res, deps) {
  const { send, json, body, allowedOrigins } = deps;
  if (req.method !== 'POST') return send(res, 405, 'text/plain', 'method not allowed');
  const origin = req.headers.origin;
  if (origin && !allowedOrigins.has(origin)) return send(res, 403, 'text/plain', 'forbidden');
  const b = await body(req, 8192).catch(() => null);
  if (!b) return json(res, { ok: false, error: 'bad request body' }, 400);

  const checked = validateSitrep(b);
  if (!checked.ok) return json(res, { ok: false, error: checked.error }, 400);

  const filename = sitrepFilename(checked.value);
  const full = path.join(INBOX, filename);
  try {
    // wx, so an existing file is never overwritten: the inbox is a durable record of what a
    // seat said, and a silent replacement would erase the earlier claim without a trace.
    fs.writeFileSync(full, renderSitrep(checked.value), { flag: 'wx' });
  } catch (e) {
    if (e.code === 'EEXIST')
      return json(
        res,
        { ok: false, error: 'a sitrep for that event_time, seat and lane already exists' },
        409
      );
    return json(res, { ok: false, error: 'cannot write to inbox/: ' + e.code }, 500);
  }
  return json(res, { ok: true, file: filename, path: full }, 201);
}

// --- dispatch -------------------------------------------------------------

async function coordinatorRoute(req, res, p, deps) {
  const { send, json } = deps;
  if (p === '/api/coordinator/sitrep') return await sitrepPost(req, res, deps);
  // Reads are open like /api/sessions: they carry no authority and no Origin.
  if (req.method !== 'GET') return send(res, 405, 'text/plain', 'method not allowed');

  if (p === '/api/coordinator/board') return boardRoute(res, deps);
  if (p === '/api/coordinator/northstar') return readText(res, NORTHSTAR, MARKDOWN, deps);
  if (p === '/api/coordinator/decisions') return readText(res, DECISIONS, MARKDOWN, deps);
  if (p === '/api/coordinator/inbox') return inboxRoute(res, deps);
  if (p === '/api/coordinator/bundle') {
    const r = await runPython(res, BUNDLE_PY, deps);
    return r && send(res, 200, 'text/plain; charset=utf-8', r.stdout);
  }
  // No --apply, ever: that flag writes the board, and a GET must not move the board. The
  // list is recomputed per request for the same reason the bundle is — a cached exception
  // set ages into a lie, and silence would read as health.
  if (p === '/api/coordinator/exceptions') return await pythonJson(res, EXCEPTIONS_PY, deps);
  if (p === '/api/coordinator/gate') return await pythonJson(res, GATE_PY, deps);

  return send(res, 404, 'text/plain', 'not found');
}

module.exports = { coordinatorRoute, validateSitrep, renderSitrep, sitrepFilename, COORDINATOR_DIR };
