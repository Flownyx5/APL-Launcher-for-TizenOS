/* ============================================================
   APL Launcher's helper on LG TVs (webOS JS service com.knikt.apllauncher.service).

   What a Developer Mode app may not do through luna (list the installed apps,
   read the app in front, set the volume, change input, turn the TV off…), the
   TV's own remote-control API does (ssap.js): the TV asks once, on screen,
   whether to allow it. This service holds that connection for the launcher
   and relays its requests; the launcher keeps the key the TV gives.

   It only answers APL Launcher itself (the caller's app id is checked), and
   stays awake while the launcher listens to it or a sleep timer runs (webOS
   stops idle services after a few seconds).

   Methods (luna://com.knikt.apllauncher.service/…):
     connect   {key, subscribe}  -> {state, key?} now and at each change
     request   {uri, payload}    -> {payload}           one SSAP request
     subscribe {uri, payload, subscribe:true} -> {payload}… an SSAP subscription
     button    {name}            -> {}                  a remote button (HOME, BACK…)
     sleep     {minutes}         -> {at}                turns the TV off later (0: cancel)
     status    {}                -> state, sleep timer, versions, the last steps
     devmode   {extend}          -> {hours} left in Developer Mode, renewed below 960 h
     luna      {uri, payload}    -> {payload}           on a rooted TV only, a short list of LG's own calls
     memory    {}                -> {kb}                memory available, swap included
     home      {apl?}            -> state, or Home to APL Launcher / LG's Home (rooted TV)
   and the apps' icons and backgrounds on http://127.0.0.1:8767 (below).
   ============================================================ */
"use strict";

var Service = require("webos-service");
var os = require("os");
var fs = require("fs");
var http = require("http");
var https = require("https");
var ssap = require("./ssap.js");
var pkg = require("./package.json");

var ID = "com.knikt.apllauncher.service", APP = "com.knikt.apllauncher";
var GUIDE = "com.webos.app.livemenu";       // LG's Guide app: a see-through page of APL Launcher on a rooted TV (webos/root/guide)
var CC_HOST = "com.webos.app.firstuse-overlay";     // where the Control Center is drawn over the apps (webos/root/cchost)
var service = new Service(ID);
var client = null, key = "";
/* The key the TV gave, kept for this boot: restarted (an update, the app manager), the service must not ask
   the TV again, which put LG's "allow this app?" question over whatever was on screen */
var KEY_FILE = "/tmp/com.knikt.apllauncher.key";
try { key = fs.readFileSync(KEY_FILE, "utf8").trim(); } catch (e) {}
function keepKey(k) { try { fs.writeFileSync(KEY_FILE, k, { mode: 384 }); } catch (e) {} }
var listeners = {}, keep = null, keepWanted = 0;
var sleepTimer = null, sleepAt = 0;

/* ---------- staying awake ---------- */
function stayAwake() {
    if (keep) return;
    try { service.activityManager.create("keepAlive", function (activity) { keep = activity; }); } catch (e) {}
}
function maybeSleep() {
    if (Object.keys(listeners).length || sleepTimer || !keep || ROOT) return;     // rooted: it watches for the Guide button
    try { service.activityManager.complete(keep, function () {}); } catch (e) {}
    keep = null;
}

/* ---------- who may call ---------- */
function caller(message) {
    var s = "";
    try { s = String(message.sender || message.senderId || ""); } catch (e) {}
    return s;
}
/* The launcher (com.knikt.apllauncher, its windows "com.knikt.apllauncher-123…"), or a developer at the
   TV's own shell (luna-send-pub). No other app gets the TV's remote API through this service. On a rooted TV,
   LG's first-use overlay app is given APL Launcher's own app info by apl-home.sh (webos/root/cchost): it shows
   the launcher's Control Center over the apps, so it may too, but only while that app info is the one in place. */
