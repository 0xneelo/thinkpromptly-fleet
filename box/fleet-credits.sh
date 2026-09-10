#!/usr/bin/env sh
# Master copy — installed on the box at /home/vibe/bin/fleet-credits.sh (see README).
# One compact JSON line for THIS machine: the Claude desktop app's own usage history (every
# org it has sampled), the org -> email mapping any CLI config on this machine can prove,
# and Codex rollout rate limits. Live Claude usage is fleet-logins.sh's (see below).
#   sh fleet-credits.sh            -> print the line
#   sh fleet-credits.sh push <url> -> POST the line to a fleetdeck /api/credits
# No access token is read: nothing here needs one. Runs on mac, WSL and linux; the
# collect case takes no arguments.

PY=$(command -v python3)
JQ=$(command -v jq)
HOST=$(hostname -s 2>/dev/null || hostname)
TS=$(date +%s)

# First non-empty value among the dotted paths, from the JSON on stdin. Empty on any miss.
jval() {
  if [ -n "$PY" ]; then
    "$PY" -c '
import json, sys
try: o = json.load(sys.stdin)
except Exception: sys.exit(0)
for p in sys.argv[1:]:
    v = o
    for k in p.split("."):
        v = v.get(k) if isinstance(v, dict) else None
    if v not in (None, ""):
        print(v); break
' "$@" 2>/dev/null
  elif [ -n "$JQ" ]; then
    f=""
    for p in "$@"; do f="$f.$p // "; done
    "$JQ" -r "${f}empty" 2>/dev/null
  fi
}

# --- Claude live usage is NOT read here. This script named the account from ~/.claude.json
# and read the token from the credential store, and on the Mac the two disagreed
# (2026-09-10): one person's numbers went out under another's name. box/fleet-logins.sh
# proves email, org and usage from the same token, so it is the only live source; this
# script keeps the desktop samples, the org -> email mapping and the Codex rollouts.
STATE=absent
EMAIL=""
USAGE=""
ORG=""

