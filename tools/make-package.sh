#!/usr/bin/env bash
# Builds the launcher packages attached to GitHub Releases, version from launcher/config.xml:
#
#   apl-launcher-v<version>.wgt        the launcher and its web bridge, as APL Launcher Setup builds it
#   apl-launcher-full-v<version>.wgt   with --overlay: one hybrid package for Apps2Samsung, the launcher
#                                      + APL Overlay and its .NET bridge and start-up service
#   SHA256SUMS-wgt.txt                 both, whichever are in the output folder
#
# The package is signed with the Tizen SDK's default certificate. A retail screen only accepts a
# package signed with a certificate that embeds its own DUID, so it does NOT install as is:
# Apps2Samsung re-signs it for the user's screen.
#
# What differs from a build made by APL Launcher Setup:
#   - js/keys.local.js is keys.example.js with empty keys. Apps2Samsung asks for the TMDB,
#     YouTube and Fanart.tv keys and writes them in before re-signing
#     (packaging/apps2samsung/, user_settings). Personal websites stay empty.
#   - no Memoji or custom avatars, no SF Pro fonts, no personal sounds (never published).
#
# The Overlay .tpk comes from tools/make-overlay.sh (package APLauncher, like the launcher).
# Inside a hybrid package the web bridge never runs on the screen (its on-boot is dropped, and not
# one line of it executes): the full package drops it, and its .NET counterpart takes its id.
#
# Used by CI (.github/workflows/setup.yml). Needs the Tizen-Core CLI
# ($TIZEN_SDK/tools/tizen-core/tz, default ~/tizen-sdk) with the certificate generator, rsync,
# zip, unzip, python3.
#
# Usage: tools/make-package.sh [--overlay <overlay.tpk>] [output-dir]   (default: dist)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TPK=""
if [ "${1:-}" = "--overlay" ]; then
    TPK="${2:?--overlay needs the .tpk from tools/make-overlay.sh}"
    [ -f "$TPK" ] || { echo "$TPK not found" >&2; exit 1; }
    TPK="$(cd "$(dirname "$TPK")" && pwd)/$(basename "$TPK")"
    shift 2
fi
OUT="${1:-$ROOT/dist}"
mkdir -p "$OUT"
OUT="$(cd "$OUT" && pwd)"

SDK="${TIZEN_SDK:-$HOME/tizen-sdk}"
TZ="$SDK/tools/tizen-core/tz"
[ -x "$TZ" ] || { echo "$TZ not found (set TIZEN_SDK)" >&2; exit 1; }
command -v zip >/dev/null || { echo "zip is required" >&2; exit 1; }

VERSION="$(python3 -c 'import re,sys; print(re.search(r"<widget[^>]*\sversion=\"([^\"]+)\"", open(sys.argv[1], encoding="utf-8").read()).group(1))' "$ROOT/launcher/config.xml")"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# version.json and js/build.js must match config.xml (tools/make-build.py).
python3 "$ROOT/tools/check.py"

echo "== Launcher $VERSION"
rsync -a \
    --exclude '*.wgt' --exclude '.manifest.tmp' --exclude 'author-signature.xml' --exclude 'signature1.xml' \
    --exclude '*.local.js' --exclude 'keys.example.js' \
    --exclude 'images/avatars/custom/' --exclude 'images/avatars/memoji/' \
    --exclude 'fonts/*.otf' --exclude 'fonts/*.OTF' --exclude 'fonts/*.ttf' --exclude 'fonts/*.TTF' \
    --exclude 'sounds/*.wav' --exclude '.DS_Store' \
    "$ROOT/launcher/" "$WORK/ui/"

