/* ============================================================
   diagnostic.js — Settings › Support › Diagnostic.

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
    var lastSnaps = [], fullEl = null, reportText = "";
    var SNAP_KINDS = { over: "Samsung's bar over the launcher", full: "Samsung's home in full screen", "focus lost": "focus lost, not to Samsung's home" };
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
            { label: APL.t("Start-up with the screen"), run: function () {
                if (PREVIEW) return preview();
                // The two services' "start at boot" flags (read, and turned on if off: startup.js)
                var flags = APL.startup ? limit(APL.startup.check(), 12000).catch(function () { return null; }) : Promise.resolve(null);
                return flags.then(function (f) {
                    return limit(sys.bridgeState(), 9000).catch(function () { return null; }).then(function (st) {
                        var parts = [], state = "ok";
                        if (f && !f.error) {
                            var b = f.apps["APLauncher.Bridge"], v = f.apps["vetrotvapp.svc"];
                            parts.push(APL.t("auto start: launcher {a} · Vetro {b}", { a: b ? (b.onboot ? "✓" : "✕") : "?", b: v ? (v.onboot && v.autorestart ? "✓" : "✕") : "?" }));
                            if (f.fixed.length) { parts.push(APL.t("turned on now, effective at the next start")); state = "warn"; }
                            if (!b || !v) state = "warn";                       // a flag that couldn't be read is not a success
                            if ((b && !b.onboot) || (v && !(v.onboot && v.autorestart))) state = "fail";
                        } else if (f && f.error) { parts.push(APL.t("flags not readable ({e})", { e: f.error.slice(0, 60) })); state = "warn"; }
                        if (st) {
                            parts.push(st.startedAt && st.startedAt < 240 ? APL.t("launcher service started with the screen ({s} s)", { s: Math.round(st.startedAt) })
                                                                         : APL.t("launcher service started later, by the launcher"));
                            var w = st.vetroWake || {};
                            if (w.how === "service") parts.push(APL.t("Vetro woken up automatically ({s} s)", { s: w.uptime }));
                            else if (w.how === "app") parts.push(APL.t("Vetro woken up by opening its app ({s} s)", { s: w.uptime }));
                            else if (w.how === "failed") { parts.push(APL.t("Vetro could not be woken up")); state = "fail"; }
                        } else { parts.push(APL.t("launcher service not answering")); state = "fail"; }
                        return R(state, parts.join(" · "));
                    });
                });
            } },
            { label: APL.t("Closing unused apps"), run: function () {
                if (PREVIEW) return preview();
                if (APL.overlay && APL.overlay.isInstalled()) return R("ok", APL.t("done by APL Overlay"));
                if (!sys.pref("idleClose")) return R("skip", APL.t("turned off in Settings › Apps"));
                return limit(sys.bridgeState(), 9000).then(function (st) {
                    var i = st.idle || {};
                    if (!i.minutes) return R("warn", APL.t("not running in the launcher service: install again with APL Launcher Setup"));
                    var last = (i.closed || []).slice(-3).join(", ");
                    return R("ok", APL.t("on: after {m} min in the background · {n} checks", { m: i.minutes, n: i.checks || 0 }) +
                                   (last ? " · " + APL.t("last closed: {list}", { list: last }) : "") +
                                   (i.respawn && i.respawn.length ? " · " + APL.t("left alone, they start again by themselves: {list}", { list: i.respawn.join(", ") }) : ""));
                });
            } },
            { label: APL.t("Start on APL Launcher"), run: function () {
                if (PREVIEW) return preview();
                // The screen's home app and Autorun Smart Hub (Settings › General & Privacy › Start on APL Launcher)
                return limit(sys.exec("vconftool get db/appfw/home_appid 2>&1; vconftool get db/menu/smart_hub/ontvsetting/auto_start 2>&1"), 9000).then(function (r) {
                    var out = String(r.output || ""), h = (/home_appid, value = (\S+)/.exec(out) || [])[1], a = (/auto_start, value = (-?\d+)/.exec(out) || [])[1];
                    if (!h) return R("warn", APL.t("the screen's home app can't be read here"));
                    if (h === "APLauncher.Home" && a === "1") return R("ok", APL.t("the launcher is the screen's home app: any remote's Home opens it, and it shows at power-on"));
                    return R("warn", APL.t("home app: {app} · Autorun Smart Hub {a} · to try: Settings › General & Privacy › Start on APL Launcher",
                                           { app: h, a: a === "1" ? APL.t("on") : APL.t("off") }));
                });
            } },
            { label: APL.t("Remote held by Vetro"), run: function () {
                if (PREVIEW) return preview();
                return limit(sys.vetroGet("/input"), 9000).then(function (d) {
                    var pol = (d && d.status && d.status.policy) || {}, held = pol.mode === "filter" ? pol.device : "";
                    var others = ((d && d.devices) || []).filter(function (x) { return x.selectable && x.name !== held; }).map(function (x) { return x.name; });
                    var more = others.length ? " · " + APL.t("not held: {list} (its Home goes to Samsung, Return to the Launcher brings the launcher back)", { list: others.join(", ") }) : "";
                    return limit(sys.bridgeState(), 9000).catch(function () { return null; }).then(function (st) {
                        var f = (st && st.follow) || null, fol = "";
                        var fl = String((f && f.last) || "").replace("failed: ", APL.t("failed: ")).replace("infrared", APL.t("infrared"));
                        if (!sys.pref("remoteFollow")) fol = " · " + APL.t("following the remote in use: off");
                        else if (f && f.on) fol = " · " + APL.t("follows the remote in use") + (f.switches ? " (" + APL.t("moved {n} times, last: {l}", { n: f.switches, l: fl }) + ")" : "") +
                                                  (f.error ? " · " + f.error : "");
                        else if (st) fol = " · " + APL.t("following the remote in use: not in the launcher service, install again with APL Launcher Setup");
                        if (!held) return R("warn", APL.t("no remote intercepted: Vetro › Remapper › choose the remote, Remote interception on") + more + fol);
                        return R(pol.connected ? "ok" : "warn", held + (pol.connected ? "" : " · " + APL.t("not connected right now")) + more + fol);
                    });
                }, function (e) { return R("warn", APL.t("Vetro doesn't say ({e})", { e: msg(e).slice(0, 60) })); });
            } },
            { label: APL.t("Return to the Launcher"), run: function () {
                if (PREVIEW) return preview();
                if (APL.overlay && APL.overlay.isInstalled()) return R("ok", APL.t("done by APL Overlay"));
                if (!sys.pref("homeReturn")) return R("skip", APL.t("turned off in Settings › Home Screen"));
                return limit(sys.bridgeState(), 9000).then(function (st) {
                    var g = st.homeGuard || {};
                    if (!g.on) return R("warn", APL.t("not running in the launcher service: install again with APL Launcher Setup"));
                    lastSnaps = g.snaps || [];
                    var seen = lastSnaps.length ? lastSnaps[lastSnaps.length - 1] : null;
                    return R(g.fails && !g.back ? "warn" : "ok", APL.t("on: Samsung's home is watched while the launcher is behind") +
                                   (g.fromStart ? " · " + APL.t("active from power-on") : "") +
                                   (g.back ? " · " + APL.t("brought back {n} times (last {t})", { n: g.back, t: g.last }) : "") +
                                   (g.how ? " · " + APL.t("how: {h}", { h: APL.t(g.how) }) : "") +
                                   (g.fails ? " · " + APL.t("{n} times not back", { n: g.fails }) : "") +
                                   (g.asleep ? " · " + APL.t("Samsung's home seen {n} times while the screen said it was going to sleep (state {pm}): left alone", { n: g.asleep, pm: g.pm }) : "") +
                                   (seen ? " · " + APL.t("last seen: {k} at {t}", { k: APL.t(SNAP_KINDS[seen.kind] || seen.kind), t: seen.at }) : ""));
                });
            } },
            { label: "APL Overlay", run: function () {
                if (PREVIEW) return preview();
                if (APL.overlay && APL.overlay.isInstalled()) return R("ok", APL.t("installed"));
                // Not there: what the screen offers, to see what it would take (APL Overlay is built for Tizen 9 / .NET 6).
                // No backslash in Vetro commands (it doubles them): xargs puts the versions on one line.
                var cmd = "ls /usr/share/dotnet.tizen/netcoreapp/ /usr/share/dotnet/shared/Microsoft.NETCore.App/ 2>/dev/null | grep -E '^[0-9]' | sort -u | xargs echo; " +
                          "pkgcmd -l 2>/dev/null | grep -ci overlay";
                return limit(sys.exec(cmd), 9000).then(function (r) {
                    var lines = String(r.output || "").split("\n"), net = (lines[0] || "").trim() || "?", pkgs = (lines[1] || "0").trim();
                    var tizen = parseFloat(sys.product().tizen) || 0;
                    var why = tizen && tizen < 9 ? APL.t("built for Tizen 9, this screen is Tizen {v}", { v: sys.product().tizen }) : APL.t("not installed");
                    return R("warn", why + " · .NET " + net + (pkgs !== "0" && pkgs !== "" ? " · " + APL.t("an overlay package is there but not usable") : ""));
                }, function () {
                    return R("warn", APL.t("not installed: no Control Center over videos (needs the C# compiler when installing)"));
                });
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
                var sm = APL.smooth ? APL.smooth.state() : null;
                if (sm) d += " · " + APL.t("effects: {l}", { l: [APL.t("All Effects"), APL.t("Light Effects"), APL.t("Minimal Effects")][sm.level] }) +
                             (sm.median ? " · " + APL.t("key to screen {ms} ms", { ms: sm.median }) : "") +
                             (sm.home ? " · " + APL.t("Home Screen: longest frame after a key {ms} ms", { ms: sm.home }) : "");
                if (APL.genArt && APL.genArt.where) d += " · " + APL.t("backgrounds painted: {w}", { w: APL.genArt.where() });
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
            // What the screen showed the last times Samsung's home was seen (for the phone remote's report)
            if (lastSnaps.length) text += "\n\n" + lastSnaps.map(function (x) { return "[" + x.at + " " + x.kind + "]\n" + x.text; }).join("\n\n");
            reportText = text;
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
        var details = el("div", "diag__btn", APL.t("Details"));
        var close_ = el("div", "diag__btn", APL.t("Close"));
        btns.appendChild(again); btns.appendChild(details); btns.appendChild(close_);
        head.appendChild(btns);
        head.appendChild(el("div", "diag__spin"));
        root.appendChild(head);
        listEl = el("div", "diag__list");
        root.appendChild(listEl);
        // Every line in full (the list cuts the long ones), and what the screen showed when Samsung's home came
        fullEl = el("pre", "diag__full");
        root.appendChild(fullEl);
        footEl = el("div", "diag__foot");
        root.appendChild(footEl);
        document.body.appendChild(root);
        nav = new APL.Nav({
            onSelect: function (i) {
                if (i === 0) { if (!running) { root.classList.remove("is-full"); details.textContent = APL.t("Details"); run(); } }
                else if (i === 1) {
                    var on = root.classList.toggle("is-full");
                    details.textContent = on ? APL.t("List") : APL.t("Details");
                    if (on) fullEl.textContent = reportText || APL.t("The tests are still running.");
                }
                else close();
            },
            onBack: function () {
                if (root.classList.contains("is-full")) { root.classList.remove("is-full"); details.textContent = APL.t("Details"); return; }
                close();
            }
        });
        nav.setTiles([again, details, close_]);
    }

    function open() {
        if (APL.settings && APL.settings.isOpen()) APL.settings.close();
        if (!root) buildDom();
        root.classList.add("is-open");
        isOpen = true;
        APL.pushNav(nav);
        nav.focus(2);
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
