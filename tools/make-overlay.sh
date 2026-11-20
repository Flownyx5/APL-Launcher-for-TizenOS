#!/usr/bin/env bash
# Builds APL Overlay (overlay/) into a .tpk with the Tizen .NET workload, the way the VS Code
# Tizen extension does, in a scratch copy with the resources 05-build-overlay.ps1 adds:
#   res/icons/*.svg          the launcher's icons (launcher/js/icons.js) in white, plus overlay/icons
#   shared/res/APLOverlay.png
# The SF Pro fonts are not published, so res/fonts stays empty and the system font is used.
#
# Needs: .NET SDK 8 with the Tizen workload (Samsung/Tizen.NET workload-install.sh), python3, rsync.
# Usage: tools/make-overlay.sh <output.tpk>
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${1:?usage: make-overlay.sh <output.tpk>}"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

rsync -a --exclude bin --exclude obj --exclude icons --exclude hybrid "$ROOT/overlay/" "$WORK/overlay/"
# The hybrid's manifest: the overlay and the two .NET services in the launcher's package. The separate
# .tpk for Tizen 6 (tools/make-tizen6.py) keeps overlay/tizen-manifest.xml (apl.launcher.overlay).
cp "$ROOT/overlay/hybrid/tizen-manifest.xml" "$WORK/overlay/tizen-manifest.xml"
# Same version as the launcher's config.xml: one package, one version.
VERSION="$(python3 -c 'import re,sys; print(re.search(r"<widget[^>]*\sversion=\"([^\"]+)\"", open(sys.argv[1], encoding="utf-8").read()).group(1))' "$ROOT/launcher/config.xml")"
python3 - "$WORK/overlay/tizen-manifest.xml" "$VERSION" <<'PY'
import re, sys
p, v = sys.argv[1], sys.argv[2]
s = open(p, encoding="utf-8").read()
s, n = re.subn(r'(<manifest\b[^>]*\sversion=")[^"]*(")', r"\g<1>" + v + r"\g<2>", s, count=1)
if n != 1:
    sys.exit("no version in the hybrid manifest")
open(p, "w", encoding="utf-8").write(s)
PY
mkdir -p "$WORK/overlay/res/icons" "$WORK/overlay/shared/res"
python3 - "$ROOT/launcher/js/icons.js" "$WORK/overlay/res/icons" <<'PY'
import re, sys
js, out = sys.argv[1], sys.argv[2]
n = 0
for name, inner in re.findall(r"(?m)^\s+(\w+):\s*'(<.+?)',?\s*$", open(js, encoding="utf-8").read()):
    inner = inner.replace("currentColor", "#ffffff")
    svg = ('<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 24 24" fill="none" '
           'stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + inner + '</svg>')
    open(f"{out}/{name}.svg", "w", encoding="utf-8").write(svg)
    n += 1
if not n:
    sys.exit("no icons found in " + js)
print(n, "icons")
PY
cp "$ROOT"/overlay/icons/*.svg "$WORK/overlay/res/icons/"
cp "$ROOT/launcher/images/settings-icon.png" "$WORK/overlay/shared/res/APLOverlay.png"

dotnet build "$WORK/overlay/APLOverlay.csproj" -c Release -v:m -nologo
TPK="$(find "$WORK/overlay/bin/Release" -name '*.tpk' | head -n 1)"
[ -n "$TPK" ] || { echo "no .tpk built" >&2; exit 1; }
LIST="$(unzip -l "$TPK")"
echo "$LIST"
for f in tizen-manifest.xml bin/APLOverlay.dll bin/APLBoot.dll bin/Bridge.dll shared/res/APLOverlay.png res/icons/check.svg res/icons/alexa-orb.svg; do
    grep -q " $f\$" <<<"$LIST" || { echo "$f is missing from the .tpk" >&2; exit 1; }
done
cp "$TPK" "$OUT"
