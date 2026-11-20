/* ============================================================
   ssap.js: the TV's own remote-control API (LG Connect Apps, "SSAP"),
   reached on wss://127.0.0.1:3001 from APL Launcher's webOS service.

   This is the API LG's phone remote uses. Without root, a Developer Mode
   app may launch an app, but not list the installed apps, read the app in
   front or set the volume: the TV keeps those for its partners. Through this
   API the TV asks once, on screen, whether to allow the remote app, and then
   answers all of it. The key it gives is kept by the launcher and sent back
   at each connection, so the question is asked only once.

   A small WebSocket client (RFC 6455) on Node's tls module, nothing else:
   the TV's certificate is its own, self-signed, so it is not checked (the
   address is the TV itself).
   ============================================================ */
"use strict";

var tls = require("tls");
var crypto = require("crypto");
var EventEmitter = require("events").EventEmitter;

/* LG's sample remote-app manifest, as every SSAP client sends it (the signed part is LG's own, so
   the TV shows it as "LG Remote App"). Taken from lgtv2 (MIT, Sebastian Raff), pairing.json. */
var MANIFEST = {
    manifestVersion: 1,
    appVersion: "1.1",
    signed: {
        created: "20140509",
        appId: "com.lge.test",
        vendorId: "com.lge",
        localizedAppNames: { "": "LG Remote App", "ko-KR": "리모컨 앱", "zxx-XX": "ЛГ Rэмotэ AПП" },
        localizedVendorNames: { "": "LG Electronics" },
        permissions: ["TEST_SECURE", "CONTROL_INPUT_TEXT", "CONTROL_MOUSE_AND_KEYBOARD", "READ_INSTALLED_APPS", "READ_LGE_SDX",
                      "READ_NOTIFICATIONS", "SEARCH", "WRITE_SETTINGS", "WRITE_NOTIFICATION_ALERT", "CONTROL_POWER",
                      "READ_CURRENT_CHANNEL", "READ_RUNNING_APPS", "READ_UPDATE_INFO", "UPDATE_FROM_REMOTE_APP",
                      "READ_LGE_TV_INPUT_EVENTS", "READ_TV_CURRENT_TIME"],
        serial: "2f930e2d2cfe083771f68e4fe7bb07"
    },
    permissions: ["LAUNCH", "LAUNCH_WEBAPP", "APP_TO_APP", "CLOSE", "TEST_OPEN", "TEST_PROTECTED", "CONTROL_AUDIO",
                  "CONTROL_DISPLAY", "CONTROL_INPUT_JOYSTICK", "CONTROL_INPUT_MEDIA_RECORDING", "CONTROL_INPUT_MEDIA_PLAYBACK",
                  "CONTROL_INPUT_TV", "CONTROL_POWER", "READ_APP_STATUS", "READ_CURRENT_CHANNEL", "READ_INPUT_DEVICE_LIST",
                  "READ_NETWORK_STATE", "READ_RUNNING_APPS", "READ_TV_CHANNEL_LIST", "WRITE_NOTIFICATION_TOAST",
                  "READ_POWER_STATE", "READ_COUNTRY_INFO", "READ_SETTINGS", "CONTROL_TV_SCREEN", "CONTROL_TV_STANBY",
                  "CONTROL_FAVORITE_GROUP", "CONTROL_USER_INFO", "CHECK_BLUETOOTH_DEVICE", "CONTROL_BLUETOOTH",
                  "CONTROL_TIMER_INFO", "STB_INTERNAL_CONNECTION", "CONTROL_RECORDING", "READ_RECORDING_STATE",
                  "WRITE_RECORDING_LIST", "READ_RECORDING_LIST", "READ_RECORDING_SCHEDULE", "WRITE_RECORDING_SCHEDULE",
                  "READ_STORAGE_DEVICE_LIST", "READ_TV_PROGRAM_INFO", "CONTROL_BOX_CHANNEL", "READ_TV_ACR_AUTH_TOKEN",
                  "READ_TV_CONTENT_STATE", "READ_TV_CURRENT_TIME", "ADD_LAUNCHER_CHANNEL", "SET_CHANNEL_SKIP",
                  "RELEASE_CHANNEL_SKIP", "CONTROL_CHANNEL_BLOCK", "DELETE_SELECT_CHANNEL", "CONTROL_CHANNEL_GROUP",
                  "SCAN_TV_CHANNELS", "CONTROL_TV_POWER", "CONTROL_WOL"],
    signatures: [{
        signatureVersion: 1,
        signature: "eyJhbGdvcml0aG0iOiJSU0EtU0hBMjU2Iiwia2V5SWQiOiJ0ZXN0LXNpZ25pbmctY2VydCIsInNpZ25hdHVyZVZlcnNpb24iOjF9." +
                   "hrVRgjCwXVvE2OOSpDZ58hR+59aFNwYDyjQgKk3auukd7pcegmE2CzPCa0bJ0ZsRAcKkCTJrWo5iDzNhMBWRyaMOv5zWSrthlf7G128qvIlpMT0YNY+n/FaOHE73uLrS/g7swl3/qH/BGFG2Hu4RlL48eb3lLKqTt2xKHdCs6Cd4RMfJPYnzgvI4BNrFUKsjkcu+WD4OO2A27Pq1n50cMchmcaXadJhGrOqH5YmHdOCj5NSHzJYrsW0HPlpuAx/ECMeIZYDh6RMqaFM2DXzdKX9NmmyqzJ3o/0lkk/N97gfVRLW5hA29yeAwaCViZNCP8iC9aO0q9fQojoa7NQnAtw=="
    }]
};

