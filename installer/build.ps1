# ============================================================
#  build.ps1 — builds dist\APL Launcher Setup.exe (Windows PowerShell 5.1).
#    powershell -NoProfile -ExecutionPolicy Bypass -File installer\build.ps1
#  Needs only the C# compiler of Visual Studio Build Tools; the app itself
#  runs on the .NET Framework 4.8 that comes with Windows 10 and 11.
# ============================================================
$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
$Root = Split-Path $Here -Parent
$Dist = Join-Path $Root "dist"
$Exe = Join-Path $Dist "APL Launcher Setup.exe"

# ---------- compiler ----------
$csc = $null
foreach ($pf in @(${env:ProgramFiles}, ${env:ProgramFiles(x86)})) {
    if (-not $pf) { continue }
    $vs = Join-Path $pf "Microsoft Visual Studio"
    if (-not (Test-Path $vs)) { continue }
    # Microsoft Visual Studio\<version>\<edition>\MSBuild\Current\Bin\Roslyn\csc.exe — newest version first
    $hit = Get-ChildItem $vs -Directory -ErrorAction SilentlyContinue | Sort-Object Name -Descending | ForEach-Object {
        Get-ChildItem $_.FullName -Directory -ErrorAction SilentlyContinue | ForEach-Object {
            Join-Path $_.FullName "MSBuild\Current\Bin\Roslyn\csc.exe"
        }
    } | Where-Object { Test-Path $_ } | Select-Object -First 1
    if ($hit) { $csc = $hit; break }
}
if (-not $csc) { throw "csc.exe (Roslyn) not found. Install Visual Studio Build Tools with the C# workload." }

$fw = Join-Path $env:WINDIR "Microsoft.NET\Framework64\v4.0.30319"
if (-not (Test-Path (Join-Path $fw "WPF\PresentationFramework.dll"))) { $fw = Join-Path $env:WINDIR "Microsoft.NET\Framework\v4.0.30319" }
if (-not (Test-Path (Join-Path $fw "WPF\PresentationFramework.dll"))) { throw ".NET Framework 4.8 (WPF) not found in $fw" }

# ---------- version (the launcher's, from config.xml) ----------
$config = [IO.File]::ReadAllText((Join-Path $Root "launcher\config.xml"))
if ($config -notmatch '<widget\b[^>]*?\bversion="([^"]+)"') { throw "No version attribute on <widget> in launcher\config.xml" }
$version = $Matches[1]
if ($version -notmatch '^\d+(\.\d+){1,3}$') { throw "Unexpected version '$version' in launcher\config.xml" }

