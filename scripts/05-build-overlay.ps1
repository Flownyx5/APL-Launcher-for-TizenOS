# 05-build-overlay.ps1 — hands APL Overlay the Home, Pause, Samsung TV Plus and Prime Video buttons.
# APL Overlay comes in the launcher's package (hybrid .wgt, 03-build-launcher.ps1): nothing is built
# here any more. A screen set up before that still has the old separate package (apl.launcher.overlay)
# and Vetro rules pointing to it: the package is removed and the rules move to APLauncher.Overlay.
#
#   .\scripts\05-build-overlay.ps1 -TvIp 192.168.1.50
#   .\scripts\05-build-overlay.ps1 -TvIp 192.168.1.50 -RemapOnly    (once the remote is set up in Vetro)
param(
    [Parameter(Mandatory = $true)][string]$TvIp,
    [string]$ProfileName = "APLauncher",   # kept for the callers; the overlay is signed with the launcher now
    [string]$TizenCli,
    [switch]$RemapOnly
)
. "$PSScriptRoot\lib.ps1"
$ErrorActionPreference = 'Stop'
$Base = "http://$TvIp`:$(Get-VetroPort)"
$Overlay = "APLauncher.Overlay"
$OldOverlay = "apl.launcher.overlay"

# APL Overlay must be on the screen, in the launcher's package
try { $have = Invoke-VetroExec $Base "app_launcher -l 2>/dev/null | grep -c '$Overlay' || true" }
catch {
    $msg = (Tr "Vetro did not answer: " "Vetro n'a pas répondu : ") + $_.Exception.Message
    if ($RemapOnly) { Send-Gui ("APL-RESULT fail " + $msg); exit 1 }
    throw $msg
}
if (($have.Trim() -split '\s+')[-1] -in @('', '0')) {
    $msg = Tr "APL Overlay is not on the screen: install APL Launcher first." "APL Overlay n'est pas sur l'écran : installe d'abord APL Launcher."
    if ($RemapOnly) { Send-Gui ("APL-RESULT fail " + $msg); exit 1 }
    throw $msg
}

# The Home button goes to the overlay if it went to the launcher (or to the old overlay). The launcher takes it back if the overlay disappears, and says so.
try {
$cur = Invoke-RestMethod -Uri "$Base/remap" -TimeoutSec 15
$changed = $false
# Where-Object: with no rules, @($cur.rules) would be one $null that goes back to Vetro as a rule
$rules = @($cur.rules | Where-Object { $_ })
foreach ($rule in $rules) {
    foreach ($a in @($rule.actions)) {
        if ($a.type -eq 'launch' -and ($a.appId -eq 'APLauncher.Home' -or $a.appId -eq $OldOverlay)) { $a.appId = $Overlay; $changed = $true }
    }
}
# Pause (244) = Control Center. Samsung TV Plus (560) = AquaPlay and Prime Video (221) = TizenTube, only if
# the app is installed: otherwise the button keeps its Samsung role. Restore removes them.
$codes = @(244)
try {
    $installed = Invoke-VetroExec $Base "app_launcher -l 2>/dev/null | grep -o -E 'AquaPlay02.AquaPlay|xvvl3S1bvH.TizenBrewStandalone' | sort -u"
    if ($installed -match 'AquaPlay02') { $codes += 560 }
    if ($installed -match 'TizenBrewStandalone') { $codes += 221 }
} catch {}
foreach ($code in $codes) {
    if ($rules | Where-Object { $_.id -eq "physical_$code" }) { continue }
    $rules += [pscustomobject]@{ id = "physical_$code"; enabled = $true; trigger = @{ type = 'physical'; value = "$code" }; actions = @(@{ type = 'launch'; appId = $Overlay }) }
    $changed = $true
}
if ($changed) {
    Invoke-RestMethod -Uri "$Base/remap" -Method Post -ContentType 'application/json' -Body (@{ rules = $rules } | ConvertTo-Json -Depth 8) -TimeoutSec 15 | Out-Null
    $extra = @(); if ($codes -contains 560) { $extra += "TV Plus = AquaPlay" }; if ($codes -contains 221) { $extra += "Prime Video = TizenTube" }
    Write-Host ((Tr "        Remote: Home twice = open apps, Home held or Pause = Control Center" "        Télécommande : 2 fois Home = apps ouvertes, Home maintenu ou Pause = Centre de contrôle") + $(if ($extra) { ", " + ($extra -join ", ") } else { "" }) + ".") -ForegroundColor Green
}
# Read the rules back: the old package goes only if none of them still launches it
$after = Invoke-RestMethod -Uri "$Base/remap" -TimeoutSec 15
$left = @($after.rules | Where-Object { $_ } | Where-Object { @($_.actions) | Where-Object { $_.type -eq 'launch' -and $_.appId -eq $OldOverlay } }).Count
} catch {
    if ($RemapOnly) { Send-Gui ("APL-RESULT fail " + (Tr "Vetro did not accept the buttons: " "Vetro n'a pas accepté les boutons : ") + $_.Exception.Message); exit 1 }
    throw
}
# The old separate package, from before the hybrid one. Removed only once Vetro has no rule left that
# launches it (read back above): otherwise Home would point to an app that is gone.
if ($left) {
    Write-Host (Tr "        The old APL Overlay package is kept: $left Vetro rule(s) still open it." "        L'ancien paquet APL Overlay est conservé : $left règle(s) Vetro l'ouvrent encore.") -ForegroundColor DarkYellow
} else {
    try {
        # -F: a fixed string, no backslashes (Vetro's /exec doubles them). || true: grep exits with 1 when it counts 0
        $old = Invoke-VetroExec $Base "pkgcmd -l 2>/dev/null | grep -cF '[$OldOverlay]' || true"
        if (($old.Trim() -split '\s+')[-1] -notin @('', '0')) {
            $out = Invoke-VetroExec $Base "app_launcher -k $OldOverlay >/dev/null 2>&1; pkgcmd -u -n $OldOverlay 2>&1 | tail -1" 120
            $old = Invoke-VetroExec $Base "pkgcmd -l 2>/dev/null | grep -cF '[$OldOverlay]' || true"
            if (($old.Trim() -split '\s+')[-1] -notin @('', '0')) { throw $out.Trim() }
            Write-Host (Tr "        Old APL Overlay package removed: it now comes with the launcher." "        Ancien paquet APL Overlay supprimé : il vient maintenant avec le launcher.") -ForegroundColor Green
        }
    } catch { Write-Host ((Tr "        The old APL Overlay package could not be removed: " "        L'ancien paquet APL Overlay n'a pas pu être supprimé : ") + $_.Exception.Message) -ForegroundColor DarkYellow }
}

if ($RemapOnly) { Send-Gui "APL-RESULT ok" }
