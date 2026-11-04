# Changelog

## 1.1.4 (Flownyx5 fork)
- Start with the screen, every time: some installers record Vetro's service and the launcher's bridge without "start at boot" (and Vetro's without "restart"), so after a full start nothing came back until Vetro was opened by hand. Once Vetro answers, the launcher reads these flags in the screen's app database and turns them on if they are off, as Vetro does for itself (effective at the next start). No reinstall needed: this comes with the automatic update.
- Diagnostic: the "Start-up with the screen" line shows these flags.

## 1.1.3 (Flownyx5 fork)
- Merges the original project's 1.0.5 to 1.0.8 (Knikt/APL-Launcher-for-TizenOS), see below: every HDMI input in Sources and inputs on the Home Screen, the bridge relays the Remapper rules (Home back to the launcher without APL Overlay), Setup accepts Tizen Studio certificates again, and a start-up that doesn't finish shows its errors instead of a black screen.
- The Diagnostic screen is now `js/diagnostic.js` (`js/diag.js` is the original project's start-up watchdog).

## 1.1.2 (Flownyx5 fork)
- Vetro wakes up on its own: if it still doesn't answer about 130 s after the screen started (or when the launcher finds it silent), the launcher's bridge starts Vetro's service; if the screen refuses that, it opens Vetro's app for a few seconds, the time for its service to start, then brings the launcher back. At most once every 5 minutes. Before that, the usual causes are worth fixing: Vetro older than 0.3.2 (open it once after updating), or Developer Mode's Host PC IP not `127.0.0.1`.
- Diagnostic: a "Start-up with the screen" line tells whether the launcher's service started with the screen and whether Vetro had to be woken up.

## 1.1.1 (Flownyx5 fork)
- Settings › Support › Diagnostic: tests on the screen itself what depends on the model (Vetro, the bridge, each remote key really sent, volume and mute, the phone remote's server, writing the backlight, weather, the TMDB key, Apple's videos, frames per second, free memory). Volume, mute and backlight are changed for a second, then put back. The report is also readable as text from the phone remote ("Diagnostic" link at the bottom of its page).

## 1.1.0 (Flownyx5 fork)
This copy updates itself from Flownyx5/APL-Launcher-for-TizenOS. Install it once with APL Launcher Setup placed in a download of this repository (the loader changed).
- Older screens (Tizen 6.0, Chromium 76: Samsung Q60A and others of 2021 and before): logos, Top Shelf backgrounds, screen saver and Settings backgrounds were invisible (`inset` is not understood there), and rows had no spacing (no `gap` in flex rows). Both now work, and these screens get lighter animations.
- Netflix and Prime Video show again on screens that list them as `org.tizen.netflix-app` / `org.tizen.primevideo`.
- App artwork screen saver: the app's logo floats over its background.
- Instant start-up: the Home Screen of the last start shows right away, the screen's app list replaces it as soon as it arrives. Tiles and backgrounds are decoded in advance.
- Aerial screen saver: 1080p by default on older screens (Settings › Screen Saver › Video Quality), and an app's artwork shows while the first video loads instead of a black screen.
- Opening an app: the tile grows until it fills the screen, as on tvOS. A band of light sweeps across the tile that gets the focus, in the direction of the move.
- Living Home Screen (Settings › Living Home Screen): a tint that follows the sun, the local weather next to the clock (Open-Meteo), and rain or snow over the Top Shelf for 40 seconds when it rains or snows outside.
- Search (new tile, Control Center, the blue key, or any letter on a keyboard): apps, films and series (TMDB), and where to watch them in France, with a button that opens the service if it is installed.
- Phone Remote (Control Center, Settings › Routines): scan the QR code, then swipe to move, tap to open, Back/Home/⏯/volume, and a keyboard that types into the search. A small server on port 8092, opt-in, protected by a secret token or a 4-digit pairing code; only remote keys can be sent.
- Good Night (Control Center, Settings › Routines): sleep timer, low brightness, Do Not Disturb and a black screen saver in one press; everything comes back the next morning.
- Kids Mode (per profile, Settings › Routines): only the chosen apps; Settings, other profiles, the app menu, search and phone remote behind a parent PIN.

## 1.0.8
- A start-up that doesn't finish no longer leaves a black screen: after 20 s on screen without the Home Screen, the launcher shows the errors it met, its version and the screen's model, to send in a GitHub issue.

## 1.0.7
- APL Launcher Setup: a certificate made with Tizen Studio's Certificate Manager is accepted again. When no Apps2Samsung certificate was valid, Setup stopped with "the TizenTube one has expired" before looking at the Tizen Studio profiles, whatever the PC had. It now uses the profile, says when no certificate was found at all, and checks the signed package: an expired certificate is reported with its date instead of being refused by the screen.

## 1.0.6
- Releases also carry `apl-launcher-full-vX.Y.Z.wgt`: the launcher and APL Overlay in one package for Apps2Samsung, with a .NET bridge and a start-up service (#8, thanks exzos28). APL Launcher Setup is unchanged.
- Without APL Overlay, the launcher can give the Home button back to itself again: its bridge now relays the Remapper rules (and the microphone switch), which it refused before. This is in the package: install it again (APL Launcher Setup or the .wgt).

## 1.0.5
- Sources shows every HDMI input of the screen. Tizen 9 no longer lists the inputs to apps, so every screen showed the Smart Monitor's (one HDMI and USB-C): they are now read from the screen through Vetro, with the device Samsung recognized on each input.
- An input can go on the Home Screen like an app: in Sources, hold OK on it › Add to Home Screen. Its tile shows the chosen device, and Edit Home Screen moves it into the dock.

## 1.0.4
- The Frame and other screens: the bridge reaches Vetro through the screen's own network address when the local one is blocked, brings the launcher back about 1 second after a wake-up instead of 15, and also after leaving Art Mode (#5, #6, thanks skjnldsv). The bridge is in the package: install it again (APL Launcher Setup or the .wgt).
- Without APL Overlay, the launcher still gives Home back to itself and the other buttons to Samsung, and now says so (#2, thanks exzos28).
- A Smart Hub tile to reach Samsung's home if you need it, hidden at first: Settings › Apps › Show on Home Screen (#7, thanks exzos28).
- Settings › Apps › Background for Other Apps: for apps with no artwork of their own, their logo on their colors, their colors only, or one APL wallpaper for all of them.
- Smoother Top Shelf on apps with Continue Watching cards (Stremio, AquaPlay, Hot Player): coming up from the grid, the cards wait for the end of the animation, and the app's data is read afterwards and less often.
- The screen's resolution shows the panel's (4K) and the interface's (1920 × 1080).

## 1.0.3
- Apps2Samsung's TV-Store now shows in the app grid: it was taken for a second Samsung App Store and hidden (#4, thanks exzos28).

## 1.0.2
- Back from sleep on the launcher: screens that wake up on the TV input or Samsung's home (The Frame 2025, which has no *Autorun Last App* setting) now open APL Launcher again when it was in front at power-off. An HDMI input, for example a console that switched the screen on, is left alone. This is in the launcher package: install it again (APL Launcher Setup or the .wgt for Apps2Samsung).
- The Frame: Art Mode's app is no longer closed at start-up or after a minute in the background.
- Releases also carry the launcher alone as a .wgt for Apps2Samsung, for installing without a Windows PC (#1, thanks exzos28).

## 1.0.1
- Smoother videos: the Samsung apps that open by themselves in the background (Samsung TV Plus, Prime Video, Samsung's video player, My Contents…) now close after 1 minute instead of 10 when you never opened them. They reopen at every wake-up and held about 250 MB that the app you watch needs. Apps you use keep the 10 minutes. Comes with APL Overlay: run APL Launcher Setup again to get it.

## 1.0.0
First public version.
- tvOS-style home screen: full-screen Top Shelf, glass dock, 6-column grid, Control Center (even over a video), Apple TV-style Settings covering every Samsung settings page, and Sources with a device picker.
- Live Top Shelf for streaming, music, game and sports apps, with film and series ratings; official logos for 50+ apps and automatic artwork for the others.
- *Continue watching* for AquaPlay, Hot Player and Stremio: title artwork from TMDB, channel logos, episode, time left and progress bar.
- Remote buttons: Home twice for the app switcher, hold Home or press ⏯ for the Control Center; Samsung TV Plus opens AquaPlay and Prime Video opens TizenTube when they are installed.
- Alexa on the microphone button, with a Siri-like glow while you speak.
- Household profiles with Memoji avatars; aerial screen saver with Apple's videos in 4K.
- Apps left in the background for 10 minutes close by themselves, never the one in front.
- Automatic updates from GitHub with automatic rollback; optimizer, and Restore to undo everything.
- **APL Launcher Setup**, a Windows app with Install, Optimize, Restore and Tools pages, instead of .bat files. Nothing to install to run it.
- English and French: the launcher follows the screen's language (or Settings › General & Privacy › Language), APL Overlay follows the launcher, and APL Launcher Setup and its scripts follow Windows.
- Needs Vetro on the screen; the installer puts only APL Launcher and APL Overlay on it.