$tmp = Join-Path ([IO.Path]::GetTempPath()) ("apl-setup-build-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Force -Path $tmp | Out-Null
New-Item -ItemType Directory -Force -Path $Dist | Out-Null
try {
    # ---------- payload: tracked files only (never keys, avatars or certificates) ----------
    Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem
    $oldEnc = [Console]::OutputEncoding
    try { [Console]::OutputEncoding = New-Object Text.UTF8Encoding($false) } catch {}   # git prints UTF-8 file names
    try { $files = @(git -C $Root -c core.quotepath=off ls-files -- launcher scripts overlay webos LICENSE) }
    finally { try { [Console]::OutputEncoding = $oldEnc } catch {} }
    if ($LASTEXITCODE -ne 0 -or $files.Count -eq 0) { throw "git ls-files failed: is git installed and is this a clone of the repository?" }
    # Belt and braces: private files stay out even if someone tracked them by mistake.
    $private = '(^|/)keys\.local\.js$|(^|/)avatars\.local\.js$|^launcher/images/avatars/(custom|memoji)/|\.(p12|pfx|pwd|pem|key)$|(^|/)SamsungCertificate/|(^|/)(author-signature|signature1)\.xml$'
    $payload = Join-Path $tmp "payload.zip"
    $zip = [IO.Compression.ZipFile]::Open($payload, 'Create')
    $count = 0
    try {
        foreach ($rel in $files) {
            if ($rel -match $private) { continue }
            $full = Join-Path $Root ($rel -replace '/', '\')
            if (-not (Test-Path -LiteralPath $full -PathType Leaf)) { continue }   # deleted but not committed yet
            [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $full, $rel, 'Optimal') | Out-Null
            $count++
        }
    } finally { $zip.Dispose() }
    Write-Host ("  payload: {0} files, {1:N0} KB" -f $count, ((Get-Item $payload).Length / 1KB))

    # ---------- icon: 16/32/48/256 PNG entries from launcher\icon.png ----------
    Add-Type -AssemblyName System.Drawing
    $src = [Drawing.Image]::FromFile((Join-Path $Root "launcher\icon.png"))
    $pngs = @()
    try {
        foreach ($s in 16, 32, 48, 256) {
            $bmp = New-Object Drawing.Bitmap($s, $s, [Drawing.Imaging.PixelFormat]::Format32bppArgb)
            $g = [Drawing.Graphics]::FromImage($bmp)
            $g.InterpolationMode = 'HighQualityBicubic'; $g.PixelOffsetMode = 'HighQuality'
            $g.CompositingQuality = 'HighQuality'; $g.SmoothingMode = 'AntiAlias'
            $g.DrawImage($src, 0, 0, $s, $s)
            $g.Dispose()
            $ms = New-Object IO.MemoryStream
            $bmp.Save($ms, [Drawing.Imaging.ImageFormat]::Png)
            $bmp.Dispose()
            $pngs += , @($s, $ms.ToArray())
        }
    } finally { $src.Dispose() }
    $ico = Join-Path $tmp "app.ico"
    $w = New-Object IO.BinaryWriter([IO.File]::Create($ico))
    try {
        $w.Write([uint16]0); $w.Write([uint16]1); $w.Write([uint16]$pngs.Count)
        $offset = 6 + 16 * $pngs.Count
        foreach ($p in $pngs) {
            $s = $p[0]; $data = $p[1]
            $dim = if ($s -ge 256) { 0 } else { $s }
            $w.Write([byte]$dim); $w.Write([byte]$dim); $w.Write([byte]0); $w.Write([byte]0)
            $w.Write([uint16]1); $w.Write([uint16]32); $w.Write([uint32]$data.Length); $w.Write([uint32]$offset)
            $offset += $data.Length
        }
        foreach ($p in $pngs) { $w.Write([byte[]]$p[1]) }
    } finally { $w.Dispose() }

    # ---------- version compiled in ----------
    $info = Join-Path $tmp "BuildInfo.cs"
    [IO.File]::WriteAllText($info, "namespace APL.Setup`r`n{`r`n    internal static class BuildInfo`r`n    {`r`n        public const string Version = `"$version`";`r`n    }`r`n}`r`n", (New-Object Text.UTF8Encoding($true)))

    # ---------- compile ----------
    $refs = @('mscorlib.dll', 'System.dll', 'System.Core.dll', 'System.Xml.dll', 'System.Xaml.dll', 'System.Net.Http.dll',
              'System.IO.Compression.dll', 'System.IO.Compression.FileSystem.dll',
              'WPF\PresentationFramework.dll', 'WPF\PresentationCore.dll', 'WPF\WindowsBase.dll')
    $rsp = New-Object Collections.Generic.List[string]
    $rsp.AddRange([string[]]@('/nologo', '/nostdlib+', '/target:winexe', '/optimize+', '/langversion:7.3',
                              '/utf8output', '/warn:4', '/platform:anycpu'))
    $rsp.Add("/out:`"$Exe`"")
    $rsp.Add("/win32manifest:`"$(Join-Path $Here 'app.manifest')`"")
    $rsp.Add("/win32icon:`"$ico`"")
    foreach ($r in $refs) { $rsp.Add("/reference:`"$(Join-Path $fw $r)`"") }
    foreach ($x in Get-ChildItem $Here -Filter *.xaml) { $rsp.Add("/resource:`"$($x.FullName)`",$($x.Name)") }
    $rsp.Add("/resource:`"$payload`",payload.zip")
    $rsp.Add("/resource:`"$(Join-Path $Root 'launcher\icon.png')`",icon.png")
    foreach ($c in Get-ChildItem $Here -Filter *.cs) { $rsp.Add("`"$($c.FullName)`"") }
    $rsp.Add("`"$info`"")
    $rspFile = Join-Path $tmp "build.rsp"
    [IO.File]::WriteAllLines($rspFile, $rsp, (New-Object Text.UTF8Encoding($false)))

    if (Test-Path -LiteralPath $Exe) {
        try { Remove-Item -LiteralPath $Exe -Force } catch { throw "Close APL Launcher Setup first: $Exe is in use." }
    }
    & $csc /noconfig "@$rspFile"   # /noconfig is only accepted on the command line
    if ($LASTEXITCODE -ne 0) { throw "Compilation failed (csc exit code $LASTEXITCODE)." }
    Write-Host "  built: $Exe (APL Launcher $version)" -ForegroundColor Green
} finally {
    Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
}
