"""Builds the two packages for Tizen 6 screens (6.0 and 6.5) from the full package of the same version.

    python3 tools/make-tizen6.py <apl-launcher-full-v<version>.wgt> [output-dir]   (default: the .wgt's folder)

On Tizen 6, opening the launcher (the web app) of the hybrid package starts the package's .NET UI app, APL
Overlay, instead: same pid, and the launcher never shows (#10, #21). The .NET services start normally. So
Tizen 6 gets two packages, for each of Tizen 6.0 (TizenFX API 8) and Tizen 6.5 (API 9):

    apl-launcher-tizen6X-v<version>.wgt   the full package without APL Overlay: the launcher, the .NET bridge
                                          and the start-up service, these two built for Tizen 6
    apl-overlay-tizen6X-v<version>.tpk    APL Overlay alone, package and app apl.launcher.overlay (an id the
                                          launcher knows, launcher/js/overlay.js), from overlay/tizen-manifest.xml

and SHA256SUMS-wgt.txt again, with every apl-launcher-*.wgt and apl-overlay-*.tpk of the output folder.

The .NET parts are compiled with csc against .NET Core 3.1 (what Tizen 6 runs: 3.1.3 on The Frame 2022 and on
an AU7700) and the TizenFX reference assemblies of the screen's API level, with the TIZEN6 symbol (the code
for Tizen 6 in overlay/). Two builds, not one: View.CornerRadius is a float in API 8 and a Vector4 from API 9,
and an API 8 build stops on Tizen 6.5 (MissingMethodException set_CornerRadius). The reference packages come
from nuget.org, pinned and checked (REFS).

Both packages are left unsigned: every screen needs its own signature anyway, and APL Launcher Setup
(scripts/03-build-launcher.ps1) or Apps2Samsung signs them for it. What APL Launcher Setup installs with them
(the API keys, avatars, fonts) goes into res/wgt/ of the launcher package, as in the full package.

csc: $CSC if set (a csc.exe, or a csc.dll run with dotnet), else the newest .NET SDK's (dotnet --list-sdks),
else Visual Studio's on Windows. The reference packages are kept in $TIZEN6_REFS (default: ~/.cache/apl-tizen6).
Used by CI (.github/workflows/setup.yml), after tools/make-package.sh --overlay.
"""
import glob, hashlib, io, json, os, re, shutil, subprocess, sys, tempfile, urllib.request, zipfile

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

# id, version, sha256 of the .nupkg (nuget.org), the folder of its reference assemblies
REFS = {
    "core": ("Microsoft.NETCore.App.Ref", "3.1.0", "9ee02f1f0989dacdce6f5a8d0c7d7eb95ddac0e65a5a5695dc57a74e63d45b23", "ref/netcoreapp3.1/"),
    "api8": ("Tizen.NET.API8", "8.0.0.15631", "82bb282e31b0b5fe7d0d3b3dfbc1e33947e8094a4b5d5b23ae4b868a23366d0e", "ref/netstandard2.0/"),
    "api9": ("Tizen.NET.API9", "9.0.0.16760", "e7de50af0dedd9561b737385c16a50ddfb8e98a257104db4c8d11ae14a3bfe72", "ref/netstandard2.0/"),
}
# tag in the file names, api-version in the manifests, TizenFX reference package
TARGETS = [("tizen60", "6.0", "api8"), ("tizen65", "6.5", "api9")]

RUNTIMECONFIG = json.dumps({"runtimeOptions": {"tfm": "netcoreapp3.1",
                                               "framework": {"name": "Microsoft.NETCore.App", "version": "3.1.0"}}}, indent=2) + "\n"
SIGNATURES = ("author-signature.xml", "signature1.xml")
OVERLAY_PRIVILEGE = "http://tizen.org/privilege/window.priority.set"   # its notification window on Tizen 6


def die(msg):
    sys.exit("make-tizen6: " + msg)


