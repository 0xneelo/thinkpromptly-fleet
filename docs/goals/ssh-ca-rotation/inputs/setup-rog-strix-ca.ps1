# One-time CA trust install for rog-strix (Windows OpenSSH, tailnet 100.124.95.60, login misterisley).
# Same idea as setup-german-box-ca.ps1, hardened after the 2026-09-06 first run left the cert
# refused: the trust line is inserted in GLOBAL scope (above any Match block), the config is
# validated with sshd -t, the operator's 1Password key is authorized as a fallback, and sshd
# restarts via a one-shot SYSTEM task, because a child of
# the ssh session dies with the session. Delivered via -EncodedCommand (the box's default
# shell swallowed a stdin pipe). Idempotent — safe to re-run. Run from the operator's terminal:
#   sh deploy-keys/bootstrap-rog-strix.sh
$ErrorActionPreference = 'Stop'
$ca = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIO4jL5PZycHkKIWlwaenerKq6VcuVk1PiqlyrrU18E4G deploy-ca'
Set-Content -Encoding ascii -Path C:\ProgramData\ssh\deploy_ca.pub -Value $ca
$conf = 'C:\ProgramData\ssh\sshd_config'
$line = 'TrustedUserCAKeys __PROGRAMDATA__/ssh/deploy_ca.pub'
$before = @(); $after = @(); $inMatch = $false
foreach ($l in (Get-Content $conf)) {
  if ($l.Trim() -eq $line) { continue }
  if (-not $inMatch -and $l -match '^\s*Match\s') { $inMatch = $true }
  if ($inMatch) { $after += $l } else { $before += $l }
}
Set-Content -Encoding ascii -Path $conf -Value ($before + $line + $after)
Set-Service sshd -StartupType Automatic
# Operator fallback: the 1Password wsl-machine key (same key as the german-box alias), so
# `ssh rog-strix` works via Touch ID when no cert is live. The login user is an administrator,
# so Windows sshd reads administrators_authorized_keys, which must carry a strict ACL.
$pub = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIPer5OIi3/djg1FyVavjGUdXfbU6NNAjEa/iO356iBtC misterislez-mac-to-wsl'
$ak = 'C:\ProgramData\ssh\administrators_authorized_keys'
if (-not (Test-Path $ak) -or -not (Select-String -Quiet -SimpleMatch $pub -Path $ak)) {
  Add-Content -Encoding ascii -Path $ak -Value $pub
}
icacls $ak /inheritance:r /grant '*S-1-5-32-544:F' '*S-1-5-18:F' | Out-Null   # SIDs: Administrators, SYSTEM (locale-proof)
$ErrorActionPreference = 'Continue'
$sshd = ((Get-CimInstance Win32_Service -Filter "Name='sshd'").PathName -replace '"','')
$t = & $sshd -t 2>&1
$ok = ($LASTEXITCODE -eq 0)
Write-Output ("config-test: " + $(if ($ok) { 'ok' } else { "FAILED: $t" }))
try {
  $cs = Get-CimInstance Win32_ComputerSystem
  Write-Output ("machine: " + $cs.Manufacturer + " | " + $cs.Model + " | " + $env:COMPUTERNAME + " | user " + $env:USERNAME)
  $p = Get-CimInstance Win32_Process -Filter "Name='sshd.exe'" | Sort-Object CreationDate | Select-Object -First 1
  Write-Output ("sshd-running-since: " + $(if ($p) { $p.CreationDate } else { 'no sshd.exe process' }))
  Write-Output '--- sshd_config tail'
  Get-Content $conf | Select-Object -Last 6
  Write-Output '--- recent sshd events (auth/cert)'
  Get-WinEvent -LogName OpenSSH/Operational -MaxEvents 80 -ErrorAction SilentlyContinue |
    Where-Object { $_.Message -match 'misterisley|cert|CA |error|Failed' } | Select-Object -First 8 |
    ForEach-Object { $m = ($_.Message -replace '\s+', ' '); $_.TimeCreated.ToString('HH:mm:ss') + ' ' + $m.Substring(0, [Math]::Min(240, $m.Length)) }
} catch { Write-Output ("diag-failed: " + $_) }
if ($ok) {
  schtasks /create /f /tn sshd-reload /ru SYSTEM /sc once /st 23:59 /tr 'cmd /c net stop sshd & net start sshd & schtasks /delete /f /tn sshd-reload'
  Write-Output 'rog-strix-ca-ok; sshd restarting via SYSTEM task'
  schtasks /run /tn sshd-reload
} else { Write-Output 'NOT restarting sshd: config test failed, fix sshd_config first' }
