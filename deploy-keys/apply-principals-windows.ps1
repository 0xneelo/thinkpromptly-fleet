# HOST OWNER ONLY. Standard deploy account; transitions privileged login principals.
[CmdletBinding(SupportsShouldProcess)]
param([ValidateSet('german-box','rog-strix')][string]$Box, [switch]$DryRun,
      [switch]$RetireLegacy, [string]$Rollback, [string]$Root = "$env:ProgramData\ssh",
      [string]$Sshd)
. "$PSScriptRoot\lib\windows-apply.ps1"
$preview = $DryRun -or $WhatIfPreference
Invoke-WithRotationLock -Root $Root -Preview $preview -Action {
$createDeploy = $false
$principalUsers = @()
$script:RollbackDisableDeploy = $false
$script:RollbackAcls = @{}
if ($Rollback) { $changes = Get-RollbackChanges $Rollback $Root }
else {
    if (-not $Box) { throw '-Box is required' }
    $conf = Join-Path $Root 'sshd_config'
    if (-not (Test-Path -LiteralPath $conf)) { throw 'sshd_config missing' }
    $user = if ($Box -eq 'german-box') { 'vibe' } else { 'misterisley' }
    $principalUsers = @('deploy', $user)
    $changes = [ordered]@{}
    $content = Set-GlobalDirective (Read-PublicConfig $conf) 'AuthorizedPrincipalsFile' '__PROGRAMDATA__/ssh/principals/%u'
    $changes[$conf] = Set-DeployPolicy $content
    foreach ($name in @('deploy', $user)) {
        $template = Join-Path $PSScriptRoot "principals/$Box/$name"
        $lines = @(Get-Content -LiteralPath $template | Where-Object { -not ($RetireLegacy -and $name -ne 'deploy' -and $_ -eq $name) })
        $changes[(Join-Path $Root "principals/$name")] = ($lines -join "`r`n") + "`r`n"
    }
    if (Get-Command Get-LocalUser -ErrorAction SilentlyContinue) {
        $account = Get-LocalUser -Name deploy -ErrorAction SilentlyContinue
        $createDeploy = $null -eq $account
        if ($account) { Assert-DeployGroups $account }
    } elseif ($preview -and $Root -ne "$env:ProgramData\ssh") {
        $createDeploy = $true # Offline Linux fixture only; actual Windows queries its account database.
    } else { throw 'LocalAccounts module is required' }
}
Invoke-WindowsApply -Changes $changes -Root $Root -Sshd $Sshd -Preview $preview -Entry 'apply-principals-windows.ps1' -CreateDeploy $createDeploy -DisableDeploy $RollbackDisableDeploy -RestoreAcls $RollbackAcls -Rollback ([bool]$Rollback) -PrincipalUsers $principalUsers
}
