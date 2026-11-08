# Development

## Layout

```
overlay/             APL Overlay: native Control Center over video, Home key, Alexa bridge (.tpk)
launcher/            The Tizen web app (packaged as a signed .wgt)
  config.xml         App ID APLauncher.Home, version, privileges, CSP
  index.html         Markup, then js/build.js and js/boot.js
  css/launcher.css   All styles (1920×1080, tvOS look, perf mode)
  js/                One module per feature, see below
  images/            Bundled artwork (apps, devices, blurred backgrounds)
  sounds/            Optional UI sounds (navigate/click/back.wav)
  version.json       Release manifest read by screens for automatic updates
scripts/             PowerShell tools run by APL Launcher Setup
installer/           APL Launcher Setup, the Windows app (WPF, .NET Framework 4.8)
tools/               Build, artwork and preview tooling
extras/              DNS blocklist
docs/                Documentation and screenshots
```

### Modules (`launcher/js/`)

| File | Role |
|---|---|
| `boot.js` | Starts the installed code, or a newer downloaded version; rolls back on failure |
| `build.js` | Generated: script list and images of the installed version |
| `system.js` | Preferences and profiles, Samsung/Tizen APIs, Vetro client, UI sounds |
| `apps.js` | Installed apps, filtering, catalog lookup, launching, web shortcuts |
| `catalog.js` / `devices.js` | Generated artwork catalogs |
| `autoart.js` | Automatic artwork (App Store, TMDB providers) |
| `genart.js` | Tile and background drawn on the screen for apps with no artwork (or sheets of light, as an option) |
| `liveshelf.js` | Live Top Shelf (TMDB, YouTube, Apple Music, Fanart.tv) |
| `navigation.js` | Focus engine (geometric neighbours), screen stack, long press |
| `launcher.js` | Home screen: dock, grid, Top Shelf, edit mode, app menu actions |
| `profiles.js` | Household profiles next to the clock |
| `appmenu.js` | tvOS context menu and alerts |
| `controlcenter.js` | Control Center, audio output and AirPlay sheets |
| `settings.js` / `settings-tree.js` | Settings app and its menu tree |
| `sources.js` | Sources screen and device picker |
| `screensaver.js` / `aerials.js` | Aerial screen saver |
| `folders.js` | App folders on the home screen |
| `switcher.js` | App switcher (Home pressed twice) |
| `widgets.js` | Continue Watching cards above the dock and in the switcher |
| `services.js` | Stops Samsung services the launcher no longer needs, and restores them |
| `overlay.js` | Starts APL Overlay, sends it the theme and app list; if it is missing, gives Home back to the launcher and the other keys to Samsung, and says what it changed |
| `updater.js` | Automatic updates from GitHub |
| `preview.js` | PC/phone preview frame and on-screen remote (does nothing on a screen) |

### APL Overlay (`overlay/`)

A small .NET app for Tizen's native toolkit, kept hidden in memory:

- **Home key:** Vetro's rule launches it. It lets an app keep playing while it tells a short press (launcher) from a long one (Control Center).
- **Back to the launcher:** when an app closes and Samsung's home appears, it opens the launcher.
- **Alexa:** announces apps and commands as smart plugs on the local network (`Alexa.cs`).
- **Alexa's glow:** a Siri-like orb and glow along the bottom while the remote's microphone button is held, then while Alexa answers (`MicButton.cs`, `Panel.Listen`). A small root script, started through Vetro, reads Vetro's forwarded remote and keeps `/tmp/apl-mic-down` while the button is down.
- **Stuck keys:** releases a key the screen still believes is down after Vetro's input helper restarts (`KeyGuard.cs`).
- **Idle apps:** closes an app left in the background for 10 minutes (`IdleApps.cs`): the launcher's apps, those seen in front and Samsung's that open by themselves (after 1 minute when they were never in front: they reopen at every wake-up and hold about 250 MB), never the one in front, Samsung's home, the TV inputs or AirPlay. The launcher sends the delay (`apl_idle`, 0 to turn it off) and its app list (`apl_apps`).