# ---------- reference assemblies ----------
def fetch_refs(cache):
    """{name: folder of its .dll} for every reference package, downloaded once and checked."""
    out = {}
    for name, (pid, ver, sha, sub) in REFS.items():
        folder = os.path.join(cache, "%s.%s" % (pid.lower(), ver))
        done = os.path.join(folder, ".ok")
        if not os.path.exists(done):
            url = "https://api.nuget.org/v3-flatcontainer/%s/%s/%s.%s.nupkg" % (pid.lower(), ver, pid.lower(), ver)
            print("== downloading", pid, ver)
            data = urllib.request.urlopen(url, timeout=120).read()
            got = hashlib.sha256(data).hexdigest()
            if got != sha:
                die("%s %s: sha256 %s, expected %s" % (pid, ver, got, sha))
            shutil.rmtree(folder, ignore_errors=True)
            os.makedirs(folder)
            with zipfile.ZipFile(io.BytesIO(data)) as z:
                for n in z.namelist():
                    if n.startswith(sub) and n.endswith(".dll") and "/" not in n[len(sub):]:
                        with open(os.path.join(folder, n[len(sub):]), "wb") as f:
                            f.write(z.read(n))
            open(done, "w").write(sha + "\n")
        dlls = sorted(glob.glob(os.path.join(folder, "*.dll")))
        if not dlls:
            die("no reference assembly in " + folder)
        out[name] = dlls
    return out


# ---------- compiler ----------
def find_csc():
    """The command that runs csc, as a list."""
    def command(path):
        return ["dotnet", path] if path.lower().endswith(".dll") else [path]
    if os.environ.get("CSC"):
        return command(os.environ["CSC"])
    try:
        sdks = subprocess.run(["dotnet", "--list-sdks"], capture_output=True, text=True).stdout
    except OSError:
        sdks = ""
    found = []
    for line in sdks.splitlines():
        m = re.match(r"\s*(\d+)\.(\d+)\.(\d+)\S*\s+\[(.+)\]", line)
        if m:
            dll = os.path.join(m.group(4), line.split()[0], "Roslyn", "bincore", "csc.dll")
            if os.path.exists(dll):
                found.append(((int(m.group(1)), int(m.group(2)), int(m.group(3))), dll))
    if found:
        return command(max(found)[1])
    for base in (os.environ.get("ProgramFiles(x86)"), os.environ.get("ProgramFiles")):
        if base:
            hits = sorted(glob.glob(os.path.join(base, "Microsoft Visual Studio", "*", "*", "MSBuild", "Current", "Bin", "Roslyn", "csc.exe")))
            if hits:
                return command(hits[-1])
    die("no C# compiler: install the .NET SDK, or set CSC")


def compile_net(csc, refs, sources, out, work):
    """One assembly (an exe, as Tizen's .NET apps are) for Tizen 6: .NET Core 3.1 and TizenFX references, TIZEN6."""
    args = ["-nologo", "-nostdlib+", "-target:exe", "-langversion:latest", "-nullable-", "-warn:1",
            "-optimize+", "-deterministic", "-define:TIZEN6", '-out:"%s"' % out]
    args += ['-r:"%s"' % r for r in refs]
    args += ['"%s"' % s for s in sources]
    rsp = os.path.join(work, os.path.basename(out) + ".rsp")
    with open(rsp, "w", encoding="utf-8") as f:
        f.write("\n".join(args) + "\n")
    r = subprocess.run(csc + ["-noconfig", "@" + rsp], capture_output=True, text=True)
    text = (r.stdout + r.stderr).strip()
    if r.returncode or not os.path.exists(out):
        die("csc failed for %s:\n%s" % (os.path.basename(out), text))
    if text:
        print(text)


def project_sources(folder):
    """A project's .cs files, as its .csproj builds them: its own folder, plus the files it links from
    elsewhere (<Compile Include="..\\VetroPort.cs" />, shared by the bridge and APL Overlay)."""
    sources = sorted(glob.glob(os.path.join(folder, "*.cs")))
    for proj in glob.glob(os.path.join(folder, "*.csproj")):
        for inc in re.findall(r'<Compile\s+Include="([^"]+\.cs)"', open(proj, encoding="utf-8").read()):
            path = os.path.normpath(os.path.join(folder, inc.replace("\\", "/")))
            if path not in sources:
                sources.append(path)
    return sources


def build_all(csc, refs, api, work):
    """{file name: bytes} of APLOverlay.dll, APLBoot.dll and Bridge.dll for one TizenFX API level."""
    tizen = [d for d in refs[api] if "Wearable" not in os.path.basename(d)]
    references = refs["core"] + tizen
    projects = {
        "APLOverlay.dll": sorted(glob.glob(os.path.join(ROOT, "overlay", "*.cs"))),
        "APLBoot.dll": project_sources(os.path.join(ROOT, "overlay", "boot")),
        "Bridge.dll": project_sources(os.path.join(ROOT, "overlay", "bridge")),
    }
    out = {}
    for name, sources in projects.items():
        if not sources or not all(os.path.exists(s) for s in sources):
            die("sources missing for " + name)
        path = os.path.join(work, name)
        compile_net(csc, references, sources, path, work)
        out[name] = open(path, "rb").read()
    return out


