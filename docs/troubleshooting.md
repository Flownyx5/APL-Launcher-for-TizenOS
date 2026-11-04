# Troubleshooting

**First aid:** **Restore** in APL Launcher Setup gives the Home button and Samsung's menu back and undoes the optimizer. Nothing in this project deletes Samsung's system.

## Installation

| Message or symptom | Fix |
|---|---|
| *Tizen Studio is not found* | Install Tizen Studio **with the CLI**, then install again. |
| *Author password* prompt | The certificate's `.pwd` files are encrypted, so the installer uses a Tizen security profile instead. Create the profile in Certificate Manager, or let the installer use your Apps2Samsung certificate. |
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
| Home still opens Samsung's home | In Vetro › Remapper, check the Home rule points to *APL Overlay* (or *APL Launcher* without it) and **Remote interception** is on (*filter* mode in older versions). Turn Vetro's *Launcher (Beta)* off. |
| After a full restart, Home opens Samsung's home | Normal for up to two minutes: Vetro starts and takes over the remote. If it lasts longer, open Vetro once from *Apps*, and check that Developer Mode's *Host PC IP* is `127.0.0.1` (Vetro needs it to restart by itself). Prefer sleep to unplugging. |
| Samsung's home is empty | Normal after Optimize: its ads and recommendations are turned off. Press Home once Vetro is ready. |
| TizenTube freezes or opens Samsung's YouTube | Open it from the launcher: it closes Samsung's YouTube first, as TizenTube needs. Then run **Repair TizenBrew** in APL Launcher Setup › Tools. |
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
