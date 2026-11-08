# ============================================================
#  restore.ps1 — PUTS EVERYTHING BACK AS BEFORE. Started by APL Launcher Setup (Restore).
#   1. Vetro: deletes the "Home → APL Launcher" rule and turns off
#      key interception (Home opens the Samsung menu again)
#   2. uninstalls APL Launcher from the screen (if you ask for it)
#   3. reminds you of the 2 Samsung settings to set back
#  Touches nothing else.
# ============================================================
param(
    [string]$TvIp,
    [switch]$Unattended,        # started by APL Launcher Setup: no questions, the optimization is undone
    [switch]$UninstallLauncher  # with -Unattended: also uninstall APL Launcher
)
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\lib.ps1"

if (-not $Unattended) { Clear-Host }
Write-Host ""
Write-Host "  ==============================================" -ForegroundColor Yellow
Write-Host (Tr "     EMERGENCY - back to the original Samsung menu" "     URGENCE - retour au menu Samsung d'origine") -ForegroundColor Yellow
Write-Host "  ==============================================" -ForegroundColor Yellow
$savedIp = Get-SavedTvIp
if (-not $TvIp -and -not $Unattended) { $TvIp = Read-Host ((Tr "  Screen IP address" "  Adresse IP de l'écran") + $(if ($savedIp) { " [$savedIp]" } else { "" })) }
if ([string]::IsNullOrWhiteSpace($TvIp)) { $TvIp = $savedIp }
$vetro = "http://$TvIp`:$(Get-VetroPort)"

# ---------- 1. Vetro: Home button given back to Samsung ----------
Write-Host ""
Write-Host (Tr "  [1/3] Giving the Home button back to Samsung (Vetro)…" "  [1/3] Bouton Home rendu à Samsung (Vetro)…") -ForegroundColor Cyan
Send-Gui ("APL-STEP 1 3 " + (Tr "Giving the Home button back to Samsung" "Bouton Home rendu à Samsung"))
$homeFailed = $false
try {
    $cur = Invoke-RestMethod -Uri "$vetro/remap" -TimeoutSec 15
    $keep = @($cur.rules | Where-Object {
        -not ($_.actions | Where-Object { $_.type -eq 'launch' -and ($_.appId -eq 'APLauncher.Home' -or $_.appId -eq 'APLauncher.Overlay' -or $_.appId -eq 'apl.launcher.overlay') })
    })
    $removed = @($cur.rules).Count - $keep.Count
    $body = @{ rules = $keep } | ConvertTo-Json -Depth 8
    if ($keep.Count -eq 0) { $body = '{"rules":[]}' }
    Invoke-RestMethod -Uri "$vetro/remap" -Method Post -ContentType 'application/json' -Body $body -TimeoutSec 15 | Out-Null
    Invoke-RestMethod -Uri "$vetro/input" -Method Post -ContentType 'application/json' -Body '{"mode":"off"}' -TimeoutSec 15 | Out-Null
    Write-Host (Tr "        OK: $removed APL rule(s) deleted, key interception turned off." "        OK : $removed règle(s) APL supprimée(s), interception des touches coupée.") -ForegroundColor Green
} catch {
    $homeFailed = $true
    Write-Host (Tr "        Vetro unreachable ($($_.Exception.Message))." "        Vetro injoignable ($($_.Exception.Message)).") -ForegroundColor DarkYellow
    Write-Host (Tr "        If Home doesn't work, open $vetro in the browser > Remapper > delete the Home rule." "        Si Home ne marche pas, ouvre $vetro dans le navigateur > Remapper > supprime la règle Home.")
}
# The screen's home app (Start on APL Launcher): its own again, before the launcher may be uninstalled below,
# so the screen never starts on an app that is gone
try {
    $homeBack = Reset-ScreenHomeApp $vetro
    if ($homeBack) { Write-Host (Tr "        The screen starts on its own home app again ($homeBack)." "        L'écran redémarre sur son propre accueil ($homeBack).") -ForegroundColor Green }
} catch {
    Write-Host ((Tr "        The screen's home app could not be set back: " "        L'accueil de l'écran n'a pas pu être remis : ") + $_.Exception.Message) -ForegroundColor DarkYellow
}

# ---------- 2. uninstall (optional) ----------
Write-Host ""
# y/yes/o/oui means yes whatever the language shown; anything else (or Enter) means no.
Send-Gui ("APL-STEP 2 3 " + (Tr "APL Launcher and the optimization" "APL Launcher et l'optimisation"))
$ans = if ($Unattended) { if ($UninstallLauncher) { 'y' } else { 'n' } } else { Read-Host (Tr "  [2/3] Also uninstall APL Launcher from the screen? (y/N)" "  [2/3] Désinstaller aussi APL Launcher de l'écran ? (o/N)") }
if ($ans -match '^[oOyY]') {
    $done = $false
    if (Test-Vetro $TvIp) {
        try { Invoke-VetroExec $vetro "pkgcmd -u -n apl.launcher.overlay; pkgcmd -u -n APLauncher" 120 | Out-Null; $done = $true } catch {}
    }
    if (-not $done) {
        try {
            $sdbPath = Find-Sdb $null
            & $sdbPath start-server | Out-Null
            $serial = Connect-Tv -Sdb $sdbPath -Ip $TvIp
            Invoke-Native $sdbPath @('-s', $serial, 'uninstall', 'APLauncher') | Out-Null
            $done = $true
        } catch {}
    }
    if ($done) { Write-Host (Tr "        APL Launcher uninstalled." "        APL Launcher désinstallé.") -ForegroundColor Green }
    else { Write-Host (Tr "        Not possible from the PC: on the screen, Apps > APL Launcher > Delete." "        Pas possible depuis le PC : sur l'écran, Applis > APL Launcher > Supprimer.") -ForegroundColor DarkYellow }
} else {
    Write-Host (Tr "        APL Launcher stays installed (it opens from Apps)." "        APL Launcher reste installé (il s'ouvre depuis Applis).")
}

