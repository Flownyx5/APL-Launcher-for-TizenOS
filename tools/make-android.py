"""Builds APL Launcher for Android TV and Google TV: two .apk files.

    apl-launcher-v<V>-android.apk               the launcher (no accessibility service: it installs without a Play
                                                Protect warning)
    apl-launcher-home-button-v<V>-android.apk   APL Launcher Home Button, optional: the accessibility service for the
                                                remote's Home and play/pause buttons (android/homebutton). Signed with
                                                the same key as the launcher, or the two can't talk.

    python tools/make-android.py              your own devices: your keys, fonts and avatars (never publish it)
    python tools/make-android.py --release    the package for GitHub Releases: no personal file (no key, no SF Pro, which
                                              Apple's license keeps out); the launcher's sounds, and the Memoji of the
                                              profiles downloaded from wimell/tapback-memojis (MIT, tools/memoji.py)
    python tools/make-android.py --dev        your own devices, and the page can be inspected from the PC (chrome://inspect)

Needs a JDK 17+, the Android SDK (platforms/android-35, build-tools/35.0.0), Gradle 8.10, Node and Pillow:
    ANDROID_HOME (default E:/Android/Sdk), GRADLE (default E:/Android/gradle-8.10.2/bin/gradle.bat),
    JAVA_HOME (default: the Temurin JDK 21 of this PC), GRADLE_USER_HOME (default E:/Android/gradle-home).

The launcher is the same code as on Samsung (launcher/), copied into the Android app's assets with the
Android layer (android/web: android.js, the Control Center page cc.html). Nothing in launcher/ changes:
the Samsung packages are made from it as before.

Signing: an Android app must always be signed with the SAME key, or it cannot be updated (it has to be
uninstalled first, which loses the Home Screen layout and the settings). APL Launcher's key is kept outside
the repository, as apl-launcher-release.jks with its password file apl-launcher-release.txt next to it, in
the first of these folders that has it: APL_KEYSTORE_DIR (only that one when it is set), E:/Android/keys-backup
(this PC), %APPDATA%/APL-Launcher. On GitHub it would come from the repository's secrets (APL_KEYSTORE_FILE
and APL_KEYSTORE_PASS). No key yet: the package is signed with the Android SDK's own test key and named
"-testkey" (for the emulator and your own tests, never to publish); --new-key makes APL Launcher's key.
"""
import json, os, re, secrets, shutil, subprocess, sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
L = os.path.join(ROOT, "launcher")
WEB = os.path.join(ROOT, "android", "web")
AND = os.path.join(ROOT, "android")
MAIN = os.path.join(AND, "app", "src", "main")

release = "--release" in sys.argv
dev = "--dev" in sys.argv and not release
out = os.path.join(ROOT, "dist")

config = open(os.path.join(L, "config.xml"), encoding="utf-8").read()
version = re.search(r'<widget[^>]*\sversion="([^"]+)"', config).group(1)

# ---- the launcher in the assets
assets = os.path.join(MAIN, "assets")
shutil.rmtree(assets, ignore_errors=True)
app_dir = os.path.join(assets, "app")
os.makedirs(app_dir)
SKIP_TOP = {"config.xml", "bridge", "version.json", ".manifest.tmp", "author-signature.xml", "signature1.xml"}
PERSONAL = ("js/keys.local.js", "js/avatars.local.js")
def skip(rel):
    rel = rel.replace("\\", "/")
    if rel.split("/")[0] in SKIP_TOP or rel.endswith((".wgt", ".tpk")):
        return True
    if rel in PERSONAL or rel == "js/keys.example.js":
        return True                                   # handled below
    if release and (rel.startswith("images/avatars/custom/") or rel.startswith("images/avatars/memoji/")):
        return True
    if release and rel.startswith("fonts/") and not rel.endswith((".css", ".md", ".txt")):
        return True                                   # SF Pro: Apple's license, never in a published package
    return False
for base, dirs, files in os.walk(L):
    for f in files:
        src = os.path.join(base, f)
        rel = os.path.relpath(src, L)
        if skip(rel):
            continue
        dst = os.path.join(app_dir, rel)
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        shutil.copy2(src, dst)

keys_src = os.path.join(L, "js", "keys.example.js" if release else "keys.local.js")
if not os.path.exists(keys_src):
    keys_src = os.path.join(L, "js", "keys.example.js")
