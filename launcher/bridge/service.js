/* ============================================================
   bridge/service.js — private bridge between the launcher and Vetro.

   Vetro (http://127.0.0.1:8099) does not let the screen's apps read
   its answers (CORS). This service (same package as the launcher, started
   by it when needed and when the screen starts) makes the request on its behalf
   and sends the answer back. At start-up, it also opens the launcher.

   Security: NO network port is opened. The launcher and this service
   talk through trusted Tizen "message ports": only apps
   signed with the same certificate as this package can use them.
   Only the paths the launcher needs are relayed. The service
   stops on its own after 15 minutes without a request.

   Tizen 9: services go through a router (service_runner.js) that
   crashes if the app attaches a trusted reply port to its message.
   So the launcher sends its request with no port attached, and this service answers
   through its own trusted port to APL_BRIDGE_REPLY. Large
   answers are sent in several pieces (message port limit).

   Wake-up: some screens (The Frame 2025) come back on the TV input
   after sleep, even when the launcher was in front at power-off, and
   have no "Autorun Last App" setting. The launcher says when it is in
   front; the service then stays started and brings it back.
   ============================================================ */
"use strict";

var http = require("http");
var fs = require("fs");
var os = require("os");

var PORT_NAME = "APL_BRIDGE";
var APP_ID = "APLauncher.Home", REPLY_PORT = "APL_BRIDGE_REPLY";
/* Tizen 9 refuses 127.0.0.1 to services (EHOSTUNREACH), but not the same local address written in IPv6.
   Some screens (The Frame 2025) silently drop both: the connection hangs ~2 min, then ETIMEDOUT.
   The screen's own LAN address works there (Vetro listens on every interface). */
var HOSTS = ["::ffff:127.0.0.1", "127.0.0.1"].concat(lanAddresses()), VETRO_PORT = 8099, hostIndex = 0;
/* req.setTimeout never fires on these screens: own timers, one to connect, one for the answer. */
var CONNECT_MS = 5000;
var ALLOWED = /^\/(status|screen|tv-settings|tv-menu|exec|components\/action|control|apps)(\/|\?|$)/;
var IDLE_MS = 15 * 60 * 1000;
var CHUNK = 4000;                       // characters per message (at most 12 KB once encoded)
var BOOT_WINDOW_S = 240, LAUNCH_TRIES = 5;
/* Going to sleep, the screen hides the launcher and sets memory/pm/state (1 = on); about 17 s
   later it freezes the apps, and the timer then misses its ticks (the fallback signal). */
var SLEEP_CHECKS = 4, POLL_MS = 3000, TICK_MS = 5000, ASLEEP_MS = 20000, HIDDEN_GRACE_MS = 45000;
var WAKE_WATCH_MS = 90000, SETTLE_MS = 15000;
/* The Frame: Art Mode hides the launcher but the screen stays on (memory/pm/state 1). Leaving it with the
   power key shows the TV input: watched while Art Mode is in front. */
var ART_APP = /^org\.tizen\.art-app$/, ART_POLL_MS = 1500;
var STATE = "vconftool get memory/pm/state; vconftool get memory/appfw/current_fullscreen_appid; vconftool get memory/system/source_type";

var port = null, idle = null, openedAtBoot = false;
var remote = null;                      // phone remote: { server, token, code, codeUntil, tries } (see the end of this file)
var lastReport = "";                    // the launcher's last diagnostic, readable from the phone remote
var startedAt = upSeconds();            // seconds since the screen started, when this service started
var vetroWake = { busy: false, at: 0, how: "", uptime: 0 };   // last time Vetro had to be woken up (see wakeVetro)
var launcherFront = false, hiddenAt = 0, lastTick = Date.now(), ticking = null, sleeping = false, waking = false, inArt = false;

function stopLater() {
    clearTimeout(idle);
    // Stays while the launcher is in front or the screen sleeps on it, to bring it back at wake-up
    if (launcherFront || sleeping || waking || inArt || vetroWake.busy || (remote && remote.server)) return;
    idle = setTimeout(function () {
        try { tizen.application.getCurrentApplication().exit(); } catch (e) {}
    }, IDLE_MS);
}

function field(data, key) {
    for (var i = 0; i < data.length; i++) if (data[i].key === key) return String(data[i].value);
    return "";
}

