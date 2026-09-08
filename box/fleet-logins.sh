#!/usr/bin/env sh
# Master copy. Nothing is installed on a polled machine: the deck pipes this file over
# `ssh <host> [wsl] sh -s`. One compact JSON line for THIS machine — which account each of
# the four AI clients is signed in as (Claude CLI, Codex CLI, Claude desktop, Codex desktop).
#   sh fleet-logins.sh [id]            -> print the line
#   sh fleet-logins.sh push <url> [id] -> POST the line to a fleetdeck /api/machines
# IDENTITY, plus the usage windows of a Claude login that proved itself. The Claude access
# token and the Codex tokens are read into python memory, used only for this machine's own
# profile and usage calls, and never printed, stored, logged, or put in argv — the two
# request headers go through a 0600 temp file, so no token appears in `ps`.
# A Claude token the endpoint refuses on a machine whose credential is an on-disk file is
# refreshed the way the CLI itself does it — same endpoint, client id, scopes and the same
# two lock directories — and the new credential is written back to that file, so a box login
# stays signed in instead of going stale between uses. The Mac's login Keychain is READ, never
# written: the operator uses Claude Code there, so its own runs keep that token fresh, and a
# background writer must not race the CLI's own Keychain writes.
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
import base64, glob, json, os, re, shutil, signal, subprocess, tempfile, time
# sqlite3 is imported where it is used, never here. It is the only import in this file that
# a python3 build can lack (musl and other minimal builds ship without libsqlite3), and it
# serves ONE mac-only client. Imported up here, its absence would abort the whole heredoc
# before a single client was read — the wrapper would then emit the empty fallback line and
# a machine would report nothing at all because a feature it does not use is unavailable.

# SIGHUP/SIGTERM as an exception, not a death: `finally` then unlinks the header file.
def _bail(*a): raise SystemExit(1)
for _s in (signal.SIGHUP, signal.SIGTERM): signal.signal(_s, _bail)

HOME = os.path.expanduser("~")
PROFILE_URL = os.environ.get("FLEET_PROFILE_URL") or "https://api.anthropic.com/api/oauth/profile"
USAGE_URL = os.environ.get("FLEET_USAGE_URL") or "https://api.anthropic.com/api/oauth/usage"
TOKEN_URL = os.environ.get("FLEET_TOKEN_URL") or "https://api.anthropic.com/v1/oauth/token"
# Claude Code's own OAuth client and default scopes (read out of claude 2.1.261). A refresh is
# the request the CLI makes on start-up, so what comes back is a credential the CLI accepts.
CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e"
SCOPES = ["user:inference", "user:profile", "user:sessions:claude_code", "user:mcp_servers", "user:file_upload"]
REFRESH_LOCK_STALE = 60   # the CLI's proper-lockfile `stale`: an older lock dir was abandoned
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
# subprocess so the token is a python string and never a shell word. Returns
# (creds, why) where why is (state, note): a locked, denied or GUI-less Keychain must not
# read as a signed-out CLI. Only stderr is ever quoted back — stdout is the secret.
def keychain():
    try:
        r = subprocess.run(["security", "find-generic-password", "-s", "Claude Code-credentials", "-w"],
                           capture_output=True, text=True, timeout=10)
    except Exception as e:
        return None, ("keychain_denied", "security could not be run: " + type(e).__name__)
    if r.returncode != 0:
        err = " ".join((r.stderr or "").split())[:120]
        if "could not be found" in err.lower():
            return None, ("absent", "the login Keychain has no Claude Code-credentials item")
        return None, ("keychain_denied", err or ("security exited %d with no message" % r.returncode))
    try:
        d = json.loads(r.stdout)
    except Exception:
        d = None
    if not isinstance(d, dict):
        return None, ("unknown_source", "the Keychain Claude Code-credentials item is not the JSON object expected")
    return d, None

