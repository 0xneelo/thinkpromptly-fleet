#!/bin/sh
# Original transport archived verbatim in docs/goals/ssh-ca-rotation/inputs/.
# Owner delivery helper, now local-only: stage deploy-keys and PUBLIC key on rog-strix.
# Avoids password SSH, stdin-shell loss and the 8191-character EncodedCommand limit.
set -eu
mode=ca
case "${1:-}" in
  --dry-run) shift; preview=-DryRun ;;
  --rollback) shift; mode=rollback; preview='' ;;
  *) preview='' ;;
esac
[ "$#" -eq 1 ] || { echo 'usage: bootstrap-rog-strix.sh [--dry-run] <Windows-public-key-path> | --rollback <Windows-backup-path>' >&2; exit 2; }
# Print only. The exact diff requires the host files: run this command locally on rog-strix.
newline='
'
carriage_return=$(printf '\r')
case "$1" in *"'"*|*"$newline"*|*"$carriage_return"*) echo 'invalid path' >&2; exit 2;; esac
if [ "$mode" = rollback ]; then
  printf "powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\\deploy-keys\\setup-rog-strix-ca.ps1 -Rollback '%s'\n" "$1"
  exit 0
fi
printf "Run in the rog-strix owner elevated terminal (this helper changes nothing):\npowershell.exe -NoProfile -ExecutionPolicy Bypass -File .\\deploy-keys\\setup-rog-strix-ca.ps1 -CaPub '%s' %s\n" "$1" "$preview"
