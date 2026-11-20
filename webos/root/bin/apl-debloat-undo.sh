#!/bin/sh
# apl-debloat-undo.sh: undo apl-debloat-stop.sh.
# Usage:
#   sh apl-debloat-undo.sh                 every group
#   sh apl-debloat-undo.sh ads tracking    only those
# Based on scripts/debloat-undo.sh in lasharor/cleanyourtv-WebOS (MIT).
export PATH=/usr/bin:/usr/sbin:/bin:/sbin:$PATH
G=" ${*:-ads tracking logs suggestions} "
on() { case "$G" in *" $1 "*) return 0 ;; esac; return 1; }
units=""; bins=""
on logs        && units="$units remotelogger service-logger"
on suggestions && { units="$units contentminer nudge"; bins="$bins sportsalarm"; }
on tracking    && bins="$bins acr2"
on ads         && bins="$bins adoverlay-service"
# lift the bind-mounts first (the daemons come back by themselves on demand)
for b in $bins; do
    for m in $(awk -v b="/usr/sbin/$b" 'substr($2,length($2)-length(b)+1)==b {print $2}' /proc/mounts | sort -r); do
        umount "$m" 2>/dev/null
    done
done
for s in $units; do
    systemctl --no-block start "$s.service"
done
# the three ad hostnames added by apl-debloat-stop.sh (never touch lines without our marker)
if on ads && grep -q "# apl-debloat" /etc/hosts; then
    grep -v "# apl-debloat" /etc/hosts > /tmp/hosts.apl.new && cat /tmp/hosts.apl.new > /etc/hosts
    rm -f /tmp/hosts.apl.new
fi
echo "apl-debloat: restored groups${G%% }"
