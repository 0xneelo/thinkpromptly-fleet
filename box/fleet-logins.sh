#!/usr/bin/env sh
# Master copy. Nothing is installed on a polled machine: the deck pipes this file over
# `ssh <host> [wsl] sh -s`. One compact JSON line for THIS machine — which account each of
# the four AI clients is signed in as (Claude CLI, Codex CLI, Claude desktop, Codex desktop).
#   sh fleet-logins.sh [id]            -> print the line
#   sh fleet-logins.sh push <url> [id] -> POST the line to a fleetdeck /api/machines
# IDENTITY ONLY. The Claude access token and the Codex tokens are read into python memory,
# used only for this machine's own profile call, and never printed, stored, logged, or put
# in argv — the two request headers go through a 0600 temp file, so no token appears in `ps`.
# A hang-up (the deck's ssh timeout) unwinds through `finally`, so that file never outlives
# the call. On a non-200 the response body is dropped unread. Runs on mac, WSL and linux.

if [ "$1" = push ]; then
  URL=$2
  ID=$3
else
  ID=$1
fi
HOST=$(hostname -s 2>/dev/null || hostname)
PY=$(command -v python3)
# The id is a machines.json key; anything else is dropped rather than quoted into JSON.
IDJ=null
case $ID in '' | *[!A-Za-z0-9._-]*) ID='' ;; *) IDJ=\"$ID\" ;; esac

