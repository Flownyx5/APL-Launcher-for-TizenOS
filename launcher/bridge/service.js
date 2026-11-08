/* ============================================================
   bridge/service.js — private bridge between the launcher and Vetro.

   Vetro (http://127.0.0.1:8099, or the port it was built with) does not let the screen's apps read
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
var HOSTS = ["::ffff:127.0.0.1", "127.0.0.1"].concat(lanAddresses()), hostIndex = 0;
/* req.setTimeout never fires on these screens: own timers, one to connect, one for the answer. */
var CONNECT_MS = 5000;
// remap: the launcher repairs the Home rule without APL Overlay (overlay.js); quick: Alexa's microphone (services.js)
// input: read only, which remote Vetro intercepts (the fork's Diagnostic)
var ALLOWED = /^\/(status|screen|tv-settings|tv-menu|exec|components\/action|control|apps|remap|quick|input)(\/|\?|$)/;
var IDLE_MS = 15 * 60 * 1000;
var CHUNK = 4000;                       // characters per message (at most 12 KB once encoded)
var BOOT_WINDOW_S = 240, LAUNCH_TRIES = 5;
/* Going to sleep, the screen hides the launcher and sets memory/pm/state (1 = on); about 17 s
   later it freezes the apps, and the timer then misses its ticks (the fallback signal). */
var SLEEP_CHECKS = 4, POLL_MS = 3000, TICK_MS = 5000, ASLEEP_MS = 20000, HIDDEN_GRACE_MS = 45000;
var WAKE_WATCH_MS = 90000, SETTLE_MS = 15000;
/* Right after a wake the first readings are not reliable yet (no app in front, or a short-lived one), and
   Vetro's agent drops ~1.5 s later for ~15 s: read back to back for a while, and only take another app
   for the user's choice once it has stayed in front. */
var WAKE_FAST_MS = 6000, OTHER_APP_STAYS_MS = 4000;
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

/* The bridge's own log, in the package's data folder (bridge.log, like the .NET bridge's). Screens can have
   app logs turned off (dlogutil: enable_apps 0), and on The Frame 2022 (Tizen 6.5, #21) the launcher never
   got an answer with nothing to say why. Read it through Vetro: cat <that folder>/bridge.log.
   No request bodies, only paths: an /exec command can carry anything. */
var LOG_FILES = [(process.env.HOME || "/home/owner") + "/apps_rw/APLauncher/data/bridge.log",
                 "/opt/usr/home/owner/apps_rw/APLauncher/data/bridge.log", "/tmp/apl-bridge-web.log"];
var LOG_MAX = 32768, logged = {}, requestsSeen = 0;
function note(msg) {
    var line = new Date().toISOString().slice(11, 23) + " " + msg + "\n";
    for (var i = 0; i < LOG_FILES.length; i++) {
        try {
            try { if (fs.statSync(LOG_FILES[i]).size > LOG_MAX) fs.unlinkSync(LOG_FILES[i]); } catch (e) {}
            fs.appendFileSync(LOG_FILES[i], line);
            return;
        } catch (e) {}
    }
}
/* The same failure over and over: written the first 3 times only. */
function noteOnce(key, msg) {
    logged[key] = (logged[key] || 0) + 1;
    if (logged[key] <= 3) note(msg + (logged[key] === 3 ? " (not written again)" : ""));
}

/* ---------- Vetro's port ----------
   8099, unless Vetro was built with another one (VETRO_PORT=… node build.cjs), which some people do because
   another app holds 8099 (tizen-youtube; Reddit, 1.0.22): then nothing answers on 8099, or another app does.
   Checked once per run with /status. When the port is not Vetro's, 8099 is tried, then every port open on
   the screen at once, and the one that answers like Vetro is kept in the data folder (vetro-port), where the
   .NET bridge and APL Overlay of the hybrid package read it too (overlay/VetroPort.cs). */
