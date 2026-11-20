# APL Launcher's repository for the Homebrew Channel

On a rooted LG TV, APL Launcher installs from the TV itself, without a PC, like any homebrew app:

1. Open the **Homebrew Channel**, then **Settings** (the gear) › **Add repository**.
2. Type this address:

   ```
   https://raw.githubusercontent.com/Knikt/APL-Launcher/main/webos/repo/apps.json
   ```

3. Back in the list, open **APL Launcher** and choose **Install**. Updates show up there too.

The Homebrew Channel checks the package against the SHA256 in the manifest before installing it.

## The root features

Installed this way, APL Launcher works like on a TV without root. For the root features (Home opens APL
Launcher, the TV's picture settings, closing apps, Guide = Control Center, debloat, updates blocked), run
once, in SSH as root (password `alpine`), from a PC or from an SSH app on a phone:

```sh
wget -qO- https://raw.githubusercontent.com/Knikt/APL-Launcher/main/webos/root/install.sh | sh
```

Or use APL Launcher Setup on a Windows PC: it does everything at once. Details: [../root/README.md](../root/README.md).

## Files

| File | What it is |
|---|---|
| `apps.json` | The index the Homebrew Channel reads: one package, with its manifest inside |
| `apl-launcher.json` | The manifest: version, the release's `.ipk` and its SHA256 |

Both are written by `python tools/make-webos.py --release`, from the package it builds. Publish the GitHub
release with that `.ipk` first, then commit these two files: the Homebrew Channel downloads the `.ipk`
from the release.
