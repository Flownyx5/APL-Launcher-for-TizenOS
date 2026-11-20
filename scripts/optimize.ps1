# ============================================================
#  optimize.ps1 — slims the screen down as much as possible. Started by APL Launcher Setup (Optimize).
#
#  Goes through Vetro (already installed on the screen, root access) and respects
#  its safeguards: "protected" components and those the system
#  needs ("keep" role: TV, home/menus, system) are NEVER
#  touched, nor Bluetooth / HDMI-CEC.
#
#  KEPT: TizenTube, TizenBrew (+ its service), Steam Link, Moonlight, Hot IPTV, Samsung Internet, Vetro,
#           APL Launcher, App Store, HDMI sources, Samsung TV Plus, AirPlay,
#           Multi View, screen mirroring + everything the system needs.
#  CUT: SmartThings and extra Samsung services (not the Samsung account).
#  Unneeded DOWNLOADED APPS        -> uninstalled (can be reinstalled from the Store)
#  Unneeded SAMSUNG COMPONENTS     -> auto start + auto restart turned off, then stopped
#                                     (nothing is erased from the system: reversible)
#  SAMSUNG'S YOUTUBE (if you ask for it) -> uninstalled: TizenTube replaces it
#                                     (can be reinstalled from the App Store)
#  Shows everything BEFORE acting, asks for confirmation, keeps a backup
#  (Restore can put everything back).
# ============================================================
param(
    [string]$TvIp,
    [switch]$Plan,           # only says what would change (APL-PLAN), changes nothing
    [switch]$Unattended,     # started by APL Launcher Setup: no questions
    [string]$Uninstall,      # with -Unattended: the downloaded apps to uninstall (appId;appId;…)
    [switch]$RemoveYouTube   # with -Unattended: also delete Samsung's YouTube
)
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\lib.ps1"
$Quiet = $Plan -or $Unattended

function Fail([string]$msg) {
    Write-Host ""; Write-Host (Tr "  PROBLEM: $msg" "  PROBLÈME : $msg") -ForegroundColor Red; Write-Host ""
    if ($Quiet) { Send-Gui "APL-RESULT fail $msg"; exit 1 }
    Read-Host (Tr "  Press Enter to close" "  Appuie sur Entrée pour fermer"); exit 1
}
# Accepts y/yes/o/oui whatever the language shown; anything else (or Enter) means no.
function Ask-YesNo([string]$q) { return ((Read-Host ("  $q " + (Tr "(y/N)" "(o/N)"))) -match '^[oOyY]') }

if (-not $Quiet) { Clear-Host }
Write-Host ""
Write-Host "  ==============================================" -ForegroundColor White
Write-Host (Tr "        APL Launcher - screen optimization" "        APL Launcher - optimisation de l'écran") -ForegroundColor White
Write-Host "  ==============================================" -ForegroundColor White
$savedIp = Get-SavedTvIp
if (-not $TvIp -and -not $Quiet) { $TvIp = Read-Host ((Tr "  Screen IP address" "  Adresse IP de l'écran") + $(if ($savedIp) { " [$savedIp]" } else { "" })) }
if ([string]::IsNullOrWhiteSpace($TvIp)) { $TvIp = $savedIp }
$base = "http://$TvIp`:$(Get-VetroPort)"

if (-not (Test-Vetro $TvIp)) {
    Fail (Tr "Vetro is not responding. On the screen: open Vetro once (Apps), wait 1 minute, and check that 'Host PC IP' is 127.0.0.1." "Vetro ne répond pas. Sur l'écran : ouvre Vetro une fois (Applis), attends 1 minute, et vérifie que « Host PC IP » vaut 127.0.0.1.")
}

Write-Host ""
Write-Host (Tr "  Reading everything that is installed (30 seconds)…" "  Lecture de tout ce qui est installé (30 secondes)…") -ForegroundColor Cyan
try { $inv = Invoke-RestMethod -Uri "$base/apps?refresh=1" -TimeoutSec 120 } catch { Fail (Tr "could not read the inventory: $($_.Exception.Message)" "inventaire illisible : $($_.Exception.Message)") }
if ($inv.registryError) { Fail (Tr "Vetro has no access to the app registry ($($inv.registryError))." "Vetro n'a pas accès au registre des apps ($($inv.registryError)).") }
$rows = @($inv.apps)
$running = @{}
try {
    $mon = Invoke-RestMethod -Uri "$base/monitor?scope=full" -TimeoutSec 60
    foreach ($p in @($mon.processes)) { if ($p.appId) { $running[$p.appId] = $true } }
} catch {}

