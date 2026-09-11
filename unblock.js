// Unblock: an orchestrator or worker seat posts an adhd-unblock decision sheet, the operator
// answers it in the deck, and the answers travel back to the posting seat over the message bus.
//
// Loopback only, like /api/goals: a sheet carries the operator's own decisions, so no box worker
// on the tailnet may read one or answer one. The POST is the one agent-facing route here — a seat
// curling from this Mac carries no Origin, so it rejects a *foreign* origin rather than a missing
// one. Every other write is the operator's browser and REQUIRES an allowed Origin — and, once a
// deck secret is configured (operator-auth.js), a signed-in operator session too, since any
// same-user shell can forge an Origin. Every fresh click is then HMAC-signed; `sigValid` is
// recomputed on each read, so a row edited in fleet.db or copied from another sheet reads false.
//
// Nothing is sent until the operator asks. `sent_sig` is the receipt: it holds the choice+note
// that were sent, so an answer edited afterwards reads dirty again and can be re-sent.
const crypto = require('crypto');

// The two options every adhd-unblock question carries besides its own, and the labels the sheet
// prints for them when the client sends none.
const STANDARD = { 'you-decide': '🤷 You decide', 'more-info': '❓ Explain more' };

const now = () => new Date().toISOString();
const sig = (choice, note) => JSON.stringify([choice, note]);
const filled = (v) => typeof v === 'string' && v.trim() !== '';
const parse = (s, fallback) => {
  try {
    return JSON.parse(s);
  } catch {
    return fallback;
  }
};

const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
// Ids become keys of plain objects on both sides of the wire; a prototype name would vanish or pollute.
const reserved = (k) => k === '__proto__' || hasOwn(Object.prototype, k);

// Returns the reason the body is not a sheet, or null when it is one.
function sheetError(b) {
  if (!b || typeof b !== 'object' || Array.isArray(b)) return 'body must be an object';
  if (!filled(b.title)) return 'title must be a non-empty string';
  if (b.intro != null && typeof b.intro !== 'string') return 'intro must be a string';
  if (!Array.isArray(b.questions) || !b.questions.length) return 'questions must be a non-empty array';
  const ids = new Set();
  for (const q of b.questions) {
    if (!q || typeof q !== 'object' || Array.isArray(q)) return 'every question must be an object';
    if (!filled(q.id)) return 'every question needs a non-empty id';
    if (reserved(q.id)) return 'question id is reserved: ' + q.id;
    if (ids.has(q.id)) return 'question ids must be unique: ' + q.id;
    ids.add(q.id);
    for (const f of ['topic', 'decision', 'why', 'explain'])
      if (typeof q[f] !== 'string') return 'question ' + q.id + ': ' + f + ' must be a string';
    if (!filled(q.decision)) return 'question ' + q.id + ': decision must be a non-empty string';
    if (!Array.isArray(q.options) || q.options.length < 2 || q.options.length > 4)
      return 'question ' + q.id + ': options must be an array of 2 to 4 entries';
    const keys = new Set();
    for (const o of q.options) {
      if (!o || typeof o !== 'object' || Array.isArray(o) || !filled(o.key) || !filled(o.label))
        return 'question ' + q.id + ': every option needs a key and a label';
      if (keys.has(o.key)) return 'question ' + q.id + ': option keys must be unique: ' + o.key;
      if (reserved(o.key) || hasOwn(STANDARD, o.key))
        return 'question ' + q.id + ': option key is reserved: ' + o.key;
      keys.add(o.key);
      if (o.detail != null && typeof o.detail !== 'string')
        return 'question ' + q.id + ': option ' + o.key + ': detail must be a string';
      if (o.recommended != null && typeof o.recommended !== 'boolean')
        return 'question ' + q.id + ': option ' + o.key + ': recommended must be a boolean';
    }
  }
  if (b.source != null && (typeof b.source !== 'object' || Array.isArray(b.source)))
    return 'source must be an object';
  if (b.reply != null) {
    const r = b.reply;
    if (typeof r !== 'object' || Array.isArray(r) || (r.type !== 'claude-desktop' && r.type !== 'tmux'))
      return 'reply type must be claude-desktop or tmux';
    // The bus validates the target for real at send time; here it only has to be addressable.
    if (!filled(r.session) || r.session.length > 300 || /[\r\n]/.test(r.session))
      return 'reply session must be a non-empty single-line string';
    if (r.host != null && !filled(r.host)) return 'reply host must be a non-empty string';
  }
  return null;
}