LINE=""
[ -n "$PY" ] && LINE=$(FLEET_LOGIN_ID="$ID" FLEET_LOGIN_HOST="$HOST" "$PY" - <<'PY'
import base64, glob, json, os, shutil, signal, subprocess, tempfile, time

# SIGHUP/SIGTERM as an exception, not a death: `finally` then unlinks the header file.
def _bail(*a): raise SystemExit(1)
for _s in (signal.SIGHUP, signal.SIGTERM): signal.signal(_s, _bail)

HOME = os.path.expanduser("~")
PROFILE_URL = os.environ.get("FLEET_PROFILE_URL") or "https://api.anthropic.com/api/oauth/profile"
# Shared Windows profiles are not people; scanning them would report the same login twice.
WIN_SKIP = ("Public", "Default", "Default User", "All Users", "desktop.ini")

uname = os.uname().sysname.lower()
def _wsl():
    if os.environ.get("WSL_DISTRO_NAME"): return True
    try: return "microsoft" in open("/proc/version").read().lower()
    except Exception: return False
OS = "darwin" if uname == "darwin" else ("wsl" if _wsl() else "linux")

def jload(p):
    try:
        if os.path.getsize(p) > 20000000: return None   # a runaway file is skipped, not parsed
        with open(p) as fh: return json.load(fh)
    except Exception:
        return None

# Null fields are simply absent; the deck fills them back in as null.
def entry(client, where, **kw):
    e = {"client": client, "where": where}
    for k, v in kw.items():
        if v is not None: e[k] = v
    return e

def secs(v):
    if not isinstance(v, (int, float)): return None
    return int(v / 1000) if v > 1e11 else int(v)

# The Mac keeps the Claude credentials in the login Keychain, not on disk. Read through
# subprocess so the token is a python string and never a shell word.
def keychain():
    try:
        r = subprocess.run(["security", "find-generic-password", "-s", "Claude Code-credentials", "-w"],
                           capture_output=True, text=True, timeout=10)
        return json.loads(r.stdout) if r.returncode == 0 and r.stdout.strip() else None
    except Exception:
        return None

# The token's own identity, which is the truth: ~/.claude.json can name a different account
# than the token in use. Returns (status, body) and never the body of a failed call.
def profile(token):
    hdr = body = None
    try:
        fd, hdr = tempfile.mkstemp()   # 0600 by default; the token never reaches argv
        os.write(fd, ("Authorization: Bearer " + token + "\nanthropic-beta: oauth-2025-04-20\n").encode())
        os.close(fd)
        fd, body = tempfile.mkstemp()
        os.close(fd)
        r = subprocess.run(["curl", "-sS", "-m", "8", "-o", body, "-w", "%{http_code}",
                            "-H", "@" + hdr, PROFILE_URL], capture_output=True, text=True, timeout=20)
        code = (r.stdout or "").strip()
        if code == "200": return 200, jload(body)
        return (int(code) if code.isdigit() else 0), None
    except Exception:
        return 0, None
    finally:
        for f in (hdr, body):
            try:
                if f: os.unlink(f)
            except Exception:
                pass

def jwt(tok):
    try:
        seg = tok.split(".")[1]
        return json.loads(base64.urlsafe_b64decode(seg + "=" * (-len(seg) % 4)))
    except Exception:
        return {}

def claude_cli(home, where):
    cfg = jload(os.path.join(home, ".claude.json")) or {}
    acct = cfg.get("oauthAccount") or {}
    ce, co = acct.get("emailAddress") or None, acct.get("organizationUuid") or None
    cred = jload(os.path.join(home, ".claude", ".credentials.json"))
    if cred is None and where == "local" and OS == "darwin": cred = keychain()
    o = (cred or {}).get("claudeAiOauth") or cred or {}
    token = o.get("accessToken") if isinstance(o, dict) else None
    base = dict(installed=True, config_email=ce, config_org=co,
                expires_at=secs(o.get("expiresAt") if isinstance(o, dict) else None))
    if token:
        code, body = profile(token)
        if code == 200 and isinstance(body, dict):
            a, g = body.get("account") or {}, body.get("organization") or {}
            return entry("claude_cli", where, state="ok", signed_in=True, proof="profile",
                         email=a.get("email") or a.get("email_address"), org=g.get("uuid"),
                         tier=g.get("rate_limit_tier"), plan=g.get("organization_type"), **base)
        # No refresh flow here: a human reopens Claude Code. The config is the only fallback,
        # and it is labelled as one because it can name a different account than the token.
        state = "token_expired" if code in (401, 403) else "rate_limited" if code == 429 else "error"
        return entry("claude_cli", where, state=state, signed_in=False if state == "token_expired" else None,
                     proof="config", email=ce, org=co, **base)
    if ce or co:
        return entry("claude_cli", where, state="config_only", proof="config", email=ce, org=co, **base)
    installed = os.path.isdir(os.path.join(home, ".claude")) or (where == "local" and bool(shutil.which("claude")))
    return entry("claude_cli", where, installed=installed, signed_in=False if installed else None,
                 state="signed_out" if installed else "not_installed")

def codex_cli(home, where):
    auth = jload(os.path.join(home, ".codex", "auth.json"))
    if not isinstance(auth, dict):
        installed = os.path.isdir(os.path.join(home, ".codex")) or (where == "local" and bool(shutil.which("codex")))
        return entry("codex_cli", where, installed=installed, signed_in=False if installed else None,
                     state="signed_out" if installed else "not_installed")
    tok = auth.get("tokens") if isinstance(auth.get("tokens"), dict) else {}
    claims = jwt(tok.get("id_token")) if tok.get("id_token") else {}
    if auth.get("auth_mode") == "apikey" or (not claims and auth.get("OPENAI_API_KEY")):
        return entry("codex_cli", where, installed=True, signed_in=True, state="api_key",
                     last_refresh=auth.get("last_refresh"))
    if not claims:
        return entry("codex_cli", where, installed=True, signed_in=False, state="signed_out")
    a = claims.get("https://api.openai.com/auth") or {}
    # An elapsed exp is not a signed-out CLI: it refreshes itself. The refresh age is the
    # honest signal, so both travel and the view reads the age.
    return entry("codex_cli", where, installed=True, signed_in=True, state="ok", proof="jwt",
                 email=claims.get("email"), plan=a.get("chatgpt_plan_type"),
                 account_id=a.get("chatgpt_account_id") or tok.get("account_id"),
                 expires_at=secs(claims.get("exp")), last_refresh=auth.get("last_refresh"))

# Only plan-usage-history.json is opened. config.json in that same directory is an oauth
# token cache and is never read, parsed or emitted.
def claude_desktop(home, where):
    if where == "local":
        if OS != "darwin" or not os.path.isdir(os.path.join(home, "Library", "Application Support", "Claude")):
            return entry("claude_desktop", "local", installed=False, state="not_installed")
        paths = [os.path.join(home, "Library", "Application Support", "Claude", "plan-usage-history.json")]
    else:
        paths = glob.glob(os.path.join(home, "AppData/Local/Packages/Claude_*/LocalCache/Roaming/Claude/plan-usage-history.json"))
        if not paths: return None
    samples = (jload(paths[0]) or {}).get("samples") or []
    orgs, last = [], None
    for s in samples:
        if not isinstance(s, dict): continue
        if isinstance(s.get("org"), str) and s["org"] not in orgs: orgs.append(s["org"])
        if isinstance(s.get("t"), (int, float)) and (last is None or s["t"] > last["t"]): last = s
    if last is None:
        return entry("claude_desktop", where, installed=True, state="no_samples")
    # The app samples as it is used, so the newest sample's org is the account it is on now.
    return entry("claude_desktop", where, installed=True, signed_in=True, state="ok", proof="history",
                 org=last.get("org"), last_active=secs(last["t"]), orgs_seen=orgs[:25])

# The Codex app shares ~/.codex/auth.json with the CLI, so it has no identity of its own.
def codex_desktop(home, where, cli):
    note = None
    if where == "local":
        found = OS == "darwin" and (os.path.isdir("/Applications/Codex.app")
                                    or os.path.isdir(os.path.join(home, "Applications", "Codex.app")))
        # The app is not always installed as Codex.app; dictation is a desktop-only feature,
        # so its history directory is the fallback evidence — said out loud, not assumed.
        if not found and OS == "darwin" and os.path.isdir(os.path.join(home, ".codex", "dictation-history")):
            found, note = True, "no Codex.app bundle; detected by ~/.codex/dictation-history"
    else:
        found = any(glob.glob(p) for p in (os.path.join(home, "AppData/Local/Programs/Codex*"),
                                           os.path.join(home, "AppData/Local/Codex*"),
                                           "/mnt/c/Program Files*/Codex*"))
    if not found:
        return entry("codex_desktop", where, installed=False, state="not_installed")
    cli = cli or {}
    return entry("codex_desktop", where, installed=True, signed_in=cli.get("signed_in"), note=note,
                 state=cli.get("state") or "signed_out", shares="codex_cli",
                 **{k: cli.get(k) for k in ("email", "plan", "account_id", "expires_at", "last_refresh", "proof")})

out = [claude_cli(HOME, "local"), codex_cli(HOME, "local"), claude_desktop(HOME, "local")]
out.append(codex_desktop(HOME, "local", out[1]))
if OS == "wsl":
    # One entry per client for the Windows side: several profiles may exist, and the one
    # actually signed in is the one worth reporting.
    best = {}
    for u in sorted(glob.glob("/mnt/c/Users/*")):
        if os.path.basename(u) in WIN_SKIP or not os.path.isdir(u): continue
        cx = codex_cli(u, "windows")
        for e in (claude_cli(u, "windows"), cx, claude_desktop(u, "windows"), codex_desktop(u, "windows", cx)):
            if e: best.setdefault(e["client"], []).append(e)
    for lst in best.values():
        out.append(max(lst, key=lambda e: (e.get("signed_in") is True, e.get("installed") is True)))

print(json.dumps({"v": 1, "id": os.environ.get("FLEET_LOGIN_ID") or None,
                  "host": os.environ.get("FLEET_LOGIN_HOST") or None, "os": OS,
                  "ts": int(time.time()), "clients": [e for e in out if e]}, separators=(",", ":")))
PY
)

# A partial failure is a state on a client, not a missing line: the deck always gets JSON.
[ -n "$LINE" ] || LINE=$(printf '{"v":1,"id":%s,"host":"%s","os":"unknown","ts":%s,"clients":[],"note":"no python3 or collector failed"}' "$IDJ" "$HOST" "$(date +%s)")

if [ "$1" = push ] && [ -n "$URL" ]; then
  printf '%s' "$LINE" | curl -sf -X POST -H 'content-type: application/json' --data-binary @- "$URL" > /dev/null
else
  printf '%s\n' "$LINE"
fi
exit 0
