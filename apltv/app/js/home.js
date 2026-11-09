/* ============================================================
   home.js: Home, Apple TV / Netflix style.
   A large featured title at the top (backdrop, logo, IMDb rating, plot,
   Play / More Info; a new one every 10 s), then rows: Continue Watching,
   Favorite Channels (what's on now), My List, Trending (this week),
   New Movies and Series (out this year or last year), Top Rated.
   The backdrop follows the title you are on.
   ============================================================ */
(function (global) {
    "use strict";

    var TV = global.TV, el = TV.el, esc = TV.esc, T = TV.t, D = TV.data;
    var HOME_GENRES = [{ kind: "movies", id: 28 }, { kind: "movies", id: 35 }, { kind: "series", id: 18 }, { kind: "series", id: "x:anime" }, { kind: "movies", id: 53 },
                       { kind: "movies", id: 878 }, { kind: "series", id: "x:kdrama" }, { kind: "movies", id: 16 }, { kind: "series", id: 35 }, { kind: "movies", id: 27 },
                       { kind: "series", id: "x:netflix" }, { kind: "movies", id: "x:anime" }];
    var genreNames = {}, genresAsked = false;
    var root, page, heroEl, rowsEl, heroNav, strips = [], zone = -1, featured = [], heroIndex = 0, heroTimer = null, visible = false, dirty = true;

    function build() {
        root = TV.$("v-home");
        root.innerHTML = "";
        page = el("div", "home");
        heroEl = el("div", "hero");
        rowsEl = el("div", "rows");
        page.appendChild(heroEl); page.appendChild(rowsEl);
        root.appendChild(page);
    }

    function empty() {
        page.innerHTML = "";
        var e = el("div", "empty");
        e.style.top = "300px";
        e.innerHTML = "<div class='empty__title'>" + esc(T("Welcome to APL TV")) + "</div><div class='empty__text'>" +
            esc(T("Add your M3U playlist or your Xtream account: scan a QR code with your phone, or type it with the remote.")) + "</div>";
        var b1 = el("div", "btn btn--primary", TV.icon("phone", 30) + esc(T("Add from Your Phone")));
        var b2 = el("div", "btn", TV.icon("keyboard", 30) + esc(T("Use the Remote")));
        e.appendChild(b1); e.appendChild(b2);
        page.appendChild(e);
        heroNav = new TV.Nav({ onSelect: function (i) { if (i === 0) TV.setup.phone(); else TV.setup.remote(); } });
        heroNav.setTiles([b1, b2]);
        heroNav.blur();
        strips = [];
        TV.bg("");
    }

    /* ---------- featured ----------
       What everyone watches this week (TMDB's trending titles found in your catalog), two movies for one
       series. Until that list is known (or without a TMDB key): the new releases of your catalog. The
       label says which, so a 2015 movie is never called new. Hidden categories, themes, titles and adult
       content are left out (data.js). */
    var why = {};
    function interleave(m, s, tag) {
        var out = [];
        for (var i = 0; i < Math.max(m.length, s.length); i++) { if (m[i]) out.push(m[i]); if (s[i] && out.length % 3 === 2) out.push(s[i]); }
        out.forEach(function (x) { why[x.id] = tag; });
        return out;
    }
    function pickFeatured() {
        why = {};
        var out = interleave(D.itemsIn("movies", "trend").slice(0, 12), D.itemsIn("series", "trend").slice(0, 8), "trend");
        if (out.length < 6) out = out.concat(interleave(D.itemsIn("movies", "new").slice(0, 12), D.itemsIn("series", "new").slice(0, 8), "new").filter(function (x) { return out.indexOf(x) < 0; }));
        // titles already known to have an adult rating stay out of the banner (see TV.meta.bannerSafe)
        return out.filter(function (x) { return !TV.meta.bannerKnown || TV.meta.bannerKnown(x) !== false; }).slice(0, 12);
    }
    /* The backdrop of a banner title, only once its rating is known to be fine; an adult-rated one leaves */
    function heroBg(item, url) {
        if (!TV.meta.bannerSafe) { if (url) TV.bg(url); return; }
        TV.meta.bannerSafe(item).then(function (ok) {
            if (!ok) { dropFeatured(item); return; }
            if (url && visible && zone === -1 && featured[heroIndex] === item) TV.bg(url);
        });
    }
    function dropFeatured(item) {
        var i = featured.indexOf(item);
        if (i < 0) return;
        featured.splice(i, 1);
        if (!featured.length) { dirty = true; if (visible) render(); return; }
        if (heroIndex >= featured.length) heroIndex = 0;
        if (i === heroIndex || heroIndex >= featured.length) drawHero(featured[heroIndex]);
    }
    function kickerOf(item) {
        var s = item.kind === "series";
        if (why[item.id] === "trend") return s ? T("Trending Show") : T("Trending Movie");
        return s ? T("New Series") : T("New Movie");
    }
    function drawHero(item) {
        heroEl.innerHTML = "";
        if (!item) return;
        var kicker = el("div", "hero__kicker", esc(kickerOf(item)));
        var title = el("div", "hero__title", esc(item.title || item.name));
        var meta = el("div", "hero__meta", item.year ? "<span>" + item.year + "</span>" : "");
        var desc = el("div", "hero__desc", esc(item.plot || ""));
        var btns = el("div", "hero__btns");
        var r = D.resumeOf(item.id);
        var play = el("div", "btn btn--primary", TV.icon("play", 28) + esc(r && r.pos > 60 ? T("Resume") : (item.kind === "series" ? T("Episodes") : T("Play"))));
        var more = el("div", "btn", TV.icon("info", 28) + esc(T("More Info")));
        btns.appendChild(play); btns.appendChild(more);
        [kicker, title, meta, desc, btns].forEach(function (n) { heroEl.appendChild(n); });
        var dots = el("div", "hero__dots");
        featured.forEach(function (f, i) { dots.appendChild(el("i", i === heroIndex ? "is-on" : "")); });
        heroEl.appendChild(dots);
        heroNav = new TV.Nav({ onSelect: function (i) { if (i === 0 && item.kind === "movie") TV.detail.play(item); else TV.detail.open(item); } });
        heroNav.setTiles([play, more], heroNav && zone === -1 ? 0 : 0);
        if (zone !== -1) heroNav.blur();
        heroBg(item, item.backdrop);
        TV.meta.lookup(item).then(function (m) {
            if (!m || featured[heroIndex] !== item) return;
            if (m.logo) { var im = el("img", "hero__logo"); im.src = m.logo; im.onload = function () { if (title.parentNode) title.parentNode.replaceChild(im, title); }; }
            var bits = [];
            if (m.imdb) bits.push(TV.meta.imdbBadge(m.imdb));
            if (m.year || item.year) bits.push("<span>" + (m.year || item.year) + "</span>");
            if (m.genres.length) bits.push("<span>" + esc(m.genres.slice(0, 2).join(", ")) + "</span>");
            if (m.runtime && item.kind === "movie") bits.push("<span>" + esc(TV.runtime(m.runtime)) + "</span>");
            if (m.seasons) bits.push("<span>" + esc(m.seasons > 1 ? T("{n} seasons", { n: m.seasons }) : T("1 season")) + "</span>");
            meta.innerHTML = bits.join("<span class='dot'></span>");
            TV.meta.certs(item.kind === "series" ? "tv" : "movie", m.tmdbId).then(function (c) {
                var age = TV.meta.certBadge(c);
                if (age && featured[heroIndex] === item) meta.innerHTML = [age].concat(bits).join("<span class='dot'></span>");
            });
            if (m.overview) desc.textContent = m.overview;
            if (m.backdrop) heroBg(item, m.backdrop);
        });
    }
    function rotate() {
        clearInterval(heroTimer);
        heroTimer = setInterval(function () {
            if (!visible || zone !== -1 || !featured.length || TV.topNav() !== TV.shell.screen || TV.shell.focusOn() !== "view") return;
            heroIndex = (heroIndex + 1) % featured.length;
            drawHero(featured[heroIndex]);
            heroNav.refocus();
        }, 10000);
    }

    /* ---------- rows ---------- */
    var rowQueue = [], rowTimer = null, noQueue = false;
    function addRow(title, items, kind, opts) {
        if (!items.length) return;
        // (drawn again over a Home already on screen: all at once, so the row in focus can be found again)
        if (!noQueue && strips.length >= 3 && !(opts && opts.now)) {             // below the fold: a moment later
            rowQueue.push([title, items, kind, opts]);
            if (!rowTimer) rowTimer = setTimeout(nextRow, 30);
            return;
        }
        makeRow(title, items, kind, opts);
    }
    function nextRow() {
        rowTimer = null;
        var r = rowQueue.shift();
        if (!r) return;
        makeRow(r[0], r[1], r[2], r[3]);
        if (rowQueue.length) rowTimer = setTimeout(nextRow, 30);
    }
    /* Drawing Home again keeps every row that has not changed (same title, same cards in the same order):
       its cards, pictures and position stay as they are. At start-up the catalog, the trending titles,
       the hidden themes and the genres arrive one after the other, and each one used to make every row
       again, pictures included: the Home that loads in jerks. */
    var oldStrips = {};
    function rowKey(title, items, kind) {
        return kind + "|" + title + "|" + items.length + "|" + items.slice(0, 40).map(function (x) {
            return x && x.item ? x.item.id + ":" + Math.round((x.resume && x.resume.pos) || 0) + (x.resume && x.resume.upNext ? "n" : "") : x && x.id;
        }).join(",");
    }
    function makeRow(title, items, kind, opts) {
        opts = opts || {};
        var key = rowKey(title, items, kind), old = oldStrips[key];
        if (old) {
            delete oldStrips[key];
            old.opts = opts;
            strips.push(old);
            rowsEl.appendChild(old.root);
            return;
        }
        var s = new TV.Strip({
            title: title, sub: opts.sub, items: items, kind: kind, height: kind === "poster" ? 440 : kind === "channel" ? 290 : 300, deferArt: true,
            make: opts.make || function (it) { return kind === "channel" ? TV.card.channel(it) : TV.card.poster(it); },
            onFocus: function (i, it) { focusItem(it, kind); }
        });
        s.kindOf = kind; s.opts = opts; s.key = key;
        strips.push(s);
        rowsEl.appendChild(s.root);
        wakeNear();
    }
    var bgSoon = TV.debounce(function (it) {
        if (!visible || !it) return;
        if (it.kind === "movie" || it.kind === "series") {
            if (it.backdrop) TV.bg(it.backdrop);
            TV.meta.lookup(it).then(function (m) { if (m && m.backdrop && visible && strips[zone] && strips[zone].current() === it) TV.bg(m.backdrop); });
        }
    }, 800);
    function focusItem(it, kind) { if (kind === "channel") return; bgSoon(it.item || it); }

    function buildRows() {
        oldStrips = {};
        strips.forEach(function (s) { if (s.key) oldStrips[s.key] = s; });
        rowsEl.innerHTML = "";
        strips = []; rowQueue = []; clearTimeout(rowTimer); rowTimer = null;
        var cw = D.continueWatching();
        addRow(T("Continue Watching"), cw, "wide", {
            make: function (x) {
                var r = x.resume, sub = r.upNext ? T("Up Next") + " · " + (r.epLabel || "") : (r.epLabel || (r.dur ? T("{n} min left", { n: Math.max(1, Math.round((r.dur - r.pos) / 60)) }) : ""));
                return TV.card.wide(x.item, { sub: sub, progress: r.upNext ? 0 : (r.dur ? r.pos / r.dur : 0) });
            }
        });
        var favs = D.favChannels();
        if (favs.length) addRow(T("Favorite Channels"), favs.slice(0, 40), "channel", { sub: T("Live now") });
        else {
            var rec = D.recentChannels();
            if (rec.length) addRow(T("Recently Watched Channels"), rec.slice(0, 20), "channel");

        }
        var ml = D.itemsIn("movies", "mylist").concat(D.itemsIn("series", "mylist"));
        addRow(T("My List"), ml, "poster");
        addRow(T("Recently Watched"), D.recentlyWatched().slice(0, 30), "poster");
        addRow(T("Trending Movies"), D.itemsIn("movies", "trend").slice(0, 30), "poster", { sub: T("This week") });
        addRow(T("Trending Series"), D.itemsIn("series", "trend").slice(0, 30), "poster", { sub: T("This week") });
        addRow(T("New Movies"), D.itemsIn("movies", "new").slice(0, 30), "poster");
        addRow(T("New Shows"), D.itemsIn("series", "new").slice(0, 30), "poster");
        addRow(T("Top Rated Movies"), D.itemsIn("movies", "top").slice(0, 30), "poster", { genreKey: "topmovies" });
        addRow(T("Top Rated Series"), D.itemsIn("series", "top").slice(0, 30), "poster", { genreKey: "topseries" });
        var cat2 = D.catalog();
        if (cat2) {
            var liveCats = cat2.live.cats.filter(function (c) { return !c.adult && !c.off && c.count >= 3; }).slice(0, favs.length ? 2 : 4);
            liveCats.forEach(function (c) { addRow(c.name, D.channelsIn(c.id).slice(0, 24), "channel", { sub: T("Live now") }); });
            // Genre rows (TMDB genres found in your catalog): loaded once, then Home is drawn again
            HOME_GENRES.forEach(function (g) {
                var items = D.itemsIn(g.kind, "g:" + g.id).slice(0, 30);
                if (items.length && genreNames[g.kind + g.id]) addRow(genreNames[g.kind + g.id], items, "poster", { sub: g.kind === "series" ? T("Series") : "", genreKey: g.kind + g.id });
            });
            if (!genresAsked) {
                genresAsked = true;
                Promise.all([TV.meta.genres("movie"), TV.meta.genres("tv")]).then(function (r) {
                    r[0].forEach(function (g) { genreNames["movies" + g.id] = g.name; });
                    r[1].forEach(function (g) { genreNames["series" + g.id] = g.name; });
                    return Promise.all(HOME_GENRES.map(function (g) { return D.genreItems(g.kind, g.id, true); }));
                }).then(function () { addGenreRows(); });
            }
        }
    }

    function addGenreRows() {
        if (!rowsEl || !D.catalog()) return;
        var have = {};
        strips.forEach(function (s) { if (s.opts && s.opts.genreKey) have[s.opts.genreKey] = 1; });
        // ...and the rows still waiting their turn below the fold: without them each "genre" or "top" that
        // arrived while rows were queued added the same rows again (Comedy seventeen times on a big account)
        rowQueue.forEach(function (r) { if (r[3] && r[3].genreKey) have[r[3].genreKey] = 1; });
        [["movies", T("Top Rated Movies")], ["series", T("Top Rated Series")]].forEach(function (t) {
            if (have["top" + t[0]]) return;
            var items = D.itemsIn(t[0], "top").slice(0, 30);
            if (items.length) addRow(t[1], items, "poster", { genreKey: "top" + t[0] });
        });
        HOME_GENRES.forEach(function (g) {
            var k = g.kind + g.id;
            if (have[k] || !genreNames[k]) return;
            var items = D.itemsIn(g.kind, "g:" + g.id).slice(0, 30);
            if (items.length) addRow(genreNames[k], items, "poster", { sub: g.kind === "series" ? T("Series") : "", genreKey: k });
        });
        if (visible) paint();
    }
    function render() {
        dirty = false;
        var cat = D.catalog();
        if (!D.sources().length || !cat) { empty(); return; }
        page.innerHTML = ""; page.appendChild(heroEl); page.appendChild(rowsEl);
        var had = featured.length, before = featured.map(function (x) { return x.id; }).join(",");
        featured = pickFeatured();
        if (featured.length && !had) zone = -1;
        var same = before && before === featured.map(function (x) { return x.id; }).join(",") && heroEl.firstChild;
        heroIndex = Math.min(heroIndex, Math.max(0, featured.length - 1));
        if (featured.length) { heroEl.style.display = ""; rowsEl.style.paddingTop = "0"; if (!same) drawHero(featured[heroIndex]); }
        else { heroEl.style.display = "none"; rowsEl.style.paddingTop = "170px"; heroNav = null; }
        buildRows();
        if (!featured.length && zone === -1) zone = 0;
        rotate();
        paint();
    }

    function scrollTo() {
        var inRows = zone >= 0 && !!strips[zone];
        page.classList.toggle("is-rows", inRows && featured.length > 0);
        document.body.classList.toggle("in-rows", inRows && visible);
        if (!inRows) { page.style.transform = "translateY(0)"; return; }
        var top = strips[zone].root.offsetTop;
        page.style.transform = "translateY(" + Math.min(0, -(top - (featured.length ? 360 : 170))) + "px)";
    }
    /* The rows on screen and the two after the one in focus load their covers and TMDB information; the
       others wait to come near (twenty rows used to ask for ~180 covers and lookups at start-up). */
    function wakeNear() {
        var from = Math.max(0, zone - 1), to = zone < 0 ? 2 : zone + 2;
        for (var i = from; i <= to && i < strips.length; i++) strips[i].wake();
    }
    function paint(active) {
        wakeNear();
        if (active === undefined) active = TV.shell && TV.shell.focusOn() === "view" && visible;
        strips.forEach(function (s, i) { s.setActive(active && i === zone); });
        if (heroNav) { if (active && zone === -1) heroNav.refocus(); else heroNav.blur(); }
        scrollTo();
        if (active && zone === -1 && featured[heroIndex]) { var fi = featured[heroIndex]; TV.meta.lookup(fi).then(function (m) { if (m && m.backdrop) heroBg(fi, m.backdrop); }); }
    }

    function activate(it, kind) {
        if (!it) return;
        if (kind === "channel") { TV.live.play(it, strips[zone].items); return; }
        if (it.item) {                                // continue watching
            if (it.item.kind === "movie") TV.detail.play(it.item, it.resume.pos);
            else TV.detail.open(it.item, { resume: true });
            return;
        }
        TV.detail.open(it);
    }

    var view = {
        show: function () {
            if (!root) build();
            visible = true;
            if (dirty || !strips.length) render(); else { strips.forEach(function (s) { s.cards.forEach(function (c) { if (c._update) c._update(); }); }); paint(); }
            if (featured[heroIndex] && featured[heroIndex].backdrop) { TV.bg(""); heroBg(featured[heroIndex], featured[heroIndex].backdrop); } else TV.bg("");
        },
        hide: function () { visible = false; clearInterval(heroTimer); TV.meta.clearQueue(); document.body.classList.remove("in-rows"); },
        enter: function () { paint(true); },
        blur: function () { if (featured.length) zone = -1; paint(false); },
        key: function (code) {
            var K = TV.KEY;
            if (!D.sources().length || !D.catalog()) { if (code === K.UP) return false; return heroNav ? (heroNav.key(code), true) : false; }
            if (code === K.UP) {
                if (zone === -1 || (zone === 0 && !featured.length)) return false;
                zone--; TV.sound.tick(); paint(true); return true;
            }
            if (code === K.DOWN) {
                if (zone < strips.length - 1) { zone++; TV.sound.tick(); paint(true); } else TV.sound.edge();
                return true;
            }
            if (code === K.LEFT || code === K.RIGHT) {
                var d = code === K.LEFT ? -1 : 1;
                if (zone === -1) { heroNav.move(d < 0 ? "left" : "right"); return true; }
                if (!strips[zone].move(d)) TV.sound.edge();
                return true;
            }
            return false;
        },
        ok: function () {
            if (!D.sources().length || !D.catalog()) { if (heroNav) heroNav.ok(); return; }
            if (zone === -1) { if (heroNav) heroNav.ok(); return; }
            var s = strips[zone];
            activate(s.current(), s.kindOf);
        },
        canHold: function () { return zone >= 0 && strips[zone] && (strips[zone].kindOf === "channel" || strips[zone].kindOf === "poster" || strips[zone].kindOf === "wide"); },
        longOk: function () {
            var s = strips[zone], it = s && s.current();
            if (!it) return;
            if (s.kindOf === "channel") {
                var fav = D.isFav(it.id);
                TV.menu(it.name, [
                    { label: fav ? T("Remove from Favorites") : T("Add to Favorites"), icon: fav ? "starLine" : "star", run: function () { D.toggleFav(it.id); } },
                    { label: T("Watch in Multiview"), icon: "grid", run: function () { TV.multiview.open([it]); } }
                ]);
            } else {
                TV.titleMenu(it.item || it, function () { view.invalidate(); }, { continueRow: !!it.item });
            }
        },
        invalidate: function () {
            dirty = true;
            if (!visible) return;
            if (TV.topNav() === TV.shell.screen) {
                clearTimeout(redrawTimer);
                // The row in focus stays in focus, even when a row arriving later (Trending) goes above it
                var z = zone, was = strips[z], key = was && was.key, title = was && was.root.firstChild && was.root.firstChild.textContent;
                noQueue = true;
                try { render(); } finally { noQueue = false; }
                var at = -1;
                if (was) strips.forEach(function (s, i) { if (at < 0 && (s === was || (key && s.key === key))) at = i; });
                if (was && at < 0) strips.forEach(function (s, i) { if (at < 0 && s.root.firstChild && s.root.firstChild.textContent === title) at = i; });
                zone = at >= 0 ? at : Math.min(z, strips.length - 1);
                paint();
                return;
            }
            // Something is open over Home (the "Pick up where you left off?" question…): drawn again once it closes
            clearTimeout(redrawTimer);
            redrawTimer = setTimeout(function again() {
                if (!dirty || !visible) return;
                if (TV.topNav() === TV.shell.screen) view.invalidate(); else redrawTimer = setTimeout(again, 700);
            }, 700);
        }
    };
    var redrawTimer = null;

    var burst = null;
    D.onChange(function (w) {
        if (w === "top" || w === "genre") { if (visible) addGenreRows(); else dirty = true; return; }
        clearTimeout(burst);
        // What you did (favorites, My List, a resume point) shows at once; what arrives by itself is grouped
        if (w === "favs" || w === "mylist" || w === "resume" || w === "groups") { view.invalidate(); return; }
        dirty = true;
        burst = setTimeout(function () { view.invalidate(); }, 450);
    });
    TV.epg.onUpdate(function () { if (visible && !TV.osd.isOpen()) strips.forEach(function (s) { s.cards.forEach(function (c) { if (c._update) c._update(); }); }); });
    TV.views = TV.views || {};
    TV.views.home = view;
})(window);