# One oauth GET with this machine's own token: the profile names the account (the truth,
# since ~/.claude.json can name a different one than the token in use) and the usage endpoint
# gives that account's windows. Returns (status, body) and never the body of a failed call.
def oauth_get(url, token):
    hdr = body = None
    try:
        fd, hdr = tempfile.mkstemp()   # 0600 by default; the token never reaches argv
        os.write(fd, ("Authorization: Bearer " + token + "\nanthropic-beta: oauth-2025-04-20\n").encode())
        os.close(fd)
        fd, body = tempfile.mkstemp()
        os.close(fd)
        r = subprocess.run(["curl", "-sS", "-m", "8", "-o", body, "-w", "%{http_code}",
                            "-H", "@" + hdr, url], capture_output=True, text=True, timeout=20)
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

# One POST to the token endpoint. The body goes through a 0600 temp file (`--data-binary @`),
# so the refresh token is no more an argument than the access token is. Returns (status, body)
# with the body parsed only on a 200 — a refusal's text is never quoted anywhere.
def oauth_post(url, payload):
    req = body = None
    try:
        fd, req = tempfile.mkstemp()
        os.write(fd, json.dumps(payload).encode())
        os.close(fd)
        fd, body = tempfile.mkstemp()
        os.close(fd)
        r = subprocess.run(["curl", "-sS", "-m", "15", "-o", body, "-w", "%{http_code}",
                            "-H", "Content-Type: application/json", "--data-binary", "@" + req, url],
                           capture_output=True, text=True, timeout=25)
        code = (r.stdout or "").strip()
        if code == "200": return 200, jload(body)
        return (int(code) if code.isdigit() else 0), None
    except Exception:
        return 0, None
    finally:
        for f in (req, body):
            try:
                if f: os.unlink(f)
            except Exception:
                pass

# The CLI refreshes under two mkdir locks (proper-lockfile): `<config>/.oauth_refresh.lock`
# and the legacy `<realpath config>.lock`, each stale after 60s. Taking the same two, in the
# same order, is what keeps a refresh here from racing a live session's — whoever is second
# sees the directory and backs off. Returns the held paths, or None when someone holds one.
def refresh_lock(cdir):
    held = []
    for l in (os.path.join(cdir, ".oauth_refresh.lock"), os.path.realpath(cdir) + ".lock"):
        try:
            os.mkdir(l)
        except FileExistsError:
            try: age = time.time() - os.stat(l).st_mtime
            except Exception: age = 0
            if age < REFRESH_LOCK_STALE:
                unlock(held)
                return None
            try:
                os.rmdir(l)
                os.mkdir(l)
            except Exception:
                unlock(held)
                return None
        except Exception:
            unlock(held)
            return None
        held.append(l)
    return held

def unlock(held):
    for l in held:
        try: os.rmdir(l)
        except Exception: pass

def stored_token(d):
    return ((d or {}).get("claudeAiOauth") or {}).get("accessToken") if isinstance(d, dict) else None

# Both stores put the new claudeAiOauth into whatever else the store holds (mcpOAuth rides
# along untouched), then read it back: a write that did not land is reported, never assumed.
# Each returns None on success, or why not.
def file_store(path):
    def store(new):
        d = jload(path)
        if not isinstance(d, dict) or not isinstance(d.get("claudeAiOauth"), dict): return "unexpected credential shape"
        d["claudeAiOauth"] = new
        tmp = path + ".fleet-tmp"   # same directory, so the rename is atomic
        try:
            fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
            with os.fdopen(fd, "w") as fh: json.dump(d, fh)
            os.replace(tmp, path)
        except BaseException as e:
            # BaseException, so a SIGTERM-driven SystemExit mid-write still unlinks the
            # 0600 temp holding a live credential rather than stranding it on disk.
            try: os.unlink(tmp)
            except Exception: pass
            if isinstance(e, Exception): return "write failed: " + type(e).__name__
            raise
        return None if stored_token(jload(path)) == new["accessToken"] else "read-back mismatch"
    return store


