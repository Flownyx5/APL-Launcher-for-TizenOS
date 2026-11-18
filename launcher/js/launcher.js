/* ============================================================
   launcher.js — tvOS Home Screen.

   Three states, driven only by where the focus is:
     shelf : focus in the dock (top row). The app's artwork fills
             the whole screen, the 2nd row peeks out at the bottom.
     grid  : focus in a lower row. Everything moves up, the artwork
             becomes a blurred background, the app's name shows under its icon.
     full  : ▲ from the dock (if the app has artwork). The interface slides
             off the screen; ▼ / Back brings it back, OK opens the app.
   ============================================================ */
(function (global) {
    "use strict";

    var APL = global.APL;
    var DOCK_SIZE = 6;           // apps per row, dock included: Settings › Home Screen › Apps per Row (5 to 7)
    var DOCK_TOP = 783;          // dock position in the shelf state (sizes(): higher with bigger tiles)
    var GRID_DOCK_TOP = 64;      // dock position once the grid has moved up
    var ROWS_TOP = 1052;         // top of the 2nd row inside .home
    var FULL_SHIFT = 430;        // shift that moves the dock off the screen

    var apps = [];          // apps shown (hidden apps excluded)
    var allApps = [];       // all apps, including Settings and Sources
    var tiles = [];
    var nav = null;
    var mode = "shelf";
    var bgActive = null;
    var dom = {};

    function $(id) { return document.getElementById(id); }

    function cacheDom() {
        dom.body = document.body;
        dom.bgA = $("bgA");
        dom.bgB = $("bgB");
        dom.bgBlur = $("bgBlur");
        dom.home = $("home");
        dom.dock = document.querySelector(".dock");
        dom.row0 = $("row0");
        dom.rows = $("rows");
        dom.hint = $("hint");
        dom.shelfInfo = $("shelfInfo");
        dom.shelfTitle = $("shelfTitle");
        dom.shelfMeta = $("shelfMeta");
        var open = document.createElement("div");                          // "OK to open", in full screen (openHint)
        open.className = "shelfinfo__open";
        open.textContent = APL.t("OK to Open");
        dom.shelfInfo.appendChild(open);
        dom.clock = $("clock");
        dom.toast = $("toast");
        dom.boot = $("boot");
        /* Still up after twenty seconds: the line stops sweeping and sits still, so
           a screen that is stuck reads as stuck rather than as loading forever. */
        if (dom.boot) global.setTimeout(function () {
            if (dom.boot && dom.boot.className.indexOf("is-hidden") < 0) dom.boot.classList.add("boot--slow");
        }, 20000);
        bgActive = dom.bgA;
    }

    /* ---------- colours ---------- */
    function rgba(hex, a) {
        var h = (hex || "#2a2a2e").replace("#", "");
        if (h.length === 3) h = h[0]+h[0]+h[1]+h[1]+h[2]+h[2];
        return "rgba(" + parseInt(h.substr(0,2),16) + "," + parseInt(h.substr(2,2),16) + "," +
               parseInt(h.substr(4,2),16) + "," + a + ")";
    }

    /* Top Shelf artwork: the app's image, otherwise an abstract
       tvOS-style wallpaper tinted with the app's colour. */
    /* Dominant colour: the one sampled from the Tizen icon, otherwise the accent. */
    function brandColour(app) { return app.edge || app.accent || "#3a4a8a"; }

    /* Settings › Appearance › Top Shelf › Otherwise › Black: a plain dark background behind every app,
       its own artwork included (the launcher's own Settings and Sources keep their large icon). What the
       apps show (What You're Watching, What's Popular) has its own switches. */
    function black() { return APL.sys.pref("shelfArt") === "black"; }
    /* Settings › Appearance › Top Shelf › Otherwise › Wallpaper: one picture or colour gradient behind every app,
       like Black but not dark (asked on Reddit and GitHub: "one static background", "gradient colour
       backgrounds", "my own wallpaper"). The pictures are the Home app's drawn backdrops and the ones added with
       install-via-vetro.py --backdrops (APL.wallpapers, settings-tree.js). What the apps show (What You're
       Watching, What's Popular) keeps its own switches, as with Black. */
    function walled() { return APL.sys.pref("shelfArt") === "wall"; }
    function wallpaper() { return walled() && APL.wallpapers ? APL.wallpapers.current() : null; }
    function artOf(app) {
        if (black()) return null;
        /* Through APL_ASSET like every local image: a screen running the downloaded update over an older
           package has no images/backdrops of its own (the picture was black, and the glass had nothing) */
        if (walled()) { var w = wallpaper(); return w && w.url ? asset(w.url) : null; }
        return app.bg;
    }
    function plain(app) { return (black() || (walled() && !artOf(app))) && !app.shelfHtml; }

    function backdropFor(app) {
        var bg = artOf(app);
        if (bg) return "#000 center / cover no-repeat url('" + bg + "')";
        if (plain(app)) { var w = wallpaper(); return (w && w.css) || "#07080c"; }
        // A card of its own (Settings, Sources, a pinned input) stands on the gradient wallpaper too
        if (walled()) { var g = wallpaper(); if (g && g.css) return g.css; }
        // No artwork yet (genart.js draws it once): a glow in the app's colour on a dark background.
        var a = brandColour(app);
        return "radial-gradient(60% 70% at 50% 44%, " + rgba(a, 0.42) + ", rgba(0,0,0,0) 70%)," +
               "radial-gradient(110% 80% at 50% 115%, " + rgba(a, 0.22) + ", rgba(0,0,0,0) 60%)," +
               "#07080c";
    }

    /* A card's own background (an app with no artwork: Settings, Sources): the glow above. On LG
       (APL.platform.cardPics) the glow is a small picture, composited from its bitmap like every other
       backdrop, and the icon and the name are layers of their own (launcher.css): painted as one 4K layer
       the card took 32 MB of the 125 the TV gives the page, and with the Settings panel over it (32 MB
       more) the bottom of the panel was left unpainted, black (a G5). */
    var glowPics = {};
    function glowPic(colour) {
        if (glowPics[colour]) return glowPics[colour];
        var W = 384, H = 216, c = document.createElement("canvas"), x = c.getContext("2d", { willReadFrequently: true });
        c.width = W; c.height = H;
        x.fillStyle = "#07080c";
        x.fillRect(0, 0, W, H);
        // backdropFor(): [centre x, centre y, radius x, radius y, alpha, where it ends]
        [[0.5, 0.44, 0.6, 0.7, 0.42, 0.7], [0.5, 1.15, 1.1, 0.8, 0.22, 0.6]].forEach(function (g) {
            x.save();
            x.translate(g[0] * W, g[1] * H);
            x.scale(g[2] * W, g[3] * H);
            var grad = x.createRadialGradient(0, 0, 0, 0, 0, 1);
            grad.addColorStop(0, rgba(colour, g[4]));
            grad.addColorStop(g[5], rgba(colour, 0));
            x.fillStyle = grad;
            x.fillRect(-3, -3, 6, 6);
            x.restore();
        });
        return (glowPics[colour] = c.toDataURL("image/png"));
    }
    /* The gradient wallpaper as the same kind of small picture, for a card of its own on LG */
    var gradPics = {};
    function gradPic(stops) {
        var key = stops.join("|");
        if (gradPics[key]) return gradPics[key];
        var W = 64, H = 216, c = document.createElement("canvas"), x = c.getContext("2d"), g, i;
        c.width = W; c.height = H;
        g = x.createLinearGradient(0, 0, 0, H);
        for (i = 0; i < stops.length; i++) g.addColorStop(stops.length > 1 ? i / (stops.length - 1) : 0, stops[i]);
        x.fillStyle = g;
        x.fillRect(0, 0, W, H);
        return (gradPics[key] = c.toDataURL("image/png"));
    }
    function cardBack(layer, app) {
        var glow = layer.querySelector("img.bg__glow");
        if (APL.platform && APL.platform.cardPics && !artOf(app) && !plain(app)) {
            layer.style.background = "#07080c";
            if (!glow) {
                glow = document.createElement("img");
                glow.className = "bg__glow";
                glow.alt = "";
                layer.insertBefore(glow, layer.firstChild);
            }
            /* On the gradient wallpaper, the gradient: the glow ignored it (Settings, Sources, a pinned input) */
            var wall = wallpaper();
            var src = wall && wall.stops ? gradPic(wall.stops) : glowPic(brandColour(app));
            if (glow.getAttribute("src") !== src) glow.src = src;
            return;
        }
        if (glow) glow.parentNode.removeChild(glow);
        layer.style.background = artOf(app) ? "#000" : backdropFor(app);
    }

    /* The title as the service prints it: its own logo when one is at hand, the
       name otherwise. The logo is an <img> inside the title line, sized like the
       text it replaces. */
    function titleShow(text, logo) {
        /* Only the title's own logo: the name is never printed in its place. A
           title without one leaves the line empty until TMDB answers, and stays
           empty when TMDB has nothing for it. */
        var t = dom.shelfTitle;
        t.textContent = "";
        if (!logo) return;
        var im = document.createElement("img");
        im.className = "shelfinfo__logo";
        im.alt = text || "";
        /* The logo arrives a moment after the picture, its file a few hundred
           kilobytes from TMDB: it fades in when it is there instead of popping
           in half drawn. */
        im.onload = function () { im.classList.add("is-in"); };
        im.src = logo;
        t.appendChild(im);
        if (im.complete && im.naturalWidth) im.classList.add("is-in");
        t.classList.remove("is-swap");
        void t.offsetWidth;                      // restart the animation
        t.classList.add("is-swap");
    }
    /* The title as words, for what has no logo to draw: same line, same height,
       same fade, so the wall reads the same whichever kind of title it holds. */
    function titleWords(text) {
        var t = dom.shelfTitle;
        t.textContent = text || "";
        if (!text) return;
        t.classList.remove("is-swap");
        void t.offsetWidth;
        t.classList.add("is-swap");
    }

    /* TMDB has the official title logo for a film or a series; the catalogue's
       picks do not carry one, so it is looked up as they come up and kept. */
    var logoWanted = "", logoCache = {};
    function logoOf(title, year) {
        if (!title || !APL.live || !APL.live.logoOf) return;
        var key = title + "|" + (year || "");
        logoWanted = key;
        if (logoCache[key] !== undefined) {
            if (logoCache[key]) titleShow(title, logoCache[key]);
            return;
        }
        APL.live.logoOf(title, year).then(function (url) {
            url = url || "";
            logoCache[key] = url;
            /* Another title went up while this answer was coming: leave it alone. */
            if (logoWanted !== key || !url) return;
            titleShow(title, url);
        }, function () {});
    }

    /* Logo + name in the centre, like the provided artwork (sharp Tizen icon, never blurred). */
    function brandCard(app) {
        var card = document.createElement("div");
        card.className = "brandcard";
        if (app.shelfHtml) {
            card.innerHTML = app.shelfHtml;               // Settings, Sources: large tvOS icon
        } else if (app.icon) {
            var img = document.createElement("img");
            img.className = "brandcard__icon";
            img.alt = "";
            img.onerror = function () {
                if (!img._vetro) { img._vetro = true; img.src = vetroIcon(app.id); return; }
                img.remove();
            };
            img.src = app.icon;
            card.appendChild(img);
        }
        var name = document.createElement("div");
        name.className = "brandcard__name";
        name.textContent = app.name;
        card.appendChild(name);
        return card;
    }

    /* Grid background, as on tvOS: the Top Shelf image, frozen and blurred.
       It is drawn ONCE into a tiny canvas (the blur costs nothing),
       which the screen stretches: no blur is recomputed while navigating. */
    var blurCanvas = null, blurToken = 0;
    function blurLayer() {
        if (blurCanvas) return blurCanvas;
        blurCanvas = document.createElement("canvas");
        var ctx = blurCanvas.getContext("2d");
        var filters = ctx && "filter" in ctx;
        blurCanvas.width = filters ? 192 : 64;          // without filters: smaller = softer
        blurCanvas.height = filters ? 108 : 36;
        blurCanvas._filters = filters;
        blurCanvas.className = "bgblur__canvas";
        dom.bgBlur.appendChild(blurCanvas);
        return blurCanvas;
    }
    function setBlur(src, app, decoded) {
        if (!dom.bgBlur) return;
        var token = ++blurToken;
        if (!src && !decoded) {
            dom.bgBlur.style.background = backdropFor(app);
            if (blurCanvas) blurCanvas.style.opacity = "0";
            return;
        }
        /* The picture that is already on the screen is used when it is handed
           over: its small copy was a second download, and the drawer waited for
           it. Otherwise the 300 px copy is fetched. */
        var img = (decoded && decoded.complete && decoded.naturalWidth) ? decoded : new Image();
        /* onload is not the whole bitmap. Drawing then left the blurred backdrop
           half filled, and the Control Center sometimes showed that banded blur
           of the app's backdrop instead of the picture. */
        var painted = false;
        function paintBlur() {
            if (painted) return;
            painted = true;
            if (token !== blurToken) return;              // another image was requested in the meantime
            if (!img.naturalWidth || !img.naturalHeight) return;   // not decoded yet: nothing to draw
            var c = blurLayer(), ctx = c.getContext("2d"), w = c.width, h = c.height;
            var m = c._filters ? 14 : 0;                  // margin: no dark edge from the blur
            ctx.clearRect(0, 0, w, h);
            if (c._filters) ctx.filter = "blur(5px) saturate(150%)";
            // "cover": the image fills the canvas without being distorted
            var r = Math.max((w + 2 * m) / img.naturalWidth, (h + 2 * m) / img.naturalHeight);
            var dw = img.naturalWidth * r, dh = img.naturalHeight * r;
            ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
            /* LG: the grid's darkening is drawn here, and the full-screen scrim fades out over the grid
               (launcher.css): one 4K layer less to blend on every frame of the grid's slide */
            if (APL.platform && APL.platform.gridTint) {
                ctx.filter = "none";
                ctx.fillStyle = document.body.classList.contains("theme-light") ? "rgba(240, 241, 246, 0.72)" : "rgba(4, 5, 10, 0.32)";
                ctx.fillRect(0, 0, w, h);
            }
            c.style.opacity = "1";
            dom.bgBlur.style.background = "#05060a";
        }
        if (img === decoded) { paintBlur(); return; }
        img.onload = function () {
            if (img.decode) img.decode().then(paintBlur, paintBlur);
            else paintBlur();
            global.setTimeout(paintBlur, 400);            // a decode that never settles
        };
        img.onerror = function () { if (token === blurToken) dom.bgBlur.style.background = backdropFor(app); };
        /* The canvas is small (blurLayer): TMDB's 300 px copy of the picture. Its 4K original was decoded
           whole by the page itself when the canvas was drawn, 0.4 s at a time on an LG G5 */
        img.src = APL.artSize ? APL.artSize(src, "w300") : src;
    }

    /* The blurred background is only prepared when entering the grid: computing it on
       every move in the dock was what made navigation stutter. */
    var blurWanted = null;
    /* glass: the picture for the frosted dock, when it differs from the grid's (see frost). */
    var blurAhead = 0;
    function wantBlur(src, app, glass) {
        frost(glass === undefined ? src : glass);
        blurWanted = { src: src, app: app };
        if (mode === "grid") flushBlur();
        /* LG: prepared once the focus has rested on an app for a second, so that entering the grid has no
           picture to decode (a 4K one in the first frames of the grid's slide) */
        else if (APL.platform && APL.platform.blurAhead) { clearTimeout(blurAhead); blurAhead = setTimeout(flushBlur, 1200); }
    }
    /* Liquid Glass with no live blur: the dock shows a soft copy of the picture behind it (the sheets
       are soft already), lined up with it (layout), so the
       picture looks frosted through the glass. A static image, drawn once when the picture changes.
       Not the small copy of live content: enlarged 6 times without a blur, it showed as big pixels in
       the dock (seen on the M8); the dock is then clear glass over the picture. */
    var frostSrc, frostToken = 0;
    function frost(src) {
        /* LG: the dock's pane is always on and opaque, so this picture under it was never seen, and each
           new one repainted the dock's layer, 2.5 Mpx with its blurred shadows (12 ms of GPU on a G5) */
        if (APL.platform && APL.platform.noFrost) return;
        if (!dom.dock || src === frostSrc) return;           // the same picture: nothing to repaint
        frostSrc = src;
        var token = ++frostToken;
        // Swapped once decoded: the dock never flashes to the bare tint while the picture loads
        whenDecoded(src, function () {
            if (token !== frostToken) return;                 // another picture was asked for in the meantime
            dom.dock.style.setProperty("--glass-img", src ? 'url("' + String(src).replace(/"/g, "%22") + '")' : "none");
            /* The dock's pane is a slice of this picture at the dock's height, so
               the new one is set here, once it is known to be decoded. */
        });
    }
    function flushBlur(decoded) {
        if (!blurWanted) return;
        var b = blurWanted;
        blurWanted = null;
        setBlur(b.src, b.app, decoded);
    }

    /* An image is only shown once decoded: the fade starts without a hitch. */
    function whenDecoded(src, then) {
        if (!src) { then(); return; }
        var im = new Image();
        im.src = src;
        /* The decoded element is handed on: the glass bakes its pane from this
           very bitmap (APL.glass.prepare(src, done, im)) instead of fetching the
           file again, which is what made the dock trail the picture. */
        var done = function () { then(im); };
        if (im.decode) im.decode().then(done, done);
        else { im.onload = done; im.onerror = done; }
    }

    /* The picture itself, as an <img> that is decoded before it is shown. As a
       CSS background on a full-screen layer the browser painted the file as it
       decoded, so a backdrop filled in a line at a time from the top - every
       time the row was scrolled, not only on the first pass. An <img> whose
       decode has finished is painted whole. The layer keeps its own colour
       underneath and the glass reads the picture from the element (glass.js). */
    /* place: the app's own artwork, drawn in the layer while its backdrop is
       decoded. A 1280 JPEG takes a while to decode on a Tizen 6.5 panel, and until
       it was ready the layer stayed on the last app's picture: stepping showed the
       app before. The app's artwork is bundled and local, so it is there in the
       frame the layer is, and the picture takes its place once it is decoded -
       neither a smaller copy of the picture nor the one before it. */
    var seenPics = {}, preloads = {}, preloadOrder = [];
    /* A picture held decoded, out of sight, before it is asked for: the next title
       of a shelf, usually. Its bitmap is then in memory and the element that shows
       it paints in the frame it is added. */
    function preload(url) {
        if (!url || preloads[url]) return;
        var im = new global.Image();
        im.decoding = "sync";
        preloads[url] = im;
        preloadOrder.push(url);
        /* Three at most: a decoded 1920 picture is a few megabytes each, and a
           television is not a workstation. Three is what a step needs - the title
           on the wall and the app either side of it. */
        while (preloadOrder.length > 3) { var old = preloadOrder.shift(); if (old !== url) delete preloads[old]; }
        if (im.decode) im.decode().then(function () { im._ok = true; }, function () {});
        else im.onload = function () { im._ok = true; };
        im.src = url;
    }

    function showPicture(layer, url, then, place, revealNow) {
        var pic = layer.querySelector("img:not(.brandcard__icon)");   // the brand card's logo is not the backdrop
        if (pic && pic.getAttribute("src") === url && pic.complete && pic.naturalWidth) {
            if (then) then(pic);                                 // the same picture, already decoded
            return;
        }
        if (pic) pic.parentNode.removeChild(pic);
        var quick = (place && place !== url) ? place : url;
        pic = document.createElement("img");
        pic.alt = "";
        pic.decoding = "sync";
        pic.src = quick;
        layer.appendChild(pic);
        var called = false;
        function done() { if (called) return; called = true; if (pic.naturalWidth) seenPics[quick] = true; if (then) then(pic); }
        /* A bitmap that has already been decoded once (preloaded for the title
           that comes next, or painted a moment ago) is on screen at once: asking
           for its decode again was a frame of the old picture. One frame later, so
           the layer never fades in on an element that has not drawn its bitmap yet
           (that is what a blank wall on a focus looked like). */
        if (quick === url && (seenPics[url] || (preloads[url] && preloads[url]._ok))) {
            if (global.requestAnimationFrame) global.requestAnimationFrame(function () { global.setTimeout(done, 0); });
            else global.setTimeout(done, 0);
            return;
        }
        /* Nothing to lay under it (no artwork of its own, and the picture not drawn
           yet): the layer goes up at once on its own backdrop, instead of the
           previous app's picture staying there and reading as the wrong show. */
        if (revealNow) global.setTimeout(done, 0);
        if (quick !== url) {
            /* The full picture is decoded off screen, then takes the element's
               place: setting a source whose bitmap is ready swaps in one frame. */
            var full = new global.Image();
            var swap = function () { if (pic && pic.getAttribute("src") !== url) pic.src = url; };
            full.src = url;
            if (full.decode) full.decode().then(swap, function () {});
            else full.onload = swap;
        }
        if (pic.decode) pic.decode().then(done, done);
        else { pic.onload = done; pic.onerror = done; }
    }

    /* Drawing a full-screen image takes 100 ms on the M8, whatever the effect: the dock
       backgrounds stay ready in invisible layers, and switching between them redraws nothing. */
    var layers = {};
    function layerFor(app) {
        if (layers[app.id]) return layers[app.id];
        var l = document.createElement("div");
        l.className = "bg";
        /* Artwork is the layer's picture, an <img> (showPicture), not a
           background: a background on this full-screen layer was painted as the
           file decoded, a line at a time from the top. */
        cardBack(l, app);
        if (!artOf(app) && !plain(app)) l.appendChild(brandCard(app));
        l.dataset.app = app.id;
        dom.bgA.parentNode.insertBefore(l, dom.bgA);
        layers[app.id] = l;
        return l;
    }
    /* After a change of order or artwork: layers to rebuild (the one on screen goes after the fade). */
    function dropLayers() {
        Object.keys(layers).forEach(function (id) {
            var l = layers[id];
            if (l === bgActive) l._stale = true; else l.parentNode.removeChild(l);
        });
        layers = {};
    }
    function showLayer(next, app) {
        next.dataset.app = app.id;
        if (next === bgActive) return;
        if (artOf(app)) motion(next); else next.classList.remove("is-motion");
        fadeTo(next);
    }
    /* Crossfade without a dip to black (two half-faded pictures over black): of the two layers, the
       upper one in the page does the fading and the lower one stays whole underneath. The new one fades
       in over the old one, or appears at once under it while the old one fades out. Nothing moves and
       the stacking never changes: only the opacity, so no full-screen repaint (100 ms on the M8). */
    var FADE_MS = 300;
    function fadeTo(next, still) {
        var old = bgActive;
        /* The new picture slides in as it fades, whichever way round the two
           layers stack, so a change never pops - not for a new app, not for the
           next title after ten seconds. Stepping through the row keeps the slide
           out: a moving full-screen layer under the dock's lens is the most
           expensive thing the page can draw, and the press has to answer now. */
        if (!still && !next.classList.contains("is-motion")) {
            next.classList.remove("is-slide");
            void next.offsetWidth;                                  // restart the animation
            next.classList.add("is-slide");
            global.setTimeout(function () { next.classList.remove("is-slide"); }, 500);
        }
        clearTimeout(next._out);
        clearTimeout(old._out);
        bgActive = next;
        readyLayer(next);
        /* The element itself, not only its id: several layers can carry the
           same app, and the glass has to slice the one that was faded in. */
        document.body.__bgLive = next;
        /* Name the app whose backdrop is live. Two layers keep is-active while
           they cross over, so "the first active layer" can still be the one
           leaving, and the glass would slice the show before last. */
        if (next.dataset && next.dataset.app) document.body.setAttribute("data-bg-app", next.dataset.app);
        if (old.compareDocumentPosition(next) & global.Node.DOCUMENT_POSITION_FOLLOWING) {
            next.classList.add("is-active");                     // above: fades in over the old one
            old._out = setTimeout(function () { hideLayer(old); }, FADE_MS + 50);
        } else {
            next.classList.add("is-instant", "is-active");       // below: whole at once, under the old one
            void next.offsetWidth;
            next.classList.remove("is-instant");
            hideLayer(old);                                       // the old one fades out over it
        }
        /* Whatever path was taken, one backdrop is on screen when the fade is
           over. A poster that never got hidden - the show of the app just left,
           under a channel with no show of its own - is cleared here. */
        setTimeout(function () {
            var list = document.querySelectorAll(".bg.is-active"), i;
            for (i = 0; i < list.length; i++) {
                if (list[i] !== bgActive) hideLayer(list[i]);
            }
        }, FADE_MS + 120);
    }
    /* LG draws in 4K: a layer kept ready is 32 MB there and its browser has 250 MB for all of them, so only
       the last few stay ready (APL.platform.readyLayers, launcher.css .is-ready); back and forth between two
       neighbours then repaints nothing. Elsewhere every layer stays ready. */
    var readyList = [];
    function readyLayer(l) {
        var max = APL.platform && APL.platform.readyLayers;
        if (!max) return;
        var i = readyList.indexOf(l);
        if (i !== -1) readyList.splice(i, 1);
        readyList.unshift(l);
        l.classList.add("is-ready");
        while (readyList.length > max) readyList.pop().classList.remove("is-ready");
    }
    function hideLayer(l) {
        if (l === bgActive) return;                               // shown again in the meantime
        l.classList.remove("is-active");
        if (l._stale) setTimeout(function () { if (l !== bgActive && l.parentNode) l.parentNode.removeChild(l); }, FADE_MS + 50);
    }

    /* The panes of the whole dock are baked as soon as the row is known, one at a
       time so the Home Screen never stutters: by the time a key moves along the
       row, the slice for the app being shown is already rendered. That is what
       makes the change instant - reveal() waits for a bake, and a bake that is
       already in the cache answers in the same frame as the call, so the picture
       and the glass swap together with no delay at all. A cold picture (the first
       visit to an app, before this has run) is the only case that waits. */
    var warmed = {};
    function warmDock() {
        if (!APL.glass || !APL.glass.prefetch || !apps || !apps.length) return;
        var queue = [], i, art;
        for (i = 0; i < apps.length && i < DOCK_SIZE; i++) {
            art = artOf(apps[i]);
            if (art && !warmed[art]) queue.push(art);
        }
        (function next() {
            var src = queue.shift();
            if (!src) return;
            warmed[src] = true;
            APL.glass.prefetch(src);
            global.setTimeout(next, 70);
        })();
    }
    /* The row arrives with the app list, which can be later than this file runs. */
    [1200, 3000, 6500, 12000].forEach(function (ms) { global.setTimeout(warmDock, ms); });
    APL.warmGlass = warmDock;

    /* The picture and the glass over it change in the same frame: the pane is
       baked from the very bitmap that is about to be shown, and only then does
       the layer go on screen. Showing the picture first and letting the dock
       catch up is the glass arriving a beat after the backdrop - the desync
       that showed as the dock changing second while the row was stepped
       through. prepare() answers at once when the pane is already rendered
       (prefetchAround keeps the neighbours ready) and after at most 1.2 s when
       it cannot be, so a picture is never held back indefinitely. */
    function reveal(app, layer, image, pic) {
        var token = backdropToken;
        var done = function () {
            if (token !== backdropToken) return;      // another app was chosen meanwhile
            showLayer(layer, app);
            /* The drawer's blurred background is this picture, drawn now from the
               very same bitmap: opening the drawer never has one to prepare. */
            wantBlur(image, app);
            flushBlur(pic);
            refreshGlass();
            warmNear(nav.index);      // the neighbours are already sliced: the next step waits for nothing
        };
        if (APL.glass && APL.glass.prepare) APL.glass.prepare(image, done, pic);
        else done();
    }

    var backdropToken = 0;
    function setBackdrop(app, force) {
        /* Nothing changes the backdrop under the Control Center, a drawer,
           search or Settings: the picture stays still while they are up. */
        if (!force && overlayOpen()) return;
        /* A picture still being prepared for the app we just left must not land
           now. Its fallback fires half a second later and paints the old show
           over the new one - the flash that goes new, previous, new. */
        /* Only the app in focus owns the backdrop. A catalogue for the app we
           just left answers later, and showing its picture here put the previous
           show back over the new one: the flash that goes new, previous, new. */
        if (!force && apps.length && apps[nav.index] && apps[nav.index] !== app) return;
        backdropToken++;
        if (bgActive.dataset.poster) bgActive._stale = true;      // removed once it has faded out
        stopRotate();
        var image = artOf(app);
        wantBlur(image && (image === app.bg ? app.bgBlur || app.bg : image), app, image && (image === app.bg ? app.bgBlur || null : image));
        var token = ++backdropToken;
        if (apps.indexOf(app) < DOCK_SIZE) {
            /* The picture is decoded before its layer is shown. A cover
               background resolves its percentages against the loaded image, so a
               layer shown first paints at the top of the box and snaps to centre
               when the file lands - the picture that "loads from the top" the
               first time an app is visited. */
            var dockLayer = layerFor(app);
            if (!image) {
                if (token !== backdropToken) return;
                showLayer(dockLayer, app);
                refreshGlass();
                return;
            }
            showPicture(dockLayer, image, function (pic) {
                if (token !== backdropToken) return;
                reveal(app, dockLayer, image, pic);
            });
            return;
        }
        if (bgActive.dataset.app === app.id) return;
        whenDecoded(image, function () {
            if (token !== backdropToken) return;          // another app was selected in the meantime
            var next = (bgActive === dom.bgA) ? dom.bgB : dom.bgA;
            next.innerHTML = "";
            if (image) next.style.background = "#000"; else cardBack(next, app);
            if (!image && !plain(app)) next.appendChild(brandCard(app));
            if (!image) { showLayer(next, app); refreshGlass(); return; }
            showPicture(next, image, function (pic) {
                if (token !== backdropToken) return;
                reveal(app, next, image, pic);
            });
        });
    }

    /* Nothing slides on its own: the title on the wall changes when the arrows
       say so, or when the app's own Top Shelf hands over its next picture. */
    var ROTATE_MS = 10000, rotTimer = null, rotN = 0;
    /* The title actually on the wall, per app: the trailer must follow it, not
       the app's first pick, now that ◀ ▶ and the rotation change it. */
    var lastPicks = {};
    /* The title on the wall for this app: its live shelf item when it has one,
       otherwise the last poster painted - the rotated one, not the first pick. */
    function pickOnWall(app) {
        if (!app) return null;
        /* The title actually on the wall wins. The rotation moves the picture on
           by itself, and the trailer used to be armed with the number kept from
           the last step: ▲ on the third show played the first one's trailer. */
        if (liveShown && liveShown.app === app && liveShown.item) return liveShown.item;
        if (app._liveItems && app._liveItems.length) return app._liveItems[app._liveN || 0];
        if (lastPicks[app.id]) return lastPicks[app.id];
        return null;
    }
    /* trailer.js asks this when a panel closes: the show on the wall, not the
       app's first pick. */
    function publishPickOnWall() {
        if (APL.trailer) APL.trailer.pickOnWall = pickOnWall;
    }
    function stopRotate() { clearTimeout(rotTimer); rotTimer = null; }
    /* The backdrop is left alone while something is over it: the Control Center,
       a drawer, search, Settings, profiles. */
    function overlayOpen() {
        return /(^| )has-(cc|sources|search|settings|profiles|wdg)( |$)/.test(document.body.className);
    }
    /* The trailer is over (trailer.js knows its length): the wall slides on to the
       next title of the same app, exactly as the ten-second timer would have. */
    /* ◀ ▶ in full screen: the other titles of the app on the wall, rather than
       the app next door. The art changes at once, its trailer two seconds later. */
    var stepAt = 0;                         // last ◀ ▶: the lens waits until it is over
    function glassSoon() {
        clearTimeout(glassSoon._t);
        glassSoon._t = setTimeout(function () { refreshGlass(); }, 240);
    }
    function stepShow(dir) {
        stepAt = Date.now();
        var app = apps[nav.index];
        if (!app || mode !== "full") return false;
        /* Every press moves one title, at once: the old 260 ms gate swallowed
           presses the remote had already sent, which is what made ◀ ▶ feel
           delayed and left the title a step behind the picture. */
        if (APL.trailer) APL.trailer.stop(true);
        if (APL.live && APL.live.hasSource && APL.live.hasSource(app) && app._liveItems && app._liveItems.length) {
            var list = app._liveItems, n = ((app._liveN || 0) + dir + list.length) % list.length;
            app._liveN = n;
            setLiveBackdrop(app, list[n], n, list, 0);
            if (APL.trailer) APL.trailer.arm(app, trailerOver, list[n]);
            return true;
        }
        /* The shelf has not answered yet (or was never started in this mode):
           ask for this app's own titles now, so the first ◀ or ▶ still moves
           within the app instead of leaving it. */
        if (APL.live && APL.live.hasSource && APL.live.hasSource(app) && APL.live.itemsNow) {
            APL.live.itemsNow(app).then(function (items) {
                if (!items || !items.length || apps[nav.index] !== app) return;
                app._liveItems = items;
                app._liveN = dir < 0 ? items.length - 1 : 0;
                warmItems(items, app);
                setLiveBackdrop(app, items[app._liveN], app._liveN, items, 0);
                if (APL.trailer) APL.trailer.arm(app, trailerOver, items[app._liveN]);
            }, function () {});
            return true;
        }
        /* An app with no shelf of its own has no other title to show, so the
           arrows move to the app next door. */
        return false;
    }

    function trailerOver() {
        /* The trailer is over: the show stays on the wall. Nothing slides on its
           own, so no catalogue title can turn up here - that is what put a
           storefront's poster under the title the viewer had chosen. */
        var app = apps[nav.index];
        if (!app || mode !== "full") return;
        if (APL.trailer) APL.trailer.arm(app, trailerOver, pickOnWall(app));
    }

    function startRotate(app) {
        /* The titles no longer slide on their own. A trailer must never have a
           new title move under it, and the show on the wall is the one chosen
           with the arrows until the arrows choose another. */
        stopRotate();
    }

    /* The frosted panes follow the layer that is on screen. Refreshing before the
       new layer was shown made the glass read the OLD one: moving to an app with
       no picture (Settings) left the previous film baked in the dock and the pill. */
    function refreshGlass() {
        if (APL.glass && APL.glass.refresh) APL.glass.refresh();
        if (APL.glass && APL.glass.paint) APL.glass.paint();
    }

    /* An app's real icon, served by Vetro (fallback when the Tizen path can't be read). */
    function vetroIcon(id) { return APL.sys.vetroUrl("/apps/icon?appId=" + encodeURIComponent(id)); }

    /* Slow camera move over the Top Shelf image, like Apple TV's animated backgrounds.
       Off by default: at rest on the M8 it takes more than one core by itself (135%, versus
       16% without it), and the images change every 9 s, so it never stops. */
    var motionN = 0;
    function motion(layer) {
        layer.classList.remove("is-motion", "is-motion-a", "is-motion-b");
        if (!APL.sys.pref("bgMotion")) return;
        void layer.offsetWidth;
        layer.classList.add("is-motion", (++motionN % 2) ? "is-motion-a" : "is-motion-b");
    }

    /* ---------- tiles ---------- */
    function letter(name) {
        var el = document.createElement("div");
        el.className = "tile__letter";
        el.textContent = (name || "?").trim().charAt(0).toUpperCase();
        return el;
    }

    /* A Tizen icon is often a square with a background: its edge colour
       is extended over the whole tile for a full-bleed tvOS look. */
    function bleedIconColour(img, card, app) {
        try {
            var c = document.createElement("canvas");
            c.width = c.height = 8;
            var ctx = c.getContext("2d");
            ctx.drawImage(img, 0, 0, 8, 8);
            var d = ctx.getImageData(0, 0, 1, 1).data;
            if (d[3] > 200) {
                card.style.background = "rgb(" + d[0] + "," + d[1] + "," + d[2] + ")";
                app.edge = "#" + [d[0], d[1], d[2]].map(function (v) { return ("0" + v.toString(16)).slice(-2); }).join("");
                // The background shown for this app takes its icon's real colour.
                /* Never over a poster: the layer carrying the film from the catalogue
                   has this app's id too, and repainting it here put the app's own
                   picture back over the film - the backdrop that seemed to reload
                   itself on the first pass along the dock. */
                if (bgActive && bgActive.dataset.app === app.id && !bgActive.dataset.poster) cardBack(bgActive, app);
            }
        } catch (e) { /* image from another origin: keep the default colour */ }
    }

    function makeTile(app, row) {
        var tile = document.createElement("div");
        tile.className = "tile";
        tile.dataset.row = row;

        var card = document.createElement("div");
        card.className = "tile__card";

        var chosen = iconOf(app);
        if (chosen) {
            // Change Icon (hold OK): the picture chosen for this app
            card.style.background = "#111 center / cover no-repeat url('" + asset(chosen) + "')";
        } else if (app.tileHtml) {
            card.innerHTML = app.tileHtml;
        } else if (app.tile) {
            // inline style: a url() inside a CSS variable would be resolved from css/
            card.style.background = "#111 center / cover no-repeat url('" + app.tile + "')";
        } else if (app.icon) {
            // No logo in the catalog: the app's real, sharp icon, until
            // genart.js makes its tile.
            /* Tizen icons are as often transparent as not: any fill behind one
               shows as a rectangle around it, which is the plate that was still
               there behind the icons. The tile is the icon, and nothing else. */
            card.style.background = "transparent";
            card.classList.add("tile__card--icon");
            var img = document.createElement("img");
            img.className = "tile__icon" + (app.autoIcon ? " tile__icon--app" : "");
            img.alt = "";
            img.onload = function () { bleedIconColour(img, card, app); };
            img.onerror = function () {
                if (!img._vetro) { img._vetro = true; img.src = vetroIcon(app.id); return; }
                card.removeChild(img); card.appendChild(letter(app.name));
            };
            img.src = app.icon;
            card.appendChild(img);
        } else {
            card.style.background = app.accent || "#2a2a2e";
            card.appendChild(letter(app.name));
        }

        var label = document.createElement("div");
        label.className = "tile__label";
        label.textContent = app.name;

        tile.appendChild(card);
        tile.appendChild(label);
        return tile;
    }

    /* LG (APL.platform.focusLayers): what focus adds to a tile, its large shadow, its sheen and (in the grid)
       its name, is not painted on the tile. Painted there, focus repainted two tiles on every move, blurred
       shadow included: 3.5 ms of GPU each on a G5 drawing in 4K, a frame lost per move. Two sets of three
       layers are shared by all the tiles instead (one a layer each would be 150 layers, and the browser then
       spent 5 to 15 ms a frame sorting them): a set is put on the tile taking the focus and scales with it,
       while the other fades out where the focus was. The shadow and the sheen are pictures, composited from
       their own bitmaps: the shadow is drawn once, at a quarter of its size (a blur loses nothing to it). */
    var focusSets = null, focusTurn = 0;
    function focusSet() {
        function part(cls, inner) {
            var d = document.createElement("div");
            d.className = "tfx tfx--" + cls;
            if (inner) d.appendChild(inner);
            return d;
        }
        function pic() { var i = document.createElement("img"); i.alt = ""; return i; }
        var set = { lift: part("lift", pic()), sheen: part("sheen", pic()), name: part("name", document.createElement("span")) };
        set.all = [set.lift, set.sheen, set.name];
        return set;
    }
    function focusFx(el) {
        if (!APL.platform || !APL.platform.focusLayers) return;
        if (!focusSets) focusSets = [focusSet(), focusSet()];
        var art = focusArt(), cont = el.parentNode, old = focusSets[focusTurn], set = focusSets[focusTurn = 1 - focusTurn];
        old.all.forEach(function (n) { n.classList.remove("is-on"); });
        if (!cont) return;
        if (!el._fxAt) el._fxAt = [el.offsetLeft, el.offsetTop];       // tiles are made again when the layout changes
        var grid = el.dataset.row !== "0";
        set.all.forEach(function (n) {
            if (n.parentNode !== cont) cont.insertBefore(n, n === set.lift ? cont.firstChild : null);
            n.style.left = el._fxAt[0] + "px";
            n.style.top = el._fxAt[1] + "px";
        });
        if (set.art !== art.key) { set.art = art.key; set.lift.firstChild.src = art.lift; set.sheen.firstChild.src = art.sheen; }
        var label = el.querySelector(".tile__label"), text = grid && label ? label.textContent : "";
        if (set.name.firstChild.textContent !== text) set.name.firstChild.textContent = text;
        set.lift.classList.add("is-on");
        set.sheen.classList.add("is-on");
        set.name.classList.toggle("is-on", !!text);
    }
    /* A rounded rectangle's path. The canvas's own roundRect is Chrome 99: webOS 6 (LG 2021, Chromium 79) doesn't
       have it, and the launcher stopped at start with "x.roundRect is not a function" (#61). */
    function roundPath(x, l, t, w, h, r) {
        if (x.roundRect) { x.roundRect(l, t, w, h, r); return; }
        r = Math.max(0, Math.min(r, w / 2, h / 2));
        x.moveTo(l + r, t);
        x.arcTo(l + w, t, l + w, t + h, r);
        x.arcTo(l + w, t + h, l, t + h, r);
        x.arcTo(l, t + h, l, t, r);
        x.arcTo(l, t, l + w, t, r);
        x.closePath();
    }
    var focusPics = { key: "" };
    function focusArt() {
        var perf = dom.body.classList.contains("perf"), key = TILE_W + "x" + TILE_H + (perf ? "p" : "");
        if (focusPics.key === key) return focusPics;
        var P = 80, Q = 4, R = 20, FAR = 4000, w = TILE_W, h = TILE_H;
        var READ = { willReadFrequently: true };          // read back at once: kept off the GPU
        var c = document.createElement("canvas"), x = c.getContext("2d", READ);
        c.width = Math.ceil((w + 2 * P) / Q); c.height = Math.ceil((h + 2 * P) / Q);
        // launcher.css: .tile.is-focused .tile__card (and its lighter .perf shadow): [y, blur, spread, alpha]
        (perf ? [[16, 26, 0, 0.5]] : [[30, 40, -6, 0.65], [10, 18, 0, 0.35]]).forEach(function (sh) {
            x.shadowColor = "rgba(0,0,0," + sh[3] + ")";
            x.shadowBlur = sh[1] / Q;
            x.shadowOffsetX = FAR;                         // the shape that casts it stays off the canvas
            x.shadowOffsetY = sh[0] / Q;
            x.fillStyle = "#000";
            x.beginPath();
            roundPath(x, (P - sh[2]) / Q - FAR, (P - sh[2]) / Q, (w + 2 * sh[2]) / Q, (h + 2 * sh[2]) / Q, Math.max(0, R + sh[2]) / Q);
            x.fill();
        });
        focusPics.lift = c.toDataURL("image/png");
        // .tile__card::after: linear-gradient(165deg, white 30% at 0, 6% at 38%, none at 60%)
        var s = document.createElement("canvas"), y = s.getContext("2d", READ), sw = 100, sh2 = Math.round(100 * h / w);
        s.width = sw; s.height = sh2;
        var a = 165 * Math.PI / 180, dx = Math.sin(a), dy = -Math.cos(a), len = Math.abs(sw * dx) + Math.abs(sh2 * dy);
        var g = y.createLinearGradient(sw / 2 - dx * len / 2, sh2 / 2 - dy * len / 2, sw / 2 + dx * len / 2, sh2 / 2 + dy * len / 2);
        g.addColorStop(0, "rgba(255,255,255,0.30)"); g.addColorStop(0.38, "rgba(255,255,255,0.06)"); g.addColorStop(0.60, "rgba(255,255,255,0)");
        y.fillStyle = g; y.fillRect(0, 0, sw, sh2);
        focusPics.sheen = s.toDataURL("image/png");
        focusPics.key = key;
        return focusPics;
    }

    /* ---------- states ---------- */
    function setMode(m) {
        mode = m;
        dom.body.classList.remove("mode-shelf", "mode-grid", "mode-full");
        dom.body.classList.add("mode-" + m);
        layout();
        if (dom.shelfInfo && nav) openHint();
        /* Full screen: two seconds on the same app may bring its trailer (trailer.js).
           Anywhere else, the video goes and the picture is immediately behind. */
        if (APL.trailer) {
            publishPickOnWall();
            var focusApp = nav && apps[nav.index];
            if (m === "full" && focusApp) APL.trailer.arm(focusApp, trailerOver, pickOnWall(focusApp));
            else APL.trailer.stop();
        }
    }

    /* Apps per row: the tiles share the dock's width (1750 px inside its padding, 50 px gaps) and keep
       their 5:3 shape; the dock grows upward from the same bottom edge (1008), and the rows start below
       it as before. CSS reads the result from variables on <html>. */
    var TILE_H = 150, TILE_W = 250, DOCK_BOTTOM = 1008;
    function sizes() {
        var n = APL.sys.pref("appsPerRow");
        n = n === 5 || n === 7 ? n : 6;
        var w = Math.round((1750 - (n - 1) * 50) / n), h = Math.round(w * 0.6), dockH = h + 75;
        DOCK_SIZE = n; TILE_H = h; TILE_W = w; DOCK_TOP = DOCK_BOTTOM - dockH;
        var s = document.documentElement.style;
        s.setProperty("--cols", n);
        s.setProperty("--tile-w", w + "px");
        s.setProperty("--tile-h", h + "px");
        s.setProperty("--dock-top", DOCK_TOP + "px");
        s.setProperty("--dock-h", dockH + "px");
    }
    sizes();

    function layout() {
        var y = 0;
        if (mode === "full") {
            y = FULL_SHIFT;
        } else if (mode === "grid") {
            y = -(DOCK_TOP - GRID_DOCK_TOP);
            // Scroll if the selected row goes off the screen.
            var el = nav && nav.current();
            if (el && el.dataset.row !== "0") {
                var visibleTop = ROWS_TOP + el.offsetTop + y;
                var limit = 1080 - (TILE_H + 80);    // icon + name + bottom margin
                if (visibleTop > limit) y -= (visibleTop - limit);
            }
        }
        dom.home.style.transform = "translateY(" + y + "px)";
        if (dom.dock) dom.dock.style.setProperty("--glass-y", -(DOCK_TOP + y) + "px");   // the frosted copy stays lined up
    }

    /* ---------- live Top Shelf ---------- */
    var liveTimer = null, liveRotate = null;

    /* The artwork is loaded before being shown: an image that can't be found is skipped
       (on to the next item) instead of leaving a black screen. */
    /* A shelf hands over its titles at once; their pictures are fetched and
       decoded here, so the first ◀ ▶ is a swap and not a download. */
    function warmItems(items, app) {
        /* Every title of the shelf, one after another: a ◀ ▶ press swaps a picture
           that is already fetched, so the step never waits for the network. They
           used to be fetched four at once, which meant the fifth title of a shelf
           was still a download, and that is what a step past it looked like. */
        if (!items || !items.length) return;
        if (app && inTopRow(app) && APL.artCache && APL.artCache.remember) {
            var pick = uniqueFor(app, items);
            APL.artCache.remember(app.id, pick && pick.bg, pick ? items.indexOf(pick) : 0);
        }
        if (warmItems._items === items) return;                 // this shelf is already being warmed
        warmItems._items = items;
        var i = 0;
        function next() {
            while (i < items.length) {
                var it = items[i++];
                if (!it || !it.bg || it.ok || it.bad || it._warm) continue;
                it._warm = true;
                (function (item) {
                    var im = new Image(), done = false;
                    var then = function (ok) {
                        if (done) return;
                        done = true;
                        if (ok) item.ok = true; else item.bad = true;
                        global.setTimeout(next, 160);           // one picture at a time: the page keeps drawing
                    };
                    im.onload = function () {
                        /* The first picture of an app is the one kept: it is what
                           the wall shows when that app takes the focus. The rest
                           are fetched for the row and left to the engine's cache. */
                        if (item === items[0] && inTopRow(app) && APL.artCache && !APL.artCache.look(item.bg)) APL.artCache.keep(item.bg);
                        then(true);
                    };
                    im.onerror = function () { then(false); };
                    im.src = srcOf(item);
                    global.setTimeout(function () { then(true); }, 4000);   // a stalled file must not stop the rest
                })(it);
                return;
            }
        }
        next();
    }

    /* The dock's row is at most seven apps, so at most seven pictures are kept:
       when the Home Screen is up they are fetched once, one shelf at a time, so
       the first visit to each app already has its backdrop instead of waiting for
       it. The row is read each time, so a rearranged dock is what gets warmed. */
    function warmDock() {
        if (!APL.live || !APL.live.itemsNow || !APL.artCache) return;
        var i = 0;
        function next() {
            while (i < apps.length && i < DOCK_SIZE) {
                var app = apps[i++];
                if (!app || !APL.live.hasSource(app) || APL.artCache.first(app.id)) continue;
                (function (a) {
                    global.setTimeout(function () {
                        if (apps.indexOf(a) === -1 || apps.indexOf(a) >= DOCK_SIZE) { next(); return; }
                        APL.live.itemsNow(a).then(function (items) {
                            var pick = uniqueFor(a, items);
                            if (pick && pick.bg) {
                                APL.artCache.remember(a.id, pick.bg, items.indexOf(pick));
                                if (!APL.artCache.look(pick.bg)) APL.artCache.keep(pick.bg);
                            }
                            next();
                        }, function () { next(); });
                    }, 700);                    // one at a time: the dock's own pane still comes first
                })(app);
                return;
            }
        }
        next();
    }

    /* Where the picture the wall is showing sits in the shelf that just answered. */
    function indexOfKept(app, items) {
        var kept = APL.artCache && APL.artCache.first ? APL.artCache.first(app.id) : "";
        if (!kept || !items) return 0;
        for (var i = 0; i < items.length; i++) if (items[i] && items[i].bg === kept) return i;
        return 0;
    }

    /* The dock's row is a handful of pictures: two apps showing the same one looks
       like a mistake. The app's own first title is taken, and when another app of
       the row already keeps that very picture, the next title of its shelf is
       kept instead - the whole shelf is walked, so a real shelf always has one
       more to offer. */
    function uniqueFor(app, items) {
        if (!items || !items.length) return null;
        var taken = {}, i, a, u;
        for (i = 0; i < apps.length && i < DOCK_SIZE; i++) {
            a = apps[i];
            if (!a || a === app) continue;
            u = APL.artCache.first(a.id);
            if (u) taken[u] = true;
        }
        for (i = 0; i < items.length; i++) {
            if (items[i] && items[i].bg && !taken[items[i].bg]) return items[i];
        }
        /* Every title of the shelf is already on the wall of a neighbour: its own
           first one is kept all the same, a picture being better than none. */
        return items[0];
    }

    /* Only the apps of the dock's row are worth a picture of their own: they are
       the ones a press lands on. Asked at the moment it is needed, so moving an
       app into the row by hand takes effect at once, and one moved out stops
       being kept. */
    function inTopRow(app) {
        var i = app ? apps.indexOf(app) : -1;
        return i !== -1 && i < DOCK_SIZE;
    }

    /* The picture as it is on the screen already (a blob kept from last time) or
       its address: a shelf that was seen before opens with no download at all. */
    function srcOf(item) {
        return (APL.artCache && item && APL.artCache.look(item.bg)) || (item && item.bg);
    }
    function setLiveBackdrop(app, item, n, items, tries) {
        if (item.bad) { if (items && (tries || 0) < items.length) setLiveBackdrop(app, items[(n + 1) % items.length], (n + 1) % items.length, items, (tries || 0) + 1); return; }
        if (item.ok) { swapLive(app, item, n); return; }
        var im = new Image();
        function shown() { item.ok = true; if (apps[nav.index] === app && mode !== "grid") swapLive(app, item, n); }
        im.onload = function () { if (im.decode) im.decode().then(shown, shown); else shown(); };
        im.onerror = function () { item.bad = true; if (apps[nav.index] === app) setLiveBackdrop(app, item, n, items, tries); };
        im.src = srcOf(item);
    }
    var liveShown = null;                                 // the Top Shelf item on screen: in full screen, OK opens it if it can
    function openable(app) {
        var shown = mode === "full" && liveShown && liveShown.app === app && bgActive.dataset.app === liveShown.tag ? liveShown.item : null;
        return shown && shown.link && APL.launchDeepLink ? shown : null;
    }
    /* Full screen on an item that opens directly: say so under its title. */
    function openHint() {
        dom.shelfInfo.classList.toggle("can-open", !!openable(apps[nav.index]));
    }
    function swapLive(app, item, n) {
        var tag = app.id + "#" + n;
        liveShown = { app: app, item: item, tag: tag };
        lastPicks[app.id] = item;
        if (bgActive.dataset.app === tag) return;
        var next = (bgActive === dom.bgA) ? dom.bgB : dom.bgA;
        next.innerHTML = "";
        next.dataset.app = tag;
        motion(next);
        /* The grid's blurred background is this picture. A kept one has no small
           copy beside it, and asking for nothing left the last app's blur in
           place: the drawer then opened on a picture that was no longer there. */
        wantBlur(item.bgSmall || item.bg || null, app, null);
        /* The picture from TMDB, Plex or YouTube is an <img> revealed once its
           decode is done, so it can never be painted a band at a time. */
        /* What fills the wall while a picture that is not drawn yet is decoded: the
           app's own artwork (bundled, local, instant), else the item's 300 px
           address. Without it the previous app's picture stayed on screen until the
           1280 JPEG had decoded, which read as the wrong show.
           Not when the picture is already decoded: rotating the wall inside one app
           comes through here with item.ok, and standing the app's artwork under it
           faded the wall to that artwork between two titles and then cut to the
           picture - and the drawer's blur was drawn from the artwork, because the
           picture was not on its element yet when the blur was baked. */
        var place = item.ok ? "" : (artOf(app) || item.bgSmall || "");
        showPicture(next, srcOf(item), function (pic) {
            /* Two quick ◀ presses reuse the same layer: an answer for the title
               before this one must not fade it in, or its picture lands under
               the new title. */
            if (!liveShown || liveShown.tag !== tag) return;
            /* Drawn here, before anything can return: the drawer's background must
               be ready by the time the user opens it, whatever the wall did. */
            flushBlur(pic);
            /* The title, its logo and its rating follow the picture on the wall,
               including when that picture was already there: leaving this to the
               branch below left the title empty until the focus moved away and
               back (a panel, or full screen and back, was what brought it). */
            shelfInfo(item);
            retryIfBlank(next, app, item, n, tag);
            if (bgActive === next) return;                 // already on screen
            /* The pane is ready before the picture is faded in, so the dock,
               the pill and the Control Center change with the backdrop instead
               of a second behind it - the poster of the last app under a new
               one. A pane that cannot be made answers at once, so nothing is
               ever held back by glass. */
            var fast = (Date.now() - stepAt) < 1500;      // stepping: the arrows are still moving
            var go = function () {
                if (!liveShown || liveShown.tag !== tag) return;
                if (bgActive === next) return;
                fadeTo(next, fast);
                if (fast) glassSoon(); else refreshGlass();
                shelfInfo(item);
            };
            /* The picture goes up at once and the frosted pane catches up
               behind it: waiting for the lens is what made a ◀ ▶ press feel
               slow, one baked pane per title. */
            /* Stepping: no pane per title, one refresh once the arrows rest. */
            go();
            if (!fast && APL.glass && APL.glass.prepare) {
                APL.glass.prepare(item.bg, function () {
                    if (!liveShown || liveShown.tag !== tag) return;
                    refreshGlass();
                }, pic);
            }
        }, place, !item.ok && !place);
    }

    /* An image that fails (a network answer that never comes, a file that cannot
       be decoded on this panel) left its layer on screen and empty: the wall
       stayed blank until the focus moved away and came back, which asked for the
       picture again. It asks again by itself, twice, then lets the app's own
       artwork take over. */
    function retryIfBlank(layer, app, item, n, tag) {
        global.setTimeout(function () {
            if (!liveShown || liveShown.tag !== tag) return;
            var im = layer.querySelector("img:not(.brandcard__icon)");
            if (im && im.complete && im.naturalWidth) return;
            item._tries = (item._tries || 0) + 1;
            if (item._tries > 2) { item.bad = true; setBackdrop(app, true); return; }
            delete item.ok;
            delete item.bad;
            /* The layer keeps the name of what it shows, and that name is what
               told the next attempt it was already there. It is cleared so the
               picture is asked for again. */
            layer.dataset.app = "";
            setLiveBackdrop(app, item, n, (app._liveItems && app._liveItems.length) ? app._liveItems : [item], 0);
        }, 1600);
    }

    /* Title and rating of the Top Shelf film or series (videos and games have none). */
    function shelfInfo(item) {
        /* A film or a series has a type; a video, an album or a game says where it
           comes from ("TizenTube", "Top albums"): that is what goes under the
           title, so What You're Watching names what it is showing on every app
           and not only on the film ones. */
        var has = !!(item && (item.type || item.poster || (item.title && item.sub)));
        dom.shelfInfo.classList.toggle("is-visible", has);
        if (!has) return;
        titleShow(item.title, item.logo);
        /* A Top Shelf picture often arrives without its logo, and the fanart and
           TMDB backdrops are exactly the ones that need it: TMDB has it. */
        /* No logo in the shelf data: TMDB has it, but that is two requests per
           title, and ten of them in a second competed with the pictures being
           fetched. While the arrows move the line stays empty; it fills once
           they rest, on the title that is actually on the wall. */
        clearTimeout(shelfInfo._logo);
        if (!item.logo && item.title && item.type) {
            var want = item.title, wantYear = item.year || "";
            shelfInfo._logo = setTimeout(function () { logoOf(want, wantYear); },
                (Date.now() - stepAt) < 1500 ? 420 : 0);
        } else if (!item.logo && item.title) {
            /* A video on YouTube, an album, a game: nothing draws its title, and
               the video's own name is all it has. It was left to the small line
               under the title (26 px, the channel), which read as a caption. */
            titleWords(item.title);
        }
        dom.shelfMeta.textContent = item.meta !== undefined ? item.meta
            : (item.type ? APL.live.metaOf(item) : (item.sub || ""));
        openHint();
    }

    /* The pane for the title that comes next is baked while this one is on
       screen: the twenty-second change then lands on a slice that is already
       made, instead of the dock finishing a bake after the picture changed. */
    function warmNext(items, i) {
        if (!items || !items.length) return;
        var item = items[i % items.length];
        if (!item || !item.bg) return;
        /* The whole picture of the title that is coming, decoded before it is
           asked for: the step then paints a bitmap instead of decoding a 1280 JPEG
           on the panel. One picture at a time, not the row's: a decoded one is a
           few megabytes, and the list here moves on with the rotation. */
        preload(item.bg);
        if (APL.glass && APL.glass.prefetch) APL.glass.prefetch(item.bg);
    }

    /* A new full-screen image costs 100 ms: as rarely as possible, and never while navigating. */
    var LIVE_ROTATE_MS = 20000;
    function stopLive() {
        clearTimeout(liveTimer); clearInterval(liveRotate);
        liveTimer = liveRotate = null;
    }

    /* New sources found (Smart Hub rows read late): the app in the dock starts over with them. */
    APL.onLiveSources = function () {
        var app = apps[nav.index];
        if (app && mode !== "grid" && nav.index < DOCK_SIZE) startLive(app);
    };

    /* The panes of the apps either side are baked while this one is on screen:
       stepping along the row never waits for one, which was the last place a
       pane could still arrive a moment after the picture it belongs to. */
    function warmNear(i) {
        [-1, 1].forEach(function (d) {
            var app = apps[i + d];
            if (!app) return;
            var art = artOf(app);
            if (!art) return;
            /* Decoded before the arrow is pressed, so a step paints a bitmap: this
               is what a smaller copy used to buy, at the picture's own size. */
            preload(art);
            if (APL.glass && APL.glass.prefetch) APL.glass.prefetch(art);
        });
    }

    /* After a short pause on the app, its current content is loaded. */
    function startLive(app) {
        stopLive();
        if (!APL.live || !APL.live.hasSource(app)) return;
        liveTimer = setTimeout(function () {
            APL.live.itemsNow(app).then(function (items) {
                if (!items || apps[nav.index] !== app) return;
                if (APL.widgets && APL.widgets.isShowing()) return;   // hidden by the cards: nothing to draw
                /* The wall is already showing this app's kept picture: the shelf
                   starts on that same title, or the picture would change back to
                   the first one a moment after it was drawn. */
                var n = APL.artCache && APL.artCache.firstIndex ? APL.artCache.firstIndex(app.id) : 0;
                if (!items[n] || (APL.artCache.first(app.id) && items[n].bg !== APL.artCache.first(app.id))) {
                    n = indexOfKept(app, items);
                }
                if (n < 0 || n >= items.length) n = 0;
                /* Kept on the app: a ◀ ▶ press then moves this list, with no shelf
                   asked for again - that second request is what a step used to
                   wait for. */
                app._liveItems = items;
                app._liveN = n;
                setLiveBackdrop(app, items[n], n, items, 0);
                warmNext(items, n + 1);
                warmItems(items, app);
                liveRotate = setInterval(function () {
                    if (mode === "grid" || mode === "full") return;  // paused under the grid and in full screen
                    if (document.hidden) return;                     // and behind an app: nobody sees it
                    if (apps[nav.index] !== app) { stopLive(); return; }
                    n = (n + 1) % items.length;
                    app._liveN = n;                     // the wall moved: the trailer follows it
                    setLiveBackdrop(app, items[n], n, items, 0);
                    warmNext(items, n + 1);
                }, LIVE_ROTATE_MS);
            });
        }, app._liveItems && app._liveItems.length ? 80 : 260);
    }

    var bgTimer = null, lastFocus = 0;
    function onFocus(i, el) {
        lastFocus = i;
        rotN = 0;
        var app = apps[i], inDock = el.dataset.row === "0", fromGrid = mode === "grid";
        focusFx(el);
        if (!inDock) stopRotate();
        if (mode !== "full") setMode(inDock ? "shelf" : "grid");
        else { layout(); if (APL.trailer) { publishPickOnWall(); APL.trailer.arm(app, trailerOver, pickOnWall(app)); } }
        if (APL.widgets) APL.widgets.show(inDock ? app : null, fromGrid);
        if (!inDock) flushBlur();
        // In the grid, as on tvOS: the Top Shelf artwork freezes and becomes
        // the blurred background; it no longer changes from one app to the next (and nothing to decode).
        if (!inDock) { clearTimeout(bgTimer); return; }
        var live = APL.live && APL.live.hasSource(app);
        // ▲ for full screen only where there is a film to see: not over one wallpaper shared by every app
        dom.hint.classList.toggle("is-visible", ((!!artOf(app) && !walled()) || live) && APL.sys.pref("showHint"));
        warmNear(i);                                   // either side, before it is asked for
        if (live && bgActive.dataset.app && bgActive.dataset.app.indexOf(app.id + "#") === 0) return;   // already shown
        /* Its own artwork is already the layer on screen (after a change of the
           Dynamic Backdrops setting, for one). The shelf picture still has to
           start, or the shelf stays empty until the focus leaves and returns. */
        if (bgActive.dataset.app === app.id) { if (live) startLive(app); return; }
        /* This app's backdrop is kept on the screen: it goes up the moment the app
           takes the focus, so no generated sheet of light is ever shown in its
           place while its shelf is fetched. */
        var kept = live && APL.artCache && APL.artCache.first ? APL.artCache.first(app.id) : "";
        if (kept && APL.artCache.look(kept)) {
            /* The picture is on the screen already: it goes up at once, so two
               apps that both have one only ever fade into each other. */
            setLiveBackdrop(app, { bg: kept, ok: true }, "c", null, 0);
            startLive(app);
            return;
        }
        /* Nothing kept yet (the first launch, or an app whose six hours are up):
           the sheet of light holds the wall while it is fetched, as before. */
        shelfInfo(null);
        // Full-screen artwork changed a fraction of a second after the focus: when
        // scrolling fast, a large image isn't decoded on every press.
        clearTimeout(bgTimer);
        var swap = function () {
            /* A shelf whose pictures are already here paints once. Drawing the
               app's own artwork first and the shelf's a moment later changed
               both the backdrop and the dock's pane twice, which is what read
               as the glass lagging behind while scrolling. */
            if (live && APL.live && APL.live.hasSource(app) && app._liveItems && app._liveItems.length) {
                startLive(app);
                return;
            }
            setBackdrop(app);
            startLive(app);
        };
        if (!bgActive.dataset.app) swap(); else bgTimer = setTimeout(swap, 170);
    }

    function launch(i) {
        var el = tiles[i];
        el.classList.add("is-pressed");
        setTimeout(function () { el.classList.remove("is-pressed"); }, 160);
        if (!apps[i].virtual || apps[i].web) APL.sys.profiles.noteLaunch(apps[i].id);   // profile history
        if (apps[i].web && APL.sys.PREVIEW) { toast(APL.t("Preview: on your TV, “{name}” would open in Internet ({url})", { name: apps[i].name, url: apps[i].url.replace(/^https:\/\/|\/$/g, "") })); return; }
        if (apps[i].virtual) { apps[i].run(); return; }
        if (APL.sys.PREVIEW) { toast(APL.t("Preview: on your TV, “{name}” would open now", { name: apps[i].name })); return; }
        showVeil();
        var id = apps[i].id;
        // Your own item, enlarged with ▲ (Plex's Continue Watching, a Spotify mix): straight to it.
        // From the dock, OK opens the app as usual.
        var shown = openable(apps[i]);
        if (shown) {
            APL.launchDeepLink(id, shown.link).catch(function () { APL.launchApp(id).catch(function (err) { hideVeil(); toast(err.message || APL.t("Couldn't open the app")); }); });
            return;
        }
        if (TUBE.test(apps[i].name)) { launchTube(id); return; }
        APL.launchApp(id).catch(function (err) { hideVeil(); toast(err.message || APL.t("Couldn't open the app")); });
    }

    /* When an app opens: the screen dims right away, the app appears over it.
       The veil goes away on returning Home, or by itself if the app couldn't open. */
    var veilTimer = null, veilHeldUntil = 0;
    function showVeil() {
        var v = $("veil");
        if (!v) { v = document.createElement("div"); v.id = "veil"; v.className = "veil"; document.body.appendChild(v); }
        v.classList.add("is-on");
        clearTimeout(veilTimer);
        veilTimer = setTimeout(hideVeil, Math.max(5000, veilHeldUntil - Date.now()));
    }
    function hideVeil() {
        if (Date.now() < veilHeldUntil) return;
        clearTimeout(veilTimer);
        var v = $("veil");
        if (v) v.classList.remove("is-on");
    }
    /* TizenTube from cold: the launcher comes back to the front while TizenBrew restarts (instead
       of the Samsung home screen) and stays black until then. */
    APL.holdVeil = function (ms) { veilHeldUntil = Date.now() + ms; showVeil(); };

    /* TizenTube replaces Samsung's YouTube app: that one must be closed first,
       otherwise TizenTube can get stuck or give way to Samsung's YouTube (same
       fix as "Fix TizenTube" in Vetro). With no answer from Vetro within 1.5 s,
       it launches anyway. */
    var TUBE = /^(TizenTube|TizenBrew)$/;
    var SAMSUNG_YOUTUBE = ["com.samsung.tv.cobalt-yt", "111299001912"];
    /* TizenTube's own app (TizenTube Cobalt, the way its makers now ship it), not TizenBrew's module.
       Installed, it is the TizenTube tile: in the place of the one that goes through TizenBrew
       (buildList, applySavedOrder), and what the remote's TizenTube button opens (openById). */
    var TUBE_APP = /^xvvl3S1TT1\./;
    function ownTube(list) { return list.filter(function (a) { return TUBE_APP.test(a.id); })[0] || null; }
    function launchTube(id) {
        var done = false;
        function go() {
            if (done) return;
            done = true;
            (id ? APL.launchApp(id) : APL.launchTizenTube()).catch(function (err) { hideVeil(); toast(err.message || APL.t("Couldn't open the app")); });
        }
        // Most of the time Samsung's YouTube isn't running: nothing to close, TizenTube opens right away
        APL.sys.runningApps().then(function (ids) {
            var open = SAMSUNG_YOUTUBE.filter(function (a) { return ids.indexOf(a) !== -1; });
            if (!open.length) { go(); return; }
            APL.sys.vetroPost("/exec", { cmd: open.map(function (a) { return "app_launcher -k " + a + " >/dev/null 2>&1"; }).join("; ") + "; true" })
                .then(function () { setTimeout(go, 300); }, go);
            setTimeout(go, 1500);
        }, go);
    }

    /* Settings › Apps: closes the apps left open behind the launcher. Only Home Screen apps
       and the big video apps: never a screen service. TizenTube stays ready (20 s from cold). */
    var KEEP_OPEN = /^(APLauncher\.|apl\.launcher\.|xvvl3S1bvH\.|xvvl3S1TT1\.|vetrotvapp)/;
    var VIDEO_APPS = ["org.tizen.netflix-app", "org.tizen.primevideo", "HEPsqFNie0.tvplusstandalone"];   // their tile carries a different id
    function memoryLeft() {
        if (APL.sys.memoryLeft) return APL.sys.memoryLeft();        // LG (webos-system.js)
        return APL.sys.exec("awk '/MemAvailable|SwapFree/{s+=$2} END{print s}' /proc/meminfo").then(function (r) { return parseInt(r.output, 10) || 0; });
    }
    APL.freeMemory = function () {
        return APL.sys.runningApps().then(function (ids) {
            var known = allApps.filter(function (a) { return !a.virtual; }).map(function (a) { return a.id; }).concat(VIDEO_APPS);   // not Samsung's YouTube: it comes back by itself within 25 s
            var open = ids.filter(function (id) { return known.indexOf(id) !== -1 && !KEEP_OPEN.test(id); });
            if (!open.length) { toast(APL.t("No apps to close"), true); return; }
            return memoryLeft().then(function (before) {
                var cmd = open.map(function (id) { return "app_launcher -k " + id + " >/dev/null 2>&1"; }).join("; ") + "; sleep 1";
                var closing = APL.sys.closeApps
                    ? APL.sys.closeApps(open).then(function (done) { open = done; return new Promise(function (r) { setTimeout(r, 1000); }); })
                    : APL.sys.exec(cmd);
                return closing.then(memoryLeft).then(function (after) {
                    if (!open.length) { toast(APL.t("No apps to close"), true); return; }
                    var freed = Math.max(0, Math.round((after - before) / 1024));
                    toast(open.length > 1 ? APL.t("{n} apps closed: {mb} MB freed", { n: open.length, mb: freed }) : APL.t("{n} app closed: {mb} MB freed", { n: open.length, mb: freed }), true);
                });
            });
        }).catch(function (e) { toast(e.message); });
    };

    /* Once per full power-on: at start-up the system opens these apps by itself, and also the
       services turned off in Settings (they then stay closed, apart from a few). Tried on the M8:
       from 400 to 770 MB of available memory. The file in /tmp disappears on restart. It waits for the
       launcher to be in front, in the background: never an app that was just opened, and Home always responds. */
    var BOOT_CLOSE = VIDEO_APPS.concat(["MCmYXNxgcu.DisneyPlus", "com.samsung.tv.home.media", "com.samsung.tv.mycontents", "com.samsung.tv.quicklaunch",
                                        "org.tizen.browser", "com.samsung.tv.bixbycapsuleviewer", "org.tizen.art-app", "com.samsung.tv.aria-video",
                                        "com.samsung.tv.cobalt-yt"]);
    /* A command run once Vetro answers. Right after a full start Vetro needs up to 90 s, and the launcher can
       already be on screen a second after power-on (the screen's home app): the bridge then answers
       { ok: false } instead of failing, so that counts as "not yet" too. Tried every 15 s, `tries` times. */
    function whenVetro(cmd, tries, done) {
        APL.sys.exec(cmd).then(function (r) {
            if (r && r.ok === false) throw new Error(r.error || "Vetro not ready");
            if (done) done(true);
        }).catch(function () {
            if (tries > 0) setTimeout(function () { whenVetro(cmd, tries - 1, done); }, 15000);
            else if (done) done(false);
        });
    }

    var bootCleaned = false;
    function bootCleanup(tries) {
        if (bootCleaned || document.hidden || APL.sys.PREVIEW || APL.platform || !APL.sys.pref("bootCleanup")) return;
        bootCleaned = true;
        var frame = /LS03/i.test(APL.sys.product().model || "");      // The Frame: Art Mode needs art-app
        var ids = BOOT_CLOSE.filter(function (id) { return !(frame && id === "org.tizen.art-app"); })
                            .concat(Object.keys(APL.sys.pref("servicesCut") || {}));
        whenVetro("[ -f /tmp/apl-cleaned ] || { touch /tmp/apl-cleaned; (" + ids.map(function (id) {
            return "app_launcher -k " + id;
        }).join("; ") + ") >/dev/null 2>&1 & }; true", 0, function (ok) {
            if (ok) return;
            bootCleaned = false;
            // Again later, checking each time that the launcher is still in front (never an app just opened)
            if (tries > 0) setTimeout(function () { bootCleanup(tries - 1); }, 15000);
        });
    }

    /* After a full start (power cut, restart) the screen can come back on the TV input or Samsung TV Plus, with
       the launcher, its home app, already loaded behind it. That happens when Autorun Smart Hub is off at that
       start: Vetro's Custom launcher switches it off, and APL Overlay keeps it off during a standby that the
       restart went through. Nothing put the launcher in front then until APL Boot's own on-boot start, 30 to
       60 s later (an S90F). So APL Boot is started as soon as the launcher loads: it puts the launcher in front
       while Samsung's screen is there, leaves an app the screen opened by itself, and does nothing more than
       5 minutes after a start (overlay/boot/Program.cs). Only the Apps2Samsung package has APL Boot:
       elsewhere the launch fails, quietly. */
    function startBootKeeper() {
        var tz = global.tizen;
        if (APL.sys.PREVIEW || APL.platform || !tz || !tz.application) return;
        function plain() { try { tz.application.launch("APLauncher.Boot", null, function () {}); } catch (e) {} }
        try {
            tz.application.launchAppControl(new tz.ApplicationControl("http://tizen.org/appcontrol/operation/service"),
                                            "APLauncher.Boot", null, plain);
        } catch (e) { plain(); }
    }

    /* The system repeats a key after 350 ms, and the remote only "releases" it after 250 to
       340 ms: on a busy screen, in every app, a short press sometimes counted twice.
       The setting is lost on restart: it is set again at every launch, as soon as Vetro answers. */
    function slowKeyRepeat(tries) {
        if (APL.sys.PREVIEW || APL.platform) return;          // Samsung's key repeat, through Vetro
        whenVetro("enlightenment_info -key_repeat set 600 0 >/dev/null 2>&1; true", tries);
    }

    /* ---------- misc ---------- */
    /* info = secondary message, hidden when "Do Not Disturb" is on */
    function toast(msg, info) {
        if (info && APL.sys.pref("dnd")) return;
        dom.toast.textContent = msg;
        dom.toast.classList.add("is-visible");
        clearTimeout(toast._t);
        toast._t = setTimeout(function () { dom.toast.classList.remove("is-visible"); }, 2600);
    }

    function startClock() {
        function tick() {
            var d = new Date(), h = d.getHours(), m = ((d.getMinutes()) < 10 ? "0" : "") + d.getMinutes();
            var text = APL.sys.pref("clock24") ? ((h) < 10 ? "0" : "") + h + ":" + m : ((h % 12) || 12) + ":" + m;
            if (dom.clock.textContent !== text) dom.clock.textContent = text;
        }
        tick();
        setInterval(tick, 10000);
        APL.sys.onPref("clock24", tick);
    }

    function render() {
        var keep = nav && nav.index >= 0 ? apps[nav.index] && apps[nav.index].id : null;
        dropLayers();
        allApps.forEach(function (a) { if (a.folder && APL.folders.byId(a.folder)) a.tileHtml = APL.folders.tileHtml(APL.folders.byId(a.folder)); });
        // The Smart Hub tile starts hidden, once per profile: shown from Settings › Home Screen › Show on Home Screen
        if (!APL.sys.pref("smartHubTileSet")) {
            var hide = APL.sys.pref("hiddenApps").slice();
            if (hide.indexOf(SAMSUNG_HOME_TILE) === -1) hide.push(SAMSUNG_HOME_TILE);
            APL.sys.setPref("smartHubTileSet", true);
            APL.sys.setPref("hiddenApps", hide);
        }
        apps = allApps.filter(function (a) {
            if (APL.sys.pref("hiddenApps").indexOf(a.id) !== -1 || APL.folders.holding(a.id)) return false;
            return !a.folder || APL.folders.byId(a.folder);
        });
        dom.row0.innerHTML = "";
        dom.rows.innerHTML = "";
        tiles = apps.map(function (app, i) {
            var row = i < DOCK_SIZE ? 0 : 1 + Math.floor((i - DOCK_SIZE) / DOCK_SIZE);
            var t = makeTile(app, row);
            (row === 0 ? dom.row0 : dom.rows).appendChild(t);
            return t;
        });
        if (!nav) createNav();
        // Same app as before; if it has gone (deleted, hidden), the same position.
        var want = nav && nav.index >= 0 ? Math.min(nav.index, apps.length - 1) : 0;
        for (var i = 0; i < apps.length; i++) if (apps[i].id === keep) want = i;
        bgActive.dataset.app = "";
        nav.setTiles(tiles);
        nav.focus(want);
        /* The row may have just been rearranged, with apps in it that were never
           on the screen before: they are warmed here, not only at start-up. */
        global.setTimeout(warmDock, 900);
    }

    function createNav() {
        var K = APL.KEY;
        nav = new APL.Nav({
            onFocus: onFocus,
            onSelect: function (i) { launch(i); },
            onLongPress: function (i, el) { if (!editing) openAppMenu(i, el); },
            // The tile reacts as soon as it's pressed: the remote's delay no longer shows
            onHoldStart: function (i) { if (tiles[i]) tiles[i].classList.add("is-pressed"); },
            onHoldCancel: function (i) { if (tiles[i]) tiles[i].classList.remove("is-pressed"); },
            onEdge: function (dir) {
                // ▲ from the dock: the "Continue Watching" cards if the app has any…
                if (dir === "up" && mode === "shelf" && APL.widgets && APL.widgets.focusCards()) return;
                // … otherwise full screen (only if the app has artwork)
                var a = apps[nav.index];
                if (dir === "up" && mode === "shelf" && (a.bg || (APL.live && APL.live.hasSource(a)))) setMode("full");
            },
            onKey: function (code) {
                if (editing) return editKey(code);
                if (mode !== "full") return false;
                // In full screen: ◀ ▶ change app, ▼ / Back return, OK opens, ▲ Search (search.js).
                if (code === K.LEFT) return stepShow(-1);
                if (code === K.RIGHT) return stepShow(1);
                if (code === K.DOWN || code === K.RETURN || code === K.ESC || code === K.BACKSPACE) { setMode("shelf"); return true; }
                if (code === K.UP) { if (APL.search) APL.search.open(); return true; }
                return false;
            },
            onBack: function () {
                // Already on the first tile: stay there. Exiting left a black screen.
                if (nav.index !== 0) { nav.focus(0); }
            }
        });
        nav.attach();
    }

    function asset(p) { return global.APL_ASSET ? global.APL_ASSET(p) : p; }

    /* Apps built into the launcher, like Settings on Apple TV. */
    /* The Home app's mark: the Home Assistant logo as a vector, so the tile
       needs no new raster. Only the mark changes; the app is the same app. */
    var HA_MARK = '<svg class="vtile__ha" viewBox="0 0 24 24" aria-hidden="true"><path d="M22.939 10.627 13.061.749a1.505 1.505 0 0 0-2.121 0l-9.879 9.878C.478 11.21 0 12.363 0 13.187v9c0 .826.675 1.5 1.5 1.5h9.227l-4.063-4.062a2.034 2.034 0 0 1-.664.113c-1.13 0-2.05-.92-2.05-2.05s.92-2.05 2.05-2.05 2.05.92 2.05 2.05c0 .233-.041.456-.113.665l3.163 3.163V9.928a2.05 2.05 0 0 1-1.15-1.84c0-1.13.92-2.05 2.05-2.05s2.05.92 2.05 2.05a2.05 2.05 0 0 1-1.15 1.84v8.127l3.146-3.146A2.051 2.051 0 0 1 18 12.239c1.13 0 2.05.92 2.05 2.05s-.92 2.05-2.05 2.05c-.25 0-.488-.047-.709-.13L12.9 20.602v3.088h9.6c.825 0 1.5-.675 1.5-1.5v-9c0-.825-.477-1.977-1.061-2.561z"/></svg>';

    function virtualApps() {
        return [
            // TizenTube: its own tile, without going through TizenBrew's screen
            { id: "apl.tizentube", name: "TizenTube", virtual: true, needs: "xvvl3S1bvH.TizenBrewStandalone", accent: "#1fb6e6", eyebrow: "VIDÉO",
              tile: APL.TIZENTUBE_ART.tile, live: "youtube",
              run: function () { showVeil(); launchTube(null); } },
            // Home Assistant's dashboard, on the TV (homeassistant.js). Its address is a
            // private one, kept in js/keys.local.js: without it, the tile is not there at all.
            { id: "apl.homeassistant", name: APL.ha ? APL.ha.name() : "Home", virtual: true, accent: "#f5a623", eyebrow: "HOME",
              tileHtml: '<div class="vtile vtile--ha-mark">' + HA_MARK + '</div>',
              when: function () { return !!(APL.ha && APL.ha.available()); },
              run: function () { APL.ha.open(); } },
            // Apple's Settings icon (images/apps/settings-*, made by tools/art)
            { id: "apl.settings", name: APL.t("Settings"), virtual: true, accent: "#8e8e93", eyebrow: "SYSTÈME",
              tile: asset("images/apps/settings-tile.png"),
              run: function () { APL.settings.open(); } },
            { id: "apl.sources", name: APL.t("Sources"), virtual: true, accent: "#2c5cc5", eyebrow: "SYSTÈME",
              tileHtml: '<div class="vtile vtile--sources">' + APL.icon("source", 92, 1.6) + '</div>',
              shelfHtml: '<div class="brandcard__glyph vtile--sources">' + APL.icon("source", 180, 1.3) + '</div>',
              run: function () { APL.openSources(); } },
            // Samsung's own home: the way out now that Vetro keeps the Home key for the launcher.
            // Hidden like any app (Settings › Home Screen › Show on Home Screen, or hold OK › Hide App).
            { id: SAMSUNG_HOME_TILE, name: "Smart Hub", virtual: true, accent: "#1428a0", eyebrow: "SYSTÈME",
              tileHtml: '<div class="vtile vtile--samsunghome">' + APL.icon("apps", 92, 1.6) + '</div>',
              shelfHtml: '<div class="brandcard__glyph vtile--samsunghome">' + APL.icon("apps", 180, 1.3) + '</div>',
              run: openSamsungHome }
        ];
    }

    /* Samsung's home ignores a plain app-control launch (Vetro's dock found the same): the platform's
       own app_launcher, as root through Vetro, shows it. The overlay is told first, or it would put the
       launcher back over it within a second ("Return to the Launcher"). */
    var SAMSUNG_HOME_TILE = "apl.samsunghome";
    function openSamsungHome() {
        // Without Vetro nothing can show it, but Home on the remote is still Samsung's
        if (APL.sys.noVetro()) { toast(APL.t("Smart Hub needs Vetro. Without it, Home on the remote opens Samsung's home.")); return; }
        if (APL.sys.PREVIEW) { toast(APL.t("Opens Samsung's Smart Hub on the screen")); return; }
        // The overlay opens it itself (it reaches Vetro on its own, without the bridge) and then
        // leaves it on screen; without the overlay, the launcher asks Vetro.
        if (APL.overlay && APL.overlay.isInstalled() && APL.overlay.openSamsungHome) { APL.overlay.openSamsungHome(); return; }
        APL.sys.vetroPost("/exec", { cmd: "/usr/bin/app_launcher -s com.samsung.tv.csfs >/dev/null 2>&1 &" })
            .catch(function () { toast(APL.t("Vetro is not responding")); });
    }

    /* The catalogue is in flight while the dock is already up: the poster of the app in
       focus replaces its artwork as soon as it lands, and turning the setting off puts
       the artwork back without a restart. */
    function boot() {
        startBootKeeper();          // first: after a full start, every second counts
        cacheDom();
        if (APL.ccOverlay) { bootCc(); return; }
        dom.hint.querySelector(".hint__text").textContent = APL.t("Press ▲ for full screen");   // index.html only has the English text
        startClock();
        APL.sys.registerKeys();
        document.body.classList.toggle("reduce-motion", !!APL.sys.pref("reduceMotion"));
        APL.sys.onPref("reduceMotion", function (v) { document.body.classList.toggle("reduce-motion", !!v); });
        applyPerf();
        APL.sys.onPref("visualEffects", applyPerf);
        applyTheme();
        blurLayer();                 // the drawer's blurred canvas, made once, before it is needed
        APL.sys.onPref("appearance", applyTheme);
        APL.sys.onPref("appsPerRow", function () { sizes(); render(); layout(); });
        APL.sys.profiles.onChange(applyTheme);
        setInterval(applyTheme, 60000);
        APL.loadApps().then(function (list) {
            buildList(list);
            watchPackages();
            setTimeout(preloadDock, 400);
            // Then a background search for missing artwork (new apps included). On LG, once the start-up is over:
            // it ran into the busiest first seconds there (#55)
            setTimeout(function () { if (APL.autoArt) APL.autoArt.run(allApps, render); },
                       APL.platform && APL.platform.directGlass ? 15000 : 3500);
            showCcHint();
            render();
            if (APL.overlay) APL.overlay.start();
            slowKeyRepeat(8);
            setTimeout(function () { bootCleanup(8); }, 25000);
            global.APL_BOOT_OK = true;          // the version (installed or updated) starts fine
            if (requestedAction()) runAction(requestedAction());   // opened for a specific reason: TizenTube, App Switcher…
            hideBoot();
        });
    }

    /* The start-up screen leaves once the Home Screen is really there - and not
       before it has been up for a moment: a black frame that appears and goes in
       a flash reads as a fault, a mark that stays a second reads as a start. The
       time is counted from the navigation, so a slow load keeps it up for as long
       as it is needed and a fast one still shows it for a second. */
    function hideBoot() {
        var nav = (global.performance && global.performance.now) ? global.performance.now() : 900;
        var wait = Math.max(0, 900 - nav);
        global.setTimeout(function () { if (dom.boot) dom.boot.classList.add("is-hidden"); }, wait + 120);
    }

    /* The Control Center over the apps (LG's Guide button, webos.js): nothing of the Home Screen, no app
       list, no artwork, no timers; the panel at once, and the window goes when it closes. */
    function bootCc() {
        APL.sys.registerKeys();
        document.body.classList.toggle("reduce-motion", !!APL.sys.pref("reduceMotion"));
        applyPerf();
        applyTheme();
        global.APL_BOOT_OK = true;
        hideBoot();
        if (APL.controlCenter) APL.controlCenter.open();
    }

    /* Full list: the dock (your apps, Settings, Sources), then your websites,
       Vetro, App Store, Samsung TV Plus and the rest in alphabetical order. */
    var virtuals = null;
    function buildList(list) {
        var favs = list.filter(function (a) { return a.favorite; });
        var FIRST = ["Vetro", "App Store", "Samsung TV Plus"];
        var rank = function (a) { if (a.web) return -1; var i = FIRST.indexOf(a.name); return i === -1 ? 99 : i; };
        var rest = list.filter(function (a) { return !a.favorite; }).concat(APL.webApps ? APL.webApps() : []).sort(function (a, b) {
            return rank(a) - rank(b) || a.name.localeCompare(b.name, APL.locale, { sensitivity: "base" });
        });
        // needs: the app it goes through. when: set up on this installation only.
        // Another platform keeps the tiles it can open (android.js: no Sources, its own home for Smart Hub)
        virtuals = virtuals || (APL.platform && APL.platform.virtualApps ? APL.platform.virtualApps(virtualApps()) : virtualApps());
        var own = ownTube(list);       // TizenTube's own app: the TizenTube tile (it is first among favs)
        var usable = virtuals.filter(function (v) {
            if (own && v.id === "apl.tizentube") return false;
            return (!v.needs || list.some(function (a) { return a.id === v.needs; })) && (!v.when || v.when());
        }).concat(APL.sources ? APL.sources.homeTiles() : []);              // inputs pinned to the Home Screen
        var tube = usable.filter(function (v) { return v.id === "apl.tizentube"; });
        defaultOrder = tube.concat(favs, usable.filter(function (v) { return tube.indexOf(v) === -1; }), rest, APL.folders.all().map(APL.folders.asApp));
        allApps = applySavedOrder(defaultOrder);
        // Artwork already found automatically (kept on the screen): right away
        if (APL.autoArt) APL.autoArt.applyCached(allApps);
    }

    /* An app installed, updated or deleted (by APL Launcher Setup, the App Store…):
       the grid updates by itself, without restarting the launcher. */
    var pkgTimer = null;
    function watchPackages() {
        var pm = (global.tizen && global.tizen.package) || (APL.platform && APL.platform.packages);
        if (!pm || typeof pm.setPackageInfoEventListener !== "function") return;
        function again() {
            clearTimeout(pkgTimer);
            pkgTimer = setTimeout(function () {
                APL.loadApps().then(function (list) {
                    var focused = apps[nav.index] && apps[nav.index].id;
                    buildList(list);
                    render();
                    for (var i = 0; i < apps.length; i++) if (apps[i].id === focused) { nav.focus(i); break; }
                    if (APL.autoArt) setTimeout(function () { APL.autoArt.run(allApps, render); }, 1500);
                });
            }, 1500);
        }
        try { pm.setPackageInfoEventListener({ oninstalled: again, onupdated: again, onuninstalled: again }); } catch (e) {}
    }

    /* ---------- chosen layout (Edit Home Screen) ---------- */
    var defaultOrder = [];
    function applySavedOrder(list) {
        var saved = APL.sys.pref("appOrder") || [];
        if (!saved.length) return list.slice();
        var pos = {};
        saved.forEach(function (id, i) { pos[id] = i; });
        // A layout from before these tiles: TizenTube first, Overscan in place of Internet
        if (!("apl.tizentube" in pos)) pos["apl.tizentube"] = -1;
        // TizenTube's own app, newly installed: in the TizenTube tile's place, not at the end
        var own = ownTube(list);
        if (own && !(own.id in pos)) pos[own.id] = pos["apl.tizentube"];
        var browser = saved.indexOf("org.tizen.browser");
        if (browser !== -1 && !("org.apps2samsung.overscan" in pos)) pos["org.apps2samsung.overscan"] = browser;
        // Only once: AquaPlay moves up into the dock (its widgets show there) in place of TizenBrew,
        // which the TizenTube tile replaces
        var AQUA = "AquaPlay02.AquaPlay", BREW = "xvvl3S1bvH.TizenBrewStandalone", moved = false;
        if (!APL.sys.pref("aquaInDock") && BREW in pos && list.some(function (a) { return a.id === AQUA; })) {
            var brewAt = pos[BREW];
            pos[BREW] = AQUA in pos ? pos[AQUA] : 100000;
            pos[AQUA] = brewAt;
            moved = true;
        }
        // Only once: Stremio moves up into the dock, after AquaPlay (its widgets only show there)
        var STREMIO = "IkWsFHtOY9.Stremio", moveStremio = !APL.sys.pref("stremioInDock") && list.some(function (a) { return a.id === STREMIO; });
        if (moveStremio) pos[STREMIO] = (AQUA in pos ? pos[AQUA] : 0) + 0.5;
        // Known apps in their place; new apps at the end, as on tvOS.
        var ordered = list.map(function (a, i) { return { a: a, k: (a.id in pos) ? pos[a.id] : 100000 + i }; })
                          .sort(function (x, y) { return x.k - y.k; })
                          .map(function (x) { return x.a; });
        if (moved || moveStremio) APL.sys.setPref("appOrder", ordered.map(function (a) { return a.id; }));
        if (moved) APL.sys.setPref("aquaInDock", true);
        if (moveStremio) APL.sys.setPref("stremioInDock", true);
        return ordered;
    }
    function saveOrder() { APL.sys.setPref("appOrder", allApps.map(function (a) { return a.id; })); }

    /* ---------- "hold OK" menu (as on tvOS) ---------- */
    var PROTECTED = /^(vetrotvapp|APLauncher\.|xvvl3S1bvH\.|com\.samsung\.|org\.tizen\.|samsung\.)/i;   // xvvl3S1bvH: TizenBrew

    function openAppMenu(i, el) {
        var app = apps[i];
        if (!app) return;
        var anchor = el.querySelector(".tile__card") || el;
        var items = [{ label: APL.t("Edit Home Screen"), icon: "grid", run: function () { startEdit(app.id); } }];
        if (app.folder) {
            items.unshift({ label: APL.t("Rename"), icon: "grid", run: function () { APL.folders.askName(app.folder); } });
            items.push({ label: APL.t("Delete Folder"), icon: "trash", destructive: true, run: function () {
                APL.folders.destroy(app.folder);
                APL.foldersChanged();
                toast(APL.t("Folder deleted: its apps are back on the Home Screen"), true);
            } });
            APL.contextMenu.open(anchor, items);
            return;
        }
        items.push({ label: APL.t("Move to Folder"), icon: "grid", run: function () { chooseFolder(app, anchor); } });
        items.push({ label: APL.t("Change Icon"), icon: "photo", run: function () { chooseIcon(app); } });
        if (app.id !== "apl.settings") {
            items.push({ label: APL.t("Hide App"), icon: "eyeOff", run: function () { hideApp(app); } });
        }
        // Deleted through Vetro; on another TV system, through its own way when it has one (LG, rooted: the apps LG lets you delete)
        var P = APL.platform;
        if (!app.virtual && !PROTECTED.test(app.id) && (!P || (P.canDelete && P.canDelete(app)))) {
            items.push({ label: APL.t("Delete App"), icon: "trash", destructive: true, run: function () { confirmDelete(app); } });
        }
        APL.contextMenu.open(el.querySelector(".tile__card") || el, items);
    }

    /* ---------- Change Icon (hold OK) ----------
       Another picture for an app's tile, among the launcher's own: every logo of the catalogue
       and the few tiles it draws itself. TizenTube with YouTube's own logo was asked for on
       Reddit. Kept for the whole screen (the appIcons setting, by app id); Original gives the
       app its own tile back. The Top Shelf stays the app's. */
    var OWN_TILES = [
        { name: "TizenTube", tile: "images/tile-tizentube.png" },
        { name: "TizenBrew", tile: "images/tile-tizenbrew.png" },
        { name: "Internet", tile: "images/tile-internet.png" },
        { name: "Hot IPTV", tile: "images/tile-hotiptv.png" }
    ];
    function iconOf(app) { return app && !app.folder ? (APL.sys.pref("appIcons") || {})[app.id] || "" : ""; }
    /* The picture a tile shows: the chosen one, else the app's own (folders.js, profiles.js). */
    APL.tileOf = function (app) { var p = iconOf(app); return p ? asset(p) : app && app.tile; };

    function iconChoices() {
        var seen = {}, list = [];
        (global.APL_CATALOG || []).concat(OWN_TILES).forEach(function (c) {
            if (!c.tile || seen[c.tile]) return;
            seen[c.tile] = true;
            list.push({ name: APL.t(c.name || c.key || ""), tile: c.tile });     // Settings: Réglages in French
        });
        return list.sort(function (a, b) { return a.name.localeCompare(b.name, APL.locale, { sensitivity: "base" }); });
    }

    function chooseIcon(app) {
        var box = document.createElement("div");
        box.className = "ipicker";
        box.innerHTML = '<h2 class="ipicker__title"></h2><div class="ipicker__scroll"><div class="ipicker__grid"></div></div>';
        box.firstChild.textContent = APL.t("Icon for “{app}”", { app: app.name });
        var grid = box.querySelector(".ipicker__grid"), items = [], now = iconOf(app), at = 0;
        function item(name, paint, path) {
            var it = document.createElement("div"), art = document.createElement("div"), label = document.createElement("div");
            it.className = "ipicker__item" + (path === now ? " is-current" : "");
            art.className = "ipicker__art";
            label.className = "ipicker__name";
            paint(art);
            label.textContent = name;
            it.appendChild(art);
            it.appendChild(label);
            it._path = path;
            if (path === now) at = items.length;
            grid.appendChild(it);
            items.push(it);
        }
        // The app's own tile first, as the Home Screen draws it without a choice
        item(APL.t("Original"), function (art) {
            if (app.tileHtml) { art.innerHTML = app.tileHtml; return; }
            if (app.tile) { art.style.backgroundImage = "url('" + app.tile + "')"; return; }
            art.style.background = app.accent || "#2a2a2e";
            if (!app.icon) { art.appendChild(letter(app.name)); return; }
            var img = document.createElement("img");
            img.alt = "";
            img.src = app.icon;
            art.appendChild(img);
        }, "");
        iconChoices().forEach(function (c) {
            item(c.name, function (art) { art.style.backgroundImage = "url('" + asset(c.tile) + "')"; }, c.tile);
        });
        document.body.appendChild(box);
        // The grid scrolls to keep the chosen row on screen (3rd row at the lowest): launcher.css .ipicker
        var ROW = 204;
        var pick = new APL.Nav({
            onFocus: function (i, t) {
                grid.style.transform = "translateY(" + (-Math.max(0, Math.round(t.offsetTop / ROW) - 2) * ROW) + "px)";
            },
            onSelect: function (i, t) {
                var cur = APL.sys.pref("appIcons") || {}, next = {}, k;
                for (k in cur) if (Object.prototype.hasOwnProperty.call(cur, k) && k !== app.id) next[k] = cur[k];
                if (t._path) next[app.id] = t._path;
                APL.sys.setPref("appIcons", next);
                done();
                render();
            },
            onBack: done
        });
        function done() {
            APL.popNav(pick);
            if (box.parentNode) box.parentNode.removeChild(box);
        }
        pick.setTiles(items);
        pick.focus(at);
        APL.pushNav(pick);
    }

    function chooseFolder(app, anchor) {
        var items = APL.folders.all().map(function (f) {
            return { label: f.name, icon: "grid", run: function () { APL.folders.addTo(f.id, app.id); APL.foldersChanged(); toast(APL.t("“{app}” is in “{folder}”", { app: app.name, folder: f.name }), true); } };
        });
        items.push({ label: APL.t("New Folder"), icon: "grid", run: function () {
            var at = allApps.indexOf(app), f = APL.folders.create(app.id);
            allApps.splice(at, 0, APL.folders.asApp(f));
            APL.foldersChanged();
            toast(APL.t("“{name}” created: hold OK on it to rename it", { name: f.name }), true);
        } });
        APL.contextMenu.open(anchor, items);
    }

    /* After a folder change: the Home Screen follows, and the layout is kept. */
    APL.foldersChanged = function () {
        allApps = allApps.filter(function (a) { return !a.folder || APL.folders.byId(a.folder); });
        saveOrder();
        render();
    };

    /* Open an app as the Home Screen knows it (folder, App Switcher…). */
    APL.openApp = function (app) {
        if (app.virtual) { app.run(); return; }
        APL.sys.profiles.noteLaunch(app.id);
        showVeil();
        APL.launchApp(app.id).catch(function (err) { hideVeil(); toast(err.message || APL.t("Couldn't open the app")); });
    };
    APL.makeTile = makeTile;

    function hideApp(app) {
        var hidden = APL.sys.pref("hiddenApps").slice();
        if (hidden.indexOf(app.id) === -1) hidden.push(app.id);
        APL.sys.setPref("hiddenApps", hidden);
        render();
        toast(APL.t("“{name}” is hidden — Settings › Apps to show it again", { name: app.name }));
    }

    function confirmDelete(app) {
        APL.alert({
            title: APL.t("Delete “{name}”?", { name: app.name }),
            message: APL.t("The app and its data will be deleted from the screen. You can reinstall it from the App Store."),
            buttons: [
                { label: APL.t("Delete"), destructive: true, run: function () { deleteApp(app); } },
                { label: APL.t("Cancel") }
            ],
            focus: 1                       // "Cancel" by default: no deleting by mistake
        });
    }

    function dropApp(id) {
        allApps = allApps.filter(function (a) { return a.id !== id; });
        saveOrder();
        render();
    }

    /* Deletion through Vetro (it refuses system and protected apps), then
       a real check in the list of installed apps. */
    function deleteApp(app) {
        if (APL.sys.PREVIEW) { dropApp(app.id); toast(APL.t("“{name}” was deleted (preview)", { name: app.name })); return; }
        toast(APL.t("Deleting “{name}”…", { name: app.name }));
        // Another TV system (LG): its own deletion, which answers once the app is gone
        if (APL.platform && APL.platform.deleteApp) {
            APL.platform.deleteApp(app).then(function () {
                dropApp(app.id);
                toast(APL.t("“{name}” was deleted", { name: app.name }));
            }, function (e) {
                toast(/system/.test(e && e.message || "") ? APL.t("“{name}” is part of the TV's system and can't be deleted. You can hide it.", { name: app.name })
                                                          : APL.t("Couldn't delete “{name}”. You can hide it.", { name: app.name }));
            });
            return;
        }
        APL.sys.vetroPost("/components/action", { appId: app.id, action: "uninstall" }).catch(function () {});
        var tries = 0;
        (function check() {
            setTimeout(function () {
                APL.isInstalled(app.id).then(function (still) {
                    if (!still) { dropApp(app.id); toast(APL.t("“{name}” was deleted", { name: app.name })); return; }
                    if (++tries < 8) { check(); return; }
                    toast(APL.t("Couldn't delete “{name}” (system app, or Vetro stopped). You can hide it.", { name: app.name }));
                });
            }, 2500);
        })();
    }

    /* ---------- Edit Home Screen: the app jiggles, the arrows move it ---------- */
    var editing = null;

    function markMoving() {
        tiles.forEach(function (t, k) { t.classList.toggle("is-moving", !!editing && apps[k].id === editing); });
    }

    function startEdit(id) {
        editing = id;
        document.body.classList.add("is-editing");
        markMoving();
        toast(APL.t("Move the app with the arrows, then press OK"), true);
    }

    function endEdit() {
        editing = null;
        document.body.classList.remove("is-editing");
        markMoving();
        saveOrder();
    }

    function editKey(code) {
        var K = APL.KEY;
        if (code === K.ENTER || code === K.RETURN || code === K.ESC || code === K.BACKSPACE) {
            endEdit();
            if (APL.sound) APL.sound.select();
            return true;
        }
        var step = { 37: -1, 39: 1, 38: -6, 40: 6 }[code];
        if (!step) return true;                        // other keys ignored while editing
        var i = -1;
        for (var k = 0; k < apps.length; k++) if (apps[k].id === editing) i = k;
        var j = i + step;
        if (code === K.DOWN && j >= apps.length && i < apps.length - 1) j = apps.length - 1;
        if (i < 0 || j < 0 || j >= apps.length) { if (APL.sound) APL.sound.edge(); return true; }
        var visible = apps.slice();
        visible.splice(j, 0, visible.splice(i, 1)[0]);
        var hidden = allApps.filter(function (a) { return visible.indexOf(a) === -1; });
        allApps = visible.concat(hidden);
        render();
        markMoving();
        if (APL.sound) APL.sound.tick();
        return true;
    }

    /* Home button: closes whatever is open and goes back to the 1st app.
       Returns false if already on the Home Screen (2nd press = Control Center). */
    APL.goHome = function () {
        var closed = false;
        /* The Home app is a screen of its own, not a package: it has to go too,
           or Home (sent as blue on screens whose overlay maps it that way)
           leaves the house drawn over the Home Screen, still taking keys. */
        if (global.CleanFrameHomeApp && global.CleanFrameHomeApp.isOpen && global.CleanFrameHomeApp.isOpen()) {
            global.CleanFrameHomeApp.close(); closed = true;
        }
        if (APL.screensaver && APL.screensaver.isActive()) { APL.screensaver.stop(); closed = true; }
        if (APL.alert && APL.alert.isOpen && APL.alert.isOpen()) { APL.alert.close(); closed = true; }
        if (APL.contextMenu && APL.contextMenu.isOpen()) { APL.contextMenu.close(); closed = true; }
        if (APL.sources && APL.sources.isOpen()) { APL.sources.close(); closed = true; }
        if (APL.search && APL.search.isOpen()) { APL.search.close(); closed = true; }
        if (APL.profilesUI && APL.profilesUI.isOpen()) { APL.profilesUI.close(); closed = true; }
        if (APL.settings && APL.settings.isOpen()) { APL.settings.close(); closed = true; }
        if (APL.controlCenter && APL.controlCenter.isOpen()) { APL.controlCenter.close(); closed = true; }
        if (APL.widgets && APL.widgets.leaveCards()) closed = true;
        if (editing) { endEdit(); closed = true; }
        if (mode === "full") { setMode("shelf"); closed = true; }
        if (nav && nav.index > 0) { nav.focus(0); closed = true; }
        return closed;
    };

    /* Open an app from elsewhere (a profile's recent apps) */
    APL.launchById = function (id) {
        for (var i = 0; i < apps.length; i++) if (apps[i].id === id) { nav.focus(i); launch(i); return; }
        APL.sys.profiles.noteLaunch(id);
        APL.launchApp(id).catch(function (err) { toast(err.message || APL.t("Couldn't open the app")); });
    };

    /* Profile change: its layout and its hidden apps */
    APL.sys.profiles.onChange(function () {
        if (!defaultOrder.length) return;
        var keep = allApps;
        allApps = applySavedOrder(defaultOrder.filter(function (d) { return keep.indexOf(d) !== -1; }));
        nav.index = 0;
        render();
    });

    /* The list again, the focus kept: an input pinned or unpinned in Sources. */
    APL.refreshHome = function () {
        APL.loadApps().then(function (list) {
            var focused = apps[nav.index] && apps[nav.index].id;
            buildList(list);
            render();
            for (var i = 0; i < apps.length; i++) if (apps[i].id === focused) { nav.focus(i); break; }
        });
    };

    APL.refreshArt = function () { if (APL.autoArt) APL.autoArt.refresh(allApps, render); };
    // render() too: Black changes no made background, yet every layer must be redrawn
    /* Settings › Top Shelf › Otherwise. Every app's generated picture is painted again only when its style
       really changes, between Sheets of Light and Large Logo (genart.js bgMode). Black and Wallpaper only
       cover those pictures: painting them all again took the processor for a minute on a 2022 LG, at each
       change (#55). */
    /* Black and Wallpaper show no generated picture: choosing them keeps the style drawn (a Large Logo user
       picking Black repainted every picture as sheets nobody saw, then again on the way back, #55) */
    var artStyleNow = "sheets";
    function artStyle() {
        var a = APL.sys.pref("shelfArt");
        return a === "black" || a === "wall" ? artStyleNow : a === "logo" ? "logo" : "sheets";
    }
    artStyleNow = artStyle();
    APL.restyleArt = function () {
        var style = artStyle();
        if (style !== artStyleNow && APL.autoArt) { artStyleNow = style; APL.autoArt.restyle(allApps, render); }
        render();
    };

    APL.resetHomeOrder = function () {
        APL.sys.setPref("appOrder", []);
        allApps = applySavedOrder(defaultOrder.filter(function (d) {
            return allApps.some(function (a) { return a.id === d.id; });
        }));
        render();
    };

    /* Dock backgrounds prepared in advance: the Top Shelf changes without a hitch. */
    function preloadDock() {
        apps.slice(0, DOCK_SIZE).forEach(layerFor);
    }

    /* Appearance: light, dark, or following the sun (sunrise and sunset computed for France). */
    function isNight(d) {
        var day = Math.floor((d - new Date(d.getFullYear(), 0, 0)) / 86400000);
        var lat = 48.85 * Math.PI / 180, decl = 23.44 * Math.PI / 180 * Math.sin(2 * Math.PI * (284 + day) / 365);
        var half = Math.acos(-Math.tan(lat) * Math.tan(decl)) * 12 / Math.PI;
        var noon = 12 - d.getTimezoneOffset() / 60 - 2.35 / 15, h = d.getHours() + d.getMinutes() / 60;
        return h < noon - half || h > noon + half;
    }
    function applyTheme() {
        var a = APL.sys.pref("appearance");
        var light = a === "light" || (a === "auto" && !isNight(new Date()));
        document.body.classList.toggle("theme-light", light);
        if (APL.overlay) APL.overlay.setTheme(light);
        // Generated backgrounds exist for both themes: the other one, already made
        if (APL.genArt && allApps && APL.genArt.retheme(allApps)) render();
    }

    /* Performance mode: no real-time blur or glass (which made the screen lag). */
    function applyPerf() {
        // Over an app there is no picture behind the glass to bend: the plain tiles
        document.body.classList.toggle("perf", !!APL.ccOverlay || !APL.sys.pref("visualEffects"));
    }

    /* Tip shown on the first start-ups. */
    function showCcHint() {
        var n = APL.sys.pref("ccHintCount");
        if (n >= 3) return;
        APL.sys.setPref("ccHintCount", n + 1);
        setTimeout(function () {
            toast((APL.platform && APL.platform.ccHint) || APL.t("Tip: ⏯ opens Control Center, and Home twice shows open apps"));
        }, 2500);
    }

    /* Home button (sent here by Vetro): if already on the Home Screen for a while,
       another press opens / closes Control Center, like the TV button on Apple TV. */
    var lastShown = Date.now(), switcherOnShow = false;
    document.addEventListener("visibilitychange", function () {
        // Over the apps, something else came in front (Home, an app the Control Center opened): it goes
        if (APL.ccOverlay) { if (document.hidden && APL.controlCenter) APL.controlCenter.close(); return; }
        // An app opens over the Home Screen: coming back, it is at rest again, not still in full screen
        if (document.hidden) { if (mode === "full") setMode("shelf"); return; }
        lastShown = Date.now();
        hideVeil();
        setTimeout(function () { bootCleanup(8); }, 25000);
        if (switcherOnShow) { switcherOnShow = false; if (APL.switcher) APL.switcher.open(); }
    });
    var lastHome = 0;
    /* The native Control Center (overlay/) asks for a launcher page: Settings, Connection… */
    function requestedAction() {
        if (APL.platform && APL.platform.takeAction) return APL.platform.takeAction();     // LG (webos.js)
        try {
            var data = global.tizen.application.getCurrentApplication().getRequestedAppControl().appControl.data || [];
            for (var i = 0; i < data.length; i++) if (data[i].key === "apl_action") return data[i].value[0];
        } catch (e) {}
        return "";
    }
    function runAction(action) {
        if (action === "boot") return;           // APL Boot putting the launcher on screen after a start-up: nothing to open
        if (action === "controlcenter") { if (APL.controlCenter) APL.controlCenter.toggle(); return; }
        if (APL.controlCenter && APL.controlCenter.isOpen()) APL.controlCenter.close();
        if (action === "switcher") {
            if (document.hidden) switcherOnShow = true;
            else if (APL.switcher && !APL.switcher.isOpen()) APL.switcher.open();
        }
        else if (action === "settings") APL.settings.open();
        else if (action === "connexions") APL.settings.open(APL.t("Connection"));
        // The Control Center drawn over the apps (LG, webos.js) asks for the launcher's own pages
        else if (action.indexOf("settings:") === 0) APL.settings.open(action.substr(9));
        else if (action === "sources") APL.openSources();
        else if (action === "search") { if (APL.search) APL.search.open(); }
        else if (action === "profiles") { if (APL.profilesUI) APL.profilesUI.open(); }
        else if (action === "screensaver") whenShown(function () { if (APL.screensaver) APL.screensaver.start(); });
        else if (action === "alexa") APL.services.alexaMic();
        else if (action.indexOf("open:") === 0) openById(action.substr(5));   // "Alexa, turn on…"
    }
    /* fn once the launcher is on screen: coming back to the front stops a screen saver (screensaver.js) */
    function whenShown(fn) {
        if (!document.hidden) { fn(); return; }
        document.addEventListener("visibilitychange", function once() {
            if (document.hidden) return;
            document.removeEventListener("visibilitychange", once);
            setTimeout(fn, 400);
        });
    }
    function openById(id) {
        // The remote's TizenTube button (APL Overlay asks for apl.tizentube): TizenTube's own app when installed
        var own = id === "apl.tizentube" && ownTube(allApps);
        if (own) id = own.id;
        for (var i = 0; i < allApps.length; i++) if (allApps[i].id === id) { APL.goHome(); APL.openApp(allApps[i]); return; }
    }
    global.addEventListener("appcontrol", function () {
        // Over the apps, Guide pressed again: the Control Center closes, and its window with it
        if (APL.ccOverlay) { requestedAction(); if (APL.controlCenter) APL.controlCenter.toggle(); return; }
        var action = requestedAction();
        if (action) { lastShown = Date.now(); runAction(action); return; }
        // Two quick presses on Home: the App Switcher, as on Apple TV
        var quick = Date.now() - lastHome < 800;
        lastHome = Date.now();
        // The second press often arrives before the Home Screen is back on screen
        if (quick && document.hidden) { switcherOnShow = true; return; }
        if (quick && !document.hidden && APL.switcher && !APL.switcher.isOpen()) {
            if (APL.controlCenter && APL.controlCenter.isOpen()) APL.controlCenter.close();
            APL.switcher.open();
            return;
        }
        if (!document.hidden && Date.now() - lastShown > 1500) {
            if (APL.switcher && APL.switcher.isOpen()) { APL.switcher.close(); return; }
            // Home from anywhere in the launcher (deep in Settings, full screen, Sources…): the Home Screen
            // at rest, on its first app
            APL.goHome();
        } else {
            lastShown = Date.now();
        }
    });

    APL.toast = function (m, info) { toast(m, info); };
    APL.allApps = function () { return allApps; };
    APL.reloadApps = function () { render(); };
    APL.openSources = function () {
        if (APL.ccOverlay && APL.platform.toLauncher) { APL.platform.toLauncher("sources"); return; }    // over the apps (webos.js)
        if (APL.sources) APL.sources.open();
    };

    /* Control Center: Play/Pause or the red key (C on the keyboard in the PC preview). */
    APL.addHotkey(function (code) {
        var K = APL.KEY;
        if (code === K.MEDIA_PLAY_PAUSE || code === K.RED || (APL.sys.PREVIEW && code === 67)) {
            if (APL.controlCenter) APL.controlCenter.toggle();
            return true;
        }
        // Home with the launcher in front: some screens never pass a launch request to the page in
        // front (The Frame 2025), so the Overlay presses blue for Home and green for the App Switcher
        // (red, above, for the Control Center).
        if (code === K.BLUE) {
            if (APL.switcher && APL.switcher.isOpen()) APL.switcher.close();
            else APL.goHome();
            return true;
        }
        if (code === K.GREEN) {
            if (APL.controlCenter && APL.controlCenter.isOpen()) APL.controlCenter.close();
            if (APL.switcher && !APL.switcher.isOpen()) APL.switcher.open();
            return true;
        }
        return false;
    });

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
    else boot();

})(window);
