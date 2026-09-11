// Every API call the fleetdeck makes, wrapped once. URLs, methods and bodies are
// copied verbatim from the current callers (app.js, keys.js, accounts.js,
// machines.js, sessions.js) — this file is a re-wrapping, not a redesign.
(function (root, factory) {
  const api = factory(root);
  root.FD = root.FD || {};
  root.FD.data = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof globalThis === 'object' ? globalThis : this, function (root) {
  const JSON_HEADERS = { 'content-type': 'application/json' };

  // Resolved per call, never captured at load time, so tests can set
  // FD.data._fetch after the file loads and Node without fetch still parses.
  function currentFetch() {
    const injected = api._fetch || (root.FD && root.FD.data && root.FD.data._fetch);
    const impl = injected || root.fetch;
    if (typeof impl !== 'function') throw new Error('no fetch available');
    return impl;
  }

  const ok = (res) => (typeof res.ok === 'boolean' ? res.ok : res.status >= 200 && res.status < 300);

  // Reading the body must never throw, so a body that cannot be read leaves ''
  // rather than masking the HTTP status with a read or parse error. res.text may
  // be missing entirely on a minimal response double or a polyfill.
  async function readBody(res) {
    if (!res || typeof res.text !== 'function') return '';
    return Promise.resolve()
      .then(() => res.text())
      .catch(() => '');
  }

  async function httpError(res, url) {
    const text = await readBody(res);
    let body = text;
    try {
      body = JSON.parse(text);
    } catch { /* not JSON: keep the raw text */ }
    const err = new Error('HTTP ' + res.status + ' ' + url);
    err.status = res.status;
    err.body = body;
    return err;
  }

  async function request(url, init) {
    const res = await currentFetch()(url, init);
    if (!ok(res)) throw await httpError(res, url);
    return res;
  }

  // A 2xx whose body will not parse is still a failure, and it must reject with
  // the same {status, body} shape as an HTTP error rather than a bare SyntaxError.
  async function parseJson(res, url) {
    if (typeof res.json === 'function') {
      try {
        return await res.json();
      } catch { /* fall through and report the raw body */ }
    }
    const text = await readBody(res);
    try {
      return JSON.parse(text);
    } catch {
      const err = new Error('bad JSON from ' + url);
      err.status = res.status;
      err.body = text;
      throw err;
    }
  }

  const getJson = (url) => request(url).then((res) => parseJson(res, url));
  const getText = (url) => request(url).then((res) => res.text());
  const postJson = (url, body) =>
    request(url, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(body) })
      .then((res) => parseJson(res, url));

  // Kept as string concatenation so a refresh-less call is exactly '/api/x',
  // with no trailing '?' — the current callers build the URL the same way.
  const refreshed = (path, opts) => path + (opts && opts.refresh ? '?refresh=1' : '');

  const api = {
    sessions: () => getJson('/api/sessions'),
    health: () => getJson('/api/health'),
    credits: (opts = {}) => getJson(refreshed('/api/credits', opts)),
    seats: () => getJson('/api/seats'),
    messages: ({ limit = 50 } = {}) => getJson('/api/messages?limit=' + limit),
    sendMessage: (body) => postJson('/api/messages', body),
    retryMessage: (id) => postJson('/api/messages/retry', { id }),
    registryUpsert: (row) => postJson('/api/registry', row),
    registryDelete: (row) => postJson('/api/registry/delete', { host: row.host, name: row.name }),
    kill: (row) => postJson('/api/kill', { host: row.host, name: row.name }),
    sshkeys: () => getJson('/api/sshkeys'),
    mintCert: (body) => postJson('/api/sshkeys/mint', body),
    deleteKey: (body) => postJson('/api/sshkeys/delete', body),
    ghtrain: () => getJson('/api/ghtrain'),
    startTrain: (body) => postJson('/api/ghtrain', body),
    endTrain: () => postJson('/api/ghtrain/end', {}),
    machines: (opts = {}) => getJson(refreshed('/api/machines', opts)),
    desktopSessions: (opts = {}) => getJson(refreshed('/api/desktop-sessions', opts)),
    // Transcripts are plain text, not JSON — sessions.js:214 reads r.text(). A bus thread id
    // asks for the per-turn JSON the message bus merges into a thread instead, and resolves a
    // state rather than rejecting: the bus renders the state as a note.
    // `host` is set for a tmux thread only: it is what tells the route the seat is a tmux
    // session on that machine rather than a Claude Desktop seat.
    transcript: (q, host) =>
      typeof q === 'string'
        ? getJson('/api/desktop-sessions/transcript?' + new URLSearchParams(
          typeof host === 'string' && host ? { seat: q, host, format: 'json' } : { seat: q, format: 'json' }))
          .catch((e) => ({ state: e && e.status === 404 ? 'not_found' : 'unavailable' }))
        : getText('/api/desktop-sessions/transcript?' + new URLSearchParams({ machine: q.machine, account: q.account, org: q.org, id: q.id })),
    poll,
    theme,
    // Adapters — pure, defined below.
    toTiles,
    toGroups,
    toRegistryRows,
    toOrg,
    toThreads,
    toKeys,
    toAccounts,
    toMachines,
    toDesktop,
    // Fixture mode.
    isFixture,
    fixtureFor,
    loadFixtures,
    // Time helpers the adapters share, exported so screen slices format the
    // same way rather than growing their own.
    ago,
  };

  // In fixture mode every fetcher resolves the mock's seed data instead of
  // hitting the network. See the fixture-mode contract further down.
  const FIXTURE_ROUTES = {
    sessions: 'groups',
    messages: 'busSessions',
    sshkeys: 'keyRows',
    credits: 'accounts',
    machines: 'machines',
    desktopSessions: 'dsData',
    seats: null,
    health: null,
    ghtrain: null,
    transcript: null,
  };

  // EVERY writing endpoint is a no-op in fixture mode. Leaving these live would
  // mean a Kill or a Delete key clicked on a ?fixture=1 page destroys a real
  // session or a real certificate on whatever backend the page is served from.
  const FIXTURE_WRITES = [
    'sendMessage', 'retryMessage', 'registryUpsert', 'registryDelete', 'kill',
    'mintCert', 'deleteKey', 'startTrain', 'endTrain',
  ];

  Object.keys(FIXTURE_ROUTES).forEach((name) => {
    const live = api[name];
    api[name] = function (...args) {
      if (!isFixture()) return live.apply(null, args);
      const key = FIXTURE_ROUTES[name];
      if (key === null) return Promise.resolve(fixtureShim(name));
      // Loading is deferred to here so fixture-extract.js is fetched only on a
      // page that actually asked for fixture mode.
      return loadFixtures().then(() => fixtureFor(key));
    };
  });

  FIXTURE_WRITES.forEach((name) => {
    const live = api[name];
    api[name] = function (...args) {
      if (!isFixture()) return live.apply(null, args);
      return Promise.resolve({ ok: true, fixture: true });
    };
  });

  // Endpoints the mock has no seed array for still have to resolve something
  // shaped like their response, or a screen wired in fixture mode would throw.
  function fixtureShim(name) {
    if (name === 'seats') return { ok: true, seats: [] };
    if (name === 'health') return { hosts: [], alerts: [] };
    if (name === 'ghtrain') return { active: false, expiresAt: null };
    return '';
  }

  // ---------------------------------------------------------------------------
  // Adapters. Each is pure and returns the *data* layer of the matching mock seed
  // array — same keys, same order, same types. Theme-derived styles and the
  // closures the mock's .map() chains add belong to the template, not here; see
  // docs/design/fleetdeck-v2/improvised.md I-L1-01. Keys the mock omits on some
  // elements are omitted, not null: the template's conditionals test presence.
  // ---------------------------------------------------------------------------

  const MIN = 60000;
  const rows = (res, key) => (Array.isArray(res) ? res : (res && res[key]) || []);
  const dash = (v) => (v === null || v === undefined || v === '' ? '—' : v);

  // The mock stores humanised strings ('16h ago', 'just now'), the API stores
  // timestamps — so formatting is part of the shape (I-L1-04). `now` is an
  // argument so the tests are deterministic.
  function ago(ts, now) {
    const at = toMillis(ts);
    if (at === null) return '—';
    const d = Math.max(0, (now === undefined ? Date.now() : now) - at);
    if (d < MIN) return 'just now';
    if (d < 60 * MIN) return Math.floor(d / MIN) + 'm ago';
    if (d < 24 * 60 * MIN) return Math.floor(d / (60 * MIN)) + 'h ago';
    return Math.floor(d / (24 * 60 * MIN)) + 'd ago';
  }

  // Epoch seconds, epoch millis and ISO strings all appear across the endpoints.
  function toMillis(ts) {
    if (ts === null || ts === undefined || ts === '') return null;
    if (typeof ts === 'number') return ts < 1e12 ? ts * 1000 : ts;
    const parsed = Date.parse(ts);
    return Number.isNaN(parsed) ? null : parsed;
  }

  function minutesAgo(ts, now) {
    const at = toMillis(ts);
    if (at === null) return 0;
    return Math.floor(Math.max(0, (now === undefined ? Date.now() : now) - at) / MIN);
  }

  // 'resets in 5d 9h 2m', the mock's bar sub-label (days once past 24h).
  function resetsIn(ts, now) {
    const at = toMillis(ts);
    if (at === null) return null;
    const d = Math.max(0, at - (now === undefined ? Date.now() : now));
    const h = Math.floor(d / (60 * MIN)), days = Math.floor(h / 24);
    return 'resets in ' + (days ? days + 'd ' + (h % 24) : h) + 'h ' + (Math.floor(d / MIN) % 60) + 'm';
  }

  function toTiles(sessions) {
    // name/box only: the footer is registry-derived and the body is live xterm,
    // both decided in L3 (I-L1-05).
    return rows(sessions, 'sessions')
      .filter((s) => s.live)
      .map((s) => ({ name: s.name, box: s.host, foot1: null, foot2: null, lines: [] }));
  }

  function toGroups(sessions) {
    // Hosts in first-appearance order — the mock's order is onboarding-box then
    // german-box, which is not alphabetical. Key is `items`, not the binding
    // map's `sessions` (I-L1-03).
    const byBox = new Map();
    rows(sessions, 'sessions')
      .filter((s) => s.live)
      .forEach((s) => {
        if (!byBox.has(s.host)) byBox.set(s.host, []);
        byBox.get(s.host).push({ n: s.name });
      });
    return Array.from(byBox, ([box, items]) => ({ box, n: items.length, items }));
  }

  function toRegistryRows(sessions, now) {
    return rows(sessions, 'sessions').map((s) => {
      // The mock's ids are opaque ('r1'); real rows have none, so host/name is
      // the stable key (I-L1-07).
      const row = {
        id: s.host + '/' + s.name,
        s: s.name,
        g: dash(s.group),
        tk: dash(s.task),
        st: s.status,
        active: ago(s.active_at, now),
        msg: ago(s.msg_at, now),
        seen: ago(s.last_seen_at, now),
      };
      if (!s.live) row.gone = true;
      return row;
    });
  }

  function toOrg(sessions, seats, now) {
    const sessionRows = rows(sessions, 'sessions');
    const seatRows = rows(seats, 'seats');
    const tree = orgChart().buildTree(sessionRows, seatRows);
    const scope = { machine: {}, project: {} };
    const push = (bucket, key, tuple) => {
      if (!key) return;
      if (!bucket[key]) bucket[key] = [];
      bucket[key].push(tuple);
    };
    sessionRows.forEach((s) => {
      const name = s.worker || s.name;
      const role = s.role || 'unassigned role';
      // Each scope shows the axis it is *not* grouped by first.
      const machineTuple = [name, role, dash(s.group) + ' / ' + s.name];
      const projectTuple = [name, role, s.host + ' / ' + s.name];
      if (!s.live) {
        machineTuple.push(false);
        projectTuple.push(false);
      }
      push(scope.machine, s.host, machineTuple);
      push(scope.project, s.group, projectTuple);
    });
    // The binding map names orgCard()'s arguments, not its returned keys.
    const cards = sessionRows.map((s) => ({
      name: s.worker || s.name,
      on: !!s.live,
      role: s.role || 'unassigned role',
      path: s.host + ' / ' + s.name,
      grp: dash(s.group),
      epoch: s.epoch,
      lease: s.lease_state,
      age: ago(s.active_at, now),
      exp: ago(s.expires_at, now),
    }));
    return { roots: tree.roots, unattached: tree.unattached, scope, cards };
  }

  function toThreads(messages, now) {
    const list = rows(messages, 'messages');
    const sessions = new Map();
    const threads = {};
    list.forEach((msg) => {
      const target = msg.target || {};
      const inbound = isSessionSource(msg.source);
      const id = inbound ? sourceSession(msg.source) : target.session;
      if (!id) return;
      if (!sessions.has(id)) {
        sessions.set(id, {
          id,
          name: id,
          host: (inbound ? sourceHost(msg.source) : target.host) || null,
          live: null,
        });
      }
      if (!threads[id]) threads[id] = [];
      threads[id].push(threadMessage(msg, inbound, now));
    });
    // The API has no group concept; ad-hoc groups are client-side (I-L1-05).
    return { busSessions: Array.from(sessions.values()), busGroups: [], threads };
  }

  // Key order differs by kind and the template's conditionals depend on it
  // (I-L1-06): inbound carries no `status` at all, a broadcast carries `per`
  // instead of it, and `err` sits immediately before `text`.
  function threadMessage(msg, inbound, now) {
    const out = {
      k: msg.id,
      dir: inbound ? 'in' : 'out',
      from: msg.source,
      at: ago(msg.created_at, now),
      m: minutesAgo(msg.created_at, now),
    };
    if (!inbound) {
      const per = perRecipient(msg);
      if (per) out.per = per;
      else {
        out.status = msg.status;
        if (msg.status === 'failed') out.err = msg.error;
      }
    }
    out.text = msg.text;
    return out;
  }

  function perRecipient(msg) {
    const to = msg.target && msg.target.sessions;
    if (!Array.isArray(to) || to.length < 2) return null;
    const per = {};
    to.forEach((s) => { per[s] = msg.status; });
    return per;
  }

  // Sources are either a plain UI name ('claude-desktop') or 'host:session'.
  const isSessionSource = (source) => typeof source === 'string' && source.indexOf(':') > 0;
  const sourceSession = (source) => source.slice(source.indexOf(':') + 1);
  const sourceHost = (source) => source.slice(0, source.indexOf(':'));

  function toKeys(sshkeys, ghtrain) {
    // The mock hard-codes ED25519, so `type` is not part of keyRows' key set.
    const keyRows = rows(sshkeys, 'keys').map((k) => ({
      name: k.name,
      fp: k.fingerprint,
      comment: k.comment,
    }));
    // Copied, so a caller mutating certs cannot corrupt the response object.
    return { keyRows, certs: rows(sshkeys, 'certs').slice(), train: ghtrain || null };
  }

  const WINDOW_LABELS = { five_hour: '5 hour', seven_day: '7 day', seven_day_fable: '7 day fable' };

  function toAccounts(credits, now) {
    const errors = rows(credits, 'errors');
    return rows(credits, 'rows').map((r) => {
      const acct = {
        prov: r.kind,
        name: r.label,
        email: r.email,
        // The mock shows the first 8 hex of the org uuid, as toDesktop does for
        // the account uuid — not the whole uuid.
        id: String(r.org || '').slice(0, 8),
        plan: accountPlan(r),
        live: r.state === 'ok' ? 'live' : '',
        right: ago(r.updated_at, now) + ' · ' + r.host,
        bars: creditBars(r, now),
        // A number[] of seven-day percentages in time order — the series spark()
        // draws. Design ruling 2026-09-07: history[].sd is the sampled percent, so
        // the raw {t, fh, sd, xu} objects do not belong in the seed (I-L1-11).
        trendPts: trendSeries(r.history),
        seen: (r.seen || []).map((s) => s.host + ' · ' + s.source).join(', '),
      };
      if (r.stale_windows) acct.staleNote = 'sampled ' + ago(r.sample_ts, now) + ' — window has reset since';
      if (r.state !== 'ok') acct.banner = accountBanner(r, errors);
      return acct;
    });
  }

  // The mock's banner is a sentence ('could not read usage on rfc1918-internal'),
  // not the raw state enum. Prefer the server's own message from errors[] when
  // one names this row (improvised.md I-L1-12).
  function accountBanner(r, errors) {
    const match = errors.find((e) => e && (e.id === r.id || e.host === r.host));
    if (match && match.message) return match.message;
    return 'could not read usage on ' + r.host;
  }

  // history[] is {t, fh, sd, xu} samples; the sparkline plots the seven-day percent.
  // Sorted by t rather than trusting the server's order, and samples with no reading
  // are dropped so the series is a clean number[] the template can hand to spark().
  function trendSeries(history) {
    if (!Array.isArray(history) || !history.length) return null;
    return history
      .slice()
      .sort((a, b) => (a && a.t) - (b && b.t))
      .map((h) => (h ? h.sd : null))
      .filter((v) => typeof v === 'number' && !Number.isNaN(v));
  }

  // The API reports a machine enum ('claude_max' + tier 'default_claude_max_20x');
  // the mock shows the human label. Codex rows already carry a readable plan.
  function accountPlan(r) {
    const tier = tierLabel(r.tier);
    if (tier) return tier;
    if (r.plan) return r.plan;
    if (r.type) return r.type;
    return r.windows_from ? r.windows_from + ' snapshot' : '';
  }

  function creditBars(r, now) {
    const out = [];
    const windows = r.windows || (r.weekly ? { weekly: r.weekly } : null);
    if (!windows) return out;
    Object.keys(windows).forEach((key) => {
      const w = windows[key] || {};
      const bar = {
        label: WINDOW_LABELS[key] || key,
        pct: w.pct === undefined ? null : w.pct,
        resets: resetsIn(w.resets_at, now),
      };
      if (w.stale) bar.stale = true;
      out.push(bar);
    });
    return out;
  }

  const CLIENT_LABELS = {
    claude_cli: 'Claude CLI',
    codex_cli: 'Codex CLI',
    claude_desktop: 'Claude Desktop',
    codex_desktop: 'Codex Desktop',
  };

  const ENV_LABELS = { local: 'WSL', windows: 'Windows' };
  const PROOF_CHIPS = {
    token: ['token-proved', 'good'],
    jwt: ['token-proved', 'good'],
    config: ['config only', 'warn'],
    profile: ['profile only', 'warn'],
    history: ['from history', 'neutral'],
  };

  function toMachines(machines, now) {
    return rows(machines, 'machines').map((m) => {
      const clients = m.clients || [];
      // A machine can report the same client twice — german-box runs a WSL and a
      // Windows side. The mock groups those into ONE column with two sections
      // (fixture machines[1]: 4 cols x 2 sections), so grouping by client, not a
      // 1:1 map, is the shape the Machines screen renders.
      const envs = new Set(clients.map((c) => c.where));
      const byClient = new Map();
      clients.forEach((c) => {
        const label = CLIENT_LABELS[c.client] || c.client;
        if (!byClient.has(label)) byClient.set(label, []);
        byClient.get(label).push(machineSection(c, now, envs.size > 1));
      });
      return {
        name: m.label,
        kind: m.os + ' · ' + m.route,
        // A string, as the mock has it — '' when there are none.
        sessions: (m.sessions || []).length ? (m.sessions || []).length + ' sessions' : '',
        cols: Array.from(byClient, ([client, sections]) => ({ client, sections })),
      };
    });
  }

  // chips and bars stay positional tuples — that is what the mock passes to mSec().
  function machineSection(c, now, splitEnv) {
    const usage = c.usage || {};
    const windows = usage.windows || {};
    const chips = [];
    // The mock carries the plan family AND the human tier label as two chips
    // (fixture machines[1]: ['claude_max','neutral'], ['Max 20x','neutral']).
    const family = c.plan || c.type;
    if (family) chips.push([family, 'neutral']);
    const tier = tierLabel(c.tier);
    if (tier) chips.push([tier, 'neutral']);
    if (c.proof) chips.push(PROOF_CHIPS[c.proof] || [c.proof, 'neutral']);
    return {
      // Only a machine with more than one environment labels them; a
      // single-environment machine uses '' (fixture machines[0]).
      env: splitEnv ? ENV_LABELS[c.where] || c.where || '' : '',
      name: c.label || 'signed in, account unknown',
      email: c.email || '',
      chips,
      // The mock's tuple is [label, pct] and only grows a third element when the
      // window is stale — it is not a fixed-width triple.
      bars: Object.keys(windows).map((key) => {
        const w = windows[key] || {};
        const pct = w.pct === undefined ? null : w.pct;
        return w.stale ? [WINDOW_LABELS[key] || key, pct, true] : [WINDOW_LABELS[key] || key, pct];
      }),
      note: c.note || (usage.sample_ts ? 'sampled ' + ago(usage.sample_ts, now) : ''),
    };
  }

  // 'default_claude_max_20x' -> 'Max 20x' with a multiplication sign, the label
  // the mock shows. The API has no human-readable tier name, so this is derived
  // (improvised.md I-L1-12).
  function tierLabel(tier) {
    const m = /max[_-]?(\d+)x$/i.exec(tier || '');
    return m ? 'Max ' + m[1] + '×' : '';
  }

  function toDesktop(desktopSessions, now) {
    const groups = rows(desktopSessions, 'groups');
    const live = [];
    const people = groups.map((g) => {
      const rowsOut = [];
      (g.sessions || []).forEach((s) => {
        if (s.isArchived) return;
        const row = desktopRow(s, now);
        rowsOut.push(row);
        if (s.live) live.push(row);
      });
      return {
        name: g.label,
        email: g.email,
        acct: 'Account ' + String(g.accountUuid || '').slice(0, 8),
        machine: g.machine,
        rows: rowsOut,
      };
    });
    // "Live now" is pinned first (ledger D17).
    const head = { name: 'Live now', email: '', acct: '', machine: '', rows: live };
    return [head].concat(people);
  }

  // The three fallbacks below are the current app's, copied verbatim so the wording
  // does not drift between the old UI and v2 — public/sessions.js:225 and :229.
  function desktopRow(s, now) {
    const row = {
      title: s.title,
      path: s.cwd,
      // 313 of the 923 captured rows have no branch, so this fallback is load-bearing.
      branch: s.branch || 'No branch',
      model: s.model || 'Model unknown',
      when: ago(s.lastActivityAt, now),
      // A missing turn count is unknown, not zero — '0 turns' would be a claim the
      // API never made. sessions.js:229 tests === null; undefined is folded in
      // because a missing key can only mean the same thing.
      turns: s.completedTurns === null || s.completedTurns === undefined
        ? 'Turns unknown'
        : s.completedTurns + ' turns',
      // The mock keeps `created` as a raw ISO string (I-L1-04).
      created: s.createdAt,
    };
    if (s.cliSessionId) row.cli = s.cliSessionId;
    if (s.id) row.sid = s.id;
    if (s.live) row.live = true;
    return row;
  }

  // ---------------------------------------------------------------------------
  // Fixture mode.
  //
  // Contract: the mock's seed arrays are ALREADY in the adapted shape, so in
  // fixture mode a fetcher resolves the adapted array directly and its adapter is
  // NOT called. Screen slices should branch on FD.data.isFixture(): when it is
  // true, use the fetcher's result as-is; otherwise pipe it through the adapter.
  // fixtureFor(name) reaches a seed array by name for tests and for slices that
  // want it explicitly. Adapters stay pure and never inspect fixture state.
  // ---------------------------------------------------------------------------

  const FIXTURE_KEY = 'fd-fixture';

  function isFixture() {
    if (readStore(FIXTURE_KEY) === '1') return true;
    const search = root.location && root.location.search;
    return typeof search === 'string' && /[?&]fixture=1(&|$)/.test(search);
  }

  // FD.fixture is S2's — the seeds its compiler moved out of the template, and the
  // ones the app itself renders. FD.fixtureExtract holds only the seeds S2 did not
  // substitute. FD.fixture always wins, and by construction the two never define
  // the same key (tools/extract-fixture.mjs filters S2's keys out and its --check
  // proves the overlap still agrees), so this order is a safety net, not a merge.
  function fixtureFor(name) {
    const owned = root.FD && root.FD.fixture;
    if (owned && name in owned) return owned[name];
    let extra = root.FD && root.FD.fixtureExtract;
    // Under Node the extract is a synchronous require, so a caller that reaches
    // here before loadFixtures() resolved still gets an answer rather than a throw.
    if (!extra && typeof require === 'function') {
      extra = require('./fixture-extract.js');
    }
    if (extra && name in extra) return extra[name];
    throw new Error(
      'no fixture named ' + name + ' — if it is one of this slice\'s seeds, ' +
      'await FD.data.loadFixtures() before reading it'
    );
  }

  // Resolves once fixture-extract.js is available. In Node it is a require; in the
  // browser the shell is expected to have included it under ?fixture=1, and if it
  // did not we inject it rather than fail. Never called outside fixture mode.
  let fixturesLoading = null;
  function loadFixtures() {
    if (root.FD && root.FD.fixtureExtract) return Promise.resolve(root.FD.fixtureExtract);
    if (fixturesLoading) return fixturesLoading;
    if (typeof require === 'function') {
      fixturesLoading = Promise.resolve(require('./fixture-extract.js'));
      return fixturesLoading;
    }
    fixturesLoading = new Promise((resolve, reject) => {
      const el = root.document.createElement('script');
      // Absolute, matching how the shell loads S2's fixture.js (index.html:36),
      // so it resolves the same from /v2/ and from /v2/index.html.
      el.src = '/v2/fixture-extract.js';
      el.onload = () => resolve(root.FD && root.FD.fixtureExtract);
      el.onerror = () => {
        // Forget the failure so a later call retries. Caching a rejected promise
        // would turn one network hiccup into fixture mode being dead for the life
        // of the page.
        fixturesLoading = null;
        el.parentNode && el.parentNode.removeChild(el);
        reject(new Error('could not load /v2/fixture-extract.js'));
      };
      root.document.head.appendChild(el);
    });
    return fixturesLoading;
  }

  function orgChart() {
    const found = root.FleetOrgChart;
    if (found) return found;
    if (typeof require === 'function') return require('./orgchart.js');
    throw new Error('FleetOrgChart is not loaded');
  }

  // Today's cadences, for whoever wires the screens up: org 30 s while the org
  // view is open plus a 1 s ticker, desktop sessions 30 s visible-only, machines
  // 60 s, SSH keys 30 s. Registry, bus, accounts and health are manual — no poll
  // (accounts.js:234 says so explicitly). Nothing starts at load time.
  function poll(fn, ms, opts) {
    const whileVisible = !!(opts && opts.whileVisible);
    const timer = setInterval(() => {
      if (!whileVisible || visible()) fn();
    }, ms);
    return { stop: () => clearInterval(timer) };
  }

  // No document (Node) counts as visible, so a poll handle still ticks in tests.
  const visible = () => typeof document === 'undefined' || !document.hidden;

  const DARK_KEY = 'fd-landing-dark';
  const LEGACY_KEY = 'fleetTheme';

  // fd-landing-dark is a *dark* flag stored as '1'/'0', so the key name and the
  // value agree. The legacy fleetTheme held 'light'/'dark' (app.js:62); only
  // 'light' ever meant light (sessions.js:32), so anything else migrates to dark.
  function theme() {
    const stored = readStore(DARK_KEY);
    const dark = stored === null ? readStore(LEGACY_KEY) !== 'light' : stored === '1';
    writeStore(DARK_KEY, dark ? '1' : '0');
    return dark;
  }

  // Storage can be absent (Node) or disabled (privacy mode) without breaking the page.
  function readStore(key) {
    try {
      return root.localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  function writeStore(key, value) {
    try {
      root.localStorage.setItem(key, value);
    } catch { /* nothing to write to */ }
  }

  return api;
});