# ---------- 2b. undo the optimization ----------
$last = Get-ChildItem (Join-Path $env:APPDATA "APL-Launcher") -Filter "optimisation-*.json" -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending | Select-Object -First 1
if ($last) {
    Write-Host ""
    $ans2 = if ($Unattended) { 'y' } else { Read-Host (Tr "  Also turn back on the Samsung components that Optimize turned off ($($last.Name))? (y/N)" "  Remettre aussi les composants Samsung coupés par Optimiser ($($last.Name)) ? (o/N)") }
    if ($ans2 -match '^[oOyY]') {
        if (-not (Test-Vetro $TvIp)) {
            Write-Host (Tr "        Vetro is not responding: open Vetro on the screen then run Restore again." "        Vetro ne répond pas : ouvre Vetro sur l'écran puis relance Restaurer.") -ForegroundColor DarkYellow
        } else {
            $bk = Get-Content $last.FullName -Raw | ConvertFrom-Json
            $done2 = 0
            foreach ($c in @($bk.silenced)) {
                foreach ($f in @('onboot', 'autorestart')) {
                    if ($c.$f) {
                        try {
                            Invoke-RestMethod -Uri "$vetro/components/action" -Method Post -ContentType 'application/json' `
                                -Body (@{ appId = $c.appId; action = 'flags'; flag = $f; enabled = $true } | ConvertTo-Json -Compress) -TimeoutSec 90 | Out-Null
                            $done2++
                        } catch {}
                    }
                }
            }
            Write-Host (Tr "        $done2 startup setting(s) restored. Restart the screen." "        $done2 réglage(s) de démarrage remis. Redémarre l'écran.") -ForegroundColor Green
            if ($bk.autorunWas -eq '1') {
                try { Invoke-VetroExec $vetro "vconftool set -f -t int db/menu/smart_hub/ontvsetting/auto_start 1" | Out-Null; Write-Host (Tr "        Smart Hub at startup: restored." "        Smart Hub au démarrage : remis.") -ForegroundColor Green } catch {}
            }
            if ($bk.dnsWas) {
                try {
                    $body = @{ action = 'apply'; enabled = [bool]$bk.dnsWas.enabled; domains = @($bk.dnsWas.domains | Where-Object { $_ }) } | ConvertTo-Json -Compress -Depth 4
                    Invoke-RestMethod -Uri "$vetro/dns" -Method Post -ContentType 'application/json' -Body $body -TimeoutSec 60 | Out-Null
                    Write-Host (Tr "        Ad filter: back as before." "        Filtre anti-pub : remis comme avant.") -ForegroundColor Green
                } catch {}
            }
            try { Invoke-RestMethod -Uri "$vetro/quick" -Method Post -ContentType 'application/json' -Body '{"id":"tracking-all","off":false}' -TimeoutSec 120 | Out-Null } catch {}
            try { Invoke-RestMethod -Uri "$vetro/quick" -Method Post -ContentType 'application/json' -Body '{"id":"voice-all","off":false}' -TimeoutSec 120 | Out-Null } catch {}
            $gone = @($bk.uninstalled) + @($bk.youtubeRemoved | Where-Object { $_ })
            if ($gone.Count) {
                Write-Host (Tr "        Uninstalled apps (reinstall from the Store if you want one back):" "        Apps désinstallées (à réinstaller depuis le Store si tu en veux une) :")
                $gone | ForEach-Object { Write-Host "          - $($_.name) [$($_.appId)]" }
            }
        }
    }
}

# ---------- 3. Samsung settings ----------
Write-Host ""
Write-Host (Tr "  [3/3] On the screen: Settings > All Settings > Advanced Features" "  [3/3] Sur l'écran : Paramètres > Tous les paramètres > Fonctions avancées") -ForegroundColor Cyan
Send-Gui ("APL-STEP 3 3 " + (Tr "Samsung settings" "Réglages Samsung"))
Write-Host (Tr "        - 'Autorun Smart Hub'  -> ON" "        - « Lancer Smart Hub automatiquement »        -> ACTIVÉ")
Write-Host (Tr "        - 'Autorun Last App'   -> as you prefer" "        - « Lancer automatiquement la dernière app »  -> comme tu préfères")
Write-Host ""
Write-Host (Tr "  The screen is back as before." "  L'écran est revenu comme avant.") -ForegroundColor Green
if ($Unattended) {
    if ($homeFailed) { Send-Gui ("APL-RESULT fail " + (Tr "Vetro is not responding: the Home button could not be given back. Open Vetro on the screen, then try again." "Vetro ne répond pas : le bouton Home n'a pas pu être rendu. Ouvre Vetro sur l'écran, puis réessaie.")); exit 1 }
    Send-Gui "APL-RESULT ok"; exit 0
}
Read-Host (Tr "  Press Enter to close" "  Appuie sur Entrée pour fermer")
