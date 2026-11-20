#!/bin/sh
# apl-preload-off.sh: LG never opens apps in the background on its own any more.
# LG's preload manager keeps apps in memory for a faster start (Netflix, YouTube, Prime Video, LG Channels, the
# browser…), opens them again a few seconds after they are closed and looks again every few minutes: they fill
# the memory and the menus lag. Each app it lists is switched off there in the two places it reads:
#   1. /var/preferences/webos-preload-manager-conf.json (its list, read when it starts): "<id>": true -> false,
#      the original kept once in $APL/preload-conf.orig.json;
#   2. its policy, now (luna setPreloadPolicy isEnabled false): LG sets it again a few minutes after a start
#      and when an app opens, so the boot hook runs this again every 10 minutes (init.d/15-apl-preload-off).
# Then the copies it already opened in the background close, never the app in front, live TV, the inputs,
# LG's Home, APL Launcher or the Homebrew Channel. Nothing is written under /usr.
# The method of webos-debloat (D-Rekk, MIT) and lg-webos-privacy-debloat (meehn69, MIT).
# Undone by apl-preload-undo.sh. Pause: touch /media/developer/apl-debloat/OFF-preload (or OFF).
# Usage: sh apl-preload-off.sh [quiet]
export PATH=/usr/bin:/usr/sbin:/bin:/sbin:$PATH
APL=/media/developer/apl-debloat
CONF=/var/preferences/webos-preload-manager-conf.json
PM=luna://com.webos.service.preloadmanager
AM=luna://com.webos.applicationManager
LIST=$APL/preload-off.list                        # the apps switched off here, one id per line (for the undo)
LOG=/tmp/apl-preload.log
# What LG preloads on these TVs, in case its list doesn't name it (the list is read too)
KNOWN="netflix youtube.leanback.v4 amazon com.webos.app.lgchannels com.webos.app.browser com.webos.app.voice
       com.disney.disneyplus-prod com.apple.appletv cdp-30 hulu vudu spotify-beehive"
log() { echo "$(cut -d' ' -f1 /proc/uptime) $*" >> $LOG; [ "$QUIET" = 1 ] || echo "apl-preload: $*"; }
luna() { luna-send -n 1 -w 8000 "$@" </dev/null 2>/dev/null; }
QUIET=0; [ "$1" = quiet ] && QUIET=1
[ -e $APL/OFF ] && exit 0
[ -e $APL/OFF-preload ] && { log "paused (OFF-preload)"; exit 0; }
never() { case "$1" in com.knikt.*|org.webosbrew.*|com.webos.app.home|com.webos.app.livetv|com.webos.app.hdmi*|com.webos.app.inputcommon|airplay|com.webos.app.airplay) return 0 ;; esac; return 1; }

# The preload manager answers once it is up (up to a minute after a start)
up=0
for i in $(seq 1 30); do luna $PM/getPreloadPolicy '{}' | grep -q '"returnValue": *true' && { up=1; break; }; sleep 2; done
[ $up = 1 ] || log "the preload manager doesn't answer: its list only"

# 1. Its list: the apps it is allowed to preload (the "allowedApps" part of the file)
ids=""
if [ -f "$CONF" ]; then
    [ -f $APL/preload-conf.orig.json ] || cp "$CONF" $APL/preload-conf.orig.json
    part=$(awk '{ s = s $0 } END { i = index(s, "\"allowedApps\""); if (!i) exit 1; s = substr(s, i); j = index(s, "}"); print substr(s, 1, j) }' "$CONF")
    ids=$(echo "$part" | grep -oE '"[A-Za-z0-9._-]+" *: *(true|false)' | sed 's/^"\([^"]*\)".*/\1/')
    changed=0
    for id in $(echo "$part" | grep -oE '"[A-Za-z0-9._-]+" *: *true' | sed 's/^"\([^"]*\)".*/\1/'); do
        never "$id" && continue
        re=$(printf '%s' "$id" | sed 's/\./\\./g')
        sed -i "s/\"$re\" *: *true/\"$id\": false/g" "$CONF" && changed=1
        grep -qx "$id" $LIST 2>/dev/null || echo "$id" >> $LIST
    done
    [ $changed = 1 ] && log "switched off in $CONF"
fi

# 2. Its policy, now: every app of its list and the known ones
for id in $ids $KNOWN; do
    never "$id" && continue
    luna $PM/setPreloadPolicy "{\"application\":{\"id\":\"$id\",\"isEnabled\":false}}" | grep -q '"returnValue": *true' &&
        { grep -qx "$id" $LIST 2>/dev/null || echo "$id" >> $LIST; }
done

# 3. What it already opened in the background closes (not what is in front). Only when run by hand or at a
#    start: later, an app you left in the background is yours (Close Unused Apps, in the launcher's service,
#    closes what the TV opens by itself after a minute)
[ "$QUIET" = 1 ] && [ -f /tmp/apl-preload.done ] && { log "done"; exit 0; }
touch /tmp/apl-preload.done
front=$(luna $AM/getForegroundAppInfo '{}' | sed -n 's/.*"appId": *"\([^"]*\)".*/\1/p' | head -1)
running=$(luna $AM/running '{}' | grep -o '"id": *"[^"]*"' | sed 's/.*"\([^"]*\)"$/\1/')
for id in $running; do
    [ "$id" = "$front" ] && continue
    never "$id" && continue
    grep -qx "$id" $LIST 2>/dev/null || continue
    luna $AM/closeByAppId "{\"id\":\"$id\"}" >/dev/null && log "closed $id (preloaded by the TV)"
done
log "done (front: ${front:-none})"
exit 0
