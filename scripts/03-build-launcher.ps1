# 03-build-launcher.ps1 — prepares the package installed on the screen: the release's full .wgt
# (launcher + APL Overlay + bridge + start-up service, built in CI by tools/make-package.sh --overlay), with this
# PC's personal files written into it and signed with your certificate.
#
#   .\scripts\03-build-launcher.ps1 -ProfileName APLauncher
#   .\scripts\03-build-launcher.ps1 -ProfileName APLauncher -SfProDir "C:\Users\<you>\Downloads\sf-pro-display_2"
#
# The package comes from dist\apl-launcher-full-v<version>.wgt when it is there (a build of your own), else
# from the GitHub release of the version in launcher\config.xml (the latest release if that one has none),
# checked against its SHA256SUMS-wgt.txt.
# Personal files (never published) go into res\wgt\: js\keys.local.js, js\avatars.local.js, your
# avatars and Memoji, the SF Pro fonts and your sounds.
# -WebOnly: the launcher's own package instead (apl-launcher-v<version>.wgt, its files at the root, a web
# bridge), for screens where the full package's .NET apps don't run (Tizen 6.x: install.ps1 decides).
param(
    [string]$ProfileName = "APLauncher",
    [string]$TizenCli,
    [string]$LauncherDir = (Join-Path (Split-Path $PSScriptRoot -Parent) "launcher"),
    [string]$OutFile = (Join-Path (Split-Path $PSScriptRoot -Parent) "dist\APL-Launcher.wgt"),
    [string]$SfProDir,   # optional: copies the SF Pro fonts before building
    [string]$Repo = "Knikt/APL-Launcher-for-TizenOS",
    [switch]$WebOnly
)
. "$PSScriptRoot\lib.ps1"
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem

$tizen = Find-Tizen $TizenCli
$config = Join-Path $LauncherDir "config.xml"
if (-not (Test-Path -LiteralPath $config)) {
    throw (Tr "Project not found: $LauncherDir (no config.xml)." "Projet introuvable : $LauncherDir (pas de config.xml).")
}
$version = ([regex]::Match((Get-Content -LiteralPath $config -Raw), '<widget[^>]*\sversion="([^"]+)"')).Groups[1].Value
if (-not $version) { throw (Tr "No version in $config." "Pas de version dans $config.") }

# Optional copy of the SF Pro fonts (not included in the repository)
if ($SfProDir) {
    $fontsDst = Join-Path $LauncherDir "fonts"
    New-Item -ItemType Directory -Force -Path $fontsDst | Out-Null
    foreach ($f in @("SFPRODISPLAYREGULAR.OTF","SFPRODISPLAYMEDIUM.OTF","SFPRODISPLAYBOLD.OTF")) {
        $src = Join-Path $SfProDir $f
        if (Test-Path -LiteralPath $src) { Copy-Item -LiteralPath $src -Destination $fontsDst -Force; Write-Host (Tr "Font copied: $f" "Police copiée : $f") }
        else { Write-Host (Tr "Font missing (skipped): $f" "Police absente (ignorée) : $f") -ForegroundColor DarkYellow }
    }
}

# Checks that the profile exists
$profiles = (Invoke-Native $tizen @('security-profiles', 'list')).Output
if (-not ($profiles -match [regex]::Escape($ProfileName))) {
    Write-Host (Tr "Warning: '$ProfileName' is not in the list of profiles, trying anyway." "Attention : '$ProfileName' n'apparaît pas dans la liste des profils, on tente quand même.") -ForegroundColor DarkYellow
}

# ---------- the hybrid package (or the launcher's own, -WebOnly) ----------
$dist = Split-Path -Parent $OutFile
if ($dist -and -not (Test-Path -LiteralPath $dist)) { New-Item -ItemType Directory -Force -Path $dist | Out-Null }
$kind = if ($WebOnly) { "apl-launcher-v" } else { "apl-launcher-full-v" }
$name = "$kind$version.wgt"
$source = Join-Path $dist $name

