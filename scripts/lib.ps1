# ============================================================
#  lib.ps1 — functions shared by the APL Launcher scripts.
#  Loaded automatically by the other scripts (. "$PSScriptRoot\lib.ps1").
# ============================================================

$ErrorActionPreference = 'Stop'

# Message language: French when Windows is in French, English otherwise.
# Tr "English text" "texte français" returns the text for that language.
$script:French = (Get-UICulture).TwoLetterISOLanguageName -eq 'fr'
if ($env:APL_LANG) { $script:French = $env:APL_LANG -eq 'fr' }   # language chosen by APL Launcher Setup
function Tr([string]$En, [string]$Fr) { if ($script:French) { return $Fr } else { return $En } }

# Started by APL Launcher Setup (APL_GUI=1): no questions, UTF-8 output, and marker lines
# the app reads (APL-STEP, APL-PROGRESS, APL-RESULT, APL-CHECK, APL-PLAN).
$script:Gui = [bool]$env:APL_GUI
if ($script:Gui) { try { [Console]::OutputEncoding = New-Object Text.UTF8Encoding($false) } catch {} }
function Send-Gui([string]$Line) { if ($script:Gui) { [Console]::Out.WriteLine($Line); [Console]::Out.Flush() } }
function Send-Progress([int]$Percent, [string]$Text) {
    Send-Gui "APL-PROGRESS $([Math]::Max(0, [Math]::Min(100, $Percent))) $Text"
    if (-not $script:Gui) { Write-Progress -Activity (Tr "Optimization" "Optimisation") -Status $Text -PercentComplete $Percent }
}

# For APL Overlay: a C# compiler (Visual Studio Build Tools) and the .NET 6 runtime.
function Find-CSharpCompiler {
    foreach ($dir in @(${env:ProgramFiles(x86)}, $env:ProgramFiles)) {
        if (-not $dir) { continue }
        $found = Get-ChildItem (Join-Path $dir "Microsoft Visual Studio") -Filter csc.exe -Recurse -ErrorAction SilentlyContinue |
                 Where-Object { $_.FullName -match 'Roslyn' } | Select-Object -First 1
        if ($found) { return $found.FullName }
    }
    return $null
}
function Find-Net6 {
    $dir = Join-Path $env:ProgramFiles "dotnet\shared\Microsoft.NETCore.App"
    return Get-ChildItem $dir -Directory -Filter "6.*" -ErrorAction SilentlyContinue | Sort-Object Name -Descending | Select-Object -First 1
}

function Find-Tool {
    param(
        [string]$Explicit,
        [string]$Name,              # 'sdb.exe' | 'tizen.bat'
        [string[]]$Candidates
    )
    if ($Explicit -and (Test-Path -LiteralPath $Explicit)) { return (Resolve-Path -LiteralPath $Explicit).Path }
    $cmd = Get-Command $Name -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    foreach ($c in $Candidates) {
        if (Test-Path -LiteralPath $c) { return (Resolve-Path -LiteralPath $c).Path }
    }
    return $null
}

function Find-Sdb {
    param([string]$Sdb)
    $cand = @(
        "$env:USERPROFILE\tizen-studio\tools\sdb.exe",
        "C:\tizen-studio\tools\sdb.exe",
        "$env:LOCALAPPDATA\Tizen\tizen-studio\tools\sdb.exe",
        ".\work\sdb\data\tools\sdb.exe"
    )
    $p = Find-Tool -Explicit $Sdb -Name 'sdb.exe' -Candidates $cand
    if (-not $p) { throw (Tr "sdb.exe not found. Install Tizen Studio or pass -Sdb 'C:\path\sdb.exe'." "sdb.exe introuvable. Installez Tizen Studio ou passez -Sdb 'C:\chemin\sdb.exe'.") }
    return $p
}

function Find-Tizen {
    param([string]$TizenCli)
    $cand = @(
        "$env:USERPROFILE\tizen-studio\tools\ide\bin\tizen.bat",
        "C:\tizen-studio\tools\ide\bin\tizen.bat",
        "$env:LOCALAPPDATA\Tizen\tizen-studio\tools\ide\bin\tizen.bat",
        ".\work\tizen-studio\tools\ide\bin\tizen.bat"
    )
    $p = Find-Tool -Explicit $TizenCli -Name 'tizen.bat' -Candidates $cand
    if (-not $p) { throw (Tr "tizen.bat (Tizen Studio CLI) not found. Install Tizen Studio (with the CLI) or pass -TizenCli." "tizen.bat (CLI Tizen Studio) introuvable. Installez Tizen Studio (avec le CLI) ou passez -TizenCli.") }
    return $p
}

