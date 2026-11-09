/* ============================================================
   vod.js: Movies and Series.
   A row of categories at the top (New, Top Rated, My List, then the
   provider's, your language first), the covers below in 7 columns, with
   the IMDb rating on each cover as soon as it is known. OK opens the
   title's page, OK held adds it to My List.
   ============================================================ */
(function (global) {
    "use strict";

    var TV = global.TV, el = TV.el, esc = TV.esc, T = TV.t, D = TV.data, S = TV.smart;

    function make(kind, viewId) {
        var root, chipsEl, chipStrip, gridClip, countEl, grid, chips = [], chipEls = [], chipIndex = 0, chipScroll = 0, zone = "grid", visible = false, catId = null, loadTimer = null, dirty = true;
        var genreList = null, providerMode = false, coverStale = false;
        var SORTS = [["default", T("Default Order")], ["added", T("Recently Added")], ["az", T("A to Z")], ["year", T("Year, Newest First")], ["rating", T("Rating, Best First")]];
        var key = kind === "movies" ? "movies" : "series";

        function build() {
            root = TV.$(viewId);
            root.innerHTML = "";
            chipsEl = el("div", "vod__chips");
            chipStrip = el("div", "vod__chipstrip");
            chipsEl.appendChild(chipStrip);
            gridClip = el("div", "vod__grid");
            countEl = el("div", "vod__count");
            root.appendChild(chipsEl); root.appendChild(gridClip); root.appendChild(countEl);
            grid = new TV.Grid({ clip: gridClip, cols: 7, cw: 256, ch: 444, viewH: 820, make: TV.card.poster, onFocus: function (i, it) { bgFor(it); } });
        }
        var bgFor = TV.debounce(function (it) {
            return;                                     // fixed backdrop in the grid: smoother on the screen
            if (!visible || !it || zone !== "grid") return;
            if (it.backdrop) TV.bg(it.backdrop, "dark");
            TV.meta.lookup(it).then(function (m) { if (m && m.backdrop && grid.current() === it && visible) TV.bg(m.backdrop, "dark"); });
        }, 500);

        /* Genres (TMDB) after New, Top Rated and My List; the provider's own categories behind the last chip */
        function buildChips() {
            var cat = D.catalog(), adult = TV.pref("showAdult");
            var sort = sortNow(), sortName = sort === "default" ? T("Sort") : SORTS.filter(function (s) { return s[0] === sort; })[0][1];
            if (providerMode) {
                chips = [{ id: "sort", name: sortName }, { id: "back", name: "‹ " + T("Genres") }, { id: "all", name: T("All") }];
                (cat ? cat[key].cats : []).forEach(function (c) { if ((adult || !c.adult) && !c.off && !D.catNameHidden(c.name)) chips.push(c); });
            } else {
                chips = [{ id: "recent", name: T("New") }, { id: "top", name: T("Top Rated") }, { id: "mylist", name: T("My List") }];
                if (D.recentlyWatched(key).length) chips.push({ id: "watched", name: T("Recently Watched") });
                (genreList || []).forEach(function (g) { chips.push({ id: "g:" + g.id, name: g.name }); });
                chips.push({ id: "provider", name: T("Provider's Categories") + " ›" });
                chips.unshift({ id: "sort", name: sortName });
                if (!genreList) TV.meta.genres(kind === "movies" ? "movie" : "tv").then(function (l) { genreList = l; if (l.length && visible) { var keep = chips[chipIndex] && chips[chipIndex].id; buildChips(); selectChip(keep); paintChips(); } });
            }
            chipStrip.innerHTML = "";
            chipEls = chips.map(function (c) {
                var e = el("div", "chip" + (c.id === "sort" && sort !== "default" ? " is-on" : ""), (c.id === "sort" ? TV.icon("sort", 24) + "&nbsp;&nbsp;" : "") + (c.tag ? "<span class='lrow__flag'>" + esc(c.tag) + "</span>" : "") + esc(c.name) + (c.count ? "<span class='chip__n'>" + c.count + "</span>" : ""));
                chipStrip.appendChild(e);
                return e;
            });
            selectChip(TV.pref(key + "Cat") || "recent");
        }
        function selectChip(want) {
            // by default the first category: not Sort, not "‹ Genres" (that would leave the provider's categories)
            chipIndex = 0;
            while (chipIndex < chips.length - 1 && (chips[chipIndex].id === "sort" || chips[chipIndex].id === "back")) chipIndex++;
            for (var i = 0; i < chips.length; i++) if (chips[i].id === want && want !== "sort") { chipIndex = i; break; }
        }

        /* Sort (first chip): the same titles in another order, for every category. Remembered for Movies and Series apart. */
        function sortNow() { var s = TV.pref(key + "Sort"); return s && s !== "default" ? s : "default"; }
        function sorted(list) {
            var how = sortNow();
            if (how === "default" || list.length < 2) return list;
            var rows = list.map(function (x, i) {
                var v;
                if (how === "az") v = S.fold(x.title || x.name);
                else if (how === "year") v = x.year || (TV.meta.known(x) || {}).year || 0;
                else if (how === "rating") { var m = TV.meta.known(x); v = (m && parseFloat(m.imdb)) || x.rating || 0; }
                else v = x.added || 0;
                return { x: x, v: v, i: i };
            });
            rows.sort(how === "az" ? function (a, b) { return a.v < b.v ? -1 : a.v > b.v ? 1 : a.i - b.i; }
                                   : function (a, b) { return (b.v - a.v) || (a.i - b.i); });
            return rows.map(function (r) { return r.x; });
        }
        function chooseSort() {
            var cur = sortNow();
            TV.menu(T("Sort By"), SORTS.map(function (s) {
                return { label: s[1], check: s[0] === cur, run: function () {
                    TV.setPref(key + "Sort", s[0]);
                    buildChips(); chipIndex = 0;
                    load(catId); zone = "chips"; grid.setActive(false); paintChips();
                } };
            }));
        }
        function paintChips() {
            chipEls.forEach(function (e, i) {
                e.classList.toggle("is-focused", i === chipIndex && zone === "chips" && TV.shell.focusOn() === "view");
                e.classList.toggle("is-current", chips[i].id === catId);
            });
            var c = chipEls[chipIndex];
            if (c) TV.lift(c);
            if (c) {
                var x = c.offsetLeft, w = c.offsetWidth;
                if (x - chipScroll + w > 1700) chipScroll = x + w - 1700;
                if (x - chipScroll < 0) chipScroll = Math.max(0, x - 40);
                chipStrip.style.transform = "translateX(" + (-chipScroll) + "px)";
            }
        }
        function waiting(id) {
            if (String(id).indexOf("g:") === 0) return !D.genreReady(key, id.slice(2));
            return id === "top" && !D.topReady(key);
        }
        function load(id, keep) {
            if (id === "provider" || id === "back") {          // switch the chip row between genres and the provider's categories
                providerMode = id === "provider";
                buildChips(); paintChips();                // on All, or on New: never on Sort or "‹ Genres"
                id = chips[chipIndex].id;
            }
            keep = keep && id === catId && grid.items.length;
            if (id === "sort") return;
            catId = id;
            TV.setPref(key + "Cat", id);
            var items = sorted(D.itemsIn(key, id));
            if (keep) grid.update(items); else grid.set(items, 0);
            grid.setActive(zone === "grid" && TV.shell.focusOn() === "view");
            
            if (!items.length) {
                gridClip.querySelector(".vod__gridin").innerHTML = "<div class='empty' style='top:200px;width:1728px'><div class='empty__text'>" +
                    esc(emptyText(id)) + "</div></div>";
            }
            paintChips();
        }

        function emptyText(id) {
            if (id === "mylist") return T("Nothing here yet: hold OK on a title to add it to My List.");
            if (id === "watched") return T("What you watch will appear here.");
            var cat = D.catalog();
            if (cat && !cat[key].items.length) return kind === "movies" ? T("No movies came from your playlists yet. APL TV asks your provider again by itself.") : T("No series came from your playlists yet. APL TV asks your provider again by itself.");
            if (waiting(id)) return T("Finding these titles in your catalog…");
            return D.offCats() ? T("Nothing here. Some countries or categories are hidden: Settings, Countries and Categories.") : T("Nothing here.");
        }

        /* A genre (Netflix, Anime…) or Top Rated still being found in the background grows while you browse it:
           the new titles join once you stop pressing keys, and you stay on the title you were on
           (before, the whole list started over from the first title: "it keeps jumping up"). */
        var refreshJob = null;
        function refreshSoon() {
            TV.uncalm(refreshJob);
            refreshJob = TV.calm(function () {
                if (!visible) { dirty = true; return; }
                if (!grid.items.length) { load(catId); return; }        // was showing "Finding these titles…"
                grid.update(sorted(D.itemsIn(key, catId)));
            }, 1200);
        }

        /* keep: the same category drawn again (a title hidden, the playlist refreshed): you stay where you were */
        function render(keep) {
            dirty = false;
            if (!D.catalog() || !D.sources().length) {
                chipStrip.innerHTML = ""; grid.set([], 0);
                gridClip.querySelector(".vod__gridin").innerHTML = "<div class='empty' style='top:160px;width:1728px'><div class='empty__title'>" + esc(T("No playlist yet")) +
                    "</div><div class='empty__text'>" + esc(T("Add one in Settings.")) + "</div></div>";
                return;
            }
            buildChips();
            load(chips[chipIndex] ? chips[chipIndex].id : "recent", keep);
        }

        var view = {
            show: function () {
                if (!root) build();
                visible = true;
                if (dirty) render(true); else { paintChips(); if (coverStale) grid.refreshCard(grid.index); grid.draw(); }
                coverStale = false;
                TV.bg("", "dark");
            },
            hide: function () { visible = false; TV.meta.clearQueue(); TV.$("bg").classList.remove("is-dark"); },
            enter: function () { zone = grid.items.length ? "grid" : "chips"; paintChips(); grid.setActive(zone === "grid"); },
            blur: function () { grid.setActive(false); paintChips(); },
            key: function (code) {
                var K = TV.KEY;
                if (zone === "chips") {
                    if (code === K.LEFT || code === K.RIGHT) {
                        var n = chipIndex + (code === K.LEFT ? -1 : 1);
                        if (n < 0 || n >= chips.length) { TV.sound.edge(); return true; }
                        // moving along the row opens nothing: the category you are on stays until OK or Down
                        // (before, each category passed loaded itself, so going back to Sort left yours)
                        chipIndex = n; TV.sound.tick(); paintChips();
                        return true;
                    }
                    if (code === K.DOWN) {
                        var c = chips[chipIndex];
                        if (c && c.id !== "sort" && c.id !== catId) load(c.id);
                        if (grid.items.length) { zone = "grid"; TV.sound.tick(); paintChips(); grid.setActive(true); } else TV.sound.edge();
                        return true;
                    }
                    if (code === K.UP) return false;
                    return true;
                }
                var dir = { 37: "left", 38: "up", 39: "right", 40: "down" }[code];
                if (!dir) return false;
                if (!grid.move(dir)) {
                    if (dir === "up") { zone = "chips"; TV.sound.tick(); grid.setActive(false); paintChips(); }
                    else TV.sound.edge();
                }
                return true;
            },
            ok: function () {
                if (zone === "chips" && chips[chipIndex] && chips[chipIndex].id === "sort") { clearTimeout(loadTimer); chooseSort(); return; }
                if (zone === "chips") { clearTimeout(loadTimer); load(chips[chipIndex].id); if (grid.items.length) { zone = "grid"; grid.setActive(true); paintChips(); } return; }
                var it = grid.current();
                if (it) TV.detail.open(it);
            },
            canHold: function () { return zone === "grid" ? !!grid.current() : zone === "chips" && !!(chips[chipIndex] && chips[chipIndex].kind); },
            longOk: function () {
                if (zone === "chips") {             // OK held on one of the provider's categories: hide it, or its whole country
                    TV.categoryMenu(chips[chipIndex], function () {
                        var i = chipIndex; buildChips(); chipIndex = Math.min(i, chips.length - 1); load(chips[chipIndex].id); zone = "chips"; paintChips();
                    });
                    return;
                }
                var it = grid.current();
                TV.titleMenu(it, function () { load(catId, true); grid.refreshCard(grid.index); grid.draw(); });
            },
            invalidate: function () { dirty = true; if (visible) render(true); }
        };
        D.onChange(function (w) {
            if (w === "catalog" || w === "hidden") view.invalidate();
            else if (w === "resume") { if (catId === "watched") dirty = true; else coverStale = true; }
            else if ((w === "top" && catId === "top") || (w === "genre" && String(catId).indexOf("g:") === 0)) { if (visible) refreshSoon(); else dirty = true; }
        });
        return view;
    }

    TV.views = TV.views || {};
    TV.views.movies = make("movies", "v-movies");
    TV.views.series = make("series", "v-series");
})(window);