var DEFAULT_PORT = 8099, NOT_VETRO = [8001, 8002];          // 8001/8002: the screen's own remote API
var PORT_FILES = [(process.env.HOME || "/home/owner") + "/apps_rw/APLauncher/data/vetro-port",
                  "/opt/usr/home/owner/apps_rw/APLauncher/data/vetro-port"];
/* Tried when the open ports cannot be read. */
var USUAL_PORTS = [8098, 8100, 8097, 9000, 9099, 8090, 8088, 8080, 8888, 9090, 8199, 18099];
var PROBE_CONNECT_MS = 1500, PROBE_ANSWER_MS = 3000, PORT_RETRY_MS = 30000, MAX_PROBES = 64;
var savedPort = rememberedPort() || DEFAULT_PORT, vetroPort = savedPort;
var portHow = vetroPort === DEFAULT_PORT ? "default" : "remembered", portProblem = "";
var portChecked = false, portWaiting = null, nextPortCheck = 0;

function validPort(p) { return p >= 1024 && p <= 65535 && NOT_VETRO.indexOf(p) < 0; }
function rememberedPort() {
    for (var i = 0; i < PORT_FILES.length; i++) {
        try { var p = parseInt(fs.readFileSync(PORT_FILES[i], "utf8"), 10); if (validPort(p)) return p; } catch (e) {}
    }
    return 0;
}
/* The usual port leaves no file behind. */
function rememberPort(p) {
    if (p === savedPort) return;
    savedPort = p;
    for (var i = 0; i < PORT_FILES.length; i++) {
        try {
            if (p === DEFAULT_PORT) { try { fs.unlinkSync(PORT_FILES[i]); } catch (e) {} continue; }
            fs.writeFileSync(PORT_FILES[i], String(p));
            return;
        } catch (e) {}
    }
}

/* Vetro's /status: its build ("app", with its version) and its root agent ("agent"). */
function isVetro(text) {
    try {
        var j = JSON.parse(text);
        return !!j && typeof j === "object" &&
               ((!!j.app && typeof j.app === "object" && !!j.app.version) || (!!j.agent && typeof j.agent === "object"));
    } catch (e) { return false; }
}

/* GET /status on one address and port: done("vetro"), done("other") when something else answers,
   done("refused") when nothing listens there, done("blocked") when the address itself is not reachable. */
function probe(host, port, done) {
    var finished = false, timer = null, req = null;
    function finish(kind) {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        try { req.abort(); } catch (e) {}
        done(kind);
    }
    try {
        req = http.request({ host: host, port: port, path: "/status", method: "GET" }, function (res) {
            var chunks = [], size = 0;
            res.on("data", function (c) { size += c.length; if (size > 262144) finish("other"); else chunks.push(c); });
            res.on("end", function () { finish(isVetro(Buffer.concat(chunks).toString("utf8")) ? "vetro" : "other"); });
        });
    } catch (e) { done("blocked"); return; }
    req.on("error", function (e) { finish(e && e.code === "ECONNREFUSED" ? "refused" : "blocked"); });
    timer = setTimeout(function () { finish("blocked"); }, PROBE_CONNECT_MS);
    req.on("socket", function (sock) {
        function connected() { clearTimeout(timer); timer = setTimeout(function () { finish("other"); }, PROBE_ANSWER_MS); }
        if (sock.connecting) sock.once("connect", connected); else connected();
    });
    req.end();
}

/* The ports open on the screen (LISTEN in /proc/net/tcp and tcp6), smallest first. */
function listeningPorts() {
    var ports = [];
    ["/proc/net/tcp", "/proc/net/tcp6"].forEach(function (file) {
        var lines = [];
        try { lines = fs.readFileSync(file, "utf8").split("\n").slice(1); } catch (e) {}
        lines.forEach(function (line) {
            var f = line.trim().split(/\s+/);
            if (f.length < 4 || f[3] !== "0A") return;
            var p = parseInt(f[1].split(":").pop(), 16);
            if (validPort(p) && ports.indexOf(p) < 0) ports.push(p);
        });
    });
    return ports.sort(function (a, b) { return a - b; });
}