shutil.copy2(keys_src, os.path.join(app_dir, "js", "keys.local.js"))
avatars = os.path.join(L, "js", "avatars.local.js")
have_avatars = not release and os.path.exists(avatars)
if have_avatars:
    shutil.copy2(avatars, os.path.join(app_dir, "js", "avatars.local.js"))
elif release:
    # The Memoji for the profiles, as APL Launcher Setup gives Samsung screens (never your own avatars)
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import memoji
    names = memoji.fetch(os.path.join(app_dir, "images", "avatars", "memoji"))
    if names:
        open(os.path.join(app_dir, "js", "avatars.local.js"), "w", encoding="utf-8", newline="\n").write(memoji.avatars_js(names))
        have_avatars = True

# index.html: no Samsung API (webapis.js is the screen's own file)
html = open(os.path.join(L, "index.html"), encoding="utf-8").read()
html = re.sub(r'\s*<!-- Samsung API[^>]*-->\s*<script src="\$WEBAPIS/webapis/webapis\.js"></script>', "", html)
if "$WEBAPIS" in html:
    sys.exit("index.html: Samsung's script line was not found, update tools/make-android.py")
open(os.path.join(app_dir, "index.html"), "w", encoding="utf-8", newline="\n").write(html)

# js/build.js: the same scripts, with the Android layer right before launcher.js starts the launcher
build_js = open(os.path.join(L, "js", "build.js"), encoding="utf-8").read()
m = re.search(r"window\.APL_BUILD\s*=\s*(\{.*\});", build_js, re.S)
if not m:
    sys.exit("js/build.js: APL_BUILD not found, update tools/make-android.py")
build = json.loads(m.group(1))
# preview.js is the PC preview's frame and on-screen remote: not on a TV
scripts = [s for s in build["scripts"] if (s != "js/avatars.local.js" or have_avatars) and s != "js/preview.js"]
if "js/launcher.js" not in scripts:
    sys.exit("js/build.js has no js/launcher.js, update tools/make-android.py")
scripts.insert(scripts.index("js/launcher.js"), "js/android.js")
build["scripts"] = scripts
open(os.path.join(app_dir, "js", "build.js"), "w", encoding="utf-8", newline="\n").write(
    "/* GENERATED by tools/make-android.py: the Android version's contents. */\nwindow.APL_BUILD = " + json.dumps(build) + ";\n")

# The Android layer, and the Control Center over the apps with the few modules it needs
shutil.copy2(os.path.join(WEB, "android.js"), os.path.join(app_dir, "js", "android.js"))
shutil.copy2(os.path.join(WEB, "android.css"), os.path.join(app_dir, "css", "android.css"))
shutil.copy2(os.path.join(WEB, "yt.html"), os.path.join(app_dir, "yt.html"))          # the trailer's relay (Web.kt, trailer.js)
CC = ["js/lang-fr.js", "js/lang-ms.js", "js/lang-pl.js", "js/lang-tr.js", "js/i18n.js", "js/system.js", "js/icons.js", "js/navigation.js"] + \
     (["js/avatars.local.js"] if have_avatars else []) + ["js/profiles.js", "js/controlcenter.js", "js/android.js"]
for s in CC:
    if not os.path.exists(os.path.join(app_dir, s)):
        sys.exit("cc.html needs " + s + ", which is missing")
cc = open(os.path.join(WEB, "cc.html"), encoding="utf-8").read()
tags = "\n    ".join('<script src="%s"></script>' % s for s in CC)
if "<!-- SCRIPTS" not in cc:
    sys.exit("android/web/cc.html: the SCRIPTS line is missing")
cc = re.sub(r"<!-- SCRIPTS[^>]*-->", tags, cc)
open(os.path.join(app_dir, "cc.html"), "w", encoding="utf-8", newline="\n").write(cc)

# ---- icons and the Android TV banner (320 x 180), from the launcher's 512 x 512 icon
from PIL import Image, ImageDraw, ImageFont
icon = Image.open(os.path.join(L, "icon.png")).convert("RGBA")
for folder, size in (("mipmap-mdpi", 48), ("mipmap-hdpi", 72), ("mipmap-xhdpi", 96), ("mipmap-xxhdpi", 144), ("mipmap-xxxhdpi", 192)):
    d = os.path.join(MAIN, "res", folder)
    os.makedirs(d, exist_ok=True)
    icon.resize((size, size), Image.LANCZOS).save(os.path.join(d, "ic_launcher.png"))
banner = Image.new("RGB", (320, 180), (0, 0, 0))
px = banner.load()
for y in range(180):
    for x in range(320):
        t = (x / 320.0) * 0.6 + (y / 180.0) * 0.4
        px[x, y] = (int(40 - 30 * t), int(40 - 30 * t), int(48 - 36 * t))
