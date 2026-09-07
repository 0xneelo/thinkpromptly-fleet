#!/usr/bin/env node
// SessionStart hook: put the session-kind badge in the SESSION TITLE, which is
// the only session-kind surface the Claude desktop app renders (it has no status
// line). Inert unless this cwd was stamped with mark.sh, so unmarked sessions
// keep Claude's normal AI-generated titles.
//
// Registered on SessionStart ONLY. It also works on UserPromptSubmit and would
// re-apply every turn, but that clobbers any manual /rename — so the topic comes
// from the agent instead: desktop-orchestrator ends its first reply with a
// copyable "/rename 🎛 ORCHESTRATOR <N> · <topic>" for the operator to click.
//
// Mechanism per the Claude Code changelog:
//   "SessionStart hooks can now set the session title via
//    hookSpecificOutput.sessionTitle on startup and resume"
//
// Known limitation (anthropics/claude-code#53023, still open): the title is
// written and persisted as customTitle, but the live UI does not repaint it —
// it shows up in the session list and after a resume.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const MAX = 60;

try {
  const hook = JSON.parse(fs.readFileSync(0, 'utf8'));
  const event = hook.hook_event_name;
  if (!event) process.exit(0); // don't guess which event we're serving

  const cwd = String(hook.cwd || '');
  const cfg = (process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude')).replace(/\/+$/, '');
  const key = crypto.createHash('sha1').update(cwd).digest('hex').slice(0, 12);

  // No marker -> emit nothing -> normal AI-generated title is preserved.
  const badge = fs.readFileSync(path.join(cfg, 'session-kind', 'marks', key), 'utf8')
    .replace(/\s+/g, ' ')
    .trim();
  if (!badge) process.exit(0);

  const where = path.basename(cwd);
  let title = where ? `${badge} · ${where}` : badge;

  // Truncate on real characters, not UTF-16 units, so emoji survive intact.
  const chars = Array.from(title);
  if (chars.length > MAX) title = chars.slice(0, MAX - 1).join('') + '…';

  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: event, sessionTitle: title },
  }));
} catch (e) {
  // fall through: emit nothing, never block a prompt
}
process.exit(0);
