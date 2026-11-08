# ============================================================
#  install.ps1 — ALL IN ONE. Started by APL Launcher Setup; also runs on its own in PowerShell.
#  1. finds Tizen Studio and sdb on the PC
#  2. saves the TMDB (and YouTube) key if you have one
#  3. finds your Samsung certificate
#  4. builds the launcher
#  5. installs the launcher and APL Overlay on the screen (through Vetro), and opens the launcher;
#     with -AplTv (or a yes), APL TV too, the IPTV player in the launcher's style
#  Nothing else is installed.
# ============================================================
param(
    [string]$TvIp,
    [string]$Tmdb, [string]$YouTube, [string]$Fanart,
    [string]$Sites,       # websites as apps: JSON [{"name":"…","url":"https://…"}], or that JSON in base64
    [switch]$AplTv,       # also installs APL TV, the IPTV player (06-install-apltv.ps1)
    [switch]$Unattended,  # started by APL Launcher Setup: no questions
    [switch]$CheckOnly    # only says what this PC has (APL-CHECK); changes nothing
)
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\lib.ps1"
$Root = Split-Path $PSScriptRoot -Parent
$Quiet = $Unattended -or $CheckOnly

function Step([int]$n, [string]$txt) {
    Write-Host ""
    Write-Host "  [$n/5] $txt" -ForegroundColor Cyan
    Send-Gui "APL-STEP $n 5 $txt"
}
function Ask([string]$question, [string]$default) {
    if ($Quiet) { return $default }
    $q = if ($default) { "$question [$default]" } else { $question }
    $a = Read-Host "        $q"
    if ([string]::IsNullOrWhiteSpace($a)) { return $default } else { return $a.Trim() }
}
function Fail([string]$msg) {
    Write-Host ""
    Write-Host (Tr "  PROBLEM: $msg" "  PROBLÈME : $msg") -ForegroundColor Red
    if ($Quiet) { Send-Gui ("APL-RESULT fail " + ($msg -replace '\s*\r?\n\s*', ' ')); exit 1 }
    Write-Host ""
    Read-Host (Tr "  Press Enter to close" "  Appuie sur Entrée pour fermer")
    exit 1
}

if (-not $Quiet) { Clear-Host }
Write-Host ""
Write-Host "  ==============================================" -ForegroundColor White
Write-Host (Tr "        APL Launcher - install on the screen" "        APL Launcher - installation sur l'écran") -ForegroundColor White
Write-Host (Tr "        (installer version 23)" "        (installateur version 23)") -ForegroundColor DarkGray
Write-Host "  ==============================================" -ForegroundColor White
Write-Host (Tr "  The screen must be on, on the same Wi-Fi as this PC." "  L'écran doit être allumé, sur le même Wi-Fi que ce PC.")

# ---------- 1. tools ----------
Step 1 (Tr "Looking for Tizen Studio on the PC…" "Recherche de Tizen Studio sur le PC…")
function Search-Tool([string]$name) {
    $found = Find-Tool -Explicit $null -Name $name -Candidates @()
    if ($found) { return $found }
    $roots = @("$env:USERPROFILE\tizen-studio", "C:\tizen-studio", "$env:LOCALAPPDATA\Tizen",
               "$env:USERPROFILE\Documents", "$env:USERPROFILE\Downloads")
    foreach ($r in $roots) {
        if (-not (Test-Path $r)) { continue }
        $hit = Get-ChildItem -LiteralPath $r -Recurse -Filter $name -ErrorAction SilentlyContinue -Depth 9 | Select-Object -First 1
        if ($hit) { return $hit.FullName }
    }
    return $null
}
$tizen = Search-Tool 'tizen.bat'
$sdb = Search-Tool 'sdb.exe'
if (-not $tizen -and -not $CheckOnly) { Fail (Tr "Tizen Studio was not found. Install it (https://developer.tizen.org/development/tizen-studio/download) then run the installer again." "Tizen Studio est introuvable. Installe-le (https://developer.tizen.org/development/tizen-studio/download) puis relance l'installateur.") }
if (-not $sdb -and -not $CheckOnly) { Fail (Tr "sdb.exe was not found (it comes with Tizen Studio)." "sdb.exe est introuvable (il est fourni avec Tizen Studio).") }
if ($tizen) { Write-Host (Tr "        OK: $tizen" "        OK : $tizen") -ForegroundColor Green }