`tools/make-overlay.sh` builds it in CI with the Tizen .NET workload, and `tools/make-package.sh --overlay` adds it to the launcher's `.wgt`: the full package, `apl-launcher-full-vX.Y.Z.wgt` (hybrid; manifest in `overlay/hybrid/`). APL Launcher Setup installs that package: `scripts/03-build-launcher.ps1` downloads it from the release, adds the personal files and signs it, `scripts/05-build-overlay.ps1` hands the buttons to the overlay and removes the old separate `apl.launcher.overlay` package. The automatic update only replaces the launcher's web part: APL Overlay, the bridge and the start-up service change with a new install of the package.

### Talking to Vetro and the screen

- **The launcher's page cannot read Vetro's answers**, so every call goes through the relay below.
- **`launcher/bridge/service.js`** is a Tizen web service in the same package (`APLauncher.Bridge`). It makes the request for the launcher and sends the answer back over a **trusted message port**, which only apps signed with the same certificate can use. It opens **no network port**, relays only the paths the launcher uses, starts on demand and with the screen (`on-boot`, to open the launcher after a full start), and stops after 15 idle minutes. The launcher tells it when it is in front (`front` message): it then stays started, and if the screen goes to sleep on the launcher (`memory/pm/state` leaves 1) and wakes up on the TV input (`memory/system/source_type` 0) or Samsung's home, it opens the launcher again. Large answers are sent in parts. Tizen 9's limits on this service are in [Testing on a real screen](live-testing.md).
- **Picture settings and Game mode** are read and written directly on the screen's AV service (D-Bus, through `/exec`), and the value read back is the one shown. Details are in [Testing on a real screen](live-testing.md).
- **Bluetooth** uses `tizen.bluetooth` to list, search and pair, and Samsung's connection manager to send the sound. The screen has no BlueZ.
- **Remote keys** are injected by Vetro as root with `/usr/bin/input_keyevent` (X key names such as `XF86Menu`, `XF86PowerOff`), like Vetro's own launcher. Samsung's network remote (WebSocket 8001/8002) is only a fallback: it does not answer on every screen.
- **HDMI inputs** are switched like Samsung's own Source tile: an app control to `org.tizen.tv-viewer` with `change_source` = Samsung's input number (HDMI 1–4 = 13–16), first from the app, then through Vetro.
- **Long press:** some remote receivers repeat a held key as press/release pairs; a release followed by a new press within 220 ms counts as the same hold.

### Constraints

- **ES5 JavaScript**, without modules or build steps: Tizen's web runtime is old. Use `var`, `function` and `Promise`, with no arrow functions.
- **Performance first.** Use no live `backdrop-filter` in performance mode (the default on screens). The grid background is a tiny canvas blurred once. Background images change only after focus settles.
- The interface strings are French. The code comments are mostly French.

## Preview

- APL Launcher Setup › Tools › *Preview on this PC* opens `launcher/index.html` in an Edge or Chrome app window.
- `python3 tools/preview/make-preview.py <dir>` builds a hostable copy: a page without `<html>`/`<body>` plus its files.

## Building and installing by hand

```powershell
.\scripts\01-connect.ps1 -TvIp <ip>              # check Developer Mode connection
.\scripts\03-build-launcher.ps1 -ProfileName <tizen-security-profile>
.\scripts\04-install-launcher.ps1 -TvIp <ip>
```

`03-build-launcher.ps1` packages the published release, or `dist\apl-launcher-full-v<version>.wgt` when that file exists, not your `launcher\` folder. To try local changes, build that file with `tools/make-overlay.sh` and `tools/make-package.sh --overlay` (Linux or macOS, as in CI) and copy it to `dist\`. Delete it afterwards: it wins over the release.

## Releasing (automatic updates)

1. Change the code, then raise `version="…"` in `launcher/config.xml`.
2. Run `python3 tools/make-build.py --notes "what changed"`. It writes `launcher/version.json` and `launcher/js/build.js`.
3. Run `python3 tools/check.py`, the same check as CI.
4. Push to `main`, the branch the screens follow (`BRANCH` in `launcher/js/boot.js`).

Screens check `version.json` every 6 hours. They download the scripts and styles, keep them in local storage, and restart on the home screen. New images are read from GitHub, so **the repository must be public**.

Changes to `boot.js`, or new privileges in `config.xml`, cannot be applied this way. Raise `LOADER` or `REINSTALL` in `tools/make-build.py`, and screens will ask for APL Launcher Setup.

## Artwork

See [visuals-and-apis.md](visuals-and-apis.md#regenerating-artwork).
