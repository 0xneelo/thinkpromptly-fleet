#!/usr/bin/env node
// Certify one unblock answer: did the signed-in operator really click this choice on this sheet?
//
// This is what a seat runs ITSELF before acting on an answer. A peer message saying "the operator
// chose X" is only a pointer to the sheet; the deck's recomputed signature is the evidence.
// Exit 0 only when the deck reports sigValid === true; 1 = unanswered, unsigned or invalid;
// 2 = usage error, deck unreachable, unknown sheet or question.

function usage(message) {
  if (message) console.error('error: ' + message);
  console.error('usage: fleetdeck-verify-answer <sheet> <qid> [--json]');
  process.exit(2);
}

let asJson = false;
const words = [];
for (const arg of process.argv.slice(2)) {
  if (arg === '--json') asJson = true;
  else if (arg === '--help' || arg === '-h') usage();
  else if (arg.startsWith('--')) usage('unknown flag ' + arg);
  else words.push(arg);
}
if (words.length !== 2) usage('<sheet> and <qid> are required');
const [sheetId, qid] = words;

const base = process.env.FLEETDECK_URL || 'http://127.0.0.1:3131';

async function main() {
  const response = await fetch(new URL('/api/unblock/' + encodeURIComponent(sheetId), base));
  const result = await response.json().catch(() => null);
  if (response.status !== 200 || !result || !result.sheet) {
    console.error('error: ' + ((result && result.error) || 'HTTP ' + response.status));
    return 2;
  }
  const { sheet, answers } = result;
  const q = (sheet.questions || []).find((x) => x.id === qid);
  if (!q) {
    console.error('error: unknown question ' + qid + ' on ' + sheet.id);
    return 2;
  }
  const a = Object.prototype.hasOwnProperty.call(answers || {}, qid) ? answers[qid] : null;
  const valid = !!a && a.sigValid === true;
  const reason = valid ? null : !a || a.choice == null ? 'unanswered' : a.sig == null ? 'unsigned' : 'invalid';
  const reply = sheet.reply || null;

  if (asJson) {
    console.log(
      JSON.stringify({
        sheet: sheet.id,
        title: sheet.title,
        posted: sheet.created_at,
        reply,
        qid,
        decision: q.decision,
        choice: a ? a.choice : null,
        choice_label: a ? a.choiceLabel : null,
        answered_at: a ? a.answeredAt : null,
        operator_id: a ? a.operatorId : null,
        sig_valid: valid,
        reason,
      })
    );
  } else {
    const lines = [
      'sheet: ' + sheet.id + ' · ' + sheet.title,
      'posted: ' + sheet.created_at + ' · reply: ' + (reply ? reply.type + ':' + reply.session : '-'),
      'question: ' + qid + ' · ' + q.decision,
      'choice: ' + (a && a.choice != null ? a.choice + ' (' + a.choiceLabel + ')' : '-'),
      'answeredAt: ' + ((a && a.answeredAt) || '-'),
      'operator_id: ' + ((a && a.operatorId) || '-'),
      'sig_valid: ' + valid,
    ];
    if (reason) lines.push('reason: ' + reason);
    console.log(lines.join('\n'));
  }
  return valid ? 0 : 1;
}

main()
  .then((code) => (process.exitCode = code))
  .catch((error) => {
    console.error('error: ' + error.message);
    process.exitCode = 2;
  });