# Runs only after this machine's own profile call refused the access token — the moment the
# CLI itself would refresh. The reply rotates the refresh token, so the store is proven
# writable first (by writing what it already holds) and the new credential is stored before
# it is used: a refresh that could not be written back would sign this machine out.
# Returns (new claudeAiOauth, None) or (None, why not).
def refresh(o, cdir, store):
    rt = o.get("refreshToken")
    if not isinstance(rt, str) or not rt: return None, "no refresh token"
    rexp = secs(o.get("refreshTokenExpiresAt"))
    if rexp and rexp < time.time(): return None, "refresh token expired, sign in again"
    held = refresh_lock(cdir)
    if held is None: return None, "another refresh holds the lock"
    # The token endpoint rotates the refresh token the moment the POST succeeds, so from here
    # to the write-back a death (the deck's 60s ssh timeout sends SIGTERM) would strand the
    # rotated token: the old one is now dead server-side and the new one never reached disk,
    # locking this box out of refresh until a human `claude auth login`. Defer those two
    # signals across just this span — a POST plus one local atomic write — then honour them.
    deferred = []
    prev = {}
    try:
        for _sig in (signal.SIGHUP, signal.SIGTERM):
            prev[_sig] = signal.signal(_sig, lambda n, f: deferred.append(n))
        why = store(o)
        if why: return None, "store not writable, " + why
        scopes = [x for x in (o.get("scopes") or []) if isinstance(x, str)] if isinstance(o.get("scopes"), list) else []
        # An empty scopes list falls back to the defaults, exactly as the CLI's own refresh does.
        code, body = oauth_post(TOKEN_URL, {"grant_type": "refresh_token", "refresh_token": rt,
                                             "client_id": o.get("clientId") or CLIENT_ID,
                                             "scope": " ".join(scopes or SCOPES)})
        if code != 200 or not isinstance(body, dict) or not isinstance(body.get("access_token"), str):
            return None, "token endpoint answered %s" % (code or "nothing")
        now = int(time.time() * 1000)
        new = dict(o, accessToken=body["access_token"],
                   refreshToken=body["refresh_token"] if isinstance(body.get("refresh_token"), str) else rt)
        ei, rei = body.get("expires_in"), body.get("refresh_token_expires_in")
        new["expiresAt"] = now + (int(ei) if isinstance(ei, (int, float)) else 3600) * 1000
        if isinstance(rei, (int, float)): new["refreshTokenExpiresAt"] = now + int(rei) * 1000
        why = store(new)
        if why: return None, "refreshed but not stored, " + why
        return new, None
    finally:
        for _sig, _h in prev.items(): signal.signal(_sig, _h)
        unlock(held)
        if deferred: raise SystemExit(1)   # a kill arrived during the span; honour it now

PCT_KEYS = ("utilization", "used_percentage", "used_percent", "pct")
XU_KEYS = ("utilization", "used_credits", "monthly_limit", "decimal_places", "currency",
           "is_enabled", "spend_limit_reached")

# A per-model weekly limit: only the fields the deck turns into a window travel.
def trim_limit(l):
    o = {k: l[k] for k in ("kind", "percent", "resets_at") if k in l}
    s = l.get("scope") if isinstance(l.get("scope"), dict) else {}
    m = s.get("model") if isinstance(s.get("model"), dict) else {}
    scope = {k: s[k] for k in ("surface",) if k in s}
    model = {k: m[k] for k in ("display_name", "id") if k in m}
    if model: scope["model"] = model
    if scope: o["scope"] = scope
    return o

