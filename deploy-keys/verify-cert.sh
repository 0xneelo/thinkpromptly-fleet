#!/bin/bash
# OWNER verification only. --dry-run prints the exact SSH invocation without SSH/config reads.
# These quoted commands expand on the target, never on the owner machine.
# shellcheck disable=SC2016
set -euo pipefail
alias_name=${1:-}; [ "$#" -gt 0 ] && shift
expect='' identity='' certificate='' dry_run=0
usage() { echo 'usage: verify-cert.sh <alias> --expect deploy|admin|refused --identity <file> --certificate <file> [--dry-run]' >&2; exit 2; }
while [ "$#" -gt 0 ]; do
  case "$1" in
    --expect|--identity|--certificate) [ "$#" -ge 2 ] || usage
      case "$1" in --expect) expect=$2;; --identity) identity=$2;; --certificate) certificate=$2;; esac
      shift 2 ;;
    --dry-run) dry_run=1; shift ;;
    *) usage ;;
  esac
done
case "$expect" in deploy|admin|refused) ;; *) usage;; esac
case "$alias_name" in
  vps-deploy|ob-deploy|ivybox-deploy) user=deploy; platform=linux ;;
  vps-admin|ob-admin|ivybox-admin) user=root; platform=linux ;;
  gb-deploy|rs-deploy) user=deploy; platform=windows ;;
  gb-admin) user=vibe; platform=windows ;;
  rs-admin) user=misterisley; platform=windows ;;
  *) usage ;;
esac
[ -n "$identity" ] && [ -n "$certificate" ] || usage
case "$expect:$user" in deploy:deploy|admin:root|admin:vibe|admin:misterisley|refused:*) ;; *) echo 'alias login does not match expected role' >&2; exit 2;; esac
if [ "$platform" = linux ]; then
  if [ "$expect" = deploy ]; then
    remote='test "$(id -un)" = deploy && test "$(id -u)" != 0 && { ! command -v sudo >/dev/null 2>&1 || ! sudo -n true; } && printf "IVO_CERT_OK deploy\n"'
  else
    remote='test "$(id -u)" = 0 && printf "IVO_CERT_OK admin\n"'
  fi
else
  # Encoded PowerShell handles the Windows default cmd shell, locale-neutral role check.
  ps='$ErrorActionPreference="Stop"; $i=[Security.Principal.WindowsIdentity]::GetCurrent(); $p=[Security.Principal.WindowsPrincipal]::new($i); $a=$p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator); '
  if [ "$expect" = deploy ]; then
    ps+='if ($env:USERNAME -ne "deploy" -or $a) { exit 1 }; Write-Output "IVO_CERT_OK deploy"'
  else
    ps+='if (-not $a) { exit 1 }; Write-Output "IVO_CERT_OK admin"'
  fi
  encoded=$(printf '%s' "$ps" | iconv -f UTF-8 -t UTF-16LE | base64 | tr -d '\n')
  remote="powershell.exe -NoProfile -EncodedCommand $encoded"
fi
args=(-o BatchMode=yes -o IdentityAgent=none -o IdentitiesOnly=yes -o PreferredAuthentications=publickey
      -o PasswordAuthentication=no -o KbdInteractiveAuthentication=no
      -o PubkeyAcceptedAlgorithms=ssh-ed25519-cert-v01@openssh.com
      -o ControlMaster=no -o ControlPath=none -o StrictHostKeyChecking=yes -o ConnectTimeout=8
      -l "$user" -i "$identity" -o "CertificateFile=$certificate" "$alias_name" "$remote")
if [ "$dry_run" = 1 ]; then printf 'ssh '; printf '%q ' "${args[@]}"; printf '\n'; exit 0; fi
[ -f "$identity" ] && [ -f "$certificate" ] || { echo 'explicit credential files missing' >&2; exit 2; }
set +e
output=$(LC_ALL=C ssh "${args[@]}" 2>&1)
status=$?
set -e
if [ "$expect" = refused ]; then
  if [ "$status" = 255 ] && [[ "$output" == *'Permission denied (publickey'* ]]; then
    echo 'PASS refused: certificate authentication denied'; exit 0
  fi
  echo 'FAIL: expected certificate refusal; transport, host-key errors, and successful logins do not qualify' >&2
  exit 1
fi
if [ "$status" = 0 ] && printf '%s\n' "$output" | grep -qx "IVO_CERT_OK $expect"; then
  echo "PASS $expect: role and privilege checks passed"; exit 0
fi
echo 'FAIL: role verification failed (remote output suppressed)' >&2
exit 1
