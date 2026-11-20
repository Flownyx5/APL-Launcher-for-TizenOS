"""Checks run by CI and before each release.

    python3 tools/check.py

- every launcher script parses (node --check);
- version.json and js/build.js match launcher/config.xml and list existing files;
- every image referenced by the catalogs exists;
- no private file (keys, certificates, local avatars) is tracked by git.
"""
import json, os, re, subprocess, sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
L = os.path.join(ROOT, "launcher")
errors = []

def fail(msg):
    errors.append(msg)

# 1. scripts parse
for name in sorted(os.listdir(os.path.join(L, "js"))):
    if name.endswith(".js"):
        r = subprocess.run(["node", "--check", os.path.join(L, "js", name)], capture_output=True, text=True)
        if r.returncode:
            fail("syntax: js/%s\n%s" % (name, r.stderr.strip()))
# the Android layer (android/web, added to the page by tools/make-android.py)
AW = os.path.join(ROOT, "android", "web")
for name in sorted(os.listdir(AW)) if os.path.isdir(AW) else []:
    if name.endswith(".js"):
        r = subprocess.run(["node", "--check", os.path.join(AW, name)], capture_output=True, text=True)
        if r.returncode:
            fail("syntax: android/web/%s\n%s" % (name, r.stderr.strip()))
for name in sorted(os.listdir(os.path.join(L, "bridge"))):
    if name.endswith(".js"):
        r = subprocess.run(["node", "--check", os.path.join(L, "bridge", name)], capture_output=True, text=True)
        if r.returncode:
            fail("syntax: bridge/%s\n%s" % (name, r.stderr.strip()))

# 1b. ES5 for the oldest screens: functions their browser engine doesn't have. String.padStart stopped the
# launcher at start on Tizen 4 (Chromium 56, #35); the others are missing on Tizen 6.0 (Chromium 76) too.
TOO_NEW = {".padStart(": "ES2017", ".padEnd(": "ES2017", "Object.fromEntries(": "ES2019", ".flatMap(": "ES2019",
           ".matchAll(": "ES2020", ".replaceAll(": "ES2021", "Promise.allSettled(": "ES2020", "structuredClone(": "2022"}
for name in sorted(os.listdir(os.path.join(L, "js"))):
    if name.endswith(".js") and ".local." not in name and name not in ("build.js",):
        text = open(os.path.join(L, "js", name), encoding="utf-8").read()
        for call, edition in TOO_NEW.items():
            if call in text:
                fail("js/%s uses %s (%s): too new for the browser of older screens, keep to ES5" % (name, call.strip(".("), edition))
# Android TV boxes can have an old WebView too (Android 7: Chromium 5x)
for name in sorted(os.listdir(AW)) if os.path.isdir(AW) else []:
    if name.endswith(".js"):
        text = open(os.path.join(AW, name), encoding="utf-8").read()
        for call, edition in TOO_NEW.items():
            if call in text:
                fail("android/web/%s uses %s (%s): keep to ES5" % (name, call.strip(".("), edition))
        code = re.sub(r"/\*.*?\*/|//[^\n]*|\"(?:\\.|[^\"\\\n])*\"|'(?:\\.|[^'\\\n])*'", "", text, flags=re.S)
        for word in ("=>", "`", "let ", "const ", "class "):
            if word in code:
                fail("android/web/%s uses %s: keep to ES5" % (name, word.strip()))

# 2. release manifest
config = open(os.path.join(L, "config.xml"), encoding="utf-8").read()
version = re.search(r'<widget[^>]*\sversion="([^"]+)"', config).group(1)
manifest = json.load(open(os.path.join(L, "version.json"), encoding="utf-8"))
if manifest["version"] != version:
    fail("version.json is %s but config.xml is %s: run tools/make-build.py" % (manifest["version"], version))
build = open(os.path.join(L, "js", "build.js"), encoding="utf-8").read()
if '"version": "%s"' % version not in build:
    fail("js/build.js does not match config.xml: run tools/make-build.py")
for path in manifest["scripts"] + manifest["styles"] + manifest["images"]:
    if ".local." not in path and not os.path.exists(os.path.join(L, path)):
        fail("missing file listed in version.json: " + path)
index = open(os.path.join(L, "index.html"), encoding="utf-8").read()
for s in ("js/build.js", "js/boot.js"):
    if s not in index:
        fail("index.html must load " + s)

# 3. catalog images
for cat in ("catalog.js", "devices.js"):
    text = open(os.path.join(L, "js", cat), encoding="utf-8").read()
    for path in re.findall(r'"(images/[^"]+)"', text):
        if not os.path.exists(os.path.join(L, path)):
            fail("%s references a missing image: %s" % (cat, path))

# 4. nothing private tracked
tracked = subprocess.run(["git", "-C", ROOT, "ls-files"], capture_output=True, text=True).stdout.split()
for f in tracked:
    if re.search(r"(\.local\.js$|\.p12$|\.pwd$|\.jks$|\.keystore$|password|images/avatars/(custom|memoji)/)", f, re.I):
        fail("private file tracked by git: " + f)

if errors:
    print("\n".join("✗ " + e for e in errors))
    sys.exit(1)
print("✓ all checks passed (version %s, %d scripts, %d images)" % (version, len(manifest["scripts"]), len(manifest["images"])))
