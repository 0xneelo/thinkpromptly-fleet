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
for path in "$identity" "$certificate"; do
  case "$path" in *[[:space:]]*|*\"*|*\'*|*\\*|*%*)
    echo 'credential paths must not contain whitespace, quotes, backslashes, or SSH expansion tokens' >&2; exit 2;;
  esac
done
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
host=RESOLVED_HOSTNAME port=RESOLVED_PORT
if [ "$dry_run" != 1 ]; then
  [ -s "$identity" ] && [ -s "$certificate" ] || { echo 'explicit credential files missing or empty' >&2; exit 2; }
  metadata=$(LC_ALL=C ssh-keygen -L -f "$certificate" 2>/dev/null) || { echo 'certificate preflight failed' >&2; exit 2; }
  printf '%s\n' "$metadata" | grep -qE '^ +Type: ssh-ed25519-cert-v01@openssh.com user certificate$' || { echo 'expected an ed25519 user certificate' >&2; exit 2; }
  cert_fp=$(LC_ALL=C ssh-keygen -lf "$certificate" -E sha256 2>/dev/null | awk '{print $2}')
  [[ "$cert_fp" =~ ^SHA256:[A-Za-z0-9+/]{43}$ ]] || { echo 'certificate fingerprint preflight failed' >&2; exit 2; }
  # Owner-side alias lookup only. Use just the endpoint, never its identities,
  # certificates, ProxyJump, ProxyCommand, or connection-sharing configuration.
  resolved=$(LC_ALL=C ssh -G -o CanonicalizeHostname=no "$alias_name" 2>/dev/null) || { echo 'alias endpoint lookup failed' >&2; exit 2; }
  host=$(printf '%s\n' "$resolved" | awk '$1=="hostname" {print $2; exit}')
  port=$(printf '%s\n' "$resolved" | awk '$1=="port" {print $2; exit}')
  [[ "$host" =~ ^[a-zA-Z0-9_.:-]+$ ]] && [[ "$port" =~ ^[0-9]{1,5}$ ]] && [ "$port" -gt 0 ] && [ "$port" -le 65535 ] || { echo 'invalid alias endpoint' >&2; exit 2; }
fi
args=(-F /dev/null -vvv -o "HostName=$host" -p "$port"
      -o BatchMode=yes -o IdentityAgent=none -o IdentitiesOnly=yes -o PreferredAuthentications=publickey
      -o PasswordAuthentication=no -o KbdInteractiveAuthentication=no
      -o PubkeyAcceptedAlgorithms=ssh-ed25519-cert-v01@openssh.com
      -o ControlMaster=no -o ControlPath=none -o StrictHostKeyChecking=yes -o ConnectTimeout=8
      -l "$user" -i "$identity" -o "CertificateFile=$certificate" "$alias_name" "$remote")
if [ "$dry_run" = 1 ]; then
  printf 'PRECHECK (owner only): nonempty files; ssh-keygen -L and -lf on the public certificate\n'
  printf 'RESOLVE (owner only): ssh -G -o CanonicalizeHostname=no %q; use only hostname and port\n' "$alias_name"
  printf 'ssh '; printf '%q ' "${args[@]}"; printf '\n'; exit 0
fi
set +e
output=$(LC_ALL=C ssh "${args[@]}" 2>&1)
status=$?
set -e
if [ "$expect" = refused ]; then
  if printf '%s\n' "$output" | python3 "$(dirname "$0")/lib/verify_trace.py" "$host" "$port" "$user" "$cert_fp" "$status"; then
    echo 'PASS refused: target rejected the explicitly presented certificate'; exit 0
  fi
  echo 'FAIL: expected certificate refusal; transport, host-key errors, and successful logins do not qualify' >&2
  exit 1
fi
if [ "$status" = 0 ] && printf '%s\n' "$output" | tr -d '\r' | grep -qx "IVO_CERT_OK $expect"; then
  echo "PASS $expect: role and privilege checks passed"; exit 0
fi
echo 'FAIL: role verification failed (remote output suppressed)' >&2
exit 1