function answer(id, status, body) {
    var back;
    try { back = tizen.messageport.requestTrustedRemoteMessagePort(APP_ID, REPLY_PORT); } catch (e) { return; }
    body = String(body || "");
    var parts = Math.max(1, Math.ceil(body.length / CHUNK));
    for (var i = 0; i < parts; i++) {
        try {
            back.sendMessage([{ key: "id", value: id }, { key: "status", value: String(status) },
                              { key: "part", value: String(i) }, { key: "parts", value: String(parts) },
                              { key: "body", value: body.substr(i * CHUNK, CHUNK) }]);
        } catch (e) {}
    }
}

function onMessage(data) {
    var rc = field(data, "remote");
    if (rc) { remoteConfig(rc); return; }
    var report = field(data, "report");
    if (report) { lastReport = report.slice(0, 20000); stopLater(); return; }
    if (field(data, "vetro") === "wake") { wakeVetro(); stopLater(); return; }
    var front = field(data, "front");
    if (front) {                        // the launcher came in front ("1") or left it ("0")
        launcherFront = front === "1";
        if (!launcherFront) { hiddenAt = Date.now(); checkSleep(SLEEP_CHECKS); }
        stopLater();
        return;
    }
    stopLater();
    var id = field(data, "id"), method = field(data, "method") || "GET", path = field(data, "path"), body = field(data, "body");
    if (path === "/__bridge/state") {               // Diagnostic: how this service and Vetro started
        answer(id, 200, JSON.stringify({ startedAt: startedAt, uptime: upSeconds(), vetroWake: vetroWake }));
        return;
    }
    if (!ALLOWED.test(path) || (method !== "GET" && method !== "POST")) {
        answer(id, 404, '{"error":"not relayed"}');
        return;
    }
    vetro(method, path, Buffer.from(body || "", "utf8"), 150000, function (status, text) { answer(id, status, text); });
}

/* The screen's IPv4 addresses on the network, tried after the two loopback forms. */
function lanAddresses() {
    var out = [];
    try {
        var nets = os.networkInterfaces();
        Object.keys(nets).forEach(function (name) {
            nets[name].forEach(function (a) { if (a.family === "IPv4" && !a.internal) out.push(a.address); });
        });
    } catch (e) {}
    return out;
}

/* A request to Vetro; done(status, text) is called once. */
function vetro(method, path, buf, timeoutMs, done, retries) {
    if (retries === undefined) retries = HOSTS.length - 1;
    var host = HOSTS[hostIndex], finished = false, timer = null;
    function finish(status, text) {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        done(status, text);
    }
    function fail(e) {
        if (finished) return;
        // The request did not go out (refused, or no answer to connect): try the next address
        if (retries > 0 && /EHOSTUNREACH|EACCES|ECONNREFUSED|ENETUNREACH|EINVAL|ETIMEDOUT|EAFNOSUPPORT|EADDRNOTAVAIL/.test(e.code)) {
            finished = true;
            clearTimeout(timer);
            if (HOSTS[hostIndex] === host) hostIndex = (hostIndex + 1) % HOSTS.length;
            vetro(method, path, buf, timeoutMs, done, retries - 1);
            return;
        }
        finish(502, JSON.stringify({ ok: false, error: "Vetro unreachable: " + e.message }));
    }
    var req = http.request({
        host: host, port: VETRO_PORT, path: path, method: method,
        headers: { "Content-Type": "application/json", "Content-Length": buf.length }
    }, function (res) {
        var chunks = [];
        res.on("data", function (c) { chunks.push(c); });
        res.on("end", function () { finish(res.statusCode || 502, Buffer.concat(chunks).toString("utf8")); });
    });
    req.on("error", fail);
    timer = setTimeout(function () {
        var e = new Error("no answer from " + host); e.code = "ETIMEDOUT";
        fail(e);
        try { req.abort(); } catch (x) {}
    }, CONNECT_MS);
    req.on("socket", function (sock) {
        // Connected: a slow answer is only a timeout, the address is kept
        function connected() {
            clearTimeout(timer);
            timer = setTimeout(function () {
                finish(504, JSON.stringify({ ok: false, error: "Vetro did not answer in time" }));
                try { req.abort(); } catch (x) {}
            }, timeoutMs);
        }
        if (sock.connecting) sock.once("connect", connected); else connected();
    });
    req.end(buf);
}

