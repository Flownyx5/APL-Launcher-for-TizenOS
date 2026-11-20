#!/bin/sh
# apl-debloat-stop.sh: stop LG's ads, viewing-tracking, telemetry and suggestions daemons.
# RAM-only: a reboot restores them unless run from init.d. Four groups:
#   ads          adoverlay-service (bind-mount over its binary) + a few ad servers in /etc/hosts
#   tracking     acr2 (LivePlus / viewing tracking): the service that reads what is on screen
#   logs         remotelogger and service-logger (systemd)
#   suggestions  contentminer, nudge (systemd) and sportsalarm (bind-mount over its binary)
# Usage:
#   sh apl-debloat-stop.sh                 every group
#   sh apl-debloat-stop.sh ads tracking    only those
# The companion apl-debloat-undo.sh restores each group.
# Based on scripts/debloat-stop.sh in lasharor/cleanyourtv-WebOS (MIT), adapted:
# - no launcher check (APL Launcher does not need to be Home for the debloat to run),
# - every group on by default; one of /media/developer/apl-debloat/OFF-<group> turns that one off.
export PATH=/usr/bin:/usr/sbin:/bin:/sbin:$PATH
APL=/media/developer/apl-debloat
mkdir -p "$APL"
if [ $# -gt 0 ]; then
    G=" $* "
else
    G=" "
    for g in ads tracking logs suggestions; do
        [ -e "$APL/OFF-$g" ] || G="$G$g "
    done
fi
on() { case "$G" in *" $1 "*) return 0 ;; esac; return 1; }
units=""; bins=""
on logs        && units="$units remotelogger service-logger"
on suggestions && { units="$units contentminer nudge"; bins="$bins sportsalarm"; }
on tracking    && bins="$bins acr2"
on ads         && bins="$bins adoverlay-service"
# NOT touching admanager: HBO Max and Disney+ wait for it at start-up (CleanYourTV issue 47).
# systemd units: --no-block so contentminer (slow to stop) doesn't hold up the rest.
for s in $units; do
    systemctl --no-block stop "$s.service" 2>&1 | sed "s/^/$s: /"
done
# luna dynamic services: a do-nothing stub mounted over the binary so ls-hubd can't start them.
printf '#!/bin/sh\nexit 0\n' > "$APL/stub-noop"
chmod +x "$APL/stub-noop"
for b in $bins; do
    [ -e "/usr/sbin/$b" ] || continue
    grep -q " /usr/sbin/$b " /proc/mounts || mount --bind "$APL/stub-noop" "/usr/sbin/$b"
    pkill -9 -f "^/usr/sbin/$b" 2>/dev/null
done
# Ad servers (in addition to the 21 already in init.d/11-apl-block-privacy): the exact subdomains that
# fire on this family of TV (CleanYourTV's three), marked so apl-debloat-undo.sh can remove them.
if on ads && ! grep -q "# apl-debloat" /etc/hosts; then
    cat >> /etc/hosts <<'H'
127.0.0.1 eic.ads.lgtvcommon.com nl.ad.lgsmartad.com nl.info.lgsmartad.com # apl-debloat
::1 eic.ads.lgtvcommon.com nl.ad.lgsmartad.com nl.info.lgsmartad.com # apl-debloat
H
fi
echo "apl-debloat: stopped groups${G%% }"
