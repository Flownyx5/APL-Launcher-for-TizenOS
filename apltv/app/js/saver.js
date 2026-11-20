/* ============================================================
   saver.js: screen protection for OLED screens (burn-in).
   An OLED screen can keep the ghost of an image left still for hours:
   the top bar, the clock, a paused movie, the Home page. With Screen
   Protection on (Automatic: on for the screens APL TV recognises as OLED):
   - the whole interface moves by a few pixels every 2 minutes, like the
     TV's own "screen shift" (the video itself does not move);
   - after 5 minutes without the remote while nothing plays: the screen
     saver, pictures from your catalog slowly moving (titles for all audiences
     only), dimmed, with the time,
     the date and the title in a corner, which changes every 3 minutes. Any
     key brings APL TV back (that key does nothing else).
   A video playing is never covered: it moves by itself.
   Recognising an OLED screen: LG says so itself (panelType); Samsung and
   Android TV sets by their model name (Samsung S85-S95, Sony A80-A95,
   Philips OLED…). An Android box cannot know the TV behind it: turn it on
   by hand there.
   ============================================================ */
(function (global) {
    "use strict";

    var TV = global.TV, T = TV.t;
    var SHIFT_MS = 120000, IDLE_MS = 5 * 60000, MOVE_CLOCK_MS = 3 * 60000, PICTURE_MS = 14000;
    var ORBIT = [[0, 0], [2, 1], [3, -1], [1, -3], [-2, -2], [-3, 1], [-1, 3], [1, 2]];

    /* ---------- which screen ---------- */
    var screen = null;
    function detect() {
        if (screen) return screen;
        var model = "", oled = false;
        try {
            if (TV.WEBOS) {
                var d = JSON.parse((global.webOSSystem || global.PalmSystem || {}).deviceInfo || "{}");
                model = d.modelName || "";
                oled = d.panelType ? /OLED/i.test(d.panelType) : /^OLED|^\d{2}LX\d/i.test(model);
            } else if (TV.TIZEN) {
                var p = global.webapis && global.webapis.productinfo;
                if (p) { try { model = p.getRealModel(); } catch (e) { model = p.getModel(); } }
                oled = /^(Q[AENS]|KQ)\d{2}S[89]\d[A-Z]/i.test(model || "");
            } else if (TV.ANDROID && global.APLAndroid && global.APLAndroid.model) {
                model = global.APLAndroid.model() || "";
                oled = /OLED|\bXR-?\d{2}A[789]\d|\bKD-?\d{2}A[89]\d|BRAVIA.*\bA[789]\d[A-Z]?\b/i.test(model);
            }
        } catch (e) { TV.log("screen type: " + e.message); }
        screen = { model: String(model || "").replace(/\..*$/, ""), oled: oled };
        TV.log("screen " + (screen.model || "unknown") + ": " + (oled ? "OLED" : "not recognised as OLED"));
        return screen;
    }
    function on() {
        var p = TV.pref("screenSaver");
        return p === "on" || (p !== "off" && detect().oled);
    }

    /* ---------- a few pixels, every 2 minutes ---------- */
    var step = 0;
    function shift(reset) {
        var o = reset || !on() ? [0, 0] : ORBIT[step = (step + 1) % ORBIT.length];
        document.body.style.transform = o[0] || o[1] ? "translate(" + o[0] + "px," + o[1] + "px)" : "";
        // the LG's picture is part of the page: it stays where it is
        var v = document.querySelector("video.pvideo");
        if (v) v.style.transform = o[0] || o[1] ? "translate(" + (-o[0]) + "px," + (-o[1]) + "px)" : "";
    }

    /* ---------- the screen saver ---------- */
    var root = null, layers = [], clock = null, shown = false, pics = [], picIndex = 0, timers = [];
    function build() {
        root = document.createElement("div");
        root.className = "saver";
        for (var i = 0; i < 2; i++) { var l = document.createElement("div"); l.className = "saver__pic"; root.appendChild(l); layers.push(l); }
        ["t", "b"].forEach(function (s) { var sh = document.createElement("div"); sh.className = "saver__shade saver__shade--" + s; root.appendChild(sh); });
        // Like the Apple TV: the time in a corner, the same margins as the interface, the date and the
        // title of the picture under it
        clock = document.createElement("div");
        clock.className = "saver__clock";
        clock.innerHTML = "<b class='saver__time'></b><span class='saver__date'></span><span class='saver__title'></span>";
        root.appendChild(clock);
        document.body.appendChild(root);
    }
    function playing() {
        return !!(TV.ytPlaying || (TV.player && TV.player.state && TV.player.state() === "PLAYING"));
    }
    /* The block changes corner every few minutes (bottom left, bottom right, top right, top left):
       never the same pixels lit for long, always neatly framed */
    var CORNERS = ["bl", "br", "tr", "tl"], corner = -1;
    function tickClock(move) {
        var d = new Date();
        clock.firstChild.textContent = TV.hhmm(d);
        var date = "";
        try { date = d.toLocaleDateString(TV.locale, { weekday: "long", day: "numeric", month: "long" }); } catch (e) {}
        clock.children[1].textContent = date;
        if (!move) return;
        clock.classList.remove("is-on");
        setTimeout(function () {
            if (!shown) return;
            corner = (corner + 1) % CORNERS.length;
            root.setAttribute("data-corner", CORNERS[corner]);
            clock.classList.add("is-on");
        }, corner < 0 ? 0 : 1000);
    }
    /* Pictures from what Home shows (trending, then new), so nothing you hid comes back here */
    function gather() {
        var D = TV.data, items = [];
        try {
            ["movies", "series"].forEach(function (k) { items = items.concat(D.itemsIn(k, "trend").slice(0, 20), D.itemsIn(k, "new").slice(0, 10)); });
            // nothing trending or new in this catalog (a small playlist, no TMDB lists): any of its titles
            if (items.length < 8) ["movies", "series"].forEach(function (k) {
                var all = (D.catalog() || {})[k], list = all && all.items || [];
                for (var n = 0; n < 40 && list.length; n++) {
                    var x = list[Math.floor(Math.random() * list.length)];
                    if (x && !D.isHidden(x) && !D.catOf(x).adult && items.indexOf(x) < 0) items.push(x);
                }
            });
        } catch (e) {}
        items.sort(function () { return Math.random() - 0.5; });
        // more than it shows: only the titles for all audiences are kept
        items.slice(0, 48).forEach(function (it) {
            if (!TV.meta || !TV.meta.lookup || !TV.meta.allAges) return;
            TV.meta.lookup(it).then(function (m) {
                var url = (m && m.backdrop) || it.backdrop;
                if (!url) return;
                // all audiences only (Tous publics, U, G…): nothing rated -10, -12 or above, nothing unrated
                TV.meta.allAges(it).then(function (ok) {
                    if (ok && !pics.some(function (p) { return p.url === url; })) pics.push({ url: url, title: (m && m.title) || it.title || it.name || "" });
                });
            }).catch(function () {});
        });
    }
    function nextPicture() {
        if (!shown || !pics.length) return;
        var pic = pics[picIndex++ % pics.length], url = TV.sized(pic.url, "w1280");
        var front = layers[picIndex % 2], back = layers[(picIndex + 1) % 2], title = clock.children[2];
        var img = new Image();
        img.onload = function () {
            if (!shown) return;
            front.style.backgroundImage = TV.cssUrl(url);
            front.classList.remove("is-moving"); void front.offsetWidth;
            front.classList.toggle("is-left", Math.random() < 0.5);
            front.classList.add("is-moving", "is-on");
            back.classList.remove("is-on");
            title.classList.remove("is-on");
            setTimeout(function () { title.textContent = pic.title; title.classList.add("is-on"); }, 700);
        };
        img.src = url;
    }
    function show() {
        if (shown) return;
        if (!root) build();
        shown = true;
        if (!pics.length) gather();
        root.classList.add("is-on");
        tickClock(true);
        timers.push(setInterval(function () { tickClock(true); }, MOVE_CLOCK_MS));
        timers.push(setInterval(function () { tickClock(false); }, 10000));
        setTimeout(nextPicture, 1500);
        timers.push(setInterval(nextPicture, PICTURE_MS));
        TV.log("screen saver on");
    }
    function hide() {
        if (!shown) return;
        shown = false;
        timers.forEach(clearInterval); timers = [];
        root.classList.remove("is-on");
        layers.forEach(function (l) { l.classList.remove("is-on", "is-moving"); });
    }

    // Any key while the saver shows only brings APL TV back
    document.addEventListener("keydown", function (e) {
        if (!shown) return;
        e.preventDefault(); e.stopPropagation(); if (e.stopImmediatePropagation) e.stopImmediatePropagation();
        hide();
        TV.keyAt = Date.now();
    }, true);
    document.addEventListener("mousemove", function () { if (shown) { hide(); TV.keyAt = Date.now(); } }, true);

    var bootAt = Date.now();
    setInterval(function () {
        if (!on() || document.hidden) { if (shown) hide(); return; }
        var idle = Date.now() - Math.max(TV.keyAt || 0, bootAt);
        if (!shown && idle >= IDLE_MS && !playing()) show();
        if (shown && playing()) hide();
    }, 5000);
    setInterval(function () { shift(false); }, SHIFT_MS);
    TV.onPref(function (k) { if (k === "screenSaver") { shift(!on()); if (!on()) hide(); } });

    TV.saver = { screen: detect, on: on, show: show, hide: hide, isShown: function () { return shown; } };
})(window);