# The screen's IP address, remembered on this PC (no hard-coded value)
function Get-SavedTvIp {
    $f = Join-Path $env:APPDATA "APL-Launcher\tv-ip.txt"
    if (Test-Path $f) { return ([IO.File]::ReadAllText($f)).Trim() }
    return ""
}
function Save-TvIp([string]$Ip) {
    $d = Join-Path $env:APPDATA "APL-Launcher"
    New-Item -ItemType Directory -Force -Path $d | Out-Null
    [IO.File]::WriteAllText((Join-Path $d "tv-ip.txt"), $Ip)
}

function Test-TvIp {
    param([string]$Ip)
    if ($Ip -notmatch '^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$') {
        throw (Tr "Invalid IPv4 address: '$Ip'. Example: 192.168.1.50" "Adresse IPv4 invalide : '$Ip'. Exemple : 192.168.1.50")
    }
}

function Invoke-WithRetry {
    param([scriptblock]$Script, [int]$Max = 4)
    $delay = 2
    for ($i = 1; $i -le $Max; $i++) {
        try { return & $Script }
        catch {
            if ($i -eq $Max) { throw }
            Write-Host (Tr "  … failed (attempt $i/$Max), retrying in ${delay}s" "  … échec (tentative $i/$Max), nouvel essai dans ${delay}s") -ForegroundColor DarkYellow
            Start-Sleep -Seconds $delay
            $delay *= 2
        }
    }
}

function Connect-Tv {
    param([string]$Sdb, [string]$Ip)
    Test-TvIp $Ip
    Write-Host (Tr "SDB connection to $Ip …" "Connexion SDB à $Ip …")
    Invoke-WithRetry { & $Sdb connect $Ip | Out-Host }
    $serial = "$Ip`:26101"
    $devices = & $Sdb devices
    if (-not ($devices -match [regex]::Escape($Ip))) {
        throw (Tr "The TV does not show up in 'sdb devices'. Easiest fix: open Vetro on the screen (Apps), wait 1 minute and try again. DO NOT CHANGE 'Host PC IP' in developer mode: TizenBrew and Vetro need 127.0.0.1." "Le téléviseur n'apparaît pas dans 'sdb devices'. Le plus simple : ouvre Vetro sur l'écran (Applis), attends 1 minute et relance. NE CHANGE PAS « Host PC IP » du mode développeur : TizenBrew et Vetro ont besoin de 127.0.0.1.")
    }
    Write-Host (Tr "Connected: $serial" "Connecté : $serial") -ForegroundColor Green
    return $serial
}

# Runs an external tool (sdb, tizen…) and captures its text output.
# Otherwise Windows PowerShell 5 turns the slightest error message from
# the tool into a terminating error when the error output is redirected.
function Invoke-Native {
    param([Parameter(Mandatory = $true)][string]$Exe, [string[]]$Arguments)
    $old = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $out = & $Exe @Arguments 2>&1 | ForEach-Object { "$_" }
        return [pscustomobject]@{ Output = ($out -join "`n"); ExitCode = $LASTEXITCODE }
    } finally { $ErrorActionPreference = $old }
}

# ------------------------------------------------------------------
#  Installation through Vetro (already on the screen, with root access).
#  Vetro requires "Host PC IP = 127.0.0.1": the PC then cannot
#  install through sdb. So we go through Vetro, changing nothing:
#  copy the package to the screen, check its hash, install it with
#  Vetro's /install function, then check the list of apps.
# ------------------------------------------------------------------
# Vetro's port: 8099, or the one it was built with (VETRO_PORT=…, when another app holds 8099). APL Launcher Setup
# finds it and passes it in APL_VETRO_PORT (installer/Vetro.cs).
function Get-VetroPort {
    if ("$env:APL_VETRO_PORT" -match '^\d{4,5}$') { return [int]$env:APL_VETRO_PORT }
    return 8099
}

function Test-Vetro {
    param([string]$Ip)
    try {
        $st = Invoke-RestMethod -Uri "http://$Ip`:$(Get-VetroPort)/status" -TimeoutSec 8
        return [bool]($st.agent -and $st.agent.connected)
    } catch { return $false }
}

function Invoke-VetroExec {
    param([string]$Base, [string]$Cmd, [int]$Timeout = 60)
    $body = @{ cmd = $Cmd } | ConvertTo-Json -Compress
    $r = Invoke-RestMethod -Uri "$Base/exec" -Method Post -ContentType 'application/json' -Body $body -TimeoutSec $Timeout
    if (-not $r.ok) { throw (Tr "the screen refused a command ($($r.stderr)$($r.error))" "l'écran a refusé une commande ($($r.stderr)$($r.error))") }
    return [string]$r.output
}

