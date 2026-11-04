/* ============================================================
   settings-tree.js — content of the Settings app.

   Apple TV layout, content = the screen's Samsung menus
   (Tizen One UI, Smart Monitor M8), taken from videos of
   "All Settings": Picture, Gaming, Sound, Connection,
   Advanced Features, General & Privacy, Support.

   Entry types:
     menu    -> submenu
     info    -> value read live from the screen (read-only)
     toggle  -> launcher preference On / Off (real)
     choice  -> launcher preference with several choices (real)
     volume  -> real volume (◀ ▶ to adjust); mute -> real mute
     action  -> immediate action (real)
     tv      -> real picture setting of the screen (◀ ▶ to adjust)
     tvmode  -> real picture mode; game -> real Game Mode
     native  -> other real setting of the screen: slider, or list of values
     samsung -> the Samsung settings, a single row: the fallback for what
                the screen does not let the launcher do.
   ============================================================ */
(function (global) {
    "use strict";

    var APL = global.APL, sys = APL.sys;

    function menu(label, icon, children, desc) { return { type: "menu", label: label, icon: icon, children: children, desc: desc }; }
    function info(label, get, desc) { return { type: "info", label: label, get: get, desc: desc }; }
    function toggle(label, key, desc) { return { type: "toggle", label: label, key: key, desc: desc }; }
    function choice(label, key, options, desc, apply) { return { type: "choice", label: label, key: key, options: options, desc: desc, apply: apply }; }
    function action(label, run, desc, icon) { return { type: "action", label: label, run: run, desc: desc, icon: icon }; }
    /* Real setting of the screen (sys.native): slider without "options", otherwise a list of values. */
    function n(id, label, desc, options, format) { return { type: "native", id: id, label: label, desc: desc, options: options, format: format }; }
    var ON_OFF = [[0, APL.t("Off")], [1, APL.t("On")]];
    /* REAL picture setting, read and written directly on the screen (otherwise "Unavailable"). */
    function tv(id, label, desc) { return { type: "tv", id: id, label: label, desc: desc }; }
    /* Sound output and Bluetooth: the Audio panel of Control Center. */
    function openAudio() { APL.settings.close(); APL.controlCenter.openAudio(); }
    /* A theme or a place of the Aerial screen saver: OK shows or hides it. */
    function flag(label, token, desc) { return { type: "flag", label: label, token: token, desc: desc }; }
    function aerialPlaces() {
        var seen = {};
        (global.APL_AERIALS || []).forEach(function (a) { seen[a[0]] = true; });
        return Object.keys(seen).map(function (p) { return flag(APL.t(p), p); })
            .sort(function (a, b) { return a.label.localeCompare(b.label, APL.locale); });
    }

    /* Tint: 15 is neutral, below it more green, above it more red. */
    function tintText(v) { return v === 15 ? "0/0" : v < 15 ? APL.t("G{n}", { n: 15 - v }) : "R" + (v - 15); }
    function signed(v) { return v > 0 ? "+" + v : String(v); }
    function balanceText(v) { return v === 10 ? APL.t("Center") : v < 10 ? APL.t("L{n}", { n: 10 - v }) : APL.t("R{n}", { n: v - 10 }); }
    function eqText(v) { return signed((v - 50) / 10); }
    function delayText(v) { return v + " ms"; }

    function confirmReset(title, message, run) {
        return function () {
            APL.alert({
                title: title, message: message, focus: 0,
                buttons: [{ label: APL.t("Cancel") }, { label: APL.t("Reset"), destructive: true, run: function () {
                    run().then(function () { APL.toast(APL.t("Settings restored"), true); }, function (e) { APL.toast(e.message); });
                } }]
            });
        };
    }

    function build() {
        var apps = ((APL.allApps && APL.allApps()) || []).filter(function (a) { return !a.virtual; });
        /* The language is fixed when the launcher starts (i18n.js): changing it reloads the launcher. */
        var language = sys.pref("language");

        return menu(APL.t("Settings"), "display", [

            action(APL.t("Control Center"), function () { APL.settings.close(); APL.controlCenter.open(); },
                APL.t("Also opens with the ⏯ button on the remote, or by holding Home."), "sliders"),

            choice(APL.t("Appearance"), "appearance", [["light", APL.t("Light")], ["dark", APL.t("Dark")], ["auto", APL.t("Automatic")]],
                APL.t("Light or dark for backgrounds and menus. Automatic switches to dark at sunset and to light at sunrise.")),

            menu(APL.t("Living Home Screen"), "sun", [
                toggle(APL.t("Light of the Day"), "ambient", APL.t("A soft tint over the Top Shelf follows the sun where you are: pink at dawn, golden at sunset, blue at night.")),
                toggle(APL.t("Weather"), "weather", APL.t("Temperature and sky next to the clock, from Open-Meteo. The town is found from the screen's internet address (geojs.io); Paris if it can't be found.")),
                toggle(APL.t("Rain and Snow"), "weatherFx", APL.t("When it rains or snows outside, drops or flakes fall over the Top Shelf for 40 seconds when you come back Home.")),
                info(APL.t("Now"), function () {
                    var w = APL.ambient && APL.ambient.now();
                    return w ? (w.city ? w.city + " · " : "") + w.temp + "°" : "—";
                })
            ], APL.t("Light of the day, weather, rain and snow.")),

            /* -------- Account -------- */
            menu(APL.t("Users and Accounts"), "person", [
                action(APL.t("Household Profiles"), function () { APL.settings.close(); if (APL.profilesUI) APL.profilesUI.open(); },
                    APL.t("Choose, add, rename or delete a profile. Each one keeps its own Home Screen, preferences and recent apps."), "person"),
                info(APL.t("Current Profile"), function () { return sys.pref("profileName") || "—"; }, APL.t("The profile chosen at the top right."))
            ], APL.t("Household profiles.")),

            /* -------- Picture (everything seen in the videos) -------- */
            menu(APL.t("Picture"), "display", [
                { type: "tvmode", label: APL.t("Picture Mode"), desc: APL.t("Dynamic, Standard, Eco, Movie. Changes right away. Each mode keeps its own settings.") },
                tv("backlight", APL.t("Backlight"), APL.t("Screen brightness. ◀ ▶ to adjust, live.")),
                tv("contrast", APL.t("Contrast"), APL.t("◀ ▶ to adjust, live.")),
                tv("sharpness", APL.t("Sharpness"), APL.t("◀ ▶ to adjust, live.")),
                tv("color", APL.t("Color"), APL.t("Color saturation. ◀ ▶ to adjust, live.")),
                menu(APL.t("Eye Care"), "sparkle", [
                    n("eyeSaver", APL.t("Eye Saver Mode"), APL.t("Reduces blue light."), ON_OFF),
                    n("adaptive", APL.t("Adaptive Picture"), APL.t("Adjusts the picture to the light in the room."), ON_OFF)
                ], APL.t("Eye protection and adaptive picture.")),
                menu(APL.t("Expert Settings"), "sliders", [
                    n("tint", APL.t("Tint (G/R)"), APL.t("◀ ▶ to adjust, live."), null, tintText),
                    n("contrastUp", APL.t("Contrast Enhancer"), APL.t("Adjusts the picture's contrast automatically."), [[0, APL.t("Disabled")], [1, APL.t("Low")], [3, APL.t("High")]]),
                    n("shadow", APL.t("Shadow Detail"), APL.t("Brightens or darkens the dark areas."), null, signed),
                    n("gamma", APL.t("Gamma"), APL.t("BT.1886 curve: darker or brighter in the midtones."), null, signed),
                    n("colorSpace", APL.t("Color Space"), APL.t("Auto follows the source, Native uses all the colors of the screen."), [[0, APL.t("Auto")], [1, APL.t("Native")]]),
                    n("colorTone", APL.t("Color Tone"), APL.t("Cool leans blue, warm leans red."), [[1, APL.t("Cool")], [2, APL.t("Standard")], [5, APL.t("Warm1")], [6, APL.t("Warm2")]]),
                    n("clarity", APL.t("Picture Clarity"), APL.t("Smooths moving pictures."), [[0, APL.t("Disabled")], [2, APL.t("Auto")], [4, APL.t("Custom")]]),
                    n("blur", APL.t("Blur Reduction"), APL.t("In Custom mode."), null),
                    n("judder", APL.t("Judder Reduction"), APL.t("In Custom mode."), null),
                    action(APL.t("Reset Picture"), confirmReset(APL.t("Reset Picture?"), APL.t("Restores the factory values of the current picture mode, brightness included."), function () { return sys.native.reset("ResetPicture"); }),
                        APL.t("Restores all picture settings to their default values."), "reset")
                ], APL.t("Fine-tuning of the picture.")),
                info(APL.t("Screen Resolution"), sys.display),
                info("HDR", function () { return sys.hdr(); })
            ], APL.t("Picture Mode, colors and fine-tuning.")),

            /* -------- Gaming -------- */
            menu(APL.t("Gaming"), "gamepad", [
                { type: "game", label: APL.t("Game Mode"), desc: APL.t("Reduces latency for consoles and PCs on HDMI and USB-C. OK to change.") }
            ], APL.t("Game Mode.")),

            /* -------- Sound -------- */
            menu(APL.t("Sound"), "speaker", [
                { type: "volume", label: APL.t("Volume"), desc: APL.t("◀ ▶ to adjust. The screen's real setting.") },
                { type: "mute", label: APL.t("Mute"), desc: APL.t("Turns the sound off or back on.") },
                toggle(APL.t("Sound Effects"), "uiSounds", APL.t("Little clicks when moving through the menus, like on Apple TV.")),
                info(APL.t("Digital Output Audio Format"), function () { return sys.audio.outputMode(); }),
                action(APL.t("Sound Output"), openAudio, APL.t("Screen speakers, AirPods, Bluetooth headphones and speakers."), "speaker"),
                n("soundMode", APL.t("Sound Mode"), APL.t("Amplify boosts voices and volume."), [[1, APL.t("Standard")], [5, APL.t("Amplify")]]),
                n("autoVolume", APL.t("Auto Volume"), APL.t("Evens out the volume between sources."), [[0, APL.t("Disabled")], [1, APL.t("Normal")], [2, APL.t("Night")]]),
                menu(APL.t("Expert Settings"), "sound", [
                    n("balance", APL.t("Balance"), APL.t("◀ ▶ toward the left or the right."), null, balanceText),
                    n("eq0", APL.t("Equalizer: 100 Hz"), APL.t("Bass."), null, eqText),
                    n("eq1", APL.t("Equalizer: 300 Hz"), "", null, eqText),
                    n("eq2", APL.t("Equalizer: 1 kHz"), APL.t("Voices."), null, eqText),
                    n("eq3", APL.t("Equalizer: 3 kHz"), "", null, eqText),
                    n("eq4", APL.t("Equalizer: 10 kHz"), APL.t("Treble."), null, eqText),
                    action(APL.t("Reset Equalizer"), confirmReset(APL.t("Reset Equalizer?"), APL.t("All bands go back to the center."), function () { return sys.native.reset("ResetEqualizer"); }), "", "reset"),
                    n("delay", APL.t("Digital Output Audio Delay"), APL.t("Fixes the lag between picture and sound."), null, delayText),
                    n("earc", APL.t("HDMI-eARC Mode"), APL.t("For a soundbar on HDMI-eARC."), ON_OFF),
                    n("feedback", APL.t("Sound Feedback"), APL.t("The sounds of the Samsung menus."), [[0, APL.t("Disabled")], [1, APL.t("Low")], [2, APL.t("Medium")], [3, APL.t("High")]])
                ], APL.t("Balance, equalizer, eARC, audio delay."))
            ], APL.t("Sound Output, Sound Mode, equalizer.")),

            /* -------- Screen Saver (launcher) -------- */
            menu(APL.t("Screen Saver"), "photo", [
                choice(APL.t("Start After"), "screensaverDelay",
                    [[0, APL.t("Never")], [2, APL.t("2 minutes")], [5, APL.t("5 minutes")], [10, APL.t("10 minutes")], [15, APL.t("15 minutes")], [30, APL.t("30 minutes")]],
                    APL.t("Idle time on the Home Screen before the screen saver starts.")),
                choice(APL.t("Type"), "screensaverStyle", [["aerial", APL.t("Aerial (Apple videos)")], ["art", APL.t("App artwork")], ["clock", APL.t("Large clock over the artwork")], ["dark", APL.t("Clock on black")]],
                    APL.t("Aerial: the Apple TV flyover videos, streamed live (China, Hawaii, London, space station…). Without a network, it switches to the app artwork.")),
                choice(APL.t("Video Quality"), "aerialQuality", [["auto", APL.t("Automatic")], ["1080", "1080p"], ["4k", "4K"]],
                    APL.t("Automatic: 1080p on older screens (they start in a second or two), 4K on recent ones. While the first video loads, an app's artwork shows.")),
                menu(APL.t("Aerial Themes"), "photo", [
                    flag(APL.t("Cities"), "cityscape", APL.t("New York, London, Hong Kong, Dubai…")),
                    flag(APL.t("Earth from Space"), "space", APL.t("Views from the International Space Station.")),
                    flag(APL.t("Underwater"), "underwater", APL.t("The seabed, sea animals and aquatic plants.")),
                    flag(APL.t("Landscapes"), "landscape", APL.t("China, Hawaii, Grand Canyon, Iceland, Yosemite…")),
                    menu(APL.t("Choose Places"), "photo", aerialPlaces(), APL.t("Hides the places you don't want to see."))
                ], APL.t("Choose what the screen saver shows.")),
                action(APL.t("Preview"), function () { APL.settings.close(); if (APL.screensaver) APL.screensaver.start(); }, APL.t("Starts the screen saver now. Press any button to exit."))
            ], APL.t("Apple TV–style screen saver.")),

            /* -------- Connection -------- */
            menu(APL.t("Connection"), "wifi", [
                menu(APL.t("Network"), "wifi", [
                    info(APL.t("Status"), function () { return sys.network().connected ? APL.t("Connected") : APL.t("Disconnected"); }),
                    info(APL.t("Connection Type"), function () { return sys.network().type; }),
                    info(APL.t("Network Name"), function () { return sys.network().ssid; }),
                    info(APL.t("Signal Strength"), function () { var n = sys.network(); return n.type === "Wi-Fi" ? n.signal + " / 5" : "—"; }),
                    info(APL.t("IP Address"), function () { return sys.network().ip; }),
                    info(APL.t("MAC Address"), function () { return sys.network().mac; }),
                    info(APL.t("Gateway"), function () { return sys.network().gateway; }),
                    info(APL.t("DNS Server"), function () { return sys.network().dns; })
                ], APL.t("Network status and addresses.")),
                action("Bluetooth", openAudio, APL.t("Connect or pair AirPods, headphones or a speaker."), "bluetooth"),
                action("AirPlay", function () { APL.settings.close(); APL.controlCenter.openAirPlay(); }, APL.t("Stream from an iPhone, iPad or Mac."), "airplay"),
                menu("HDMI", "hdmi", [
                    n("hdmiBlack", APL.t("HDMI Black Level"), APL.t("Change it if blacks look gray or crushed."), [[0, APL.t("Normal")], [1, APL.t("Auto")], [2, APL.t("Low")]])
                ], APL.t("HDMI input settings."))
            ], APL.t("Network, Bluetooth, AirPlay, HDMI.")),

            /* -------- Advanced Features -------- */
            menu(APL.t("Advanced Features"), "sparkle", [
                toggle(APL.t("“Full screen” hint"), "showHint", APL.t("Shows “Press ▲ for full screen” on the Home Screen.")),
                toggle(APL.t("Return to the Launcher"), "homeReturn", APL.t("When an app closes, or when Samsung's home opens on its own (a phone app's Home button, a remote Vetro doesn't intercept), the screen comes back here. Samsung's home opened from the launcher's Smart Hub tile stays.")),
                action(APL.t("Alexa on the microphone button"), function () { APL.settings.close(); APL.services.alexaMic(); },
                    APL.t("Do this once: in the Voice menu, choose Amazon Alexa and sign in to your Amazon account. Then hold the microphone button on the remote and talk to Alexa."), "mic"),
                toggle("Alexa (Echo Dot)", "alexaBridge", APL.t("Say “Alexa, discover my devices” once. Then: “Alexa, turn on TizenTube”, “Alexa, turn off the screen”, “Alexa, turn on the AirPods”, “Alexa, turn on game mode”.")),
                toggle(APL.t("Slow Background Motion"), "bgMotion", APL.t("A slow camera move over the Home Screen images. Pretty, but it keeps the screen very busy and slows everything else down.")),
                menu(APL.t("Start Screen Option"), "power", [
                    n("smartHub", APL.t("Autorun Smart Hub"), APL.t("Leave it off so you no longer land on the Samsung home screen."), ON_OFF)
                ], APL.t("Make the screen start on APL Launcher."))
            ], APL.t("Return to the launcher, Alexa, backgrounds, start-up.")),

            /* -------- Apps -------- */
            menu(APL.t("Apps"), "apps", [
                menu(APL.t("Show on Home Screen"), "apps", [
                    // The launcher's own Smart Hub tile first: the way out to Samsung's home
                    { type: "hide", label: "Smart Hub", id: "apl.samsunghome",
                      desc: APL.t("A tile that opens Samsung's Smart Hub, the way out now that the Home button opens the launcher. Press Home there to come back.") }
                ].concat(apps.map(function (a) {
                    return { type: "hide", label: a.name, id: a.id, desc: APL.t("OK to show or hide “{name}” on the Home Screen.", { name: a.name }) };
                })), APL.t("Choose the apps shown on the Home Screen.")),
                info(APL.t("Rearrange"), function () { return APL.t("Hold OK"); },
                    APL.t("On the Home Screen, hold OK on an app: Edit Home Screen, Hide App or Delete App.")),
                action(APL.t("Reset Home Screen"), function () {
                    if (APL.resetHomeOrder) APL.resetHomeOrder();
                    APL.toast(APL.t("Original layout restored"), true);
                }, APL.t("Puts the apps back in their original order (your apps, Settings, Sources, then the others)."), "reset"),
                toggle(APL.t("Automatic Artwork"), "autoArt",
                    APL.t("The launcher finds each app's logo, background and current content on its own (Apple's App Store, TMDB), even for apps installed later. Otherwise, it makes them from the app's icon.")),
                choice(APL.t("Background for Other Apps"), "shelfArt",
                    [["logo", APL.t("Logo on Its Colors")], ["colors", APL.t("Its Colors Only")], ["wallpaper", APL.t("APL Wallpaper")]],
                    APL.t("Top Shelf of the apps that have no artwork of their own: their logo enlarged on their colors, their colors alone, or the same wallpaper for all of them."),
                    function () { if (APL.restyleArt) APL.restyleArt(); }),
                action(APL.t("Search for Artwork Again"), function () {
                    if (APL.refreshArt) APL.refreshArt();
                    APL.toast(APL.t("Searching for artwork in the background…"), true);
                }, APL.t("Clears the artwork found and searches again for all apps."), "reset"),
                toggle(APL.t("Dynamic Top Shelf"), "liveShelf", APL.t("Shows the movies, shows and videos of the moment in the Top Shelf (Netflix, Prime, Disney+, TizenTube…).")),
                info(APL.t("TMDB Key"), function () { return APL.live && APL.live.keys().tmdb ? APL.t("Configured") : APL.t("Missing"); },
                    APL.t("Put it in launcher/js/keys.local.js on the PC, then rebuild.")),
                info(APL.t("YouTube Key"), function () { return APL.live && APL.live.keys().youtube ? APL.t("Configured") : APL.t("Missing"); },
                    APL.t("Optional: trending videos in TizenTube's Top Shelf.")),
                info(APL.t("Fanart.tv Key"), function () { return APL.live && APL.live.keys().fanart ? APL.t("Configured") : APL.t("Missing"); },
                    APL.t("Optional: HD backgrounds for movies and shows. Set it in APL Launcher Setup.")),
                info(APL.t("Installed Apps"), function () { return String(apps.length); }),
                toggle(APL.t("Close unused apps"), "idleClose",
                    APL.t("An app left in the background for more than 10 minutes closes on its own, TizenTube included: the screen keeps its memory and stays smooth. The app in front is never closed, nor are the Home Screen, the TV inputs and AirPlay.")),
                action(APL.t("Free Up Memory"), function () { APL.freeMemory(); },
                    APL.t("Closes the apps left open behind the launcher (Netflix, Disney+, Samsung's YouTube…). They reopen normally, but start over from the beginning. TizenTube stays ready."), "reset")
            ], APL.t("Apps shown on the Home Screen and their artwork.")),

            /* -------- General & Privacy -------- */
            menu(APL.t("General & Privacy"), "sliders", [
                choice(APL.t("Language"), "language", [["auto", APL.t("Automatic")], ["en", "English"], ["fr", "Français"]],
                    APL.t("Automatic follows the screen's language. The launcher restarts to apply it."),
                    function (v) { if (v !== language) setTimeout(function () { global.location.reload(); }, 400); }),
                toggle(APL.t("24-Hour Time"), "clock24", APL.t("Time format on the Home Screen and in Control Center.")),
                toggle(APL.t("Visual Effects (blur, glass)"), "visualEffects", APL.t("Prettier but slower. Off by default so the screen stays smooth.")),
                menu(APL.t("Power and Energy Saving"), "leaf", [
                    n("ecoSensor", APL.t("Brightness Optimization"), APL.t("Lowers the brightness in a dark room."), ON_OFF),
                    n("energy", APL.t("Power Saving Mode"), APL.t("Reduces power consumption."), ON_OFF)
                ], APL.t("Brightness and power consumption.")),
                menu(APL.t("Accessibility"), "access", [
                    toggle(APL.t("Reduce Motion"), "reduceMotion", APL.t("Removes the launcher's zooms and fades.")),
                    choice(APL.t("Opening an App"), "openAnim", [["auto", APL.t("Automatic")], ["zoom", APL.t("Zoom")], ["fade", APL.t("Fade")], ["none", APL.t("None")]],
                        APL.t("Zoom: the tile grows until it fills the screen, as on Apple TV. Fade: the tile grows a little and fades while the screen goes black, smooth on every screen. Automatic: fade on older screens (Tizen 6), zoom on recent ones."))
                ], APL.t("Launcher animations.")),
                menu(APL.t("Samsung Services"), "shield", [
                    action(APL.t("Block All"), function () { APL.services.cutAll(); },
                        APL.t("Stops the Samsung services below from starting. They go away at the screen's next full restart. Nothing is uninstalled."), "shield"),
                    action(APL.t("Restore All"), function () { APL.services.restoreAll(); },
                        APL.t("Brings back what was blocked here, at the screen's next start-up."), "reset")
                ].concat(APL.services.groups.map(function (g) {
                    return { type: "service", label: g.label, group: g, desc: g.desc };
                })), APL.t("Stops what the launcher no longer needs from starting.")),
                toggle(APL.t("Close Apps at Start-Up"), "bootCleanup", APL.t("Once per full power-on, closes what the system opens on its own: Netflix, TV Plus, Disney+, Samsung Internet, Art Mode, the pieces of the Samsung home screen and the blocked services. Frees about 350 MB.")),
                { type: "samsung", label: APL.t("Samsung Settings"), desc: APL.t("For what the screen keeps for its own menus: changing Wi-Fi, time, language, Samsung account, parental controls, privacy, reset.") }
            ], APL.t("Clock, energy, accessibility, Samsung Settings.")),

            /* -------- Routines (routines.js) -------- */
            menu(APL.t("Routines"), "night", [
                action(APL.t("Good Night"), function () { APL.settings.close(); APL.routines.goodNight(); },
                    APL.t("Sleep timer, low brightness, Do Not Disturb and a black screen saver, in one press. Press again to cancel; everything comes back the next morning."), "night"),
                choice(APL.t("Good Night: Sleep After"), "nightMinutes", [[15, APL.t("15 minutes")], [30, APL.t("30 minutes")], [45, APL.t("45 minutes")], [60, APL.t("1 hour")], [90, APL.t("1 h 30")]],
                    APL.t("When the screen turns off after Good Night.")),
                choice(APL.t("Good Night: Brightness"), "nightBacklight", [[0, APL.t("Minimum")], [4, "4"], [8, "8"], [14, "14"], [20, "20"]],
                    APL.t("The backlight while Good Night runs (0 to 50).")),
                menu(APL.t("Kids Mode"), "kids", [
                    { type: "check", label: APL.t("Kids Mode for {name}", { name: sys.profiles.current().name }),
                      get: function () { return APL.kids.active(); }, set: function (v) { APL.kids.set(v); },
                      desc: APL.t("This profile only sees the apps chosen below. Settings, the other profiles, the app menu and the search ask for the parent PIN. A fence for young children: the screen's Parental Controls stay the real lock.") },
                    menu(APL.t("Allowed Apps"), "apps", apps.map(function (a) {
                        return { type: "check", label: a.name, onText: APL.t("Allowed"), offText: "—",
                                 get: function () { return APL.kids.allowedIds().indexOf(a.id) !== -1; },
                                 set: function () { APL.kids.toggleApp(a.id); },
                                 desc: APL.t("OK to allow or remove “{name}” in Kids Mode.", { name: a.name }) };
                    }), APL.t("The apps a child's profile sees.")),
                    action(APL.t("Change PIN"), function () { APL.kids.changePin(); }, APL.t("The 4-digit parent PIN."), "lock")
                ], APL.t("A profile for children, behind a PIN.")),
                { type: "action", label: APL.t("Phone Remote"), icon: "phone", run: function () { APL.settings.close(); APL.phone.open(); },
                  value: function () { return sys.pref("phoneRemote") ? APL.t("On") : APL.t("Off"); },
                  desc: APL.t("Your phone becomes a remote: swipe to move, tap to open, and a keyboard for the search. Scan the code shown on the screen (same Wi-Fi).") }
            ], APL.t("Good Night, Kids Mode, phone remote.")),

            /* -------- Support -------- */
            menu(APL.t("Support"), "info", [
                action(APL.t("Diagnostic"), function () { if (APL.diag) APL.diag.open(); },
                    APL.t("Tests on this screen what depends on the model: Vetro, each remote key, volume, the phone remote, brightness, weather, TMDB, Apple's videos, smoothness. Volume, mute and brightness are changed for a second, then put back. Takes about a minute."), "help"),
                menu(APL.t("Launcher Update"), "update", [
                    info(APL.t("Version"), function () {
                        var u = APL.updater;
                        return u ? (u.fromBundle() ? APL.t("{v} (auto-update)", { v: u.running() }) : u.running()) : sys.version;
                    }, APL.t("The version running. “auto-update”: downloaded on its own from GitHub.")),
                    toggle(APL.t("Automatic updates"), "autoUpdate",
                        APL.t("The launcher checks GitHub every 6 hours and installs the new version on its own. Nothing to do on the PC.")),
                    action(APL.t("Check for Update"), function () { if (APL.updater) APL.updater.check(true); },
                        APL.t("Checks right away for a new version."), "update"),
                    action(APL.t("Go Back to the Installed Version"), function () { if (APL.updater) APL.updater.reset(); },
                        APL.t("Forgets the downloaded updates and goes back to the version installed by APL Launcher Setup."), "reset")
                ], APL.t("Automatic updates from GitHub.")),
                menu(APL.t("About This Screen"), "info", [
                    info(APL.t("Name"), function () { return sys.product().name; }),
                    info(APL.t("Model"), function () { return sys.product().model; }),
                    info(APL.t("Software Version"), function () { return sys.product().firmware; }),
                    info(APL.t("Tizen Version"), function () { return sys.product().tizen; }),
                    info(APL.t("Resolution"), sys.display),
                    info(APL.t("Storage"), sys.storage),
                    info(APL.t("IP Address"), function () { return sys.network().ip; }),
                    info("APL Launcher", function () { return APL.t("Version {v}", { v: sys.version }); }),
                    info(APL.t("Sources"), function () { return "TMDB, YouTube, App Store, Apple Music"; },
                        APL.t("Movies and shows: This product uses the TMDB API but is not endorsed or certified by TMDB."))
                ], APL.t("Model, software and storage."))
            ], APL.t("Launcher updates, about.")),

            action(APL.t("Sources"), function () { APL.openSources(); },
                APL.t("Connected devices: HDMI, TV Access, SmartThings, Emby…"), "source"),
            action(APL.t("Sleep Now"), function () { sys.sleepNow().catch(function (e) { APL.toast(e.message); }); },
                APL.t("Turns off the screen."), "moon")

        ], APL.t("All the screen's settings, the Apple TV way."));
    }

    APL.settingsTree = build;
})(window);
