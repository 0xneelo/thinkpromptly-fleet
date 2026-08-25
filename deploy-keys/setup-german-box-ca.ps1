# One-time CA trust install for german-box (Windows OpenSSH).
# Run from the Mac:  ssh german-box "powershell -NoProfile -Command -" < deploy-keys/setup-german-box-ca.ps1
$ErrorActionPreference = 'Stop'
$ca = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIO4jL5PZycHkKIWlwaenerKq6VcuVk1PiqlyrrU18E4G misterislez@rfc1918-internal.by.netflash.com.cy'
Set-Content -Encoding ascii -Path C:\ProgramData\ssh\deploy_ca.pub -Value $ca
$conf = 'C:\ProgramData\ssh\sshd_config'
$line = 'TrustedUserCAKeys __PROGRAMDATA__/ssh/deploy_ca.pub'
if (-not (Select-String -Quiet -SimpleMatch $line -Path $conf)) {
  Add-Content -Encoding ascii -Path $conf -Value $line
}
Write-Output 'config-written; restarting sshd detached'
# Detached restart: Restart-Service from this session would kill our own connection mid-script.
Start-Process powershell -WindowStyle Hidden -ArgumentList '-NoProfile','-Command','Start-Sleep 2; Restart-Service sshd'
Write-Output 'german-box-ca-ok'
