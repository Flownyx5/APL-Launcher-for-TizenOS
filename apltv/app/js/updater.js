/* ============================================================
   updater.js: APL TV's automatic updates, from GitHub (the same system as
   APL Launcher).

   On the screen, 30 s after start-up and then every 6 hours: reads
   app/version.json in APL TV's GitHub repository. If the version is
   newer, downloads the code, the styles and the page (a few hundred KB),
   keeps them on the screen (boot.js runs them from then on), then
   restarts APL TV as soon as nothing is playing or open (otherwise at
   the next start). Your playlists and settings are not touched.

   Each TV reads its own part of version.json ("platforms": tizen, webos,
   android). An update that changes a TV's own installed part (Samsung:
   permissions in config.xml, the helper service; LG: its package; Android:
   the app) cannot be done this way: a message then asks, just once, to run
   APL Launcher Setup again (Samsung) or to install the new .ipk / .apk.
   An update can also be held for one TV ("off").
   ============================================================ */
(function (global) {
    "use strict";

    var TV = global.TV, T = TV.t, U = global.TV_UPDATE;
    if (!U) return;

    var busy = false;
    function raw() { return global.TV_UPDATE_RAW || U.RAW; }      // a test build may point elsewhere (dev.local.js)

    function getText(url) {
        return global.fetch(url + (url.indexOf("?") > -1 ? "&" : "?") + "t=" + Date.now(), { cache: "no-store" })
            .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.text(); });
    }
    function save(bundle) {
        var text = JSON.stringify(bundle);
        try { global.localStorage.setItem(U.KEY, text); return; } catch (e) {}
        // Not enough room: the old downloaded version goes first, then once more
        try { global.localStorage.removeItem(U.KEY); global.localStorage.setItem(U.KEY, text); }
        catch (e2) { throw new Error(T("not enough space on the screen")); }
    }

    /* manual: asked from Settings (messages shown) */
    function check(manual) {
        if (busy) return Promise.resolve();
        if (TV.PREVIEW) { if (manual) TV.toast(T("Updates happen on the screen.")); return Promise.resolve(); }
        busy = true;
        if (manual) TV.toast(T("Checking for an update…"));
        return getText(raw() + "version.json").then(function (txt) {
            var v = JSON.parse(txt);
            if (!v || !v.version || U.cmp(v.version, U.running) <= 0) {
                if (manual) TV.toast(T("APL TV is up to date (version {v})", { v: U.running }));
                return;
            }
            // This TV's own part of the update: Samsung, LG and Android each have their own installed
            // part, so their own minimum version, and an update can be held for one of them
            var mine = (v.platforms && v.platforms[TV.PLATFORM]) || {};
            if (mine.off) {
                TV.log("update " + v.version + " is not out for " + TV.PLATFORM + " yet");
                if (manual) TV.toast(T("APL TV is up to date (version {v})", { v: U.running }));
                return;
            }
            var reinstall = mine.reinstall || (v.platforms ? null : v.reinstall);
            var loader = mine.loader || v.loader || 1;
            if (mine.notes) v.notes = mine.notes;
            // A version that failed to start is not downloaded again and again
            var prev = null;
            try { prev = JSON.parse(global.localStorage.getItem(U.KEY) || "null"); } catch (e) {}
            if (prev && prev.bad && prev.version === v.version && !manual) return;
            if (loader > U.LOADER || (reinstall && U.cmp(reinstall, U.installed) > 0)) {
                if (manual || TV.pref("updateNotified") !== v.version) {
                    TV.setPref("updateNotified", v.version);
                    TV.toast(TV.WEBOS ? T("APL TV {v} is out: install its new .ipk once", { v: v.version })
                           : TV.ANDROID ? T("APL TV {v} is out: install its new .apk once", { v: v.version })
                                      : T("APL TV {v} is out: install it once with APL Launcher Setup on the PC", { v: v.version }));
                }
                return;
            }
            var paths = (v.scripts || []).concat(v.styles || []).filter(function (p) { return !/\.local\./.test(p) && /^(js|css)\/[\w.-]+\.(js|css)$/.test(p); });
            var files = {};
            return Promise.all(paths.map(function (p) { return getText(raw() + p).then(function (t) { files[p] = t; }); })).then(function () {
                save({ version: v.version, loader: loader, scripts: v.scripts, styles: v.styles, body: v.body || null, files: files, at: Date.now() });
                TV.log("update " + v.version + " downloaded");
                TV.toast(v.notes ? T("APL TV {v} is ready: {notes}", { v: v.version, notes: v.notes }) : T("APL TV {v} is ready", { v: v.version }));
                restartWhenIdle();
            });
        }).catch(function (e) {
            TV.log("update check failed: " + (e && e.message));
            if (manual) TV.toast(T("Update failed: {error}. Try again later.", { error: (e && e.message) || T("no network") }));
        }).then(function () { busy = false; });
    }

    /* Restarts on the Home page with nothing open, or while APL TV is in the background */
    function restartWhenIdle() {
        setTimeout(function wait() {
            var hidden = document.hidden;
            var idle = TV.shell && TV.shell.current() === "home" && TV.topNav && TV.topNav() === TV.shell.screen &&
                       !TV.osd.isOpen() && !TV.detail.isOpen() && !(TV.multiview && TV.multiview.isOpen());
            if (!hidden && !idle) { setTimeout(wait, 20000); return; }
            global.location.reload();
        }, 4000);
    }

    /* Back to the version installed by APL Launcher Setup (or by hand) */
    function reset() {
        try { global.localStorage.removeItem(U.KEY); } catch (e) {}
        TV.toast(T("Going back to the installed version…"));
        setTimeout(function () { global.location.reload(); }, 1200);
    }

    function auto() { if (TV.pref("autoUpdate")) check(false); }
    setTimeout(auto, 30000);
    setInterval(auto, 6 * 3600 * 1000);

    TV.updater = { check: check, reset: reset, running: function () { return U.running; },
                   installed: function () { return U.installed; }, fromBundle: function () { return U.fromBundle; } };
})(window);
