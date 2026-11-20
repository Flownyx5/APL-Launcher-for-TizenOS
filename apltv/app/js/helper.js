/* ============================================================
   helper.js: talks to APL TV's helper service (service/service.js).
   The service starts when needed and listens on port 8765 of the screen
   (Samsung: a Tizen web service; LG: the app's webOS JS service;
   Android: Helper.java inside the app).
   ============================================================ */
(function (global) {
    "use strict";

    var TV = global.TV;
    var PORT = 8765;
    var bases = null, baseIndex = 0, starting = null, lastAnswer = "";

    /* Samsung: the service is "<package>.Helper". Apps2Samsung can give the package another id on a TV (#22: an id
       blocked there, or taken by another app) and rewrites it in the installed files, not in the code that comes
       later through the automatic updates: the id is the running app's own. */
    function serviceId() {
        try { var p = global.tizen.application.getCurrentApplication().appInfo.packageId; if (p) return p + ".Helper"; } catch (e) {}
        return "APLTVMedia.Helper";
    }
    function why(e) { return e ? (e.name && e.name !== "Error" ? e.name + ": " : "") + (e.message || e) : "?"; }

    function hosts() {
        if (bases) return bases;
        var list = ["http://127.0.0.1:" + PORT];
        try { var ip = global.webapis && global.webapis.network && global.webapis.network.getIp(); if (ip) list.push("http://" + ip + ":" + PORT); } catch (e) {}
        if (TV.PREVIEW) list = ["http://" + (global.location.hostname || "127.0.0.1") + ":" + PORT];
        bases = list;
        return list;
    }

    /* On LG (webOS) the same helper runs as the app's JS service (com.knikt.apltv.service). The app stays
       subscribed to it: webOS keeps a service alive only while someone listens. */
    var WEBOS_SERVICE = "luna://com.knikt.apltv.service/", lunaKeep = null, lunaCall = null;
    function startWebos(resolve) {
        var done = false;
        function fin() { if (!done) { done = true; resolve(); } }
        // Already subscribed: one more "start" opens the port again if the service closed it while idle
        if (lunaKeep) lunaCall = TV.luna(WEBOS_SERVICE + "start", {}, fin);
        else lunaKeep = TV.luna(WEBOS_SERVICE + "start", { subscribe: true }, function (m) {
            if (m && m.returnValue === false) { TV.log("helper service: " + (m.errorText || "refused")); lunaKeep = null; }
            fin();
        });
        setTimeout(fin, 4000);
    }
    function startService() {
        if (starting) return starting;
        lastAnswer = "";
        starting = new Promise(function (resolve) {
            if (TV.WEBOS) { startWebos(resolve); return; }
            // Android: the helper is part of the app (Helper.java), started with it
            if (TV.ANDROID) { try { global.APLAndroid.startHelper(); } catch (e) {} resolve(); return; }
            var T = global.tizen;
            if (!T || !T.application) { resolve(); return; }
            var id = serviceId();
            function plain(e) {
                if (e) TV.log("helper " + id + ": " + why(e));
                try { T.application.launch(id, resolve, function (e2) { TV.log("helper " + id + " not started: " + why(e2)); lastAnswer = why(e2); resolve(); }); }
                catch (e3) { TV.log("helper " + id + " not started: " + why(e3)); lastAnswer = why(e3); resolve(); }
            }
            try { T.application.launchAppControl(new T.ApplicationControl("http://tizen.org/appcontrol/operation/service"), id, resolve, plain); }
            catch (e) { plain(e); }
        }).then(function () { return waitUp(Date.now() + 12000); });
        starting.then(function () { starting = null; }, function () { starting = null; });
        return starting;
    }
    /* /ping answers 200 from APL TV's helper. Any other answer is another app on the port (#22: Tizenfy's phone page
       listens on 8765 too), said in the error. */
    function ping(base) {
        return TV.http(base + "/ping", { timeout: 1500 }).then(function (r) {
            if (r.status !== 200) { if (r.status) lastAnswer = "port " + PORT + ": HTTP " + r.status + ", another app?"; throw new Error("no"); }
            return base;
        });
    }
    function waitUp(until) {
        return new Promise(function (resolve, reject) {
            (function again() {
                var list = hosts(), i = 0;
                (function tryNext() {
                    if (i >= list.length) {
                        if (Date.now() > until) { TV.log("helper unavailable" + (lastAnswer ? ": " + lastAnswer : "")); reject(new Error("helper unavailable" + (lastAnswer ? ", " + lastAnswer : ""))); }
                        else setTimeout(again, 400);
                        return;
                    }
                    var b = list[i++];
                    ping(b).then(function () { baseIndex = list.indexOf(b); resolve(); }, tryNext);
                })();
            })();
        });
    }

    /* One request; starts the service the first time */
    function call(path, opts) {
        opts = opts || {};
        function once() {
            return TV.http(hosts()[baseIndex] + path, { method: opts.method || "GET", body: opts.body, timeout: opts.timeout || 60000,
                headers: opts.body ? { "Content-Type": "text/plain" } : null }).then(function (r) {
                if (r.status === 0) throw new Error("helper unreachable");
                return r;
            });
        }
        return once().catch(function () { return startService().then(once); });
    }
    function json(r) { try { return JSON.parse(r.text); } catch (e) { throw new Error("helper: bad answer"); } }

    TV.helper = {
        PORT: PORT,
        start: startService,
        /* A Stalker portal's request with its own headers (Cookie with the MAC, MAG User-Agent, token).
           An installed helper from before 1.0.7 does not know it: "needs the new install". */
        sget: function (url, headers, timeout) {
            return call("/sget", { method: "POST", body: JSON.stringify({ url: url, headers: headers || {}, t: timeout || 60000 }), timeout: (timeout || 60000) + 5000 }).then(function (r) {
                // a helper from before 1.0.7 answers its own "not found"; any other 404 is the server's
                if (r.status === 404 && /^\s*\{\s*"error"\s*:\s*"not found"\s*\}\s*$/.test(r.text || "")) { var n = new Error("helper too old"); n.old = true; throw n; }
                if (r.status >= 200 && r.status < 300) return r.text;
                var e = new Error("HTTP " + r.status); e.status = r.status; e.body = r.text; throw e;
            });
        },
        /* A Stalker portal's movie through the helper, asked with the portal's headers (#30: its server refused the TV's
           own player, HTTP 403). Gives the address to play; a helper from before 1.4.6 doesn't have it (e.old). */
        relay: function (url, id, headers) {
            return call("/px/hd", { method: "POST", body: JSON.stringify({ id: id, headers: headers || {} }), timeout: 5000 }).then(function (r) {
                if (r.status === 404) { var n = new Error("helper too old"); n.old = true; throw n; }
                if (r.status !== 200) throw new Error("relay: HTTP " + r.status);
                var name = String(url).split(/[?#]/)[0].split("/").pop().replace(/[^A-Za-z0-9._-]/g, "").slice(-60) || "x";     // index.m3u8: HLS to the player
                return hosts()[baseIndex] + "/px/f/" + name + "?h=" + encodeURIComponent(id) + "&u=" + encodeURIComponent(url);
            });
        },
        fetch: function (url, timeout) {
            return call("/fetch?u=" + encodeURIComponent(url) + "&t=" + (timeout || 120000), { timeout: (timeout || 120000) + 5000 }).then(function (r) {
                if (r.status >= 200 && r.status < 300) return r.text;
                var e = new Error("HTTP " + r.status); e.status = r.status; e.body = r.text; throw e;
            });
        },
        epg: function (url, ids, from, to, names) {
            // ua: the player's name this server lets in, when it refused the screen's own requests (core.js)
            return call("/epg", { method: "POST", timeout: 300000, body: JSON.stringify({ url: url, ids: ids, from: from, to: to, names: !!names, ua: TV.uaFor(url) }) }).then(function (r) {
                if (r.status !== 200) throw new Error("guide: " + (json(r).error || r.status));
                return json(r);
            });
        },
        epgMatch: function (url, names, from, to) {
            return call("/epg/match", { method: "POST", timeout: 240000, body: JSON.stringify({ url: url, names: names, from: from, to: to, ua: TV.uaFor(url) }) }).then(function (r) {
                if (r.status !== 200) throw new Error("guide: " + (json(r).error || r.status));
                return json(r);
            });
        },
        /* IMDb ratings from IMDb's daily file (the first call downloads it: up to a minute) */
        imdb: function (ids) {
            return call("/imdb", { method: "POST", timeout: 200000, body: JSON.stringify({ ids: ids }) }).then(function (r) {
                if (r.status !== 200) throw new Error("imdb: HTTP " + r.status);
                return json(r).ratings || {};
            });
        },
        session: function () { return call("/session", { method: "POST", body: "{}" }).then(json); },
        /* Stremio's torrent engine started by the service (Samsung): { ok, base } (an older service: not known) */
        stremioEngine: function () {
            return call("/stremio/engine", { timeout: 32000 }).then(function (r) {
                if (r.status === 404) return { ok: false, old: true };
                return json(r);
            });
        },
        /* The phone editor (1.0.11): the playlist goes to the helper, the phone's changes come back */
        editStart: function (data) {
            return call("/edit/start", { method: "POST", timeout: 30000, body: JSON.stringify(data) }).then(function (r) {
                if (r.status === 404) { var n = new Error("helper too old"); n.old = true; throw n; }
                if (r.status !== 200) { var e2 = new Error("HTTP " + r.status); e2.status = r.status; throw e2; }
                return json(r);
            });
        },
        editPending: function (token) { return call("/edit/pending?k=" + encodeURIComponent(token), { timeout: 8000 }).then(json); },
        editClose: function () { return call("/edit/close", { timeout: 5000 }).catch(function () {}); },
        /* Timeshift (1.0.11): the service keeps the channel; the player reads it back from tsUrl */
        tsStart: function (url) {
            return call("/ts/start", { method: "POST", timeout: 30000, body: JSON.stringify({ url: url }) }).then(function (r) {
                if (r.status === 404) { var n = new Error("helper too old"); n.old = true; throw n; }
                if (r.status !== 200) { var e; try { e = new Error(JSON.parse(r.text).error); } catch (x) { e = new Error("HTTP " + r.status); } throw e; }
                return json(r);
            });
        },
        tsInfo: function (id) { return call("/ts/info?id=" + encodeURIComponent(id), { timeout: 6000 }).then(function (r) { if (r.status !== 200) throw new Error("none"); return json(r); }); },
        tsStop: function () { return call("/ts/stop", { timeout: 5000 }).catch(function () {}); },
        tsUrl: function (id, t) { return hosts()[baseIndex] + "/ts/stream.ts?id=" + encodeURIComponent(id) + "&t=" + Math.floor(t); },
        pending: function (token) { return call("/pending?k=" + encodeURIComponent(token), { timeout: 8000 }).then(json); },
        close: function () { return call("/session/close", { timeout: 5000 }).catch(function () {}); },
        shelf: function (data) { return call("/shelf", { method: "POST", timeout: 8000, body: JSON.stringify(data) }).catch(function () {}); },
        sendLog: function (lines, dev) { return call("/log", { method: "POST", timeout: 8000, body: JSON.stringify({ lines: lines, dev: !!dev }) }).catch(function () {}); }
    };

    /* Development builds: the test remote. Each key is [keyCode, holdMs]; a keydown (and its repeats while
       held) then a keyup are dispatched to the page, as the real remote would. */
    function fire(type, code) {
        var e;
        try { e = new KeyboardEvent(type, { bubbles: true, cancelable: true }); } catch (x) { e = document.createEvent("Event"); e.initEvent(type, true, true); }
        try { Object.defineProperty(e, "keyCode", { get: function () { return code; } }); } catch (x) {}
        (document.activeElement || document.body).dispatchEvent(e);
    }
    var keyQueue = [], keyBusy = false;
    function pumpKeys() {
        if (keyBusy || !keyQueue.length) return;
        keyBusy = true;
        var k = keyQueue.shift(), code = k[0], hold = k[1] || 0;
        // Test switches (development builds): -1 sounds on/off, -2 animations on/off
        if (code < 0) {
            if (code === -1) TV.setPref("sounds", !TV.pref("sounds"));
            if (code === -2) { TV.setPref("motion", !TV.pref("motion")); document.body.classList.toggle("reduce-motion", !TV.pref("motion")); }
            if (code === -3) document.body.classList.toggle("t-noslide");
            if (code === -4) document.body.classList.toggle("t-noscale");
            if (code === -5) document.body.classList.toggle("t-noshadow");
            if (code === -6) document.body.classList.toggle("t-noart");
            TV.log("test switch " + code + ": sounds " + TV.pref("sounds") + ", motion " + TV.pref("motion") + ", noslide " + document.body.classList.contains("t-noslide") + ", noscale " + document.body.classList.contains("t-noscale") + ", noshadow " + document.body.classList.contains("t-noshadow") + ", noart " + document.body.classList.contains("t-noart"));
            keyBusy = false; pumpKeys(); return;
        }
        fire("keydown", code);
        var reps = Math.floor(hold / 100), i = 0;
        (function rep() {
            if (i++ < reps) { setTimeout(function () { fire("keydown", code); rep(); }, 100); return; }
            setTimeout(function () { fire("keyup", code); setTimeout(function () { keyBusy = false; pumpKeys(); }, 280); }, hold ? 30 : 120);
        })();
    }
    setInterval(function () {
        if (!TV.DEV || TV.PREVIEW) return;
        call("/dev/keys", { timeout: 3000 }).then(function (r) {
            var j = json(r);
            if (!j.keys || !j.keys.length) return;
            // development builds: "js:…" runs a test in the app, its answer goes to the log
            j.keys = j.keys.filter(function (k) {
                if (typeof k !== "string" || k.indexOf("js:") !== 0) return true;
                // a script element (the page's rules allow inline scripts, not eval)
                var sc = document.createElement("script");
                sc.text = "(function(){try{var __o=(function(){" + k.slice(3) + ";})();TV.log('dev js: '+(typeof __o==='object'?JSON.stringify(__o):String(__o)).slice(0,6000));}catch(e){TV.log('dev js error: '+e.message);}})();";
                document.head.appendChild(sc); document.head.removeChild(sc);
                return false;
            });
            if (j.keys.length) { j.keys.forEach(function (k) { keyQueue.push(typeof k === "number" ? [k, 0] : k); }); pumpKeys(); }
        }).catch(function () {});
    }, 400);

    /* Development builds (js/dev.local.js sets TV.DEV): the app's log goes to the service, which shows it to the PC */
    var sent = 0;
    setInterval(function () {
        if (!TV.DEV) return;
        // counted over the app's life: the list keeps its last 300 lines, its length stops moving
        var fresh = (TV.logTotal || 0) - sent, lines = fresh > 0 ? TV.logs.slice(-Math.min(fresh, TV.logs.length)) : [];
        sent = TV.logTotal || 0;
        if (lines.length) TV.helper.sendLog(lines, true);
    }, 3000);
})(window);
