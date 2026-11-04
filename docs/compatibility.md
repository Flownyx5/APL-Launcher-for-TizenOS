# Compatibility

What works today, what works with limits, what has not been tested on a real screen yet, and what is not possible.
Every "Works" below was checked on a real screen, not only in the PC preview: on the M8 unless the notes say otherwise.

This list follows what users report. To add your screen, open an issue with its model and Tizen version (*Settings › Support › About This TV*) and what works or not.

| | Meaning |
|---|---|
| ✅ | Works, checked on a real screen |
| ⚠️ | Works, with the limits given in the notes |
| 🧪 | Built, but not yet checked on a real screen |
| ❌ | Not possible on these screens |

## Screens

| Screen | Status | Notes |
|---|---|---|
| Samsung Smart Monitor M8, Tizen 9 | ✅ | Developed and used every day on this screen, rooted with Vetro, installed with APL Launcher Setup. |
| Samsung The Frame 2025 (TQ43LS03FAUXXC, 43", Tizen 9) | ⚠️ | Reported by a contributor. **Launcher package** (Apps2Samsung): Home and a full start open the launcher, and since 1.0.4 it comes back after sleep and after Art Mode. **Full package** (launcher and APL Overlay): works, with limits that fixes on the way (pull request #11) remove: APL Overlay cannot reach Vetro on this screen, so keep Home on the launcher in Vetro's Remapper for now, and after a long sleep the launcher can take up to 20 s to come back. APL Overlay can close Art Mode after 10 minutes in the background: fixed for the next version. Home twice, Home held and ⏯ do nothing yet on this screen. After a full start, Tizen only starts the launcher about 77 s after power-on. |
| Samsung QN92D (2024, Tizen 8) | ⚠️ | Reported by a contributor, with the full package (Apps2Samsung): the launcher, its bridge and the start-up service work, and the launcher opens about 80 s after a full start. Nothing else reported yet. |
| Samsung AU7700 (2021, Tizen 6) | 🧪 | Asked about in the issues, not tried yet. This model is not in Vetro's compatibility list yet, so root itself is not confirmed. If Vetro works, the launcher alone is the realistic part: APL Overlay is only reported on Tizen 8 and 9. |
| Other Samsung Smart Monitors and TVs | 🧪 | Not tested yet. They need Vetro, so only screens that Vetro supports can work. Reports are welcome in the issues. |
| Samsung screens without root / Vetro | ❌ | The launcher needs Vetro for the Home button, the remote buttons and the system controls. |

### Reports without a model yet

| Report | Status | Notes |
|---|---|---|
| A 4K TV (Reddit) | ⚠️ | Works, and an automatic update arrived while it was in use. Its three points are fixed: the resolution shown as 1920×1080 and Stremio's cards slowing the animation (1.0.4), only one HDMI input in Sources (1.0.5). Several HDMI inputs not confirmed on it yet. |
| A TV (Reddit) | ⚠️ | No return to the launcher after standby, and Samsung's home not caught: reported before 1.0.4 and without APL Overlay. |
| A TV (Reddit) | ⚠️ | Setup refused a valid Tizen Studio certificate (fixed in 1.0.7), then the launcher stayed black with no apps. Since 1.0.8 it shows the error on screen instead; waiting for it. |

## Remotes

| Remote | Status | Notes |
|---|---|---|
| Samsung Smart Remote (*Smart Control 2016*), paired over Bluetooth | ✅ | Every button, the microphone included. |
| The same remote, infrared only | ⚠️ | Every button except the microphone: by infrared it only asks the screen to show the pairing guide. |
| Other remotes and keyboards | 🧪 | Not tested. |

Vetro intercepts one device at a time: pick the remote in Vetro › Remapper (see [Installation](installation.md)).

## PC

| | Status | Notes |
|---|---|---|
| Windows 11 | ✅ | APL Launcher Setup. |
| Windows 10 | 🧪 | Should work the same; not tested. |
| macOS, Linux | ⚠️ | APL Launcher Setup is a Windows app. Without it, the `.wgt` packages of each release install with Apps2Samsung, but Optimize and Restore are not available. The PC preview (`launcher/index.html`) opens in any browser. |

## Features

### Home screen

| Feature | Status | Notes |
|---|---|---|
| Top Shelf, glass dock, grid, focus motion, sounds | ✅ | 57–60 frames per second once the screen has settled. |
| Back to the launcher when an app closes | ✅ | In less than 0.65 s. |
| Hold OK on an app: Edit Home Screen, Hide, Delete | ✅ | System apps cannot be deleted. |
| Live Top Shelf (trending titles, Game Pass, Steam, Ligue 1, top albums…) | ✅ | Needs a free TMDB key; YouTube trends need a YouTube key. |
| Official logos and automatic artwork for other apps | ✅ | |
| Household profiles and Memoji | ✅ | |
| Interface in English and French | ✅ | French when the screen is in French; *Settings › General & Privacy › Language* to choose. |
| Launcher interface in 4K | ❌ | The screen draws apps and menus in a single 1920×1080 mode, Samsung's own menus included. Only video is 4K. |

### Continue Watching

| App | Status | Notes |
|---|---|---|
| AquaPlay: last channel | ✅ | Channel name and a sharp logo for 203 French channels. |
| AquaPlay: film or series | ✅ | Picture with the title from TMDB. |
| AquaPlay: progress of a series episode | 🧪 | Checked with simulated data on the PC; not seen yet on the screen. |
| AquaPlay: open straight on a channel or series | ❌ | AquaPlay reads no launch request; its own settings can resume the last channel. |
| Stremio | 🧪 | Read from real Stremio data on the PC; not seen yet on the screen. |
| Hot Player | ⚠️ | Hot Player keeps only the episode number, never the series or channel name. |
| Netflix, Prime Video, Disney+, YouTube, Crunchyroll… | ❌ | They keep nothing readable on the screen and have no public API for your history. The Top Shelf shows what is popular instead. |

### Remote buttons

| Feature | Status | Notes |
|---|---|---|
| Home: back to the launcher | ✅ | After a full restart, Vetro takes up to 2 minutes to take over the remote. |
| Home twice: App Switcher | ✅ | |
| Hold Home, or ⏯: Control Center, even over a video | ✅ | ⏯ no longer pauses videos. |
| Samsung TV Plus → AquaPlay, Prime Video → TizenTube | ✅ | Only when those apps are installed; otherwise the buttons keep their Samsung role. |
| A stuck key released by itself | ⚠️ | Seen working with the infrared remote; not yet seen over Bluetooth. |

### Control Center and Settings

| Feature | Status | Notes |
|---|---|---|
| Control Center on the launcher and over any app | ✅ | Over apps it is drawn by APL Overlay. APL Launcher Setup needs the C# compiler and .NET 6 to build it; the full package for Apps2Samsung already has it. |
| Sleep, Wi-Fi, Do Not Disturb, Sleep Timer, Brightness | ✅ | |
| Audio output and Bluetooth headphones (AirPods…) | ✅ | |
| Settings covering every Samsung settings page | ✅ | Real picture controls (backlight, contrast, sharpness, colour, local dimming); a few pages open Samsung's own settings. |
| Sources: inputs and the device on each | ✅ | The HDMI inputs are read from the screen through Vetro (Tizen 9 no longer lists them). Checked on the M8 (one HDMI and USB-C); a screen with several HDMI inputs is not checked yet. |
| An input as a tile on the Home Screen | ✅ | Sources › hold OK on the input › Add to Home Screen. |

### Voice

| Feature | Status | Notes |
|---|---|---|
| Alexa on the microphone button | ✅ | With the remote paired over Bluetooth, after signing in to Amazon once. |
| Siri-like glow while you speak | ✅ | |
| Alexa+ | ❌ | Samsung's Alexa app on this screen is the classic Alexa. |
| Text of what you say and of Alexa's answer | ❌ | Alexa on this screen sends neither; she only speaks. |
| An Echo opening apps on the screen | 🧪 | Built; not yet tried with a real Echo. |
| Bixby | ✅ | Turned off by Optimize, and back with Restore. |

### Screen saver

| Feature | Status | Notes |
|---|---|---|
| Apple's aerial videos in 4K | ✅ | 3840×2160 HEVC on the screen's video plane; 1080p if a 4K video is refused. |
| Cross-fade between two 4K videos | 🧪 | The screen decodes one 4K video at a time: the old one holds its last picture during the fade. Not seen yet. |
| Apple's newest aerials | ❌ | Published only in a format the screen refuses. They are left out of the list. |

### System

| Feature | Status | Notes |
|---|---|---|
| Apps left 10 minutes in the background close by themselves | ✅ | Never the app in front, the launcher, the TV inputs or AirPlay. Samsung's apps that open by themselves and were never used close after 1 minute. |
| Optimize and Restore | ✅ | Checked on the screen with the scripts; the new app runs the same scripts. |
| Back to the launcher after standby | ✅ | The M8 comes back on it by itself. The Frame comes back on the TV input: since 1.0.4 the launcher brings itself back, also when leaving Art Mode (contributor's report). |
| Full restart (`reboot`) | ✅ | The launcher is back after about a minute; about 80 s on The Frame and the QN92D, where Tizen starts it later. |
| Power cut, or a device switched on on HDMI at start-up | 🧪 | Not tested. |
| Automatic updates from GitHub | ✅ | Seen on the M8 and on a user's TV. A new version of the package itself (APL Overlay, the bridge) still needs installing again. The automatic rollback has not been needed yet. |
| TizenBrew and TizenTube | ✅ | Not needed; the launcher opens them and leaves them alone. |
| Casting YouTube from a phone | 🧪 | Not tested since Samsung's YouTube app was removed on the test screen. |
| Steam Link and Moonlight | ✅ | Shown with their own artwork when they are installed. The installer does not install them. |
| Android apps (APK) | ❌ | Tizen cannot run them. |