# The reply carries more than the windows — `spend` among it. Only what the deck's own
# whitelist reads is copied out, so a field the endpoint adds later never leaves this box.
def trim_usage(u):
    # Some builds answer with the windows nested under rate_limits, others at the top level;
    # trimming the outer object of a nested reply would keep nothing at all.
    rl = u.get("rate_limits")
    if isinstance(rl, dict): u = rl
    out = {}
    for k, v in u.items():
        if k == "extra_usage":
            if isinstance(v, dict): out[k] = {x: v[x] for x in XU_KEYS if x in v}
        elif k == "limits":
            if isinstance(v, list):
                out[k] = [trim_limit(l) for l in v[:20] if isinstance(l, dict)]
        elif isinstance(v, dict) and any(x in v for x in PCT_KEYS):
            out[k] = {x: v[x] for x in PCT_KEYS + ("resets_at",) if x in v}
    return out

def jwt(tok):
    try:
        seg = tok.split(".")[1]
        return json.loads(base64.urlsafe_b64decode(seg + "=" * (-len(seg) % 4)))
    except Exception:
        return {}

def base_of(ce, co, exp=None):
    return dict(installed=True, config_email=ce, config_org=co, expires_at=secs(exp))

def claude_cli(home, where):
    cfg = jload(os.path.join(home, ".claude.json")) or {}
    acct = cfg.get("oauthAccount") or {}
    ce, co = acct.get("emailAddress") or None, acct.get("organizationUuid") or None
    cred_path = os.path.join(home, ".claude", ".credentials.json")
    cred = jload(cred_path)
    # A refresh is written straight back, so only a store we can write safely earns one: the
    # on-disk credential file, never the Mac Keychain (read-only here — see the header).
    note, store = None, file_store(cred_path)
    if cred is None and where == "local" and OS == "darwin":
        cred, why = keychain()
        store = None
        # A Keychain that refused, or holds something else, is its own state — but only when
        # it is the reason there is no token, so a working on-disk credential still wins.
        if cred is None and why and why[0] != "absent":
            fallback = why[0] == "keychain_denied"
            return entry("claude_cli", where, state=why[0], proof="config" if fallback else None,
                         email=ce if fallback else None, org=co if fallback else None,
                         note=why[1], **base_of(ce, co))
        if why: note = why[1]
    o = (cred or {}).get("claudeAiOauth") or cred or {}
    token = o.get("accessToken") if isinstance(o, dict) else None
    base = base_of(ce, co, o.get("expiresAt") if isinstance(o, dict) else None)
    if token:
        code, body = oauth_get(PROFILE_URL, token)
        # Only the store shape the CLI writes today is refreshed; a flat legacy file is left
        # for the CLI to migrate. The note says what happened either way.
        if code in (401, 403) and store and isinstance(cred, dict) and isinstance(cred.get("claudeAiOauth"), dict):
            new, why = refresh(o, os.path.join(home, ".claude"), store)
            if new:
                o, token = new, new["accessToken"]
                base = base_of(ce, co, o.get("expiresAt"))
                code, body = oauth_get(PROFILE_URL, token)
                # A refreshed token that STILL will not prove itself is not a success: say so,
                # or the row would read "token refreshed" beside a signed-out state.
                note = "token refreshed" if code == 200 else "refreshed but still refused (%s)" % code
            else:
                note = "not refreshed: " + why
        if code == 200 and isinstance(body, dict):
            a, g = body.get("account") or {}, body.get("organization") or {}
            # Only a token that just proved itself is worth spending a second call on. The
            # windows belong to THIS account, so they ride with the identity that named it.
            ucode, ubody = oauth_get(USAGE_URL, token)
            # A 200 carrying something other than the object expected is a broken reply: called
            # "ok" with no windows it would read on the deck as an account using nothing.
            ok = ucode == 200 and isinstance(ubody, dict)
            ustate = ("ok" if ok else "rate_limited" if ucode == 429
                      else "token_expired" if ucode in (401, 403) else "error")
            usage = trim_usage(ubody) if ok else None
            return entry("claude_cli", where, state="ok", signed_in=True, proof="profile",
                         email=a.get("email") or a.get("email_address"), org=g.get("uuid"),
                         tier=g.get("rate_limit_tier"), plan=g.get("organization_type"),
                         usage_state=ustate, usage=usage, note=note, **base)
        # A token refused and not refreshable: the config is the only fallback, and it is
        # labelled as one because it can name a different account than the token.
        state = "token_expired" if code in (401, 403) else "rate_limited" if code == 429 else "error"
        return entry("claude_cli", where, state=state, signed_in=False if state == "token_expired" else None,
                     proof="config", email=ce, org=co, note=note, **base)
    if ce or co:
        return entry("claude_cli", where, state="config_only", proof="config", email=ce, org=co, note=note, **base)
    installed = os.path.isdir(os.path.join(home, ".claude")) or (where == "local" and bool(shutil.which("claude")))
    return entry("claude_cli", where, installed=installed, signed_in=False if installed else None,
                 state="signed_out" if installed else "not_installed", note=note)

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
    hist = jload(paths[0])
    # Three different truths, and only the third is a broken file. Missing or unreadable, and
    # a dict that simply has no samples key yet, both mean "installed, nothing sampled" — the
    # app writes the key when it first samples, so a fresh install legitimately lacks it.
    # A samples key holding something that is not a list is the only real shape violation.
    if isinstance(hist, dict) and "samples" in hist and not isinstance(hist["samples"], list):
        return entry("claude_desktop", where, installed=True, state="unknown_source",
                     note="plan-usage-history.json is not the shape expected: samples is not a list")
    if hist is not None and not isinstance(hist, dict):
        return entry("claude_desktop", where, installed=True, state="unknown_source",
                     note="plan-usage-history.json is not the shape expected: not a JSON object")
    samples = (hist or {}).get("samples") or []
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