logo = icon.resize((96, 96), Image.LANCZOS)
banner.paste(logo, (22, 42), logo)
draw = ImageDraw.Draw(banner)
font = None
for f in (os.path.join(L, "fonts", "SFPRODISPLAYBOLD.OTF"), "C:/Windows/Fonts/segoeuib.ttf", "C:/Windows/Fonts/arialbd.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"):
    if os.path.exists(f):
        font = ImageFont.truetype(f, 34); break
draw.text((132, 52), "APL", fill=(255, 255, 255), font=font or ImageFont.load_default())
draw.text((132, 90), "Launcher", fill=(255, 255, 255), font=font or ImageFont.load_default())
os.makedirs(os.path.join(MAIN, "res", "drawable"), exist_ok=True)
banner.save(os.path.join(MAIN, "res", "drawable", "banner.png"))

# APL Launcher Home Button: the same icon with a small house, and its own banner
HB = os.path.join(AND, "homebutton", "src", "main")
def house(img):
    img = img.copy()
    d = ImageDraw.Draw(img)
    w = img.size[0]
    r = int(w * 0.36)                     # the badge, bottom right
    x0 = y0 = w - r - int(w * 0.04)
    d.ellipse((x0, y0, x0 + r, y0 + r), fill=(10, 132, 255, 255))
    cx, cy, k = x0 + r / 2.0, y0 + r / 2.0, r / 100.0
    d.polygon([(cx - 26 * k, cy - 2 * k), (cx, cy - 26 * k), (cx + 26 * k, cy - 2 * k)], fill=(255, 255, 255, 255))
    d.rectangle((cx - 18 * k, cy - 4 * k, cx + 18 * k, cy + 24 * k), fill=(255, 255, 255, 255))
    d.rectangle((cx - 6 * k, cy + 8 * k, cx + 6 * k, cy + 24 * k), fill=(10, 132, 255, 255))
    return img
hicon = house(icon)
for folder, size in (("mipmap-mdpi", 48), ("mipmap-hdpi", 72), ("mipmap-xhdpi", 96), ("mipmap-xxhdpi", 144), ("mipmap-xxxhdpi", 192)):
    d = os.path.join(HB, "res", folder)
    os.makedirs(d, exist_ok=True)
    hicon.resize((size, size), Image.LANCZOS).save(os.path.join(d, "ic_launcher.png"))
hbanner = Image.new("RGB", (320, 180), (0, 0, 0))
hpx = hbanner.load()
for y in range(180):
    for x in range(320):
        hpx[x, y] = px[x, y]
hlogo = hicon.resize((96, 96), Image.LANCZOS)
hbanner.paste(hlogo, (22, 42), hlogo)
hdraw = ImageDraw.Draw(hbanner)
small = None
for f in (os.path.join(L, "fonts", "SFPRODISPLAYBOLD.OTF"), "C:/Windows/Fonts/segoeuib.ttf", "C:/Windows/Fonts/arialbd.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"):
    if os.path.exists(f):
        small = ImageFont.truetype(f, 30); break
hdraw.text((132, 54), "Home", fill=(255, 255, 255), font=small or ImageFont.load_default())
hdraw.text((132, 90), "Button", fill=(255, 255, 255), font=small or ImageFont.load_default())
os.makedirs(os.path.join(HB, "res", "drawable"), exist_ok=True)
hbanner.save(os.path.join(HB, "res", "drawable", "banner.png"))

# ---- the tools (on this PC: E:, where there is room; elsewhere: what the machine provides)
win = os.name == "nt"
sdk = os.environ.get("ANDROID_HOME") or os.environ.get("ANDROID_SDK_ROOT") or ("E:/Android/Sdk" if win else "")
gradle = os.environ.get("GRADLE") or ("E:/Android/gradle-8.10.2/bin/gradle.bat" if win else "gradle")
java = os.environ.get("JAVA_HOME") or ("C:/Program Files/Eclipse Adoptium/jdk-21.0.11.10-hotspot" if win else "")
if not sdk:
    sys.exit("ANDROID_HOME is not set")
open(os.path.join(AND, "local.properties"), "w", encoding="utf-8").write("sdk.dir=" + sdk.replace("\\", "/").replace(":", "\\:") + "\n")
env = dict(os.environ, ANDROID_HOME=sdk, ANDROID_SDK_ROOT=sdk)
if java: env["JAVA_HOME"] = java
if win:
    env.setdefault("GRADLE_USER_HOME", "E:/Android/gradle-home")
    env.setdefault("ANDROID_USER_HOME", "E:/Android/user")