# ---------- 2. settings ----------
if (-not $CheckOnly) {
Step 2 (Tr "A few questions (Enter = suggested value)" "Quelques questions (Entrée = valeur proposée)")
if (-not $TvIp) { $TvIp = Ask (Tr "Screen IP address (on the screen: Settings › Connection › Network › Network Status)" "Adresse IP de l'écran (sur l'écran : Paramètres › Connexion › Réseau › État du réseau)") (Get-SavedTvIp) }
try { Test-TvIp $TvIp } catch { Fail $_.Exception.Message }
Save-TvIp $TvIp

$keysFile = Join-Path $Root "launcher\js\keys.local.js"
# Backup copy of the keys outside the ZIP folder: a new download finds them again.
$keysSaved = Join-Path $env:APPDATA "APL-Launcher\keys.local.js"
if ($Unattended) {
    # The app passes every key and the websites: the keys file is written from them.
    $clean = { param($k) ("$k" -replace '[^A-Za-z0-9._-]', '') }
    $list = @()
    if ($Sites) {
        $json = $Sites.Trim()
        if (-not $json.StartsWith('[')) { try { $json = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($json)) } catch { $json = '[]' } }
        try {
            foreach ($w in @(ConvertFrom-Json $json)) {
                $name = ("$($w.name)" -replace '[^\p{L}\p{N} +.\-]', '').Trim()
                $url = "$($w.url)".Trim()
                if ($name -and $url -match '^https?://[^\s"''\\$]+$') { $list += ('{ name: "' + $name + '", url: "' + $url + '" }') }
            }
        } catch {}
    }
    $content = "window.APL_KEYS = {`r`n    tmdb: `"$(& $clean $Tmdb)`",`r`n    youtube: `"$(& $clean $YouTube)`",`r`n    fanart: `"$(& $clean $Fanart)`",`r`n    webApps: [" + ($list -join ", ") + "]`r`n};`r`n"
    [IO.File]::WriteAllText($keysFile, $content, (New-Object Text.UTF8Encoding($false)))
    New-Item -ItemType Directory -Force -Path (Split-Path $keysSaved -Parent) | Out-Null
    Copy-Item $keysFile $keysSaved -Force
}
if (-not (Test-Path $keysFile) -and (Test-Path $keysSaved)) { Copy-Item $keysSaved $keysFile -Force }
if (-not (Test-Path $keysFile)) {
    Write-Host (Tr "        TMDB key: on themoviedb.org > Settings > API > 'API Key'." "        Clé TMDB : sur themoviedb.org > Paramètres > API > « Clé de l'API ».")
    $tmdb = Ask (Tr "Paste your TMDB key (or Enter to skip)" "Colle ta clé TMDB (ou Entrée pour passer)") ""
    $yt = Ask (Tr "YouTube Data API key, optional (or Enter to skip)" "Clé YouTube Data API, optionnelle (ou Entrée pour passer)") ""
    $content = "window.APL_KEYS = {`r`n    tmdb: `"$tmdb`",`r`n    youtube: `"$yt`"`r`n};`r`n"
    [IO.File]::WriteAllText($keysFile, $content, (New-Object Text.UTF8Encoding($false)))
    New-Item -ItemType Directory -Force -Path (Split-Path $keysSaved -Parent) | Out-Null
    Copy-Item $keysFile $keysSaved -Force
    Write-Host (Tr "        Keys saved on this PC only." "        Clés enregistrées sur ce PC uniquement.") -ForegroundColor Green
} else {
    New-Item -ItemType Directory -Force -Path (Split-Path $keysSaved -Parent) | Out-Null
    Copy-Item $keysFile $keysSaved -Force
    Write-Host (Tr "        Keys already saved." "        Clés déjà enregistrées.") -ForegroundColor Green
}
# Fanart.tv key (HD logos and backgrounds for movies and shows): asked only once
$keysText = [IO.File]::ReadAllText($keysFile)
if ($keysText -notmatch 'fanart\s*:') {
    Write-Host (Tr "        Fanart.tv key, optional: fanart.tv > your profile > API Key." "        Clé Fanart.tv, optionnelle : fanart.tv > ton profil > API Key.")
    $fan = (Ask (Tr "Paste your Fanart.tv key (or Enter to skip)" "Colle ta clé Fanart.tv (ou Entrée pour passer)") "") -replace '[^A-Za-z0-9]', ''
    $keysText = $keysText -replace '(\S)\s*\};\s*$', "`$1,`r`n    fanart: `"$fan`"`r`n};`r`n"
    [IO.File]::WriteAllText($keysFile, $keysText, (New-Object Text.UTF8Encoding($false)))
    Copy-Item $keysFile $keysSaved -Force
    if ($fan) { Write-Host (Tr "        Fanart.tv key saved on this PC only." "        Clé Fanart.tv enregistrée sur ce PC uniquement.") -ForegroundColor Green }
}
# Personal websites to show as apps (opened in Internet): asked only once
$keysText = [IO.File]::ReadAllText($keysFile)
if ($keysText -notmatch 'webApps\s*:') {
    Write-Host (Tr "        Websites to show as apps (they open in Internet), optional." "        Sites web à afficher comme des apps (ils s'ouvrent dans Internet), optionnel.")
    Write-Host (Tr "        Type the name then the address, e.g.: MySite https://example.com   (empty Enter to finish)" "        Tape le nom puis l'adresse, ex. : MonSite https://exemple.fr   (Entrée vide pour finir)")
    $sites = @()
    while ($true) {
        $line = Read-Host "        Site"
        if ([string]::IsNullOrWhiteSpace($line)) { break }
        $m = [regex]::Match($line.Trim(), '^(.+?)\s+(https?://[^\s"''\\$]+)$')
        if (-not $m.Success) { Write-Host (Tr "        Expected format: Name https://address" "        Format attendu : Nom https://adresse") -ForegroundColor DarkYellow; continue }
        $name = ($m.Groups[1].Value -replace '[^\p{L}\p{N} +.\-]', '').Trim()
        if ($name) { $sites += ('{ name: "' + $name + '", url: "' + $m.Groups[2].Value + '" }') }
    }
    $list = "[" + ($sites -join ", ") + "]"
    $keysText = $keysText -replace '(\S)\s*\};\s*$', ('$1,' + "`r`n    webApps: " + $list + "`r`n};`r`n")
    [IO.File]::WriteAllText($keysFile, $keysText, (New-Object Text.UTF8Encoding($false)))
    Copy-Item $keysFile $keysSaved -Force
    if ($sites.Count) { Write-Host (Tr "        $($sites.Count) site(s) saved on this PC only." "        $($sites.Count) site(s) enregistré(s) sur ce PC uniquement.") -ForegroundColor Green }
}

# Personal avatars (your Memoji): images put in  Pictures\APL Launcher avatars  on this PC.
# Copied into the screen's package only (never published on GitHub).
$avDir = Join-Path ([Environment]::GetFolderPath('MyPictures')) "APL Launcher avatars"
$avOut = Join-Path $Root "launcher\images\avatars\custom"
$avJs = Join-Path $Root "launcher\js\avatars.local.js"
if (-not (Test-Path $avDir)) { New-Item -ItemType Directory -Force -Path $avDir | Out-Null }
New-Item -ItemType Directory -Force -Path $avOut | Out-Null
Get-ChildItem -LiteralPath $avOut -File -ErrorAction SilentlyContinue | Remove-Item -Force
$avFiles = @(Get-ChildItem -LiteralPath $avDir -File -ErrorAction SilentlyContinue | Where-Object { $_.Extension -match '^\.(png|jpg|jpeg|webp)$' })
$avNames = @()
$i = 0
foreach ($f in $avFiles) {
    $i++
    $dest = "perso-" + $i + $f.Extension.ToLower()
    Copy-Item -LiteralPath $f.FullName -Destination (Join-Path $avOut $dest) -Force
    $avNames += ('"custom/' + $dest + '"')
}
if ($avFiles.Count) { Write-Host (Tr "        $($avFiles.Count) personal avatar(s) added from $avDir" "        $($avFiles.Count) avatar(s) perso ajouté(s) depuis $avDir") -ForegroundColor Green }

# Apple Memoji (58 faces) for the profiles: downloaded once from
# github.com/wimell/tapback-memojis (MIT license), kept on this PC, resized to
# 200 px and put in the screen's package. They are never published in this repository.
function Resize-Png([string]$src, [string]$dst, [int]$size) {
    try {
        Add-Type -AssemblyName System.Drawing -ErrorAction Stop
        $img = [System.Drawing.Image]::FromFile($src)
        try {
            $k = [Math]::Min($size / $img.Width, $size / $img.Height)
            $w = [int][Math]::Round($img.Width * $k); $h = [int][Math]::Round($img.Height * $k)
            $bmp = New-Object System.Drawing.Bitmap $size, $size, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
            $g = [System.Drawing.Graphics]::FromImage($bmp)
            $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
            $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
            $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
            $g.Clear([System.Drawing.Color]::Transparent)
            $g.DrawImage($img, [int](($size - $w) / 2), [int](($size - $h) / 2), $w, $h)
            $g.Dispose()
            $bmp.Save($dst, [System.Drawing.Imaging.ImageFormat]::Png)
            $bmp.Dispose()
        } finally { $img.Dispose() }
        return $true
    } catch { return $false }
}
$mjUrl = "https://raw.githubusercontent.com/wimell/tapback-memojis/2044fef695febaf43ddcf58932e39da7f5fe6b60/src/public/images/avatars/v1/"
$mjCache = Join-Path $env:APPDATA "APL-Launcher\memoji"
$mjOut = Join-Path $Root "launcher\images\avatars\memoji"
New-Item -ItemType Directory -Force -Path $mjCache | Out-Null
New-Item -ItemType Directory -Force -Path $mjOut | Out-Null
$mjMissing = @(1..58 | Where-Object { -not (Test-Path (Join-Path $mjCache "$_.png")) })
if ($mjMissing.Count) {
    Write-Host (Tr "        Downloading Memoji for the profiles ($($mjMissing.Count))…" "        Téléchargement des Memoji pour les profils ($($mjMissing.Count))…")
    try { [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12 } catch {}
    foreach ($n in $mjMissing) {
        $f = Join-Path $mjCache "$n.png"
        try { Invoke-WebRequest -UseBasicParsing -Uri ($mjUrl + "$n.png") -OutFile $f -TimeoutSec 30 }
        catch { Remove-Item -LiteralPath $f -Force -ErrorAction SilentlyContinue }
    }
}
$mjNames = @()
foreach ($n in 1..58) {
    $src = Join-Path $mjCache "$n.png"
    if (-not (Test-Path $src) -or (Get-Item $src).Length -lt 1000) { continue }
    $dst = Join-Path $mjOut "$n.png"
    if (-not (Resize-Png $src $dst 200)) { Copy-Item -LiteralPath $src -Destination $dst -Force }
    $mjNames += ('"memoji/' + $n + '.png"')
}
if ($mjNames.Count) { Write-Host (Tr "        $($mjNames.Count) Memoji ready for the profiles." "        $($mjNames.Count) Memoji prêts pour les profils.") -ForegroundColor Green }
else { Write-Host (Tr "        Memoji not downloaded (no network?): the profiles will use the 3D avatars." "        Memoji non téléchargés (pas de réseau ?) : les profils auront les avatars 3D.") -ForegroundColor DarkYellow }
[IO.File]::WriteAllText($avJs, ("window.APL_CUSTOM_AVATARS = [" + ($avNames -join ", ") + "];`r`nwindow.APL_MEMOJI = [" + ($mjNames -join ", ") + "];`r`n"), (New-Object Text.UTF8Encoding($false)))
}

# ---------- 3. certificate ----------
Step 3 (Tr "Samsung certificate (signing)…" "Certificat Samsung (signature)…")
# The author.pwd / distributor.pwd files are ENCRYPTED: we don't read them.
# We reuse the Tizen Studio profile that already points to them (the one created for
# TizenTube): Tizen decrypts the passwords itself, no questions asked.
function Find-SigningProfile {
    $studio = Split-Path (Split-Path (Split-Path (Split-Path $tizen -Parent) -Parent) -Parent) -Parent
    $xmlCandidates = @(
        (Join-Path (Split-Path $studio -Parent) 'tizen-studio-data\profile\profiles.xml'),
        "C:\tizen-studio-data\profile\profiles.xml",
        "$env:USERPROFILE\tizen-studio-data\profile\profiles.xml"
    )
    foreach ($x in ($xmlCandidates | Select-Object -Unique)) {
        if (-not (Test-Path $x)) { continue }
        try { [xml]$doc = Get-Content $x -Raw } catch { continue }
        $best = $null
        foreach ($pr in $doc.profiles.profile) {
            $author = $pr.profileitem | Where-Object { $_.distributor -eq '0' } | Select-Object -First 1
            # Profile usable without questions = passwords stored in .pwd files
            if ($author -and $author.password -like '*.pwd' -and (Test-Path $author.password)) {
                if ($pr.name -match 'tizentube') { $script:profileXml = $x; return $pr.name }
                if (-not $best) { $best = $pr.name; $bestXml = $x }
            }
        }
        if ($best) { $script:profileXml = $bestXml; return $best }
    }
    # Fallback: from the list of profiles (leaving out profiles without saved passwords). The CLI first
    # prints "Loaded in '...\profiles.xml'." and a header: only the lines after "[Profile Name]" are names.
    # ("Loaded" was taken for a profile, and the package came out unsigned: #36.)
    $names = @()
    $lines = @((Invoke-Native $tizen @('security-profiles', 'list')).Output -split "`n")
    $header = [array]::FindIndex([string[]]$lines, [Predicate[string]]{ param($l) $l -match '^\s*\[Profile Name\]' })
    for ($i = $header + 1; $i -lt $lines.Count; $i++) {
        $n = ($lines[$i].Trim() -split '\s+')[0]
        if ($n -and $n -notmatch "^\[|^-|Profile|^APLLauncher$|^Loaded$|'|\.xml") { $names += $n }
    }
    $t = $names | Where-Object { $_ -match 'tizentube' } | Select-Object -First 1
    if ($t) { return $t }
    if ($names.Count -ge 1) { return $names[0] }
    return $null
}
$script:profileXml = $null
$signProfile = $null
$certPwdFile = $null