# ---------- what we keep ----------
# Samsung's YouTube (9Ur5IzDKqV.TizenYouTube, or 111299001912 on older models):
# never touched by the sorting below; uninstalled only if you ask for it (separate question).
# Steam Link and Moonlight: kept if they are installed. apl.launcher.overlay: APL Overlay's own package on Tizen 6.
$KEEP = 'TizenYouTube|TizenTube|TizenBrew|xvvl3S1|9Ur5IzDKqV|^111299001912|6YLB5zo9te|HotIptv|^org\.tizen\.browser|^vetrotvapp|^APLauncher|^apl\.launcher\.|TSLinkTV01|MoonLightS'
# Always kept, whatever the Vetro category: App Store (+ the Samsung account
# it needs to download), HDMI sources / inputs, Samsung TV Plus and
# channels, USB playback (My Contents), Alexa and the microphone button dispatcher.
$KEEP_SYSTEM = 'store|samsungapps|org\.volt|source|SMSource|hdmi|AVControl|tv-viewer|tvplus|tvPlus|w2VwCK465D|' +
               'samsung-account|samsungaccount|CSAccount|CSBilling|billing|\.sso|ssoservice|usb-launcher|mycontent|' +
               'alexa|multi-assistant'
$keptPkgs = @{}
foreach ($r in $rows) { if (($r.appId -match $KEEP_SYSTEM) -or ($r.packageId -match $KEEP_SYSTEM) -or ($r.name -match 'App ?Store|^Apps$|Samsung TV|TV Plus|Source|HDMI')) { $keptPkgs[$r.packageId] = $true } }
foreach ($r in $rows) { if (($r.appId -match $KEEP) -or ($r.packageId -match $KEEP) -or ($r.name -match 'TizenTube|TizenBrew|^YouTube$|Steam Link|Moonlight|Hot ?IPTV|Hot ?Player|Vetro')) { $keptPkgs[$r.packageId] = $true } }

# User's choice: AirPlay, Multi View and screen mirroring KEPT;
# SmartThings and extra Samsung services CUT (the Samsung account stays,
# the App Store needs it — see KEEP_SYSTEM).
$cutSharing = $false
$cutSamsung = $true

# ---------- sorting ----------
$uninstall = @(); $silence = @(); $seenPkg = @{}
foreach ($r in $rows) {
    if ($r.protected -or $keptPkgs[$r.packageId]) { continue }
    if ($r.role -eq 'keep') { continue }                 # TV, home/menus, system: hands off
    if ($r.area -eq 'devices') { continue }              # Bluetooth, HDMI-CEC, remote
    if ($r.area -eq 'sharing' -and -not $cutSharing) { continue }
    if ($r.area -eq 'samsung' -and -not $cutSamsung) { continue }
    if ($r.system -eq $false -and $r.removable -eq $true) {
        if (-not $seenPkg[$r.packageId]) { $seenPkg[$r.packageId] = $true; $uninstall += $r }
        continue
    }
    if ($r.onboot -or $r.autorestart -or $running[$r.appId]) { $silence += $r }
}

function Label($r) { if ($r.name) { "$($r.name)  [$($r.appId)]" } else { $r.appId } }

