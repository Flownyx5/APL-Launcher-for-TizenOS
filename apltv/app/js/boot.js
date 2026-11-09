/* ============================================================
   boot.js: APL TV's start-up and automatic updates (the same system as
   APL Launcher).

   APL TV updates itself ON ITS OWN: updater.js downloads the newest
   version of the app's code, styles and page from GitHub and keeps it on
   the screen. At start-up, this file runs:
     - the downloaded version if it is newer than the installed one,
     - otherwise the installed version (the one in the .wgt).
   Safety: if the downloaded version fails or shows nothing within 20 s,
   it is set aside and the installed version starts again right away.

   This file, config.xml and the helper service never change through an
   automatic update: a version that needs them asks once for APL Launcher
   Setup (version.json: "loader", "reinstall").
   ============================================================ */
(function (global) {
    "use strict";

    var LOADER = 1;
    var REPO = "Flownyx5/APL-Launcher-for-TizenOS";      // fork: APL TV lives in apltv/ of the launcher's fork
    var BRANCH = "main";
    var BUILD = global.TV_BUILD || { version: "0", scripts: [], styles: [] };
    var RAW = "https://raw.githubusercontent.com/" + REPO + "/" + BRANCH + "/apltv/app/";
    var KEY = "apltv.bundle";

    function cmp(a, b) {
        a = String(a || "0").split("."); b = String(b || "0").split(".");
        for (var i = 0; i < Math.max(a.length, b.length); i++) {
            var x = parseInt(a[i] || 0, 10), y = parseInt(b[i] || 0, 10);
            if (x !== y) return x > y ? 1 : -1;
        }
        return 0;
    }
    function readBundle() {
        try { return JSON.parse(global.localStorage.getItem(KEY) || "null"); } catch (e) { return null; }
    }
    function markBad(b) {
        try { b.bad = true; global.localStorage.setItem(KEY, JSON.stringify(b)); }
        catch (e) { try { global.localStorage.removeItem(KEY); } catch (x) {} }
    }

    // Updates only on the screen, Samsung, LG or Android (the PC preview always runs the local files)
    var onTv = !!(global.tizen || global.PalmSystem || global.PalmServiceBridge || global.webOSSystem || global.APLAndroid);
    var bundle = onTv ? readBundle() : null;
    var useBundle = !!(bundle && !bundle.bad && bundle.files && (bundle.loader || 1) <= LOADER &&
                       cmp(bundle.version, BUILD.version) > 0);

    global.TV_UPDATE = {
        LOADER: LOADER, REPO: REPO, BRANCH: BRANCH, RAW: RAW, KEY: KEY, cmp: cmp,
        installed: BUILD.version,
        running: useBundle ? bundle.version : BUILD.version,
        fromBundle: useBundle
    };

    var failed = false;
    function fallBack(why) {
        if (failed || !useBundle) return;
        failed = true;
        markBad(bundle);
        try { console.error("APL TV: version " + bundle.version + " set aside (" + why + "), back to the installed version"); } catch (e) {}
        global.location.reload();
    }

    if (useBundle) {
        // An error while the downloaded version starts, or nothing on screen: the installed version
        global.addEventListener("error", function () { if (!global.TV_BOOT_OK) fallBack("error"); });
        setTimeout(function () { if (!global.TV_BOOT_OK) fallBack("nothing displayed"); }, 20000);
        // The new version's page and styles
        if (bundle.body) {
            var tail = document.getElementById("tv-boot");
            var holder = document.createElement("div");
            holder.innerHTML = bundle.body;
            while (document.body.firstChild && document.body.firstChild !== tail) document.body.removeChild(document.body.firstChild);
            while (holder.firstChild) document.body.insertBefore(holder.firstChild, tail);
        }
        var links = document.querySelectorAll("link[data-app-css]");
        (bundle.styles || []).forEach(function (path) {
            if (bundle.files[path] === undefined) return;
            for (var k = 0; k < links.length; k++) if (links[k].getAttribute("href") === path) links[k].disabled = true;
            var st = document.createElement("style");
            st.textContent = bundle.files[path];
            document.head.appendChild(st);
        });
    }

    /* Scripts in order: the update's (kept text) or the screen's files. */
    var list = useBundle ? bundle.scripts : BUILD.scripts;
    var i = 0;
    (function next() {
        if (i >= list.length) return;
        var path = list[i++], s = document.createElement("script");
        if (useBundle && bundle.files[path] !== undefined) {
            s.text = bundle.files[path] + "\n//# sourceURL=" + path;
            document.body.appendChild(s);
            next();
        } else {
            s.src = path;
            s.onload = s.onerror = next;
            document.body.appendChild(s);
        }
    })();
})(window);
