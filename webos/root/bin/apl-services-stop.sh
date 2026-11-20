#!/bin/sh
# apl-services-stop.sh: free RAM by stopping LG's unused background services.
# Two mechanisms, both reversible by apl-services-undo.sh:
#  1. systemd units: stop + kill. Not mask (/etc is read-only); the boot hook re-stops them.
#  2. luna-launched daemons (dynamic services): chmod 000 + bind-mount /dev/null over the binary.
#     ls-hubd respawns a dynamic service on every luna call; the bind redirects it to /dev/null,
#     which exits at once. The real file is not touched (bind is RAM only).
#
# Derived from modules/debloat.sh in JulioFerrero/own-your-glass (MIT): the entries whose
# "Tier A" or "Tier B" safety was documented in its FINDINGS.md, MINUS anything that would break
# AirPlay / Chromecast / casting (avahi) or ThinQ (iot-client, pushclient).
# The user asked these keep working.
#
# WARNING — DO NOT ADD /usr/sbin/sdx. Bind-neutralising it silently kills the TV's Settings UI
# (OYG FINDINGS F42). Left intentionally in place here.
#
# Usage:
#   sh apl-services-stop.sh                 every service below
#   sh apl-services-stop.sh units           only the systemd units
#   sh apl-services-stop.sh binaries        only the binaries
# /media/developer/apl-debloat/OFF-services pauses the lot.
export PATH=/usr/bin:/usr/sbin:/bin:/sbin:$PATH
APL=/media/developer/apl-debloat
mkdir -p "$APL"
[ -e "$APL/OFF-services" ] && { echo "apl-services: paused (OFF-services)"; exit 0; }

case "$1" in
    units)    do_units=1; do_bins=0 ;;
    binaries) do_units=0; do_bins=1 ;;
    *)        do_units=1; do_bins=1 ;;
esac

# --- systemd units: LG features the user doesn't use. One per line, "<unit>".
# avahi-* NOT in this list: AirPlay discovery and Chromecast use mDNS. If you don't need either,
# add `avahi-daemon.service` and `avahi-adaptor.service`.
# iot-client and pushclient NOT in this list either: ThinQ.
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
# Processes those units may leave running. Same order; empty line = no process.
PROCS="
com.webos.service.mycar

com.webos.service.buddyconnector
alwaysready
ai-inference-manager
com.webos.service.ruleengine
wowplay

dmost
ninfod
rdxd
service-logger
"

# --- luna-launched binaries: dynamic services ls-hubd respawns on demand.
# /usr/sbin/admanager NOT in the list: HBO Max and Disney+ wait for it at start-up (OYG F47).
# /usr/sbin/sdx       NOT in the list: breaks Settings UI (OYG F42).
BINS="
/usr/bin/com.webos.app.voice
/usr/sbin/lg.thinqai.adapter
/usr/sbin/airessrvallocator
/usr/sbin/com.webos.service.iotproxy
/usr/sbin/iconnectivity
/usr/sbin/uploadd
/usr/sbin/amazon-alexa-adapter
/usr/sbin/performer
/usr/sbin/nlpmanager
"

MODES="$APL/bin-modes"                          # <path> <octal> per line, for undo
touch "$MODES" 2>/dev/null

if [ "$do_units" = 1 ]; then
    echo "$UNITS" | while IFS= read -r unit; do
        [ -z "$unit" ] && continue
        systemctl --no-block stop "$unit" 2>&1 | sed "s/^/  $unit: /"
    done
    echo "$PROCS" | while IFS= read -r proc; do
        [ -z "$proc" ] && continue
        pkill -9 -x "$proc" 2>/dev/null
    done
fi

if [ "$do_bins" = 1 ]; then
    for path in $BINS; do
        [ -e "$path" ] || continue
        if ! grep -q " $path " /proc/mounts; then
            prev=$(stat -c %a "$path" 2>/dev/null)
            if [ -n "$prev" ] && ! grep -q "^$path " "$MODES" 2>/dev/null; then
                printf '%s %s\n' "$path" "$prev" >> "$MODES"
            fi
            chmod 000 "$path" 2>/dev/null
            mount --bind /dev/null "$path"
        fi
        # Kill any already-running copy; ls-hubd will respawn, hit /dev/null and exit at once.
        name=$(basename "$path")
        pkill -9 -x "$name" 2>/dev/null
    done
fi

echo "apl-services: done."
