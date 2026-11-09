/* ============================================================
   guide.js: the TV guide as a grid (time across, channels down).
   The programme you are on is described at the top, its channel plays in
   the window at the top right. ◀ ▶ move in time, ▲▼ change channel,
   OK on what is on now watches it full screen. The category is the one
   chosen in Live TV; OK on the category button changes it.
   ============================================================ */
(function (global) {
    "use strict";

    var TV = global.TV, el = TV.el, esc = TV.esc, T = TV.t, D = TV.data;
    var RECT = [0, 0, 1920, 1080];            // the channel plays full screen behind the grid
    var PX_MIN = 10, ROW_H = 92, GRID_W = 1520, SPAN_MIN = Math.floor(GRID_W / PX_MIN);
    var root, top, gridBody, rowsEl, ruler, nowLine, catBtn;
    var chans = [], row = 0, focusTime = 0, t0 = 0, scrollY = 0, cells = {}, visible = false, zone = "grid", previewTimer = null, playingId = null;
    var catId = null;

    function build() {
        root = TV.$("v-guide");
        root.innerHTML = "";
        root.appendChild(el("div", "guide__shade"));
        top = el("div", "guide__top");
        root.appendChild(top);
        var grid = el("div", "guide__grid");
        ruler = el("div", "guide__ruler");
        gridBody = el("div", "guide__body");
        rowsEl = el("div", "guide__rows");
        gridBody.appendChild(rowsEl);
        grid.appendChild(ruler); grid.appendChild(gridBody);
        nowLine = el("div", "guide__now");
        root.appendChild(grid);
        grid.appendChild(nowLine);
    }

    function startOfWindow(t) { var d = new Date(t); d.setMinutes(d.getMinutes() < 30 ? 0 : 30, 0, 0); return d.getTime(); }
    function xOf(t) { return (t - t0) / 60000 * PX_MIN; }

    function drawRuler() {
        ruler.innerHTML = "";
        for (var m = 0; m <= SPAN_MIN; m += 30) {
            var tk = el("div", "guide__tick", TV.hhmm(t0 + m * 60000));
            tk.style.left = (m * PX_MIN) + "px";
            ruler.appendChild(tk);
        }
        var nx = xOf(Date.now());
        nowLine.style.display = nx >= 0 && nx <= GRID_W ? "" : "none";
        nowLine.style.left = (300 + nx) + "px";
    }

    function progsOf(ch) {
        var from = t0, to = t0 + SPAN_MIN * 60000, list = TV.epg.range(ch, from - 3600000, to);
        if (!list.length) return [[from, to, T("No information"), "", true]];
        var out = [], t = from;
        list.forEach(function (p) {
            if (p[1] <= from || p[0] >= to) return;
            if (p[0] > t + 60000) out.push([t, p[0], "", "", true]);
            out.push(p);
            t = p[1];
        });
        if (t < to) out.push([t, to, "", "", true]);
        return out;
    }

    function drawRows() {
        rowsEl.innerHTML = "";
        cells = {};
        var first = Math.max(0, row - 4), last = Math.min(chans.length, first + 11);
        var spacer = el("div"); spacer.style.height = (first * ROW_H) + "px";
        rowsEl.appendChild(spacer);
        var now = Date.now();
        for (var i = first; i < last; i++) {
            var ch = chans[i], r = el("div", "grow");
            var chEl = el("div", "grow__ch" + (playingId === ch.id ? " is-current" : ""));
            var logo = el("div", "grow__logo");
            TV.logoBox(logo, ch);
            chEl.appendChild(el("div", "grow__num", String(ch.num)));
            chEl.appendChild(logo);
            chEl.appendChild(el("div", "grow__name", esc(ch.name)));
            r.appendChild(chEl);
            var pr = el("div", "grow__progs");
            cells[i] = [];
            progsOf(ch).forEach(function (p) {
                var x = Math.max(0, xOf(p[0])), w = Math.min(GRID_W, xOf(p[1])) - x - 6;
                if (w < 8) return;
                var c = el("div", "gcell" + (p[4] ? " is-empty" : "") + (p[0] <= now && p[1] > now ? " is-now" : "") + (p[1] <= now ? " is-past" : ""));
                c.style.left = x + "px"; c.style.width = w + "px";
                c.innerHTML = "<div class='gcell__t'>" + esc(p[2] || (p[4] ? "" : "")) + "</div>" + (w > 150 && !p[4] ? "<div class='gcell__h'>" + TV.hhmm(p[0]) + " – " + TV.hhmm(p[1]) + "</div>" : "");
                c._p = p;
                pr.appendChild(c);
                cells[i].push(c);
            });
            r.appendChild(pr);
            rowsEl.appendChild(r);
        }
        var y = row * ROW_H;
        if (y - scrollY > 580 - ROW_H * 1.6) scrollY = y - 580 + ROW_H * 1.6;
        if (y - scrollY < 0) scrollY = y;
        rowsEl.style.transform = "translateY(" + (-scrollY) + "px)";
        TV.epg.ensure(chans.slice(first, last));
        markFocus();
    }

    function focusedCell() {
        var list = cells[row] || [];
        for (var i = 0; i < list.length; i++) { var p = list[i]._p; if (p[0] <= focusTime && p[1] > focusTime) return list[i]; }
        return list[0] || null;
    }
    function markFocus() {
        Object.keys(cells).forEach(function (k) { cells[k].forEach(function (c) { c.classList.remove("is-focused"); }); });
        if (catBtn) catBtn.classList.toggle("is-focused", zone === "cat" && TV.shell.focusOn() === "view");
        var c = focusedCell();
        if (c && zone === "grid" && TV.shell.focusOn() === "view") c.classList.add("is-focused");
        describe(c ? c._p : null, chans[row]);
    }
    function describe(p, ch) {
        var cat = catId === "fav" ? { name: T("Favorites") } : catId === "all" ? { name: T("All Channels") } : String(catId).indexOf("grp:") === 0 ? (D.chanGroupOf(catId) || {}) : D.catOf({ cat: catId });
        top.innerHTML = "";
        var cr = el("div", "guide__cat");
        catBtn = el("div", "chip" + (zone === "cat" && TV.shell.focusOn() === "view" ? " is-focused" : ""), TV.icon("list", 24) + "&nbsp;&nbsp;" + esc(cat.name || T("Channels")));
        cr.appendChild(catBtn);
        top.appendChild(cr);
        if (!ch) return;
        var real = p && !p[4];
        top.appendChild(el("div", "guide__title", esc(real ? p[2] : ch.name)));
        top.appendChild(el("div", "guide__meta", "<span class='badge'>" + ch.num + "</span><span>" + esc(ch.name) + "</span>" +
            (real ? "<span class='dot'></span><span>" + TV.dayName(new Date(p[0])) + " " + TV.hhmm(p[0]) + " – " + TV.hhmm(p[1]) + "</span>" : "") +
            (real && p[0] <= Date.now() && p[1] > Date.now() ? "<span class='badge badge--live'>" + esc(T("LIVE")) + "</span>" : "")));
        if (real && p[3]) top.appendChild(el("div", "guide__desc", esc(p[3])));
    }

    function schedulePreview() {
        clearTimeout(previewTimer);
        var ch = chans[row];
        if (!ch || playingId === ch.id || !TV.pref("autoPreview")) return;
        previewTimer = setTimeout(function () {
            if (!visible) return;
            playingId = ch.id;
            TV.live.playChannel(ch, RECT);
        }, 900);
    }

    function load() {
        catId = TV.pref("liveCat") || "all";
        if (catId === "recent") catId = "all";
        chans = D.channelsIn(catId);
        if (!chans.length && catId !== "all") { catId = "all"; chans = D.channelsIn("all"); }
        row = 0;
        var last = TV.pref("lastChannel");
        for (var i = 0; i < chans.length; i++) if (chans[i].id === last) { row = i; break; }
        t0 = startOfWindow(Date.now());
        focusTime = Date.now();
        scrollY = 0;
        drawRuler(); drawRows();
    }

    /* Every category (no longer only the first 60), by country when there are many: the same list as Live TV */
    function pickCategory() {
        TV.live.pickCategory(catId, function (c) { TV.setPref("liveCat", c.id); load(); zone = "grid"; markFocus(); },
                             [{ id: "fav", name: T("Favorites") }, { id: "all", name: T("All Channels") }].concat(D.chanGroups().map(function (g) { return { id: "grp:" + g.id, name: g.name, count: g.ids.length }; })));
    }

    var view = {
        show: function () {
            if (!root) build();
            visible = true;
            document.body.classList.add("in-guide");
            load();
        },
        hide: function () {
            visible = false; clearTimeout(previewTimer);
            document.body.classList.remove("in-guide");
            if (!TV.osd.isOpen() && !TV.multiview.isOpen()) { TV.player.stop(); playingId = null; }
        },
        enter: function () { zone = "grid"; markFocus(); schedulePreview(); },
        blur: function () { markFocus(); },
        key: function (code) {
            var K = TV.KEY;
            if (zone === "cat") {
                if (code === K.DOWN) { zone = "grid"; TV.sound.tick(); markFocus(); return true; }
                if (code === K.UP) return false;
                TV.sound.edge(); return true;
            }
            switch (code) {
                case K.UP:
                    if (row === 0) { zone = "cat"; TV.sound.tick(); markFocus(); return true; }
                    row--; TV.sound.tick(); drawRows(); schedulePreview(); return true;
                case K.DOWN: case K.CH_DOWN:
                    if (row >= chans.length - 1) { TV.sound.edge(); return true; }
                    row++; TV.sound.tick(); drawRows(); schedulePreview(); return true;
                case K.CH_UP: if (row > 0) { row--; drawRows(); schedulePreview(); } return true;
                case K.LEFT: {
                    var c = focusedCell(), p = c && c._p;
                    var target = p ? p[0] - 60000 : focusTime - 30 * 60000;
                    if (target < Date.now() - 2 * 3600000) { TV.sound.edge(); return true; }
                    focusTime = Math.max(target, t0 - 1);
                    if (focusTime < t0) { t0 -= 30 * 60000; drawRuler(); drawRows(); } else markFocus();
                    var c2 = focusedCell(); if (c2) focusTime = Math.max(c2._p[0], t0);
                    TV.sound.tick(); return true;
                }
                case K.RIGHT: {
                    var cc = focusedCell(), pp = cc && cc._p;
                    focusTime = pp ? pp[1] + 1 : focusTime + 30 * 60000;
                    if (focusTime > Date.now() + 24 * 3600000) { focusTime = pp ? pp[0] : focusTime; TV.sound.edge(); return true; }
                    if (xOf(focusTime) > GRID_W - 200) { t0 += 60 * 60000; drawRuler(); drawRows(); } else markFocus();
                    TV.sound.tick(); return true;
                }
            }
            return false;
        },
        ok: function () {
            if (zone === "cat") { pickCategory(); return; }
            var ch = chans[row], c = focusedCell(), p = c && c._p;
            if (!ch) return;
            if (!p || (p[0] <= Date.now() && p[1] > Date.now()) || p[4]) { playingId = ch.id; TV.live.play(ch, chans); return; }
            TV.toast(p[1] <= Date.now() ? T("This programme is over") : T("Starts at {t}", { t: TV.hhmm(p[0]) }));
        },
        canHold: function () { return zone === "grid" && !!chans[row]; },
        longOk: function () {
            var ch = chans[row], fav = D.isFav(ch.id);
            TV.menu(ch.num + "  " + ch.name, [
                { label: T("Watch"), icon: "play", run: function () { TV.live.play(ch, chans); } },
                { label: fav ? T("Remove from Favorites") : T("Add to Favorites"), icon: fav ? "starLine" : "star", run: function () { D.toggleFav(ch.id); } },
                { label: T("Watch in Multiview"), icon: "grid", run: function () { TV.multiview.open([ch]); } },
                { label: T("TV Guide for This Channel"), icon: "list", run: function () { TV.live.guideMenu(ch); } }
            ]);
        }
    };

    TV.epg.onUpdate(function () { if (visible && !TV.osd.isOpen() && !TV.multiview.isOpen()) drawRows(); });
    setInterval(function () { if (visible) { drawRuler(); } }, 60000);
    TV.views = TV.views || {};
    TV.views.guide = view;
})(window);
