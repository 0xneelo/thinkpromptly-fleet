# Offline public-config regressions; no service, account, key, or real ACL operation.
param([switch]$LockChild, [string]$MutexName, [string]$Root)
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot/../deploy-keys/lib/windows-apply.ps1"
if ($LockChild) {
    Invoke-WithRotationLock -Root $Root -Preview $false -MutexName $MutexName -Action {
        [Console]::WriteLine('LOCKED')
        [Console]::ReadLine() | Out-Null
    }
    exit 0
}
function Assert-True($Condition, [string]$Message) { if (-not $Condition) { throw $Message } }
function Assert-Throws([scriptblock]$Action, [string]$Pattern) {
    try { & $Action } catch { if ($_.Exception.Message -match $Pattern) { return }; throw }
    throw "Expected failure matching $Pattern"
}
$fixtureRoot = Join-Path ([IO.Path]::GetTempPath()) ('ivo-windows-audit-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $fixtureRoot | Out-Null
try {
    function Get-CimInstance { [pscustomobject]@{ PathName='"C:\Program Files\OpenSSH\sshd.exe" -f C:\config' } }
    Assert-True ((Resolve-SshdPath '') -eq 'C:\Program Files\OpenSSH\sshd.exe') 'Validator must use registered service executable'
    Assert-True ((Resolve-SshdPath 'explicit-sshd') -eq 'explicit-sshd') 'Explicit validator override lost'
    function Get-LocalGroup {
        [pscustomobject]@{ SID=[pscustomobject]@{Value='S-1-5-32-544'}; Name='Administrators' }
        [pscustomobject]@{ SID=[pscustomobject]@{Value='unprivileged-orphan-fixture'}; Name='ordinary-group' }
    }
    function Get-LocalGroupMember($Group) {
        if ($Group.Name -ne 'Administrators') { throw 'unrelated orphan group was inspected' }
        if ($script:privilegedMember) { [pscustomobject]@{SID='deploy-fixture-sid'} }
    }
    $script:privilegedMember = $false
    Assert-DeployGroups ([pscustomobject]@{SID='deploy-fixture-sid'})
    $script:privilegedMember = $true
    Assert-Throws { Assert-DeployGroups ([pscustomobject]@{SID='deploy-fixture-sid'}) } 'privileged group'
    'PASS B-L2/B-L4: privileged group checks and service executable resolution'
    $before = "Port 22`r`nMatch Address 10.0.0.0/8`r`n PasswordAuthentication yes`r`n"
    $after = Set-DeployPolicy $before
    Assert-True ($after.IndexOf('Match User deploy') -lt $after.IndexOf('Match Address')) 'Deploy Match must be first'
    Assert-True ($after -ceq (Set-DeployPolicy $after)) 'Deploy policy must be idempotent'
    Assert-Throws { Set-DeployPolicy "Include custom.conf`r`nPort 22`r`n" } 'Include before deploy policy'
    $trust = "TrustedUserCAKeys __PROGRAMDATA__/ssh/deploy_ca.pub`r`n"
    Assert-TransitionPolicy $trust ($trust + 'AuthorizedPrincipalsFile __PROGRAMDATA__/ssh/principals/%u') $true
    Assert-Throws { Assert-TransitionPolicy '' 'Port 22' $true } 'trust directive missing'
    Assert-Throws { Assert-TransitionPolicy ($trust + 'AuthorizedPrincipalsFile policy') $trust $false } 'preserve'
    'PASS A1: first Match and Include refusal; A2: companion directive checks'

    $script:sources = @()
    $script:badSource = $false
    function Fake-Sshd {
        $script:sources += $args[-1]
        $global:LASTEXITCODE = 0
        'trustedusercakeys __PROGRAMDATA__/ssh/deploy_ca.pub'
        'authorizedprincipalsfile __PROGRAMDATA__/ssh/principals/%u'
        'authorizedprincipalscommand none'
        if ($script:badSource -and $args[-1] -match 'addr=10\.0\.0\.1$') { 'passwordauthentication yes' }
        else { 'passwordauthentication no' }
        'kbdinteractiveauthentication no'
    }
    Test-SshdPolicy 'Fake-Sshd' 'public-config-fixture' $fixtureRoot @('deploy','vibe')
    Assert-True ($script:sources.Count -eq 8) 'Check both users across IPv4/IPv6 sources'
    $script:badSource = $true
    Assert-Throws { Test-SshdPolicy 'Fake-Sshd' 'public-config-fixture' $fixtureRoot @('deploy') } 'password policy differs'
    'PASS A1: effective non-loopback policy failure is rejected'

    $name = 'ivo-test-' + [guid]::NewGuid().ToString('N')
    $start = [Diagnostics.ProcessStartInfo]::new((Get-Process -Id $PID).Path)
    $start.UseShellExecute = $false
    $start.RedirectStandardInput = $true; $start.RedirectStandardOutput = $true; $start.RedirectStandardError = $true
    foreach ($arg in @('-NoProfile','-File',$PSCommandPath,'-LockChild','-MutexName',$name,'-Root',$fixtureRoot)) { $start.ArgumentList.Add($arg) }
    $child = [Diagnostics.Process]::Start($start)
    try {
        Assert-True ($child.StandardOutput.ReadLine() -eq 'LOCKED') 'Child must acquire mutex'
        Assert-Throws { Invoke-WithRotationLock -Root $fixtureRoot -Preview $false -MutexName $name -Action { throw 'unlocked action ran' } } 'host mutex'
        $child.StandardInput.WriteLine('release')
        Assert-True ($child.WaitForExit(5000)) 'Child must release mutex'
        Assert-True ($child.ExitCode -eq 0) 'Child mutex fixture failed'
    } finally { if (-not $child.HasExited) { $child.Kill() }; $child.Dispose() }
    $pending = Join-Path $fixtureRoot 'ca-rotation.pending'
    [IO.File]::WriteAllText($pending, 'public-backup-directory')
    Assert-Throws { Invoke-WithRotationLock -Root $fixtureRoot -Preview $false -MutexName $name -Action { throw 'pending action ran' } } 'restart/recovery is pending'
    Remove-Item -LiteralPath $pending
    Invoke-WithRotationLock -Root $fixtureRoot -Preview $false -MutexName $name -Action { 'PASS A2: cross-process mutex and detached restart gate' }

    # Mock only ACL installation; exercise the real temporary-file and rename path.
    $target = Join-Path $fixtureRoot 'sshd_config'
    [IO.File]::WriteAllText($target, 'old public config')
    function Set-StrictAcl([string]$Path, [bool]$Readable) {
        Assert-True ((Split-Path -Parent $Path) -eq $fixtureRoot) 'Stage file must share target directory'
        if ($Path -eq $target) {
            Assert-True ([IO.File]::ReadAllText($target) -eq 'new public config') 'Final ACL applied before complete replacement'
            return
        }
        Assert-True ([IO.File]::ReadAllText($target) -eq 'old public config') 'Target changed before protected staging'
        Assert-True ([IO.File]::ReadAllText($Path) -eq 'new public config') 'Stage content incomplete'
    }
    Write-AtomicPublicConfig $target 'new public config'
    Assert-True ([IO.File]::ReadAllText($target) -eq 'new public config') 'Atomic replacement failed'
    Assert-True (@(Get-ChildItem -LiteralPath $fixtureRoot -Filter '.ca-rotation-*').Count -eq 0) 'Stage file leaked'
    [IO.File]::WriteAllText($target, 'old public config')
    function Move-PublicConfigAtomically { throw 'injected rename failure' }
    Assert-Throws { Write-AtomicPublicConfig $target 'new public config' } 'rename failure'
    Assert-True ([IO.File]::ReadAllText($target) -eq 'old public config') 'Failed rename damaged target'
    Assert-True (@(Get-ChildItem -LiteralPath $fixtureRoot -Filter '.ca-rotation-*').Count -eq 0) 'Failed rename leaked stage'
    Remove-Item Function:Move-PublicConfigAtomically
    'PASS A5: staged atomic replacement and failure cleanup'

    [IO.File]::WriteAllText($target, 'MALFORMED')
    $backup = Join-Path $fixtureRoot 'backup'; New-Item -ItemType Directory -Path $backup | Out-Null
    $script:validated = @()
    function Test-Sshd([string]$Sshd, [string]$Conf) {
        $script:validated += $Conf
        Assert-True ([IO.File]::ReadAllText($Conf) -eq 'Port 22') 'Validated malformed current config instead of rollback candidate'
    }
    $changes = [ordered]@{}; $changes[$target] = 'Port 22'
    Test-TransactionBaseline 'fake-sshd' $target $backup $changes $true
    Assert-True ($script:validated[0] -eq (Join-Path $backup 'rollback-candidate.conf')) 'Wrong rollback validation path'
    'PASS A7: rollback validates saved config despite malformed current config'
} finally { Remove-Item -LiteralPath $fixtureRoot -Recurse -Force }
