# Changelog

## 1.2.0 (Flownyx5 fork)
Rebuilt on the original project's 1.0.22 (Knikt/APL-Launcher-for-TizenOS), with the fork's features on top. From the original: Start on APL Launcher, Liquid Glass and Dynamic Backdrops, the moving screen-saver clock, Vetro on another port, Samsung's 2025 Home, the web bridge's log and fallback port for Tizen 6, Tizen 4 support, Sources with Live TV, APL TV, Nuvio, the Top Shelf styles, apps per row, Search (the fork's Search, with films, series and where to watch them, replaces its app-only list). See below for the fork's own changes since 1.1.0 and the original's since 1.0.9.

## 1.1.9 (Flownyx5 fork)
- Return to the Launcher without APL Overlay: when Samsung's home comes to the front by itself — the Home button of a phone app (SmartThings…) or of a remote Vetro doesn't intercept, or an app that closes — the launcher's bridge brings the launcher back within about 2 s. Samsung's home opened from the Smart Hub tile stays. Settings › Advanced Features › Return to the Launcher; the Diagnostic counts how many times it happened.
- Phone remote: Home opens the launcher directly (an injected Home key went to Samsung's home, as with the phone apps).
- The bridge is in the package: install again with APL Launcher Setup.

## 1.1.8 (Flownyx5 fork)
- TizenTube wears YouTube's logo and artwork: tile, Top Shelf, blurred grid background, App Switcher and screen saver.

## 1.1.7 (Flownyx5 fork)
- Without APL Overlay (it is built for Tizen 9, so older screens can't run it): the launcher's bridge now closes the apps left in the background for 10 minutes, as APL Overlay does (Samsung's apps that open by themselves and were never used: after a minute). Never the app in front, the launcher, Vetro, the TV inputs, AirPlay, nor music apps (Spotify, Deezer, Apple Music…), which keep playing behind the Home Screen. Settings › Apps › Close unused apps; the Diagnostic shows the last ones closed. The bridge is in the package: install again with APL Launcher Setup.
- Opening an app on older screens: a light fade (the tile grows a little and fades while the screen goes black) replaces the full-screen zoom, which stuttered on a Tizen 6 TV, and the app starts once the animation is done. The black veil now really fades in (it appeared at once the first time). Settings › General & Privacy › Accessibility › Opening an App: Automatic, Zoom, Fade or None.

## 1.1.6 (Flownyx5 fork)
- Older screens are recognized again: Samsung TVs write their engine as "76.0.3809.146/6.0 TV" in the user agent, not "Chrome/76", so the Q60A (Tizen 6.0) got neither the lighter animations nor the 1080p screen saver videos. The Tizen version and the missing `inset` support now count too.
- Diagnostic: the last row no longer runs over the footer; a start-up flag that can't be read is shown as a limit, not a success.

## 1.1.5 (Flownyx5 fork)
- Diagnostic: when APL Overlay is missing, says why (it is built for Tizen 9 and .NET 6) and which .NET the screen has, to see what an older-screen version would need.

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

## 1.0.22
- **Liquid Glass and Dynamic Backdrops** (#32, thanks praneetchoudhary0-droid): the dock, the status pill and the Control Center get Liquid Glass, a slice of the backdrop baked once instead of blurred live, so it is always on (*Visual Effects* keeps the live blur). *Dynamic Backdrops* (off by default) shows a film or series the service streams right now, from JustWatch's trending list, on apps with nothing of their own to show. The Control Center sits on a fixed grid with room for the French labels, and gets a Search button. Measured on the M8: a little heavier, the same feel.
- **The screen saver's clock can move** (#37): *Settings › Screen Saver › Move the Clock* sends it to the next corner every 1 to 5 minutes, clockwise and a few pixels off each time, against burn-in on OLED screens. It works with every type, the two big clocks included. Tried in the preview and on the M8.
- **OLED screens are recognized** by their model (S8x and S9x TVs, Odyssey OLED monitors with Smart TV): there the clock moves every 2 minutes by default, and the setting says the screen is an OLED. Your own choice still wins. On the M8, which is not an OLED, nothing changes.
- **Vetro on another port than 8099.** Vetro can be built with another port (`VETRO_PORT=…`), for example when another app already holds 8099. The launcher only looked on 8099, and *Link to Vetro* said "Vetro refused" (Reddit, Vetro on 8098). The launcher, both bridges and APL Overlay now check the port, try every port open on the screen when Vetro is not on it, and keep the one that answers like Vetro. APL Launcher Setup also tries the usual other ports (8098, 8100, 9000…) and passes the port on to its steps. *Link to Vetro* shows the port when it is not 8099. Tried with a fake Vetro on a PC; on the M8, only that APL Overlay sees the screen's open ports. Not yet tried with Vetro really on another port.
- **Samsung's new Home** on the 2025 screens (`com.samsung.tv.coba.newhome`, `com.samsung.tv.home.media`) counts as Samsung's home everywhere: APL Overlay, both bridges and the TizenTube watcher replace it with the launcher like the older one, and idle-app closing never closes the new Home. APL Boot already knew it. Reported on an S90F and an S93F; not tried on a 2025 screen.
- *Start on APL Launcher*: the switch shows "…" while the screen is asked and says after 20 s when the screen does not answer (an S90F showed nothing at all on OK, and the write only failed after a minute). When the screen keeps another home app, the message says which one and what Autorun Smart Hub is.
- *Settings › Support › Support APL Launcher* shows a QR code to the Ko-fi page (ko-fi.com/knikt). The READMEs and GitHub's Sponsor button have the link too.
- The changes to APL Overlay and the bridges (Samsung's new Home, Vetro's port) come with the full package: install it again with APL Launcher Setup or Apps2Samsung. The rest reaches the screens through the automatic update.
- Compatibility list: S90F (Start on APL Launcher with Vetro's *Custom launcher* off, the new Home) and S93F after 1.0.21. Troubleshooting: Vetro on another port.

## 1.0.21
- **The launcher stays in memory.** Leaving TizenTube showed Samsung's home, then black for about 10 s while the launcher started again (Reddit, an S93F): when memory runs short, the screen's memory manager closed the launcher like any forgotten app. APL Overlay now asks it, through Vetro, to leave the launcher and itself out of its low-memory killer, again whenever one of them restarts. Tried on the M8, also after a full restart. Comes with APL Overlay: install the full package again (APL Launcher Setup or Apps2Samsung).
- After a full start, Home pressed before Vetro holds the remote no longer leaves Samsung's home on screen for 350 ms: APL Overlay knows whether Vetro holds Home yet and puts the launcher over it at once. On the M8, APL Overlay saw Vetro take Home; a Home press in that first minute could not be tried from here.
- **Without Vetro** (installed from Apps2Samsung's TV-Store without root, a Q72D on Reddit), *Return to the Launcher* is off unless you turn it on: it needs no Vetro and replaced Samsung's home as soon as Home showed it, with no way back to Samsung's menus. The settings that need Vetro (picture, Game Mode, Start on APL Launcher, Samsung services, closing apps, Set Up the Remote Buttons, Alexa) say *Needs Vetro*, and the *Smart Hub* tile says that Home opens Samsung's home. Nothing changes where Vetro is installed. Tried in the PC preview, with and without Vetro.
- The launcher starts on Tizen 4 screens again (#35, a UA32N4200 from 2018): the clocks used `padStart`, which their browser doesn't have. `tools/check.py` now refuses the functions newer than the oldest screens' browsers. Vetro has no root on screens that old, so only the launcher itself works there.
- The synthesized clicks (used when you have no sound files of your own) fade in and out: the Back key made a snap "like breaking plastic" on an S93F.
- APL Launcher Setup: "Loaded" is no longer taken for a signing profile (#36). Without an Apps2Samsung certificate, Setup reads Tizen Studio's profiles, and the newer Tizen CLI starts that list with "Loaded in '…profiles.xml'": the package came out unsigned and the install stopped.
- Tizen 6: APL Overlay, the bridge and the start-up service build for Tizen 6's .NET Core 3.1 (`TIZEN6`), with APL Overlay in a see-through notification window so the Control Center stays over apps. With the launcher and APL Overlay in two packages (test builds `tizen6-test-2` and `tizen6-test-3`) it works on The Frame 2022 (#21). APL Launcher Setup and Apps2Samsung still install the launcher alone on Tizen 6: installing both packages comes next.
- Troubleshooting: *Start on APL Launcher* and Vetro 0.5's *Custom launcher* (it switches Autorun Smart Hub off), and Samsung's menus without Vetro. The compatibility list covers every report so far (S93F, S90F, Q72D, S95C, AUE70, Tizen 5.5 and older).

## 1.0.20
- **APL TV**, the IPTV player made to go with APL Launcher ([Knikt/APL-TV-for-TizenOS](https://github.com/Knikt/APL-TV-for-TizenOS)): Live TV, movies and series from your own M3U playlists and Xtream accounts, in the same style. On the Home Screen it has its own tile, and its Top Shelf shows what you were watching at its minute and your last channel (APL TV writes them itself, with no address or account in them); OK on a card opens APL TV right there. Tried on the M8 with APL TV 1.0.1.
- APL Launcher Setup: *Install* page › **Also install APL TV** downloads the latest APL TV release, checks its SHA256, adds your TMDB key and the launcher's fonts and sounds, signs it with your certificate and installs it. A failure there never fails the launcher's install. The READMEs present APL TV.
- **Search**: ▲ from the dock goes full screen, ▲ again opens Search. A row of letters, the matching apps below as you type, the recently used ones before that; apps hidden from the Home Screen only with *Settings › Home Screen › Search Hidden Apps* (#28, thanks skjnldsv).
- *Settings › Home Screen › Apps per Row*: 5, 6 (as before) or 7 apps in the dock and the grid (#27, thanks skjnldsv).
- The Top Shelf backgrounds are no longer shipped: the screen draws them itself (Sheets of Light by default since 1.0.16), and the package loses 118 images. *Otherwise* keeps Sheets of Light, Large Logo (the app's logo on a halo of its colour, now for every app) and Black; App Colors and the APL wallpaper go, a saved choice moves to the closest one (#26, thanks skjnldsv).
- **Live TV** in Sources on TVs (antenna, cable or satellite: the screen's own tuner, Samsung's input 0, as Vetro's dock does it on a Q80A). Hold OK on it › Add to Home Screen pins it like an app. Asked on Reddit. Not on the Smart Monitors, which have no tuner: tried with fake TVs (a Q80A on Tizen 6, an S95C on Tizen 9) and on the M8, where it rightly doesn't show; not yet on a TV.
- Apps2Samsung can offer the launcher-only package too, for Tizen 6 (#10): it carries a second copy of its keys file at `res/wgt/js/keys.local.js`, the path Apps2Samsung writes the keys to in the full package, read when `js/keys.local.js` has none. The catalog entry (`packaging/apps2samsung/`) lists both packages as two variants.
- APL Launcher is created by Knikt (Gero Corp.): said in *Settings › Support › About This Screen*, APL Launcher Setup's About page, the READMEs and the license.
- Installing without a Windows PC: `scripts/install-via-vetro.py` installs the full package through Vetro from macOS or Linux with Python 3, and can ask for the API keys (#25, thanks BPHvZ).
- Nuvio's Continue Watching in the Top Shelf, like Stremio's: the last films and episodes started in Nuvio's TV app (official and hosted builds), with their picture, rating and the time left. Read on the screen, from Nuvio's own progress list only, never its account. Asked on Reddit again and again. Tried with a real Chromium storage written the way Nuvio writes it, read by the M8's own tools; not yet with Nuvio itself installed.
- *Settings › Support › About This Screen › Link to Vetro* gives Vetro's reason when it runs nothing, for example "no root agent connected": an S95C on Tizen 9 (Reddit) only said "Vetro refused", and its picture settings and brightness did not work.
- Netflix shows on the Home Screen when Samsung preinstalled it (`org.tizen.netflix-app`, on the M8 and on an S95C reported on Reddit): it was taken for one of the screen's services and hidden, even from Show on Home Screen.
- Prime Video's Top Shelf works in every country: TMDB lists it as 9 in the US, the UK and Germany, and as 119 in India, France and Canada. The launcher only knew 119.
- Without the bridge, the Top Shelf's country comes from the screen's time zone before its language: a Frame in India with an English menu got American results, where JioHotstar and Sony LIV have none (#21).
- The web bridge (Tizen 6 screens) keeps its own log, `bridge.log` in the launcher's data folder, and answers through another port when the trusted one fails: on The Frame 2022 (Tizen 6.5) the launcher never got an answer, with nothing to say why (#21). It comes with one more install with APL Launcher Setup. Tried with a fake screen only: the M8 uses the .NET bridge.

## 1.0.19
- *Settings › Remote and Devices › Set Up the Remote Buttons* sets the remote in Vetro from the screen, as APL Launcher Setup does. Home and ⏯ go to APL Overlay (Home to APL Launcher on Tizen 6), and Samsung TV Plus and Prime Video too when AquaPlay and TizenTube are installed and no rule uses them yet. Other Vetro rules are left alone. It also says whether Vetro intercepts the remote, and where to turn that on.
- So a launcher installed from a phone with Apps2Samsung no longer needs a PC: Vetro's own Remapper does not list APL Overlay, and picking it took a browser console. Asked on Reddit. Tried on the M8: with the ⏯ rule removed in Vetro, the button put it back (the same four rules as before) and ⏯ went to APL Overlay again.
- Install guide: installing from a phone with Apps2Samsung, step by step. A custom `.wgt` comes without API keys; Apps2Samsung asks for them when APL Launcher is installed from its catalog.

## 1.0.18
- JioHotstar, Sony LIV and Nuvio join the catalog, with their own logo tile and background. They are recognised by their Tizen id (for Nuvio: the official, hosted, native and lite builds) or by their name, and "Disney+ Hotstar" is no longer taken for Disney+. Asked for in #21 and on Reddit.
- JioHotstar and Sony LIV fill the Top Shelf with what is popular on them in your country (TMDB), like Netflix or Prime Video. Nuvio shows what is trending, like Stremio. Tried in the PC preview set to India: The Mentalist and The Office on JioHotstar, Mob Psycho 100 on Sony LIV. On the M8 the launcher starts as before with the new catalog (none of the three apps is installed there).

## 1.0.17
- The online demo (and the PC preview) looks like a real screen: a dock anyone could have (TizenTube, Netflix, Prime Video, Disney+, Apple TV), a live Top Shelf with Blender Studio's open movies (CC BY, pictures from TMDB) when there is no TMDB key, and the Sheets of Light behind catalog apps. It showed this PC's own favourites, TizenTube twice and an empty Top Shelf.
- *Settings › Support › About This Screen › Link to Vetro* tells more: whether the bridge gets the launcher's requests at all, or gets them but cannot reach Vetro, with the addresses it tried and how each failed (#21: "Bridge: timeout" on a Tizen 6.5 Frame). The detail from the web bridge (Tizen 6) comes with APL Launcher Setup 1.0.17.
- The Top Shelf's "Movie" and "TV Show" follow the launcher's language right away: what was kept from before a language change stayed in the old one for up to 6 hours.
- The "Clock on black" screen saver is centred on the screen (#24, thanks skjnldsv).

## 1.0.16
- Settings are reorganised (#22, thanks skjnldsv): **Appearance** gathers the theme, the Top Shelf, visual effects and background motion; **Home Screen** the apps shown, their order and the way back to the launcher; **Remote and Devices** the play/pause button, Alexa and Bluetooth.
- One **Top Shelf** menu, in the order the launcher tries things: What You're Watching, What's Popular, then **Otherwise** for apps without artwork. Sheets of Light are now the default there for anyone who never picked a style; Black replaces the old App Backgrounds switch (turned into Black when it was off). Tried on the M8: the new menus in French, Otherwise on Sheets of Light.
- *Start on APL Launcher* moves to **General & Privacy**, above Close Apps at Start-Up, and Advanced Features goes away (#23, thanks skjnldsv). Autorun Smart Hub leaves the launcher's Settings: Start on APL Launcher turns it on, APL Overlay switches it around standby, and turning it off alone kept the launcher from showing at power-on. It is still in Samsung's own settings.
- *Settings › Support › About This Screen › Link to Vetro* says how the launcher reaches Vetro: through its bridge, with the time it took, or the bridge's error. Without the bridge, orders still go out but nothing can be read back, so the screen's settings say Unavailable: on a Tizen 6.5 Frame (#21) the picture values came back in under a second from the PC, never in the launcher. On the M8: "Through the bridge (107 ms)".
- Install guide: on Tizen 6.x with Apps2Samsung, install the launcher alone and map Home to it.
- Samsung TV Plus is no longer listed through its deep linker on Tizen 6.5: launched alone it doesn't open TV Plus (reported in #21, where Prime Video and Apple TV now work). The Samsung TV Plus app from the store is listed as before.

## 1.0.15
- APL Launcher Setup installs the launcher on its own on Tizen 6.x screens. APL Overlay, the bridge and the start-up service of the full package are .NET apps for Tizen 7 and newer: on The Frame 2022 (Tizen 6.5) they don't run, and since the launcher reaches Vetro through that bridge, the settings stayed empty and Bluetooth devices didn't connect (#21). The launcher's own package has a web bridge instead. Setup reads the screen's Tizen version through Vetro; Tizen 7 and newer get the full package as before. Tried from this PC: both packages built and signed, the right one chosen for the M8 (Tizen 9); not tried on a Tizen 6 screen.
- Prime Video and Apple TV show in the launcher when Samsung preinstalled them: their Samsung ids were filtered out with the screen's own services (Apple TV is com.samsung.tv.aria-video), and on Tizen 6.5 Samsung TV Plus too, through its deep linker (#21). Seen on the M8: Apple TV in the grid.
- The Top Shelf empties what it kept when the screen's country changes: trending videos fetched for France stayed up to 6 hours after the update to 1.0.14.

## 1.0.14
- *Start on APL Launcher* no longer brings Samsung's home at every wake. It needs Autorun Smart Hub on for the launcher to show a second after a full start, but with it on the screen also opened Samsung's home after each standby. APL Overlay now turns Autorun off while the screen sleeps and back on once it is awake: a wake goes back to the app you were watching, and a full start still shows the launcher at once. Only on screens that really come back from standby, learned at the first wake (The Frame's deep standby is a full start and is left as it was). Tried on the M8: two wakes with Autorun off by hand (back on the launcher, back on AquaPlay) and two with APL Overlay switching it (back on AquaPlay, no Samsung home; Autorun on again 16 s after the wake); a full start, the launcher in front 1.5 s after power-on.
- Home pressed in the minute after a wake, while Vetro restarts, still reaches the screen, which opens its home: APL Overlay now replaces it at once (half a second on screen on the M8) instead of after a check that the busy screen delayed to 3 s.
- APL Boot also puts the launcher in front of Samsung TV Plus after a full start: with Autorun off (after a power cut during standby) the M8 showed TV Plus until then.
- The Top Shelf follows the screen's country: trending videos, top albums, game prices and what each streaming service offers were those of France on every screen. The country is the one Samsung's store uses on the screen, read through Vetro once and kept (#21, reported from India).

## 1.0.13
- Top Shelf: your own content first. Apps that fill Samsung's home with rows (Plex's Continue Watching, Spotify's mixes) now fill the Top Shelf the same way, and ▲ then OK opens the item itself (#14, thanks skjnldsv). *Settings › Apps › Top Shelf Content* sets what comes first.
- Sheets of Light, a new *Top Shelf Background* choice: soft sheets of light in the app's colors (#13, thanks skjnldsv). Their colors now follow the logo: as bright as the logo's color (yellows no longer turn olive, orange no longer brown or red), and a logo with two colors (Samsung TV Plus, Pluto TV) gets both.
- Liquid Glass for the dock, the Control Center and the status pill, with no live blur (#18, thanks skjnldsv). Over live Top Shelf content the dock is clear glass: the frosted copy showed big pixels there on the M8.
- Home always brings the Home Screen back to rest, from deep in Settings or full screen, and the screen saver no longer greets you on the way back (#17, thanks skjnldsv).
- *Settings › ⏯ in Apps*: Control Center (as before) or Play and Pause (#16, thanks skjnldsv).
- Sources fits five inputs or more on screen (#19), and with a single profile the status pill shows the time alone (#15, thanks skjnldsv).
- APL Overlay opens the launcher through the screen itself first, Vetro only if that fails: after a wake, Samsung's home showed for several seconds while Vetro restarted, now for under a second.

## 1.0.12
- Sources: *Add to Home Screen* (hold OK on an input) was the last of 16 cards, below the bottom of the screen. It now comes first, and the cards are smaller so all of them fit. Reported on Reddit.
- *Settings › Apps › Top Shelf Background* (was *Background for Other Apps*): a new choice, *APL Wallpaper for Every App*, puts the same wallpaper behind every app, including those with artwork of their own. Continue Watching and the Dynamic Top Shelf then sit on it too. The other choices only change the apps without artwork, and now say so. The APL wallpaper itself is now a plain dark gradient.

## 1.0.11
- APL Launcher Setup installs the full package, like Apps2Samsung (#9, thanks exzos28): it downloads the release's package, adds your personal files and signs it with your certificate, so the PC no longer needs the C# compiler or .NET 6. A screen set up before moves by itself: the buttons go to the new APL Overlay first, then the old separate package is removed. Tried on the M8: keys, websites, settings and *Start on APL Launcher* kept.
- APL Overlay no longer closes Netflix and YouTube's engine over and over: the screen preloads them and starts them again a minute after they are closed, about 15 times an hour. An app that comes back by itself twice in a row is now left alone, until it is used.

## 1.0.10
- APL Overlay: Home pressed in the first minute after power-on, before Vetro takes the key, opened Samsung's home and could leave it there. APL Overlay now brings the launcher back without Vetro, also when Samsung's home was already in front when it started. Tried on the M8: five presses before Vetro was up, the launcher back each time in under half a second.
- Alexa on the microphone button didn't work after a full start once the launcher showed early: APL Overlay asked Vetro once, before it was up. It now tries every 15 s until Vetro runs it (on the M8: about 70 s after power-on).
- Both are in APL Overlay: install again with APL Launcher Setup, or the full package with Apps2Samsung.

## 1.0.9
- Tizen 6.x: the Home Screen stayed black with no apps. The stylesheet used the CSS `inset` property, which the browser engine of Tizen 6.5 and older doesn't know, so every app icon was 0×0. It now uses `top`, `right`, `bottom` and `left`; newer screens look the same. Found by a Reddit user.
- *Settings › Advanced Features › Start Screen Option › Start on APL Launcher*: the screen makes the launcher its home app and shows it about a second after power-on, instead of about a minute (#12, thanks skjnldsv). Measured on the M8: 1.3 s instead of 64 s. Turning it off puts the original values back; Restore does too, and the Optimizer leaves Autorun Smart Hub on while the launcher is the home app.
- The start-up cleanup and the remote's key-repeat fix gave up silently when Vetro wasn't answering yet, which happens after a full start: they now try again every 15 s for 2 minutes. On the M8 the key repeat had stayed at 350 ms.
- The Frame: APL Overlay reaches Vetro through the screen's LAN address like the bridge, the launcher is back right after a wake, and the full package's bridge reads the screen state straight from the platform (#11, thanks skjnldsv).
- APL Overlay never closes The Frame's Art Mode any more.

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
