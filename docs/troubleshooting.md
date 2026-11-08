# Troubleshooting

**First aid:** **Restore** in APL Launcher Setup gives the Home button and Samsung's menu back and undoes the optimizer. Nothing in this project deletes Samsung's system.

## Installation

| Message or symptom | Fix |
|---|---|
| *Tizen Studio is not found* | Install Tizen Studio **with the CLI**, then install again. |
| *Author password* prompt | The certificate's `.pwd` files are encrypted, so the installer uses a Tizen security profile instead. Create the profile in Certificate Manager, or let the installer use your Apps2Samsung certificate. |
| Black Home Screen with only the clock, no apps (Tizen 6.x) | Fixed in 1.0.9: the screen's browser engine ignored a CSS property and every icon was 0×0. The update arrives by itself; or install the latest release again. |
| *APL Launcher couldn't start* (or a black screen before 1.0.8) | The launcher met an error while starting. Take a photo of the message, with the TV model and Tizen version, and open an issue on GitHub. |
| *No valid Samsung certificate* | No certificate was found, or the newest one has expired (the message says which). Create a new one for this screen's DUID with Apps2Samsung (found automatically) or Tizen Studio's Certificate Manager (used through its signing profile). Before 1.0.7, APL Launcher Setup ignored Tizen Studio certificates at this step. |
| *The Samsung certificate of profile … expired* | The Tizen Studio profile signs, but its certificate is out of date. Create a new one, then install again. |
| *Certificate in signature was expired* | Same cause. Create a new certificate, then install again. |
| *[118,-4] Load archive info fail* | The package is corrupted or was built by an old version. Download the ZIP again and reinstall. |
| *The screen is not in `sdb devices`* | Developer Mode must point to the PC's IP. If Vetro is running (Host PC IP `127.0.0.1`), the installer installs through Vetro instead: open Vetro once on the screen, wait a minute, then try again. |
| The launcher is not in the Apps menu | Read the installer's last messages: the real error is shown there. Run it again with the screen on. |

## Daily use

| Symptom | Fix |
|---|---|
| Home still opens Samsung's home | In APL Launcher, *Settings › Remote and Devices › Set Up the Remote Buttons* sends Home back to APL Overlay (or APL Launcher without it) and says whether Vetro intercepts the remote. If not, in Vetro › Remapper, turn on **Remote interception** (*filter* mode in older versions). Turn Vetro's *Launcher (Beta)* off. |
| Screen settings show *Unavailable*, or *Settings › Support › About This Screen › Link to Vetro* says "Bridge: no answer at all" | The launcher gets no answer from its bridge. On Tizen 6 screens the bridge keeps a log since 1.0.20: run `cat /opt/usr/home/owner/apps_rw/APLauncher/data/bridge.log` through Vetro (`POST http://<screen-ip>:8099/exec` with `{"cmd": "..."}`) and attach it to an issue. |
| *Link to Vetro* says "Bridge: Vetro refused" with "Vetro unreachable", and your Vetro was built with another port than 8099 (`VETRO_PORT=…`, for example because another app holds 8099) | Before 1.0.22 the launcher only looked for Vetro on 8099. Since 1.0.22 the launcher, its bridge and APL Overlay find Vetro's port on their own (every open port on the screen is tried), and APL Launcher Setup tries 8099 and the usual other ports (8098, 8100, 9000…). Install the full package again with APL Launcher Setup to get the new bridge and APL Overlay. *Link to Vetro* then shows the port. |
| After a full restart, Home opens Samsung's home | Normal for up to two minutes: Vetro starts and takes over the remote. If it lasts longer, open Vetro once from *Apps*, and check that Developer Mode's *Host PC IP* is `127.0.0.1` (Vetro needs it to restart by itself). Prefer sleep to unplugging. |
| Samsung's home is empty | Normal after Optimize: its ads and recommendations are turned off. Press Home once Vetro is ready. |
| TizenTube freezes or opens Samsung's YouTube | Open it from the launcher: it closes Samsung's YouTube first, as TizenTube needs. Then run **Repair TizenBrew** in APL Launcher Setup › Tools. |
| *Start on APL Launcher* turns itself off again | It needs Samsung's *Autorun Smart Hub* on, and Vetro 0.5's own *Custom launcher* switches that off. Keep Vetro's Custom launcher off and let APL Launcher handle Home (*Settings › Remote and Devices › Set Up the Remote Buttons*). |
| Without Vetro, Samsung's menus can't be reached | Since 1.0.21, *Return to the Launcher* is off by default when Vetro is not installed, so Home shows Samsung's home. If you turned it on yourself, turn it off in *Settings › Home Screen*. |
| The screen starts on Smart Hub | Turn *Autorun Smart Hub* off and *Autorun last app* on, then put the screen to sleep from the launcher. |
| Holding OK opens the app instead of the menu | The launcher handles remotes that repeat a held key as press/release pairs. If it still happens, tell us your remote model. |
| Brightness, picture settings or Bluetooth show *Indisponible* or *Failed to fetch* | These need Vetro and the launcher's private relay: check that Vetro is running, then install again. |
| Switching to an HDMI input does nothing | The launcher asks Samsung's TV app directly. If that fails, it opens Samsung's source list. |
| The live Top Shelf stays on the app's artwork | Add a TMDB key on the **Install** page of APL Launcher Setup, and check the network. If you use your own ad blocker, allow `api.themoviedb.org` and `image.tmdb.org`. |

## Updates

| Symptom | Fix |
|---|---|
| *Update failed: the launcher's GitHub repository is private* | Screens can only read a **public** repository. |
| *Version … available: run APL Launcher Setup again on the PC* | The new version needs new permissions. Install once more with APL Launcher Setup. |
| A new version misbehaves | *Settings › Support › Launcher Update › Go Back to the Installed Version*. A version that fails to start is set aside automatically. |

## Reporting a problem

Open an issue with:
- the screen model and Tizen version (*Settings › Support › About This Screen*);
- the launcher version;
- what you did;
- a photo of any message.