/* Probes ports at once on one address: done(the ports that answered like Vetro, how many were tried, where they came from). */
function probeAll(host, exclude, done) {
    var ports = listeningPorts(), from = "open ports";
    if (!ports.length) { ports = USUAL_PORTS; from = "usual ports"; }
    ports = ports.filter(function (p) { return exclude.indexOf(p) < 0; }).slice(0, MAX_PROBES);
    var left = ports.length, vetros = [];
    if (!left) { done(vetros, 0, from); return; }
    ports.forEach(function (p) {
        probe(host, p, function (kind) {
            if (kind === "vetro") vetros.push(p);
            if (--left === 0) done(vetros.sort(function (a, b) { return a - b; }), ports.length, from);
        });
    });
}

/* Is vetroPort Vetro's? If not: 8099, then the open ports. done() once decided; vetroPort only changes for a port
   that answered like Vetro. */
function checkPort(done) {
    var t0 = Date.now(), tried = [vetroPort];
    function found(p, how) {
        if (p !== vetroPort || how.indexOf("found") === 0) note("Vetro on port " + p + " (" + how + ", " + (Date.now() - t0) + " ms)");
        vetroPort = p; portHow = how; portProblem = ""; portChecked = true;
        rememberPort(p);
        done();
    }
    function gaveUp(why) {
        portProblem = why;
        noteOnce("port", "Vetro's port: " + why);
        nextPortCheck = Date.now() + PORT_RETRY_MS;
        done();
    }
    function scan(host, why) {
        probeAll(host, tried, function (vetros, count, from) {
            if (vetros.length) found(vetros[0], "found among " + count + " " + from);
            else gaveUp(why + ", not among " + count + " " + from);
        });
    }
    // The first address that is not blocked (Tizen 9 refuses 127.0.0.1 to services, The Frame 2025 both loopback forms)
    (function onHost(i) {
        if (i >= HOSTS.length) { gaveUp("no address reached"); return; }
        var host = HOSTS[(hostIndex + i) % HOSTS.length];
        probe(host, vetroPort, function (kind) {
            if (kind === "blocked") { onHost(i + 1); return; }
            if (kind === "vetro") { found(vetroPort, portHow); return; }
            var why = (kind === "refused" ? "nothing on " : "another app on ") + vetroPort;
            if (vetroPort === DEFAULT_PORT) { scan(host, why); return; }
            tried.push(DEFAULT_PORT);
            probe(host, DEFAULT_PORT, function (k) { if (k === "vetro") found(DEFAULT_PORT, "default"); else scan(host, why); });
        });
    })(0);
}

/* Runs fn once Vetro's port is known: checked once per run, and again after Vetro could not be reached
   (at most every 30 s while it is not found). */
function withPort(fn) {
    if (portChecked || Date.now() < nextPortCheck) { fn(); return; }
    if (portWaiting) { portWaiting.push(fn); return; }
    portWaiting = [fn];
    checkPort(function () {
        var waiting = portWaiting;
        portWaiting = null;
        waiting.forEach(function (f) { f(); });
    });
}

function stopLater() {
    clearTimeout(idle);
    // Stays while the launcher is in front or the screen sleeps on it, to bring it back at wake-up
    if (launcherFront || sleeping || waking || inArt || vetroWake.busy || (idleApps && idleApps.minutes > 0) || (homeGuard && homeGuard.on) || (remote && remote.server)) return;
    idle = setTimeout(function () {
        try { tizen.application.getCurrentApplication().exit(); } catch (e) {}
    }, IDLE_MS);
}

function field(data, key) {
    for (var i = 0; i < data.length; i++) if (data[i].key === key) return String(data[i].value);
    return "";
}

