# ============================================================
#  install-webos.ps1 — installs APL Launcher on an LG TV (webOS) from this PC.
#  Started by APL Launcher Setup (LG); also runs on its own in PowerShell.
#
#  Rooted TV (Homebrew Channel, SSH root / alpine):
#    .\scripts\install-webos.ps1 -TvIp 192.168.1.15 -Rooted
#  Not rooted (LG's Developer Mode app, Key Server on, its passphrase):
#    .\scripts\install-webos.ps1 -TvIp 192.168.1.15 -Passphrase A1B2C3
#
#  1. builds the package (.ipk) from launcher\ and webos\service\, with your keys and websites
#  2. connects to the TV (Windows' own ssh.exe: SSH root on a rooted TV, Developer Mode's key otherwise)
#  3. sends the package and installs it (LG's own installer, as ares-install does)
#  4. rooted only: the root scripts of webos\root (Home opens APL Launcher, picture settings, closing apps,
#     Guide = Control Center, debloat, updates blocked), from this PC: nothing is downloaded on the TV
#  5. opens APL Launcher
#  -CheckOnly: only says what this PC has (APL-CHECK). -PackageOnly: step 1 only (-OutFile).
# ============================================================
param(
    [string]$TvIp,
    [switch]$Rooted,
    [string]$Password,        # root's SSH password, base64 of its UTF-8 text (default: alpine)
    [string]$Passphrase,      # Developer Mode's passphrase (not rooted)
    [string]$Tmdb, [string]$YouTube, [string]$Fanart,
    [string]$Sites,           # websites as apps: JSON [{"name":"…","url":"https://…"}], or that JSON in base64
    [switch]$NoHome,          # rooted: Home keeps LG's Home
    [switch]$NoDebloat,       # rooted: LG's ads, tracking and extra services are left running
    [switch]$AplTv,           # also installs APL TV (the latest release of Knikt/APL-TV, its LG package)
    [switch]$FourK,           # the page drawn in 3840 x 2160 (sharper, less smooth) instead of 1920 x 1080
    [string]$AplTvRepo = "Knikt/APL-TV",
    [switch]$Unattended,
    [switch]$CheckOnly,
    [switch]$PackageOnly,
    [string]$OutFile,
    [string]$PersonalDir      # another launcher\ folder to take your fonts, sounds, avatars (and keys) from
)
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\lib.ps1"
$Root = Split-Path $PSScriptRoot -Parent
$Quiet = $Unattended -or $CheckOnly
$AppId = "com.knikt.apllauncher"
$ServiceId = "$AppId.service"
$Total = 4 + [int][bool]$Rooted + [int][bool]$AplTv
$script:StepN = 0
function NextStep([string]$txt) { $script:StepN++; Step $script:StepN $txt }

function Step([int]$n, [string]$txt) {
    Write-Host ""
    Write-Host "  [$n/$Total] $txt" -ForegroundColor Cyan
    Send-Gui "APL-STEP $n $Total $txt"
}
function Fail([string]$msg) {
    Write-Host ""
    Write-Host (Tr "  PROBLEM: $msg" "  PROBLÈME : $msg") -ForegroundColor Red
    if ($Quiet) { Send-Gui ("APL-RESULT fail " + ($msg -replace '\s*\r?\n\s*', ' ')); exit 1 }
    exit 1
}

