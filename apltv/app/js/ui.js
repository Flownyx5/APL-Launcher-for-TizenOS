/* ============================================================
   ui.js: interface pieces shared by the screens.
   - VList: a long vertical list (categories, channels) that only builds
     the rows near the focus: 5,000 channels scroll as fast as 50.
   - Strip: a row of cards (Home, search, episodes), scrolled tvOS style.
   - Grid: covers in 7 columns, built row by row as you go down.
   - Cards: cover, wide picture, channel (logo + what's on + progress).
   - Backdrop, menu (OK held), alert, text input (the screen's keyboard).
   ============================================================ */
(function (global) {
    "use strict";

    var TV = global.TV, el = TV.el, esc = TV.esc, T = TV.t;

    /* ---------- backdrop ---------- */
    var bgFlip = false, bgUrl = "", bgTimer = null;
    TV.bg = function (url, mode) {
        url = TV.sized(url, "w1280");
        var b = TV.$("bg");
        b.classList.toggle("is-dark", mode === "dark");
        if (url === bgUrl) return;
        bgUrl = url;
        TV.uncalm(bgTimer);
        bgTimer = TV.calm(function () {
            var a = TV.$(bgFlip ? "bgImgA" : "bgImgB"), o = TV.$(bgFlip ? "bgImgB" : "bgImgA");
            if (!url) { a.classList.remove("is-on"); o.classList.remove("is-on"); return; }
            var im = new Image();
            im.onload = function () {
                var swap = function () {
                    if (bgUrl !== url) return;
                    TV.calm(function () {
                        if (bgUrl !== url) return;
                        if (TV.mark) TV.mark("bg");
                        a.style.backgroundImage = TV.cssUrl(url);
                        a.classList.add("is-on"); o.classList.remove("is-on");
                        bgFlip = !bgFlip;
                    }, 380);
                };
                if (im.decode) im.decode().then(swap, swap); else swap();
            };
            im.src = url;
        }, 380);
    };

    /* ---------- VList ----------
       Rows are placed at their own height (absolute positions): moving one row adds the one coming into view
       and removes the one leaving it, nothing else is rebuilt. Only the row that loses the focus and the one
       that gets it change class. */
    function VList(opts) {
        this.clip = opts.clip;
        this.inner = el("div", "live__list");
        this.inner.style.position = "relative";
        this.clip.appendChild(this.inner);
        this.rowH = opts.rowH;
        this.render = opts.render;
        this.onFocus = opts.onFocus || function () {};
        this.top = opts.top || 0;
        this.items = [];
        this.index = 0;
        this.scroll = 0;
        this.active = false;
        this.rows = {};
        this.marked = -1;
        this.viewH = opts.viewH || 900;
    }
    VList.prototype.set = function (items, index) {
        this.items = items || [];
        this.index = TV.clamp(index || 0, 0, Math.max(0, this.items.length - 1));
        this.inner.innerHTML = "";
        this.rows = {}; this.marked = -1;
        this.inner.style.height = (this.top + this.items.length * this.rowH) + "px";
        this.scroll = Math.max(0, this.top + this.index * this.rowH - this.viewH / 3);
        this.draw();
    };
    VList.prototype.current = function () { return this.items[this.index]; };
    VList.prototype.makeRow = function (i) {
        var r = this.render(this.items[i], i);
        r.style.position = "absolute"; r.style.left = "0"; r.style.right = "0";
        r.style.top = (this.top + i * this.rowH) + "px";
        this.rows[i] = r;
        this.inner.appendChild(r);
        return r;
    };
    VList.prototype.draw = function () {
        var n = this.items.length, rowH = this.rowH, y = this.top + this.index * rowH, s = this.scroll;
        if (y - s > this.viewH - rowH * 2.2) s = y - this.viewH + rowH * 2.2;
        if (y - s < rowH * 1.2) s = Math.max(0, y - rowH * 1.2);
        this.scroll = s;
        var first = Math.max(0, Math.floor((s - this.top) / rowH) - 3), last = Math.min(n, Math.ceil((s + this.viewH - this.top) / rowH) + 3);
        for (var k in this.rows) { var i = +k; if (i < first || i >= last) { this.inner.removeChild(this.rows[k]); delete this.rows[k]; if (i === this.marked) this.marked = -1; } }
        for (var j = first; j < last; j++) if (!this.rows[j]) this.makeRow(j);
        this.inner.style.transform = "translateY(" + (-s) + "px)";
        this.mark();
    };
    VList.prototype.mark = function () {
        var old = this.rows[this.marked];
        if (old) { old.classList.remove("is-focused"); old.classList.remove("is-current"); }
        var row = this.rows[this.index];
        if (row) { TV.lift(row); row.classList.toggle("is-focused", this.active); row.classList.toggle("is-current", !this.active); }
        this.marked = this.index;
    };
    VList.prototype.setHead = function (node) { this.head = node; };
    VList.prototype.focus = function (i, silent) {
        if (!this.items.length) return false;
        i = TV.clamp(i, 0, this.items.length - 1);
        var moved = i !== this.index;
        this.index = i;
        this.draw();
        if (!silent) this.onFocus(this.index, this.current());
        return moved;
    };
    VList.prototype.move = function (d) {
        if (!this.items.length) return false;
        var i = this.index + d;
        if (i < 0 || i >= this.items.length) {
            if (Math.abs(d) > 1) i = TV.clamp(i, 0, this.items.length - 1);
            else return false;
        }
        if (i === this.index) return false;
        this.focus(i);
        TV.sound.tick();
        return true;
    };
    VList.prototype.setActive = function (on) { this.active = on; this.mark(); };
    /* The rows on screen made again (new guide data): the others are made when they come into view */
    VList.prototype.refresh = function () {
        for (var k in this.rows) { this.inner.removeChild(this.rows[k]); }
        this.rows = {}; this.marked = -1;
        this.draw();
    };
    VList.prototype.rowOf = function (i) { return this.rows[i] || null; };
    TV.VList = VList;

    /* ---------- HList: a long row of cards (Live TV channels), built as it scrolls ---------- */
    function HList(opts) {
        this.clip = opts.clip;
        this.inner = opts.inner || el("div");
        if (!opts.inner) this.clip.appendChild(this.inner);
        this.step = opts.step; this.viewW = opts.viewW || 1728;
        this.render = opts.render; this.onFocus = opts.onFocus || function () {};
        this.items = []; this.index = 0; this.scroll = 0; this.active = false; this.cards = {}; this.marked = -1; this.spare = null;
        this.onWindow = opts.onWindow || null;
    }
    HList.prototype.set = function (items, index) {
        this.items = items || []; this.index = TV.clamp(index || 0, 0, Math.max(0, this.items.length - 1));
        this.inner.innerHTML = ""; this.cards = {}; this.marked = -1;
        this.draw();
    };
    HList.prototype.current = function () { return this.items[this.index]; };
    HList.prototype.draw = function () {
        var n = this.items.length, step = this.step;
        // The focused card stays second from the left once the row has moved, as in the Apple TV app
        this.scroll = Math.max(0, Math.min((this.index - 1) * step, n * step - this.viewW + step * 0.4));
        if (this.scroll < 0 || n * step <= this.viewW) this.scroll = 0;
        // The cards on screen now; spare cards on each side a moment later, once the move is drawn
        var first = Math.max(0, Math.floor(this.scroll / step)), last = Math.min(n, Math.ceil((this.scroll + this.viewW) / step) + 1);
        if (TV.mark) for (var m = first; m < last; m++) if (!this.cards[m]) { TV.mark("make"); break; }
        this.fill(first, last, false);
        this.inner.style.transform = "translateX(" + (-this.scroll) + "px)";
        this.mark();
        var self = this;
        TV.uncalm(this.spare);
        this.spare = TV.calm(function () {
            var a = Math.max(0, first - 3), b = Math.min(n, last + 4), todo = [];
            for (var k in self.cards) { var i = +k; if (i < a || i >= b) { self.inner.removeChild(self.cards[k]); delete self.cards[k]; if (i === self.marked) self.marked = -1; } }
            for (var j = a; j < b; j++) if (!self.cards[j]) todo.push(j);
            var gen = self.gen = (self.gen || 0) + 1;
            (function step() {
                if (self.gen !== gen || !todo.length) return;
                var x = todo.shift();
                if (Date.now() - TV.keyAt < 300) return;   // a new move started: the next calm moment goes on
                if (TV.mark) TV.mark("spare");
                self.fill(x, x + 1, false);
                requestAnimationFrame(step);
            })();
        }, 320);
        if (this.onWindow) this.onWindow(Math.max(0, first - 6), Math.min(n, last + 10));
    };
    HList.prototype.fill = function (first, last, prune) {
        if (prune) for (var k in this.cards) { var i = +k; if (i < first || i >= last) { this.inner.removeChild(this.cards[k]); delete this.cards[k]; if (i === this.marked) this.marked = -1; } }
        for (var j = first; j < last; j++) if (!this.cards[j]) {
            var c = this.render(this.items[j], j);
            c.style.left = (j * this.step) + "px";
            this.cards[j] = c; this.inner.appendChild(c);
            if (j === this.index && this.active) { c.classList.add("is-focused"); this.marked = j; }
        }
    };
    HList.prototype.mark = function () {
        var old = this.cards[this.marked];
        if (old) old.classList.remove("is-focused");
        var c = this.cards[this.index];
        if (c) TV.lift(c);
        if (c && this.active) c.classList.add("is-focused");
        this.marked = this.index;
    };
    HList.prototype.focus = function (i, silent) {
        if (!this.items.length) return;
        this.index = TV.clamp(i, 0, this.items.length - 1);
        this.draw();
        if (!silent) this.onFocus(this.index, this.current());
    };
    HList.prototype.move = function (d) {
        var i = this.index + d;
        if (i < 0 || i >= this.items.length) return false;
        this.focus(i); TV.sound.tick();
        return true;
    };
    HList.prototype.setActive = function (on) { this.active = on; var c = this.cards[this.index]; if (c) c.classList.toggle("is-focused", on); this.marked = this.index; };
    HList.prototype.refresh = function () { for (var k in this.cards) this.inner.removeChild(this.cards[k]); this.cards = {}; this.marked = -1; this.draw(); };
    TV.HList = HList;

    /* ---------- Strip (a row of cards) ---------- */
    function Strip(opts) {
        this.root = el("div", "row");
        this.kind = opts.kind || "poster";
        this.items = opts.items || [];
        this.make = opts.make;
        this.onFocus = opts.onFocus || function () {};
        this.onSelect = opts.onSelect || function () {};
        this.onLong = opts.onLong || null;
        this.index = 0; this.scroll = 0; this.active = false;
        this.gap = opts.gap || 36;
        this.left = opts.left === undefined ? 96 : opts.left;
        this.width = opts.width || 1920;
        // Pictures only once the row is near the screen (Home: wake()), not for every row at start-up
        this.deferArt = !!opts.deferArt; this.awake = !opts.deferArt;
        if (opts.title) this.root.appendChild(el("div", "row__title", esc(opts.title) + (opts.sub ? " <small>" + esc(opts.sub) + "</small>" : "")));
        this.clipEl = el("div", "row__clip");
        this.clipEl.style.setProperty("--row-h", (opts.height || 300) + "px");
        this.strip = el("div", "row__strip");
        this.strip.style.left = this.left + "px";
        this.clipEl.appendChild(this.strip);
        this.root.appendChild(this.clipEl);
        this.cards = [];
        this.build();
    }
    Strip.prototype.build = function () {
        this.strip.innerHTML = ""; this.cards = []; this._cw = 0;
        this.grow(9);
        this.lazy();
    };
    /* Cards are made as the row is scrolled: a Home with 15 rows does not make 400 cards at once */
    Strip.prototype.grow = function (upTo) {
        for (var i = this.cards.length; i < Math.min(this.items.length, upTo); i++) {
            var c = this.make(this.items[i], i);
            this.cards.push(c); this.strip.appendChild(c);
        }
    };
    Strip.prototype.cardW = function () {         // measured once: reading it on every press made the screen lay out again
        if (!this._cw && this.cards[0]) this._cw = this.cards[0].offsetWidth;
        return this._cw || 230;
    };
    Strip.prototype.wake = function () { if (this.awake) return; this.awake = true; this.lazy(); };
    Strip.prototype.lazy = function () {
        if (!this.awake) return;
        var w = this.cardW() + this.gap, first = Math.floor(this.scroll / w) - 1, last = first + Math.ceil(this.width / w) + 3;
        for (var i = Math.max(0, first); i < Math.min(this.cards.length, last); i++) {
            var c = this.cards[i];
            if (c._art && !c._loaded) { c._loaded = true; c._art(); }
        }
    };
    Strip.prototype.focus = function (i, silent) {
        if (!this.cards.length) return;
        if (i >= this.cards.length - 4) this.grow(i + 9);
        i = TV.clamp(i, 0, this.cards.length - 1);
        var c = this.cards[i];
        /* Where the card really is, read before anything changes. Computed from the gap before, which TVs
           without flex gap (Tizen 6.0) do not apply: there, going left, the card ended up off the screen. */
        var real = c.offsetWidth > 0, w = (real ? c.offsetWidth : this.cardW()) + this.gap, x = real ? c.offsetLeft : i * w, right = this.width - this.left - 140;
        if (this.cards[this.index]) this.cards[this.index].classList.remove("is-focused");
        this.index = i;
        TV.lift(c);
        if (this.active) c.classList.add("is-focused");
        if (x - this.scroll + w > right) this.scroll = x + w - right;
        if (x - this.scroll < 0) this.scroll = x;
        this.strip.style.transform = "translateX(" + (-this.scroll) + "px)";
        this.lazy();
        if (!silent) this.onFocus(i, this.items[i], c);
    };
    Strip.prototype.setActive = function (on) {
        this.active = on;
        var c = this.cards[this.index];
        if (c) c.classList.toggle("is-focused", on);
        if (on) this.focus(this.index);
    };
    Strip.prototype.move = function (d) {
        var i = this.index + d;
        if (i < 0 || i >= this.items.length) return false;
        this.focus(i); TV.sound.tick();
        return true;
    };
    Strip.prototype.current = function () { return this.items[this.index]; };
    TV.Strip = Strip;

    /* ---------- Grid (covers, 7 columns) ---------- */
    function Grid(opts) {
        this.clip = opts.clip;
        this.inner = el("div", "vod__gridin");
        this.inner.style.display = "block";
        this.clip.appendChild(this.inner);
        this.cols = opts.cols || 7;
        this.cw = opts.cw || 256; this.ch = opts.ch || 440;
        this.make = opts.make;
        this.onFocus = opts.onFocus || function () {};
        this.items = []; this.index = 0; this.scroll = 0; this.active = false; this.cards = {}; this.marked = -1; this.spare = null;
        this.viewH = opts.viewH || 840;
    }
    Grid.prototype.set = function (items, index) {
        this.items = items || []; this.index = TV.clamp(index || 0, 0, Math.max(0, this.items.length - 1));
        this.scroll = 0; this.inner.innerHTML = ""; this.cards = {};
        this.inner.style.height = Math.ceil(this.items.length / this.cols) * this.ch + "px";
        this.draw();
    };
    Grid.prototype.draw = function () {
        var row = Math.floor(this.index / this.cols), y = row * this.ch;
        if (y - this.scroll > this.viewH - this.ch * 1.1) this.scroll = y - this.viewH + this.ch * 1.1;
        if (y - this.scroll < 0) this.scroll = y;
        this.scroll = Math.max(0, this.scroll);
        /* The rows on screen are made now; the spare rows above and below a moment later, once the move is drawn */
        var seeFirst = Math.floor(this.scroll / this.ch), seeLast = Math.ceil((this.scroll + this.viewH) / this.ch);
        this.fill(seeFirst, seeLast);
        var self = this;
        TV.uncalm(this.spare);
        this.spare = TV.calm(function () { self.fillSlowly(Math.max(0, seeFirst - 2), seeLast + 3); }, 320);
        TV.lift(this.cards[this.index]);
        if (this.cards[this.marked]) this.cards[this.marked].classList.remove("is-focused");
        if (this.cards[this.index]) this.cards[this.index].classList.toggle("is-focused", this.active);
        this.marked = this.index;
        this.inner.style.transform = "translateY(" + (-this.scroll) + "px)";
    };
    /* Spare cards made a couple per frame: the screen never has to make a whole row in one frame */
    Grid.prototype.fillSlowly = function (firstRow, lastRow) {
        var self = this, todo = [], keep = {};
        for (var i = Math.max(0, firstRow) * this.cols; i < Math.min(this.items.length, lastRow * this.cols); i++) { keep[i] = 1; if (!this.cards[i]) todo.push(i); }
        for (var k in this.cards) if (!keep[k]) { this.inner.removeChild(this.cards[k]); delete this.cards[k]; }
        var gen = this.gen = (this.gen || 0) + 1;
        (function step() {
            if (self.gen !== gen) return;
            var n = 0;
            if (Date.now() - TV.keyAt < 300) return;       // a new move started: the next draw goes on
            if (TV.mark) TV.mark("spare");
            while (todo.length && n < 2) { var j = todo.shift(); if (!self.cards[j]) { self.fill(Math.floor(j / self.cols), Math.floor(j / self.cols) + 1, false, j); n++; } }
            if (todo.length) requestAnimationFrame(step);
        })();
    };
    Grid.prototype.fill = function (firstRow, lastRow, prune, only) {
        var keep = {};
        for (var i = Math.max(0, firstRow) * this.cols; i < Math.min(this.items.length, lastRow * this.cols); i++) {
            if (only !== undefined && i !== only) continue;
            var c = this.cards[i];
            if (!c) {
                c = this.make(this.items[i], i);
                c.style.position = "absolute";
                c.style.left = (i % this.cols) * this.cw + "px";
                c.style.top = Math.floor(i / this.cols) * this.ch + "px";
                this.inner.appendChild(c);
                if (c._art) c._art();
                this.cards[i] = c;
                if (i === this.index && this.active) c.classList.add("is-focused");
            }
            keep[i] = 1;
        }
        if (prune) for (var k in this.cards) if (!keep[k]) { this.inner.removeChild(this.cards[k]); delete this.cards[k]; }
    };
    Grid.prototype.focus = function (i) {
        if (!this.items.length) return false;
        i = TV.clamp(i, 0, this.items.length - 1);
        var t0 = Date.now(), had = Object.keys(this.cards).length;
        this.index = i; this.draw();
        this.onFocus(i, this.items[i], this.cards[i]);
        if (TV.DEV && Date.now() - t0 > 12) TV.log("grid move " + (Date.now() - t0) + " ms, cards " + had + " -> " + Object.keys(this.cards).length);
        return true;
    };
    Grid.prototype.move = function (dir) {
        var i = this.index, c = this.cols;
        if (dir === "left") { if (i % c === 0) return false; i--; }
        else if (dir === "right") { if (i % c === c - 1 || i + 1 >= this.items.length) return false; i++; }
        else if (dir === "up") { if (i < c) return false; i -= c; }
        else if (dir === "down") { if (Math.floor(i / c) >= Math.floor((this.items.length - 1) / c)) return false; i = Math.min(this.items.length - 1, i + c); }
        this.focus(i); TV.sound.tick();
        return true;
    };
    Grid.prototype.setActive = function (on) { this.active = on; if (this.cards[this.index]) this.cards[this.index].classList.toggle("is-focused", on); this.draw(); if (on) this.onFocus(this.index, this.items[this.index], this.cards[this.index]); };
    Grid.prototype.current = function () { return this.items[this.index]; };
    /* The same list with titles added or removed in the background (a genre such as Netflix still being
       found on TMDB): the focused title stays focused, on the same line of the screen, and the covers
       that did not move stay. Returns false when nothing changed. */
    Grid.prototype.update = function (items) {
        items = items || [];
        var old = this.items, cur = old[this.index], oldRow = Math.floor(this.index / this.cols), i;
        if (items.length === old.length) {
            for (i = 0; i < items.length && items[i] === old[i]; i++) {}
            if (i === items.length) return false;
        }
        var idx = cur ? items.indexOf(cur) : -1;
        if (idx < 0 && cur) for (i = 0; i < items.length; i++) if (items[i] && items[i].id === cur.id) { idx = i; break; }
        if (idx < 0) idx = Math.min(this.index, items.length - 1);
        if (this.cards[this.index]) this.cards[this.index].classList.remove("is-focused");
        for (var k in this.cards) if (items[k] !== old[k]) { this.inner.removeChild(this.cards[k]); delete this.cards[k]; }
        this.items = items;
        this.index = Math.max(0, idx);
        this.scroll = Math.max(0, this.scroll + (Math.floor(this.index / this.cols) - oldRow) * this.ch);
        this.inner.style.height = Math.ceil(items.length / this.cols) * this.ch + "px";
        this.marked = -1;
        this.draw();
        return true;
    };
    /* One cover made again (watched, progress): the others stay */
    Grid.prototype.refreshCard = function (i) {
        var c = this.cards[i];
        if (!c) return;
        this.inner.removeChild(c);
        delete this.cards[i];
        var row = Math.floor(i / this.cols);
        this.fill(row, row + 1, false, i);
        if (i === this.index) this.marked = i;
    };
    Grid.prototype.cardAt = function (i) { return this.cards[i]; };
    TV.Grid = Grid;

    /* ---------- cards ---------- */
    function putArt(node, im) {
        var old = node.querySelector(".card__img");
        if (old) node.removeChild(old);
        im.className = "card__img";
        node.insertBefore(im, node.firstChild);
        var fb = node.querySelector(".card__fallback");
        if (fb) fb.style.display = "none";
    }
    function artLoader(node, url, size, onFail) {
        url = TV.sized(url, size || "w342");
        return function () {
            if (!url) { if (onFail) onFail(); return; }
            var im = new Image();
            im.onerror = function () { if (onFail) onFail(); };
            im.onload = function () {
                // a provider's "no picture" image (a few pixels, or a tiny logo) counts as no cover
                if (im.naturalWidth < 60 || im.naturalHeight < 60) { if (onFail) onFail(); return; }
                if (TV.DEV) {
                    var st = TV._artStats = TV._artStats || { n: 0, w: 0, big: 0, tmdb: 0, max: 0 };
                    st.n++; st.w += im.naturalWidth; if (im.naturalWidth > 400) st.big++; if (url.indexOf("image.tmdb.org") >= 0) st.tmdb++; if (im.naturalWidth > st.max) st.max = im.naturalWidth;
                    if (st.n % 40 === 0) TV.log("art stats: " + st.n + " pictures, average width " + Math.round(st.w / st.n) + " px, wider than 400: " + st.big + ", widest " + st.max + ", from TMDB: " + st.tmdb);
                }
                var go = function () { TV.later(function () { putArt(node, im); }); };
                if (im.decode) im.decode().then(go, go); else go();
            };
            im.src = url;
        };
    }
    TV.card = {
        poster: function (item) {
            var c = el("div", "card card--poster"), art = el("div", "card__art");
            art.appendChild(el("div", "card__fallback", esc(item.title || item.name)));
            var rate = el("div", "card__rate");
            art.appendChild(rate);
            c.appendChild(art);
            c.appendChild(el("div", "card__cap", esc(item.title || item.name)));
            var sub = el("div", "card__sub", item.year ? String(item.year) : "");
            c.appendChild(sub);
            var r = TV.data.resumeOf(item.id);
            if (r && r.done && item.kind === "movie") art.appendChild(el("div", "card__seen", TV.icon("check", 22)));
            else if (r && r.dur && item.kind === "movie") { var b = el("div", "card__bar"); b.innerHTML = "<i style='width:" + Math.round(100 * r.pos / r.dur) + "%'></i>"; art.appendChild(b); }
            c._art = function () {
                // The provider's cover first; if it is missing or broken, TMDB's
                var found = null, failed = !item.poster, swapped = false;
                function fromTmdb() { if (failed && found && found.poster && !swapped) { swapped = true; artLoader(art, found.poster)(); } }
                if (item.poster) artLoader(art, item.poster, null, function () { failed = true; fromTmdb(); })();
                if (TV.meta.enabled()) TV.meta.want(item, function (m) {
                    if (!m) return;
                    found = m; fromTmdb();
                    if (m.imdb || (!item.year && m.year)) TV.later(function () {
                        if (m.imdb) rate.innerHTML = TV.meta.imdbBadge(m.imdb);
                        if (!item.year && m.year) sub.textContent = m.year;
                    });
                });
            };
            c._item = item;
            return c;
        },
        wide: function (item, opts) {
            opts = opts || {};
            var c = el("div", "card card--wide"), art = el("div", "card__art");
            art.appendChild(el("div", "card__fallback", esc(item.title || item.name)));
            var txt = el("div", "card__wtxt");
            txt.innerHTML = "<div class='card__wtitle'>" + esc(opts.title || item.title || item.name) + "</div><div class='card__wsub'>" + esc(opts.sub || "") + "</div>";
            art.appendChild(txt);
            if (opts.progress) { var b = el("div", "card__bar"); b.innerHTML = "<i style='width:" + Math.round(opts.progress * 100) + "%'></i>"; art.appendChild(b); }
            c.appendChild(art);
            c._art = function () {
                var url = opts.image || item.backdrop, failed = !url, found = null, swapped = false;
                function next() {
                    if (!failed || swapped) return;
                    if (found && found.backdrop) { swapped = true; artLoader(art, found.backdrop, "w780")(); }
                    else if (found !== null || !(TV.meta.enabled() && (item.kind === "movie" || item.kind === "series"))) { if (item.poster) { swapped = true; artLoader(art, item.poster)(); } }
                }
                if (url) artLoader(art, url, "w780", function () { failed = true; next(); })();
                if (TV.meta.enabled() && (item.kind === "movie" || item.kind === "series")) TV.meta.lookup(item).then(function (m) { found = m || false; next(); });
                else next();
            };
            c._item = item;
            return c;
        },
        channel: function (ch) {
            var c = el("div", "card card--channel"), art = el("div", "card__art");
            var logo = el("div", "card__logo" + (ch.logo ? "" : " card__logo--txt"), ch.logo ? "" : esc(ch.name));
            art.appendChild(logo);
            var now = el("div", "card__now"), bar = el("div", "card__bar");
            bar.innerHTML = "<i style='width:0'></i>";
            art.appendChild(now); art.appendChild(bar);
            art.appendChild(el("div", "card__live", "<span class='badge badge--live'>" + esc(T("LIVE")) + "</span>"));
            c.appendChild(art);
            c.appendChild(el("div", "card__cap", esc(ch.name)));
            c._art = function () {
                if (ch.logo) { var im = new Image(); im.onload = function () { logo.style.backgroundImage = TV.cssUrl(ch.logo); }; im.onerror = function () { logo.className = "card__logo card__logo--txt"; logo.textContent = ch.name; }; im.src = ch.logo; }
            };
            c._update = function () {
                var n = TV.epg.now(ch);
                now.textContent = n && n.cur ? n.cur[2] : "";
                bar.style.display = n && n.cur ? "" : "none";
                bar.firstChild.style.width = Math.round(TV.epg.progress(n && n.cur) * 100) + "%";
            };
            c._update();
            c._item = ch;
            return c;
        }
    };
    var logoOk = {}, logoBad = {}, logoWait = {};
    /* A logo fetched and decoded before its card appears: the move itself then costs nothing */
    TV.prefetchLogo = function (u) {
        if (!u || logoOk[u] || logoBad[u] || logoWait[u]) return;
        logoWait[u] = 1;
        var im = new Image();
        im.onload = function () {
            if (im.decode) im.decode().then(function () { logoOk[u] = 1; delete logoWait[u]; }, function () { logoOk[u] = 1; delete logoWait[u]; });
            else { logoOk[u] = 1; delete logoWait[u]; }
        };
        im.onerror = function () { logoBad[u] = 1; delete logoWait[u]; };
        im.src = u;
    };
    TV.logoBox = function (node, ch) {
        node.textContent = "";
        node.style.backgroundImage = "";
        var u = ch.logo;
        if (!u || logoBad[u]) { node.textContent = ch.name; return; }
        if (logoOk[u]) { node.style.backgroundImage = TV.cssUrl(u); return; }
        var im = new Image();
        im.onload = function () { logoOk[u] = 1; node.style.backgroundImage = TV.cssUrl(u); };
        im.onerror = function () { logoBad[u] = 1; node.textContent = ch.name; };
        im.src = u;
    };

    /* ---------- menu (OK held) ---------- */
    /* OK held on a movie or a series: More Info, My List, watched, hide it */
    TV.titleMenu = function (it, after, opts) {
        if (!it) return;
        opts = opts || {};
        var D = TV.data, inl = D.inMyList(it.id), name = it.title || it.name;
        function done() { if (after) after(); }
        var items = [
            { label: T("More Info"), icon: "info", run: function () { TV.detail.open(it, { push: TV.detail.isOpen() }); } },
            { label: inl ? T("Remove from My List") : T("Add to My List"), icon: inl ? "check" : "plus", run: function () { var on = D.toggleMyList(it.id); TV.toast(on ? T("Added to My List") : T("Removed from My List")); done(); } }
        ];
        if (it.kind === "movie") {
            var seen = D.isDone(it.id);
            items.push({ label: seen ? T("Mark as Unwatched") : T("Mark as Watched"), icon: "eyeCheck", run: function () { D.markWatched(it, null, !seen); done(); } });
        }
        if (opts.continueRow) items.push({ label: T("Remove from Continue Watching"), icon: "trash", run: function () { D.forget(it); TV.toast(T("Removed from Continue Watching")); done(); } });
        items.push({ label: T("Hide This Title"), icon: "eyeOff", run: function () {
            TV.alert({ title: T("Hide “{name}”?", { name: name }), message: T("It will no longer appear anywhere in APL TV. You can bring it back in Settings, Hidden Titles."), buttons: [
                { label: T("Cancel") },
                { label: T("Hide"), run: function () { D.setHidden(it, true); TV.toast(T("“{name}” is hidden", { name: name })); done(); } }
            ] });
        } });
        TV.menu(name, items);
    };
    /* OK held on a category of the playlist (Live TV, Movies, Series): hide it, or everything from its country */
    TV.categoryMenu = function (c, after) {
        if (!c || !c.kind) return;
        var D = TV.data, name = (c.tag ? c.tag + " · " : "") + c.name;
        function done() { if (after) after(); }
        var items = [{ label: T("Hide This Category"), icon: "eyeOff", run: function () {
            TV.alert({ title: T("Hide “{name}”?", { name: name }), message: T("Its channels, movies and series will no longer appear anywhere in APL TV. You can bring it back in Settings, Countries and Categories."), buttons: [
                { label: T("Cancel") },
                { label: T("Hide"), run: function () { D.setCatOff(c, true); TV.toast(T("“{name}” is hidden", { name: name })); done(); } }
            ] });
        } }];
        if (c.grp) {
            var g = D.offGroups().filter(function (x) { return x.id === c.grp; })[0], country = TV.smart.groupName(c.grp);
            items.push({ label: T("Hide Everything from {name}", { name: country }), icon: "eyeOff", run: function () {
                TV.alert({ title: T("Hide everything from {name}?", { name: country }), message: T("Its {n} categories will no longer appear anywhere in APL TV, nor the ones it adds later. You can bring them back in Settings, Countries and Categories.", { n: g ? g.cats.length : 1 }), buttons: [
                    { label: T("Cancel") },
                    { label: T("Hide"), run: function () { D.setGroupOff(c.grp, true); TV.toast(T("“{name}” is hidden", { name: country })); done(); } }
                ] });
            } });
        }
        TV.menu(name, items);
    };
    /* A menu longer than the screen (subtitle languages, versions…) scrolls inside its panel: the title
       stays, the chosen line is always in view, and a half line at the bottom shows there is more. */
    TV.menu = function (title, items) {
        var root = TV.$("menu"), panel = root.firstChild;
        panel.innerHTML = "";
        if (title) panel.appendChild(el("div", "menu__title", esc(title)));
        var list = el("div", "menu__list");
        panel.appendChild(list);
        var tiles = items.map(function (it) {
            var r = el("div", "menu__item" + (it.danger ? " is-danger" : ""), "<span class='menu__label'>" + esc(it.label) + "</span>" + (it.check ? "<span class='menu__check'>" + TV.icon("check", 30) + "</span>" : (it.icon ? TV.icon(it.icon, 30) : "")));
            list.appendChild(r);
            return r;
        });
        function inView(t) {
            var top = t.offsetTop, h = t.offsetHeight, view = list.clientHeight, s = list.scrollTop, room = 44;
            if (list.scrollHeight <= view + 1) return;
            if (top - room < s) list.scrollTop = Math.max(0, top - room);
            else if (top + h + room > s + view) list.scrollTop = top + h + room - view;
        }
        var nav = new TV.Nav({
            onFocus: function (i, t) { inView(t); },
            onSelect: function (i) { close(); if (items[i].run) items[i].run(); },
            onBack: close
        });
        function close() { root.classList.remove("is-open"); TV.popNav(nav); }
        root.classList.add("is-open");
        TV.pushNav(nav);
        nav.setTiles(tiles, Math.max(0, items.map(function (x) { return !!x.focus; }).indexOf(true)));
        return close;
    };

    /* ---------- alert ---------- */
    TV.alert = function (o) {
        var root = TV.$("alert");
        root.innerHTML = "";
        var box = el("div", "alert__box");
        box.appendChild(el("h2", "alert__title", esc(o.title || "")));
        if (o.message) box.appendChild(el("p", "alert__msg", esc(o.message)));
        if (o.node) box.appendChild(o.node);                     // a QR code, a picture…
        var btns = el("div", "alert__buttons");
        var buttons = o.buttons || [{ label: T("OK") }];
        var tiles = buttons.map(function (b) { var d = el("div", "alert__btn" + (b.danger ? " is-danger" : ""), esc(b.label)); btns.appendChild(d); return d; });
        box.appendChild(btns);
        root.appendChild(box);
        var nav = new TV.Nav({
            onSelect: function (i) { close(); if (buttons[i].run) buttons[i].run(); },
            onBack: function () { close(); if (o.onCancel) o.onCancel(); }
        });
        function close() { root.classList.remove("is-open"); TV.popNav(nav); }
        root.classList.add("is-open");
        TV.pushNav(nav);
        nav.setTiles(tiles, o.focus || 0);
        return close;
    };

    /* ---------- text input with the screen's keyboard ----------
       The hidden <input> takes the focus: the Samsung keyboard opens over the app.
       Done (or OK on it) keeps the text, Back / Cancel puts it back. */
    TV.editText = function (o) {
        var inp = TV.$("ime"), before = o.value || "";
        inp.type = o.secret ? "password" : (o.url ? "url" : "text");
        inp.value = before;
        var blocker = { key: function () {} };          // nothing else moves while typing
        TV.pushNav(blocker);
        var finished = false;
        function finish(keep) {
            if (finished) return;
            finished = true;
            inp.removeEventListener("keydown", onKey);
            inp.removeEventListener("input", onInput);
            inp.removeEventListener("blur", onBlur);
            try { inp.blur(); } catch (e) {}
            if (TV.ANDROID) { try { global.APLAndroid.editing(false); } catch (e) {} }
            TV.popNav(blocker);
            if (keep) { if (o.onDone) o.onDone(inp.value.trim()); }
            else { if (o.onInput) o.onInput(before); if (o.onCancel) o.onCancel(); }
        }
        function onKey(e) {
            var c = e.keyCode;
            if (c === 13 || c === TV.KEY.DONE) { e.preventDefault(); finish(true); }
            else if (c === TV.KEY.CANCEL || c === TV.KEY.RETURN || c === 27) { e.preventDefault(); finish(c === TV.KEY.RETURN ? true : false); }
        }
        function onInput() { if (o.onInput) o.onInput(inp.value); }
        function onBlur() { setTimeout(function () { finish(true); }, 50); }
        inp.addEventListener("keydown", onKey);
        inp.addEventListener("input", onInput);
        setTimeout(function () { inp.addEventListener("blur", onBlur); }, 300);
        // Android: the keys go to the keyboard while typing, and the keyboard is asked to open
        if (TV.ANDROID) { try { global.APLAndroid.editing(true); } catch (e) {} }
        setTimeout(function () { try { inp.focus(); if (inp.setSelectionRange) inp.setSelectionRange(inp.value.length, inp.value.length); } catch (e) {} }, 30);
    };

    /* A short text typed with the screen's keyboard, shown in a box while you type (a group's name...) */
    TV.prompt = function (o) {
        var root = TV.$("alert");
        root.innerHTML = "";
        var box = el("div", "alert__box");
        box.appendChild(el("h2", "alert__title", esc(o.title || "")));
        var field = el("div", "alert__field");
        function show(v) { field.innerHTML = v ? esc(v) : "<span class='alert__ph'>" + esc(o.placeholder || "") + "</span>"; }
        show(o.value || "");
        box.appendChild(field);
        box.appendChild(el("p", "alert__msg", esc(T("Type it with the keyboard, then OK."))));
        root.appendChild(box);
        root.classList.add("is-open");
        TV.editText({ value: o.value || "", onInput: show,
            onDone: function (v) { root.classList.remove("is-open"); v = String(v || "").trim(); if (v && o.onDone) o.onDone(v); },
            onCancel: function () { root.classList.remove("is-open"); } });
    };

    /* ---------- clock ---------- */
    function tick() { var c = TV.$("clock"); if (c) c.textContent = TV.hhmm(new Date()); }
    tick(); setInterval(tick, 10000);
})(window);