# 1) First choice: a Samsung certificate that is STILL VALID and whose password is
#    readable (password.txt, created by Apps2Samsung).
function Find-CertCandidates {
    $roots = @("$env:APPDATA\Apps2Samsung", "$env:LOCALAPPDATA\Apps2Samsung",
               "$env:USERPROFILE\SamsungCertificate", "$env:USERPROFILE")
    $roots += @(Get-ChildItem 'C:\Users' -Directory -ErrorAction SilentlyContinue | ForEach-Object {
        Join-Path $_.FullName 'AppData\Roaming\Apps2Samsung' })
    # Tools started from a "packaged" Windows app (Microsoft Store): their AppData
    # is redirected to  %LOCALAPPDATA%\Packages\<app>\LocalCache\Roaming.
    $roots += @(Get-ChildItem "$env:LOCALAPPDATA\Packages" -Directory -ErrorAction SilentlyContinue | ForEach-Object {
        Join-Path $_.FullName 'LocalCache\Roaming\Apps2Samsung' })
    $seen = @{}
    $out = @()
    foreach ($r in $roots) {
        if (-not (Test-Path $r)) { continue }
        $depth = if ($r -eq $env:USERPROFILE) { 6 } else { 8 }
        Get-ChildItem -LiteralPath $r -Recurse -Depth $depth -Filter 'password.txt' -ErrorAction SilentlyContinue | ForEach-Object {
            $d = $_.DirectoryName
            if ($seen[$d]) { return }
            $seen[$d] = $true
            $a = Join-Path $d 'author.p12'; $di = Join-Path $d 'distributor.p12'
            if (-not ((Test-Path $a) -and (Test-Path $di))) { return }
            $pw = (Get-Content -LiteralPath $_.FullName -Raw).Trim()
            $exp = $null
            try {
                $e1 = (New-Object System.Security.Cryptography.X509Certificates.X509Certificate2($a, $pw)).NotAfter
                $e2 = (New-Object System.Security.Cryptography.X509Certificates.X509Certificate2($di, $pw)).NotAfter
                $exp = if ($e1 -lt $e2) { $e1 } else { $e2 }
            } catch {}
            $out += [pscustomobject]@{ Dir = $d; Pwd = $_.FullName; Expires = $exp }
        }
    }
    return $out
}

