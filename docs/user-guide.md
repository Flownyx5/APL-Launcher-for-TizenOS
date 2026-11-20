# User guide

The interface is in French, so labels are given here in French with their English meaning.

## Remote

| Key | Home screen | Full screen |
|---|---|---|
| ◀ ▶ ▲ ▼ | move between apps | ◀ ▶ change app |
| **OK** | open the app | open the app |
| **OK held** | app menu (see below) | — |
| **Back** | back to the first app; on the first app, nothing (the *Smart Hub* tile opens Samsung's home) | back to the dock |
| **Home** (Vetro) | opens the launcher; pressed twice: open apps; held: Control Center | |
| **⏯** or red key | Control Center, over any app (⏯ no longer pauses videos, unless *Settings › Remote and Devices › Play/Pause Button* is set to *Play and Pause*) | |
| **Samsung TV Plus** | AquaPlay | |
| **Prime Video** | TizenTube (its own app, TizenTube Cobalt, when it is installed; else through TizenBrew) | |

## Home screen

The screen has three states, like tvOS:

| State | When | What you see |
|---|---|---|
| **Top Shelf** | an app in the dock (top row) is selected | its artwork fills the screen; live content changes slowly |
| **Grid** | ▼ into the other rows | the Top Shelf image freezes and becomes a blurred background; app names appear under the icons |
| **Full screen** | ▲ from the dock | only the artwork stays |

The dock holds your favourite apps, *Settings* and *Sources*.

## App menu (OK held)

Hold **OK** on an app for half a second:

| Choice | Effect |
|---|---|
| **Edit Home Screen** | The app jiggles. Move it with the arrows, then press OK or Back to drop it. The layout is saved. |
| **Change Icon** | Another tile for the app, among the launcher's own logos: TizenTube with YouTube's logo, for example. *Original* gives the app its own tile back. |
| **Hide App** | Removes it from the Home Screen. Bring it back in *Settings › Home Screen › Show on Home Screen*. |
| **Delete App** | Asks for confirmation (*Cancel* is selected by default), then uninstalls through Vetro. System apps cannot be deleted from here. |

## Profiles

Household profiles open from the avatar in Control Center, or from Settings. With two profiles or more, the current one's avatar also shows at the top right, next to the clock. Each person gets their own:
- home screen layout;
- hidden apps;
- interface preferences;
- recently opened apps.

Select **+** to add someone, and hold **OK** on a profile to choose an avatar, rename it, change its colour or delete it. Avatars are Memoji faces (and your own Memoji, see [installation](installation.md#profile-avatars-memoji)), plus 3D animal faces.

Accounts *inside* apps (Netflix profiles, YouTube accounts…) are still chosen in each app.

## Control Center

Open it with **⏯**, by holding **Home**, or with the red key. Glass tiles appear at the top right:

| Tile | Effect |
|---|---|
| **Sleep** | puts the screen to sleep |
| **Wi-Fi** | network name; opens the Connections settings |
| **Do Not Disturb** | hides secondary messages |
| **Audio** | output picker: TV speakers, or paired Bluetooth headphones and speakers with their battery (connect with OK; needs Vetro). *Associer des AirPods…* opens Samsung's Bluetooth list. |
| **Minuterie** (Sleep timer) | cycles 15 / 30 / 60 / 90 / 120 minutes / off |
| ○ **Mode Jeu** | Game Mode settings |
| ○ **Accessibility** | accessibility settings |
| ○ **AirPlay et iPhone** | how to mirror an iPhone, send videos, use the iPhone as a remote, and the AirPlay code setting |
| ○ **Sources** | the Sources screen |
| **Brightness** | ◀ ▶ changes the real backlight (needs Vetro) |
| **Screensaver** / **Settings** | starts the screen saver / opens Settings |

## Home app (Home Assistant)

The Home app shows your Home Assistant house as tiles: rooms down the side,
categories above the grid. It asks for the address once, on the TV, and keeps
whatever it is given.

**One way in: a long-lived access token.** In Home Assistant: your profile,
the Security tab, Long-lived access tokens, Create token. Paste it into the
Token field. Nothing has to be set on the server for it: the token is checked
over a WebSocket, and a WebSocket is not subject to the cross-origin rule that
stops a page reading another site's answer. The REST calls that follow (the
states, the service calls) are the one part that would need this screen in
`http: cors_allowed_origins`, so on a stock install the launcher keeps to the
socket. If that list is set for something else, `- "*"` is accepted - an
earlier version of this page said a wildcard does not work, and that was wrong
(checked on a Frame).

The password sign-in this guide used to describe was removed: it needed this
screen's origin in `http: cors_allowed_origins`, and on the TV the launcher's
origin is not an address that can be listed.

Once inside, **Edit Layout** in the sidebar rearranges the house: move an
accessory to another room, make a room or a category, step an accessory up or
down inside its room, or take it off the house with **Remove from Home**. What
was taken off is listed under **Hidden**, and can be put back from there. The
arrangement is stored on the TV and is never written back to Home Assistant.

## Settings

Apple TV–style split view: a big icon and a description on the left, the list on the right. It covers every Samsung settings section:
- Appearance: light or dark theme, the Top Shelf (what it shows, and the background for apps without artwork), visual effects, background motion;
- Home Screen: apps shown, their order, the full screen hint, coming back here when an app closes;
- Remote and Devices: what the play/pause button does in apps, Alexa, Bluetooth;
- Picture, with real backlight, contrast, sharpness, colour and local dimming;
- Gaming, Sound, Screen Saver, Connection;
- Apps: artwork found online, apps left open, memory;
- General & Privacy: language, clock, starting on the launcher, closing what Samsung opens at start-up;
- Support: about, and launcher updates.

Rows marked with an arrow-out icon open the matching Samsung page.

## Sources

The *Sources* tile shows one tile per input (Live TV on TVs, HDMI, USB-C) plus AirPlay.
- **OK** switches straight to the input. *Live TV* is the screen's own tuner: antenna, cable or satellite.
- **OK held** lets you choose what is plugged in: Nintendo Switch 2, Switch, Steam Deck, PlayStation 5/4, Xbox, PC, Mac, Apple TV, NVIDIA Shield, Fire TV, Chromecast, Freebox, Orange box. The input then shows that device's logo.
- **OK held › Add to Home Screen** pins the input to the Home Screen as a tile, like an app: a *Live TV* tile, for example. Hold OK on the tile to move it.

USB-C has no direct key on Samsung screens, so it opens Samsung's source list as a last resort.

## Screen saver

After the delay set in *Settings › Screen Saver*, Apple's aerial videos play: daytime videos in the day, night videos at night, with the place name. Any key stops it. Without a network, it shows the app artwork instead.

## Preview on a PC or phone

In APL Launcher Setup › Tools, click **Preview on this PC**. The launcher opens in an Edge or Chrome window with an on-screen remote:
- arrows, **OK** (hold for the app menu), Back, Home, ⏯ and full screen;
- on the keyboard: arrows, Enter, Esc = Back, C = Control Center.

Apps do not really open in the preview.
