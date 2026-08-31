// The coordinator board over HTTP: eight read routes and one write.
//
// Every derived view — the bundle text, the live exceptions, the byte gate — is produced
// by spawning the Python that already computes it. There is no JavaScript copy of any of
// that arithmetic, because a second implementation is a second answer, and the whole point
// of the board is that there is one. The deck is a window onto the coordinator, not a
// reimplementation of it.
//
// The write surface is deliberately one file drop into the selected instance's `inbox/`. Nothing
// here edits board.json, and nothing here commits: the board changes only through a run, which
// is what makes the board's history auditable.

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

// The Python lives with the real board and imports its siblings by name, so the scripts are
// always resolved from the checkout and only the board path travels as an argument. A board
// root therefore needs a board and an inbox, nothing else.
const SCRIPT_DIR = path.join(__dirname, 'coordinator');
// Overridable the same way FLEET_SSH_BIN is, so a test can stand in a script that fails the way a
// missing or dying python3 does — the branch that must not answer with our argv.
const PYTHON_BIN = process.env.FLEET_PYTHON_BIN || 'python3';
const BUNDLE_PY = path.join(SCRIPT_DIR, 'bundle.py');
const EXCEPTIONS_PY = path.join(SCRIPT_DIR, 'exceptions.py');
const GATE_PY = path.join(SCRIPT_DIR, 'gate.py');

// cwd is the script dir so `import board_lib` resolves the same way it does on the CLI.
// maxBuffer is generous: the bundle is gated at 8KB but the raw exceptions JSON is not.
const PY_OPTS = { timeout: 15000, killSignal: 'SIGKILL', maxBuffer: 4 * 1024 * 1024, cwd: SCRIPT_DIR };

// --- instances ------------------------------------------------------------
//
// This checkout is the coordinator VENDOR, not a coordinator instance (operator ruling: "you are
// building the coordinator, you arent using it"). `coordinator/` here is the vendor's own frozen
// dev fixture: it binds nothing, and a deck that served it would hand a caller a board that looks
// real and is not. So there is no default board root any more. A deck serves the instances it was
// given, and a deck that was given none serves no board at all — 503, never the fixture.
//
// An instance name arrives from the query string, so it is untrusted. It is only ever a key into
// this map: never joined onto a path, never resolved, never turned into a directory name. That is
// why `?instance=../../etc` needs no sanitising — it is a key that is not in the map, and the
// answer is 404 without a single syscall.
//
// Selection is a query parameter rather than a path segment so every route stays the exact string
// it already was, and every existing caller keeps working unchanged.

// The same path as SCRIPT_DIR and a different fact about it: the scripts here are what the deck
// runs, and the board here is what the deck must never serve.
const VENDOR_DIR = path.join(__dirname, 'coordinator');
const ALLOW_VENDOR_FIXTURE = process.env.FLEET_COORDINATOR_ALLOW_VENDOR_FIXTURE === '1';
const LEGACY_DIR = (process.env.FLEET_COORDINATOR_DIR || '').trim();
const DEFAULT_INSTANCE = (process.env.FLEET_COORDINATOR_DEFAULT_INSTANCE || '').trim();

const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

// FLEET_COORDINATOR_INSTANCES is either the JSON itself or a path to a file holding it, told apart
// by whether it parses. A registry that will not load leaves the deck serving no instances rather
// than refusing to boot: this API is one surface of a process that also brokers every terminal in
// the fleet, and a typo in one env var must not take the terminals down with it. The boot line
// says so out loud instead.
function loadInstances() {
  const raw = (process.env.FLEET_COORDINATOR_INSTANCES || '').trim();
  if (!raw) return { instances: Object.create(null), error: '' };
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    let text;
    try {
      text = fs.readFileSync(raw, 'utf8');
    } catch (e) {
      return { instances: Object.create(null), error: 'unreadable(' + e.code + ')' };
    }
    try {
      parsed = JSON.parse(text);
    } catch {
      return { instances: Object.create(null), error: 'file-is-not-JSON' };
    }
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
    return { instances: Object.create(null), error: 'not-an-object' };

  // Null-prototype, and not for safety — has() already asks hasOwnProperty. On a plain `{}` the
  // assignment `instances['__proto__'] = dir` hits Object.prototype's __proto__ accessor, which
  // silently discards a string: the entry never becomes an own property, so the name is
  // unreachable AND unreported. A deck that drops part of its configuration without saying so is
  // the same class of bug as one that serves a fixture without saying so. With no prototype there
  // is no accessor to trap it, so every key is an ordinary own property. Do not "tidy" this to {}.
  const instances = Object.create(null);
  const skipped = [];
  for (const [name, dir] of Object.entries(parsed)) {
    // A relative path resolves against whatever cwd the deck happened to start in, which is not a
    // stable meaning for a board root. Dropped, not guessed at — and named in the boot line, so
    // nothing is ever discarded in silence.
    if (typeof dir === 'string' && dir && path.isAbsolute(dir)) instances[name] = dir;
    else skipped.push(name);
  }
  return { instances, error: skipped.length ? 'skipped-non-absolute:' + skipped.join(',') : '' };
}