function Use-Cert($c) {
    $pw = (Get-Content -LiteralPath $c.Pwd -Raw).Trim()
    Invoke-Native $tizen @('security-profiles', 'remove', '-n', 'APLPartner') | Out-Null
    $r = Invoke-Native $tizen @('security-profiles', 'add', '-n', 'APLPartner',
        '-a', (Join-Path $c.Dir 'author.p12'), '-p', $pw, '-d', (Join-Path $c.Dir 'distributor.p12'), '-dp', $pw)
    $pw = $null
    return ($r.ExitCode -eq 0)
}

Write-Host (Tr "        Looking for a valid Samsung certificate on the PC (1 minute max)…" "        Recherche d'un certificat Samsung valable sur le PC (1 minute max)…")
$now = Get-Date
$certs = @(Find-CertCandidates)
foreach ($c in $certs) {
    $when = if ($c.Expires) { $c.Expires.ToString((Tr 'yyyy-MM-dd' 'dd/MM/yyyy')) } else { Tr "unreadable date" "date illisible" }
    $tag = if ($c.Expires -and $c.Expires -lt $now) { Tr "EXPIRED" "EXPIRÉ" } else { "ok" }
    Write-Host (Tr "          - $($c.Dir)  (until ${when}: $tag)" "          - $($c.Dir)  (jusqu'au $when : $tag)")
}
# Valid ones first; then those whose date could not be read (most recent first).
function Select-Usable($list) {
    $ok = @($list | Where-Object { $_.Expires -and $_.Expires -gt (Get-Date) } | Sort-Object Expires -Descending)
    $unknown = @($list | Where-Object { -not $_.Expires } | Sort-Object { (Get-Item $_.Dir).LastWriteTime } -Descending)
    return @($ok + $unknown)
}
$valid = @(Select-Usable $certs)

