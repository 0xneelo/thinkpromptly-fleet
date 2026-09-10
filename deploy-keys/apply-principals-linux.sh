#!/bin/sh
# HOST OWNER ONLY. --box <host> --dry-run first; --rollback <backup> restores files.
set -eu
here=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
exec python3 "$here/lib/host_apply.py" principals "$@"