# The Codex app is Electron, so its signed-in account lives in the Chromium profile under
# the app's own userData directory — not in ~/.codex/auth.json. The exact directory name is
# not contractual, so it is globbed (app dir, optionally one profile level down) rather than
# hardcoded, and finding nothing is a normal outcome.
CODEX_APP_DIRS = ("Codex*", "codex*", "OpenAI/Codex*", "com.openai.codex*")
CODEX_DB_FILES = ("Login Data For Account", "Account Web Data")
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$")

# The app's own Electron userData directory. Validated on the Mac 2026-09-06: the bundle
# checks missed and ~/Library/Application Support/Codex/ was there, so this is the evidence
# that stops a present app being reported as absent.
def codex_app_dirs(home):
    base, out = os.path.join(home, "Library", "Application Support"), []
    for d in CODEX_APP_DIRS:
        for q in sorted(glob.glob(os.path.join(base, d))):
            if os.path.isdir(q) and q not in out: out.append(q)
    return out

def codex_profile_dbs(home):
    base, out = os.path.join(home, "Library", "Application Support"), []
    for d in CODEX_APP_DIRS:
        for f in CODEX_DB_FILES:                     # Login Data For Account is tried first
            for pat in (os.path.join(base, d, f), os.path.join(base, d, "*", f)):
                for q in sorted(glob.glob(pat)):
                    if os.path.isfile(q) and q not in out: out.append(q)
    return out

