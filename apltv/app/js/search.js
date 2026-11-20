/* ============================================================
   search.js: search across channels, movies and series, tvOS style.
   OK on the field opens the TV's own keyboard (Samsung's, LG's, Gboard),
   results as you type: channels first, then movies, then series. Accents
   and case do not matter ("cine" finds "Ciné+"). With a Stremio account,
   the Movies and Series rows also get the titles TMDB finds in your
   language that your addons play (checked as they come).
   ============================================================ */
(function (global) {
    "use strict";

    var TV = global.TV, el = TV.el, esc = TV.esc, T = TV.t, D = TV.data;
    var root, field, results, resIn, strips = [], zone = "field", query = "", visible = false, first = "";

    function build() {
        root = TV.$("v-search");
        root.innerHTML = "";
        field = el("div", "search__field");
        results = el("div", "search__results");
        resIn = el("div", "search__in");
        results.appendChild(resIn);
        root.appendChild(field); root.appendChild(results);
        drawField();
    }
    /* The TV's own keyboard (Gboard, Samsung's, LG's): what you type there searches as you type */
    function tvKeyboard() {
        var before = query;
        TV.editText({ value: query,
            onInput: function (v) { query = String(v || "").slice(0, 60); drawField(); runSoon(); },
            // done: straight into the results
            onDone: function (v) { query = String(v || "").slice(0, 60); drawField(); run(); if (strips.length) zone = 0; paint(); },
            onCancel: function () { query = before; drawField(); run(); paint(); } });
    }
    function drawField() {
        field.innerHTML = TV.icon("search", 36) + "<span>" + (query ? "<bdi>" + esc(query) + "</bdi>" : "<span class='search__ph'>" + esc(T("Channels, movies, series")) + "</span>") + "<i class='caret'></i></span>";
    }
    /* A real keyboard (PC, Bluetooth) types into the field too */
    function type(k) {
        if (k === "del") query = query.slice(0, -1);
        else if (k === "clear") query = "";
        else if (k === "space") { if (query && query.slice(-1) !== " ") query += " "; }
        else query += k;
        drawField();
        runSoon();
    }
    var runSoon = TV.debounce(run, 280), asked = 0;
    function run() {
        resIn.innerHTML = ""; strips = [];
        var my = ++asked;
        if (query.trim().length < 2) {
            if (!query) resIn.innerHTML = "<div class='empty' style='top:110px'><div class='empty__text'>" + esc(T("Type at least two letters.")) + "</div></div>";
            return;
        }
        var r = D.search(query, 40);
        function add(title, items, kind, what) {
            if (!items.length) return null;
            var s = new TV.Strip({ title: title, items: items.slice(), kind: kind, height: kind === "channel" ? 290 : 440,
                make: function (it) { return kind === "channel" ? TV.card.channel(it) : TV.card.poster(it); } });
            s.kindOf = kind; s.what = what;
            strips.push(s); resIn.appendChild(s.root);
            return s;
        }
        // Asked by voice for movies (or series, or channels): that row comes first
        var rows = [[T("Channels"), r.live, "channel", "live"], [T("Movies"), r.movies, "poster", "movies"], [T("Series"), r.series, "poster", "series"]];
        if (first) rows = rows.filter(function (x) { return x[3] === first; }).concat(rows.filter(function (x) { return x[3] !== first; }));
        rows.forEach(function (x) { add(x[0], x[1], x[2], x[3]); });
        if (!strips.length) resIn.innerHTML = "<div class='empty' style='top:110px'><div class='empty__text'>" + esc(T("No results for “{q}”", { q: query })) + "</div></div>";
        TV.epg.ensure(r.live.slice(0, 12));
        remote(my);
    }
    /* With a Stremio account: the titles TMDB finds in your language that your playlists miss and your addons play
       join the Movies and Series rows (one row each, not a row of their own), as the addons are asked */
    var lastRemote = null;
    function remote(my) {
        lastRemote = null;
        if (!TV.stremio || !TV.stremio.account() || !TV.meta.enabled()) return;
        var q = query;
        TV.meta.searchTitles(q).then(function (list) {
            if (my !== asked) return;
            lastRemote = { my: my, list: list };
            // these first in the addons' queue: they are on the screen
            var soon = TV.debounce(mergeRemote, 250);
            list.forEach(function (x) { TV.stremio.wantHas(x.kind === "series" ? "series" : "movie", x.id, function (v) { if (v) soon(); }, true); });
            mergeRemote();
        });
    }
    function mergeRemote() {
        var lr = lastRemote;
        if (!lr || lr.my !== asked) return;
        ["movies", "series"].forEach(function (kind) {
            var list = lr.list.filter(function (x) { return x.kind === kind; });
            if (!list.length) return;
            D.findTitles(kind, list).then(function (found) {
                if (lr.my !== asked || !found.length) return;
                var s = strips.filter(function (x) { return x.what === kind; })[0], have = {};
                (s ? s.items : []).forEach(function (x) { have[x.id] = 1; have["k" + D.versionKey(x)] = 1; });
                var fresh = found.filter(function (x) { return !have[x.id] && !have["k" + D.versionKey(x)]; });
                if (!fresh.length) return;
                if (s) { fresh.forEach(function (x) { s.items.push(x); }); s.lazy(); return; }
                // the row is new: in its place (channels, movies, series)
                var cur = typeof zone === "number" ? strips[zone] : null;
                if (!strips.length) resIn.innerHTML = "";
                var ns = new TV.Strip({ title: kind === "series" ? T("Series") : T("Movies"), items: fresh, kind: "poster", height: 440, make: function (it) { return TV.card.poster(it); } });
                ns.kindOf = "poster"; ns.what = kind;
                var order = { live: 0, movies: 1, series: 2 };
                strips.push(ns);
                strips.sort(function (x, y) { return order[x.what] - order[y.what]; });
                var at = strips.indexOf(ns);
                if (at + 1 < strips.length) resIn.insertBefore(ns.root, strips[at + 1].root); else resIn.appendChild(ns.root);
                if (cur) zone = strips.indexOf(cur);
                paint();
            });
        });
    }
    // your addons were found to play more titles: they join the rows of the search on the screen
    D.onChange(function (w) { if (w === "virtual" && visible && lastRemote) mergeRemote(); });
    /* The results fill the whole screen under the field: the list inside moves, never the frame, so nothing
       is cut at the bottom. In the results the keyboard steps aside, the field goes up, the tab bar hides. */
    function paint() {
        var active = TV.shell.focusOn() === "view";
        var si = typeof zone === "number" ? zone : -1;
        strips.forEach(function (s, i) { s.setActive(active && i === si); s.root.classList.toggle("is-above", si >= 0 && i < si); });
        field.classList.toggle("is-focused", zone === "field" && active);
        root.classList.toggle("is-results", si >= 0);
        document.body.classList.toggle("in-results", si >= 0 && visible);
        var y = 0;
        if (si >= 0) y = 170 - 290 - (strips[si].root.offsetTop - strips[0].root.offsetTop);
        resIn.style.transform = "translateY(" + y + "px)";
    }

    var view = {
        show: function () { if (!root) build(); visible = true; TV.bg("", "dark"); paint(); },
        hide: function () { visible = false; TV.$("bg").classList.remove("is-dark"); document.body.classList.remove("in-results"); },
        enter: function () { zone = "field"; paint(); },
        blur: function () { paint(); },
        key: function (code) {
            var K = TV.KEY;
            if (code >= 65 && code <= 90) { type(String.fromCharCode(code + 32)); return true; }          // a real keyboard (PC, Bluetooth)
            if (code >= 48 && code <= 57) { type(String.fromCharCode(code)); return true; }
            if (code === 32) { type("space"); return true; }
            if (code === 8) { type("del"); return true; }
            if (zone === "field") {
                if (code === K.UP) return false;
                if (code === K.DOWN) { if (strips.length) { zone = 0; TV.sound.tick(); paint(); } else TV.sound.edge(); return true; }
                return code === K.LEFT || code === K.RIGHT;
            }
            var s = strips[zone];
            if (code === K.LEFT || code === K.RIGHT) { if (!s.move(code === K.LEFT ? -1 : 1)) TV.sound.edge(); return true; }
            if (code === K.UP) { if (zone === 0) zone = "field"; else zone--; TV.sound.tick(); paint(); return true; }
            if (code === K.DOWN) { if (zone < strips.length - 1) { zone++; TV.sound.tick(); paint(); } else TV.sound.edge(); return true; }
            if (TV.isBack(code)) { zone = "field"; paint(); return true; }
            return false;
        },
        ok: function () {
            if (zone === "field") { tvKeyboard(); return; }
            var s = strips[zone], it = s.current();
            if (!it) return;
            if (s.kindOf === "channel") TV.live.play(it, s.items); else TV.detail.open(it);
        },
        backHandled: function () { if (zone !== "field") { zone = "field"; paint(); return true; } return false; },
        canHold: function () { return typeof zone === "number" && strips[zone] && !!strips[zone].current(); },
        longOk: function () {
            var s = strips[zone], it = s && s.current();
            if (!it) return;
            if (s.kindOf === "channel") {
                var fav = D.isFav(it.id);
                TV.menu(it.name, [{ label: fav ? T("Remove from Favorites") : T("Add to Favorites"), icon: fav ? "starLine" : "star", run: function () { D.toggleFav(it.id); } },
                    TV.channelHideItem(it, function () { run(); paint(); })]);
            } else TV.titleMenu(it, function () { run(); paint(); });
        }
    };

    /* A search asked by voice ("search Dragon Ball movies"): the words typed in, the results shown at once
       with the asked kind first, the focus on the first result, ready to choose */
    function ask(q, kind) {
        if (!root) build();
        query = String(q || "").toLowerCase().slice(0, 60);
        first = kind || "";
        drawField();
        run();
        first = "";
        zone = strips.length ? 0 : "field";
        paint();
    }

    TV.views = TV.views || {};
    TV.views.search = view;
    TV.search = { ask: ask };
})(window);
