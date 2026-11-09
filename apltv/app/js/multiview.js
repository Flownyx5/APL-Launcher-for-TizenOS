/* ============================================================
   multiview.js: up to 4 channels at once (TiviMate's Multiview).
   The first tile plays with sound (AVPlay); the others are silent extra
   players (AVPlayStore on recent screens, else a <video>). Whether a
   screen can decode several streams at once depends on its chip: a tile
   that cannot play says so.
   Arrows: choose a tile. OK: empty tile -> pick a channel; full tile ->
   its sound (it becomes the main one). OK held: full screen, change,
   remove. Back: full screen on the channel with sound.
   ============================================================ */
(function (global) {
    "use strict";

    var TV = global.TV, el = TV.el, esc = TV.esc, T = TV.t, D = TV.data, K = TV.KEY;
    var root, slots = [null, null, null, null], players = [null, null, null, null], tiles = [], focus = 0, open = false, layout = 2;
    var picker = null;

    function rects() {
        if (layout === 2) return [[0, 270, 960, 540], [960, 270, 960, 540]];
        return [[0, 0, 960, 540], [960, 0, 960, 540], [0, 540, 960, 540], [960, 540, 960, 540]];
    }

    /* ---------- extra (silent) players ---------- */
    function Extra(i) { this.i = i; this.kind = ""; this.p = null; this.v = null; this.obj = null; }
    Extra.prototype.play = function (url, r, onErr) {
        this.stop();
        var store = global.webapis && global.webapis.avplaystore;
        var self = this;
        if (store && store.getPlayer && !TV.PREVIEW) {
            try {
                this.obj = el("object"); this.obj.type = "application/avplayer";
                this.obj.style.cssText = "position:fixed;left:0;top:0;width:1920px;height:1080px";
                TV.$("mv").appendChild(this.obj);
                this.p = store.getPlayer();
                this.p.open(url);
                this.p.setListener({ onerror: function (e) { TV.log("multiview extra error " + e); onErr(String(e)); }, onbufferingstart: function () {}, onbufferingcomplete: function () {} });
                this.p.setDisplayRect(r[0], r[1], r[2], r[3]);
                this.p.prepareAsync(function () { try { self.p.play(); } catch (e) { onErr(e.message); } }, function (e) { TV.log("multiview extra prepare " + (e && e.name)); onErr(String(e && e.name || e)); });
                this.kind = "store";
                TV.log("multiview: tile " + this.i + " with AVPlayStore");
                return;
            } catch (e) { TV.log("avplaystore unavailable: " + e.message); this.stop(); }
        }
        var v = this.v = el("video", "pvideo");
        v.muted = true; v.autoplay = true;
        v.style.left = r[0] + "px"; v.style.top = r[1] + "px"; v.style.width = r[2] + "px"; v.style.height = r[3] + "px";
        TV.$("mv").appendChild(v);
        v.addEventListener("error", function () { onErr("video " + (v.error && v.error.code)); });
        v.src = url;
        var pr = v.play(); if (pr && pr.catch) pr.catch(function (e) { onErr(e.message); });
        this.kind = "video";
        TV.log("multiview: tile " + this.i + " with <video>");
    };
    Extra.prototype.stop = function () {
        if (this.p) { try { this.p.stop(); } catch (e) {} try { this.p.close(); } catch (e) {} this.p = null; }
        if (this.obj && this.obj.parentNode) this.obj.parentNode.removeChild(this.obj);
        if (this.v) { try { this.v.pause(); this.v.removeAttribute("src"); this.v.load(); } catch (e) {} if (this.v.parentNode) this.v.parentNode.removeChild(this.v); this.v = null; }
        this.obj = null; this.kind = "";
    };

    /* ---------- tiles ---------- */
    function draw() {
        root.innerHTML = "";
        tiles = [];
        var rs = rects();
        rs.forEach(function (r, i) {
            var t = el("div", "mvt" + (i === 0 && slots[0] ? " is-audio" : ""));
            t.style.left = r[0] + "px"; t.style.top = r[1] + "px"; t.style.width = r[2] + "px"; t.style.height = r[3] + "px";
            var ch = slots[i];
            if (!ch) t.innerHTML = "<div class='mvt__empty'><div class='mvt__plus'>" + TV.icon("plus", 44) + "</div><span>" + esc(T("Add a channel")) + "</span></div>";
            else {
                t.innerHTML = "<div class='mvt__label'><span class='mvt__audio'>" + TV.icon("speaker", 22) + "</span><span>" + esc(ch.num + "  " + ch.name) + "</span></div>" +
                    (ch._mvErr ? "<div class='mvt__err'>" + esc(T("This screen cannot play one more channel at once.")) + "</div>" : "");
            }
            if (i === focus) t.classList.add("is-focused");
            root.appendChild(t);
            tiles.push(t);
        });
        root.appendChild(el("div", "mvui__hint", esc(T("OK: sound or add · Hold OK: options · Back: full screen"))));
    }
    function start(i) {
        var ch = slots[i], r = rects()[i];
        if (!ch) return;
        ch._mvErr = false;
        if (i === 0) {
            TV.player.play(D.streamUrl(ch), { live: true, rect: r, onError: function (e) { TV.log("multiview main: " + e); } });
            D.pushRecent(ch.id);
        } else {
            players[i] = players[i] || new Extra(i);
            players[i].play(D.streamUrl(ch), r, function (e) { ch._mvErr = true; draw(); });
        }
    }
    function restartAll() {
        for (var i = 1; i < 4; i++) if (players[i]) players[i].stop();
        TV.player.stop();
        slots.forEach(function (c, i) { if (c && i < rects().length) start(i); });
    }
    function setLayout() {
        var n = slots.filter(Boolean).length, before = layout;
        layout = n > 2 || (slots[2] || slots[3]) ? 4 : 2;
        return before !== layout;
    }

    function openMv(chans) {
        if (!root) root = TV.$("mvui");
        TV.osd.close();
        slots = [null, null, null, null];
        (chans || []).slice(0, 4).forEach(function (c, i) { slots[i] = c; });
        focus = slots[1] ? 0 : 1;
        setLayout();
        open = true;
        root.classList.add("is-on");
        document.body.classList.add("is-fullscreen");
        TV.pushNav(screen);
        draw();
        restartAll();
    }
    function closeMv(toFull) {
        open = false;
        for (var i = 1; i < 4; i++) if (players[i]) players[i].stop();
        root.classList.remove("is-on");
        document.body.classList.remove("is-fullscreen");
        TV.popNav(screen);
        var main = slots[0];
        if (toFull && main) { TV.player.stop(); TV.live.play(main); }
        else { TV.player.stop(); if (TV.shell) TV.shell.refreshView(); }
    }

    /* ---------- channel picker ---------- */
    function pick(i) {
        var seen = {}, items = [];
        D.favChannels().concat(D.recentChannels()).forEach(function (c) { if (!seen[c.id]) { seen[c.id] = 1; items.push(c); } });
        var cat = TV.pref("liveCat");
        if (cat && cat !== "fav" && cat !== "recent") D.channelsIn(cat).forEach(function (c) { if (!seen[c.id]) { seen[c.id] = 1; items.push(c); } });
        if (items.length < 10) D.channelsIn("all").slice(0, 300).forEach(function (c) { if (!seen[c.id]) { seen[c.id] = 1; items.push(c); } });
        var box = el("div", "osd__list");
        box.style.cssText = "opacity:1;transform:none;z-index:5;left:" + (i % 2 ? 1160 : 40) + "px";
        box.appendChild(el("div", "osd__listhead", "<span>" + esc(T("Add a channel")) + "</span><small>" + items.length + "</small>"));
        var clip = el("div", "osd__listclip");
        box.appendChild(clip);
        root.appendChild(box);
        var vl = new TV.VList({ clip: clip, rowH: 100, viewH: 880, render: function (c) {
            var r = el("div", "crow"), logo = el("div", "crow__logo"); TV.logoBox(logo, c);
            r.appendChild(el("div", "crow__num", String(c.num))); r.appendChild(logo);
            var n = TV.epg.now(c);
            r.appendChild(el("div", "crow__txt", "<div class='crow__name'>" + esc(c.name) + "</div><div class='crow__prog'>" + (n && n.cur ? esc(n.cur[2]) : "&nbsp;") + "</div>"));
            return r;
        } });
        vl.set(items, 0); vl.setActive(true);
        picker = {
            key: function (code) {
                if (code === K.UP) vl.move(-1); else if (code === K.DOWN) vl.move(1);
                else if (TV.isBack(code) || code === K.LEFT || code === K.RIGHT) done(null);
            },
            ok: function () { done(vl.current()); }
        };
        function done(c) {
            TV.popNav(picker); picker = null;
            root.removeChild(box);
            if (!c) return;
            slots[i] = c;
            if (setLayout()) { draw(); restartAll(); } else { draw(); start(i); }
        }
        TV.pushNav(picker);
    }

    var screen = {
        key: function (code) {
            var n = rects().length, cols = 2;
            if (code === K.LEFT && focus % cols === 1) focus--;
            else if (code === K.RIGHT && focus % cols === 0 && focus + 1 < n) focus++;
            else if (code === K.UP && focus >= cols) focus -= cols;
            else if (code === K.DOWN && focus + cols < n) focus += cols;
            else if (code === K.DOWN && layout === 2) { layout = 4; draw(); restartAll(); focus = 2; }
            else if (TV.isBack(code)) { closeMv(true); return; }
            else { TV.sound.edge(); return; }
            TV.sound.tick();
            draw();
        },
        ok: function () {
            var ch = slots[focus];
            if (!ch) { pick(focus); return; }
            if (focus === 0) return;
            // This tile's sound: it becomes the main one
            var main = slots[0]; slots[0] = ch; slots[focus] = main; focus = 0;
            draw(); restartAll();
        },
        canHold: function () { return !!slots[focus]; },
        longOk: function () {
            var ch = slots[focus], i = focus;
            TV.menu(ch.num + "  " + ch.name, [
                { label: T("Full Screen"), icon: "tv", run: function () { var m = slots[0]; slots[0] = ch; slots[i] = m; closeMv(true); } },
                { label: T("Change Channel"), icon: "list", run: function () { pick(i); } },
                { label: T("Remove"), icon: "trash", danger: true, run: function () {
                    if (players[i]) players[i].stop();
                    if (i === 0) { TV.player.stop(); slots[0] = null; for (var k = 1; k < 4; k++) if (slots[k]) { slots[0] = slots[k]; slots[k] = null; break; } }
                    else slots[i] = null;
                    setLayout(); draw(); restartAll();
                } }
            ]);
        }
    };

    TV.multiview = { open: openMv, isOpen: function () { return open; }, close: function () { if (open) closeMv(false); } };
})(window);
