# Shared local host-owner transaction. Dot-source from an entry script.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$script:RotationHelperPath = $PSCommandPath

function Invoke-WithRotationLock {
    param([string]$Root, [bool]$Preview, [scriptblock]$Action,
          [string]$MutexName = 'Global\FleetdeckSshCaRotation')
    if ($Preview) { & $Action; return }
    $mutex = [Threading.Mutex]::new($false, $MutexName)
    $owned = $false
    try {
        try { $owned = $mutex.WaitOne(0) }
        catch [Threading.AbandonedMutexException] { $owned = $true }
        if (-not $owned) { throw 'Another CA rotation apply/rollback holds the host mutex' }
        # The detached SYSTEM task can outlive its caller and mutex. Its pending
        # marker blocks the gap until restart or recovery completes successfully.
        if (Test-Path -LiteralPath (Join-Path $Root 'ca-rotation.pending')) {
            throw 'CA rotation restart/recovery is pending; inspect the recorded task before another apply'
        }
        & $Action
    } finally {
        if ($owned) { $mutex.ReleaseMutex() }
        $mutex.Dispose()
    }
}

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
function Set-DeployPolicy([string]$Content) {
    $begin = '# BEGIN CA ROTATION DEPLOY'; $end = '# END CA ROTATION DEPLOY'
    $Content = $Content -replace ('(?s)' + [regex]::Escape($begin) + '.*?' + [regex]::Escape($end) + '\r?\n?'), ''
    $match = [regex]::Match($Content, '(?im)^\s*Match\s+')
    $split = if ($match.Success) { $match.Index } else { $Content.Length }
    $prefix = $Content.Substring(0, $split)
    if ($prefix -match '(?im)^\s*Include\s+') {
        throw 'Include before deploy policy requires owner review: inline global directives and move Match blocks into sshd_config first'
    }
    return $prefix.TrimEnd("`r", "`n") + "`r`n$begin`r`nMatch User deploy`r`n    PasswordAuthentication no`r`n    KbdInteractiveAuthentication no`r`nMatch all`r`n$end`r`n" + $Content.Substring($split)
}
function Assert-TransitionPolicy([string]$Before, [string]$After, [bool]$Principals) {
    if ($After -notmatch '(?im)^\s*TrustedUserCAKeys\s+__PROGRAMDATA__/ssh/deploy_ca\.pub\s*$') {
        throw 'Managed trust directive missing; complete S2 before principals apply'
    }
    if (-not $Principals) {
        $pattern = '(?im)^\s*AuthorizedPrincipalsFile[^\r\n]*'
        $oldValues = @([regex]::Matches($Before, $pattern) | ForEach-Object { $_.Value }) -join "`n"
        $newValues = @([regex]::Matches($After, $pattern) | ForEach-Object { $_.Value }) -join "`n"
        if ($oldValues -cne $newValues) {
            throw 'Trust transaction must preserve the existing principals directive'
        }
    }
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
function Resolve-SshdPath([string]$Explicit) {
    if ($Explicit) { return $Explicit }
    $service = Get-CimInstance -ClassName Win32_Service -Filter "Name='sshd'"
    if (-not $service) { throw 'sshd service is missing' }
    $command = [Environment]::ExpandEnvironmentVariables($service.PathName).Trim()
    if ($command -match '^"([^"]+\.exe)"(?:\s|$)') { $executable = $Matches[1] }
    elseif ($command -match '^([^\s"]+\.exe)(?:\s|$)') { $executable = $Matches[1] }
    else { throw 'Ambiguous sshd service executable; owner must inspect PathName' }
    if ($executable -notmatch '(?i)[\\/]sshd\.exe$') { throw 'Service executable is not sshd.exe' }
    return $executable
}
function Assert-DeployGroups($Account) {
    $privileged = @('S-1-5-32-544','S-1-5-32-547','S-1-5-32-548','S-1-5-32-549',
                    'S-1-5-32-550','S-1-5-32-551','S-1-5-32-552','S-1-5-32-556','S-1-5-32-578')
    foreach ($group in Get-LocalGroup) {
        if ($group.SID.Value -notin $privileged -and $group.Name -ne 'docker-users') { continue }
        if (Get-LocalGroupMember -Group $group -ErrorAction Stop | Where-Object { $_.SID -eq $Account.SID }) {
            throw 'Existing deploy account belongs to a privileged group; owner must resolve'
        }
    }
}
function Test-SshdPolicy([string]$Sshd, [string]$Conf, [string]$Root, [string[]]$Users) {
    foreach ($user in $Users) {
        foreach ($source in @('127.0.0.1', '10.0.0.1', '192.0.2.1', '2001:db8::1')) {
            $effective = & $Sshd -T -f $Conf -C "user=$user,host=localhost,addr=$source"
            if ($LASTEXITCODE -ne 0) { throw 'sshd effective-policy check failed' }
            $values = @{}
            foreach ($line in $effective) {
                $parts = $line -split '\s+', 2
                if ($parts.Count -eq 2) { $values[$parts[0].ToLowerInvariant()] = $parts[1].Replace('\','/') }
            }
            if ($values.trustedusercakeys -notin @('__PROGRAMDATA__/ssh/deploy_ca.pub', ($Root.Replace('\','/') + '/deploy_ca.pub'))) {
                throw 'Effective trust policy differs; inspect Match/Include'
            }
            if ($values.authorizedprincipalsfile -notin @('__PROGRAMDATA__/ssh/principals/%u', ($Root.Replace('\','/') + '/principals/%u'))) {
                throw 'Effective principals policy differs; inspect Match/Include'
            }
            if ($values.ContainsKey('authorizedprincipalscommand') -and $values.authorizedprincipalscommand -ne 'none') { throw 'Unexpected principals command' }
            if ($user -eq 'deploy' -and ($values.passwordauthentication -ne 'no' -or $values.kbdinteractiveauthentication -ne 'no')) {
                throw 'Effective deploy password policy differs'
            }
        }
    }
}

function Set-PublicConfigAcl([string]$Path, [bool]$Readable, [string]$Sddl) {
    if ($Sddl) {
        $acl = Get-Acl -LiteralPath $Path
        $acl.SetSecurityDescriptorSddlForm($Sddl)
        Set-Acl -LiteralPath $Path -AclObject $acl
    } else { Set-StrictAcl $Path $Readable }
}
function Move-PublicConfigAtomically([string]$Temp, [string]$Path) {
    if (Test-Path -LiteralPath $Path) { [IO.File]::Replace($Temp, $Path, [NullString]::Value) }
    else { [IO.File]::Move($Temp, $Path) }
}
function Write-AtomicPublicConfig([string]$Path, [string]$Content, [bool]$Readable = $false, [string]$Sddl = '') {
    $temp = Join-Path (Split-Path -Parent $Path) ('.ca-rotation-' + [guid]::NewGuid().ToString('N') + '.tmp')
    try {
        [IO.File]::WriteAllText($temp, $Content, [Text.UTF8Encoding]::new($false))
        Set-PublicConfigAcl $temp $Readable $Sddl
        Move-PublicConfigAtomically $temp $Path
        # ReplaceFile retains destination metadata; explicitly enforce the planned ACL.
        Set-PublicConfigAcl $Path $Readable $Sddl
    } finally {
        if (Test-Path -LiteralPath $temp) { Remove-Item -LiteralPath $temp -Force }
    }
}

function Test-TransactionBaseline([string]$Sshd, [string]$Conf, [string]$Backup, [System.Collections.IDictionary]$Changes, [bool]$Rollback) {
    if (-not $Rollback) { Test-Sshd $Sshd $Conf; return }
    $candidate = Join-Path $Backup 'rollback-candidate.conf'
    $content = if ($Changes.Contains($Conf)) { $Changes[$Conf] } else { Read-PublicConfig $Conf }
    [IO.File]::WriteAllText($candidate, $content, [Text.UTF8Encoding]::new($false))
    Test-Sshd $Sshd $candidate
}
function Set-StrictAcl([string]$Path, [bool]$Readable = $false) {
    $item = Get-Item -LiteralPath $Path
    $acl = if ($item.PSIsContainer) { [Security.AccessControl.DirectorySecurity]::new() } else { [Security.AccessControl.FileSecurity]::new() }
    $acl.SetAccessRuleProtection($true, $false)
    $admin = [Security.Principal.SecurityIdentifier]::new('S-1-5-32-544')
    $acl.SetOwner($admin)
    $inherit = if ($item.PSIsContainer) { [Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit' } else { [Security.AccessControl.InheritanceFlags]::None }
    foreach ($sid in @('S-1-5-32-544', 'S-1-5-18')) {
        $rule = [Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new($sid), 'FullControl', $inherit, 'None', 'Allow')
        $acl.AddAccessRule($rule)
    }
    if ($Readable) { $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new('S-1-5-32-545'), 'ReadAndExecute', $inherit, 'None', 'Allow')) }
    Set-Acl -LiteralPath $Path -AclObject $acl

}
function Assert-ProtectedPolicyPath([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path)) { return }
    Assert-PlainPath $Path
    $acl = Get-Acl -LiteralPath $Path
    $trusted = @('S-1-5-32-544', 'S-1-5-18')
    $owner = [Security.Principal.NTAccount]::new($acl.Owner).Translate([Security.Principal.SecurityIdentifier]).Value
    if ($owner -notin $trusted) { throw "SSH policy owner must be Administrators or SYSTEM: $Path" }
    $writes = [Security.AccessControl.FileSystemRights]'Write,Delete,DeleteSubdirectoriesAndFiles,ChangePermissions,TakeOwnership'
    foreach ($rule in $acl.Access) {
        $sid = $rule.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value
        if ($rule.AccessControlType -eq 'Allow' -and ($rule.FileSystemRights -band $writes) -and $sid -notin $trusted) {
            throw "SSH policy permits writes outside Administrators/SYSTEM: $Path"
        }
    }
}
function Invoke-WindowsApply {
    param([System.Collections.IDictionary]$Changes, [string]$Root, [string]$Sshd, [bool]$Preview, [string]$Entry,
          [bool]$CreateDeploy = $false, [bool]$DisableDeploy = $false, [hashtable]$RestoreAcls = @{},
          [bool]$Rollback = $false, [string[]]$PrincipalUsers = @())
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
    if ($DisableDeploy) { Write-Output '- ACCOUNT deploy: disable newly created account; retain its files' }
    foreach ($p in $RestoreAcls.Keys) { Write-Output "ACL RESTORE $p : $($RestoreAcls[$p])" }
    if ($CreateDeploy) { Write-Output '+ ACCOUNT deploy: standard Users group only; PasswordNeverExpires; UserMayNotChangePassword; no password login; certificate authentication' }
    $caPath = Join-Path $Root 'deploy_ca.pub'
    $caText = if ($Changes.Contains($caPath)) { $Changes[$caPath] } else { Read-PublicConfig $caPath }
    foreach ($line in ($caText -split '\r?\n')) { if ($line.Trim() -and -not $line.Trim().StartsWith('#')) { Write-Output ('CA fingerprint: ' + (Get-CaFingerprint $line)) } }
    Write-Output 'PLAN: protected ACLs; service PathName validator (unless explicit -Sshd); sshd -t; detached SYSTEM task restarts sshd; AllowStartIfOnBatteries + DontStopIfGoingOnBatteries; restores backup on failure'
    if ($Preview) { Write-Output 'DRY-RUN: no files, accounts, ACLs, tasks, or services changed'; return }
    if ($PSVersionTable.PSEdition -eq 'Core' -and -not $IsWindows) { throw 'Apply requires Windows' }
    if ([IO.Path]::GetFullPath($Root).TrimEnd('\') -ne [IO.Path]::GetFullPath("$env:ProgramData\ssh").TrimEnd('\')) { throw 'Custom Root is allowed only for offline dry-runs' }
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    if (-not ([Security.Principal.WindowsPrincipal]::new($identity)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Apply requires an elevated owner terminal' }
    $Sshd = Resolve-SshdPath $Sshd
    foreach ($directory in @($Root, (Join-Path $Root 'principals'), (Join-Path $Root 'ca-rotation-backups'))) { Assert-ProtectedPolicyPath $directory }
    foreach ($policyFile in $Changes.Keys) { Assert-ProtectedPolicyPath $policyFile }
    if (-not $Rollback) {
        $after = if ($Changes.Contains($conf)) { $Changes[$conf] } else { Read-PublicConfig $conf }
        Assert-TransitionPolicy (Read-PublicConfig $conf) $after ($PrincipalUsers.Count -gt 0)
        Test-Sshd $Sshd $conf
    }
    if (-not $changed.Count -and -not $CreateDeploy -and -not $DisableDeploy) { Write-Output 'Already current; no restart'; return }
    $backup = Join-Path $Root ('ca-rotation-backups\' + [guid]::NewGuid().ToString('N'))
    Assert-PlainPath $backup
    $backupParent = Split-Path -Parent $backup
    if (-not (Test-Path -LiteralPath $backupParent)) { New-Item -ItemType Directory -Path $backupParent | Out-Null; Set-StrictAcl $backupParent }
    New-Item -ItemType Directory -Path $backup -Force | Out-Null
    Set-StrictAcl $backup
    if ($Rollback) { Test-TransactionBaseline $Sshd $conf $backup $Changes $true }
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
            New-LocalUser -Name deploy -Password $secret -PasswordNeverExpires -UserMayNotChangePassword -Description 'CA daily deploy account' | Out-Null
            $secret.Dispose()
            Add-LocalGroupMember -SID 'S-1-5-32-545' -Member deploy
        }
        foreach ($p in $changed.Keys) {
            if ($null -eq $changed[$p]) { Remove-Item -LiteralPath $p -ErrorAction SilentlyContinue; continue }
            $parent = Split-Path -Parent $p
            if (-not (Test-Path -LiteralPath $parent)) { New-Item -ItemType Directory -Path $parent | Out-Null; Set-StrictAcl $parent $true }
            $sddl = if ($RestoreAcls.ContainsKey($p)) { $RestoreAcls[$p] } else { '' }
            Write-AtomicPublicConfig $p $changed[$p] ($p -match '[\\/]principals[\\/]') $sddl
        }
        if ($DisableDeploy) { Disable-LocalUser -Name deploy }
        Test-Sshd $Sshd $conf
        if (-not $Rollback -and $PrincipalUsers.Count) { Test-SshdPolicy $Sshd $conf $Root $PrincipalUsers }
        # Keep restart/rollback independent of an SSH parent process. Never restart the deck.
        $restart = Join-Path $backup 'restart.ps1'
        $body = @'
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $PSCommandPath
. (Join-Path $here 'windows-apply.ps1')
$m = Get-Content -Raw -LiteralPath (Join-Path $here 'manifest.json') | ConvertFrom-Json
$pending = Join-Path (Split-Path -Parent (Split-Path -Parent $here)) 'ca-rotation.pending'
try {
    Restart-Service sshd -ErrorAction Stop
    if ((Get-Service sshd).Status -ne 'Running') { throw 'sshd is not running' }
    'restart-ok' | Set-Content -LiteralPath (Join-Path $here 'result.txt')
    Remove-Item -LiteralPath $pending -Force
} catch {
    foreach ($f in $m.files) {
        if ($f.existed) {
            Write-AtomicPublicConfig $f.path ([IO.File]::ReadAllText($f.saved)) $false $f.acl
        } else { Remove-Item -LiteralPath $f.path -ErrorAction SilentlyContinue }
    }
    if ($m.createdDeploy) { Disable-LocalUser -Name deploy }
    Restart-Service sshd -ErrorAction Stop
    'restart-failed; restored files; new deploy account disabled if present' | Set-Content -LiteralPath (Join-Path $here 'result.txt')
    Remove-Item -LiteralPath $pending -Force
    exit 1
}
'@
        [IO.File]::WriteAllText($restart, $body, [Text.UTF8Encoding]::new($false))
        Set-StrictAcl $restart
        Copy-Item -LiteralPath $script:RotationHelperPath -Destination (Join-Path $backup 'windows-apply.ps1')
        Set-StrictAcl (Join-Path $backup 'windows-apply.ps1')
        $task = 'ssh-ca-rotation-' + (Split-Path -Leaf $backup)
        $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ('-NoProfile -ExecutionPolicy Bypass -File "' + $restart + '"')
        $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
        Register-ScheduledTask -TaskName $task -Action $action -Settings $settings -User SYSTEM -RunLevel Highest -Force | Out-Null
        Write-AtomicPublicConfig (Join-Path $Root 'ca-rotation.pending') $backup
        Start-ScheduledTask -TaskName $task
        Write-Output "Restart queued via SYSTEM task $task. Read $backup\result.txt; remove task after verification."
    } catch {
        foreach ($f in $manifest) {
            if ($f.existed) { Write-AtomicPublicConfig $f.path ([IO.File]::ReadAllText($f.saved)) $false $f.acl }
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
        if ([IO.Path]::GetFullPath((Split-Path -Parent $f.saved)) -ne [IO.Path]::GetFullPath($Backup)) { throw 'Unexpected saved rollback path' }
        Assert-PlainPath $f.saved
        $changes[$f.path] = if ($f.existed) { [IO.File]::ReadAllText($f.saved) } else { $null }
    }
    $script:RollbackDisableDeploy = [bool]$m.createdDeploy
    $script:RollbackAcls = @{}
    foreach ($f in $m.files) { if ($f.existed) { $script:RollbackAcls[$f.path] = $f.acl } }
    return $changes
}

function Get-CaFingerprint([string]$Key) {
    $parts = $Key.Trim() -split '\s+'
    if ($parts.Count -lt 2 -or $parts[0] -ne 'ssh-ed25519') { throw 'Trust file contains an unsupported public key' }
    $raw = [Convert]::FromBase64String($parts[1])
    $sha = [Security.Cryptography.SHA256]::Create()
    try { return 'SHA256:' + [Convert]::ToBase64String($sha.ComputeHash($raw)).TrimEnd('=') }
    finally { $sha.Dispose() }
}
function Remove-LegacyCa([string]$Before) {
    $lines = @($Before -split '\r?\n' | Where-Object { $_.Trim() })
    $kept = @($lines | Where-Object { $_.Trim().StartsWith('#') -or (Get-CaFingerprint $_) -ne 'SHA256:Sg4TJdI9+SNBj8K0et1nEBhb8ntuX7ZzXSqzikyyDL0' })
    if (-not @($kept | Where-Object { -not $_.Trim().StartsWith('#') }).Count) { throw 'Refusing to remove last CA' }
    return ($kept -join "`r`n") + "`r`n"
}
