# Installation

This guide installs APL Launcher on a Samsung Tizen TV or Smart Monitor from a Windows PC, and makes it replace Samsung's home screen.

## 1. Before you start

**On the PC**
- Windows 10 or 11, on the same network as the screen.
- [Tizen Studio](https://developer.tizen.org/development/tizen-studio/download) with the **CLI**. In the Package Manager, add **Samsung Certificate Extension** under *Extension SDK*.
- A **Samsung certificate** (author + distributor) made for your screen. Create it in Tizen Studio's *Certificate Manager*, or with a tool such as Apps2Samsung. The installer looks for it in both places. Keep a copy somewhere safe: updates must be signed with the same certificate, or the screen refuses them.
- [Visual Studio Build Tools](https://visualstudio.microsoft.com/downloads/#build-tools-for-visual-studio-2022) with the C# workload, and the [.NET 6 runtime](https://dotnet.microsoft.com/download/dotnet/6.0). The installer uses them to build APL Overlay, the small native helper behind the Home button, the Control Center over videos, the Alexa glow and the closing of unused apps. Without them, the launcher still works without those.

**On the screen**
- **Developer Mode**: open *Apps*, type `1 2 3 4 5` on the remote, turn Developer Mode on, enter the PC's IP address, then restart the screen.
- **Vetro** *(required)*: [Vetro](https://github.com/andrearicci93/vetro) runs on the screen with root access. Install it **first**, with Vetro's own guide (the screen has to be rooted). It gives the launcher the Home button and the other remote buttons, APL Overlay, the optimizer, real picture settings, Bluetooth audio, Alexa, faster closing of Samsung's home and app removal. Check that its dashboard opens on the PC at `http://<screen-ip>:8099` before going on.

> Vetro and TizenBrew need the screen's *Host PC IP* to be `127.0.0.1`, which means the PC can no longer install over Developer Mode. The installer detects Vetro and installs through it instead. **If you use TizenBrew or Vetro, never change Host PC IP back to the PC's address.**

## 2. Install

1. Download **APL Launcher Setup** (`APL-Launcher-Setup.exe`) from the [latest release](https://github.com/Knikt/APL-Launcher-for-TizenOS/releases/latest) and open it. Windows may say the app is not signed: *More info › Run anyway*. It needs nothing else to run.
2. On the **Install** page:
   - the app finds the screen with **Find**, or type its IP address (*Settings › Connection › Network › Network Status*); it is remembered for next time, and the app checks that Vetro answers;
   - it checks the PC: Tizen Studio and `sdb`, a Samsung certificate, the C# compiler and .NET 6;
   - enter the optional API keys and personal websites (see below).
3. Click **Install**. The app:
   - prepares the profile avatars (see below);
   - finds your Samsung certificate and builds a signed package;
   - installs the launcher and APL Overlay through Vetro, and opens the launcher.

Nothing else is installed on the screen. Vetro is required: **Install** stays off until the screen answers.

Your keys and websites stay on your PC (`%APPDATA%\APL-Launcher\keys.local.js`) and are never uploaded to GitHub.

### Without a Windows PC: Apps2Samsung

Every release also has the whole package as `apl-launcher-full-vX.Y.Z.wgt`, for [Apps2Samsung](https://github.com/Apps2Samsung/Apps2Samsung): the launcher, APL Overlay, the bridge to Vetro and the start-up service, in one hybrid package. It is signed with the Tizen SDK's default certificate, and Apps2Samsung re-signs it for your screen. Vetro is still required.

1. Install `apl-launcher-full-vX.Y.Z.wgt` from the [latest release](https://github.com/Knikt/APL-Launcher-for-TizenOS/releases/latest) in Apps2Samsung as a custom `.wgt` (or send it to TV-Store at `http://<screen-ip>:8077/upload`). Apps2Samsung asks for the optional API keys below and writes them into the package.
2. If the launcher is already installed with another certificate, uninstall it first: the screen refuses a package signed with a different certificate.
3. In Vetro's **Remapper**, Home (and ⏯) → **APL Overlay** (`APLauncher.Overlay`), and **Remote interception** on. Vetro's app list hides apps without an icon, so APL Overlay is not in it: on the Remapper page, add it from the browser's console with `document.getElementById('targetApp').add(new Option('APL Overlay', 'APLauncher.Overlay'))`, then pick it.

After a full restart, the screen comes back on its last input or on Smart Hub; the start-up service puts the launcher on screen about 80 s after power-on. No personal websites, Memoji or SF Pro fonts in this package. Automatic updates work the same way. (`apl-launcher-vX.Y.Z.wgt`, next to it, is the launcher alone, without the overlay.)

### Optional API keys

| Key | What it adds | Where to get it |
|---|---|---|
| TMDB | Live Top Shelf: trending films and series for each streaming service | themoviedb.org › Settings › API |
| YouTube Data API v3 | Trending videos in TizenTube's Top Shelf | console.cloud.google.com › Credentials |
| Fanart.tv | Textless HD backgrounds | fanart.tv › your profile › API Key |

Without keys, everything else still works: logos, App Store icons and backgrounds, music charts.

### Personal websites

The **Install** page can add websites as apps (name and address). They open in Samsung Internet, and are stored in your local keys file only.

### Profile avatars (Memoji)

The installer downloads 58 Memoji faces once from [wimell/tapback-memojis](https://github.com/wimell/tapback-memojis) and puts them in the package, so they work offline. They stay on your PC (`%APPDATA%\APL-Launcher\memoji`) and are never uploaded to this repository. Without a network, profiles use the bundled 3D avatars instead.

To use **your own Memoji**, put PNG images in the `APL Launcher avatars` folder inside your *Pictures* folder, then install again. They come first in the avatar list. On an iPhone: send your Memoji sticker in Messages, open it, then *Share › Save Image*.

## 3. Replace Samsung's home screen

The app shows these last two steps when the installation is done.

**Start on APL Launcher.** On the screen, open *Settings › All Settings › Advanced Features* (or *General*, depending on the model):
- **Autorun Smart Hub** → Off
- **Autorun last app** → On

Then put the screen to sleep from the launcher (*Control Center › Sleep*). It starts on the launcher next time.

**Home button → APL Launcher** (needs Vetro). Open the Vetro dashboard at `http://<screen-ip>:8099` on the PC, then in **Remapper**:
1. In the device list, choose your remote: **Smart Control 2016** when it is paired over Bluetooth (needed for Alexa), **wt61p807 rc device** when it works by infrared only. To pair it, point it at the screen and hold **Back** and **⏯** together for 3 seconds.
2. *Listen for a key* → press **Home** on the remote. Action: *open an app* → **APL Launcher** (`APLauncher.Home`) → **Save**.
3. Turn on **Remote interception** (called *filter* mode in older Vetro versions), so Home no longer reaches Smart Hub.
4. Make sure Vetro's own *Launcher (Beta)* is off.
5. Click **Done — set up the buttons** in the app: it moves Home to APL Overlay and adds ⏯ (Control Center). When AquaPlay or TizenTube is installed, Samsung TV Plus opens AquaPlay and Prime Video opens TizenTube; otherwise those buttons keep their Samsung role.

Then press Home twice for the app switcher, and hold Home or press ⏯ for the Control Center.

After a **full restart** (unplugged, or a reboot), Vetro needs up to two minutes to start and take over the remote. Until then, Home opens Samsung's home. Putting the screen to sleep and waking it does not have this delay.

Samsung's home (`com.samsung.tv.csfs`) is **not deleted**. It handles sources, quick settings and some menus behind the scenes, so it stays installed and is only closed in the background to free memory.

## 4. Optional: optimize

Open the **Optimize** page. It reads the screen and lists:
- every downloaded app it would **uninstall**, each with its own checkbox;
- every Samsung component it would **silence**;
- the extra changes it would make.

Nothing changes until you click **Optimize** and confirm; a backup is saved first. Details: [optimizer.md](optimizer.md).

## 5. Updates

Updates are automatic: every 6 hours the screen checks this repository's `launcher/version.json`, downloads the new version and restarts when you are on the home screen. You can also check, pause or roll back in *Settings › Support › Launcher update*.

A version that needs new app permissions asks you to install once more with APL Launcher Setup.

## Undo everything

Open the **Restore** page. It:
- removes the Vetro Home rule;
- turns key interception off;
- restores the components, settings and DNS filter changed by the optimizer;
- can uninstall the launcher too (*Also uninstall APL Launcher*).

Then turn **Autorun Smart Hub** back on.
