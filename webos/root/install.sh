#!/bin/sh
# APL Launcher on webOS — one-command installer for the boot hooks and the
# scripts they run. Pulls the files from this repo and puts them where the
# Homebrew Channel will run them at every boot.
#
# Tested on LG OLED55G56LS (G5, firmware 43.21.77 / 11.2.0-3706, webOS 26),
# with APL Launcher 1.0.24 and Homebrew Channel 0.7.3.
#
# Run this in SSH as root (password `alpine` after rooting with WTFBro):
#
#   wget -qO- https://raw.githubusercontent.com/Knikt/APL-Launcher/main/webos/root/install.sh | sh
#
# or from a feature branch:
#
#   BRANCH=claude/gallant-northcutt-5aae3a \
#   wget -qO- "https://raw.githubusercontent.com/Knikt/APL-Launcher/$BRANCH/webos/root/install.sh" | sh -s -- "$BRANCH"
#
# APL Launcher Setup (Windows) sends the files itself and runs it from that folder:
#
#   APL_SRC=/tmp/apl-root sh /tmp/apl-root/install.sh
#
# To undo everything: sh /media/developer/apl-debloat/uninstall.sh
set -eu

APL_VERSION="1.2.0"
REPO="Knikt/APL-Launcher"
BRANCH="${1:-main}"
URL="https://raw.githubusercontent.com/$REPO/$BRANCH/webos/root"
SRC="${APL_SRC:-}"     # a folder with these files already on the TV (APL Launcher Setup): nothing downloaded

APL=/media/developer/apl-debloat
HOOK=/var/lib/webosbrew/init.d

if [ -n "$SRC" ]; then
    echo "APL Launcher $APL_VERSION — webOS root setup from $SRC"
else
    echo "APL Launcher $APL_VERSION — webOS root setup from $REPO ($BRANCH)"
fi
echo

# Sanity: this should be a rooted LG TV with Homebrew Channel.
[ -d "$HOOK" ] || { echo "ERROR: $HOOK does not exist. Is Homebrew Channel installed?"; exit 1; }
[ -d /var/lib/webosbrew ] || { echo "ERROR: /var/lib/webosbrew does not exist. This isn't a rooted LG TV."; exit 1; }

mkdir -p "$APL" "$HOOK"

fetch() {
    dst="$1"; src="$2"
    echo "  $dst"
    if [ -n "$SRC" ]; then
        cp "$SRC/$src" "$dst"
    elif command -v curl >/dev/null 2>&1; then
        curl -fsSL -o "$dst" "$URL/$src"
    else
        wget -q -O "$dst" "$URL/$src"
    fi
    chmod +x "$dst"
}

echo "Downloading scripts into $APL/"
fetch "$APL/apl-debloat-stop.sh"   bin/apl-debloat-stop.sh
fetch "$APL/apl-debloat-undo.sh"   bin/apl-debloat-undo.sh
fetch "$APL/apl-services-stop.sh"  bin/apl-services-stop.sh
fetch "$APL/apl-services-undo.sh"  bin/apl-services-undo.sh
fetch "$APL/apl-home.sh"           bin/apl-home.sh
fetch "$APL/apl-home-undo.sh"      bin/apl-home-undo.sh
fetch "$APL/apl-keep-root.sh"      bin/apl-keep-root.sh
fetch "$APL/apl-noload.sh"         bin/apl-noload.sh
fetch "$APL/apl-noload-undo.sh"    bin/apl-noload-undo.sh
fetch "$APL/apl-preload-off.sh"    bin/apl-preload-off.sh
fetch "$APL/apl-preload-undo.sh"   bin/apl-preload-undo.sh
fetch "$APL/uninstall.sh"          uninstall.sh
mkdir -p "$APL/noload"
fetch "$APL/noload/index.html"     noload/index.html
mkdir -p "$APL/personal"
mkdir -p "$APL/home"
fetch "$APL/home/index.html"       home/index.html
fetch "$APL/home/appinfo.json"     home/appinfo.json
mkdir -p "$APL/guide"
fetch "$APL/guide/index.html"      guide/index.html
fetch "$APL/guide/appinfo.json"    guide/appinfo.json
mkdir -p "$APL/cchost"
fetch "$APL/cchost/appinfo.json"   cchost/appinfo.json