/* Since 2026 LG's firmware rejects that signature ("403 Pairing rejected: blacklisted certificate
   detected", webOS 25 and 26). Then the same manifest goes without its signed part, as other SSAP clients
   now do: the TV still asks, and grants what it gives an unsigned remote app (not WRITE_SETTINGS). All the
   permissions are asked for in the clear. */
var UNSIGNED = {
    manifestVersion: MANIFEST.manifestVersion,
    appVersion: MANIFEST.appVersion,
    permissions: MANIFEST.permissions.concat(MANIFEST.signed.permissions.filter(function (p) { return MANIFEST.permissions.indexOf(p) === -1; }))
};

/* The last steps, for the launcher's Settings › About and for reports (no key in it) */
var LOG = [];
function log(text) {
    LOG.push(new Date().toISOString().slice(11, 19) + " " + text);
    if (LOG.length > 60) LOG.shift();
}

/* ---------- a WebSocket over TLS ---------- */
function Socket(host, port, path, origin) {
    EventEmitter.call(this);
    var self = this, key = crypto.randomBytes(16).toString("base64");
    var buf = Buffer.alloc(0), open = false, parts = [], partOp = 0;
    this.closed = false;
    this.why = "";
    log("connect " + host + ":" + port + (path && path !== "/" ? " (buttons)" : "") + (origin ? " origin " + origin : ""));
    this.sock = tls.connect({ host: host, port: port, rejectUnauthorized: false }, function () {
        var CRLF = "\r\n";
        self.sock.write("GET " + (path || "/") + " HTTP/1.1" + CRLF + "Host: " + host + ":" + port + CRLF + "Upgrade: websocket" + CRLF +
                        "Connection: Upgrade" + CRLF + "Sec-WebSocket-Key: " + key + CRLF + "Sec-WebSocket-Version: 13" + CRLF +
                        (origin ? "Origin: " + origin + CRLF : "") + CRLF);
    });
    this.sock.setNoDelay(true);
    this.sock.on("data", function (d) {
        buf = Buffer.concat([buf, d]);
        if (!open) {
            var end = buf.indexOf("\r\n\r\n");
            if (end < 0) return;
            var head = buf.slice(0, end).toString();
            buf = buf.slice(end + 4);
            if (!/^HTTP\/1\.1 101/.test(head)) { self.why = head.split("\r\n")[0]; self.fail(new Error("refused: " + self.why)); return; }
            open = true;
            self.emit("open");
        }
        while (buf.length >= 2) {
            var fin = (buf[0] & 0x80) !== 0, op = buf[0] & 0x0f, masked = (buf[1] & 0x80) !== 0, len = buf[1] & 0x7f, at = 2;
            if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); at = 4; }
            else if (len === 127) { if (buf.length < 10) return; len = buf.readUInt32BE(2) * 4294967296 + buf.readUInt32BE(6); at = 10; }
            var mask = null;
            if (masked) { if (buf.length < at + 4) return; mask = buf.slice(at, at + 4); at += 4; }
            if (buf.length < at + len) return;
            var data = buf.slice(at, at + len);
            buf = buf.slice(at + len);
            if (mask) for (var i = 0; i < data.length; i++) data[i] ^= mask[i % 4];
            if (op === 8) {
                self.why = data.length >= 2 ? data.readUInt16BE(0) + " " + data.slice(2).toString("utf8") : "";
                log("closed by the TV" + (self.why ? ": " + self.why : ""));
                self.close();
                return;
            }
            if (op === 9) { self.frame(10, data); continue; }                // ping: pong
            if (op === 10) continue;
            if (op === 0) { parts.push(data); } else { parts = [data]; partOp = op; }
            if (!fin) continue;
            var whole = Buffer.concat(parts);
            parts = [];
            if (partOp === 1) self.emit("message", whole.toString("utf8"));
        }
    });
    this.sock.on("error", function (e) { log("error " + (e && (e.code || e.message))); self.fail(e); });
    this.sock.on("close", function () { self.fail(open ? null : new Error("closed by the TV before the websocket opened")); });
}
Socket.prototype = Object.create(EventEmitter.prototype);
Socket.prototype.frame = function (op, data) {
    if (this.closed) return;
    var len = data.length, head, mask = crypto.randomBytes(4);
    if (len < 126) { head = Buffer.alloc(2); head[1] = 0x80 | len; }
    else if (len < 65536) { head = Buffer.alloc(4); head[1] = 0x80 | 126; head.writeUInt16BE(len, 2); }
    else { head = Buffer.alloc(10); head[1] = 0x80 | 127; head.writeUInt32BE(Math.floor(len / 4294967296), 2); head.writeUInt32BE(len % 4294967296, 6); }
    head[0] = 0x80 | op;
    var body = Buffer.alloc(len);
    for (var i = 0; i < len; i++) body[i] = data[i] ^ mask[i % 4];
    this.sock.write(Buffer.concat([head, mask, body]));
};
Socket.prototype.send = function (text) { this.frame(1, Buffer.from(text, "utf8")); };
Socket.prototype.fail = function (e) {
    if (this.closed) return;
    this.closed = true;
    try { this.sock.destroy(); } catch (x) {}
    this.emit("close", e);
};
Socket.prototype.close = function () {
    try { this.frame(8, Buffer.alloc(0)); } catch (e) {}
    this.fail(null);
};

