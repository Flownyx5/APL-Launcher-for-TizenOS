/* ============================================================
   updater.js — automatic launcher updates, from GitHub.

   On the screen, 30 s after start-up and then every 6 h: reads
   launcher/version.json on GitHub. If the version is newer, downloads
   the code, the styles and the catalog (a few hundred KB), keeps them
   on the screen, then restarts the launcher as soon as the Home Screen
   is showing (otherwise at the next launch). New images are read
   directly from GitHub. Nothing to do on the PC.

   An update that changes the app's permissions (config.xml) or the
   loader cannot be done this way: a message then asks to run
   APL Launcher Setup again, just once.
   ============================================================ */
(function (global) {
    "use strict";

    var APL = global.APL, sys = APL.sys, U = global.APL_UPDATE;
    if (!U) return;

    var busy = false;

    function getText(url) {
        return global.fetch(url + (url.indexOf("?") > -1 ? "&" : "?") + "t=" + Date.now(), { cache: "no-store" })
            .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.text(); });
    }

    function save(bundle) {
        var text = JSON.stringify(bundle);
        try { global.localStorage.setItem("apl.bundle", text); return; } catch (e) {}
        // Not enough space: clear the caches (Top Shelf, artwork) then try again
        try {
            var del = [];
            for (var i = 0; i < global.localStorage.length; i++) {
                var k = global.localStorage.key(i);
                if (/^apl\.(live|art)\./.test(k)) del.push(k);
            }
            del.forEach(function (k) { global.localStorage.removeItem(k); });
            global.localStorage.removeItem("apl.bundle");
            global.localStorage.setItem("apl.bundle", text);
        } catch (e2) { throw new Error(APL.t("not enough space on the screen")); }
    }

    /* manual: true when requested from Settings (visible messages) */
    function check(manual) {
        if (busy) return Promise.resolve();
        if (sys.PREVIEW) { if (manual) APL.toast(APL.t("Preview: updates happen on the screen")); return Promise.resolve(); }
        // Another TV system (LG): GitHub's version is Samsung's until that system's own files are published
        // with it, and its loader would not run a downloaded version anyway (boot.js)
        if (APL.platform && !APL.platform.updates) {
            if (APL.platform.updateNotice) return notice(manual);
            if (manual) APL.toast(APL.t("On this TV, updates come as a new package"));
            return Promise.resolve();
        }
        busy = true;
        if (manual) APL.toast(APL.t("Checking for an update…"), true);
        return getText(U.RAW + "version.json").then(function (txt) {
            var v = JSON.parse(txt);
            if (U.cmp(v.version, U.running) <= 0) {
                if (manual) APL.toast(APL.t("The launcher is up to date (version {v})", { v: U.running }));
                return;
            }
            // A version that failed to start is not downloaded again over and over
            var prev = null;
            try { prev = JSON.parse(global.localStorage.getItem("apl.bundle") || "null"); } catch (e) {}
            if (prev && prev.bad && prev.version === v.version && !manual) return;
            if ((v.loader || 1) > U.LOADER || (v.reinstall && U.cmp(v.reinstall, U.installed) > 0)) {
                if (manual || sys.pref("updateNotified") !== v.version) {
                    sys.setPref("updateNotified", v.version);
                    APL.toast(APL.t("Version {v} available: run APL Launcher Setup again on the PC (just once)", { v: v.version }));
                }
                return;
            }
            var paths = (v.scripts || []).concat(v.styles || []).filter(function (p) { return !/\.local\./.test(p); });
            var files = {};
            return Promise.all(paths.map(function (p) {
                return getText(U.RAW + p).then(function (t) { files[p] = t; });
            })).then(function () {
                save({ version: v.version, loader: v.loader || 1, scripts: v.scripts, styles: v.styles,
                       body: v.body || null, files: files, at: Date.now() });
                APL.toast(APL.t("Update {v} installed — {notes}", { v: v.version, notes: v.notes || APL.t("new launcher features") }));
                restartWhenIdle();
            });
        }).catch(function (e) {
            if (!manual) return;
            if (/HTTP 404/.test(e.message)) APL.toast(APL.t("Update failed: the launcher's GitHub repository is private (it must be public)."));
            else APL.toast(APL.t("Update failed: {error}. Try again later.", { error: e.message || APL.t("no network") }));
        }).then(function () { busy = false; });
    }

    /* Restarts only on the Home Screen, with nothing open, after a few seconds. */
    function restartWhenIdle() {
        setTimeout(function wait() {
            var open = (APL.settings && APL.settings.isOpen()) || (APL.controlCenter && APL.controlCenter.isOpen()) ||
                       (APL.contextMenu && APL.contextMenu.isOpen()) || (APL.sources && APL.sources.isOpen()) || (APL.search && APL.search.isOpen()) || (APL.screensaver && APL.screensaver.isActive()) ||
                       document.hidden;
            if (open) { setTimeout(wait, 20000); return; }
            global.location.reload();
        }, 4000);
    }

    /* Go back to the version installed by APL Launcher Setup */
    function reset() {
        try { global.localStorage.removeItem("apl.bundle"); } catch (e) {}
        APL.toast(APL.t("Going back to the installed version…"));
        setTimeout(function () { global.location.reload(); }, 1200);
    }

    /* Another TV system (LG, Android TV): the launcher can't update itself there, so it says when a new
       version is out and how to get it (APL.platform.updateNotice: the Homebrew Channel, APL Launcher Setup,
       the Downloader app). Once per version, on the Home Screen with nothing open; Check for Update asks now. */
    function notice(manual) {
        busy = true;
        if (manual) APL.toast(APL.t("Checking for an update…"), true);
        return getText(U.RAW + "version.json").then(function (txt) {
            var v = JSON.parse(txt);
            if (U.cmp(v.version, U.installed) <= 0) {
                if (manual) APL.toast(APL.t("The launcher is up to date (version {v})", { v: U.installed }));
                return;
            }
            if (!manual && sys.pref("updateNotified") === v.version) return;
            whenIdle(function () {
                sys.setPref("updateNotified", v.version);
                APL.platform.updateNotice(v);
            }, manual);
        }).catch(function (e) {
            if (manual) APL.toast(APL.t("Update failed: {error}. Try again later.", { error: e.message || APL.t("no network") }));
        }).then(function () { busy = false; });
    }
    function idle() {
        return !((APL.settings && APL.settings.isOpen()) || (APL.controlCenter && APL.controlCenter.isOpen()) ||
                 (APL.contextMenu && APL.contextMenu.isOpen()) || (APL.alert && APL.alert.isOpen && APL.alert.isOpen()) ||
                 (APL.sources && APL.sources.isOpen()) || (APL.search && APL.search.isOpen()) ||
                 (APL.screensaver && APL.screensaver.isActive && APL.screensaver.isActive()) || document.hidden);
    }
    function whenIdle(fn, now) {
        if (now || idle()) { fn(); return; }
        setTimeout(function () { whenIdle(fn, false); }, 20000);
    }

    function auto() {
        if (APL.platform && !APL.platform.updates) { if (APL.platform.updateNotice) check(false); return; }
        if (sys.pref("autoUpdate")) check(false);
    }
    if (!APL.ccOverlay) {                   // not from the Control Center over the apps (LG, webos.js)
        setTimeout(auto, 30000);
        setInterval(auto, 6 * 3600 * 1000);
    }

    APL.updater = { check: check, reset: reset, running: function () { return U.running; },
                    installed: function () { return U.installed; }, fromBundle: function () { return U.fromBundle; } };
})(window);
