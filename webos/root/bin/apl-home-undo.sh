#!/bin/sh
# apl-home-undo.sh: LG's own Home and Guide (and its first-use overlay) back, now. At the next start apl-home.sh runs again unless the boot hook
# 30-apl-home is removed or /media/developer/apl-debloat/OFF-home exists.
export PATH=/usr/bin:/usr/sbin:/bin:/sbin:$PATH
H=/usr/palm/applications/com.webos.app.home
luna() { luna-send "$@" </dev/null; }
grep -q " $H " /proc/mounts || { echo "LG's Home is not replaced"; exit 0; }
for m in $(awk -v h="$H" '$2 == h {print $2}' /proc/mounts); do umount "$m"; done
G=/usr/palm/applications/com.webos.app.livemenu
for m in $(awk -v g="$G" '$2 == g {print $2}' /proc/mounts); do umount "$m"; done
C=/usr/palm/applications/com.webos.app.firstuse-overlay
for m in $(awk -v c="$C" '$2 == c {print $2}' /proc/mounts); do umount "$m"; done
(sleep 3; pkill -9 -f /usr/palm/applications/airplay/LunaExecutable) </dev/null >/dev/null 2>&1 &
systemctl restart sam
for i in $(seq 1 60); do systemctl is-active sam >/dev/null 2>&1 && break; sleep 2; done
sleep 5
pkill -f "[a]pp-id=com.webos.app.home"
sleep 2
luna -n 1 -w 10000 luna://com.webos.applicationManager/launch '{"id":"com.webos.app.home"}' >/dev/null
echo "$(cut -d' ' -f1 /proc/uptime) LG's Home is back" | tee -a /tmp/apl-home.log
