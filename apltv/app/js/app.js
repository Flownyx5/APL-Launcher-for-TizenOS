/* ============================================================
   app.js: start-up and the tab bar.
   Tabs at the top, tvOS style: Home, Live TV, Guide, Movies, Series,
   Search, Settings. ▼ goes into the page, ▲ at its top comes back to the
   tabs. Back: from a page to its tab, from a tab to Home, from Home asks
   whether to quit.
   APL Launcher (or anything) can open a channel directly:
   app control data  channel=<channel id>  or  play=last.
   ============================================================ */
(function (global) {
    "use strict";

    var TV = global.TV, el = TV.el, esc = TV.esc, T = TV.t, D = TV.data;
    TV.VERSION = "1.0.11";
    TV.DONATE = "https://ko-fi.com/knikt";     // the Ko-fi page for donations (Settings > About, README, .github/FUNDING.yml)
    var TABS = [
        { id: "home", label: T("Home") },
        { id: "live", label: T("Live TV") },
        { id: "guide", label: T("Guide") },
        { id: "movies", label: T("Movies") },
        { id: "series", label: T("Series") },
        { id: "search", icon: "search", label: T("Search") },
        { id: "settings", icon: "gear", label: T("Settings") }
    ];
    var tabEls = [], tabIndex = 0, focusOn = "tabs", current = null;

    function buildTabs() {
        var nav = TV.$("tabs");
        nav.innerHTML = "";
        tabEls = TABS.map(function (t) {
            var e = el("div", "tab", t.icon ? TV.icon(t.icon, 30) : esc(t.label));
            nav.appendChild(e);
            return e;
        });
    }
    function paintTabs() {
        tabEls.forEach(function (e, i) {
            e.classList.toggle("is-focused", focusOn === "tabs" && i === tabIndex);
            e.classList.toggle("is-current", TABS[i].id === current);
        });
    }
    function viewOf(id) { return TV.views[id]; }

    function go(id, enter) {
        var i = TABS.map(function (t) { return t.id; }).indexOf(id);
        if (i < 0) return;
        tabIndex = i;
        if (current !== id) {
            if (current && viewOf(current)) viewOf(current).hide();
            document.querySelectorAll(".view").forEach(function (v) { v.classList.remove("is-on"); });
            TV.$("v-" + id).classList.add("is-on");
            current = id;
            var t0 = Date.now();
            viewOf(id).show();
            if (TV.DEV) requestAnimationFrame(function () { requestAnimationFrame(function () { TV.log("page " + id + " shown in " + (Date.now() - t0) + " ms"); }); });
            if (id !== "live" && id !== "guide") TV.setPref("startTab", id === "settings" || id === "search" ? "home" : id);
        }
        if (enter) toView(); else { focusOn = "tabs"; viewOf(id).blur(); }
        paintTabs();
        TV.$("top").classList.remove("is-hidden");
    }
    function toView() {
        focusOn = "view";
        paintTabs();
        viewOf(current).enter();
    }
    function toTabs() {
        focusOn = "tabs";
        viewOf(current).blur();
        paintTabs();
    }

    var switchTimer = null;
    var screen = {
        key: function (code) {
            var K = TV.KEY;
            if (focusOn === "tabs") {
                if (code === K.LEFT || code === K.RIGHT) {
                    var n = tabIndex + (code === K.LEFT ? -1 : 1);
                    if (n < 0 || n >= TABS.length) { TV.sound.edge(); return; }
                    tabIndex = n; TV.sound.tick(); paintTabs();
                    clearTimeout(switchTimer);
                    switchTimer = setTimeout(function () { go(TABS[tabIndex].id); }, 110);
                    return;
                }
                if (code === K.DOWN) { clearTimeout(switchTimer); if (current !== TABS[tabIndex].id) go(TABS[tabIndex].id); TV.sound.tick(); toView(); return; }
                if (TV.isBack(code)) { if (current !== "home") go("home"); else askQuit(); return; }
                if (TV.digit(code) >= 0 || code === K.CH_UP || code === K.CH_DOWN) { go("live", true); viewOf("live").key(code); return; }
                return;
            }
            var v = viewOf(current);
            if (TV.isBack(code)) {
                if (v.backHandled && v.backHandled()) return;
                toTabs();
                return;
            }
            var handled = v.key(code);
            if (!handled && code === K.UP) { TV.sound.tick(); toTabs(); }
        },
        ok: function () {
            if (focusOn === "tabs") { clearTimeout(switchTimer); if (current !== TABS[tabIndex].id) go(TABS[tabIndex].id); toView(); return; }
            viewOf(current).ok();
        },
        canHold: function () { var v = viewOf(current); return focusOn === "view" && !!v.longOk && (!v.canHold || v.canHold()); },
        longOk: function () { viewOf(current).longOk(); }
    };
    function askQuit() {
        TV.alert({ title: T("Quit APL TV?"), buttons: [{ label: T("Quit"), run: function () { TV.player.stop(); TV.exit(); } }, { label: T("Cancel") }], focus: 1 });
    }

    TV.shell = {
        screen: screen, go: go, toTabs: toTabs, toView: toView,
        focusOn: function () { return focusOn; },
        current: function () { return current; },
        refreshView: function () { if (current && TV.topNav() === screen) { var v = viewOf(current); if (v.show) v.show(); if (focusOn === "view") v.enter(); else v.blur(); paintTabs(); } }
    };

    /* ---------- opened by another app (APL Launcher's Top Shelf…) ---------- */
    /* LG (webOS): the same requests come as launch parameters, once ({"channel": "…"}, {"search": "…"}) */
    var webosSeen = "";
    function webosParams(p) {
        var S = global.webOSSystem || global.PalmSystem, txt = p ? JSON.stringify(p) : String(S && S.launchParams || "");
        if (!txt || txt === "{}" || txt === webosSeen) return {};
        webosSeen = txt;
        try { return typeof p === "object" && p ? p : (JSON.parse(txt) || {}); } catch (e) { return {}; }
    }
    function readRequest(params) {
        try {
            var m = {};
            if (TV.WEBOS) m = webosParams(params);
            else {
                var req = global.tizen.application.getCurrentApplication().getRequestedAppControl();
                var data = (req && req.appControl && req.appControl.data) || [];
                data.forEach(function (d) { m[d.key] = d.value && d.value[0]; });
            }
            if (m.channel) { var ch = D.channel(m.channel); if (ch) { TV.live.play(ch); return true; } }
            // From APL Launcher's Top Shelf: a title's page, or straight back into it
            var cat = D.catalog(), byId = function (id) { return cat && (cat.movies.byId[id] || cat.series.byId[id]); };
            if (m.title && byId(m.title)) { TV.detail.open(byId(m.title)); return true; }
            if (m.resume && byId(m.resume)) {
                var it = byId(m.resume), r = D.resumeOf(it.id);
                if (it.kind === "movie") TV.detail.play(it, r && !r.done ? r.pos : 0); else TV.detail.open(it, { resume: true });
                return true;
            }
            if (m.tab && TV.views[m.tab]) { go(m.tab, true); return true; }
            // A search asked from outside (voice, APL Launcher): search=<words>
            if (m.search && TV.voice) { TV.voice.search(String(m.search).slice(0, 80)); return true; }
            if (m.play === "last") { var last = D.channel(TV.pref("lastChannel")); if (last) { TV.live.play(last); return true; } }
        } catch (e) {}
        return false;
    }
    // Opened again while already in front (APL Launcher's Top Shelf): Tizen says so with "appcontrol"
    global.addEventListener("appcontrol", function () { setTimeout(readRequest, 100); });
    // LG: opened again while running (its icon, a voice request): the new parameters, then to the front
    document.addEventListener("webOSRelaunch", function (e) {
        var S = global.webOSSystem || global.PalmSystem;
        try { if (S && S.activate) S.activate(); } catch (x) {}
        setTimeout(function () { readRequest(e && e.detail); }, 100);
    });
    document.addEventListener("visibilitychange", function () {
        if (!document.hidden) { if (!TV.WEBOS) setTimeout(readRequest, 200); TV.registerKeys(); }
        else pushShelf();
    });

    /* ---------- APL Launcher's Top Shelf ----------
       What you were watching and your channels, with the data to open each one here (app control
       "resume", "title", "channel"). Sent when you leave APL TV and every few minutes. */
    function pushShelf() {
        if (!TV.TIZEN || !D.catalog() || !TV.helper || !TV.helper.shelf) return;     // APL Launcher is on Samsung screens
        try {
            var cont = D.continueWatching().slice(0, 12).map(function (x) {
                var it = x.item, r = x.resume;
                return { title: it.title || it.name, sub: r.upNext ? T("Up Next") + " · " + (r.epLabel || "") : (r.epLabel || ""), kind: it.kind,
                         image: TV.sized(it.backdrop || it.poster || "", "w780"), poster: TV.sized(it.poster || "", "w342"),
                         progress: r.upNext || !r.dur ? 0 : Math.round(100 * r.pos / r.dur) / 100, data: { resume: it.id } };
            });
            var chans = (D.favChannels().length ? D.favChannels() : D.recentChannels()).slice(0, 16).map(function (c) {
                var n = TV.epg.now(c), cur = n && n.cur;
                return { name: c.name, num: c.num, logo: c.logo || "", now: cur ? cur[2] : "", data: { channel: c.id } };
            });
            var watched = D.recentlyWatched().slice(0, 12).map(function (it) { return { title: it.title || it.name, kind: it.kind, poster: TV.sized(it.poster || "", "w342"), data: { title: it.id } }; });
            var lc = D.channel(TV.pref("lastChannel")), ln = lc && TV.epg.now(lc), lcur = ln && ln.cur;
            var last = lc ? { name: lc.name, num: lc.num, logo: lc.logo || "", now: lcur ? lcur[2] : "", progress: lcur ? Math.round(TV.epg.progress(lcur) * 100) / 100 : 0, data: { channel: lc.id } } : null;
            TV.helper.shelf({ v: 1, app: "APLTVMedia.TV", at: Date.now(), lang: TV.lang, continueWatching: cont, lastChannel: last, channels: chans, recentlyWatched: watched,
                              favorites: !!D.favChannels().length });
        } catch (e) { TV.log("shelf: " + e.message); }
    }
    setInterval(function () { if (!document.hidden) pushShelf(); }, 5 * 60 * 1000);
    TV.pushShelf = function () { clearTimeout(shelfSoon); shelfSoon = setTimeout(pushShelf, 1500); };
    var shelfSoon = null;
    var themesBuilt = false;
    D.onChange(function (w) { if (w === "catalog" && !themesBuilt && D.catalog()) { themesBuilt = true; setTimeout(D.buildThemes, 1500); } });
    setTimeout(pushShelf, 12000);
    // The title cache of the first versions is cleared once (titles are matched better now)
    setTimeout(function () {
        if (TV.load("pruned-meta-v4")) return;
        var n = 0;
        ["meta:v2:", "meta:v3:", "meta:v4:"].reduce(function (p, pre) { return p.then(function () { return TV.idb.prune(pre).then(function (c) { n += c; }); }); }, Promise.resolve())
            .then(function () { TV.log("old title cache cleared: " + n + " entries"); TV.save("pruned-meta-v4", 1); });
    }, 90000);

    /* ---------- "Pick up where you left off": the movie or episode at its minute, or the last channel ---------- */
    var asked = false;
    function offerResume() {
        if (asked || !TV.pref("resumePrompt") || TV.osd.isOpen() || TV.detail.isOpen()) return;
        asked = true;
        var w = TV.load("lastWatch", null);
        if (!w || Date.now() - (w.at || 0) > 7 * 86400000) return;
        TV.save("lastWatch", null);                          // asked once
        var cat = D.catalog();
        if (w.kind === "vod") {
            var it = cat && (cat.movies.byId[w.item] || cat.series.byId[w.item]), r = it && D.resumeOf(w.key);
            if (!it || !r || r.done || r.pos < 60) return;
            var label = (it.title || it.name) + (r.epLabel ? " · " + r.epLabel : "");
            TV.alert({ title: T("Pick up where you left off?"), message: label + "\n" + T("Stopped at {t}", { t: TV.runtime(Math.max(1, Math.floor(r.pos / 60))) }) + (r.dur ? " · " + T("{n} min left", { n: Math.max(1, Math.round((r.dur - r.pos) / 60)) }) : ""),
                buttons: [
                    { label: T("Resume"), run: function () { if (it.kind === "movie") TV.detail.play(it, r.pos); else TV.detail.open(it, { resume: true }); } },
                    { label: T("Not Now") }
                ] });
        } else if (w.kind === "live") {
            var c = D.channel(w.id);
            if (!c) return;
            TV.alert({ title: T("Back to {name}?", { name: c.name }), message: T("The channel you were watching."),
                buttons: [{ label: T("Watch"), run: function () { TV.live.play(c); } }, { label: T("Not Now") }] });
        }
    }

    /* ---------- start-up ---------- */
    function boot() {
        TV.registerKeys();
        buildTabs();
        var bootMsg = TV.$("bootMsg");
        TV.pushNav(screen);
        TV.log("APL TV " + TV.VERSION + (global.TV_UPDATE && global.TV_UPDATE.fromBundle ? " (downloaded update, installed " + global.TV_UPDATE.installed + ")" : "") + " starting, " + (TV.PREVIEW ? "preview" : "screen") + ", avplay " + (TV.player.native ? "yes" : "no"));
        TV.heap("start");
        try { if (TV.DEV && navigator.storage && navigator.storage.estimate) navigator.storage.estimate().then(function (e) { TV.log("storage " + Math.round(e.usage / 1048576) + " MB used of " + Math.round(e.quota / 1048576) + " MB"); }); } catch (e) {}
        D.start(function (m) { bootMsg.textContent = m; }).then(function () {
            var hasData = D.sources().length && D.catalog() && (D.catalog().live.chans.length || D.catalog().movies.items.length);
            var tab = TV.pref("startTab") || "home";
            if (tab === "settings" || tab === "search" || !TV.views[tab]) tab = "home";
            go(hasData ? tab : "home", true);
            // the first start (or the first after this update): how to show the playlist, then the rest
            if (TV.pref("setupDone") !== 1 && TV.playlistSetup) setTimeout(function () { TV.playlistSetup(function () { if (hasData) setTimeout(offerResume, 800); }); }, 700);
            else if (hasData) setTimeout(offerResume, 1200);
            setTimeout(function () { TV.$("boot").classList.add("is-hidden"); document.body.classList.remove("is-booting"); global.TV_BOOT_OK = true; }, 150);
            readRequest();
            if (TV.voice) TV.voice.start();
            TV.heap("catalog loaded");
            setTimeout(function () { TV.epg.loadAll(); }, 1500);
        }, function (e) {
            TV.log("start failed: " + e.message);
            global.TV_BOOT_OK = true;
            go("home", true);
            TV.$("boot").classList.add("is-hidden");
        });
    }
    // Dev builds: start the helper early so the PC can read the log
    if (TV.DEV && !TV.PREVIEW) setTimeout(function () { TV.helper.start().catch(function () {}); }, 2000);
    /* Dev builds: smoothness meter. Every 10 s while keys are pressed: frames drawn, frames over 34 ms (a
       visible hitch at 60 Hz), the worst one, how long presses took to show, and the JavaScript memory. */
    if (TV.DEV) (function () {
        var last = 0, frames = 0, slow = 0, worst = 0, keys = [], active = 0, marks = [], causes = {}, slowList = [];
        TV.mark = function (name) { marks.push([Date.now(), name]); if (marks.length > 40) marks.shift(); };
        function frame(t) {
            if (last) {
                var d = t - last; frames++; if (d > worst) worst = d;
                if (d > 34) {
                    slow++;
                    var now = Date.now(), why = "idle";
                    for (var i = marks.length - 1; i >= 0; i--) if (now - marks[i][0] < d + 60) { why = marks[i][1]; break; }
                    causes[why] = (causes[why] || 0) + 1;
                    if (slowList.length < 30) slowList.push(Math.round(d) + why);
                }
            }
            last = t; requestAnimationFrame(frame);
        }
        requestAnimationFrame(frame);
        TV.perf = { key: function (ms) { keys.push(ms); active = Date.now(); } };
        var longN = 0, longMs = 0, longList = [], clockGap = Date.now() - performance.now();
        try {
            new PerformanceObserver(function (l) { l.getEntries().forEach(function (e) { longN++; longMs += e.duration; if (longList.length < 20) { var at = Math.round(e.startTime + clockGap - TV.keyAt), lastMark = ""; for (var q = marks.length - 1; q >= 0; q--) if (marks[q][0] <= e.startTime + clockGap + 5) { lastMark = marks[q][1] + (Math.round(e.startTime + clockGap - marks[q][0])); break; } longList.push(Math.round(e.duration) + "@" + at + "(" + lastMark + ")"); } }); }).observe({ entryTypes: ["longtask"] });
        } catch (e) { TV.log("no long task observer: " + e.message); }
        setInterval(function () {
            if (Date.now() - active < 11000 && keys.length) {
                var sum = 0, max = 0; keys.forEach(function (k) { sum += k; if (k > max) max = k; });
                var mem = global.performance && performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) + " MB" : "?";
                TV.log("perf: " + frames + " frames, " + slow + " slow, worst " + Math.round(worst) + " ms; " + keys.length + " keys, avg " + Math.round(sum / keys.length) + " ms, max " + max + " ms; slow after: " + JSON.stringify(causes) + " " + slowList.join(" ") + " | long tasks " + longN + " = " + Math.round(longMs) + " ms: " + longList.join(" "));
            }
            frames = slow = worst = 0; keys = []; causes = {}; slowList = []; longN = longMs = 0; longList = [];
        }, 10000);
    })();
    global.addEventListener("error", function (e) { TV.log("JS error: " + e.message + " @" + (e.filename || "").split("/").pop() + ":" + e.lineno); });
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})(window);