/* ---------- the TV's API on top of it ---------- */
/* opts: { hosts, port, key }. One connection, opened on demand, kept while it is used; every request
   waits for the registration. From the TV itself the API checks where a connection comes from ("invalid
   origin"): the ways to reach it are tried in turn, and the one that works is kept for the next times. */
var ORIGINS = [null, "file://", "http://localhost", "http://127.0.0.1", "https://localhost", "null", "app://com.knikt.apllauncher", "com.knikt.apllauncher"];
function Client(opts) {
    EventEmitter.call(this);
    this.hosts = opts.hosts || [opts.host || "127.0.0.1"];
    var ways = this.ways = [], hosts = this.hosts;
    hosts.forEach(function (h) { ORIGINS.forEach(function (o) { ways.push({ host: h, origin: o }); }); });
    this.wayAt = 0;
    this.host = this.hosts[0];
    this.origin = null;
    this.unsigned = !!opts.unsigned;     // the TV refused the signed manifest once already
    this.port = opts.port || 3001;
    this.key = opts.key || "";
    this.ws = null;
    this.ready = null;          // Promise of a registered connection
    this.waiting = {};          // id -> { resolve, reject, sub }
    this.seq = 0;
    this.state = "idle";        // idle | connecting | prompt | registered | refused | error
    this.error = "";
}
Client.prototype = Object.create(EventEmitter.prototype);