# Full package: the .NET bridge in the Overlay's .tpk (overlay/bridge) takes the web one's id,
# APLauncher.Bridge, so the web service is dropped from config.xml. The plain package keeps it.
if [ -n "$TPK" ]; then
python3 - "$WORK/ui/config.xml" <<'PY'
import re, sys
p = sys.argv[1]; s = open(p, encoding="utf-8").read()
s2, n = re.subn(r"\n?[ \t]*<!--(?:(?!-->).)*?bridge/service\.js(?:(?!-->).)*?-->", "", s, flags=re.S)
s2, n = re.subn(r"[ \t]*<tizen:service id=\"APLauncher\.Bridge\".*?</tizen:service>\n?", "", s2, flags=re.S)
if n != 1:
    sys.exit("config.xml: expected one APLauncher.Bridge web service, found %d" % n)
open(p, "w", encoding="utf-8").write(s2)
PY
grep -q "tizen:service" "$WORK/ui/config.xml" && { echo "a web service is left in config.xml" >&2; exit 1; }
fi

# The keys file Apps2Samsung fills in. Its `tmdb: ""` style lines are the find strings of
# packaging/apps2samsung/*.json: keep them in sync.
cp "$ROOT/launcher/js/keys.example.js" "$WORK/ui/js/keys.local.js"
for k in tmdb youtube fanart; do
    grep -q "^    $k: \"\",\$" "$WORK/ui/js/keys.local.js" \
        || { echo "keys.example.js has no '$k: \"\",' line, update packaging/apps2samsung" >&2; exit 1; }
done

# Runs a CLI command; on failure prints the Tizen CLI logs.
run_cli() {
    if ! "$@"; then
        find "$SDK" "$SDK-data" "$HOME" -path '*tizen*' -name '*.log' 2>/dev/null | while read -r log; do
            echo "--- $log"; tail -n 60 "$log"
        done
        return 1
    fi
}

echo "== Package"
# Without -s, tz pack signs with the SDK's default certificate: every screen needs its own
# signature anyway, and Apps2Samsung replaces this one. With --overlay, tz pack adds the Overlay
# .tpk to the launcher as a reference package (hybrid), like the VS Code extension's build.
(cd "$WORK/ui" && zip -qr "$WORK/web.wgt" .)
WGT="$WORK/signed.wgt"
if [ -n "$TPK" ]; then
    run_cli "$TZ" pack -t wgt -k "$TPK" -b "$WORK/web.wgt" -o "$WGT"
    NAME="apl-launcher-full-v$VERSION.wgt"
else
    run_cli "$TZ" pack -t wgt -b "$WORK/web.wgt" -o "$WGT"
    NAME="apl-launcher-v$VERSION.wgt"
fi
[ -f "$WGT" ] || { echo "tz pack produced no $WGT" >&2; exit 1; }

cp "$WGT" "$OUT/$NAME"
# One listing, then a here-string: grep -q on a pipe would kill unzip with SIGPIPE (pipefail).
LIST="$(unzip -l "$OUT/$NAME")"
echo "$LIST" | grep -v -E " (images|res/icons|res/wgt/images)/"
if [ -n "$TPK" ]; then
    # Hybrid layout: the web app under res/wgt/, the Overlay at the root (bin/, shared/res/, res/icons/).
    # packaging/apps2samsung/*.json patches res/wgt/js/keys.local.js: keep the path in sync.
    FILES="config.xml tizen-manifest.xml author-signature.xml signature1.xml
           res/wgt/config.xml res/wgt/index.html res/wgt/js/boot.js res/wgt/js/build.js
           res/wgt/js/keys.local.js res/wgt/css/launcher.css res/wgt/icon.png
           bin/APLOverlay.dll bin/APLBoot.dll bin/Bridge.dll shared/res/APLOverlay.png res/icons/alexa-orb.svg res/icons/check.svg"
else
    FILES="config.xml index.html bridge/service.js js/boot.js js/build.js js/keys.local.js css/launcher.css icon.png
           author-signature.xml signature1.xml"
fi
for f in $FILES; do
    grep -q " $f\$" <<<"$LIST" || { echo "$f is missing from $NAME" >&2; exit 1; }
done
(cd "$OUT" && sha256sum apl-launcher-*.wgt > SHA256SUMS-wgt.txt)
ls -l "$OUT"
