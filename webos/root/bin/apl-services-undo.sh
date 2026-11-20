#!/bin/sh
# apl-services-undo.sh: undo apl-services-stop.sh.
# - Lifts the bind-mounts over each binary and restores its original mode (from bin-modes).
# - Starts the systemd units back.
# A reboot alone would also undo everything, as long as the boot hook (13-apl-services-stop)
# has been removed first.
export PATH=/usr/bin:/usr/sbin:/bin:/sbin:$PATH
APL=/media/developer/apl-debloat
MODES="$APL/bin-modes"

# Lift binds first, then restore modes (in reverse order so the top mount goes first).
if [ -r "$MODES" ]; then
    awk '{print $1}' "$MODES" | while IFS= read -r path; do
        for m in $(awk -v p="$path" 'substr($2,length($2)-length(p)+1)==p {print $2}' /proc/mounts | sort -r); do
            umount "$m" 2>/dev/null
        done
    done
    while IFS=' ' read -r path mode; do
        [ -n "$path" ] && [ -n "$mode" ] && [ -e "$path" ] && chmod "$mode" "$path" 2>/dev/null
    done < "$MODES"
    mv "$MODES" "$MODES.done.$(date +%s)" 2>/dev/null
fi

UNITS="
com.webos.service.mycar.service
com.webos.service.familycare.service
com.webos.service.buddyconnector.service
alwaysready.service
ai-inference-manager.service
com.webos.service.ruleengine.service
wowplay.service
cups-lpd.socket
dmost.service
ninfod.service
rdxd.service
service-logger.service
"
echo "$UNITS" | while IFS= read -r unit; do
    [ -z "$unit" ] && continue
    systemctl --no-block start "$unit" 2>&1 | sed "s/^/  $unit: /"
done

echo "apl-services: restored."
