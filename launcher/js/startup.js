/* ============================================================
   startup.js — start with the screen, every time.

   Two background services must start on their own when the screen
   starts: Vetro's (vetrotvapp.svc: the Home key, root) and the
   launcher's bridge (APLauncher.Bridge: opens the launcher after a
   full start, brings it back after sleep, wakes Vetro up).
   Some installers record them without "start at boot" (and Vetro's
   without "restart"): after a full start nothing comes back until
   Vetro is opened by hand. Vetro repairs its own flags only once
   opened, from version 0.3.2.
   Here, once Vetro answers: the two services' flags are read in the
   screen's app database and turned on if they are off, exactly as
   Vetro does it for itself (sqlite3 on /opt/dbspace/.pkgmgr_parser.db,
   as root). Takes effect at the next start of the screen. The values
   found first are kept in apl.bootFlagsBefore.
   ============================================================ */
(function (global) {
    "use strict";

    var APL = global.APL, sys = APL.sys;
    var DB = "/opt/dbspace/.pkgmgr_parser.db";
    var WANT = { "APLauncher.Bridge": ["onboot"], "vetrotvapp.svc": ["onboot", "autorestart"] };
    var FIELD = { onboot: "app_onboot", autorestart: "app_autorestart" };
    var state = null;               // { apps: { id: { onboot, autorestart } }, fixed: [..], error }

    function read() {
        var ids = Object.keys(WANT).map(function (id) { return "'" + id + "'"; }).join(",");
        return sys.exec("sqlite3 -readonly " + DB + " \"SELECT app_id, app_onboot, app_autorestart FROM package_app_info WHERE app_id IN (" + ids + ");\" 2>&1")
            .then(function (r) {
                var apps = {};
                String((r && r.output) || "").split("\n").forEach(function (line) {
                    var c = line.trim().split("|");
                    if (c.length === 3 && WANT[c[0]]) apps[c[0]] = { onboot: c[1] === "true", autorestart: c[2] === "true" };
                });
                return apps;
            });
    }

    function fix(apps) {
        var cmds = [], fixed = [];
        Object.keys(WANT).forEach(function (id) {
            if (!apps[id]) return;                                  // not installed (or another name): left alone
            WANT[id].forEach(function (flag) {
                if (apps[id][flag]) return;
                cmds.push("sqlite3 -bail " + DB + " \"BEGIN IMMEDIATE; UPDATE package_app_info SET " + FIELD[flag] + "='true' WHERE app_id='" + id + "'; COMMIT;\"");
                fixed.push(id + " " + flag);
            });
        });
        if (!cmds.length) return Promise.resolve(fixed);
        try { if (!global.localStorage.getItem("apl.bootFlagsBefore")) global.localStorage.setItem("apl.bootFlagsBefore", JSON.stringify(apps)); } catch (e) {}
        return sys.exec(cmds.join(" && ") + " 2>&1").then(function () { return fixed; });
    }

    /* Read, repair what is off, read again: the result is what the Diagnostic shows. */
    function check() {
        if (sys.PREVIEW) return Promise.resolve(null);
        return read().then(function (before) {
            return fix(before).then(function (fixed) {
                return read().then(function (after) {
                    state = { apps: after, fixed: fixed, at: Date.now() };
                    return state;
                });
            });
        }).catch(function (e) {
            state = { apps: {}, fixed: [], error: (e && e.message) || String(e) };
            return state;
        });
    }

    /* Once per launcher start, as soon as Vetro answers (root needed). */
    var done = false;
    function whenVetro(tries) {
        if (done || sys.PREVIEW) return;
        sys.vetroAlive().then(function (ok) {
            if (!ok) { if (tries > 0) setTimeout(function () { whenVetro(tries - 1); }, 20000); return; }
            done = true;
            check();
        });
    }
    var prev = APL.onHomeReady;
    APL.onHomeReady = function () { if (prev) prev(); setTimeout(function () { whenVetro(15); }, 8000); };

    APL.startup = {
        check: check,
        state: function () { return state; },
        WANT: WANT
    };
})(window);
