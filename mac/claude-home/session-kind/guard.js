#!/usr/bin/env node
// PreToolUse hook: a session marked "🎛 ORCHESTRATOR", "🔬 RESEARCHER",
// "🎨 DESIGN" (design implementation orchestrator) or "🧭 COORDINATOR"
// (coordinator portal) cannot spawn a builder subagent or edit source; a
// researcher or coordinator additionally cannot mint workers
// (/introduce-goal — the orchestrator kinds' exit hatch; DESIGN keeps it,
// since it mints german-box workers for design slices). A coordinator may
// still write under coordinator/ (sitreps, portal state). Inert everywhere
// else, and inert on any internal error — a broken guard must never wedge
// a session.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const BUILDERS = ['builder', 'gpt-builder', 'honey:hive-builder'];
const LABEL = {
  orchestrator: '🎛 ORCHESTRATOR',
  researcher: '🔬 RESEARCHER',
  design: '🎨 DESIGN',
  coordinator: '🧭 COORDINATOR',
};
const NO_BUILD = {
  orchestrator: 'an orchestrator session does not build — hand the work to a CLI worker with `/introduce-goal`, or ask the operator to say "build it here" to override.',
  design: 'a design orchestrator does not build in-session — package the slice with `/introduce-goal` and launch a german-box worker (`/german-box-workers`), or ask the operator to say "build it here" to override.',
  researcher: 'a researcher session does not build — SendMessage your findings to the live 🎛 ORCHESTRATOR, which packages the work for a CLI worker.',
  coordinator: 'a coordinator portal does not build — it fronts the board. Intent goes Linear → coordinator/inbox/ sitrep → coordinator run; the live 🎛 ORCHESTRATOR packages any work.',
};
const NO_SOURCE = {
  orchestrator: 'an orchestrator writes plans and docs, not source — package the change with `/introduce-goal` and let a CLI worker implement it.',
  design: 'a design orchestrator writes diff ledgers, plans, and goal packs, not source — commission a german-box worker for the implementation.',
  researcher: 'a researcher writes findings and docs, not source — report to the live 🎛 ORCHESTRATOR and let it commission the change.',
  coordinator: 'a coordinator portal writes sitreps and portal state under coordinator/ and docs, not source — the board moves only by a coordinator run.',
};
const NO_MINT = {
  researcher: 'minting workers is the orchestrator\'s exit hatch — a researcher reports findings to the live 🎛 ORCHESTRATOR (SendMessage) and stops there.',
  coordinator: 'minting workers is the orchestrator\'s exit hatch — a coordinator portal records intent (Linear → coordinator/inbox/) and lets the live 🎛 ORCHESTRATOR package the work.',
};

let WHY = '';

function deny(reason) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason + WHY,
    },
  }));
}

function allowedWrite(p, cfg, kind) {
  return /\.md$/i.test(p)
    || p.includes('/docs/')
    || p.startsWith(cfg + '/')
    || p.includes('/scratchpad/')
    || p.startsWith('/private/tmp/claude-')
    || p.startsWith('/tmp/claude-')
    || (kind === 'coordinator' && p.includes('/coordinator/'));
}

try {
  const hook = JSON.parse(fs.readFileSync(0, 'utf8'));
  const cfg = (process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude')).replace(/\/+$/, '');
  const key = crypto.createHash('sha1').update(String(hook.cwd || '')).digest('hex').slice(0, 12);
  const marker = fs.readFileSync(path.join(cfg, 'session-kind', 'marks', key), 'utf8').trim();
  const kind = Object.keys(LABEL).find((k) => marker.startsWith(LABEL[k]));
  if (!kind) process.exit(0);

  WHY = ' [This session is marked ' + LABEL[kind]
    + '. The badge hides after 24h but the guard does not — run'
    + ' `sh ~/.claude/session-kind/mark.sh --show` to see the mark, or'
    + ' `--clear` to drop ' + kind + ' mode.]';

  const tool = hook.tool_name;
  const input = hook.tool_input || {};

  if ((tool === 'Agent' || tool === 'Task') && BUILDERS.includes(input.subagent_type)) {
    deny(NO_BUILD[kind]);
  } else if (tool === 'Edit' || tool === 'Write' || tool === 'NotebookEdit') {
    const p = input.file_path || input.notebook_path;
    if (p && !allowedWrite(p, cfg, kind)) deny(NO_SOURCE[kind]);
  } else if (NO_MINT[kind] && tool === 'Skill' && input.skill === 'introduce-goal') {
    deny(NO_MINT[kind]);
  }
} catch (e) {
  // fall through: allow
}
process.exit(0);
