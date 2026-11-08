# ============================================================
#  repair-tizenbrew.ps1 — checks and repairs TizenBrew / TizenTube.
#  Started from APL Launcher Setup › Tools. Goes through Vetro.
#
#  1. Are TizenBrew, TizenTube and the official YouTube installed?
#  2. Developer mode: on, with Host PC IP = 127.0.0.1?
#     (TizenBrew uses it to start TizenTube)
#  3. Did the optimization (Optimize) turn off or remove something
#     they need?
#  4. DNS filter: is a site they need blocked?
#  5. Can the screen reach YouTube and the module sites?
#  Reads first, explains, and changes nothing without asking you.
#  Report: diagnostic-tizenbrew.txt (no key or password).
# ============================================================
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\lib.ps1"
$Root = Split-Path $PSScriptRoot -Parent

$report = New-Object System.Collections.Generic.List[string]
$problems = New-Object System.Collections.Generic.List[string]
function Say([string]$t, [string]$c = 'Gray') { Write-Host "  $t" -ForegroundColor $c; $report.Add($t) }
function Ok([string]$t) { Say "OK        $t" 'Green' }
function Info([string]$t) { Say "INFO      $t" 'Gray' }
function Bad([string]$t, [string]$fix) {
    Say (Tr "PROBLEM   $t" "PROBLÈME  $t") 'Yellow'
    if ($fix) { Say "          -> $fix" 'Yellow' }
    $problems.Add($t)
}
# Accepts y/yes/o/oui whatever the language shown; anything else (or Enter) means no.
function Ask-YesNo([string]$q) { return ((Read-Host ("  $q " + (Tr "(y/N)" "(o/N)"))) -match '^[oOyY]') }
function Exec([string]$cmd, [int]$t = 60) { try { return (Invoke-VetroExec $base $cmd $t) } catch { return $null } }
function Post($path, $body) {
    return Invoke-RestMethod -Uri "$base$path" -Method Post -ContentType 'application/json' `
        -Body ($body | ConvertTo-Json -Compress -Depth 5) -TimeoutSec 120
}
function Save-Report {
    $file = Join-Path $Root "diagnostic-tizenbrew.txt"
    $head = @((Tr "APL Launcher - TizenBrew / TizenTube diagnostic" "APL Launcher - diagnostic TizenBrew / TizenTube"), (Get-Date).ToString('s'), "")
    [IO.File]::WriteAllLines($file, [string[]]($head + $report), (New-Object Text.UTF8Encoding($true)))
    Write-Host ""
    Write-Host (Tr "  Report saved: $file" "  Rapport enregistré : $file") -ForegroundColor Cyan
}
# Sites TizenBrew and TizenTube need (modules, YouTube, updates)
$NEEDED = 'youtube|googlevideo|ytimg|ggpht|googleapis|gstatic|google\.|jsdelivr|github|npmjs|unpkg|cloudflare|tizenbrew'
# Uninstalled apps to report. For turned-off components, we don't offer to turn
# Samsung's YouTube back on: TizenTube actually needs it to be closed.
$RELATED = 'xvvl3S1|TizenBrew|TizenTube'
$RELATED_ON = $RELATED

Clear-Host
Write-Host ""
Write-Host "  ==============================================" -ForegroundColor White
Write-Host (Tr "     Checking TizenBrew and TizenTube" "     Vérification de TizenBrew et TizenTube") -ForegroundColor White
Write-Host "  ==============================================" -ForegroundColor White
$savedIp = Get-SavedTvIp
$TvIp = Read-Host ((Tr "  Screen IP address" "  Adresse IP de l'écran") + $(if ($savedIp) { " [$savedIp]" } else { "" }))
if ([string]::IsNullOrWhiteSpace($TvIp)) { $TvIp = $savedIp }
$base = "http://$TvIp`:$(Get-VetroPort)"
Write-Host ""

# ---------- 0. Vetro ----------
if (-not (Test-Vetro $TvIp)) {
    Bad (Tr "Vetro is not responding on ${TvIp}: cannot check the screen." "Vetro ne répond pas sur $TvIp : impossible de vérifier l'écran.") `
        (Tr "On the screen, open Vetro (Apps) and wait 1 minute, then run this tool again. If Vetro doesn't start either: Apps, enter 1 2 3 4 5, developer mode On with Host PC IP = 127.0.0.1, then restart the screen (hold the power button)." "Sur l'écran, ouvre Vetro (Applis) et attends 1 minute, puis relance cet outil. Si Vetro ne démarre plus non plus : Applis, tape 1 2 3 4 5, mode développeur Activé avec Host PC IP = 127.0.0.1, puis redémarre l'écran (bouton marche maintenu).")
    Save-Report
    Read-Host (Tr "  Press Enter to close" "  Appuie sur Entrée pour fermer"); exit 1
}
Ok (Tr "Vetro is responding." "Vetro répond.")

# ---------- 1. installed apps ----------
Write-Host ""
Write-Host (Tr "  [1/5] Installed apps" "  [1/5] Apps installées") -ForegroundColor Cyan
$pk = Exec "pkgcmd -l 2>/dev/null | grep -iE 'xvvl3S1|TizenTube|9Ur5IzDKqV|111299001912'; true"
if ($null -eq $pk) {
    Info (Tr "Could not read the app list (Vetro refused the command)." "Liste des apps illisible (Vetro a refusé la commande).")
} else {
    if ($pk -match 'xvvl3S1bvH') { Ok (Tr "TizenBrew is installed." "TizenBrew est installé.") }
    else { Bad (Tr "TizenBrew is no longer installed." "TizenBrew n'est plus installé.") (Tr "Reinstall it with the official TizenBrew installer (github.com/reisxd/TizenBrew), then add the TizenTube module again." "Réinstalle-le avec l'installateur officiel de TizenBrew (github.com/reisxd/TizenBrew), puis remets le module TizenTube.") }
    if ($pk -match 'xvvl3S1TT1|name \[[^\]]*TizenTube') { Ok (Tr "The TizenTube app is installed." "L'app TizenTube est installée.") }
    else { Info (Tr "No separate TizenTube app: normal if TizenTube opens from TizenBrew (module)." "Pas d'app TizenTube séparée : normal si TizenTube s'ouvre depuis TizenBrew (module).") }
}
# Samsung's YouTube: TizenTube replaces it and they get in each other's way. Offered for deletion,
# only if the app is named exactly "YouTube". The screen's response goes into the report.
$ytLine = Exec "pkgcmd -l 2>/dev/null | grep -E 'pkgid \[(9Ur5IzDKqV|111299001912)\]'; true"
if ($ytLine -and $ytLine.Trim()) {
    $ytPkg = $null; $ytName = ''
    if ($ytLine -match 'pkgid \[([^\]]+)\]') { $ytPkg = $Matches[1] }
    if ($ytLine -match 'name \[([^\]]+)\]') { $ytName = $Matches[1].Trim() }
    Info (Tr "Samsung's YouTube: '$ytName' [$ytPkg]" "YouTube de Samsung : « $ytName » [$ytPkg]")
    if ($ytPkg -and $ytName -eq 'YouTube' -and (Ask-YesNo (Tr "Delete Samsung's YouTube app (TizenTube replaces it)?" "Supprimer l'app YouTube de Samsung (TizenTube la remplace) ?"))) {
        $ytApp = if ($ytPkg -eq '9Ur5IzDKqV') { '9Ur5IzDKqV.TizenYouTube' } else { $ytPkg }
        [void](Exec "app_launcher -k com.samsung.tv.cobalt-yt >/dev/null 2>&1; app_launcher -k $ytApp >/dev/null 2>&1; true")
        $ytOk = $false
        try {
            $r = Post '/components/action' @{ appId = $ytApp; action = 'uninstall' }
            $ytOk = [bool]$r.ok
            if (-not $ytOk -and $r.error) { Info (Tr "Vetro: $($r.error)" "Vetro : $($r.error)") }
        } catch { Info ((Tr "Vetro: " "Vetro : ") + $(if ($_.ErrorDetails.Message) { $_.ErrorDetails.Message } else { $_.Exception.Message })) }
        if (-not $ytOk) {
            $out = Exec "pkgcmd -u -n $ytPkg 2>&1; echo exit=`$?" 120
            if ($out) { Info ((Tr "Response from the screen: " "Réponse de l'écran : ") + ($out.Trim() -replace '\s+', ' ')) }
            $still = Exec "pkgcmd -l 2>/dev/null | grep 'pkgid \[$ytPkg\]'; true"
            $ytOk = -not ($still -and $still.Trim())
        }
        if ($ytOk) { Ok (Tr "Samsung's YouTube deleted (can be reinstalled from the App Store)." "YouTube de Samsung supprimé (réinstallable depuis l'App Store).") }
        else { Bad (Tr "The screen refuses to delete YouTube." "L'écran refuse de supprimer YouTube.") (Tr "Try on the screen: Apps > Settings (gear icon) > YouTube > Delete. Otherwise, send me this report." "Essaie sur l'écran : Applis > Paramètres (roue dentée) > YouTube > Supprimer. Sinon, envoie-moi ce rapport.") }
    }
}
$ps = Exec "ps -ef 2>/dev/null | grep -iE 'xvvl3S1bvH|StandaloneService' | grep -v grep; true"
if ($ps) { Info (Tr "The TizenBrew service is running right now." "Le service de TizenBrew tourne en ce moment.") }
else { Info (Tr "The TizenBrew service is not running right now (normal if TizenBrew is not open)." "Le service de TizenBrew ne tourne pas en ce moment (normal si TizenBrew n'est pas ouvert).") }

