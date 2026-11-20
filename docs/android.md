# APL Launcher on Android TV and Google TV

APL Launcher also runs on Android TV and Google TV, as a real launcher app: the same Home Screen, Settings, Control Center, Search, profiles and screen saver as on Samsung, from the same code. No root needed.

> **Status: released since 1.1.0.** Tried in the Android TV 14 emulator only (`AOSP TV on x86`): not yet on a real box, TV or on Google TV.

## Install

1. Get the `.apk` from the [latest release](https://github.com/Knikt/APL-Launcher/releases/latest), or on the TV with the Downloader app, code **9890834** (to build it yourself, see [Building](#building)). APL Launcher Setup does steps 2 to 4 for you, your API keys and [APL Launcher Home Button](#apl-launcher-home-button) included.
2. On the TV, in *Settings*, find *About* and press OK seven times on the build number (*Android TV OS build* on Google TV) to get *Developer options*, then turn on *USB debugging* (or *Network debugging*).
3. From the PC, on the same network:
   ```
   adb connect <tv-ip>
   adb install apl-launcher-vX.Y.Z-android.apk
   adb install apl-launcher-home-button-vX.Y.Z-android.apk    # optional: the Home button, see below
   ```
   The Downloader app works too, from a link to the `.apk`.
4. Open APL Launcher from the TV's app list. At its first starts it asks for what Home needs (way A below), until Home opens it, three times at most:
   - without APL Launcher Home Button, it says what the module is for and how to get it;
   - where the device's own launcher keeps the Home button (Android TV 12+, Google TV), *Turn On the Remote Buttons* opens Android's Accessibility screen: choose APL Launcher Home Button, turn it on, accept Android's usual warning, then Back. *All set* confirms it. Tried in the emulator from a fresh install, with a virtual remote;
   - elsewhere it first offers Android's own *Set as default home app* question, then the remote buttons if Home still isn't APL Launcher. Not tried: the emulator's launcher keeps the button.

   *Later* waits for the next start; *Settings › Android TV* has the same steps.

## APL Launcher Home Button

Home, holding Home and ⏯ over every app need an accessibility service, and **Google Play Protect blocks any app installed outside the Play Store that declares one** (*App blocked to protect your device*, with only an OK button: a Nvidia Shield, on Reddit). So since 1.1.4 the service is in a small second app, **APL Launcher Home Button** (`com.knikt.apllauncher.home`, under 1 MB): the launcher itself installs without a warning, and only who wants the Home button installs the module.

- **Get it**: `apl-launcher-home-button-vX.Y.Z-android.apk` in the [latest release](https://github.com/Knikt/APL-Launcher/releases/latest), or in Downloader `https://github.com/Knikt/APL-Launcher/releases/latest/download/apl-launcher-home-button.apk`. APL Launcher Setup installs it with the launcher.
- **Play Protect**: on the TV, Play Store › your profile › *Settings* › *Play Protect*, turn off *Scan apps with Play Protect*, install the module, then turn it back on. `adb install` from a PC works as well.
- **Turn it on**: *Settings › Device Preferences › Accessibility › APL Launcher Home Button › On* (APL Launcher's *Settings › Android TV* opens that screen). After installing it from Downloader, *Open* goes straight there.
- It is signed with APL Launcher's key and talks to APL Launcher only: a permission Android gives only to apps signed with that same key (`HomeButton.kt` in the launcher, `android/homebutton` for the module). Without APL Launcher it does nothing; the Home button stays Android's.
- Updated from 1.1.3 or before, where the service was in the launcher: Home keeps the TV's own launcher until the module is installed and turned on. The launcher says so once.

## The Top Shelf's keys (TMDB, YouTube, Fanart.tv)

The published `.apk` has no API key, and it can't be changed on your PC (it is signed with APL Launcher's own key). The keys are kept by the app instead, in its own storage:

- **On the TV**: *Settings › Appearance › Top Shelf › Online Services*, OK on a key, then type it (Android's keyboard, or the Google TV app on your phone). A TMDB key is checked with TMDB right away, and a refused one never replaces the one already there. *Remove the Typed Keys* removes them.
- **From the PC**: APL Launcher Setup sends the keys of its *Install* page (`scripts/install-android.ps1 -Tmdb … -YouTube … -Fanart …`, else the ones the Setup saved). By hand:
  ```
  adb shell am broadcast -a com.knikt.apllauncher.SET_KEYS -n com.knikt.apllauncher/.KeysReceiver --es tmdb <key> --es youtube <key> --es fanart <key>
  ```
  Only adb and the system may send this (`KeysReceiver.kt` asks for `WRITE_SECURE_SETTINGS`, which apps can't have). The launcher starts again with them. Tried in the emulator: the Setup's script gave the published `.apk` its three keys, and YouTube's Top Shelf showed what is trending.

Without keys, *Settings › Appearance › Dynamic Backdrops* still shows a film or series each service streams now (JustWatch, no key).

## Make Home open APL Launcher

Android TV 12 and later, and Google TV, keep their own launcher on the Home button even after another app is chosen. Tried in the emulator: Android's own question (*Set APL Launcher as your default home app?*, offered in *Settings › Android TV › Make APL Launcher the Home App*) and `adb shell cmd package set-home-activity` both accept APL Launcher, and Home still opens *Android TV Home*, whose Home entry has a system priority. There are two ways around it. Choose one.

### A. APL Launcher Home Button (accessibility service): recommended

Install [APL Launcher Home Button](#apl-launcher-home-button), then on the TV: *Settings › Device Preferences › Accessibility › APL Launcher Home Button › On* (APL Launcher's own *Settings › Android TV › Turn On the Remote Buttons* opens that screen). Or from the PC:

```
adb shell settings put secure enabled_accessibility_services com.knikt.apllauncher.home/com.knikt.apllauncher.home.KeyService
adb shell settings put secure accessibility_enabled 1
```

The first command replaces the list of accessibility services that are on. If another one is on (TalkBack, Button Mapper…), read the list first with `adb shell settings get secure enabled_accessibility_services` and add the module's after a `:`.

What it does, all tried in the emulator with a virtual remote:
- **Home** opens APL Launcher, from any app. Twice quickly: the App Switcher, as on Samsung.
- **Home held**, or **⏯**: the Control Center over the app in front (with *draw over other apps*, [below](#the-control-center-over-apps); without it, the launcher opens with its Control Center). In the launcher, they open its own Control Center.
- When the device's own home comes up by itself (an app closes, the device starts), APL Launcher takes its place: after a full restart it was in front 6 seconds after start-up. *Settings › Home Screen › Return to the Launcher* turns that off.
- Sleep and the Sleep Timer work through it, and Close Unused Apps up to Android 13.

Limits:
- The device's own home can show for a moment at start-up or when an app closes, before APL Launcher replaces it.
- **Force stop** on APL Launcher Home Button (*Settings › Apps*) turns the service off: Android does that. Turn it on again afterwards. Installing an update of either app keeps it on.
- The buttons Google keeps for itself (Assistant, Input, the YouTube and Netflix buttons) stay as they are.
- It only sees the remote's buttons and the name of the app in front; no window content. Nothing in the system changes: uninstalling the module puts everything back.

*Settings › Android TV › Home Button* switches between APL Launcher and the device's own home.

### B. Turn off the device's own launcher (adb)

With its launcher off, Android has only APL Launcher left for Home, with no accessibility service. Tried on the Android TV emulator: Home opened APL Launcher directly.

```
adb shell pm disable-user --user 0 com.google.android.tvlauncher          # Android TV
adb shell pm disable-user --user 0 com.google.android.apps.tv.launcherx   # Google TV
```

On Google TV, people who use other launchers also turn off `com.google.android.tungsten.setupwraith`, which can stand in as a home screen. Not tried here.

Before choosing it:
- Whatever lives in that launcher goes with it: the recommendations rows, Google TV's profiles and *For you*, and on some TVs the inputs menu. A system update can turn it back on.
- **Never uninstall APL Launcher while the device's launcher is off**: the TV would have no home screen. Turn it back on first:
  ```
  adb shell pm enable com.google.android.tvlauncher
  adb shell pm enable com.google.android.apps.tv.launcherx
  ```
- Holding Home and ⏯ for the Control Center over apps still need APL Launcher Home Button (way A).

A is reversible and changes nothing in the system; B avoids the moment where the other home shows, at the cost of what that launcher does.

## The Control Center over apps

It opens over the app in front (hold Home, or ⏯ when *Settings › Remote and Devices › Play/Pause Button* is *Control Center*; both need APL Launcher Home Button), and closes with Back. Its window is the launcher's, so it needs **draw over other apps**:
- on the TV: *Settings › Apps › Special app access › Display over other apps › APL Launcher* (*Settings › Android TV › Allow Over Other Apps* in the launcher opens it; on the Android TV 14 emulator that screen is there), or from the PC: `adb shell appops set com.knikt.apllauncher SYSTEM_ALERT_WINDOW allow`. APL Launcher Setup does it;
- without it, holding Home opens the launcher with its Control Center instead.

The app behind stays on screen and is not paused by Android (tried with APL TV and Live TV; not yet with a video playing). Settings, Search, the screen saver and profiles chosen there open in the launcher.

Optional, with adb: `adb shell appops set com.knikt.apllauncher GET_USAGE_STATS allow` lets the App Switcher list the apps used before the service was turned on.

## Without root, and with root

**Works now, without root** (tried in the emulator unless the line says otherwise):

| | |
|---|---|
| Home Screen | The device's real apps: names, icons, and each TV app's banner as its tile (catalogue artwork first for known apps, artwork found online). Opening apps, Search, folders, profiles, Edit Home Screen, Hide App. The Home Screen follows apps being installed, removed, turned off or on. |
| App Switcher | Home twice: the apps opened lately (seen by APL Launcher Home Button). |
| Delete App | Android's own *Uninstall?* question. |
| Home button | Way A (APL Launcher Home Button) or B above. |
| Control Center | In the launcher and over any app: Sleep, network, Do Not Disturb, Sleep Timer, Accessibility, screen saver, Settings, Search, profiles. Audio opens Android's *Remotes and Accessories* (Bluetooth). |
| Sleep, Sleep Timer | Through APL Launcher Home Button ("lock screen", which puts a TV to sleep). The timer is Android's: on time whatever app is in front. |
| Volume, Mute | Android's media volume. Not checked on a TV whose sound goes to an amplifier over HDMI-CEC. |
| What You're Watching | The cards an app puts in Android TV's *Play Next* row (Watch Next): Nuvio's Continue Watching, the next episode…, over the Top Shelf when the app's tile is focused: *Continue Watching* with the time left and the progress, or *Up Next* when it isn't started; OK opens it right there (the program's own link, only inside that app). Android 11+, with *Allow APL Launcher to read all TV listings…*: Android asks once at the first starts, or APL Launcher Setup gives it (`adb shell pm grant com.knikt.apllauncher android.permission.READ_TV_LISTINGS`). Apps make their rows readable by default (TvProvider: `searchable`). *Settings › Appearance › Top Shelf › What You're Watching* turns it off. Tried in the emulator with Nuvio 1.1.0 (`com.nuvio.tv`: an episode marked as watched, the next one shows as *Up Next* and OK opens Nuvio on it) and with a small app writing a started episode and a movie. APL TV's own *Continue Watching* and *Last Channel* do show: APL TV hands them to APL Launcher itself (its `ShelfProvider`, from the APL TV version after 1.0.12, which answers APL Launcher only, checked by its signing certificate). Tried in the emulator: the cards showed, and OK opened APL TV right in the film, at its minute, or on the channel. |
| Information | Network (type, IP, gateway, DNS), model, Android version, storage, panel and interface resolution, HDR. |
| Settings | Appearance, Top Shelf (What's Popular, artwork), Home Screen, Screen Saver (Aerial videos play), language, clock, profiles, the *Android TV* menu. Android's own screens for Wi-Fi, picture, sound, Bluetooth, apps and everything else. |
| Close Unused Apps, Free Up Memory, ▲ in the App Switcher | **Up to Android 13 only.** Android closes apps left 10 minutes in the background, or all of them on request; never the one in front nor an app playing music with a notification. Android 14 and later let an app close only its own processes (tried in the emulator: Android answers *Invalid packageName*), so these settings are hidden there. Not tried on an Android 13 device yet. |

**Not on Android yet, no root needed** (later versions):
- *Sources*: the HDMI inputs of TVs running Android TV (Sony, TCL, Philips…).
- The Bluetooth list inside the Control Center (Android's own screen opens instead).
- The Wi-Fi network's name: Android hides it from apps without the location permission (shown as —).
- Automatic updates of the launcher: they come with a new `.apk`.

**Would need root** (a second phase, only if wanted):
- Closing apps on Android 14 and later, and on any version closing the one in front and those playing in the background, so *Close Unused Apps*, *Free Up Memory* and the App Switcher's ▲ work everywhere.
- The device's picture and sound settings inside the launcher (backlight, picture mode, Game Mode, equalizer…). Each brand keeps them in its own system app; without root the launcher opens Android's screens.
- Taking the other buttons (Assistant, Input, YouTube, Netflix) or changing the remote's key repeat.
- Sleep without APL Launcher Home Button.

## Building

```
python tools/make-android.py              # your own devices: your keys, fonts and avatars (never publish it)
python tools/make-android.py --release    # the package for GitHub Releases: no key, no SF Pro (Apple's license); the sounds, and the Memoji (tools/memoji.py)
python tools/make-android.py --dev        # your own devices, the page can be inspected from the PC (chrome://inspect)
```

It needs a JDK 17+, the Android SDK (platform 35, build-tools 35), Gradle 8.10, Node and Pillow (see the top of the script). The launcher is copied from `launcher/` unchanged, with the Android layer from `android/web` (`android.js`, and `cc.html` for the Control Center over apps); the Kotlin app is in `android/app`, the module in `android/homebutton`. Nothing in `launcher/` is built differently for Samsung.

It makes both packages, signed with the same key: `apl-launcher-vX.Y.Z-android.apk` and `apl-launcher-home-button-vX.Y.Z-android.apk`. With `--release` it also writes `SHA256SUMS-apk.txt` and copies them under the fixed names `apl-launcher-android.apk` and `apl-launcher-home-button.apk`: add all of them to the GitHub release, so `.../releases/latest/download/<fixed name>` (Downloader) always gives the latest.

Signing: an Android app must always be signed with the same key, or it can't be updated without uninstalling it (which loses the Home Screen layout). APL Launcher has its own key (not APL TV's), kept outside the repository and never published (see the top of the script for where the script looks for it). Its certificate, to check a downloaded `.apk` (`apksigner verify --print-certs`):

```
CN=APL Launcher, O=Gero Corp., C=FR
SHA-256: d9:3c:e3:6b:3c:d7:01:1e:01:81:7f:f3:19:c1:ae:38:6a:8c:48:48:9d:e0:06:ef:0f:61:53:87:6b:d6:86:a6
```

On a machine without that key, the script signs with the Android SDK's test key and names the file `-testkey` (for tests only; `--release` refuses to run then). An `.apk` signed with the test key can't update one signed with APL Launcher's key: uninstall it first.

## How it works

| Piece | Where |
|---|---|
| The Home Screen: a WebView with the launcher, Home and the remote's keys (sent with Samsung's key codes) | `android/app/.../MainActivity.kt`, `Web.kt` |
| What the page asks of Android (`window.APLAndroid`): apps, launching, sound, network, Android's screens, sleep… | `Bridge.kt`, `AppList.kt`, `SleepReceiver.kt` |
| The remote over every app, the app in front, Close Unused Apps | APL Launcher Home Button: `android/homebutton/.../KeyService.kt` (accessibility service), `Link.kt`; in the launcher `HomeButton.kt` (`HomeButtonProvider`) |
| The API keys, kept by the app and sent by APL Launcher Setup | `KeysReceiver.kt` |
| The Control Center over apps | `Overlay.kt`, `android/web/cc.html` |
| The launcher's Samsung calls turned into Android ones, Settings and Control Center for Android | `android/web/android.js` |

The shared code only has a few hooks that do nothing on Samsung (`APL.platform`, `APL.appsFromList`, `sys.setDefault`).