var CC_MOUNT = /\s\/usr\/palm\/applications\/com\.webos\.app\.firstuse-overlay\s/, ccOursAt = 0, ccOurs = false;
function ccHostIsOurs() {
    if (Date.now() - ccOursAt > 10000) {
        ccOursAt = Date.now();
        try { ccOurs = CC_MOUNT.test(fs.readFileSync("/proc/mounts", "utf8")); } catch (e) { ccOurs = false; }
    }
    return ccOurs;
}
function allowed(message) {
    var s = caller(message);
    if (s === APP || s.indexOf(APP + "-") === 0 || s.indexOf("com.webos.lunasendpub") === 0) return true;
    return s.indexOf(CC_HOST + "-") === 0 && ccHostIsOurs();
}
function guard(fn) {
    return function (message) {
        if (!allowed(message)) {
            message.respond({ returnValue: false, errorText: "not allowed for " + (caller(message) || "?") });
            return;
        }
        try { fn(message); } catch (e) { message.respond({ returnValue: false, errorText: String(e && e.message || e) }); }
    };
}

/* ---------- the TV's remote API ---------- */
function tv() {
    if (client) return client;
    // The TV itself, then its own network addresses (in case its remote API only listens there)
    var hosts = ["127.0.0.1"];
    try {
        var nets = os.networkInterfaces();
        Object.keys(nets).forEach(function (n) {
            (nets[n] || []).forEach(function (a) { if (a.family === "IPv4" && !a.internal) hosts.push(a.address); });
        });
    } catch (e) {}
    client = new ssap.Client({ key: key, hosts: hosts });
    client.on("key", function (k) { key = k; keepKey(k); broadcast({ state: client.state, key: k }); });
    client.on("state", function (s) { broadcast({ state: s, error: client.error || undefined }); });
    return client;
}
function broadcast(m) {
    m.returnValue = true;
    Object.keys(listeners).forEach(function (t) { try { listeners[t].respond(m); } catch (e) { delete listeners[t]; } });
}

var connect = service.register("connect", guard(function (message) {
    var p = message.payload || {};
    if (p.key && typeof p.key === "string" && p.key !== key) {
        key = p.key;
        keepKey(key);
        if (client) { client.key = key; }
    }
    var c = tv();
    if (message.isSubscription) {
        listeners[message.uniqueToken] = message;
        stayAwake();
    }
    message.respond({ returnValue: true, subscribed: !!message.isSubscription, state: c.state, key: c.key || undefined });
    c.connect().catch(function () {});
}));
connect.on("cancel", function (message) {
    delete listeners[message.uniqueToken];
    maybeSleep();
});

