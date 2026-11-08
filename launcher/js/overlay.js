/* ============================================================
   overlay.js — the link with APL Overlay (overlay/ folder), the native app
   that shows Control Center on top of a video.

   The Home, Pause, Samsung TV Plus and Prime Video keys go to the overlay
   (Vetro rules): see overlay/Program.cs. The launcher
   starts it hidden so that it responds right away, and passes it the theme,
   the "Return to the Launcher" setting and the delay for closing background apps.

   With no overlay installed, the Home key must stay with the launcher and the others
   with Samsung: the Vetro rules are put back at start-up, so that no key is lost, and an
   alert says what was changed.
   ============================================================ */
(function (global) {
    "use strict";

    var APL = global.APL, sys = APL.sys;
    /* APL Overlay is apl.launcher.overlay when APL Launcher Setup installs it (a package of its own), and
       APLauncher.Overlay inside the hybrid package for Apps2Samsung. The one installed is used; if both
       are, the one in this package. */
    var OVERLAY_IDS = ["APLauncher.Overlay", "apl.launcher.overlay"];
    var OVERLAY = OVERLAY_IDS[1], LAUNCHER = "APLauncher.Home", HOME_RULE = "physical_63";
    var installed = false, light = false;

    /* The apps the Echo can open: "Name=app:id", Home Screen first (the first ones
       are used the most). No ";" or "=" in a name, and few enough apps to stay readable
       in the Alexa app. */
    var ALEXA_APPS = 16;
    var IDLE_MINUTES = 10;          // an app in the background for this long is closed
    function alexaList() {
        return ((APL.allApps && APL.allApps()) || []).filter(function (a) {
            return !a.folder && a.id !== "apl.settings" && a.id !== "apl.sources";
        }).slice(0, ALEXA_APPS).map(function (a) {
            return String(a.name).replace(/[;=]/g, " ") + "=app:" + a.id;
        }).join(";");
    }

    /* The Home Screen apps, which the overlay closes when they stay in the background (overlay/IdleApps.cs):
       never a service. A virtual tile counts as the app it opens (TizenTube: TizenBrew). */
    function homeApps() {
        return ((APL.allApps && APL.allApps()) || []).map(function (a) {
            return a.folder ? "" : a.virtual ? (a.needs || "") : a.id;
        }).filter(function (id) { return /^[A-Za-z0-9_.-]+$/.test(id); }).join(";");
    }

    /* Without APL Overlay (it is built for Tizen 9): the launcher's bridge closes the apps left in the
       background instead (bridge/service.js, idleCheck). Music apps are left alone: they play behind. */
    var MUSIC = /^(spotify|deezer|applemusic|amazonmusic|qobuz|tidal|youtubemusic)$/;
    var checked = false;                // APL Overlay looked for (start): before that, nothing is sent
    function sendBridgeIdle() {
        if (sys.PREVIEW || installed || !checked) return;
        var apps = (APL.allApps && APL.allApps()) || [];
        var keep = apps.filter(function (a) { return !a.virtual && (a.music || (a.key && MUSIC.test(a.key))); }).map(function (a) { return a.id; });
        var cfg = { minutes: sys.pref("idleClose") ? IDLE_MINUTES : 0, apps: homeApps().split(";"), keep: keep,
                    homeReturn: !!sys.pref("homeReturn") };
        sys.bridgeSend([{ key: "idle", value: JSON.stringify(cfg) }]).catch(function () {});
    }

    function send() {
        if (!installed) { sendBridgeIdle(); return; }
        if (sys.PREVIEW) return;
        try {
            var T = global.tizen;
            var data = [new T.ApplicationControlData("apl_action", ["stay"]),
                        new T.ApplicationControlData("apl_theme", [light ? "light" : "dark"]),
                        new T.ApplicationControlData("apl_return", [sys.pref("homeReturn") ? "1" : "0"]),
                        new T.ApplicationControlData("apl_pause", [sys.pref("pauseKey") === "playpause" ? "playpause" : "controlcenter"]),
                        new T.ApplicationControlData("apl_alexa_on", [sys.pref("alexaBridge") ? "1" : "0"]),
                        new T.ApplicationControlData("apl_alexa", [alexaList()]),
                        new T.ApplicationControlData("apl_idle", [sys.pref("idleClose") ? String(IDLE_MINUTES) : "0"]),
                        new T.ApplicationControlData("apl_apps", [homeApps()]),
                        new T.ApplicationControlData("apl_lang", [APL.lang || "en"])];
            var ctl = new T.ApplicationControl("http://tizen.org/appcontrol/operation/default", null, null, null, data);
            T.application.launchAppControl(ctl, OVERLAY, function () {}, function () {});
        } catch (e) {}
    }

    /* The Smart Hub tile: the overlay opens Samsung's home and leaves it on screen until something
       else comes in front (overlay/Program.cs, apl_action samsung_home). */
    function openSamsungHome() {
        if (!installed || sys.PREVIEW) return;
        try {
            var T = global.tizen;
            var ctl = new T.ApplicationControl("http://tizen.org/appcontrol/operation/default", null, null, null,
                                               [new T.ApplicationControlData("apl_action", ["samsung_home"])]);
            T.application.launchAppControl(ctl, OVERLAY, function () {}, function () {});
        } catch (e) {}
    }

    /* Keys handed to the overlay while it is not there: Home goes back to the launcher, the others to
       Samsung. Only the rules that launch the overlay change (the ones APL Launcher Setup made), and
       the person at the screen is told what changed: nothing happens behind their back. */
    var KEY_NAMES = { "63": "Home", "244": "⏯", "560": "Samsung TV Plus", "221": "Prime Video" };
    function keyName(rule) {
        var code = rule.trigger && String(rule.trigger.value);
        return KEY_NAMES[code] || APL.t("key {code}", { code: code });
    }
    function checkHomeRule() {
        sys.vetroGet("/remap").then(function (r) {
            var rules = (r && r.rules) || [], changed = false, home = false, freed = [];
            rules = rules.filter(function (rule) {
                var mine = (rule.actions || []).filter(function (a) { return a.type === "launch" && OVERLAY_IDS.indexOf(a.appId) !== -1; });
                if (!mine.length) return true;
                changed = true;
                mine.forEach(function (a) { a.appId = LAUNCHER; });
                if (rule.id === HOME_RULE) { home = true; return true; }
                freed.push(keyName(rule));
                return false;
            });
            if (!changed) return;
            sys.vetroPost("/remap", { rules: rules }).then(function () { tellRepaired(home, freed); }).catch(function () {});
        }, function () {});
    }
    function tellRepaired(home, freed) {
        if (!APL.alert) return;
        var keys = freed.join(", "), many = freed.length > 1, message;
        if (home && freed.length) message = many
            ? APL.t("Home now opens APL Launcher, and {keys} are back to Samsung. Run APL Launcher Setup again to get the overlay back.", { keys: keys })
            : APL.t("Home now opens APL Launcher, and {keys} is back to Samsung. Run APL Launcher Setup again to get the overlay back.", { keys: keys });
        else if (home) message = APL.t("Home now opens APL Launcher. Run APL Launcher Setup again to get the overlay back.");
        else message = many
            ? APL.t("{keys} are back to Samsung. Run APL Launcher Setup again to get the overlay back.", { keys: keys })
            : APL.t("{keys} is back to Samsung. Run APL Launcher Setup again to get the overlay back.", { keys: keys });
        APL.alert({ title: APL.t("APL Overlay is not installed"), message: message, buttons: [{ label: APL.t("OK") }] });
    }

    /* Settings › Remote and Devices › Set Up the Remote Buttons: the Vetro rules APL Launcher Setup makes,
       from the screen itself. Installed from a phone with Apps2Samsung, there is no Setup, and Vetro's own
       Remapper does not list APL Overlay (an app without an icon). Home and ⏯ go to the overlay (Home to the
       launcher without it); Samsung TV Plus and Prime Video too, as Setup does, when AquaPlay and TizenBrew
       are installed and no rule uses those buttons yet. Other rules stay as they are. Then: is Vetro
       intercepting the remote at all? That switch needs the remote to be picked, so it stays in Vetro. */
    var EXTRA_KEYS = [["560", "AquaPlay02.AquaPlay"], ["221", "xvvl3S1bvH.TizenBrewStandalone"]];
    var REMAP_FILE = "/opt/usr/home/owner/share/vetro-remap.json";     // where Vetro keeps its rules and the remote it intercepts
    function setUpButtons() {
        if (sys.PREVIEW) return Promise.resolve({ preview: true });
        var target = installed ? OVERLAY : LAUNCHER;
        return Promise.all([sys.vetroGet("/remap"), APL.isInstalled(EXTRA_KEYS[0][1]), APL.isInstalled(EXTRA_KEYS[1][1])]).then(function (got) {
            var rules = (got[0] && got[0].rules) || [], changed = [], ids = {};
            rules.forEach(function (r) { ids[r.id] = true; });
            function ruleFor(code) {
                for (var i = 0; i < rules.length; i++) {
                    var t = rules[i].trigger;
                    if (t && t.type === "physical" && String(t.value) === code) return rules[i];
                }
                return null;
            }
            function point(code, always) {
                var rule = ruleFor(code), launch = [{ type: "launch", appId: target }];
                if (rule) {
                    var a = rule.actions || [];
                    if (!always || (rule.enabled !== false && a.length === 1 && a[0].type === "launch" && a[0].appId === target)) return;
                    rule.enabled = true;
                    rule.actions = launch;
                } else {
                    var id = "physical_" + code;
                    if (ids[id]) id += "_apl";
                    rules.push({ id: id, enabled: true, trigger: { type: "physical", value: code }, actions: launch });
                }
                changed.push(code);
            }
            point("63", true);
            if (installed) {
                point("244", true);
                if (got[1]) point(EXTRA_KEYS[0][0], false);
                if (got[2]) point(EXTRA_KEYS[1][0], false);
            }
            var saved = changed.length ? sys.vetroPost("/remap", { rules: rules }).then(function (r) {
                if (!r || r.sent || !r.ok) throw new Error(APL.t("Vetro did not save the buttons"));
            }) : Promise.resolve();
            return saved.then(function () {
                return sys.exec("cat " + REMAP_FILE).then(function (r) {
                    var store = {};
                    try { store = JSON.parse(r.output || "{}"); } catch (e) {}
                    return !!(store.input && store.input.enabled === true && store.input.device);
                }, function () { return null; });
            }).then(function (intercepting) {
                return { changed: changed, target: target, intercepting: intercepting };
            });
        });
    }
    function setUpButtonsNow() {
        APL.toast(APL.t("Setting up the buttons in Vetro…"), true);
        setUpButtons().then(function (r) {
            if (r.preview) { APL.toast(APL.t("Preview: the buttons are set on the screen"), true); return; }
            var done = r.target === LAUNCHER ? APL.t("Home opens APL Launcher.")
                : APL.t("Home and ⏯ open APL Overlay: hold Home for the Control Center, press it twice for the open apps.");
            var lines = [r.changed.length ? done : APL.t("The buttons were already set up.") + " " + done];
            if (r.intercepting === false) {
                var ip = (sys.network().ip || "").replace(/^—$/, "");
                lines.push(APL.t("One step left, in Vetro: on a phone or a computer, open {url}, then Remapper. Choose your remote (Smart Control when it is paired over Bluetooth, rc device by infrared) and turn on Remote interception.",
                    { url: "http://" + (ip || APL.t("the screen's address")) + ":" + sys.vetroPort() }));
            }
            APL.alert({ title: APL.t("Remote Buttons"), message: lines.join("\n\n"), buttons: [{ label: APL.t("OK") }] });
        }, function (e) {
            APL.alert({ title: APL.t("Remote Buttons"), message: (e && e.message) || APL.t("Vetro is not responding"), buttons: [{ label: APL.t("OK") }] });
        });
    }

    function start() {
        if (sys.PREVIEW) return;
        Promise.all(OVERLAY_IDS.map(function (id) { return APL.isInstalled(id); })).then(function (found) {
            var i = found.indexOf(true);
            installed = i !== -1;
            checked = true;
            if (installed) OVERLAY = OVERLAY_IDS[i];
            if (installed) send(); else { checkHomeRule(); sendBridgeIdle(); }
        });
    }

    sys.onPref("homeReturn", send);
    sys.onPref("alexaBridge", send);
    sys.onPref("idleClose", send);
    sys.onPref("pauseKey", send);

    // The Home Screen's list changes (an app installed, hidden…): the bridge gets it again, every 10 minutes at most
    setInterval(function () { if (!installed && !document.hidden) sendBridgeIdle(); }, 10 * 60000);

    APL.overlay = {
        start: start,
        setTheme: function (isLight) {
            if (isLight === light) return;
            light = isLight;
            send();
        },
        refresh: send,
        openSamsungHome: openSamsungHome,
        setUpButtons: setUpButtonsNow,
        isInstalled: function () { return installed; }
    };
})(window);
