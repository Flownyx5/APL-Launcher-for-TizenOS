/* ============================================================
   service/service.js: APL TV's helper, a Tizen web service (Node).

   1. The phone setup page. The app shows a QR code with
      http://<screen>:8765/?k=<code>. The phone opens it on the home Wi-Fi,
      you type or paste your playlist there, and it goes straight to the
      screen. No outside website: your logins never leave your home.
      The page only accepts a submission with the code shown on the screen,
      and only while the "Add from your phone" page is open on it.
   2. Network work the page cannot do itself, for the app only (requests
      from the screen itself, never from the network):
      /fetch  a provider's answer without CORS headers, gzip opened
      /epg    a TV guide (XMLTV, often .gz, often huge) read here and
              sent back already cut to the channels and hours needed.
   Stops on its own after 15 minutes without a request.
   ============================================================ */
"use strict";

var http = require("http");
var https = require("https");
var zlib = require("zlib");
var os = require("os");
var crypto = require("crypto");

var PORT = 8765, VERSION = "1.4.7";
var IDLE_MS = 15 * 60 * 1000, SESSION_MS = 20 * 60 * 1000;
var UA = "APL TV/" + VERSION + " (" + (global.APLTV_PLATFORM || "Tizen") + ")";

var session = null;           // { token, at }
var pending = [];             // what the phone sent, waiting for the app
var logs = [], devLog = false;
var seenOrigins = {};
var epgCache = {};            // url -> { at, chans: { id: [[start, stop, title, desc]] }, names: { id: name } , icons }
var server = null, idle = null;
var shelf = null;             // what APL Launcher shows from APL TV (Continue Watching, channels), sent by the app

function stopLater() {
    clearTimeout(idle);
    idle = setTimeout(function () {
        try { server.close(); } catch (e) {}
        server = null;                  // on LG the process can stay: the next "start" opens the port again
        try { tizen.application.getCurrentApplication().exit(); } catch (e) {}
    }, IDLE_MS);
}

function lanAddresses() {
    var out = [];
    try {
        var nets = os.networkInterfaces();
        Object.keys(nets).forEach(function (n) { nets[n].forEach(function (a) { if (a.family === "IPv4" && !a.internal) out.push(a.address); }); });
    } catch (e) {}
    return out;
}
function isLocal(req) {
    var a = String(req.socket && req.socket.remoteAddress || "").replace(/^::ffff:/, "");
    return a === "127.0.0.1" || a === "::1" || lanAddresses().indexOf(a) !== -1;
}

/* Security: a website opened in the screen's browser runs on the screen too (127.0.0.1), and must not use
   this service (to reach the home network through /fetch, or read the app's data). Browsers always say
   where a page comes from (Origin): the app's own pages (file://, shown as "null") and the phone page
   served here are let in; any other website is refused. Requests without an Origin are not from a page. */
