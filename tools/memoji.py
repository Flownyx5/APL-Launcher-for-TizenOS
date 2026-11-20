"""The 58 Memoji of the profiles, for the packages made on a PC (tools/make-android.py, tools/make-webos.py).

They come from github.com/wimell/tapback-memojis (MIT license, Wes Wimell), at a fixed commit: the same faces APL
Launcher Setup downloads for Samsung screens (scripts/install.ps1). Like there, they are never put in this
repository: downloaded once into a cache on this PC, resized to 200 px, then copied into the package, with the
project's license next to them (images/avatars/memoji/LICENSE.txt).

    from memoji import fetch
    names = fetch("<package>/images/avatars/memoji")      # ["memoji/1.png", …], [] without network

    python3 tools/memoji.py <package>/images/avatars/memoji <package>/js/avatars.local.js     (tools/make-package.sh)

Without Pillow (a bare CI machine) the faces are copied as they are (about 40 KB each) instead of resized.
"""
import os, shutil, sys, urllib.request

COMMIT = "2044fef695febaf43ddcf58932e39da7f5fe6b60"
BASE = "https://raw.githubusercontent.com/wimell/tapback-memojis/%s/" % COMMIT
COUNT = 58


def cache_dir():
    if os.name == "nt" and os.environ.get("APPDATA"):
        return os.path.join(os.environ["APPDATA"], "APL-Launcher", "memoji")       # the Setup's cache too
    return os.path.join(os.path.expanduser("~"), ".cache", "apl-launcher", "memoji")


def _get(url, path):
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "APL-Launcher-build"}), timeout=30) as r:
            data = r.read()
        with open(path, "wb") as f:
            f.write(data)
        return True
    except Exception:
        return False


def fetch(dest):
    """Copies the Memoji into dest (made if needed) and returns their names for js/avatars.local.js."""
    try:
        from PIL import Image
    except ImportError:
        Image = None
    cache = cache_dir()
    os.makedirs(cache, exist_ok=True)
    lic = os.path.join(cache, "LICENSE")
    if not os.path.exists(lic):
        _get(BASE + "LICENSE", lic)
    if not os.path.exists(lic):
        print("Memoji: their license could not be read (no network?): the profiles will use the 3D avatars")
        return []
    for n in range(1, COUNT + 1):
        f = os.path.join(cache, "%d.png" % n)
        if not os.path.exists(f) or os.path.getsize(f) < 1000:
            _get(BASE + "src/public/images/avatars/v1/%d.png" % n, f)
    os.makedirs(dest, exist_ok=True)
    names = []
    for n in range(1, COUNT + 1):
        src = os.path.join(cache, "%d.png" % n)
        if not os.path.exists(src) or os.path.getsize(src) < 1000:
            continue
        if Image is None:
            shutil.copyfile(src, os.path.join(dest, "%d.png" % n))
        else:
            im = Image.open(src).convert("RGBA")
            im.thumbnail((200, 200), Image.LANCZOS)
            square = Image.new("RGBA", (200, 200), (0, 0, 0, 0))
            square.paste(im, ((200 - im.width) // 2, (200 - im.height) // 2), im)
            square.save(os.path.join(dest, "%d.png" % n))
        names.append("memoji/%d.png" % n)
    with open(lic, encoding="utf-8") as f:
        text = f.read()
    with open(os.path.join(dest, "LICENSE.txt"), "w", encoding="utf-8", newline="\n") as f:
        f.write("Memoji from https://github.com/wimell/tapback-memojis (commit %s)\n\n%s" % (COMMIT, text))
    print("Memoji:", len(names), "faces in the package")
    return names


def avatars_js(names):
    """js/avatars.local.js for a published package: the Memoji, no personal avatar."""
    return "window.APL_CUSTOM_AVATARS = [];\nwindow.APL_MEMOJI = [%s];\n" % ", ".join('"%s"' % n for n in names)


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit("usage: memoji.py <images/avatars/memoji folder> <js/avatars.local.js>")
    found = fetch(sys.argv[1])
    if found:
        os.makedirs(os.path.dirname(os.path.abspath(sys.argv[2])), exist_ok=True)
        with open(sys.argv[2], "w", encoding="utf-8", newline="\n") as f:
            f.write(avatars_js(found))