# ---------- tar, ar and Developer Mode's key, in C# (compiled by Windows' own .NET) ----------
if (-not ('AplWebos' -as [type])) {
    Add-Type -ReferencedAssemblies System.IO.Compression, System.Core -Language CSharp -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Security.Cryptography;
using System.Text;

public sealed class AplTar
{
    private readonly MemoryStream ms = new MemoryStream();
    private readonly long mtime;
    public AplTar(long mtime) { this.mtime = mtime; }

    public void Dir(string path) { Header(path.TrimEnd('/') + "/", 0, '5', 493); }          // 0755
    public void File(string path, byte[] data, bool exec)
    {
        Header(path, data.Length, '0', exec ? 493 : 420);                                    // 0755 / 0644
        ms.Write(data, 0, data.Length);
        long r = data.Length % 512;
        if (r != 0) ms.Write(new byte[512 - r], 0, (int)(512 - r));
    }

    private void Header(string path, long size, char type, int mode)
    {
        string name, prefix;
        Split(path, out name, out prefix);
        var h = new byte[512];
        Put(h, 0, name, 100);
        Oct(h, 100, mode, 8); Oct(h, 108, 0, 8); Oct(h, 116, 0, 8);
        Oct(h, 124, size, 12); Oct(h, 136, mtime, 12);
        for (int i = 148; i < 156; i++) h[i] = 32;
        h[156] = (byte)type;
        Put(h, 257, "ustar", 6); h[263] = (byte)'0'; h[264] = (byte)'0';
        Put(h, 265, "root", 32); Put(h, 297, "root", 32);
        Put(h, 345, prefix, 155);
        long sum = 0;
        foreach (byte b in h) sum += b;
        Put(h, 148, Convert.ToString(sum, 8).PadLeft(6, '0'), 6);
        h[154] = 0; h[155] = 32;
        ms.Write(h, 0, 512);
    }

    private static void Split(string path, out string name, out string prefix)
    {
        name = path; prefix = "";
        if (Encoding.UTF8.GetByteCount(path) <= 100) return;
        for (int i = path.Length - 2; i > 0; i--)
        {
            if (path[i] != '/') continue;
            string p = path.Substring(0, i), n = path.Substring(i + 1);
            if (Encoding.UTF8.GetByteCount(n) <= 100 && Encoding.UTF8.GetByteCount(p) <= 155) { name = n; prefix = p; return; }
        }
        throw new InvalidOperationException("Path too long for the package: " + path);
    }

    private static void Put(byte[] h, int off, string s, int len)
    {
        byte[] b = Encoding.UTF8.GetBytes(s);
        Array.Copy(b, 0, h, off, Math.Min(b.Length, len));
    }

    private static void Oct(byte[] h, int off, long v, int len)
    {
        Put(h, off, Convert.ToString(v, 8).PadLeft(len - 1, '0'), len - 1);
        h[off + len - 1] = 0;
    }

    public byte[] Tar()
    {
        var o = new MemoryStream();
        ms.WriteTo(o);
        o.Write(new byte[1024], 0, 1024);
        return o.ToArray();
    }

    public byte[] TarGz()
    {
        byte[] t = Tar();
        var o = new MemoryStream();
        using (var gz = new GZipStream(o, CompressionLevel.Optimal, true)) gz.Write(t, 0, t.Length);
        return o.ToArray();
    }
}

public static class AplWebos
{
    /// <summary>An .ipk: an ar archive of debian-binary, control.tar.gz and data.tar.gz (what ares-package makes).</summary>
    public static void WriteAr(string outFile, string[] names, byte[][] datas, long mtime)
    {
        using (var f = System.IO.File.Create(outFile))
        {
            byte[] magic = Encoding.ASCII.GetBytes("!<arch>\n");
            f.Write(magic, 0, magic.Length);
            for (int i = 0; i < names.Length; i++)
            {
                string h = names[i].PadRight(16) + mtime.ToString().PadRight(12) + "0".PadRight(6) + "0".PadRight(6) +
                           "100644".PadRight(8) + datas[i].Length.ToString().PadRight(10) + "`\n";
                byte[] hb = Encoding.ASCII.GetBytes(h);
                f.Write(hb, 0, hb.Length);
                f.Write(datas[i], 0, datas[i].Length);
                if (datas[i].Length % 2 == 1) f.WriteByte((byte)'\n');
            }
        }
    }

    /// <summary>Developer Mode's private key (http://tv:9991/webos_rsa), decrypted with the passphrase the
    /// Developer Mode app shows: an unencrypted PEM key for ssh.exe.</summary>
    public static string DecryptPem(string pem, string pass)
    {
        string dek = null;
        var b64 = new StringBuilder();
        bool began = false;
        foreach (string raw in pem.Replace("\r", "").Split('\n'))
        {
            string l = raw.Trim();
            if (l.StartsWith("-----BEGIN"))
            {
                if (l.Contains("ENCRYPTED PRIVATE KEY") || l.Contains("OPENSSH")) throw new InvalidOperationException("unsupported key format: " + l);
                began = true; continue;
            }
            if (l.StartsWith("-----END")) break;
            if (!began || l.Length == 0 || l.StartsWith("Proc-Type:")) continue;
            if (l.StartsWith("DEK-Info:")) { dek = l.Substring(9).Trim(); continue; }
            b64.Append(l);
        }
        if (!began) throw new InvalidOperationException("no key in the answer");
        byte[] der = Convert.FromBase64String(b64.ToString());
        if (dek != null)
        {
            string[] parts = dek.Split(',');
            string alg = parts[0].Trim().ToUpperInvariant();
            byte[] iv = Hex(parts[1].Trim());
            int keyLen = alg == "AES-128-CBC" ? 16 : alg == "AES-192-CBC" ? 24 : alg == "AES-256-CBC" ? 32 : alg == "DES-EDE3-CBC" ? 24 : 0;
            if (keyLen == 0) throw new InvalidOperationException("unsupported key cipher: " + alg);
            byte[] key = BytesToKey(Encoding.UTF8.GetBytes(pass ?? ""), iv.Take(8).ToArray(), keyLen);
            SymmetricAlgorithm c = alg.StartsWith("AES") ? (SymmetricAlgorithm)Aes.Create() : TripleDES.Create();
            c.Mode = CipherMode.CBC; c.Padding = PaddingMode.PKCS7; c.Key = key; c.IV = iv;
            try { der = c.CreateDecryptor().TransformFinalBlock(der, 0, der.Length); }
            catch (CryptographicException) { throw new UnauthorizedAccessException("wrong passphrase"); }
            if (der.Length < 2 || der[0] != 0x30) throw new UnauthorizedAccessException("wrong passphrase");
        }
        string body = Convert.ToBase64String(der);
        var sb = new StringBuilder("-----BEGIN RSA PRIVATE KEY-----\n");
        for (int i = 0; i < body.Length; i += 64) sb.Append(body.Substring(i, Math.Min(64, body.Length - i))).Append('\n');
        return sb.Append("-----END RSA PRIVATE KEY-----\n").ToString();
    }

    private static byte[] BytesToKey(byte[] pass, byte[] salt, int len)
    {
        var outp = new List<byte>();
        byte[] prev = new byte[0];
        using (var md5 = MD5.Create())
        {
            while (outp.Count < len)
            {
                prev = md5.ComputeHash(prev.Concat(pass).Concat(salt).ToArray());
                outp.AddRange(prev);
            }
        }
        return outp.Take(len).ToArray();
    }

    private static byte[] Hex(string s)
    {
        var b = new byte[s.Length / 2];
        for (int i = 0; i < b.Length; i++) b[i] = Convert.ToByte(s.Substring(i * 2, 2), 16);
        return b;
    }
}
'@
}

