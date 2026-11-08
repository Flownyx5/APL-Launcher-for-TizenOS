# 06-install-apltv.ps1 — installs APL TV, the IPTV player in APL Launcher's style (your own M3U playlists and
# Xtream accounts), on the screen. Asked for by APL Launcher Setup ("Also install APL TV"), or on its own:
#
#   .\scripts\06-install-apltv.ps1 -TvIp 192.168.1.50 -ProfileName APLPartner
#   .\scripts\06-install-apltv.ps1 -TvIp 192.168.1.50 -ProfileName APLPartner -Wgt C:\path\apl-tv-v1.0.0.wgt
#
# The package is the latest GitHub release of APL TV (apl-tv-v<version>.wgt, built in CI by its
# tools/make-package.sh), checked against the release's SHA256SUMS-wgt.txt; -Wgt takes a package of your own.
# Personal files (never published) go into it: your TMDB key (the one saved for the launcher, in
# launcher\js\keys.local.js), and the launcher's SF Pro fonts and sounds. Then it is signed with your
# certificate and installed through Vetro (or the developer mode). Your playlists and settings stay on the
# screen: installing again only updates the app.
param(
    [Parameter(Mandatory = $true)][string]$TvIp,
    [string]$ProfileName = "APLPartner",
    [string]$TizenCli,
    [string]$Sdb,
    [string]$Wgt,
    [string]$Repo = "Knikt/APL-TV-for-TizenOS",
    [string]$LauncherDir = (Join-Path (Split-Path $PSScriptRoot -Parent) "launcher"),
    [switch]$NoLaunch
)
. "$PSScriptRoot\lib.ps1"
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem

$AppId = "APLTVMedia.TV"
$tizen = Find-Tizen $TizenCli
$dist = Join-Path (Split-Path $PSScriptRoot -Parent) "dist"
New-Item -ItemType Directory -Force -Path $dist | Out-Null

