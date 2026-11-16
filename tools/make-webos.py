"""Builds APL Launcher for LG TVs (webOS): an .ipk with the launcher and its helper service.

    python tools/make-webos.py                    your own TV: your keys, avatars, fonts and sounds (never publish it)
    python tools/make-webos.py --release          no personal file (apl-launcher-vX.Y.Z-lg-webos.ipk + SHA256)
    python tools/make-webos.py --personal DIR     take the personal files from another launcher/ folder
                                                  (a git worktree has none of its own)
    python tools/make-webos.py --4k               drawn in 3840 x 2160 instead of 1920 x 1080 (sharper, less smooth)

Then, with LG's webOS CLI (npm install -g @webos-tools/cli) and the TV in Developer Mode:
    ares-install -d <tv> dist/com.knikt.apllauncher_<version>_all.ipk
    ares-launch -d <tv> com.knikt.apllauncher

The launcher is the same code as on Samsung (launcher/): js/webos.js finds out it runs on webOS and gives
the rest of the code LG's apps, keys and settings (js/webos-system.js, js/webos-settings.js). Samsung's own
files stay out: config.xml, the Tizen bridge, the webapis script line.
  app id      com.knikt.apllauncher
  service id  com.knikt.apllauncher.service (webos/service/)
The version comes from launcher/config.xml.
"""
import hashlib, json, os, re, shutil, subprocess, sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
L = os.path.join(ROOT, "launcher")
APP_ID = "com.knikt.apllauncher"
SERVICE_ID = APP_ID + ".service"

release = "--release" in sys.argv
# The page LG draws: 1920 x 1080 by default, enlarged by the TV. In 3840 x 2160 (--4k: the launcher's layout
# zoomed twice, js/webos.js) text and glass are as sharp as the panel, but a G5 then spends about 10 ms of each
# frame handing the picture to the screen, whatever the page draws (measured with the inspector, 2026-11-16):
# 76 to 93 % of frames on time, against 83 to 98 % and 58 to 60 images a second everywhere in 1920 x 1080.
# On a rooted TV, Settings › Appearance › Interface Resolution rebuilds the installed package in the other one
# (webos/service, "resolution"). --hd is still accepted: it is the default.
RESOLUTION = "3840x2160" if "--4k" in sys.argv else "1920x1080"
out = os.path.join(ROOT, "dist")
if "--out" in sys.argv:
    out = os.path.abspath(sys.argv[sys.argv.index("--out") + 1])
personal = L
if "--personal" in sys.argv:
    personal = os.path.abspath(sys.argv[sys.argv.index("--personal") + 1])

config = open(os.path.join(L, "config.xml"), encoding="utf-8").read()
version = re.search(r'<widget[^>]*\sversion="([^"]+)"', config).group(1)
work = os.path.join(out, "webos")
app_dir, svc_dir = os.path.join(work, "app"), os.path.join(work, "service")
shutil.rmtree(work, ignore_errors=True)
os.makedirs(app_dir); os.makedirs(svc_dir)

# ---- the launcher: everything in launcher/ but Samsung's own files and the personal ones
SKIP_TOP = {"config.xml", "bridge", "version.json", ".manifest.tmp", "author-signature.xml", "signature1.xml"}
PRIVATE = ("js/keys.local.js", "js/avatars.local.js", "js/keys.example.js")
def is_personal(rel):
    # SF Pro (Apple's license) and your own avatars; the launcher's sounds are in the repository and go everywhere
    return (rel.startswith("fonts/") and not rel.endswith((".css", ".md", ".txt"))) or \
           rel.startswith(("images/avatars/custom/", "images/avatars/memoji/"))
for base, dirs, files in os.walk(L):
    for f in files:
        src = os.path.join(base, f)
        rel = os.path.relpath(src, L).replace("\\", "/")
        if rel.split("/")[0] in SKIP_TOP or rel.endswith(".wgt") or rel in PRIVATE or is_personal(rel):
            continue
        dst = os.path.join(app_dir, rel)
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        shutil.copy2(src, dst)

# index.html without Samsung's API script (it does not exist on LG)
html = open(os.path.join(L, "index.html"), encoding="utf-8").read()
html = re.sub(r'\s*<!-- Samsung API[^>]*-->\s*<script src="\$WEBAPIS/webapis/webapis\.js"></script>', "", html)
if "$WEBAPIS" in html:
    sys.exit("index.html: Samsung's script line was not found, update tools/make-webos.py")
open(os.path.join(app_dir, "index.html"), "w", encoding="utf-8", newline="\n").write(html)

# Keys, avatars, fonts: yours on your own TV; in the published package, empty keys and the Memoji of the profiles
# (downloaded from wimell/tapback-memojis, MIT, as APL Launcher Setup does for Samsung: tools/memoji.py)
keys_src = os.path.join(personal, "js", "keys.local.js")
if release or not os.path.exists(keys_src):
    keys_src = os.path.join(L, "js", "keys.example.js")
shutil.copy2(keys_src, os.path.join(app_dir, "js", "keys.local.js"))
copied = []
if not release:
    for base, dirs, files in os.walk(personal):
        for f in files:
            src = os.path.join(base, f)
            rel = os.path.relpath(src, personal).replace("\\", "/")
            if rel == "js/avatars.local.js" or is_personal(rel):
                dst = os.path.join(app_dir, rel)
                os.makedirs(os.path.dirname(dst), exist_ok=True)
                shutil.copy2(src, dst)
                copied.append(rel)