# ---------- packages ----------
def file_info(name, like=None):
    """A zip entry: the full package's date and modes when it comes from there, else rwxr-xr-x as tz writes them."""
    i = zipfile.ZipInfo(name, like.date_time if like else (2026, 1, 1, 0, 0, 0))
    i.compress_type = zipfile.ZIP_STORED if name.endswith("/") else zipfile.ZIP_DEFLATED
    i.create_system = 3
    i.external_attr = ((0o40755 << 16) | 0x10) if name.endswith("/") else (0o100755 << 16)
    if like is not None and like.external_attr >> 16:
        i.external_attr = like.external_attr
    return i


def is_overlay(name):
    """APL Overlay's files in the full package (tools/make-overlay.sh): they go to the .tpk."""
    return (name in ("APLOverlay.deps.json", "shared/res/APLOverlay.png") or name.startswith("bin/APLOverlay.")
            or name.startswith("res/icons/"))


def launcher_package(full, api_version, dlls, out):
    """The full package without APL Overlay, its two .NET services built for Tizen 6. Unsigned."""
    with zipfile.ZipFile(full) as zin, zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        names = zin.namelist()
        for need in ("tizen-manifest.xml", "res/wgt/config.xml", "bin/APLBoot.dll", "bin/Bridge.dll"):
            if need not in names:
                die("%s has no %s: not a full package" % (full, need))
        for info in zin.infolist():
            n = info.filename
            if n in SIGNATURES or is_overlay(n):
                continue
            data = zin.read(n)
            if n == "tizen-manifest.xml":
                text = data.decode("utf-8")
                text, k = re.subn(r"\s*<ui-application\b.*?</ui-application>", "", text, flags=re.S)
                if k != 1:
                    die("expected one ui-application (APL Overlay) in the full package's manifest, found %d" % k)
                text, k = re.subn(r'api-version="[0-9.]+"', 'api-version="%s"' % api_version, text)
                if k < 3 or "<ui-application" in text or len(re.findall(r"<service-application\b", text)) != 2:
                    die("unexpected manifest in the full package:\n" + text)
                data = text.encode("utf-8")
            elif n.startswith("bin/") and n.endswith(".dll"):
                base = n[4:]
                if base not in dlls:
                    die("no Tizen 6 build for " + n)
                data = dlls[base]
            elif n.startswith("bin/") and n.endswith(".runtimeconfig.json"):
                data = RUNTIMECONFIG.encode("utf-8")
            elif n.startswith("bin/") and n.endswith(".deps.json"):
                if b".NETCoreApp,Version=v6.0" not in data:
                    die(n + " does not target .NET 6 any more: check what it should say for .NET Core 3.1")
                data = data.replace(b".NETCoreApp,Version=v6.0", b".NETCoreApp,Version=v3.1")
            z.writestr(file_info(n, info), data)


def overlay_package(full, api_version, version, dll, out):
    """APL Overlay alone, apl.launcher.overlay (overlay/tizen-manifest.xml), with the full package's icons. Unsigned."""
    man = open(os.path.join(ROOT, "overlay", "tizen-manifest.xml"), encoding="utf-8").read()
    man, k = re.subn(r'api-version="[0-9.]+"', 'api-version="%s"' % api_version, man)
    if k != 2:
        die("expected api-version twice in overlay/tizen-manifest.xml, found %d" % k)
    man, k = re.subn(r'(<manifest\b[^>]*\sversion=")[^"]*(")', r"\g<1>" + version + r"\g<2>", man, count=1)
    if k != 1 or 'package="apl.launcher.overlay"' not in man or OVERLAY_PRIVILEGE not in man:
        die("overlay/tizen-manifest.xml: expected package apl.launcher.overlay, a version and " + OVERLAY_PRIVILEGE)
    with zipfile.ZipFile(full) as zin, zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr(file_info("tizen-manifest.xml"), man.encode("utf-8"))
        for d in ("bin/", "lib/", "res/", "res/fonts/", "res/icons/", "shared/", "shared/res/"):
            z.writestr(file_info(d), b"")
        z.writestr(file_info("bin/APLOverlay.dll"), dll)
        z.writestr(file_info("bin/APLOverlay.runtimeconfig.json"), RUNTIMECONFIG.encode("utf-8"))
        for info in zin.infolist():
            n = info.filename
            if (n.startswith("res/icons/") and not n.endswith("/")) or n == "shared/res/APLOverlay.png":
                z.writestr(file_info(n, info), zin.read(n))


