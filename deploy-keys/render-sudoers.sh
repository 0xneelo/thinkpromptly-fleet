#!/bin/bash
# Pure template renderer; writes stdout only. Owner reviews and installs with visudo.
set -euo pipefail
[ "$#" = 2 ] && [ "$1" = --app ] || { echo 'usage: render-sudoers.sh --app <exact-unit[.service]>' >&2; exit 2; }
app=${2%.service}
[[ "$app" =~ ^[a-zA-Z0-9][a-zA-Z0-9_.@-]*$ ]] || { echo 'invalid unit name' >&2; exit 2; }
here=$(cd "$(dirname "$0")" && pwd)
sed "s/@APP@/$app/g" "$here/sudoers-app.template"
