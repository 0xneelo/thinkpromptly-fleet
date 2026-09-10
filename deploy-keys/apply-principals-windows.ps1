# HOST OWNER ONLY. Standard deploy account; transitions privileged login principals.
[CmdletBinding(SupportsShouldProcess)]
param([ValidateSet('german-box','rog-strix')][string]$Box, [switch]$DryRun,
      [switch]$RetireLegacy, [string]$Rollback, [string]$Root = "$env:ProgramData\ssh",
      [string]$Sshd = "$env:WINDIR\System32\OpenSSH\sshd.exe")
. "$PSScriptRoot\lib\windows-apply.ps1"
$preview = $DryRun -or $WhatIfPreference
$createDeploy = $false
$RollbackDisableDeploy = $false
$RollbackAcls = @{}
if ($Rollback) { $changes = Get-RollbackChanges $Rollback $Root }
else {
    if (-not $Box) { throw '-Box is required' }
    $conf = Join-Path $Root 'sshd_config'
    if (-not (Test-Path -LiteralPath $conf)) { throw 'sshd_config missing' }
    $user = if ($Box -eq 'german-box') { 'vibe' } else { 'misterisley' }
    $changes = [ordered]@{}
    $content = Set-GlobalDirective (Read-PublicConfig $conf) 'AuthorizedPrincipalsFile' '__PROGRAMDATA__/ssh/principals/%u'
    $begin = '# BEGIN CA ROTATION DEPLOY'; $end = '# END CA ROTATION DEPLOY'
    $content = $content -replace ('(?s)' + [regex]::Escape($begin) + '.*?' + [regex]::Escape($end) + '\r?\n?'), ''
    $changes[$conf] = $content + "$begin`r`nMatch User deploy`r`n    PasswordAuthentication no`r`n    KbdInteractiveAuthentication no`r`nMatch all`r`n$end`r`n"
    foreach ($name in @('deploy', $user)) {
        $template = Join-Path $PSScriptRoot "principals/$Box/$name"
        $lines = @(Get-Content -LiteralPath $template | Where-Object { -not ($RetireLegacy -and $name -ne 'deploy' -and $_ -eq $name) })
        $changes[(Join-Path $Root "principals/$name")] = ($lines -join "`r`n") + "`r`n"
    }
    if (Get-Command Get-LocalUser -ErrorAction SilentlyContinue) {
        $account = Get-LocalUser -Name deploy -ErrorAction SilentlyContinue
        $createDeploy = $null -eq $account
        if ($account) {
            foreach ($group in Get-LocalGroup) {
                if ($group.SID.Value -eq 'S-1-5-32-545') { continue }
                if (Get-LocalGroupMember -Group $group -ErrorAction Stop | Where-Object { $_.SID -eq $account.SID }) {
                    throw 'Existing deploy account belongs to a group other than Users; owner must resolve'
                }
            }
        }
    } elseif ($preview -and $Root -ne "$env:ProgramData\ssh") {
        $createDeploy = $true # Offline Linux fixture only; actual Windows queries its account database.
    } else { throw 'LocalAccounts module is required' }
}
Invoke-WindowsApply -Changes $changes -Root $Root -Sshd $Sshd -Preview $preview -Entry 'apply-principals-windows.ps1' -CreateDeploy $createDeploy -DisableDeploy $RollbackDisableDeploy -RestoreAcls $RollbackAcls