# ---------- Windows' own ssh.exe (OpenSSH, in Windows 10 and 11) ----------
# A password is handed to it without a console through SSH_ASKPASS, which needs OpenSSH 8.4 or later
# (Windows 11; Windows 10 has 8.1, then Git for Windows' ssh.exe is used when it is there).
function Get-SshVersion([string]$exe) {
    try {
        $r = Invoke-Native $exe @('-V')
        $m = [regex]::Match($r.Output, 'OpenSSH[_A-Za-z]*_(\d+)\.(\d+)')
        if ($m.Success) { return [version]("{0}.{1}" -f $m.Groups[1].Value, $m.Groups[2].Value) }
    } catch {}
    return $null
}
function Find-Ssh([bool]$NeedAskPass) {
    $list = @("$env:WINDIR\System32\OpenSSH\ssh.exe", "$env:WINDIR\Sysnative\OpenSSH\ssh.exe",
              "$env:ProgramFiles\Git\usr\bin\ssh.exe", "${env:ProgramFiles(x86)}\Git\usr\bin\ssh.exe")
    $found = @()
    foreach ($c in $list) {
        if (-not $c -or -not (Test-Path -LiteralPath $c)) { continue }
        $v = Get-SshVersion $c
        if (-not $v) { continue }
        $found += [pscustomobject]@{ Path = $c; Version = $v; Git = ($c -match '\\Git\\') }
    }
    if (-not $NeedAskPass) { return ($found | Select-Object -First 1) }
    return ($found | Where-Object { $_.Version -ge [version]"8.4" } | Select-Object -First 1)
}

function Quote-Arg([string]$a) {
    if ($a -notmatch '[\s"]') { return $a }
    return '"' + ($a -replace '(\\*)"', '$1$1\"' -replace '(\\+)$', '$1$1') + '"'
}

# One command on the TV. -InputFile goes to its standard input (a package, an archive);
# -Script is a shell script sent the same way (no quoting through the command line).
function Invoke-TvSsh {
    param([string]$Command, [string]$InputFile, [string]$Script, [int]$TimeoutSec = 180)
    $a = New-Object Collections.Generic.List[string]
    $known = if ($script:SshGit) { '/dev/null' } else { 'NUL' }
    foreach ($o in @('StrictHostKeyChecking=no', "UserKnownHostsFile=$known", 'LogLevel=ERROR', 'ConnectTimeout=10', 'ServerAliveInterval=15')) { $a.Add('-o'); $a.Add($o) }
    if ($script:KeyFile) {
        foreach ($o in @('PasswordAuthentication=no', 'IdentitiesOnly=yes', 'PubkeyAcceptedKeyTypes=+ssh-rsa', 'HostKeyAlgorithms=+ssh-rsa')) { $a.Add('-o'); $a.Add($o) }
        $a.Add('-i'); $a.Add($script:KeyFile); $a.Add('-p'); $a.Add('9922'); $a.Add("prisoner@$TvIp")
    } else {
        foreach ($o in @('PreferredAuthentications=password,keyboard-interactive', 'PubkeyAuthentication=no', 'NumberOfPasswordPrompts=1')) { $a.Add('-o'); $a.Add($o) }
        $a.Add('-p'); $a.Add('22'); $a.Add("root@$TvIp")
    }
    $a.Add($Command)
    $psi = New-Object Diagnostics.ProcessStartInfo
    $psi.FileName = $script:Ssh
    $psi.Arguments = ($a | ForEach-Object { Quote-Arg $_ }) -join ' '
    $psi.UseShellExecute = $false
    $psi.RedirectStandardInput = $true; $psi.RedirectStandardOutput = $true; $psi.RedirectStandardError = $true
    $psi.CreateNoWindow = $true
    if (-not $script:KeyFile) {
        $psi.EnvironmentVariables['SSH_ASKPASS'] = $script:AskPass
        $psi.EnvironmentVariables['SSH_ASKPASS_REQUIRE'] = 'force'
        $psi.EnvironmentVariables['DISPLAY'] = 'apl:0'
        $psi.EnvironmentVariables['APL_SSH_PW'] = $script:Pw
    }
    $p = [Diagnostics.Process]::Start($psi)
    $out = $p.StandardOutput.ReadToEndAsync()
    $err = $p.StandardError.ReadToEndAsync()
    try {
        if ($InputFile) {
            $fs = [IO.File]::OpenRead($InputFile)
            try { $fs.CopyTo($p.StandardInput.BaseStream) } finally { $fs.Close() }
        } elseif ($Script) {
            $bytes = (New-Object Text.UTF8Encoding($false)).GetBytes(($Script -replace "`r`n", "`n"))
            $p.StandardInput.BaseStream.Write($bytes, 0, $bytes.Length)
        }
        $p.StandardInput.Close()
    } catch {}
    if (-not $p.WaitForExit($TimeoutSec * 1000)) {
        try { $p.Kill() } catch {}
        throw (Tr "The TV did not answer in time ($TimeoutSec s)." "La TV n'a pas répondu à temps ($TimeoutSec s).")
    }
    $p.WaitForExit()
    [pscustomobject]@{ Code = $p.ExitCode; Out = $out.Result; Err = $err.Result }
}

# ---------- -CheckOnly: what this PC has ----------
if ($CheckOnly) {
    $any = Find-Ssh $false
    $pw = Find-Ssh $true
    $check = [ordered]@{
        ssh = $(if ($any) { $any.Path } else { $null })
        sshVersion = $(if ($any) { $any.Version.ToString() } else { $null })
        password = $(if ($pw) { $pw.Path } else { $null })
        version = $null
    }
    $cfg = Join-Path $Root "launcher\config.xml"
    if (Test-Path -LiteralPath $cfg) { $check.version = ([regex]::Match([IO.File]::ReadAllText($cfg), '<widget[^>]*\sversion="([^"]+)"')).Groups[1].Value }
    Send-Gui ("APL-CHECK " + ($check | ConvertTo-Json -Compress))
    if (-not $script:Gui) { $check | Format-List }
    exit 0
}

if (-not $PackageOnly) {
    try { Test-TvIp $TvIp } catch { Fail $_.Exception.Message }
}

