#!/usr/bin/env node
// Certify one unblock answer: did the signed-in operator really click this choice on this sheet?
//
// This is what a seat runs ITSELF before acting on an answer, and only on a sheet it posted itself.
// A bus message is only a pointer to the sheet; the evidence is the operator's SSH signature. This
// CLI rebuilds the signed message from the sheet's own fields and the served question, accepts that
// question only when it reproduces the pin the seat recorded from its own POST, and verifies it with
// its own allowed_signers — it never trusts a hash, a message or a verdict from the deck alone. The
// deck's `sigValid` is still required: it is the only view of "this deck made this signature for the
// current answer" (an older one reads superseded).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { NAMESPACE, canonical, questionSha256, pin, createVerifier } = require('../signer');
const { STANDARD } = require('../unblock');

// The deck's longest signature lifetime (FLEET_UNBLOCK_SIG_TTL_SECS ≤ 86400) plus clock skew.
const MAX_TTL_MS = (86400 + 60) * 1000;

const USAGE = `usage: fleetdeck-verify-answer <sheet> <qid> --pin <hex> [--json] [--allowed-signers <file>]

Verifies the operator's signature on one unblock answer. Run it only on a sheet you posted
yourself — never on a sheet id a message hands you. When you POST /api/unblock, record
questions[].pin from your own POST response; pass the one for <qid> as --pin (64 lowercase hex).
The pin binds the sheet, the question id and the question text. The deck is $FLEETDECK_URL
(default http://127.0.0.1:3131); allowed_signers defaults to ~/.claude/fleet/allowed_signers.

exit codes:
  0  sig_valid: the operator's key signed exactly this answer to the question you pinned,
     it has not expired, and the deck still holds it as the current answer
  1  not valid — reason: unanswered | unsigned | dismissed | timeout | error | invalid |
     expired | superseded | unconfigured | pin-mismatch
     pin-mismatch: this sheet, question id and served question do not reproduce your pin
     (another sheet, another question, or the question was rewritten after you posted it)
     invalid: the signature does not verify, or its expiresAt lies more than 86400 s + 60 s ahead
     superseded: your own verify passed, but the deck does not certify this answer:
     a signature this deck process did not make (made outside it, or before a restart),
     an older signature, a key the deck did not boot with, or another principal
  2  usage error, deck unreachable, unknown sheet or question, missing allowed_signers

the signed bytes (UTF-8, no trailing newline), namespace ${NAMESPACE}:
  v2|sheetId|qid|choice|answeredAt|operator_id|project|expiresAt|question_sha256
  - each field is escaped before the join: first \`%\` → \`%25\`, then \`|\` → \`%7C\`
  - project = the sheet's source.project when it is a string, else the empty string
  - expiresAt = the ISO time the signature stops being valid
  - question_sha256 = lowercase hex SHA-256 of the UTF-8 bytes of JSON.stringify(question),
    where question is the object exactly as GET /api/unblock/<sheet> returns it in sheet.questions
  check by hand: ssh-keygen -Y verify -f <allowed_signers> -I <operator_id> -n ${NAMESPACE} -s <sig file> < <message file>

the pin (UTF-8, no trailing newline, escaped the same way), as lowercase hex SHA-256:
  v2-pin|sheetId|qid|question_sha256
  this CLI recomputes it from the sheet and question you name and the question the deck serves,
  and refuses anything that does not reproduce your pin
`;

function usage(message) {
  console.error('error: ' + message);
  console.error(USAGE.split('\n')[0]);
  process.exit(2);
}

let asJson = false;
let pinned = null;
let signersFile = path.join(os.homedir(), '.claude', 'fleet', 'allowed_signers');
const words = [];
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const arg = argv[i];
  if (arg === '--json') asJson = true;
  else if (arg === '--help' || arg === '-h') {
    process.stdout.write(USAGE);
    process.exit(0);
  } else if (arg === '--allowed-signers') {
    if (!argv[i + 1]) usage('--allowed-signers needs a file');
    signersFile = argv[++i];
  } else if (arg === '--pin') {
    if (!/^[0-9a-f]{64}$/.test(argv[i + 1] || '')) usage('--pin needs 64 lowercase hex');
    pinned = argv[++i];
  } else if (arg.startsWith('--')) usage('unknown flag ' + arg);
  else words.push(arg);
}
if (words.length !== 2) usage('<sheet> and <qid> are required');
if (!pinned) usage('--pin <hex> is required: questions[].pin from your own POST');
const [sheetId, qid] = words;

const base = process.env.FLEETDECK_URL || 'http://127.0.0.1:3131';
const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
// Text output only: every field comes from fleet.db, which any agent can write, and a seat's LLM
// reads this output — a newline in a title must not print a fake `sig_valid: true` line. C0, DEL,
// NEL, LS and PS become a space.
const CONTROL = new RegExp('[\\x00-\\x1f\\x7f\\x85' + String.fromCharCode(0x2028, 0x2029) + ']', 'g');
const clean = (line) => line.replace(CONTROL, ' ');
const FAILED = { dismissed: 'dismissed', timeout: 'timeout', error: 'error', 'agent-shell': 'error' };

