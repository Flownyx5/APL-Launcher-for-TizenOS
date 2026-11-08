# ============================================================
#  diagnose-sources.ps1 — looks for WHERE the screen keeps the names of connected
#  devices (Switch, Steam Deck, PS5…), so the launcher can recognize them
#  by itself. READ-ONLY: nothing is changed on the screen.
#  Result: diagnostic-sources.txt on the Desktop (to send to Claude).
#  Before running it: turn on and plug in your devices (HDMI, USB-C).
# ============================================================
. "$PSScriptRoot\lib.ps1"
$ErrorActionPreference = 'Stop'
Write-Host ""
Write-Host (Tr "  Sources diagnostic (read-only)" "  Diagnostic des sources (lecture seule)") -ForegroundColor Cyan
$savedIp = Get-SavedTvIp
$ip = Read-Host ((Tr "  Screen IP address" "  Adresse IP de l'écran") + $(if ($savedIp) { " [$savedIp]" } else { "" }))
if ([string]::IsNullOrWhiteSpace($ip)) { $ip = $savedIp }
$base = "http://$ip`:$(Get-VetroPort)"
try { Invoke-RestMethod -Uri "$base/status" -TimeoutSec 8 | Out-Null } catch {
    Write-Host (Tr "  Vetro is not responding on ${base}: turn on the screen and open Vetro, then try again." "  Vetro ne répond pas sur $base : allume l'écran et ouvre Vetro, puis relance.") -ForegroundColor Red
    Read-Host (Tr "  Press Enter to close" "  Entrée pour fermer"); exit 1
}
$cmds = @(
    "vconftool get -r db/ 2>/dev/null | grep -iE 'hdmi|cec|anynet|extsrc|source|osd' | head -150",
    "vconftool get -r memory/ 2>/dev/null | grep -iE 'hdmi|cec|anynet|extsrc|source|osd' | head -150",
    "busctl --system list --no-pager 2>/dev/null | grep -iE 'cec|hdmi|anynet|source|extsrc|avoc|tvs' | head -60",
    "ls -la /dev 2>/dev/null | grep -iE 'cec|hdmi'",
    "find /opt/usr/data /opt/usr/home/owner/data /opt/var -maxdepth 5 \( -iname '*anynet*' -o -iname '*cec*' -o -iname '*source*' -o -iname '*extsrc*' \) 2>/dev/null | head -80"
)
$out = New-Object System.Text.StringBuilder
foreach ($c in $cmds) {
    [void]$out.AppendLine("===== $c")
    try {
        $r = Invoke-RestMethod -Uri "$base/exec" -Method Post -ContentType 'application/json' -Body (@{ cmd = $c } | ConvertTo-Json -Compress) -TimeoutSec 60
        [void]$out.AppendLine([string]$r.output)
    } catch { [void]$out.AppendLine((Tr "(error: $($_.Exception.Message))" "(erreur : $($_.Exception.Message))")) }
}
$file = Join-Path ([Environment]::GetFolderPath('Desktop')) "diagnostic-sources.txt"
[IO.File]::WriteAllText($file, $out.ToString(), (New-Object Text.UTF8Encoding($true)))
Write-Host (Tr "  Done: $file" "  Fini : $file") -ForegroundColor Green
Write-Host (Tr "  Send this file to Claude in the chat." "  Envoie ce fichier à Claude dans le chat.") -ForegroundColor Green
Start-Process notepad.exe $file
Read-Host (Tr "  Press Enter to close" "  Entrée pour fermer")
