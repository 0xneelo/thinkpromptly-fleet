#!/usr/bin/env node
// PreToolUse hook: a session marked "🎛 ORCHESTRATOR", "🔬 RESEARCHER",
// "🎨 DESIGN" (design implementation orchestrator), "🧭 COORDINATOR"
// (coordinator portal) or "🥅 GOALKEEPER" (the auditor seat) cannot spawn a
// builder subagent or edit source; a researcher, coordinator or goalkeeper
// additionally cannot mint workers (/introduce-goal — the orchestrator kinds'
// exit hatch; DESIGN keeps it, since it mints german-box workers for design
// slices). A coordinator may still write under coordinator/ (sitreps, portal
// state).
//
// The goalkeeper is isolated in both directions (PLAN.md v2 §3.4):
//   - it may not message any seat, may not reach the fleet bus or the deck
//     API, and may write only under ~/.claude/goalkeeper/ and the scratchpad;
//   - every OTHER stamped session — orchestrator, researcher, design,
//     coordinator and worker alike — may not message a 🥅 seat, may not reach
//     one over the bus/deck API, and may not write under ~/.claude/goalkeeper/.
//
// Inert everywhere else, and inert on any internal error — a broken guard must
// never wedge a session.
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
  goalkeeper: '🥅 GOALKEEPER',
};
const NO_BUILD = {
  orchestrator: 'an orchestrator session does not build — hand the work to a CLI worker with `/introduce-goal`, or ask the operator to say "build it here" to override.',
  design: 'a design orchestrator does not build in-session — package the slice with `/introduce-goal` and launch a german-box worker (`/german-box-workers`), or ask the operator to say "build it here" to override.',
  researcher: 'a researcher session does not build — SendMessage your findings to the live 🎛 ORCHESTRATOR, which packages the work for a CLI worker.',
  coordinator: 'a coordinator portal does not build — it fronts the board. Intent goes Linear → coordinator/inbox/ sitrep → coordinator run; the live 🎛 ORCHESTRATOR packages any work.',
  goalkeeper: 'a goalkeeper does not build — it only records the operator\'s directions and audits drift against them. Report the drift to the operator and let them commission the work.',
};
const NO_SOURCE = {
  orchestrator: 'an orchestrator writes plans and docs, not source — package the change with `/introduce-goal` and let a CLI worker implement it.',
  design: 'a design orchestrator writes diff ledgers, plans, and goal packs, not source — commission a german-box worker for the implementation.',
  researcher: 'a researcher writes findings and docs, not source — report to the live 🎛 ORCHESTRATOR and let it commission the change.',
  coordinator: 'a coordinator portal writes sitreps and portal state under coordinator/ and docs, not source — the board moves only by a coordinator run.',
  goalkeeper: 'a goalkeeper writes only inside its own repo — thread.md, projects.json, sweep.json and audits/ under ~/.claude/goalkeeper/ (plus the scratchpad). Every other repo is read-only evidence.',
};
const NO_MINT = {
  researcher: 'minting workers is the orchestrator\'s exit hatch — a researcher reports findings to the live 🎛 ORCHESTRATOR (SendMessage) and stops there.',
  coordinator: 'minting workers is the orchestrator\'s exit hatch — a coordinator portal records intent (Linear → coordinator/inbox/) and lets the live 🎛 ORCHESTRATOR package the work.',
  goalkeeper: 'minting workers is the orchestrator\'s exit hatch — a goalkeeper audits and reports to the operator, who decides whether any work is commissioned.',
};