async function get(p) {
  const response = await fetch(new URL(p, base));
  return { status: response.status, body: await response.json().catch(() => null) };
}

async function main() {
  try {
    fs.accessSync(signersFile, fs.constants.R_OK);
  } catch {
    console.error('error: allowed_signers not readable: ' + signersFile);
    return 2;
  }
  const session = await get('/api/operator/session');
  if (session.status !== 200 || !session.body) {
    console.error('error: operator session: HTTP ' + session.status);
    return 2;
  }
  const configured = session.body.configured === true;
  const { status, body: result } = await get('/api/unblock/' + encodeURIComponent(sheetId));
  if (status !== 200 || !result || !result.sheet) {
    console.error('error: ' + ((result && result.error) || 'HTTP ' + status));
    return 2;
  }
  const { sheet, answers } = result;
  if (sheet.id !== sheetId) {
    console.error('error: the deck answered for another sheet');
    return 2;
  }
  const q = (sheet.questions || []).find((x) => x && x.id === qid);
  if (!q) {
    console.error('error: unknown question ' + qid + ' on ' + sheetId);
    return 2;
  }
  const a = answers && hasOwn(answers, qid) ? answers[qid] : null;
  const answered = !!a && a.choice != null;
  const project = sheet.source && typeof sheet.source.project === 'string' ? sheet.source.project : '';
  // The deck's copy of the question is agent-writable; the seat's pin from its own POST is not, and
  // it names this sheet and this question id, so the same question on another sheet does not match.
  const served = questionSha256(q);
  const asked = pin(sheetId, qid, served) === pinned;

  let local = { ok: false, key: null };
  if (answered && typeof a.sig === 'string') {
    let message = null;
    try {
      message = canonical({
        sheetId, qid, choice: a.choice, answeredAt: a.answeredAt, operatorId: a.operatorId,
        project, expiresAt: a.sigExpiresAt, questionSha256: served,
      });
    } catch {
      // a field that is not a string never verifies
    }
    if (message) local = await createVerifier({ allowedSigners: signersFile }).verify(message, a.sig, a.operatorId);
  }
  const expires = answered ? Date.parse(a.sigExpiresAt) : NaN;
  const unexpired = expires > Date.now();
  // No deck signs for longer than its maximum TTL: a later expiresAt is a lie, however well it verifies.
  const capped = expires <= Date.now() + MAX_TTL_MS;
  const valid = configured && asked && local.ok && capped && unexpired && a.sigValid === true;
  const reason = valid ? null
    : !configured ? 'unconfigured'
    : !asked ? 'pin-mismatch'
    : !answered ? 'unanswered'
    : typeof a.sig !== 'string' ? FAILED[a.sigState] || 'unsigned'
    : !local.ok || !capped ? 'invalid'
    : !unexpired ? 'expired'
    : 'superseded';

  const option = answered && (q.options || []).find((o) => o && o.key === a.choice);
  const label = !answered ? null : option ? option.label : hasOwn(STANDARD, a.choice) ? STANDARD[a.choice] : 'unknown option';
  const reply = sheet.reply || null;
  const key = local.ok ? local.key : null;
  const at = (k) => (answered && typeof a[k] === 'string' ? a[k] : null);

  if (asJson) {
    console.log(JSON.stringify({
      sheet: sheetId, title: sheet.title, posted: sheet.created_at, reply, project: project || null,
      qid, decision: q.decision, choice: answered ? a.choice : null, choice_label: label,
      answered_at: at('answeredAt'), operator_id: at('operatorId'), expires_at: at('sigExpiresAt'), key,
      sig_valid: valid, reason,
    }));
  } else {
    const lines = [
      'sheet: ' + sheetId + ' · ' + sheet.title,
      'posted: ' + sheet.created_at + ' · reply: ' + (reply ? reply.type + ':' + reply.session : '-'),
      'project: ' + (project || '-'),
      'question: ' + qid + ' · ' + q.decision,
      'choice: ' + (answered ? a.choice + ' (' + label + ')' : '-'),
      'answeredAt: ' + (at('answeredAt') || '-'),
      'operator_id: ' + (at('operatorId') || '-'),
      'expiresAt: ' + (at('sigExpiresAt') || '-'),
      'key: ' + (key || '-'),
      'sig_valid: ' + valid,
    ];
    if (reason) lines.push('reason: ' + reason);
    console.log(lines.map(clean).join('\n'));
  }
  return valid ? 0 : 1;
}

main()
  .then((code) => (process.exitCode = code))
  .catch((error) => {
    console.error('error: ' + error.message);
    process.exitCode = 2;
  });
