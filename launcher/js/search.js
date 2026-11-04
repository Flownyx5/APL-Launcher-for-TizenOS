/* ============================================================
   search.js — universal search, as on Apple TV.

   Type a few letters (on-screen keyboard, the remote's numbers, a
   keyboard, or the phone remote): the installed apps that match, then
   the films and series (TMDB). OK on a title: where it can be watched
   in France right now (subscription, free, rental, purchase) and a
   button for each service installed on the screen, which opens it.
   The apps don't accept a title from outside: the launcher opens the
   right app, the title is shown so it can be found there in one search.
   Needs the TMDB key for films and series (the apps work without it).
   ============================================================ */
(function (global) {
    "use strict";

    var APL = global.APL, sys = APL.sys;
    var KEYS = global.APL_KEYS || {};
    var TMDB = "https://api.themoviedb.org/3", IMG = "https://image.tmdb.org/t/p/";
    var REGION = "FR";
    /* TMDB (JustWatch) provider ids of the services in the launcher's catalogue */
    var PROVIDER_KEY = { 8: "netflix", 1796: "netflix", 119: "primevideo", 9: "primevideo", 337: "disneyplus", 350: "appletv", 2: "appletv",
                         531: "paramountplus", 283: "crunchyroll", 35: "rakutentv", 300: "plutotv", 381: "canalplus", 1899: "hbomax",
                         234: "arte", 1754: "tf1plus", 147: "m6plus", 188: "youtube", 192: "youtube" };

    var root, queryEl, kbEl, appsRow, resRow, noteEl, nav, isOpen = false;
    var sheet, sheetNav, sheetOpen = false;
    var query = "", timer = null, token = 0, cache = {};

    function el(tag, cls, html) { var e = document.createElement(tag); e.className = cls; if (html) e.innerHTML = html; return e; }
    function norm(s) {
        s = String(s || "").toLowerCase();
        if (s.normalize) s = s.normalize("NFD").replace(/[̀-ͯ]/g, "");
        return s.replace(/\+/g, " plus ").replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
    }
    function getJson(url) {
        return global.fetch(url).then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); });
    }

    /* ---------- the keyboard ---------- */
    var ROWS = ["abcdefghijklm", "nopqrstuvwxyz", "1234567890"];
    function buildKeyboard() {
        var keys = [];
        ROWS.forEach(function (r, ri) {
            var row = el("div", "srch__kbrow");
            r.split("").forEach(function (ch) {
                var k = el("div", "srch__key");
                k.textContent = ch;
                k._ch = ch;
                row.appendChild(k); keys.push(k);
            });
            if (ri === 2) {
                [["space", APL.t("Space"), " "], ["del", APL.icon("backspace", 34, 2), "\b"], ["clear", APL.t("Clear"), "\x18"]].forEach(function (s) {
                    var k = el("div", "srch__key srch__key--" + s[0]);
                    k.innerHTML = s[1];
                    k._ch = s[2];
                    row.appendChild(k); keys.push(k);
                });
            }
            kbEl.appendChild(row);
        });
        return keys;
    }

    function type(ch) {
        if (ch === "\b") query = query.slice(0, -1);
        else if (ch === "\x18") query = "";
        else if (query.length < 40) query += ch;
        paintQuery();
        clearTimeout(timer);
        timer = setTimeout(run, 380);
        showApps();
    }
    function paintQuery() {
        queryEl.textContent = query || APL.t("Apps, films, series…");
        queryEl.classList.toggle("is-empty", !query);
    }

    /* ---------- apps that match ---------- */
    function appsMatching(q) {
        q = norm(q);
        if (!q) return [];
        var list = (APL.allApps ? APL.allApps() : []).filter(function (a) { return !a.folder; });
        var scored = [];
        list.forEach(function (a) {
            var n = norm(a.name), s = n.indexOf(q) === 0 ? 3 : (" " + n).indexOf(" " + q) !== -1 ? 2 : n.indexOf(q) !== -1 ? 1 : 0;
            if (s) scored.push({ a: a, s: s });
        });
        return scored.sort(function (x, y) { return y.s - x.s; }).slice(0, 6).map(function (x) { return x.a; });
    }
    var appTiles = [];
    function showApps() {
        appsRow.innerHTML = "";
        appTiles = appsMatching(query).map(function (a) {
            var t = APL.makeTile(a, 1);
            t.classList.add("srch__app");
            t._app = a;
            appsRow.appendChild(t);
            return t;
        });
        appsRow.parentNode.classList.toggle("is-empty", !appTiles.length);
        retile();
    }

    /* ---------- films and series ---------- */
    var resTiles = [];
    function run() {
        var q = query.trim(), my = ++token;
        if (q.length < 2) { resRow.innerHTML = ""; resTiles = []; note(""); retile(); return; }
        if (!KEYS.tmdb) { note(APL.t("Add a TMDB key in APL Launcher Setup to search films and series too.")); return; }
        var hit = cache[q];
        (hit ? Promise.resolve(hit) : getJson(TMDB + "/search/multi?api_key=" + KEYS.tmdb + "&language=" + APL.locale +
                "&include_adult=false&query=" + encodeURIComponent(q)).then(function (j) {
            var list = (j.results || []).filter(function (r) { return (r.media_type === "movie" || r.media_type === "tv") && r.poster_path; }).slice(0, 12);
            cache[q] = list;
            return list;
        })).then(function (list) {
            if (my !== token || !isOpen) return;
            resRow.innerHTML = "";
            resTiles = list.map(function (r) {
                var c = el("div", "srch__res");
                c._r = r;
                var pic = el("div", "srch__poster");
                pic.style.backgroundImage = "url('" + IMG + "w185" + r.poster_path + "')";
                var name = el("div", "srch__title");
                name.textContent = r.title || r.name;
                var year = String(r.release_date || r.first_air_date || "").slice(0, 4);
                var meta = el("div", "srch__meta");
                meta.textContent = (r.media_type === "tv" ? APL.t("Series") : APL.t("content|Movie")) + (year ? " · " + year : "");
                c.appendChild(pic); c.appendChild(name); c.appendChild(meta);
                resRow.appendChild(c);
                return c;
            });
            note(list.length ? "" : APL.t("No film or series found for “{q}”.", { q: q }));
            retile();
        }, function () { if (my === token) note(APL.t("TMDB is not answering. Check the network.")); });
    }
    function note(t) { noteEl.textContent = t; noteEl.style.display = t ? "" : "none"; }

    function retile() {
        if (!nav) return;
        var cur = nav.current(), all = keyTiles.concat(appTiles, resTiles);
        var keep = all.indexOf(cur);
        nav.tiles.forEach(function (t) { t.classList.remove("is-focused"); });
        nav.tiles = all;
        nav.index = -1;
        nav.focus(keep !== -1 ? keep : Math.min(lastKey, keyTiles.length - 1));
    }

    /* ---------- where to watch ---------- */
    function installedFor(p) {
        var key = PROVIDER_KEY[p.provider_id], pn = norm(p.provider_name).replace(/ (with ads|basic with ads|standard with ads)$/, "");
        var apps = (APL.allApps ? APL.allApps() : []).filter(function (a) { return !a.folder && (!a.virtual || a.web); });
        for (var i = 0; i < apps.length; i++) {
            var a = apps[i], an = norm(a.name);
            if ((key && a.key === key) || (a.tmdbProvider && a.tmdbProvider === p.provider_id)) return a;
            if (an && (an === pn || pn.indexOf(an + " ") === 0 || an.indexOf(pn + " ") === 0 || pn === "amazon " + an)) return a;
        }
        return null;
    }

    function providers(r) {
        return getJson(TMDB + "/" + r.media_type + "/" + r.id + "/watch/providers?api_key=" + KEYS.tmdb).then(function (j) {
            var fr = (j.results || {})[REGION] || {}, seen = {}, out = [];
            [["flatrate", APL.t("Subscription")], ["free", APL.t("Free")], ["ads", APL.t("Free with ads")], ["rent", APL.t("Rent")], ["buy", APL.t("Buy")]].forEach(function (k) {
                (fr[k[0]] || []).forEach(function (p) {
                    var app = installedFor(p), id = app ? app.id : "p" + p.provider_id;
                    if (seen[id]) return;
                    seen[id] = true;
                    out.push({ p: p, kind: k[1], app: app });
                });
            });
            // The services installed here first
            return out.sort(function (a, b) { return (b.app ? 1 : 0) - (a.app ? 1 : 0); });
        });
    }

    function openSheet(r) {
        if (!sheet) buildSheet();
        var title = r.title || r.name, year = String(r.release_date || r.first_air_date || "").slice(0, 4);
        sheet.querySelector(".srch__sbg").style.backgroundImage = r.backdrop_path ? "url('" + IMG + "w1280" + r.backdrop_path + "')" : "none";
        sheet.querySelector(".srch__stitle").textContent = title;
        var rating = r.vote_count >= 20 ? " · ★ " + (Math.round(r.vote_average * 10) / 10).toString().replace(".", APL.lang === "fr" ? "," : ".") : "";
        sheet.querySelector(".srch__smeta").textContent = (r.media_type === "tv" ? APL.t("Series") : APL.t("content|Movie")) + (year ? " · " + year : "") + rating;
        sheet.querySelector(".srch__sover").textContent = r.overview || "";
        var row = sheet.querySelector(".srch__chips");
        row.innerHTML = '<div class="srch__wait">' + APL.t("Looking for where to watch it…") + "</div>";
        sheet.classList.add("is-open");
        sheetOpen = true;
        APL.pushNav(sheetNav);
        sheetNav.setTiles([]);
        providers(r).then(function (list) {
            if (!sheetOpen) return;
            row.innerHTML = "";
            var tiles = [];
            if (!list.length) row.innerHTML = '<div class="srch__wait">' + APL.t("Not available to stream in France right now.") + "</div>";
            list.slice(0, 9).forEach(function (x) {
                var c = el("div", "srch__chip" + (x.app ? " is-installed" : ""));
                var logo = el("span", "srch__chiplogo");
                if (x.p.logo_path) logo.style.backgroundImage = "url('" + IMG + "w92" + x.p.logo_path + "')";
                var txt = el("span", "srch__chiptxt");
                var name = el("b", ""); name.textContent = x.app ? APL.t("Open {app}", { app: x.app.name }) : x.p.provider_name;
                var sub = el("i", ""); sub.textContent = x.kind + (x.app ? "" : " · " + APL.t("not installed"));
                txt.appendChild(name); txt.appendChild(sub);
                c.appendChild(logo); c.appendChild(txt);
                row.appendChild(c);
                if (x.app) { c._go = { app: x.app, title: title }; tiles.push(c); }
            });
            sheetNav.setTiles(tiles);
        }, function () { if (sheetOpen) row.innerHTML = '<div class="srch__wait">' + APL.t("TMDB is not answering. Check the network.") + "</div>"; });
    }
    function closeSheet() {
        if (!sheetOpen) return;
        sheetOpen = false;
        sheet.classList.remove("is-open");
        APL.popNav(sheetNav);
    }
    function buildSheet() {
        sheet = el("div", "srch__sheet",
            '<div class="srch__sbg"></div><div class="srch__sshade"></div>' +
            '<div class="srch__sbody"><div class="srch__stitle"></div><div class="srch__smeta"></div><div class="srch__sover"></div>' +
            '<div class="srch__swhere">' + APL.t("Where to watch") + '</div><div class="srch__chips"></div></div>');
        root.appendChild(sheet);
        sheetNav = new APL.Nav({
            onSelect: function (i, c) {
                var go = c._go;
                close();
                APL.toast(APL.t("“{title}” is on {app}: search for it there", { title: go.title, app: go.app.name }));
                APL.openApp(go.app);
            },
            onBack: closeSheet
        });
    }

    /* ---------- the screen ---------- */
    var keyTiles = [], lastKey = 0;
    function buildDom() {
        root = el("section", "srch");
        var head = el("div", "srch__head");
        head.appendChild(el("span", "srch__glyph", APL.icon("search", 54, 2.2)));
        queryEl = el("div", "srch__query");
        head.appendChild(queryEl);
        root.appendChild(head);
        kbEl = el("div", "srch__kb");
        root.appendChild(kbEl);
        var appsBox = el("div", "srch__block srch__block--apps is-empty");
        appsBox.appendChild(el("div", "srch__label", APL.t("Apps")));
        appsRow = el("div", "srch__apps");
        appsBox.appendChild(appsRow);
        root.appendChild(appsBox);
        var resBox = el("div", "srch__block");
        resBox.appendChild(el("div", "srch__label", APL.t("Films and series")));
        noteEl = el("div", "srch__note");
        resBox.appendChild(noteEl);
        resRow = el("div", "srch__results");
        resBox.appendChild(resRow);
        root.appendChild(resBox);
        document.body.appendChild(root);
        keyTiles = buildKeyboard();
        nav = new APL.Nav({
            crossWeight: 2,
            onFocus: function (i, t) {
                if (t._ch !== undefined) lastKey = keyTiles.indexOf(t);
                // The results row follows the focus sideways
                if (t._r) {
                    var x = Math.min(0, 640 - t.offsetLeft);
                    resRow.style.transform = "translateX(" + x + "px)";
                }
            },
            onSelect: function (i, t) {
                if (t._ch !== undefined) { type(t._ch); return; }
                if (t._app) { var a = t._app; close(); if (APL.zoomOpen && !a.virtual) APL.zoomOpen(t, a); APL.openApp(a); return; }
                if (t._r) openSheet(t._r);
            },
            onBack: function () {
                if (query) { type("\x18"); return; }
                close();
            },
            onKey: function (code, e) {
                // A real keyboard (Bluetooth, PC, phone) or the remote's numbers: typed straight in
                var ch = e && e.key && e.key.length === 1 ? e.key.toLowerCase() : "";
                if (ch && /[a-z0-9 àâäéèêëîïôöùûüç'-]/.test(ch)) { type(ch); return true; }
                if (code === 8 && query) { type("\b"); return true; }
                return false;
            }
        });
    }

    function open(text) {
        if (APL.kids && APL.kids.active()) { APL.toast(APL.t("Search is off in Kids Mode")); return; }
        if (!root) buildDom();
        if (APL.controlCenter && APL.controlCenter.isOpen()) APL.controlCenter.close();
        if (!isOpen) {
            isOpen = true;
            root.classList.add("is-open");
            document.body.classList.add("has-search");
            APL.pushNav(nav);
        }
        query = typeof text === "string" ? text.toLowerCase().slice(0, 40) : "";
        paintQuery();
        showApps();
        run();
        nav.focus(Math.min(lastKey, keyTiles.length - 1));
    }
    function close() {
        if (!isOpen) return;
        closeSheet();
        isOpen = false;
        root.classList.remove("is-open");
        document.body.classList.remove("has-search");
        APL.popNav(nav);
    }

    /* From the Home Screen: the blue key, or a letter typed on a keyboard, opens the search. */
    APL.addHotkey(function (code, e) {
        if (isOpen || !APL.homeNav || (APL.topNav && APL.topNav() !== APL.homeNav)) return false;
        if (APL.screensaver && APL.screensaver.isActive()) return false;
        if (code === APL.KEY.BLUE) { open(""); return true; }
        if (e && e.key && e.key.length === 1 && /[a-z]/i.test(e.key) && !(sys.PREVIEW && /^[cC]$/.test(e.key))) { open(e.key); return true; }
        return false;
    });

    APL.search = { open: open, close: close, isOpen: function () { return isOpen; }, type: function (t) { if (!isOpen) open(t); else { query = ""; String(t).split("").forEach(type); } } };
})(window);
