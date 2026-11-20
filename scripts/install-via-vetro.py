#!/usr/bin/env python3
"""Configure and install the full APL Launcher WGT through Vetro."""

import argparse
import atexit
import base64
import hashlib
import json
import re
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
import zipfile
from getpass import getpass
from pathlib import Path
from urllib.parse import urlsplit

CHUNK_SIZE = 36_000


def request(base, path, payload=None, timeout=60):
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(
        f"{base}{path}", data=data,
        headers={"Content-Type": "application/json"} if data is not None else {},
    )
    with urllib.request.urlopen(req, timeout=timeout) as response:
        return json.load(response)


def exec_vetro(base, command, timeout=60):
    result = request(base, "/exec", {"cmd": command}, timeout)
    if not result.get("ok"):
        raise RuntimeError(result.get("stderr") or result.get("error") or "Vetro rejected command")
    return str(result.get("output", ""))


def collect_settings():
    print("Optional API keys (press Return at a prompt to skip it):")
    print("  TMDB: use the API Key (v3 auth), not the API Read Access Token.")
    print("        https://www.themoviedb.org/settings/api")
    print("  YouTube: enable YouTube Data API v3 in Google Cloud, then create an API key.")
    print("        https://console.cloud.google.com/apis/library/youtube.googleapis.com")
    print("        https://console.cloud.google.com/apis/credentials")
    print("  Fanart.tv: copy the API key from your account profile.")
    print("        https://fanart.tv/get-an-api-key/")
    keys = {}
    for field, label in (("tmdb", "TMDB API Key (v3 auth)"), ("youtube", "YouTube Data API v3 key"), ("fanart", "Fanart.tv API key")):
        value = getpass(f"{label} API key (press Enter to skip): ").strip()
        if value and not re.fullmatch(r"[A-Za-z0-9._-]{1,512}", value):
            raise ValueError(f"{label} key contains unsupported characters")
        keys[field] = value

    sites = []
    while True:
        name = input("Website name (press Enter when finished): ").strip()
        if not name:
            break
        url = input("Website URL (http:// or https://): ").strip()
        parsed = urlsplit(url)
        if not name or len(name) > 80 or any(ord(c) < 32 for c in name):
            raise ValueError("Website name must be 1–80 printable characters")
        if parsed.scheme not in ("http", "https") or not parsed.hostname or parsed.username or parsed.password or any(c.isspace() for c in url):
            raise ValueError("Website URL must be an http(s) URL without whitespace or credentials")
        sites.append({"name": name, "url": url})
        if len(sites) >= 30:
            break
    keys["webApps"] = sites
    ask_home_assistant(keys)
    return keys



BACKDROP_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp"}


def ask_home_assistant(keys):
    """Ask for the address and a token, so the TV never needs a keyboard.

    A password cannot be used from a packaged app: signing in with one goes
    through Home Assistant's login API, which a browser only lets a page read
    when the server names that page's origin, and a widget has no origin to
    name. A token is checked over the WebSocket, which is not subject to that.
    """
    url = input("Home Assistant address, e.g. http://192.168.1.10:8123 (Enter to skip): ").strip()
    if not url:
        return
    parsed = urlsplit(url)
    if parsed.scheme not in ("http", "https") or not parsed.hostname or parsed.username or parsed.password:
        raise ValueError("Home Assistant address must be an http(s) URL without credentials")
    token = getpass("Long-lived access token (Profile -> Security): ").strip()
    if not token:
        raise ValueError("A token is required: this package cannot sign in with a password")
    keys["ha"] = {"url": url.rstrip("/"), "name": "Home", "token": token}


def read_backdrops(directory):
    """Pictures for the house, one per file, copied into the package.

    A file called kitchen.jpg becomes a backdrop named "kitchen" that can then
    be given to the Kitchen room on the TV. Nothing is resized here: pictures
    are expected at 3840x2160 or thereabouts.
    """
    if not directory:
        return {}, []
    root = Path(directory)
    if not root.is_dir():
        raise ValueError("--backdrops must be a directory of pictures")
    entries, meta = {}, []
    for path in sorted(root.iterdir()):
        if not path.is_file() or path.suffix.lower() not in BACKDROP_SUFFIXES:
            continue
        if path.stat().st_size > 8 * 1024 * 1024:
            raise ValueError(f"{path.name} is larger than 8 MB")
        safe = re.sub(r"[^A-Za-z0-9._-]", "-", path.name)
        target = "res/wgt/images/backdrops/" + safe
        entries[target] = path.read_bytes()
        meta.append({"id": Path(safe).stem, "name": Path(safe).stem.replace("-", " "),
                     "file": target[len("res/wgt/"):]})
    return entries, meta