# The release's package and its SHA256SUMS-wgt.txt, or $null when that release (or the asset) does not exist
function Get-FullRelease([string]$Tag) {
    $api = "https://api.github.com/repos/$Repo/releases/" + $(if ($Tag) { "tags/$Tag" } else { "latest" })
    try { $rel = Invoke-RestMethod -UseBasicParsing -Uri $api -Headers @{ 'User-Agent' = 'APL-Launcher-Setup' } -TimeoutSec 60 }
    catch {
        if ($_.Exception.Response -and [int]$_.Exception.Response.StatusCode -eq 404) { return $null }
        throw (Tr "Could not reach GitHub ($api): $($_.Exception.Message)" "GitHub injoignable ($api) : $($_.Exception.Message)")
    }
    $pkg = @($rel.assets) | Where-Object { $_.name -match ('^' + [regex]::Escape($kind) + '.+[.]wgt$') } | Select-Object -First 1
    $sum = @($rel.assets) | Where-Object { $_.name -eq 'SHA256SUMS-wgt.txt' } | Select-Object -First 1
    if (-not $pkg -or -not $sum) { return $null }
    [pscustomobject]@{ Tag = $rel.tag_name; Name = $pkg.name; Url = $pkg.browser_download_url; Sums = $sum.browser_download_url }
}