/* ---------- wake-up ----------
   Back from sleep, if the launcher was in front at power-off: when the screen shows the TV input
   (antenna, no device) or Samsung's home, the launcher is opened again. An HDMI input (a console
   that switched the screen on), an app or the launcher itself are left alone. Vetro restarts its
   agent at wake-up: it answers again after about 15 s. */
function shell(command, done) {
    var buf = Buffer.from(JSON.stringify({ cmd: command }), "utf8");
    vetro("POST", "/exec", buf, 20000, function (status, text) {
        var out = "";
        try { out = String(JSON.parse(text).output || ""); } catch (e) {}
        done(out);
    });
}
function vconfValue(out, key) { return (new RegExp(key + ", value = (\\S+)").exec(out) || [])[1]; }

/* Screen state, app in front and source in one read: { pm: "1", app: "appId", source: 0 }. */
function readState(done) {
    shell(STATE, function (out) {
        done({ pm: vconfValue(out, "memory/pm/state"), app: vconfValue(out, "current_fullscreen_appid"),
               source: parseInt(vconfValue(out, "source_type"), 10) });
    });
}
/* The screen shows the TV input (antenna, no device) or Samsung's home: the launcher should come back. */
function onTvInput(st) { return !!st.app && ((/tv-viewer/.test(st.app) && st.source === 0) || /csfs|home\.sidebar/.test(st.app)); }

/* The launcher was just hidden: by another app, by Art Mode, or by the screen going to sleep? */
function checkSleep(tries) {
    if (sleeping || waking || inArt) return;
    readState(function (st) {
        if (st.pm && st.pm !== "1") { sleeping = true; stopLater(); watchWake(); return; }
        if (st.app && ART_APP.test(st.app)) { inArt = true; stopLater(); watchArt(); return; }
        if (tries > 1 && !launcherFront) setTimeout(function () { checkSleep(tries - 1); }, 1000);
    });
}
/* The reading that shows the wake is passed on: Vetro restarts its agent a moment later and only
   answers again after about 15 s, so reading again would keep the TV input on screen meanwhile. */
function watchWake() {
    readState(function (st) {
        if (st.pm === "1") { sleeping = false; wokeUp(true, st); return; }
        setTimeout(watchWake, POLL_MS);
    });
}
/* Art Mode in front: wait until it is left. To the TV input or Samsung's home, the launcher comes back;
   to an HDMI input (a device that switched the screen on) or another app, nothing is done. */
function watchArt() {
    if (launcherFront || !inArt) { inArt = false; stopLater(); return; }
    readState(function (st) {
        if (launcherFront) { inArt = false; stopLater(); return; }
        if (st.pm && st.pm !== "1") { inArt = false; sleeping = true; stopLater(); watchWake(); return; }   // Art Mode, then off
        if (!st.app || ART_APP.test(st.app)) { setTimeout(watchArt, ART_POLL_MS); return; }
        inArt = false;
        if (onTvInput(st)) { try { tizen.application.launch(APP_ID, function () {}, function () {}); } catch (e) {} }
        stopLater();
    });
}

/* Fallback: the apps were frozen during the sleep. */
function tick() {
    var now = Date.now();
    if (now - lastTick > ASLEEP_MS) wokeUp(launcherFront || sleeping || (hiddenAt > 0 && lastTick - hiddenAt < HIDDEN_GRACE_MS));
    lastTick = now;
}

function wokeUp(wasFront, first) {
    if (waking || !wasFront) return;
    waking = true;
    var until = Date.now() + WAKE_WATCH_MS, launcherSince = 0;
    function done() { waking = false; stopLater(); }
    function decided(st) {               // true when nothing more is needed
        if (!st || !st.app) return false;
        if (onTvInput(st)) {
            try { tizen.application.launch(APP_ID, function () {}, function () {}); } catch (e) {}
            return true;
        }
        if (st.app !== APP_ID) return true;
        if (!launcherSince) launcherSince = Date.now();
        return Date.now() - launcherSince > SETTLE_MS;                          // the screen came back on it
    }
    if (decided(first)) { done(); return; }
    (function look() {
        readState(function (st) {
            if (decided(st) || Date.now() > until) { done(); return; }
            setTimeout(look, POLL_MS);
        });
    })();
}

/* ---------- Vetro wake-up ----------
   Vetro's service should start with the screen, but on some screens its installer drops the
   "start at boot" flag (Vetro puts it back from 0.3.2, once opened), and after a full start it
   takes up to 90 s. If Vetro still doesn't answer about 130 s after the screen started (or when
   the launcher finds it silent), its service is started from here; if the screen refuses that,
   Vetro's app is opened for a few seconds, the time for its service to start, then the launcher
   comes back to the front. At most once every 5 minutes. */