def create_configured_wgt(source, destination, settings, extras=None):
    extras = extras or {}
    with zipfile.ZipFile(source, "r") as original, zipfile.ZipFile(destination, "w", zipfile.ZIP_DEFLATED) as output:
        entries = original.namelist()
        config_path = "res/wgt/js/keys.local.js"
        if config_path not in entries:
            raise RuntimeError("Full WGT is missing res/wgt/js/keys.local.js")
        for entry in original.infolist():
            if entry.filename != config_path:
                output.writestr(entry, original.read(entry.filename))
        contents = "window.APL_KEYS = " + json.dumps(settings, ensure_ascii=False) + ";\n"
        output.writestr(config_path, contents.encode("utf-8"))
        for name, data in extras.items():
            output.writestr(name, data)


def sign_package(source, destination, duid, signer):
    command = [signer, "sign", str(source), "-o", str(destination), "--duids", duid, "--partner"]
    result = subprocess.run(command, text=True, capture_output=True)
    if result.returncode:
        detail = (result.stderr or result.stdout).strip()
        raise RuntimeError(f"Apps2Samsung could not sign the customized package: {detail or 'signing failed'}")
    print("Customized package signed with the Partner certificate.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("tv_ip", help="TV IPv4 address (Vetro must be reachable on port 8099)")
    parser.add_argument("package", type=Path, help="Full hybrid release .wgt package (default-signed or Partner-signed)")
    parser.add_argument("--vetro-port", type=int, default=8099, help="Vetro HTTP port (default: 8099)")
    parser.add_argument("--configure", action="store_true", help="Privately enter API keys and personal websites before signing and installing")
    parser.add_argument("--duid", help="TV DUID covered by the Partner certificate (required with --configure)")
    parser.add_argument("--backdrops", help="Directory of pictures to offer as backdrops, copied into the package")
    parser.add_argument("--apps2samsung-cli", help="Apps2Samsung CLI executable (default: apps2samsung-cli on PATH)")
    parser.add_argument("--no-launch", action="store_true", help="Do not launch after installation")
    args = parser.parse_args()
    if not 1 <= args.vetro_port <= 65535:
        parser.error("Vetro port must be between 1 and 65535")
    if not re.fullmatch(r"(?:[0-9]{1,3}\.){3}[0-9]{1,3}", args.tv_ip):
        parser.error("TV address must be an IPv4 address")
    if not args.package.is_file() or args.package.suffix.lower() != ".wgt":
        parser.error("package must be an existing .wgt file")

    package_path = args.package
    temporary = None
    if args.configure:
        if not args.duid:
            parser.error("--duid is required with --configure")
        if not re.fullmatch(r"[A-Za-z0-9_-]{5,64}", args.duid):
            parser.error("--duid has an invalid format")
        signer = args.apps2samsung_cli or shutil.which("apps2samsung-cli")
        if not signer:
            parser.error("Apps2Samsung CLI was not found; install it or pass --apps2samsung-cli")
        settings = collect_settings()
        extras, backdrops = read_backdrops(args.backdrops)
        if backdrops:
            settings.setdefault("ha", {})["backdrops"] = backdrops
        temporary = tempfile.TemporaryDirectory(prefix="apl-vetro-install-")
        atexit.register(temporary.cleanup)
        customized = Path(temporary.name) / "customized.wgt"
        signed = Path(temporary.name) / "signed.wgt"
        create_configured_wgt(args.package, customized, settings, extras)
        sign_package(customized, signed, args.duid, signer)
        package_path = signed

    package = package_path.read_bytes()
    with zipfile.ZipFile(package_path) as archive:
        config = archive.read("config.xml").decode("utf-8")
        widget = re.search(r'<widget\b[^>]*\bversion="([^"]+)"', config)
        application = re.search(r'<tizen:application\b[^>]*\bid="([^"]+)"', config)
        if not widget or not application:
            raise RuntimeError("WGT config.xml does not contain a Tizen application ID and version")
        version, = widget.groups()
        app_id, = application.groups()
        if not re.fullmatch(r"APLauncher(?:\.[A-Za-z0-9_.-]+)?", app_id) or not re.fullmatch(r"[A-Za-z0-9_.+-]+", version):
            raise RuntimeError("WGT contains an unexpected app ID or version")
        if "tizen-manifest.xml" not in archive.namelist():
            raise RuntimeError("Use the full hybrid package (not the launcher-only WGT)")
    base = f"http://{args.tv_ip}:{args.vetro_port}"
    status = request(base, "/status", timeout=10)
    if not (status.get("agent") or {}).get("connected"):
        raise RuntimeError("Vetro agent is not connected; check Vetro on the TV")

    remote = "/tmp/apl-launcher-vetro.wgt"
    encoded = base64.b64encode(package).decode("ascii")
    exec_vetro(base, f": > {remote}.b64")
    for offset in range(0, len(encoded), CHUNK_SIZE):
        chunk = encoded[offset:offset + CHUNK_SIZE]
        exec_vetro(base, f"printf '%s' '{chunk}' >> {remote}.b64")
        print(f"Sending package: {min(100, (offset + CHUNK_SIZE) * 100 // len(encoded))}%", end="\r", flush=True)
    digest = hashlib.sha256(package).hexdigest()
    remote_hash = exec_vetro(base, f"base64 -d {remote}.b64 > {remote} && rm -f {remote}.b64 && chmod 644 {remote} && sha256sum {remote}")
    if digest not in remote_hash:
        exec_vetro(base, f"rm -f {remote} {remote}.b64")
        raise RuntimeError("Package transfer failed SHA-256 verification")

    try:
        try:
            exec_vetro(base, f"pkgcmd -i -t wgt -p {remote} 2>&1", timeout=120)
        except Exception as exc:
            print(f"pkgcmd reported: {exc}", file=sys.stderr)
        installed = False
        for attempt in range(6):
            check = exec_vetro(base, f"pkgcmd -l 2>/dev/null | grep -iF '[{app_id.split('.')[0]}]' | grep -cF 'version [{version}]' || true")
            overlay = exec_vetro(base, f"app_launcher -l 2>/dev/null | grep -c '{app_id.split('.')[0]}.Overlay' || true")
            if check.strip().endswith("1") and overlay.strip().endswith("1"):
                installed = True
                break
            if attempt < 5:
                time.sleep(4)
        if not installed:
            try:
                request(base, "/install", {"path": remote}, timeout=180)
            except Exception as exc:
                print(f"Vetro installer reported: {exc}", file=sys.stderr)
            time.sleep(4)
            check = exec_vetro(base, f"pkgcmd -l 2>/dev/null | grep -iF '[{app_id.split('.')[0]}]' | grep -cF 'version [{version}]' || true")
            overlay = exec_vetro(base, f"app_launcher -l 2>/dev/null | grep -c '{app_id.split('.')[0]}.Overlay' || true")
            installed = check.strip().endswith("1") and overlay.strip().endswith("1")
        if not installed:
            raise RuntimeError(f"TV did not confirm installation of {app_id} {version}; verify the package is signed for this TV")
    finally:
        try:
            exec_vetro(base, f"rm -f {remote} {remote}.b64")
        except Exception:
            pass
    if not args.no_launch:
        try:
            request(base, "/apps/launch", {"appId": app_id}, timeout=25)
        except (urllib.error.URLError, TimeoutError) as exc:
            print(f"Installed; automatic launch failed: {exc}", file=sys.stderr)
    print(f"Installed {app_id} {version}.")


if __name__ == "__main__":
    try:
        main()
    except (
        OSError, RuntimeError, urllib.error.URLError, zipfile.BadZipFile,
        subprocess.SubprocessError, KeyError, ValueError, EOFError,
    ) as error:
        print(f"Installation failed: {error}", file=sys.stderr)
        sys.exit(1)