# ONE column, from a private copy, opened read-only: the account name. password_value, any
# token_service table and every cookie store are never selected, so no secret can be reached.
# Returns (email, note, kind) where kind is ok / no_email / unreadable — "the file holds no
# email" and "the file cannot be read" are different answers and must not share a state.
# The copy is removed in `finally`, so a hang-up leaves nothing.
def codex_db_email(path):
    # mkdtemp inside the try, so a SIGHUP between creating the directory and entering the
    # block cannot unwind past a scope that was never entered and strand the copy.
    name, tmp = os.path.basename(path), None
    try:
        import sqlite3   # here, not at the top: a python3 without it must not cost the
                         # other three clients their reading. See the import comment above.
        tmp = tempfile.mkdtemp()   # 0700 by default
        dst = os.path.join(tmp, "db")
        shutil.copyfile(path, dst)
        # The sidecars travel too, or the copy would be a torn read of a live database.
        for sfx in ("-wal", "-shm", "-journal"):
            if os.path.isfile(path + sfx): shutil.copyfile(path + sfx, dst + sfx)
        con = sqlite3.connect("file:" + dst + "?mode=ro", uri=True)
        try:
            if not con.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='logins'").fetchall():
                return None, name + " has no logins table", "unreadable"
            if "username_value" not in [c[1] for c in con.execute("PRAGMA table_info(logins)")]:
                return None, name + " logins table has no username_value column", "unreadable"
            for row in con.execute("SELECT username_value FROM logins"):
                v = row[0].strip() if isinstance(row[0], str) else ""
                if EMAIL_RE.match(v): return v, None, "ok"
            # Probed on the Mac 2026-09-06: the account IS in this profile, but Codex desktop
            # keeps it under Chromium safeStorage / IndexedDB rather than in the logins table.
            # Naming that is the point — it tells the next reader where to look instead of
            # leaving them to rediscover that this table is the wrong place.
            return None, (name + " has no email-shaped username_value; Codex desktop keeps the"
                          " account under safeStorage/IndexedDB, which this reader cannot read"), "no_email"
        finally:
            con.close()
    except Exception as e:
        return None, name + " could not be read: " + type(e).__name__, "unreadable"
    finally:
        # ignore_errors swallows OSError, not the TypeError rmtree(None) would raise if the
        # import above failed before there was ever a directory to remove.
        if tmp: shutil.rmtree(tmp, ignore_errors=True)

def codex_desktop(home, where, cli):
    note = None
    if where == "local":
        found = OS == "darwin" and (os.path.isdir("/Applications/Codex.app")
                                    or os.path.isdir(os.path.join(home, "Applications", "Codex.app")))
        # The bundle is not always where those two look. The app's own userData directory is
        # the stronger evidence and carries no caveat, so it is tried before the dictation
        # directory — the Mac run of 2026-09-06 had the userData dir and no bundle, and said
        # "no Codex.app bundle", which was a false negative worth not repeating.
        if not found and OS == "darwin":
            if codex_app_dirs(home):
                found = True
            elif os.path.isdir(os.path.join(home, ".codex", "dictation-history")):
                found, note = True, "no Codex.app bundle; detected by ~/.codex/dictation-history"
    else:
        found = any(glob.glob(p) for p in (os.path.join(home, "AppData/Local/Programs/Codex*"),
                                           os.path.join(home, "AppData/Local/Codex*"),
                                           "/mnt/c/Program Files*/Codex*"))
    if not found:
        return entry("codex_desktop", where, installed=False, state="not_installed")
    if where == "local" and OS == "darwin":
        email = dbnote = kind = None
        try:
            for q in codex_profile_dbs(home):
                email, why, k = codex_db_email(q)
                if email: break
                if dbnote is None: dbnote, kind = why, k  # the first candidate's answer is the honest one
        except Exception:
            email = dbnote = kind = None             # nothing here may kill the collector
        if email:
            return entry("codex_desktop", where, installed=True, signed_in=True, state="ok",
                         proof="app_profile", email=email, note=note)
        # Either way a profile is there and this reader could not get an identity out of it.
        # `unknown_source` is the honest state for BOTH: the Mac probe of 2026-09-06 found the
        # account really is in that profile, encrypted under safeStorage/IndexedDB — so this
        # is a source this reader cannot read, not a source with nothing in it. Borrowing the
        # CLI's identity here would assert the app is signed in as the CLI's account, which
        # nothing has established. `kind` still separates the two causes in the note.
        if dbnote:
            return entry("codex_desktop", where, installed=True, state="unknown_source",
                         note="; ".join(x for x in (note, dbnote) if x))
    # No Chromium profile at all: the app is assumed to share ~/.codex/auth.json with the CLI,
    # and `shares` says that identity is borrowed rather than proved by this client.
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
