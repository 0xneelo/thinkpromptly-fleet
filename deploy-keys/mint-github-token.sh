#!/bin/bash
# Mint a GitHub App installation access token. GitHub caps these at 1h server-side.
# The token is kept in a shell variable and never passed as an argument to any process.
set -euo pipefail

app_id=${GH_APP_ID:-}
installation_id=${GH_APP_INSTALLATION_ID:-}
key_file=${GH_APP_KEY_FILE:-}
key_op=${GH_APP_KEY_OP:-}
askpass=0
broker=0

usage() {
	echo "usage: $(basename "$0") [--app-id ID] [--installation-id ID] [--key-file PEM | --key-op 1P-DOC-TITLE] [--askpass] [--broker]" >&2
	exit 2
}

while [ $# -gt 0 ]; do
	case "$1" in
	--app-id)
		app_id=${2:-}
		shift 2
		;;
	--installation-id)
		installation_id=${2:-}
		shift 2
		;;
	--key-file)
		key_file=${2:-}
		shift 2
		;;
	--key-op)
		key_op=${2:-}
		shift 2
		;;
	--askpass)
		askpass=1
		shift
		;;
	--broker)
		broker=1
		shift
		;;
	*) usage ;;
	esac
done

# --broker: the fleetdeck train already holds the PEM in memory, so this mode needs no
# app id, no installation id and no key — it just asks the local deck for a fresh token.
if [ "$broker" -eq 1 ]; then
	# --fail-with-body: non-zero exit on the broker's 503, but its message still arrives.
	if ! response=$(curl -s --fail-with-body http://localhost:3131/api/ghtoken); then
		msg=$(printf '%s' "$response" | python3 -c '
import json, sys
try:
    print(json.load(sys.stdin).get("error", ""))
except Exception:
    print("")
' 2>/dev/null)
		echo "error: ${msg:-fleetdeck not reachable at localhost:3131}" >&2
		exit 1
	fi
else
	missing=
	[ -n "$app_id" ] || missing="$missing GH_APP_ID (--app-id)"
	[ -n "$installation_id" ] || missing="$missing GH_APP_INSTALLATION_ID (--installation-id)"
	[ -n "$key_file" ] || [ -n "$key_op" ] || missing="$missing GH_APP_KEY_FILE-or-GH_APP_KEY_OP (--key-file/--key-op)"
	if [ -n "$missing" ]; then
		echo "error: missing config:$missing" >&2
		exit 2
	fi

	case "$app_id" in
	*[!0-9]*)
		echo "error: GH_APP_ID must be numeric (got '$app_id')" >&2
		exit 2
		;;
	esac

	if [ -z "$key_op" ] && [ ! -r "$key_file" ]; then
		echo "error: private key not readable: $key_file" >&2
		exit 2
	fi

	b64url() { openssl base64 -A | tr '+/' '-_' | tr -d '='; }

	now=$(date +%s)
	header=$(printf '%s' '{"alg":"RS256","typ":"JWT"}' | b64url)
	payload=$(printf '{"iat":%d,"exp":%d,"iss":"%s"}' "$((now - 30))" "$((now + 540))" "$app_id" | b64url)
	# 1Password mode: the PEM is fetched into memory only (biometric-gated by the op CLI)
	# and handed to openssl via process substitution — it never touches disk here.
	if [ -n "$key_op" ]; then
		if ! key_pem=$(op document get "$key_op"); then
			echo "error: 1Password read failed for '$key_op' — unlock 1Password; CLI integration must be on (Settings → Developer)." >&2
			exit 1
		fi
		case "$key_pem" in
		*"BEGIN "*"PRIVATE KEY"*) ;;
		*)
			echo "error: 1Password document '$key_op' is not a PEM private key" >&2
			exit 1
			;;
		esac
		signature=$(printf '%s' "$header.$payload" | openssl dgst -sha256 -sign <(printf '%s\n' "$key_pem") | b64url)
	else
		signature=$(printf '%s' "$header.$payload" | openssl dgst -sha256 -sign "$key_file" | b64url)
	fi
	jwt="$header.$payload.$signature"

	if ! response=$(curl -sf -X POST \
		-H "Authorization: Bearer $jwt" \
		-H "Accept: application/vnd.github+json" \
		"https://api.github.com/app/installations/$installation_id/access_tokens"); then
		echo "error: token request failed — check the app id, installation id, and that the PEM matches the App." >&2
		exit 1
	fi
fi

# Parsed output is captured, never echoed, so the token stays out of the terminal.
parsed=$(printf '%s' "$response" | python3 -c '
import json, sys
d = json.load(sys.stdin)
if "token" not in d:
    sys.exit("error: GitHub response contained no token")
print(d["token"])
print(d.get("expires_at", "unknown"))
')
token=${parsed%%$'\n'*}
expires=${parsed#*$'\n'}

echo "expires: $expires" >&2

if [ "$askpass" -eq 0 ]; then
	printf '%s\n' "$token"
	exit 0
fi

dir=$(mktemp -d)
chmod 700 "$dir"
helper="$dir/askpass.sh"
esc=${token//\'/\'\\\'\'}

umask 077
cat >"$helper" <<EOF
#!/bin/sh
printf '%s\n' '$esc'
EOF
chmod 700 "$helper"

echo "helper dir: $dir — delete after use; token expires $expires" >&2

# GIT_CONFIG_* (git >= 2.31) resets any configured credential.helper — an osxkeychain or
# gh helper would otherwise answer before GIT_ASKPASS, or persist this token to the keychain.
# credential.username removes the username prompt.
qhelper=${helper//\'/\'\\\'\'} # bare assignment: inside "..." bash would not expand these escapes
printf "export GIT_ASKPASS='%s'\n" "$qhelper"
cat <<'EOF'
export GIT_CONFIG_COUNT=2
export GIT_CONFIG_KEY_0=credential.helper
export GIT_CONFIG_VALUE_0=
export GIT_CONFIG_KEY_1=credential.username
export GIT_CONFIG_VALUE_1=x-access-token
EOF
