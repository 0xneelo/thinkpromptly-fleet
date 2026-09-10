# Origin: docs/goals/ssh-ca-rotation/inputs/setup-rog-strix-ca.ps1 (verbatim archived input).
# Bootstrap public key SHA256:JaxLCc5XTWKixVFdoHMCLQyzpsCTNTbMs6wO4hcvV/U is the
# operator 1Password wsl-machine fallback (misterislez-mac-to-wsl), not a second CA.
# Existing fallback authorized_keys and ACLs are preserved. This rotation never adds it.
# Keep TrustedUserCAKeys GLOBAL, above Match Group administrators; restart via SYSTEM task.
# rog-strix owner: run locally in elevated PowerShell. No remote transport.
[CmdletBinding(SupportsShouldProcess)]
param([string]$CaPub, [switch]$RetireV1, [switch]$DryRun, [string]$Rollback,
      [string]$Root = "$env:ProgramData\ssh", [string]$Sshd = "$env:WINDIR\System32\OpenSSH\sshd.exe")
. "$PSScriptRoot\lib\windows-apply.ps1"
$RollbackDisableDeploy = $false
$RollbackAcls = @{}
$changes = [ordered]@{}
if ($Rollback) { $changes = Get-RollbackChanges $Rollback $Root }
elseif ($RetireV1) {
    $ca = Join-Path $Root 'deploy_ca.pub'
    $changes[$ca] = Remove-LegacyCa (Read-PublicConfig $ca)
}
else {
    if (-not $CaPub) { throw 'Pass -CaPub with the v2 PUBLIC file; v1 stays trusted' }
    $key = Get-PublicKey $CaPub
    $ca = Join-Path $Root 'deploy_ca.pub'
    $conf = Join-Path $Root 'sshd_config'
    if (-not (Test-Path -LiteralPath $conf)) { throw 'sshd_config missing' }
    $changes[$ca] = Add-Ca (Read-PublicConfig $ca) $key
    $changes[$conf] = Set-GlobalDirective (Read-PublicConfig $conf) 'TrustedUserCAKeys' '__PROGRAMDATA__/ssh/deploy_ca.pub'
}
$preview = $DryRun -or $WhatIfPreference
Invoke-WindowsApply -Changes $changes -Root $Root -Sshd $Sshd -Preview $preview -Entry 'setup-rog-strix-ca.ps1' -DisableDeploy $RollbackDisableDeploy -RestoreAcls $RollbackAcls
