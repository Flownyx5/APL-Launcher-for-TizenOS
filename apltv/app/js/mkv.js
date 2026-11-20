/* ============================================================
   mkv.js: the languages and names of a Matroska file's tracks, read from the file itself.

   Some Samsung TVs give the language of an .mkv file's audio tracks but nothing at all for its subtitles: a
   QE65S90C showed 36 subtitle tracks as "Track 1, 2…" (issues #9 and #34; its log said track_lang "" on every
   one). The file says them in its Tracks part, near its start. Before a movie or an episode in .mkv opens on
   Samsung's player (js/player.js), its first bytes are read once (1 MB and 2 s at most) and each track's
   language and name kept. The player then fills in what the TV leaves empty, track by track in the same order,
   and only when the TV lists as many tracks as the file.

   Read BEFORE the player opens the file, never at the same time: a provider that allows one connection keeps it
   for the movie. Not on a Stalker portal's link, which can be good for one request only (wanted()).
   ============================================================ */
(function (global) {
    "use strict";
    var TV = global.TV;
    var MAX = 1048576, WAIT = 2000, KEEP = 40;
    var known = {}, order = [];

    /* ---------- EBML, Matroska's way of writing: an id, a size, then the content ---------- */
    var ID = { EBML: 0x1A45DFA3, SEGMENT: 0x18538067, TRACKS: 0x1654AE6B, CLUSTER: 0x1F43B675, ENTRY: 0xAE,
               NUMBER: 0xD7, TYPE: 0x83, CODEC: 0x86, NAME: 0x536E, LANG: 0x22B59C, BCP47: 0x22B59D,
               DEFAULT: 0x88, FORCED: 0x55AA };

    /* One number at b[p]: { v, next }. A size of all ones is unknown (Infinity). null: the bytes stop first. */
    function vint(b, p, n, isId) {
        if (p >= n) return null;
        var first = b[p], len = 1, mask = 0x80;
        while (len <= 8 && !(first & mask)) { mask >>= 1; len++; }
        if (len > 8) return { v: -1, next: p + 1 };                       // not EBML
        if (p + len > n) return null;
        var v = isId ? first : first & (mask - 1), ones = (first & (mask - 1)) === mask - 1;
        for (var i = 1; i < len; i++) { v = v * 256 + b[p + i]; if (b[p + i] !== 255) ones = false; }
        return { v: !isId && ones ? Infinity : v, next: p + len };
    }
    /* An element's head at b[p]: { id, at (where its content starts), size }; null: cut short */
    function head(b, p, n) {
        var a = vint(b, p, n, true); if (!a) return null;
        var c = vint(b, a.next, n, false); if (!c) return null;
        return { id: a.v, at: c.next, size: c.v };
    }
    function walk(b, s, e, fn) {
        var p = s;
        while (p < e) {
            var h = head(b, p, e);
            if (!h || h.id < 0 || h.size === Infinity || h.at + h.size > e) return;
            fn(h.id, h.at, h.at + h.size);
            p = h.at + h.size;
        }
    }
    function uint(b, s, e) { var v = 0; for (var i = s; i < e; i++) v = v * 256 + b[i]; return v; }
    function utf8(b, s, e) {
        while (e > s && b[e - 1] === 0) e--;                              // a string padded with zeros
        var t = "";
        for (var i = s; i < e; i++) t += String.fromCharCode(b[i]);
        try { return decodeURIComponent(escape(t)); } catch (x) { return t; }
    }

    function tracks(b, s, e) {
        var out = { audio: [], subs: [] };
        walk(b, s, e, function (id, cs, ce) {
            if (id !== ID.ENTRY) return;
            // No Language element means English (Matroska's default); LanguageBCP47, when there, is the one to read
            var t = { num: 0, type: 0, codec: "", name: "", lang: "eng", forced: false, def: true }, bcp = "";
            walk(b, cs, ce, function (k, ks, ke) {
                if (k === ID.NUMBER) t.num = uint(b, ks, ke);
                else if (k === ID.TYPE) t.type = uint(b, ks, ke);
                else if (k === ID.CODEC) t.codec = utf8(b, ks, ke);
                else if (k === ID.NAME) t.name = utf8(b, ks, ke).trim();
                else if (k === ID.LANG) t.lang = utf8(b, ks, ke).trim();
                else if (k === ID.BCP47) bcp = utf8(b, ks, ke).trim();
                else if (k === ID.FORCED) t.forced = uint(b, ks, ke) === 1;
                else if (k === ID.DEFAULT) t.def = uint(b, ks, ke) === 1;
            });
            if (bcp) t.lang = bcp;
            if (t.type === 2) out.audio.push(t);
            else if (t.type === 17) out.subs.push(t);
        });
        return out;
    }

    /* The tracks of a file's first bytes, { audio: [], subs: [] } in the file's order. null: not enough bytes yet;
       false: they are not at the start (pictures come first, or it isn't Matroska). */
    function parse(b) {
        var n = b.length, h = head(b, 0, n);
        if (!h) return null;
        if (h.id !== ID.EBML || h.size < 0 || h.size === Infinity) return false;
        var seg = head(b, h.at + h.size, n);
        if (!seg) return null;
        if (seg.id !== ID.SEGMENT) return false;
        var p = seg.at;
        while (p < n) {
            var el = head(b, p, n);
            if (!el) return null;
            if (el.id < 0 || el.size < 0) return false;
            if (el.id === ID.TRACKS) return el.size === Infinity ? false : el.at + el.size <= n ? tracks(b, el.at, el.at + el.size) : null;
            if (el.id === ID.CLUSTER || el.size === Infinity) return false;
            p = el.at + el.size;
        }
        return null;
    }

    function remember(url, info) {
        if (!(url in known)) { order.push(url); if (order.length > KEEP) delete known[order.shift()]; }
        known[url] = info;
    }

    /* Reads a file's first bytes, once per link: the tracks, or null. Never fails. */
    function read(url) {
        if (url in known) return Promise.resolve(known[url]);
        var t0 = Date.now();
        return new Promise(function (resolve) {
            var x = new XMLHttpRequest(), over = false, seen = 0, buf = new Uint8Array(MAX), timer;
            function end(info, why) {
                if (over) return;
                over = true; clearTimeout(timer);
                try { x.abort(); } catch (e) {}
                remember(url, info || null);
                if (info) TV.log("mkv: " + info.audio.length + " audio and " + info.subs.length + " subtitle tracks read from the file in " + (Date.now() - t0) + " ms: " +
                                 info.subs.map(function (s) { return s.lang + (s.name ? " " + s.name : ""); }).join(", ").slice(0, 400));
                else TV.log("mkv: track names not read (" + why + ")");
                resolve(info || null);
            }
            // The bytes as they come (a text answer read byte by byte), parsed again each time more arrive
            function look(done) {
                var text = x.responseText || "", len = Math.min(text.length, MAX);
                if (len <= seen && !done) return;
                for (var i = seen; i < len; i++) buf[i] = text.charCodeAt(i) & 255;
                seen = len;
                var r = parse(buf.subarray(0, len));
                if (r) end(r);
                else if (r === false) end(null, "no track list at the start of the file");
                else if (done || len >= MAX) end(null, "no track list in its first " + Math.round(len / 1024) + " KB");
            }
            timer = setTimeout(function () { end(null, "no answer in " + WAIT / 1000 + " s"); }, WAIT);
            try {
                x.open("GET", url, true);
                x.overrideMimeType("text/plain; charset=x-user-defined");
                x.setRequestHeader("Range", "bytes=0-" + (MAX - 1));             // a server that ignores it is cut at 1 MB
                x.onreadystatechange = function () {
                    if (over) return;
                    if (x.readyState >= 2 && x.status && x.status !== 200 && x.status !== 206) { end(null, "HTTP " + x.status); return; }
                    if (x.readyState === 3) look(false);
                    else if (x.readyState === 4) { if (!x.status) end(null, "refused"); else look(true); }
                };
                x.onprogress = function () { if (!over && x.readyState === 3) look(false); };
                x.send();
            } catch (e) { end(null, e.message); }
        });
    }

    /* A movie or an episode in .mkv, not read yet. A playlist's or an Xtream account's link, and also the links asked
       just before playing for a Stremio stream, a media server's file or a public domain movie: those are good for
       more than one request (1.4.2 left them out, and a film from one of them had no names, #34). Not a Stalker
       portal's: it can be good for one request only. An .mkv not read says why in the log, a link read before too. */
    function wanted(url, opts) {
        if (opts && opts.live) return false;
        if (!/^https?:\/\/[^?#]+\.mkv([?#]|$)/i.test(String(url || ""))) {
            // what the link ends with, so a film that should have been read can be told (#34: a second film, from the same
            // Xtream account, had no "mkv:" line at all)
            var tail = String(url || "").split(/[?#]/)[0].split("/").pop();
            TV.log("mkv: track names not read (the link ends with \"" + (tail.indexOf(".") >= 0 ? tail.slice(tail.lastIndexOf(".")) : "no extension") + "\", not .mkv)");
            return false;
        }
        if (/^stalker:/.test((opts && opts._via) || "")) { TV.log("mkv: track names not read (a portal's link can be good for one request only)"); return false; }
        if (url in known) {
            var k = known[url];
            TV.log(k ? "mkv: track names read before (" + k.audio.length + " audio and " + k.subs.length + " subtitle tracks)" : "mkv: track names not readable before, not asked again");
            return false;
        }
        return true;
    }

    function put(tv, file) {
        if (!tv.length || tv.length !== file.length) return;
        tv.forEach(function (t, i) {
            if (!t.lang && file[i].lang) t.lang = file[i].lang;
            if (!t.name && file[i].name) t.name = file[i].name;
        });
    }
    /* The player's tracks ({ type: "AUDIO"|"TEXT", lang, name }) completed from the file: what the TV leaves empty,
       in order. Subtitles: all the file's, or its text ones only when the TV skips the pictures (PGS, VobSub). */
    function fill(list, url) {
        var info = known[url];
        if (!info) return list;
        var audio = list.filter(function (t) { return t.type === "AUDIO"; }), text = list.filter(function (t) { return t.type === "TEXT"; });
        put(audio, info.audio);
        put(text, info.subs.length === text.length ? info.subs : info.subs.filter(function (s) { return /^S_TEXT\//.test(s.codec); }));
        return list;
    }

    TV.mkv = { wanted: wanted, read: read, fill: fill, parse: parse };
})(window);