function createUnblock({ db, messageBus, send, json, body, allowedOrigins, auth }) {
  db.exec(`CREATE TABLE IF NOT EXISTS unblock_sheets (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    intro TEXT,
    questions TEXT NOT NULL,
    source TEXT,
    reply TEXT,
    status TEXT NOT NULL DEFAULT 'open',
    created_at TEXT,
    updated_at TEXT,
    closed_at TEXT
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS unblock_answers (
    sheet_id TEXT,
    qid TEXT,
    choice TEXT,
    choice_label TEXT,
    answered_at TEXT,
    note TEXT NOT NULL DEFAULT '',
    note_at TEXT,
    sent_sig TEXT,
    sent_at TEXT,
    operator_id TEXT,
    answer_sig TEXT,
    PRIMARY KEY (sheet_id, qid)
  )`);
  // A db from before DECK-108 has the table without the two signing columns.
  const cols = new Set(db.prepare('PRAGMA table_info(unblock_answers)').all().map((c) => c.name));
  for (const col of ['operator_id', 'answer_sig'])
    if (!cols.has(col)) db.exec('ALTER TABLE unblock_answers ADD COLUMN ' + col + ' TEXT');

  const insertSheet = db.prepare(
    `INSERT INTO unblock_sheets (id, title, intro, questions, source, reply, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?)`
  );
  const allSheets = db.prepare('SELECT * FROM unblock_sheets ORDER BY created_at DESC, id DESC');
  const oneSheet = db.prepare('SELECT * FROM unblock_sheets WHERE id = ?');
  const sheetAnswers = db.prepare('SELECT * FROM unblock_answers WHERE sheet_id = ?');
  const oneAnswer = db.prepare('SELECT * FROM unblock_answers WHERE sheet_id = ? AND qid = ?');
  const upsertAnswer = db.prepare(
    `INSERT INTO unblock_answers (sheet_id, qid, choice, choice_label, answered_at, note, note_at, sent_sig, sent_at, operator_id, answer_sig)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(sheet_id, qid) DO UPDATE SET
       choice = excluded.choice, choice_label = excluded.choice_label, answered_at = excluded.answered_at,
       note = excluded.note, note_at = excluded.note_at,
       operator_id = excluded.operator_id, answer_sig = excluded.answer_sig`
  );
  const markSent = db.prepare(
    'UPDATE unblock_answers SET sent_sig = ?, sent_at = ? WHERE sheet_id = ? AND qid = ?'
  );
  const touchSheet = db.prepare('UPDATE unblock_sheets SET updated_at = ? WHERE id = ?');
  const setStatus = db.prepare(
    'UPDATE unblock_sheets SET status = ?, closed_at = ?, updated_at = ? WHERE id = ?'
  );

  const answerView = (row) => ({
    choice: row.choice,
    choiceLabel: row.choice_label,
    answeredAt: row.answered_at,
    note: row.note || '',
    noteAt: row.note_at,
    sentAt: row.sent_at,
    dirty: row.choice != null && row.sent_sig !== sig(row.choice, row.note || ''),
    operatorId: row.operator_id,
    sig: row.answer_sig,
    // Recomputed on every read, never stored: a row edited in fleet.db reads false at once.
    sigValid: auth.answerSigValid({
      sheetId: row.sheet_id,
      qid: row.qid,
      choice: row.choice,
      answeredAt: row.answered_at,
      operatorId: row.operator_id,
      sig: row.answer_sig,
    }),
  });

  function listRow(sheet) {
    const questions = parse(sheet.questions, []);
    const rows = sheetAnswers.all(sheet.id);
    const answered = rows.filter((r) => r.choice != null);
    return {
      id: sheet.id,
      title: sheet.title,
      intro: sheet.intro,
      source: parse(sheet.source, null),
      reply: parse(sheet.reply, null),
      status: sheet.status,
      created_at: sheet.created_at,
      updated_at: sheet.updated_at,
      closed_at: sheet.closed_at,
      total: questions.length,
      answered: answered.length,
      pending: answered.filter((r) => r.sent_sig !== sig(r.choice, r.note || '')).length,
    };
  }

  // 409 payloads and send payloads are the same object: the operator who has no reply target
  // copies out exactly what the seat would have received.
  function sendPayload(sheet, questions, rows, ids) {
    const byId = new Map(rows.map((r) => [r.qid, r]));
    const answers = ids.map((qid) => {
      const r = byId.get(qid);
      const q = questions.find((x) => x.id === qid);
      return {
        id: qid,
        decision: q ? q.decision : '',
        choice: r.choice,
        choiceLabel: r.choice_label,
        answeredAt: r.answered_at,
        note: r.note || '',
        noteAt: r.note_at,
      };
    });
    return {
      sheet: 'adhd-unblock',
      sheetId: sheet.id,
      title: sheet.title,
      answered: answers.length + '/' + questions.length,
      ...(answers.length < questions.length ? { partial: true } : {}),
      answers,
    };
  }

  const forbidden = (res) => send(res, 403, 'text/plain', 'forbidden');
  const operatorOk = (req) => allowedOrigins.has(req.headers.origin);

  async function route(req, res, p) {
    const raw = p.slice('/api/unblock'.length).split('/').filter(Boolean);
    // A question id travels in the path, so it arrives percent-encoded; a malformed escape is
    // a segment that matches nothing rather than a throw out of the handler.
    const rest = raw.map((s) => {
      try {
        return decodeURIComponent(s);
      } catch {
        return s;
      }
    });

    if (!rest.length) {
      if (req.method === 'GET')
        return json(res, { sheets: allSheets.all().map(listRow) });
      if (req.method !== 'POST') return send(res, 405, 'text/plain', 'method not allowed');
      const origin = req.headers.origin;
      if (origin && !allowedOrigins.has(origin)) return forbidden(res);
      // A sheet is a whole decision brief, options and explanations included.
      const b = await body(req, 262144).catch(() => null);
      const bad = b === null ? 'bad request body' : sheetError(b);
      if (bad) return json(res, { error: bad }, 400);
      const id = 'ub-' + crypto.randomBytes(4).toString('hex');
      const stamp = now();
      insertSheet.run(
        id,
        b.title,
        b.intro == null ? '' : b.intro,
        JSON.stringify(b.questions),
        b.source == null ? null : JSON.stringify(b.source),
        b.reply == null
          ? null
          : JSON.stringify({
              type: b.reply.type,
              session: b.reply.session,
              ...(b.reply.host ? { host: b.reply.host } : {}),
            }),
        stamp,
        stamp
      );
      return json(res, { id, url: '/app#unblock?sheet=' + id }, 201);
    }

    const sheet = oneSheet.get(rest[0]);
    if (!sheet) return json(res, { error: 'unknown sheet' }, 404);
    const questions = parse(sheet.questions, []);

    if (rest.length === 1) {
      if (req.method !== 'GET') return send(res, 405, 'text/plain', 'method not allowed');
      const answers = Object.create(null);
      for (const row of sheetAnswers.all(sheet.id)) answers[row.qid] = answerView(row);
      return json(res, { sheet: { ...listRow(sheet), questions }, answers });
    }

    // --- the operator's writes. A seat must never answer, send or close its own sheet.
    if (req.method !== (rest[1] === 'answers' ? 'PUT' : 'POST'))
      return send(res, 405, 'text/plain', 'method not allowed');
    if (!operatorOk(req)) return forbidden(res);
    // The Origin only proves a browser-shaped request; any same-user shell can forge it. With a
    // deck secret configured the operator's signed-in session is what actually authorises a write.
    const operatorId = auth.operator(req);
    if (auth.configured && !operatorId) return json(res, { error: 'sign in required' }, 401);

    if (rest[1] === 'answers') {
      const qid = rest[2];
      const q = questions.find((x) => x.id === qid);
      if (!q) return json(res, { error: 'unknown question' }, 404);
      const b = await body(req, 65536).catch(() => null);
      if (!b || typeof b !== 'object' || Array.isArray(b)) return json(res, { error: 'bad request body' }, 400);
      const stored = oneAnswer.get(sheet.id, qid) || {
        choice: null, choice_label: null, answered_at: null, note: '', note_at: null,
        sent_sig: null, sent_at: null, operator_id: null, answer_sig: null,
      };
      let { choice, choice_label: label, answered_at: answeredAt, note, note_at: noteAt } = stored;
      let { operator_id: signer, answer_sig: answerSig } = stored;
      note = note || '';
      const stamp = now();

      if ('choice' in b) {
        if (b.choice === null) {
          [choice, label, answeredAt, signer, answerSig] = [null, null, null, null, null];
        } else {
          if (typeof b.choice !== 'string' || !(hasOwn(STANDARD, b.choice) || q.options.some((o) => o.key === b.choice)))
            return json(res, { error: 'choice must be an option key of ' + qid + ', you-decide or more-info' }, 400);
          // A fresh click is a new choice, or — once a secret is configured — the same choice on a
          // row that was never signed (answered before sign-in existed). Only a fresh click is
          // stamped and signed; a note or label edit leaves the signature exactly as it was.
          if (b.choice !== stored.choice || (auth.configured && !stored.answer_sig)) {
            answeredAt = stamp;
            signer = operatorId;
            answerSig = auth.signAnswer({ sheetId: sheet.id, qid, choice: b.choice, answeredAt, operatorId });
          }
          choice = b.choice;
          const option = q.options.find((o) => o.key === choice);
          label = filled(b.choiceLabel)
            ? b.choiceLabel
            : hasOwn(STANDARD, choice) ? STANDARD[choice] : option ? option.label : choice;
        }
      } else if (filled(b.choiceLabel) && choice != null) {
        label = b.choiceLabel;
      }

      if ('note' in b) {
        if (b.note != null && typeof b.note !== 'string') return json(res, { error: 'note must be a string' }, 400);
        const next = b.note == null ? '' : b.note;
        if (next !== note) noteAt = next === '' ? null : stamp;
        note = next;
      }

      upsertAnswer.run(
        sheet.id, qid, choice, label, answeredAt, note, noteAt, stored.sent_sig, stored.sent_at, signer, answerSig
      );
      touchSheet.run(stamp, sheet.id);
      const view = answerView(oneAnswer.get(sheet.id, qid));
      // Both readings of "the answer in the GET shape": the fields themselves, and under `answer`.
      return json(res, { qid, ...view, answer: view });
    }

    if (rest[1] === 'close' || rest[1] === 'reopen') {
      const closing = rest[1] === 'close';
      const stamp = now();
      setStatus.run(closing ? 'closed' : 'open', closing ? stamp : null, stamp, sheet.id);
      return json(res, { sheet: listRow(oneSheet.get(sheet.id)) });
    }

    if (rest[1] !== 'send') return send(res, 404, 'text/plain', 'not found');

    const b = await body(req, 65536).catch(() => null);
    if (b === null) return json(res, { error: 'bad request body' }, 400);
    const rows = sheetAnswers.all(sheet.id);
    const byId = new Map(rows.map((r) => [r.qid, r]));
    const asked = Array.isArray(b.ids) ? b.ids : null;
    if (asked && asked.some((id) => typeof id !== 'string'))
      return json(res, { error: 'ids must be question ids' }, 400);
    // Question order, never the order the operator happened to click in.
    const ids = questions
      .map((q) => q.id)
      .filter((qid) => {
        const r = byId.get(qid);
        if (!r || r.choice == null) return false;
        return asked ? asked.includes(qid) : r.sent_sig !== sig(r.choice, r.note || '');
      });
    if (!ids.length) return json(res, { sent: 0 });

    const payload = sendPayload(sheet, questions, rows, ids);
    const reply = parse(sheet.reply, null);
    if (!reply) return json(res, { error: 'no reply target', payload }, 409);

    let message;
    try {
      message = await messageBus.send({
        source: 'unblock',
        target: reply,
        text: '/adhd-unblock answers for "' + sheet.title + '"\n' + JSON.stringify(payload, null, 2),
      });
    } catch (error) {
      // A target the bus refuses is the operator's problem to fix, so nothing is marked sent.
      return json(res, { error: error.message, payload }, Number.isInteger(error.code) ? error.code : 500);
    }
    const stamp = now();
    for (const qid of ids) {
      const r = byId.get(qid);
      markSent.run(sig(r.choice, r.note || ''), stamp, sheet.id, qid);
    }
    touchSheet.run(stamp, sheet.id);
    return json(res, { sent: ids.length, messageId: message.id, payload });
  }

  return route;
}

module.exports = { createUnblock };