const { instances: INSTANCES, error: REGISTRY_ERROR } = loadInstances();
const INSTANCE_NAMES = Object.keys(INSTANCES).sort();

// The name resolution falls back to, or null when there is none. FLEET_COORDINATOR_DIR is the
// unnamed single-instance form, so a deck configured that way has no default *name* even though
// it does resolve — the two are different questions and this one answers honestly.
function defaultName() {
  if (LEGACY_DIR) return null;
  if (DEFAULT_INSTANCE) return has(INSTANCES, DEFAULT_INSTANCE) ? DEFAULT_INSTANCE : null;
  return INSTANCE_NAMES.length === 1 ? INSTANCE_NAMES[0] : null;
}

const realpath = (p) => {
  try {
    return fs.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
};

// Real paths, not strings, so a symlink to the vendor checkout is caught too. Equality is not
// enough on its own either: a board root *inside* coordinator/ is the same fixture wearing a
// subdirectory.
function isVendorFixture(dir) {
  const real = realpath(dir);
  const vendor = realpath(VENDOR_DIR);
  return real === vendor || real.startsWith(vendor + path.sep);
}

// A board root's four files. Built per request, because which root is in play is a per-request
// question now; SCRIPT_DIR deliberately is not, and still resolves from this checkout.
const statePaths = (dir) => ({
  dir,
  board: path.join(dir, 'board.json'),
  inbox: path.join(dir, 'inbox'),
  northstar: path.join(dir, 'northstar.md'),
  decisions: path.join(dir, 'decisions-effective.md'),
});

// Returns { st } or { error, code }. Both failure codes are non-2xx, which is what the portal's
// documented file fallback keys on, and they are kept apart so an operator can read which one they
// have: 404 is "the board you asked for is not there", 503 is "this deck serves no boards".
function resolveInstance(req, deps) {
  const url = deps.url || new URL(req.url, 'http://localhost');
  const name = url.searchParams.get('instance');
  let dir;
  if (name) {
    if (!has(INSTANCES, name)) return { code: 404, error: 'unknown coordinator instance' };
    dir = INSTANCES[name];
  } else if (LEGACY_DIR) {
    dir = LEGACY_DIR;
  } else if (DEFAULT_INSTANCE) {
    // Named a default that is not configured: fail closed rather than silently serve some other
    // board, which is the whole class of bug this milestone exists to close.
    if (!has(INSTANCES, DEFAULT_INSTANCE))
      return { code: 503, error: 'default coordinator instance is not configured' };
    dir = INSTANCES[DEFAULT_INSTANCE];
  } else if (INSTANCE_NAMES.length === 1) {
    dir = INSTANCES[INSTANCE_NAMES[0]];
  } else if (INSTANCE_NAMES.length > 1) {
    return { code: 503, error: 'no coordinator instance selected — pass ?instance=<name>' };
  } else {
    return { code: 503, error: 'no coordinator instance configured' };
  }

  if (!ALLOW_VENDOR_FIXTURE && isVendorFixture(dir))
    return {
      code: 503,
      error:
        'refusing to serve the vendor fixture coordinator/ — this checkout builds the ' +
        'coordinator, it is not a coordinator instance ' +
        '(FLEET_COORDINATOR_ALLOW_VENDOR_FIXTURE=1 to override for local development)',
    };
  return { st: statePaths(dir) };
}

// Names only, never paths: this answers unauthenticated on the tailnet listener, and the paths
// would be a map of the host's directory layout. 200 with an empty list on an unconfigured deck —
// "what do you serve?" has an answer even when the answer is "nothing".
const instancesRoute = (res, deps) =>
  deps.json(res, { ok: true, instances: INSTANCE_NAMES, default: defaultName() });

// One line at boot, in the style of the lifecycle and role lines: a 503 from /api/coordinator/*
// should be explainable from the log alone.
const bootLine = () =>
  'coordinator: instances=' +
  INSTANCE_NAMES.length +
  (INSTANCE_NAMES.length ? ' (' + INSTANCE_NAMES.join(', ') + ')' : '') +
  ' default=' +
  (defaultName() || (LEGACY_DIR ? 'FLEET_COORDINATOR_DIR' : 'none')) +
  (REGISTRY_ERROR ? ' registry_error=' + REGISTRY_ERROR : '') +
  (ALLOW_VENDOR_FIXTURE ? ' vendor_fixture=allowed' : '');

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
const why = (r, board) =>
  (r.stderr || '')
    .split('\n')
    .filter((line) => line.startsWith('FAIL:'))
    .join(' · ')
    // The scripts name the board by the path they were handed, which is an absolute path on this
    // box. The caller already knows which board it asked for; it does not need our layout.
    .split(board)
    .join('board.json')
    .slice(0, 200);

// err.message from execFile is "Command failed: <the whole argv>\n<raw stderr>", so it can never
// be relayed: it carries this box's absolute paths and, on an uncaught exception, a traceback. When
// the script did not manage a FAIL: line of its own — it timed out, python3 is missing, something
// threw — the caller gets the shape of the failure and nothing else. The detail belongs in the
// deck's own log, not in an answer to an unauthenticated GET.
const reason = (r, board) =>
  why(r, board) ||
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
async function runPython(res, script, st, deps) {
  if (!fs.existsSync(st.board)) {
    deps.json(res, { ok: false, error: 'cannot read board.json' }, 404);
    return null;
  }
  const r = await run(PYTHON_BIN, [script, st.board], PY_OPTS);
  if (r.err) {
    deps.json(
      res,
      { ok: false, error: path.basename(script) + ' failed: ' + reason(r, st.board) },
      500
    );
    return null;
  }
  return r;
}

async function pythonJson(res, script, st, deps) {
  const r = await runPython(res, script, st, deps);
  if (!r) return;
  let parsed;
  try {
    parsed = JSON.parse(r.stdout);
  } catch {
    return deps.json(
      res,
      { ok: false, error: path.basename(script) + ' did not print JSON: ' + why(r, st.board) },
      500
    );
  }
  return deps.json(res, parsed);
}

function boardRoute(res, st, deps) {
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(st.board, 'utf8'));
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
function inboxEntry(inbox, name) {
  const full = path.join(inbox, name);
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

function inboxRoute(res, st, deps) {
  let names;
  try {
    names = fs
      .readdirSync(st.inbox, { withFileTypes: true })
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
  const pending = names
    .slice(0, INBOX_LIST_CAP)
    .map((n) => inboxEntry(st.inbox, n))
    .filter(Boolean);
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

// The file is a flat `key: value` block, so a line break inside a single-line value writes a second
// unindented line, and `event: "cleared\u2028state: closed"` becomes a forged `state:` header that a
// per-line parser reads as the seat's own declaration.
//
// "Line break" has to mean whatever the WIDEST consumer thinks it means, not whatever JavaScript
// does. Python's str.splitlines() — what the drain and any script reading these files uses — breaks
// on \v \f \x1c \x1d \x1e \x85 \u2028 and \u2029 as well as \n and \r. A blacklist of \r\n alone
// therefore leaves seven other ways to write the same forgery (ORCHESTRATOR 12, pre-weave review).
// So this is a whitelist in spirit: no C0 or C1 control character and neither Unicode separator may
// appear in any value, whatever some future consumer decides counts as a boundary. \n alone is
// carved out for the two prose fields, and renderSitrep indents what follows it.
const SEPARATORS = '\\x85\\u2028\\u2029';
const SCALAR_BAD = new RegExp('[\\x00-\\x1f\\x7f-\\x9f' + SEPARATORS + ']');
const PROSE_BAD = new RegExp('[\\x00-\\x09\\x0b-\\x1f\\x7f-\\x9f' + SEPARATORS + ']');

// Reaches here already typed, so every value is a string or a list of them.
const clean = (value, prose) =>
  (Array.isArray(value) ? value : [value]).every((v) => !(prose ? PROSE_BAD : SCALAR_BAD).test(v));

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
    if (!clean(payload[key], MULTILINE.includes(key)))
      return bad("'" + key + "' must not contain a line break or a control character");

  if (!SAFE_TOKEN.test(seatId(payload.seat))) return bad('seat id must be [A-Za-z0-9._-]');
  if (!SAFE_TOKEN.test(String(payload.lane).trim())) return bad('lane must be [A-Za-z0-9._-]');

  return { ok: true, value: payload };
}

// The event_time, not the write time: the file is named for when the thing happened, so two
// reports of the same event from the same seat collide instead of both landing.
const sitrepFilename = (value) =>
  String(value.event_time).trim() + '-' + seatId(value.seat) + '-' + String(value.lane).trim() + '.md';

const PAD = 13; // README block: every value starts at column 13, `seat:` plus eight spaces.

// Splits on exactly the class validateSitrep rejects, so the second line of defence covers the same
// ground as the first: anything that ever slips past validation still lands indented, never at
// column 0 where it could read as a header. CRLF leads the alternation so it counts as one break.
const LINE_BOUNDARY = new RegExp('\\r\\n|[\\n\\r\\v\\f\\x1c\\x1d\\x1e' + SEPARATORS + ']');

function lines(value) {
  return (Array.isArray(value) ? value : [value]).flatMap((v) => String(v).split(LINE_BOUNDARY));
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

async function sitrepPost(req, res, st, deps) {
  const { send, json, body, allowedOrigins } = deps;
  if (req.method !== 'POST') return send(res, 405, 'text/plain', 'method not allowed');
  const origin = req.headers.origin;
  if (origin && !allowedOrigins.has(origin)) return send(res, 403, 'text/plain', 'forbidden');
  const b = await body(req, 8192).catch(() => null);
  if (!b) return json(res, { ok: false, error: 'bad request body' }, 400);

  const checked = validateSitrep(b);
  if (!checked.ok) return json(res, { ok: false, error: checked.error }, 400);

  const filename = sitrepFilename(checked.value);
  const full = path.join(st.inbox, filename);
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

// Every route that reads or writes a board, so an unresolvable instance fails the whole group
// closed in one place while an unknown path keeps the plain 404 it always had.
const BOARD_ROUTES = new Set([
  '/api/coordinator/sitrep',
  '/api/coordinator/board',
  '/api/coordinator/northstar',
  '/api/coordinator/decisions',
  '/api/coordinator/inbox',
  '/api/coordinator/bundle',
  '/api/coordinator/exceptions',
  '/api/coordinator/gate',
]);

async function coordinatorRoute(req, res, p, deps) {
  const { send, json } = deps;
  // Answerable without an instance, by design: it is the question "what do you serve?".
  if (p === '/api/coordinator/instances')
    return req.method === 'GET'
      ? instancesRoute(res, deps)
      : send(res, 405, 'text/plain', 'method not allowed');

  if (!BOARD_ROUTES.has(p)) return send(res, 404, 'text/plain', 'not found');
  // Ahead of the method check on purpose: the group fails closed as one unit, so a write to an
  // unresolvable deck is told "this deck serves no board" (503) rather than "wrong method" (405).
  // The 503 is the actionable half. On a deck that does resolve, the 405 below still answers.
  const sel = resolveInstance(req, deps);
  if (sel.error) return json(res, { ok: false, error: sel.error }, sel.code);
  const st = sel.st;

  if (p === '/api/coordinator/sitrep') return await sitrepPost(req, res, st, deps);
  // Reads are open like /api/sessions: they carry no authority and no Origin.
  if (req.method !== 'GET') return send(res, 405, 'text/plain', 'method not allowed');

  if (p === '/api/coordinator/board') return boardRoute(res, st, deps);
  if (p === '/api/coordinator/northstar') return readText(res, st.northstar, MARKDOWN, deps);
  if (p === '/api/coordinator/decisions') return readText(res, st.decisions, MARKDOWN, deps);
  if (p === '/api/coordinator/inbox') return inboxRoute(res, st, deps);
  if (p === '/api/coordinator/bundle') {
    const r = await runPython(res, BUNDLE_PY, st, deps);
    return r && send(res, 200, 'text/plain; charset=utf-8', r.stdout);
  }
  // No --apply, ever: that flag writes the board, and a GET must not move the board. The
  // list is recomputed per request for the same reason the bundle is — a cached exception
  // set ages into a lie, and silence would read as health.
  if (p === '/api/coordinator/exceptions') return await pythonJson(res, EXCEPTIONS_PY, st, deps);
  if (p === '/api/coordinator/gate') return await pythonJson(res, GATE_PY, st, deps);

  return send(res, 404, 'text/plain', 'not found');
}

module.exports = { coordinatorRoute, validateSitrep, renderSitrep, sitrepFilename, bootLine };