service.register("request", guard(function (message) {
    var p = message.payload || {};
    if (!/^ssap:\/\//.test(String(p.uri || ""))) { message.respond({ returnValue: false, errorText: "uri must be ssap://" }); return; }
    tv().request(p.uri, p.payload || {}, p.timeout || 20000).then(function (r) {
        message.respond({ returnValue: true, payload: r });
    }, function (e) {
        message.respond({ returnValue: false, errorText: e.message, state: tv().state });
    });
}));

var subs = {};
var sub = service.register("subscribe", guard(function (message) {
    var p = message.payload || {};
    if (!message.isSubscription || !/^ssap:\/\//.test(String(p.uri || ""))) {
        message.respond({ returnValue: false, errorText: "a subscription to an ssap:// uri" });
        return;
    }
    listeners[message.uniqueToken] = message;
    stayAwake();
    subs[message.uniqueToken] = tv().subscribe(p.uri, p.payload || {}, function (payload) {
        message.respond({ returnValue: true, payload: payload });
    }, function () {
        message.respond({ returnValue: false, errorText: "connection closed", state: tv().state });
    });
}));
sub.on("cancel", function (message) {
    var end = subs[message.uniqueToken];
    if (end) end();
    delete subs[message.uniqueToken];
    delete listeners[message.uniqueToken];
    maybeSleep();
});

service.register("button", guard(function (message) {
    var name = String((message.payload || {}).name || "");
    if (!/^[A-Z0-9_]{1,24}$/i.test(name)) { message.respond({ returnValue: false, errorText: "bad button" }); return; }
    tv().button(name).then(function () { message.respond({ returnValue: true }); },
                           function (e) { message.respond({ returnValue: false, errorText: e.message }); });
}));

/* ---------- sleep timer: the launcher is in the background when it is needed ---------- */
service.register("sleep", guard(function (message) {
    var min = Math.max(0, Math.min(600, parseInt((message.payload || {}).minutes, 10) || 0));
    if (sleepTimer) { clearTimeout(sleepTimer); sleepTimer = null; }
    sleepAt = min ? Date.now() + min * 60000 : 0;
    if (min) {
        stayAwake();
        sleepTimer = setTimeout(function () {
            sleepTimer = null; sleepAt = 0;
            tv().request("ssap://system/turnOff", {}).catch(function () {});
            maybeSleep();
        }, min * 60000);
    } else {
        maybeSleep();
    }
    message.respond({ returnValue: true, at: sleepAt });
}));

service.register("status", guard(function (message) {
    var c = tv();
    message.respond({ returnValue: true, version: pkg.version, node: process.version, root: ROOT, state: c.state, error: c.error || undefined,
                      host: c.host, origin: c.origin, unsigned: c.unsigned, sleepAt: sleepAt, caller: caller(message), listeners: Object.keys(listeners).length,
                      log: ssap.log.slice(-30) });
}));

service.register("ping", function (message) { message.respond({ returnValue: true }); });

/* ---------- on a rooted TV ----------
   The Homebrew Channel's elevate-service (webos/root/) runs this service as root with every luna permission.
   The launcher then gets what LG keeps for its own menus, and only that: the picture and sound settings,
   the apps running, closing one. Nothing else is relayed. */
var ROOT = !!(process.getuid && process.getuid() === 0);
var LUNA_OK = {
    "luna://com.webos.settingsservice/getSystemSettings": 1,
    "luna://com.webos.settingsservice/getSystemSettingDesc": 1,
    "luna://com.webos.settingsservice/setSystemSettings": 1,
    "luna://com.webos.applicationManager/running": 1,
    "luna://com.webos.applicationManager/getForegroundAppInfo": 1,
    "luna://com.webos.applicationManager/closeByAppId": 1
};
var SETTINGS_OK = { picture: 1, sound: 1 };
service.register("luna", guard(function (message) {
    var p = message.payload || {}, uri = String(p.uri || ""), args = p.payload || {};
    if (!ROOT) { message.respond({ returnValue: false, errorText: "not rooted", notRooted: true }); return; }
    if (!LUNA_OK[uri]) { message.respond({ returnValue: false, errorText: "not allowed: " + uri }); return; }
    if (/\/(get|set)System/.test(uri) && !SETTINGS_OK[args.category]) { message.respond({ returnValue: false, errorText: "category not allowed" }); return; }
    var done = false;
    var timer = setTimeout(function () { if (!done) { done = true; message.respond({ returnValue: false, errorText: "no answer" }); } }, 15000);
    service.call(uri, args, function (m) {
        if (done) return;
        done = true; clearTimeout(timer);
        var r = m && m.payload || {};
        message.respond({ returnValue: true, payload: r });
    });
}));

/* Delete App (hold OK on an app): {id}. Only what LG itself lets you delete (getAppInfo: removable, not a
   system app), never APL Launcher or the Homebrew Channel. Store apps go through LG's installer, apps
   installed in Developer Mode or by the Homebrew Channel through its developer side. Answers once the app is
   really gone (getAppInfo no longer knows it), within 40 s. */
var NO_REMOVE = /^(com\.knikt\.apllauncher|org\.webosbrew\.)/;
service.register("remove", guard(function (message) {
    var id = String((message.payload || {}).id || "");
    if (!ROOT) { message.respond({ returnValue: false, errorText: "not rooted", notRooted: true }); return; }
    if (!/^[A-Za-z0-9._-]{1,120}$/.test(id) || NO_REMOVE.test(id)) { message.respond({ returnValue: false, errorText: "not allowed" }); return; }
    var done = false;
    function answer(m) { if (done) return; done = true; message.respond(m); }
    function info(cb) {
        service.call("luna://com.webos.applicationManager/getAppInfo", { id: id }, function (m) {
            var p = m && m.payload || {};
            cb(p.returnValue !== false && p.appInfo ? p.appInfo : null);
        });
    }
    info(function (a) {
        if (!a) { answer({ returnValue: false, errorText: "not installed" }); return; }
        if (a.removable !== true || a.systemApp) { answer({ returnValue: false, errorText: "system app", system: true }); return; }
        var dev = /^\/media\/developer\//.test(String(a.folderPath || ""));
        service.call(dev ? "luna://com.webos.appInstallService/dev/remove" : "luna://com.webos.appInstallService/remove",
                     { id: id }, function () {});
        var tries = 0;
        (function check() {
            setTimeout(function () {
                info(function (still) {
                    if (!still) { answer({ returnValue: true, removed: true }); return; }
                    if (++tries < 20) check(); else answer({ returnValue: false, errorText: "still installed" });
                });
            }, 2000);
        })();
    });
}));

/* Home opens APL Launcher, or LG's own Home (webos/root/bin/apl-home.sh and apl-home-undo.sh). {} reads the
   state; {apl: true|false} switches now and for the next starts (OFF-home). The app manager restarts: the
   screen goes black a few seconds, and the launcher's page with it. */
var ROOT_DIR = "/media/developer/apl-debloat", HOME_RE = /\s\/usr\/palm\/applications\/com\.webos\.app\.home\s/;
service.register("home", guard(function (message) {
    if (!ROOT) { message.respond({ returnValue: false, errorText: "not rooted", notRooted: true }); return; }
    var p = message.payload || {}, off = ROOT_DIR + "/OFF-home", replaced = false;
    try { replaced = HOME_RE.test(fs.readFileSync("/proc/mounts", "utf8")); } catch (e) {}
    var installed = fs.existsSync(ROOT_DIR + "/apl-home.sh") && fs.existsSync(ROOT_DIR + "/apl-home-undo.sh");
    if (typeof p.apl !== "boolean") {
        message.respond({ returnValue: true, installed: installed, replaced: replaced, off: fs.existsSync(off) });
        return;
    }
    if (!installed) { message.respond({ returnValue: false, errorText: "webos/root/install.sh is not installed" }); return; }
    try {
        if (p.apl) { if (fs.existsSync(off)) fs.unlinkSync(off); }
        else fs.writeFileSync(off, "");
    } catch (e) { message.respond({ returnValue: false, errorText: e.code || String(e) }); return; }
    message.respond({ returnValue: true, apl: p.apl });
    setTimeout(function () {
        require("child_process").spawn("sh", [ROOT_DIR + (p.apl ? "/apl-home.sh" : "/apl-home-undo.sh")],
                                       { detached: true, stdio: "ignore" }).unref();
    }, 400);
}));

/* ---------- the Guide button ----------
   apl-home.sh puts a blank page in place of LG's Guide (com.webos.app.livemenu, webos/root/guide/). When the
   TV opens it, the Control Center of APL Launcher opens instead, saying which app was in front so that Back
   goes back to it. The app manager's life events tell both. Rooted TV only; OFF-guide turns it off. */
var lastApp = "", guideAt = 0;
var NOT_AN_APP = /^(com\.webos\.app\.(home|livemenu|starfish.*|.*systemui.*|quicksettings|volume.*)|com\.knikt\.apllauncher)$/;
function onLife(p) {
    var id = String(p.appId || ""), ev = String(p.event || "");
    idleLife(id, ev);
    if (ev === "foreground") {
        if (id === APP || id === "com.webos.app.home") lastApp = "";
        else if (!NOT_AN_APP.test(id)) lastApp = id;
    }
    // One press gives "launch", then "foreground" up to 2 s later: once per press, or the panel opened and closed
    if (id === GUIDE && (ev === "splash" || ev === "launch" || ev === "foreground") && Date.now() - guideAt > 4000) {
        guideAt = Date.now();
        service.call("luna://com.webos.applicationManager/closeByAppId", { id: GUIDE }, function () {});
        frontNow(function (front) {
            // Over the launcher itself: its own Control Center, with its glass
            if (!front) { ccLauncher(""); return; }
            ccHostReady(function (ready) {
                if (!ready) { ccLauncher(front); return; }
                ssap.note("Guide: Control Center drawn over " + front);
                service.call("luna://com.webos.applicationManager/launch", { id: CC_HOST, params: { apl: "cc" } }, function (m) {
                    if (m && m.payload && m.payload.returnValue === false) ccLauncher(front);
                });
            });
        });
    }
}
/* The launcher in front with its Control Center open, the app it was opened over coming back with Back: over the
   launcher, and until the TV restarts once with the app info of webos/root/cchost (it reads it at its start) */
function ccLauncher(front) {
    ssap.note("Guide: Control Center over " + (front || "the launcher"));
    service.call("luna://com.webos.applicationManager/launch", { id: APP, params: { apl_action: "controlcenter", from: front } }, function () {});
}
/* The app in front ("" for the launcher or LG's Home): the TV says, the windows drawn over the apps left out */
function frontNow(cb) {
    service.call("luna://com.webos.applicationManager/getForegroundAppInfo", {}, function (m) {
        var id = String(m && m.payload && m.payload.appId || "");
        if (id === APP || id === "com.webos.app.home") id = "";
        else if (!id || NOT_AN_APP.test(id) || id === CC_HOST) id = lastApp;     // not known, a panel: the last app seen
        cb(id);
    });
}
/* Is the Control Center's window ready over the apps? The TV has APL Launcher's app info for it (its vendor, a
   window over the apps, cc.html) only once it restarted after apl-home.sh put it in place. */
var hostAt = 0, hostIs = false;
function ccHostReady(cb) {
    if (Date.now() - hostAt < 30000) { cb(hostIs); return; }
    service.call("luna://com.webos.applicationManager/getAppInfo", { id: CC_HOST }, function (m) {
        var a = (m && m.payload && m.payload.appInfo) || {};
        hostIs = a.defaultWindowType === "overlay" && /Knikt/.test(String(a.vendor || "")) &&
                 /\/cc\.html$/.test(String(a.main || "")) && ccHostIsOurs();
        hostAt = Date.now();
        cb(hostIs);
    });
}

/* ---------- the Control Center over the apps (the Guide button) ----------
   launcher/cc.html opens the launcher's own page (?apl=cc) in the window over the app in front. Its storage is
   that app's: the launcher's settings are kept here for it (ccSave, given each time an app opens over the
   launcher), and what it changes (Do Not Disturb) goes back to the launcher (back). In RAM, and in /tmp in case
   the service restarts; the remote API's key is in it, so the file is root's alone. */
var CC_FILE = "/tmp/apl-cc-state.json", ccStore = {}, ccBack = null;
try { var ccWas = JSON.parse(fs.readFileSync(CC_FILE, "utf8")); ccStore = ccWas.store || {}; ccBack = ccWas.back || null; } catch (e) {}
service.register("ccSave", guard(function (message) {
    var p = message.payload || {};
    if (p.store && typeof p.store === "object") {
        var s = {}, size = 0;
        Object.keys(p.store).slice(0, 80).forEach(function (k) {
            var v = p.store[k];
            if (/^apl\./.test(k) && typeof v === "string" && (size += k.length + v.length) < 512 * 1024) s[k] = v;
        });
        ccStore = s;
    }
    if ("back" in p) ccBack = p.back && typeof p.back === "object" ? { dnd: !!p.back.dnd, at: Date.now() } : null;
    try { fs.writeFileSync(CC_FILE, JSON.stringify({ store: ccStore, back: ccBack }), { mode: 384 }); } catch (e) {}
    message.respond({ returnValue: true });
}));
/* over: the app the Control Center is drawn over */
service.register("ccState", guard(function (message) {
    frontNow(function (front) { message.respond({ returnValue: true, over: front, store: ccStore, back: ccBack }); });
}));
function watchApps() {
    var sub = service.subscribe("luna://com.webos.applicationManager/getAppLifeEvents", { subscribe: true });
    ssap.note("watching app launches for Guide");
    sub.on("response", function (m) {
        var p = m && m.payload || {};
        if (!fs.existsSync(ROOT_DIR + "/OFF-guide")) onLife(p);
        else idleLife(String(p.appId || ""), String(p.event || ""));
    });
    sub.on("cancel", function () { setTimeout(watchApps, 5000); });
}

/* ---------- Close Unused Apps (rooted TV), as APL Overlay does on Samsung ----------
   An app left 10 minutes in the background closes on its own; one the TV opened by itself and you never used
   (LG Channels, which LG keeps preloaded) after 1 minute. Never the app in front, the launcher and its Home
   page, live TV, the inputs, AirPlay, nor an app playing sound or video. The TV keeps its memory, and the
   launcher stays smooth. Settings › Apps › Close Unused Apps turns it off (service "idle"). */
var idleOn = true, bgSince = {}, hidden = {}, frontApp = "";
var NEVER_CLOSE = /^(com\.knikt\.apllauncher|com\.webos\.app\.(home|livetv|hdmi\d*|inputcommon|livemenu|firstuse-overlay|.*systemui.*|airplay|screensaver|tvhotkey)|airplay)$/;
var PRELOADED = { "com.webos.app.lgchannels": 1 };
function idleLife(id, ev) {
    if (!id) return;
    if (ev === "foreground") { frontApp = id; delete bgSince[id]; delete hidden[id]; }
    else if (ev === "background") { bgSince[id] = Date.now(); if (frontApp === id) frontApp = ""; }
    else if (ev === "launch" || ev === "splash") { if (frontApp !== id && !(id in bgSince)) { hidden[id] = true; bgSince[id] = Date.now(); } }
    else if (ev === "close" || ev === "stop") { delete bgSince[id]; delete hidden[id]; }
}
// The apps that play sound or video now (the media server's pipelines): never closed
function playing(cb) {
    service.call("luna://com.webos.media/getActivePipelines", {}, function (m) {
        var out = {}, list = m && m.payload;
        (Array.isArray(list) ? list : []).forEach(function (p) {
            var id = String(p.appid || p.appId || "");
            if (id && p.type !== "vtclient") out[id] = true;
        });
        cb(out);
    });
}
function idleTick() {
    if (!idleOn || fs.existsSync(ROOT_DIR + "/OFF-idleclose")) return;
    service.call("luna://com.webos.applicationManager/running", {}, function (m) {
        var apps = (m && m.payload && m.payload.running) || [];
        playing(function (busy) {
            var now = Date.now();
            apps.forEach(function (a) {
                var id = String(a.id || "");
                if (!id || id === frontApp || NEVER_CLOSE.test(id) || busy[id]) return;
                if (!(id in bgSince)) { bgSince[id] = now; if (PRELOADED[id]) hidden[id] = true; return; }   // first seen behind: counted from now
                var limit = hidden[id] ? 60000 : 10 * 60000;
                if (now - bgSince[id] < limit) return;
                service.call("luna://com.webos.applicationManager/closeByAppId", { id: id }, function () {});
                ssap.note("closed " + id + (hidden[id] ? " (opened by the TV, never used)" : " (10 min in the background)"));
                delete bgSince[id]; delete hidden[id];
            });
        });
    });
}
service.register("idle", guard(function (message) {
    var p = message.payload || {};
    if (typeof p.on === "boolean") idleOn = p.on;
    message.respond({ returnValue: true, on: idleOn, root: ROOT });
}));
if (ROOT) {
    stayAwake();
    watchApps();
    service.call("luna://com.webos.applicationManager/getForegroundAppInfo", {}, function (m) { frontApp = String(m && m.payload && m.payload.appId || frontApp); });
    setInterval(idleTick, 30000);
}

/* ---------- APL TV's Top Shelf ----------
   APL TV writes what you were watching in /tmp/apltv-shelf.json (its own service, POST /shelf): titles,
   pictures, progress, no address and no account. A page cannot read a file: this hands that one file
   over, cut down to what the launcher shows. No root needed (services share /tmp). */
var SHELF_FILE = "/tmp/apltv-shelf.json";
service.register("shelf", guard(function (message) {
    fs.stat(SHELF_FILE, function (err, st) {
        if (err || !st.isFile() || st.size > 400000) { message.respond({ returnValue: false, errorText: "no shelf" }); return; }
        fs.readFile(SHELF_FILE, "utf8", function (e, txt) {
            var s = null;
            try { s = JSON.parse(txt); } catch (x) {}
            if (e || !s || typeof s !== "object") { message.respond({ returnValue: false, errorText: "no shelf" }); return; }
            message.respond({ returnValue: true, shelf: {
                app: s.app, at: s.at,
                continueWatching: Array.isArray(s.continueWatching) ? s.continueWatching.slice(0, 4) : [],
                lastChannel: s.lastChannel || null
            } });
        });
    });
}));

service.register("memory", guard(function (message) {
    fs.readFile("/proc/meminfo", "utf8", function (err, txt) {
        if (err) { message.respond({ returnValue: false, errorText: err.code || "meminfo" }); return; }
        var kb = 0;
        String(txt).split("\n").forEach(function (l) {
            var m = /^(MemAvailable|SwapFree):\s+(\d+)/.exec(l);
            if (m) kb += parseInt(m[2], 10);
        });
        message.respond({ returnValue: true, kb: kb });
    });
}));

/* ---------- Developer Mode: never let it run out ----------
   When LG's Developer Mode session runs out (1000 hours), the TV deletes every app installed through it,
   this launcher, APL TV and the Homebrew Channel included, and it must be set up again. The Developer
   Mode app's Extend button asks LG's server to start the 1000 hours again, with the session token the
   TV keeps; the launcher does the same once a day, as soon as fewer than 960 hours are left. */
var DEV_TOKEN = "/var/luna/preferences/devmode_enabled";
function lge(what, token) {
    return new Promise(function (resolve, reject) {
        https.get("https://developer.lge.com/secure/" + what + ".dev?sessionToken=" + encodeURIComponent(token), { timeout: 15000 }, function (r) {
            var body = "";
            r.on("data", function (d) { body += d; });
            r.on("end", function () { try { resolve(JSON.parse(body)); } catch (e) { reject(new Error("LG: " + body.slice(0, 80))); } });
        }).on("error", reject).on("timeout", function () { this.destroy(new Error("LG didn't answer")); });
    });
}
function hoursLeft(r) {
    var m = /^(\d+):(\d+)/.exec(String(r && r.errorMsg || ""));
    return r && r.result === "success" && m ? parseInt(m[1], 10) + parseInt(m[2], 10) / 60 : null;
}
service.register("devmode", guard(function (message) {
    var token = "";
    try { token = fs.readFileSync(DEV_TOKEN, "utf8").trim(); } catch (e) {}
    if (!/^[0-9a-f]{20,128}$/i.test(token)) { message.respond({ returnValue: false, errorText: "no Developer Mode session on this TV" }); return; }
    var extend = !!(message.payload || {}).extend, extended = false;
    lge("CheckDevModeSession", token).then(function (r) {
        var h = hoursLeft(r);
        if (h === null) throw new Error("LG: " + (r && r.errorMsg || "?"));
        if (!extend || h >= 960) return h;
        return lge("ResetDevModeSession", token).then(function () { return lge("CheckDevModeSession", token); }).then(function (r2) {
            var h2 = hoursLeft(r2);
            extended = h2 !== null && h2 > h;
            ssap.note("Developer Mode: " + Math.floor(h) + " h left, " + (extended ? "renewed: " + Math.floor(h2) + " h" : "renewal refused"));
            return h2 === null ? h : h2;
        });
    }).then(function (h) {
        message.respond({ returnValue: true, hours: Math.floor(h), extended: extended });
    }, function (e) {
        message.respond({ returnValue: false, errorText: e.message });
    });
}));

/* ---------- the apps' icons and backgrounds ----------
   The TV gives its apps' icons on https://127.0.0.1:3001 (its own certificate, which the launcher's page
   refuses) and their backgrounds as files of the apps (which the page can't read). Both are served here,
   on this TV only (127.0.0.1), with the header that lets the launcher read their colours (its Top Shelf
   artwork is made from them, as on Samsung):
     http://127.0.0.1:8767/icon?u=<https://127.0.0.1:3001/resources/…>
     http://127.0.0.1:8767/file?p=</media/cryptofs/apps/usr/palm/applications/<app>/…png> */
var ART_PORT = 8767;
var ICON_RE = /^https?:\/\/127\.0\.0\.1:300[01]\/resources\/[A-Za-z0-9]+\/[^?#]+$/;
var FILE_RE = /^\/(media\/cryptofs\/apps\/usr|usr|mnt\/otncabi\/usr|media\/developer\/apps\/usr)\/palm\/applications\/[A-Za-z0-9._-]+\/[^?#]+\.(png|jpe?g|webp)$/i;
var TYPES = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp" };
var cache = {}, cacheOrder = [], CACHE_MAX = 120;
function remember(k, v) {
    if (!cache[k]) { cacheOrder.push(k); if (cacheOrder.length > CACHE_MAX) delete cache[cacheOrder.shift()]; }
    cache[k] = v;
}
function sendImage(res, img) {
    res.writeHead(200, { "Content-Type": img.type, "Access-Control-Allow-Origin": "*", "Cache-Control": "max-age=86400" });
    res.end(img.body);
}
function proxyIcon(src, k, res) {
    src = src.replace(/^http:\/\/127\.0\.0\.1:3000\//, "https://127.0.0.1:3001/");
    https.get(src, { rejectUnauthorized: false, timeout: 8000 }, function (r) {
        var parts = [];
        r.on("data", function (d) { parts.push(d); });
        r.on("end", function () {
            if (r.statusCode !== 200) { res.writeHead(r.statusCode || 502); res.end(); return; }
            var img = { type: r.headers["content-type"] || "image/png", body: Buffer.concat(parts) };
            remember(k, img);
            sendImage(res, img);
        });
    }).on("error", function () { res.writeHead(502); res.end(); });
}
var artServer = null;
function startArt() {
    if (artServer) return;
    artServer = http.createServer(function (req, res) {
        var u;
        try { u = new URL(req.url, "http://127.0.0.1"); } catch (e) { res.writeHead(400); res.end(); return; }
        var k = u.pathname + "?" + u.search;
        if (cache[k]) { sendImage(res, cache[k]); return; }
        if (u.pathname === "/icon") {
            var src = String(u.searchParams.get("u") || ""), xl = String(u.searchParams.get("xl") || "");
            var srcOk = ICON_RE.test(src) && src.indexOf("..") === -1, xlOk = FILE_RE.test(xl) && xl.indexOf("..") === -1;
            if (!srcOk && !xlOk) { res.writeHead(403); res.end(); return; }
            // The app's own 192 px icon first (sharper on the Home Screen), then the one the TV serves
            if (xlOk) {
                fs.readFile(xl, function (err, body) {
                    if (!err && body.length) {
                        var img = { type: TYPES[xl.split(".").pop().toLowerCase()] || "image/png", body: body };
                        remember(k, img);
                        sendImage(res, img);
                    } else if (srcOk) proxyIcon(src, k, res);
                    else { res.writeHead(404); res.end(); }
                });
                return;
            }
            proxyIcon(src, k, res);
            return;
        }
        if (u.pathname === "/file") {
            var p = String(u.searchParams.get("p") || "");
            if (!FILE_RE.test(p) || p.indexOf("..") !== -1) { res.writeHead(403); res.end(); return; }
            fs.readFile(p, function (err, body) {
                if (err) { res.writeHead(404); res.end(); return; }
                var img = { type: TYPES[p.split(".").pop().toLowerCase()] || "image/png", body: body };
                if (body.length < 3000000) remember(k, img);
                sendImage(res, img);
            });
            return;
        }
        res.writeHead(404); res.end();
    });
    artServer.on("error", function (e) { ssap.note("art server: " + (e.code || e.message)); artServer = null; });
    artServer.listen(ART_PORT, "127.0.0.1");
}
startArt();