Write-Host ""
Write-Host "  ==============================================" -ForegroundColor White
Write-Host (Tr "        APL Launcher - install on an LG TV" "        APL Launcher - installation sur une TV LG") -ForegroundColor White
Write-Host "  ==============================================" -ForegroundColor White

# ---------- 1. the package ----------
NextStep (Tr "Building the package with your settings…" "Fabrication du paquet avec tes réglages…")
$L = Join-Path $Root "launcher"
$config = [IO.File]::ReadAllText((Join-Path $L "config.xml"))
$version = ([regex]::Match($config, '<widget[^>]*\sversion="([^"]+)"')).Groups[1].Value
if (-not $version) { Fail (Tr "No version in launcher\config.xml." "Pas de version dans launcher\config.xml.") }

# Keys and websites: the same keys.local.js as on Samsung (kept in %APPDATA%\APL-Launcher for next time)
$keysSaved = Join-Path $env:APPDATA "APL-Launcher\keys.local.js"
$keysJs = $null
if ($Unattended) {
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
    $keysJs = "window.APL_KEYS = {`r`n    tmdb: `"$(& $clean $Tmdb)`",`r`n    youtube: `"$(& $clean $YouTube)`",`r`n    fanart: `"$(& $clean $Fanart)`",`r`n    webApps: [" + ($list -join ", ") + "]`r`n};`r`n"
    New-Item -ItemType Directory -Force -Path (Split-Path $keysSaved -Parent) | Out-Null
    [IO.File]::WriteAllText($keysSaved, $keysJs, (New-Object Text.UTF8Encoding($false)))
} elseif ($PersonalDir -and (Test-Path -LiteralPath (Join-Path $PersonalDir "js\keys.local.js"))) {
    $keysJs = [IO.File]::ReadAllText((Join-Path $PersonalDir "js\keys.local.js"))
} elseif (Test-Path -LiteralPath (Join-Path $L "js\keys.local.js")) {
    $keysJs = [IO.File]::ReadAllText((Join-Path $L "js\keys.local.js"))
} elseif (Test-Path -LiteralPath $keysSaved) {
    $keysJs = [IO.File]::ReadAllText($keysSaved)
} else {
    $keysJs = [IO.File]::ReadAllText((Join-Path $L "js\keys.example.js"))
}

$utf8 = New-Object Text.UTF8Encoding($false)
$mtime = [long]([DateTimeOffset]::UtcNow.ToUnixTimeSeconds())
$data = New-Object AplTar($mtime)
$appBase = "usr/palm/applications/$AppId"
$svcBase = "usr/palm/services/$ServiceId"
$pkgBase = "usr/palm/packages/$AppId"
foreach ($d in @('usr', 'usr/palm', 'usr/palm/applications', 'usr/palm/packages', 'usr/palm/services', $appBase, $pkgBase, $svcBase)) { $data.Dir($d) }
$installed = 0
function Add-Bytes([string]$path, [byte[]]$bytes, [bool]$exec = $false) { $data.File($path, $bytes, $exec); $script:installed += $bytes.Length }

