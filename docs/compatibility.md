# Compatibility

What works today, what works with limits, what has not been tested on a real screen yet, and what is not possible.
Every "Works" below was checked on a real screen, not only in the PC preview: on the M8 unless the notes say otherwise.

This list follows what users report in the issues, the pull requests and on Reddit. To add your screen, open an issue with its model and Tizen version (*Settings › Support › About This TV*) and what works or not.

| | Meaning |
|---|---|
| ✅ | Works, checked on a real screen |
| ⚠️ | Works, with the limits given in the notes |
| 🧪 | Built, but not yet checked on a real screen |
| ❌ | Not possible on these screens |

**Which package?** Tizen 7 and newer: the full package (`apl-launcher-full-v<version>.wgt`: the launcher, APL Overlay, the bridge to Vetro and the start-up service), which APL Launcher Setup and Apps2Samsung's catalog install. Tizen 6.x: the launcher alone (`apl-launcher-v<version>.wgt`), which Setup picks by itself; the full package doesn't work there yet (see The Frame 2022 and the AU7700).

## Screens

| Screen | Status | Notes |
|---|---|---|
| Samsung Smart Monitor M8, Tizen 9 | ✅ | Developed and used every day on this screen, rooted with Vetro, installed with APL Launcher Setup. |
| Samsung The Frame 2025 (TQ43LS03FAUXXC, 43", Tizen 9) | ⚠️ | Reported by a contributor (#3, #5, #6, #11 to #19). **Launcher package** (Apps2Samsung): Home and a full start open the launcher, and it comes back after sleep and after Art Mode. **Full package**: works; since 1.0.9 APL Overlay reaches Vetro on this screen, the launcher is back about half a second after a wake, and Art Mode is never closed. *Start on APL Launcher* shows the launcher right after power-on. Since 1.0.13, Home from anywhere in the launcher goes back to the Home Screen, Home twice opens the App Switcher and Home held the Control Center (#17), and with *Play and Pause* ⏯ pauses and resumes a film in Plex (#16). Sources shows its four HDMI inputs and AirPlay (#19), and Plex and Spotify fill the Top Shelf with your own items (#14). No *Autorun Last App* setting on this model. |
| Samsung QN92D (2024, Tizen 8) | ⚠️ | Reported by a contributor, with the full package (Apps2Samsung): the launcher, its bridge and the start-up service work, and the launcher opens about 80 s after a full start. APL Overlay works too: the *Smart Hub* tile opens Samsung's home and leaves it there, and Home brings the launcher back (#7). Apps2Samsung's TV-Store shows in the app grid since 1.0.3 (#4, checked with the apps this screen lists). Nothing else reported yet. |
| Samsung QLED Q72D (TQ75Q72D, 2024, Tizen 9) | ⚠️ | Reported on Reddit, installed from Apps2Samsung's TV-Store (full package), **without Vetro**: runs, “a bit laggy”. The launcher keeps coming back over Samsung's menus: *Return to the Launcher* (*Settings › Home Screen*) is on by default and works without Vetro, so Samsung's home, reached with Home, is replaced at once; turning it off keeps Samsung's menus. After a full power-on the start-up service also puts the launcher in front for a few minutes. Without Vetro, nothing can close Samsung's apps in the background. |
| Samsung S93F (QE77S93FAEXXU, 2025, Tizen 9) | ✅ | Reported on Reddit, installed with Apps2Samsung: “very easy process and works amazing”. Leaving TizenTube showed Samsung's home, then black for about 10 s: the screen had closed the launcher to make room, and it started again. Fixed in 1.0.21 (APL Overlay asks the screen's memory manager to keep the launcher). The 2025 screens have Samsung's new Home, which APL Overlay and the bridges replace like the old one from 1.0.22. The synthesized click of Back sounded like a snap: softer since 1.0.21, or *Settings › Sound › Sound Effects* off. |
| Samsung S90F (2025, Tizen 9) | ⚠️ | Reported on Reddit, installed with Apps2Samsung and Vetro: *Start on APL Launcher* won't turn on, even with Vetro 0.5's *Custom launcher* off and *Start with Smart Hub Home* on, so after a full start the launcher comes after 30 to 90 s; laggy with *Visual Effects* on (they are off by default). This screen has Samsung's new Home: from 1.0.22 APL Launcher replaces it like the old one, and the message on *Start on APL Launcher* says what the screen kept. The Right key once kept repeating: Vetro's input helper restarting while it was held (pressing it again stops it; APL Overlay releases it by itself). |
| Samsung S95C (Tizen 9) | ⚠️ | Reported on Reddit. Netflix, preinstalled by Samsung, was hidden: it shows since 1.0.20. The picture settings and the brightness did not work, with only “Vetro refused” to say why: since 1.0.20 *Settings › Support › About This Screen › Link to Vetro* gives Vetro's reason (for example no root agent connected). Not confirmed back yet. |
| Samsung S95B (QD-OLED, 2022) | ✅ | Reported in #37, with Vetro 0.5.0: the screen saver's clock moves from corner to corner since 1.0.22 (on by default there, the screen is recognized as an OLED), and the automatic update works. With Vetro 0.5.0, Samsung's own screen saver no longer shows over the launcher. The 2022 screens run Tizen 6.5: see *Screens on Tizen 6.x* for what the launcher alone can't do. |
| Samsung The Frame 2022 (LS03B, 55", Tizen 6.5) | ⚠️ | Reported in the issues (#21). **Launcher alone** (since 1.0.15): runs, Prime Video and Apple TV are listed and Bluetooth speakers connect, but its web bridge to Vetro never answers there (*Link to Vetro*: timeout), so the picture and Wi-Fi settings stay empty. **Test builds for Tizen 6** (APL Overlay, the bridge and the start-up service built for the screen's .NET Core 3.1): APL Overlay works (Control Center over apps, brightness), and the .NET bridge and the start-up service run. But in one package with them the launcher doesn't open: on Tizen 6, opening it starts APL Overlay instead. **Test 3** (the launcher with its bridge and start-up service, and APL Overlay in a package of its own, in a notification window): “working perfectly”. It goes into the next version, with APL Launcher Setup installing both packages and the keys. |
| Samsung AU7700 (UA43AU7700KLXL, 2021, Tizen 6.0) | 🧪 | Reported in the issues (#10): Vetro has root on it. The full package from Apps2Samsung doesn't work there: the launcher is missing from the app list and opening it starts APL Overlay instead, which can't run without .NET 6. The launcher alone is the package for Tizen 6; not confirmed on this screen yet. |
| Samsung AUE70 (UA43AUE70AKLXL, 2021, Tizen 6) | ⚠️ | Reported on Reddit. APL Launcher Setup refused a valid certificate (fixed in 1.0.7), then the Home Screen stayed black with no apps (fixed in 1.0.9, confirmed). On 1.0.8, Netflix and Prime Video were missing: Prime Video is listed since 1.0.15 and Netflix since 1.0.20, not confirmed on this screen yet. |
| Screens on Tizen 6.x | ⚠️ | Reported on Reddit: no apps on the Home Screen before 1.0.9 (the browser engine ignored a CSS property and every icon was 0×0), all of them showing after the fix. On Tizen 6.0, a few items touch (for example the clock and the profile picture), since its engine also lacks spacing in rows. Without APL Overlay (launcher alone): no Control Center over apps, no Alexa on the microphone button, no closing of idle apps; Home goes to the launcher. |
| Screens on Tizen 5.5 and older (2020 and before) | ❌ | Not for now. Vetro's notes report no root on a 2020 Q80T (Tizen 5.5, Vetro runs app-only there), and a 2019 Q80R (Tizen 5.0) only with local changes; the Home button, the remote buttons and the system controls need root. Their browser engine is also older than anything tried: Tizen 4 lacks CSS Grid, which the Control Center uses. |
| Other Samsung Smart Monitors and TVs | 🧪 | Not tested yet. They need Vetro, so only screens that Vetro supports can work. Reports are welcome in the issues. |
| Samsung screens without root / Vetro | ⚠️ | The launcher itself runs (the Q72D above): apps, Top Shelf, Return to the Launcher. Everything else needs Vetro: the Home button and the other remote buttons, the *Smart Hub* tile, the screen's settings (picture, Wi-Fi, Bluetooth), Start on APL Launcher, and closing apps (Free Up Memory, Close Unused Apps, Close Apps at Start-Up). |

### Reports without a model yet

| Report | Status | Notes |
|---|---|---|
| A 4K TV (Reddit) | ⚠️ | Works, and an automatic update arrived while it was in use. Its three points are fixed: the resolution shown as 1920×1080 and Stremio's cards slowing the animation (1.0.4), only one HDMI input in Sources (1.0.5). |
| A TV (Reddit) | ⚠️ | No return to the launcher after standby, and Samsung's home not caught: reported before 1.0.4 and without APL Overlay. |
| A TV (Reddit) | ⚠️ | “Not smooth and lagging.” *Settings › Appearance › Visual Effects* and *Slow Background Motion* off, and *Settings › Apps › Close Unused Apps* on, are what helps; not confirmed back. |
| A Tizen 9 screen (#25) | 🧪 | The full package 1.0.19 installs through Vetro with `scripts/install-via-vetro.py` (Python 3, from macOS, Linux or Windows). Nothing else reported yet. |

## Remotes

| Remote | Status | Notes |
|---|---|---|
| Samsung Smart Remote (*Smart Control 2016*), paired over Bluetooth | ✅ | Every button, the microphone included. |
| The same remote, infrared only | ⚠️ | Every button except the microphone: by infrared it only asks the screen to show the pairing guide. |
| Other remotes and keyboards | 🧪 | Not tested. |

Vetro intercepts one device at a time: pick the remote in Vetro › Remapper (see [Installation](installation.md)), and stop listening there once a key is captured: listening pauses the interception.

## PC and phone

| | Status | Notes |
|---|---|---|
| Windows 11 | ✅ | APL Launcher Setup. |
| Windows 10 | 🧪 | Should work the same; not tested. |
| macOS, Linux | ⚠️ | APL Launcher Setup is a Windows app. `scripts/install-via-vetro.py` (Python 3) installs the full package through Vetro and can ask for the API keys (#25, tried on a Tizen 9 screen); the `.wgt` packages of each release also install with Apps2Samsung. Optimize and Restore are not available. The PC preview (`launcher/index.html`) opens in any browser. |
| Apps2Samsung (phone, PC or its TV-Store) | ✅ | Its catalog and TV-Store install the full package: The Frame 2025, the QN92D and the Q72D were installed with it. *Settings › Remote and Devices › Set Up the Remote Buttons* (1.0.19) sets the remote in Vetro as Setup does. Optimize and Restore need the Windows app. On Tizen 6, install the launcher alone as a custom `.wgt`. |

## Features

### Home screen

| Feature | Status | Notes |
|---|---|---|
| Top Shelf, dock, grid, focus motion, sounds | ✅ | 57–60 frames per second once the screen has settled. |
| Liquid Glass on the dock, the Control Center and the status pill | ✅ | On the M8 and The Frame 2025 (1.0.13). No live blur: over live Top Shelf content the dock is clear glass. |
| Top Shelf backgrounds: Sheets of Light, Large Logo, Black | ✅ | Drawn by the screen for apps without artwork; Sheets of Light by default (1.0.16). On The Frame 2025 the first drawing takes 190 to 470 ms per app, one at a time in the background. |
| Back to the launcher when an app closes | ✅ | In less than 0.65 s. *Settings › Home Screen › Return to the Launcher* turns it off. |
| Hold OK on an app: Edit Home Screen, Hide, Delete | ✅ | System apps cannot be deleted. |
| Search | ✅ | ▲ from the dock goes full screen, ▲ again opens Search (1.0.20). |
| 5, 6 or 7 apps per row | ✅ | *Settings › Home Screen › Apps per Row* (1.0.20). |
| *Smart Hub* tile: Samsung's own home | ✅ | Hidden at first: *Settings › Home Screen › Show on Home Screen*. It opens Samsung's home through Vetro and leaves it there; Home brings the launcher back. On the QN92D (#7). |
| Samsung's preinstalled Netflix, Prime Video and Apple TV | ✅ | Listed since 1.0.15 (Prime Video, Apple TV) and 1.0.20 (Netflix). Seen on the M8 and The Frame 2022. |
| Live Top Shelf (trending titles, Game Pass, Steam, Ligue 1, top albums…) | ✅ | Needs a free TMDB key; YouTube trends need a YouTube key. Follows the screen's country (1.0.14); Prime Video works in every country since 1.0.20. |
| Top Shelf: your own content first (Plex's Continue Watching, Spotify's mixes) | ✅ | ▲ then OK opens the item itself. On The Frame 2025 (#14). |
| JioHotstar and Sony LIV in the Top Shelf | 🧪 | What is popular on them in your country (1.0.18). Tried in the PC preview set to India; not yet on a screen with the apps. |
| Live TV as a tile (TVs with a tuner) | 🧪 | *Sources › hold OK on Live TV › Add to Home Screen* (1.0.20). Tried with simulated TVs; Smart Monitors have no tuner, so it rightly doesn't show on the M8. |
| APL TV tile and Top Shelf | ✅ | What you were watching in APL TV and your last channel; OK opens APL TV there. On the M8 with APL TV 1.0.1. |
| Official logos and automatic artwork for other apps | ✅ | |
| Household profiles and Memoji | ✅ | With a single profile, the status pill shows the time alone (#15). |
| Interface in English and French | ✅ | French when the screen is in French; *Settings › General & Privacy › Language* to choose. |
| Launcher interface in 4K | ❌ | The screen draws apps and menus in a single 1920×1080 mode, Samsung's own menus included. Only video is 4K. |

### Continue Watching

| App | Status | Notes |
|---|---|---|
| AquaPlay: last channel | ✅ | Channel name and a sharp logo for 203 French channels. |
| AquaPlay: film or series | ✅ | Picture with the title from TMDB. |
| AquaPlay: progress of a series episode | 🧪 | Checked with simulated data on the PC; not seen yet on the screen. |
| AquaPlay: open straight on a channel or series | ❌ | AquaPlay reads no launch request; its own settings can resume the last channel. |
| APL TV | ✅ | The film or episode at its minute, and the last channel. On the M8 (1.0.20). |
| Stremio | 🧪 | Read from real Stremio data on the PC; not seen yet on the screen. |
| Nuvio | 🧪 | The last films and episodes started, with the time left (1.0.20). Read on the M8 from storage written the way Nuvio writes it; not yet with Nuvio itself installed. |
| Plex | ✅ | Its Continue Watching, through the Top Shelf's own content (#14, The Frame 2025). |
| Hot Player | ⚠️ | Hot Player keeps only the episode number, never the series or channel name. |
| Netflix, Prime Video, Disney+, YouTube, Crunchyroll… | ❌ | They keep nothing readable on the screen and have no public API for your history. The Top Shelf shows what is popular instead. |

### Remote buttons

| Feature | Status | Notes |
|---|---|---|
| Home: back to the launcher | ✅ | From anywhere in the launcher it goes back to the Home Screen at rest (1.0.13). In the first minute after a full start, before Vetro takes the key, Home opens Samsung's home for a moment and APL Overlay brings the launcher back (1.0.10). |
| Home twice: App Switcher | ✅ | Also on The Frame 2025 since 1.0.13. |
| Hold Home, or ⏯: Control Center, even over a video or an HDMI input | ✅ | Over an HDMI input tried on the M8. Home held also on The Frame 2025 since 1.0.13. |
| ⏯ as Play and Pause instead | ✅ | *Settings › Remote and Devices › Play/Pause Button* (1.0.13). On The Frame 2025 (#16). |
| Samsung TV Plus → AquaPlay, Prime Video → TizenTube | ✅ | Only when those apps are installed; otherwise the buttons keep their Samsung role. |
| Set Up the Remote Buttons from the screen | ✅ | *Settings › Remote and Devices* (1.0.19), for screens installed without Setup. On the M8. |
| A stuck key released by itself | ⚠️ | Seen working with the infrared remote; not yet seen over Bluetooth. |

### Control Center and Settings

| Feature | Status | Notes |
|---|---|---|
| Control Center on the launcher and over any app | ✅ | Over apps it is drawn by APL Overlay. |
| Sleep, Wi-Fi, Do Not Disturb, Sleep Timer, Brightness | ✅ | |
| Audio output and Bluetooth headphones (AirPods…) | ✅ | |
| Settings covering every Samsung settings page | ✅ | Real picture controls (backlight, contrast, sharpness, colour, local dimming); a few pages open Samsung's own settings. They need the bridge to Vetro: on The Frame 2022 (launcher alone) they stay empty. |
| *Link to Vetro* | ✅ | *Settings › Support › About This Screen*: how the launcher reaches Vetro, how long it took, or why it can't (1.0.16 to 1.0.20). |
| Sources: inputs and the device on each | ✅ | The HDMI inputs are read from the screen through Vetro (Tizen 9 no longer lists them). On the M8 (one HDMI and USB-C) and The Frame 2025 (four HDMI inputs and AirPlay, all on screen since 1.0.13). |
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
| Clock on black | ✅ | Centred on the screen since 1.0.17 (#24). |
| Cross-fade between two 4K videos | 🧪 | The screen decodes one 4K video at a time: the old one holds its last picture during the fade. Not seen yet. |
| Apple's newest aerials | ❌ | Published only in a format the screen refuses. They are left out of the list. |

### System

| Feature | Status | Notes |
|---|---|---|
| Apps left 10 minutes in the background close by themselves | ✅ | Never the app in front, the launcher, the TV inputs, AirPlay or The Frame's Art Mode. Samsung's apps that open by themselves and were never used close after 1 minute; one the screen starts again right away (its preloaded Netflix and YouTube engine) is left alone. Comes with APL Overlay. |
| Optimize and Restore | ✅ | Checked on the screen with the scripts; the new app runs the same scripts. Windows only (APL Launcher Setup). |
| Back to the launcher after standby | ✅ | The M8 comes back on it by itself. The Frame 2025 comes back on the TV input: the launcher brings itself back, also when leaving Art Mode, about half a second after the wake since 1.0.9 (contributor's report). |
| Full restart (`reboot`) | ✅ | The launcher is back after about a minute; about 80 s on The Frame 2025 and the QN92D, where Tizen starts it later. After a full start, the start-up service keeps it in front of Samsung's own screens for a few minutes. |
| Start on APL Launcher | ✅ | *Settings › General & Privacy*: the screen makes the launcher its home app and shows it about a second after power-on (1.3 s on the M8, measured over two restarts; also on The Frame 2025). Since 1.0.14 a wake from standby no longer opens Samsung's home: on the M8 it goes back to the app that was in front, and Home pressed in the minute after a wake (while Vetro restarts) shows Samsung's home for about half a second only. Turning it off, or Restore, puts the original values back; uninstalling the launcher gives the screen its own home back too. |
| Power cut, or a device switched on on HDMI at start-up | 🧪 | Not tested. |
| Automatic updates from GitHub | ✅ | Seen on the M8 and on a user's TV; *Settings › Support › Launcher Update › Check for Update* checks at once. A new version of the package itself (APL Overlay, the bridge) still needs installing again. The automatic rollback has not been needed yet. |
| APL TV, installed by Setup | ✅ | *Install* page › *Also install APL TV* (1.0.20). On the M8. |
| TizenBrew and TizenTube | ✅ | Not needed; the launcher opens them and leaves them alone. |
| Casting YouTube from a phone | 🧪 | Not tested since Samsung's YouTube app was removed on the test screen. |
| Steam Link and Moonlight | ✅ | Shown with their own artwork when they are installed. The installer does not install them. |
| Android apps (APK) | ❌ | Tizen cannot run them. |
