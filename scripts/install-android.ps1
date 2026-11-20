# ============================================================
#  install-android.ps1 — installs APL Launcher on an Android TV or Google TV from this PC.
#  Started by APL Launcher Setup (Android TV); also runs on its own in PowerShell.
#
#    .\scripts\install-android.ps1 -TvIp 192.168.1.30
#    .\scripts\install-android.ps1 -TvIp 192.168.1.30 -PairPort 37123 -PairCode 482913   (Wireless debugging)
#
#  1. adb: Android's own tool (platform-tools), found on this PC or downloaded once from Google
#  2. the packages: -Apk, else dist\apl-launcher-v*-android.apk, else the latest GitHub release's .apk; and APL Launcher
#     Home Button, the optional module with the remote buttons service (dist\apl-launcher-home-button-v*-android.apk,
#     or the release's). It is a second app because Play Protect blocks a sideloaded app that declares an accessibility
#     service: adb installs it all the same.
#  3. connects to the TV (USB or Network debugging: the TV asks to allow this PC once)
#  4. installs them, turns on the module's remote buttons service (Home opens APL Launcher), lets the launcher draw
#     over apps (its Control Center over the app in front), gives it your TMDB, YouTube and
#     Fanart.tv keys (-Tmdb -YouTube -Fanart, else the ones saved by APL Launcher Setup) and opens it
#  -CheckOnly: only says what this PC has (APL-CHECK).
# ============================================================
param(
    [string]$TvIp,
    [string]$Port = "5555",
    [string]$PairPort,          # Wireless debugging (Android 11+): the pairing port and code the TV shows
    [string]$PairCode,
    [string]$Apk,
    [switch]$NoHomeService,     # no APL Launcher Home Button (Home keeps the TV's own launcher)
    [string]$Tmdb, [string]$YouTube, [string]$Fanart,   # the Top Shelf's keys; none given: the Setup's saved ones
    [string]$Repo = "Knikt/APL-Launcher",
    [switch]$AplTv,             # also installs APL TV (apl-tv-android.apk of Knikt/APL-TV's latest release)
    [string]$AplTvRepo = "Knikt/APL-TV",
    [switch]$Unattended,
    [switch]$CheckOnly
)
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\lib.ps1"
$Root = Split-Path $PSScriptRoot -Parent
$Quiet = $Unattended -or $CheckOnly
$AppId = "com.knikt.apllauncher"
$ModuleId = "$AppId.home"                      # APL Launcher Home Button (android/homebutton)
$KeyService = "$ModuleId/$ModuleId.KeyService"
$OldService = "$AppId/$AppId.KeyService"       # 1.1.3 and before: the service was in the launcher itself
$Total = 4 + [int][bool]$AplTv

function Step([int]$n, [string]$txt) {
    Write-Host ""
    Write-Host "  [$n/$Total] $txt" -ForegroundColor Cyan
    Send-Gui "APL-STEP $n $Total $txt"
}
function Fail([string]$msg) {
    Write-Host ""
    Write-Host (Tr "  PROBLEM: $msg" "  PROBLÈME : $msg") -ForegroundColor Red
    if ($Quiet) { Send-Gui ("APL-RESULT fail " + ($msg -replace '\s*\r?\n\s*', ' ')) }
    exit 1
}

$tools = Join-Path $env:LOCALAPPDATA "APL-Launcher\platform-tools"
function Find-Adb {
    $list = @((Join-Path $tools "adb.exe"),
              "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe",
              "$env:ANDROID_HOME\platform-tools\adb.exe", "$env:ANDROID_SDK_ROOT\platform-tools\adb.exe",
              "E:\Android\Sdk\platform-tools\adb.exe")
    foreach ($c in $list) { if ($c -and (Test-Path -LiteralPath $c)) { return $c } }
    $cmd = Get-Command adb.exe -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    return $null
}
function Find-LocalApk([string]$prefix = "apl-launcher-v") {
    $dist = Join-Path $Root "dist"
    if (-not (Test-Path -LiteralPath $dist)) { return $null }
    $hit = Get-ChildItem -LiteralPath $dist -Filter "$prefix*android*.apk" -File -ErrorAction SilentlyContinue |
           Where-Object { $_.Name -notmatch 'testkey' } | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($hit) { return $hit.FullName }
    return $null
}