if ($CheckOnly) {
    $best = @($valid) + @($certs | Sort-Object Expires -Descending) | Select-Object -First 1
    $cert = $null
    if ($best) { $cert = @{ dir = $best.Dir; expires = $(if ($best.Expires) { $best.Expires.ToString('yyyy-MM-dd') } else { $null }); valid = [bool]$valid.Count } }
    $prof = $null
    if ($tizen) { try { $prof = Find-SigningProfile } catch {} }
    $check = @{ tizen = $tizen; sdb = $sdb; certificate = $cert; profile = $prof; csharp = [bool](Find-CSharpCompiler); net6 = [bool](Find-Net6) }
    Send-Gui ("APL-CHECK " + ($check | ConvertTo-Json -Compress -Depth 4))
    exit 0
}

if (-not $valid.Count) {
    # No valid certificate: create a new one with Apps2Samsung (Samsung account).
    $a2sCli = Search-Tool 'apps2samsung-cli.exe'
    if ($a2sCli) {
        Write-Host ""
        Write-Host (Tr "        No valid Samsung certificate. Creating a NEW one with Apps2Samsung." "        Aucun certificat Samsung valable. On en crée un NEUF avec Apps2Samsung.") -ForegroundColor Yellow
        Write-Host (Tr "        A Samsung page will open in the browser: sign in with your Samsung account," "        Une page Samsung va s'ouvrir dans le navigateur : connecte-toi avec ton compte Samsung,") -ForegroundColor Yellow
        Write-Host (Tr "        then come back here. (Never give your Samsung password to anyone, not even in the chat.)" "        puis reviens ici. (Ne donne ton mot de passe Samsung à personne, même pas dans le chat.)") -ForegroundColor Yellow
        if (-not $Quiet) { Read-Host (Tr "        Press Enter to start" "        Appuie sur Entrée pour commencer") }
        & $a2sCli cert --tv $TvIp
        $certs = @(Find-CertCandidates)
        $valid = @(Select-Usable $certs)
    }
}
if ($valid.Count) {
    $best = $valid[0]
    if (Use-Cert $best) {
        $signProfile = 'APLPartner'
        $certPwdFile = $best.Pwd
        $until = if ($best.Expires) { (Tr "valid until " "valable jusqu'au ") + $best.Expires.ToString((Tr 'yyyy-MM-dd' 'dd/MM/yyyy')) } else { Tr "unreadable date" "date non lisible" }
        Write-Host (Tr "        Chosen certificate: $($best.Dir) ($until)" "        Certificat choisi : $($best.Dir) ($until)") -ForegroundColor Green
    } else {
        Write-Host (Tr "        (This certificate could not be registered in Tizen.)" "        (Ce certificat n'a pas pu être enregistré dans Tizen.)") -ForegroundColor DarkYellow
    }
}

