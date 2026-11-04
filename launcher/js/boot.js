/* ============================================================
   boot.js — launcher start-up and automatic updates.

   The launcher installed on the screen can update itself ON ITS OWN:
   updater.js downloads the latest version from GitHub (code, styles,
   catalog) and keeps it on the screen. At start-up, this file runs:
     - the downloaded version if it is newer than the installed one,
     - otherwise the installed version (the one from the .wgt).
   Safety: if the downloaded version crashes or does not show within
   15 seconds, it is set aside and the installed version starts again
   right away. New images are read from GitHub, the others
   from the screen.

   This file never changes through an automatic update: a version
   that needs a new loader (LOADER) is installed with APL Launcher Setup.
   ============================================================ */
(function (global) {
    "use strict";

    var LOADER = 2;                      // 2: updates come from Flownyx5/APL-Launcher-for-TizenOS
    var REPO = "Flownyx5/APL-Launcher-for-TizenOS";   // your copy (fork): updates come from there
    var BRANCH = "main";
    var BUILD = global.APL_BUILD || { version: "0", scripts: [], images: [] };
    var RAW = "https://raw.githubusercontent.com/" + REPO + "/" + BRANCH + "/launcher/";

    function cmp(a, b) {
        a = String(a || "0").split("."); b = String(b || "0").split(".");
        for (var i = 0; i < Math.max(a.length, b.length); i++) {
            var x = parseInt(a[i] || 0, 10), y = parseInt(b[i] || 0, 10);
            if (x !== y) return x > y ? 1 : -1;
        }
        return 0;
    }

    function readBundle() {
        try { return JSON.parse(global.localStorage.getItem("apl.bundle") || "null"); } catch (e) { return null; }
    }
    function markBad(b) {
        try {
            b.bad = true;
            global.localStorage.setItem("apl.bundle", JSON.stringify(b));
        } catch (e) {
            try { global.localStorage.removeItem("apl.bundle"); } catch (x) {}
        }
    }

    // Updates only on the screen (the PC preview always runs the local version)
    var onTv = !!global.tizen || !!global.APL_TEST_BUNDLE;
    var bundle = onTv ? readBundle() : null;
    var useBundle = !!(bundle && !bundle.bad && bundle.files && (bundle.loader || 1) <= LOADER &&
                       cmp(bundle.version, BUILD.version) > 0);

    var packaged = {};
    (BUILD.images || []).forEach(function (p) { packaged[p] = true; });

    /* Path of an image: the screen's copy if it is there, otherwise GitHub's. */
    global.APL_ASSET = function (p) {
        if (!p || !useBundle || /^(https?:|data:|blob:|file:|\/)/.test(p) || packaged[p]) return p;
        return RAW + p;
    };
    global.APL_UPDATE = {
        LOADER: LOADER, REPO: REPO, BRANCH: BRANCH, RAW: RAW, cmp: cmp,
        installed: BUILD.version,
        running: useBundle ? bundle.version : BUILD.version,
        fromBundle: useBundle
    };

    var failed = false;
    function fallBack(why) {
        if (failed || !useBundle) return;
        failed = true;
        markBad(bundle);
        try { console.error("APL: version " + bundle.version + " set aside (" + why + "), back to the installed version"); } catch (e) {}
        global.location.reload();
    }

    if (useBundle) {
        // An error while the downloaded version starts => installed version.
        global.addEventListener("error", function () { if (!global.APL_BOOT_OK) fallBack("error"); });
        setTimeout(function () { if (!global.APL_BOOT_OK) fallBack("nothing displayed"); }, 15000);
        // Styles and page of the new version
        if (bundle.body) document.body.innerHTML = bundle.body;
        var link = document.getElementById("apl-css");
        (bundle.styles || []).forEach(function (path) {
            if (bundle.files[path] === undefined) return;
            if (link) link.disabled = true;
            var st = document.createElement("style");
            st.textContent = bundle.files[path];
            document.head.appendChild(st);
        });
    }

    /* Scripts in order: the update's (stored text) or the screen's. */
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
