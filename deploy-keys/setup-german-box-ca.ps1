# german-box owner: run locally in elevated PowerShell. No remote transport.
[CmdletBinding(SupportsShouldProcess)]
param([string]$CaPub, [switch]$RetireV1, [switch]$DryRun, [string]$Rollback,
      [string]$Root = "$env:ProgramData\ssh", [string]$Sshd)
. "$PSScriptRoot\lib\windows-apply.ps1"
$preview = $DryRun -or $WhatIfPreference
Invoke-WithRotationLock -Root $Root -Preview $preview -Action {
$script:RollbackDisableDeploy = $false
$script:RollbackAcls = @{}
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
Invoke-WindowsApply -Changes $changes -Root $Root -Sshd $Sshd -Preview $preview -Entry 'setup-german-box-ca.ps1' -DisableDeploy $RollbackDisableDeploy -RestoreAcls $RollbackAcls -Rollback ([bool]$Rollback)
}
