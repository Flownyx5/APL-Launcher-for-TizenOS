/* ============================================================
   library.js: one tab per media server (Plex, Jellyfin, Emby), after
   Series, named after it. Like Home, only with that server: one of its
   newest titles at the top, then Continue Watching, Recently Added, one
   row per library (movies, then series) and My List. Its libraries also
   stay in Movies and Series as categories (the full grid, with Sort).
   ============================================================ */
(function (global) {
    "use strict";

    var TV = global.TV, el = TV.el, esc = TV.esc, T = TV.t, D = TV.data;
    var views = {};

    function isMedia(s) { return !!s && (s.type === "jellyfin" || s.type === "plex"); }
    function label(s) { return s.type === "plex" ? "Plex" : s.kind === "emby" ? "Emby" : "Jellyfin"; }
    function firstRow() { return T("Recently Added"); }
    /* The tabs of the media servers: "Plex", "Jellyfin"… (the server's own name when two have the same) */
    function tabs() {
        var list = D.sources().filter(isMedia), count = {};
        list.forEach(function (s) { count[label(s)] = (count[label(s)] || 0) + 1; });
        return list.map(function (s) { ensure(s.id); return { id: "m-" + s.id, label: count[label(s)] > 1 ? s.name : label(s) }; });
    }
    function ensure(id) {
        if (views[id]) return;
        if (!document.getElementById("v-m-" + id)) {
            var sec = document.createElement("section");
            sec.id = "v-m-" + id; sec.className = "view view--home";
            TV.$("views").appendChild(sec);
        }
        views[id] = TV.views["m-" + id] = makeView(id);
    }

    function makeView(srcId) {
        var root, page, heroEl, rowsEl, strips = [], zone = -1, featured = [], heroIndex = 0, heroNav = null, visible = false, dirty = true, heroTimer = null;
        function src() { return D.sources().filter(function (s) { return s.id === srcId; })[0]; }
        function mine(x) { return (x.item || x).src === srcId; }
        function build() {
            root = TV.$("v-m-" + srcId);
            root.innerHTML = "";
            page = el("div", "home"); heroEl = el("div", "hero"); rowsEl = el("div", "rows");
            page.appendChild(heroEl); page.appendChild(rowsEl);
            root.appendChild(page);
        }
        /* libraries of its hidden in Settings > Countries and Categories: said so, instead of "nothing yet" */
        function hiddenLibs() {
            var cat = D.catalog();
            return !!cat && ["movies", "series"].some(function (k) { return cat[k].cats.some(function (c) { return c.id.indexOf(srcId + ":") === 0 && c.off && c.count; }); });
        }
        /* its libraries, as they are in Movies and Series (hidden titles and categories left out) */
        function libs() {
            var cat = D.catalog(), out = [];
            if (!cat) return out;
            [["movies", T("{n} movies")], ["series", T("{n} series")]].forEach(function (k) {
                cat[k[0]].cats.forEach(function (c) {
                    if (c.id.indexOf(srcId + ":") !== 0 || c.off) return;
                    var items = D.itemsIn(k[0], c.id);
                    if (items.length) out.push({ kind: k[0], cat: c, items: items });
                });
            });
            return out;
        }

        /* ---------- the title at the top ---------- */
        function drawHero(item) {
            heroEl.innerHTML = "";
            if (!item) return;
            var s = src();
            heroEl.appendChild(el("div", "hero__kicker", esc((s ? label(s) : "") + " · " + firstRow(s))));
            var title = el("div", "hero__title", esc(item.title || item.name));
            heroEl.appendChild(title);
            var bits = [];
            if (item.year) bits.push("<span>" + item.year + "</span>");
            if (item.rating) bits.push("<span>★ " + (Math.round(item.rating * 10) / 10) + "</span>");
            if (item.dur) bits.push("<span>" + esc(TV.runtime(Math.round(item.dur / 60))) + "</span>");
            var meta = el("div", "hero__meta", bits.join("<span class='dot'></span>"));
            heroEl.appendChild(meta);
            var desc = el("div", "hero__desc", esc(item.plot || ""));
            heroEl.appendChild(desc);
            var btns = el("div", "hero__btns"), r = D.resumeOf(item.id);
            var play = el("div", "btn btn--primary", TV.icon("play", 28) + esc(r && r.pos > 60 ? T("Resume") : (item.kind === "series" ? T("Episodes") : T("Play"))));
            var more = el("div", "btn", TV.icon("info", 28) + esc(T("More Info")));
            btns.appendChild(play); btns.appendChild(more);
            heroEl.appendChild(btns);
            var dots = el("div", "hero__dots");
            featured.forEach(function (f, i) { dots.appendChild(el("i", i === heroIndex ? "is-on" : "")); });
            heroEl.appendChild(dots);
            heroNav = new TV.Nav({ onSelect: function (i) { if (i === 0 && item.kind === "movie") TV.detail.play(item); else TV.detail.open(item); } });
            heroNav.setTiles([play, more], 0);
            if (zone !== -1 || TV.shell.focusOn() !== "view") heroNav.blur();
            if (visible && zone === -1) TV.bg(item.backdrop || "");
            TV.meta.lookup(item).then(function (m) {
                if (!m || featured[heroIndex] !== item) return;
                if (m.logo) { var im = el("img", "hero__logo"); im.src = m.logo; im.onload = function () { if (title.parentNode) title.parentNode.replaceChild(im, title); }; }
                if (m.overview && !item.plot) desc.textContent = m.overview;
                if (!item.backdrop && m.backdrop && visible && zone === -1) TV.bg(m.backdrop);
            });
        }
        function rotate() {
            clearInterval(heroTimer);
            heroTimer = setInterval(function () {
                if (!visible || zone !== -1 || featured.length < 2 || TV.topNav() !== TV.shell.screen || TV.shell.focusOn() !== "view") return;
                heroIndex = (heroIndex + 1) % featured.length;
                drawHero(featured[heroIndex]);
                heroNav.refocus();
            }, 10000);
        }

        /* ---------- the rows ---------- */
        var bgSoon = TV.debounce(function (it) {
            if (!visible || !it) return;
            if (it.backdrop) TV.bg(it.backdrop);
            else TV.meta.lookup(it).then(function (m) { if (m && m.backdrop && visible && strips[zone] && strips[zone].current() === it) TV.bg(m.backdrop); });
        }, 800);
        function addRow(title, items, kind, opts) {
            if (!items.length) return;
            opts = opts || {};
            var s = new TV.Strip({
                title: title, sub: opts.sub, items: items, kind: kind, height: kind === "poster" ? 440 : 300,
                make: opts.make || function (it) { return TV.card.poster(it); },
                onFocus: function (i, it) { bgSoon(it.item || it); }
            });
            s.kindOf = kind;
            strips.push(s);
            rowsEl.appendChild(s.root);
        }
        function render() {
            dirty = false;
            if (!page) build();
            page.innerHTML = ""; page.appendChild(heroEl); page.appendChild(rowsEl);
            rowsEl.innerHTML = ""; strips = [];
            var s = src(), L = libs();
            if (!s || !L.length) {
                heroEl.innerHTML = ""; heroEl.style.display = "none"; featured = []; heroNav = null;
                var e = el("div", "empty");
                e.style.top = "300px";
                e.innerHTML = "<div class='empty__title'>" + esc(s ? label(s) : "") + "</div><div class='empty__text'>" +
                    esc(s && s.error ? s.error : (s && !s.at ? T("Loading…") : hiddenLibs() ? T("This server's libraries are hidden: Settings > Countries and Categories.") : T("Nothing in this server's libraries yet."))) + "</div>";
                page.appendChild(e);
                return;
            }
            var all = [];
            L.forEach(function (l) { all = all.concat(l.items); });
            all.sort(function (a, b) { return (b.added || 0) - (a.added || 0); });
            featured = all.filter(function (x) { return x.backdrop; }).slice(0, 8);
            if (featured.length < 3) featured = all.slice(0, 8);
            heroIndex = Math.min(heroIndex, Math.max(0, featured.length - 1));
            heroEl.style.display = ""; rowsEl.style.paddingTop = "0";
            drawHero(featured[heroIndex]);
            addRow(T("Continue Watching"), D.continueWatching().filter(mine), "wide", {
                make: function (x) {
                    var r = x.resume, sub = r.upNext ? T("Up Next") + " · " + (r.epLabel || "") : (r.epLabel || (r.dur ? T("{n} min left", { n: Math.max(1, Math.round((r.dur - r.pos) / 60)) }) : ""));
                    return TV.card.wide(x.item, { sub: sub, progress: r.upNext ? 0 : (r.dur ? r.pos / r.dur : 0) });
                }
            });
            addRow(firstRow(s), all.slice(0, 30), "poster");
            L.forEach(function (l) { addRow(l.cat.name, l.items.slice(0, 400), "poster", { sub: l.kind === "movies" ? T("{n} movies", { n: l.items.length }) : T("{n} series", { n: l.items.length }) }); });
            addRow(T("My List"), D.itemsIn("movies", "mylist").concat(D.itemsIn("series", "mylist")).filter(mine), "poster");
            if (zone >= strips.length) zone = strips.length - 1;
            if (!featured.length && zone === -1) zone = 0;
            rotate();
        }
        function scrollTo() {
            var inRows = zone >= 0 && !!strips[zone];
            page.classList.toggle("is-rows", inRows);
            document.body.classList.toggle("in-rows", inRows && visible);
            if (!inRows) { page.style.transform = "translateY(0)"; return; }
            page.style.transform = "translateY(" + Math.min(0, -(strips[zone].root.offsetTop - 360)) + "px)";
        }
        function paint(active) {
            if (!page) return;
            if (active === undefined) active = TV.shell.focusOn() === "view" && visible;
            strips.forEach(function (s, i) { s.setActive(active && i === zone); });
            if (heroNav) { if (active && zone === -1) heroNav.refocus(); else heroNav.blur(); }
            scrollTo();
            if (zone === -1 && featured[heroIndex] && visible) TV.bg(featured[heroIndex].backdrop || "");
        }
        function activate(it) {
            if (!it) return;
            if (it.item) { if (it.item.kind === "movie") TV.detail.play(it.item, it.resume.pos); else TV.detail.open(it.item, { resume: true }); return; }
            TV.detail.open(it);
        }
        var view = {
            show: function () {
                if (!page) build(); visible = true; if (dirty || !strips.length) render(); paint();
                // this server's Continue Watching, as other devices left it (Jellyfin and Emby)
                if (TV.media && TV.media.fresh) TV.media.fresh(srcId);
            },
            hide: function () { visible = false; clearInterval(heroTimer); document.body.classList.remove("in-rows"); },
            enter: function () { paint(true); },
            blur: function () { if (featured.length) zone = -1; paint(false); },
            key: function (code) {
                var K = TV.KEY;
                if (!strips.length && !heroNav) return false;
                if (code === K.UP) { if (zone === -1 || (zone === 0 && !featured.length)) return false; zone--; TV.sound.tick(); paint(true); return true; }
                if (code === K.DOWN) { if (zone < strips.length - 1) { zone++; TV.sound.tick(); paint(true); } else TV.sound.edge(); return true; }
                if (code === K.LEFT || code === K.RIGHT) {
                    var d = code === K.LEFT ? -1 : 1;
                    if (zone === -1) { if (heroNav) heroNav.move(d < 0 ? "left" : "right"); return true; }
                    if (!strips[zone].move(d)) TV.sound.edge();
                    return true;
                }
                return false;
            },
            ok: function () { if (zone === -1) { if (heroNav) heroNav.ok(); return; } if (strips[zone]) activate(strips[zone].current()); },
            canHold: function () { return zone >= 0 && !!strips[zone] && !!strips[zone].current(); },
            longOk: function () {
                var it = strips[zone] && strips[zone].current();
                if (it) TV.titleMenu(it.item || it, function () { dirty = true; if (visible) { render(); paint(); } }, { continueRow: !!it.item });
            }
        };
        D.onChange(function () { dirty = true; if (visible && TV.topNav() === TV.shell.screen) { var z = zone; render(); zone = Math.min(z, strips.length - 1); paint(); } });
        return view;
    }

    TV.views = TV.views || {};
    TV.library = { tabs: tabs, isMedia: isMedia };
})(window);
