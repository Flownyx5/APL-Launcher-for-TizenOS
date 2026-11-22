/* ============================================================
   vault.js — apps behind a secret code.

   Settings › Apps › Protected Apps (or hold OK on an app):
     Locked   the app stays on the Home Screen with a small lock; opening
              it asks for the code.
     Hidden   the app leaves the Home Screen, Search, the App Switcher and
              Settings' lists; hold OK › Show Hidden Apps (or the same
              Settings page) asks for the code and shows them for a while.
   The code: 4, 6 or 8 digits, chosen here, kept hashed, shared by the
   whole screen (every profile). Asked again: each time, after 5 or
   30 minutes, or until the screen sleeps. Five wrong codes in a row:
   30 seconds before the next try.
   Every way the launcher opens an app goes through the code (the Home
   Screen, folders, Search, the App Switcher, Continue Watching, Alexa),
   and the launcher's bridge also brings the code up when a locked or
   hidden app is opened from outside the launcher (Samsung's Smart Hub,
   a phone app): bridge/service.js, vault.
   ============================================================ */
(function (global) {
    "use strict";

    var APL = global.APL, sys = APL.sys;
    var SALT = "apl-vault", MAX_FAILS = 5, BLOCK_MS = 30000;
    var passes = {}, revealUntil = 0, fails = 0, blockUntil = 0;

    function T(text, vars) { return APL.t(text, vars); }
    function states() { return sys.pref("vaultApps") || {}; }
    function stateOf(id) { return states()[id] || "open"; }
    function hasCode() { return !!sys.pref("vaultPin"); }
    /* Kept as "length:hash": the code asked is always as long as the one saved, even after Code Length
       changed and the new code was not typed (cancelled) */
    function saved() {
        var v = sys.pref("vaultPin") || "", m = /^([468]):(.+)$/.exec(v);
        return m ? { len: +m[1], h: m[2] } : v ? { len: 4, h: v } : null;
    }
    function wanted() { var n = sys.pref("vaultPinLength"); return n === 6 || n === 8 ? n : 4; }
    function codeLength() { var s = saved(); return s ? s.len : wanted(); }
    function hash(pin) { return APL.pinPad.hash(SALT, pin); }
    function relockMs() {
        var r = sys.pref("vaultRelock");
        return r === "each" ? 15000 : r === 30 ? 30 * 60000 : r === "sleep" ? 12 * 3600000 : 5 * 60000;
    }
    function protectedIds() {
        var m = states();
        return hasCode() ? Object.keys(m).filter(function (id) { return m[id] === "lock" || m[id] === "hide"; }) : [];
    }
    function passed(id) { return (passes[id] || 0) > Date.now(); }
    function revealed() { return revealUntil > Date.now(); }

    /* The app (or the tile, for a launcher tile that opens another app: TizenTube) */
    function idOf(app) { return typeof app === "string" ? app : app && app.id; }
    function needs(app) {
        if (!hasCode()) return false;
        var id = idOf(app), st = stateOf(id), via = app && app.needs ? stateOf(app.needs) : "open";
        if (st === "open" && via === "open") return false;
        return !passed(id) && !(app && app.needs && passed(app.needs));
    }
    function hidden(app) { return hasCode() && stateOf(idOf(app)) === "hide" && !revealed(); }
    function hiddenIds() { return revealed() ? [] : protectedIds().filter(function (id) { return stateOf(id) === "hide"; }); }

    /* ---------- the bridge: locked apps opened from outside the launcher ---------- */
    function tellBridge(msg) { if (!sys.PREVIEW && sys.bridgeSend) sys.bridgeSend([{ key: "vaultAllow", value: JSON.stringify(msg) }]).catch(function () {}); }
    function grant(id) {
        var until = Date.now() + relockMs();
        passes[id] = until;
        tellBridge({ id: id, ms: relockMs() });
    }

    /* ---------- asking for the code ---------- */
    function nameOf(id) {
        var list = (APL.allApps && APL.allApps()) || [];
        for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i].name;
        return "";
    }
    function check(pin) {
        if (Date.now() < blockUntil) return false;
        var s = saved();
        if (s && pin.length === s.len && hash(pin) === s.h) { fails = 0; return true; }
        if (++fails >= MAX_FAILS) {
            fails = 0;
            blockUntil = Date.now() + BLOCK_MS;
            setTimeout(function () { if (APL.pinPad.isOpen()) APL.pinPad.close(); }, 450);
            APL.toast(T("Wrong code five times: try again in 30 seconds."));
        }
        return false;
    }
    /* ask(id or app, done, cancel, title): the code, then done(); nothing asked when not needed */
    function ask(app, done, cancel, title) {
        var id = idOf(app);
        if (Date.now() < blockUntil) {
            APL.toast(T("Wrong code five times: try again in {s} seconds.", { s: Math.ceil((blockUntil - Date.now()) / 1000) }));
            if (cancel) cancel();
            return;
        }
        var name = (app && app.name) || nameOf(id);
        APL.pinPad({
            title: title || (name ? T("Code for “{name}”", { name: name }) : T("Enter the secret code")),
            length: codeLength(),
            check: check,
            done: function () {
                if (id) { grant(id); if (app && app.needs) grant(app.needs); }
                if (done) done();
            },
            cancel: cancel
        });
    }
    /* guard(app, run): run now when the app needs no code, after it otherwise */
    function guard(app, run, cancel) {
        if (!needs(app)) { var id = idOf(app); if (id && stateOf(id) !== "open") tellBridge({ id: id, ms: relockMs() }); run(); return; }
        ask(app, run, cancel);
    }

    /* ---------- a new code (typed twice) ---------- */
    function newCode(done, cancel) {
        var len = wanted();
        // Cancelled: Code Length shows the length of the code kept again
        function stop() { var s = saved(); if (s && s.len !== wanted()) sys.setPref("vaultPinLength", s.len); if (cancel) cancel(); }
        APL.pinPad({ title: T("Choose a secret code"), sub: T("{n} digits", { n: len }), length: len, check: function () { return true; }, cancel: stop,
            done: function (first) {
                APL.pinPad({ title: T("Type it again"), sub: T("{n} digits", { n: len }), length: len, check: function (p) { return p === first; }, cancel: stop,
                    done: function () {
                        sys.setPref("vaultPin", len + ":" + hash(first));
                        APL.toast(T("Secret code saved"), true);
                        if (done) done();
                    } });
            } });
    }
    /* Change it: the current code first (when there is one), then the new one */
    function changeCode(done) {
        if (!hasCode()) { newCode(done); return; }
        ask(null, function () { newCode(done); }, null, T("Current secret code"));
    }
    /* Forget it: every protection goes with it (asked for the code first) */
    function forget(done) {
        ask(null, function () {
            sys.setPref("vaultPin", "");
            sys.setPref("vaultApps", {});
            passes = {}; revealUntil = 0;
            changed();
            APL.toast(T("Secret code removed: every app is visible and opens without it again"), true);
            if (done) done();
        }, null, T("Current secret code"));
    }

    /* ---------- the state of an app ---------- */
    function setState(id, st, done) {
        function apply() {
            var m = {}, cur = states(), k;
            for (k in cur) m[k] = cur[k];
            if (st === "open") delete m[id]; else m[id] = st;
            sys.setPref("vaultApps", m);
            if (st !== "open") passes[id] = 0;
            changed();
            if (done) done();
        }
        // No code yet: it is chosen first, then the app is protected
        if (st !== "open" && !hasCode()) { newCode(apply); return; }
        apply();
    }
    function nextState(id) { var st = stateOf(id); return st === "open" ? "lock" : st === "lock" ? "hide" : "open"; }
    function stateText(id) {
        var st = stateOf(id);
        return st === "lock" ? T("Locked") : st === "hide" ? T("Hidden") : T("Visible");
    }

    /* ---------- showing the hidden apps for a while ---------- */
    var revealTimer = null;
    function reveal(done) {
        ask(null, function () {
            revealUntil = Date.now() + Math.max(relockMs(), 5 * 60000);
            protectedIds().forEach(function (id) { if (stateOf(id) === "hide") passes[id] = Date.now() + relockMs(); });
            clearTimeout(revealTimer);
            revealTimer = setTimeout(function () { revealUntil = 0; changed(); }, revealUntil - Date.now());
            changed();
            APL.toast(T("Hidden apps shown for a while, with a lock"), true);
            if (done) done();
        }, null, T("Show the hidden apps"));
    }
    function hideAgain() { revealUntil = 0; clearTimeout(revealTimer); changed(); }

    /* "Each time": the hidden apps hide again as soon as an app opens over the launcher. "Until the screen
       sleeps": the launcher is frozen while the screen sleeps (and behind an app); back after more than ten
       minutes away, the code is asked again (the bridge knows the sleep itself, for the apps it watches). */
    var hiddenAt = 0;
    document.addEventListener("visibilitychange", function () {
        if (document.hidden) {
            hiddenAt = Date.now();
            if (sys.pref("vaultRelock") === "each" && revealed()) hideAgain();
            return;
        }
        if (sys.pref("vaultRelock") === "sleep" && hiddenAt && Date.now() - hiddenAt > 10 * 60000) {
            passes = {};
            if (revealed()) hideAgain();
        }
    });

    /* The bridge watches the real apps: a launcher tile that opens another app (TizenTube) gives that app;
       one that stays inside the launcher (Home Assistant) needs nothing outside it */
    function bridgeIds() {
        var list = (APL.allApps && APL.allApps()) || [], byId = {}, out = [];
        list.forEach(function (a) { byId[a.id] = a; });
        protectedIds().forEach(function (id) {
            var a = byId[id], real = a && a.virtual ? a.needs : id;
            if (real && out.indexOf(real) === -1) out.push(real);
        });
        return out;
    }
    var sentVault = null;
    function sendBridge() {
        if (sys.PREVIEW || !sys.bridgeSend) return;
        var msg = JSON.stringify({ ids: bridgeIds(), ms: relockMs() });
        if (msg === sentVault) return;
        sys.bridgeSend([{ key: "vault", value: msg }]).then(function () { sentVault = msg; }, function () {});
    }
    /* The Home Screen drawn again once, whatever changed (the code and the apps' states can change together) */
    var changeTimer = null;
    function changed() {
        clearTimeout(changeTimer);
        changeTimer = setTimeout(function () {
            if (APL.reloadApps) APL.reloadApps();
            sendBridge();
        }, 0);
    }
    sys.onPref("vaultPin", changed);
    sys.onPref("vaultApps", changed);
    sys.onPref("vaultRelock", sendBridge);
    // Once the apps are known (the bridge forgets nothing: its list is kept on the screen), then now and then
    setTimeout(sendBridge, 20000);
    setInterval(function () { if (!document.hidden) { sentVault = null; sendBridge(); } }, 30 * 60000);

    /* ---------- every way the launcher opens an app ---------- */
    function wrap() {
        if (APL._vaultWrapped || !APL.launchApp) return;
        APL._vaultWrapped = true;
        var rawLaunch = APL.launchApp, rawDeep = APL.launchDeepLink, rawOpen = APL.openApp;
        function behind(id, run) {
            return new Promise(function (resolve, reject) {
                if (APL.hideVeil) APL.hideVeil();
                if (APL.dropZoom) APL.dropZoom();
                ask(id, function () {
                    if (APL.showVeil) APL.showVeil();
                    run().then(resolve, reject);
                }, function () { resolve(); });            // cancelled: nothing opens, no error shown
            });
        }
        APL.launchApp = function (id) {
            var self = this, args = arguments;
            if (!needs(id)) { if (stateOf(id) !== "open") tellBridge({ id: id, ms: relockMs() }); return rawLaunch.apply(self, args); }
            return behind(id, function () { return rawLaunch.apply(self, args); });
        };
        if (rawDeep) APL.launchDeepLink = function (id) {
            var self = this, args = arguments;
            if (!needs(id)) { if (stateOf(id) !== "open") tellBridge({ id: id, ms: relockMs() }); return rawDeep.apply(self, args); }
            return behind(id, function () { return rawDeep.apply(self, args); });
        };
        if (rawOpen) APL.openApp = function (app) {
            var self = this, args = arguments;
            // Launcher tiles that open another app (TizenTube): their own state counts too
            if (app && app.virtual && needs(app)) { ask(app, function () { rawOpen.apply(self, args); }); return; }
            return rawOpen.apply(self, args);
        };
    }

    /* The bridge brought the launcher back over a locked app opened from outside (Smart Hub, a phone app) */
    function fromBridge(id) {
        if (!hasCode() || bridgeIds().indexOf(id) === -1) return;
        ask(id, function () { APL.launchApp(id); }, null, T("“{name}” is protected", { name: nameOf(id) || id }));
    }

    var prev = APL.onHomeReady;
    APL.onHomeReady = function () { if (prev) prev(); wrap(); };
    wrap();

    APL.vault = {
        needs: needs, hidden: hidden, hiddenIds: hiddenIds, protectedIds: protectedIds, guard: guard, ask: ask,
        stateOf: stateOf, setState: setState, nextState: nextState, stateText: stateText,
        hasCode: hasCode, codeLength: codeLength, changeCode: changeCode, newCode: newCode, forget: forget,
        reveal: reveal, revealed: revealed, hideAgain: hideAgain, relockMs: relockMs, fromBridge: fromBridge, bridgeIds: bridgeIds,
        badge: function (app) { var st = hasCode() ? stateOf(idOf(app)) : "open"; return st === "open" ? "" : st; }
    };
})(window);