# --- Claude desktop app + org mapping. plan-usage-history.json is derived numbers only,
# and it covers every org the app has sampled — including accounts with no CLI login here.
# The token cache in that same directory (config.json) is NEVER read, parsed or emitted.
# The org -> email pairs come from the CLI configs on this machine (this user's, the WSL
# users', and the Windows side reachable from WSL), so the deck can resolve an org itself.
# `desktop` stays the newest sample per org; `history` is the trend behind it, thinned.
EXTRA=""
[ -n "$PY" ] && EXTRA=$("$PY" -c '
import glob, json, os
home = os.path.expanduser("~")
last = {}
hist = {}
for pat in [home + "/Library/Application Support/Claude/plan-usage-history.json",
            "/mnt/c/Users/*/AppData/Local/Packages/Claude_*/LocalCache/Roaming/Claude/plan-usage-history.json"]:
    for p in glob.glob(pat):
        try:
            # A runaway file is skipped rather than parsed into memory on a worker box.
            if os.path.getsize(p) > 20000000: continue
            samples = json.load(open(p)).get("samples") or []
        except Exception: continue
        # One row per org: the last sample it has, whichever file holds it.
        for s in samples:
            org, t = s.get("org"), s.get("t")
            if not isinstance(org, str) or not isinstance(t, (int, float)): continue
            if org not in last or t > last[org]["t"]:
                last[org] = {"org": org, "t": t, "u": s.get("u") or {}}
            # The file stamps in ms, the deck works in seconds; the same second reported by
            # two files is one sample, so the merge dedupes on it.
            hist.setdefault(org, {})[int(t / 1000) if t > 1e11 else int(t)] = s.get("u") or {}
history = []
for org, pts in hist.items():
    ts = sorted(pts)
    # At most 300 per org: keep the newest, spread the rest evenly over the span.
    if len(ts) > 300:
        step = (len(ts) - 1) / 299.0
        ts = [ts[int(round(i * step))] for i in range(300)]
    for t in ts:
        u = pts[t]
        history.append({"org": org, "t": t, "fh": u.get("fh"), "sd": u.get("sd"), "xu": u.get("xu")})
accts = {}
for pat in [home + "/.claude.json", "/home/*/.claude.json", "/mnt/c/Users/*/.claude.json"]:
    for p in glob.glob(pat):
        try: o = json.load(open(p)).get("oauthAccount") or {}
        except Exception: continue
        if o.get("organizationUuid") and o.get("emailAddress"):
            accts[o["organizationUuid"]] = {"org": o["organizationUuid"], "email": o["emailAddress"],
                                            "tier": o.get("organizationRateLimitTier"),
                                            "type": o.get("organizationType"),
                                            "extra": bool(o.get("hasExtraUsageEnabled"))}
print(json.dumps({"desktop": list(last.values()), "history": history,
                  "accounts": list(accts.values())}, separators=(",", ":")))
' 2>/dev/null)

# --- Codex. Newest rollout transcript; rate limits ride on its token_count events.
CXSTATE=absent
CX=""
if [ -d "$HOME/.codex/sessions" ]; then
  f=$(ls -t "$HOME"/.codex/sessions/*/*/*/rollout-*.jsonl 2>/dev/null | head -1)
  if [ -n "$f" ]; then
    CXSTATE=error
    # Only the last 300k is scanned: rollouts run to tens of MB.
    [ -n "$PY" ] && CX=$("$PY" -c '
import json, os, sys
p = sys.argv[1]
sz = os.path.getsize(p)
with open(p, "rb") as fh:
    if sz > 300000: fh.seek(sz - 300000)
    data = fh.read()
for line in reversed(data.split(b"\n")):
    try: o = json.loads(line)
    except Exception: continue
    rl = o.get("payload", {}).get("rate_limits") if isinstance(o, dict) else None
    if rl:
        print(json.dumps({"rate_limits": rl, "snapshot_ts": o.get("timestamp")}, separators=(",", ":")))
        break
' "$f" 2>/dev/null)
    [ -n "$CX" ] && CXSTATE=ok
  fi
fi

# --- Emit. Only derived usage travels: percentages, reset stamps, plan, email, hostname.
LINE=""
if [ -n "$PY" ]; then
  LINE=$(HOSTN="$HOST" TSN="$TS" CL_EMAIL="$EMAIL" CL_ORG="$ORG" CL_STATE="$STATE" CL_USAGE="$USAGE" \
    CX="$CX" CX_STATE="$CXSTATE" EXTRA="$EXTRA" "$PY" -c '
import json, os
e = os.environ
def jl(s):
    try: return json.loads(s)
    except Exception: return None
claude = None if e["CL_STATE"] == "absent" else {
    "email": e["CL_EMAIL"] or None, "org": e["CL_ORG"] or None, "state": e["CL_STATE"],
    "usage": jl(e["CL_USAGE"])}
codex = None if e["CX_STATE"] == "absent" else dict(jl(e["CX"]) or {}, state=e["CX_STATE"])
x = jl(e["EXTRA"]) or {}
print(json.dumps({"host": e["HOSTN"], "ts": int(e["TSN"]), "claude": claude, "codex": codex,
                  "desktop": x.get("desktop") or [], "history": x.get("history") or [],
                  "accounts": x.get("accounts") or []},
                 separators=(",", ":")))
')
elif [ -n "$JQ" ]; then
  # No python3: only the live Claude read survives — the desktop and Codex scans need it.
  LINE=$("$JQ" -nc --arg host "$HOST" --arg email "$EMAIL" --arg org "$ORG" --arg state "$STATE" \
    --argjson ts "$TS" --argjson usage "${USAGE:-null}" \
    '{host:$host,ts:$ts,codex:null,desktop:[],history:[],accounts:[],claude:(if $state=="absent" then null else
       {email:(if $email=="" then null else $email end),org:(if $org=="" then null else $org end),
        state:$state,usage:$usage} end)}')
fi
[ -n "$LINE" ] || exit 1

if [ "$1" = push ] && [ -n "$2" ]; then
  printf '%s' "$LINE" | curl -sf -X POST -H 'Content-Type: application/json' --data @- "$2" > /dev/null
else
  printf '%s\n' "$LINE"
fi
exit 0