function originOk(req) {
    var o = String(req.headers.origin || "");
    if (!o || o === "null" || /^(file|app|wgt):/i.test(o)) return true;
    var m = /^https?:\/\/([^\/:]+)(?::(\d+))?$/i.exec(o);
    return !!m && String(m[2] || "80") === String(PORT) && (m[1] === "127.0.0.1" || m[1] === "localhost" || lanAddresses().indexOf(m[1]) !== -1);
}
function cors(res) {
    var o = res._origin;
    if (o) { res.setHeader("Access-Control-Allow-Origin", o); res.setHeader("Vary", "Origin"); }
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}
function send(res, status, body, type) {
    cors(res);
    res.writeHead(status, { "Content-Type": type || "application/json; charset=utf-8", "Cache-Control": "no-store" });
    res.end(typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}
function readBody(req, max, cb) {
    var chunks = [], size = 0, done = false;
    req.on("data", function (c) { size += c.length; if (size > max) { done = true; req.destroy(); cb(null); return; } chunks.push(c); });
    req.on("end", function () { if (!done) cb(Buffer.concat(chunks).toString("utf8")); });
    req.on("error", function () { if (!done) { done = true; cb(null); } });
}
function query(u) {
    var q = {}, i = u.indexOf("?");
    if (i < 0) return q;
    u.slice(i + 1).split("&").forEach(function (kv) {
        var p = kv.split("=");
        try { q[decodeURIComponent(p[0])] = decodeURIComponent((p[1] || "").replace(/\+/g, " ")); } catch (e) {}
    });
    return q;
}
function log(line) {
    logs.push(new Date().toISOString().slice(11, 19) + " [svc] " + line);
    if (logs.length > 500) logs.shift();
}
function redact(s) {
    return String(s).replace(/(username|password)=([^&\s"]+)/gi, "$1=***").replace(/\/(live|movie|series|timeshift)\/[^\/\s"]+\/[^\/\s"]+\//gi, "/$1/***/***/");
}

/* ---------- outgoing requests (redirects, gzip) ---------- */
var TLS_RETRY = /CERT|SELF_SIGNED|UNABLE_TO_VERIFY|ERR_TLS|DEPTH_ZERO/i;
function get(target, timeoutMs, cb, hops, insecure, extra) {
    hops = hops || 0;
    var lib = /^https:/i.test(target) ? https : http, finished = false;
    function finish(err, res) { if (finished) return; finished = true; clearTimeout(timer); cb(err, res); }
    var timer = setTimeout(function () { try { rq.destroy(); } catch (e) {} finish(new Error("timeout")); }, timeoutMs || 60000);
    var rq;
    try {
        var hd = { "User-Agent": UA, "Accept-Encoding": "gzip", "Accept": "*/*" };
        if (extra) Object.keys(extra).forEach(function (k) { hd[k] = extra[k]; });         // a Stalker portal's own headers
        rq = lib.get(target, { headers: hd, rejectUnauthorized: !insecure }, function (res) {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && hops < 6) {
                res.resume();
                clearTimeout(timer); finished = true;
                var next = res.headers.location;
                if (!/^https?:/i.test(next)) next = new URL(next, target).toString();
                get(next, timeoutMs, cb, hops + 1, insecure, extra);
                return;
            }
            var stream = res, enc = String(res.headers["content-encoding"] || "");
            if (/gzip|deflate/i.test(enc)) stream = res.pipe(/gzip/i.test(enc) ? zlib.createGunzip() : zlib.createInflate());
            // A .gz file served as is: open it when its first bytes say gzip
            var first = true, out = new (require("stream").PassThrough)(), gun = null;
            stream.on("data", function (c) {
                if (first) { first = false; if (c[0] === 0x1f && c[1] === 0x8b) { gun = zlib.createGunzip(); gun.on("data", function (d) { out.write(d); }); gun.on("end", function () { out.end(); }); gun.on("error", function (e) { out.destroy(e); }); } }
                if (gun) gun.write(c); else out.write(c);
            });
            stream.on("end", function () { if (gun) gun.end(); else out.end(); });
            stream.on("error", function (e) { out.destroy(e); });
            finish(null, { status: res.statusCode, type: res.headers["content-type"] || "", body: out });
        });
        rq.on("error", function (e) {
            // IPTV providers often have expired or self-made certificates: once more without the check
            if (!insecure && /^https:/i.test(target) && TLS_RETRY.test(String(e.code || e.message))) {
                if (finished) return;
                finished = true; clearTimeout(timer);
                log("certificate not valid (" + (e.code || e.message) + "), retried without the check: " + redact(target).replace(/^(https?:\/\/[^\/]+).*$/, "$1"));
                get(target, timeoutMs, cb, hops, true, extra);
                return;
            }
            finish(e);
        });
    } catch (e) { finish(e); }
}

/* ---------- the relay of a Stalker portal's movies (#30) ----------
   Some portals give movie links that only a MAG box may open: the TV's own player was refused (HTTP 403), as the
   server wants a MAG box's name and the portal's cookie, which a TV's player can't send. The app gives the portal's
   headers once (POST /px/hd), then plays http://127.0.0.1:8765/px?h=<id>&u=<link>: the service asks with them, and
   in an HLS playlist every address (the next playlists, the pieces, the keys) comes back through here too. A piece
   or a file is passed on as it comes, its range included (seeking). Local requests only. */
var pxHeaders = {};
/* The address keeps the file's own name (index.m3u8, 0001.ts): a TV's player knows HLS by it */
function pxName(u) { var n = String(u).split(/[?#]/)[0].split("/").pop().replace(/[^A-Za-z0-9._-]/g, "").slice(-60); return n || "x"; }
function pxPath(u, h) { return "/px/f/" + pxName(u) + "?h=" + encodeURIComponent(h) + "&u=" + encodeURIComponent(u); }
function pxRewrite(text, base, h) {
    return String(text).split(/\r?\n/).map(function (line) {
        var t = line.trim();
        if (!t) return line;
        try {
            if (t.charAt(0) === "#") return line.replace(/URI="([^"]+)"/g, function (m, u) { return 'URI="' + pxPath(new URL(u, base).toString(), h) + '"'; });
            return pxPath(new URL(t, base).toString(), h);
        } catch (e) { return line; }
    }).join("\n");
}
/* One request with those headers, redirects followed: the answer as it comes, and the address it came from (the
   base of a playlist's relative addresses) */
function pxGet(target, hd, cb, hops) {
    hops = hops || 0;
    var lib = /^https:/i.test(target) ? https : http, done = false, rq;
    function finish(err, res, url) { if (done) return; done = true; clearTimeout(timer); cb(err, res, url); }
    var timer = setTimeout(function () { try { rq.destroy(); } catch (e) {} finish(new Error("timeout")); }, 30000);
    try {
        var h = { "User-Agent": UA, "Accept": "*/*" };
        Object.keys(hd || {}).forEach(function (k) { h[k] = hd[k]; });
        rq = lib.get(target, { headers: h, rejectUnauthorized: false }, function (res) {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && hops < 6) {
                res.resume(); done = true; clearTimeout(timer);
                pxGet(new URL(res.headers.location, target).toString(), hd, cb, hops + 1);
                return;
            }
            finish(null, res, target);
        });
        rq.on("error", function (e) { finish(e); });
    } catch (e) { finish(e); }
}
function pxServe(req, res, q) {
    if (!isLocal(req) || !/^https?:\/\//i.test(q.u || "")) { send(res, 400, { error: "bad request" }); return; }
    var hd = {}, saved = pxHeaders[q.h] || {};
    Object.keys(saved).forEach(function (k) { hd[k] = saved[k]; });
    // "from the start" is the same as no range: the whole answer, its length known (a 206 for it ended ffmpeg with an error)
    if (req.headers.range && !/^bytes=0-$/.test(req.headers.range)) hd.Range = req.headers.range;
    pxGet(q.u, hd, function (err, up, url) {
        if (err) { log("relay failed " + redact(q.u) + ": " + err.message); send(res, 502, { error: err.message }); return; }
        var type = String(up.headers["content-type"] || "");
        var playlist = /mpegurl/i.test(type) || /\.m3u8?(\?|$)/i.test(url.split("#")[0]);
        cors(res);
        if (up.statusCode >= 400) log("relay: HTTP " + up.statusCode + " for " + redact(url).replace(/^(https?:\/\/[^\/]+).*?([^\/?]*)(\?.*)?$/, "$1/.../$2"));
        if (playlist && up.statusCode < 400) {
            var chunks = [];
            up.on("data", function (c) { chunks.push(c); });
            up.on("end", function () {
                var text = Buffer.concat(chunks).toString("utf8");
                // rewritten, so whole: 200 even when the player asked a range of it (206 with another length broke ffmpeg)
                var body = Buffer.from(/^\s*#EXTM3U/.test(text) ? pxRewrite(text, url, q.h) : text, "utf8");
                res.writeHead(200, { "Content-Type": "application/vnd.apple.mpegurl", "Content-Length": body.length, "Cache-Control": "no-store" });
                res.end(body);
            });
            up.on("error", function () { try { res.end(); } catch (e) {} });
            return;
        }
        var out = { "Cache-Control": "no-store" };
        ["content-type", "content-length", "content-range", "accept-ranges"].forEach(function (k) { if (up.headers[k]) out[k] = up.headers[k]; });
        res.writeHead(up.statusCode, out);
        up.pipe(res);
        up.on("error", function () { try { res.end(); } catch (e) {} });
        res.on("close", function () { try { up.destroy(); } catch (e) {} });
    });
}

/* ---------- timeshift: the live channel kept in a buffer, to pause it and go back in it ----------
   The app asks for it (POST /ts/start, local only): the service then reads the channel (MPEG-TS) itself, in pieces
   of about 4 s kept in files (60 min or 400 MB at most, the oldest go first), and the player reads it back from
   here: /ts/stream.ts?t=<time> starts at the piece of that moment and follows the channel as it comes. One channel
   at a time: the provider sees one connection, the service's. */
var TS_DIR = (global.APLTV_TMP || "/tmp") + "/apltv-ts", TS_SEG_MS = 4000, TS_MAX_MS = 60 * 60 * 1000, TS_MAX_BYTES = global.APLTV_TS_MAX || 400 * 1024 * 1024;
var tsRec = null;             // { id, url, segs: [{ n, t, bytes, file, done }], total, rq, res, err, waiters, retries, started }
function tsFile(n) { return TS_DIR + "/s" + n + ".ts"; }
function tsStop() {
    var r = tsRec;
    tsRec = null;
    if (!r) return;
    r.stopped = true;
    try { if (r.rq) r.rq.destroy(); } catch (e) {}
    r.segs.forEach(function (sg) { try { require("fs").unlinkSync(sg.file); } catch (e) {} });
    tsWake(r);
}
function tsWake(r) { var w = r.waiters; r.waiters = []; w.forEach(function (f) { try { f(); } catch (e) {} }); }
function tsOpen(r, target, hops, insecure) {
    var lib = /^https:/i.test(target) ? https : http;
    var rq;
    try {
        rq = lib.get(target, { headers: { "User-Agent": UA, "Accept": "*/*", "Connection": "keep-alive" }, rejectUnauthorized: !insecure }, function (res) {
            if (r.stopped) { res.destroy(); return; }
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && hops < 6) {
                res.resume();
                var next = res.headers.location;
                if (!/^https?:/i.test(next)) next = new URL(next, target).toString();
                tsOpen(r, next, hops + 1, insecure);
                return;
            }
            if (res.statusCode !== 200) { res.resume(); tsFail(r, "HTTP " + res.statusCode); return; }
            r.err = ""; r.live = true;
            var rest = null, synced = false;
            res.on("data", function (c) {
                if (r.stopped) return;
                if (rest) { c = Buffer.concat([rest, c]); rest = null; }
                if (!synced) {                                     // start on a packet (0x47 every 188 bytes)
                    var k = 0;
                    while (k + 376 < c.length && !(c[k] === 0x47 && c[k + 188] === 0x47 && c[k + 376] === 0x47)) k++;
                    if (k + 376 >= c.length) { rest = c; return; }
                    c = c.slice(k); synced = true;
                }
                var whole = c.length - (c.length % 188);
                if (whole < c.length) rest = c.slice(whole);
                if (whole) tsWrite(r, c.slice(0, whole));
            });
            res.on("end", function () { if (!r.stopped) tsFail(r, "the channel stopped"); });
            res.on("error", function (e) { if (!r.stopped) tsFail(r, e.message); });
            if (r.onFirst) { var f = r.onFirst; r.onFirst = null; f(null); }
        });
        rq.on("error", function (e) {
            if (r.stopped) return;
            if (!insecure && /^https:/i.test(target) && TLS_RETRY.test(String(e.code || e.message))) { tsOpen(r, target, hops, true); return; }
            tsFail(r, e.message);
        });
        rq.setTimeout(20000, function () { try { rq.destroy(new Error("timeout")); } catch (e) {} });
        r.rq = rq;
    } catch (e) { tsFail(r, e.message); }
}
function tsFail(r, why) {
    r.live = false;
    if (r.onFirst) { var f = r.onFirst; r.onFirst = null; f(new Error(why)); return; }
    // cut while it played: opened again (5 times at most, 2 s apart); what was kept stays
    if (++r.retries > 5) { r.err = why; log("timeshift: gave up (" + why + ")"); tsWake(r); return; }
    log("timeshift: " + why + ", reconnecting");
    setTimeout(function () { if (tsRec === r) tsOpen(r, r.url, 0, false); }, 2000);
}
function tsWrite(r, buf) {
    var fs = require("fs"), now = Date.now(), cur = r.segs[r.segs.length - 1];
    if (!cur || cur.done || now - cur.t >= TS_SEG_MS) {
        if (cur) cur.done = true;
        cur = { n: r.next++, t: now, bytes: 0, done: false };
        cur.file = tsFile(cur.n);
        r.segs.push(cur);
    }
    try { fs.appendFileSync(cur.file, buf); } catch (e) {
        // the screen's memory is full: the buffer gets smaller (the oldest half goes), and goes on
        if (r.segs.length < 6) { tsFail(r, "disk: " + e.message); return; }
        r.max = Math.max(20 * 1024 * 1024, Math.floor(r.total / 2));
        log("timeshift: memory full at " + Math.round(r.total / 1048576) + " MB, buffer now " + Math.round(r.max / 1048576) + " MB");
        while (r.segs.length > 2 && r.total > r.max) { var o = r.segs.shift(); r.total -= o.bytes; try { fs.unlinkSync(o.file); } catch (x) {} }
        try { fs.appendFileSync(cur.file, buf); } catch (e2) { tsFail(r, "disk: " + e2.message); return; }
    }
    cur.bytes += buf.length; r.total += buf.length;
    if (r.retries && now - r.started > 60000) r.retries = 0;
    // the oldest pieces go: 60 min, or 400 MB
    while (r.segs.length > 2 && (r.total > r.max || now - r.segs[0].t > TS_MAX_MS)) {
        var old = r.segs.shift();
        r.total -= old.bytes;
        try { fs.unlinkSync(old.file); } catch (e) {}
    }
    tsWake(r);
}
function tsStart(url, cb) {
    tsStop();
    var fs = require("fs");
    try { fs.mkdirSync(TS_DIR, { recursive: true }); } catch (e) {}
    try { fs.readdirSync(TS_DIR).forEach(function (f) { try { fs.unlinkSync(TS_DIR + "/" + f); } catch (e) {} }); } catch (e) {}
    var r = tsRec = { id: newToken(), url: url, segs: [], next: 0, total: 0, max: TS_MAX_BYTES, waiters: [], retries: 0, started: Date.now(), err: "", live: false };
    var done = false;
    r.onFirst = function (err) { if (done) return; done = true; clearTimeout(t); if (err) { if (tsRec === r) tsStop(); cb(err); } else cb(null, r); };
    var t = setTimeout(function () { if (r.onFirst) r.onFirst(new Error("timeout")); }, 20000);
    log("timeshift: recording " + redact(url).replace(/^(https?:\/\/[^\/]+).*$/, "$1/…"));
    tsOpen(r, url, 0, false);
}
function tsInfo(r) {
    return { id: r.id, live: r.live, err: r.err, from: r.segs.length ? r.segs[0].t : 0, to: Date.now(), bytes: r.total, segs: r.segs.map(function (sg) { return sg.t; }) };
}
/* The buffer from the piece of that moment, then the channel as it comes, until the player closes */
function tsStream(req, res, t) {
    var r = tsRec, fs = require("fs");
    var i = 0;
    while (i + 1 < r.segs.length && r.segs[i + 1].t <= t) i++;
    var sg = r.segs[i], n = sg ? sg.n : 0, pos = 0, fd = null, closed = false, buf = Buffer.alloc(65536);
    cors(res);
    res.writeHead(200, { "Content-Type": "video/mp2t", "Cache-Control": "no-store", "X-Start": String(sg ? sg.t : Date.now()) });
    req.on("close", function () { closed = true; if (fd !== null) { try { fs.closeSync(fd); } catch (e) {} fd = null; } });
    function segOf(k) { for (var j = 0; j < r.segs.length; j++) if (r.segs[j].n === k) return r.segs[j]; return null; }
    function pump() {
        if (closed || tsRec !== r) { try { res.end(); } catch (e) {} return; }
        var cur = segOf(n);
        if (!cur) {                                            // gone (too old), or not there yet
            if (r.segs.length && r.segs[0].n > n) { n = r.segs[0].n; pos = 0; if (fd !== null) { try { fs.closeSync(fd); } catch (e) {} fd = null; } return pump(); }
            if (r.err) { try { res.end(); } catch (e) {} return; }
            r.waiters.push(pump); return;
        }
        if (fd === null) { try { fd = fs.openSync(cur.file, "r"); } catch (e) { r.waiters.push(pump); return; } }
        var got = 0;
        try { got = fs.readSync(fd, buf, 0, buf.length, pos); } catch (e) { got = 0; }
        if (got > 0) {
            pos += got;
            if (res.write(Buffer.from(buf.slice(0, got)))) setImmediate(pump); else res.once("drain", pump);
            return;
        }
        if (cur.done && pos >= cur.bytes) { try { fs.closeSync(fd); } catch (e) {} fd = null; n++; pos = 0; return setImmediate(pump); }
        if (r.err) { try { res.end(); } catch (e) {} return; }
        r.waiters.push(pump);                                  // the newest piece: wait for more
    }
    pump();
}

/* ---------- IMDb ratings ----------
   The app first asks a free per-title source (Cinemeta), which has no rating yet for many new titles.
   IMDb publishes all its ratings once a day (title.ratings.tsv.gz, ~9 MB, for personal and
   non-commercial use): read here once a day, kept compact (title number and rating, ~5 MB, sorted for
   a quick search), and saved in /tmp so a restarted service does not download it again. */
var IMDB_URL = "https://datasets.imdbws.com/title.ratings.tsv.gz", IMDB_FILE = "/tmp/apltv-imdb.bin", IMDB_DAY = 24 * 3600 * 1000;
var imdbTab = null, imdbWaiting = null;
function imdbFind(tab, id) {
    var n = parseInt(String(id).replace(/^tt/, ""), 10);
    if (!(n > 0)) return 0;
    var lo = 0, hi = tab.n - 1;
    while (lo <= hi) {
        var mid = (lo + hi) >> 1, v = tab.ids[mid];
        if (v === n) return tab.r[mid] / 10;
        if (v < n) lo = mid + 1; else hi = mid - 1;
    }
    return 0;
}
function loadImdb(cb) {
    if (imdbTab && Date.now() - imdbTab.at < IMDB_DAY) { cb(null, imdbTab); return; }
    if (imdbWaiting) { imdbWaiting.push(cb); return; }
    imdbWaiting = [cb];
    var fs = require("fs");
    function done(err, tab) {
        if (tab) imdbTab = tab;
        if (err) log("imdb ratings: " + err.message);
        var w = imdbWaiting; imdbWaiting = null;
        w.forEach(function (fn) { fn(imdbTab ? null : err, imdbTab); });
    }
    fs.readFile(IMDB_FILE, function (e, buf) {
        try {
            if (!e && buf.length > 12) {
                var at = buf.readDoubleLE(0), n = buf.readUInt32LE(8);
                if (Date.now() - at < IMDB_DAY && buf.length === 12 + n * 5) {
                    var ids = new Uint32Array(n), r = new Uint8Array(n);
                    new Uint8Array(ids.buffer).set(buf.slice(12, 12 + n * 4));
                    r.set(buf.slice(12 + n * 4));
                    log("imdb ratings: " + n + " titles from /tmp");
                    done(null, { at: at, n: n, ids: ids, r: r });
                    return;
                }
            }
        } catch (x) {}
        download();
    });
    function download() {
        log("imdb ratings: downloading");
        get(IMDB_URL, 180000, function (err, res) {
            if (err) { done(err); return; }
            if (res.status !== 200) { res.body.resume(); done(new Error("HTTP " + res.status)); return; }
            // id * 256 + rating*10 in one number: one native sort puts them in order
            var cap = 1 << 21, keys = new Float64Array(cap), n = 0, rest = "", header = true;
            function line(s) {
                if (header) { header = false; if (s.indexOf("tconst") === 0) return; }
                var t1 = s.indexOf("\t"), t2 = s.indexOf("\t", t1 + 1);
                if (t1 < 3 || t2 < 0) return;
                if (parseInt(s.slice(t2 + 1), 10) < 5) return;               // a handful of votes is not a rating
                var id = parseInt(s.slice(2, t1), 10), rate = Math.round(parseFloat(s.slice(t1 + 1, t2)) * 10);
                if (!(id > 0) || !(rate > 0)) return;
                if (n === cap) { var bigger = new Float64Array(cap * 2); bigger.set(keys); keys = bigger; cap *= 2; }
                keys[n++] = id * 256 + rate;
            }
            res.body.setEncoding("utf8");
            res.body.on("data", function (chunk) {
                var parts = (rest + chunk).split("\n");
                rest = parts.pop();
                for (var i = 0; i < parts.length; i++) line(parts[i]);
            });
            res.body.on("error", function (e) { done(e); });
            res.body.on("end", function () {
                try {
                    if (rest) line(rest);
                    if (n < 1000) { done(new Error("only " + n + " ratings")); return; }
                    var sorted = keys.subarray(0, n);
                    if (sorted.sort) sorted.sort(); else Array.prototype.sort.call(sorted, function (a, b) { return a - b; });
                    var ids = new Uint32Array(n), r = new Uint8Array(n);
                    for (var i = 0; i < n; i++) { var k = sorted[i]; r[i] = k % 256; ids[i] = (k - r[i]) / 256; }
                    keys = null;
                    var tab = { at: Date.now(), n: n, ids: ids, r: r };
                    log("imdb ratings: " + n + " titles");
                    done(null, tab);
                    var out = Buffer.alloc ? Buffer.alloc(12 + n * 5) : new Buffer(12 + n * 5);
                    out.writeDoubleLE(tab.at, 0); out.writeUInt32LE(n, 8);
                    var view = new Uint8Array(out.buffer, out.byteOffset || 0, out.length);
                    view.set(new Uint8Array(ids.buffer, 0, n * 4), 12);
                    view.set(r, 12 + n * 4);
                    fs.writeFile(IMDB_FILE, out, function () {});
                } catch (x) { done(x); }
            });
        });
    }
}

/* ---------- XMLTV, read as it arrives ---------- */
function decodeXml(s) {
    return String(s || "").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/&(amp|lt|gt|quot|apos|#(\d+)|#x([0-9a-f]+));/gi, function (m, n, d, h) {
        if (d) return String.fromCharCode(parseInt(d, 10));
        if (h) return String.fromCharCode(parseInt(h, 16));
        return { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" }[n.toLowerCase()];
    }).trim();
}
function xmltvTime(s) {
    var m = String(s || "").match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?\s*([+-]\d{4})?/);
    if (!m) return 0;
    var t = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
    if (m[7]) { var sign = m[7][0] === "-" ? -1 : 1; t -= sign * ((+m[7].slice(1, 3)) * 60 + (+m[7].slice(3, 5))) * 60000; }
    return t;
}
/* Memory: a provider's guide is a few hundred MB once read; the app takes what it needs at once and keeps
   it itself. So a guide is only kept here 10 minutes after its last use (it was 3 h: the service held
   ~200 MB on the M8, and the screen then had to swap). */
var EPG_KEEP_MS = 10 * 60 * 1000;
setInterval(function () {
    Object.keys(epgCache).forEach(function (k) { var c = epgCache[k]; if (c && !c.waiting && Date.now() - (c.used || c.at) > EPG_KEEP_MS) delete epgCache[k]; });
}, 60 * 1000);
/* A guide whose server only lets some players in: the name the app learned for it (core.js), or VLC after a
   refusal (403) under APL TV's own name */
var epgUa = {}, VLC_UA = "VLC/3.0.21 LibVLC/3.0.21";
function getGuide(target, ms, cb) {
    get(target, ms, function (err, res) {
        if (!err && (res.status === 403 || res.status === 401) && !epgUa[target]) {
            res.body.resume();
            log("epg refused (" + res.status + "): asked again as VLC");
            get(target, ms, function (e2, r2) { if (!e2 && r2.status === 200) epgUa[target] = VLC_UA; cb(e2, r2); }, 0, false, { "User-Agent": VLC_UA });
            return;
        }
        cb(err, res);
    }, 0, false, epgUa[target] ? { "User-Agent": epgUa[target] } : undefined);
}
function learnUa(b) { if (b && typeof b.ua === "string" && b.ua && b.ua.length < 200) epgUa[b.url] = b.ua; }
function loadXmltv(target, cb) {
    var c = epgCache[target];
    if (c && !c.waiting && Date.now() - c.at < 3 * 3600 * 1000) { c.used = Date.now(); cb(null, c); return; }
    if (c && c.waiting) { c.waiting.push(cb); return; }
    var entry = { at: 0, chans: {}, names: {}, icons: {}, waiting: [cb], count: 0 };
    epgCache[target] = entry;
    var from = Date.now() - 6 * 3600 * 1000, to = Date.now() + 3 * 86400 * 1000;
    log("epg: loading " + redact(target));
    getGuide(target, 240000, function (err, res) {
        function done(e) {
            var w = entry.waiting; entry.waiting = null;
            if (e) { delete epgCache[target]; log("epg failed: " + e.message); }
            else { entry.at = Date.now(); log("epg: " + entry.count + " programmes, " + Object.keys(entry.chans).length + " channels"); }
            w.forEach(function (fn) { fn(e, entry); });
        }
        if (err) { done(err); return; }
        if (res.status !== 200) { res.body.resume(); done(new Error("HTTP " + res.status)); return; }
        var buf = "";
        res.body.setEncoding("utf8");
        res.body.on("data", function (chunk) {
            buf += chunk;
            var re = /<(programme|channel)\b([^>]*)>([\s\S]*?)<\/\1>/g, m, last = 0;
            while ((m = re.exec(buf))) {
                last = re.lastIndex;
                var attrs = m[2], inner = m[3];
                if (m[1] === "channel") {
                    var id = (attrs.match(/id="([^"]*)"/) || [])[1];
                    if (!id) continue;
                    var dn = (inner.match(/<display-name[^>]*>([\s\S]*?)<\/display-name>/) || [])[1];
                    var ic = (inner.match(/<icon[^>]*src="([^"]*)"/) || [])[1];
                    entry.names[decodeXml(id)] = decodeXml(dn);
                    if (ic) entry.icons[decodeXml(id)] = decodeXml(ic);
                    continue;
                }
                var ch = decodeXml((attrs.match(/channel="([^"]*)"/) || [])[1]);
                var st = xmltvTime((attrs.match(/start="([^"]*)"/) || [])[1]), sp = xmltvTime((attrs.match(/stop="([^"]*)"/) || [])[1]);
                if (!ch || !st || sp < from || st > to) continue;
                var title = (inner.match(/<title[^>]*>([\s\S]*?)<\/title>/) || [])[1];
                var desc = (inner.match(/<desc[^>]*>([\s\S]*?)<\/desc>/) || [])[1];
                (entry.chans[ch] = entry.chans[ch] || []).push([st, sp, decodeXml(title), decodeXml(desc).slice(0, 320)]);
                entry.count++;
            }
            buf = buf.slice(last);
            if (buf.length > 4000000) buf = buf.slice(-200000);   // a broken file: never grow without end
        });
        res.body.on("end", function () {
            Object.keys(entry.chans).forEach(function (k) { entry.chans[k].sort(function (a, b) { return a[0] - b[0]; }); });
            done(null);
        });
        res.body.on("error", function (e) { done(e); });
    });
}

/* A channel name reduced to letters and digits, without accents or quality ("France 2 HD" -> "france2").
   epg.js has the same function: both sides must agree. */
function compact(s) {
    s = String(s || "").toLowerCase();
    try { s = s.normalize("NFD").replace(/[\u0300-\u036f]/g, ""); } catch (e) {}
    s = s.replace(/^\s*[a-z]{2,3}\s*[-|:]\s+/, "");          // "IT - Rai 1": the country written before the name
    return s.replace(/\b(uhd|fhd|hd|sd|4k|hevc|h265|raw|backup|\d{3,4}p)\b/g, " ").replace(/\+/g, "plus").replace(/[^a-z0-9]+/g, "");
}
/* A public guide read as it arrives: only the channels whose names the app asked for are kept */
function matchXmltv(target, names, from, to, cb) {
    var want = {}, idTo = {}, out = {}, count = 0;
    names.forEach(function (n) { want[n] = 1; });
    log("epg match: " + redact(target) + " for " + names.length + " names");
    getGuide(target, 180000, function (err, res) {
        if (err) { cb(err); return; }
        if (res.status !== 200) { res.body.resume(); cb(new Error("HTTP " + res.status)); return; }
        var buf = "", done = false;
        res.body.setEncoding("utf8");
        res.body.on("data", function (chunk) {
            buf += chunk;
            var re = /<(programme|channel)\b([^>]*)>([\s\S]*?)<\/\1>/g, m, last = 0;
            while ((m = re.exec(buf))) {
                last = re.lastIndex;
                if (m[1] === "channel") {
                    var id = decodeXml((m[2].match(/id="([^"]*)"/) || [])[1]);
                    if (!id) continue;
                    // a channel asked by its guide id ("#id:" + its tvg-id, js/epg.js): U.and.GOLD.HD.uk found as it is (#32)
                    var byId = "#id:" + id.toLowerCase();
                    if (want[byId]) { (idTo[id] = idTo[id] || []).push(byId); delete want[byId]; }
                    var dn, dre = /<display-name[^>]*>([\s\S]*?)<\/display-name>/g;
                    while ((dn = dre.exec(m[3]))) {
                        var c = compact(decodeXml(dn[1]));
                        if (c && want[c]) { (idTo[id] = idTo[id] || []).push(c); delete want[c]; }
                    }
                    continue;
                }
                var ch = decodeXml((m[2].match(/channel="([^"]*)"/) || [])[1]), who = idTo[ch];
                if (!who) continue;
                var st = xmltvTime((m[2].match(/start="([^"]*)"/) || [])[1]), sp = xmltvTime((m[2].match(/stop="([^"]*)"/) || [])[1]);
                if (!st || sp < from || st > to) continue;
                var p = [st, sp, decodeXml((m[3].match(/<title[^>]*>([\s\S]*?)<\/title>/) || [])[1]), decodeXml((m[3].match(/<desc[^>]*>([\s\S]*?)<\/desc>/) || [])[1]).slice(0, 320)];
                who.forEach(function (n) { (out[n] = out[n] || []).push(p); });
                count++;
            }
            buf = buf.slice(last);
            if (buf.length > 4000000) buf = buf.slice(-200000);
        });
        res.body.on("end", function () {
            if (done) return; done = true;
            Object.keys(out).forEach(function (k) { out[k].sort(function (a, b) { return a[0] - b[0]; }); });
            log("epg match: " + Object.keys(out).length + " channels, " + count + " programmes");
            cb(null, out);
        });
        res.body.on("error", function (e) { if (!done) { done = true; cb(e); } });
    });
}

/* ---------- the phone page ---------- */
function phoneCss() {
    return "*{box-sizing:border-box;margin:0;padding:0}body{font:17px -apple-system,BlinkMacSystemFont,'SF Pro Text',Roboto,sans-serif;background:#000;color:#fff;" +
        "min-height:100vh;background:radial-gradient(120% 70% at 20% 0%,#1d2639 0%,#0b0d13 55%,#000 100%);padding:28px 20px 60px}" +
        "h1{font-size:34px;font-weight:700;letter-spacing:-.5px;margin:18px 0 6px}h1 span{color:rgba(255,255,255,.6);font-weight:400}p.sub{color:rgba(255,255,255,.62);margin-bottom:26px;line-height:1.4}" +
        ".seg{display:flex;background:rgba(118,118,128,.24);border-radius:12px;padding:3px;margin-bottom:22px}.seg button{flex:1;border:0;background:none;color:#fff;font:600 15px inherit;padding:10px 2px;border-radius:9px}" +
        ".seg button.on{background:rgba(255,255,255,.9);color:#000}.card{background:rgba(255,255,255,.08);border-radius:16px;overflow:hidden;margin-bottom:14px;box-shadow:inset 0 1px 0 rgba(255,255,255,.12)}" +
        "label{display:block;padding:12px 16px 0;font-size:13px;color:rgba(255,255,255,.55);text-transform:uppercase;letter-spacing:.6px}" +
        "input{width:100%;border:0;background:none;color:#fff;font:17px inherit;padding:6px 16px 14px;outline:none}.card+.card{margin-top:0}.row{border-top:1px solid rgba(255,255,255,.08)}" +
        ".hint{font-size:14px;color:rgba(255,255,255,.5);margin:2px 4px 22px;line-height:1.4}button.go{width:100%;border:0;border-radius:14px;background:#fff;color:#000;font:600 18px inherit;padding:16px;margin-top:8px}" +
        "button.go:disabled{opacity:.5}.msg{margin-top:16px;text-align:center;color:#ff6961}.done{text-align:center;padding-top:60px}.done .big{font-size:80px}.done h2{font-size:28px;margin:16px 0 8px}" +
        ".done p{color:rgba(255,255,255,.65)}.hide{display:none}";
}
/* The phone page in Polish, keyed by its English texts (the French is written next to each one below) */
var PHONE_PL = {
    "This code has expired": "Ten kod wygasł",
    "On the screen, open APL TV › Settings › Add a playlist › From your phone, then scan the new code.": "Na ekranie otwórz APL TV › Ustawienia › Dodaj playlistę › Z telefonu, a potem zeskanuj nowy kod.",
    "Send your playlist to the screen. It goes straight to it on your Wi-Fi, through no other website.": "Wyślij playlistę na ekran. Trafi na niego bezpośrednio przez Twoją sieć Wi-Fi, bez pośrednictwa żadnej strony internetowej.",
    "Server": "Serwer",
    "Username": "Nazwa użytkownika",
    "Password": "Hasło",
    "The three details your provider gave you. A get.php link pasted in Server works too.": "Trzy dane od Twojego dostawcy. Możesz też wkleić link get.php w polu Serwer.",
    "Playlist address (M3U)": "Adres playlisty (M3U)",
    "Paste the link of your M3U playlist.": "Wklej link do playlisty M3U.",
    "Portal address": "Adres portalu",
    "MAC address": "Adres MAC",
    "The portal (MAG, Ministra) and the MAC address your provider registered. The serial number and device IDs only if it asks for them.": "Portal (MAG, Ministra) i adres MAC zarejestrowany przez dostawcę. Numer seryjny i identyfikatory urządzenia tylko wtedy, gdy ich wymaga.",
    "Serial number (optional)": "Numer seryjny (opcjonalnie)",
    "Device ID 1 (optional)": "ID urządzenia 1 (opcjonalnie)",
    "Device ID 2 (optional)": "ID urządzenia 2 (opcjonalnie)",
    "Your Jellyfin or Emby server: its address, your user name and your password.": "Twój serwer Jellyfin lub Emby: jego adres, nazwa użytkownika i hasło.",
    "Plex links with a code: tap the button below, a code appears on the TV, then type it on plex.tv/link with this phone.": "Plex łączy się za pomocą kodu: stuknij przycisk poniżej, a gdy na telewizorze pojawi się kod, wpisz go na plex.tv/link na tym telefonie.",
    "Name (optional)": "Nazwa (opcjonalnie)",
    "My TV": "Mój telewizor",
    "TV guide address, XMLTV (optional)": "Adres przewodnika TV, XMLTV (opcjonalnie)",
    "Send to the screen": "Wyślij na ekran",
    "Sent!": "Wysłano!",
    "Look at your screen: APL TV is loading your playlist.": "Spójrz na ekran: APL TV wczytuje Twoją playlistę.",
    "Show the Plex code on the TV": "Pokaż kod Plex na telewizorze",
    "Fill in the server, the username and the password.": "Wpisz serwer, nazwę użytkownika i hasło.",
    "Fill in the portal and a MAC address like 00:1A:79:12:34:56.": "Wpisz portal i adres MAC, np. 00:1A:79:12:34:56.",
    "Fill in the server's address and your user name.": "Wpisz adres serwera i nazwę użytkownika.",
    "Paste the playlist's link.": "Wklej link do playlisty.",
    "Look at your TV: the Plex code is there. Type it on plex.tv/link.": "Spójrz na telewizor: jest na nim kod Plex. Wpisz go na plex.tv/link.",
    "This code has expired: scan the new one on the screen.": "Ten kod wygasł: zeskanuj nowy kod z ekranu.",
    "The screen did not answer. Is the phone on the same Wi-Fi?": "Ekran nie odpowiedział. Czy telefon jest w tej samej sieci Wi-Fi?",
    "TMDB key (optional)": "Klucz TMDB (opcjonalnie)",
    "For posters, summaries and ratings: your free key from themoviedb.org (Settings › API). You can send it alone.": "Do plakatów, opisów i ocen: Twój darmowy klucz z themoviedb.org (Ustawienia › API). Możesz wysłać sam klucz.",
    "Look at your screen: APL TV is checking your TMDB key.": "Spójrz na ekran: APL TV sprawdza Twój klucz TMDB."
};
/* The phone page in Italian, keyed by its English texts */
var PHONE_IT = {
    "This code has expired": "Questo codice è scaduto",
    "On the screen, open APL TV › Settings › Add a playlist › From your phone, then scan the new code.": "Sullo schermo, apri APL TV › Impostazioni › Aggiungi una playlist › Dal telefono, poi inquadra il nuovo codice.",
    "Send your playlist to the screen. It goes straight to it on your Wi-Fi, through no other website.": "Invia la tua playlist allo schermo. Arriva direttamente attraverso il tuo Wi-Fi, senza passare da nessun altro sito.",
    "Server": "Server",
    "Username": "Nome utente",
    "Password": "Password",
    "The three details your provider gave you. A get.php link pasted in Server works too.": "I tre dati che ti ha dato il fornitore. Funziona anche un link get.php incollato in Server.",
    "Playlist address (M3U)": "Indirizzo della playlist (M3U)",
    "Paste the link of your M3U playlist.": "Incolla il link della tua playlist M3U.",
    "Portal address": "Indirizzo del portale",
    "MAC address": "Indirizzo MAC",
    "The portal (MAG, Ministra) and the MAC address your provider registered.": "Il portale (MAG, Ministra) e l'indirizzo MAC registrato dal fornitore.",
    "Your Jellyfin or Emby server: its address, your user name and your password.": "Il tuo server Jellyfin o Emby: il suo indirizzo, il tuo nome utente e la tua password.",
    "Plex links with a code: tap the button below, a code appears on the TV, then type it on plex.tv/link with this phone.": "Plex si collega con un codice: tocca il pulsante qui sotto, sulla TV appare un codice, poi scrivilo su plex.tv/link con questo telefono.",
    "Name (optional)": "Nome (facoltativo)",
    "My TV": "La mia TV",
    "TV guide address, XMLTV (optional)": "Indirizzo guida TV, XMLTV (facoltativo)",
    "Send to the screen": "Invia allo schermo",
    "Sent!": "Inviato!",
    "Look at your screen: APL TV is loading your playlist.": "Guarda lo schermo: APL TV sta caricando la tua playlist.",
    "Show the Plex code on the TV": "Mostra il codice Plex sulla TV",
    "Fill in the server, the username and the password.": "Inserisci il server, il nome utente e la password.",
    "Fill in the portal and a MAC address like 00:1A:79:12:34:56.": "Inserisci il portale e un indirizzo MAC come 00:1A:79:12:34:56.",
    "Fill in the server's address and your user name.": "Inserisci l'indirizzo del server e il tuo nome utente.",
    "Paste the playlist's link.": "Incolla il link della playlist.",
    "Look at your TV: the Plex code is there. Type it on plex.tv/link.": "Guarda la TV: c'è il codice Plex. Scrivilo su plex.tv/link.",
    "This code has expired: scan the new one on the screen.": "Questo codice è scaduto: inquadra quello nuovo sullo schermo.",
    "The screen did not answer. Is the phone on the same Wi-Fi?": "Lo schermo non ha risposto. Il telefono è sulla stessa rete Wi-Fi?",
    "TMDB key (optional)": "Chiave TMDB (facoltativa)",
    "For posters, summaries and ratings: your free key from themoviedb.org (Settings › API). You can send it alone.": "Per locandine, trame e valutazioni: la tua chiave gratuita di themoviedb.org (Settings › API). Puoi inviarla da sola.",
    "Look at your screen: APL TV is checking your TMDB key.": "Guarda lo schermo: APL TV sta controllando la tua chiave TMDB.",
    "The portal (MAG, Ministra) and the MAC address your provider registered. The serial number and device IDs only if it asks for them.": "Il portale (MAG, Ministra) e l'indirizzo MAC registrato dal fornitore. Il numero di serie e i Device ID solo se li richiede.",
    "Serial number (optional)": "Numero di serie (facoltativo)",
    "Device ID 1 (optional)": "Device ID 1 (facoltativo)",
    "Device ID 2 (optional)": "Device ID 2 (facoltativo)"
};
function phonePage(lang, token, ok) {
    var fr = /^fr/i.test(lang || ""), pl = /^pl/i.test(lang || ""), it = /^it/i.test(lang || "");
    function t(en, f) { return fr ? f : (pl && PHONE_PL[en]) || (it && PHONE_IT[en]) || en; }
    var css = phoneCss();
    if (!ok) {
        return "<!doctype html><html><head><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'><title>APL TV</title><style>" + css + "</style></head><body>" +
            "<div class=done><div class=big>⌛</div><h2>" + t("This code has expired", "Ce code a expiré") + "</h2><p>" +
            t("On the screen, open APL TV › Settings › Add a playlist › From your phone, then scan the new code.", "Sur l'écran, ouvre APL TV › Réglages › Ajouter une playlist › Depuis le téléphone, puis scanne le nouveau code.") + "</p></div></body></html>";
    }
    return "<!doctype html><html><head><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'><title>APL TV</title><style>" + css + "</style></head><body>" +
        "<div id=form><h1>APL <span>TV</span></h1><p class=sub>" + t("Send your playlist to the screen. It goes straight to it on your Wi-Fi, through no other website.", "Envoie ta playlist à l'écran. Elle y va directement par ton Wi-Fi, sans passer par aucun site.") + "</p>" +
        "<div class=seg><button id=bx class=on type=button>Xtream</button><button id=bm type=button>M3U</button><button id=bs type=button>Stalker</button><button id=bj type=button>Jellyfin</button><button id=bp type=button>Plex</button></div>" +
        "<div id=fx><div class=card><label>" + t("Server", "Serveur") + "</label><input id=server inputmode=url autocapitalize=off autocorrect=off placeholder='http://exemple.com:8080'>" +
        "<div class=row><label>" + t("Username", "Identifiant") + "</label><input id=user autocapitalize=off autocorrect=off></div>" +
        "<div class=row><label>" + t("Password", "Mot de passe") + "</label><input id=pass type=password autocapitalize=off autocorrect=off></div></div>" +
        "<p class=hint>" + t("The three details your provider gave you. A get.php link pasted in Server works too.", "Les trois infos données par ton fournisseur. Un lien get.php collé dans Serveur marche aussi.") + "</p></div>" +
        "<div id=fm class=hide><div class=card><label>" + t("Playlist address (M3U)", "Adresse de la playlist (M3U)") + "</label><input id=url inputmode=url autocapitalize=off autocorrect=off placeholder='http://…/playlist.m3u'></div>" +
        "<p class=hint>" + t("Paste the link of your M3U playlist.", "Colle le lien de ta playlist M3U.") + "</p></div>" +
        "<div id=fs class=hide><div class=card><label>" + t("Portal address", "Adresse du portail") + "</label><input id=portal inputmode=url autocapitalize=off autocorrect=off placeholder='http://exemple.com:8080/c/'>" +
        "<div class=row><label>" + t("MAC address", "Adresse MAC") + "</label><input id=mac autocapitalize=characters autocorrect=off placeholder='00:1A:79:12:34:56'></div>" +
        "<div class=row><label>" + t("Serial number (optional)", "Numéro de série (facultatif)") + "</label><input id=sn autocapitalize=characters autocorrect=off></div>" +
        "<div class=row><label>" + t("Device ID 1 (optional)", "ID d'appareil 1 (facultatif)") + "</label><input id=id1 autocapitalize=characters autocorrect=off></div>" +
        "<div class=row><label>" + t("Device ID 2 (optional)", "ID d'appareil 2 (facultatif)") + "</label><input id=id2 autocapitalize=characters autocorrect=off></div></div>" +
        "<p class=hint>" + t("The portal (MAG, Ministra) and the MAC address your provider registered. The serial number and device IDs only if it asks for them.", "Le portail (MAG, Ministra) et l'adresse MAC enregistrée par ton fournisseur. Le numéro de série et les ID d'appareil seulement s'il les demande.") + "</p></div>" +
        "<div id=fj class=hide><div class=card><label>" + t("Server", "Serveur") + "</label><input id=jserver inputmode=url autocapitalize=off autocorrect=off placeholder='http://192.168.1.20:8096'>" +
        "<div class=row><label>" + t("Username", "Nom d'utilisateur") + "</label><input id=juser autocapitalize=off autocorrect=off></div>" +
        "<div class=row><label>" + t("Password", "Mot de passe") + "</label><input id=jpass type=password autocapitalize=off autocorrect=off></div></div>" +
        "<p class=hint>" + t("Your Jellyfin or Emby server: its address, your user name and your password.", "Ton serveur Jellyfin ou Emby : son adresse, ton nom d'utilisateur et ton mot de passe.") + "</p></div>" +
        "<div id=fp class=hide><p class=hint>" + t("Plex links with a code: tap the button below, a code appears on the TV, then type it on plex.tv/link with this phone.", "Plex se relie avec un code : touche le bouton ci-dessous, un code s'affiche sur la TV, puis tape-le sur plex.tv/link avec ce t\u00E9l\u00E9phone.") + "</p></div>" +
        "<div class=card id=fe><label>" + t("Name (optional)", "Nom (facultatif)") + "</label><input id=name placeholder='" + t("My TV", "Ma TV") + "'>" +
        "<div class=row id=fepg><label>" + t("TV guide address, XMLTV (optional)", "Adresse du guide TV, XMLTV (facultatif)") + "</label><input id=epg inputmode=url autocapitalize=off autocorrect=off></div></div>" +
        "<div class=card><label>" + t("TMDB key (optional)", "Clé TMDB (facultatif)") + "</label><input id=tmdb autocapitalize=off autocorrect=off spellcheck=false></div>" +
        "<p class=hint>" + t("For posters, summaries and ratings: your free key from themoviedb.org (Settings › API). You can send it alone.", "Pour les affiches, les résumés et les notes : ta clé gratuite de themoviedb.org (Paramètres › API). Tu peux l'envoyer seule.") + "</p>" +
        "<button class=go id=go type=button>" + t("Send to the screen", "Envoyer à l'écran") + "</button><div class=msg id=msg></div></div>" +
        "<div id=done class='done hide'><div class=big>✓</div><h2>" + t("Sent!", "C'est envoyé !") + "</h2><p id=donep>" + t("Look at your screen: APL TV is loading your playlist.", "Regarde ton écran : APL TV charge ta playlist.") + "</p></div>" +
        "<script>var K=" + JSON.stringify(token).replace(/</g, "\\u003c") + ",mode='xtream';function $(i){return document.getElementById(i)}" +
        "var M={xtream:['bx','fx'],m3u:['bm','fm'],stalker:['bs','fs'],jellyfin:['bj','fj'],plex:['bp','fp']};" +
        "function sw(m){mode=m;for(var k in M){$(M[k][0]).className=k==m?'on':'';$(M[k][1]).className=k==m?'':'hide'}$('fe').className=m=='plex'?'card hide':'card';$('fepg').className=m=='jellyfin'?'row hide':'row';" +
        "$('go').textContent=m=='plex'?" + JSON.stringify(t("Show the Plex code on the TV", "Afficher le code Plex sur la TV")) + ":" + JSON.stringify(t("Send to the screen", "Envoyer \u00E0 l'\u00E9cran")) + "}" +
        "$('bx').onclick=function(){sw('xtream')};$('bm').onclick=function(){sw('m3u')};$('bs').onclick=function(){sw('stalker')};$('bj').onclick=function(){sw('jellyfin')};$('bp').onclick=function(){sw('plex')};" +
        "$('go').onclick=function(){var b={k:K,type:mode,name:$('name').value,epg:$('epg').value,tmdb:$('tmdb').value.trim()};" +
        "var only=function(m){if(b.tmdb){b.type='key';return true}$('msg').textContent=m;return false};" +
        "if(mode=='xtream'){b.server=$('server').value;b.user=$('user').value;b.pass=$('pass').value;if(!b.server||(!/get\\.php/i.test(b.server)&&(!b.user||!b.pass))){if(!only(" + JSON.stringify(t("Fill in the server, the username and the password.", "Remplis le serveur, l'identifiant et le mot de passe.")) + "))return}}" +
        "else if(mode=='stalker'){b.portal=$('portal').value;b.mac=$('mac').value;b.sn=$('sn').value.trim();b.id1=$('id1').value.trim();b.id2=$('id2').value.trim();if(!b.portal||b.mac.replace(/[^0-9a-f]/gi,'').length!=12){if(!only(" + JSON.stringify(t("Fill in the portal and a MAC address like 00:1A:79:12:34:56.", "Remplis le portail et une adresse MAC comme 00:1A:79:12:34:56.")) + "))return}}" +
        "else if(mode=='jellyfin'){b.server=$('jserver').value;b.user=$('juser').value;b.pass=$('jpass').value;b.epg='';if(!b.server||!b.user){if(!only(" + JSON.stringify(t("Fill in the server's address and your user name.", "Remplis l'adresse du serveur et ton nom d'utilisateur.")) + "))return}}" +
        "else if(mode=='plex'){b.name='';b.epg=''}" +
        "else{b.url=$('url').value;if(!b.url){if(!only(" + JSON.stringify(t("Paste the playlist's link.", "Colle le lien de la playlist.")) + "))return}}" +
        "$('go').disabled=true;$('msg').textContent='';var x=new XMLHttpRequest();x.open('POST','/submit');x.setRequestHeader('Content-Type','application/json');" +
        "x.onload=function(){if(x.status==200){$('form').className='hide';$('done').className='done';if(b.type=='key')$('donep').textContent=" + JSON.stringify(t("Look at your screen: APL TV is checking your TMDB key.", "Regarde ton écran : APL TV vérifie ta clé TMDB.")) + ";else if(mode=='plex')$('donep').textContent=" + JSON.stringify(t("Look at your TV: the Plex code is there. Type it on plex.tv/link.", "Regarde ta TV : le code Plex y est. Tape-le sur plex.tv/link.")) + "}else{$('go').disabled=false;$('msg').textContent=x.status==403?" + JSON.stringify(t("This code has expired: scan the new one on the screen.", "Ce code a expiré : scanne le nouveau sur l'écran.")) + ":" + JSON.stringify(t("The screen did not answer. Is the phone on the same Wi-Fi?", "L'écran n'a pas répondu. Le téléphone est-il sur le même Wi-Fi ?")) + "}};" +
        "x.onerror=function(){$('go').disabled=false;$('msg').textContent=" + JSON.stringify(t("The screen did not answer. Is the phone on the same Wi-Fi?", "L'écran n'a pas répondu. Le téléphone est-il sur le même Wi-Fi ?")) + "};x.send(JSON.stringify(b))};" +
        "</script></body></html>";
}

/* ---------- the phone editor: your categories (hidden, order), your groups of channels, your favorites ----------
   The app sends what it has (POST /edit/start, local only) and gets a code; the phone opens /edit?k=CODE, changes
   things and sends them back (POST /edit/save); the app takes them (GET /edit/pending, local only). The page's
   script (editScript) runs on the phone: it is sent as text. */
var edit = null;              // { token, at, data, saved, wrong }
var EDIT_MS = 30 * 60 * 1000;
function editOk(k) { return !!(edit && k && k === edit.token && Date.now() - edit.at < EDIT_MS); }
function editWrong() { if (edit && ++edit.wrong >= 20) { log("too many wrong editor codes: closed"); edit = null; } }
var EDIT_TEXT = {
    en: { sub: "Hide or move your categories, make your groups of channels, order your favorites, rename or hide channels. Then send it all to the TV.", cats: "Categories", groups: "Groups", favs: "Favorites",
          live: "TV", movies: "Movies", series: "Series", catsHint: "The switch hides or shows a category everywhere on the TV; Hide all / Show all do the whole list, or just what your search finds (\u201Car\u201D, \u201Cadult\u201D\u2026). Hold \u2261 and drag to move one, or tap categories to select them, then move, hide or show them all at once.", none: "Nothing here.",
          groupsHint: "Your own lists of channels, shown in Live TV and the Guide after Favorites. Hold \u2261 and drag to move a channel.", rename: "Rename", del: "Delete", addChans: "Add channels", newGroup: "New group",
          favsHint: "Your favorite channels, in the order the TV shows them. Hold \u2261 and drag to move one.", noChans: "No channels yet.", search: "Search a channel", done: "Done", noMatch: "No channel with this name.",
          groupName: "Name of the group", delGroup: "Delete the group \u201C{name}\u201D?", send: "Send to the TV", sent: "Sent!", sentHow: "Look at your TV: your changes are there.",
          again: "Keep editing", expired: "This code has expired", expiredHow: "On the TV, open APL TV \u203A Settings \u203A Edit on Your Phone, then scan the new code.",
          noAnswer: "The TV did not answer. Is the phone on the same Wi-Fi?", error: "Something went wrong. Scan the code again.", loading: "Loading your playlist\u2026",
          findCat: "Search a category", noCat: "No category with this name.", sel1: "1 selected", seln: "{n} selected", toTop: "To the top", toBottom: "To the bottom",
          moveAfter: "Put after\u2026", placeHint: "Now tap the category they should come after.", cancel: "Cancel",
          hideAll: "Hide all", showAll: "Show all", hideN: "Hide these {n}", showN: "Show these {n}", hideSel: "Hide", showSel: "Show", shownOf: "{n} of {t} shown on the TV",
          names: "Channels", namesHint: "Give a channel the name you want: the TV shows it everywhere (Live TV, the guide, search, Continue) and keeps it when your playlist updates. Leave it empty to get the provider's name back. Hide takes a channel out of Live TV, the guide and search; your favorites and groups keep it.",
          hideCh: "Hide", showCh: "Show", hiddenCh: "Hidden",
          renamed: "Renamed", findChan: "Search a channel to rename or hide", newName: "Name of the channel", was: "was {name}", reset: "Provider's name", typeMore: "Type a few letters of the channel." },
    fr: { sub: "Masque ou d\u00E9place tes cat\u00E9gories, fais tes groupes de cha\u00EEnes, range tes favoris, renomme ou masque tes cha\u00EEnes. Puis envoie tout \u00E0 la TV.", cats: "Cat\u00E9gories", groups: "Groupes", favs: "Favoris",
          live: "TV", movies: "Films", series: "S\u00E9ries", catsHint: "L'interrupteur masque ou affiche une cat\u00E9gorie partout sur la TV ; Tout masquer / Tout afficher font toute la liste, ou seulement ce que trouve ta recherche (\u00AB ar \u00BB, \u00AB adult \u00BB\u2026). Maintiens \u2261 et fais glisser pour en d\u00E9placer une, ou touche des cat\u00E9gories pour les s\u00E9lectionner, puis les d\u00E9placer, masquer ou afficher d'un coup.", none: "Rien ici.",
          groupsHint: "Tes propres listes de cha\u00EEnes, dans la TV en direct et le Guide apr\u00E8s les Favoris. Maintiens \u2261 et fais glisser pour d\u00E9placer une cha\u00EEne.", rename: "Renommer", del: "Supprimer", addChans: "Ajouter des cha\u00EEnes", newGroup: "Nouveau groupe",
          favsHint: "Tes cha\u00EEnes favorites, dans l'ordre o\u00F9 la TV les montre. Maintiens \u2261 et fais glisser pour en d\u00E9placer une.", noChans: "Pas encore de cha\u00EEne.", search: "Chercher une cha\u00EEne", done: "OK", noMatch: "Aucune cha\u00EEne avec ce nom.",
          groupName: "Nom du groupe", delGroup: "Supprimer le groupe \u00AB {name} \u00BB ?", send: "Envoyer \u00E0 la TV", sent: "C'est envoy\u00E9 !", sentHow: "Regarde ta TV : tes changements y sont.",
          again: "Continuer \u00E0 modifier", expired: "Ce code a expir\u00E9", expiredHow: "Sur la TV, ouvre APL TV \u203A R\u00E9glages \u203A Modifier sur ton t\u00E9l\u00E9phone, puis scanne le nouveau code.",
          noAnswer: "La TV n'a pas r\u00E9pondu. Le t\u00E9l\u00E9phone est-il sur le m\u00EAme Wi-Fi ?", error: "Un probl\u00E8me est survenu. Scanne \u00E0 nouveau le code.", loading: "Chargement de ta playlist\u2026",
          findCat: "Chercher une cat\u00E9gorie", noCat: "Aucune cat\u00E9gorie avec ce nom.", sel1: "1 s\u00E9lectionn\u00E9e", seln: "{n} s\u00E9lectionn\u00E9es", toTop: "Tout en haut", toBottom: "Tout en bas",
          moveAfter: "Placer apr\u00E8s\u2026", placeHint: "Touche maintenant la cat\u00E9gorie apr\u00E8s laquelle les mettre.", cancel: "Annuler",
          hideAll: "Tout masquer", showAll: "Tout afficher", hideN: "Masquer ces {n}", showN: "Afficher ces {n}", hideSel: "Masquer", showSel: "Afficher", shownOf: "{n} sur {t} affich\u00E9es sur la TV",
          names: "Cha\u00EEnes", namesHint: "Donne \u00E0 une cha\u00EEne le nom que tu veux : la TV l'affiche partout (TV en direct, guide, recherche, Reprendre) et le garde quand ta playlist se met \u00E0 jour. Laisse vide pour retrouver le nom du fournisseur. Masquer retire une cha\u00EEne de la TV en direct, du guide et de la recherche ; tes favoris et tes groupes la gardent.",
          hideCh: "Masquer", showCh: "Afficher", hiddenCh: "Masqu\u00E9es",
          renamed: "Renomm\u00E9es", findChan: "Chercher une cha\u00EEne \u00E0 renommer ou masquer", newName: "Nom de la cha\u00EEne", was: "avant : {name}", reset: "Nom du fournisseur", typeMore: "Tape quelques lettres de la cha\u00EEne." },
    pl: { sub: "Ukrywaj lub przeno\u015B kategorie, tw\u00F3rz grupy kana\u0142\u00F3w, uk\u0142adaj ulubione, zmieniaj nazwy kana\u0142\u00F3w lub je ukrywaj. Potem wy\u015Blij wszystko do telewizora.", cats: "Kategorie", groups: "Grupy", favs: "Ulubione",
          live: "TV", movies: "Filmy", series: "Seriale", catsHint: "Prze\u0142\u0105cznik ukrywa lub pokazuje kategori\u0119 wsz\u0119dzie na telewizorze. Przytrzymaj \u2261 i przeci\u0105gnij, aby przenie\u015B\u0107 kategori\u0119, albo stuknij kategorie, aby je zaznaczy\u0107 i przenie\u015B\u0107 wszystkie naraz.", none: "Nic tu nie ma.",
          groupsHint: "Twoje w\u0142asne listy kana\u0142\u00F3w, widoczne w TV na \u017Cywo i w Przewodniku po Ulubionych. Przytrzymaj \u2261 i przeci\u0105gnij, aby przenie\u015B\u0107 kana\u0142.", rename: "Zmie\u0144 nazw\u0119", del: "Usu\u0144", addChans: "Dodaj kana\u0142y", newGroup: "Nowa grupa",
          favsHint: "Twoje ulubione kana\u0142y w kolejno\u015Bci, w jakiej pokazuje je telewizor. Przytrzymaj \u2261 i przeci\u0105gnij, aby przenie\u015B\u0107 kana\u0142.", noChans: "Brak kana\u0142\u00F3w.", search: "Szukaj kana\u0142u", done: "Gotowe", noMatch: "Brak kana\u0142u o tej nazwie.",
          groupName: "Nazwa grupy", delGroup: "Usun\u0105\u0107 grup\u0119 \u201E{name}\u201D?", send: "Wy\u015Blij do telewizora", sent: "Wys\u0142ano!", sentHow: "Sp\u00F3jrz na telewizor: zmiany ju\u017C tam s\u0105.",
          again: "Edytuj dalej", expired: "Ten kod wygas\u0142", expiredHow: "Na telewizorze otw\u00F3rz APL TV \u203A Ustawienia \u203A Edytuj na telefonie, a potem zeskanuj nowy kod.",
          noAnswer: "Telewizor nie odpowiedzia\u0142. Czy telefon jest w tej samej sieci Wi-Fi?", error: "Co\u015B posz\u0142o nie tak. Zeskanuj kod ponownie.", loading: "Wczytywanie playlisty\u2026",
          findCat: "Szukaj kategorii", noCat: "Brak kategorii o tej nazwie.", sel1: "Zaznaczone: 1", seln: "Zaznaczone: {n}", toTop: "Na g\u00F3r\u0119", toBottom: "Na d\u00F3\u0142",
          moveAfter: "Umie\u015B\u0107 za\u2026", placeHint: "Teraz stuknij kategori\u0119, za kt\u00F3r\u0105 maj\u0105 si\u0119 znale\u017A\u0107.", cancel: "Anuluj",
          hideAll: "Ukryj wszystkie", showAll: "Poka\u017C wszystkie", hideN: "Ukryj znalezione ({n})", showN: "Poka\u017C znalezione ({n})", hideSel: "Ukryj", showSel: "Poka\u017C", shownOf: "Widoczne na telewizorze: {n} z {t}",
          names: "Nazwy", namesHint: "Nadaj kana\u0142owi dowoln\u0105 nazw\u0119: telewizor poka\u017Ce j\u0105 wsz\u0119dzie (TV na \u017Cywo, przewodnik, wyszukiwanie, Kontynuuj ogl\u0105danie) i zachowa j\u0105 po aktualizacji playlisty. Zostaw pole puste, aby przywr\u00F3ci\u0107 nazw\u0119 od dostawcy.",
          hideCh: "Ukryj", showCh: "Poka\u017C", hiddenCh: "Ukryte",
          renamed: "Ze zmienion\u0105 nazw\u0105", findChan: "Wyszukaj kana\u0142, aby zmieni\u0107 nazw\u0119 lub go ukry\u0107", newName: "Nazwa kana\u0142u", was: "wcze\u015Bniej: {name}", reset: "Nazwa od dostawcy", typeMore: "Wpisz kilka liter nazwy kana\u0142u." },
    it: {"sub":"Nascondi o sposta le categorie, crea i tuoi gruppi di canali, ordina i preferiti. Poi invia tutto alla TV.","cats":"Categorie","groups":"Gruppi","favs":"Preferiti","live":"TV","movies":"Film","series":"Serie","catsHint":"L'interruttore nasconde o mostra una categoria ovunque sulla TV; Nascondi tutto / Mostra tutto agiscono su tutto l'elenco, o solo su ciò che trova la ricerca (“ar”, “adult”…). Tieni premuto ≡ e trascina per spostarne una, o tocca le categorie per selezionarle, poi spostale, nascondile o mostrale tutte insieme.","none":"Niente qui.","groupsHint":"Le tue liste di canali, in TV in diretta e nella Guida dopo i Preferiti. Tieni premuto ≡ e trascina per spostare un canale.","rename":"Rinomina","del":"Elimina","addChans":"Aggiungi canali","newGroup":"Nuovo gruppo","favsHint":"I tuoi canali preferiti, nell'ordine in cui la TV li mostra. Tieni premuto ≡ e trascina per spostarne uno.","noChans":"Ancora nessun canale.","search":"Cerca un canale","done":"Fine","noMatch":"Nessun canale con questo nome.","groupName":"Nome del gruppo","delGroup":"Eliminare il gruppo “{name}”?","send":"Invia alla TV","sent":"Inviato!","sentHow":"Guarda la TV: le tue modifiche sono lì.","again":"Continua a modificare","expired":"Questo codice è scaduto","expiredHow":"Sulla TV, apri APL TV › Impostazioni › Modifica dal telefono, poi inquadra il nuovo codice.","noAnswer":"La TV non ha risposto. Il telefono è sulla stessa rete Wi-Fi?","error":"Qualcosa è andato storto. Inquadra di nuovo il codice.","loading":"Caricamento della playlist…","findCat":"Cerca una categoria","noCat":"Nessuna categoria con questo nome.","sel1":"1 selezionata","seln":"{n} selezionate","toTop":"In cima","toBottom":"In fondo","moveAfter":"Metti dopo…","placeHint":"Ora tocca la categoria dopo la quale metterle.","cancel":"Annulla","hideAll":"Nascondi tutto","showAll":"Mostra tutto","hideN":"Nascondi queste {n}","showN":"Mostra queste {n}","hideSel":"Nascondi","showSel":"Mostra","shownOf":"{n} su {t} visibili sulla TV","names":"Nomi","namesHint":"Dai a un canale il nome che vuoi: la TV lo mostra ovunque (TV in diretta, guida, ricerca, Continua a guardare) e lo mantiene quando la playlist si aggiorna. Lascia vuoto per tornare al nome del fornitore.","renamed":"Rinominati","findChan":"Cerca un canale da rinominare","newName":"Nome del canale","was":"prima: {name}","reset":"Nome del fornitore","typeMore":"Scrivi qualche lettera del canale.","hideCh":"Nascondi","showCh":"Mostra","hiddenCh":"Nascosti"}
};
var EDIT_CSS = ".r{display:flex;align-items:center;gap:8px;padding:10px 12px;border-top:1px solid rgba(255,255,255,.08)}.card>.r:first-child{border-top:0}" +
    ".r .n{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.r small{color:rgba(255,255,255,.5);font-size:13px;margin-left:4px}.r.off .n{opacity:.45}" +
    "button.mv{border:0;background:rgba(255,255,255,.1);color:#fff;width:38px;height:34px;border-radius:9px;font-size:14px;flex:none}button.red{color:#ff6961}" +
    "button.sw{border:0;width:51px;height:31px;border-radius:16px;background:rgba(120,120,128,.4);position:relative;flex:none}button.sw i{position:absolute;left:2px;top:2px;width:27px;height:27px;border-radius:14px;background:#fff;transition:left .15s}" +
    "button.sw.on{background:#34c759}button.sw.on i{left:22px}button.sm{border:0;background:rgba(255,255,255,.12);color:#fff;font:600 14px inherit;padding:7px 10px;border-radius:9px;flex:none}" +
    "button.add{display:block;width:100%;border:0;border-top:1px solid rgba(255,255,255,.08);background:none;color:#0a84ff;font:600 16px inherit;padding:13px 14px;text-align:left}" +
    "button.go2{width:100%;border:0;border-radius:14px;background:rgba(255,255,255,.12);color:#fff;font:600 17px inherit;padding:14px;margin:6px 0 14px}.r.head{background:rgba(255,255,255,.05)}" +
    ".bar{position:sticky;bottom:0;padding:16px 0 6px;background:linear-gradient(rgba(0,0,0,0),#000 35%)}.empty{padding:16px;color:rgba(255,255,255,.5);text-align:center}#kinds{margin-top:-8px}" +
    ".ov{position:fixed;left:0;top:0;right:0;bottom:0;background:#0b0d13;overflow:auto;padding:16px 16px 40px;z-index:5}.ovh{display:flex;gap:8px;position:sticky;top:0;background:#0b0d13;padding-bottom:10px;z-index:1}" +
    ".ovh input{flex:1;background:rgba(255,255,255,.1);border-radius:12px;padding:12px 14px}.r.pick .ck{color:#0a84ff;font-size:20px;width:28px;text-align:center;flex:none}.r.pick.on .ck{color:#34c759}" +
    // dragging (the handle), selecting several categories, searching one
    ".hd{flex:none;width:40px;height:36px;margin-right:-6px;display:flex;align-items:center;justify-content:center;font-size:26px;line-height:1;color:rgba(255,255,255,.5);" +
    "touch-action:none;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none;cursor:grab}.card.dragging{overflow:visible}.dragging .r{transition:transform .15s}" +
    ".r.drag{position:relative;z-index:5;transition:none;background:#2a2e38;border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,.65)}.bar{z-index:6}" +
    ".r .sc{flex:none;width:24px;height:24px;border-radius:12px;border:2px solid rgba(255,255,255,.35);position:relative}" +
    ".r.sel{background:rgba(10,132,255,.2)}.r.sel .sc{background:#0a84ff;border-color:#0a84ff}.r.sel .sc:after{content:'';position:absolute;left:6px;top:2px;width:6px;height:11px;border:solid #fff;border-width:0 2px 2px 0;transform:rotate(45deg)}" +
    "input.find{display:block;background:rgba(255,255,255,.1);border-radius:12px;padding:12px 14px;margin:0 0 12px;-webkit-appearance:none}" +
    ".selbox{background:#1f232c;border-radius:16px;padding:10px;margin-bottom:10px;box-shadow:0 -4px 24px rgba(0,0,0,.6),inset 0 1px 0 rgba(255,255,255,.1)}" +
    ".selbar{display:flex;align-items:center;gap:8px}.selbar span{flex:1;font-size:15px;line-height:1.3;color:rgba(255,255,255,.9);padding-left:6px}" +
    ".selacts{display:flex;gap:8px;margin-top:10px}.selacts button{flex:1;padding:12px 4px;background:rgba(255,255,255,.14)}" +
    "@keyframes fl{from{background:rgba(52,199,89,.4)}to{background:rgba(52,199,89,0)}}.r.flash{animation:fl 1.8s ease-out}" +
    ".bulk{display:flex;gap:8px;margin:0 0 8px}.bulk button{flex:1;padding:11px 4px}.cnt{font-size:13px;color:rgba(255,255,255,.5);margin:0 0 10px 4px}" +
    ".placing .r{box-shadow:inset 3px 0 0 #0a84ff}.placing .r.sel{opacity:.45;box-shadow:none}.placing .sw,.placing .hd{pointer-events:none;opacity:.35}" +
    ".r .n2{overflow:hidden;text-overflow:ellipsis}.r .n2 small{display:block;margin:2px 0 0;overflow:hidden;text-overflow:ellipsis}";
function editScript() {
    var D = null, tab = "cats", kind = "live", picker = null, byId = {}, filter = "", placing = false, drag = null, nameQ = "";
    var app = document.getElementById("app");
    function $(id) { return document.getElementById(id); }
    function h(v) { return String(v === null || v === undefined ? "" : v).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c]; }); }
    function fold(v) { v = String(v || "").toLowerCase(); return v.normalize ? v.normalize("NFD").replace(/[\u0300-\u036f]/g, "") : v; }
    function seg(id, items, cur) { return "<div class=seg id=" + id + ">" + items.map(function (it) { return "<button type=button data-v='" + it[0] + "' class='" + (it[0] === cur ? "on" : "") + "'>" + h(it[1]) + "</button>"; }).join("") + "</div>"; }
    function listOf(l) { return l === "f" ? D.favs : D.groups[+l.slice(1)].ids; }
    function cats() { return D.kinds[kind] || []; }
    function selCount() { var n = 0; cats().forEach(function (c) { if (c.sel) n++; }); return n; }
    function chanRows(ids, l) {
        if (!ids.length) return "<div class=empty>" + h(L.noChans) + "</div>";
        return ids.map(function (id, i) {
            var c = byId[id];
            return "<div class=r data-row=" + i + "><span class=n>" + h(c ? c[1] : id) + (c && c[2] ? " <small>" + h(c[2]) + "</small>" : "") + "</span>" +
                "<button class='mv red' data-a=cdel data-l=" + l + " data-i=" + i + ">\u2715</button><span class=hd>\u2261</span></div>";
        }).join("");
    }
    function draw() {
        var html = "<h1>APL <span>TV</span></h1><p class=sub>" + h(L.sub) + "</p>" + seg("tabs", [["cats", L.cats], ["groups", L.groups], ["favs", L.favs], ["names", L.names]], tab);
        if (tab === "cats") {
            html += seg("kinds", [["live", L.live], ["movies", L.movies], ["series", L.series]], kind) + "<p class=hint>" + h(L.catsHint) + "</p>";
            if (cats().length > 8) html += "<input class=find id=find type=search placeholder='" + h(L.findCat) + "' value='" + h(filter) + "' autocomplete=off autocorrect=off autocapitalize=off>";
            html += "<div class=bulk id=bulk></div><div class=cnt id=cnt></div><div class=card id=cats data-list=cats></div>";
        } else if (tab === "groups") {
            html += "<p class=hint>" + h(L.groupsHint) + "</p>";
            D.groups.forEach(function (g, gi) {
                html += "<div class=card data-list=g" + gi + "><div class='r head'><span class=n>" + h(g.name) + " <small>" + g.ids.length + "</small></span>" +
                    "<button class=sm data-a=gren data-g=" + gi + ">" + h(L.rename) + "</button><button class='sm red' data-a=gdel data-g=" + gi + ">" + h(L.del) + "</button></div>" +
                    chanRows(g.ids, "g" + gi) + "<button class=add data-a=gadd data-g=" + gi + ">+ " + h(L.addChans) + "</button></div>";
            });
            html += "<button class=go2 data-a=gnew>+ " + h(L.newGroup) + "</button>";
        } else if (tab === "names") {
            // your names: the ones renamed first, then a search for the one to rename (issue #6)
            html += "<p class=hint>" + h(L.namesHint) + "</p>";
            var ren = Object.keys(D.names).filter(function (id) { return byId[id]; });
            if (ren.length) html += "<p class=cnt>" + h(L.renamed) + "</p><div class=card>" + ren.map(function (id) {
                return "<div class=r><span class='n n2'>" + h(D.names[id]) + " <small>" + h(L.was.replace("{name}", byId[id][3] || byId[id][1])) + "</small></span>" +
                    "<button class=sm data-a=nren data-id='" + h(id) + "'>" + h(L.rename) + "</button><button class='mv red' data-a=nreset data-id='" + h(id) + "'>\u2715</button></div>";
            }).join("") + "</div>";
            var hid = Object.keys(D.hid).filter(function (id) { return byId[id]; });
            if (hid.length) html += "<p class=cnt>" + h(L.hiddenCh) + "</p><div class=card>" + hid.map(function (id) {
                return "<div class='r off'><span class='n n2'>" + h(D.names[id] || byId[id][1]) + " <small>" + h(byId[id][2]) + "</small></span>" +
                    "<button class=sm data-a=nshow data-id='" + h(id) + "'>" + h(L.showCh) + "</button></div>";
            }).join("") + "</div>";
            html += "<input class=find id=nfind type=search placeholder='" + h(L.findChan) + "' value='" + h(nameQ) + "' autocomplete=off autocorrect=off autocapitalize=off><div id=nres></div>";
        } else {
            html += "<p class=hint>" + h(L.favsHint) + "</p><div class=card data-list=f>" + chanRows(D.favs, "f") + "<button class=add data-a=fadd>+ " + h(L.addChans) + "</button></div>";
        }
        html += "<div class=bar id=bar></div>";
        app.innerHTML = html;
        if (tab === "cats") { drawCats(); var f = $("find"); if (f) f.oninput = function () { filter = this.value; drawCats(); }; }
        if (tab === "names") { drawNames(); var nf = $("nfind"); if (nf) nf.oninput = function () { nameQ = this.value; drawNames(); }; }
        drawBar();
    }
    /* The channels found for a name (two letters at least): each with Rename */
    function drawNames() {
        var box = $("nres"), q = fold(nameQ).trim(), all = D.chans || [], out = [];
        if (!box) return;
        if (q.length < 2) { box.innerHTML = "<div class=empty>" + h(L.typeMore) + "</div>"; return; }
        for (var i = 0; i < all.length && out.length < 80; i++) if (fold(all[i][1] + " " + (all[i][3] || "")).indexOf(q) >= 0) out.push(all[i]);
        box.innerHTML = out.length ? "<div class=card>" + out.map(function (c) {
            var mine = D.names[c[0]], off = !!D.hid[c[0]];
            return "<div class='r" + (off ? " off" : "") + "'><span class='n n2'>" + h(mine || c[1]) + " <small>" + h(mine ? L.was.replace("{name}", c[3] || c[1]) : c[2]) + "</small></span>" +
                "<button class=sm data-a=nren data-id='" + h(c[0]) + "'>" + h(L.rename) + "</button>" +
                "<button class=sm data-a=" + (off ? "nshow" : "nhide") + " data-id='" + h(c[0]) + "'>" + h(off ? L.showCh : L.hideCh) + "</button></div>";
        }).join("") + "</div>" : "<div class=empty>" + h(L.noMatch) + "</div>";
    }
    /* The categories of one kind: tap to select (several at once), the switch hides, the handle drags (not while searching) */
    function drawCats() {
        var box = $("cats"), list = cats(), q = fold(filter).trim(), out = "", shown = 0;
        if (!box) return;
        list.forEach(function (c, i) {
            if (q && fold(c.name).indexOf(q) < 0) return;
            shown++;
            out += "<div class='r" + (c.off ? " off" : "") + (c.sel ? " sel" : "") + (c.flash ? " flash" : "") + "' data-row=" + i + ">" +
                "<span class=sc data-a=sel data-i=" + i + "></span><span class=n data-a=sel data-i=" + i + ">" + h(c.name) + " <small>" + h(c.count) + "</small></span>" +
                "<button class='sw" + (c.off ? "" : " on") + "' data-a=sw data-i=" + i + "><i></i></button>" + (q ? "" : "<span class=hd>\u2261</span>") + "</div>";
        });
        box.innerHTML = shown ? out : "<div class=empty>" + h(list.length ? L.noCat : L.none) + "</div>";
        // hide or show the whole list, or what the search finds
        var bulk = $("bulk"), cnt = $("cnt"), on = 0;
        list.forEach(function (c) { if (!c.off) on++; });
        if (bulk) bulk.innerHTML = list.length ? "<button class=sm data-a=hideall>" + h(q ? L.hideN.replace("{n}", shown) : L.hideAll) + "</button><button class=sm data-a=showall>" + h(q ? L.showN.replace("{n}", shown) : L.showAll) + "</button>" : "";
        if (cnt) cnt.textContent = list.length ? L.shownOf.replace("{n}", on).replace("{t}", list.length) : "";
        box.className = "card" + (placing ? " placing" : "");
    }
    function drawBar() {
        var b = $("bar"), n = tab === "cats" ? selCount() : 0, top = "";
        if (!b) return;
        if (!n) placing = false;
        if (placing) top = "<div class=selbox><div class=selbar><span>" + h(L.placeHint) + "</span><button class=sm data-a=pcancel>" + h(L.cancel) + "</button></div></div>";
        else if (n) top = "<div class=selbox><div class=selbar><span>" + h((n === 1 ? L.sel1 : L.seln).replace("{n}", n)) + "</span><button class=sm data-a=sclear>" + h(L.cancel) + "</button></div>" +
            "<div class=selacts><button class=sm data-a=stop>\u2191 " + h(L.toTop) + "</button><button class=sm data-a=sbottom>\u2193 " + h(L.toBottom) + "</button><button class=sm data-a=splace>" + h(L.moveAfter) + "</button></div>" +
            "<div class=selacts><button class=sm data-a=shide>" + h(L.hideSel) + "</button><button class=sm data-a=sshow>" + h(L.showSel) + "</button></div></div>";
        b.innerHTML = top + "<button class=go id=send data-a=send>" + h(L.send) + "</button><div class=msg id=msg></div>";
    }
    /* The selected categories, in their order: to the top, to the bottom, or right after another one */
    function moveSel(where, after) {
        var list = cats(), picked = [], rest = [];
        list.forEach(function (c) { (c.sel ? picked : rest).push(c); });
        if (!picked.length) return;
        var k = where === "top" ? 0 : where === "bottom" ? rest.length : rest.indexOf(list[after]) + 1;
        picked.forEach(function (c) { c.sel = false; c.flash = true; });
        D.kinds[kind] = rest.slice(0, k).concat(picked, rest.slice(k));
    }
    /* What just moved flashes green, and comes into view if it is not */
    function showMoved() {
        var el = app.querySelector(".r.flash");
        if (el) {
            var r = el.getBoundingClientRect();
            if (r.top < 70 || r.bottom > window.innerHeight - 170) { try { el.scrollIntoView({ block: "center" }); } catch (x) { el.scrollIntoView(); } }
        }
        if (D.kinds[kind]) D.kinds[kind].forEach(function (c) { c.flash = false; });
    }

    /* ---- dragging a row by its handle (categories, a group's channels, favorites). The page scrolls by itself near
       the top and the bottom of the screen, so a category can go from the end of a long list to its start in one go. ---- */
    function scrollY() { return window.pageYOffset || document.documentElement.scrollTop || 0; }
    function point(e) { var t = (e.touches && e.touches[0]) || (e.changedTouches && e.changedTouches[0]); return t || e; }
    function dragStart(e) {
        if (drag || picker || placing) return;
        var hd = e.target && e.target.closest ? e.target.closest(".hd") : null;
        if (!hd) return;
        var row = hd.parentNode, box = row.parentNode, rows = [].slice.call(box.querySelectorAll(".r[data-row]")), s = scrollY();
        if (rows.length < 2 || !box.getAttribute("data-list")) return;
        if (e.cancelable) e.preventDefault();
        drag = { box: box, key: box.getAttribute("data-list"), row: row, rows: rows, from: rows.indexOf(row), y0: point(e).clientY, s0: s, h: row.offsetHeight,
            mids: rows.map(function (r) { var b = r.getBoundingClientRect(); return b.top + s + b.height / 2; }) };
        drag.to = drag.from; drag.y = drag.y0;
        box.className += " dragging"; row.className += " drag";
        drag.raf = requestAnimationFrame(tick);
    }
    function place() {
        var d = drag, dy = d.y - d.y0 + scrollY() - d.s0, center = d.mids[d.from] + dy, to = 0, i;
        d.row.style.transform = "translateY(" + dy + "px)";
        for (i = 0; i < d.mids.length; i++) if (i !== d.from && d.mids[i] < center) to++;
        if (to === d.to) return;
        d.to = to;
        for (i = 0; i < d.rows.length; i++) {
            if (i === d.from) continue;
            var sh = d.from < to && i > d.from && i <= to ? -d.h : d.from > to && i >= to && i < d.from ? d.h : 0;
            d.rows[i].style.transform = sh ? "translateY(" + sh + "px)" : "";
        }
    }
    // only once the finger goes toward an edge: a row taken near the bottom does not run away by itself
    function tick() {
        if (!drag) return;
        var y = drag.y, bar = $("bar"), low = (bar ? bar.getBoundingClientRect().top : window.innerHeight - 100) - 30, v = 0;
        if (y < 90 && y < drag.y0 - 8) v = -Math.min(32, Math.ceil((90 - y) / 3));
        else if (y > low && y > drag.y0 + 8) v = Math.min(32, Math.ceil((y - low) / 3));
        if (v) { window.scrollBy(0, v); place(); }
        drag.raf = requestAnimationFrame(tick);
    }
    function dragMove(e) { if (!drag) return; if (e.cancelable) e.preventDefault(); drag.y = point(e).clientY; place(); }
    function dragEnd() {
        if (!drag) return;
        var d = drag, list = d.key === "cats" ? cats() : listOf(d.key);
        drag = null;
        cancelAnimationFrame(d.raf);
        if (d.to !== d.from && d.from >= 0) { var it = list.splice(d.from, 1)[0]; list.splice(d.to, 0, it); if (it && typeof it === "object") it.flash = true; }
        draw();
        showMoved();
    }
    if (window.PointerEvent) {
        document.addEventListener("pointerdown", function (e) { if (!e.button) dragStart(e); });
        document.addEventListener("pointermove", dragMove);
        document.addEventListener("pointerup", dragEnd);
        document.addEventListener("pointercancel", dragEnd);
        // a finger on a handle never scrolls the page (older iPhones ignore touch-action)
        document.addEventListener("touchstart", function (e) { if (e.target && e.target.closest && e.target.closest(".hd")) e.preventDefault(); }, { passive: false });
        document.addEventListener("touchmove", function (e) { if (drag) e.preventDefault(); }, { passive: false });
    } else {
        document.addEventListener("touchstart", dragStart, { passive: false });
        document.addEventListener("touchmove", dragMove, { passive: false });
        document.addEventListener("touchend", dragEnd);
        document.addEventListener("touchcancel", dragEnd);
    }

    function drawPicker() {
        var q = fold(picker.q).trim(), list = listOf(picker.target), out = [], all = D.chans || [];
        for (var i = 0; i < all.length && out.length < 150; i++) if (!q || fold(all[i][1]).indexOf(q) >= 0) out.push(all[i]);
        $("res").innerHTML = (out.length ? "" : "<div class=empty>" + h(L.noMatch) + "</div>") + "<div class=card>" + out.map(function (c) {
            var on = list.indexOf(c[0]) >= 0;
            return "<div class='r pick" + (on ? " on" : "") + "' data-id='" + h(c[0]) + "'><span class=n>" + h(c[1]) + " <small>" + h(c[2]) + "</small></span><span class=ck>" + (on ? "\u2713" : "+") + "</span></div>";
        }).join("") + "</div>";
    }
    function openPicker(target) {
        picker = { target: target, q: "" };
        var ov = document.createElement("div");
        ov.className = "ov"; ov.id = "ov";
        ov.innerHTML = "<div class=ovh><input id=q placeholder='" + h(L.search) + "' autocomplete=off autocorrect=off><button class=sm id=ovx data-a=pdone>" + h(L.done) + "</button></div><div id=res></div>";
        document.body.appendChild(ov);
        $("q").oninput = function () { picker.q = this.value; drawPicker(); };
        drawPicker();
        $("q").focus();
    }
    function closePicker() { var ov = $("ov"); if (ov) ov.parentNode.removeChild(ov); picker = null; draw(); }
    function send() {
        var b = { k: K, data: { kinds: {}, groups: D.groups, favs: D.favs, names: D.names, hidden: Object.keys(D.hid) } };
        Object.keys(D.kinds).forEach(function (k) { b.data.kinds[k] = D.kinds[k].map(function (c) { return { key: c.key, off: !!c.off }; }); });
        $("send").disabled = true; $("msg").textContent = "";
        var x = new XMLHttpRequest();
        x.open("POST", "/edit/save");
        x.setRequestHeader("Content-Type", "application/json");
        x.onload = function () {
            if (x.status === 200) app.innerHTML = "<div class=done><div class=big>\u2713</div><h2>" + h(L.sent) + "</h2><p>" + h(L.sentHow) + "</p><br><button class=go2 data-a=again>" + h(L.again) + "</button></div>";
            else { $("send").disabled = false; $("msg").textContent = x.status === 403 ? L.expired : L.noAnswer; }
        };
        x.onerror = function () { $("send").disabled = false; $("msg").textContent = L.noAnswer; };
        x.send(JSON.stringify(b));
    }
    document.addEventListener("click", function (e) {
        var t = e.target;
        while (t && t.nodeType === 1 && !(t.getAttribute("data-a") || t.getAttribute("data-v") || t.getAttribute("data-id"))) t = t.parentNode;
        var found = !!(t && t.nodeType === 1);
        var a = found ? t.getAttribute("data-a") : null, v = found ? t.getAttribute("data-v") : null, id = found ? t.getAttribute("data-id") : null,
            i = found ? +t.getAttribute("data-i") : -1, g = found ? +t.getAttribute("data-g") : -1, l = found ? t.getAttribute("data-l") : null;
        if (picker) {
            if (a === "pdone") { closePicker(); return; }
            if (id !== null) { var pl = listOf(picker.target), k = pl.indexOf(id); if (k >= 0) pl.splice(k, 1); else pl.push(id); drawPicker(); }
            return;
        }
        // "Put after...": the category tapped now is the one the selection goes after
        if (placing && tab === "cats") {
            if (a === "pcancel") { placing = false; drawCats(); drawBar(); return; }
            var r = e.target;
            while (r && r.nodeType === 1 && r.getAttribute("data-row") === null) r = r.parentNode;
            if (r && r.nodeType === 1 && r.parentNode && r.parentNode.id === "cats") {
                var at = +r.getAttribute("data-row"), c = cats()[at];
                if (!c || c.sel) return;
                moveSel("after", at); placing = false; filter = ""; draw(); showMoved();
                return;
            }
            if (!v && a !== "send") return;
            placing = false;
        }
        if (!found) return;
        if (v) { if (t.parentNode.id === "tabs") tab = v; else { kind = v; filter = ""; } draw(); return; }
        var cs = cats();
        if (a === "sel") { if (cs[i]) cs[i].sel = !cs[i].sel; drawCats(); drawBar(); return; }
        if (a === "sw") { if (cs[i]) cs[i].off = !cs[i].off; drawCats(); return; }
        if (a === "hideall" || a === "showall") {
            var fq = fold(filter).trim();
            cs.forEach(function (x) { if (!fq || fold(x.name).indexOf(fq) >= 0) x.off = a === "hideall"; });
            drawCats(); return;
        }
        if (a === "shide" || a === "sshow") { cs.forEach(function (x) { if (x.sel) { x.off = a === "shide"; x.sel = false; } }); drawCats(); drawBar(); return; }
        if (a === "stop" || a === "sbottom") { moveSel(a === "stop" ? "top" : "bottom"); filter = ""; draw(); showMoved(); return; }
        if (a === "splace") { placing = true; drawCats(); drawBar(); return; }
        if (a === "sclear") { cs.forEach(function (x) { x.sel = false; }); drawCats(); drawBar(); return; }
        if (a === "cdel") listOf(l).splice(i, 1);
        else if (a === "gnew") { var nm = prompt(L.groupName, ""); if (nm && nm.trim()) D.groups.push({ id: "", name: nm.trim().slice(0, 40), ids: [] }); }
        else if (a === "gren") { var nn = prompt(L.groupName, D.groups[g].name); if (nn && nn.trim()) D.groups[g].name = nn.trim().slice(0, 40); }
        else if (a === "gdel") { if (confirm(L.delGroup.replace("{name}", D.groups[g].name))) D.groups.splice(g, 1); }
        else if (a === "gadd") { openPicker("g" + g); return; }
        else if (a === "nren" && id !== null) {
            var c0 = byId[id], nv = prompt(L.newName, D.names[id] || (c0 ? c0[3] || c0[1] : ""));
            if (nv === null) return;
            nv = nv.replace(/\s+/g, " ").trim().slice(0, 60);
            // the provider's own name typed back, or nothing: no name of yours
            if (!nv || (c0 && nv === (c0[3] || c0[1]))) delete D.names[id]; else D.names[id] = nv;
        }
        else if (a === "nreset" && id !== null) delete D.names[id];
        else if (a === "nhide" && id !== null) D.hid[id] = 1;
        else if (a === "nshow" && id !== null) delete D.hid[id];
        else if (a === "fadd") { openPicker("f"); return; }
        else if (a === "send") { send(); return; }
        else if (a !== "again") return;
        draw();
    });
    app.innerHTML = "<div class=done><p>" + h(L.loading) + "</p></div>";
    var x = new XMLHttpRequest();
    x.open("GET", "/edit/data?k=" + encodeURIComponent(K));
    x.onload = function () {
        if (x.status !== 200) { app.innerHTML = "<div class=done><div class=big>\u231B</div><h2>" + h(L.expired) + "</h2><p>" + h(L.expiredHow) + "</p></div>"; return; }
        try { D = JSON.parse(x.responseText); } catch (er) { D = null; }
        if (!D || !D.kinds) { app.textContent = L.error; return; }
        D.groups = D.groups || []; D.favs = D.favs || []; D.names = D.names && typeof D.names === "object" ? D.names : {};
        D.hid = {}; (Array.isArray(D.hidden) ? D.hidden : []).forEach(function (id) { D.hid[id] = 1; });
        (D.chans || []).forEach(function (c) { byId[c[0]] = c; });
        draw();
    };
    x.onerror = function () { app.textContent = L.noAnswer; };
    x.send();
}
/* ---------- the video summaries' player (Sports): YouTube's own embedded player, on a page of this service ----------
   YouTube's player refuses a page without an address (the app's own, file://: "error 153"), so the app shows this
   page in a frame: http://127.0.0.1:8765/yt?v=ID. The app drives it with messages (play/pause, ±10 s, stop) and
   hears back the time, the length and what goes wrong. The same page for Android (written into the .apk). */
function ytPage() {
    return "<!doctype html><html><head><meta charset=utf-8><meta name=referrer content=strict-origin-when-cross-origin>" +
        "<style>html,body{margin:0;height:100%;background:#000;overflow:hidden}#p{position:fixed;left:0;top:0;width:100%;height:100%;border:0}</style></head>" +
        "<body><div id=p></div><script>(" + ytScript.toString() + ")();</" + "script><script src='https://www.youtube.com/iframe_api'></" + "script></body></html>";
}
function ytScript() {
    var m = /[?&]v=([A-Za-z0-9_-]{6,20})/.exec(location.search), v = m && m[1], pl = null, muted = false, started = false;
    /* cue=1: made ready ahead, while you are still on the match's page (YouTube's player takes 3 s of the TV's
       time to start, and the video stuttered through them); it plays at the first "play" */
    var cue = /[?&]cue=1/.test(location.search), going = !cue, ticking = null;
    // a screen that refuses sound without a press leaves the video unstarted (-1) or cued (5): muted then, the first
    // OK gives the sound back. Still loading (3) is not that: waited for, up to 10 s
    function watch() {
        var waited = 0;
        setTimeout(function check() {
            if (started) return;
            waited += 1000;
            var s = pl.getPlayerState ? pl.getPlayerState() : -1;
            if (waited < 3000 || (s === 3 && waited < 10000)) { setTimeout(check, 1000); return; }
            pl.mute(); muted = true; pl.playVideo(); send({ muted: 1, note: "muted to start (state " + s + ")" });
        }, 1000);
        if (!ticking) ticking = setInterval(function () { if (pl && pl.getCurrentTime) send({ t: pl.getCurrentTime(), d: pl.getDuration(), state: pl.getPlayerState() }); }, 500);
    }
    function send(o) { o.apltvYt = 1; try { parent.postMessage(JSON.stringify(o), "*"); } catch (e) {} }
    // YouTube's automatic subtitles off (they come back with the captions module, loaded once the video plays)
    function noCaptions() {
        try { pl.setOption("captions", "track", {}); } catch (x) {}
        try { pl.unloadModule("captions"); pl.unloadModule("cc"); } catch (x) {}
    }
    window.onerror = function (msg) { send({ note: "script error " + msg }); };
    send({ note: "page up" });
    window.onYouTubeIframeAPIReady = function () {
        send({ note: "YouTube's player loaded" });
        if (!v) { send({ error: "no video" }); return; }
        pl = new YT.Player("p", { width: "100%", height: "100%", videoId: v, host: "https://www.youtube-nocookie.com",
            playerVars: { autoplay: cue ? 0 : 1, controls: 0, rel: 0, playsinline: 1, iv_load_policy: 3, cc_load_policy: 0, fs: 0, disablekb: 1, modestbranding: 1, origin: location.origin },
            events: {
                onReady: function (e) {
                    noCaptions();
                    send({ ready: 1, d: e.target.getDuration() });
                    if (going) { e.target.playVideo(); watch(); }
                },
                onApiChange: function () { noCaptions(); },
                onStateChange: function (e) {
                    if (e.data === 1 && !started) { started = true; noCaptions(); setTimeout(noCaptions, 1500); }
                    send({ state: e.data });
                },
                onError: function (e) { send({ error: e.data }); }
            } });
    };
    window.addEventListener("message", function (ev) {
        var c; try { c = JSON.parse(ev.data); } catch (x) { return; }
        if (!c || !c.apltvCmd) return;
        if (!pl || !pl.getPlayerState) { if (c.apltvCmd === "play") going = true; return; }   // pressed before it was ready: it plays when ready
        if (c.apltvCmd === "toggle") {
            if (muted) { pl.unMute(); muted = false; send({ muted: 0 }); if (pl.getPlayerState() !== 1) pl.playVideo(); return; }
            if (pl.getPlayerState() === 1) pl.pauseVideo(); else pl.playVideo();
        } else if (c.apltvCmd === "play") { pl.playVideo(); if (!going) { going = true; watch(); } }
        else if (c.apltvCmd === "pause") pl.pauseVideo();
        else if (c.apltvCmd === "seek") pl.seekTo(Math.max(0, pl.getCurrentTime() + (+c.by || 0)), true);
        else if (c.apltvCmd === "stop") pl.stopVideo();
    });
}
function editPage(lang, token, ok) {
    var L = {}, mine = EDIT_TEXT[/^fr/i.test(lang || "") ? "fr" : /^pl/i.test(lang || "") ? "pl" : /^it/i.test(lang || "") ? "it" : "en"], k;
    for (k in EDIT_TEXT.en) L[k] = mine[k] || EDIT_TEXT.en[k];          // a text not translated yet: in English
    var head = "<!doctype html><html><head><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'><title>APL TV</title><style>" + phoneCss() + EDIT_CSS + "</style></head><body>";
    if (!ok) return head + "<div class=done><div class=big>\u231B</div><h2>" + L.expired + "</h2><p>" + L.expiredHow + "</p></div></body></html>";
    return head + "<div id=app></div><script>var K=" + JSON.stringify(token).replace(/</g, "\\u003c") + ",L=" + JSON.stringify(L).replace(/</g, "\\u003c") + ";(" + editScript.toString() + ")();</" + "script></body></html>";
}

function newToken() {
    var A = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789", s = "", b = crypto.randomBytes(8);
    for (var i = 0; i < 8; i++) s += A[b[i] % A.length];
    return s;
}
function sessionOk(k) { return !!(session && k && k === session.token && Date.now() - session.at < SESSION_MS); }
/* A wrong code counts: after 20 the session is closed (the TV shows a new code) */
function wrongCode() { if (session && ++session.wrong >= 20) { log("too many wrong phone codes: session closed"); session = null; pending = []; } }

/* Stremio's torrent engine (Samsung). Stremio's app for Samsung TVs brings it as a service of its own
   (IkWsFHtOY9.StremioService, port 11470), which the TV lets only Stremio start; the app (APL TV) is paused as soon
   as it is in the background, so this service does it: Stremio's app opens, its engine starts (about 4 s), and
   APL TV comes back to the front. The engine then stays ready until the TV is switched off. */
var STREMIO_APP = "IkWsFHtOY9.Stremio", stremioWaiting = null;
function stremioPing(ip, cb) {
    var done = false, r = http.get({ host: ip, port: 11470, path: "/settings", timeout: 1500 }, function (x) { x.resume(); if (!done) { done = true; cb(x.statusCode === 200); } });
    r.on("error", function () { if (!done) { done = true; cb(false); } });
    r.on("timeout", function () { r.destroy(); });
}
function stremioEngine(cb) {
    if (stremioWaiting) { stremioWaiting.push(cb); return; }
    stremioWaiting = [cb];
    var ip = lanAddresses()[0] || "127.0.0.1", t0 = Date.now(), base = "http://" + ip + ":11470";
    function fin(r) { var l = stremioWaiting || []; stremioWaiting = null; l.forEach(function (f) { try { f(r); } catch (e) {} }); }
    stremioPing(ip, function (up) {
        if (up) { fin({ ok: true, base: base, started: false }); return; }
        var T = typeof tizen !== "undefined" ? tizen : null;
        if (!T || !T.application) { fin({ ok: false, error: "no tizen" }); return; }
        var me = "APLTVMedia.TV";
        try { me = T.application.getCurrentApplication().appInfo.packageId + ".TV"; } catch (e) {}
        function back() { try { T.application.launch(me, function () {}, function () {}); } catch (e) {} }
        try {
            T.application.launch(STREMIO_APP, function () {
                (function poll() {
                    stremioPing(ip, function (ok) {
                        if (ok) { back(); log("stremio engine started in " + (Date.now() - t0) + " ms"); fin({ ok: true, base: base, started: true, ms: Date.now() - t0 }); }
                        else if (Date.now() - t0 < 25000) setTimeout(poll, 400);
                        else { back(); fin({ ok: false, error: "the engine did not start" }); }
                    });
                })();
            }, function (e) { fin({ ok: false, missing: true, error: String(e && e.message || e) }); });
        } catch (e) { fin({ ok: false, error: e.message }); }
    });
}

function handler(req, res) {
    stopLater();
    var u = req.url || "/", path = u.split("?")[0], q = query(u), local = isLocal(req);
    if (!originOk(req)) { log("refused a request from a website: " + String(req.headers.origin).slice(0, 80)); res.writeHead(403); res.end(); return; }
    if (devLog && req.headers.origin && !seenOrigins[req.headers.origin] && Object.keys(seenOrigins).length < 6) { seenOrigins[req.headers.origin] = 1; log("origin seen: " + req.headers.origin); }
    res._origin = req.headers.origin && req.headers.origin !== "null" ? req.headers.origin : (req.headers.origin === "null" ? "null" : "");
    if (req.method === "OPTIONS") { cors(res); res.writeHead(204); res.end(); return; }

    if (path === "/ping") { send(res, 200, { ok: 1, v: VERSION, session: !!session }); return; }
    if (path === "/stremio/engine") {
        if (!local) { send(res, 403, { error: "local only" }); return; }
        stremioEngine(function (r) { send(res, 200, r); });
        return;
    }

    if (path === "/" || path === "/s") {
        var good = sessionOk(q.k);
        if (q.k && !good) wrongCode();
        send(res, 200, phonePage(req.headers["accept-language"], good ? q.k : "", good), "text/html; charset=utf-8");
        return;
    }
    if (path === "/submit" && req.method === "POST") {
        readBody(req, 20000, function (body) {
            var b = null;
            try { b = JSON.parse(body); } catch (e) {}
            if (!b || !sessionOk(b.k)) { wrongCode(); send(res, 403, { ok: 0 }); return; }
            var item = { type: b.type === "m3u" ? "m3u" : b.type === "stalker" ? "stalker" : b.type === "jellyfin" ? "jellyfin" : b.type === "plex" ? "plex" : b.type === "key" ? "key" : "xtream", name: String(b.name || "").slice(0, 80), epg: String(b.epg || "").slice(0, 2000) };
            if (b.tmdb) item.tmdb = String(b.tmdb).replace(/\s+/g, "").slice(0, 400);          // the TMDB key, with the playlist or alone
            if (item.type === "m3u") item.url = String(b.url || "").slice(0, 4000);
            else if (item.type === "stalker") {
                item.portal = String(b.portal || "").slice(0, 400); item.mac = String(b.mac || "").slice(0, 40);
                ["sn", "id1", "id2"].forEach(function (k) { if (b[k]) item[k] = String(b[k]).slice(0, 200); });     // a MAG box's serial and device IDs, when the portal checks them
            }
            else { item.server = String(b.server || "").slice(0, 400); item.user = String(b.user || "").slice(0, 200); item.pass = String(b.pass || "").slice(0, 200); }
            pending.push(item);
            if (pending.length > 5) pending.shift();
            log("phone sent a " + item.type + " source");
            send(res, 200, { ok: 1 });
        });
        return;
    }

    // the phone editor (its page, the playlist it edits, what it sends back)
    if (path === "/yt") { send(res, 200, ytPage(), "text/html; charset=utf-8"); return; }
    if (path === "/edit") {
        var eok = editOk(q.k);
        if (q.k && !eok) editWrong();
        send(res, 200, editPage(req.headers["accept-language"], eok ? q.k : "", eok), "text/html; charset=utf-8");
        return;
    }
    if (path === "/edit/data") {
        if (!editOk(q.k)) { editWrong(); send(res, 403, { error: "expired" }); return; }
        send(res, 200, edit.data, "application/json; charset=utf-8");
        return;
    }
    if (path === "/edit/save" && req.method === "POST") {
        readBody(req, 6000000, function (body) {
            var b = null;
            try { b = JSON.parse(body); } catch (e) {}
            if (!b || !editOk(b.k) || !b.data) { editWrong(); send(res, 403, { ok: 0 }); return; }
            edit.saved = JSON.stringify(b.data);
            log("phone sent playlist changes");
            send(res, 200, { ok: 1 });
        });
        return;
    }

    // Everything below is for the app on this screen only
    if (!local) { send(res, 403, { error: "local only" }); return; }

    if (path === "/edit/start" && req.method === "POST") {
        readBody(req, 8000000, function (body) {
            if (!body) { send(res, 400, { error: "too big" }); return; }
            edit = { token: newToken(), at: Date.now(), data: body, saved: null, wrong: 0 };
            send(res, 200, { token: edit.token, urls: lanAddresses().map(function (a) { return "http://" + a + ":" + PORT + "/edit?k=" + edit.token; }) });
        });
        return;
    }
    if (path === "/edit/pending") {
        if (!editOk(q.k)) { send(res, 200, { data: null, expired: true }); return; }
        var sv = edit.saved; edit.saved = null;
        edit.at = Date.now();                      // the TV still shows the code: it stays valid
        send(res, 200, "{\"data\":" + (sv || "null") + "}", "application/json; charset=utf-8");
        return;
    }
    if (path === "/edit/close") { edit = null; send(res, 200, { ok: 1 }); return; }
    // timeshift (1.0.11)
    if (path === "/ts/start" && req.method === "POST") {
        readBody(req, 20000, function (body) {
            var b = null;
            try { b = JSON.parse(body); } catch (e) {}
            if (!b || !/^https?:\/\//i.test(String(b.url || ""))) { send(res, 400, { error: "no url" }); return; }
            tsStart(String(b.url), function (err, r) { if (err) send(res, 502, { error: err.message }); else send(res, 200, tsInfo(r)); });
        });
        return;
    }
    if (path === "/ts/info") { if (!tsRec || (q.id && q.id !== tsRec.id)) { send(res, 404, { error: "none" }); return; } send(res, 200, tsInfo(tsRec)); return; }
    if (path === "/ts/stream.ts") {
        if (!tsRec || (q.id && q.id !== tsRec.id)) { send(res, 404, { error: "none" }); return; }
        tsStream(req, res, +q.t || Date.now());
        return;
    }
    if (path === "/ts/stop") { tsStop(); send(res, 200, { ok: 1 }); return; }

    if (path === "/session" && req.method === "POST") {
        session = { token: newToken(), at: Date.now(), wrong: 0 };
        pending = [];
        send(res, 200, { token: session.token, urls: lanAddresses().map(function (a) { return "http://" + a + ":" + PORT + "/?k=" + session.token; }) });
        return;
    }
    if (path === "/session/close") { session = null; pending = []; send(res, 200, { ok: 1 }); return; }
    if (path === "/pending") {
        if (!sessionOk(q.k)) { send(res, 200, { items: [], expired: true }); return; }
        var items = pending; pending = [];
        send(res, 200, { items: items });
        return;
    }
    /* A request with the headers a Stalker (MAG) portal wants: the TV's browser refuses to send a Cookie or
       a User-Agent of its own. Body: { url, headers }. Local only, like everything here. */
    if (path === "/px/hd" && req.method === "POST") {
        if (!isLocal(req)) { send(res, 403, { error: "local only" }); return; }
        readBody(req, 20000, function (body) {
            var b = null;
            try { b = JSON.parse(body); } catch (e) {}
            if (!b || !b.id) { send(res, 400, { error: "bad request" }); return; }
            var hd = {};
            Object.keys(b.headers || {}).forEach(function (k) { if (/^(cookie|user-agent|x-user-agent|authorization|referer|accept-language)$/i.test(k)) hd[k] = String(b.headers[k]).slice(0, 2000); });
            pxHeaders[String(b.id).slice(0, 80)] = hd;
            send(res, 200, { ok: 1 });
        });
        return;
    }
    if (path === "/px" || path.indexOf("/px/f/") === 0) { pxServe(req, res, q); return; }
    if (path === "/sget" && req.method === "POST") {
        readBody(req, 20000, function (body) {
            var b = null;
            try { b = JSON.parse(body); } catch (e) {}
            if (!b || !/^https?:\/\//i.test(b.url || "")) { send(res, 400, { error: "bad request" }); return; }
            var hd = {};
            Object.keys(b.headers || {}).forEach(function (k) { if (/^(cookie|user-agent|x-user-agent|authorization|referer|accept-language)$/i.test(k)) hd[k] = String(b.headers[k]).slice(0, 2000); });
            get(b.url, parseInt(b.t, 10) || 60000, function (err, r) {
                if (err) { log("stalker request failed " + redact(b.url) + ": " + err.message); send(res, 502, { error: err.message }); return; }
                cors(res);
                res.writeHead(r.status, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
                r.body.pipe(res);
                r.body.on("error", function () { try { res.end(); } catch (e) {} });
            }, 0, false, hd);
        });
        return;
    }
    if (path === "/fetch") {
        if (!/^https?:\/\//i.test(q.u || "")) { send(res, 400, { error: "bad url" }); return; }
        get(q.u, parseInt(q.t, 10) || 120000, function (err, r) {
            if (err) { log("fetch failed " + redact(q.u) + ": " + err.message); send(res, 502, { error: err.message }); return; }
            cors(res);
            res.writeHead(r.status, { "Content-Type": /json/i.test(r.type) ? "application/json; charset=utf-8" : "text/plain; charset=utf-8", "Cache-Control": "no-store" });
            r.body.pipe(res);
            r.body.on("error", function () { try { res.end(); } catch (e) {} });
        });
        return;
    }
    if (path === "/epg" && req.method === "POST") {
        readBody(req, 4000000, function (body) {
            var b = null;
            try { b = JSON.parse(body); } catch (e) {}
            if (!b || !/^https?:\/\//i.test(b.url || "")) { send(res, 400, { error: "bad request" }); return; }
            learnUa(b);
            loadXmltv(b.url, function (err, e) {
                if (err) { send(res, 502, { error: err.message }); return; }
                var from = b.from || Date.now() - 3 * 3600 * 1000, to = b.to || Date.now() + 24 * 3600 * 1000;
                var want = b.ids || Object.keys(e.chans), out = {}, names = {};
                want.forEach(function (id) {
                    var list = e.chans[id];
                    if (list) out[id] = list.filter(function (p) { return p[1] > from && p[0] < to; });
                });
                if (b.names) names = e.names;
                send(res, 200, { chans: out, names: names, total: e.count });
            });
        });
        return;
    }
    if (path === "/imdb" && req.method === "POST") {
        readBody(req, 200000, function (body) {
            var b = null;
            try { b = JSON.parse(body); } catch (e) {}
            if (!b || !b.ids || !b.ids.length) { send(res, 400, { error: "bad request" }); return; }
            loadImdb(function (err, tab) {
                if (err || !tab) { send(res, 502, { error: (err && err.message) || "no ratings" }); return; }
                var out = {};
                b.ids.slice(0, 2000).forEach(function (id) { var r = imdbFind(tab, id); if (r) out[id] = r; });
                send(res, 200, { ratings: out, at: tab.at });
            });
        });
        return;
    }
    if (path === "/epg/match" && req.method === "POST") {
        readBody(req, 2000000, function (body) {
            var b = null;
            try { b = JSON.parse(body); } catch (e) {}
            if (!b || !/^https?:\/\//i.test(b.url || "") || !b.names) { send(res, 400, { error: "bad request" }); return; }
            learnUa(b);
            matchXmltv(b.url, b.names, b.from || Date.now() - 4 * 3600 * 1000, b.to || Date.now() + 26 * 3600 * 1000, function (err, out) {
                if (err) { send(res, 502, { error: err.message }); return; }
                send(res, 200, { chans: out });
            });
        });
        return;
    }
    /* APL Launcher's Top Shelf: the app sends it (local only); the launcher on the same screen reads it.
       Kept in /tmp too, so it can be read while the service is asleep. No addresses or credentials in it. */
    if (path === "/shelf" && req.method === "POST") {
        if (!local) { send(res, 403, { error: "local only" }); return; }
        readBody(req, 200000, function (body) {
            try { shelf = JSON.parse(body); require("fs").writeFile("/tmp/apltv-shelf.json", JSON.stringify(shelf), function () {}); send(res, 200, { ok: 1 }); }
            catch (e) { send(res, 400, { error: "bad shelf" }); }
        });
        return;
    }
    if (path === "/shelf") {
        if (!local) { send(res, 403, { error: "local only" }); return; }
        if (shelf) { send(res, 200, shelf); return; }
        require("fs").readFile("/tmp/apltv-shelf.json", "utf8", function (err, txt) {
            if (err) { send(res, 404, { error: "no shelf yet" }); return; }
            try { shelf = JSON.parse(txt); send(res, 200, shelf); } catch (e) { send(res, 404, { error: "no shelf yet" }); }
        });
        return;
    }
    if (path === "/log" && req.method === "POST") {
        readBody(req, 200000, function (body) {
            try { var b = JSON.parse(body); devLog = !!b.dev; (b.lines || []).forEach(function (l) { logs.push(String(l)); }); while (logs.length > 500) logs.shift(); } catch (e) {}
            send(res, 200, { ok: 1 });
        });
        return;
    }
    send(res, 404, { error: "not found" });
}

/* While testing, the PC reads the app's log here (only when the app turned it on) */
function devHandler(req, res) {
    var path = (req.url || "/").split("?")[0];
    if (path === "/dev/log" && devLog) { send(res, 200, logs.map(redact).join("\n"), "text/plain; charset=utf-8"); return true; }
    // Test remote (development builds only): keys go to the app itself, not through the screen's input devices
    if (path === "/dev/key" && devLog && req.method === "POST") {
        readBody(req, 4000, function (body) {
            try { var b = JSON.parse(body); (b.keys || []).forEach(function (k) { devKeys.push(k); }); } catch (e) {}
            send(res, 200, { ok: 1, queued: devKeys.length });
        });
        return true;
    }
    if (path === "/dev/keys" && isLocal(req)) { var k = devKeys; devKeys = []; send(res, 200, { keys: k }); return true; }
    // Test of the automatic updates (development builds only): a version put in /tmp/apltv-update from the PC
    var um = /^\/dev\/update\/((?:js|css)\/[\w.-]+\.(?:js|css)|version\.json)$/.exec(path);
    if (um && devLog && req.method === "GET" && isLocal(req)) {
        require("fs").readFile("/tmp/apltv-update/" + um[1], "utf8", function (err, txt) {
            if (err) send(res, 404, { error: "not found" }); else send(res, 200, txt, "text/plain; charset=utf-8");
        });
        return true;
    }
    return false;
}
var devKeys = [];

function start() {
    if (server) return;
    server = http.createServer(function (req, res) {
        try { if (devHandler(req, res)) return; handler(req, res); }
        catch (e) { log("error " + e.message); try { send(res, 500, { error: e.message }); } catch (e2) {} }
    });
    server.on("error", function (e) { log("server: " + e.message); });
    server.listen(PORT, "0.0.0.0", function () { log("listening on " + PORT); });
    stopLater();
}

module.exports.start = function () { start(); stopLater(); };
module.exports.phonePage = phonePage;      // tools/make-android.py: the same phone page for the Android helper
module.exports.editPage = editPage;
module.exports.ytPage = ytPage;          // and the summaries' player        // and the phone editor
module.exports.onStart = function () { start(); };
module.exports.onRequest = function () { start(); };
module.exports.onExit = function () { clearTimeout(idle); try { server.close(); } catch (e) {} server = null; };
if (!global.APLTV_NO_START) { try { start(); } catch (e) {} }
