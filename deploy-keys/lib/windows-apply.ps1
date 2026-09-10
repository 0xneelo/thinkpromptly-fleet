# Shared local host-owner transaction. Dot-source from an entry script.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Read-PublicConfig([string]$Path) {
    if (Test-Path -LiteralPath $Path) { return [IO.File]::ReadAllText($Path) }
    return ''
}
function Assert-PlainPath([string]$Path) {
    $p = $Path
    while ($p) {
        if ((Test-Path -LiteralPath $p) -and ((Get-Item -LiteralPath $p -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) {
            throw "Refusing reparse point: $p"
        }
        $p = Split-Path -Parent $p
    }
}
function Get-PublicKey([string]$Path) {
    $lines = @(Get-Content -LiteralPath $Path | Where-Object { $_.Trim() -and -not $_.Trim().StartsWith('#') })
    if ($lines.Count -ne 1) { throw 'Expected one ed25519 public key' }
    $parts = $lines[0].Trim() -split '\s+'
    if ($parts.Count -lt 2 -or $parts[0] -ne 'ssh-ed25519') { throw 'Expected an ordinary ed25519 PUBLIC key' }
    $raw = [Convert]::FromBase64String($parts[1])
    $prefix = [byte[]](0,0,0,11,115,115,104,45,101,100,50,53,53,49,57,0,0,0,32)
    if ($raw.Length -ne 51) { throw 'Invalid public key size' }
    for ($i=0; $i -lt $prefix.Length; $i++) { if ($raw[$i] -ne $prefix[$i]) { throw 'Invalid public key encoding' } }
    return $parts -join ' '
}
function Add-Ca([string]$Before, [string]$Key) {
    $identity = ($Key -split '\s+')[0..1] -join ' '
    foreach ($line in ($Before -split '\r?\n')) {
        $parts = $line.Trim() -split '\s+'
        if ($parts.Count -ge 2 -and ($parts[0..1] -join ' ') -eq $identity) { return $Before }
    }
    $separator = if ($Before -and -not $Before.EndsWith("`n")) { "`r`n" } else { '' }
    return $Before + $separator + $Key + "`r`n"
}
function Set-GlobalDirective([string]$Before, [string]$Name, [string]$Value) {
    $lines = @($Before -split '\r?\n' | Where-Object { $_ -notmatch ('^\s*' + $Name + '\s+') })
    # Trim just the split terminator, preserving all actual blank lines.
    if ($lines.Count -gt 0 -and $lines[-1] -eq '') { $lines = @($lines | Select-Object -SkipLast 1) }
    return "$Name $Value`r`n" + (($lines -join "`r`n") + $(if ($lines.Count) { "`r`n" } else { '' }))
}
function Show-FileDiff([string]$Path, [string]$Before, [AllowNull()][object]$After) {
    if ($Before -ceq $After) { return }
    Write-Output "--- $Path"
    Write-Output "+++ $Path (planned)"
    Write-Output '@@ complete file replacement @@'
    if ($Before) { foreach ($l in ($Before -split '\r?\n')) { Write-Output "-$l" } }
    if ($null -ne $After -and $After) { foreach ($l in ($After -split '\r?\n')) { Write-Output "+$l" } }
}
function Test-Sshd([string]$Sshd, [string]$Conf) {
    & $Sshd -t -f $Conf
    if ($LASTEXITCODE -ne 0) { throw 'sshd -t failed' }
}
function Set-StrictAcl([string]$Path, [bool]$Readable = $false) {
    $item = Get-Item -LiteralPath $Path
    $acl = if ($item.PSIsContainer) { [Security.AccessControl.DirectorySecurity]::new() } else { [Security.AccessControl.FileSecurity]::new() }
    $acl.SetAccessRuleProtection($true, $false)
    $admin = [Security.Principal.SecurityIdentifier]::new('S-1-5-32-544')
    $acl.SetOwner($admin)
    foreach ($sid in @('S-1-5-32-544', 'S-1-5-18')) {
        $rule = [Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new($sid), 'FullControl', 'Allow')
        $acl.AddAccessRule($rule)
    }
    if ($Readable) { $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new('S-1-5-32-545'), 'ReadAndExecute', 'Allow')) }
    Set-Acl -LiteralPath $Path -AclObject $acl

}
function Invoke-WindowsApply {
    param([System.Collections.IDictionary]$Changes, [string]$Root, [string]$Sshd, [bool]$Preview, [string]$Entry,
          [bool]$CreateDeploy = $false)
    $conf = Join-Path $Root 'sshd_config'
    $changed = [ordered]@{}
    foreach ($p in $Changes.Keys) {
        Assert-PlainPath $p
        $before = Read-PublicConfig $p
        if ($Changes[$p] -cne $before -or ($null -eq $Changes[$p] -and (Test-Path -LiteralPath $p))) {
            $changed[$p] = $Changes[$p]
            Show-FileDiff $p $before $Changes[$p]
        }
    }
    if ($CreateDeploy) { Write-Output '+ ACCOUNT deploy: standard Users group only, no password login; certificate authentication' }
    Write-Output 'PLAN: protected ACLs; sshd -t; detached SYSTEM task restarts sshd; restores backup on failure'
    if ($Preview) { Write-Output 'DRY-RUN: no files, accounts, ACLs, tasks, or services changed'; return }
    if ($PSVersionTable.PSEdition -eq 'Core' -and -not $IsWindows) { throw 'Apply requires Windows' }
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    if (-not ([Security.Principal.WindowsPrincipal]::new($identity)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Apply requires an elevated owner terminal' }
    Test-Sshd $Sshd $conf
    if (-not $changed.Count -and -not $CreateDeploy) { Write-Output 'Already current; no restart'; return }
    $backup = Join-Path $Root ('ca-rotation-backups\' + [guid]::NewGuid().ToString('N'))
    Assert-PlainPath $backup
    New-Item -ItemType Directory -Path $backup -Force | Out-Null
    Set-StrictAcl $backup
    $manifest = @()
    foreach ($p in $changed.Keys) {
        $exists = Test-Path -LiteralPath $p
        $saved = Join-Path $backup ($manifest.Count.ToString() + '.bak')
        $acl = $null
        if ($exists) { Copy-Item -LiteralPath $p -Destination $saved; $acl = (Get-Acl -LiteralPath $p).Sddl }
        $manifest += @{ path=$p; saved=$saved; existed=$exists; acl=$acl }
    }
    @{ files=$manifest; createdDeploy=$CreateDeploy } | ConvertTo-Json -Depth 5 | Set-Content -Encoding UTF8 -LiteralPath (Join-Path $backup 'manifest.json')
    Write-Output "ROLLBACK: .\deploy-keys\$Entry -Rollback '$backup'"
    try {
        if ($CreateDeploy) {
            # Random password is held only in memory, never accepted for SSH and never logged.
            $secret = ConvertTo-SecureString ([guid]::NewGuid().ToString('N') + 'aA1!') -AsPlainText -Force
            New-LocalUser -Name deploy -Password $secret -Description 'CA daily deploy account' | Out-Null
            $secret.Dispose()
            Add-LocalGroupMember -SID 'S-1-5-32-545' -Member deploy
        }
        foreach ($p in $changed.Keys) {
            if ($null -eq $changed[$p]) { Remove-Item -LiteralPath $p -ErrorAction SilentlyContinue; continue }
            $parent = Split-Path -Parent $p
            if (-not (Test-Path -LiteralPath $parent)) { New-Item -ItemType Directory -Path $parent | Out-Null; Set-StrictAcl $parent $true }
            [IO.File]::WriteAllText($p, $changed[$p], [Text.UTF8Encoding]::new($false))
            Set-StrictAcl $p
        }
        Test-Sshd $Sshd $conf
        # Keep restart/rollback independent of an SSH parent process. Never restart the deck.
        $restart = Join-Path $backup 'restart.ps1'
        $body = @'
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $PSCommandPath
$m = Get-Content -Raw -LiteralPath (Join-Path $here 'manifest.json') | ConvertFrom-Json
try {
    Restart-Service sshd -ErrorAction Stop
    if ((Get-Service sshd).Status -ne 'Running') { throw 'sshd is not running' }
    'restart-ok' | Set-Content -LiteralPath (Join-Path $here 'result.txt')
} catch {
    foreach ($f in $m.files) {
        if ($f.existed) {
            Copy-Item -LiteralPath $f.saved -Destination $f.path -Force
            $acl = Get-Acl -LiteralPath $f.path
            $acl.SetSecurityDescriptorSddlForm($f.acl)
            Set-Acl -LiteralPath $f.path -AclObject $acl
        } else { Remove-Item -LiteralPath $f.path -ErrorAction SilentlyContinue }
    }
    if ($m.createdDeploy) { Disable-LocalUser -Name deploy }
    Restart-Service sshd -ErrorAction Stop
    'restart-failed; restored files; new deploy account disabled if present' | Set-Content -LiteralPath (Join-Path $here 'result.txt')
    exit 1
}
'@
        [IO.File]::WriteAllText($restart, $body, [Text.UTF8Encoding]::new($false))
        Set-StrictAcl $restart
        $task = 'ssh-ca-rotation-' + (Split-Path -Leaf $backup)
        $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ('-NoProfile -ExecutionPolicy Bypass -File "' + $restart + '"')
        Register-ScheduledTask -TaskName $task -Action $action -User SYSTEM -RunLevel Highest -Force | Out-Null
        Start-ScheduledTask -TaskName $task
        Write-Output "Restart queued via SYSTEM task $task. Read $backup\result.txt; remove task after verification."
    } catch {
        foreach ($f in $manifest) {
            if ($f.existed) { Copy-Item -LiteralPath $f.saved -Destination $f.path -Force; $acl = Get-Acl -LiteralPath $f.path; $acl.SetSecurityDescriptorSddlForm($f.acl); Set-Acl -LiteralPath $f.path -AclObject $acl }
            else { Remove-Item -LiteralPath $f.path -ErrorAction SilentlyContinue }
        }
        if ($CreateDeploy -and (Get-LocalUser -Name deploy -ErrorAction SilentlyContinue)) { Disable-LocalUser -Name deploy }
        Test-Sshd $Sshd $conf
        throw
    }
    & ssh-keygen.exe -lf (Join-Path $Root 'deploy_ca.pub') -E sha256
    if ($LASTEXITCODE -ne 0) { throw 'Fingerprint check failed' }
}
function Get-RollbackChanges([string]$Backup, [string]$Root) {
    Assert-PlainPath $Backup
    $expected = [IO.Path]::GetFullPath((Join-Path $Root 'ca-rotation-backups'))
    if ([IO.Path]::GetFullPath((Split-Path -Parent $Backup)) -ne $expected) { throw 'Invalid rollback directory' }
    $m = Get-Content -Raw -LiteralPath (Join-Path $Backup 'manifest.json') | ConvertFrom-Json
    $changes = [ordered]@{}
    foreach ($f in $m.files) {
        $allowed = @((Join-Path $Root 'deploy_ca.pub'), (Join-Path $Root 'sshd_config'), (Join-Path $Root 'principals/deploy'), (Join-Path $Root 'principals/vibe'), (Join-Path $Root 'principals/misterisley'))
        if ($f.path -notin $allowed) { throw 'Unexpected rollback path' }
        $changes[$f.path] = if ($f.existed) { [IO.File]::ReadAllText($f.saved) } else { $null }
    }
    if ($m.createdDeploy) { Write-Warning 'Rollback restores files; disable the newly created deploy user after leaving its sessions. Do not delete its data.' }
    return $changes
}