var VETRO_APP = "vetrotvapp.app", VETRO_SVC = "vetrotvapp.svc", VETRO_READY_S = 130;
function upSeconds() { try { return parseFloat(fs.readFileSync("/proc/uptime", "utf8")) || 0; } catch (e) { return 0; } }
function vetroAnswers(done) {
    vetro("GET", "/status", Buffer.from("", "utf8"), 4000, function (status) { done(status === 200); });
}
function waitVetro(ms, done) {
    var until = Date.now() + ms;
    (function look() {
        vetroAnswers(function (ok) {
            if (ok || Date.now() >= until) { done(ok); return; }
            setTimeout(look, 2500);
        });
    })();
}
function startVetroService(done) {
    var called = false;
    function once(v) { if (!called) { called = true; done(v); } }
    function plain() { try { tizen.application.launch(VETRO_SVC, function () { once(true); }, function () { once(false); }); } catch (e) { once(false); } }
    try {
        tizen.application.launchAppControl(new tizen.ApplicationControl("http://tizen.org/appcontrol/operation/service"),
                                           VETRO_SVC, function () { once(true); }, plain);
    } catch (e) { plain(); }
    setTimeout(function () { once(false); }, 8000);
}
function wakeVetro() {
    if (vetroWake.busy || Date.now() - vetroWake.at < 5 * 60000) return;
    var up = upSeconds();
    if (up && up < VETRO_READY_S) {                        // full start: leave Vetro its 90 s first
        setTimeout(wakeVetro, (VETRO_READY_S - up) * 1000);
        return;
    }
    vetroWake.busy = true;
    function done(how) {
        vetroWake.busy = false;
        vetroWake.at = Date.now();
        vetroWake.how = how;
        vetroWake.uptime = Math.round(upSeconds());
        stopLater();
    }
    vetroAnswers(function (ok) {
        if (ok) { vetroWake.busy = false; return; }        // it answers: nothing to do
        startVetroService(function (started) {
            waitVetro(started ? 30000 : 0, function (ok2) {
                if (ok2) { done("service"); return; }
                // Started from here is refused (another package's service): Vetro's own app starts it
                try {
                    tizen.application.launch(VETRO_APP, function () {
                        waitVetro(60000, function (ok3) {
                            // Vetro's app was opened from here: the launcher comes back in front
                            try { tizen.application.launch(APP_ID, function () {}, function () {}); } catch (e) {}
                            done(ok3 ? "app" : "failed");
                        });
                    }, function () { done("failed"); });
                } catch (e) { done("failed"); }
            });
        });
    });
}

function start() {
    stopLater();
    if (!ticking) ticking = setInterval(tick, TICK_MS);
    if (port) return;
    port = tizen.messageport.requestTrustedLocalMessagePort(PORT_NAME);
    port.addMessagePortListener(onMessage);
}

/* Full start-up (power cut, restart): the screen comes back on its last input and,
   with no device plugged in, its HDMI page puts it to sleep at about 78 s. This service starts with the screen,
   at about 57 s (on-boot, config.xml): opening the launcher cancels the countdown. Started later
   by the launcher, it does nothing. */
function isBooting() {
    try { return parseFloat(fs.readFileSync("/proc/uptime", "utf8")) < BOOT_WINDOW_S; } catch (e) { return false; }
}
function openLauncher(tries) {
    if (openedAtBoot || tries <= 0 || !isBooting()) return;
    function again() { setTimeout(function () { openLauncher(tries - 1); }, 3000); }
    try {
        tizen.application.getAppsContext(function (running) {
            if (running.some(function (c) { return c.appId === APP_ID; })) { openedAtBoot = true; return; }
            tizen.application.launch(APP_ID, function () { openedAtBoot = true; }, again);
        }, again);
    } catch (e) { again(); }
}

/* ---------- phone remote ----------
   Opt-in (Settings, or the Phone Remote button in Control Center). A small web server on the
   screen's network address, port 8092, serves the remote's page to a phone on the same Wi-Fi and
   turns its buttons into remote keys (input_keyevent, through Vetro).
   Security: every request needs the secret token that the screen puts in its QR code (or a pairing
   code shown on the screen for 10 minutes, 8 tries). Only the keys of the list below can be sent:
   no command, no file. Text typed on the phone only goes to the launcher's search. */