# 2) Otherwise: a Tizen Studio signing profile (made with its Certificate Manager, or the one used for
#    TizenTube). Its passwords are encrypted, so its expiry date is only read once the package is signed.
if (-not $signProfile) { $signProfile = Find-SigningProfile }
if (-not $signProfile) {
    $newest = $certs | Where-Object { $_.Expires } | Sort-Object Expires -Descending | Select-Object -First 1
    $found = if ($newest) {
        $d = $newest.Expires.ToString((Tr 'yyyy-MM-dd' 'dd/MM/yyyy'))
        Tr "the newest one found expired on $d" "le plus récent trouvé a expiré le $d"
    } else { Tr "none was found" "aucun n'a été trouvé" }
    Fail (Tr ("no valid Samsung certificate on this PC ($found).`n" +
              "  Create one with Apps2Samsung, or with Tizen Studio's Certificate Manager (Samsung certificate for this screen, with your Samsung account), then try again.") `
             ("aucun certificat Samsung valable sur ce PC ($found).`n" +
              "  Crée-en un avec Apps2Samsung, ou avec le Certificate Manager de Tizen Studio (certificat Samsung pour cet écran, avec ton compte Samsung), puis réessaie."))
}

# The profile may come from ANOTHER Tizen Studio installation (the one used
# for TizenTube). We copy it into the profiles file of the Tizen Studio
# version used here (after a backup): same certificates, same encrypted
# passwords, so no questions asked.
function Get-CliProfilesXml {
    $studio = Split-Path (Split-Path (Split-Path (Split-Path $tizen -Parent) -Parent) -Parent) -Parent
    $data = $null
    $info = Join-Path $studio 'sdk.info'
    if (Test-Path $info) {
        $m = Select-String -Path $info -Pattern '^\s*TIZEN_SDK_DATA_PATH\s*=\s*(.+)$' | Select-Object -First 1
        if ($m) { $data = $m.Matches[0].Groups[1].Value.Trim() }
    }
    if (-not $data) { $data = Join-Path (Split-Path $studio -Parent) 'tizen-studio-data' }
    return Join-Path $data 'profile\profiles.xml'
}

if ($signProfile -and $script:profileXml) {
    $visible = (Invoke-Native $tizen @('security-profiles', 'list')).Output
    if ($visible -notmatch [regex]::Escape($signProfile)) {
        $target = Get-CliProfilesXml
        Write-Host (Tr "        Copying profile '$signProfile' to $target" "        Copie du profil '$signProfile' vers $target")
        try {
            [xml]$src = Get-Content $script:profileXml -Raw
            $node = $src.profiles.profile | Where-Object { $_.name -eq $signProfile } | Select-Object -First 1
            if (Test-Path $target) {
                Copy-Item $target "$target.avant-apl" -Force
                [xml]$dst = Get-Content $target -Raw
            } else {
                New-Item -ItemType Directory -Force -Path (Split-Path $target -Parent) | Out-Null
                [xml]$dst = '<?xml version="1.0" encoding="UTF-8" standalone="no"?><profiles active="' + $signProfile + '" version="3.1"></profiles>'
            }
            $old = $dst.profiles.profile | Where-Object { $_.name -eq $signProfile }
            foreach ($o in @($old)) { if ($o) { [void]$dst.profiles.RemoveChild($o) } }
            [void]$dst.DocumentElement.AppendChild($dst.ImportNode($node, $true))
            $dst.Save($target)
        } catch { Fail (Tr "could not copy the profile: $($_.Exception.Message)" "copie du profil impossible : $($_.Exception.Message)") }
        $visible = (Invoke-Native $tizen @('security-profiles', 'list')).Output
        if ($visible -notmatch [regex]::Escape($signProfile)) {
            Write-Host (Tr "        (Tizen still shows:)" "        (Tizen affiche encore :)") -ForegroundColor Yellow
            Write-Host $visible
            Write-Host (Tr "        Trying the build anyway…" "        On tente quand même la compilation…") -ForegroundColor Yellow
        }
    }
}
Write-Host (Tr "        Profile: $signProfile" "        Profil : $signProfile") -ForegroundColor Green