Client.prototype.connect = function () {
    if (this.ready) return this.ready;
    this.ready = this.attempt(0);
    this.ready.catch(function () {});
    return this.ready;
};
Client.prototype.attempt = function (n) {
    var self = this;
    this.state = "connecting";
    var way = this.ways[this.wayAt % this.ways.length];
    this.host = way.host; this.origin = way.origin;
    return new Promise(function (resolve, reject) {
        var ws = self.ws = new Socket(way.host, self.port, "/", way.origin);
        var regId = "register_" + (++self.seq), settled = false, answered = false;
        function settle(err) {
            if (settled) return;
            settled = true;
            if (err) reject(err); else resolve(self);
        }
        ws.on("open", function () {
            var payload = { forcePairing: false, pairingType: "PROMPT", manifest: self.unsigned ? UNSIGNED : MANIFEST };
            if (self.key) payload["client-key"] = self.key;
            ws.send(JSON.stringify({ type: "register", id: regId, payload: payload }));
        });
        ws.on("message", function (text) {
            var m;
            try { m = JSON.parse(text); } catch (e) { return; }
            if (m.id === regId) {
                answered = true;
                log("register: " + m.type + (m.payload && m.payload.pairingType ? " " + m.payload.pairingType : "") + (m.error ? " " + m.error : ""));
                if (m.type === "registered") {
                    var k = m.payload && m.payload["client-key"];
                    if (k && k !== self.key) { self.key = k; self.emit("key", k); }
                    self.state = "registered"; self.error = "";
                    self.emit("state", self.state);
                    settle(null);
                } else if (m.type === "response" && m.payload && m.payload.pairingType === "PROMPT") {
                    self.state = "prompt";                          // the TV is asking, on screen
                    self.emit("state", self.state);
                } else if (m.type === "error" && /blacklisted certificate/i.test(String(m.error)) && !self.unsigned) {
                    // The signature LG no longer accepts: the same way, unsigned
                    self.unsigned = true;
                    settled = true;
                    ws.removeAllListeners("close");
                    ws.close();
                    if (self.ws === ws) self.ws = null;
                    self.attempt(n).then(resolve, reject);
                } else if (m.type === "error") {
                    // Not this way (the TV refuses this address or origin): the next one, before giving up
                    if (n + 1 < self.ways.length && self.state !== "prompt") { answered = false; ws.close(); return; }
                    self.state = "refused"; self.error = String(m.error || "refused");
                    self.emit("state", self.state);
                    settle(new Error(self.error));
                    ws.close();
                }
                return;
            }
            var w = self.waiting[m.id];
            if (!w) return;
            if (m.type === "error") {
                if (!w.sub) delete self.waiting[m.id];
                w.reject(new Error(String(m.error || "error")), m.payload);
                return;
            }
            if (!w.sub) delete self.waiting[m.id];
            w.resolve(m.payload || {});
        });
        ws.on("close", function (e) {
            if (self.ws === ws) self.ws = null;
            var w = self.waiting; self.waiting = {};
            Object.keys(w).forEach(function (id) { w[id].reject(new Error("connection closed")); if (w[id].sub && w[id].onClose) w[id].onClose(); });
            // Closed before the TV even answered the registration (its origin check): the next way, at once
            if (!answered && !settled && n + 1 < self.ways.length) {
                self.wayAt = (self.wayAt + 1) % self.ways.length;
                settled = true;
                self.attempt(n + 1).then(resolve, reject);
                return;
            }
            self.ready = null;
            if (self.state !== "refused") { self.state = e ? "error" : "idle"; self.error = (e && e.message) || ws.why || ""; }
            self.emit("state", self.state);
            settle(e || new Error(ws.why ? "closed by the TV: " + ws.why : "closed"));
        });
    });
};

/* One request: resolves with the answer's payload. */
Client.prototype.request = function (uri, payload, timeoutMs) {
    var self = this;
    return this.connect().then(function () {
        return new Promise(function (resolve, reject) {
            var id = "req_" + (++self.seq);
            var t = setTimeout(function () { delete self.waiting[id]; reject(new Error("timeout")); }, timeoutMs || 15000);
            self.waiting[id] = { resolve: function (p) { clearTimeout(t); resolve(p); }, reject: function (e) { clearTimeout(t); reject(e); } };
            self.ws.send(JSON.stringify({ type: "request", id: id, uri: uri, payload: payload || {} }));
        });
    });
};

/* A subscription: onMsg(payload) for each answer. Returns a function that ends it. */
Client.prototype.subscribe = function (uri, payload, onMsg, onClose) {
    var self = this, id = "sub_" + (++self.seq), ended = false;
    this.connect().then(function () {
        if (ended) return;
        self.waiting[id] = { sub: true, resolve: onMsg, reject: function () {}, onClose: onClose };
        self.ws.send(JSON.stringify({ type: "subscribe", id: id, uri: uri, payload: payload || {} }));
    }, function () { if (onClose) onClose(); });
    return function () {
        ended = true;
        if (!self.waiting[id]) return;
        delete self.waiting[id];
        try { self.ws.send(JSON.stringify({ type: "unsubscribe", id: id, uri: uri })); } catch (e) {}
    };
};

/* Remote buttons (HOME, BACK, UP, ENTER…): the TV opens a second socket for them. */
Client.prototype.button = function (name) {
    var self = this;
    var go = function () {
        if (!self.pointer || self.pointer.closed) {
            return self.request("ssap://com.webos.service.networkinput/getPointerInputSocket").then(function (p) {
                var u = /^wss?:\/\/([^/:]+):(\d+)(\/.*)$/.exec(String(p.socketPath || ""));
                if (!u) throw new Error("no button socket");
                return new Promise(function (resolve, reject) {
                    var s = new Socket(self.host, parseInt(u[2], 10) === 3000 ? 3001 : parseInt(u[2], 10), u[3], self.origin);
                    s.on("open", function () { self.pointer = s; resolve(s); });
                    s.on("close", function (e) { if (self.pointer === s) self.pointer = null; reject(e || new Error("closed")); });
                });
            });
        }
        return Promise.resolve(self.pointer);
    };
    return go().then(function (s) { s.send("type:button\nname:" + String(name).toUpperCase() + "\n\n"); });
};

Client.prototype.close = function () {
    if (this.pointer) { try { this.pointer.close(); } catch (e) {} this.pointer = null; }
    if (this.ws) this.ws.close();
};

module.exports = { Client: Client, Socket: Socket, MANIFEST: MANIFEST, UNSIGNED: UNSIGNED, log: LOG, note: log };
