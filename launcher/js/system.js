/* ============================================================
   system.js — Samsung hardware access + launcher preferences.

   APIs used (all available to a non-partner Tizen app):
     tizen.tvaudiocontrol      volume, mute, audio output format
     webapis.productinfo       model, firmware
     webapis.network           connection type, SSID, IP, MAC, DNS…
     tizen.systeminfo          storage, display, Tizen version
     tizen.tvinputdevice       Play/Pause, color and Info keys
   Remote keys, picture, Game Mode: root commands through Vetro
   (via the private bridge, bridge/service.js). Without Vetro, the local
   network remote (ws://127.0.0.1:8001) puts the screen to sleep: the first
   time, the screen asks whether to allow APL Launcher, which must be accepted.

   On PC (preview), everything is simulated and marked "(preview)".
   ============================================================ */
(function (global) {
    "use strict";

    var tz = global.tizen;
    var wa = global.webapis;
    /* Another TV system is a real screen too: LG (js/webos.js) gives its own sound, network, picture…
       (P.adaptSys, at the end of this file), and Android TV (android/web/android.js) replaces what follows
       with Android's calls */
    var P = global.APL && global.APL.platform;
    var PREVIEW = !tz && !P && !global.APLAndroid;
    var APL = global.APL;

    /* ---------- preferences (stored on the screen) ---------- */
    var DEFAULTS = {
        profileName: "",            // first name shown in Control Center (Settings)
        clock24: true,
        showHint: true,
        reduceMotion: false,
        dnd: false,
        sleepTimer: 0,              // minutes, 0 = off
        sleepAt: 0,                 // timestamp of the scheduled sleep
        screensaverDelay: 5,        // minutes, 0 = never
        screensaverStyle: "aerial", // "aerial" (Apple videos) | "art" (app artwork) | "dark"
        screensaverClockMove: 0,    // minutes between two corners of the screen saver's clock, 0 = it stays put
        uiSounds: true,             // small navigation clicks, like on Apple TV
        hiddenApps: [],
        appIcons: {},               // Change Icon (hold OK on an app): { app id: tile picture } for the whole screen (launcher.js)
        appOrder: [],
        sourceDevices: {},          // device chosen for each input (Sources screen)
        sourcePorts: null,          // the screen's HDMI ports, read through Vetro (sources.js)
        pinnedSources: [],          // inputs shown on the Home Screen as tiles (sources.js)
        autoUpdate: true,           // launcher updates from GitHub, on their own
        autoArt: true,              // logos, backgrounds and content found automatically (App Store, TMDB)
        appsPerRow: 6,              // dock and grid: 5, 6 or 7 (launcher.js sizes())
        searchHidden: false,        // Search also finds the hidden apps (search.js)
        shelfArt: "sheets",         // Top Shelf of apps without artwork: "sheets" | "logo" | "wall" | "black" (genart.js, launcher.js)
        shelfWall: "pic:dusk",      //   with "wall": the wallpaper behind every app (genart.js APL.wallpapers)
        smartHubTileSet: false,     // the Smart Hub tile was hidden once in this profile (it starts hidden)
        hubShelf: true,             // Top Shelf: the apps' own Smart Hub rows first (liveshelf.js)
        liveShelf: true,            //   then the content of the moment (TMDB / YouTube…), then shelfArt
        visualEffects: PREVIEW,     // blur / glass: costly on the screen, off by default
        gameWanted: false,          // Game Mode requested (applied when switching to an input)
        ccHintCount: 0,             // number of times the Control Center tip has been shown
        appearance: "dark",         // "dark" | "light" | "auto" (follows the sun)
        folders: [],                // Home Screen folders: { id, name, apps: [ids] }
        aerialHidden: [],           // themes and places hidden from the Aerial screen saver
        bgMotion: false,            // slow background motion: costs more than one CPU core when idle
        homeReturn: true,           // when an app closes: the launcher rather than the Samsung home
        alexaBridge: true,          // the Echo Dot can open apps (overlay/Alexa.cs)
        servicesCut: {},            // blocked Samsung services and their original settings (services.js)
        bootCleanup: true,          // once per power-on: closes what Samsung opens on its own
        supportReminder: true,      // once per power-on: the Ko-fi code over the Home Screen (launcher.js supportReminder)
        homeAppSaved: null,         // { home, autostart } before "Start on APL Launcher", put back when it is turned off
        idleClose: true,            // an app left in the background for 10 min is closed (overlay/IdleApps.cs)
        pauseKey: "controlcenter",  // ⏯ in an app: "controlcenter" | "playpause", the app's own (overlay/Program.cs)
        language: "auto"            // "auto" (screen language) | "en" | "fr" | "ms" | "pl" | "tr": read at start-up by i18n.js
    };
    /* OLED panels, told by the model the screen reports: the S8x / S9x TVs from 2022 on, whatever the
       region letters (QE55S95BATXXU, QN65S90FAEXZA, KQ65SD95AFXKR…), and the Odyssey OLED monitors with
       Smart TV, whose code has an S where the Neo (mini LED) ones have an N (LS49CG954SUXEN, LS34BG850SNXGO,
       LS32DG802SUXEN). A still picture can mark them, so the screen saver's clock moves there unless the
       viewer chose otherwise (Settings › Screen Saver › Move the Clock). PC preview: ?oled. */
    var OLED_RE = /^[A-Z]{2}\d{2}S[A-Z]?[89]\d|^LS\d{2}[A-Z]G[689]\d{2}S/;
    var OLED = PREVIEW ? /[?&]oled\b/.test(global.location.search)
        : OLED_RE.test(String((function () { try { return wa.productinfo.getRealModel(); } catch (e) { return ""; } })() || "").toUpperCase());
    if (OLED) DEFAULTS.screensaverClockMove = 2;
    /* Screen settings (shared) and the settings of each profile in the household:
       Home Screen layout, hidden apps, preferences, recent apps. */
    var PROFILE_KEYS = { hiddenApps: 1, appOrder: 1, clock24: 1, showHint: 1, reduceMotion: 1, dnd: 1,
                         uiSounds: 1, screensaverStyle: 1, screensaverDelay: 1, screensaverClockMove: 1, liveShelf: 1, hubShelf: 1, recentApps: 1,
                         appearance: 1, folders: 1, aerialHidden: 1, smartHubTileSet: 1 };
    DEFAULTS.recentApps = [];
    var COLORS = ["#ff9f0a", "#30d158", "#0a84ff", "#bf5af2", "#ff375f", "#64d2ff", "#ffd60a", "#ac8e68"];
    function load(k, fallback) {
        try { var v = JSON.parse(global.localStorage.getItem(k) || "null"); return v || fallback; } catch (e) { return fallback; }
    }
    function save(k, v) {
        var text = JSON.stringify(v);
        try { global.localStorage.setItem(k, text); } catch (e) {}
        if (!COPY_KEYS.test(k) || COPY_SKIP.test(k)) return;
        copyPending[k] = text;
        /* Stamped, so the copy can be told apart from local storage when a
           screen comes back from the wall with an older one of the two. */
        copyPending[COPY_REV] = String(Date.now());
        try { global.localStorage.setItem(COPY_REV, copyPending[COPY_REV]); } catch (e) {}
        copyLater();
    }

    /* ---------- a second copy of the settings, in IndexedDB ----------
       A screen switched off at the wall can come back with its local storage empty: every setting, the
       profiles and the Home Screen layout gone, and the version installed by APL Launcher Setup instead of
       the downloaded one (#60, a Frame 2022). Local storage reaches the disk a while after each change;
       an IndexedDB write is on the disk once it is done. So each setting saved above is also written there
       a moment later, and at start-up, when local storage has none of them but the copy has, they are put
       back and the page loads once more with them. A real first start has no copy, so nothing comes back. */
    var COPY_DB = "apl-settings-copy", COPY_KEYS = /^apl\./;
    /* Not settings: the downloaded launcher itself (large, and fetched again by the
       updater), and the six-hour content lists — the apps' own Top Shelf rows,
       which come back by themselves and would only make the copy big and the
       restore slow on a panel with little flash. */
    /* Nor the screen's own state: which window it is in (apl.webos.*), whether the
       Control Center has been seen (apl.ccSeen), when the copy last put itself
       back (apl.copyRestored*). Those say nothing about a setting and are written
       on every window change. */
    var COPY_SKIP = /^apl\.(bundle$|live\.|webos\.|ccSeen$|copyRestored)/;
    var COPY_MAX = 262144;                     // 256 KB per value: a restore stays quick
    var COPY_REV = "apl.rev";                  // when the settings were last written, in both stores
    var copyDb = null, copyPending = {}, copySeen = {}, copyTimer = null, copyHold = false, copySweepTimer = 0;

    /* The connection is reopened whenever the browser closes it under us (a screen
       that clears its storage, a browser that restarts it): with a cached closed
       connection every write for the rest of the session threw, in silence, and
       the copy stopped following the settings. IndexedDB on a 6.5 panel is also
       slow to answer and can refuse outright: nothing here may throw into the
       start-up or hold it back. */
    function copyOpen() {
        if (copyDb) return copyDb;
        copyDb = new Promise(function (resolve, reject) {
            if (!global.indexedDB) { reject(new Error("no IndexedDB")); return; }
            var rq;
            try { rq = global.indexedDB.open(COPY_DB, 1); } catch (e) { reject(e); return; }
            rq.onupgradeneeded = function () { try { rq.result.createObjectStore("kv"); } catch (e) {} };
            rq.onsuccess = function () {
                var db = rq.result;
                db.onclose = function () { copyDb = null; };
                db.onversionchange = function () { try { db.close(); } catch (e) {} copyDb = null; };
                resolve(db);
            };
            rq.onerror = function () { reject(rq.error || new Error("open")); };
            rq.onblocked = function () { reject(new Error("blocked")); };
        });
        copyDb["catch"](function () { copyDb = null; });     // the next call tries again
        return copyDb;
    }
    function copyLater() {
        clearTimeout(copyTimer);
        /* A quarter of a second, not one and a half: a screen unplugged straight
           after a change kept the copy from before it, and the setting was gone
           when the power came back. */
        copyTimer = setTimeout(copyFlush, 280);
        copySweepSoon();
    }
    /* The modules that write straight into local storage (the Home Assistant
       connection, a picture's address, the chosen region) do not go through
       save(), so a sweep follows a change to catch them. It is not on a clock:
       reading every key every twenty seconds walked over the generated artwork
       for nothing, which is the kind of background work 1.3.0 took out on LG. */
    function copySweepSoon() {
        if (copySweepTimer) return;
        copySweepTimer = global.setTimeout(function () { copySweepTimer = 0; copySweep(); }, 2000);
    }
    function copyWrite(batch) {
        return copyOpen().then(function (db) {
            return new Promise(function (resolve, reject) {
                var tx;
                try { tx = db.transaction("kv", "readwrite"); } catch (e) { reject(e); return; }
                tx.oncomplete = function () { resolve(); };
                tx.onerror = function () { reject(tx.error || new Error("write")); };
                tx.onabort = function () { reject(tx.error || new Error("abort")); };
                var store = tx.objectStore("kv"), keys = Object.keys(batch);
                for (var i = 0; i < keys.length; i++) {
                    if (batch[keys[i]] === null) store["delete"](keys[i]); else store.put(batch[keys[i]], keys[i]);
                }
            });
        });
    }
    function copyFlush() {
        if (copyHold) return;                       // the copy is being read back: it must not be written over first
        var batch = copyPending, keys = Object.keys(batch);
        copyPending = {};
        if (!keys.length) return;
        /* A batch that fails is not retried here: what it carried is not written
           down as written below, so the next sweep queues it again. Only the
           connection is dropped, so the next attempt reopens it. */
        copyWrite(batch).then(function () {
            /* What the copy holds now, so a sweep queues only what has changed
               since. Every value used to be queued on every hide, which on a TV is
               every time an app opens, the generated artwork included. */
            for (var i = 0; i < keys.length; i++) {
                if (batch[keys[i]] === null) delete copySeen[keys[i]]; else copySeen[keys[i]] = batch[keys[i]];
            }
        })["catch"](function () { copyDb = null; });
    }
    function copyDrop(k) { copyPending[k] = null; copyLater(); }
    /* Everything the launcher keeps, read out of local storage and written to the
       copy. Most modules write straight into local storage (the Home Assistant
       connection, the address of each app's picture, the chosen region) without
       passing through save(), so the copy is swept rather than only fed by it - a
       walk over the keys after a change, and at the moment the page is hidden or
       closed, which is when the power can go - and only the values that are not in
       the copy already are queued. */
    function copySweep() {
        var changed = 0;
        try {
            for (var i = 0; i < global.localStorage.length; i++) {
                var k = global.localStorage.key(i);
                if (!k || !COPY_KEYS.test(k) || COPY_SKIP.test(k) || k === COPY_REV) continue;
                var v = global.localStorage.getItem(k);
                if (typeof v !== "string" || v.length > COPY_MAX) continue;
                if (copySeen[k] === v) continue;               // already in the copy, unchanged
                copyPending[k] = v;
                changed++;
            }
        } catch (e) {}
        if (changed) {
            copyPending[COPY_REV] = String(Date.now());
            try { global.localStorage.setItem(COPY_REV, copyPending[COPY_REV]); } catch (e) {}
        }
        copyFlush();
    }
    function copyStored() {
        return copyOpen().then(function (db) {
            return new Promise(function (resolve) {
                var out = {}, rq;
                try { rq = db.transaction("kv", "readonly").objectStore("kv").openCursor(); }
                catch (e) { resolve(out); return; }
                rq.onsuccess = function () { var c = rq.result; if (c) { out[c.key] = c.value; c["continue"](); } else resolve(out); };
                rq.onerror = function () { resolve(out); };
            });
        });
    }
    /* What the copy has is compared with what local storage has, at every start -
       not only when local storage is empty. A screen that loses power can come
       back with an older copy of its storage rather than none, which is why the
       settings were sometimes kept and sometimes not; and it can come back with
       only some of the keys, which left the Home Screen layout at its defaults
       while the rest was still there. The copy carries the time it was written:
       when it is newer than local storage, or when local storage has none of it,
       the copy is put back and the page loads once more with it. */
    function copyCheck() {
        copyHold = true;
        var answered = false;
        function release() {
            if (answered) return;
            answered = true;
            copyHold = false;
            copyFlush();
        }
        /* A storage that never answers must not hold the Home Screen back: after
           three seconds the copy is left for the next start. */
        var watchdog = setTimeout(release, 3000);
        try {
            copyStored().then(function (saved) {
                clearTimeout(watchdog);
                if (answered) return;               // the start has already gone on without it
                answered = true;
                var keys = Object.keys(saved || {}).filter(function (k) {
                    return (COPY_KEYS.test(k) || k === COPY_REV) && typeof saved[k] === "string";
                });
                if (!keys.length) { copyHold = false; copySweep(); return; }
                var there = Number(saved[COPY_REV] || 0), here = 0;
                try { here = Number(global.localStorage.getItem(COPY_REV) || 0); } catch (e) { here = 0; }
                /* Only what the copy can actually fill: a key this code never wrote
                   there (an older copy) must not reload the page for nothing. */
                var partial = false;
                try {
                    var cur = (load("apl.profiles", {}) || {}).current;
                    var want = ["apl.prefs", "apl.profiles", cur ? "apl.prefs." + cur : ""];
                    for (var i = 0; i < want.length; i++) {
                        if (want[i] && !global.localStorage.getItem(want[i]) && keys.indexOf(want[i]) >= 0) partial = true;
                    }
                } catch (e) {}
                /* A minute of slack: two clocks that disagree must not cause a restore. */
                var behind = !!there && there > here + 60000;
                if (!partial && !behind) { copyHold = false; return; }   // nothing to put back: the copy follows a change from here
                /* The guard is here to stop a reload loop, not to stop the next
                   restore: it used to live in window.name, which survives every
                   reload in the tab, so one restore in a session turned every
                   later one off - and a storage wiped again a minute later was
                   then never put back. Thirty seconds is longer than the reload
                   needs and far shorter than a session. */
                var last = 0;
                try { last = Number(global.sessionStorage.getItem("apl.copyRestoredAt") || 0); } catch (e) {}
                if (last && Date.now() - last < 30000) { copyPending = {}; copyHold = false; return; }
                var wrote = 0;
                for (var j = 0; j < keys.length; j++) {
                    /* The copy is what put these back, so they are already in it. */
                    try { global.localStorage.setItem(keys[j], saved[keys[j]]); copySeen[keys[j]] = saved[keys[j]]; wrote++; } catch (e) {}
                }
                if (!wrote) { copyHold = false; return; }   // nothing could be written: leave the copy alone
                try { global.sessionStorage.setItem("apl.copyRestoredAt", String(Date.now())); } catch (e) {}
                global.location.reload();
            }, release);
        } catch (e) { release(); }
    }
    /* A screen that is switched off has a moment between the change and the power
       going: the copy is written then, without waiting for its quarter second. */
    if (global.addEventListener) {
        global.addEventListener("pagehide", function () { copyHold = false; copySweep(); });
        global.addEventListener("beforeunload", function () { copyHold = false; copySweep(); });
        global.addEventListener("visibilitychange", function () {
            if (global.document && global.document.hidden) copySweep();
        });
    }
    var prefs = load("apl.prefs", {});
    var household = load("apl.profiles", null);
    if (!household || !household.list || !household.list.length) {
        // First launch with profiles: the current settings become those of the first profile
        household = { current: "p1", list: [{ id: "p1", name: prefs.profileName || APL.t("Me"), color: COLORS[2] }] };
        var first = {};
        Object.keys(PROFILE_KEYS).forEach(function (k) { if (k in prefs) first[k] = prefs[k]; });
        save("apl.prefs.p1", first);
        save("apl.profiles", household);
    }
    var pprefs = load("apl.prefs." + household.current, {});
    // Up to 1.0.19, Otherwise also had App Colors (now Large Logo) and the APL wallpaper (now Black)
    var OLD_ART = { colors: "logo", wallpaper: "black", all: "black" };
    if (OLD_ART[prefs.shelfArt]) { prefs.shelfArt = OLD_ART[prefs.shelfArt]; save("apl.prefs", prefs); }
    // Up to 1.0.14, "App Backgrounds" off (per profile) gave a plain dark Top Shelf: now shelfArt "black"
    household.list.forEach(function (p) {
        var pp = p.id === household.current ? pprefs : load("apl.prefs." + p.id, {});
        if (!("appBackgrounds" in pp)) return;
        if (pp.appBackgrounds === false && p.id === household.current) { prefs.shelfArt = "black"; save("apl.prefs", prefs); }
        delete pp.appBackgrounds;
        save("apl.prefs." + p.id, pp);
    });

    // Local storage came back empty (a screen switched off at the wall): the copy, if there is one, comes back
    /* Nothing else writes the copy on its own: a ten-second "make sure it is
       there" pass read local storage and pushed it into the copy, so a start that
       had not restored yet (a slow storage, an empty one that was about to be
       put back) could overwrite a good copy with this start's defaults. The copy
       follows the settings through save() and is only ever seeded from local
       storage when the copy is empty. */
    copyCheck();

    function currentProfile() {
        for (var i = 0; i < household.list.length; i++) if (household.list[i].id === household.current) return household.list[i];
        return household.list[0];
    }
    function pref(k) {
        if (k === "profileName") return currentProfile().name;
        var src = PROFILE_KEYS[k] ? pprefs : prefs;
        return (k in src) ? src[k] : DEFAULTS[k];
    }
    function setPref(k, v) {
        if (k === "profileName") { currentProfile().name = v; save("apl.profiles", household); }
        else if (PROFILE_KEYS[k]) { pprefs[k] = v; save("apl.prefs." + household.current, pprefs); }
        else { prefs[k] = v; save("apl.prefs", prefs); }
        (listeners[k] || []).forEach(function (fn) { fn(v); });
    }
    var listeners = {};
    function onPref(k, fn) { (listeners[k] = listeners[k] || []).push(fn); }

    /* Is Vetro on the screen at all (vetrotvapp.app, vetrotvapp.svc)? Installed from Apps2Samsung's TV-Store
       without root (a Q72D on Reddit), the Home key stays Samsung's: Return to the Launcher, which needs no
       Vetro, then replaced Samsung's home as soon as Home showed it, with no way back to Samsung's menus. Without
       Vetro it is off unless chosen, and the settings that need Vetro say so (settings.js). Asked again at every
       start; any doubt (the list can't be read) counts as Vetro there, so nothing changes. */
    var noVetro = false;
    function markNoVetro() {
        if (noVetro) return;
        noVetro = true;
        var before = pref("homeReturn");
        DEFAULTS.homeReturn = false;
        if (pref("homeReturn") !== before) (listeners.homeReturn || []).forEach(function (fn) { fn(false); });
    }
    /* The screen's list of apps (about 500 entries with the services), asked once for everyone at start-up.
       Vetro's check below asked first and the Home Screen a moment later, each on its own, and the Home
       Screen waits for its answer: after a full start the screen answers slowly. One request in flight is
       shared, and an answer serves for a few seconds; fresh: true always asks again (an install, an uninstall). */
    var appsInfoAsk = null, appsInfoAt = 0, appsInfoList = null, APPS_INFO_KEEP = 5000;
    function appsInfo(fresh) {
        if (!tz || !tz.application || typeof tz.application.getAppsInfo !== "function") return Promise.reject(new Error("unavailable"));
        if (!fresh && appsInfoList && Date.now() - appsInfoAt < APPS_INFO_KEEP) return Promise.resolve(appsInfoList);
        if (!fresh && appsInfoAsk) return appsInfoAsk;
        var ask = new Promise(function (resolve, reject) {
            try {
                tz.application.getAppsInfo(function (list) {
                    appsInfoList = list; appsInfoAt = Date.now();
                    resolve(list);
                }, reject);
            } catch (e) { reject(e); }
        });
        appsInfoAsk = ask;
        function done() { if (appsInfoAsk === ask) appsInfoAsk = null; }
        ask.then(done, done);
        return ask;
    }

    function detectVetro() {
        if (P) return;                     // not a Samsung screen: no Vetro to look for
        if (PREVIEW) {
            // The PC preview has no Vetro to look for: ?novetro shows the screen without it
            if (global.location && /[?&]novetro\b/.test(global.location.search)) markNoVetro();
            return;
        }
        appsInfo().then(function (list) {
            for (var i = 0; i < list.length; i++) if (/^vetrotvapp\./.test(list[i].id)) return;
            markNoVetro();
        }, function () {});
    }
    detectVetro();

    /* ---------- profiles ---------- */
    var profileListeners = [];
    var profiles = {
        list: function () { return household.list.slice(); },
        current: currentProfile,
        colors: COLORS,
        switchTo: function (id) {
            if (id === household.current) return;
            household.current = id;
            save("apl.profiles", household);
            pprefs = load("apl.prefs." + id, {});
            Object.keys(PROFILE_KEYS).forEach(function (k) { (listeners[k] || []).forEach(function (fn) { fn(pref(k)); }); });
            profileListeners.forEach(function (fn) { fn(currentProfile()); });
        },
        add: function (name) {
            var n = 1, id;
            do { id = "p" + (++n); } while (household.list.some(function (p) { return p.id === id; }));
            var p = { id: id, name: name || APL.t("Profile {n}", { n: household.list.length + 1 }), color: COLORS[household.list.length % COLORS.length] };
            household.list.push(p);
            save("apl.profiles", household);
            return p;
        },
        update: function (id, fields) {
            household.list.forEach(function (p) { if (p.id === id) Object.keys(fields).forEach(function (k) { p[k] = fields[k]; }); });
            save("apl.profiles", household);
            profileListeners.forEach(function (fn) { fn(currentProfile()); });
        },
        remove: function (id) {
            if (household.list.length < 2) return false;
            household.list = household.list.filter(function (p) { return p.id !== id; });
            try { global.localStorage.removeItem("apl.prefs." + id); } catch (e) {}
            copyDrop("apl.prefs." + id);
            if (household.current === id) profiles.switchTo(household.list[0].id);
            save("apl.profiles", household);
            return true;
        },
        onChange: function (fn) { profileListeners.push(fn); },
        /* History: the last apps opened by this profile */
        noteLaunch: function (appId) {
            var r = (pref("recentApps") || []).filter(function (x) { return x !== appId; });
            r.unshift(appId);
            setPref("recentApps", r.slice(0, 12));
        }
    };

    function safe(fn, fallback) { try { var v = fn(); return (v === undefined || v === null || v === "") ? fallback : v; } catch (e) { return fallback; } }

    /* ---------- sound ---------- */
    var mock = { volume: 18, mute: false };
    var audio = {
        getVolume: function () { return PREVIEW ? mock.volume : safe(function () { return tz.tvaudiocontrol.getVolume(); }, 0); },
        setVolume: function (v) {
            v = Math.max(0, Math.min(100, Math.round(v)));
            if (PREVIEW) { mock.volume = v; return v; }
            safe(function () { tz.tvaudiocontrol.setVolume(v); });
            return audio.getVolume();
        },
        isMute: function () { return PREVIEW ? mock.mute : safe(function () { return tz.tvaudiocontrol.isMute(); }, false); },
        setMute: function (m) { if (PREVIEW) mock.mute = m; else safe(function () { tz.tvaudiocontrol.setMute(m); }); },
        outputMode: function () {
            var m = PREVIEW ? "PCM" : safe(function () { return tz.tvaudiocontrol.getOutputMode(); }, "—");
            return { PCM: "PCM", DOLBY: "Dolby Digital", DTS: "DTS", AAC: "AAC", DOLBY_DIGITAL_PLUS: "Dolby Digital+" }[m] || m;
        }
    };

    /* ---------- network ---------- */
    function network() {
        if (PREVIEW) return { connected: true, type: "Wi-Fi", ssid: APL.t("Livebox-(preview)"), signal: 4, ip: "192.168.1.50", mac: "XX:XX:XX:XX:XX:XX", gateway: "192.168.1.1", dns: "192.168.1.1" };
        var n = wa && wa.network;
        var t = safe(function () { return n.getActiveConnectionType(); }, -1);
        var type = { 0: APL.t("Disconnected"), 1: "Wi-Fi", 2: "Ethernet", 3: "Mobile" }[t] || APL.t("Unknown");
        return {
            connected: t > 0,
            type: type,
            ssid: t === 1 ? safe(function () { return n.getWiFiSsid(); }, "—") : "—",
            signal: t === 1 ? safe(function () { return n.getWiFiSignalStrengthLevel(); }, 0) : 0,
            ip: safe(function () { return n.getIp(); }, "—"),
            mac: safe(function () { return n.getMac(); }, "—"),
            gateway: safe(function () { return n.getGateway(); }, "—"),
            dns: safe(function () { return n.getDns(); }, "—")
        };
    }

    /* ---------- device ---------- */
    function product() {
        if (PREVIEW) return { model: "LS32CM801UUXEN", name: APL.t("Smart Monitor M8 (preview)"), firmware: "T-PTMLCWWC-0090", tizen: "9.0" };
        var p = wa && wa.productinfo;
        return {
            model: safe(function () { return p.getRealModel(); }, safe(function () { return p.getModel(); }, "—")),
            name: safe(function () { return p.getModel(); }, APL.t("Samsung screen")),
            firmware: safe(function () { return p.getFirmware(); }, "—"),
            tizen: safe(function () { return tz.systeminfo.getCapability("http://tizen.org/feature/platform.version"); }, "—")
        };
    }

    /* Apps are drawn in 1920 × 1080 (the screen offers them no other mode), while the panel and
       the videos can be 4K or 8K: both are shown. */
    function display() {
        return new Promise(function (resolve) {
            if (PREVIEW) return resolve(APL.t("3840 × 2160 (preview)"));
            var p = wa && wa.productinfo;
            var panel = safe(function () { return p.is8KPanelSupported() ? "7680 × 4320" : ""; }, "") ||
                        safe(function () { return p.isUdPanelSupported() ? "3840 × 2160" : ""; }, "");
            try {
                tz.systeminfo.getPropertyValue("DISPLAY", function (d) {
                    var ui = d.resolutionWidth + " × " + d.resolutionHeight;
                    resolve(panel && panel !== ui ? APL.t("{panel} (interface {ui})", { panel: panel, ui: ui }) : ui);
                }, function () { resolve(panel || "—"); });
            } catch (e) { resolve(panel || "—"); }
        });
    }

    function gb(bytes) { var n = (bytes / 1e9).toFixed(1); return APL.t("{n} GB", { n: APL.lang === "fr" || APL.lang === "pl" || APL.lang === "tr" ? n.replace(".", ",") : n }); }
    function storage() {
        return new Promise(function (resolve) {
            if (PREVIEW) return resolve(APL.t("4.1 GB free of 8.0 GB (preview)"));
            try {
                tz.systeminfo.getPropertyValue("STORAGE", function (s) {
                    var u = (s.units || [])[0];
                    resolve(u ? APL.t("{free} free of {total}", { free: gb(u.availableCapacity), total: gb(u.capacity) }) : "—");
                }, function () { resolve("—"); });
            } catch (e) { resolve("—"); }
        });
    }

    function hdr() {
        if (PREVIEW) return APL.t("Supported");
        return safe(function () { return wa.avinfo.isHdrTvSupport() ? APL.t("Supported") : APL.t("Not supported"); }, "—");
    }

    /* ---------- remote keys ----------
       Simulated by Vetro, as root (/usr/bin/input_keyevent, like Vetro's
       launcher). Samsung's network remote (WebSocket 8001/8002) does not answer
       on every screen: it is now only a fallback, without Vetro. */
    var XKEYS = { KEY_MENU: "XF86Menu", KEY_POWER: "XF86PowerOff", KEY_SOURCE: "XF86Display", KEY_HOME: "XF86Home",
                  KEY_RETURN: "XF86Back", KEY_EXIT: "XF86Exit", KEY_INFO: "XF86Info" };
    function remoteKey(key) {
        if (PREVIEW) return Promise.reject(new Error(APL.t("PC preview: {key} not sent", { key: key })));
        var x = XKEYS[key] || key;
        if (!/^[A-Za-z0-9]+$/.test(x)) return Promise.reject(new Error(APL.t("Unknown key: {key}", { key: key })));
        return vetroAlive().then(function (ok) {
            if (!ok) return wsRemoteKey(key);
            return vetroPost("/exec", { cmd: "/usr/bin/input_keyevent " + x + " 2>&1" }).then(function (r) {
                if (r && r.ok === false) throw new Error(APL.t("The screen refused the key ({key})", { key: x }));
            });
        });
    }

    /* Fallback without Vetro: Samsung's network remote. */
    var TOKEN_KEY = "apl.remoteToken";
    function wsRemoteKey(key) {
        return new Promise(function (resolve, reject) {
            var name = global.btoa("APL Launcher");
            var token = "";
            try { token = global.localStorage.getItem(TOKEN_KEY) || ""; } catch (e) {}
            var urls = [
                "ws://127.0.0.1:8001/api/v2/channels/samsung.remote.control?name=" + name,
                "wss://127.0.0.1:8002/api/v2/channels/samsung.remote.control?name=" + name + (token ? "&token=" + token : "")
            ];
            (function attempt(i) {
                if (i >= urls.length) { reject(new Error(APL.t("Vetro is not responding (open Vetro once on the screen)"))); return; }
                var done = false, ws;
                var timer = setTimeout(function () { if (!done) { done = true; try { ws.close(); } catch (e) {} attempt(i + 1); } }, 5000);
                try { ws = new global.WebSocket(urls[i]); } catch (e) { clearTimeout(timer); attempt(i + 1); return; }
                ws.onmessage = function (m) {
                    var d = {};
                    try { d = JSON.parse(m.data); } catch (e) {}
                    if (d.event === "ms.channel.connect") {
                        if (d.data && d.data.token) { try { global.localStorage.setItem(TOKEN_KEY, d.data.token); } catch (e) {} }
                        ws.send(JSON.stringify({ method: "ms.remote.control", params: {
                            Cmd: "Click", DataOfCmd: key, Option: "false", TypeOfRemote: "SendRemoteKey" } }));
                        done = true; clearTimeout(timer);
                        setTimeout(function () { try { ws.close(); } catch (e) {} resolve(); }, 400);
                    } else if (d.event === "ms.channel.unauthorized") {
                        done = true; clearTimeout(timer); reject(new Error(APL.t("Access denied on the screen")));
                    }
                };
                ws.onerror = function () { if (!done) { done = true; clearTimeout(timer); attempt(i + 1); } };
            })(0);
        });
    }

    /* Opens Samsung's Settings menu, for the settings the launcher does not handle itself. */
    function openSamsungSettings(path) {
        return tvExec("app_launcher -s org.tizen.menu >/dev/null 2>&1; true").then(function () { return path; });
    }
    function sleepNow() { return remoteKey("KEY_POWER"); }

    /* Switch to an input, like Samsung's Source tile (and Vetro's launcher):
       tv-viewer is asked to show input number `type` (TV 0, HDMI 1 to 4 = 13 to 16;
       on the Smart Monitor M8, number 14 would be the USB-C input, not yet checked with a device plugged in).
       First directly from the app, otherwise through Vetro. */
    function switchSource(type, label) {
        if (PREVIEW) return Promise.reject(new Error(APL.t("PC preview: input change not sent")));
        var n = String(type);
        var icon = "/usr/apps/com.samsung.tv.theme-resource/shared/res/org.tizen.menu/Settings_Popup/device_icon/" +
                   (type >= 13 && type <= 16 ? "r_icon_device_s_hdmi" + (type - 12) : "r_icon_device_s_tv") + ".webp";
        var extra = [["change_source", n], ["sourceType", n], ["sourceName", String(label || "HDMI " + (type - 12)).replace(/[^A-Za-z0-9 +-]/g, "")],
                     ["sourceIcon", icon]];
        function viaVetro() {
            // No mbrIndex here: app_launcher takes "-2" for an option and rejects the command
            var args = extra.concat([["__K_EX_LAUNCH_REQUESTOR", "user"]]).map(function (kv) { return kv[0] + " '" + kv[1] + "'"; }).join(" ");
            return tvExec("app_launcher -s org.tizen.tv-viewer " + args + " 2>&1").then(function (r) {
                if (r.ok === false) throw new Error(APL.t("The screen refused the input change"));
            });
        }
        return game.applyOnInput().then(function () {
            return new Promise(function (resolve, reject) {
                try {
                    var data = extra.concat([["mbrIndex", "-2"]]).map(function (kv) { return new tz.ApplicationControlData(kv[0], [kv[1]]); });
                    var ctl = new tz.ApplicationControl("http://tizen.org/appcontrol/operation/default", null, null, null, data);
                    tz.application.launchAppControl(ctl, "org.tizen.tv-viewer", resolve, function () { viaVetro().then(resolve, reject); });
                } catch (e) { viaVetro().then(resolve, reject); }
            });
        });
    }

    /* Apps running right now (ids), without going through Vetro. */
    function runningApps() {
        return new Promise(function (resolve, reject) {
            if (!tz || !tz.application || !tz.application.getAppsContext) { reject(new Error(APL.t("unavailable"))); return; }
            tz.application.getAppsContext(function (list) {
                resolve(list.map(function (c) { return c.appId; }));
            }, reject);
        });
    }

    /* ---------- remote keys ---------- */
    function registerKeys() {
        if (!tz || !tz.tvinputdevice) return;
        ["MediaPlayPause", "MediaPlay", "ColorF0Red", "ColorF1Green", "ColorF2Yellow", "ColorF3Blue", "Info"].forEach(function (k) {
            try { tz.tvinputdevice.registerKey(k); } catch (e) {}
        });
    }

    /* ---------- sleep timer ----------
       The screen does the counting (background command): the launcher stops as soon as an app
       is in front, which is exactly when the timer is needed. The file is shared with overlay/. */
    var SLEEP_FILE = "/tmp/apl-sleep-at";
    function armSleepTimer(minutes) {
        var at = minutes ? Date.now() + minutes * 60000 : 0;
        setPref("sleepTimer", minutes);
        setPref("sleepAt", at);
        if (PREVIEW) return;
        var secs = Math.round(at / 1000);
        tvExec(minutes ? "echo " + secs + " > " + SLEEP_FILE + "; (sleep " + (minutes * 60) + "; if [ \"$(cat " + SLEEP_FILE + " 2>/dev/null)\" = \"" + secs + "\" ]; then rm -f " + SLEEP_FILE +
                         "; /usr/bin/input_keyevent XF86PowerOff; fi) >/dev/null 2>&1 &"
                       : "rm -f " + SLEEP_FILE).catch(function () {});
    }
    /* Timer set from the native Control Center: the launcher picks it up. */
    function readSleepTimer() {
        if (PREVIEW) return Promise.resolve();
        return tvExec("cat " + SLEEP_FILE + " 2>/dev/null").then(function (r) {
            var secs = parseInt(String(r.output || "").trim(), 10), at = secs ? secs * 1000 : 0;
            if (at < Date.now()) at = 0;
            setPref("sleepAt", at);
            if (!at) setPref("sleepTimer", 0);
        }, function () {});
    }

    /* ---------- Vetro (root service already installed on the screen) ----------
       Used for the REAL picture settings (backlight, contrast, sharpness,
       color…) and to close the Samsung home. Body sent as text/plain: no
       preflight request, Vetro reads the JSON whatever the type. */
    /* Vetro's port: 8099, or the one Vetro was built with (VETRO_PORT=…, when another app holds 8099). The bridge
       finds it on its own (bridge/service.js, overlay/VetroPort.cs); the launcher learns it from /status, where
       Vetro gives a port that is not the usual one, and keeps it for the direct calls and icons. */
    var VETRO_PORT_KEY = "apl.vetroPort";
    var vetroPortNum = (function () { var p = parseInt(load(VETRO_PORT_KEY, 0), 10); return p >= 1024 && p <= 65535 ? p : 8099; })();
    function vetroUrl(path) { return "http://127.0.0.1:" + vetroPortNum + (path || ""); }
    function notePort(s) {
        if (!s || !s.app || typeof s.app !== "object" || !s.app.version) return;
        var p = parseInt(s.app.port, 10) || 8099;
        if (p === vetroPortNum || p < 1024 || p > 65535) return;
        vetroPortNum = p;
        if (p === 8099) { try { global.localStorage.removeItem(VETRO_PORT_KEY); } catch (e) {} } else save(VETRO_PORT_KEY, p);
    }
    /* Vetro only lets the screen's apps read its answers for /status, /probe and
       /screen. The launcher's private bridge (bridge/service.js, a service in this package) makes
       the other requests and sends the answer back through a trusted Tizen message port
       (reserved for apps signed with the same certificate; no network port is opened). */
    var BRIDGE_ID = "APLauncher.Bridge", BRIDGE_PORT = "APL_BRIDGE";
    var replyPort = null, pending = {}, seq = 0, bridgeDownUntil = 0, bridgeStarting = null;
    /* The service takes a few seconds to open its port after it starts: wait until it is there. */
    function waitBridge(until) {
        return new Promise(function (resolve, reject) {
            (function poll() {
                try { tz.messageport.requestTrustedRemoteMessagePort(BRIDGE_ID, BRIDGE_PORT); resolve(); }
                catch (e) { if (Date.now() >= until) reject(e); else setTimeout(poll, 250); }
            })();
        });
    }
    function startBridge() {
        if (bridgeStarting) return bridgeStarting;
        function done() { bridgeStarting = null; }
        bridgeStarting = new Promise(function (resolve) {
            function plain() { try { tz.application.launch(BRIDGE_ID, resolve, resolve); } catch (e) { resolve(); } }
            try {
                tz.application.launchAppControl(new tz.ApplicationControl("http://tizen.org/appcontrol/operation/service"),
                                                BRIDGE_ID, resolve, plain);
            } catch (e) { plain(); }
        }).then(function () { return waitBridge(Date.now() + 12000); });
        bridgeStarting.then(done, done);
        return bridgeStarting;
    }
    /* Before Tizen 7 (The Frame 2022 on 6.5, #21) the bridge's answers never came back through the trusted
       port alone. There the launcher also attaches its port to each request, and opens a plain port the
       bridge can answer through (bridge/service.js tries them in turn and logs which one works). Never on
       Tizen 9: its service router crashes when a request carries a port. */
    var oldTizen = null;
    function isOldTizen() {
        if (oldTizen === null) {
            oldTizen = safe(function () {
                return parseFloat(tz.systeminfo.getCapability("http://tizen.org/feature/platform.version")) < 7;
            }, false) === true;
        }
        return oldTizen;
    }
    var plainReplyPort = null;
    function onReply(data) {
        var m = {};
        for (var i = 0; i < data.length; i++) m[data[i].key] = data[i].value;
        var p = pending[m.id];
        if (!p) return;
        // Large answers arrive in several pieces (a piece sent again by another port counts once)
        var part = parseInt(m.part, 10) || 0;
        if (p.chunks[part] === undefined) p.got++;
        p.chunks[part] = m.body || "";
        if (p.got < (parseInt(m.parts, 10) || 1)) return;
        delete pending[m.id]; clearTimeout(p.timer);
        p.resolve({ status: parseInt(m.status, 10) || 0, body: p.chunks.join("") });
    }
    function ensureReplyPort() {
        if (replyPort) return replyPort;
        replyPort = tz.messageport.requestTrustedLocalMessagePort("APL_BRIDGE_REPLY");
        replyPort.addMessagePortListener(onReply);
        if (isOldTizen() && !plainReplyPort) {
            try {
                plainReplyPort = tz.messageport.requestLocalMessagePort("APL_BRIDGE_REPLY_PLAIN");
                plainReplyPort.addMessagePortListener(onReply);
            } catch (e) {}
        }
        return replyPort;
    }
    function bridgeRequest(method, path, body, waitMs) {
        if (PREVIEW || !tz || !tz.messageport || Date.now() < bridgeDownUntil) return Promise.reject(new Error("bridge unavailable"));
        function send() {
            return new Promise(function (resolve, reject) {
                var remote = tz.messageport.requestTrustedRemoteMessagePort(BRIDGE_ID, BRIDGE_PORT);   // throws if not started
                ensureReplyPort();
                var id = String(++seq);
                pending[id] = { resolve: resolve, chunks: [], got: 0, timer: setTimeout(function () { delete pending[id]; reject(new Error("timeout")); }, waitMs || 60000) };
                // No port attached on Tizen 7 and newer: the service answers through its own trusted port (see bridge/service.js)
                var msg = [{ key: "id", value: id }, { key: "method", value: method },
                           { key: "path", value: path }, { key: "body", value: body || "" }];
                if (isOldTizen()) {
                    try { remote.sendMessage(msg, replyPort); return; } catch (e) {}
                }
                remote.sendMessage(msg);
            });
        }
        return send().catch(function (e) {
            if (e && e.message === "timeout") throw e;
            return startBridge().then(send);                 // bridge not started yet: start it
        }).catch(function (e) {
            bridgeDownUntil = Date.now() + 5000;              // bridge missing: try again 5 s later
            throw e;
        });
    }
    /* Tells the bridge whether the launcher is in front: if the screen goes to sleep on it, the
       bridge brings it back at wake-up on screens that come back on the TV input (bridge/service.js). */
    function bridgeFront(visible) {
        if (PREVIEW || !tz || !tz.messageport) return;
        function send() {
            tz.messageport.requestTrustedRemoteMessagePort(BRIDGE_ID, BRIDGE_PORT).sendMessage([{ key: "front", value: visible ? "1" : "0" }]);
        }
        try { send(); } catch (e) { if (visible) startBridge().then(send).catch(function () {}); }
    }
    if (!PREVIEW && !P && global.document) {
        document.addEventListener("visibilitychange", function () { bridgeFront(!document.hidden); });
        setTimeout(function () { if (!document.hidden) bridgeFront(true); }, 5000);
    }
    function vetroGet(path) {
        return bridgeRequest("GET", path, "").then(function (r) {
            if (r.status >= 400) throw new Error("Vetro " + r.status);
            return JSON.parse(r.body);
        }, function () {
            return global.fetch(vetroUrl(path)).then(function (r) { if (!r.ok) throw new Error("Vetro " + r.status); return r.json(); },
                function () { throw new Error(APL.t("Vetro is not responding")); });
        });
    }
    function vetroPost(path, body) {
        var text = JSON.stringify(body);
        return bridgeRequest("POST", path, text).then(function (r) {
            try { return JSON.parse(r.body); } catch (e) { return {}; }
        }, function () {
            // Without the bridge: the order still goes to Vetro, with no readable answer
            return global.fetch(vetroUrl(path), { method: "POST", mode: "no-cors", headers: { "content-type": "text/plain" }, body: text })
                .then(function () { return { sent: true }; });
        });
    }
    /* Is Vetro answering? (cached for 30 s) */
    var aliveAt = 0, alive = false;
    function vetroAlive() {
        if (PREVIEW) return Promise.resolve(false);
        if (Date.now() - aliveAt < 30000) return Promise.resolve(alive);
        return vetroGet("/status").then(function (s) { notePort(s); return !!s && !(s.agent && s.agent.connected === false); },
                                        function () { return false; })
            .then(function (ok) { alive = ok; aliveAt = Date.now(); return ok; });
    }
    // Bridge started early: Control Center and Settings respond right away
    if (!PREVIEW && !P) setTimeout(function () { vetroAlive(); }, 4000);

    /* Settings › Support › About This Screen: how the launcher reaches Vetro. Through the bridge it reads the
       answers; without it orders still go out (Bluetooth connects) but nothing can be read back, so the
       picture settings say Unavailable. For reports (issue #21, Tizen 6.5). */
    function vetroLink() {
        if (PREVIEW) return Promise.resolve(APL.t("Preview"));
        // 1. Does the bridge get the request and answer at all? The web bridge answers this one itself,
        //    without Vetro (bridge/service.js); the .NET bridge says "not relayed", which is an answer too.
        var t0 = Date.now(), info = null;
        return bridgeRequest("GET", "/bridge-info", "", 10000).then(function (r) {
            try { info = JSON.parse(r.body); } catch (e) {}
            // 2. Then a command through Vetro
            t0 = Date.now();
            return bridgeRequest("POST", "/exec", JSON.stringify({ cmd: "true" }), 20000).then(function (x) {
                var ok = false, why = "";
                try { var j = JSON.parse(x.body); ok = j.ok !== false; why = String(j.error || j.stderr || "").slice(0, 80); } catch (e) {}
                // Vetro answers but runs nothing (an S95C on Tizen 9, Reddit): most often its root agent is not
                // connected, which Vetro says ("no root agent connected"). Shown as it is.
                var port = (info && info.port) || vetroPortNum;
                return (ok ? APL.t("Through the bridge") : APL.t("Bridge: Vetro refused")) + " (" + (Date.now() - t0) + " ms" +
                       (info && info.reached ? ", " + info.reached : "") + (port !== 8099 ? ", " + APL.t("port {port}", { port: port }) : "") +
                       (!ok && why ? ", " + why : "") + ")";
            }, function () {
                // The bridge answers but Vetro doesn't: the addresses it tried and how they failed
                var tried = [];
                if (info && info.errors) Object.keys(info.errors).forEach(function (h) { tried.push(h + " " + info.errors[h]); });
                return APL.t("Bridge works, Vetro unreachable") + (tried.length ? ": " + tried.join(" · ") : "");
            });
        }, function (e) {
            return APL.t("Bridge: {error}", { error: e && e.message === "timeout" ? APL.t("no answer at all") : ((e && e.message) || "?") });
        });
    }

    /* Root command on the screen, through Vetro and the bridge. No backslashes in commands: Vetro doubles them. */
    function tvExec(cmd) {
        return vetroPost("/exec", { cmd: cmd }).then(function (r) {
            if (!r || r.sent) throw new Error(APL.t("Vetro is not responding (open Vetro once on the screen)"));
            return r;
        });
    }

    /* ---------- picture and Game Mode: the screen's AV service (D-Bus) ----------
       Answers look like "ii <value> <code>", with code 0 when all is well. */
    var AVOC = "busctl --system call org.tizen.tv.avoc /org/tizen/tv/avoc org.tizen.tv.avoc.AvOutputControl ";
    var PICTURE = [
        { id: "backlight", get: "GetBacklight i 0", set: "SetBacklight ii", min: 0, max: 50 },
        { id: "contrast", get: "GetContrast i 0", set: "SetContrast yi", min: 0, max: 50 },
        { id: "sharpness", get: "GetSharpness i 0", set: "SetSharpness yi", min: 0, max: 20 },
        { id: "color", get: "GetColorStrength i 0", set: "SetColorStrength yi", min: 0, max: 50 },
        { id: "pictureMode", get: "GetPictureMode i 0", set: "SetPictureMode ii", coded: true }
    ];
    /* Modes in this screen's Samsung list, noted on the M8 (Game Mode forces another one). */
    var PICTURE_MODES = [[65536, APL.t("Dynamic")], [65537, "Standard"], [65552, APL.t("Eco")], [65538, APL.t("Movie")]];
    var GAME_PICTURE = 458769;
    function pictureModeName(v) {
        if (v === GAME_PICTURE) return APL.t("Game");
        for (var i = 0; i < PICTURE_MODES.length; i++) if (PICTURE_MODES[i][0] === v) return PICTURE_MODES[i][1];
        return APL.t("Automatic");
    }
    function answerValue(line) { return parseInt(String(line || "").trim().split(/\s+/)[1], 10); }

    var MOCK_TV = [
        { id: "backlight", writable: true, value: 32, min: 0, max: 50 },
        { id: "contrast", writable: true, value: 45, min: 0, max: 50 },
        { id: "sharpness", writable: true, value: 10, min: 0, max: 20 },
        { id: "color", writable: true, value: 25, min: 0, max: 50 },
        { id: "pictureMode", writable: true, value: 65537, coded: true }
    ];
    var tvCache = null, tvAt = 0, tvPending = null;
    function tvSettings(force) {
        if (PREVIEW) return Promise.resolve(MOCK_TV);
        if (!force && tvCache && Date.now() - tvAt < 8000) return Promise.resolve(tvCache);
        if (tvPending) return tvPending;
        // Everything is read at once: a single command, much faster than Vetro's /tv-settings
        var cmd = PICTURE.map(function (p) { return "echo " + p.id + " $(" + AVOC + p.get + " 2>/dev/null)"; }).join("; ");
        tvPending = tvExec(cmd).then(function (r) {
            var byId = {};
            String(r.output || "").split("\n").forEach(function (l) {
                var w = l.trim().split(/\s+/);
                if (w.length >= 4) byId[w[0]] = { value: parseInt(w[2], 10), code: parseInt(w[3], 10) };
            });
            tvCache = PICTURE.filter(function (p) { return byId[p.id] && byId[p.id].code === 0; }).map(function (p) {
                return { id: p.id, writable: true, value: byId[p.id].value, min: p.min, max: p.max, coded: !!p.coded, def: p };
            });
            tvAt = Date.now(); tvPending = null;
            return tvCache;
        }, function (e) { tvPending = null; throw e; });
        return tvPending;
    }
    /* Writes a value and reads it back: the value read back is what counts. The last argument is 1:
       the screen saves the value (with 0, it applies but the screen forgets it in under a second). */
    function tvWrite(it, want) {
        var p = it.def;
        return tvExec(AVOC + p.set + " " + want + " 1 2>&1; " + AVOC + p.get + " 2>&1").then(function (r) {
            var lines = String(r.output || "").trim().split("\n");
            var back = answerValue(lines[lines.length - 1]);
            if (isNaN(back)) throw new Error(APL.t("The screen did not respond"));
            it.value = back;
            if (back !== want) throw new Error(APL.t("The screen refused this setting for now"));
            return back;
        });
    }
    /* On the M8, Standard has its backlight and contrast at 0 (black picture, unreadable menus):
       in that case a mode takes over the values of the mode being left. */
    function setPictureMode(v) {
        if (PREVIEW) { MOCK_TV[MOCK_TV.length - 1].value = v; return Promise.resolve(v); }
        return tvSettings(true).then(function (before) {
            var old = {};
            before.forEach(function (it) { old[it.id] = it; });
            if (!old.pictureMode) throw new Error(APL.t("Picture Mode unavailable"));
            return tvWrite(old.pictureMode, v).then(function (back) {
                return tvSettings(true).then(function (now) {
                    var next = Promise.resolve();
                    now.forEach(function (it) {
                        if ((it.id === "backlight" || it.id === "contrast") && it.value === 0 && old[it.id] && old[it.id].value > 0) {
                            next = next.then(function () { return tvWrite(it, old[it.id].value); });
                        }
                    });
                    return next.then(function () { tvCache = null; return back; });
                });
            });
        });
    }

    /* Game Mode: the screen accepts it once an input (HDMI, USB-C) has been shown since
       power-on. Before that, the request is held (gameWanted) and sent when switching to an input. */
    var game = {
        get: function () {
            if (PREVIEW) return Promise.resolve({ available: true, on: !!pref("gameWanted") });
            return tvExec(AVOC + "CheckGameMode 2>&1; " + AVOC + "GetGameMode i 0 2>&1").then(function (r) {
                var lines = String(r.output || "").trim().split("\n");
                var available = answerValue(lines[0]) === 1;
                if (available && pref("gameWanted")) setPref("gameWanted", false);
                return { available: available, on: available ? answerValue(lines[1]) === 1 : !!pref("gameWanted"),
                         pending: !available && !!pref("gameWanted") };
            });
        },
        set: function (on) {
            if (PREVIEW) { setPref("gameWanted", !!on); return Promise.resolve({ available: true, on: !!on }); }
            return game.get().then(function (g) {
                if (!g.available) {
                    setPref("gameWanted", !!on);
                    return { available: false, on: !!on, pending: !!on };
                }
                return tvExec(AVOC + "SetGameMode ii 1 " + (on ? 1 : 0) + " 2>&1; sleep 1; " + AVOC + "GetGameMode i 0 2>&1").then(function (r) {
                    var lines = String(r.output || "").trim().split("\n");
                    var now = answerValue(lines[lines.length - 1]) === 1;
                    tvCache = null;
                    if (now !== !!on) throw new Error(APL.t("The screen refused Game Mode for now"));
                    return { available: true, on: now };
                });
            });
        },
        /* As soon as the input shows, the launcher goes to the background and does nothing more:
           the command is handed to the screen before leaving, and it waits for the input to be ready. */
        applyOnInput: function () {
            if (PREVIEW || !pref("gameWanted")) return Promise.resolve();
            var sent = tvExec("(for i in 1 2 3 4 5 6 7 8 9 10; do sleep 2; if [ \"$(" + AVOC + "CheckGameMode)\" = \"i 1\" ]; then " +
                              AVOC + "SetGameMode ii 1 1; break; fi; done) >/dev/null 2>&1 &").catch(function () {});
            return Promise.race([sent, new Promise(function (resolve) { setTimeout(resolve, 1500); })]);
        }
    };
    /* The screen's other settings: AV service (D-Bus) or vconf, read and written directly, as
       above. All tried on the M8: write, read back, restore. "--": negative values.
       V = the value. No backslashes: Vetro doubles them. */
    var NATIVE = {
        tint:       { get: "GetColorTint i 0", set: "SetColorTint yi -- V 1", min: 0, max: 30 },
        shadow:     { get: "GetBrightness i 0", set: "SetBrightness ii -- V 1", min: -5, max: 5 },
        gamma:      { get: "GetGamma i 0", set: "SetGamma ii -- V 1", min: -3, max: 3 },
        blur:       { get: "GetBlurReduction i 0", set: "SetBlurReduction iy -- 1 V", min: 0, max: 10 },
        judder:     { get: "GetJuddlerReduction i 0", set: "SetJuddlerReduction iy -- 1 V", min: 0, max: 10 },
        balance:    { get: "GetBalance u 0", set: "SetBalance uu -- V 1", min: 0, max: 20 },
        delay:      { get: "GetDelay u 0", set: "SetDelay uu -- V 1", min: 0, max: 250, step: 10 },
        eq0:        { get: "GetEqualizer uu 0 0", set: "SetEqualizer iii -- 0 V 1", min: 0, max: 100, step: 10 },
        eq1:        { get: "GetEqualizer uu 1 0", set: "SetEqualizer iii -- 1 V 1", min: 0, max: 100, step: 10 },
        eq2:        { get: "GetEqualizer uu 2 0", set: "SetEqualizer iii -- 2 V 1", min: 0, max: 100, step: 10 },
        eq3:        { get: "GetEqualizer uu 3 0", set: "SetEqualizer iii -- 3 V 1", min: 0, max: 100, step: 10 },
        eq4:        { get: "GetEqualizer uu 4 0", set: "SetEqualizer iii -- 4 V 1", min: 0, max: 100, step: 10 },
        contrastUp: { get: "GetDynamicContrast i 0", set: "SetDynamicContrast ii -- V 1" },
        colorTone:  { get: "GetColorToneMode i 0", set: "SetColorToneMode ii -- V 1" },
        colorSpace: { get: "GetColorSpace i 0", set: "SetColorSpace ii -- V 1" },
        clarity:    { get: "GetAutoMotionPlus i 0", set: "SetAutoMotionPlus ii -- V 1" },
        eyeSaver:   { get: "GetEyeSaverMode i 0", set: "SetEyeSaverMode ii -- V 1" },
        adaptive:   { get: "GetAdaptivePicture", set: "SetAdaptivePicture i -- V" },
        energy:     { get: "GetEnergySaving i 0", set: "SetEnergySaving ii -- 1 V" },
        ecoSensor:  { get: "GetEcoSensor i 0", set: "SetEcoSensor ii -- 1 V" },
        hdmiBlack:  { get: "GetHdmiBlackLevel i 0", set: "SetHdmiBlackLevel ii -- V 1" },
        earc:       { get: "GetEarcEnable", set: "SetEarcEnable i -- V" },
        soundMode:  { get: "GetSoundMode u 0", set: "SetSoundMode uu -- V 1" },
        autoVolume: { get: "GetAutoVolume u 0", set: "SetAutoVolume uu -- V 1" },
        feedback:   { get: "GetSoundFeedback i 0", set: "SetSoundFeedback ii -- 1 V" },
        /* The screen's home app (db/appfw/home_appid). At power-on the screen puts either the TV input or the
           home app in front, and Autorun Smart Hub chooses the home app: with the launcher as home app, it is
           on screen about a second after power-on instead of after the start-up service (~1 min). Autorun
           also opened Samsung's home at every wake: APL Overlay turns it off while the screen sleeps and
           on again once it is awake (overlay/Autorun.cs). Off: the screen's own home app again, as the
           firmware records it in db/first_screen/type. */
        homeApp:    { home: true }
    };
    var HOME_KEY = "db/appfw/home_appid", AUTOSTART_KEY = "db/menu/smart_hub/ontvsetting/auto_start";
    var MOCK_NATIVE = {};
    function nativeGet(id) {
        var d = NATIVE[id];
        if (PREVIEW) return Promise.resolve(MOCK_NATIVE[id] || (d.min !== undefined ? Math.round((d.min + d.max) / 2) : 0));
        if (d.home) {
            // On only if both took: with Autorun off the screen still starts on the TV input
            return withTimeout(homeAppRead(), 15000).then(function (s) { return s.home === "APLauncher.Home" && s.autostart === 1 ? 1 : 0; });
        }
        if (d.vconf) {
            return tvExec("vconftool get " + d.vconf + " 2>&1").then(function (r) {
                var m = /value = (-?[0-9]+)/.exec(String(r.output || ""));
                if (!m) throw new Error(APL.t("Unavailable"));
                return parseInt(m[1], 10);
            });
        }
        return tvExec(AVOC + d.get + " 2>&1").then(function (r) {
            var w = String(r.output || "").trim().split(/\s+/);
            if (w.length < 3 || w[w.length - 1] !== "0") throw new Error(APL.t("Unavailable"));
            return parseInt(w[1], 10);
        });
    }
    /* Writes then reads back: the value read back is what counts. */
    function nativeSet(id, value) {
        var d = NATIVE[id];
        if (PREVIEW) { MOCK_NATIVE[id] = value; return Promise.resolve(value); }
        // Start on APL Launcher first: it has no D-Bus method, and reading d.set below threw before anything was
        // written, so OK only showed "…" on every screen (an S90F). The timeout covers the read back too.
        if (d.home) return withTimeout(homeAppSet(value).then(function (r) { return homeAppCheck(value, r); }), 20000);
        var write = d.vconf ? "vconftool set -f -t int " + d.vconf + " " + value + " 2>&1" : AVOC + d.set.replace("V", value) + " 2>&1";
        return tvExec(write).then(function () { return nativeGet(id); }).then(function (back) {
            if (back !== value) throw new Error(APL.t("The screen refused this setting for now"));
            return back;
        });
    }
    function withTimeout(p, ms) {
        return new Promise(function (resolve, reject) {
            var t = setTimeout(function () {
                reject(new Error(APL.t("The screen didn't answer within {s} s. Try again in a minute.", { s: Math.round(ms / 1000) })));
            }, ms);
            p.then(function (v) { clearTimeout(t); resolve(v); }, function (e) { clearTimeout(t); reject(e); });
        });
    }
    /* Start on APL Launcher read back. When the screen doesn't keep it, the message says what it kept
       (and what vconftool answered, when it said anything): "refused" alone told nobody why. */
    function homeAppCheck(value, written) {
        return homeAppRead().then(function (s) {
            var back = s.home === "APLauncher.Home" && s.autostart === 1 ? 1 : 0;
            if (back === value) return back;
            var said = String((written && written.output) || "").replace(/\s+/g, " ").trim().slice(0, 90);
            throw new Error(APL.t("The screen kept {app} as its home app, Autorun Smart Hub {state}.",
                                  { app: s.home, state: s.autostart === 1 ? APL.t("on") : APL.t("off") }) + (said ? " " + said : ""));
        });
    }
    function homeAppRead() {
        return tvExec("vconftool get " + HOME_KEY + " 2>&1; vconftool get " + AUTOSTART_KEY + " 2>&1").then(function (r) {
            var out = String(r.output || ""), h = /home_appid, value = (\S+)/.exec(out), a = /auto_start, value = (-?[0-9]+)/.exec(out);
            if (!h || !a) throw new Error(APL.t("Unavailable"));
            return { home: h[1], autostart: parseInt(a[1], 10) };
        });
    }
    /* On: saves the screen's home app and Autorun as they are, then makes the launcher the home app and
       turns Autorun on. Off: puts back exactly what was saved; without a saved value, the home app the
       firmware records in db/first_screen/type, then Samsung's home, and Autorun off. */
    var APP_ID_RE = /^[A-Za-z0-9._-]{1,120}$/;
    function homeAppSet(value) {
        return homeAppRead().then(function (cur) {
            if (value === 1) {
                if (cur.home !== "APLauncher.Home") setPref("homeAppSaved", { home: cur.home, autostart: cur.autostart });
                return tvExec("vconftool set -f -t string " + HOME_KEY + " APLauncher.Home 2>&1; vconftool set -f -t int " + AUTOSTART_KEY + " 1 2>&1");
            }
            var saved = pref("homeAppSaved") || {};
            var home = saved.home && saved.home !== "APLauncher.Home" && APP_ID_RE.test(saved.home) ? saved.home : null;
            var autostart = saved.autostart === 1 ? 1 : 0;
            var setHome = home ? "vconftool set -f -t string " + HOME_KEY + " " + home + " 2>&1"
                : "h=$(vconftool get db/first_screen/type 2>/dev/null | awk '{print $4}'); " +
                  "if [ -z \"$h\" ] || [ \"$h\" = APLauncher.Home ]; then h=com.samsung.tv.csfs; fi; " +
                  "vconftool set -f -t string " + HOME_KEY + " \"$h\" 2>&1";
            return tvExec(setHome + "; vconftool set -f -t int " + AUTOSTART_KEY + " " + autostart + " 2>&1").then(function (r) {
                setPref("homeAppSaved", null);
                return r;
            });
        });
    }
    function nativeReset(method) { return PREVIEW ? Promise.resolve() : tvExec(AVOC + method + " 2>&1"); }

    function tvItem(id) {
        return tvSettings().then(function (items) {
            for (var i = 0; i < items.length; i++) if (items[i].id === id) return items[i];
            return null;
        });
    }
    /* Gradual adjustment (◀ ▶): the displayed value changes right away, the write
       goes out 350 ms after the last key press, one at a time. */
    var tvTimers = {}, tvWriting = {};
    function tvAdjust(id, delta, onChange) {
        return tvItem(id).then(function (it) {
            if (!it || !it.writable) throw new Error(APL.t("Setting unavailable for now"));
            if (it.target === undefined) it.target = it.value;
            it.target = Math.max(it.min, Math.min(it.max, it.target + delta));
            if (onChange) onChange(it.target, it);
            clearTimeout(tvTimers[id]);
            tvTimers[id] = setTimeout(function flush() {
                if (tvWriting[id]) { tvTimers[id] = setTimeout(flush, 150); return; }
                if (it.target === it.value) return;
                if (PREVIEW) { it.value = it.target; return; }
                tvWriting[id] = true;
                tvWrite(it, it.target).then(function () {
                    tvWriting[id] = false;
                }, function (e) {
                    tvWriting[id] = false;
                    it.target = it.value;
                    tvCache = null;
                    if (onChange) onChange(it.value, it);
                    if (global.APL && global.APL.toast) global.APL.toast(e.message);
                });
            }, 350);
            return it.target;
        });
    }
    function tvValue(id) {
        return tvItem(id).then(function (it) { return it ? (it.target !== undefined ? it.target : it.value) : null; });
    }

    /* ---------- navigation sounds (synthesized, no file) ---------- */
    var actx = null;
    function blip(freq, dur, vol) {
        if (!pref("uiSounds")) return;
        try {
            if (!actx) { var AC = global.AudioContext || global.webkitAudioContext; if (!AC) return; actx = new AC(); }
            if (actx.state === "suspended" && actx.resume) actx.resume();
            // A few milliseconds in and out: a sound that starts or stops at full level is a snap in the
            // speakers ("like breaking plastic", Reddit, on an S93F), on top of the TV's own key sound
            var t = actx.currentTime + 0.005, o = actx.createOscillator(), g = actx.createGain();
            o.type = "sine"; o.frequency.setValueAtTime(freq, t);
            g.gain.setValueAtTime(0.0001, t);
            g.gain.linearRampToValueAtTime(vol, t + 0.006);
            g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
            g.gain.linearRampToValueAtTime(0, t + dur + 0.01);
            o.connect(g); g.connect(actx.destination); o.start(t); o.stop(t + dur + 0.03);
        } catch (e) {}
    }
    /* Interface sounds: the files launcher/sounds/navigate.wav, click.wav and
       back.wav if they are there (your real sounds), decoded once into memory and played
       through WebAudio (almost no latency). Otherwise, small synthesized clicks. */
    var buffers = {}, players = {}, FILES = { navigate: "sounds/navigate.wav", click: "sounds/click.wav", back: "sounds/back.wav" };
    // Fallback if the file cannot be read into memory (e.g. page opened from disk)
    function loadPlayer(k) {
        try {
            var a = new global.Audio(FILES[k]);
            a.preload = "auto";
            a.addEventListener("canplaythrough", function () { if (!buffers[k]) players[k] = a; });
        } catch (e) {}
    }
    function loadSounds() {
        var AC = global.AudioContext || global.webkitAudioContext;
        Object.keys(FILES).forEach(function (k) {
            if (!AC || !global.XMLHttpRequest) { loadPlayer(k); return; }
            try {
                var x = new XMLHttpRequest();
                x.open("GET", FILES[k], true);
                x.responseType = "arraybuffer";
                x.onload = function () {
                    if (!x.response || (x.status && x.status !== 200 && x.status !== 0)) return;
                    try {
                        if (!actx) actx = new AC();
                        var done = function (buf) { buffers[k] = buf; };
                        var pr = actx.decodeAudioData(x.response, done, function () {});
                        if (pr && pr.then) pr.then(done, function () {});
                    } catch (e) {}
                };
                x.onerror = function () { loadPlayer(k); };
                x.send();
            } catch (e) { loadPlayer(k); }
        });
    }
    function play(k, rate, vol) {
        if (!pref("uiSounds")) return !!(buffers[k] || players[k]);
        var buf = buffers[k];
        if (!buf && players[k]) {
            try {
                var a = players[k];
                a.volume = vol || 1;
                a.playbackRate = rate || 1;
                a.currentTime = 0;
                var pr = a.play();
                if (pr && pr.catch) pr.catch(function () {});
            } catch (e) {}
            return true;
        }
        if (!buf) return false;
        try {
            if (actx.state === "suspended" && actx.resume) actx.resume();
            var src = actx.createBufferSource(), g = actx.createGain();
            src.buffer = buf;
            if (rate) src.playbackRate.value = rate;
            g.gain.value = vol || 1;
            src.connect(g); g.connect(actx.destination);
            src.start(0);
        } catch (e) {}
        return true;
    }
    var sound = {
        tick: function () { if (!play("navigate")) blip(2100, 0.022, 0.045); },
        select: function () { if (!play("click")) blip(1250, 0.06, 0.07); },
        back: function () { if (!play("back")) blip(900, 0.05, 0.06); },
        // Edge of the grid: the navigation sound, lower and softer
        edge: function () { if (!play("navigate", 0.72, 0.6)) blip(420, 0.05, 0.05); }
    };
    if (global.document && document.readyState !== "loading") setTimeout(loadSounds, 300);
    else if (global.document) document.addEventListener("DOMContentLoaded", function () { setTimeout(loadSounds, 300); });

    global.APL = global.APL || {};
    global.APL.sound = sound;
    global.APL.sys = {
        PREVIEW: PREVIEW,
        pref: pref, setPref: setPref, onPref: onPref, profiles: profiles,
        setDefault: function (k, v) { DEFAULTS[k] = v; },     // another platform's defaults (android.js)
        audio: audio, network: network, product: product, display: display, storage: storage, hdr: hdr,
        remoteKey: remoteKey, openSamsungSettings: openSamsungSettings, sleepNow: sleepNow,
        switchSource: switchSource, vetroAlive: vetroAlive, vetroLink: vetroLink,
        vetroUrl: vetroUrl, vetroPort: function () { return vetroPortNum; },
        noVetro: function () { return noVetro; },
        registerKeys: registerKeys, armSleepTimer: armSleepTimer, readSleepTimer: readSleepTimer,
        vetroGet: vetroGet, vetroPost: vetroPost, exec: tvExec, appsInfo: appsInfo, game: game, runningApps: runningApps,
        native: { get: nativeGet, set: nativeSet, reset: nativeReset, info: function (id) { return NATIVE[id]; } },
        isOled: function () { return OLED; },
        PICTURE_MODES: PICTURE_MODES, pictureModeName: pictureModeName, setPictureMode: setPictureMode,
        tvSettings: tvSettings, tvItem: tvItem, tvAdjust: tvAdjust, tvValue: tvValue,
        version: (global.APL_UPDATE && global.APL_UPDATE.running) || "1.0.0"
    };
    if (P && P.adaptSys) P.adaptSys(global.APL.sys, { DEFAULTS: DEFAULTS });
})(window);