# ---------- 2. developer mode ----------
Write-Host ""
Write-Host (Tr "  [2/5] Developer mode (TizenBrew needs it)" "  [2/5] Mode développeur (TizenBrew en a besoin)") -ForegroundColor Cyan
$dm = Exec "vconftool get db/sdk/develop/mode 2>&1; vconftool get db/sdk/develop/ip 2>&1"
$mode = $null; $ip = $null
if ($dm -match 'develop/mode, value = (\d+)') { $mode = $Matches[1] }
if ($dm -match 'develop/ip, value = ([0-9.]+)') { $ip = $Matches[1] }
if ($mode -eq '0') {
    Bad (Tr "Developer mode is off." "Le mode développeur est désactivé.") (Tr "On the screen: Apps, enter 1 2 3 4 5 with the remote, developer mode On, Host PC IP = 127.0.0.1, then restart the screen (hold the power button)." "Sur l'écran : Applis, tape 1 2 3 4 5 avec la télécommande, mode développeur Activé, Host PC IP = 127.0.0.1, puis redémarre l'écran (bouton marche maintenu).")
} elseif ($mode -eq '1') { Ok (Tr "Developer mode is on." "Mode développeur activé.") }
if ($ip -and $ip -ne '127.0.0.1') {
    Bad (Tr "Host PC IP is $ip instead of 127.0.0.1: TizenBrew can no longer start TizenTube." "Host PC IP vaut $ip au lieu de 127.0.0.1 : TizenBrew ne peut plus lancer TizenTube.") (Tr "I can set it back to 127.0.0.1 (the screen will then need a restart)." "Je peux le remettre à 127.0.0.1 (puis il faudra redémarrer l'écran).")
    if (Ask-YesNo (Tr "Set Host PC IP back to 127.0.0.1?" "Remettre Host PC IP à 127.0.0.1 ?")) {
        $r = Exec "vconftool set -f -t string db/sdk/develop/ip 127.0.0.1 2>&1; vconftool get db/sdk/develop/ip 2>&1"
        if ($r -match 'value = 127\.0\.0\.1') { Ok (Tr "Host PC IP set back to 127.0.0.1. Restart the screen (hold the power button)." "Host PC IP remis à 127.0.0.1. Redémarre l'écran (bouton marche maintenu).") }
        else { Bad (Tr "The screen refused the change." "L'écran a refusé le changement.") (Tr "Do it by hand: Apps, enter 1 2 3 4 5, Host PC IP = 127.0.0.1, then restart the screen." "Fais-le à la main : Applis, tape 1 2 3 4 5, Host PC IP = 127.0.0.1, puis redémarre l'écran.") }
    }
} elseif ($ip) { Ok "Host PC IP = 127.0.0.1." }
if (-not $mode -and -not $ip) {
    Info (Tr "Could not read the setting automatically. Check by hand: Apps, enter 1 2 3 4 5: On, Host PC IP = 127.0.0.1." "Réglage illisible automatiquement. Vérifie à la main : Applis, tape 1 2 3 4 5 : Activé, Host PC IP = 127.0.0.1.")
}

