#!/bin/bash
# Pure template renderer; writes stdout only. Owner reviews and installs with visudo.
set -euo pipefail
[ "$#" = 2 ] && [ "$1" = --app ] || { echo 'usage: render-sudoers.sh --app <exact-unit-without-.service>' >&2; exit 2; }
[[ "$2" =~ ^[a-zA-Z0-9][a-zA-Z0-9_.@-]*$ ]] || { echo 'invalid unit name' >&2; exit 2; }
here=$(cd "$(dirname "$0")" && pwd)
sed "s/@APP@/$2/g" "$here/sudoers-app.template"
