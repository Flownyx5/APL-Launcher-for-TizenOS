/* ============================================================
   core.js: small shared tools.
   DOM helpers, preferences, IndexedDB cache, HTTP, interface sounds
   (the same as APL Launcher), toast, icons, remote keys, time.
   ES5 only: the app must also run on Tizen 6 screens.
   ============================================================ */
(function (global) {
    "use strict";

    var TV = global.TV = global.TV || {};
    var T = TV.t;
    /* Where APL TV runs: a Samsung screen (Tizen), an LG TV (webOS), or the PC preview */
    TV.TIZEN = !!global.tizen;
    TV.WEBOS = !TV.TIZEN && !!(global.PalmSystem || global.PalmServiceBridge || global.webOSSystem);
    TV.ANDROID = !TV.TIZEN && !TV.WEBOS && !!global.APLAndroid;      // the Android app (android/), js/android.js
    TV.PREVIEW = !TV.TIZEN && !TV.WEBOS && !TV.ANDROID;
    TV.PLATFORM = TV.TIZEN ? "tizen" : TV.WEBOS ? "webos" : TV.ANDROID ? "android" : "preview";
    if (TV.PREVIEW) { document.body.classList.add("is-preview"); document.documentElement.style.background = "#000"; }
    if (TV.WEBOS) {
        document.documentElement.classList.add("is-webos");
        var avObj = document.getElementById("av");          // Samsung's video plane: nothing to do on LG
        if (avObj && avObj.parentNode) avObj.parentNode.removeChild(avObj);
    }
    /* webOS system calls (luna://…). onMsg gets each answer; a subscription keeps coming while the
       returned bridge is kept. */
    TV.luna = function (uri, params, onMsg) {
        var B = global.PalmServiceBridge;
        if (!B) { if (onMsg) setTimeout(function () { onMsg({ returnValue: false, errorText: "no webOS" }); }, 0); return null; }
        var b = new B();
        b.onservicecallback = function (txt) { var m = {}; try { m = JSON.parse(txt); } catch (e) {} if (onMsg) onMsg(m); };
        b.call(uri, JSON.stringify(params || {}));
        return b;
    };
    /* Tizen 6.0 (2021 TVs, Chromium 76) has no flex gap: the items of a row would touch.
       There the class no-gap spaces them with margins instead (rules generated at the end of tv2.css). */
    (function () {
        var f = document.createElement("div");
        f.style.display = "flex"; f.style.flexDirection = "column"; f.style.rowGap = "1px"; f.style.position = "absolute";
        f.appendChild(document.createElement("div")); f.appendChild(document.createElement("div"));
        document.body.appendChild(f);
        var works = f.scrollHeight === 1;
        document.body.removeChild(f);
        if (works && !global.TV_NO_GAP) return;
        document.documentElement.classList.add("no-gap");
        /* A margin can only space elements: a bare text next to an icon ("<svg>Play", "IMDb 7,7") is put in a
           span, so the icon and its text keep their space too. Only on these screens. */
        if (!global.MutationObserver) return;
        function isIcon(n) { return n && (n.nodeName === "svg" || n.nodeName === "SVG" || n.nodeName === "IMG"); }
        function wrap(t) {
            if (!t || t.nodeType !== 3 || !t.parentNode || !/\S/.test(t.nodeValue)) return;
            if (!isIcon(t.previousSibling) && !isIcon(t.nextSibling)) return;
            var s = document.createElement("span");
            t.parentNode.insertBefore(s, t); s.appendChild(t);
        }
        function scan(n) {
            if (n.nodeType === 3) { wrap(n); return; }
            if (n.nodeType !== 1) return;
            if (isIcon(n)) { wrap(n.previousSibling); wrap(n.nextSibling); }
            var icons = n.querySelectorAll("svg, img");
            for (var i = 0; i < icons.length; i++) { wrap(icons[i].previousSibling); wrap(icons[i].nextSibling); }
        }
        new MutationObserver(function (list) {
            for (var i = 0; i < list.length; i++) for (var j = 0; j < list[i].addedNodes.length; j++) scan(list[i].addedNodes[j]);
        }).observe(document.body, { childList: true, subtree: true });
        scan(document.body);
    })();

    /* ---------- DOM ---------- */
    TV.$ = function (id) { return document.getElementById(id); };
    TV.el = function (tag, cls, html) {
        var e = document.createElement(tag);
        if (cls) e.className = cls;
        if (html !== undefined && html !== null) e.innerHTML = html;
        return e;
    };
    TV.esc = function (s) {
        return String(s === undefined || s === null ? "" : s).replace(/[&<>"']/g, function (c) {
            return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
        });
    };
    /* TMDB pictures at the size they are shown. Providers give "original", "w500" or "w600_and_h900_bestv2"
       (600 x 900 for a cover shown 220 px wide: three times the pixels to decode and draw) */
    TV.sized = function (u, w) { return u ? String(u).replace(/(image\.tmdb\.org\/t\/p\/)[^\/]+\//, "$1" + w + "/") : u; };
    TV.cssUrl = function (u) { return u ? 'url("' + String(u).replace(/["\\\n]/g, "") + '")' : "none"; };
    TV.clamp = function (v, a, b) { return v < a ? a : (v > b ? b : v); };

    /* ---------- storage ---------- */
    var PFX = "apltv.";
    /* Read once from the screen's storage, then from memory (favorites, resume points… are read for every card) */
    var memo = {};
    TV.load = function (key, fallback) {
        if (Object.prototype.hasOwnProperty.call(memo, key)) return memo[key] === null ? fallback : memo[key];
        try { var v = global.localStorage.getItem(PFX + key); memo[key] = v === null ? null : JSON.parse(v); } catch (e) { memo[key] = null; }
        return memo[key] === null ? fallback : memo[key];
    };
    TV.save = function (key, value) {
        memo[key] = value;
        try { global.localStorage.setItem(PFX + key, JSON.stringify(value)); return true; } catch (e) { TV.log("save failed " + key + ": " + e.message); return false; }
    };
    TV.drop = function (key) { delete memo[key]; try { global.localStorage.removeItem(PFX + key); } catch (e) {} };

    var DEFAULTS = { pictureMode: "fit", language: "auto", sounds: true, showAdult: false, mergeQuality: true, autoPreview: false, motion: true, startTab: "home", lastChannel: null, timeFormat: "24",
                     audioLang: "auto", audioLang2: "orig", subLang: "auto", subLang2: "off", subSize: "m", subColor: "white", subBg: "outline", subPos: "low", autoNext: false, resumePrompt: true, autoUpdate: true, screenSaver: "auto", tidyCats: true, tidyNames: true };
    var prefs = TV.load("prefs", {}) || {};
    var prefListeners = [];
    TV.pref = function (k) { return Object.prototype.hasOwnProperty.call(prefs, k) ? prefs[k] : DEFAULTS[k]; };
    TV.setPref = function (k, v) {
        prefs[k] = v; TV.save("prefs", prefs);
        prefListeners.forEach(function (fn) { try { fn(k, v); } catch (e) {} });
    };
    TV.onPref = function (fn) { prefListeners.push(fn); };

    /* ---------- IndexedDB: the big things (catalogs, guides) ---------- */
    var dbp = null;
    function db() {
        if (dbp) return dbp;
        dbp = new Promise(function (resolve) {
            try {
                var rq = global.indexedDB.open("apltv", 1);
                rq.onupgradeneeded = function () { rq.result.createObjectStore("kv"); };
                rq.onsuccess = function () { resolve(rq.result); };
                rq.onerror = function () { resolve(null); };
            } catch (e) { resolve(null); }
        });
        return dbp;
    }
    var mem = {};
    TV.idb = {
        get: function (k) {
            return db().then(function (d) {
                if (!d) return mem[k];
                return new Promise(function (resolve) {
                    try {
                        var rq = d.transaction("kv", "readonly").objectStore("kv").get(k);
                        rq.onsuccess = function () { resolve(rq.result); };
                        rq.onerror = function () { resolve(undefined); };
                    } catch (e) { resolve(undefined); }
                });
            });
        },
        set: function (k, v) {
            return db().then(function (d) {
                if (!d) { mem[k] = v; return; }
                return new Promise(function (resolve) {
                    try {
                        var tx = d.transaction("kv", "readwrite");
                        tx.objectStore("kv").put(v, k);
                        tx.oncomplete = function () { resolve(true); };
                        tx.onerror = tx.onabort = function () { TV.log("idb set failed " + k + ": " + (tx.error && (tx.error.name + " " + tx.error.message))); resolve(false); };
                    } catch (e) { resolve(); }
                });
            });
        },
        /* Removes every key that starts with prefix (old caches), in the background */
        prune: function (prefix) {
            return db().then(function (d) {
                if (!d) return 0;
                return new Promise(function (resolve) {
                    var n = 0;
                    try {
                        var tx = d.transaction("kv", "readwrite"), store = tx.objectStore("kv");
                        var rq = store.openCursor(global.IDBKeyRange ? global.IDBKeyRange.bound(prefix, prefix + "\uffff") : null);
                        rq.onsuccess = function () { var c = rq.result; if (!c) return; if (String(c.key).indexOf(prefix) === 0) { c.delete(); n++; } c.continue(); };
                        tx.oncomplete = function () { resolve(n); };
                        tx.onerror = tx.onabort = function () { resolve(n); };
                    } catch (e) { resolve(n); }
                });
            });
        },
        del: function (k) {
            return db().then(function (d) {
                if (!d) { delete mem[k]; return; }
                return new Promise(function (resolve) {
                    try { var tx = d.transaction("kv", "readwrite"); tx.objectStore("kv").delete(k); tx.oncomplete = tx.onerror = function () { resolve(); }; } catch (e) { resolve(); }
                });
            });
        }
    };

    /* ---------- log (kept in memory; the helper service shows it to the PC while testing) ---------- */
    var logs = [];
    TV.logs = logs;
    TV.log = function (msg) {
        // Never keep an address with its credentials: users/passwords are cut out
        var line = new Date().toTimeString().slice(0, 8) + " " + TV.redact(String(msg));
        logs.push(line);
        if (logs.length > 300) logs.shift();
        try { global.console.log("[APL TV] " + line); } catch (e) {}
    };
    /* Development builds: JavaScript memory in use, to find what weighs */
    TV.heap = function (label) {
        if (!TV.DEV) return;
        try { TV.log("heap " + label + ": " + Math.round(performance.memory.usedJSHeapSize / 1048576) + " MB"); } catch (e) {}
    };
    TV.redact = function (s) {
        return String(s)
            .replace(/(username|password|user|pass|token|key|api_key)=([^&\s"]+)/gi, "$1=***")
            .replace(/\/(live|movie|series|timeshift)\/[^\/\s"]+\/[^\/\s"]+\//gi, "/$1/***/***/")
            .replace(/\/\/[^\/\s"@]+:[^\/\s"@]+@/g, "//***@");
    };

    /* ---------- HTTP ----------
       Direct first. If the screen refuses to read the answer (status 0: no CORS headers on the provider,
       or a compressed file the page cannot open), the helper service fetches it (helper.js). */
    TV.http = function (url, opts) {
        opts = opts || {};
        return new Promise(function (resolve, reject) {
            var x = new XMLHttpRequest(), done = false;
            var timer = setTimeout(function () { if (done) return; done = true; try { x.abort(); } catch (e) {} reject(new Error("timeout")); }, opts.timeout || 30000);
            try {
                x.open(opts.method || "GET", url, true);
                if (opts.type) x.responseType = opts.type;
                if (opts.headers) Object.keys(opts.headers).forEach(function (h) { x.setRequestHeader(h, opts.headers[h]); });
                x.onreadystatechange = function () {
                    if (x.readyState !== 4 || done) return;
                    done = true; clearTimeout(timer);
                    resolve({ status: x.status, text: opts.type ? null : x.responseText, body: opts.type ? x.response : null });
                };
                if (opts.onprogress) x.onprogress = opts.onprogress;
                x.send(opts.body || null);
            } catch (e) { done = true; clearTimeout(timer); reject(e); }
        });
    };
    TV.fetchText = function (url, opts) {
        opts = opts || {};
        return TV.http(url, opts).then(function (r) {
            if (r.status >= 200 && r.status < 300 && r.text !== null) return r.text;
            if (r.status === 0 && TV.helper && !opts.noProxy) {
                TV.log("direct fetch refused, through the helper: " + url.split("?")[0]);
                return TV.helper.fetch(url, opts.timeout);
            }
            var e = new Error("HTTP " + r.status); e.status = r.status; throw e;
        }, function (e) {
            if (TV.helper && !opts.noProxy && e.message !== "timeout") return TV.helper.fetch(url, opts.timeout);
            throw e;
        });
    };
    TV.fetchJSON = function (url, opts) {
        return TV.fetchText(url, opts).then(function (t) {
            try { return JSON.parse(t); } catch (e) { var er = new Error("bad JSON"); er.body = String(t).slice(0, 200); throw er; }
        });
    };

    /* ---------- time ---------- */
    function pad(n) { return n < 10 ? "0" + n : String(n); }
    TV.hhmm = function (d) {
        d = d instanceof Date ? d : new Date(d);
        if (TV.pref("timeFormat") === "12") {
            var h = d.getHours() % 12 || 12;
            return h + ":" + pad(d.getMinutes()) + (d.getHours() < 12 ? " AM" : " PM");
        }
        return pad(d.getHours()) + ":" + pad(d.getMinutes());
    };
    TV.duration = function (sec) {
        sec = Math.max(0, Math.round(sec || 0));
        var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
        return (h ? h + ":" + pad(m) : m) + ":" + pad(s);
    };
    TV.runtime = function (min) {
        min = Math.round(min || 0);
        if (!min) return "";
        var h = Math.floor(min / 60), m = min % 60;
        return h ? (TV.lang === "fr" ? h + " h " + (m ? pad(m) : "") : h + "h " + (m ? m + "m" : "")) : m + " min";
    };
    TV.dayName = function (d) {
        try { return d.toLocaleDateString(TV.locale, { weekday: "long" }); } catch (e) { return ""; }
    };

    /* ---------- sounds (APL Launcher's: sounds/*.wav decoded once, else short synthesized clicks) ---------- */
    var actx = null, buffers = {}, FILES = { navigate: "sounds/navigate.wav", click: "sounds/click.wav", back: "sounds/back.wav" };
    function ctx() {
        if (actx) return actx;
        var AC = global.AudioContext || global.webkitAudioContext;
        if (AC) { try { actx = new AC(); } catch (e) {} }
        return actx;
    }
    function blip(freq, dur, vol) {
        if (!TV.pref("sounds")) return;
        var c = ctx(); if (!c) return;
        try {
            var t = c.currentTime, o = c.createOscillator(), g = c.createGain();
            o.type = "sine"; o.frequency.setValueAtTime(freq, t);
            g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
            o.connect(g); g.connect(c.destination); o.start(t); o.stop(t + dur + 0.02);
        } catch (e) {}
    }
    function loadSounds() {
        Object.keys(FILES).forEach(function (k) {
            var c = ctx(); if (!c) return;
            try {
                var x = new XMLHttpRequest();
                x.open("GET", FILES[k], true);
                x.responseType = "arraybuffer";
                x.onload = function () {
                    if (!x.response || (x.status && x.status !== 200)) return;
                    try {
                        var done = function (buf) { if (!buffers[k] && TV.DEV) TV.log("sound ready: " + k); buffers[k] = buf; };
                        var pr = c.decodeAudioData(x.response, done, function () {});
                        if (pr && pr.then) pr.then(done, function () {});
                    } catch (e) {}
                };
                x.send();
            } catch (e) {}
        });
    }
    function play(k, rate, vol) {
        if (!TV.pref("sounds")) return true;
        var buf = buffers[k];
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
    TV.sound = {
        tick: function () { if (!play("navigate")) blip(2100, 0.022, 0.045); },
        select: function () { if (!play("click")) blip(1250, 0.06, 0.07); },
        back: function () { if (!play("back")) blip(900, 0.05, 0.06); },
        edge: function () { if (!play("navigate", 0.72, 0.6)) blip(420, 0.05, 0.05); }
    };
    setTimeout(loadSounds, 400);

    /* ---------- toast ---------- */
    var toastTimer = null;
    TV.toast = function (msg, long) {
        var t = TV.$("toast");
        t.textContent = msg;
        t.classList.add("is-visible");
        clearTimeout(toastTimer);
        toastTimer = setTimeout(function () { t.classList.remove("is-visible"); }, long ? 5200 : 3000);
    };

    /* ---------- icons (SF Symbols style, drawn as SVG) ---------- */
    function svg(d, size, extra) {
        size = size || 30;
        return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"' + (extra || "") + ">" + d + "</svg>";
    }
    var P = {
        search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5 21 21"/>',
        gear: '<circle cx="12" cy="12" r="3.2"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
        play: '<path d="M7 4.5v15l12.5-7.5z" fill="currentColor" stroke="none"/>',
        pause: '<path d="M7 4h3.5v16H7zM13.5 4H17v16h-3.5z" fill="currentColor" stroke="none"/>',
        star: '<path d="M12 3.2l2.7 5.6 6.1.8-4.5 4.2 1.1 6.1L12 17l-5.4 2.9 1.1-6.1-4.5-4.2 6.1-.8z" fill="currentColor" stroke="none"/>',
        starLine: '<path d="M12 3.2l2.7 5.6 6.1.8-4.5 4.2 1.1 6.1L12 17l-5.4 2.9 1.1-6.1-4.5-4.2 6.1-.8z"/>',
        plus: '<path d="M12 5v14M5 12h14"/>',
        check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
        eyeOff: '<path d="M3 3l18 18"/><path d="M10.6 5.1A10 10 0 0 1 12 5c5 0 9 4.5 10 7-.4 1-1.2 2.3-2.4 3.5M6.1 6.2C4 7.6 2.6 9.7 2 12c1 2.5 5 7 10 7 1.6 0 3.1-.4 4.4-1.1"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
        back10: '<path d="M6 5v14"/><path d="M19 5.5v13L9.5 12z" fill="currentColor" stroke="none"/>',
        fwd10: '<path d="M18 5v14"/><path d="M5 5.5v13l9.5-6.5z" fill="currentColor" stroke="none"/>',
        moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>',
        cc: '<rect x="2.5" y="5" width="19" height="14" rx="3"/><path d="M10.5 10.2a2.3 2.3 0 1 0 0 3.6M17.5 10.2a2.3 2.3 0 1 0 0 3.6"/>',
        eyeCheck: '<path d="M2 12c1-2.5 5-7 10-7s9 4.5 10 7c-1 2.5-5 7-10 7S3 14.5 2 12z"/><path d="M9 12l2 2 4-4"/>',
        chevron: '<path d="M9 5l7 7-7 7"/>',
        tv: '<rect x="2.5" y="5" width="19" height="13" rx="2.5"/><path d="M8 21h8"/>',
        grid: '<rect x="3" y="3" width="8" height="8" rx="2"/><rect x="13" y="3" width="8" height="8" rx="2"/><rect x="3" y="13" width="8" height="8" rx="2"/><rect x="13" y="13" width="8" height="8" rx="2"/>',
        phone: '<rect x="6.5" y="2.5" width="11" height="19" rx="2.5"/><path d="M11 18.5h2"/>',
        keyboard: '<rect x="2.5" y="6" width="19" height="12" rx="2.5"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/>',
        trash: '<path d="M4 7h16M10 11v6M14 11v6M5.5 7l1 12.5A2 2 0 0 0 8.5 21h7a2 2 0 0 0 2-1.5L18.5 7M9 7V4.5h6V7"/>',
        refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/>',
        list: '<path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>',
        sort: '<path d="M7 4v16M3 8l4-4 4 4M17 20V4M13 16l4 4 4-4"/>',
        aspect: '<rect x="2.5" y="5" width="19" height="14" rx="2.5"/><path d="M6 9.5V8h2.5M18 14.5V16h-2.5"/>',
        info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5h.01"/>',
        speaker: '<path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5z" fill="currentColor"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>',
        link: '<path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1"/>',
        film: '<rect x="3" y="3" width="18" height="18" rx="2.5"/><path d="M7.5 3v18M16.5 3v18M3 7.5h4.5M3 12h18M3 16.5h4.5M16.5 7.5H21M16.5 16.5H21"/>',
        restart: '<path d="M4 12a8 8 0 1 0 2.3-5.7M4 4v5h5"/>',
        eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
        quality: '<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M7 15V9M7 12h3M10 9v6M14 9h2.5a1.5 1.5 0 0 1 1.5 1.5v3a1.5 1.5 0 0 1-1.5 1.5H14z"/>'
    };
    TV.icon = function (name, size, extra) { return svg(P[name] || "", size, extra); };

    /* ---------- remote keys ---------- */
    TV.registerKeys = function () {
        if (!global.tizen || !global.tizen.tvinputdevice) return;
        ["ChannelUp", "ChannelDown", "MediaPlayPause", "MediaPlay", "MediaPause", "MediaStop", "MediaFastForward", "MediaRewind",
         "MediaTrackPrevious", "MediaTrackNext", "Info", "Guide", "ChannelList", "PreviousChannel", "Exit",
         "ColorF0Red", "ColorF1Green", "ColorF2Yellow", "ColorF3Blue",
         "0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "Minus"].forEach(function (k) {
            try { global.tizen.tvinputdevice.registerKey(k); } catch (e) {}
        });
    };

    TV.debounce = function (fn, ms) {
        var t = null;
        return function () { var a = arguments, s = this; clearTimeout(t); t = setTimeout(function () { fn.apply(s, a); }, ms); };
    };
    TV.uid = function () { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); };

    TV.exit = function () {
        if (TV.WEBOS) { try { global.close(); } catch (e) {} return; }
        if (TV.ANDROID) { try { global.APLAndroid.exit(); } catch (e) {} return; }
        try { global.tizen.application.getCurrentApplication().exit(); } catch (e) { TV.toast("Exit (preview)"); }
    };
    TV.hide = function () {
        if (TV.ANDROID) { try { global.APLAndroid.background(); } catch (e) { TV.exit(); } return; }
        if (TV.WEBOS) {
            var S = global.webOSSystem || global.PalmSystem;
            try { S.platformBack(); } catch (e) { TV.exit(); }
            return;
        }
        try { global.tizen.application.getCurrentApplication().hide(); } catch (e) { TV.exit(); }
    };
})(window);