else:
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import memoji
    names = memoji.fetch(os.path.join(app_dir, "images", "avatars", "memoji"))
    if names:
        open(os.path.join(app_dir, "js", "avatars.local.js"), "w", encoding="utf-8", newline="\n").write(memoji.avatars_js(names))

# Icons: 80 x 80 and 130 x 130 (LG's sizes), from the 512 x 512 one; the splash: the logo on black
from PIL import Image
icon = Image.open(os.path.join(L, "icon.png")).convert("RGBA")
icon.resize((80, 80), Image.LANCZOS).save(os.path.join(app_dir, "icon-80.png"))
icon.resize((130, 130), Image.LANCZOS).save(os.path.join(app_dir, "icon-130.png"))
splash = Image.new("RGB", (1920, 1080), (0, 0, 0))
logo = icon.resize((300, 300), Image.LANCZOS)
splash.paste(logo, ((1920 - 300) // 2, (1080 - 300) // 2), logo)
splash.save(os.path.join(app_dir, "splash.png"))

appinfo = {
    "id": APP_ID,
    "version": version,
    "vendor": "Knikt (Gero Corp.)",
    "type": "web",
    "main": "index.html",
    "title": "APL Launcher",
    "icon": "icon-80.png",
    "largeIcon": "icon-130.png",
    "splashBackground": "splash.png",
    "bgColor": "#000000",
    "iconColor": "#1c1c1e",
    "resolution": RESOLUTION,
    "disableBackHistoryAPI": True,
    "handlesRelaunch": True,
    "transparent": False,
    "appDescription": "Apple TV style Home Screen",
}
json.dump(appinfo, open(os.path.join(app_dir, "appinfo.json"), "w", encoding="utf-8", newline="\n"), indent=2)

# ---- the helper service
for f in ("index.js", "ssap.js"):
    shutil.copy2(os.path.join(ROOT, "webos", "service", f), os.path.join(svc_dir, f))
json.dump({"name": SERVICE_ID, "version": version, "main": "index.js", "description": "APL Launcher helper"},
          open(os.path.join(svc_dir, "package.json"), "w", encoding="utf-8", newline="\n"), indent=2)
json.dump({"id": SERVICE_ID, "description": "LG Connect Apps relay and sleep timer for APL Launcher",
           "services": [{"name": SERVICE_ID, "description": "APL Launcher helper"}]},
          open(os.path.join(svc_dir, "services.json"), "w", encoding="utf-8", newline="\n"), indent=2)

print("APL Launcher", version, "for webOS:", "release" if release else "personal (%d files of yours)" % len(copied), "->", work)

if "--no-package" in sys.argv:
    sys.exit(0)
ares = shutil.which("ares-package") or shutil.which("ares-package.cmd")
if not ares:
    sys.exit("ares-package not found: npm install -g @webos-tools/cli")
subprocess.check_call([ares, "--no-minify", "-o", out, app_dir, svc_dir])
ipk = os.path.join(out, "%s_%s_all.ipk" % (APP_ID, version))
if release:
    final = os.path.join(out, "apl-launcher-v%s-lg-webos.ipk" % version)
    shutil.move(ipk, final)
    ipk = final
    h = hashlib.sha256(open(ipk, "rb").read()).hexdigest()
    open(os.path.join(out, "SHA256SUMS-ipk.txt"), "w", encoding="utf-8", newline="\n").write("%s  %s\n" % (h, os.path.basename(ipk)))

    # The Homebrew Channel's repository (webos/repo, see its README): APL Launcher installs from the TV itself,
    # with no PC. The .ipk is the release's asset: publish the release with it, then commit webos/repo.
    REPO = "Knikt/APL-Launcher"
    RAW = "https://raw.githubusercontent.com/%s/main/" % REPO
    manifest = {
        "id": APP_ID,
        "version": version,
        "type": "web",
        "title": "APL Launcher",
        "appDescription": "An Apple TV style Home Screen",
        "iconUri": RAW + "launcher/icon.png",
        "sourceUrl": "https://github.com/" + REPO,
        "rootRequired": False,
        "ipkUrl": "https://github.com/%s/releases/download/v%s/%s" % (REPO, version, os.path.basename(ipk)),
        "ipkHash": {"sha256": h},
        "ipkSize": os.path.getsize(ipk),
    }
    index = {
        "paging": {"page": 1, "count": 1, "maxPage": 1, "itemsTotal": 1, "prevUrl": None, "nextUrl": None},
        "packages": [{
            "id": APP_ID,
            "title": "APL Launcher",
            "iconUri": manifest["iconUri"],
            "manifestUrl": RAW + "webos/repo/apl-launcher.json",
            "manifest": manifest,
            "pool": "main",
            "shortDescription": "An Apple TV style Home Screen for LG TVs. Root features: see the README.",
            "fullDescriptionUrl": "https://github.com/%s#readme" % REPO,
        }],
    }
    repo_dir = os.path.join(ROOT, "webos", "repo")
    os.makedirs(repo_dir, exist_ok=True)
    json.dump(manifest, open(os.path.join(repo_dir, "apl-launcher.json"), "w", encoding="utf-8", newline="\n"), indent=2)
    json.dump(index, open(os.path.join(repo_dir, "apps.json"), "w", encoding="utf-8", newline="\n"), indent=2)
    print("Homebrew Channel repository:", os.path.join(repo_dir, "apps.json"), "(commit it once the release is published)")
print("package:", ipk, os.path.getsize(ipk), "bytes")