if (Test-Path -LiteralPath $source) {
    Write-Host (Tr "Package: $source (local build)" "Paquet : $source (version locale)")
} else {
    # Windows PowerShell 5.1 can default to TLS 1.0 on older Windows 10, which GitHub refuses
    try { [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12 } catch {}
    # Not every version gets a release (some only go out through the automatic update): then the latest
    # release is installed. The automatic update only replaces the web part: APL Overlay, the bridge and
    # the start-up service stay as in that release.
    $rel = Get-FullRelease "v$version"
    if (-not $rel) {
        $rel = Get-FullRelease ""
        if (-not $rel) { throw (Tr "No GitHub release of $Repo has the package ($kind*.wgt)." "Aucune version GitHub de $Repo n'a le paquet ($kind*.wgt).") }
        Write-Host (Tr "        No release v$version with the full package: installing the latest release, $($rel.Tag). The launcher updates itself afterwards, APL Overlay stays at $($rel.Tag) until the next install." "        Pas de version v$version avec le paquet complet : installation de la dernière version, $($rel.Tag). Le launcher se met à jour ensuite, APL Overlay reste en $($rel.Tag) jusqu'à la prochaine installation.") -ForegroundColor DarkYellow
    }
    $name = $rel.Name
    $source = Join-Path $dist $name
    Write-Title (Tr "Downloading $name (release $($rel.Tag))" "Téléchargement de $name (version $($rel.Tag))")
    $ProgressPreference = 'SilentlyContinue'
    # Under another name until it is checked: a file with the final name counts as a good package
    $part = "$source.part"
    try {
        Invoke-WebRequest -UseBasicParsing -Uri $rel.Url -OutFile $part -TimeoutSec 300
        $sums = (Invoke-WebRequest -UseBasicParsing -Uri $rel.Sums -TimeoutSec 60).Content
    } catch {
        Remove-Item -LiteralPath $part -Force -ErrorAction SilentlyContinue
        throw (Tr "Could not download $($rel.Url) ($($_.Exception.Message))." "Téléchargement impossible : $($rel.Url) ($($_.Exception.Message)).")
    }
    if ($sums -is [byte[]]) { $sums = [Text.Encoding]::UTF8.GetString($sums) }
    $want = ([regex]::Match([string]$sums, "(?m)^([0-9a-f]{64})\s+\*?$([regex]::Escape($name))\s*$")).Groups[1].Value
    $got = (Get-FileHash -LiteralPath $part -Algorithm SHA256).Hash.ToLowerInvariant()
    if (-not $want -or $want -ne $got) {
        Remove-Item -LiteralPath $part -Force -ErrorAction SilentlyContinue
        throw (Tr "$name does not match the release's SHA256SUMS-wgt.txt. Run the installation again." "$name ne correspond pas au SHA256SUMS-wgt.txt de la version. Relance l'installation.")
    }
    Move-Item -LiteralPath $part -Destination $source -Force
    Write-Host (Tr "        Downloaded and checked." "        Téléchargé et vérifié.") -ForegroundColor Green
}

# ---------- personal files, then a fresh signature ----------
Write-Title (Tr "Building the .wgt package (profile '$ProfileName')" "Compilation du paquet .wgt (profil '$ProfileName')")
$work = Join-Path $dist "package"
if (Test-Path -LiteralPath $work) { Remove-Item -LiteralPath $work -Recurse -Force }
[IO.Compression.ZipFile]::ExtractToDirectory($source, $work)
# The CI's signature (Tizen SDK default certificate) goes: the package is signed again with yours
Get-ChildItem -LiteralPath $work -Filter "*signature*.xml" | Remove-Item -Force
$web = if ($WebOnly) { $work } else { Join-Path $work "res\wgt" }   # where the launcher's files are
if (-not (Test-Path -LiteralPath (Join-Path $web "config.xml"))) { throw (Tr "$name has no launcher in it (no config.xml where expected)." "$name ne contient pas de launcher (pas de config.xml à l'endroit attendu).") }
$personal = @("js\keys.local.js", "js\avatars.local.js")
foreach ($p in $personal) {
    $src = Join-Path $LauncherDir $p
    if (Test-Path -LiteralPath $src) { Copy-Item -LiteralPath $src -Destination (Join-Path $web $p) -Force }
}
foreach ($d in @("images\avatars\custom", "images\avatars\memoji")) {
    $src = Join-Path $LauncherDir $d
    if (Test-Path -LiteralPath $src) {
        New-Item -ItemType Directory -Force -Path (Join-Path $web $d) | Out-Null
        Get-ChildItem -LiteralPath $src -Force | Copy-Item -Destination (Join-Path $web $d) -Recurse -Force
    }
}
foreach ($pair in @(@("fonts", "*.otf"), @("fonts", "*.ttf"), @("sounds", "*.wav"))) {
    $src = Join-Path $LauncherDir $pair[0]
    if (Test-Path -LiteralPath $src) {
        New-Item -ItemType Directory -Force -Path (Join-Path $web $pair[0]) | Out-Null
        Get-ChildItem -LiteralPath $src -Filter $pair[1] -File | Copy-Item -Destination (Join-Path $web $pair[0]) -Force
    }
}
$unsigned = Join-Path $dist "apl-launcher-unsigned.wgt"
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

Write-Host (Tr "(If nothing moves for 2 minutes, close the window and try again.)" "(Si plus rien ne bouge pendant 2 minutes, ferme la fenêtre et réessaie.)") -ForegroundColor DarkGray
# Signing an existing package: the CLI writes the signed copy into -o
$signed = Join-Path $dist "signed"
if (Test-Path -LiteralPath $signed) { Remove-Item -LiteralPath $signed -Recurse -Force }
New-Item -ItemType Directory -Force -Path $signed | Out-Null
$r = Invoke-Native $tizen @('package', '-t', 'wgt', '-s', $ProfileName, '-o', $signed, '--', $unsigned)
Write-Host $r.Output
if ($r.ExitCode -ne 0 -or $r.Output -match 'fail|not exist|Invalid') { throw (Tr "Signing failed. Tizen's message: $($r.Output)" "La signature a échoué. Message de Tizen : $($r.Output)") }
$wgt = Get-ChildItem -LiteralPath $signed -Filter *.wgt | Select-Object -First 1
if (-not $wgt) { $wgt = Get-Item -LiteralPath $unsigned }   # some CLI versions sign the file in place
$zip = [IO.Compression.ZipFile]::OpenRead($wgt.FullName)
try { $hasSig = [bool]($zip.Entries | Where-Object { $_.FullName -eq "author-signature.xml" }) } finally { $zip.Dispose() }
if (-not $hasSig) { throw (Tr "The package was not signed (no author-signature.xml). Tizen's message: $($r.Output)" "Le paquet n'a pas été signé (pas d'author-signature.xml). Message de Tizen : $($r.Output)") }
Copy-Item -LiteralPath $wgt.FullName -Destination $OutFile -Force
Remove-Item -LiteralPath $signed -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $unsigned -Force -ErrorAction SilentlyContinue

Write-Host ""
Write-Host (Tr "Package ready: $OutFile ($([math]::Round((Get-Item -LiteralPath $OutFile).Length/1KB)) KB)" "Paquet prêt : $OutFile ($([math]::Round((Get-Item -LiteralPath $OutFile).Length/1KB)) Ko)") -ForegroundColor Green
Write-Host (Tr "Install it with: .\scripts\04-install-launcher.ps1 -TvIp 192.168.1.50" "Installez-le avec : .\scripts\04-install-launcher.ps1 -TvIp 192.168.1.50")