def check(path, files, apps):
    """What the screen needs is in the package, with no signature left."""
    with zipfile.ZipFile(path) as z:
        names = z.namelist()
        man = z.read("tizen-manifest.xml").decode("utf-8")
    for f in files:
        if f not in names:
            die("%s is missing from %s" % (f, path))
    if any(n in SIGNATURES for n in names):
        die(path + " is still signed")
    found = re.findall(r'appid="([^"]+)"', man)
    if sorted(found) != sorted(apps):
        die("%s: apps %s, expected %s" % (path, found, apps))
    icons = len([n for n in names if n.startswith("res/icons/") and n.endswith(".svg")])
    print("  %s: %d entries, apps %s, api-version %s, %d icons" % (
        os.path.basename(path), len(names), ", ".join(found), ", ".join(sorted(set(re.findall(r'api-version="([^"]+)"', man)))), icons))


def main():
    if len(sys.argv) not in (2, 3):
        die("usage: make-tizen6.py <apl-launcher-full-v<version>.wgt> [output-dir]")
    full = os.path.abspath(sys.argv[1])
    out_dir = os.path.abspath(sys.argv[2] if len(sys.argv) == 3 else os.path.dirname(full))
    os.makedirs(out_dir, exist_ok=True)
    with zipfile.ZipFile(full) as z:
        config = z.read("res/wgt/config.xml").decode("utf-8")
    version = re.search(r'<widget[^>]*\sversion="([^"]+)"', config).group(1)

    cache = os.environ.get("TIZEN6_REFS") or os.path.join(os.path.expanduser("~"), ".cache", "apl-tizen6")
    refs = fetch_refs(cache)
    csc = find_csc()
    print("== csc:", " ".join(csc))
    work = tempfile.mkdtemp(prefix="apl-tizen6-")
    try:
        for tag, api_version, api in TARGETS:
            print("== Tizen %s (%s)" % (api_version, REFS[api][0]))
            folder = os.path.join(work, tag)
            os.makedirs(folder)
            dlls = build_all(csc, refs, api, folder)
            wgt = os.path.join(out_dir, "apl-launcher-%s-v%s.wgt" % (tag, version))
            tpk = os.path.join(out_dir, "apl-overlay-%s-v%s.tpk" % (tag, version))
            launcher_package(full, api_version, dlls, wgt)
            overlay_package(full, api_version, version, dlls["APLOverlay.dll"], tpk)
            check(wgt, ["config.xml", "tizen-manifest.xml", "bin/APLBoot.dll", "bin/Bridge.dll", "bin/Bridge.runtimeconfig.json",
                        "res/wgt/config.xml", "res/wgt/index.html", "res/wgt/js/boot.js", "res/wgt/js/keys.local.js"],
                  ["APLauncher.APLBoot", "APLauncher.Bridge"])
            check(tpk, ["tizen-manifest.xml", "bin/APLOverlay.dll", "bin/APLOverlay.runtimeconfig.json",
                        "shared/res/APLOverlay.png", "res/icons/alexa-orb.svg", "res/icons/check.svg"],
                  ["apl.launcher.overlay"])
    finally:
        shutil.rmtree(work, ignore_errors=True)

    # Every package of the folder, as APL Launcher Setup checks them (03-build-launcher.ps1)
    packages = sorted(glob.glob(os.path.join(out_dir, "apl-launcher-*.wgt")) + glob.glob(os.path.join(out_dir, "apl-overlay-*.tpk")))
    with open(os.path.join(out_dir, "SHA256SUMS-wgt.txt"), "w", encoding="utf-8", newline="\n") as f:
        for p in packages:
            f.write("%s  %s\n" % (hashlib.sha256(open(p, "rb").read()).hexdigest(), os.path.basename(p)))
    print("== SHA256SUMS-wgt.txt:", ", ".join(os.path.basename(p) for p in packages))


if __name__ == "__main__":
    main()