var REMOTE_PORT = 8092;
var REMOTE_KEYS = { up: "Up", down: "Down", left: "Left", right: "Right", ok: "Return", back: "XF86Back", home: "XF86Home",
                    play: "XF86PlayBack", volup: "XF86AudioRaiseVolume", voldown: "XF86AudioLowerVolume", mute: "XF86AudioMute",
                    chup: "XF86RaiseChannel", chdown: "XF86LowerChannel", info: "XF86Info", power: "XF86PowerOff" };

function sameSecret(a, b) {
    a = String(a || ""); b = String(b || "");
    if (!a || a.length !== b.length) return false;
    var d = 0;
    for (var i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return d === 0;
}

function remoteConfig(json) {
    var c = {};
    try { c = JSON.parse(json); } catch (e) { return; }
    if (!c.on || !/^[A-Za-z0-9]{16,64}$/.test(c.token || "")) { stopRemote(); stopLater(); return; }
    if (!remote) remote = { server: null, tries: 0 };
    remote.token = c.token;
    if (c.code && /^[0-9]{4}$/.test(c.code)) { remote.code = c.code; remote.codeUntil = Date.now() + 10 * 60000; remote.tries = 0; }
    if (!remote.server) startRemote();
    stopLater();
}

function stopRemote() {
    if (remote && remote.server) { try { remote.server.close(); } catch (e) {} }
    remote = null;
}

function startRemote() {
    var srv = http.createServer(function (req, res) {
        var url = req.url || "/", q = url.indexOf("?"), path = q === -1 ? url : url.substr(0, q);
        var params = {};
        (q === -1 ? "" : url.substr(q + 1)).split("&").forEach(function (kv) {
            var i = kv.indexOf("=");
            if (i > 0) { try { params[kv.substr(0, i)] = decodeURIComponent(kv.substr(i + 1)); } catch (e) {} }
        });
        function send(status, type, body) {
            res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
            res.end(body);
        }
        if (req.method === "GET" && (path === "/" || path === "/index.html")) { send(200, "text/html; charset=utf-8", REMOTE_PAGE); return; }
        // Diagnostic: is the server reachable? (nothing secret in the answer)
        if (req.method === "GET" && path === "/ping") {
            res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" });
            res.end('{"ok":true,"app":"apl-remote"}');
            return;
        }
        // The last diagnostic report, as text to copy (token needed)
        if (req.method === "GET" && path === "/report") {
            if (!remote || !sameSecret(params.t, remote.token)) { send(403, "text/plain; charset=utf-8", "forbidden"); return; }
            send(200, "text/plain; charset=utf-8", lastReport || "No diagnostic yet: Settings › Support › Diagnostic on the screen.");
            return;
        }
        if (req.method !== "POST") { send(404, "text/plain", "not found"); return; }
        var chunks = [], size = 0;
        req.on("data", function (c) { size += c.length; if (size > 2048) { req.destroy(); return; } chunks.push(c); });
        req.on("end", function () {
            var body = {};
            try { body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); } catch (e) {}
            if (!remote) { send(503, "application/json", '{"ok":false}'); return; }
            if (path === "/pair") {
                var ok = remote.code && Date.now() < remote.codeUntil && remote.tries < 8 && sameSecret(body.code, remote.code);
                if (!ok) { remote.tries++; send(403, "application/json", '{"ok":false}'); return; }
                send(200, "application/json", JSON.stringify({ ok: true, token: remote.token }));
                return;
            }
            if (!sameSecret(params.t || body.t, remote.token)) { send(403, "application/json", '{"ok":false}'); return; }
            if (path === "/key") {
                var k = REMOTE_KEYS[body.k];
                if (!k) { send(400, "application/json", '{"ok":false}'); return; }
                shell("/usr/bin/input_keyevent " + k + " >/dev/null 2>&1; true", function () {});
                send(200, "application/json", '{"ok":true}');
                return;
            }
            if (path === "/text") {
                var text = String(body.text || "").replace(/[\u0000-\u001f]/g, "").slice(0, 60);
                toLauncher("text", text);
                send(200, "application/json", '{"ok":true}');
                return;
            }
            if (path === "/hello") { send(200, "application/json", JSON.stringify({ ok: true, front: launcherFront })); return; }
            send(404, "application/json", '{"ok":false}');
        });
    });
    srv.on("error", function () { if (remote) remote.server = null; });
    srv.listen(REMOTE_PORT);
    remote.server = srv;
}

