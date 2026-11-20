# APL Launcher root scripts for LG TVs (webOS)

The scripts installed at every boot on a rooted LG TV. They go in
`/var/lib/webosbrew/init.d/`, which the Homebrew Channel runs with
`run-parts` after each start-up.

Tested with APL Launcher **1.0.24** on an **LG OLED G5** (OLED55G56LS,
firmware 43.21.77 / 11.2.0-3706, webOS 26), rooted with WTFBro
([e.nya.je/getroot](https://e.nya.je/getroot/)) and Homebrew Channel
0.7.3. The setup freed about **390 MB of memory pressure** at steady
state (swap went from 355 MB to 18 MB).

| File | What it does | Starts |
|---|---|---|
| `init.d/10-apl-block-updates` | Blocks LG's 6 firmware-update hostnames (`snu`, `snu-dev`, `nsu`, `su`, `su-dev`, `su-ssl`.lge.com) in `/etc/hosts`. | at boot |
| `init.d/11-apl-block-privacy` | Blocks 21 LG ad/telemetry/content-recognition hostnames, from the SAFE tier of furkan-bayrak/lg-tv-blocklist (CC BY 4.0). Netflix, Prime, HBO and YouTube keep working. | at boot |
| `init.d/12-apl-debloat` | After 15 s, runs `bin/apl-debloat-stop.sh`. | at boot |
| `bin/apl-debloat-stop.sh` | Stops LG's `adoverlay-service`, `acr2` (viewing tracking / LivePlus), `remotelogger`, `service-logger`, `contentminer`, `nudge`, `sportsalarm`, and adds 3 more ad servers to `/etc/hosts`. Four groups (`ads`, `tracking`, `logs`, `suggestions`): one of `/media/developer/apl-debloat/OFF-<group>` pauses that group. `OFF` pauses the whole thing. | on demand or by `12-apl-debloat` |
| `bin/apl-debloat-undo.sh` | Puts every group back: lifts the bind-mounts, restarts the systemd units, removes the 3 hostnames. | on demand |
| `init.d/13-apl-services-stop` | After 25 s, runs `bin/apl-services-stop.sh`. | at boot |
| `init.d/14-apl-noload` + `bin/apl-noload.sh` | The apps you don't use never open, even when the TV preloads them on its own: for each id in `noload.list` (LG Channels by default), its start page is covered in RAM by a blank one (`noload/index.html`) that closes at once. The app stays installed and nothing is written in the system; `bin/apl-noload-undo.sh` gives the apps back now. Add an id to `noload.list` to keep another app from ever opening. `OFF-noload` pauses it. | at boot |
| `init.d/15-apl-preload-off` + `bin/apl-preload-off.sh` | LG no longer opens apps in the background by itself (its preload manager: Netflix, YouTube, Prime Video, LG Channels, the browser… kept in memory and opened again seconds after they close). Every app in `/var/preferences/webos-preload-manager-conf.json` is switched off there (the original kept in `preload-conf.orig.json`) and in its policy (luna `setPreloadPolicy`), again every 10 minutes since LG sets it back; the copies it already opened close at boot, never the app in front, live TV or the inputs. The method of [webos-debloat](https://gist.github.com/D-Rekk/468e559e823106afea72689d1e2aa1f1) and [lg-webos-privacy-debloat](https://github.com/meehn69/lg-webos-privacy-debloat) (MIT). `bin/apl-preload-undo.sh` gives preloading back; `OFF-preload` pauses it. | at boot, then every 10 min |
| `bin/apl-services-stop.sh` | Frees RAM by stopping 12 LG systemd units (familycare, buddyconnector, alwaysready, AI inference, ruleengine, wowplay, cups-lpd, dmost, ninfod, rdxd, service-logger, mycar) and bind-mounting `/dev/null` over 9 luna-launched daemons (`com.webos.app.voice`, `lg.thinqai.adapter`, `airessrvallocator`, `iotproxy`, `iconnectivity`, `uploadd`, `amazon-alexa-adapter`, `performer`, `nlpmanager`). Derived from `modules/debloat.sh` of [JulioFerrero/own-your-glass](https://github.com/JulioFerrero/own-your-glass) (MIT), with avahi and ThinQ (iot-client/pushclient) left alone: AirPlay, Chromecast and ThinQ keep working. | on demand or by `13-apl-services-stop` |
| `bin/apl-services-undo.sh` | Lifts the binary bind-mounts, restores the original file modes, starts the systemd units back. | on demand |
| `init.d/20-apl-elevate` | Gives APL Launcher's service root with the Homebrew Channel's own `elevate-service`, as HBC does for itself at each boot. Installing or updating the launcher writes the service's luna files back to normal; this puts root back at the next start. With root the launcher reads and sets the picture settings (Picture Mode, OLED Pixel Brightness, contrast…), closes the apps left open (Free Up Memory, App Switcher) and its Control Center slider is the brightness. `OFF-root` pauses it. | at boot |
| `init.d/21-apl-keep-root` + `bin/apl-keep-root.sh` | Keeps APL Launcher rooted and personal after every update of it (the Homebrew Channel's, the Setup's, ares-install): an update writes the service's luna files back to normal, which takes root away until the next start. A background loop (every 10 s, as root) gives root back within seconds, and puts back into the package the files a public package can't have, kept in `personal/`: the SF Pro fonts, your `keys.local.js`, your avatars and sounds. `install.sh` fills `personal/` from the launcher installed at that moment. `OFF-root` pauses it; log in `/tmp/apl-keep-root.log`. | at boot |
| `init.d/30-apl-home` | Runs `bin/apl-home.sh` at boot. `OFF-home` keeps LG's Home. | at boot |
| `bin/apl-home.sh` | Home opens APL Launcher, and the TV starts on it. `home/` (a page named `com.webos.app.home` that only opens APL Launcher, again at each press of Home) is mounted in RAM over LG's Home and the app manager (`sam`) is restarted to read it: the way [CleanYourTV](https://github.com/lasharor/cleanyourtv-WebOS) (MIT) replaces the Flutter Home of webOS 24 and newer. Nothing is written under `/usr`. If APL Launcher isn't running 40 s later, LG's Home comes back by itself. Home → APL Launcher in 0.3 s on the G5. | on demand or by `30-apl-home` |
| `bin/apl-home-undo.sh` | LG's Home back now (unmount, restart `sam`). | on demand |
| `guide/` | Mounted by `bin/apl-home.sh` over LG's Guide (`com.webos.app.livemenu`): a blank page. When the TV opens it, the launcher's service (root, watching the app manager's life events) closes it and opens APL Launcher's Control Center; Back goes back to the app that was in front. Without the service (no root), the page opens the Control Center itself after a moment: never a black screen. `OFF-guide` keeps LG's Guide. The Magic Remote's AI button can't be used: LG keeps it for its own assistant and no app ever gets it. | with `apl-home.sh` |

`apl-debloat-*` is based on scripts/debloat-stop.sh and debloat-undo.sh in
[lasharor/cleanyourtv-WebOS](https://github.com/lasharor/cleanyourtv-WebOS)
(MIT), with the launcher check removed (the debloat runs regardless of
which app is Home) and the config.json dependency dropped (each group is
on by default; a file in `/media/developer/apl-debloat` turns one off).

`apl-services-*` is based on modules/debloat.sh in
[JulioFerrero/own-your-glass](https://github.com/JulioFerrero/own-your-glass)
(MIT). The `oyg harden` orchestration, the dry-run framework, the state
machine and the aggressive tier are dropped. **avahi-daemon /
avahi-adaptor are kept running** (AirPlay / Chromecast discovery), and
**iot-client / pushclient too** (ThinQ). `/usr/sbin/sdx` is deliberately
NOT bind-neutralised: doing so silently kills LG's Settings UI (OYG
FINDINGS F42). `/usr/sbin/admanager` is kept running: HBO Max and
Disney+ wait for it at start-up (OYG F47, CleanYourTV issue 47).

## Install on the TV (one-off, SSH as root)

Easiest: **APL Launcher Setup** on a Windows PC (*Your TV › LG*, *My TV is rooted*). It installs the launcher and sends these files from the PC (nothing downloaded on the TV), runs `install.sh` with `APL_SRC`, and applies everything at once. Or by hand:

One command, in SSH as root (password `alpine` after rooting with WTFBro):

```sh
wget -qO- https://raw.githubusercontent.com/Knikt/APL-Launcher/main/webos/root/install.sh | sh
```

This pulls the six scripts and the four boot hooks into
`/media/developer/apl-debloat/` and `/var/lib/webosbrew/init.d/`, and
writes the version and branch into `/media/developer/apl-debloat/VERSION`
and `BRANCH`. Reboot once, or apply right away:

```sh
sh /var/lib/webosbrew/init.d/10-apl-block-updates
sh /var/lib/webosbrew/init.d/11-apl-block-privacy
sh /media/developer/apl-debloat/apl-debloat-stop.sh
sh /media/developer/apl-debloat/apl-services-stop.sh
free -m    # before / after, to measure the gain
```

To undo everything:

```sh
sh /media/developer/apl-debloat/uninstall.sh
```

The uninstaller removes the boot hooks, lifts the live binds and starts
the stopped systemd units back; a reboot alone would also undo almost
everything, as long as the boot hooks are removed first.

Pause one group without undoing it:

```sh
touch /media/developer/apl-debloat/OFF-ads
touch /media/developer/apl-debloat/OFF-tracking
touch /media/developer/apl-debloat/OFF-logs
touch /media/developer/apl-debloat/OFF-suggestions
touch /media/developer/apl-debloat/OFF                 # the whole thing
touch /media/developer/apl-debloat/OFF-home            # LG's Home at the next start
touch /media/developer/apl-debloat/OFF-root            # no root for the launcher's service at the next start
```

LG's Home right now, without restarting: `sh /media/developer/apl-debloat/apl-home-undo.sh`.

## What breaks and what doesn't

Verified safe (from CleanYourTV's testing and the upstream blocklist's
evidence base): Netflix, Prime Video, HBO Max, YouTube, Disney+, the LG
app store, app updates, sign-ins, the launcher.

Expected to break: LG's ad overlays, LivePlus / content recognition,
sports alerts, "New & Hot" nudges, Live Plus viewing tracking, LG's
telemetry logs.

Not touched: `admanager` (HBO Max and Disney+ wait for it at start-up,
CleanYourTV issue 47), the firmware-update path (already blocked by
`10-apl-block-updates`), the microphones, CEC/ARC/eARC, HDMI inputs,
AirPlay and casting, HbbTV, ThinQ.
