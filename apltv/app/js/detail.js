/* ============================================================
   detail.js: a movie's or a series' page, Apple TV style.
   The first screen: backdrop, the title's logo, IMDb rating, year,
   genres, runtime, the real plot (TMDB, in your language), the buttons,
   director and cast, all laid out one under the other (nothing can
   overlap, however long the plot is). Below, as you go down: seasons and
   episodes (watched ones ticked), the movie's saga, "More Like This"
   (TMDB's recommendations found in your catalog) and the cast.
   OK held: watched / not watched, hide this title.
   ============================================================ */
(function (global) {
    "use strict";

    var TV = global.TV, el = TV.el, esc = TV.esc, T = TV.t, D = TV.data;
    var root, inner, bgEl, item = null, meta = null, btnNav = null, zone = "btns", zones = ["btns"], isOpen = false, token = 0;
    var seasons = {}, seasonKeys = [], seasonIndex = 0, seasonEls = [], seasonRow = null, epStrip = null, tmdbTv = 0;
    var certInfo = null, mainEl, sectionEl, castStrip = null, castEl = null, extras = [], extraLists = {}, onCloseCb = null, history = [], lastClosed = null;

    function build() {
        root = TV.$("detail");
        root.innerHTML = "";
        bgEl = el("div", "detail__bg");
        root.appendChild(bgEl);
        root.appendChild(el("div", "detail__scrim"));
        inner = el("div", "detail__in");
        root.appendChild(inner);
    }

    function setBg(url) {
        url = TV.sized(url, "w1280");
        if (!url) return;
        var im = new Image();
        im.onload = function () { bgEl.style.backgroundImage = TV.cssUrl(url); };
        im.src = url;
    }

    function open(it, opts) {
        if (!root) build();
        opts = opts || {};
        // Opened from an actor's page or from "More Like This": Back comes back to the title before
        if (opts.push && item && isOpen) history.push(item);
        else if (opts.push && item && !isOpen && lastClosed) history.push(lastClosed);
        else if (!opts.push && !opts.back) history = [];
        item = it; meta = null; certInfo = null; seasons = {}; seasonKeys = []; seasonIndex = 0; epStrip = null; castStrip = null; extras = []; extraLists = {}; zone = "btns"; tmdbTv = 0;
        var my = ++token;
        isOpen = true;
        root.classList.add("is-open");
        bgEl.style.backgroundImage = "";
        setBg(it.backdrop || "");
        draw();
        TV.pushNav(screen);
        var t0 = Date.now();
        // TMDB at once: usually already known from the covers, so the page is complete in its first frame
        TV.meta.lookup(it, it._ref && it._ref.id).then(function (m) {
            if (my !== token || !m || meta) return;
            meta = m;
            if (it.kind === "series") tmdbTv = m.tmdbId;
            if (m.backdrop) setBg(m.backdrop);
            drawSoon();
            loadExtras(my);
            if (TV.DEV) TV.log("detail complete in " + (Date.now() - t0) + " ms");
        });
        var provider = it.kind === "movie" ? D.vodInfo(it) : D.seriesInfo(it);
        provider.then(function (info) {
            if (my !== token) return null;
            var tmdbId = 0;
            if (it.kind === "movie" && info && info.info) {
                tmdbId = parseInt(info.info.tmdb_id, 10) || 0;
                it._plot = info.info.plot || info.info.description || "";
                it._dur = parseInt(info.info.duration_secs, 10) || 0;
                if (!it.backdrop && info.info.backdrop_path && info.info.backdrop_path[0]) { it.backdrop = info.info.backdrop_path[0]; setBg(it.backdrop); }
            }
            if (it.kind === "series" && info) {
                seasons = info.seasons || {};
                seasonKeys = Object.keys(seasons).filter(function (k) { return seasons[k].length; }).sort(function (a, b) { return a - b; });
                tmdbId = parseInt(info.info && (info.info.tmdb || info.info.tmdb_id), 10) || 0;
                if (!it.plot && info.info && info.info.plot) it.plot = info.info.plot;
                var start = startEp();
                if (start) seasonKeys.forEach(function (k, i) { if (seasons[k].indexOf(start.ep) >= 0) seasonIndex = i; });
            }
            drawSoon();
            return meta && (!tmdbId || meta.tmdbId === tmdbId) ? meta : TV.meta.lookup(it, tmdbId);
        }).then(function (m) {
            if (my !== token || !m) return;
            var changed = m !== meta;
            meta = m;
            if (it.kind === "series") tmdbTv = m.tmdbId;
            if (changed && m.backdrop) setBg(m.backdrop);
            if (changed) { drawSoon(); extraLists = {}; loadExtras(my); }
            if (it.kind === "series") enrichSeason();
        }).catch(function (e) { TV.log("detail: " + e.message); });
        onCloseCb = opts.onClose || null;
    }

    function close() {
        if (history.length) { var prev = history.pop(); token++; open(prev, { back: true }); return; }
        token++;
        lastClosed = item;
        isOpen = false;
        root.classList.remove("is-open");
        TV.popNav(screen);
        if (onCloseCb) onCloseCb();
        if (TV.shell) TV.shell.refreshView();
    }

    /* ---------- the saga and "More Like This", found in your catalog ---------- */
    function loadExtras(my) {
        if (!meta || !meta.tmdbId) return;
        TV.meta.certs(item.kind === "series" ? "tv" : "movie", meta.tmdbId).then(function (c) { if (my === token && c) { certInfo = c; drawSoon(); } });
        var kind = item.kind === "series" ? "tv" : "movie", part = item.kind === "series" ? "series" : "movies", mine = D.versionKey(item);
        function oneEach(found) {
            var seen = {}, out = [];
            found.forEach(function (x) {
                if (D.versionKey(x) === mine || (x._ref && x._ref.id === meta.tmdbId) || D.isHidden(x) || (TV.pref("showAdult") ? false : D.catOf(x).adult)) return;
                var k = x._ref && x._ref.id ? "t" + x._ref.id : D.versionKey(x);
                if (seen[k]) return;
                seen[k] = 1; out.push(x);
            });
            return out;
        }
        if (kind === "movie" && meta.collection) TV.meta.collection(meta.collection.id).then(function (parts) {
            if (my !== token || !parts.length) return null;
            return D.findTitles(part, parts).then(function (found) {
                var l = oneEach(found);
                if (my !== token || !l.length) return;
                extraLists.saga = { title: meta.collection.name || T("The Saga"), items: l };
                drawSoon();
            });
        });
        TV.meta.similar(kind, meta).then(function (list) {
            if (my !== token || !list.length) return null;
            return D.findTitles(part, list).then(function (found) {
                var l = oneEach(found).slice(0, 30);
                if (my !== token || !l.length) return;
                extraLists.similar = { title: T("More Like This"), items: l };
                drawSoon();
            });
        });
        // The director's other movies (a series: its creator's other series)
        var who = (meta.directors || [])[0];
        if (who && who.id) TV.meta.byPerson(who.id, kind).then(function (list) {
            if (my !== token || !list.length) return null;
            return D.findTitles(part, list).then(function (found) {
                var l = oneEach(found).slice(0, 30);
                if (my !== token || !l.length) return;
                extraLists.director = { title: kind === "movie" ? T("Directed by {name}", { name: who.name }) : T("From {name}", { name: who.name }), items: l };
                drawSoon();
            });
        });
    }

    /* ---------- where a series starts again: the episode in progress, or the next one after a watched one ---------- */
    function allEps() { var all = []; seasonKeys.forEach(function (k) { all = all.concat(seasons[k]); }); return all; }
    function startEp() {
        var r = D.resumeOf(item.id), ep = r && r.ep ? findEp(r.ep) : null;
        if (!ep) return null;
        if (r.upNext) return { ep: ep, pos: 0, next: true };                 // set when the episode before was finished
        var er = D.resumeOf(item.id + "|" + ep.id);
        if (er && er.done) { var n = nextEp(ep); return n ? { ep: n, pos: 0, next: true } : { ep: ep, pos: 0, next: false }; }
        return { ep: ep, pos: er ? er.pos : (r.pos || 0), next: false };
    }
    function seasonDone(k) { var l = seasons[k] || []; return l.length > 0 && l.every(function (e) { return D.isDone(item.id + "|" + e.id); }); }

    /* ---------- drawing ---------- */
    function draw() {
        var it = item, m = meta || {};
        var keepZone = zone, keepBtn = btnNav ? btnNav.index : 0, keep = {};
        if (epStrip) keep.eps = epStrip.index;
        if (castStrip) keep.cast = castStrip.index;
        extras.forEach(function (x) { keep[x.id] = x.strip.index; });
        inner.innerHTML = "";

        // ---- the first screen: everything one under the other, anchored at the bottom ----
        mainEl = el("div", "detail__main");
        var title = el("div", "detail__title", esc(m.title || it.title || it.name));
        mainEl.appendChild(title);
        if (m.logo) { var im = el("img", "detail__logo"); im.onload = function () { if (title.parentNode) title.parentNode.replaceChild(im, title); }; im.src = m.logo; }
        var bits = [];
        var age = TV.meta.certBadge(certInfo);
        if (age) bits.push(age);
        if (m.imdb) bits.push(TV.meta.imdbBadge(m.imdb));
        else if (it.rating) bits.push("<span>★ " + TV.meta.fmt(it.rating) + "</span>");
        if (m.year || it.year) bits.push("<span>" + (m.year || it.year) + "</span>");
        if (m.genres && m.genres.length) bits.push("<span>" + esc(m.genres.join(", ")) + "</span>");
        if (it.kind === "movie" && (m.runtime || it._dur)) bits.push("<span>" + esc(TV.runtime(m.runtime || Math.round(it._dur / 60))) + "</span>");
        if (it.kind === "series" && (seasonKeys.length || m.seasons)) { var n = seasonKeys.length || m.seasons; bits.push("<span>" + esc(n > 1 ? T("{n} seasons", { n: n }) : T("1 season")) + "</span>"); }
        var cat = D.catOf(it);
        if (cat.tag) bits.push("<span class='badge'>" + esc(cat.tag) + "</span>");
        if (it.kind === "movie" && D.isDone(it.id)) bits.push("<span class='detail__seen'>" + TV.icon("check", 24) + esc(T("Watched")) + "</span>");
        mainEl.appendChild(el("div", "detail__meta", bits.join("<span class='dot'></span>")));
        if (m.tagline) mainEl.appendChild(el("div", "detail__tagline", esc(m.tagline)));
        mainEl.appendChild(el("div", "detail__desc", esc(m.overview || it._plot || it.plot || (meta === null ? "" : T("No description available.")))));

        var r = D.resumeOf(it.id), start = it.kind === "series" ? startEp() : null;
        if (it.kind === "movie" && r && r.dur && r.pos > 60 && !r.done) {
            mainEl.appendChild(el("div", "detail__progress", "<div class='bar'><i style='width:" + Math.round(100 * r.pos / r.dur) + "%'></i></div><span>" +
                esc(T("{n} min left", { n: Math.max(1, Math.round((r.dur - r.pos) / 60)) })) + "</span>"));
        }
        if (start && !start.next && start.pos > 60) {
            var er = D.resumeOf(it.id + "|" + start.ep.id);
            if (er && er.dur) mainEl.appendChild(el("div", "detail__progress", "<div class='bar'><i style='width:" + Math.round(100 * er.pos / er.dur) + "%'></i></div><span>" +
                esc(T("S{s} E{e}", { s: start.ep.season, e: start.ep.episode }) + " · " + T("{n} min left", { n: Math.max(1, Math.round((er.dur - er.pos) / 60)) })) + "</span>"));
        }
        var btnsEl = el("div", "detail__btns"), btns = [], acts = [];
        function add(cls, html, act) { var b = el("div", "btn" + (cls ? " " + cls : ""), html); btnsEl.appendChild(b); btns.push(b); acts.push(act); }
        if (it.kind === "movie") {
            if (r && r.pos > 60 && !r.done) {
                add("btn--primary", TV.icon("play", 28) + esc(T("Resume")), function () { play(it, r.pos); });
                add("", TV.icon("restart", 28) + esc(T("Start Over")), function () { play(it, 0); });
            } else add("btn--primary", TV.icon("play", 28) + esc(T("Play")), function () { play(it, 0); });
        } else {
            var first = start ? start.ep : firstEp();
            if (first) {
                var resuming = start && !start.next && start.pos > 60;
                var label = resuming ? T("Resume S{s} E{e}", { s: first.season, e: first.episode }) : T("Play S{s} E{e}", { s: first.season, e: first.episode });
                add("btn--primary", TV.icon("play", 28) + esc(label), function () { playEp(first, resuming ? start.pos : 0); });
            }
        }
        if (it.versions && it.versions.length > 1) {
            add("", TV.icon("quality", 28) + esc(T("Versions ({n})", { n: it.versions.length })), function () {
                TV.menu(T("Versions"), it.versions.map(function (v) {
                    var c = D.catOf(v), q = (String(v.name).match(/\b(4K|UHD|FHD|HD|MULTI|VOSTFR|VF|VO|HDR)\b/gi) || []).join(" ");
                    return { label: [c.tag, q, c.name].filter(Boolean).join(" · ") || v.name, check: v === item, run: function () {
                        if (v === item) return;
                        // the page opens again on this version: its own episodes, plot and links (before, a series kept
                        // the episodes of the first version, so that one played), and it is remembered for next time
                        var vs = it.versions; v.versions = vs;
                        D.preferVersion(v);
                        token++;
                        open(v, { back: true, onClose: onCloseCb });
                        TV.toast(T("Version changed: {name}", { name: [c.tag, q].filter(Boolean).join(" · ") || c.name || v.name }));
                    } };
                }));
            });
        }
        var inl = D.inMyList(it.id);
        add("", TV.icon(inl ? "check" : "plus", 28) + esc(T("My List")), function () {
            var on = D.toggleMyList(it.id);
            TV.toast(on ? T("Added to My List") : T("Removed from My List"));
            draw();
        });
        mainEl.appendChild(btnsEl);
        var people = [];
        if (m.director && m.director.length) people.push("<b>" + esc(it.kind === "series" ? T("Created by") : T("Director")) + "</b>  " + esc(m.director.join(", ")));
        if (m.cast && m.cast.length) people.push("<b>" + esc(T("Cast")) + "</b>  " + esc(m.cast.slice(0, 6).map(function (c) { return typeof c === "string" ? c : c.name; }).join(", ")));
        if (people.length) mainEl.appendChild(el("div", "detail__people", people.join("<br>")));
        inner.appendChild(mainEl);
        btnNav = new TV.Nav({ onSelect: function (i) { acts[i](); } });
        btnNav.setTiles(btns, Math.min(keepBtn, btns.length - 1));

        // ---- below: seasons and episodes, the saga, More Like This, the cast ----
        sectionEl = el("div", "detail__section");
        seasonEls = []; seasonRow = null; epStrip = null;
        if (it.kind === "series" && seasonKeys.length) {
            seasonRow = el("div", "detail__seasons");
            seasonEls = seasonKeys.map(function (k) {
                var c = el("div", "chip", esc(T("Season {n}", { n: k })) + (seasonDone(k) ? "<span class='chip__seen'>" + TV.icon("check", 22) + "</span>" : ""));
                seasonRow.appendChild(c);
                return c;
            });
            sectionEl.appendChild(seasonRow);
            var eps = seasons[seasonKeys[seasonIndex]] || [];
            epStrip = new TV.Strip({ items: eps, height: 400, left: 0, width: 1728, gap: 32, make: makeEp, onFocus: function () {} });
            epStrip.root.className = "detail__eps";
            sectionEl.appendChild(epStrip.root);
            if (keep.eps >= 0 && keep.eps !== undefined) epStrip.focus(Math.min(keep.eps, eps.length - 1), true);
            else if (start) { var si = eps.indexOf(start.ep); if (si >= 0) epStrip.focus(si, true); }
        }
        extras = [];
        ["saga", "similar", "director"].forEach(function (id) {
            var x = extraLists[id];
            if (!x || !x.items.length) return;
            var s = new TV.Strip({ title: x.title, items: x.items, height: 440, left: 0, width: 1728, make: function (t) { return TV.card.poster(t); } });
            s.root.classList.add("detail__row");
            sectionEl.appendChild(s.root);
            extras.push({ id: id, strip: s });
            if (keep[id] !== undefined) s.focus(Math.min(keep[id], x.items.length - 1), true);
        });
        castStrip = null; castEl = null;
        var castList = (m.cast || []).filter(function (c) { return c && typeof c === "object" && c.id; });
        if (castList.length) {
            castEl = el("div", "detail__cast");
            castEl.appendChild(el("div", "detail__h", esc(T("Cast & Crew"))));
            castStrip = new TV.Strip({ items: castList, height: 300, left: 0, width: 1728, gap: 26, make: makePerson });
            castStrip.root.className = "detail__caststrip";
            castEl.appendChild(castStrip.root);
            sectionEl.appendChild(castEl);
            if (keep.cast !== undefined) castStrip.focus(Math.min(keep.cast, castList.length - 1), true);
        }
        inner.appendChild(sectionEl);
        zones = ["btns"];
        if (seasonRow) zones.push("seasons");
        if (epStrip && epStrip.items.length) zones.push("eps");
        extras.forEach(function (x) { zones.push(x.id); });
        if (castStrip) zones.push("cast");
        zone = zones.indexOf(keepZone) >= 0 ? keepZone : "btns";
        paint();
    }
    function makeEp(ep) {
        var c = el("div", "ep"), art = el("div", "ep__art"), key = item.id + "|" + ep.id;
        var r = D.resumeOf(key);
        if (r && r.done) { art.appendChild(el("div", "ep__seen", TV.icon("check", 20) + esc(T("Watched")))); c.classList.add("is-seen"); }
        else if (r && r.dur) { var b = el("div", "card__bar"); b.innerHTML = "<i style='width:" + Math.round(100 * Math.min(1, r.pos / r.dur)) + "%'></i>"; art.appendChild(b); }
        c.appendChild(art);
        c.appendChild(el("div", "ep__n", esc(T("Episode {n}", { n: ep.episode })) + (ep.dur ? " · " + esc(TV.runtime(Math.round(ep.dur / 60))) : "")));
        c.appendChild(el("div", "ep__t", esc(ep._name || ep.title || T("Episode {n}", { n: ep.episode }))));
        c.appendChild(el("div", "ep__d", esc(ep._plot || ep.plot || "")));
        c._art = function () {
            var url = TV.sized(ep._still || ep.image || (meta && meta.backdrop) || item.backdrop, "w500");
            if (url) { var im = new Image(); im.onload = function () { TV.later(function () { art.style.backgroundImage = TV.cssUrl(url); }); }; im.src = url; }
        };
        return c;
    }
    var drawFrame = 0;
    function drawSoon() {
        if (drawFrame) return;
        drawFrame = requestAnimationFrame(function () { drawFrame = 0; if (isOpen) draw(); });
    }
    function makePerson(c) {
        var d = el("div", "pcard"), ph = el("div", "pcard__photo");
        ph.textContent = String(c.name || "").split(/\s+/).map(function (w) { return w.charAt(0); }).join("").slice(0, 2).toUpperCase();
        d.appendChild(ph);
        d.appendChild(el("div", "pcard__name", esc(c.name)));
        d.appendChild(el("div", "pcard__role", esc(c.role || "")));
        d._art = function () {
            if (!c.photo) return;
            var im = new Image();
            im.onload = function () { ph.textContent = ""; ph.style.backgroundImage = TV.cssUrl(c.photo); };
            im.src = c.photo;
        };
        return d;
    }
    function enrichSeason() {
        var k = seasonKeys[seasonIndex];
        if (!tmdbTv || !k) return;
        var my = token;
        TV.meta.season(tmdbTv, k).then(function (s) {
            if (!s || my !== token) return;
            var changed = false;
            (seasons[k] || []).forEach(function (ep) {
                var x = s.eps[ep.episode];
                if (!x) return;
                ep._name = x.name; ep._plot = x.overview; if (x.still && !ep.image) ep._still = x.still; if (!ep.dur && x.runtime) ep.dur = x.runtime * 60;
                changed = true;
            });
            if (changed && seasonKeys[seasonIndex] === k) drawSoon();
        });
    }
    function extraOf(z) { for (var i = 0; i < extras.length; i++) if (extras[i].id === z) return extras[i]; return null; }
    function stripOf(z) { if (z === "eps") return epStrip; if (z === "cast") return castStrip; var x = extraOf(z); return x ? x.strip : null; }
    function topIn(e) { var y = 0; while (e && e !== inner) { y += e.offsetTop; e = e.offsetParent; } return y; }
    function paint() {
        if (zone === "btns") btnNav.refocus(); else btnNav.blur();
        seasonEls.forEach(function (c, i) { c.classList.toggle("is-current", i === seasonIndex); c.classList.toggle("is-focused", zone === "seasons" && i === seasonIndex); });
        if (epStrip) epStrip.setActive(zone === "eps");
        extras.forEach(function (x) { x.strip.setActive(zone === x.id); });
        if (castStrip) castStrip.setActive(zone === "cast");
        // the row in use comes up under the top of the screen; the first screen when on the buttons
        var target = zone === "seasons" || zone === "eps" ? seasonRow : zone === "cast" ? castEl : (extraOf(zone) ? extraOf(zone).strip.root : null);
        var y = target ? topIn(target) - 110 : 0;
        inner.style.transform = "translateY(" + (-Math.max(0, y)) + "px)";
    }

    function firstEp() { var k = seasonKeys[0]; return k ? seasons[k][0] : null; }
    function findEp(id) { for (var i = 0; i < seasonKeys.length; i++) { var l = seasons[seasonKeys[i]]; for (var j = 0; j < l.length; j++) if (l[j].id === id) return l[j]; } return null; }
    function nextEp(ep) { var all = allEps(), i = all.indexOf(ep); return i >= 0 ? all[i + 1] || null : null; }

    /* ---------- OK held ---------- */
    function titleMenu() {
        var it = item, items = [];
        if (it.kind === "movie") {
            var done = D.isDone(it.id);
            items.push({ label: done ? T("Mark as Unwatched") : T("Mark as Watched"), icon: "eyeCheck", run: function () { D.markWatched(it, null, !done); draw(); } });
        } else if (seasonKeys.length) {
            var all = allEps(), allDone = all.every(function (e) { return D.isDone(it.id + "|" + e.id); });
            items.push({ label: allDone ? T("Mark Series as Unwatched") : T("Mark Series as Watched"), icon: "eyeCheck", run: function () { D.markWatched(it, all, !allDone); draw(); } });
        }
        items.push({ label: T("Hide This Title"), icon: "eyeOff", run: function () { hide(it); } });
        TV.menu(it.title || it.name, items);
    }
    function epMenu(ep) {
        if (!ep) return;
        var key = item.id + "|" + ep.id, done = D.isDone(key), k = seasonKeys[seasonIndex], sd = seasonDone(k);
        TV.menu(T("S{s} E{e}", { s: ep.season, e: ep.episode }) + " · " + (ep._name || ep.title || ""), [
            { label: done ? T("Mark as Unwatched") : T("Mark as Watched"), icon: "eyeCheck", run: function () { D.markWatched(item, [ep], !done); draw(); } },
            { label: sd ? T("Mark Season {n} as Unwatched", { n: k }) : T("Mark Season {n} as Watched", { n: k }), icon: "eyeCheck", run: function () { D.markWatched(item, seasons[k], !sd); draw(); } }
        ]);
    }
    function hide(it) {
        TV.alert({ title: T("Hide “{name}”?", { name: it.title || it.name }), message: T("It will no longer appear anywhere in APL TV. You can bring it back in Settings, Hidden Titles."), buttons: [
            { label: T("Cancel") },
            { label: T("Hide"), run: function () { D.setHidden(it, true); TV.toast(T("“{name}” is hidden", { name: it.title || it.name })); history = []; close(); } }
        ] });
    }

    /* ---------- playing ---------- */
    function play(it, start) {
        var title = (meta && meta.title) || it.title || it.name;
        TV.osd.vod({ url: D.vodUrl(it), item: it, title: title, sub: it.year ? String(it.year) : "", resumeKey: it.id, start: start || 0,
                     onClose: function () { if (isOpen) draw(); } });
    }
    function playEp(ep, start) {
        var it = item, title = (meta && meta.title) || it.title || it.name;
        var sub = T("S{s} E{e}", { s: ep.season, e: ep.episode }) + ((ep._name || ep.title) ? " · " + (ep._name || ep.title) : "");
        var key = it.id + "|" + ep.id, n = nextEp(ep), all = allEps(), p = all[all.indexOf(ep) - 1] || null;
        function label(e) { return T("S{s} E{e}", { s: e.season, e: e.episode }) + ((e._name || e.title) ? " · " + (e._name || e.title) : ""); }
        if (!start) { var r = D.resumeOf(key); if (r && !r.done && r.pos > 60) start = r.pos; }
        TV.osd.vod({ url: D.vodUrl(it, ep), item: it, ep: ep, title: title, sub: sub, resumeKey: key, start: start || 0,
            next: n ? { ep: n, label: label(n) } : null,
            prev: p ? { ep: p, label: label(p) } : null,
            onEpisode: function (e) { playEp(e, 0); },
            onClose: function () { if (isOpen) draw(); } });
    }

    var screen = {
        key: function (code) {
            var K = TV.KEY, zi = zones.indexOf(zone);
            if (TV.isBack(code)) { if (zone !== "btns") { zone = "btns"; paint(); return; } close(); return; }
            if (code === K.DOWN) { if (zi < zones.length - 1) { zone = zones[zi + 1]; TV.sound.tick(); paint(); } else TV.sound.edge(); return; }
            if (code === K.UP) { if (zi > 0) { zone = zones[zi - 1]; TV.sound.tick(); paint(); } else TV.sound.edge(); return; }
            if (zone === "btns") { btnNav.key(code); return; }
            if (zone === "seasons") {
                if (code === K.LEFT || code === K.RIGHT) {
                    var n = seasonIndex + (code === K.LEFT ? -1 : 1);
                    if (n < 0 || n >= seasonKeys.length) { TV.sound.edge(); return; }
                    seasonIndex = n; TV.sound.tick();
                    var eps = seasons[seasonKeys[seasonIndex]] || [];
                    epStrip.items = eps; epStrip.index = 0; epStrip.scroll = 0; epStrip.build(); epStrip.focus(0, true);
                    paint(); enrichSeason();
                }
                return;
            }
            var s = stripOf(zone);
            if (s && (code === K.LEFT || code === K.RIGHT)) { if (!s.move(code === K.LEFT ? -1 : 1)) TV.sound.edge(); }
        },
        ok: function () {
            if (zone === "btns") { btnNav.ok(); return; }
            if (zone === "seasons") { if (zones.indexOf("eps") >= 0) { zone = "eps"; paint(); } return; }
            if (zone === "cast") { var who = castStrip && castStrip.current(); if (who) TV.person.open(who, item); return; }
            if (zone === "eps") { var ep = epStrip && epStrip.current(); if (ep) playEp(ep, 0); return; }
            var x = extraOf(zone), t = x && x.strip.current();
            if (t) open(t, { push: true });
        },
        canHold: function () { return zone === "btns" || zone === "eps" || !!extraOf(zone); },
        longOk: function () {
            if (zone === "eps") { epMenu(epStrip && epStrip.current()); return; }
            var x = extraOf(zone);
            if (x) { var t = x.strip.current(); if (t) TV.titleMenu(t, function () { extraLists = {}; loadExtras(token); drawSoon(); }); return; }
            titleMenu();
        }
    };

    TV.detail = { open: open, close: close, isOpen: function () { return isOpen; },
        play: function (it, start) { if (it.kind === "movie") { item = it; meta = null; TV.meta.lookup(it).then(function (m) { meta = m; }); play(it, start); } else open(it); } };
})(window);
