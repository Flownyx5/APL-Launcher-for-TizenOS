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
# bridge), for screens where the full package's .NET apps don't run (before Tizen 6, or a Tizen 6 whose
# version can't be told: install.ps1 decides).
# -Tizen6 6.0 | 6.5: the two packages made for that Tizen 6 version (tools/make-tizen6.py): the launcher with its
# .NET bridge and start-up service but without APL Overlay (apl-launcher-tizen6X-v<version>.wgt, filled in like
# the full package), and APL Overlay alone (apl-overlay-tizen6X-v<version>.tpk, apl.launcher.overlay), signed
# into -OverlayFile. With no release having them yet (before 1.1.0), the launcher alone, as -WebOnly. If APL
# Overlay can't be signed, there is no -OverlayFile: the launcher is installed on its own.
# This fork (Flownyx5) publishes no release: its launcher is the one in this folder.
#   -WebOnly: the package is built from launcher\ as it is (the web bridge included), nothing downloaded.
#   Full package and Tizen 6 pair: the original's release keeps its .NET part (APL Overlay, .NET bridge,
#   start-up service), and its web part (res\wgt\) is replaced by launcher\.
#   -FromRelease: the release's packages as they are, as in the original project.
param(
    [string]$ProfileName = "APLauncher",
    [string]$TizenCli,
    [string]$LauncherDir = (Join-Path (Split-Path $PSScriptRoot -Parent) "launcher"),
    [string]$OutFile = (Join-Path (Split-Path $PSScriptRoot -Parent) "dist\APL-Launcher.wgt"),
    [string]$OverlayFile = (Join-Path (Split-Path $PSScriptRoot -Parent) "dist\APL-Overlay.tpk"),
    [string]$SfProDir,   # optional: copies the SF Pro fonts before building
    [string]$Repo = "Knikt/APL-Launcher",
    [switch]$WebOnly,
    [string]$Tizen6 = "",   # '6.0' or '6.5'
    [switch]$FromRelease
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
if ($Tizen6 -and $Tizen6 -notin @('6.0', '6.5')) { throw (Tr "-Tizen6 is 6.0 or 6.5, not '$Tizen6'." "-Tizen6 vaut 6.0 ou 6.5, pas « $Tizen6 ».") }

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

# ---------- the hybrid package (the launcher's own with -WebOnly, Tizen 6's pair with -Tizen6) ----------
$dist = Split-Path -Parent $OutFile
if ($dist -and -not (Test-Path -LiteralPath $dist)) { New-Item -ItemType Directory -Force -Path $dist | Out-Null }
# An APL Overlay signed by an earlier run must not go with this launcher
if (Test-Path -LiteralPath $OverlayFile) { Remove-Item -LiteralPath $OverlayFile -Force }

# The files this install needs: <Prefix><version>.<Ext>, the launcher's package first
function Get-Wanted {
    if ($Tizen6) {
        $t = "tizen" + ($Tizen6 -replace '\.', '')
        return @([pscustomobject]@{ Prefix = "apl-launcher-$t-v"; Ext = "wgt" }, [pscustomobject]@{ Prefix = "apl-overlay-$t-v"; Ext = "tpk" })
    }
    $kind = if ($WebOnly) { "apl-launcher-v" } else { "apl-launcher-full-v" }
    return @([pscustomobject]@{ Prefix = $kind; Ext = "wgt" })
}

# The release's files and its SHA256SUMS-wgt.txt, or $null when that release (or one of the files) does not exist
function Get-Release([string]$Tag, $Wanted) {
    $api = "https://api.github.com/repos/$Repo/releases/" + $(if ($Tag) { "tags/$Tag" } else { "latest" })
    try { $rel = Invoke-RestMethod -UseBasicParsing -Uri $api -Headers @{ 'User-Agent' = 'APL-Launcher-Setup' } -TimeoutSec 60 }
    catch {
        if ($_.Exception.Response -and [int]$_.Exception.Response.StatusCode -eq 404) { return $null }
        throw (Tr "Could not reach GitHub ($api): $($_.Exception.Message)" "GitHub injoignable ($api) : $($_.Exception.Message)")
    }
    $files = @()
    foreach ($w in $Wanted) {
        $asset = @($rel.assets) | Where-Object { $_.name -match ('^' + [regex]::Escape($w.Prefix) + '.+[.]' + $w.Ext + '$') } | Select-Object -First 1
        if (-not $asset) { return $null }
        $files += [pscustomobject]@{ Name = $asset.name; Url = $asset.browser_download_url }
    }
    $sum = @($rel.assets) | Where-Object { $_.name -eq 'SHA256SUMS-wgt.txt' } | Select-Object -First 1
    if (-not $sum) { return $null }
    [pscustomobject]@{ Tag = $rel.tag_name; Files = $files; Sums = $sum.browser_download_url }
}

# Files of launcher\ that never go into a package (as in tools/make-package.sh)
function Copy-LocalLauncher([string]$To, [string[]]$Skip) {
    $rootLength = (Get-Item -LiteralPath $LauncherDir).FullName.TrimEnd('\').Length + 1
    Get-ChildItem -LiteralPath $LauncherDir -Recurse -Force -File | ForEach-Object {
        $relPath = $_.FullName.Substring($rootLength)
        $top = ($relPath -split '[\\/]')[0]
        if ($Skip -contains $relPath -or $Skip -contains $top) { return }
        if ($_.Name -like '*.wgt' -or $_.Name -in @('.manifest.tmp', 'author-signature.xml', 'signature1.xml', '.DS_Store', 'Thumbs.db', 'keys.example.js')) { return }
        $dst = Join-Path $To $relPath
        $dir = Split-Path -Parent $dst
        if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
        Copy-Item -LiteralPath $_.FullName -Destination $dst -Force
    }
    # No keys of your own yet: the empty template, as in the release (the launcher loads js\keys.local.js)
    $keys = Join-Path $To "js\keys.local.js"
    if (-not (Test-Path -LiteralPath $keys)) { Copy-Item -LiteralPath (Join-Path $LauncherDir "js\keys.example.js") -Destination $keys -Force }
}

# The launcher of this folder, nothing downloaded: what is installed is exactly what is here
$fromFolder = $WebOnly -and -not $FromRelease -and -not $Tizen6
$sources = $null
if ($fromFolder) {
    Write-Host (Tr "Package: the launcher of this folder ($version)" "Paquet : le launcher de ce dossier ($version)")
    $sources = @(Join-Path $dist "apl-launcher-v$version.wgt")
}
while (-not $sources) {
    $wanted = @(Get-Wanted)
    $local = @($wanted | ForEach-Object { Join-Path $dist "$($_.Prefix)$version.$($_.Ext)" })
    if (-not @($local | Where-Object { -not (Test-Path -LiteralPath $_) }).Count) {
        foreach ($f in $local) { Write-Host (Tr "Package: $f (local build)" "Paquet : $f (version locale)") }
        $sources = $local
        break
    }
    # Windows PowerShell 5.1 can default to TLS 1.0 on older Windows 10, which GitHub refuses
    try { [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12 } catch {}
    # Not every version gets a release (some only go out through the automatic update): then the latest
    # release is installed. The automatic update only replaces the web part: APL Overlay, the bridge and
    # the start-up service stay as in that release.
    $rel = Get-Release "v$version" $wanted
    if (-not $rel) {
        $rel = Get-Release "" $wanted
        if ($rel) { Write-Host (Tr "        No release v$version with the full package: installing the latest release, $($rel.Tag). The launcher updates itself afterwards, APL Overlay stays at $($rel.Tag) until the next install." "        Pas de version v$version avec le paquet complet : installation de la dernière version, $($rel.Tag). Le launcher se met à jour ensuite, APL Overlay reste en $($rel.Tag) jusqu'à la prochaine installation.") -ForegroundColor DarkYellow }
    }
    if (-not $rel) {
        if ($Tizen6) {
            # The Tizen 6 pair comes with 1.1.0: before it, the launcher alone, as Setup always installed it there
            Write-Host (Tr "        No release has the packages for Tizen $Tizen6 yet: the launcher is installed on its own." "        Aucune version n'a encore les paquets pour Tizen $Tizen6 : le launcher est installé seul.") -ForegroundColor DarkYellow
            $Tizen6 = ""; $WebOnly = $true
            continue
        }
        throw (Tr "No GitHub release of $Repo has the package ($($wanted[0].Prefix)*.wgt)." "Aucune version GitHub de $Repo n'a le paquet ($($wanted[0].Prefix)*.wgt).")
    }
    $ProgressPreference = 'SilentlyContinue'
    try { $sums = (Invoke-WebRequest -UseBasicParsing -Uri $rel.Sums -TimeoutSec 60).Content }
    catch { throw (Tr "Could not download $($rel.Sums) ($($_.Exception.Message))." "Téléchargement impossible : $($rel.Sums) ($($_.Exception.Message)).") }
    if ($sums -is [byte[]]) { $sums = [Text.Encoding]::UTF8.GetString($sums) }
    $got = @()
    foreach ($file in $rel.Files) {
        $name = $file.Name
        $source = Join-Path $dist $name
        Write-Title (Tr "Downloading $name (release $($rel.Tag))" "Téléchargement de $name (version $($rel.Tag))")
        # Under another name until it is checked: a file with the final name counts as a good package
        $part = "$source.part"
        try { Invoke-WebRequest -UseBasicParsing -Uri $file.Url -OutFile $part -TimeoutSec 300 }
        catch {
            Remove-Item -LiteralPath $part -Force -ErrorAction SilentlyContinue
            throw (Tr "Could not download $($file.Url) ($($_.Exception.Message))." "Téléchargement impossible : $($file.Url) ($($_.Exception.Message)).")
        }
        $want = ([regex]::Match([string]$sums, "(?m)^([0-9a-f]{64})\s+\*?$([regex]::Escape($name))\s*$")).Groups[1].Value
        $hash = (Get-FileHash -LiteralPath $part -Algorithm SHA256).Hash.ToLowerInvariant()
        if (-not $want -or $want -ne $hash) {
            Remove-Item -LiteralPath $part -Force -ErrorAction SilentlyContinue
            throw (Tr "$name does not match the release's SHA256SUMS-wgt.txt. Run the installation again." "$name ne correspond pas au SHA256SUMS-wgt.txt de la version. Relance l'installation.")
        }
        Move-Item -LiteralPath $part -Destination $source -Force
        Write-Host (Tr "        Downloaded and checked." "        Téléchargé et vérifié.") -ForegroundColor Green
        $got += $source
    }
    $sources = $got
}
$source = $sources[0]
$name = Split-Path -Leaf $source

# ---------- personal files, then a fresh signature ----------
Write-Title (Tr "Building the .wgt package (profile '$ProfileName')" "Compilation du paquet .wgt (profil '$ProfileName')")
$work = Join-Path $dist "package"
if (Test-Path -LiteralPath $work) { Remove-Item -LiteralPath $work -Recurse -Force }
$web = if ($WebOnly) { $work } else { Join-Path $work "res\wgt" }   # where the launcher's files are (also on Tizen 6)
if ($fromFolder) {
    New-Item -ItemType Directory -Force -Path $work | Out-Null
    Copy-LocalLauncher $work @()
} else {
    [IO.Compression.ZipFile]::ExtractToDirectory($source, $work)
    # The CI's signature (Tizen SDK default certificate) goes: the package is signed again with yours
    Get-ChildItem -LiteralPath $work -Filter "*signature*.xml" | Remove-Item -Force
}
if (-not (Test-Path -LiteralPath (Join-Path $web "config.xml"))) { throw (Tr "$name has no launcher in it (no config.xml where expected)." "$name ne contient pas de launcher (pas de config.xml à l'endroit attendu).") }
if (-not $fromFolder -and -not $FromRelease) {
    # The release's web part is replaced by this folder's launcher. Its config.xml stays (the .NET bridge
    # takes the web bridge's id there), with this folder's version.
    $cfg = Join-Path $web "config.xml"
    $keep = Get-Content -LiteralPath $cfg -Raw -Encoding UTF8
    Get-ChildItem -LiteralPath $web -Force | Where-Object { $_.Name -ne "config.xml" } | Remove-Item -Recurse -Force
    Copy-LocalLauncher $web @("config.xml", "bridge")
    $keep = ([regex]'(<widget[^>]*\sversion=")[^"]+(")').Replace($keep, ('${1}' + $version + '${2}'), 1)
    [IO.File]::WriteAllText($cfg, $keep, (New-Object Text.UTF8Encoding($false)))
    Write-Host (Tr "        Launcher $version from this folder, its .NET part from $name." "        Launcher $version de ce dossier, sa partie .NET de $name.") -ForegroundColor Green
}
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

# ---------- Tizen 6: APL Overlay's own package, signed with the same certificate ----------
if ($Tizen6) {
    Write-Title (Tr "Signing APL Overlay for Tizen $Tizen6 (profile '$ProfileName')" "Signature d'APL Overlay pour Tizen $Tizen6 (profil '$ProfileName')")
    $tpk = Join-Path $dist "apl-overlay-signing.tpk"
    try {
        Copy-Item -LiteralPath $sources[1] -Destination $tpk -Force
        # Any signature in it goes (the release's has none): it is signed for this screen
        $zip = [IO.Compression.ZipFile]::OpenRead($tpk)
        try { $hadSig = [bool]($zip.Entries | Where-Object { $_.FullName -match '^(author-)?signature\d*\.xml$' }) } finally { $zip.Dispose() }
        if ($hadSig) {
            $zip = [IO.Compression.ZipFile]::Open($tpk, 'Update')
            try { @($zip.Entries | Where-Object { $_.FullName -match '^(author-)?signature\d*\.xml$' }) | ForEach-Object { $_.Delete() } } finally { $zip.Dispose() }
        }
        # Signed in place, as APL Launcher Setup signed APL Overlay's package before 1.0.10
        $r = Invoke-Native $tizen @('package', '--type', 'tpk', '--sign', $ProfileName, '--', $tpk)
        Write-Host $r.Output
        if ($r.ExitCode -ne 0 -or $r.Output -match 'fail|not exist|Invalid') { throw (Tr "Tizen's message: $($r.Output)" "message de Tizen : $($r.Output)") }
        $zip = [IO.Compression.ZipFile]::OpenRead($tpk)
        try { $hasSig = [bool]($zip.Entries | Where-Object { $_.FullName -eq "author-signature.xml" }) } finally { $zip.Dispose() }
        if (-not $hasSig) { throw (Tr "no author-signature.xml in it. Tizen's message: $($r.Output)" "pas d'author-signature.xml dedans. Message de Tizen : $($r.Output)") }
        Move-Item -LiteralPath $tpk -Destination $OverlayFile -Force
        Write-Host (Tr "APL Overlay ready: $OverlayFile ($([math]::Round((Get-Item -LiteralPath $OverlayFile).Length/1KB)) KB)" "APL Overlay prêt : $OverlayFile ($([math]::Round((Get-Item -LiteralPath $OverlayFile).Length/1KB)) Ko)") -ForegroundColor Green
    } catch {
        Remove-Item -LiteralPath $tpk -Force -ErrorAction SilentlyContinue
        Write-Host ((Tr "APL Overlay could not be signed, the launcher is installed on its own: " "APL Overlay n'a pas pu être signé, le launcher est installé seul : ") + $_.Exception.Message) -ForegroundColor DarkYellow
    }
}

Write-Host ""
Write-Host (Tr "Package ready: $OutFile ($([math]::Round((Get-Item -LiteralPath $OutFile).Length/1KB)) KB)" "Paquet prêt : $OutFile ($([math]::Round((Get-Item -LiteralPath $OutFile).Length/1KB)) Ko)") -ForegroundColor Green
Write-Host (Tr "Install it with: .\scripts\04-install-launcher.ps1 -TvIp 192.168.1.50" "Installez-le avec : .\scripts\04-install-launcher.ps1 -TvIp 192.168.1.50")
