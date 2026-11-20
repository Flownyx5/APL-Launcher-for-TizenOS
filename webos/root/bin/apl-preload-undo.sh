#!/bin/sh
# apl-preload-undo.sh: LG preloads its apps again, as before apl-preload-off.sh. Its list comes back from the copy
# kept in $APL/preload-conf.orig.json, each app switched off is switched on again, and the loop of the boot hook
# stops. To keep it after a restart too: touch /media/developer/apl-debloat/OFF-preload (or remove the hook
# /var/lib/webosbrew/init.d/15-apl-preload-off).
export PATH=/usr/bin:/usr/sbin:/bin:/sbin:$PATH
APL=/media/developer/apl-debloat
CONF=/var/preferences/webos-preload-manager-conf.json
PM=luna://com.webos.service.preloadmanager
luna() { luna-send -n 1 -w 8000 "$@" </dev/null 2>/dev/null; }
if [ -f /tmp/apl-preload.pid ]; then kill "$(cat /tmp/apl-preload.pid)" 2>/dev/null; rm -f /tmp/apl-preload.pid; fi
[ -f $APL/preload-conf.orig.json ] && cp $APL/preload-conf.orig.json "$CONF" && echo "apl-preload: LG's list is back"
if [ -f $APL/preload-off.list ]; then
    while read -r id; do
        [ -n "$id" ] && luna $PM/setPreloadPolicy "{\"application\":{\"id\":\"$id\",\"isEnabled\":true}}" >/dev/null
    done < $APL/preload-off.list
    rm -f $APL/preload-off.list
fi
echo "apl-preload: LG preloads its apps again"
exit 0
