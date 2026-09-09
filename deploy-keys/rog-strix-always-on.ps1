# rog-strix always-on: lid closed stays up, never sleeps/hibernates, Tailscale + sshd survive.
# Applied 2026-09-09 to all four ASUS schemes (Performance/Balanced/Silent/Turbo) so Armoury Crate
# mode switches keep the settings. Run from the Mac (the box swallows a stdin pipe, so -EncodedCommand):
#   B64=$(iconv -f utf-8 -t utf-16le deploy-keys/rog-strix-always-on.ps1 | base64 | tr -d '\n')
#   ssh rs-deploy "powershell -NoProfile -ExecutionPolicy Bypass -EncodedCommand $B64"
# Needs an admin login (misterisley is). Idempotent. Not covered here: Tailscale key expiry is an
# admin-console setting (login.tailscale.com -> machine symmio -> Disable key expiry).
$ErrorActionPreference = 'Continue'
$schemes = (powercfg /list | Select-String 'GUID: ([0-9a-f-]{36})').Matches | ForEach-Object { $_.Groups[1].Value }
$active  = ((powercfg /getactivescheme) | Select-String '([0-9a-f-]{36})').Matches[0].Groups[1].Value
"schemes: $($schemes -join ' ')"; "active: $active"
# unhide lid/sleep settings so they show in the UI too
powercfg /attributes SUB_BUTTONS LIDACTION -ATTRIB_HIDE | Out-Null
powercfg /attributes SUB_SLEEP UNATTENDSLEEP -ATTRIB_HIDE | Out-Null
powercfg /attributes SUB_SLEEP ALLOWSTANDBY -ATTRIB_HIDE | Out-Null
$wlan = '19cbb8fa-5279-450e-9fac-8a3d5fedd0c1'; $wlanPS = '12bbebe6-58d6-4636-95bb-3217ef867c1a'
foreach ($s in $schemes) {
  foreach ($m in 'ac','dc') {
    $set = "/set${m}valueindex"
    powercfg $set $s SUB_BUTTONS LIDACTION 0          # lid close: do nothing
    powercfg $set $s SUB_SLEEP STANDBYIDLE 0          # sleep after: never
    powercfg $set $s SUB_SLEEP HIBERNATEIDLE 0        # hibernate after: never
    powercfg $set $s SUB_SLEEP UNATTENDSLEEP 0        # unattended sleep: never
    powercfg $set $s SUB_SLEEP ALLOWSTANDBY 0         # allow standby states: off
    powercfg $set $s SUB_DISK DISKIDLE 0              # disk off: never
    powercfg $set $s $wlan $wlanPS 0                  # wifi power saving: max performance
  }
}
powercfg /setactive $active
powercfg /hibernate off
# services: restart on crash
sc.exe failure Tailscale reset= 86400 actions= restart/5000/restart/10000/restart/30000 | Out-Null
sc.exe failure sshd reset= 86400 actions= restart/5000/restart/10000/restart/30000 | Out-Null
# wifi NIC: forbid device power-down (takes effect after reboot)
$nic = 'HKLM:\SYSTEM\CurrentControlSet\Control\Class\{4d36e972-e325-11ce-bfc1-08002be10318}\0013'
if ((Get-ItemProperty $nic).DriverDesc -match 'AX211') { Set-ItemProperty $nic -Name PnPCapabilities -Value 24 -Type DWord; "wifi PnPCapabilities=24 set" }
"--- verify (active scheme) ---"
  $out = powercfg /q SCHEME_CURRENT $q.Split(' ')[0] $q.Split(' ')[1] | Select-String 'Current (AC|DC)'
  "$q => " + (($out | ForEach-Object { $_.Line.Trim() -replace 'Current | Power Setting Index','' }) -join ' ')
}
powercfg /a | Select-String -Pattern 'Standby \(S0|Hibernate' -Context 0,1
sc.exe qfailure Tailscale | Select-String 'RESTART' | Select-Object -First 1