# The launcher: everything in launcher\ but Samsung's own files (as tools/make-webos.py does). Personal
# files that are on this PC (fonts, sounds, avatars) go in, as on Samsung; the keys come from above.
$skipTop = @('config.xml', 'bridge', 'version.json', '.manifest.tmp', 'author-signature.xml', 'signature1.xml')
$skipFiles = @('js/keys.local.js', 'js/keys.example.js')
$dirsDone = @{}
$files = Get-ChildItem -LiteralPath $L -Recurse -File | Sort-Object FullName
$count = 0
foreach ($f in $files) {
    $rel = $f.FullName.Substring($L.Length + 1) -replace '\\', '/'
    if ($skipTop -contains $rel.Split('/')[0] -or $rel -like '*.wgt' -or $skipFiles -contains $rel) { continue }
    if ($rel -eq 'index.html') { continue }
    $parts = $rel.Split('/')
    for ($i = 1; $i -lt $parts.Length; $i++) {
        $dir = ($parts[0..($i - 1)] -join '/')
        if (-not $dirsDone.ContainsKey($dir)) { $data.Dir("$appBase/$dir"); $dirsDone[$dir] = 1 }
    }
    Add-Bytes "$appBase/$rel" ([IO.File]::ReadAllBytes($f.FullName))
    $count++
}
# -PersonalDir: your own files from another launcher\ folder (a clone's worktree has none of its own)
$isPersonal = { param($rel) (($rel -like 'fonts/*' -or $rel -like 'sounds/*') -and $rel -notmatch '\.(css|md|txt)$') -or $rel -like 'images/avatars/custom/*' -or $rel -like 'images/avatars/memoji/*' -or $rel -eq 'js/avatars.local.js' }
if ($PersonalDir -and (Test-Path -LiteralPath $PersonalDir)) {
    $PersonalDir = (Resolve-Path -LiteralPath $PersonalDir).Path.TrimEnd('\')
    foreach ($f in (Get-ChildItem -LiteralPath $PersonalDir -Recurse -File | Sort-Object FullName)) {
        $rel = $f.FullName.Substring($PersonalDir.Length + 1) -replace '\\', '/'
        if (-not (& $isPersonal $rel)) { continue }
        if (Test-Path -LiteralPath (Join-Path $L ($rel -replace '/', '\'))) { continue }   # already in
        $parts = $rel.Split('/')
        for ($i = 1; $i -lt $parts.Length; $i++) {
            $dir = ($parts[0..($i - 1)] -join '/')
            if (-not $dirsDone.ContainsKey($dir)) { $data.Dir("$appBase/$dir"); $dirsDone[$dir] = 1 }
        }
        Add-Bytes "$appBase/$rel" ([IO.File]::ReadAllBytes($f.FullName))
        $count++
    }
}
# index.html without Samsung's API script (it does not exist on LG)
$html = [IO.File]::ReadAllText((Join-Path $L "index.html"))
$html = [regex]::Replace($html, '\s*<!-- Samsung API[^>]*-->\s*<script src="\$WEBAPIS/webapis/webapis\.js"></script>', '')
if ($html.Contains('$WEBAPIS')) { Fail "index.html: Samsung's script line was not found (tools/make-webos.py and this script must be updated)." }
Add-Bytes "$appBase/index.html" $utf8.GetBytes($html)
Add-Bytes "$appBase/js/keys.local.js" $utf8.GetBytes($keysJs)

# Icons 80 and 130 px (LG's sizes) and the splash: the logo on black
Add-Type -AssemblyName System.Drawing
function Get-Png([Drawing.Image]$src, [int]$w, [int]$h, [int]$logo) {
    $bmp = New-Object Drawing.Bitmap($w, $h, [Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [Drawing.Graphics]::FromImage($bmp)
    $g.InterpolationMode = 'HighQualityBicubic'; $g.PixelOffsetMode = 'HighQuality'; $g.SmoothingMode = 'AntiAlias'; $g.CompositingQuality = 'HighQuality'
    if ($logo -gt 0) { $g.Clear([Drawing.Color]::Black); $g.DrawImage($src, [int](($w - $logo) / 2), [int](($h - $logo) / 2), $logo, $logo) }
    else { $g.DrawImage($src, 0, 0, $w, $h) }
    $g.Dispose()
    $ms = New-Object IO.MemoryStream
    $bmp.Save($ms, [Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    return $ms.ToArray()
}
$icon = [Drawing.Image]::FromFile((Join-Path $L "icon.png"))
try {
    Add-Bytes "$appBase/icon-80.png" (Get-Png $icon 80 80 0)
    Add-Bytes "$appBase/icon-130.png" (Get-Png $icon 130 130 0)
    Add-Bytes "$appBase/splash.png" (Get-Png $icon 1920 1080 300)
} finally { $icon.Dispose() }

$appinfo = [ordered]@{
    id = $AppId; version = $version; vendor = "Knikt (Gero Corp.)"; type = "web"; main = "index.html"; title = "APL Launcher"
    icon = "icon-80.png"; largeIcon = "icon-130.png"; splashBackground = "splash.png"; bgColor = "#000000"; iconColor = "#1c1c1e"
    resolution = $(if ($FourK) { "3840x2160" } else { "1920x1080" }); disableBackHistoryAPI = $true; handlesRelaunch = $true; transparent = $false; appDescription = "Apple TV style Home Screen"
}
Add-Bytes "$appBase/appinfo.json" $utf8.GetBytes(($appinfo | ConvertTo-Json))

# The helper service (webos\service)
foreach ($f in @('index.js', 'ssap.js')) {
    $src = Join-Path $Root "webos\service\$f"
    if (-not (Test-Path -LiteralPath $src)) { Fail (Tr "Missing file: webos\service\$f" "Fichier manquant : webos\service\$f") }
    Add-Bytes "$svcBase/$f" ([IO.File]::ReadAllBytes($src))
}
Add-Bytes "$svcBase/package.json" $utf8.GetBytes(([ordered]@{ name = $ServiceId; version = $version; main = "index.js"; description = "APL Launcher helper" } | ConvertTo-Json))
$svcJson = [ordered]@{ id = $ServiceId; description = "LG Connect Apps relay and sleep timer for APL Launcher"; services = @([ordered]@{ name = $ServiceId; description = "APL Launcher helper" }) }
Add-Bytes "$svcBase/services.json" $utf8.GetBytes(($svcJson | ConvertTo-Json -Depth 4))
Add-Bytes "$pkgBase/packageinfo.json" $utf8.GetBytes(([ordered]@{ id = $AppId; version = $version; app = $AppId; services = @($ServiceId) } | ConvertTo-Json))

$control = "Package: $AppId`nVersion: $version`nSection: misc`nPriority: optional`nArchitecture: all`nInstalled-Size: $installed`nMaintainer: Knikt (Gero Corp.)`nDescription: APL Launcher, an Apple TV style Home Screen`nwebOS-Package-Format-Version: 2`nwebOS-Packager-Version: x.y.x`n"
$ctl = New-Object AplTar($mtime)
$ctl.File('control', $utf8.GetBytes($control), $false)

if (-not $OutFile) { $OutFile = Join-Path $Root "dist\webos\${AppId}_${version}_all.ipk" }
New-Item -ItemType Directory -Force -Path (Split-Path $OutFile -Parent) | Out-Null
[AplWebos]::WriteAr($OutFile, [string[]]@('debian-binary', 'control.tar.gz', 'data.tar.gz'),
                    [byte[][]]@($utf8.GetBytes("2.0`n"), $ctl.TarGz(), $data.TarGz()), $mtime)
$ipkSize = (Get-Item -LiteralPath $OutFile).Length
$ipkHash = (Get-FileHash -LiteralPath $OutFile -Algorithm SHA256).Hash.ToLowerInvariant()
Write-Host (Tr "        APL Launcher ${version}: $count files, $([Math]::Round($ipkSize / 1MB, 1)) MB" "        APL Launcher $version : $count fichiers, $([Math]::Round($ipkSize / 1MB, 1)) Mo") -ForegroundColor Green
if ($PackageOnly) {
    Write-Host "        $OutFile"
    if ($Quiet) { Send-Gui "APL-RESULT ok" }
    exit 0
}

# ---------- 2. connect ----------
NextStep (Tr "Connecting to the TV ($TvIp)…" "Connexion à la TV ($TvIp)…")
$work = Join-Path $env:LOCALAPPDATA "APL-Launcher\webos"
New-Item -ItemType Directory -Force -Path $work | Out-Null
$script:KeyFile = $null
if ($Rooted) {
    $ssh = Find-Ssh $true
    if (-not $ssh) {
        Fail (Tr "This PC's SSH client can't be given a password on its own (OpenSSH 8.4 or later is needed: Windows 11, or Git for Windows)." "Le client SSH de ce PC ne peut pas recevoir le mot de passe tout seul (il faut OpenSSH 8.4 ou plus : Windows 11, ou Git pour Windows).")
    }
    $script:Ssh = $ssh.Path; $script:SshGit = $ssh.Git
    $script:Pw = 'alpine'
    if ($Password) { try { $script:Pw = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($Password)) } catch { $script:Pw = $Password } }
    $script:AskPass = Join-Path $work "askpass.cmd"
    [IO.File]::WriteAllText($script:AskPass, "@echo off`r`npowershell.exe -NoProfile -NonInteractive -Command `"[Console]::Out.WriteLine(`$env:APL_SSH_PW)`"`r`n", (New-Object Text.ASCIIEncoding))
    Write-Host "        SSH: $($ssh.Path) (OpenSSH $($ssh.Version))"
    $r = Invoke-TvSsh -Command 'id -u; test -d /var/lib/webosbrew && echo hbc' -TimeoutSec 40
    if ($r.Code -ne 0) {
        if ($r.Err -match 'denied|Permission') { Fail (Tr "The TV refused the SSH password. Check root's password (alpine by default) in the Homebrew Channel." "La TV a refusé le mot de passe SSH. Vérifie le mot de passe de root (alpine par défaut) dans le Homebrew Channel.") }
        Fail (Tr "No SSH answer from $TvIp. Is the TV on and rooted, with SSH on in the Homebrew Channel? ($($r.Err.Trim()))" "Pas de réponse SSH de $TvIp. La TV est-elle allumée et rootée, avec SSH activé dans le Homebrew Channel ? ($($r.Err.Trim()))")
    }
    if ($r.Out -notmatch '(?m)^0\s*$') { Fail (Tr "SSH works but not as root: this TV isn't rooted." "Le SSH marche mais pas en root : cette TV n'est pas rootée.") }
    if ($r.Out -notmatch 'hbc') { Fail (Tr "The Homebrew Channel is not on this TV (/var/lib/webosbrew is missing)." "Le Homebrew Channel n'est pas sur cette TV (/var/lib/webosbrew manque).") }
    Write-Host (Tr "        Rooted TV, Homebrew Channel found." "        TV rootée, Homebrew Channel trouvé.") -ForegroundColor Green
    $tvDir = '/tmp'; $luna = 'luna-send'
} else {
    $ssh = Find-Ssh $false
    if (-not $ssh) { Fail (Tr "No SSH client on this PC (Windows' OpenSSH client: Settings › System › Optional features)." "Pas de client SSH sur ce PC (client OpenSSH de Windows : Paramètres › Système › Fonctionnalités facultatives).") }
    $script:Ssh = $ssh.Path; $script:SshGit = $ssh.Git
    if (-not $Passphrase) { Fail (Tr "Type the passphrase shown in the Developer Mode app." "Tape la phrase secrète affichée dans l'app Developer Mode.") }
    try {
        try { [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12 } catch {}
        $pem = (Invoke-WebRequest -UseBasicParsing -Uri "http://${TvIp}:9991/webos_rsa" -TimeoutSec 10).Content
        if ($pem -is [byte[]]) { $pem = [Text.Encoding]::ASCII.GetString($pem) }
    } catch {
        Fail (Tr "The TV's Key Server doesn't answer. In the Developer Mode app, turn on Key Server, then try again." "Le Key Server de la TV ne répond pas. Dans l'app Developer Mode, active Key Server, puis réessaie.")
    }
    try { $plain = [AplWebos]::DecryptPem($pem, $Passphrase.Trim()) }
    catch [UnauthorizedAccessException] { Fail (Tr "Wrong passphrase: type the one the Developer Mode app shows (capital letters and digits)." "Mauvaise phrase secrète : tape celle de l'app Developer Mode (majuscules et chiffres).") }
    catch { Fail (Tr "The TV's key could not be read: $($_.Exception.Message)" "La clé de la TV n'a pas pu être lue : $($_.Exception.Message)") }
    $script:KeyFile = Join-Path $work ("devmode-" + ($TvIp -replace '\.', '-') + ".key")
    if (Test-Path -LiteralPath $script:KeyFile) { Remove-Item -LiteralPath $script:KeyFile -Force }
    [IO.File]::WriteAllText($script:KeyFile, $plain, (New-Object Text.ASCIIEncoding))
    # ssh.exe refuses a key that other accounts can read
    & icacls.exe $script:KeyFile /inheritance:r /grant:r "$($env:USERNAME):F" | Out-Null
    $r = Invoke-TvSsh -Command 'echo ok' -TimeoutSec 40
    if ($r.Code -ne 0 -or $r.Out -notmatch 'ok') {
        Fail (Tr "Developer Mode's SSH (port 9922) did not accept the key. Check that Developer Mode is on, then try again. ($($r.Err.Trim()))" "Le SSH du mode développeur (port 9922) n'a pas accepté la clé. Vérifie que le mode développeur est actif, puis réessaie. ($($r.Err.Trim()))")
    }
    Write-Host (Tr "        Developer Mode answers." "        Le mode développeur répond.") -ForegroundColor Green
    $tvDir = '/media/developer/temp'; $luna = 'luna-send-pub'
}
Save-TvIp $TvIp -Name "webos-ip.txt"

# ---------- 3. send and install ----------
NextStep (Tr "Installing APL Launcher on the TV…" "Installation d'APL Launcher sur la TV…")
# Sends a package and installs it with LG's own installer (as ares-install does). Returns "" or why it failed.
function Install-IpkOnTv([string]$LocalIpk, [string]$Name) {
    $hash = (Get-FileHash -LiteralPath $LocalIpk -Algorithm SHA256).Hash.ToLowerInvariant()
    $size = (Get-Item -LiteralPath $LocalIpk).Length
    $onTv = "$tvDir/$Name.ipk"
    $r = Invoke-TvSsh -Command "mkdir -p $tvDir && cat > $onTv && sha256sum $onTv" -InputFile $LocalIpk -TimeoutSec 300
    if ($r.Code -ne 0 -or $r.Out -notmatch $hash) {
        return (Tr "the package did not arrive whole on the TV ($($r.Err.Trim()))" "le paquet n'est pas arrivé entier sur la TV ($($r.Err.Trim()))")
    }
    Write-Host (Tr "        Package sent ($([Math]::Round($size / 1MB, 1)) MB), checked." "        Paquet envoyé ($([Math]::Round($size / 1MB, 1)) Mo), vérifié.")
    $installScript = @"
IPK=$onTv
LOG=$tvDir/$Name.log
rm -f `$LOG
$luna -i luna://com.webos.appInstallService/dev/install '{"id":"com.ares.defaultName","ipkUrl":"$onTv","subscribe":true}' > `$LOG 2>&1 &
PID=`$!
i=0
while [ `$i -lt 240 ]; do
    sleep 1; i=`$((i+1))
    if grep -qi 'install failed\|"returnValue": *false\|errorText' `$LOG; then kill `$PID 2>/dev/null; cat `$LOG; rm -f `$IPK; echo APL-INSTALL-FAILED; exit 1; fi
    if grep -q '"installed"' `$LOG; then kill `$PID 2>/dev/null; rm -f `$IPK `$LOG; echo APL-INSTALL-OK; exit 0; fi
done
kill `$PID 2>/dev/null; cat `$LOG; rm -f `$IPK; echo APL-INSTALL-TIMEOUT; exit 1
"@
    $r = Invoke-TvSsh -Command 'sh -s' -Script $installScript -TimeoutSec 300
    if ($r.Out -notmatch 'APL-INSTALL-OK') {
        return (($r.Out -split "`n" | Where-Object { $_ -match 'errorText|failed|reason' } | Select-Object -First 2) -join ' ')
    }
    return ""
}
$why = Install-IpkOnTv $OutFile "apl-launcher-setup"
if ($why) { Fail (Tr "The TV did not install the package: $why" "La TV n'a pas installé le paquet : $why") }
Write-Host (Tr "        Installed." "        Installé.") -ForegroundColor Green

# ---------- APL TV (optional: never stops the install) ----------
if ($AplTv) {
    NextStep (Tr "Installing APL TV…" "Installation d'APL TV…")
    $done = $false
    try {
        try { [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12 } catch {}
        $rel = Invoke-RestMethod -UseBasicParsing -Uri "https://api.github.com/repos/$AplTvRepo/releases/latest" -Headers @{ 'User-Agent' = 'APL-Launcher-Setup' } -TimeoutSec 60
        $asset = @($rel.assets) | Where-Object { $_.name -match '^apl-tv-v.*-lg-webos\.ipk$' } | Select-Object -First 1
        if (-not $asset) { throw (Tr "APL TV $($rel.tag_name) has no LG package" "APL TV $($rel.tag_name) n'a pas de paquet LG") }
        $tvIpk = Join-Path $work $asset.name
        Invoke-WebRequest -UseBasicParsing -Uri $asset.browser_download_url -OutFile $tvIpk -TimeoutSec 300
        $sums = @($rel.assets) | Where-Object { $_.name -eq 'SHA256SUMS-ipk.txt' } | Select-Object -First 1
        if ($sums) {
            $txt = (Invoke-WebRequest -UseBasicParsing -Uri $sums.browser_download_url -TimeoutSec 60).Content
            if ($txt -is [byte[]]) { $txt = [Text.Encoding]::ASCII.GetString($txt) }
            $want = ([regex]::Match($txt, '([0-9a-fA-F]{64})\s+\*?' + [regex]::Escape($asset.name))).Groups[1].Value.ToLowerInvariant()
            if ($want -and $want -ne (Get-FileHash -LiteralPath $tvIpk -Algorithm SHA256).Hash.ToLowerInvariant()) { throw (Tr "the download is damaged (SHA256)" "le téléchargement est abîmé (SHA256)") }
        }
        Write-Host "        $($asset.name)"
        $why = Install-IpkOnTv $tvIpk "apl-tv-setup"
        if ($why) { throw $why }
        $done = $true
        Write-Host (Tr "        APL TV installed: open it from the dock or LG's app list." "        APL TV installé : ouvre-le depuis le dock ou la liste des apps LG.") -ForegroundColor Green
    } catch {
        Write-Host (Tr "        APL TV could not be installed ($($_.Exception.Message)). APL Launcher is fine; APL TV can be installed later from its releases." "        APL TV n'a pas pu être installé ($($_.Exception.Message)). APL Launcher est bien installé ; APL TV peut s'installer plus tard depuis ses versions.") -ForegroundColor Yellow
    }
}

# ---------- 4. rooted: the root scripts ----------
if ($Rooted) {
    NextStep (Tr "Root features: Home, picture settings, debloat…" "Fonctions root : Home, réglages d'image, debloat…")
    $rootDir = Join-Path $Root "webos\root"
    $tar = New-Object AplTar($mtime)
    $rdone = @{}
    foreach ($f in (Get-ChildItem -LiteralPath $rootDir -Recurse -File | Sort-Object FullName)) {
        $rel = $f.FullName.Substring($rootDir.Length + 1) -replace '\\', '/'
        if ($rel -like '*.md') { continue }
        $parts = $rel.Split('/')
        for ($i = 1; $i -lt $parts.Length; $i++) { $dir = ($parts[0..($i - 1)] -join '/'); if (-not $rdone.ContainsKey($dir)) { $tar.Dir($dir); $rdone[$dir] = 1 } }
        $bytes = [IO.File]::ReadAllBytes($f.FullName)
        $isText = $rel -like '*.sh' -or $rel -like 'init.d/*' -or $rel -like '*.html' -or $rel -like '*.json'
        if ($isText) { $bytes = $utf8.GetBytes(([Text.Encoding]::UTF8.GetString($bytes) -replace "`r`n", "`n").TrimStart([char]0xFEFF)) }
        $tar.File($rel, $bytes, ($rel -like '*.sh' -or $rel -like 'init.d/*'))
    }
    $tarFile = Join-Path $work "apl-root.tar"
    [IO.File]::WriteAllBytes($tarFile, $tar.Tar())
    $r = Invoke-TvSsh -Command 'rm -rf /tmp/apl-root && mkdir -p /tmp/apl-root && tar -x -C /tmp/apl-root && echo APL-SENT' -InputFile $tarFile -TimeoutSec 120
    if ($r.Out -notmatch 'APL-SENT') { Fail (Tr "The root scripts did not arrive on the TV. ($($r.Err.Trim()))" "Les scripts root ne sont pas arrivés sur la TV. ($($r.Err.Trim()))") }
    # OFF-noload / OFF-preload: LG's apps opened in the background on their own (LG Channels, the preload
    # manager) are part of the debloat
    $offDebloat = 'OFF-ads OFF-tracking OFF-logs OFF-suggestions OFF-services OFF-noload OFF-preload'
    $rootScript = @"
A=/media/developer/apl-debloat
APL_SRC=/tmp/apl-root sh /tmp/apl-root/install.sh || { echo APL-ROOT-FAILED; exit 1; }
cd `$A
rm -f OFF OFF-root
$(if ($NoDebloat) { "touch $offDebloat" } else { "rm -f $offDebloat" })
$(if ($NoHome) { 'touch OFF-home' } else { 'rm -f OFF-home' })
sh /var/lib/webosbrew/init.d/10-apl-block-updates
sh /var/lib/webosbrew/init.d/11-apl-block-privacy
$(if (-not $NoDebloat) { "sh `$A/apl-debloat-stop.sh; sh `$A/apl-services-stop.sh" })
$(if (-not $NoDebloat) { @'
# now too, not only at the next start: LG Channels covered, LG's preloading off. Their loops (every 10 min)
# start again from the new scripts.
for n in noload preload; do
    if [ -f /tmp/apl-$n.pid ]; then kill "$(cat /tmp/apl-$n.pid)" 2>/dev/null; rm -f /tmp/apl-$n.pid; fi
done
sh /var/lib/webosbrew/init.d/14-apl-noload
sh /var/lib/webosbrew/init.d/15-apl-preload-off
'@ })
rm -rf /tmp/apl-root
echo APL-ROOT-OK
"@
    $r = Invoke-TvSsh -Command 'sh -s' -Script $rootScript -TimeoutSec 240
    foreach ($line in ($r.Out -split "`n")) { if ($line.Trim()) { Write-Host "        $($line.Trim())" } }
    if ($r.Out -notmatch 'APL-ROOT-OK') { Fail (Tr "The root scripts did not finish. $($r.Err.Trim())" "Les scripts root ne sont pas allés au bout. $($r.Err.Trim())") }
    Write-Host (Tr "        Root features on. Updates of the TV's software stay blocked (they would remove the root)." "        Fonctions root actives. Les mises à jour du logiciel de la TV restent bloquées (elles enlèveraient le root).") -ForegroundColor Green
}

# ---------- 5. open it ----------
NextStep (Tr "Opening APL Launcher…" "Ouverture d'APL Launcher…")
if ($Rooted -and -not $NoHome) {
    # Home opens APL Launcher from now on (app manager restarted: the screen goes black a few seconds)
    $r = Invoke-TvSsh -Command 'sh -s' -Script "grep -q ' /usr/palm/applications/com.webos.app.home ' /proc/mounts && echo APL-HOME-ALREADY || { (sh /media/developer/apl-debloat/apl-home.sh </dev/null >/dev/null 2>&1 &); echo APL-HOME-STARTED; }" -TimeoutSec 60
    if ($r.Out -match 'APL-HOME-STARTED') { Write-Host (Tr "        Home now opens APL Launcher: the screen goes black a few seconds." "        Home ouvre maintenant APL Launcher : l'écran devient noir quelques secondes.") }
}
if ($Rooted -and $NoHome) {
    $r = Invoke-TvSsh -Command 'sh -s' -Script "grep -q ' /usr/palm/applications/com.webos.app.home ' /proc/mounts && sh /media/developer/apl-debloat/apl-home-undo.sh </dev/null >/dev/null 2>&1; echo done" -TimeoutSec 120
}
$r = Invoke-TvSsh -Command 'sh -s' -Script "$luna -n 1 -w 10000 luna://com.webos.applicationManager/launch '{`"id`":`"$AppId`"}'" -TimeoutSec 40
Write-Host ""
Write-Host (Tr "  Done: APL Launcher $version is on the TV." "  Terminé : APL Launcher $version est sur la TV.") -ForegroundColor Green
if ($Quiet) { Send-Gui "APL-RESULT ok" }
exit 0