echo
echo "Downloading boot hooks into $HOOK/"
fetch "$HOOK/10-apl-block-updates"   init.d/10-apl-block-updates
fetch "$HOOK/11-apl-block-privacy"   init.d/11-apl-block-privacy
fetch "$HOOK/12-apl-debloat"         init.d/12-apl-debloat
fetch "$HOOK/13-apl-services-stop"   init.d/13-apl-services-stop
fetch "$HOOK/14-apl-noload"          init.d/14-apl-noload
fetch "$HOOK/15-apl-preload-off"     init.d/15-apl-preload-off
fetch "$HOOK/20-apl-elevate"         init.d/20-apl-elevate
fetch "$HOOK/21-apl-keep-root"       init.d/21-apl-keep-root
fetch "$HOOK/30-apl-home"            init.d/30-apl-home

echo
echo "Giving APL Launcher's service root (picture settings, closing apps)"
sh "$HOOK/20-apl-elevate"
pkill -f com.knikt.apllauncher.service 2>/dev/null || true

# Your own files (SF Pro fonts, keys, avatars) that are in the launcher now are kept in personal/, so an
# update (the Homebrew Channel's public package has none of them) gets them back
ME=/media/developer/apps/usr/palm/applications/com.knikt.apllauncher
if [ -d "$ME" ]; then
    for d in fonts sounds images/avatars/custom images/avatars/memoji; do
        for f in "$ME/$d"/*; do
            case "$f" in *.md|*.txt|*.css|*"*") continue ;; esac
            [ -f "$f" ] && mkdir -p "$APL/personal/$d" && cp "$f" "$APL/personal/$d/"
        done
    done
    if [ -s "$ME/js/keys.local.js" ] && ! grep -q 'tmdb: *""' "$ME/js/keys.local.js"; then
        mkdir -p "$APL/personal/js" && cp "$ME/js/keys.local.js" "$APL/personal/js/"
    fi
    [ -f "$ME/js/avatars.local.js" ] && mkdir -p "$APL/personal/js" && cp "$ME/js/avatars.local.js" "$APL/personal/js/"
fi

echo "Keeping root and your files after every update of the launcher (apl-keep-root.sh)"
if [ -f /tmp/apl-keep-root.pid ]; then kill "$(cat /tmp/apl-keep-root.pid)" 2>/dev/null || true; fi
rm -f /tmp/apl-keep-root.pid
sh "$HOOK/21-apl-keep-root"

printf '%s\n' "$APL_VERSION" > "$APL/VERSION"
if [ -n "$SRC" ]; then echo setup > "$APL/BRANCH"; else printf '%s\n' "$BRANCH" > "$APL/BRANCH"; fi

echo
echo "Installed. Reboot the TV to run the boot hooks."
echo
echo "To apply right now without rebooting:"
echo "  sh $HOOK/10-apl-block-updates"
echo "  sh $HOOK/11-apl-block-privacy"
echo "  sh $APL/apl-debloat-stop.sh"
echo "  sh $APL/apl-services-stop.sh"
echo "  sh $HOOK/14-apl-noload           (LG Channels never opens)"
echo "  sh $HOOK/15-apl-preload-off      (LG no longer opens apps in the background by itself)"
echo "  sh $APL/apl-home.sh             (Home opens APL Launcher; the screen goes black a few seconds)"
echo
echo "LG's Home instead of APL Launcher: touch $APL/OFF-home, or sh $APL/apl-home-undo.sh for now."
echo
echo "To undo everything: sh $APL/uninstall.sh"