/* The answer goes back through the launcher's trusted port (Tizen 9 refuses a port attached to the request).
   If that fails, through the port the launcher attached to its request (older screens), then through its
   plain port (APL_BRIDGE_REPLY_PLAIN, only opened on screens before Tizen 7). The way that worked is tried
   first next time, and every change of way is written in the log. */
var PLAIN_REPLY_PORT = "APL_BRIDGE_REPLY_PLAIN", route = "";
function replyRoutes(attached) {
    var all = [
        ["trusted", function () { return tizen.messageport.requestTrustedRemoteMessagePort(APP_ID, REPLY_PORT); }],
        ["attached", function () { if (!attached) throw new Error("no port attached"); return attached; }],
        ["plain", function () { return tizen.messageport.requestRemoteMessagePort(APP_ID, PLAIN_REPLY_PORT); }]
    ];
    return all.filter(function (r) { return r[0] === route; }).concat(all.filter(function (r) { return r[0] !== route; }));
}
function answer(id, status, body, attached) {
    body = String(body || "");
    var parts = Math.max(1, Math.ceil(body.length / CHUNK)), routes = replyRoutes(attached), errors = [];
    for (var r = 0; r < routes.length; r++) {
        try {
            var back = routes[r][1]();
            for (var i = 0; i < parts; i++) {
                back.sendMessage([{ key: "id", value: id }, { key: "status", value: String(status) },
                                  { key: "part", value: String(i) }, { key: "parts", value: String(parts) },
                                  { key: "body", value: body.substr(i * CHUNK, CHUNK) }]);
            }
            if (route !== routes[r][0]) {
                note("answers go through the " + routes[r][0] + " port" + (errors.length ? " (" + errors.join("; ") + ")" : ""));
                route = routes[r][0];
            }
            return;
        } catch (e) {
            errors.push(routes[r][0] + ": " + ((e && (e.name + " " + e.message)) || e));
        }
    }
    noteOnce("answer", "could not answer request " + id + ": " + errors.join("; "));
}

function onMessage(data, attached) {
    var rc = field(data, "remote");
    if (rc) { remoteConfig(rc); return; }
    var report = field(data, "report");
    if (report) { lastReport = report.slice(0, 20000); stopLater(); return; }
    if (field(data, "vetro") === "wake") { wakeVetro(); stopLater(); return; }
    var ic = field(data, "idle");
    if (ic) { idleConfig(ic); return; }
    if (field(data, "home") === "wanted") { homeGuard.wanted = true; homeGuard.seenAt = 0; return; }
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
        answer(id, 200, JSON.stringify({ startedAt: startedAt, uptime: upSeconds(), vetroWake: vetroWake,
                                         idle: { minutes: idleApps.minutes, closed: idleApps.closed.slice(-6), checks: idleApps.checks },
                                         homeGuard: { on: homeGuard.on, back: homeGuard.back, last: homeGuard.last, fromStart: homeGuard.fromStart } }), attached);
        return;
    }
    if (++requestsSeen <= 20) note("request " + id + ": " + method + " " + path.split("?")[0] + (attached ? " (port attached)" : ""));
    // Settings › Support › Link to Vetro: answered here, without Vetro, so the launcher can tell a bridge that
    // gets nothing (or cannot answer) from one that cannot reach Vetro, and which addresses failed how (#21)
    if (/^\/bridge-info(\?|$)/.test(path)) {
        var info = { bridge: "web", hosts: HOSTS, using: HOSTS[hostIndex], reached: reached, errors: hostErrors, route: route,
                     port: vetroPort, portHow: portChecked ? portHow : "not checked yet", portProblem: portProblem };
        // ?scan=1: every open port tried as Vetro would be, to check the search on a screen (nothing is changed)
        if (!/[?&]scan=1/.test(path)) { answer(id, 200, JSON.stringify(info), attached); return; }
        var t0 = Date.now();
        probeAll(reached || HOSTS[hostIndex], [], function (vetros, count, from) {
            info.scan = { vetro: vetros, tried: count, from: from, ms: Date.now() - t0 };
            answer(id, 200, JSON.stringify(info), attached);
        });
        return;
    }
    if (!ALLOWED.test(path) || (method !== "GET" && method !== "POST")) {
        answer(id, 404, '{"error":"not relayed"}', attached);
        return;
    }
    withPort(function () {
        vetro(method, path, Buffer.from(body || "", "utf8"), 150000, function (status, text) { answer(id, status, text, attached); });
    });
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