keytool = os.path.join(java, "bin", "keytool") if java else "keytool"

# ---- the signing key (see the top of this file): APL Launcher's own, never APL TV's
args = [gradle, "-p", AND, "--no-daemon", "-q", "assembleRelease", "-PaplVersion=" + version] + (["-PaplDebuggable=1"] if dev else [])
testkey = False
jks, pw = os.environ.get("APL_KEYSTORE_FILE"), os.environ.get("APL_KEYSTORE_PASS")
if not jks:
    if os.environ.get("APL_KEYSTORE_DIR"):
        dirs = [os.environ["APL_KEYSTORE_DIR"]]
    else:
        dirs = (["E:/Android/keys-backup"] if win and os.path.isdir("E:/Android") else []) + \
               [os.path.join(os.environ.get("APPDATA") or os.path.expanduser("~"), "APL-Launcher")]
    keydir = next((d for d in dirs if os.path.exists(os.path.join(d, "apl-launcher-release.jks"))), None)
    if not keydir and "--new-key" in sys.argv:
        keydir = dirs[0]
        os.makedirs(keydir, exist_ok=True)
        jks, pwfile = os.path.join(keydir, "apl-launcher-release.jks"), os.path.join(keydir, "apl-launcher-release.txt")
        new_pw = secrets.token_urlsafe(24)
        # the password goes through the environment: never on a command line, never in an error message
        subprocess.check_call([keytool, "-genkeypair", "-keystore", jks, "-storetype", "PKCS12", "-alias", "apllauncher",
                               "-keyalg", "RSA", "-keysize", "4096", "-validity", "10000", "-storepass:env", "APL_KEYSTORE_PASS",
                               "-keypass:env", "APL_KEYSTORE_PASS", "-dname", "CN=APL Launcher, O=Gero Corp., C=FR"],
                              env=dict(os.environ, APL_KEYSTORE_PASS=new_pw))
        open(pwfile, "w", encoding="utf-8").write(new_pw)
        print("new signing key:", jks, "(keep a copy of it and of", os.path.basename(pwfile) + ")")
    if keydir:
        jks, pwfile = os.path.join(keydir, "apl-launcher-release.jks"), os.path.join(keydir, "apl-launcher-release.txt")
        if not os.path.exists(pwfile):
            sys.exit("apl-launcher-release.txt (the key's password) is missing next to " + jks)
        pw = open(pwfile, encoding="utf-8").read().strip()
        print("signing key:", os.path.normpath(jks))
    else:
        testkey = True
        print("no APL Launcher key yet: signed with the Android SDK's test key (emulator and tests only)")
if jks:
    if not pw:
        sys.exit("APL_KEYSTORE_PASS is not set")
    env["APL_KEYSTORE_PASS"] = pw
    args += ["-PaplKeystore=" + jks, "-PaplKeyAlias=apllauncher"]
if release and testkey:
    sys.exit("--release needs APL Launcher's own key (--new-key makes it): a package signed with the test key must never be published")

print("APL Launcher", version, "for Android:", "release" if release else ("dev" if dev else "personal"))
if subprocess.call(args, env=env, shell=False) != 0:
    sys.exit("the Android build failed (see above)")
os.makedirs(out, exist_ok=True)
suffix = ("" if release else ("-dev" if dev else "-personal")) + ("-testkey" if testkey else "")
finals = []
for module, name, fixed in (("app", "apl-launcher", "apl-launcher-android.apk"), ("homebutton", "apl-launcher-home-button", "apl-launcher-home-button.apk")):
    apk = os.path.join(AND, module, "build", "outputs", "apk", "release", module + "-release.apk")
    final = os.path.join(out, "%s-v%s-android%s.apk" % (name, version, suffix))
    shutil.copy2(apk, final)
    finals.append(final)
    print("package:", final, os.path.getsize(final), "bytes")
    # The release also carries each one under a fixed name: .../releases/latest/download/<name>, for Downloader
    if release:
        shutil.copy2(final, os.path.join(out, fixed))
if release:
    import hashlib
    with open(os.path.join(out, "SHA256SUMS-apk.txt"), "w", encoding="utf-8", newline="\n") as f:
        for final in finals:
            f.write("%s  %s\n" % (hashlib.sha256(open(final, "rb").read()).hexdigest(), os.path.basename(final)))