# ---------- the package ----------
if ($Wgt) {
    if (-not (Test-Path -LiteralPath $Wgt)) { throw (Tr "Package not found: $Wgt" "Paquet introuvable : $Wgt") }
    $source = (Get-Item -LiteralPath $Wgt).FullName
    Write-Host (Tr "        Package: $source (your own)" "        Paquet : $source (le tien)")
} else {
    try { [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12 } catch {}
    $api = "https://api.github.com/repos/$Repo/releases/latest"
    try { $rel = Invoke-RestMethod -UseBasicParsing -Uri $api -Headers @{ 'User-Agent' = 'APL-Launcher-Setup' } -TimeoutSec 60 }
    catch {
        if ($_.Exception.Response -and [int]$_.Exception.Response.StatusCode -eq 404) { throw (Tr "APL TV has no release on GitHub yet ($Repo)." "APL TV n'a pas encore de version sur GitHub ($Repo).") }
        throw (Tr "Could not reach GitHub ($api): $($_.Exception.Message)" "GitHub injoignable ($api) : $($_.Exception.Message)")
    }
    $pkg = @($rel.assets) | Where-Object { $_.name -match '^apl-tv-v[0-9][0-9A-Za-z.\-]*[.]wgt$' } | Select-Object -First 1
    $sum = @($rel.assets) | Where-Object { $_.name -eq 'SHA256SUMS-wgt.txt' } | Select-Object -First 1
    if (-not $pkg -or -not $sum) { throw (Tr "The release $($rel.tag_name) of $Repo has no APL TV package." "La version $($rel.tag_name) de $Repo n'a pas de paquet APL TV.") }
    $source = Join-Path $dist $pkg.name
    Write-Title (Tr "Downloading $($pkg.name) (release $($rel.tag_name))" "Téléchargement de $($pkg.name) (version $($rel.tag_name))")
    $ProgressPreference = 'SilentlyContinue'
    # Under another name until it is checked: a file with the final name counts as a good package
    $part = "$source.part"
    try {
        Invoke-WebRequest -UseBasicParsing -Uri $pkg.browser_download_url -OutFile $part -TimeoutSec 300
        $sums = (Invoke-WebRequest -UseBasicParsing -Uri $sum.browser_download_url -TimeoutSec 60).Content
    } catch {
        Remove-Item -LiteralPath $part -Force -ErrorAction SilentlyContinue
        throw (Tr "Could not download $($pkg.browser_download_url) ($($_.Exception.Message))." "Téléchargement impossible : $($pkg.browser_download_url) ($($_.Exception.Message)).")
    }
    if ($sums -is [byte[]]) { $sums = [Text.Encoding]::UTF8.GetString($sums) }
    $want = ([regex]::Match([string]$sums, "(?m)^([0-9a-f]{64})\s+\*?$([regex]::Escape($pkg.name))\s*$")).Groups[1].Value
    $got = (Get-FileHash -LiteralPath $part -Algorithm SHA256).Hash.ToLowerInvariant()
    if (-not $want -or $want -ne $got) {
        Remove-Item -LiteralPath $part -Force -ErrorAction SilentlyContinue
        throw (Tr "$($pkg.name) does not match the release's SHA256SUMS-wgt.txt. Run the installation again." "$($pkg.name) ne correspond pas au SHA256SUMS-wgt.txt de la version. Relance l'installation.")
    }
    Move-Item -LiteralPath $part -Destination $source -Force
    Write-Host (Tr "        Downloaded and checked." "        Téléchargé et vérifié.") -ForegroundColor Green
}

# ---------- personal files, then a fresh signature ----------
Write-Title (Tr "Building APL TV (profile '$ProfileName')" "Compilation d'APL TV (profil '$ProfileName')")
$work = Join-Path $dist "apltv-package"
if (Test-Path -LiteralPath $work) { Remove-Item -LiteralPath $work -Recurse -Force }
[IO.Compression.ZipFile]::ExtractToDirectory($source, $work)
Get-ChildItem -LiteralPath $work -Filter "*signature*.xml" | Remove-Item -Force
$config = Join-Path $work "config.xml"
$configText = if (Test-Path -LiteralPath $config) { [IO.File]::ReadAllText($config) } else { "" }
if ($configText -notmatch ('id="' + [regex]::Escape($AppId) + '"')) { throw (Tr "$source is not an APL TV package (no $AppId in its config.xml)." "$source n'est pas un paquet APL TV (pas de $AppId dans son config.xml).") }
$version = ([regex]::Match($configText, '<widget[^>]*\sversion="([^"]+)"')).Groups[1].Value

# The TMDB key saved for the launcher (posters, summaries, cast). Without one, APL TV asks for it in Settings.
$keys = Join-Path $work "js\keys.local.js"
$tmdb = ""
$launcherKeys = Join-Path $LauncherDir "js\keys.local.js"
if (-not (Test-Path -LiteralPath $launcherKeys)) { $launcherKeys = Join-Path $env:APPDATA "APL-Launcher\keys.local.js" }
if (Test-Path -LiteralPath $launcherKeys) {
    $tmdb = ([regex]::Match([IO.File]::ReadAllText($launcherKeys), 'tmdb\s*:\s*"([A-Za-z0-9]*)"')).Groups[1].Value
}
$keysText = if (Test-Path -LiteralPath $keys) { [IO.File]::ReadAllText($keys) } else { "" }
if ($keysText -match '(?m)^\s*tmdb:\s*"[^"]*",?\s*$') { $keysText = [regex]::Replace($keysText, '(?m)^(\s*tmdb:\s*)"[^"]*"', ('$1"' + $tmdb + '"')) }
else { $keysText = "window.TV_KEYS = {`n    tmdb: `"$tmdb`",`n};`n" }
[IO.File]::WriteAllText($keys, $keysText, (New-Object Text.UTF8Encoding($false)))
if ($tmdb) { Write-Host (Tr "        TMDB key added (the launcher's)." "        Clé TMDB ajoutée (celle du launcher).") -ForegroundColor Green }
else { Write-Host (Tr "        No TMDB key on this PC: APL TV asks for it in Settings." "        Pas de clé TMDB sur ce PC : APL TV la demande dans ses Réglages.") -ForegroundColor DarkYellow }

# The launcher's SF Pro fonts and sounds, so both look and sound the same (never published)
foreach ($pair in @(@("fonts", "*.otf"), @("fonts", "*.ttf"), @("sounds", "*.wav"))) {
    $src = Join-Path $LauncherDir $pair[0]
    if (-not (Test-Path -LiteralPath $src)) { continue }
    $files = @(Get-ChildItem -LiteralPath $src -Filter $pair[1] -File)
    if (-not $files.Count) { continue }
    New-Item -ItemType Directory -Force -Path (Join-Path $work $pair[0]) | Out-Null
    $files | Copy-Item -Destination (Join-Path $work $pair[0]) -Force
}

$unsigned = Join-Path $dist "apl-tv-unsigned.wgt"
if (Test-Path -LiteralPath $unsigned) { Remove-Item -LiteralPath $unsigned -Force }
# Entries written by hand: the screen needs "/" in the paths, whatever this Windows' .NET would write
$rootLength = (Get-Item -LiteralPath $work).FullName.TrimEnd('\').Length + 1
$zip = [IO.Compression.ZipFile]::Open($unsigned, 'Create')
try {
    Get-ChildItem -LiteralPath $work -Recurse -Force | ForEach-Object {
        $entry = $_.FullName.Substring($rootLength).Replace('\', '/')
        if ($_.PSIsContainer) { $zip.CreateEntry("$entry/") | Out-Null }
        else { [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $_.FullName, $entry, 'Optimal') | Out-Null }
    }
} finally { $zip.Dispose() }
Remove-Item -LiteralPath $work -Recurse -Force

$signed = Join-Path $dist "apltv-signed"
if (Test-Path -LiteralPath $signed) { Remove-Item -LiteralPath $signed -Recurse -Force }
New-Item -ItemType Directory -Force -Path $signed | Out-Null
$r = Invoke-Native $tizen @('package', '-t', 'wgt', '-s', $ProfileName, '-o', $signed, '--', $unsigned)
Write-Host $r.Output
if ($r.ExitCode -ne 0 -or $r.Output -match 'fail|not exist|Invalid') { throw (Tr "Signing failed. Tizen's message: $($r.Output)" "La signature a échoué. Message de Tizen : $($r.Output)") }
$out = Get-ChildItem -LiteralPath $signed -Filter *.wgt | Select-Object -First 1
if (-not $out) { $out = Get-Item -LiteralPath $unsigned }   # some CLI versions sign the file in place
$zip = [IO.Compression.ZipFile]::OpenRead($out.FullName)
try { $hasSig = [bool]($zip.Entries | Where-Object { $_.FullName -eq "author-signature.xml" }) } finally { $zip.Dispose() }
if (-not $hasSig) { throw (Tr "APL TV was not signed (no author-signature.xml). Tizen's message: $($r.Output)" "APL TV n'a pas été signé (pas d'author-signature.xml). Message de Tizen : $($r.Output)") }
$final = Join-Path $dist "APL-TV.wgt"
Copy-Item -LiteralPath $out.FullName -Destination $final -Force
Remove-Item -LiteralPath $signed -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $unsigned -Force -ErrorAction SilentlyContinue
Write-Host (Tr "        APL TV $version ready ($([math]::Round((Get-Item -LiteralPath $final).Length/1KB)) KB)." "        APL TV $version prêt ($([math]::Round((Get-Item -LiteralPath $final).Length/1KB)) Ko).") -ForegroundColor Green

# ---------- installation ----------
Write-Title (Tr "Installing APL TV on the screen $TvIp" "Installation d'APL TV sur l'écran $TvIp")
try {
    if (Test-Vetro $TvIp) { Install-ViaVetro -Ip $TvIp -Wgt $final -AppId $AppId -Name "APL TV" -NoLaunch:$NoLaunch }
    else { & "$PSScriptRoot\04-install-launcher.ps1" -TvIp $TvIp -Wgt $final -AppId $AppId -Sdb $Sdb -TizenCli $tizen -NoLaunch:$NoLaunch }
} catch {
    # The screen refuses an update signed with another certificate than the APL TV already on it
    throw ($_.Exception.Message + (Tr "`n  If APL TV was installed before with another certificate, uninstall it from the screen first (its playlists go with it), then try again." "`n  Si APL TV a été installé avant avec un autre certificat, désinstalle-le d'abord de l'écran (ses playlists partent avec), puis réessaie."))
}
