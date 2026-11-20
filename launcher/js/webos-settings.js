/* ============================================================
   webos-settings.js — Settings and Control Center on LG TVs (webOS).

   settings-tree.js describes Samsung's menus. On an LG TV this file goes
   through that tree once it is built (APL.settingsTree): what only Samsung
   or Vetro can do goes away (Samsung's services, Smart Hub, the overlay,
   root commands), the rest stays as it is, and LG's own parts take their
   place: the TV's picture and sound settings, its sound outputs, LG's
   Settings app. It also gives the Control Center LG's sound outputs and
   AirPlay (controlcenter.js asks APL.platform).
   ============================================================ */
(function (global) {
    "use strict";

    var APL = global.APL = global.APL || {};
    var P = APL.platform;
    if (!P || P.name !== "webos") return;
    var sys = APL.sys;

    function t(s, vars) { return APL.t(s, vars); }

    /* ---------- the tree ---------- */
    // Launcher preferences that only mean something on Samsung (Smart Hub rows, APL Overlay, Vetro, updates)
    var SAMSUNG_PREFS = { homeReturn: 1, pauseKey: 1, alexaBridge: 1, idleClose: 1, bootCleanup: 1, autoUpdate: 1, hubShelf: 1 };
    // Rows of the Samsung screen's own settings (settings-tree.js), until LG's equivalents below replace them
    var SAMSUNG_TYPES = { service: 1, game: 1, tv: 1, tvmode: 1, native: 1 };

    // On a rooted TV the launcher's service reads and sets these through LG's own settings (webos-system.js)
    var ROOT_ROWS = { "tv:backlight": 1, "tv:contrast": 1, "tv:sharpness": 1, "tv:color": 1, "tvmode:": 1 };
    function samsungOnly(item) {
        // Free Up Memory and Close Unused Apps: the launcher's service does them on a rooted TV
        var rootedHere = P.rooted && ((item.type === "action" && item.label === t("Free Up Memory")) || (item.type === "toggle" && item.key === "idleClose"));
        if (rootedHere) return false;
        if (item.vetro === true) return true;
        if (SAMSUNG_TYPES[item.type] && !(P.rooted && ROOT_ROWS[item.type + ":" + (item.id || "")])) return true;
        if ((item.type === "toggle" || item.type === "choice") && SAMSUNG_PREFS[item.key]) return true;
        if (item.type === "hide" && item.id === "apl.samsunghome") return true;
        if (item.type === "action" && item.label === t("Go Back to the Installed Version")) return true;   // Check for Update stays: it says how to update (updater.js)
        // Samsung's own resets (its picture and sound service)
        if (item.type === "action" && (item.label === t("Reset Picture") || item.label === t("Reset Equalizer"))) return true;
        if (item.type === "info" && item.label === "HDR" && sys.hdr() === "—") return true;
        // The sound output in use: the Sound Output row below opens the list, with the one in use ticked
        if (item.type === "info" && item.label === t("Digital Output Audio Format")) return true;
        if (item.type === "info" && item.label === t("Storage")) return true;
        return false;
    }

    /* A few rows say what they do on LG */
    function relabel(item) {
        if (item.type === "samsung") {
            item.label = t("TV Settings");
            item.desc = t("LG's own settings, for what the launcher doesn't change itself: Wi-Fi, time, language, LG account, parental controls, Game Optimizer, reset.");
        } else if (item.type === "info" && item.label === t("Tizen Version")) {
            item.label = t("webOS Version");
        } else if (item.type === "info" && item.label === t("Link to Vetro")) {
            item.label = "LG Connect Apps";
            item.desc = t("How the launcher lists your apps, reads the volume and turns the TV off: the TV asked once whether to allow it. Refused by mistake? TV Settings › General › Devices › External Devices, then start the launcher again.");
        } else if (item.type === "action" && item.label === t("Control Center")) {
            item.desc = t("Also opens with the red button or ⏯ on the remote, on the Home Screen.");
        } else if (item.type === "toggle" && item.key === "liveShelf") {
            item.desc = t("Trending films, series and videos on each service, top albums, games, sports. Films and series need a TMDB key, videos a YouTube key (see Online Services).");
        } else if (item.type === "choice" && item.key === "language") {
            item.desc = t("Automatic follows the TV's language. The launcher restarts to apply it.");
        } else if (item.type === "tv" && item.id === "backlight" && P.oled) {
            item.label = t("OLED Pixel Brightness");
            item.desc = t("How bright the OLED panel is. ◀ ▶ to adjust, live.");
        } else if (item.type === "tvmode") {
            item.desc = t("The TV's own modes: Filmmaker Mode, Cinema, Standard, Vivid… Changes right away. Each mode keeps its own settings.");
        } else if (item.type === "toggle" && item.key === "idleClose") {
            item.desc = t("An app left in the background for more than 10 minutes closes on its own, and one the TV opened by itself (LG Channels) after 1 minute: the TV keeps its memory and the launcher stays smooth. Never the app in front, live TV, the inputs, AirPlay, or an app playing sound or video.");
        } else if (item.type === "action" && item.label === t("Free Up Memory")) {
            item.desc = t("Closes the apps left open behind the launcher (Netflix, Disney+, LG Channels…). They reopen normally, but start over from the beginning. The app in front, the inputs and AirPlay stay.");
        }
        return item;
    }
    function tvRow(id, label, desc) { return { type: "tv", id: id, label: label, desc: desc }; }

    function adapt(node) {
        if (!node.children) return node;
        var kids = [];
        node.children.forEach(function (c) {
            if (samsungOnly(c)) return;
            // Samsung Services: Samsung's own processes, nothing of it on LG
            if (c.type === "menu" && (c.children || []).some(function (k) { return k.type === "service"; })) return;
            if (c.type === "menu") {
                adapt(c);
                if (!c.children.length) return;                 // a menu left empty (Gaming, Power, HDMI…)
            }
            kids.push(relabel(c));
        });
        node.children = kids;
        if (P.extraRows) P.extraRows(node);
        return node;
    }

    /* LG's own rows. The TV doesn't let an app read or change its picture settings without root (LG
       Connect Apps answers "Application error", luna "Access denied"): the Picture menu opens LG's own,
       the sound mode is read. Developer Mode's time left goes in About This Screen. */
    var SOUND_MODES = { aiSoundPlus: "AI Sound Pro", aiSound: "AI Sound", standard: "Standard", cinema: "Cinema", clearVoice: "Clear Voice",
                        sports: "Sports", music: "Music", game: "Game Optimizer" };
    var soundMode = null;
    function readSoundMode() {
        return P.ssap("ssap://settings/getSystemSettings", { category: "sound", keys: ["soundMode"] }, 8000).then(function (m) {
            var v = m.settings && m.settings.soundMode;
            soundMode = v ? (SOUND_MODES[v] ? t(SOUND_MODES[v]) : v) : null;
            return soundMode || t("Unavailable");
        }, function () { return t("Unavailable"); });
    }
    P.extraRows = function (node) {
        if (node.label === t("Picture") && P.rooted) {
            var after = 0;
            node.children.forEach(function (c, i) { if (c.type === "tv" && c.id === "contrast") after = i + 1; });
            if (after) node.children.splice(after, 0, tvRow("brightness", t("Brightness"), t("The black level: brightens or darkens the dark areas. ◀ ▶ to adjust, live.")));
            node.children.push({ type: "action", label: t("Picture Settings on the TV"), icon: "display",
                run: function () { sys.openTvSettings(); },
                desc: t("Everything else (AI Picture, Eye Comfort Mode, Dynamic Tone Mapping…): in LG's own settings.") });
        } else if (node.label === t("Picture")) {
            node.children.unshift({ type: "action", label: t("Picture Settings on the TV"), icon: "display",
                run: function () { sys.openTvSettings(); },
                desc: t("Picture mode, OLED Pixel Brightness, contrast, colour: in LG's own settings. Without root, the TV keeps them for its own menus.") });
        } else if (node.label === t("Expert Settings") && P.rooted) {
            node.children.unshift(tvRow("tint", t("Tint (G/R)"), t("◀ ▶ to adjust, live.")),
                                  tvRow("colorTemperature", t("Color Temperature"), t("Cool leans blue, warm leans red. ◀ ▶ to adjust, live.")));
        } else if (node.label === t("Sound")) {
            var at = 0;
            node.children.forEach(function (c, i) { if (c.type === "mute") at = i + 1; });
            node.children.splice(at, 0, { type: "info", label: t("Sound Mode"), get: readSoundMode,
                desc: t("Chosen in the TV's own settings (Sound › Sound Mode).") });
        } else if (node.label === t("General & Privacy") && P.rooted && P.home && P.home.installed) {
            var at24 = 0;
            node.children.forEach(function (c, i) { if (c.type === "toggle" && c.key === "clock24") at24 = i + 1; });
            node.children.splice(at24, 0, { type: "choice", label: t("Start on APL Launcher"), key: "lgHomeApl",
                options: [[true, t("On")], [false, t("Off")]],
                desc: t("The Home button opens APL Launcher, and the TV starts on it. Off: LG's own Home, right away and at each start. The screen goes black a few seconds when it changes."),
                apply: function (v) { P.setHome(v); } });
        } else if (node.label === t("Appearance")) {
            node.children.push({ type: "choice", label: t("Interface Resolution"), key: "webosRes",
                options: [["1920x1080", t("1080p (Smooth)")], ["3840x2160", t("4K (Sharp)")]],
                desc: t("4K: sharper text and glass, less smooth (the TV spends about 10 ms of each frame on the picture alone). The launcher rebuilds itself in the other one and opens again by itself, in about half a minute. Needs a rooted TV; otherwise run APL Launcher Setup again with Interface in 4K on or off."),
                apply: function (v) { P.setResolution(v); } });
        } else if (node.label === t("About This Screen") && P.rooted) {
            node.children.push({ type: "info", label: t("Root Access"), get: function () { return t("On (Homebrew Channel)"); },
                                 desc: t("The launcher's helper runs as root: picture settings, the apps left open, Free Up Memory. Given by webos/root/install.sh, again at each start.") });
        } else if (node.label === t("About This Screen")) {
            node.children.push({ type: "info", label: t("Developer Mode"), get: function () { return P.devmode ? P.devmode() : "—"; },
                                 desc: t("LG deletes the apps installed in Developer Mode when its 1000 hours run out, this launcher included. The launcher renews them on its own, once a day, as the Developer Mode app's Extend button does.") });
        }
    };

    var build = APL.settingsTree;
    if (build) APL.settingsTree = function () { return adapt(build()); };

    /* ---------- Control Center ---------- */
    P.ccHint = t("Tip: the red button or ⏯ opens Control Center on the Home Screen");
    /* The slider: the brightness as on Samsung on a rooted TV, the volume otherwise (controlcenter.js keeps this object) */
    P.ccSlider = {};
    P.onRoot(function (on) {
        P.ccSlider.id = on ? "backlight" : "volume";
        P.ccSlider.icon = on ? "sun" : "speaker";
        P.ccSlider.title = on ? t("Brightness") : t("Volume");
    });
    /* The sound outputs the TV offers (LG Connect Apps): the one in use is ticked. */
    var OUTPUT_LIST = ["tv_speaker", "external_arc", "external_optical", "bt_soundbar", "headphone", "lineout", "tv_speaker_headphone"];
    P.ccOutputName = function () { return sys.audio.outputMode(); };
    P.ccAudioItems = function (redraw) {
        var cur = sys.audio.output ? sys.audio.output() : "";
        var out = [{ cls: "head", title: t("Audio") }, { cls: "section", title: t("Sound Output") }];
        OUTPUT_LIST.forEach(function (o) {
            out.push({ cls: "row", icon: o === "tv_speaker" ? "display" : o === "headphone" ? "headphones" : o === "bt_soundbar" ? "bluetooth" : "speaker",
                       title: sys.audio.outputName(o),
                       check: function () { return (sys.audio.output ? sys.audio.output() : "") === o; },
                       select: function () {
                           P.ssap("ssap://audio/changeSoundOutput", { output: o }, 8000).then(function () {
                               setTimeout(function () { P.lunaOnce("luna://com.webos.audio/getSoundOutput", {}).then(function (m) {
                                   if (m.soundOutput && sys.audio.setOutput) sys.audio.setOutput(m.soundOutput);
                                   redraw();
                               }, redraw); }, 600);
                           }, function (e) { APL.toast(e.message); });
                       } });
        });
        out.push({ cls: "section", title: t("Bluetooth") });
        out.push({ cls: "row", icon: "bluetooth", title: t("Pair AirPods or Headphones…"),
                   sub: function () { return t("In the TV's settings: Sound › Sound Out › Bluetooth"); },
                   select: function () { sys.openTvSettings(); } });
        if (cur && OUTPUT_LIST.indexOf(cur) === -1) out.splice(2, 0, { cls: "row", icon: "speaker", title: sys.audio.outputName(cur), check: function () { return true; } });
        return out;
    };
    P.ccAirplayItems = function () {
        return [
            { cls: "head", title: t("AirPlay and iPhone") },
            { cls: "section", title: t("From iPhone") },
            { cls: "row", icon: "split", title: t("Mirror the Screen"),
              sub: function () { return t("Control Center › Screen Mirroring › this screen"); } },
            { cls: "row", icon: "airplay", title: t("Send a Video or Photos"),
              sub: function () { return t("AirPlay button in the app, then choose this screen"); } },
            { cls: "row", icon: "remote", title: t("iPhone as a Remote"),
              sub: function () { return t("Home app: add the screen, then Control Center › Remote"); } },
            { cls: "section", title: t("On the Screen") },
            { cls: "row", icon: "gear", title: t("AirPlay and HomeKit Settings"),
              sub: function () { return t("Screen name, passcode, HomeKit"); },
              select: function () { P.launch("com.webos.app.airplay").catch(function () { sys.openTvSettings(); }); } }
        ];
    };
})(window);
