#!/usr/bin/env sh
# Claude Desktop Code-tab metadata only. Run locally, or pipe over ssh [wsl] sh -s.
# Only <accountUuid>/<orgUuid>/local_<id>.json is opened. No credential/config files,
# transcripts, scheduled tasks, or peer keys. Diagnostics are counts, never file content.
if ! command -v python3 >/dev/null 2>&1; then
  printf '%s\n' '{"v":1,"state":"unavailable","complete":false,"sessions":[],"skipped":0}'
  exit 0
fi
python3 - <<'PY'
import datetime, glob, json, math, os, re, stat, time

UUID = re.compile(r'^[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$')
LOCAL = re.compile(r'^local_[A-Za-z0-9_-]{1,160}\.json$')
MAX_FILE = 2 * 1024 * 1024
MAX_ROWS = 20000
skipped = 0

def text(value, limit):
    return value[:limit] if isinstance(value, str) else None

def stamp(value):
    try:
        if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value):
            if value < 0:
                return None
            date = datetime.datetime.fromtimestamp(value / 1000, datetime.timezone.utc)
        elif isinstance(value, str):
            date = datetime.datetime.fromisoformat(value.replace('Z', '+00:00'))
            if date.tzinfo is None:
                return None
            date = date.astimezone(datetime.timezone.utc)
        else:
            return None
        return date.isoformat(timespec='milliseconds').replace('+00:00', 'Z')
    except (ValueError, OverflowError, OSError):
        return None

def entries(folder):
    global skipped
    try:
        with os.scandir(folder) as scan:
            return sorted(scan, key=lambda e: e.name)
    except OSError:
        skipped += 1
        return []

def read_row(entry, account, org):
    # O_NONBLOCK prevents a substituted FIFO from hanging; O_NOFOLLOW rejects symlinks.
    fd = os.open(entry.path, os.O_RDONLY | os.O_NONBLOCK | os.O_NOFOLLOW)
    with os.fdopen(fd, 'r', encoding='utf-8') as source:
        info = os.fstat(source.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_size > MAX_FILE:
            raise ValueError()
        raw = source.read(MAX_FILE + 1)
        if len(raw) > MAX_FILE:
            raise ValueError()
        data = json.loads(raw)
    if not isinstance(data, dict):
        raise ValueError()
    turns = data.get('completedTurns')
    cli = data.get('cliSessionId')
    return {
        'accountUuid': account.lower(), 'orgUuid': org.lower(), 'id': entry.name[:-5],
        'title': text(data.get('title'), 1000), 'cwd': text(data.get('cwd'), 4096),
        'worktree': text(data.get('worktree'), 4096), 'branch': text(data.get('branch'), 300),
        'model': text(data.get('model'), 100), 'createdAt': stamp(data.get('createdAt')),
        'lastActivityAt': stamp(data.get('lastActivityAt')),
        'isArchived': data.get('isArchived') is True,
        'completedTurns': turns if isinstance(turns, int) and not isinstance(turns, bool) and 0 <= turns <= 9007199254740991 else None,
        'cliSessionId': cli.lower() if isinstance(cli, str) and UUID.fullmatch(cli) else None,
    }

home = os.path.expanduser('~')
roots = [os.path.join(home, 'Library/Application Support/Claude/claude-code-sessions')]
# Override the Windows users root for fixture isolation, never to choose a config file.
users = os.environ.get('FLEET_DESKTOP_WINDOWS_USERS', '/mnt/c/Users')
roots += glob.glob(os.path.join(users, '*/AppData/Local/Packages/Claude_*/LocalCache/Roaming/Claude/claude-code-sessions'))
roots += glob.glob(os.path.join(users, '*/AppData/Roaming/Claude/claude-code-sessions'))
roots = sorted(set(root for root in roots if os.path.isdir(root) and not os.path.islink(root)))
rows = {}
try:
    for root in roots:
        for account in entries(root):
            if not UUID.fullmatch(account.name) or not account.is_dir(follow_symlinks=False):
                continue
            for org in entries(account.path):
                if not UUID.fullmatch(org.name):
                    continue
                if not org.is_dir(follow_symlinks=False):
                    skipped += 1
                    continue
                for entry in entries(org.path):
                    if not LOCAL.fullmatch(entry.name):
                        continue
                    try:
                        row = read_row(entry, account.name, org.name)
                        key = (row['accountUuid'], row['orgUuid'], row['id'])
                        previous = rows.get(key)
                        if previous is None or (row['lastActivityAt'] or '') > (previous['lastActivityAt'] or ''):
                            rows[key] = row
                        if len(rows) > MAX_ROWS:
                            raise OverflowError()
                    except (OSError, ValueError, UnicodeError, RecursionError):
                        skipped += 1
    print(json.dumps({'v': 1, 'state': 'ok' if roots else 'not_found', 'ts': int(time.time()),
                      'complete': skipped == 0, 'skipped': skipped, 'sessions': [rows[k] for k in sorted(rows)]},
                     separators=(',', ':')))
except Exception:
    # Never print exception text: JSON parse errors can contain source content.
    print('{"v":1,"state":"unavailable","complete":false,"sessions":[],"skipped":0}')
PY
