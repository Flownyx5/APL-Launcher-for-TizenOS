#!/bin/sh
# apl-keep-root.sh: keeps APL Launcher rooted and personal, also after an update of the launcher.
# Started at every boot by init.d/21-apl-keep-root, and by install.sh. Runs in the background, as root.
#
# Installing or updating the launcher (Homebrew Channel, APL Launcher Setup, ares-install) puts in the
# package's own files and writes its service's luna files back to normal. Every 10 seconds this checks:
#   1. the package changed (its appinfo.json): your own files kept in personal/ go back into it, the ones a
#      public package can't have (the SF Pro fonts, your keys.local.js, your avatars). A package that brings
#      keys of its own keeps them, and they become the kept ones;
#   2. the launcher's service runs without root: elevate-service gives it root again and it is restarted
#      (the launcher starts it again on its next call). At most once a minute.
#   3. the launcher's service doesn't run: it is started (one luna call, at most once a minute). It closes
#      the unused apps (Close Unused Apps) and watches the Guide button, and with LG's own Home in front
#      nothing else calls it. OFF-idleclose leaves it stopped.
# Pause: touch /media/developer/apl-debloat/OFF-root. Log: /tmp/apl-keep-root.log.
export PATH=/usr/bin:/usr/sbin:/bin:/sbin:$PATH
APL=/media/developer/apl-debloat
ME=/media/developer/apps/usr/palm/applications/com.knikt.apllauncher
SVC=com.knikt.apllauncher.service
SVCDIR=/media/developer/apps/usr/palm/services/$SVC
E=/media/developer/apps/usr/palm/services/org.webosbrew.hbchannel.service/elevate-service
KEEP=$APL/personal
PID=/tmp/apl-keep-root.pid
LOG=/tmp/apl-keep-root.log

[ -f $PID ] && kill -0 "$(cat $PID)" 2>/dev/null && exit 0
echo $$ > $PID
log() { echo "$(cut -d' ' -f1 /proc/uptime) $*" >> $LOG; }
keys_empty() { [ ! -s "$1" ] || grep -q 'tmdb: *""' "$1"; }

# Your files back into the package, when it doesn't have them
restore() {
    [ -d "$ME" ] && [ -d "$KEEP" ] || return 0
    if [ -s "$KEEP/js/keys.local.js" ] && keys_empty "$ME/js/keys.local.js"; then
        cp "$KEEP/js/keys.local.js" "$ME/js/keys.local.js" && log "keys.local.js put back"
    elif [ -s "$ME/js/keys.local.js" ] && ! keys_empty "$ME/js/keys.local.js"; then
        mkdir -p "$KEEP/js" && cp "$ME/js/keys.local.js" "$KEEP/js/keys.local.js"
    fi
    for d in fonts sounds images/avatars/custom images/avatars/memoji; do
        [ -d "$KEEP/$d" ] || continue
        mkdir -p "$ME/$d"
        for f in "$KEEP/$d"/*; do
            [ -f "$f" ] || continue
            [ -f "$ME/$d/${f##*/}" ] || { cp "$f" "$ME/$d/" && log "$d/${f##*/} put back"; }
        done
    done
    [ -f "$KEEP/js/avatars.local.js" ] && [ ! -f "$ME/js/avatars.local.js" ] && cp "$KEEP/js/avatars.local.js" "$ME/js/" && log "avatars.local.js put back"
    chmod -R a+rX "$ME" 2>/dev/null
}

seen=""
last=0
started=0
log "watching $SVC"
while :; do
    if [ ! -e $APL/OFF-root ]; then
        stamp=$(stat -c %Y "$ME/appinfo.json" 2>/dev/null)
        if [ -n "$stamp" ] && [ "$stamp" != "$seen" ]; then
            restore
            seen=$stamp
        fi
        p=$(pgrep -f "^$SVC" | head -1)
        if [ -n "$p" ] && [ -x "$E" ] && [ -d "$SVCDIR" ] && [ "$(stat -c %u /proc/$p 2>/dev/null)" != 0 ]; then
            now=$(cut -d. -f1 /proc/uptime)
            if [ $((now - last)) -ge 60 ]; then
                last=$now
                "$E" $SVC </dev/null >/dev/null 2>&1
                kill "$p" 2>/dev/null
                log "root given back to $SVC (it ran as uid $(stat -c %u /proc/$p 2>/dev/null))"
            fi
        elif [ -z "$p" ] && [ -d "$SVCDIR" ] && [ ! -e $APL/OFF-idleclose ]; then
            now=$(cut -d. -f1 /proc/uptime)
            if [ $((now - started)) -ge 60 ]; then
                started=$now
                luna-send-pub -n 1 -w 8000 luna://$SVC/idle '{}' </dev/null >/dev/null 2>&1 && log "started $SVC"
            fi
        fi
    fi
    sleep 10
done