/* For /bridge-info: the address Vetro last answered on, and the last error on each address tried. */
var reached = "", hostErrors = {};

/* A request to Vetro; done(status, text) is called once. */
function vetro(method, path, buf, timeoutMs, done, retries) {
    if (retries === undefined) retries = HOSTS.length - 1;
    var host = HOSTS[hostIndex], finished = false, timer = null;
    function finish(status, text) {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        if (status > 0 && status < 500) reached = host;
        done(status, text);
    }
    function fail(e) {
        if (finished) return;
        hostErrors[host] = (e.code || "") + " " + String(e.message || "").slice(0, 60);
        noteOnce("vetro " + host, "Vetro at " + host + ": " + hostErrors[host]);
        // The request did not go out (refused, or no answer to connect): try the next address
        if (retries > 0 && /EHOSTUNREACH|EACCES|ECONNREFUSED|ENETUNREACH|EINVAL|ETIMEDOUT|EAFNOSUPPORT|EADDRNOTAVAIL/.test(e.code)) {
            finished = true;
            clearTimeout(timer);
            if (HOSTS[hostIndex] === host) hostIndex = (hostIndex + 1) % HOSTS.length;
            vetro(method, path, buf, timeoutMs, done, retries - 1);
            return;
        }
        portChecked = false;            // Vetro may have moved to another port: looked for again before the next request
        finish(502, JSON.stringify({ ok: false, error: "Vetro unreachable on port " + vetroPort + ": " + e.message }));
    }
    var req = http.request({
        host: host, port: vetroPort, path: path, method: method,
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
                hostErrors[host] = "connected, no answer in " + Math.round(timeoutMs / 1000) + " s";
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
    withPort(function () {
        vetro("POST", "/exec", buf, 20000, function (status, text) {
            var out = "";
            try { out = String(JSON.parse(text).output || ""); } catch (e) {}
            done(out);
        });
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
function onTvInput(st) { return !!st.app && ((/tv-viewer/.test(st.app) && st.source === 0) || /csfs|home\.sidebar|coba\.newhome|home\.media/.test(st.app)); }

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
    var woke = Date.now(), until = woke + WAKE_WATCH_MS, launcherSince = 0, other = null, otherSince = 0;
    function done() { waking = false; stopLater(); }
    function decided(st) {               // true when nothing more is needed
        if (!st || !st.app) return false;
        if (onTvInput(st)) {
            try { tizen.application.launch(APP_ID, function () {}, function () {}); } catch (e) {}
            return true;
        }
        // Art Mode in front at wake: leaving it later is watched like any other Art Mode
        if (ART_APP.test(st.app)) { inArt = true; watchArt(); return true; }
        if (st.app !== APP_ID) {
            // Another app: the user's choice only if it stays (wake-up screens come and go)
            if (st.app !== other) { other = st.app; otherSince = Date.now(); return false; }
            return Date.now() - otherSince >= OTHER_APP_STAYS_MS;
        }
        other = null;
        if (!launcherSince) launcherSince = Date.now();
        return Date.now() - launcherSince > SETTLE_MS;                          // the screen came back on it
    }
    if (decided(first)) { done(); return; }
    (function look() {
        readState(function (st) {
            if (decided(st) || Date.now() > until) { done(); return; }
            setTimeout(look, Date.now() - woke > WAKE_FAST_MS ? POLL_MS : 100);   // back to back at first
        });
    })();
}

/* ---------- apps left in the background ----------
   APL Overlay's IdleApps (overlay/IdleApps.cs), for screens where APL Overlay can't run (it is built
   for Tizen 9): every minute, the apps running behind the one in front; an app left in the
   background for 10 minutes is closed (app_launcher -k, through Vetro). The screen keeps every app
   it opened until its memory runs out, and then everything slows down. Never closed: the app in
   front, the launcher, Vetro, Samsung's home, the TV inputs, AirPlay and screen mirroring, and the
   music apps the launcher names (music keeps playing behind the Home Screen). Only the Home
   Screen's apps, those once seen in front and Samsung's that open by themselves count; those never
   seen in front close after a minute (they reopen at every wake-up and hold about 250 MB).
   The launcher turns it on (message "idle") when APL Overlay isn't installed. */
var IDLE_CHECK_MS = 60000, IDLE_UNUSED_MIN = 1;
var IDLE_NEVER = /^(APLauncher\.|apl\.launcher\.|vetrotvapp|com\.samsung\.tv\.csfs|com\.samsung\.tv\.home\.sidebar|org\.tizen\.tv-viewer)/;
var IDLE_RECEIVERS = /airplay|ScreenMirroring|multiscreen/i;
var IDLE_SELF = ["com.samsung.tv.home.media", "com.samsung.tv.mycontents", "com.samsung.tv.quicklaunch", "org.tizen.browser",
                 "com.samsung.tv.bixbycapsuleviewer", "com.samsung.tv.aria-video", "com.samsung.tv.cobalt-yt",
                 "MCmYXNxgcu.DisneyPlus", "org.tizen.netflix-app", "org.tizen.primevideo", "HEPsqFNie0.tvplusstandalone"];
var idleApps = { minutes: 0, home: {}, keep: {}, lastUsed: {}, seen: {}, front: "", timer: null, busy: false, closed: [], checks: 0 };

/* The launcher's settings for these two jobs, kept next to the bridge's log: at the next start of the
   screen they apply at once, before the launcher has ever run (a remote Vetro doesn't intercept, such as an
   old infrared one, opened Samsung's home and nothing brought the launcher back). Without the file (first
   start after the install): Return to the Launcher on, as the launcher's own default. */
var CONFIG_FILES = [(process.env.HOME || "/home/owner") + "/apps_rw/APLauncher/data/bridge-config.json",
                    "/opt/usr/home/owner/apps_rw/APLauncher/data/bridge-config.json", "/tmp/apl-bridge-config.json"];
function saveConfig(json) {
    for (var i = 0; i < CONFIG_FILES.length; i++) {
        try { fs.writeFileSync(CONFIG_FILES[i], json); return; } catch (e) {}
    }
}
function loadConfig() {
    for (var i = 0; i < CONFIG_FILES.length; i++) {
        try { return fs.readFileSync(CONFIG_FILES[i], "utf8"); } catch (e) {}
    }
    return JSON.stringify({ minutes: 0, homeReturn: true });
}
function idleConfig(json, fromFile) {
    var c = {};
    try { c = JSON.parse(json); } catch (e) { return; }
    if (!fromFile) saveConfig(JSON.stringify(c));
    var m = parseInt(c.minutes, 10);
    idleApps.minutes = isNaN(m) ? 0 : Math.max(0, Math.min(240, m));
    idleApps.home = {}; idleApps.keep = {};
    (c.apps || []).forEach(function (id) { if (/^[A-Za-z0-9_.-]+$/.test(id)) idleApps.home[id] = true; });
    (c.keep || []).forEach(function (id) { if (/^[A-Za-z0-9_.-]+$/.test(id)) idleApps.keep[id] = true; });
    if (idleApps.minutes > 0 && !idleApps.timer) idleApps.timer = setInterval(idleCheck, IDLE_CHECK_MS);
    if (idleApps.minutes === 0 && idleApps.timer) { clearInterval(idleApps.timer); idleApps.timer = null; }
    homeGuardConfig(c.homeReturn === true);
    stopLater();
}

/* ---------- back to the launcher when Samsung's home shows ----------
   APL Overlay's "Return to the Launcher", for screens without it. Samsung's home comes to the front
   when a remote that Vetro doesn't intercept presses Home (a phone app such as SmartThings, an
   infrared remote while the Bluetooth one is chosen in Vetro), or when an app closes. While the
   launcher isn't in front, the app in front is read every 1.2 s; Samsung's home seen twice in a row
   (it flashes by while apps start) brings the launcher back. Not when it was asked for (the
   launcher's Smart Hub tile): it then stays until something else is in front. Settings › Advanced
   Features › Return to the Launcher. */
var HOME_GUARD_MS = 1200;
var homeGuard = { on: false, timer: null, busy: false, wanted: false, seenAt: 0, back: 0, last: "", silent: 0 };
function homeGuardConfig(on) {
    homeGuard.on = !!on;
    if (homeGuard.on && !homeGuard.timer) homeGuard.timer = setInterval(homeGuardTick, HOME_GUARD_MS);
    if (!homeGuard.on && homeGuard.timer) { clearInterval(homeGuard.timer); homeGuard.timer = null; }
}
function homeGuardTick() {
    if (!homeGuard.on || launcherFront || sleeping || waking || homeGuard.busy) { homeGuard.seenAt = 0; return; }
    homeGuard.busy = true;
    shell("vconftool get memory/appfw/current_fullscreen_appid 2>/dev/null; vconftool get memory/pm/state 2>/dev/null", function (out) {
        homeGuard.busy = false;
        if (!out) {                                                      // Vetro silent: nothing can be read
            homeGuard.seenAt = 0;
            if (++homeGuard.silent >= 25) { homeGuard.silent = 0; wakeVetro(); }   // ~30 s: wake it (at most every 5 min)
            return;
        }
        homeGuard.silent = 0;
        if (launcherFront) { homeGuard.seenAt = 0; return; }
        var app = vconfValue(out, "current_fullscreen_appid") || "", pm = vconfValue(out, "memory/pm/state");
        if (pm && pm !== "1") { homeGuard.seenAt = 0; return; }          // going to sleep: left alone
        var home = /csfs|home\.sidebar|coba\.newhome/.test(app);          // Samsung's home (2025: the new Home)
        if (!home) { homeGuard.seenAt = 0; if (app) homeGuard.wanted = false; return; }
        if (homeGuard.wanted) return;                                    // opened on purpose: it stays
        if (!homeGuard.seenAt) { homeGuard.seenAt = Date.now(); return; }
        homeGuard.seenAt = 0;
        homeGuard.back++;
        homeGuard.last = new Date().toISOString().slice(11, 16);
        try { tizen.application.launch(APP_ID, function () {}, function () {}); } catch (e) {}
    });
}

function idleFront(app) {
    var now = Date.now();
    if (idleApps.front && idleApps.front !== app) idleApps.lastUsed[idleApps.front] = now;   // in use until now
    idleApps.front = app || "";
    if (!idleApps.front) return;
    idleApps.lastUsed[idleApps.front] = now;
    idleApps.seen[idleApps.front] = true;
}

function idleClosable(id) {
    if (IDLE_NEVER.test(id) || IDLE_RECEIVERS.test(id) || idleApps.keep[id]) return false;
    return !!(idleApps.seen[id] || idleApps.home[id] || IDLE_SELF.indexOf(id) !== -1);
}

function idleCheck() {
    if (idleApps.busy || idleApps.minutes <= 0 || sleeping) return;
    idleApps.busy = true;
    shell("vconftool get memory/appfw/current_fullscreen_appid 2>/dev/null; app_launcher -S 2>/dev/null", function (out) {
        idleApps.checks++;
        if (!out) { idleApps.busy = false; return; }                     // Vetro silent: nothing is known, nothing closed
        idleFront(vconfValue(out, "memory/appfw/current_fullscreen_appid") || "");
        var now = Date.now(), close = [];
        out.split("\n").forEach(function (line) {
            var m = /^\s*([A-Za-z0-9_.-]+) \(\d+\)\s*$/.exec(line);
            if (!m) return;
            var id = m[1];
            if (id === idleApps.front || !idleClosable(id)) return;
            var used = idleApps.lastUsed[id];
            if (!used) { idleApps.lastUsed[id] = now; return; }          // already behind when this started: counted from now
            var limit = IDLE_SELF.indexOf(id) !== -1 && !idleApps.seen[id] ? Math.min(IDLE_UNUSED_MIN, idleApps.minutes) : idleApps.minutes;
            if (now - used >= limit * 60000) close.push(id);
        });
        if (!close.length) { idleApps.busy = false; return; }
        shell(close.map(function (id) { delete idleApps.lastUsed[id]; return "app_launcher -k " + id + " >/dev/null 2>&1"; }).join("; ") + "; true", function () {
            close.forEach(function (id) { idleApps.closed.push(new Date().toISOString().slice(11, 16) + " " + id); });
            if (idleApps.closed.length > 20) idleApps.closed = idleApps.closed.slice(-20);
            idleApps.busy = false;
        });
    });
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
    withPort(function () {
        vetro("GET", "/status", Buffer.from("", "utf8"), 4000, function (status) { done(status === 200); });
    });
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

var configLoaded = false;
function start() {
    if (!configLoaded) {                      // the launcher's last settings: Return to the Launcher from power-on
        configLoaded = true;
        idleConfig(loadConfig(), true);
        homeGuard.fromStart = homeGuard.on;
    }
    stopLater();
    if (!ticking) ticking = setInterval(tick, TICK_MS);
    if (port) return;
    try {
        port = tizen.messageport.requestTrustedLocalMessagePort(PORT_NAME);
        port.addMessagePortListener(onMessage);
    } catch (e) {
        port = null;
        noteOnce("port", "could not open port " + PORT_NAME + ": " + ((e && (e.name + " " + e.message)) || e));
        throw e;
    }
    var up = "?";
    try { up = Math.round(parseFloat(fs.readFileSync("/proc/uptime", "utf8"))); } catch (e) {}
    note("started (Node " + process.version + ", screen up for " + up + " s), port " + PORT_NAME + " open");
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
                if (body.k === "home") {
                    // An injected Home key isn't seen by Vetro's interception: it would open Samsung's home.
                    // The launcher is opened directly (twice quickly: its App Switcher, as with the remote).
                    try { tizen.application.launch(APP_ID, function () {}, function () {}); } catch (e) {}
                    send(200, "application/json", '{"ok":true}');
                    return;
                }
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
        var msg = [{ key: "id", value: "event" }, { key: "event", value: event }, { key: "body", value: body }];
        try { tizen.messageport.requestTrustedRemoteMessagePort(APP_ID, REPLY_PORT).sendMessage(msg); return true; } catch (e) {}
        // The plain port the launcher also listens on, on screens where the trusted one fails (Tizen 6.5)
        try { tizen.messageport.requestRemoteMessagePort(APP_ID, PLAIN_REPLY_PORT).sendMessage(msg); return true; } catch (e) { return false; }
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
module.exports.onExit = function () { clearTimeout(idle); clearInterval(ticking); ticking = null; port = null; stopRemote(); if (idleApps.timer) clearInterval(idleApps.timer); if (homeGuard.timer) clearInterval(homeGuard.timer); };