# ---------- 3. optimization ----------
Write-Host ""
Write-Host (Tr "  [3/5] Optimization (Optimize)" "  [3/5] Optimisation (Optimiser)") -ForegroundColor Cyan
$backups = @(Get-ChildItem (Join-Path $env:APPDATA "APL-Launcher") -Filter "optimisation-*.json" -ErrorAction SilentlyContinue |
             Sort-Object LastWriteTime)
$silenced = @(); $gone = @()
foreach ($b in $backups) {
    try {
        $bk = Get-Content $b.FullName -Raw | ConvertFrom-Json
        $silenced += @($bk.silenced | Where-Object { $_ })
        $gone += @($bk.uninstalled | Where-Object { $_ })
    } catch {}
}
if (-not $backups.Count) { Ok (Tr "The optimization was never run from this PC." "L'optimisation n'a jamais été lancée depuis ce PC.") }
else {
    Info (Tr "$($backups.Count) optimization(s) found: $($silenced.Count) component(s) turned off, $($gone.Count) app(s) uninstalled." "$($backups.Count) optimisation(s) trouvée(s) : $($silenced.Count) composant(s) coupé(s), $($gone.Count) app(s) désinstallée(s).")
    foreach ($g in $gone) {
        if ("$($g.appId) $($g.packageId) $($g.name)" -match $RELATED) {
            Bad (Tr "'$($g.name)' [$($g.appId)] was uninstalled by the optimization." "« $($g.name) » [$($g.appId)] a été désinstallé par l'optimisation.") (Tr "Reinstall it from the screen's App Store (or with the TizenBrew installer for TizenBrew)." "Réinstalle-le depuis l'App Store de l'écran (ou l'installateur de TizenBrew pour TizenBrew).")
        }
    }
    $mine = @($silenced | Where-Object { "$($_.appId) $($_.name)" -match $RELATED_ON })
    if ($mine.Count) {
        foreach ($c in $mine) { Bad (Tr "'$($c.name)' [$($c.appId)] was turned off at startup by the optimization." "« $($c.name) » [$($c.appId)] a été coupé au démarrage par l'optimisation.") "" }
        if (Ask-YesNo (Tr "Turn it back on?" "Le remettre en marche ?")) {
            foreach ($c in $mine) {
                foreach ($f in @('onboot', 'autorestart')) {
                    if ($c.$f) { try { [void](Post '/components/action' @{ appId = $c.appId; action = 'flags'; flag = $f; enabled = $true }) } catch {} }
                }
            }
            Ok (Tr "Turned back on." "Remis en marche.")
        }
    } elseif ($silenced.Count) { Ok (Tr "Nothing related to TizenBrew, TizenTube or YouTube was turned off." "Rien de lié à TizenBrew, TizenTube ou YouTube n'a été coupé.") }
}