# A vconf value read through Vetro, '' when it can't be read
function Get-VconfValue {
    param([string]$Base, [string]$Key)
    try { $o = Invoke-VetroExec $Base "vconftool get $Key 2>&1" } catch { return '' }
    if ($o -match 'value = (\S+)') { return $Matches[1] }
    return ''
}

# What the screen runs, read through Vetro: its Tizen version (/etc/info.ini, "Model=Tizen9/TV;", 0 when
# unknown) and whether .NET 6 or newer is there. APL Overlay, the .NET bridge and the start-up service of the
# full package need it: on Tizen 6.5 (The Frame 2022, issue #21) they don't run, and with them goes everything
# the launcher asks Vetro. $null when Vetro does not answer.
function Get-ScreenPlatform {
    param([string]$Base)
    try {
        $o = Invoke-VetroExec $Base ("grep -o -E 'Tizen[0-9]+' /etc/info.ini 2>/dev/null | head -1; " +
                                     "ls -d /usr/share/dotnet/shared/Microsoft.NETCore.App/[6-9].* /usr/share/dotnet/shared/Microsoft.NETCore.App/[1-9][0-9].* 2>/dev/null | head -1; true")
    } catch { return $null }
    $tizen = 0
    if ($o -match 'Tizen(\d+)') { $tizen = [int]$Matches[1] }
    [pscustomobject]@{ Tizen = $tizen; DotNet6 = [bool]($o -match 'Microsoft\.NETCore\.App/\d') }
}

# "Start on APL Launcher" undone: when the launcher is the screen's home app (db/appfw/home_appid, opened at
# power-on with Autorun Smart Hub), the firmware's own home app goes back (db/first_screen/type, else
# Samsung's home), read back. Returns the app set back, '' when nothing needed it.
function Reset-ScreenHomeApp {
    param([string]$Base)
    if ((Get-VconfValue $Base 'db/appfw/home_appid') -notlike 'APLauncher*') { return '' }
    $original = Get-VconfValue $Base 'db/first_screen/type'
    if (-not $original -or $original -like 'APLauncher*' -or $original -notmatch '^[A-Za-z0-9_.-]+$') { $original = 'com.samsung.tv.csfs' }
    Invoke-VetroExec $Base "vconftool set -f -t string db/appfw/home_appid $original" | Out-Null
    if ((Get-VconfValue $Base 'db/appfw/home_appid') -ne $original) {
        throw (Tr "the screen kept APL Launcher as its home app" "l'écran garde APL Launcher comme application d'accueil")
    }
    return $original
}

# Expiry of the certificates a .wgt is signed with (the first, signer's, certificate of author-signature.xml
# and signature1.xml): the earliest date, or $null if the package can't be read.
function Get-WgtCertExpiry {
    param([string]$Wgt)
    if (-not (Test-Path -LiteralPath $Wgt)) { return $null }
    try {
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        $zip = [IO.Compression.ZipFile]::OpenRead($Wgt)
        try {
            $dates = @()
            foreach ($name in @('author-signature.xml', 'signature1.xml')) {
                $entry = $zip.GetEntry($name)
                if (-not $entry) { continue }
                $reader = New-Object IO.StreamReader($entry.Open())
                $xml = $reader.ReadToEnd()
                $reader.Close()
                $m = [regex]::Match($xml, '<X509Certificate>\s*([A-Za-z0-9+/=\s]+?)\s*</X509Certificate>')
                if ($m.Success) {
                    $bytes = [Convert]::FromBase64String(($m.Groups[1].Value -replace '\s', ''))
                    $dates += (New-Object System.Security.Cryptography.X509Certificates.X509Certificate2(, $bytes)).NotAfter
                }
            }
            if ($dates.Count) { return ($dates | Sort-Object | Select-Object -First 1) }
        } finally { $zip.Dispose() }
    } catch {}
    return $null
}