Write-Host ""
Write-Host (Tr "  ===== KEPT =====" "  ===== GARDÉ =====") -ForegroundColor Green
$rows | Where-Object { $keptPkgs[$_.packageId] -and $_.show } | ForEach-Object { Write-Host "    $(Label $_)" }
Write-Host (Tr "    + App Store, HDMI sources, Samsung TV Plus, Samsung account, AirPlay, Multi View," "    + App Store, sources HDMI, Samsung TV Plus, compte Samsung, AirPlay, Multi View,")
Write-Host (Tr "      screen mirroring, Bluetooth, and everything the system needs" "      recopie d'écran, Bluetooth, et tout ce dont le système a besoin")
Write-Host ""
Write-Host (Tr "  ===== TO UNINSTALL ($($uninstall.Count) downloaded apps) =====" "  ===== À DÉSINSTALLER ($($uninstall.Count) apps téléchargées) =====") -ForegroundColor Yellow
$uninstall | ForEach-Object { Write-Host "    $(Label $_)" }
Write-Host ""
Write-Host (Tr "  ===== TO TURN OFF at startup + stop ($($silence.Count) Samsung components) =====" "  ===== À COUPER au démarrage + arrêter ($($silence.Count) composants Samsung) =====") -ForegroundColor Yellow
$silence | Group-Object { if ($_.areaLabel) { $_.areaLabel } else { $_.area } } | ForEach-Object {
    Write-Host (Tr "    $($_.Name):" "    $($_.Name) :") -ForegroundColor DarkYellow
    $_.Group | ForEach-Object { Write-Host "      - $(Label $_)" }
}
# ---------- extra system optimizations (through Vetro) ----------
# Samsung ad / tracking hosts (Vetro's list, "ads", "statistics"
# and "reported" groups) — without the Samsung TV Plus ones, which we keep.
$DNS_BLOCK = @('rtb-config.samsungads.com', 'dc.di.atlas.samsung.com', 'regi.di.atlas.samsung.com',
    'regi.bigdata.samsung.com', 'lcprd1.samsungcloudsolution.net', 'samsungads.com', 'config.samsungads.com',
    'ads.samsung.com', 'samsungacr.com', 'log-config.samsungacr.com', 'log-ingestion.samsungacr.com',
    'acr0.samsungcloudsolution.com')
Write-Host (Tr "  ===== ALSO =====" "  ===== EN PLUS =====") -ForegroundColor Yellow
Write-Host (Tr "    - Vetro switches 'all ads and tracking' and 'Bixby': turned off (Alexa stays on the microphone button)" "    - interrupteurs Vetro « toutes les pubs et le pistage » et « Bixby » : coupés (Alexa reste sur le bouton micro)")
Write-Host (Tr "    - ad filter on the screen: $($DNS_BLOCK.Count) Samsung ad / tracking addresses blocked" "    - filtre anti-pub sur l'écran : $($DNS_BLOCK.Count) adresses de pub / pistage Samsung bloquées")
Write-Host (Tr "    - cleanup of installation leftovers (frees up storage)" "    - nettoyage des restes d'installation (libère du stockage)")
Write-Host (Tr "    - Smart Hub no longer opens by itself at power-on" "    - Smart Hub ne s'ouvre plus tout seul à l'allumage")

Write-Host ""
# Uninstalling: separate question (the listed apps are kept if the answer is no)
# Samsung's YouTube: only the app named exactly "YouTube" (never TizenTube).
$ytRows = @($rows | Where-Object { ($_.appId -match '^(9Ur5IzDKqV\.TizenYouTube|111299001912)$') -and ("$($_.name)".Trim() -eq 'YouTube') -and -not $_.disabled })
if ($Plan) {
    $planOut = @{
        uninstall = @($uninstall | ForEach-Object { @{ appId = $_.appId; name = "$($_.name)" } })
        silence = @($silence | ForEach-Object { @{ appId = $_.appId; name = "$($_.name)"; area = $(if ($_.areaLabel) { "$($_.areaLabel)" } else { "$($_.area)" }) } })
        youtube = @($ytRows | ForEach-Object { @{ appId = $_.appId; name = "$($_.name)" } })
        kept = @($rows | Where-Object { $keptPkgs[$_.packageId] -and $_.show } | ForEach-Object { if ($_.name) { "$($_.name)" } else { $_.appId } } | Select-Object -Unique)
        dnsCount = $DNS_BLOCK.Count
    }
    Send-Gui ("APL-PLAN " + ($planOut | ConvertTo-Json -Compress -Depth 4))
    exit 0
}
$removeYt = @()
if ($Unattended) {
    if ($RemoveYouTube) { $removeYt = $ytRows }
    $wanted = @("$Uninstall" -split ';' | Where-Object { $_ })
    $uninstall = @($uninstall | Where-Object { $wanted -contains $_.appId })
} elseif ($ytRows.Count) {
    Write-Host ""
    Write-Host (Tr "  ===== SAMSUNG'S YOUTUBE =====" "  ===== YOUTUBE DE SAMSUNG =====") -ForegroundColor Yellow
    $ytRows | ForEach-Object { Write-Host "    $(Label $_)" }
    Write-Host (Tr "    TizenTube replaces it. Can be reinstalled from the App Store if needed." "    TizenTube le remplace. Réinstallable depuis l'App Store si besoin.")
    if (Ask-YesNo (Tr "Delete Samsung's YouTube app?" "Supprimer l'app YouTube de Samsung ?")) { $removeYt = $ytRows }
}
if (-not $Unattended -and $uninstall.Count -gt 0 -and -not (Ask-YesNo (Tr "Uninstall the $($uninstall.Count) downloaded apps listed above?" "Désinstaller les $($uninstall.Count) apps téléchargées listées plus haut ?"))) {
    $uninstall = @()
    Write-Host (Tr "  The downloaded apps are kept." "  Les apps téléchargées sont gardées.")
}
if (-not $Unattended -and -not (Ask-YesNo (Tr "Apply all of this?" "On applique tout ça ?"))) { Write-Host (Tr "  Nothing was changed." "  Rien n'a été modifié."); Read-Host (Tr "  Press Enter to close" "  Entrée pour fermer"); exit 0 }