# ---------- 4. DNS filter ----------
Write-Host ""
Write-Host (Tr "  [4/5] The screen's ad filter (DNS)" "  [4/5] Filtre anti-pub (DNS) de l'écran") -ForegroundColor Cyan
$dns = $null
try { $dns = Invoke-RestMethod -Uri "$base/dns" -TimeoutSec 30 } catch {}
if (-not $dns) { Info (Tr "Could not read the DNS filter." "Filtre DNS illisible.") }
else {
    $all = @($dns.domains | Where-Object { $_ })
    $bad = @($all | Where-Object { $_ -match $NEEDED })
    if ($bad.Count) {
        Bad (Tr "The filter blocks sites TizenBrew / TizenTube need: $($bad -join ', ')" "Le filtre bloque des sites dont TizenBrew / TizenTube ont besoin : $($bad -join ', ')") (Tr "I can remove them from the filter (the rest of the filter is kept)." "Je peux les retirer du filtre (le reste du filtre est gardé).")
        if (Ask-YesNo (Tr "Remove these sites from the filter?" "Retirer ces sites du filtre ?")) {
            try {
                $keep = @($all | Where-Object { $_ -notmatch $NEEDED })
                [void](Post '/dns' @{ action = 'apply'; enabled = [bool]$dns.enabled; domains = $keep })
                Ok (Tr "Sites removed from the filter." "Sites retirés du filtre.")
            } catch { Bad (Tr "Vetro refused the change." "Vetro a refusé le changement.") (Tr "In Vetro (http://$TvIp`:$(Get-VetroPort)) > DNS, remove them by hand." "Dans Vetro (http://$TvIp`:$(Get-VetroPort)) > DNS, retire-les à la main.") }
        }
    } else { Ok (Tr "The filter blocks no YouTube, TizenBrew or module site ($($all.Count) addresses blocked)." "Le filtre ne bloque aucun site de YouTube, TizenBrew ou de ses modules ($($all.Count) adresses bloquées).") }
}
$hosts = Exec "grep -iE 'jsdelivr|youtube|googlevideo|ytimg|github|npmjs|unpkg' /etc/hosts 2>/dev/null; true"
if ($hosts) { Bad (Tr "The screen's hosts file blocks: $($hosts.Trim() -replace '\s+', ' ')" "Le fichier hosts de l'écran bloque : $($hosts.Trim() -replace '\s+', ' ')") (Tr "In Vetro > DNS, remove these addresses, or send me this report." "Dans Vetro > DNS, retire ces adresses, ou envoie-moi ce rapport.") }