# ---------- 4. build ----------
Step 4 (Tr "Building the launcher…" "Compilation du launcher…")
# Tizen 6.x: the full package's .NET apps (APL Overlay, the bridge, the start-up service) don't run there, and
# the launcher reaches Vetro through that bridge (The Frame 2022, issue #21): the launcher's own package then,
# with its web bridge. Without APL Overlay the launcher keeps Home and gives the other buttons back to Samsung.
$webOnly = $false
if (Test-Vetro $TvIp) {
    $platform = Get-ScreenPlatform "http://$TvIp`:$(Get-VetroPort)"
    if ($platform) {
        $webOnly = ($platform.Tizen -ge 1 -and $platform.Tizen -lt 7) -or ($platform.Tizen -eq 0 -and -not $platform.DotNet6)
        $seen = if ($platform.Tizen) { "Tizen $($platform.Tizen)" } else { Tr "an unknown Tizen version" "une version de Tizen inconnue" }
        if ($webOnly) {
            Write-Host (Tr "        The screen runs $($seen): APL Overlay needs Tizen 7 or newer, so the launcher is installed on its own." "        L'écran est sous $seen : APL Overlay demande Tizen 7 ou plus, le launcher est donc installé seul.") -ForegroundColor Yellow
            Write-Host (Tr "        Home, the Home Screen and the settings work; the Control Center over videos and Alexa need APL Overlay." "        Home, l'écran d'accueil et les réglages marchent ; le Centre de contrôle sur les vidéos et Alexa demandent APL Overlay.") -ForegroundColor Yellow
        }
    }
}
if ($certPwdFile -and $signProfile -eq 'APLPartner') {
    Write-Host (Tr "        If you are asked for 'Author password' or 'Distributor password':" "        Si on te demande « Author password » ou « Distributor password » :") -ForegroundColor Yellow
    Write-Host (Tr "        open $certPwdFile with Notepad, copy its content, right-click to paste, Enter." "        ouvre $certPwdFile avec le Bloc-notes, copie son contenu, clic droit pour coller, Entrée.") -ForegroundColor Yellow
}
$sf = "$env:USERPROFILE\Downloads\sf-pro-display_2"
try {
    if (Test-Path $sf) { & "$PSScriptRoot\03-build-launcher.ps1" -ProfileName $signProfile -TizenCli $tizen -SfProDir $sf -WebOnly:$webOnly }
    else { & "$PSScriptRoot\03-build-launcher.ps1" -ProfileName $signProfile -TizenCli $tizen -WebOnly:$webOnly }
} catch { Fail ((Tr "the build failed: " "la compilation a échoué : ") + $_.Exception.Message) }

# An expired certificate signs without a word, then the screen refuses the package: say it here.
$wgt = Join-Path $Root "dist\APL-Launcher.wgt"
$certEnd = Get-WgtCertExpiry $wgt
if ($certEnd -and $certEnd -lt (Get-Date)) {
    $d = $certEnd.ToString((Tr 'yyyy-MM-dd' 'dd/MM/yyyy'))
    Fail (Tr ("the Samsung certificate of profile '$signProfile' expired on $d.`n" +
              "  Create a new one with Apps2Samsung, or with Tizen Studio's Certificate Manager (Samsung certificate for this screen), then try again.") `
             ("le certificat Samsung du profil « $signProfile » a expiré le $d.`n" +
              "  Crée-en un nouveau avec Apps2Samsung, ou avec le Certificate Manager de Tizen Studio (certificat Samsung pour cet écran), puis réessaie."))
}

# ---------- 5. installation ----------
Step 5 (Tr "Installing the launcher on the screen $TvIp…" "Installation du launcher sur l'écran $TvIp…")
if (Test-Vetro $TvIp) {
    Write-Host (Tr "        Vetro is running on the screen: installing through Vetro (nothing to change on the screen)." "        Vetro est actif sur l'écran : installation par Vetro (rien à changer sur l'écran).")
    try { Install-ViaVetro -Ip $TvIp -Wgt $wgt }
    catch { Fail ((Tr "the installation failed: " "l'installation a échoué : ") + $_.Exception.Message) }
} else {
    Write-Host (Tr "        Vetro is not responding: standard installation (developer mode)." "        Vetro ne répond pas : installation classique (mode développeur).") -ForegroundColor Yellow
    Write-Host (Tr "        Without Vetro, the launcher opens from the Apps menu, but the Home button, Control Center" "        Sans Vetro, le launcher s'ouvre depuis le menu Applis, mais la touche Home, le Centre de contrôle") -ForegroundColor Yellow
    Write-Host (Tr "        over videos, Alexa and closing unused apps are missing. Install Vetro (see README)." "        sur les vidéos, Alexa et la fermeture des apps inutilisées manquent. Installe Vetro (voir README).") -ForegroundColor Yellow
    try { & "$PSScriptRoot\04-install-launcher.ps1" -TvIp $TvIp -Sdb $sdb -TizenCli $tizen }
    catch {
        Fail ((Tr "the installation failed: " "l'installation a échoué : ") + $_.Exception.Message + (Tr "`n  Open Vetro once on the screen (Apps menu), wait 1 minute and run the installer again." "`n  Ouvre Vetro une fois sur l'écran (menu Applis), attends 1 minute et relance l'installateur."))
    }
}

