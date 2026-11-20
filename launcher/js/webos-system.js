/* ============================================================
   webos-system.js — APL.sys on LG TVs (webOS).

   system.js builds APL.sys for Samsung (Tizen's APIs, Vetro), then hands
   it here (APL.platform.adaptSys) on an LG TV: what this TV can do takes
   the place of each part, the rest (preferences, profiles, sounds) stays.

     sound       luna com.webos.audio (mute, up/down, the level), and the
                 exact level through LG Connect Apps (ssap://audio/…)
     network     luna com.palm.connectionmanager
     the TV      the model and webOS version (luna, the page's deviceInfo)
     inputs      the HDMI / Live TV apps (com.webos.app.hdmi1…)
     off, timer  LG Connect Apps (ssap://system/turnOff), the timer kept by
                 the launcher's service while the launcher is in the background
     picture     on a rooted TV, LG's settings service through the launcher's
                 service (webos/root/ elevates it); otherwise LG's own menus
     open apps   on a rooted TV, the app manager: the apps running, closing one
   Vetro's shell (sys.exec on Samsung) doesn't exist here: it says so.
   ============================================================ */
(function (global) {
    "use strict";

    var APL = global.APL = global.APL || {};
    var P = APL.platform;
    if (!P || P.name !== "webos") return;

    function t(s, vars) { return APL.t ? APL.t(s, vars) : s; }
    function noRoot() { return Promise.reject(new Error(t("This needs a rooted TV on LG"))); }

    /* ---------- root ----------
       On a TV rooted with the Homebrew Channel, webos/root/ gives the launcher's service root: it then relays
       a few of LG's own calls (its picture settings, the apps running). Known from the last start at once,
       then from the service. */
    var ROOT_KEY = "apl.webos.root", rootFns = [];
    P.rooted = (function () { try { return global.localStorage.getItem(ROOT_KEY) === "1"; } catch (e) { return false; } })();
    P.onRoot = function (fn) { rootFns.push(fn); fn(P.rooted); };
    /* Just after an update of the launcher, its service starts without root, and apl-keep-root.sh (webos/root)
       gives it back within seconds, with your keys and fonts put back into the package: the page looks again
       for a few minutes, and reloads once when root comes back, so it has them all. */
    var rootTries = 0, startedRooted = null;
    function readRoot() {
        P.service("status", {}).then(function (m) {
            var r = !!m.root;
            try { global.localStorage.setItem(ROOT_KEY, r ? "1" : "0"); } catch (e) {}
            if (startedRooted === null) startedRooted = r;
            if (r) readHome();
            if (!r && ++rootTries < 12) setTimeout(readRoot, 15000);
            if (r && !startedRooted && !APL.ccOverlay) {
                var again = false;
                try { again = global.sessionStorage.getItem("apl.webos.rootReload") !== "1"; global.sessionStorage.setItem("apl.webos.rootReload", "1"); } catch (e) {}
                if (again) { setTimeout(function () { global.location.reload(); }, 500); return; }
            }
            if (r === P.rooted) return;
            P.rooted = r;
            rootFns.forEach(function (fn) { try { fn(r); } catch (e) {} });
        }, function () { if (++rootTries < 12) setTimeout(readRoot, 15000); });
    }
    readRoot();
    document.addEventListener("visibilitychange", function () {
        if (!document.hidden && !P.rooted && rootTries >= 12) { rootTries = 0; readRoot(); }
    });
    /* Home: APL Launcher or LG's own (webos/root/bin/apl-home.sh), Settings › General & Privacy */
    P.home = null;
    function readHome() {
        P.service("home", {}).then(function (m) {
            P.home = m;
            if (P.sys && m.installed) P.sys.setPref("lgHomeApl", !!m.replaced);
        }, function () {});
    }
    P.setHome = function (apl) {
        return P.service("home", { apl: !!apl }).then(function () {
            if (APL.toast) APL.toast(apl ? t("APL Launcher opens with Home in a few seconds") : t("LG's Home comes back in a few seconds"), true);
        }, function (e) { if (APL.toast) APL.toast(e.message); });
    };
    function rootLuna(uri, payload, ms) {
        if (!P.rooted) return noRoot();
        return P.lunaOnce("luna://com.knikt.apllauncher.service/luna", { uri: uri, payload: payload || {} }, ms || 15000)
            .then(function (m) { return m.payload || {}; });
    }
    var SETTINGS = "luna://com.webos.settingsservice/", APPMGR = "luna://com.webos.applicationManager/";

    /* ---------- sound ---------- */
    var snd = { volume: 0, mute: false, output: "" };
    function readVolume(m) {
        if (!m) return;
        var st = m.volumeStatus || m;
        if (typeof st.volume === "number") snd.volume = st.volume;
        if (typeof st.muteStatus === "boolean") snd.mute = st.muteStatus;
        else if (typeof m.muted === "boolean") snd.mute = m.muted;
        else if (typeof m.mute === "boolean") snd.mute = m.mute;
        if (st.soundOutput) snd.output = st.soundOutput;
    }
    P.lunaOnce("luna://com.webos.audio/getVolume", {}).then(readVolume, function () {});
    P.lunaOnce("luna://com.webos.audio/getSoundOutput", {}).then(function (m) { if (m.soundOutput) snd.output = m.soundOutput; }, function () {});
    // The exact level as it changes (any remote, any app), once LG Connect Apps is allowed
    P.ssapSub("ssap://audio/getVolume", { subscribe: true }, readVolume);
    var OUTPUTS = {
        tv_speaker: "TV Speaker", external_speaker: "Audio Out", external_optical: "Optical Out", external_arc: "HDMI ARC",
        lineout: "Line Out", headphone: "Headphones", tv_external_speaker: "TV Speaker + Audio Out",
        tv_speaker_headphone: "TV Speaker + Headphones", bt_soundbar: "Bluetooth", soundbar: "Soundbar"
    };
    function outputName(o) { return OUTPUTS[o] ? t(OUTPUTS[o]) : (o || "—"); }

    var volTimer = null;
    var audio = {
        getVolume: function () { return snd.volume; },
        setVolume: function (v) {
            v = Math.max(0, Math.min(100, Math.round(v)));
            var from = snd.volume;
            snd.volume = v;
            clearTimeout(volTimer);
            volTimer = setTimeout(function () {
                P.ssap("ssap://audio/setVolume", { volume: v }, 8000).catch(function () {
                    // Not allowed yet: the steps the TV lets any app take
                    var n = Math.min(30, Math.abs(v - from)), up = v > from;
                    (function step() {
                        if (n-- <= 0) return;
                        P.lunaOnce("luna://com.webos.audio/" + (up ? "volumeUp" : "volumeDown"), {}).then(step, function () {});
                    })();
                });
            }, 120);
            return v;
        },
        isMute: function () { return snd.mute; },
        setMute: function (m) {
            snd.mute = !!m;
            P.lunaOnce("luna://com.webos.audio/setMuted", { muted: !!m }).catch(function () {
                return P.ssap("ssap://audio/setMute", { mute: !!m });
            }).catch(function (e) { if (APL.toast) APL.toast(e.message); });
        },
        outputMode: function () { return outputName(snd.output); },
        output: function () { return snd.output; },
        setOutput: function (o) { snd.output = o; },
        outputName: outputName
    };

    /* ---------- network ---------- */
    var net = { connected: false, type: t("Unknown"), ssid: "—", signal: 0, ip: "—", mac: "—", gateway: "—", dns: "—" };
    function readNet(m) {
        if (!m || m.returnValue === false) return;
        var w = m.wired || {}, f = m.wifi || {};
        var on = w.state === "connected" ? w : f.state === "connected" ? f : null;
        net.connected = !!on;
        net.type = w.state === "connected" ? "Ethernet" : f.state === "connected" ? "Wi-Fi" : t("Disconnected");
        net.ssid = f.state === "connected" ? (f.ssid || "—") : "—";
        net.ip = on && on.ipAddress || "—";
        net.gateway = on && on.gateway || "—";
        net.dns = on && (on.dns1 || on.dns2) || "—";
        if (f.state === "connected" && typeof f.signalLevel === "number") net.signal = Math.max(0, Math.min(5, Math.round(f.signalLevel)));
    }
    P.luna("luna://com.palm.connectionmanager/getStatus", { subscribe: true }, readNet);
    P.lunaOnce("luna://com.palm.connectionmanager/getinfo", {}).then(function (m) {
        var mac = (m.wiredInfo && m.wiredInfo.macAddress) || (m.wifiInfo && m.wifiInfo.macAddress);
        if (mac) net.mac = String(mac).toUpperCase();
    }, function () {});
    function network() { return net; }

    /* ---------- the TV ---------- */
    var info = { model: P.model || "—", name: "LG " + (P.model || "TV"), firmware: "—", tizen: "—" };
    P.lunaOnce("luna://com.webos.service.tv.systemproperty/getSystemInfo", { keys: ["modelName", "firmwareVersion", "sdkVersion"] }).then(function (m) {
        if (m.firmwareVersion) info.firmware = m.firmwareVersion;
        if (m.modelName && info.model === "—") info.model = String(m.modelName).replace(/\..*$/, "");
        if (m.sdkVersion && info.tizen === "—") info.tizen = m.sdkVersion;
    }, function () {});
    P.lunaOnce("luna://com.webos.service.systemservice/osInfo/query", { parameters: ["webos_release", "webos_name", "webos_imagename"] }).then(function (m) {
        if (m.webos_release) info.tizen = m.webos_release + (info.tizen !== "—" && info.tizen !== m.webos_release ? " (SDK " + info.tizen + ")" : "");
    }, function () {});
    /* LG's names: OLED55G56LS is an OLED G5, 55 inches */
    (function () {
        var m = /^OLED(\d{2})([A-Z])(\d)/.exec(info.model);
        if (m) info.name = "LG OLED " + m[2] + m[3] + " " + m[1] + "″";
        else if (/^\d{2}[A-Z]{2}\d/.test(info.model)) info.name = "LG " + info.model.slice(2, 6) + " " + info.model.slice(0, 2) + "″";
    })();
    function product() { return info; }

    var dev = P.device || {};
    /* The panel (deviceInfo: 3840 x 2160 on a G5) and the interface, which LG draws in 1920 x 1080 */
    function display() {
        var ui = (global.innerWidth || 1920) + " × " + (global.innerHeight || 1080);
        var panel = dev.screenWidth ? dev.screenWidth + " × " + dev.screenHeight : "";
        return Promise.resolve(panel && panel !== ui ? t("{panel} (interface {ui})", { panel: panel, ui: ui }) : ui);
    }
    /* LG's OLEDs all show Dolby Vision, HDR10 and HLG; the TV tells nothing of it to an app */
    function hdr() {
        var kinds = [];
        if (dev.dolbyVision) kinds.push("Dolby Vision");
        if (dev.hdr10) kinds.push("HDR10");
        if (!kinds.length && P.oled) kinds = ["Dolby Vision", "HDR10", "HLG"];
        return kinds.length ? kinds.join(", ") : "—";
    }

    /* ---------- the remote, off, inputs ---------- */
    var BUTTONS = { KEY_HOME: "HOME", KEY_RETURN: "BACK", KEY_EXIT: "EXIT", KEY_MENU: "MENU", KEY_INFO: "INFO", KEY_SOURCE: "INPUT_HUB" };
    function remoteKey(key) {
        if (key === "KEY_POWER") return sleepNow();
        return P.button(BUTTONS[key] || String(key).replace(/^KEY_/, ""));
    }
    function sleepNow() {
        return P.ssap("ssap://system/turnOff", {}, 8000).then(function () {});
    }
    /* Samsung's numbers, as sources.js gives them: TV 0, HDMI 1 to 4 = 13 to 16. On LG each input is an app. */
    function switchSource(type) {
        var id = type === 0 ? "com.webos.app.livetv" : type >= 13 && type <= 16 ? "com.webos.app.hdmi" + (type - 12) : "";
        if (!id) return Promise.reject(new Error(t("This input isn't supported on this screen")));
        return P.launch(id);
    }
    /* The TV's inputs, for Sources: its HDMI ports, named as in LG's input list when renamed there */
    P.readPorts = function () {
        return P.ssap("ssap://tv/getExternalInputList", {}, 10000).then(function (p) {
            var ports = (p.devices || []).filter(function (d) { return /^HDMI_\d$/.test(d.id || ""); }).map(function (d) {
                return { type: "HDMI", number: d.port || parseInt(String(d.id).slice(5), 10), label: d.modified && d.label ? String(d.label) : "" };
            });
            if (!ports.length) return null;
            ports.unshift({ type: "TV", number: 1 });
            return ports;
        }, function () { return null; });
    };

    /* LG's own Settings, for what the launcher doesn't do itself */
    function openSettings() { return P.launch("com.palm.app.settings").catch(function () { return P.button("MENU"); }); }

    /* ---------- sleep timer: counted by the service, the launcher being in the background then ---------- */
    function armSleepTimer(sys, minutes) {
        var at = minutes ? Date.now() + minutes * 60000 : 0;
        sys.setPref("sleepTimer", minutes);
        sys.setPref("sleepAt", at);
        P.service("sleep", { minutes: minutes }).catch(function (e) { if (APL.toast) APL.toast(e.message); });
    }
    function readSleepTimer(sys) {
        return P.service("status", {}).then(function (m) {
            var at = m.sleepAt && m.sleepAt > Date.now() ? m.sleepAt : 0;
            sys.setPref("sleepAt", at);
            if (!at) sys.setPref("sleepTimer", 0);
        }, function () {});
    }

    /* ---------- Developer Mode ----------
       When its 1000 hours run out, the TV deletes every app installed through it, this one included. The
       launcher's service renews it the way the Developer Mode app's Extend button does: checked once a day
       while the launcher runs, renewed once fewer than 960 hours are left. */
    var DEV_KEY = "apl.webos.devmode", devm = (function () { try { return JSON.parse(global.localStorage.getItem(DEV_KEY) || "null") || {}; } catch (e) { return {}; } })();
    function devCheck() {
        if (P.rooted) return;                            // rooting removes Developer Mode and its 1000 hours
        if (devm.at && Date.now() - devm.at < 20 * 3600 * 1000) return;
        P.service("devmode", { extend: true }).then(function (m) {
            devm = { at: Date.now(), hours: m.hours, renewed: m.extended ? Date.now() : devm.renewed || 0 };
            try { global.localStorage.setItem(DEV_KEY, JSON.stringify(devm)); } catch (e) {}
        }, function (e) { devm.error = e.message; });
    }
    if (!APL.ccOverlay) {                   // the launcher does it, not the Control Center over the apps
        setTimeout(devCheck, 8000);
        setInterval(devCheck, 3600 * 1000);
    }
    P.devmode = function () {
        if (devm.hours === undefined) return devm.error ? t("Unavailable") : "…";
        var left = Math.max(0, devm.hours - Math.floor((Date.now() - (devm.at || Date.now())) / 3600000));
        return t("{h} h left, renewed by the launcher", { h: left });
    };

    /* ---------- the picture, on a rooted TV ----------
       LG's settings service, as LG's own menus: values are strings ("14"), each picture mode keeps its own,
       and the ranges and the modes on offer come from the TV (getSystemSettingDesc). On an OLED, backlight
       is OLED Pixel Brightness. */
    var PIC_KEYS = ["backlight", "contrast", "brightness", "sharpness", "color", "tint", "colorTemperature"];
    var PIC_RANGE = { backlight: [0, 100], contrast: [0, 100], brightness: [0, 100], sharpness: [0, 50], color: [0, 100],
                      tint: [-50, 50], colorTemperature: [-50, 50] };
    var MODE_NAMES = { vivid: "Vivid", normal: "Standard", standard: "Standard", eco: "Eco", cinema: "Cinema", cinemaBright: "Cinema Home",
                       sports: "Sports", game: "Game Optimizer", filmMaker: "Filmmaker Mode", expert1: "ISF Expert (Bright Room)",
                       expert2: "ISF Expert (Dark Room)", personalized: "Personalized Picture" };
    /* HDR and Dolby Vision have their own modes (hdrStandard, dolbyHdrCinema…): the same names */
    function modeName(v) {
        var k = String(v || "").replace(/^(dolbyHdr|hdr)(.)/, function (m, p, c) { return c.toLowerCase(); });
        return MODE_NAMES[k] ? t(MODE_NAMES[k]) : String(v || "—");
    }
    var picModes = [];                                // [value, name], in LG's order (settings.js lists them)
    var picCache = null, picAt = 0, picPending = null;
    function tvSettings(force) {
        if (!P.rooted) return Promise.resolve([]);
        if (!force && picCache && Date.now() - picAt < 8000) return Promise.resolve(picCache);
        if (picPending) return picPending;
        var keys = PIC_KEYS.concat(["pictureMode"]);
        picPending = Promise.all([
            rootLuna(SETTINGS + "getSystemSettings", { category: "picture", keys: keys }),
            rootLuna(SETTINGS + "getSystemSettingDesc", { category: "picture", keys: keys }).catch(function () { return {}; })
        ]).then(function (res) {
            var s = res[0].settings || {}, desc = {};
            (res[1].results || []).forEach(function (d) { if (d && d.key) desc[d.key] = d; });
            var items = [];
            PIC_KEYS.forEach(function (k) {
                /* A value never set in this mode comes back as the number 0, not a string: the TV's real one
                   depends on the country (hasCountryVar). Left out: showing 0 and writing 1 from it would
                   all but black the screen (Cinema on a G5). */
                if (typeof s[k] !== "string") return;
                var v = parseInt(s[k], 10);
                if (isNaN(v)) return;
                var d = desc[k], r = d && d.values && d.values.range;
                items.push({ id: k, writable: !(d && d.ui && d.ui.active === false), value: v,
                             min: r ? r.min : PIC_RANGE[k][0], max: r ? r.max : PIC_RANGE[k][1] });
            });
            if (s.pictureMode) {
                var list = (desc.pictureMode && desc.pictureMode.values && desc.pictureMode.values.arrayExt) || [];
                picModes.length = 0;
                list.forEach(function (m) { if (m.visible && m.active) picModes.push([m.value, modeName(m.value)]); });
                if (!picModes.some(function (m) { return m[0] === s.pictureMode; })) picModes.unshift([s.pictureMode, modeName(s.pictureMode)]);
                items.push({ id: "pictureMode", writable: true, value: s.pictureMode, coded: true });
            }
            picCache = items; picAt = Date.now(); picPending = null;
            return items;
        }, function (e) { picPending = null; throw e; });
        return picPending;
    }
    /* Writes a value and reads it back: the value read back is what counts */
    function picWrite(it, want) {
        var set = {};
        set[it.id] = String(want);
        return rootLuna(SETTINGS + "setSystemSettings", { category: "picture", settings: set }).then(function (r) {
            if (r.returnValue === false) throw new Error(t("The screen refused this setting for now"));
            return rootLuna(SETTINGS + "getSystemSettings", { category: "picture", keys: [it.id] });
        }).then(function (r) {
            var back = r.settings && r.settings[it.id];
            if (back === undefined) throw new Error(t("The screen did not respond"));
            it.value = it.coded ? String(back) : parseInt(back, 10);
            if (String(it.value) !== String(want)) throw new Error(t("The screen refused this setting for now"));
            return it.value;
        });
    }
    function picItem(id) {
        return tvSettings().then(function (items) {
            for (var i = 0; i < items.length; i++) if (items[i].id === id) return items[i];
            return null;
        });
    }
    /* ◀ ▶: the value shown changes at once, the write goes out 350 ms after the last press, one at a time */
    var picTimers = {}, picWriting = {};
    function picAdjust(id, delta, onChange) {
        return picItem(id).then(function (it) {
            if (!it || !it.writable || it.coded) throw new Error(t("Setting unavailable for now"));
            if (it.target === undefined) it.target = it.value;
            it.target = Math.max(it.min, Math.min(it.max, it.target + delta));
            if (onChange) onChange(it.target, it);
            clearTimeout(picTimers[id]);
            picTimers[id] = setTimeout(function flush() {
                if (picWriting[id]) { picTimers[id] = setTimeout(flush, 150); return; }
                if (it.target === it.value) return;
                picWriting[id] = true;
                picWrite(it, it.target).then(function () { picWriting[id] = false; }, function (e) {
                    picWriting[id] = false;
                    it.target = it.value;
                    picCache = null;
                    if (onChange) onChange(it.value, it);
                    if (APL.toast) APL.toast(e.message);
                });
            }, 350);
            return it.target;
        });
    }
    function setPictureMode(v) {
        return picItem("pictureMode").then(function (it) {
            if (!it) throw new Error(t("Picture Mode unavailable"));
            return picWrite(it, v).then(function (back) { picCache = null; return back; });
        });
    }

    /* ---------- the apps running, on a rooted TV ---------- */
    /* Never closed: the app in front, LG's home and system interface, the inputs, AirPlay */
    var NEVER_CLOSE = /^(airplay|com\.knikt\.apllauncher|com\.webos\.app\.(home|livetv|hdmi\d*|starfish.*|.*systemui.*))$/;
    function runningApps() {
        if (!P.rooted) return Promise.resolve([]);
        return rootLuna(APPMGR + "running", {}).then(function (r) {
            return (r.running || []).map(function (a) { return String(a.id || ""); }).filter(Boolean);
        });
    }
    function closeApps(ids) {
        if (!P.rooted) return noRoot();
        return rootLuna(APPMGR + "getForegroundAppInfo", {}).then(function (r) { return r.appId || ""; }, function () { return ""; }).then(function (front) {
            var list = (ids || []).filter(function (id) { return id && id !== front && !NEVER_CLOSE.test(id); });
            return list.reduce(function (p, id) {
                return p.then(function () { return rootLuna(APPMGR + "closeByAppId", { id: id }).catch(function () {}); });
            }, Promise.resolve()).then(function () { return list; });
        });
    }
    function memoryLeft() {
        return P.service("memory", {}).then(function (m) { return m.kb || 0; });
    }

    /* ---------- how the launcher reaches the TV (Settings › About, in place of "Link to Vetro") ---------- */
    function link() {
        var s = P.state();
        var text = { registered: t("Allowed"), prompt: t("Waiting for you to allow it on the TV"), refused: t("Refused on the TV"),
                     connecting: t("Connecting…"), error: t("Unavailable"), idle: t("Not connected") }[s] || s;
        return Promise.resolve(text);
    }

    P.adaptSys = function (sys, internals) {
        var D = internals && internals.DEFAULTS;
        if (D) {
            if (P.oled) D.screensaverClockMove = 2;      // as on Samsung's OLEDs: the clock goes round the corners
            // Samsung-only parts: no Smart Hub rows, no Vetro, no APL Overlay, no updates from GitHub yet
            D.hubShelf = false; D.homeReturn = false; D.alexaBridge = false; D.bootCleanup = false; D.autoUpdate = false;
            D.idleClose = true;                       // done by the launcher's service on a rooted TV (webos/service, "idle")
            D.lgHomeApl = true;                       // read from the TV at each start (readHome)
        }
        // Close Unused Apps: the launcher's service closes them (rooted TV); this setting turns it on or off there
        P.onRoot(function (on) { if (on) P.service("idle", { on: sys.pref("idleClose") !== false }).catch(function () {}); });
        sys.onPref("idleClose", function (v) { if (P.rooted) P.service("idle", { on: !!v }).catch(function () {}); });
        sys.platform = "webos";
        sys.audio = audio;
        sys.network = network;
        sys.product = product;
        sys.display = display;
        sys.storage = function () { return Promise.resolve("—"); };
        sys.hdr = hdr;
        sys.remoteKey = remoteKey;
        sys.openSamsungSettings = openSettings;
        sys.openTvSettings = openSettings;
        sys.sleepNow = sleepNow;
        sys.switchSource = switchSource;
        sys.runningApps = runningApps;
        sys.closeApps = closeApps;
        sys.memoryLeft = memoryLeft;
        /* APL TV's Top Shelf (widgets.js), handed over by the launcher's service */
        sys.appShelf = function () { return P.service("shelf", {}).then(function (m) { return m.shelf; }); };
        sys.registerKeys = function () {};
        sys.armSleepTimer = function (m) { armSleepTimer(sys, m); };
        sys.readSleepTimer = function () { return readSleepTimer(sys); };
        sys.vetroAlive = function () { return Promise.resolve(false); };
        sys.vetroLink = link;
        sys.vetroGet = noRoot; sys.vetroPost = noRoot; sys.exec = noRoot;
        sys.noVetro = function () { return false; };         // the rows that need Vetro are not shown here (webos-settings.js)
        sys.isOled = function () { return !!P.oled; };
        /* The picture: LG keeps it from apps (LG Connect Apps "Application error", luna "Access denied"), not
           from a rooted TV's service. Without root the Control Center's slider is the volume (P.ccSlider). */
        function volumeItem() { return { id: "volume", writable: true, value: snd.volume, min: 0, max: 100 }; }
        sys.tvSettings = tvSettings;
        sys.tvItem = function (id) { return id === "volume" ? Promise.resolve(volumeItem()) : picItem(id); };
        sys.tvValue = function (id) {
            if (id === "volume") return Promise.resolve(snd.volume);
            return picItem(id).then(function (it) { return it ? (it.target !== undefined ? it.target : it.value) : null; });
        };
        sys.tvAdjust = function (id, delta, onChange) {
            if (id !== "volume") return picAdjust(id, delta, onChange);
            var v = audio.setVolume(snd.volume + delta);
            if (onChange) onChange(v, volumeItem());
            return Promise.resolve(v);
        };
        sys.PICTURE_MODES = picModes;
        sys.pictureModeName = modeName;
        sys.setPictureMode = setPictureMode;
        sys.game = {
            get: function () { return Promise.resolve({ available: false, on: false }); },
            set: function () { return Promise.reject(new Error(t("Game Optimizer is in the TV's own settings"))); },
            applyOnInput: function () { return Promise.resolve(); }
        };
        P.sys = sys;
        if (P.home && P.home.installed) sys.setPref("lgHomeApl", !!P.home.replaced);
        if (D) D.webosRes = resNow();                   // shown when nothing was chosen: what is installed
        keepResolution(sys);
    };

    /* ---------- the page's resolution ----------
       LG takes an app's resolution only when it is installed (appinfo.json). The launcher comes in 1920 x 1080
       (smooth); Settings › Appearance › Interface Resolution has the launcher's service rebuild the installed
       package in 3840 x 2160 or back (rooted TV, webos/service "resolution"). */
    function resNow() { return (global.innerWidth || 1920) > 2500 ? "3840x2160" : "1920x1080"; }
    P.setResolution = function (want) {
        var sys = P.sys, now = resNow();
        if (!sys) return;
        sys.setPref("webosRes", now);                   // what is on screen, until the switch is under way
        if (want === now) return;
        if (!P.rooted) {
            APL.alert({ title: t("Interface Resolution"),
                message: t("Without root, the TV takes another resolution only with a new install: run APL Launcher Setup again, with Interface in 4K on or off."),
                buttons: [{ label: t("OK") }] });
            return;
        }
        APL.alert({ title: want === "3840x2160" ? t("Switch to 4K?") : t("Switch to 1080p?"),
            message: t("The launcher rebuilds itself and opens again by itself, in about half a minute. Your settings, keys and apps stay."),
            focus: 1,
            buttons: [{ label: t("Cancel") }, { label: t("Switch"), run: function () {
                P.service("resolution", { set: want }).then(function () {
                    sys.setPref("webosRes", want);          // kept: it comes back after an update (keepResolution)
                    APL.toast(t("Rebuilding the launcher…"), true);
                }, function (e) { APL.toast((e && e.message) || t("The TV refused")); });
            } }] });
    };
    /* The Homebrew Channel installs the package as it is published (1080p): a resolution chosen here comes back
       on its own after an update, once per version, on a rooted TV */
    function keepResolution(sys) {
        var want = null, now = resNow(), ver = (global.APL_BUILD && global.APL_BUILD.version) || "", key = "apl.webos.resTried";
        try { want = (JSON.parse(global.localStorage.getItem("apl.prefs") || "{}") || {}).webosRes || null; } catch (e) {}
        if (!want || want === now || APL.ccOverlay) return;
        try { if (global.localStorage.getItem(key) === ver + ":" + want) return; } catch (e) {}
        var asked = false;
        P.onRoot(function (on) {
            if (!on || asked) return;
            asked = true;
            setTimeout(function () {
                if (document.hidden) { asked = false; return; }
                P.service("resolution", { set: want }).then(function (m) {
                    if (m && (m.rebuilding || m.unchanged)) try { global.localStorage.setItem(key, ver + ":" + want); } catch (e) {}
                    if (m && m.rebuilding) APL.toast(t("Rebuilding the launcher…"), true);
                }, function () { asked = false; });
            }, 20000);
        });
    }
})(window);