/* An event for the launcher (text typed on the phone): the launcher comes to the front first. */
function toLauncher(event, body) {
    function post() {
        try {
            tizen.messageport.requestTrustedRemoteMessagePort(APP_ID, REPLY_PORT)
                .sendMessage([{ key: "id", value: "event" }, { key: "event", value: event }, { key: "body", value: body }]);
            return true;
        } catch (e) { return false; }
    }
    if (launcherFront && post()) return;
    try { tizen.application.launch(APP_ID, function () {}, function () {}); } catch (e) {}
    var n = 0;
    (function again() { if (!post() && ++n < 10) setTimeout(again, 500); })();
}

var REMOTE_PAGE = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,user-scalable=no">' +
'<meta name="theme-color" content="#000"><title>APL Remote</title><style>' +
':root{color-scheme:dark}*{box-sizing:border-box;-webkit-tap-highlight-color:transparent;-webkit-user-select:none;user-select:none}' +
'body{margin:0;background:#000;color:#f5f5f7;font:16px -apple-system,system-ui,Segoe UI,Roboto,sans-serif;display:flex;flex-direction:column;align-items:center;min-height:100vh;padding:18px 16px 28px}' +
'h1{font-size:17px;font-weight:600;margin:4px 0 16px;color:#a1a1a6}h1 b{color:#f5f5f7}' +
'#pad{width:100%;max-width:380px;aspect-ratio:1/1;border-radius:34px;background:radial-gradient(circle at 50% 40%,#2c2c30,#18181b 70%);position:relative;touch-action:none;box-shadow:inset 0 0 0 1px #2e2e33}' +
'#pad i{position:absolute;color:#5a5a60;font-style:normal;font-size:22px}#pad .u{top:14px;left:50%;transform:translateX(-50%)}#pad .d{bottom:14px;left:50%;transform:translateX(-50%)}' +
'#pad .l{left:16px;top:50%;transform:translateY(-50%)}#pad .r{right:16px;top:50%;transform:translateY(-50%)}' +
'#dot{position:absolute;width:64px;height:64px;margin:-32px 0 0 -32px;border-radius:50%;background:rgba(255,255,255,.14);opacity:0;transition:opacity .2s;pointer-events:none}' +
'.row{display:flex;justify-content:space-between;width:100%;max-width:380px;margin-top:16px}' +
'button{flex:1;margin:0 6px;height:62px;border:0;border-radius:31px;background:#1c1c1f;color:#f5f5f7;font-size:22px;box-shadow:inset 0 0 0 1px #2e2e33}' +
'button:active{background:#3a3a3f}button.small{font-size:15px}' +
'form{display:flex;width:100%;max-width:380px;margin-top:20px}input{flex:1;height:52px;border-radius:26px;border:0;padding:0 20px;background:#1c1c1f;color:#fff;font-size:17px;box-shadow:inset 0 0 0 1px #2e2e33;-webkit-user-select:text;user-select:text}' +
'form button{flex:none;width:110px;height:52px;font-size:16px;background:#0a84ff;box-shadow:none}' +
'#pair{display:none;flex-direction:column;align-items:center;margin-top:30px}#pair input{width:200px;text-align:center;font-size:30px;letter-spacing:10px;flex:none}' +
'#msg{color:#ff453a;height:20px;margin-top:10px;font-size:14px}.hide{display:none!important}' +
'#rep{display:block;text-align:center;margin-top:26px;color:#636366;font-size:14px;text-decoration:none}' +
'</style></head><body><h1><b>APL</b> Remote</h1>' +
'<div id="pair"><p id="ptext"></p><input id="code" inputmode="numeric" maxlength="4" autocomplete="off"><div id="msg"></div></div>' +
'<div id="ui" class="hide"><div id="pad"><i class="u">⌃</i><i class="d">⌄</i><i class="l">‹</i><i class="r">›</i><div id="dot"></div></div>' +
'<div class="row"><button data-k="back">‹</button><button data-k="home">⌂</button><button data-k="play">⏯</button></div>' +
'<div class="row"><button data-k="voldown">−</button><button data-k="mute" class="small">MUTE</button><button data-k="volup">+</button></div>' +
'<form id="f"><input id="q" autocomplete="off"><button id="go"></button></form><a id="rep" href="#">Diagnostic</a></div>' +
'<script>(function(){var fr=/^fr/i.test(navigator.language||"");var T=fr?{pair:"Entre le code à 4 chiffres affiché sur la TV",bad:"Code incorrect",q:"Rechercher sur la TV…",go:"Envoyer"}:{pair:"Enter the 4-digit code shown on the TV",bad:"Wrong code",q:"Search on the TV…",go:"Send"};' +
'var m=/[?&]t=([A-Za-z0-9]+)/.exec(location.search),t=m?m[1]:"";try{if(t)localStorage.setItem("aplT",t);else t=localStorage.getItem("aplT")||""}catch(e){}' +
'if(m)history.replaceState(null,"","/");' +
'function post(p,b){b=b||{};b.t=t;return fetch(p+"?t="+encodeURIComponent(t),{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(b)})}' +
'function key(k){if(navigator.vibrate)navigator.vibrate(8);post("/key",{k:k}).then(function(r){if(r.status===403)askPair()})}' +
'function askPair(){t="";try{localStorage.removeItem("aplT")}catch(e){}document.getElementById("ui").classList.add("hide");var p=document.getElementById("pair");p.style.display="flex";document.getElementById("ptext").textContent=T.pair;document.getElementById("code").focus()}' +
'document.getElementById("code").addEventListener("input",function(){var c=this.value.replace(/[^0-9]/g,"");this.value=c;if(c.length===4)fetch("/pair",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({code:c})}).then(function(r){return r.json()}).then(function(j){if(j.ok){t=j.token;try{localStorage.setItem("aplT",t)}catch(e){}show()}else{document.getElementById("msg").textContent=T.bad;document.getElementById("code").value=""}})});' +
'function show(){document.getElementById("pair").style.display="none";document.getElementById("ui").classList.remove("hide")}' +
'document.getElementById("rep").addEventListener("click",function(e){e.preventDefault();location.href="/report?t="+encodeURIComponent(t)});' +
'document.getElementById("q").placeholder=T.q;document.getElementById("go").textContent=T.go;' +
'document.getElementById("f").addEventListener("submit",function(e){e.preventDefault();var q=document.getElementById("q");if(q.value.trim())post("/text",{text:q.value.trim()});q.value="";q.blur()});' +
'Array.prototype.forEach.call(document.querySelectorAll("button[data-k]"),function(b){b.addEventListener("click",function(){key(b.getAttribute("data-k"))})});' +
'var pad=document.getElementById("pad"),dot=document.getElementById("dot"),sx=0,sy=0,st=0,moved=false,rep=null;' +
'function pos(e){var r=pad.getBoundingClientRect(),p=e.touches?e.touches[0]:e;return{x:p.clientX-r.left,y:p.clientY-r.top}}' +
'function down(e){e.preventDefault();var p=pos(e);sx=p.x;sy=p.y;st=Date.now();moved=false;dot.style.left=p.x+"px";dot.style.top=p.y+"px";dot.style.opacity=1}' +
'function move(e){if(!st)return;e.preventDefault();var p=pos(e),dx=p.x-sx,dy=p.y-sy;dot.style.left=p.x+"px";dot.style.top=p.y+"px";if(Math.abs(dx)>56||Math.abs(dy)>56){moved=true;key(Math.abs(dx)>Math.abs(dy)?(dx>0?"right":"left"):(dy>0?"down":"up"));sx=p.x;sy=p.y}}' +
'function up(e){if(!st)return;e.preventDefault();if(!moved&&Date.now()-st<450)key("ok");st=0;dot.style.opacity=0}' +
'pad.addEventListener("touchstart",down);pad.addEventListener("touchmove",move);pad.addEventListener("touchend",up);pad.addEventListener("mousedown",down);pad.addEventListener("mousemove",move);pad.addEventListener("mouseup",up);' +
'if(!t)askPair();else post("/hello").then(function(r){if(r.status===403)askPair();else show()},function(){show()})})()</script></body></html>';

module.exports.onStart = function () { start(); openLauncher(LAUNCH_TRIES); if (isBooting()) wakeVetro(); };
// Some environments run the script without calling onStart
try { start(); openLauncher(LAUNCH_TRIES); if (isBooting()) wakeVetro(); } catch (e) {}
module.exports.onRequest = function () { start(); };
module.exports.onExit = function () { clearTimeout(idle); clearInterval(ticking); ticking = null; port = null; stopRemote(); };
