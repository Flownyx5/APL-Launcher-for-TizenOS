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

var PORT = 8765, VERSION = "1.0.10";
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
function loadXmltv(target, cb) {
    var c = epgCache[target];
    if (c && !c.waiting && Date.now() - c.at < 3 * 3600 * 1000) { c.used = Date.now(); cb(null, c); return; }
    if (c && c.waiting) { c.waiting.push(cb); return; }
    var entry = { at: 0, chans: {}, names: {}, icons: {}, waiting: [cb], count: 0 };
    epgCache[target] = entry;
    var from = Date.now() - 6 * 3600 * 1000, to = Date.now() + 3 * 86400 * 1000;
    log("epg: loading " + redact(target));
    get(target, 240000, function (err, res) {
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
    get(target, 180000, function (err, res) {
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
function phonePage(lang, token, ok) {
    var fr = /^fr/i.test(lang || "");
    function t(en, f) { return fr ? f : en; }
    var css = "*{box-sizing:border-box;margin:0;padding:0}body{font:17px -apple-system,BlinkMacSystemFont,'SF Pro Text',Roboto,sans-serif;background:#000;color:#fff;" +
        "min-height:100vh;background:radial-gradient(120% 70% at 20% 0%,#1d2639 0%,#0b0d13 55%,#000 100%);padding:28px 20px 60px}" +
        "h1{font-size:34px;font-weight:700;letter-spacing:-.5px;margin:18px 0 6px}h1 span{color:rgba(255,255,255,.6);font-weight:400}p.sub{color:rgba(255,255,255,.62);margin-bottom:26px;line-height:1.4}" +
        ".seg{display:flex;background:rgba(118,118,128,.24);border-radius:12px;padding:3px;margin-bottom:22px}.seg button{flex:1;border:0;background:none;color:#fff;font:600 16px inherit;padding:10px;border-radius:9px}" +
        ".seg button.on{background:rgba(255,255,255,.9);color:#000}.card{background:rgba(255,255,255,.08);border-radius:16px;overflow:hidden;margin-bottom:14px;box-shadow:inset 0 1px 0 rgba(255,255,255,.12)}" +
        "label{display:block;padding:12px 16px 0;font-size:13px;color:rgba(255,255,255,.55);text-transform:uppercase;letter-spacing:.6px}" +
        "input{width:100%;border:0;background:none;color:#fff;font:17px inherit;padding:6px 16px 14px;outline:none}.card+.card{margin-top:0}.row{border-top:1px solid rgba(255,255,255,.08)}" +
        ".hint{font-size:14px;color:rgba(255,255,255,.5);margin:2px 4px 22px;line-height:1.4}button.go{width:100%;border:0;border-radius:14px;background:#fff;color:#000;font:600 18px inherit;padding:16px;margin-top:8px}" +
        "button.go:disabled{opacity:.5}.msg{margin-top:16px;text-align:center;color:#ff6961}.done{text-align:center;padding-top:60px}.done .big{font-size:80px}.done h2{font-size:28px;margin:16px 0 8px}" +
        ".done p{color:rgba(255,255,255,.65)}.hide{display:none}";
    if (!ok) {
        return "<!doctype html><html><head><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'><title>APL TV</title><style>" + css + "</style></head><body>" +
            "<div class=done><div class=big>⌛</div><h2>" + t("This code has expired", "Ce code a expiré") + "</h2><p>" +
            t("On the screen, open APL TV › Settings › Add a playlist › From your phone, then scan the new code.", "Sur l'écran, ouvre APL TV › Réglages › Ajouter une playlist › Depuis le téléphone, puis scanne le nouveau code.") + "</p></div></body></html>";
    }
    return "<!doctype html><html><head><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'><title>APL TV</title><style>" + css + "</style></head><body>" +
        "<div id=form><h1>APL <span>TV</span></h1><p class=sub>" + t("Send your playlist to the screen. It goes straight to it on your Wi-Fi, through no other website.", "Envoie ta playlist à l'écran. Elle y va directement par ton Wi-Fi, sans passer par aucun site.") + "</p>" +
        "<div class=seg><button id=bx class=on type=button>Xtream</button><button id=bm type=button>" + t("M3U link", "Lien M3U") + "</button><button id=bs type=button>" + t("Stalker", "Stalker") + "</button></div>" +
        "<div id=fx><div class=card><label>" + t("Server", "Serveur") + "</label><input id=server inputmode=url autocapitalize=off autocorrect=off placeholder='http://exemple.com:8080'>" +
        "<div class=row><label>" + t("Username", "Identifiant") + "</label><input id=user autocapitalize=off autocorrect=off></div>" +
        "<div class=row><label>" + t("Password", "Mot de passe") + "</label><input id=pass type=password autocapitalize=off autocorrect=off></div></div>" +
        "<p class=hint>" + t("The three details your provider gave you. A get.php link pasted in Server works too.", "Les trois infos données par ton fournisseur. Un lien get.php collé dans Serveur marche aussi.") + "</p></div>" +
        "<div id=fm class=hide><div class=card><label>" + t("Playlist address (M3U)", "Adresse de la playlist (M3U)") + "</label><input id=url inputmode=url autocapitalize=off autocorrect=off placeholder='http://…/playlist.m3u'></div>" +
        "<p class=hint>" + t("Paste the link of your M3U playlist.", "Colle le lien de ta playlist M3U.") + "</p></div>" +
        "<div id=fs class=hide><div class=card><label>" + t("Portal address", "Adresse du portail") + "</label><input id=portal inputmode=url autocapitalize=off autocorrect=off placeholder='http://exemple.com:8080/c/'>" +
        "<div class=row><label>" + t("MAC address", "Adresse MAC") + "</label><input id=mac autocapitalize=characters autocorrect=off placeholder='00:1A:79:12:34:56'></div></div>" +
        "<p class=hint>" + t("The portal (MAG, Ministra) and the MAC address your provider registered.", "Le portail (MAG, Ministra) et l'adresse MAC enregistrée par ton fournisseur.") + "</p></div>" +
        "<div class=card><label>" + t("Name (optional)", "Nom (facultatif)") + "</label><input id=name placeholder='" + t("My TV", "Ma TV") + "'>" +
        "<div class=row><label>" + t("TV guide address, XMLTV (optional)", "Adresse du guide TV, XMLTV (facultatif)") + "</label><input id=epg inputmode=url autocapitalize=off autocorrect=off></div></div>" +
        "<button class=go id=go type=button>" + t("Send to the screen", "Envoyer à l'écran") + "</button><div class=msg id=msg></div></div>" +
        "<div id=done class='done hide'><div class=big>✓</div><h2>" + t("Sent!", "C'est envoyé !") + "</h2><p>" + t("Look at your screen: APL TV is loading your playlist.", "Regarde ton écran : APL TV charge ta playlist.") + "</p></div>" +
        "<script>var K=" + JSON.stringify(token).replace(/</g, "\\u003c") + ",mode='xtream';function $(i){return document.getElementById(i)}" +
        "function sw(m){mode=m;$('bx').className=m=='xtream'?'on':'';$('bm').className=m=='m3u'?'on':'';$('bs').className=m=='stalker'?'on':'';$('fx').className=m=='xtream'?'':'hide';$('fm').className=m=='m3u'?'':'hide';$('fs').className=m=='stalker'?'':'hide'}" +
        "$('bx').onclick=function(){sw('xtream')};$('bm').onclick=function(){sw('m3u')};$('bs').onclick=function(){sw('stalker')};" +
        "$('go').onclick=function(){var b={k:K,type:mode,name:$('name').value,epg:$('epg').value};" +
        "if(mode=='xtream'){b.server=$('server').value;b.user=$('user').value;b.pass=$('pass').value;if(!b.server||(!/get\\.php/i.test(b.server)&&(!b.user||!b.pass))){$('msg').textContent=" + JSON.stringify(t("Fill in the server, the username and the password.", "Remplis le serveur, l'identifiant et le mot de passe.")) + ";return}}" +
        "else if(mode=='stalker'){b.portal=$('portal').value;b.mac=$('mac').value;if(!b.portal||b.mac.replace(/[^0-9a-f]/gi,'').length!=12){$('msg').textContent=" + JSON.stringify(t("Fill in the portal and a MAC address like 00:1A:79:12:34:56.", "Remplis le portail et une adresse MAC comme 00:1A:79:12:34:56.")) + ";return}}" +
        "else{b.url=$('url').value;if(!b.url){$('msg').textContent=" + JSON.stringify(t("Paste the playlist's link.", "Colle le lien de la playlist.")) + ";return}}" +
        "$('go').disabled=true;$('msg').textContent='';var x=new XMLHttpRequest();x.open('POST','/submit');x.setRequestHeader('Content-Type','application/json');" +
        "x.onload=function(){if(x.status==200){$('form').className='hide';$('done').className='done'}else{$('go').disabled=false;$('msg').textContent=x.status==403?" + JSON.stringify(t("This code has expired: scan the new one on the screen.", "Ce code a expiré : scanne le nouveau sur l'écran.")) + ":" + JSON.stringify(t("The screen did not answer. Is the phone on the same Wi-Fi?", "L'écran n'a pas répondu. Le téléphone est-il sur le même Wi-Fi ?")) + "}};" +
        "x.onerror=function(){$('go').disabled=false;$('msg').textContent=" + JSON.stringify(t("The screen did not answer. Is the phone on the same Wi-Fi?", "L'écran n'a pas répondu. Le téléphone est-il sur le même Wi-Fi ?")) + "};x.send(JSON.stringify(b))};" +
        "</script></body></html>";
}

function newToken() {
    var A = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789", s = "", b = crypto.randomBytes(8);
    for (var i = 0; i < 8; i++) s += A[b[i] % A.length];
    return s;
}
function sessionOk(k) { return !!(session && k && k === session.token && Date.now() - session.at < SESSION_MS); }
/* A wrong code counts: after 20 the session is closed (the TV shows a new code) */
function wrongCode() { if (session && ++session.wrong >= 20) { log("too many wrong phone codes: session closed"); session = null; pending = []; } }

function handler(req, res) {
    stopLater();
    var u = req.url || "/", path = u.split("?")[0], q = query(u), local = isLocal(req);
    if (!originOk(req)) { log("refused a request from a website: " + String(req.headers.origin).slice(0, 80)); res.writeHead(403); res.end(); return; }
    if (devLog && req.headers.origin && !seenOrigins[req.headers.origin] && Object.keys(seenOrigins).length < 6) { seenOrigins[req.headers.origin] = 1; log("origin seen: " + req.headers.origin); }
    res._origin = req.headers.origin && req.headers.origin !== "null" ? req.headers.origin : (req.headers.origin === "null" ? "null" : "");
    if (req.method === "OPTIONS") { cors(res); res.writeHead(204); res.end(); return; }

    if (path === "/ping") { send(res, 200, { ok: 1, v: VERSION, session: !!session }); return; }

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
            var item = { type: b.type === "m3u" ? "m3u" : b.type === "stalker" ? "stalker" : "xtream", name: String(b.name || "").slice(0, 80), epg: String(b.epg || "").slice(0, 2000) };
            if (item.type === "m3u") item.url = String(b.url || "").slice(0, 4000);
            else if (item.type === "stalker") { item.portal = String(b.portal || "").slice(0, 400); item.mac = String(b.mac || "").slice(0, 40); }
            else { item.server = String(b.server || "").slice(0, 400); item.user = String(b.user || "").slice(0, 200); item.pass = String(b.pass || "").slice(0, 200); }
            pending.push(item);
            if (pending.length > 5) pending.shift();
            log("phone sent a " + item.type + " source");
            send(res, 200, { ok: 1 });
        });
        return;
    }

    // Everything below is for the app on this screen only
    if (!local) { send(res, 403, { error: "local only" }); return; }

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
module.exports.onStart = function () { start(); };
module.exports.onRequest = function () { start(); };
module.exports.onExit = function () { clearTimeout(idle); try { server.close(); } catch (e) {} server = null; };
if (!global.APLTV_NO_START) { try { start(); } catch (e) {} }