if ($webOnly) {
    # No APL Overlay: the launcher puts the Home rule back on itself at start-up and frees the other buttons
    # (launcher/js/overlay.js), also when this replaces a full package that had them.
    Write-Host (Tr "        Without APL Overlay: the launcher keeps the Home button itself." "        Sans APL Overlay : le launcher garde lui-même la touche Home.")
} elseif (Test-Vetro $TvIp) {
    Write-Host (Tr "        Control Center over videos (APL Overlay)…" "        Centre de contrôle sur les vidéos (APL Overlay)…")
    try { & "$PSScriptRoot\05-build-overlay.ps1" -TvIp $TvIp -ProfileName $signProfile -TizenCli $tizen }
    catch { Write-Host ((Tr "        The remote's buttons were not set up: " "        Les boutons de la télécommande n'ont pas été configurés : ") + $_.Exception.Message + (Tr " The launcher works anyway." " Le launcher marche quand même.")) -ForegroundColor DarkYellow }
}

# APL TV, the IPTV player in the launcher's style (your own M3U playlists and Xtream accounts): only when asked.
if (-not $Quiet -and -not $AplTv) {
    $a = Ask (Tr "Also install APL TV, the IPTV player for your own playlists? (y/N)" "Installer aussi APL TV, le lecteur IPTV pour tes propres playlists ? (o/N)") ""
    $AplTv = [bool]($a -match '^(y|yes|o|oui)$')
}
if ($AplTv) {
    Write-Host (Tr "        APL TV (IPTV player)…" "        APL TV (lecteur IPTV)…")
    try { & "$PSScriptRoot\06-install-apltv.ps1" -TvIp $TvIp -ProfileName $signProfile -TizenCli $tizen -Sdb $sdb -NoLaunch }
    catch { Write-Host ((Tr "        APL TV was not installed: " "        APL TV n'a pas été installé : ") + $_.Exception.Message + (Tr " The launcher works anyway." " Le launcher marche quand même.")) -ForegroundColor DarkYellow }
}

Write-Host ""
Write-Host "  ==============================================" -ForegroundColor Green
Write-Host (Tr "    INSTALLED! APL Launcher is on the screen." "    C'EST INSTALLÉ ! APL Launcher est sur l'écran.") -ForegroundColor Green
Write-Host "  ==============================================" -ForegroundColor Green
Write-Host ""
if ($Quiet) { Send-Gui "APL-RESULT ok"; exit 0 }
Write-Host (Tr "  There are 2 settings left to do ONCE, with the remote:" "  Il reste 2 réglages à faire UNE fois, avec la télécommande :") -ForegroundColor White
Write-Host ""
Write-Host (Tr "   A) On the screen: Settings > All Settings > Advanced Features" "   A) Sur l'écran : Paramètres > Tous les paramètres > Fonctions avancées")
Write-Host (Tr "        - 'Autorun Smart Hub'  -> OFF" "        - « Lancer Smart Hub automatiquement »        -> DÉSACTIVÉ")
Write-Host (Tr "        - 'Autorun Last App'   -> ON" "        - « Lancer automatiquement la dernière app »  -> ACTIVÉ")
Write-Host ""
Write-Host (Tr "   B) On this PC, open  http://$TvIp`:$(Get-VetroPort)  (Vetro) > Remapper tab:" "   B) Sur ce PC, ouvre  http://$TvIp`:$(Get-VetroPort)  (Vetro) > onglet Remapper :")
Write-Host (Tr "        in the device list, pick your remote: 'Smart Control 2016' if it is" "        dans la liste des appareils, choisis ta télécommande : « Smart Control 2016 » si elle est")
Write-Host (Tr "        paired over Bluetooth, 'wt61p807 rc device' if it only works over infrared;" "        appairée en Bluetooth, « wt61p807 rc device » si elle marche en infrarouge seulement ;")
Write-Host (Tr "        listen for a key > press HOME > open the app 'APL Launcher' > Save" "        écouter une touche > appuie sur HOME > ouvrir l'app « APL Launcher » > Enregistrer")
Write-Host (Tr "        then turn on the 'Remote interception' switch (it must be blue)," "        puis active l'interrupteur « Remote interception » (il doit être bleu),")
Write-Host (Tr "        and run the installer once more: it hands Home and Pause over to APL Overlay." "        et relance l'installateur une fois : il confie Home et Pause à APL Overlay.")
Write-Host ""
Write-Host (Tr "  After a full restart of the screen, Vetro takes up to 2 minutes to take" "  Après un redémarrage complet de l'écran, Vetro met jusqu'à 2 minutes à reprendre")
Write-Host (Tr "  over again: meanwhile, Home still opens the Samsung menu. That is normal." "  la main : pendant ce temps, Home ouvre encore le menu Samsung. C'est normal.")
Write-Host ""
Write-Host (Tr "  If the screen asks 'Allow APL Launcher?', answer Allow." "  Si l'écran demande « Autoriser APL Launcher ? », réponds Autoriser.")
Write-Host ""
Write-Host (Tr "  NEXT: Optimize in APL Launcher Setup removes unneeded apps and services." "  ENSUITE : Optimiser, dans APL Launcher Setup, enlève les apps et services inutiles.") -ForegroundColor Cyan
Write-Host (Tr "  Control Center: press Home twice (or the ⏯ button)." "  Centre de contrôle : appuie 2 fois sur Home (ou sur la touche ⏯).") -ForegroundColor Cyan
Write-Host ""
Read-Host (Tr "  Press Enter to close" "  Appuie sur Entrée pour fermer")
