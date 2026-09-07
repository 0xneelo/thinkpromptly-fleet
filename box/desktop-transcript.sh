#!/usr/bin/env sh
# Renders one Claude Code transcript as plain text. $1 is the CLI session UUID, validated by
# the deck before it is passed here. Only <projects root>/*/<uuid>.jsonl is opened; thinking
# blocks are dropped, tool calls and results are clipped. Diagnostics never carry content.
if ! command -v python3 >/dev/null 2>&1; then
  printf '%s\n' '{"v":1,"state":"unavailable"}'
  exit 0
fi
python3 - "$1" <<'PY'
import glob, json, os, re, stat, sys

UUID = re.compile(r'^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$')
MAX_FILE = 64 * 1024 * 1024
MAX_TEXT = 4 * 1024 * 1024
CLIP = 400

def emit(state, **extra):
    out = {'v': 1, 'state': state}
    out.update(extra)
    print(json.dumps(out, separators=(',', ':')))
    sys.exit(0)

sid = sys.argv[1].lower() if len(sys.argv) > 1 else ''
if not UUID.fullmatch(sid):
    emit('unavailable')
users = os.environ.get('FLEET_DESKTOP_WINDOWS_USERS', '/mnt/c/Users')
roots = [os.path.join(os.path.expanduser('~'), '.claude', 'projects')]
roots += glob.glob(os.path.join(users, '*', '.claude', 'projects'))
files = []
for root in roots:
    files += glob.glob(os.path.join(glob.escape(root), '*', sid + '.jsonl'))
files = [f for f in files if not os.path.islink(f) and os.path.isfile(f)]
if not files:
    emit('not_found')
try:
    path = max(files, key=os.path.getmtime)
except OSError:
    emit('unavailable')

def clip(value):
    s = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False)
    s = ' '.join(s.split())
    return s if len(s) <= CLIP else s[:CLIP] + ' … (+%d chars)' % (len(s) - CLIP)

def result_text(content):
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return '\n'.join(b.get('text', '') for b in content if isinstance(b, dict) and b.get('type') == 'text')
    return ''

out, turns, title, meta, role, size = [], [], None, None, None, 0
try:
    fd = os.open(path, os.O_RDONLY | os.O_NONBLOCK | os.O_NOFOLLOW)
    with os.fdopen(fd, 'r', encoding='utf-8', errors='replace') as source:
        info = os.fstat(source.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_size > MAX_FILE:
            emit('unavailable')
        for line in source:
            try:
                d = json.loads(line)
            except ValueError:
                continue
            if not isinstance(d, dict):
                continue
            kind = d.get('type')
            if kind == 'custom-title' and isinstance(d.get('customTitle'), str):
                title = d['customTitle']
                continue
            if kind not in ('user', 'assistant') or d.get('isSidechain') or d.get('isMeta'):
                continue
            message = d.get('message')
            if not isinstance(message, dict):
                continue
            if meta is None:
                meta = {'cwd': d.get('cwd'), 'branch': d.get('gitBranch')}
            content = message.get('content')
            blocks = [{'type': 'text', 'text': content}] if isinstance(content, str) else content if isinstance(content, list) else []
            parts = []
            for block in blocks:
                if not isinstance(block, dict):
                    continue
                if block.get('type') == 'text' and isinstance(block.get('text'), str) and block['text'].strip():
                    parts.append(block['text'].rstrip())
                elif block.get('type') == 'tool_use':
                    parts.append('> Tool %s: %s' % (block.get('name') or '?', clip(block.get('input', {}))))
                elif block.get('type') == 'tool_result':
                    parts.append('> Result: ' + clip(result_text(block.get('content'))))
            if not parts:
                continue
            # A user-role message made of tool results only continues the assistant's turn.
            if kind == 'user' and all(part.startswith('> Result: ') for part in parts):
                kind = role or kind
            if kind != role:
                role = kind
                stamp = d.get('timestamp') if isinstance(d.get('timestamp'), str) else ''
                out.append('\n## %s%s\n' % ('User' if kind == 'user' else 'Assistant', ' · ' + stamp if stamp else ''))
                turns.append({'role': kind, 'ts': stamp, 'text': []})
            out.append('\n'.join(parts) + '\n')
            turns[-1]['text'].append(out[-1])
            size += len(out[-1])
            if size > MAX_TEXT:
                break
except OSError:
    emit('unavailable')
head = ['# ' + (title or 'Untitled session'), 'CLI session: ' + sid]
where = {'cwd': '', 'branch': ''}
for key, label in (('cwd', 'Directory'), ('branch', 'Branch')):
    if meta and isinstance(meta.get(key), str) and meta[key]:
        where[key] = meta[key]
        head.append(label + ': ' + meta[key])
text = '\n'.join(head) + '\n' + ''.join(out)
if len(text) > MAX_TEXT:
    text = text[:MAX_TEXT] + '\n… transcript clipped at 4 MB\n'
emit('ok', text=text, title=title or 'Untitled session', cwd=where['cwd'], branch=where['branch'],
     turns=[{'role': t['role'], 'ts': t['ts'], 'text': ''.join(t['text']).rstrip('\n')} for t in turns])
PY
