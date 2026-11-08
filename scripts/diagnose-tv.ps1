# ============================================================
#  diagnose-tv.ps1 — what the screen can do, so the launcher's
#  interface can control it. Started from APL Launcher Setup › Tools.
#
#  READ-ONLY (except the launcher's relay, which is simply started):
#   1. Vetro and the launcher's relay (APLauncher.Bridge)
#   2. Picture / sound / game settings the screen exposes (D-Bus avoc)
#      and their current values
#   3. Samsung menu entries related to game, picture, sound and
#      Bluetooth (with their possible choices)
#   4. Bluetooth: adapter and known devices (names, state)
#   5. Misc: network remote, TV app, stores
#  Report: diagnostic-tv.txt (no password, Bluetooth addresses masked).
# ============================================================
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\lib.ps1"
$Root = Split-Path $PSScriptRoot -Parent

$out = New-Object System.Collections.Generic.List[string]
function Add([string]$t) { $out.Add($t); Write-Host "  $t" }
function Section([string]$t) { $out.Add(""); $out.Add("===== $t ====="); Write-Host ""; Write-Host "  $t" -ForegroundColor Cyan }
function Run([string]$cmd, [int]$t = 60) {
    try { return (Invoke-VetroExec $base $cmd $t) } catch { return (Tr "(refused: $($_.Exception.Message))" "(refusé : $($_.Exception.Message))") }
}
function Mask([string]$s) { return ($s -replace '([0-9A-Fa-f]{2}[:_]){5}[0-9A-Fa-f]{2}', 'XX:XX:XX:XX:XX:XX') }

Clear-Host
Write-Host ""
Write-Host "  ==============================================" -ForegroundColor White
Write-Host (Tr "     What the screen can do (read-only)" "     Ce que l'écran sait faire (lecture seule)") -ForegroundColor White
Write-Host "  ==============================================" -ForegroundColor White
$savedIp = Get-SavedTvIp
$TvIp = Read-Host ((Tr "  Screen IP address" "  Adresse IP de l'écran") + $(if ($savedIp) { " [$savedIp]" } else { "" }))
if ([string]::IsNullOrWhiteSpace($TvIp)) { $TvIp = $savedIp }
$base = "http://$TvIp`:$(Get-VetroPort)"
if (-not (Test-Vetro $TvIp)) {
    Write-Host (Tr "  Vetro is not responding: open Vetro on the screen, wait 1 minute and try again." "  Vetro ne répond pas : ouvre Vetro sur l'écran, attends 1 minute et relance.") -ForegroundColor Yellow
    Read-Host (Tr "  Press Enter to close" "  Entrée pour fermer"); exit 1
}

# ---------- 1. Vetro and relay ----------
Section (Tr "1. Vetro and the launcher's relay" "1. Vetro et relais du launcher")
try {
    $st = Invoke-RestMethod -Uri "$base/status" -TimeoutSec 15
    $js = ($st | ConvertTo-Json -Depth 3 -Compress) -replace '"(token|secret|nonce)":"[^"]*"', '"$1":"…"'
    Add ((Tr "Vetro: " "Vetro : ") + $js.Substring(0, [Math]::Min(600, $js.Length)))
} catch { Add (Tr "Could not read Vetro /status" "Vetro /status illisible") }
Add (Run "pkgcmd -l 2>/dev/null | grep -i 'APLauncher'; true")
Add (Run "app_launcher -l 2>/dev/null | grep -i 'APLauncher'; true")
Add ((Tr "Starting the relay: " "Démarrage du relais : ") + (Run "app_launcher -s APLauncher.Bridge 2>&1; sleep 2; ps -ef 2>/dev/null | grep -i 'APLauncher' | grep -v grep; true"))

# ---------- 2. screen settings (D-Bus avoc) ----------
Section (Tr "2. Settings exposed by the screen (org.tizen.tv.avoc)" "2. Réglages exposés par l'écran (org.tizen.tv.avoc)")
Add (Run "busctl --system introspect org.tizen.tv.avoc /org/tizen/tv/avoc org.tizen.tv.avoc.AvOutputControl 2>&1 | grep -E 'method' | sed -E 's/ +/ /g'; true" 30)
Add (Tr "Current values:" "Valeurs actuelles :")
foreach ($g in @('GetGameMode i 0', 'GetRealGameMode i 0', 'GetLowInputLagStatus', 'GetPictureMode i 0', 'GetSoundMode u 0', 'GetBacklight i 0', 'GetColorToneMode i 0', 'GetAutoMotionPlus i 0')) {
    Add ("  " + $g.Split(' ')[0] + " -> " + (Run "busctl --system call org.tizen.tv.avoc /org/tizen/tv/avoc org.tizen.tv.avoc.AvOutputControl $g 2>&1; true" 10).Trim())
}
Add (Tr "Other TV services on D-Bus:" "Autres services TV sur D-Bus :")
Add (Run "busctl --system list --no-pager 2>/dev/null | grep -iE 'tv\.|avoc|bt|blue|sound|game|menu' | cut -c1-90; true" 30)