// Tools that carry a message to another seat.
const MSG_TOOLS = ['SendMessage', 'mcp__ccd_session_mgmt__send_message'];
// Shell routes that reach another seat: the fleet bus, the deck API, the
// session registry.
const REACH = /fleet-notify|fleet-message|api\/notify|api\/messages|\.claude\/sessions\//;
// Naming the seat. Case-insensitive, because `to: "goalkeeper"` is every bit a
// reach as the all-caps badge form.
const GK_NAME_I = /goalkeeper|🥅/i;
// Addressee-shaped tokens inside a SHELL COMMAND. A reach NAMES its target; the
// first cut tested the badge spelling anywhere in the command, which both missed
// a lowercase `to` value and fired on any command that merely mentioned the
// seat. Each pattern's LAST capture is the addressee's value.
// A flag's value may be bare, or quoted AND CONTAIN SPACES — `--to="🥅
// GOALKEEPER 9"` is the badge's own spelling, so a pattern that stops at the
// first space would miss the most obvious address of all.
const FLAG_VALUE = '(?:"([^"]*)"|\'([^\']*)\'|([^\\s\'"]+))';
const CMD_ADDRESSEE = [
  new RegExp('--to[=\\s]+' + FLAG_VALUE, 'gi'),       // --to <x>, --to host:session
  new RegExp('--session[=\\s]+' + FLAG_VALUE, 'gi'),
  new RegExp('--target[=\\s]+' + FLAG_VALUE, 'gi'),
  /["']to["']\s*:\s*["']([^"']*)["']/gi,      // {"to": "<x>"}
  /["']session(?:_id)?["']\s*:\s*["']([^"']*)["']/gi,
  /["']target["']\s*:\s*["']([^"']*)["']/gi,
  /["']name["']\s*:\s*["']([^"']*)["']/gi,
  /["']title["']\s*:\s*["']([^"']*)["']/gi,
];

// A heredoc body is DATA, not a command. `cat > brief.md <<'EOF' … EOF` never
// reaches anyone, whatever it quotes — and on 2026-09-07T19:28Z the orchestrator
// was denied writing the very brief that specifies this rule, because the file
// it was writing quoted a reach PoC. Strip bodies before scanning.
function stripHeredocs(cmd) {
  return cmd.replace(
    /<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1[\s\S]*?^[ \t]*\2[ \t]*$/gm,
    '<<HEREDOC',
  );
}

// A shell command whose write DESTINATION is the goalkeeper's repo — the other
// way a seat could put bytes in there without using a write tool.
// Split on the operators that sequence commands. This is a conservative
// scanner, not a shell parser: quoting is not honoured, which can only ever
// over-segment and so cannot hide a target.
function segments(cmd) {
  return cmd.split(/\s*(?:&&|\|\||[;|\n])\s*/);
}

function argTokens(s) {
  const out = [];
  const parts = s.split(/\s+/);
  for (let i = 0; i < parts.length; i += 1) {
    const t = parts[i].replace(/^['"]|['"]$/g, '');
    if (t) out.push(t);
  }
  return out;
}

// Every path a segment WRITES to.
//
// A copy READS its sources and writes only its destination, so treating every
// argument as a target refused `cp <jail>/audits/2026-09-07.md /tmp/copy.md` —
// an orchestrator reading the evidence it is meant to read. The two families
// are therefore separated: for cp/mv/install/ln/dd only the destination counts,
// for rm/mkdir/touch/truncate/chmod/chown/tee every path argument does.
function writeTargets(seg) {
  const targets = [];
  const redirect = /(?:>>?)\s*(['"]?)([^\s'"|;&<>]+)\1/g;
  let m = redirect.exec(seg);
  while (m) { targets.push(m[2]); m = redirect.exec(seg); }

  // Every path argument is written.
  const all = /\b(?:rm|mkdir|touch|truncate|chmod|chown|tee)\b([^;&|\n]*)/g;
  m = all.exec(seg);
  while (m) {
    const toks = argTokens(m[1]);
    for (let i = 0; i < toks.length; i += 1) {
      if (toks[i].charAt(0) !== '-') targets.push(toks[i]);
    }
    m = all.exec(seg);
  }

  // Only the destination is written.
  const dest = /\b(?:cp|mv|install|ln|dd)\b([^;&|\n]*)/g;
  m = dest.exec(seg);
  while (m) {
    const toks = argTokens(m[1]);
    let explicit = null;
    const plain = [];
    for (let i = 0; i < toks.length; i += 1) {
      const t = toks[i];
      if (t.indexOf('of=') === 0) { explicit = t.slice(3); continue; }   // dd
      if (t.indexOf('if=') === 0) continue;                              // dd source
      if (t === '-t' || t === '--target-directory') {
        if (toks[i + 1]) { explicit = toks[i + 1]; i += 1; }
        continue;
      }
      if (t.indexOf('--target-directory=') === 0) {
        explicit = t.slice('--target-directory='.length);
        continue;
      }
      if (t.charAt(0) === '-') continue;
      plain.push(t);
    }
    if (explicit) targets.push(explicit);
    else if (plain.length) targets.push(plain[plain.length - 1]);
    m = dest.exec(seg);
  }
  return targets;
}

// A path is anchored when it names its own root; anything else is relative to
// wherever the shell happens to be standing.
function isAnchored(t) {
  return t.charAt(0) === '/' || t.charAt(0) === '~' || t.charAt(0) === '$';
}

// Does any anchored token in the command point inside the jail? Only consulted
// when a `cd "$var"` has made the working directory unknowable, so that such a
// command is refused when it names the jail and allowed when it does not.
function namesGoalkeeper(cmd, cfg, cwd) {
  const toks = cmd.split(/[\s'"=]+/);
  for (let i = 0; i < toks.length; i += 1) {
    if (toks[i] && isAnchored(toks[i]) && underGoalkeeper(toks[i], cfg, cwd)) return true;
  }
  return false;
}

// A shell command whose write DESTINATION is the goalkeeper's repo.
//
// Targets are resolved against the directory the shell is standing in at that
// point, not against the session cwd: `cd ~/.claude/goalkeeper && echo x > e.md`
// writes into the jail with a target that is just `e.md`. So `cd`/`pushd` are
// tracked across the sequencing operators. A `cd "$var"` cannot be resolved
// statically; from there relative targets are unknowable, and the command is
// refused only if it names the jail somewhere anchored — an ordinary relative
// write in some other repo must never be denied on a guess.
function commandWritesGoalkeeper(cmd, cfg, cwd) {
  let here = cwd;                       // null once the cwd stops being knowable
  const segs = segments(cmd);
  for (let i = 0; i < segs.length; i += 1) {
    const seg = segs[i].trim();
    if (!seg) continue;
    const cd = /^(?:cd|pushd)(?:\s+(['"]?)(.*?)\1)?\s*$/.exec(seg);
    if (cd) {
      const dir = (cd[2] || '').trim();
      if (!dir) here = os.homedir();                    // bare `cd` goes home
      else if (/[$`*?]/.test(dir)) here = null;         // not statically knowable
      else here = norm(dir, here === null ? cwd : here) || null;
      continue;
    }
    const targets = writeTargets(seg);
    for (let j = 0; j < targets.length; j += 1) {
      const t = targets[j];
      if (isAnchored(t)) {
        if (underGoalkeeper(t, cfg, cwd)) return true;
      } else if (here !== null) {
        if (underGoalkeeper(t, cfg, here)) return true;
      } else if (namesGoalkeeper(cmd, cfg, cwd)) {
        return true;
      }
    }
  }
  return false;
}

function commandAddressesGoalkeeper(cmd) {
  for (const re of CMD_ADDRESSEE) {
    re.lastIndex = 0;
    let m = re.exec(cmd);
    while (m) {
      // Test every capture: the quoted and bare alternatives above mean only
      // one of them is defined per match.
      for (let i = 1; i < m.length; i += 1) {
        if (typeof m[i] === 'string' && m[i] && GK_NAME_I.test(m[i])) return true;
      }
      m = re.exec(cmd);
    }
  }
  return false;
}

// PLAN.md v2 §3.4.2 as amended by §9: for a non-goalkeeper kind the deny matches
// the ADDRESSEE FIELDS ONLY, never the whole serialised input. The first cut
// matched the whole payload, which denied an orchestrator telling a worker "your
// branch is the 🥅 GOALKEEPER lane" — a message to somebody else that merely
// mentions the seat. Addressing it is the thing that is forbidden; talking about
// it is not, and this project is *named* goalkeeper.
// §9 names to, session_id, title, target.session and name. `session` and
// `recipient` are included as well: they are addressee-shaped aliases of the
// same thing, and leaving an alias open would reopen the hole §9 is closing.
// The §9 intent is preserved exactly — no body field is ever matched.
// `agent` and `seat` were in the first cut and were dropped when this list was
// narrowed to §9's names. They are addressee-shaped like the rest, and a seat is
// exactly what one addresses, so they are back.
const ADDRESSEE_KEYS = ['to', 'session_id', 'session', 'title', 'name', 'recipient',
  'agent', 'seat'];

function addressesGoalkeeper(input) {
  if (!input || typeof input !== 'object') return false;
  for (const k of ADDRESSEE_KEYS) {
    if (typeof input[k] === 'string' && GK_NAME_I.test(input[k])) return true;
  }
  // target.session — the nested form the bus uses.
  const t = input.target;
  if (t && typeof t === 'object' && typeof t.session === 'string'
      && GK_NAME_I.test(t.session)) return true;
  // A bare string target is an addressee too.
  if (typeof t === 'string' && GK_NAME_I.test(t)) return true;
  return false;
}

const NO_MESSAGE_GK = 'a goalkeeper never messages a seat — it works 1-on-1 with the operator (PLAN.md v2 §3.4). Put the drafted relay line in today\'s audit note and let the operator forward it.';
const NO_REACH_GK = 'a goalkeeper never reaches the fleet bus, the deck API or another seat\'s registry entry — its only output is the audit note the operator reads.';
const NO_MSG_TO_GK = 'the 🥅 GOALKEEPER seat cannot be addressed by any seat (PLAN.md v2 §3.4). It reads your files; you never reach it. Raise it with the operator instead.';
const NO_REACH_TO_GK = 'the 🥅 GOALKEEPER seat cannot be reached over the fleet bus, the deck API or the session registry (PLAN.md v2 §3.4). It reads your files; you never reach it.';
const NO_WRITE_TO_GK = 'the goalkeeper\'s repo (~/.claude/goalkeeper/) belongs to the 🥅 seat alone — never write there. It reads your files; you never write its.';

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

// Resolve a tool's file_path the way the filesystem will: expand `~`, resolve
// `.` and `..`, collapse duplicate separators, and anchor a relative path to the
// session's cwd. Without this, `<cfg>/goalkeeper/../../remote-system/server.js`
// string-matches the allowlist and then lands outside it — which is the whole
// jail, escaped in one segment.
function norm(p, cwd) {
  if (typeof p !== 'string' || p === '') return '';
  let s = p;
  // Expand the spellings a shell expands, before any comparison. `~` alone was
  // handled; `$HOME/.claude/goalkeeper/x` reaches exactly the same file and was
  // not, so the jail could be addressed by simply spelling it differently.
  const home = os.homedir();
  s = s.replace(/^\$\{HOME\}/, home).replace(/^\$HOME(?=\/|$)/, home);
  const cfgEnv = process.env.CLAUDE_CONFIG_DIR;
  if (cfgEnv) {
    s = s.replace(/^\$\{CLAUDE_CONFIG_DIR\}/, cfgEnv)
      .replace(/^\$CLAUDE_CONFIG_DIR(?=\/|$)/, cfgEnv);
  }
  if (s === '~') s = home;
  else if (s.startsWith('~/')) s = path.join(home, s.slice(2));
  try {
    return path.resolve(cwd || process.cwd(), s);
  } catch (e) {
    return '';
  }
}

// Lexical resolution is not enough: a symlink INSIDE the jail can point out of
// it, and one outside can point in. `ln -s /elsewhere ~/.claude/goalkeeper/x.js`
// then writing that path is a jailbreak that `path.resolve` cannot see. So walk
// up to the deepest ancestor that actually exists, realpath THAT, and re-attach
// the rest — the target itself may not exist yet, since a Write creates it.
function realDeep(p, depth) {
  const d = depth || 0;
  if (d > 32) return p;                       // symlink loop; give up lexically
  try {
    return fs.realpathSync(p);                // exists and resolves
  } catch (e) { /* not resolvable as a whole — keep going */ }
  // A DANGLING symlink is the case that matters most: realpath throws, but a
  // Write still follows it and lands on the target. Resolve the link by hand.
  try {
    if (fs.lstatSync(p).isSymbolicLink()) {
      return realDeep(path.resolve(path.dirname(p), fs.readlinkSync(p)), d + 1);
    }
  } catch (e) { /* not a symlink, or gone */ }
  const parent = path.dirname(p);
  if (!parent || parent === p) return p;      // reached the root
  return path.join(realDeep(parent, d + 1), path.basename(p));
}

// Lexical resolve, then symlink resolve. Every path comparison below uses this.
function resolved(p, cwd) {
  const n = norm(p, cwd);
  return n ? realDeep(n) : '';
}

// The goalkeeper's own repo, realpathed too — ~/.claude itself may be a symlink.
function goalkeeperDir(cfg) {
  return realDeep(path.resolve(cfg, 'goalkeeper'));
}

// The goalkeeper's own repo. Compared against the RESOLVED path, never the raw
// string, so no spelling of it — and no symlink through it — can point elsewhere.
function underGoalkeeper(p, cfg, cwd) {
  const n = resolved(p, cwd);
  if (!n) return false;
  const gk = goalkeeperDir(cfg);
  return n === gk || n.startsWith(gk + path.sep);
}

function isScratch(p, cwd) {
  const n = resolved(p, cwd);
  if (!n) return false;
  return n.includes('/scratchpad/')
    || n.startsWith('/private/tmp/claude-')
    || n.startsWith('/tmp/claude-');
}

function allowedWrite(p, cfg, kind, cwd) {
  // The goalkeeper does not get the generic docs/md allowlist: its own repo
  // and the scratchpad, nothing else.
  if (kind === 'goalkeeper') return underGoalkeeper(p, cfg, cwd) || isScratch(p, cwd);
  // Everyone else: the standard allowlist, minus the goalkeeper's repo. The
  // exclusion is checked on the resolved path and comes FIRST, so a doubled
  // slash or a `..` segment cannot ride in on the generic `<cfg>/` allowance.
  if (underGoalkeeper(p, cfg, cwd)) return false;
  return /\.md$/i.test(p)
    || p.includes('/docs/')
    || p.startsWith(cfg + '/')
    || isScratch(p, cwd)
    || (kind === 'coordinator' && p.includes('/coordinator/'));
}

try {
  const hook = JSON.parse(fs.readFileSync(0, 'utf8'));
  const cfg = (process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude')).replace(/\/+$/, '');
  const marksDir = process.env.CLAUDE_SESSION_KIND_MARKS || path.join(cfg, 'session-kind', 'marks');
  const key = crypto.createHash('sha1').update(String(hook.cwd || '')).digest('hex').slice(0, 12);
  const marker = fs.readFileSync(path.join(marksDir, key), 'utf8').trim();
  const kind = Object.keys(LABEL).find((k) => marker.startsWith(LABEL[k]));

  // An unmarked session is not guarded at all. A marked one is — even when its
  // badge is not one of the LABEL kinds (a 🔨 WORKER), because the goalkeeper
  // isolation rules bind every stamped seat.
  const badge = marker.split('\n')[0].trim();
  WHY = ' [This session is marked ' + badge
    + '. The badge hides after 24h but the guard does not — run'
    + ' `sh ~/.claude/session-kind/mark.sh --show` to see the mark, or'
    + ' `--clear` to drop ' + (kind || 'that') + ' mode.]';

  const tool = hook.tool_name;
  const input = hook.tool_input || {};
  const cwd = String(hook.cwd || '');
  // A shell reach is a shell reach whatever the tool is called. Keying this on
  // tool_name === 'Bash' would let any MCP shell wrapper walk straight past it,
  // so the check is on the payload: anything carrying a `command` string.
  const command = typeof input.command === 'string' ? input.command : '';
  // Scan the command with heredoc BODIES removed: they are data being written,
  // not a route to anyone (item 9).
  const scan = stripHeredocs(command);
  const writePath = input.file_path || input.notebook_path;
  const isWrite = tool === 'Edit' || tool === 'Write' || tool === 'NotebookEdit';

  if (kind === 'goalkeeper') {
    // The 🥅 seat reaches nobody.
    if (MSG_TOOLS.includes(tool)) {
      deny(NO_MESSAGE_GK);
    } else if (REACH.test(scan)) {
      deny(NO_REACH_GK);
    } else if ((tool === 'Agent' || tool === 'Task') && BUILDERS.includes(input.subagent_type)) {
      deny(NO_BUILD[kind]);
    } else if (isWrite) {
      if (writePath && !allowedWrite(writePath, cfg, kind, cwd)) deny(NO_SOURCE[kind]);
    } else if (tool === 'Skill' && input.skill === 'introduce-goal') {
      deny(NO_MINT[kind]);
    }
  } else {
    // Every other stamped seat reaches everyone except the 🥅 seat.
    if (MSG_TOOLS.includes(tool) && addressesGoalkeeper(input)) {
      deny(NO_MSG_TO_GK);
    } else if (REACH.test(scan) && commandAddressesGoalkeeper(scan)) {
      deny(NO_REACH_TO_GK);
    } else if (isWrite && writePath && underGoalkeeper(writePath, cfg, cwd)) {
      deny(NO_WRITE_TO_GK);
    } else if (command && commandWritesGoalkeeper(scan, cfg, cwd)) {
      deny(NO_WRITE_TO_GK);
    } else if (!kind) {
      // A worker (or any other badge): the goalkeeper rules above are the only
      // ones that bind it. Everything else is allowed.
      process.exit(0);
    } else if ((tool === 'Agent' || tool === 'Task') && BUILDERS.includes(input.subagent_type)) {
      deny(NO_BUILD[kind]);
    } else if (isWrite) {
      if (writePath && !allowedWrite(writePath, cfg, kind, cwd)) deny(NO_SOURCE[kind]);
    } else if (NO_MINT[kind] && tool === 'Skill' && input.skill === 'introduce-goal') {
      deny(NO_MINT[kind]);
    }
  }
} catch (e) {
  // fall through: allow
}
process.exit(0);