# A release's package (its versioned name, else its fixed name for Downloader), checked against SHA256SUMS-apk.txt
function Get-ReleaseApk($rel, [string]$pattern, [string]$fixed) {
    $asset = @($rel.assets) | Where-Object { $_.name -match $pattern -and $_.name -notmatch 'testkey' } | Select-Object -First 1
    if (-not $asset) { $asset = @($rel.assets) | Where-Object { $_.name -eq $fixed } | Select-Object -First 1 }
    if (-not $asset) { return $null }
    $file = Join-Path $env:LOCALAPPDATA ("APL-Launcher\" + $asset.name)
    Write-Host (Tr "        Downloading $($asset.name)…" "        Téléchargement de $($asset.name)…")
    Invoke-WebRequest -UseBasicParsing -Uri $asset.browser_download_url -OutFile $file -TimeoutSec 300
    $sums = @($rel.assets) | Where-Object { $_.name -match '^SHA256SUMS' -and $_.name -match 'apk' } | Select-Object -First 1
    if ($sums) {
        $txt = (Invoke-WebRequest -UseBasicParsing -Uri $sums.browser_download_url -TimeoutSec 60).Content
        if ($txt -is [byte[]]) { $txt = [Text.Encoding]::ASCII.GetString($txt) }
        $want = ([regex]::Match($txt, '([0-9a-fA-F]{64})\s+\*?' + [regex]::Escape($asset.name))).Groups[1].Value.ToLowerInvariant()
        $got = (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($want -and $want -ne $got) { Remove-Item -LiteralPath $file -Force; throw (Tr "The download is damaged (SHA256 differs). Try again." "Le téléchargement est abîmé (SHA256 différent). Réessaie.") }
    }
    return $file
}

if ($CheckOnly) {
    $check = [ordered]@{ adb = (Find-Adb); apk = $(if ($Apk) { $Apk } else { Find-LocalApk }); module = (Find-LocalApk "apl-launcher-home-button-v") }
    Send-Gui ("APL-CHECK " + ($check | ConvertTo-Json -Compress))
    if (-not $script:Gui) { $check | Format-List }
    exit 0
}
try { Test-TvIp $TvIp } catch { Fail $_.Exception.Message }
try { [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12 } catch {}

Write-Host ""
Write-Host "  ==============================================" -ForegroundColor White
Write-Host (Tr "        APL Launcher - install on Android TV" "        APL Launcher - installation sur Android TV") -ForegroundColor White
Write-Host "  ==============================================" -ForegroundColor White

# ---------- 1. adb ----------
Step 1 (Tr "Looking for adb on this PC…" "Recherche d'adb sur ce PC…")
$adb = Find-Adb
if (-not $adb) {
    Write-Host (Tr "        Downloading Android's platform-tools from Google (about 7 MB)…" "        Téléchargement des platform-tools d'Android chez Google (7 Mo environ)…")
    $zip = Join-Path $env:TEMP "apl-platform-tools.zip"
    try { Invoke-WebRequest -UseBasicParsing -Uri "https://dl.google.com/android/repository/platform-tools-latest-windows.zip" -OutFile $zip -TimeoutSec 300 }
    catch { Fail (Tr "platform-tools could not be downloaded: $($_.Exception.Message)" "Les platform-tools n'ont pas pu être téléchargés : $($_.Exception.Message)") }
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $parent = Split-Path $tools -Parent
    New-Item -ItemType Directory -Force -Path $parent | Out-Null
    if (Test-Path -LiteralPath $tools) { Remove-Item -LiteralPath $tools -Recurse -Force }
    [IO.Compression.ZipFile]::ExtractToDirectory($zip, $parent)    # the zip holds a platform-tools\ folder
    Remove-Item -LiteralPath $zip -Force -ErrorAction SilentlyContinue
    $adb = Find-Adb
    if (-not $adb) { Fail (Tr "adb.exe is missing from the download." "adb.exe manque dans le téléchargement.") }
}
Write-Host "        adb: $adb" -ForegroundColor Green
function Adb([string[]]$a) { Invoke-Native $adb $a }
Adb @('start-server') | Out-Null

# ---------- 2. the package ----------
Step 2 (Tr "Getting APL Launcher for Android…" "Récupération d'APL Launcher pour Android…")
if (-not $Apk) { $Apk = Find-LocalApk }
$ModuleApk = if ($NoHomeService) { $null } else { Find-LocalApk "apl-launcher-home-button-v" }
if (-not $Apk -or (-not $NoHomeService -and -not $ModuleApk)) {
    $api = "https://api.github.com/repos/$Repo/releases/latest"
    try { $rel = Invoke-RestMethod -UseBasicParsing -Uri $api -Headers @{ 'User-Agent' = 'APL-Launcher-Setup' } -TimeoutSec 60 }
    catch { Fail (Tr "Could not reach GitHub ($api): $($_.Exception.Message)" "GitHub injoignable ($api) : $($_.Exception.Message)") }
    if (-not $Apk) {
        try { $Apk = Get-ReleaseApk $rel '^apl-launcher-v.*-android\.apk$' 'apl-launcher-android.apk' } catch { Fail $_.Exception.Message }
        if (-not $Apk) { Fail (Tr "This release ($($rel.tag_name)) has no Android package yet." "Cette version ($($rel.tag_name)) n'a pas encore de paquet Android.") }
    }
    if (-not $NoHomeService -and -not $ModuleApk) {
        # Releases up to 1.1.3 have none: the launcher then had the service itself
        try { $ModuleApk = Get-ReleaseApk $rel '^apl-launcher-home-button-v.*-android\.apk$' 'apl-launcher-home-button.apk' } catch { Write-Host "        $($_.Exception.Message)" -ForegroundColor Yellow }
    }
}
if (-not (Test-Path -LiteralPath $Apk)) { Fail (Tr "Package not found: $Apk" "Paquet introuvable : $Apk") }
Write-Host "        $(Split-Path $Apk -Leaf)" -ForegroundColor Green
if ($ModuleApk) { Write-Host "        $(Split-Path $ModuleApk -Leaf)" -ForegroundColor Green }

# ---------- 3. connect ----------
Step 3 (Tr "Connecting to the TV ($TvIp)… Allow this PC on the TV if it asks." "Connexion à la TV ($TvIp)… Autorise ce PC sur la TV si elle le demande.")
if ($PairPort -and $PairCode) {
    $r = Adb @('pair', "${TvIp}:$PairPort", $PairCode)
    Write-Host "        $($r.Output.Trim())"
    if ($r.Output -notmatch 'Successfully paired') { Fail (Tr "Pairing refused: check the pairing port and code shown by the TV (Wireless debugging › Pair device with pairing code)." "Appairage refusé : vérifie le port et le code d'appairage affichés par la TV (Débogage sans fil › Associer l'appareil avec un code).") }
}
$serial = "${TvIp}:$Port"
$state = ""
for ($i = 0; $i -lt 45; $i++) {
    $r = Adb @('connect', $serial)
    $st = (Adb @('-s', $serial, 'get-state')).Output.Trim()
    if ($st -eq 'device') { $state = 'device'; break }
    if ($i -eq 0) { Write-Host "        $($r.Output.Trim())" }
    if ($st -match 'unauthorized') {
        if ($state -ne 'unauthorized') { Write-Host (Tr "        On the TV: allow debugging from this PC (tick Always allow)." "        Sur la TV : autorise le débogage depuis ce PC (coche Toujours autoriser).") -ForegroundColor Yellow }
        $state = 'unauthorized'
    }
    Start-Sleep -Seconds 2
}
if ($state -ne 'device') {
    if ($state -eq 'unauthorized') { Fail (Tr "The TV did not allow this PC. Accept the debugging question on the TV, then try again." "La TV n'a pas autorisé ce PC. Accepte la question de débogage sur la TV, puis réessaie.") }
    Fail (Tr "No adb answer from $serial. Turn on USB debugging (or Network debugging) in the TV's Developer options." "Pas de réponse adb de $serial. Active le débogage USB (ou réseau) dans les Options pour les développeurs de la TV.")
}
Save-TvIp $TvIp -Name "android-ip.txt"
$model = (Adb @('-s', $serial, 'shell', 'getprop', 'ro.product.model')).Output.Trim()
$sdk = (Adb @('-s', $serial, 'shell', 'getprop', 'ro.build.version.sdk')).Output.Trim()
Write-Host (Tr "        Connected: $model (Android API $sdk)" "        Connecté : $model (API Android $sdk)") -ForegroundColor Green

# ---------- 4. install, Home, open ----------
Step 4 (Tr "Installing APL Launcher on the TV…" "Installation d'APL Launcher sur la TV…")
$r = Adb @('-s', $serial, 'install', '-r', $Apk)
Write-Host "        $($r.Output.Trim())"
if ($r.Output -notmatch 'Success') {
    if ($r.Output -match 'INSTALL_FAILED_UPDATE_INCOMPATIBLE') { Fail (Tr "Another APL Launcher (signed with another key) is installed: uninstall it on the TV first." "Un autre APL Launcher (signé avec une autre clé) est installé : désinstalle-le d'abord sur la TV.") }
    Fail (Tr "The TV did not install the package: $($r.Output.Trim())" "La TV n'a pas installé le paquet : $($r.Output.Trim())")
}
if ($ModuleApk) {
    # Home opens APL Launcher: APL Launcher Home Button and its accessibility service (docs/android.md, way A), added to
    # the services already on, without the launcher's own one of 1.1.3 and before
    $r = Adb @('-s', $serial, 'install', '-r', $ModuleApk)
    Write-Host "        $($r.Output.Trim())"
    if ($r.Output -notmatch 'Success') {
        Write-Host (Tr "        APL Launcher Home Button could not be installed: Home keeps the TV's own launcher. APL Launcher shows how to get it (Settings › Android TV)." "        APL Launcher Home Button n'a pas pu être installé : Home garde le launcher de la TV. APL Launcher explique comment l'obtenir (Réglages › Android TV).") -ForegroundColor Yellow
    } else {
        $cur = (Adb @('-s', $serial, 'shell', 'settings', 'get', 'secure', 'enabled_accessibility_services')).Output.Trim()
        if ($cur -eq 'null') { $cur = '' }
        $list = @(@($cur -split ':') | Where-Object { $_ -and $_ -ne $OldService -and $_ -ne $KeyService }) + $KeyService
        Adb @('-s', $serial, 'shell', 'settings', 'put', 'secure', 'enabled_accessibility_services', ($list -join ':')) | Out-Null
        Adb @('-s', $serial, 'shell', 'settings', 'put', 'secure', 'accessibility_enabled', '1') | Out-Null
        $now = (Adb @('-s', $serial, 'shell', 'settings', 'get', 'secure', 'enabled_accessibility_services')).Output
        if ($now -match [regex]::Escape($KeyService)) { Write-Host (Tr "        Remote buttons on: Home opens APL Launcher." "        Boutons de la télécommande activés : Home ouvre APL Launcher.") -ForegroundColor Green }
        else { Write-Host (Tr "        The remote buttons service could not be turned on: APL Launcher will offer it at its first start." "        Le service des boutons n'a pas pu être activé : APL Launcher le proposera à son premier démarrage.") -ForegroundColor Yellow }
    }
    # Its Control Center over the app in front: "draw over other apps" (also in the TV's Settings › Apps › Special app access)
    Adb @('-s', $serial, 'shell', 'appops', 'set', $AppId, 'SYSTEM_ALERT_WINDOW', 'allow') | Out-Null
}
# What You're Watching: the apps' Watch Next row (Nuvio's Continue Watching…), Android 11+; else Android asks once
Adb @('-s', $serial, 'shell', 'pm', 'grant', $AppId, 'android.permission.READ_TV_LISTINGS') | Out-Null
# The API keys: the published .apk has none and can't be changed here (it is signed with APL Launcher's key), so
# they go to the app itself (KeysReceiver.kt, which only adb and the system may call). Never written to the log.
$keyArgs = @()
$given = $PSBoundParameters.ContainsKey('Tmdb') -or $PSBoundParameters.ContainsKey('YouTube') -or $PSBoundParameters.ContainsKey('Fanart')
$k = @{ tmdb = $Tmdb; youtube = $YouTube; fanart = $Fanart }
$keysSaved = Join-Path $env:APPDATA "APL-Launcher\keys.local.js"
if (-not $given -and (Test-Path -LiteralPath $keysSaved)) {
    $txt = [IO.File]::ReadAllText($keysSaved)
    foreach ($n in @('tmdb', 'youtube', 'fanart')) { $m = [regex]::Match($txt, "\b$n\s*:\s*`"([A-Za-z0-9_-]+)`""); if ($m.Success) { $k[$n] = $m.Groups[1].Value } }
}
foreach ($n in @('tmdb', 'youtube', 'fanart')) {
    $v = ("" + $k[$n]) -replace '[^A-Za-z0-9_-]', ''
    if ($v.Length -ge 8) { $keyArgs += @('--es', $n, $v) }
}
if ($keyArgs.Count) {
    $r = Adb (@('-s', $serial, 'shell', 'am', 'broadcast', '-a', 'com.knikt.apllauncher.SET_KEYS', '-n', "$AppId/.KeysReceiver") + $keyArgs)
    $n = $keyArgs.Count / 3
    if ($r.Output -match 'result=1') { Write-Host (Tr "        $n key(s) given to APL Launcher (Top Shelf)." "        $n clé(s) donnée(s) à APL Launcher (Top Shelf).") -ForegroundColor Green }
    else { Write-Host (Tr "        The keys could not be given to APL Launcher: type them on the TV, Settings › Appearance › Top Shelf › Online Services." "        Les clés n'ont pas pu être données à APL Launcher : tape-les sur la TV, Réglages › Apparence › Top Shelf › Services en ligne.") -ForegroundColor Yellow }
}

# ---------- APL TV (optional: never stops the install) ----------
if ($AplTv) {
    Step 5 (Tr "Installing APL TV…" "Installation d'APL TV…")
    try {
        $rel = Invoke-RestMethod -UseBasicParsing -Uri "https://api.github.com/repos/$AplTvRepo/releases/latest" -Headers @{ 'User-Agent' = 'APL-Launcher-Setup' } -TimeoutSec 60
        $asset = @($rel.assets) | Where-Object { $_.name -match '^apl-tv-v.*-android\.apk$' } | Select-Object -First 1
        if (-not $asset) { $asset = @($rel.assets) | Where-Object { $_.name -eq 'apl-tv-android.apk' } | Select-Object -First 1 }
        if (-not $asset) { throw (Tr "APL TV $($rel.tag_name) has no Android package" "APL TV $($rel.tag_name) n'a pas de paquet Android") }
        $tvApk = Join-Path $env:LOCALAPPDATA ("APL-Launcher\" + $asset.name)
        Invoke-WebRequest -UseBasicParsing -Uri $asset.browser_download_url -OutFile $tvApk -TimeoutSec 300
        $sums = @($rel.assets) | Where-Object { $_.name -eq 'SHA256SUMS-apk.txt' } | Select-Object -First 1
        if ($sums) {
            $txt = (Invoke-WebRequest -UseBasicParsing -Uri $sums.browser_download_url -TimeoutSec 60).Content
            if ($txt -is [byte[]]) { $txt = [Text.Encoding]::ASCII.GetString($txt) }
            $want = ([regex]::Match($txt, '([0-9a-fA-F]{64})\s+\*?' + [regex]::Escape($asset.name))).Groups[1].Value.ToLowerInvariant()
            if ($want -and $want -ne (Get-FileHash -LiteralPath $tvApk -Algorithm SHA256).Hash.ToLowerInvariant()) { throw (Tr "the download is damaged (SHA256)" "le téléchargement est abîmé (SHA256)") }
        }
        $r = Adb @('-s', $serial, 'install', '-r', $tvApk)
        if ($r.Output -notmatch 'Success') { throw $r.Output.Trim() }
        Write-Host (Tr "        APL TV installed ($($asset.name))." "        APL TV installé ($($asset.name)).") -ForegroundColor Green
    } catch {
        Write-Host (Tr "        APL TV could not be installed ($($_.Exception.Message)). APL Launcher is fine; APL TV can be installed later from its releases." "        APL TV n'a pas pu être installé ($($_.Exception.Message)). APL Launcher est bien installé ; APL TV peut s'installer plus tard depuis ses versions.") -ForegroundColor Yellow
    }
}
Adb @('-s', $serial, 'shell', 'am', 'start', '-n', "$AppId/.MainActivity") | Out-Null
Write-Host ""
Write-Host (Tr "  Done: APL Launcher is on the TV." "  Terminé : APL Launcher est sur la TV.") -ForegroundColor Green
if ($Quiet) { Send-Gui "APL-RESULT ok" }
exit 0
