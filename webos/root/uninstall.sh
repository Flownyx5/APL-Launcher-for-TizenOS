#!/bin/sh
# APL Launcher on webOS — one-command uninstaller. Lifts every change
# install.sh made: the boot hooks are removed, the live binds on /etc/hosts
# and on the LG service binaries are undone, and the stopped systemd units
# are started back.
#
# Run this in SSH as root:
#   sh /media/developer/apl-debloat/uninstall.sh
#
# A reboot alone would also undo almost everything (the live binds live in
# RAM and the stopped units restart at boot), as long as the boot hooks
# under /var/lib/webosbrew/init.d/ are removed first — which this script does.
set -u

APL=/media/developer/apl-debloat
HOOK=/var/lib/webosbrew/init.d

echo "APL Launcher — webOS root uninstall"
echo

echo "Removing boot hooks from $HOOK/"
for f in 10-apl-block-updates 11-apl-block-privacy 12-apl-debloat 13-apl-services-stop 14-apl-noload 15-apl-preload-off 20-apl-elevate 21-apl-keep-root 30-apl-home; do
    if [ -e "$HOOK/$f" ]; then
        echo "  $HOOK/$f"
        rm -f "$HOOK/$f"
    fi
done

echo
echo "Stopping the root keeper (apl-keep-root.sh)"
if [ -f /tmp/apl-keep-root.pid ]; then kill "$(cat /tmp/apl-keep-root.pid)" 2>/dev/null; rm -f /tmp/apl-keep-root.pid; fi

echo
echo "LG's own Home back"
[ -r "$APL/apl-home-undo.sh" ] && sh "$APL/apl-home-undo.sh" || echo "  apl-home-undo.sh not found, skipping"

echo
echo "Lifting live changes (apps that never opened, debloat, services)"
[ -r "$APL/apl-noload-undo.sh" ] && sh "$APL/apl-noload-undo.sh" || echo "  apl-noload-undo.sh not found, skipping"
[ -r "$APL/apl-preload-undo.sh" ] && sh "$APL/apl-preload-undo.sh" || echo "  apl-preload-undo.sh not found, skipping"
[ -x "$APL/apl-services-undo.sh" ] && sh "$APL/apl-services-undo.sh" || echo "  apl-services-undo.sh not found, skipping"
[ -x "$APL/apl-debloat-undo.sh"  ] && sh "$APL/apl-debloat-undo.sh"  || echo "  apl-debloat-undo.sh  not found, skipping"

echo
echo "Lifting /etc/hosts bind (update + privacy blocklists)"
for m in $(awk '$2 == "/etc/hosts" {print $2}' /proc/mounts); do
    umount "$m" 2>/dev/null && echo "  umount $m"
done

echo
echo "APL Launcher's service keeps root until the launcher is installed again"
echo "(installing it writes its luna files back to normal)."
echo
echo "Done. The scripts in $APL/ and the pause files (OFF, OFF-*) are kept."
echo "To remove them too:  rm -rf $APL"
echo
echo "A full reboot now puts the TV back to its stock state."
