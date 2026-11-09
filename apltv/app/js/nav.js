/* ============================================================
   nav.js: the remote, as in APL Launcher.
   - Screen stack: only the top screen gets the keys. A screen is any
     object with key(code, e) and, optionally, ok(), longOk(), canHold().
     TV.pushNav(screen) when it opens, TV.popNav(screen) when it closes.
   - One press = one action: the M8's remote sends repeats and
     "released, pressed" pairs on a single slightly long press; they only
     count after 600 ms, at a steady pace, and only for the arrows.
   - OK held 600 ms = longOk() (the menu), a short press = ok() on release.
   - TV.Nav: focus by on-screen geometry, for small sets (buttons, menus,
     settings rows). Long lists use the index-based lists of ui.js.
   ============================================================ */
(function (global) {
    "use strict";

    var TV = global.TV;
    var KEY = TV.KEY = {
        LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40, ENTER: 13,
        RETURN: 10009, ESC: 27, BACKSPACE: 8, EXIT: 10182,
        PLAY: 415, PAUSE: 19, PLAYPAUSE: 10252, STOP: 413, FF: 417, RW: 412, PREV: 10232, NEXT: 10233,
        CH_UP: 427, CH_DOWN: 428, PREV_CH: 10190, CH_LIST: 10073, GUIDE: 458, INFO: 457,
        RED: 403, GREEN: 404, YELLOW: 405, BLUE: 406,
        DONE: 65376, CANCEL: 65385, PAGE_UP: 33, PAGE_DOWN: 34
    };
    // LG remotes (webOS): Back is 461, the channel keys are Page Up / Page Down
    if (TV.WEBOS) { KEY.RETURN = 461; KEY.CH_UP = 33; KEY.CH_DOWN = 34; }
    TV.isBack = function (c) { return c === KEY.RETURN || c === KEY.ESC || c === KEY.BACKSPACE; };
    TV.digit = function (c) { return c >= 48 && c <= 57 ? c - 48 : (c >= 96 && c <= 105 ? c - 96 : -1); };

    /* ---------- one press = one action ---------- */
    var ARROW_HOLD_MS = 450, ARROW_EVERY_MS = 95, REPRESS_GAP_MS = 20, HOLD_MIN_MS = 250;
    var lastKey = 0, pressedAt = 0, actedAt = 0, releasedAt = 0;
    var downAt = 0, keyDown = false, upAt = 0;          // wall clock (Date.now) for "is the key held"
    function isArrow(c) { return c >= KEY.LEFT && c <= KEY.DOWN; }
    function counts(e) {
        var code = e.keyCode, now = e.timeStamp || Date.now();
        var repeat = code === lastKey && (e.repeat || now - releasedAt < REPRESS_GAP_MS);
        if (repeat && !e.repeat && now - pressedAt < HOLD_MIN_MS) repeat = false;
        keyDown = true;
        if (!repeat) { lastKey = code; pressedAt = actedAt = now; downAt = Date.now(); return true; }
        if (!isArrow(code) || now - pressedAt < ARROW_HOLD_MS || now - actedAt < ARROW_EVERY_MS) return false;
        actedAt = now;
        return true;
    }
    /* Held = the same key kept down for more than 450 ms. (e.timeStamp counts from the page's start, not
       from 1970: it was compared with Date.now() here, so every press looked held and the steps of the
       timeline grew by themselves.) */
    TV.isHeld = function () { return (keyDown || Date.now() - upAt < 60) && Date.now() - downAt > ARROW_HOLD_MS; };

    /* ---------- motion helpers ----------
       TV.calm(fn, ms): fn runs once no key has come for ms, so the motion of the last press is over
       (programme info, spare cards, pictures and backdrops never interrupt a move).
       TV.lift(a, b, ...): these items (the focused one and its neighbours) become separate layers in
       advance: growing, shrinking and sliding are then only moved by the graphics chip, nothing is
       drawn again. They go back into their row once the remote has been still for a moment. */
    TV.keyAt = 0;
    TV.calm = function (fn, ms) {
        var h = { t: 0, dead: false };
        ms = ms || 300;
        function wait() {
            if (h.dead) return;
            var left = TV.keyAt + ms - Date.now();
            if (left > 0) h.t = setTimeout(wait, left + 5);
            else { h.dead = true; fn(); }
        }
        h.t = setTimeout(wait, 40);
        return h;
    };
    TV.uncalm = function (h) { if (h && h.t !== undefined) { h.dead = true; clearTimeout(h.t); } };
    /* TV.later(fn): a small screen update that can wait (a rating, a year, a picture arriving) is made
       between moves, six at most per frame, instead of at the moment it arrives */
    var laterQ = [], laterWait = false;
    function laterKick() {
        if (laterWait) return;
        laterWait = true;
        TV.calm(function () { requestAnimationFrame(laterRun); }, 220);
    }
    function laterRun() {
        laterWait = false;
        if (!laterQ.length) return;
        if (Date.now() - TV.keyAt < 220) { laterKick(); return; }
        if (TV.mark) TV.mark("later");
        var t0 = Date.now(), n = 0;
        while (laterQ.length && n < 6 && Date.now() - t0 < 6) { n++; try { laterQ.shift()(); } catch (e) {} }
        if (laterQ.length) { laterWait = true; requestAnimationFrame(laterRun); }
    }
    TV.later = function (fn) { laterQ.push(fn); laterKick(); };

    var lifted = [], liftGen = 0, liftDrop = null, LIFT_MAX = 24;
    TV.lift = function () {
        liftGen++;
        for (var i = 0; i < arguments.length; i++) {
            var e = arguments[i];
            if (!e || !e.classList) continue;
            if (!e._lift) { e.classList.add("is-lift"); lifted.push(e); }
            e._lift = liftGen;
        }
        while (lifted.length > LIFT_MAX) {          // arrow held: the oldest ones, long done moving, go back
            var j = 0;
            while (j < lifted.length && lifted[j]._lift === liftGen) j++;
            if (j >= lifted.length) break;
            var x = lifted.splice(j, 1)[0];
            x._lift = 0; x.classList.remove("is-lift");
        }
        TV.uncalm(liftDrop);
        liftDrop = TV.calm(function () {
            if (TV.mark) TV.mark("unlift");
            var keep = [];
            for (var k = 0; k < lifted.length; k++) {
                var y = lifted[k];
                if (y._lift === liftGen && document.body.contains(y)) keep.push(y);
                else { y._lift = 0; y.classList.remove("is-lift"); }
            }
            lifted = keep;
        }, 700);
    };

    /* ---------- OK held ---------- */
    var LONG_MS = 600, GAP_MS = 45;
    var seenKeyUp = false, swallowEnter = 0, hold = null;

    /* The focused item shrinks a little the moment OK goes down: the answer is seen at once */
    function pressed() {
        var f = document.querySelectorAll(".is-focused"), t = f[f.length - 1];
        if (!t) return;
        t.classList.add("is-pressed");
        setTimeout(function () { t.classList.remove("is-pressed"); }, 140);
    }
    function okShort(scr) { if (scr.ok) scr.ok(); else if (scr.key) scr.key(KEY.ENTER); }
    function holdStart(scr) {
        if (hold) {
            hold.rep = true;
            if (hold.release) { clearTimeout(hold.release); hold.release = null; }
            if (Date.now() - hold.at >= HOLD_MIN_MS) holdFire();
            return;
        }
        var h = hold = { scr: scr, rep: false, release: null, at: Date.now() };
        TV.sound.select();
        pressed();
        if (scr.onHoldStart) scr.onHoldStart();
        h.t = setTimeout(function () {
            if (hold !== h) return;
            if (h.release && !h.rep) return;
            if (!h.rep && !seenKeyUp) { hold = null; okShort(h.scr); return; }
            holdFire();
        }, LONG_MS);
    }
    function holdFire() {
        var h = hold; if (!h) return;
        clearTimeout(h.t); if (h.release) clearTimeout(h.release);
        hold = null;
        if (top() !== h.scr) return;
        swallowEnter = Date.now();
        h.scr.longOk();
    }
    function holdEnd() {
        var h = hold; if (!h) return;
        clearTimeout(h.t); if (h.release) clearTimeout(h.release);
        hold = null;
        if (top() === h.scr) okShort(h.scr);
    }

    /* ---------- screen stack ---------- */
    var stack = [], hotkeys = [];
    function top() { return stack[stack.length - 1] || null; }
    TV.pushNav = function (s) { var i = stack.indexOf(s); if (i !== -1) stack.splice(i, 1); stack.push(s); };
    TV.popNav = function (s) { var i = stack.indexOf(s); if (i !== -1) stack.splice(i, 1); };
    TV.topNav = top;
    TV.addHotkey = function (fn) { hotkeys.push(fn); };
    TV.onAnyKey = null;

    global.addEventListener("keydown", function (e) {
        var ae = document.activeElement;
        if (ae && (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA")) return;   // typing: the field has the keys
        var code = e.keyCode;
        if (code !== KEY.ENTER && !counts(e)) { e.preventDefault(); return; }
        TV.keyAt = Date.now();
        if (code === KEY.ENTER && swallowEnter) {
            if (Date.now() - swallowEnter < 450) { swallowEnter = Date.now(); e.preventDefault(); return; }
            swallowEnter = 0;
        }
        if (TV.onAnyKey) TV.onAnyKey(e);
        for (var i = 0; i < hotkeys.length; i++) if (hotkeys[i](code, e) === true) { e.preventDefault(); return; }
        var s = top();
        if (!s) return;
        e.preventDefault();
        if (code === KEY.ENTER) {
            if (s.longOk && (!s.canHold || s.canHold())) { holdStart(s); return; }
            if (!e.repeat) { TV.sound.select(); pressed(); okShort(s); }
            return;
        }
        if (TV.isBack(code)) TV.sound.back();
        var t0 = TV.DEV ? Date.now() : 0;
        if (TV.mark) TV.mark("key");
        if (s.key) s.key(code, e);
        // Development builds: how long a press takes to show on screen (two frames later = painted)
        if (TV.DEV && TV.perf) requestAnimationFrame(function () { requestAnimationFrame(function () { TV.perf.key(Date.now() - t0); }); });
    }, false);

    global.addEventListener("keyup", function (e) {
        if (e.keyCode === lastKey) { releasedAt = e.timeStamp || Date.now(); keyDown = false; upAt = Date.now(); }
        if (e.keyCode !== KEY.ENTER) return;
        seenKeyUp = true;
        if (swallowEnter && Date.now() - swallowEnter < 450) { swallowEnter = Date.now(); return; }
        swallowEnter = 0;
        if (hold) {
            var h = hold;
            if (h.release) clearTimeout(h.release);
            h.release = setTimeout(function () { if (hold === h) holdEnd(); }, GAP_MS);
        }
    }, false);

    /* ---------- geometric focus (small sets) ---------- */
    function Nav(opts) {
        opts = opts || {};
        this.tiles = [];
        this.index = -1;
        this.onFocus = opts.onFocus || function () {};
        this.onSelect = opts.onSelect || function () {};
        this.onBack = opts.onBack || function () {};
        this.onEdge = opts.onEdge || function () {};
        this.onKey = opts.onKey || null;
        this.onLongPress = opts.onLongPress || null;
        this.cross = opts.cross || 3;
        if (this.onLongPress) {
            var self = this;
            this.longOk = function () { if (self.current()) self.onLongPress(self.index, self.current()); };
            this.canHold = opts.canHold ? function () { return opts.canHold(self.index); } : null;
        }
    }
    Nav.prototype.setTiles = function (tiles, keep) {
        var prev = this.current();
        if (prev) prev.classList.remove("is-focused");
        this.tiles = tiles;
        var i = typeof keep === "number" ? keep : (keep && this.index >= 0 ? Math.min(this.index, tiles.length - 1) : 0);
        this.index = -1;
        if (tiles.length) this.focus(Math.max(0, Math.min(i, tiles.length - 1)));
    };
    Nav.prototype.current = function () { return this.tiles[this.index] || null; };
    Nav.prototype.focus = function (i) {
        if (i < 0 || i >= this.tiles.length) return;
        var prev = this.tiles[this.index];
        if (prev) prev.classList.remove("is-focused");
        this.index = i;
        TV.lift(this.tiles[i]);
        this.tiles[i].classList.add("is-focused");
        this.onFocus(i, this.tiles[i]);
    };
    Nav.prototype.blur = function () { var c = this.current(); if (c) c.classList.remove("is-focused"); };
    Nav.prototype.refocus = function () { var c = this.current(); if (c) { c.classList.add("is-focused"); this.onFocus(this.index, c); } };
    function box(el) { var r = el.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom, x: r.left + r.width / 2, y: r.top + r.height / 2 }; }
    function gap(p, a, b) { return p < a ? a - p : (p > b ? p - b : 0); }
    Nav.prototype.neighbour = function (dir) {
        var from = this.current();
        if (!from) return -1;
        var a = box(from), best = -1, bestScore = Infinity;
        for (var i = 0; i < this.tiles.length; i++) {
            if (i === this.index) continue;
            var c = box(this.tiles[i]), dx = c.x - a.x, dy = c.y - a.y, primary, cross, ok;
            switch (dir) {
                case "left":  ok = dx < -4; primary = -dx; cross = gap(a.y, c.t, c.b) * this.cross + Math.abs(dy) * 0.3; break;
                case "right": ok = dx > 4;  primary = dx;  cross = gap(a.y, c.t, c.b) * this.cross + Math.abs(dy) * 0.3; break;
                case "up":    ok = dy < -4; primary = -dy; cross = gap(a.x, c.l, c.r) * this.cross + Math.abs(dx) * 0.3; break;
                case "down":  ok = dy > 4;  primary = dy;  cross = gap(a.x, c.l, c.r) * this.cross + Math.abs(dx) * 0.3; break;
            }
            if (!ok) continue;
            var score = primary + cross;
            if (score < bestScore) { bestScore = score; best = i; }
        }
        return best;
    };
    Nav.prototype.move = function (dir) {
        var n = this.neighbour(dir);
        if (n !== -1) { this.focus(n); TV.sound.tick(); return true; }
        if (this.onEdge(dir) !== true) TV.sound.edge();
        return false;
    };
    Nav.prototype.ok = function () { if (this.current()) this.onSelect(this.index, this.current()); };
    Nav.prototype.key = function (code, e) {
        if (this.onKey && this.onKey(code, e) === true) return;
        switch (code) {
            case KEY.LEFT: this.move("left"); break;
            case KEY.RIGHT: this.move("right"); break;
            case KEY.UP: this.move("up"); break;
            case KEY.DOWN: this.move("down"); break;
            default: if (TV.isBack(code)) this.onBack();
        }
    };
    TV.Nav = Nav;

    // Mouse (PC preview): click = focus + OK on a Nav's tile
    global.addEventListener("click", function (e) {
        var s = top();
        if (!s || !s.tiles) return;
        for (var el = e.target; el && el !== document; el = el.parentNode) {
            var i = s.tiles.indexOf(el);
            if (i !== -1) { s.focus(i); s.ok(); return; }
        }
    }, false);
})(window);
