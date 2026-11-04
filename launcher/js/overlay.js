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

    function send() {
        if (!installed || sys.PREVIEW) return;
        try {
            var T = global.tizen;
            var data = [new T.ApplicationControlData("apl_action", ["stay"]),
                        new T.ApplicationControlData("apl_theme", [light ? "light" : "dark"]),
                        new T.ApplicationControlData("apl_return", [sys.pref("homeReturn") ? "1" : "0"]),
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

    function start() {
        if (sys.PREVIEW) return;
        Promise.all(OVERLAY_IDS.map(function (id) { return APL.isInstalled(id); })).then(function (found) {
            var i = found.indexOf(true);
            installed = i !== -1;
            if (installed) OVERLAY = OVERLAY_IDS[i];
            if (installed) send(); else checkHomeRule();
        });
    }

    sys.onPref("homeReturn", send);
    sys.onPref("alexaBridge", send);
    sys.onPref("idleClose", send);

    APL.overlay = {
        start: start,
        setTheme: function (isLight) {
            if (isLight === light) return;
            light = isLight;
            send();
        },
        refresh: send,
        openSamsungHome: openSamsungHome,
        isInstalled: function () { return installed; }
    };
})(window);
