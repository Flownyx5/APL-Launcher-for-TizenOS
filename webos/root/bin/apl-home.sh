#!/bin/sh
# apl-home.sh: the Home key opens APL Launcher, the TV starts on it, and Guide opens its Control Center over the app.
# home/ (a page named com.webos.app.home that only opens APL Launcher) is mounted in RAM over LG's Home,
# then the app manager (sam) is restarted so it reads it: the way CleanYourTV (MIT) replaces the Flutter
# Home of webOS 24 and newer. Nothing is written under /usr. Undone by apl-home-undo.sh, or by a restart
# once the boot hook 30-apl-home is removed (or /media/developer/apl-debloat/OFF-home exists).
# Safety: if APL Launcher is not running 40 s after, LG's Home comes back by itself.
export PATH=/usr/bin:/usr/sbin:/bin:/sbin:$PATH
APL=/media/developer/apl-debloat
H=/usr/palm/applications/com.webos.app.home
ME=/media/developer/apps/usr/palm/applications/com.knikt.apllauncher
T=/tmp/apl-home
G=/usr/palm/applications/com.webos.app.livemenu
TG=/tmp/apl-guide
# The Control Center over the apps: an LG app that draws a see-through window over the one in front and that the
# TV never opens once set up (its first-use overlay), given APL Launcher's app info, which points at cc.html
C=/usr/palm/applications/com.webos.app.firstuse-overlay
TC=/tmp/apl-cchost
LOG=/tmp/apl-home.log
log() { echo "$(cut -d' ' -f1 /proc/uptime) $*" | tee -a $LOG; }
luna() { luna-send "$@" </dev/null; }

[ -d "$ME" ] || { log "APL Launcher is not installed: LG's Home stays"; exit 0; }
[ -r "$APL/home/index.html" ] && [ -r "$APL/home/appinfo.json" ] || { log "missing $APL/home (install.sh)"; exit 1; }
grep -q " $H " /proc/mounts && { log "LG's Home is already replaced"; exit 0; }

rm -rf $T && mkdir -p $T
cp "$APL/home/index.html" "$APL/home/appinfo.json" $T/ && cp "$ME/icon-80.png" $T/icon.png 2>/dev/null
for i in $(seq 1 60); do systemctl is-active sam >/dev/null 2>&1 && break; sleep 1; done
mount --bind $T $H || { log "the mount over LG's Home failed"; exit 1; }
# The Guide button opens APL Launcher's Control Center (guide/), unless OFF-guide
if [ ! -e "$APL/OFF-guide" ] && [ -r "$APL/guide/index.html" ] && [ -d $G ] && ! grep -q " $G " /proc/mounts; then
    rm -rf $TG && mkdir -p $TG && cp "$APL/guide/index.html" "$APL/guide/appinfo.json" $TG/ && cp "$ME/icon-80.png" $TG/icon.png 2>/dev/null
    mount --bind $TG $G && log "Guide opens the Control Center"
    if [ -r "$APL/cchost/appinfo.json" ] && [ -r "$ME/cc.html" ] && [ -d $C ] && ! grep -q " $C " /proc/mounts; then
        rm -rf $TC && mkdir -p $TC && cp "$APL/cchost/appinfo.json" $TC/ && cp "$ME/icon-80.png" $TC/icon.png 2>/dev/null
        mount --bind $TC $C && log "the Control Center is drawn over the apps"
    fi
fi
log "mounted over LG's Home; restarting the app manager"
# an AirPlay child of sam makes its stop wait about 90 s (CleanYourTV): ended once the stop has begun
(sleep 3; pkill -9 -f /usr/palm/applications/airplay/LunaExecutable) </dev/null >/dev/null 2>&1 &
systemctl restart sam
for i in $(seq 1 60); do systemctl is-active sam >/dev/null 2>&1 && break; sleep 2; done
sleep 6
# Nothing is in front after the restart: Home (APL Launcher), unless something was opened meanwhile (an input)
fg=$(luna -n 1 -w 5000 -f luna://com.webos.applicationManager/getForegroundAppInfo '{}' | grep '"appId"')
case "$fg" in
    *'"appId": ""'*|*com.webos.app.home*|*com.knikt.apllauncher*|"")
        luna -n 1 -w 10000 luna://com.webos.applicationManager/launch '{"id":"com.webos.app.home"}' >/dev/null ;;
esac
for i in $(seq 1 20); do
    luna -n 1 -w 3000 luna://com.palm.webappmanager/listRunningApps '{}' | grep -q '"com.knikt.apllauncher"' && { log "APL Launcher is up: Home opens it"; exit 0; }
    sleep 2
done
log "APL Launcher did not come up: LG's Home is back until the next start"
sh $APL/apl-home-undo.sh
