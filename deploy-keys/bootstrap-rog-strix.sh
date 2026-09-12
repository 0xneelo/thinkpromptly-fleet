#!/bin/sh
# One-shot delivery of setup-rog-strix-ca.ps1 over password ssh. No stdin pipe: the box's
# default ssh shell swallowed `powershell -Command -` (2026-09-06), so the script travels
# inside the command line as UTF-16LE base64 (-EncodedCommand), shell-agnostic.
# Usage: sh deploy-keys/bootstrap-rog-strix.sh [user@host]
set -eu
here=$(cd "$(dirname "$0")" && pwd)
host=${1:-misterisley@100.124.95.60}
b64=$(grep -v '^[[:space:]]*#' "$here/setup-rog-strix-ca.ps1" | iconv -f utf-8 -t utf-16le | base64 | tr -d '\n')
# cmd.exe caps a command line at 8191 chars.
[ ${#b64} -lt 7900 ] || { echo "encoded script too long (${#b64}); trim setup-rog-strix-ca.ps1" >&2; exit 1; }
exec ssh -o PubkeyAuthentication=no "$host" "powershell.exe -NoProfile -ExecutionPolicy Bypass -EncodedCommand $b64"