function Install-ViaVetro {
    param([string]$Ip, [string]$Wgt, [string]$AppId = "APLauncher.Home", [string]$Name = "APL Launcher", [switch]$NoLaunch)
    $base = "http://$Ip`:$(Get-VetroPort)"
    $tmp = "/tmp/apl-" + (($AppId -split '\.')[0]).ToLower() + ".wgt"
    # What the screen must show afterwards: an older package left in place still has the same id
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zip = [IO.Compression.ZipFile]::OpenRead($Wgt)
    try {
        $reader = New-Object IO.StreamReader($zip.GetEntry('config.xml').Open())
        $version = ([regex]::Match($reader.ReadToEnd(), '<widget[^>]*\sversion="([^"]+)"')).Groups[1].Value
        $reader.Close()
        $hybrid = [bool]$zip.GetEntry('tizen-manifest.xml')
    } finally { $zip.Dispose() }
    if (-not $version) { throw (Tr "$Wgt has no version in its config.xml." "$Wgt n'a pas de version dans son config.xml.") }
    $b64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes($Wgt))
    $chunk = 48000
    Invoke-VetroExec $base ": > $tmp.b64" | Out-Null
    for ($o = 0; $o -lt $b64.Length; $o += $chunk) {
        $part = $b64.Substring($o, [Math]::Min($chunk, $b64.Length - $o))
        Invoke-VetroExec $base "printf '%s' '$part' >> $tmp.b64" | Out-Null
        $pct = [int](100 * [Math]::Min($o + $chunk, $b64.Length) / $b64.Length)
        Write-Progress -Activity (Tr "Sending $Name to the screen" "Envoi de $Name vers l'écran") -PercentComplete $pct -Status "$pct %"
    }
    Write-Progress -Activity (Tr "Sending $Name to the screen" "Envoi de $Name vers l'écran") -Completed
    $sum = Invoke-VetroExec $base "base64 -d $tmp.b64 > $tmp && rm -f $tmp.b64 && chmod 644 $tmp && sha256sum $tmp"
    $local = (Get-FileHash -LiteralPath $Wgt -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($sum -notmatch $local) { throw (Tr "the package arrived damaged on the screen (different hash). Run the installation again." "le paquet est arrivé abîmé sur l'écran (empreinte différente). Relance l'installation.") }
    Write-Host (Tr "        Package copied to the screen and verified." "        Paquet copié sur l'écran et vérifié.") -ForegroundColor Green

    # 1) Samsung's install command (root, synchronous): shows the real reason if it fails.
    $pkg = ($AppId -split '\.')[0]
    $out = ""
    try { $out = Invoke-VetroExec $base "pkgcmd -i -t wgt -p $tmp 2>&1; echo exit=`$?" 120 }
    catch { $out = (Tr "pkgcmd: " "pkgcmd : ") + $_.Exception.Message }
    Write-Host (Tr "        Response from the screen:" "        Réponse de l'écran :") -ForegroundColor DarkGray
    Write-Host ($out.Trim() -replace '(?m)^', '          ')

    # 2) Check the screen's package list.
    function Test-Installed {
        try {
            $n = Invoke-VetroExec $base "pkgcmd -l 2>/dev/null | grep -iF '[$pkg]' | grep -cF 'version [$version]' || true"
            if (($n.Trim() -split '\s+')[-1] -in @('', '0')) { return $false }
            if (-not $hybrid) { return $true }
            $n = Invoke-VetroExec $base "app_launcher -l 2>/dev/null | grep -c '$pkg.Overlay' || true"
            return (($n.Trim() -split '\s+')[-1] -notin @('', '0'))
        } catch { return $false }
    }
    $found = Test-Installed
    if (-not $found) {
        # 3) Second attempt with Vetro's installer.
        try {
            $r = Invoke-RestMethod -Uri "$base/install" -Method Post -ContentType 'application/json' `
                -Body (@{ path = $tmp } | ConvertTo-Json -Compress) -TimeoutSec 180
            Write-Host ((Tr "        Vetro: " "        Vetro : ") + "$($r | ConvertTo-Json -Compress -Depth 3)") -ForegroundColor DarkGray
        } catch {
            Write-Host ((Tr "        Vetro: " "        Vetro : ") + "$($_.ErrorDetails.Message)$($_.Exception.Message)") -ForegroundColor DarkGray
        }
        for ($i = 0; $i -lt 5 -and -not $found; $i++) { Start-Sleep -Seconds 4; $found = Test-Installed }
    }
    try { Invoke-VetroExec $base "rm -f $tmp" | Out-Null } catch {}
    if (-not $found) {
        throw (Tr "the screen did not install $Name $version. Send me all the text above ('Response from the screen')." "l'écran n'a pas installé $Name $version. Envoie-moi tout le texte au-dessus (« Réponse de l'écran »).")
    }
    Write-Host (Tr "        $Name is installed." "        $Name est installé.") -ForegroundColor Green
    if ($NoLaunch) { return }
    try {
        Invoke-RestMethod -Uri "$base/apps/launch" -Method Post -ContentType 'application/json' `
            -Body (@{ appId = $AppId } | ConvertTo-Json -Compress) -TimeoutSec 25 | Out-Null
    } catch {}
}

function Write-Title {
    param([string]$Text)
    Write-Host ""
    Write-Host "==== $Text ====" -ForegroundColor Cyan
}
