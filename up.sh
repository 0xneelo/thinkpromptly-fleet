#!/bin/bash
# Start (or restart) the fleetdeck from the operator's own terminal.
# 1Password approval prompts follow the process that started the deck: a deck
# started from an agent shell can never sign certs ("communication with agent
# failed"), so this script refuses to run there.
set -euo pipefail

cd "$(dirname "$0")"
PORT=${PORT:-3131}
export PATH="$PATH:/usr/sbin" # lsof lives here; not every shell has it in PATH

# Everything below decides "is a deck already on this port?" by asking lsof. Without it the
# `|| true` on that query would answer "no" for the wrong reason and we would start a second
# deck on an occupied port — so say so here instead of failing on the health check later.
if ! command -v lsof >/dev/null 2>&1; then
	echo "error: lsof not found, so this script cannot tell whether a deck already holds :${PORT:-3131}." >&2
	echo "Install it (Debian/Ubuntu: sudo apt install lsof), then re-run ./up.sh." >&2
	exit 1
fi

if env | grep -q '^CLAUDE'; then
	echo "error: agent shell detected (CLAUDE_* in env)." >&2
	echo "Run ./up.sh from your own Terminal, or 1Password cert signing will fail." >&2
	exit 1
fi

# Arm the tailnet sitrep gate (XYZ-1850): key lives outside git, mode 600.
if [ -f deploy-keys/fleet-tailnet.env ]; then
	. deploy-keys/fleet-tailnet.env
else
	echo "warn: deploy-keys/fleet-tailnet.env missing — tailnet POST /sitrep runs UNAUTHENTICATED" >&2
fi

# Test-suite preflight (XYZ-1896). test/http.js gives the tailnet listener its own loopback
# address so the suite can tell a tailnet-source request from a loopback-source one. macOS
# does not provide 127.0.0.2 until someone adds the alias, and it does not survive a reboot.
# The deck itself never needs it, so this warns and starts anyway — it exists so the single
# entry point stays self-explaining on a fresh boot.
if ! node -e 'const s=require("net").createServer();s.on("error",()=>process.exit(1));s.listen(0,"127.0.0.2",()=>s.close(()=>process.exit(0)))' 2>/dev/null; then
	echo "warn: 127.0.0.2 is not bindable — the deck is fine, but \`npm test\` will fail fast until:" >&2
	if [ "$(uname -s)" = "Darwin" ]; then
		echo "  sudo ifconfig lo0 alias 127.0.0.2 up    # not persistent — re-run after a reboot" >&2
	else
		echo "  sudo ip addr add 127.0.0.2/8 dev lo" >&2
	fi
fi

old=$(lsof -ti tcp:"$PORT" -sTCP:LISTEN || true)
if [ -n "$old" ]; then
	echo "replacing deck on :$PORT (pid $old) — an active GitHub train survives in the broker (:3132)"
	kill $old || true
	for _ in {1..40}; do
		lsof -ti tcp:"$PORT" -sTCP:LISTEN >/dev/null || break
		sleep 0.25
	done
	if lsof -ti tcp:"$PORT" -sTCP:LISTEN >/dev/null; then
		echo "error: pid $old did not release :$PORT" >&2
		exit 1
	fi
fi

nohup node server.js >>deck.log 2>&1 &
pid=$!

ok=
for _ in {1..40}; do
	curl -sf "http://localhost:$PORT/api/health" >/dev/null && ok=1 && break
	sleep 0.25
done
if [ -n "$ok" ] && ! kill -0 "$pid" 2>/dev/null; then
	ok= # something answered health, but our node is dead — that was a stale listener
fi
if [ -z "$ok" ]; then
	echo "error: deck did not answer on :$PORT — tail of deck.log:" >&2
	tail -20 deck.log >&2
	exit 1
fi
echo "deck up: http://localhost:$PORT (pid $pid, log: deck.log)"