# ---------- 3. Samsung menu ----------
Section (Tr "3. Samsung menu: game, picture, sound, Bluetooth" "3. Menu Samsung : jeu, image, son, Bluetooth")
try {
    $menu = Invoke-RestMethod -Uri "$base/tv-menu" -TimeoutSec 60
    $items = @($menu.items | Where-Object { "$($_.id) $($_.vconfKey)" -match 'game|picture_?mode|picture\.mode|sound_?mode|sound_?output|speaker|bluetooth|bt_|auto_?low|alm|vrr|input_?signal|eco|motion' })
    Add (Tr "$($items.Count) entries (out of $($menu.count))" "$($items.Count) entrée(s) (sur $($menu.count))")
    foreach ($it in ($items | Select-Object -First 120)) {
        $opts = if ($it.options) { (Tr " | choices: " " | choix : ") + (($it.options | ForEach-Object { "$($_.value)=$($_.label)" }) -join ', ') } else { "" }
        Add ("  " + $it.id + (Tr " | key " " | clé ") + $it.vconfKey + " | " + $it.type + " | " + $it.capability + " | " + $it.style + $opts)
    }
} catch { Add (Tr "Could not read the menu: $($_.Exception.Message)" "Menu illisible : $($_.Exception.Message)") }

# ---------- 4. Bluetooth ----------
Section "4. Bluetooth"
$bt = Run "busctl --system --json=short call org.bluez / org.freedesktop.DBus.ObjectManager GetManagedObjects 2>&1; true" 30
try {
    $j = $bt | ConvertFrom-Json
    $objs = $j.data[0]
    foreach ($p in $objs.PSObject.Properties) {
        $ifs = $p.Value
        if ($ifs.'org.bluez.Adapter1') {
            $a = $ifs.'org.bluez.Adapter1'
            Add (Tr ("Adapter " + $p.Name + ": powered=" + $a.Powered.data + ", discovering=" + $a.Discovering.data + ", discoverable=" + $a.Discoverable.data) `
                    ("Adaptateur " + $p.Name + " : allumé=" + $a.Powered.data + ", recherche=" + $a.Discovering.data + ", visible=" + $a.Discoverable.data))
        }
        if ($ifs.'org.bluez.Device1') {
            $d = $ifs.'org.bluez.Device1'
            Add (Tr ("  Device '" + $d.Name.data + "' icon=" + $d.Icon.data + " paired=" + $d.Paired.data + " connected=" + $d.Connected.data + " trusted=" + $d.Trusted.data) `
                    ("  Appareil « " + $d.Name.data + " » icône=" + $d.Icon.data + " associé=" + $d.Paired.data + " connecté=" + $d.Connected.data + " confiance=" + $d.Trusted.data))
        }
    }
} catch { Add ((Tr "Raw response: " "Réponse brute : ") + (Mask ($bt.Substring(0, [Math]::Min(1500, $bt.Length))))) }
Add (Tr "Samsung's Bluetooth agents and services:" "Agents et services Bluetooth de Samsung :")
Add (Run "busctl --system list --no-pager 2>/dev/null | grep -iE 'bluez|projectx|bt' | cut -c1-90; ls /usr/bin 2>/dev/null | grep -iE '^bt|blue' | head -20; true" 30)

# ---------- 5. misc ----------
Section (Tr "5. Misc" "5. Divers")
Add ((Tr "Network remote (8001): " "Télécommande réseau (8001) : ") + (Run "curl -s -m 4 http://127.0.0.1:8001/api/v2/ 2>&1 | head -c 400; echo; true" 15))
Add ((Tr "Key tool: " "Outil de touches : ") + (Run "ls -l /usr/bin/input_keyevent 2>&1; true" 10))
Add ((Tr "TV app: " "App TV : ") + (Run "app_launcher -l 2>/dev/null | grep -iE 'tv-viewer|org.tizen.menu' ; true" 15))
Add ((Tr "Stores: " "Boutiques : ") + (Run "app_launcher -l 2>/dev/null | grep -iE 'store|samsungapps|volt' ; true" 15))
Add ((Tr "Model: " "Modèle : ") + (Run "cat /etc/info.ini 2>/dev/null | grep -iE 'model|version' | head -5; true" 10))

$file = Join-Path $Root "diagnostic-tv.txt"
[IO.File]::WriteAllLines($file, [string[]](@((Tr "APL Launcher - what the screen can do" "APL Launcher - ce que l'écran sait faire"), (Get-Date).ToString('s')) + $out), (New-Object Text.UTF8Encoding($true)))
Write-Host ""
Write-Host (Tr "  Report saved: $file" "  Rapport enregistré : $file") -ForegroundColor Green
Write-Host (Tr "  Send me this file." "  Envoie-moi ce fichier.") -ForegroundColor Green
Read-Host (Tr "  Press Enter to close" "  Appuie sur Entrée pour fermer")