# ---------- 5. Internet access from the screen ----------
Write-Host ""
Write-Host (Tr "  [5/5] Internet access from the screen" "  [5/5] Accès à Internet depuis l'écran") -ForegroundColor Cyan
$test = 'for h in cdn.jsdelivr.net www.youtube.com registry.npmjs.org; do ' +
        'a=$(getent hosts $h 2>/dev/null | head -n 1 | cut -d" " -f1); ' +
        'c=000; command -v curl >/dev/null 2>&1 && c=$(curl -s -o /dev/null -m 12 -w "%{http_code}" "https://$h/" 2>/dev/null); ' +
        'echo "$h ${a:-?} ${c:-000}"; done'
$net = Exec $test 90
if (-not $net) { Info (Tr "Test not possible (Vetro refused the command)." "Test impossible (Vetro a refusé la commande).") }
else {
    foreach ($line in ($net -split "`n" | Where-Object { $_.Trim() })) {
        $p = $line.Trim() -split '\s+'
        if ($p.Count -lt 3) { continue }
        $h = $p[0]; $addr = $p[1]; $code = $p[2]
        if ($addr -match '^(0\.0\.0\.0|127\.)') { Bad (Tr "$h is blocked by a filter (response $addr)." "$h est bloqué par un filtre (réponse $addr).") (Tr "Check the filter on your router, Pi-hole or AdGuard: $h must be allowed." "Vérifie le filtre de ta box, Pi-hole ou AdGuard : $h doit être autorisé.") }
        elseif ($code -ne '000') { Ok (Tr "$h reachable." "$h joignable.") }
        else { Info (Tr "${h}: no response to the test (may come from the test itself, not necessarily a problem)." "$h : pas de réponse au test (peut venir du test lui-même, pas forcément un problème).") }
    }
}

# ---------- if it still doesn't work ----------
$others = @($silenced | Where-Object { "$($_.appId) $($_.name)" -notmatch $RELATED_ON })
if ($others.Count) {
    Write-Host ""
    Write-Host (Tr "  If TizenBrew still doesn't work after restarting the screen, we can also" "  Si TizenBrew ne marche toujours pas après un redémarrage de l'écran, on peut aussi") -ForegroundColor White
    Write-Host (Tr "  turn back on the $($others.Count) other Samsung services the optimization turned off." "  remettre les $($others.Count) autres services Samsung coupés par l'optimisation.") -ForegroundColor White
    if (Ask-YesNo (Tr "Turn them back on now?" "Les remettre en marche maintenant ?")) {
        $n = 0
        foreach ($c in $others) {
            foreach ($f in @('onboot', 'autorestart')) {
                if ($c.$f) { try { [void](Post '/components/action' @{ appId = $c.appId; action = 'flags'; flag = $f; enabled = $true }); $n++ } catch {} }
            }
        }
        foreach ($q in @('tracking-all', 'voice-all')) { try { [void](Post '/quick' @{ id = $q; off = $false }) } catch {} }
        Ok (Tr "$n startup setting(s) restored. Restart the screen." "$n réglage(s) de démarrage remis. Redémarre l'écran.")
    }
}

# ---------- summary ----------
Write-Host ""
Write-Host "  ==============================================" -ForegroundColor White
if ($problems.Count) {
    Say (Tr "$($problems.Count) problem(s) found: see the PROBLEM lines above." "$($problems.Count) problème(s) trouvé(s) : voir les lignes PROBLÈME plus haut.") 'Yellow'
} else {
    Say (Tr "No problem found on the screen." "Aucun problème trouvé sur l'écran.") 'Green'
}
Say (Tr "Next:" "Ensuite :") 'White'
Say (Tr "  1. Restart the screen: hold the remote's power button until it restarts." "  1. Redémarre l'écran : maintiens le bouton marche de la télécommande jusqu'au redémarrage.") 'White'
Say (Tr "  The launcher itself closes Samsung's YouTube before opening TizenTube (they get in each other's way)." "  Le launcher ferme lui-même YouTube de Samsung avant d'ouvrir TizenTube (ils se gênent).") 'White'
Say (Tr "  2. Open TizenBrew: if it offers an update (of TizenBrew or of the TizenTube module)," "  2. Ouvre TizenBrew : s'il propose une mise à jour (de TizenBrew ou du module TizenTube),") 'White'
Say (Tr "     accept it. When YouTube changes, TizenTube often needs its latest version." "     accepte-la. Quand YouTube change, TizenTube a souvent besoin de sa dernière version.") 'White'
Say (Tr "  3. Still broken: send me the diagnostic-tizenbrew.txt file." "  3. Toujours en panne : envoie-moi le fichier diagnostic-tizenbrew.txt.") 'White'
Save-Report
Read-Host (Tr "  Press Enter to close" "  Appuie sur Entrée pour fermer")