# ---------- backup (for Restore) ----------
$backupDir = Join-Path $env:APPDATA "APL-Launcher"
New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
$backupFile = Join-Path $backupDir ("optimisation-" + (Get-Date -Format 'yyyyMMdd-HHmmss') + ".json")
$backup = @{
    tv = $TvIp; date = (Get-Date).ToString('s')
    silenced = @($silence | ForEach-Object { @{ appId = $_.appId; name = $_.name; onboot = [bool]$_.onboot; autorestart = [bool]$_.autorestart } })
    uninstalled = @($uninstall | ForEach-Object { @{ appId = $_.appId; packageId = $_.packageId; name = $_.name } })
    youtubeRemoved = @($removeYt | ForEach-Object { @{ appId = $_.appId; packageId = $_.packageId; name = $_.name } })
}
($backup | ConvertTo-Json -Depth 5) | Set-Content -LiteralPath $backupFile -Encoding UTF8

function Act($body) {
    try {
        $r = Invoke-RestMethod -Uri "$base/components/action" -Method Post -ContentType 'application/json' `
            -Body ($body | ConvertTo-Json -Compress) -TimeoutSec 90
        return [bool]$r.ok
    } catch { return $false }
}

$total = $uninstall.Count + $silence.Count; $n = 0; $okCount = 0; $failed = @()
# Original state of the system settings, for Restore
try { $backup.autorunWas = ((Invoke-VetroExec $base "vconftool get db/menu/smart_hub/ontvsetting/auto_start 2>&1") -replace '(?s).*value = (\d+).*', '$1').Trim() } catch {}
try { $d0 = Invoke-RestMethod -Uri "$base/dns" -TimeoutSec 30; $backup.dnsWas = @{ enabled = [bool]$d0.enabled; domains = @($d0.domains) } } catch {}
($backup | ConvertTo-Json -Depth 5) | Set-Content -LiteralPath $backupFile -Encoding UTF8

foreach ($r in $uninstall) {
    $n++; Send-Progress (90 * $n / $total) (Tr "Uninstalling: $(Label $r)" "Désinstallation : $(Label $r)")
    if (Act @{ appId = $r.appId; action = 'uninstall' }) { $okCount++ } else { $failed += (Tr "uninstall $(Label $r)" "désinstaller $(Label $r)") }
}
foreach ($r in $silence) {
    $n++; Send-Progress (90 * $n / $total) (Tr "Stopping: $(Label $r)" "Arrêt : $(Label $r)")
    $good = $true
    if ($r.onboot) { $good = (Act @{ appId = $r.appId; action = 'flags'; flag = 'onboot'; enabled = $false }) -and $good }
    if ($r.autorestart) { $good = (Act @{ appId = $r.appId; action = 'flags'; flag = 'autorestart'; enabled = $false }) -and $good }
    if ($running[$r.appId]) { [void](Act @{ appId = $r.appId; action = 'stop' }) }
    if ($good) { $okCount++ } else { $failed += (Tr "turn off $(Label $r)" "couper $(Label $r)") }
}
Write-Progress -Activity (Tr "Optimization" "Optimisation") -Completed

foreach ($y in $removeYt) {
    # Closed, then uninstalled through Vetro; otherwise with Samsung's install command.
    $pkg = if ($y.packageId) { $y.packageId } else { ($y.appId -split '\.')[0] }
    try { Invoke-VetroExec $base "app_launcher -k com.samsung.tv.cobalt-yt >/dev/null 2>&1; app_launcher -k $($y.appId) >/dev/null 2>&1; true" 20 | Out-Null } catch {}
    $gone = Act @{ appId = $y.appId; action = 'uninstall' }
    if (-not $gone) {
        try { Invoke-VetroExec $base "pkgcmd -u -n $pkg 2>&1; true" 120 | Out-Null } catch {}
        try { $gone = -not ((Invoke-VetroExec $base "pkgcmd -l 2>/dev/null | grep 'pkgid \[$pkg\]'; true").Trim()) } catch {}
    }
    if ($gone) { Write-Host (Tr "    ok  Samsung's YouTube deleted" "    ok  YouTube de Samsung supprimé") -ForegroundColor Green }
    else { $failed += (Tr "delete Samsung's YouTube (the screen refused)" "supprimer YouTube de Samsung (l'écran a refusé)") }
}
Write-Host (Tr "  System settings…" "  Réglages système…") -ForegroundColor Cyan
Send-Progress 92 (Tr "System settings…" "Réglages système…")
function Post($path, $body) {
    try { return Invoke-RestMethod -Uri "$base$path" -Method Post -ContentType 'application/json' -Body ($body | ConvertTo-Json -Compress -Depth 4) -TimeoutSec 120 }
    catch { return $null }
}
foreach ($q in @('tracking-all', 'bixby')) {
    $r = Post '/quick' @{ id = $q; off = $true }
    if ($r -and $r.ok) { Write-Host (Tr "    ok  Vetro switch '$q' turned off" "    ok  interrupteur Vetro « $q » coupé") -ForegroundColor Green } else { $failed += (Tr "Vetro switch $q" "interrupteur Vetro $q") }
}
$domains = @($DNS_BLOCK)
if ($backup.dnsWas) { $domains = @(@($backup.dnsWas.domains) + $DNS_BLOCK | Where-Object { $_ } | Select-Object -Unique) }
$r = Post '/dns' @{ action = 'apply'; enabled = $true; domains = $domains }
if ($r -and -not $r.error) { Write-Host (Tr "    ok  ad filter on ($($domains.Count) addresses)" "    ok  filtre anti-pub actif ($($domains.Count) adresses)") -ForegroundColor Green } else { $failed += (Tr "ad filter" "filtre anti-pub") }
$r = Post '/leftovers' @{ action = 'clear' }
if ($r -and -not $r.error) { Write-Host (Tr "    ok  installation leftovers cleaned up" "    ok  restes d'installation nettoyés") -ForegroundColor Green }
if ((Get-VconfValue $base 'db/appfw/home_appid') -like 'APLauncher*') {
    # Start on APL Launcher: Autorun Smart Hub opens the screen's home app, the launcher, so it stays on
    Write-Host (Tr "    ok  the screen starts on APL Launcher (Smart Hub at power-on left on: it opens the launcher)" "    ok  l'écran démarre sur APL Launcher (Smart Hub à l'allumage laissé activé : il ouvre le launcher)") -ForegroundColor Green
} else {
    try {
        Invoke-VetroExec $base "vconftool set -f -t int db/menu/smart_hub/ontvsetting/auto_start 0" | Out-Null
        Write-Host (Tr "    ok  Smart Hub no longer opens at power-on" "    ok  Smart Hub ne s'ouvre plus à l'allumage") -ForegroundColor Green
    } catch { $failed += (Tr "Smart Hub at startup setting" "réglage Smart Hub au démarrage") }
}

Write-Host ""
Write-Host "  ==============================================" -ForegroundColor Green
Write-Host (Tr "    Done: $okCount / $total items processed." "    Terminé : $okCount / $total éléments traités.") -ForegroundColor Green
Write-Host "  ==============================================" -ForegroundColor Green
if ($failed.Count) {
    Write-Host (Tr "  Not processed (refused by the screen or by Vetro, harmless):" "  Non traités (refusés par l'écran ou par Vetro, sans gravité) :") -ForegroundColor DarkYellow
    $failed | ForEach-Object { Write-Host "    - $_" }
}
Write-Host ""
Write-Host (Tr "  Backup: $backupFile" "  Sauvegarde : $backupFile")
Write-Host (Tr "  To put everything back: Restore, in APL Launcher Setup." "  Pour tout remettre : Restaurer, dans APL Launcher Setup.")
Write-Host (Tr "  Restart the screen (unplug it for 30 s) for a fresh start." "  Redémarre l'écran (débranche 30 s) pour repartir à neuf.") -ForegroundColor Cyan
if ($Quiet) { Send-Progress 100 (Tr "Done" "Terminé"); Send-Gui "APL-RESULT ok"; exit 0 }
Read-Host (Tr "  Press Enter to close" "  Appuie sur Entrée pour fermer")
