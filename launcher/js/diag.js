/* ============================================================
   diag.js — Settings › Support › Diagnostic.

   Checks, on the screen itself, what depends on the model: Vetro,
   the bridge, each remote key (the key is really sent and the
   launcher looks for it), volume and mute (changed then put back),
   the phone remote's server, reading and writing the backlight
   (changed by 1 then put back), weather, TMDB, Apple's videos,
   smoothness (frames per second) and memory.
   Each line: ✓ works, ! works with a limit, ✕ doesn't work, – not
   tested. The report is also kept as text: on the phone remote
   (Diagnostic link at the bottom) when it is on.
   ============================================================ */
(function (global) {
    "use strict";

    var APL = global.APL, sys = APL.sys;
    var root, listEl, sumEl, footEl, nav, isOpen = false, running = false, runId = 0;

    function el(tag, cls, html) { var e = document.createElement(tag); e.className = cls; if (html) e.innerHTML = html; return e; }
    function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
    function limit(p, ms) {
        return new Promise(function (resolve, reject) {
            var t = setTimeout(function () { reject(new Error(APL.t("no answer after {s} s", { s: Math.round(ms / 1000) }))); }, ms);
            p.then(function (v) { clearTimeout(t); resolve(v); }, function (e) { clearTimeout(t); reject(e); });
        });
    }
    function R(state, detail) { return { state: state, detail: detail || "" }; }
    function msg(e) { return (e && e.message) || String(e || ""); }
    function getJson(url) { return global.fetch(url, { cache: "no-store" }).then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); }); }
    var PREVIEW = sys.PREVIEW;
    function preview() { return R("skip", APL.t("PC preview: tested on the screen")); }

    /* ---------- a key really sent (input_keyevent through Vetro), and looked for ---------- */
    function keyTest(xname, codes) {
        if (PREVIEW) return Promise.resolve(preview());
        return new Promise(function (resolve) {
            var got = false, out = "";
            // While the test runs, every key is caught here and does nothing else
            function cap(e) {
                if (e.type === "keydown" && codes.indexOf(e.keyCode) !== -1) got = true;
                e.stopImmediatePropagation(); e.stopPropagation(); e.preventDefault();
            }
            global.addEventListener("keydown", cap, true);
            global.addEventListener("keyup", cap, true);
            sys.exec("/usr/bin/input_keyevent " + xname + " 2>&1; echo rc=$?").then(function (r) { out = String(r.output || "").trim(); },
                                                                                   function (e) { out = msg(e); });
            setTimeout(function () {
                global.removeEventListener("keydown", cap, true);
                global.removeEventListener("keyup", cap, true);
                if (got) resolve(R("ok", APL.t("received by the launcher")));
                else resolve(R("fail", APL.t("sent, nothing arrived") + (out ? " (" + out.replace(/\s+/g, " ").slice(0, 80) + ")" : "")));
            }, 1600);
        });
    }

    function volumeTest() {
        if (PREVIEW) return Promise.resolve(preview());
        var before = sys.audio.getVolume();
        if (before >= 100) return Promise.resolve(R("skip", APL.t("volume already at 100")));
        return sys.exec("/usr/bin/input_keyevent XF86AudioRaiseVolume 2>&1").then(function () { return wait(1200); }).then(function () {
            var after = sys.audio.getVolume();
            if (after > before) {
                sys.exec("/usr/bin/input_keyevent XF86AudioLowerVolume 2>&1").catch(function () {});
                return R("ok", APL.t("{a} → {b}, then put back", { a: before, b: after }));
            }
            return R("warn", APL.t("volume unchanged ({v}): key unknown, or the sound goes to an external device", { v: before }));
        }, function (e) { return R("fail", msg(e)); });
    }

    function muteTest() {
        if (PREVIEW) return Promise.resolve(preview());
        var before = sys.audio.isMute();
        return sys.exec("/usr/bin/input_keyevent XF86AudioMute 2>&1").then(function () { return wait(1200); }).then(function () {
            var after = sys.audio.isMute();
            if (after !== before) {
                sys.exec("/usr/bin/input_keyevent XF86AudioMute 2>&1").catch(function () {});
                return R("ok", APL.t("switched, then put back"));
            }
            return R("warn", APL.t("mute unchanged"));
        }, function (e) { return R("fail", msg(e)); });
    }

    /* ---------- the checks, in order ---------- */
    function checks() {
        return [
            { label: APL.t("Screen"), run: function () {
                var p = sys.product();
                return R("info", p.model + " · " + p.firmware + " · Tizen " + p.tizen + " · Chromium " + (APL.chromeVersion || "?"));
            } },
            { label: "APL Launcher", run: function () {
                var U = global.APL_UPDATE || {};
                var d = APL.t("version {v}", { v: sys.version }) + (U.fromBundle ? " " + APL.t("(auto-update)") : "") + " · " + (U.REPO || "?") +
                        " · " + (sys.pref("autoUpdate") ? APL.t("updates on") : APL.t("updates off"));
                return R(/^Flownyx5\//.test(U.REPO || "") ? "ok" : "warn", d);
            } },
            { label: APL.t("Display engine"), run: function () {
                var inset = !!(global.CSS && global.CSS.supports && global.CSS.supports("inset", "0"));
                var gap = !document.documentElement.classList.contains("no-flexgap");
                var legacy = document.documentElement.classList.contains("legacy");
                return R("ok", "inset " + (inset ? APL.t("yes") : APL.t("no, replaced")) + " · flex gap " + (gap ? APL.t("yes") : APL.t("no, replaced")) +
                               (legacy ? " · " + APL.t("light animations") : ""));
            } },
            { label: APL.t("Installed apps"), run: function () {
                var t0 = Date.now();
                return limit(APL.loadApps(), 10000).then(function (list) {
                    function find(key) { var a = list.filter(function (x) { return x.key === key; })[0]; return a ? a.id : APL.t("not found"); }
                    return R("ok", APL.t("{n} apps in {ms} ms", { n: list.length, ms: Date.now() - t0 }) + " · Netflix: " + find("netflix") + " · Prime: " + find("primevideo"));
                });
            } },
            { label: "Vetro", run: function () {
                if (PREVIEW) return preview();
                return limit(sys.exec("id -u; cut -d. -f1 /proc/uptime"), 9000).then(function (r) {
                    var l = String(r.output || "").trim().split(/\s+/), up = Math.round((parseInt(l[1], 10) || 0) / 360) / 10;
                    return l[0] === "0" ? R("ok", APL.t("root commands work · screen on for {h} h", { h: up })) : R("warn", APL.t("answers, but not as root (uid {u})", { u: l[0] }));
                });
            } },
            { label: APL.t("Launcher bridge"), run: function () {
                if (PREVIEW) return preview();
                return limit(sys.bridgePing(), 9000).then(function () { return R("ok", APL.t("answers")); });
            } },
            { label: "APL Overlay", run: function () {
                if (PREVIEW) return preview();
                return APL.overlay && APL.overlay.isInstalled() ? R("ok", APL.t("installed")) :
                    R("warn", APL.t("not installed: no Control Center over videos (needs the C# compiler when installing)"));
            } },
            { label: APL.t("Key ▲ (phone remote)"), run: function () { return keyTest("Up", [38]); } },
            { label: APL.t("Key ▶ (phone remote)"), run: function () { return keyTest("Right", [39]); } },
            { label: APL.t("Key OK (phone remote)"), run: function () { return keyTest("Return", [13]); } },
            { label: APL.t("Key Back (phone remote)"), run: function () { return keyTest("XF86Back", [10009, 8, 27]); } },
            { label: APL.t("Key ⏯ (phone remote)"), run: function () { return keyTest("XF86PlayBack", [10252, 415, 19]); } },
            { label: APL.t("Key Info (phone remote)"), run: function () { return keyTest("XF86Info", [457]); } },
            { label: APL.t("Volume + / − (phone remote)"), run: volumeTest },
            { label: APL.t("Mute (phone remote)"), run: muteTest },
            { label: APL.t("Phone remote server"), run: phoneServer },
            { label: APL.t("Brightness (Good Night)"), run: brightness },
            { label: APL.t("Network and weather"), run: weather },
            { label: APL.t("TMDB key (search, Top Shelf)"), run: function () {
                var k = (global.APL_KEYS || {}).tmdb;
                if (!k) return R("warn", APL.t("no key: the search finds apps only, no films or series"));
                return limit(getJson("https://api.themoviedb.org/3/configuration?api_key=" + k), 9000).then(function () { return R("ok", APL.t("key accepted")); },
                    function (e) { return R("fail", /401/.test(msg(e)) ? APL.t("key refused by TMDB") : msg(e)); });
            } },
            { label: APL.t("Apple videos (screen saver)"), run: aerial },
            { label: APL.t("Smoothness and memory"), run: smoothness },
            { label: APL.t("Storage and time"), run: function () {
                return sys.storage().then(function (s) {
                    var d = new Date(), off = -d.getTimezoneOffset() / 60;
                    return R("info", s + " · " + d.toLocaleTimeString(APL.locale, { hour: "2-digit", minute: "2-digit" }) + " (UTC" + (off >= 0 ? "+" : "") + off + ")");
                });
            } }
        ];
    }

    function phoneServer() {
        if (PREVIEW || !APL.phone) return Promise.resolve(preview());
        var ip = sys.network().ip;
        function ping(host) {
            return limit(getJson("http://" + host + ":8092/ping"), 4000).then(function (j) { return !!(j && j.ok); }, function () { return false; });
        }
        return APL.phone.serverOn().then(function () { return wait(1800); }).then(function () {
            return ping("127.0.0.1").then(function (local) {
                return (/^\d+\.\d+\.\d+\.\d+$/.test(ip || "") ? ping(ip) : Promise.resolve(false)).then(function (lan) {
                    APL.phone.serverSync();                 // back as it was (off if it was off)
                    if (lan) return R("ok", APL.t("listening on {ip}:8092", { ip: ip }));
                    if (local) return R("warn", APL.t("starts, but not reachable at {ip}:8092", { ip: ip }));
                    return R("fail", APL.t("the server doesn't start on this screen"));
                });
            });
        }, function (e) { APL.phone.serverSync(); return R("fail", msg(e)); });
    }

    function brightness() {
        function find(items, id) { for (var i = 0; i < items.length; i++) if (items[i].id === id) return items[i]; return null; }
        return limit(sys.tvSettings(true), 12000).then(function (items) {
            var b = find(items, "backlight");
            var readable = APL.t("{n} picture settings readable", { n: items.length });
            if (!b) return R("fail", APL.t("backlight not readable") + " · " + readable);
            if (!b.writable) return R("warn", APL.t("backlight {v}/{max}, read only", { v: b.value, max: b.max }) + " · " + readable);
            var v = b.value, step = v < b.max ? 1 : -1;
            return sys.tvAdjust("backlight", step).then(function () { return wait(2200); })
                .then(function () { return sys.tvSettings(true); })
                .then(function (after) {
                    var nb = find(after, "backlight"), now = nb ? nb.value : v;
                    if (now !== v) sys.tvAdjust("backlight", v - now).catch(function () {});      // put back
                    return now === v + step
                        ? R("ok", APL.t("backlight {v}/{max}, changed and put back", { v: v, max: b.max }) + " · " + readable)
                        : R("fail", APL.t("backlight {v}/{max}: the change didn't apply", { v: v, max: b.max }));
                });
        });
    }

    function weather() {
        var n = sys.network();
        var net = n.type + (n.ip && n.ip !== "—" ? " · " + n.ip : "");
        if (!n.connected) return Promise.resolve(R("fail", APL.t("not connected")));
        var place = PREVIEW ? Promise.resolve({ latitude: "48.85", longitude: "2.35", city: "Paris" })
                            : limit(getJson("https://get.geojs.io/v1/ip/geo.json"), 8000);
        return place.then(function (g) {
            return limit(getJson("https://api.open-meteo.com/v1/forecast?latitude=" + parseFloat(g.latitude).toFixed(3) + "&longitude=" +
                                 parseFloat(g.longitude).toFixed(3) + "&current=temperature_2m"), 8000).then(function (j) {
                return R("ok", net + " · " + (g.city ? g.city + " " : "") + Math.round(j.current.temperature_2m) + "°");
            });
        }, function (e) { return R("warn", net + " · " + APL.t("town not found ({e}): Paris is used", { e: msg(e) })); });
    }

    function aerial() {
        var probe = document.createElement("video");
        var can = probe.canPlayType('video/mp4; codecs="hvc1.1.6.L150.90"') || probe.canPlayType('video/mp4; codecs="hev1.1.6.L150.90"');
        var hevc = can === "probably" ? APL.t("yes") : can === "maybe" ? APL.t("probably") : APL.t("no");
        var a = (global.APL_AERIALS || [])[0];
        if (!a) return Promise.resolve(R("warn", APL.t("no video list")));
        return new Promise(function (resolve) {
            var v = document.createElement("video"), t0 = Date.now(), done = false;
            v.muted = true; v.setAttribute("muted", ""); v.preload = "auto";
            v.style.cssText = "position:fixed;left:0;top:0;width:2px;height:2px;opacity:0.01;pointer-events:none";
            document.body.appendChild(v);
            function end(r) {
                if (done) return;
                done = true;
                try { v.pause(); v.removeAttribute("src"); v.load(); } catch (e) {}
                if (v.parentNode) v.parentNode.removeChild(v);
                resolve(r);
            }
            v.onplaying = function () {
                var s = ((Date.now() - t0) / 1000).toFixed(1);
                end(R(+s > 6 ? "warn" : "ok", APL.t("1080p starts in {s} s · 4K HEVC: {h}", { s: APL.lang === "fr" ? s.replace(".", ",") : s, h: hevc })));
            };
            v.onerror = function () { end(R("fail", APL.t("the 1080p video doesn't play · 4K HEVC: {h}", { h: hevc }))); };
            setTimeout(function () { end(R("fail", APL.t("no picture after 15 s · 4K HEVC: {h}", { h: hevc }))); }, 15000);
            v.src = a[4].replace(/^https:/, "http:");
            try { var p = v.play(); if (p && p.catch) p.catch(function () {}); } catch (e) {}
        });
    }

    function smoothness() {
        var spin = root.querySelector(".diag__spin");
        spin.classList.add("is-on");
        return new Promise(function (resolve) {
            var frames = 0, t0 = 0;
            function tick(t) {
                if (!t0) t0 = t;
                frames++;
                if (t - t0 < 2000) { global.requestAnimationFrame(tick); return; }
                resolve(Math.round(frames * 1000 / (t - t0)));
            }
            global.requestAnimationFrame(tick);
        }).then(function (fps) {
            spin.classList.remove("is-on");
            var mem = PREVIEW ? Promise.resolve(null) : sys.exec("awk '/MemAvailable/{print $2}' /proc/meminfo").then(function (r) {
                return Math.round((parseInt(r.output, 10) || 0) / 1024);
            }, function () { return null; });
            return mem.then(function (mb) {
                var d = APL.t("{fps} frames per second", { fps: fps }) + (mb ? " · " + APL.t("{mb} MB of memory free", { mb: mb }) : "");
                return R(fps >= 50 ? "ok" : fps >= 30 ? "warn" : "fail", d);
            });
        });
    }

    /* ---------- screen ---------- */
    var ICON = { ok: "✓", warn: "!", fail: "✕", skip: "–", info: "i", run: "" };

    function row(label) {
        var r = el("div", "diag__row is-wait");
        r.innerHTML = '<span class="diag__st"></span><span class="diag__txt"><b></b><i></i></span>';
        r.querySelector("b").textContent = label;
        r.querySelector("i").textContent = "";
        listEl.appendChild(r);
        return r;
    }
    function paint(r, res) {
        r.className = "diag__row is-" + res.state;
        r.querySelector(".diag__st").textContent = ICON[res.state];
        r.querySelector("i").textContent = res.detail;
    }

    function run() {
        if (running) return;
        running = true;
        var my = ++runId, list = checks(), rows = [], out = [], count = { ok: 0, warn: 0, fail: 0, skip: 0, info: 0 };
        listEl.innerHTML = "";
        list.forEach(function (c) { rows.push(row(c.label)); });
        sumEl.textContent = APL.t("Testing…");
        footEl.textContent = "";
        var i = 0;
        (function next() {
            if (my !== runId) return;
            if (i >= list.length) { finish(); return; }
            var c = list[i], r = rows[i];
            r.className = "diag__row is-run";
            var p;
            try { p = Promise.resolve(c.run()); } catch (e) { p = Promise.reject(e); }
            limit(p, 30000).then(function (res) { return res; }, function (e) { return R("fail", msg(e)); }).then(function (res) {
                if (my !== runId) return;
                paint(r, res);
                count[res.state]++;
                out.push(ICON[res.state] + " " + c.label + " — " + res.detail);
                i++;
                setTimeout(next, 150);
            });
        })();
        function finish() {
            running = false;
            sumEl.textContent = APL.t("{ok} work · {warn} with a limit · {fail} don't work · {skip} not tested", count);
            var text = "APL Launcher diagnostic — " + new Date().toISOString().slice(0, 16).replace("T", " ") + "\n" + out.join("\n");
            try { global.localStorage.setItem("apl.diag", text); } catch (e) {}
            try { console.log(text); } catch (e) {}
            if (!PREVIEW) sys.bridgeSend([{ key: "report", value: text }]).catch(function () {});
            footEl.textContent = sys.pref("phoneRemote")
                ? APL.t("The report as text: on the phone remote, “Diagnostic” link at the bottom.")
                : APL.t("Take a photo of this screen to share it.");
        }
    }

    function buildDom() {
        root = el("section", "diag");
        var head = el("div", "diag__head");
        head.appendChild(el("h1", "diag__title", APL.t("Diagnostic")));
        sumEl = el("div", "diag__sum");
        head.appendChild(sumEl);
        var btns = el("div", "diag__btns");
        var again = el("div", "diag__btn", APL.t("Run Again"));
        var close_ = el("div", "diag__btn", APL.t("Close"));
        btns.appendChild(again); btns.appendChild(close_);
        head.appendChild(btns);
        head.appendChild(el("div", "diag__spin"));
        root.appendChild(head);
        listEl = el("div", "diag__list");
        root.appendChild(listEl);
        footEl = el("div", "diag__foot");
        root.appendChild(footEl);
        document.body.appendChild(root);
        nav = new APL.Nav({
            onSelect: function (i) { if (i === 0) { if (!running) run(); } else close(); },
            onBack: close
        });
        nav.setTiles([again, close_]);
    }

    function open() {
        if (APL.settings && APL.settings.isOpen()) APL.settings.close();
        if (!root) buildDom();
        root.classList.add("is-open");
        isOpen = true;
        APL.pushNav(nav);
        nav.focus(1);
        run();
    }
    function close() {
        if (!isOpen) return;
        isOpen = false;
        runId++;                                   // a test still running is forgotten
        running = false;
        root.classList.remove("is-open");
        APL.popNav(nav);
    }

    APL.diag = { open: open, close: close, isOpen: function () { return isOpen; } };
})(window);
