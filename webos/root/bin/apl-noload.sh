#!/bin/sh
# apl-noload.sh: the apps you don't use never open, even when the TV preloads them on its own (LG Channels).
# For each app in noload.list (one id per line, # for a note), its start page is covered in RAM by a blank one
# (noload/index.html) that closes at once: the TV may still try to open it, nothing runs. Nothing is written
# in the system, the app stays installed; apl-noload-undo.sh puts it back now, a restart without this hook too.
# Started at every boot by init.d/14-apl-noload, then again every 10 minutes (LG mounts its own apps some
# time after the boot hooks run, and again after it updates one: the cover is put back then). OFF-noload
# pauses it. Log: /tmp/apl-noload.log.
# Usage: sh apl-noload.sh [wait]     wait: up to 3 minutes for the apps' files (at a start)
export PATH=/usr/bin:/usr/sbin:/bin:/sbin:$PATH
APL=/media/developer/apl-debloat
LIST=$APL/noload.list
STUB=$APL/noload/index.html
LOG=/tmp/apl-noload.log
log() { echo "$(cut -d' ' -f1 /proc/uptime) $*" >> $LOG; echo "apl-noload: $*"; }
[ -e $APL/OFF ] && exit 0
[ -e $APL/OFF-noload ] && exit 0
[ -r $STUB ] || { log "missing $STUB"; exit 1; }
[ -r $LIST ] || printf '%s\n' "# Apps that never open (apl-noload.sh). One id per line." "com.webos.app.lgchannels" > $LIST
WAIT=0; [ "$1" = wait ] && WAIT=1

# Where the app is installed (LG's own apps appear under /media/system/apps once it has mounted them)
app_dir() {
    for d in /media/system/apps/usr/palm/applications /usr/palm/applications /media/cryptofs/apps/usr/palm/applications; do
        [ -f "$d/$1/appinfo.json" ] && { echo "$d/$1"; return 0; }
    done
    return 1
}

grep -v '^ *#' $LIST | while read -r id; do
    [ -n "$id" ] || continue
    case "$id" in com.knikt.*|org.webosbrew.*|com.webos.app.home|com.webos.app.livetv|com.webos.app.hdmi*|airplay) continue ;; esac
    dir=$(app_dir "$id")
    if [ -z "$dir" ] && [ $WAIT = 1 ]; then
        for i in $(seq 1 36); do sleep 5; dir=$(app_dir "$id") && break; done
    fi
    [ -n "$dir" ] || { log "$id is not installed"; continue; }
    main=$(sed -n 's/.*"main" *: *"\([^"]*\)".*/\1/p' "$dir/appinfo.json" | head -1)
    [ -n "$main" ] || main=index.html
    page="$dir/$main"
    [ -f "$page" ] || { log "$id has no $main"; continue; }
    # already covered: the page reads as the blank one (a cover that LG hid by mounting the app again is not)
    cmp -s $STUB "$page" && continue
    if mount --bind $STUB "$page"; then
        log "$id never opens"
        # a copy the TV opened before it was covered closes now
        luna-send -n 1 -w 3000 luna://com.webos.applicationManager/closeByAppId "{\"id\":\"$id\"}" </dev/null >/dev/null 2>&1
    fi
done
exit 0
