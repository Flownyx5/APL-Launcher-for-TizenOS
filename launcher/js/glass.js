/* ============================================================
   glass.js — pre-blurred glass for the launcher's chrome.

   The panels used backdrop-filter. On a Tizen set that is the most
   expensive thing on screen: the blur is re-run every time a tile
   scales on focus or a panel slides in. This freezes the backdrop
   once per artwork (a 48x27 copy upscaled to a 480x270 tile, so the
   downscale itself is the blur, enlarged a quarter and a quarter
   brighter), then shows the slice that sits under each surface. Opening a panel, moving focus or changing the
   artwork then only changes background-position: nothing filters,
   and nothing is drawn per frame.

     src()      the frozen backdrop in use ("" when there is none)
     lens(x,y)  the background-position for a stage point
     offset(el) stage rectangle of an element, ignoring transforms
     paint()    re-slice every surface now
     refresh()  re-read the artwork, then paint (debounced)
     setSource(url)  force an artwork (a page that is not the Home
                     Screen, e.g. a fixed backdrop); release() undoes it.
     onChange(fn)    called with the new backdrop ("" when there is
                     none), for a sheet that shows it full-frame.

   Everything is behind body.glass, added here, so the skin can be
   switched off and the old translucent fills come straight back.
   ============================================================ */
(function (global) {
    "use strict";

    var APL = global.APL = global.APL || {};

    /* These canvases are read back (getImageData, toDataURL) and never shown: kept in ordinary memory.
       On the GPU each read waited for it, 90 ms at a time on an LG G5, in the middle of an animation. */
    var READ = { willReadFrequently: true };
    var PANE_FADE_MS = 300;              /* the picture's crossfade (launcher.js FADE_MS) */

    var BAKE_W = 480, BAKE_H = 270;      /* 1/4 of the stage */
    var TINY_W = 48, TINY_H = 27;        /* 1/40: two steps down, no filter */
    var ZOOM = 1.25;                     /* the backdrop is enlarged behind the glass */
    var LIGHT = 1.05;                    /* 5 % brighter: the pane reads as lit, not washed out */

    /* Every surface that should read as a lens. Add a selector here and it
       gets the material, with no other change. The profile row in Control
       Center is deliberately NOT one: a circle that small only shows a
       smear, and it sits next to the avatar that must stay flat. */
    var TARGETS = [
        ".dock",
        ".status",            /* the clock and avatar pill */
        ".search-hint",       /* the magnifier across from it: the same pill */
        ".cc__t",
        ".scard__art--glass"
    ];

    /* LG (APL.platform.directGlass): a pane is kept for good, and what changes with the picture changes
       without anything being painted again. The slice is an <img> the screen composites straight from its
       480 x 270 bitmap (a layer made of one image is rastered at the image's own size, then scaled by the
       GPU), and the shade over it is a plain layer whose opacity is the shade. A pane made again for each
       picture had the whole surface repainted with it: on a G5 drawing in 4K the clock pill alone took
       25 ms of GPU each time (blurred shadows, masked rim), the dock 12. */
    var DIRECT = !!(APL.platform && APL.platform.directGlass);
    /* Its picture is made at half the size, 240 x 135, without a canvas filter, and encoded away from the
       animation (toBlob): the 480 x 270 JPEG of toDataURL took 20 ms at rest on a G5, and 110 to 140 ms
       each while the focus moved along the dock, six times in a first pass. The picture is a 48 x 27
       sample enlarged, so the screen's own enlarging shows it the same. */
    var DIRECT_W = 240, DIRECT_H = 135;

    var baked = "";          /* data URL of the frozen backdrop */
    var bakedFrom = "";      /* the artwork it was made from */
    var forced = "";         /* setSource() override */
    var timer = 0, empty = 0, tries = 0;
    var settle = 0;          /* second look, once the new backdrop has faded in */
    var body = null;

    function $(id) { return document.getElementById(id); }

    function urlOf(el) {
        if (!el) return "";
        /* The backdrop is an <img> inside the layer (launcher.js showPicture):
           that bitmap is painted whole, where a background filled itself in a
           line at a time as it decoded. */
        /* Not the brand card's logo: that is an <img> too, and slicing it put a
           blurred app icon behind the dock on every channel without artwork. */
        var pic = el.querySelector ? el.querySelector("img:not(.brandcard__icon)") : null;
        if (pic && pic.currentSrc) return pic.currentSrc;
        var bg = global.getComputedStyle(el).backgroundImage || "";
        var m = /url\(["']?([^"')]+)["']?\)/.exec(bg);
        return m ? m[1] : "";
    }

    /* The artwork on screen. A generated brand card has no URL (it is a
       gradient), and those keep the plain translucent fill: an empty
       answer is a valid answer. */
    /* The layer on screen. During a crossfade two layers carry is-active and the
       earlier one can still be the one leaving, so the launcher names the app
       whose backdrop is live and this follows that name. */
    function sceneEl() {
        /* The element that was actually faded in, recorded by launcher.js. A
           dock app has more than one layer carrying its id - its own artwork,
           then a poster for it - and both are inserted immediately before bgA,
           so each new one lands LATER in the document. "The first one with this
           id" was therefore always the oldest: the app's own backdrop stayed
           under the glass while the dynamic picture was on screen, which is the
           blurred app backdrop the dock, the pill and the Control Center kept
           showing. */
        var live = document.body.__bgLive;
        if (live && document.documentElement.contains(live)) return live;
        var id = document.body.getAttribute("data-bg-app"), i, list, hit = null;
        if (id) {
            list = document.querySelectorAll(".bg[data-app]");
            for (i = 0; i < list.length; i++) {
                if (list[i].getAttribute("data-app") === id) hit = list[i];   // the newest
            }
            if (hit) return hit;
        }
        /* The named layer can be gone by now (a layer is removed once it has
           faded): whatever is still on screen is the picture. #bgBlur is not in
           this chain on purpose - it is the blurred copy, so slicing it gives a
           pane of a blur, which is what the Control Center was showing. */
        var act = document.querySelectorAll(".bg.is-active");
        return act.length ? act[act.length - 1] : null;
    }

    function scene() {
        /* The layer on screen decides, including when its answer is "no picture":
           Settings and a channel with no artwork are a gradient. Falling through
           to bgA/bgB here read a layer that is still fading out, so leaving an app
           for Settings kept the app's film under the dock and the pill. */
        var el = sceneEl();
        if (el) return urlOf(el);
        return urlOf($("bgA")) || urlOf($("bgB"));
    }

    /* The pane for each artwork is rendered once and kept, so a picture that
       comes back (the ten-second rotation, a step back along the row) is shown
       on a slice that is already made: nothing is drawn on the frame that
       changes the backdrop. */
    var cache = {}, order = [], CACHE_MAX = 12;
    /* The direct panes show the pane's picture from a blob: URL, loaded and decoded once here. Each <img>
       given the data: URL itself read it again, 2.7 ms a pane on a G5, fifteen panes with the Control
       Center built; one already loaded in the page is taken as it is (0.3 ms). */
    var quickUrl = {}, quickN = 0;
    function quick(data) {
        if (/^blob:/.test(data)) { quickUrl[data] = data; quickN++; return; }      // a direct pane (drawDirect)
        if (data in quickUrl || !global.fetch || !global.URL) return;
        quickUrl[data] = "";                              // on its way
        global.fetch(data).then(function (r) { return r.blob(); }).then(function (b) {
            var u = global.URL.createObjectURL(b), im = new global.Image();
            im.onload = function () { quickUrl[data] = u; };
            im.src = u;
            if (im.decode) im.decode().catch(function () {});
            if (++quickN > 40) {                          // the pictures gone from the cache give their blob back
                Object.keys(quickUrl).forEach(function (d) {
                    if (d === baked || order.some(function (k) { return cache[k] === d; })) return;
                    if (quickUrl[d]) global.URL.revokeObjectURL(quickUrl[d]);
                    delete quickUrl[d];
                });
                quickN = Object.keys(quickUrl).length;
            }
        }).catch(function () { delete quickUrl[data]; });
    }
    function remember(src, data) {
        if (!src || !data) return;
        if (!cache[src]) order.push(src);
        cache[src] = data;
        if (DIRECT) quick(data);
        while (order.length > CACHE_MAX) {
            var old = order.shift();
            if (cache[old] !== baked) delete lums[cache[old]];      // the pane on screen keeps its measure
            delete cache[old];
        }
    }

    /* How bright the picture is under each surface. The pane is an opaque slice of
       the picture laid over the surface's own tint, so on a white poster the dock
       and the clock pill were white glass with white text on it, and the Control
       Center's labels barely read. The 48x27 sample the pane is made from is kept as
       a grid of luminances (one cell = 40x40 px of the stage), and each pane is then
       darkened - or, in the light theme, veiled - just enough for its own text. */
    var lums = {};           /* luminance grid of each pane, by its data URL */
    function chan(c) {
        c = Math.min(1, c / 255 * LIGHT);
        return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    }
    function grid(canvas) {
        try {
            var d = canvas.getContext("2d", READ).getImageData(0, 0, TINY_W, TINY_H).data, g = [], i;
            for (i = 0; i < d.length; i += 4) g.push(0.2126 * chan(d[i]) + 0.7152 * chan(d[i + 1]) + 0.0722 * chan(d[i + 2]));
            return g;
        } catch (e) { return null; }
    }

    /* For each kind of surface: the luminance its pane must stay under for white
       text (dark theme), the shade it never goes below, and in the light theme the
       luminance it must stay above for dark text, with its least veil. A pill and a
       tile carry text; the dock carries only icons, so it is only kept from turning
       into a white plate. Sources stays dark in both themes (white text). */
    var TUNE = {
        pill: { y: 0.09, shade: 0.30, ly: 0.55, veil: 0.45 },
        dock: { y: 0.22, shade: 0.10, ly: 0.42, veil: 0.30 },
        tile: { y: 0.07, shade: 0.55, ly: 0.60, veil: 0.55 },
        card: { y: 0.06, shade: 0.70, dark: true }
    };
    function kindOf(el) {
        var c = el.classList;
        if (c.contains("cc__t")) return "tile";
        if (c.contains("dock")) return "dock";
        if (c.contains("scard__art--glass")) return "card";
        return "pill";
    }
    /* Mean, brightest and darkest cell under a stage rectangle. */
    function under(g, r) {
        var x0 = Math.max(0, Math.floor(r.x / 40)), x1 = Math.min(TINY_W - 1, Math.floor((r.x + r.w - 1) / 40));
        var y0 = Math.max(0, Math.floor(r.y / 40)), y1 = Math.min(TINY_H - 1, Math.floor((r.y + r.h - 1) / 40));
        var sum = 0, n = 0, hi = 0, lo = 1, x, y, v;
        for (y = y0; y <= y1; y++) {
            for (x = x0; x <= x1; x++) {
                v = g[y * TINY_W + x];
                sum += v; n++;
                if (v > hi) hi = v;
                if (v < lo) lo = v;
            }
        }
        return n ? { mean: sum / n, hi: hi, lo: lo } : null;
    }
    function tint(layer, el, r) {
        var t = TUNE[kindOf(el)], g = lums[baked], s = g ? under(g, r) : null;
        var light = !t.dark && body.classList.contains("theme-light");
        if (!light) {
            /* Black over the slice: in the screen's sRGB blend the luminance falls as
               (1 - shade) ^ 2.2. Half the mean, half the brightest cell, so a bright
               spot under the label counts. */
            var min = t.shade, y = s ? 0.5 * s.mean + 0.5 * s.hi : 1, a = 0;
            if (t.dark && body.classList.contains("perf")) min = 0.9;
            if (y > t.y) a = 1 - Math.pow(t.y / y, 1 / 2.2);
            layer.style.setProperty("--glass-shade", Math.max(min, Math.min(0.92, a)).toFixed(3));
        } else {
            /* A pale veil: it lifts a dark picture to the luminance dark text needs. */
            var yl = s ? 0.5 * s.mean + 0.5 * s.lo : 0, vt = Math.pow(t.ly, 1 / 2.2), v = Math.pow(yl, 1 / 2.2), w = 0;
            if (v < vt) w = (vt - v) / (1 - v);
            layer.style.setProperty("--glass-veil", Math.max(t.veil, Math.min(0.95, w)).toFixed(3));
        }
    }

    /* Two canvases, both off the animation path. The second is the only
       "blur": drawing 48x27 into 480x270 is a 10x upscale, which the
       compositor smooths for free. */
    function draw(img) {
        /* The glass enlarges what sits behind it by a quarter: sample the
           middle 80% of the artwork, so every slice is a 1.25x crop of the
           backdrop and the edges of the pane never show the pixels the
           surface used to sit on. */
        var iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
        var sw = iw / ZOOM, sh = ih / ZOOM;

        var tiny = document.createElement("canvas");
        tiny.width = TINY_W;
        tiny.height = TINY_H;
        tiny.getContext("2d", READ).drawImage(img, (iw - sw) / 2, (ih - sh) / 2, sw, sh, 0, 0, TINY_W, TINY_H);

        var out = document.createElement("canvas");
        out.width = BAKE_W;
        out.height = BAKE_H;
        var c = out.getContext("2d", READ);
        c.imageSmoothingEnabled = true;
        if ("imageSmoothingQuality" in c) c.imageSmoothingQuality = "high";
        /* Brightness is baked once here: no filter, no redraw, on the TV's
           animation path. */
        if ("filter" in c) c.filter = "brightness(" + LIGHT + ")";
        c.drawImage(tiny, 0, 0, BAKE_W, BAKE_H);
        var data = out.toDataURL("image/jpeg", 0.72), g = grid(tiny);
        if (g) lums[data] = g;
        return data;
    }

    /* LG: the same pane, made for the direct panes (see DIRECT_W). The brightness is put on the 1,296 pixels of
       the sample, not filtered over the bigger canvas; the luminances are read before, as draw() does. */
    function drawDirect(img, cb) {
        var iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
        var sw = iw / ZOOM, sh = ih / ZOOM;
        var tiny = document.createElement("canvas");
        tiny.width = TINY_W;
        tiny.height = TINY_H;
        var t = tiny.getContext("2d", READ);
        t.drawImage(img, (iw - sw) / 2, (ih - sh) / 2, sw, sh, 0, 0, TINY_W, TINY_H);
        var g = grid(tiny);
        try {
            var px = t.getImageData(0, 0, TINY_W, TINY_H), d = px.data, i;
            for (i = 0; i < d.length; i += 4) { d[i] = d[i] * LIGHT; d[i + 1] = d[i + 1] * LIGHT; d[i + 2] = d[i + 2] * LIGHT; }
            t.putImageData(px, 0, 0);
        } catch (e) {}
        var out = document.createElement("canvas");
        out.width = DIRECT_W;
        out.height = DIRECT_H;
        var c = out.getContext("2d", READ);
        c.imageSmoothingEnabled = true;
        if ("imageSmoothingQuality" in c) c.imageSmoothingQuality = "high";
        c.drawImage(tiny, 0, 0, DIRECT_W, DIRECT_H);
        var answered = false;
        function answer(data) {
            if (answered) return;
            answered = true;
            if (data && g) lums[data] = g;
            cb(data);
        }
        if (out.toBlob && global.URL && global.URL.createObjectURL) {
            out.toBlob(function (b) { answer(b ? global.URL.createObjectURL(b) : out.toDataURL("image/jpeg", 0.72)); }, "image/jpeg", 0.72);
            // an encoder that never answers: the small one now
            global.setTimeout(function () { if (!answered) answer(out.toDataURL("image/jpeg", 0.72)); }, 1500);
        } else {
            answer(out.toDataURL("image/jpeg", 0.72));
        }
    }

    var rendering = {};
    /* One render per artwork, however many ask for it: a bake finishing after
       the focus moved on still answers everybody, and nothing is dropped. */
    function render(src, cb, el) {
        if (cache[src]) { cb(cache[src]); return; }
        if (rendering[src]) { rendering[src].push(cb); return; }
        rendering[src] = [cb];
        function finish(data) {
            var list = rendering[src] || [], i;
            delete rendering[src];
            if (data) remember(src, data);
            for (i = 0; i < list.length; i++) { try { list[i](data); } catch (e) {} }
        }
        var img = null, started = false, objectUrl = "";
        /* The launcher hands over the <img> it has already decoded and put on
           screen (launcher.js passes it from whenDecoded / showPicture). Drawing
           THAT element is one canvas pass: no second fetch of a 1080p file, no
           second decode. Re-fetching here is why the pane trailed the picture by
           an app, a second at a time on a cold row. */
        /* Only a same-origin bitmap can be read back out of a canvas: an <img>
           straight from image.tmdb.org taints it and toDataURL throws, which left
           every TMDB pane empty. Such a picture keeps the blob fetch below. */
        if (el && /^(data:|blob:)/i.test(el.currentSrc || el.src || "")) {
            img = el;
            started = true;
            if (el.decode) el.decode().then(paintSource, paintSource);
            else paintSource();
            return;
        }
        /* onload fires before every row is decoded. Drawing then bakes a
           half-decoded picture into the pane, and the 10x upscale shows it as
           the backdrop filling in line by line - which is what a first visit to
           an app looked like. The whole bitmap is awaited first. */
        var painted = false;
        function paintSource() {
            if (painted) return;
            painted = true;
            if (DIRECT) {
                try { drawDirect(img, withPane); } catch (e) { withPane(""); }
                return;
            }
            var data = "";
            try { data = draw(img); } catch (e) { data = ""; }
            withPane(data);
        }
        function withPane(data) {
            if (objectUrl) { try { global.URL.revokeObjectURL(objectUrl); } catch (e) {} objectUrl = ""; }
            if (!data) { finish(""); return; }
            /* Decode the frozen pane before anyone can show it: a pane whose
               bitmap is not ready paints an empty frame first, which is a
               flicker in exactly the moment the picture changes. */
            var im = new global.Image();
            var settled = false;
            function ok() { if (settled) return; settled = true; finish(data); }
            im.src = data;
            if (im.decode) im.decode().then(ok, ok);
            else { im.onload = ok; im.onerror = ok; }
            global.setTimeout(ok, 250);
        }
        function useImage(url, cors) {
            if (started) return;
            started = true;
            img = new global.Image();
            /* A poster from the catalogue lives on images.justwatch.com: without
               this the canvas is tainted, toDataURL throws, and every lens would
               quietly disappear behind remote artwork. */
            if (cors) img.crossOrigin = "anonymous";
            img.onload = function () {
                if (img.decode) img.decode().then(paintSource, paintSource);
                else paintSource();
                global.setTimeout(paintSource, 400);    // a decode that never settles
            };
            img.onerror = function () {
                if (objectUrl) { try { global.URL.revokeObjectURL(objectUrl); } catch (e) {} objectUrl = ""; }
                finish("");
            };
            img.src = url;
        }

        /* image.tmdb.org serves a CORS fetch of a poster with
           `Access-Control-Allow-Origin: *` but Chromium refuses that same file as
           an <img crossorigin="anonymous">, so every TMDB backdrop lost its lens
           and fell back to a plain fill. The bytes are fetched as a blob instead:
           a blob URL is same-origin, so the canvas is readable as usual. Hosts
           whose fetch is refused still take the plain <img> path. */
        var remote = !/^(data:|blob:)/i.test(src);
        /* The pane is a 48 x 27 sample: TMDB's 300 px copy of the picture is plenty, where its 4K
           original was a 4K decode on the page's own thread */
        var from = remote && APL.artSize ? APL.artSize(src, "w300") : src;
        if (remote && global.fetch && global.URL && global.URL.createObjectURL) {
            global.fetch(from, { mode: "cors", credentials: "omit" }).then(function (r) {
                if (!r.ok) throw new Error("http " + r.status);
                return r.blob();
            }).then(function (blob) {
                if ((blob.type || "").indexOf("image/") !== 0) throw new Error("not an image");
                objectUrl = global.URL.createObjectURL(blob);
                useImage(objectUrl, false);
            }).catch(function () { useImage(from, true); });
        } else {
            useImage(from, remote);
        }
    }

    var wanted = "";         /* the artwork that should be on screen right now */

    function bake(src, done, el) {
        if (!src) { drop(); return; }
        wanted = src;
        if (src.indexOf("grad:") === 0) {
            if (src === bakedFrom && baked) { paint(); if (done) done(); return; }
            baked = gradImage(src.slice(5).split("|"));
            bakedFrom = src;
            forget();
            paint();
            notify();
            if (done) done();
            return;
        }
        if (src === bakedFrom && baked) { paint(); if (done) done(); return; }
        render(src, function (data) {
            /* A render that lands after the focus has moved on is kept for next
               time, not shown. Without this a fast scroll shows panes out of
               order, and each late one is a jump the eye catches at once. */
            if (data && data !== baked && src === wanted) {
                baked = data;
                bakedFrom = src;
                forget();
                paint();
                notify();
            } else if (!data && src === wanted && baked) {
                /* The picture cannot be read back (a host that serves no CORS
                   header): keeping the pane that was there left the app before
                   last under the dock, a backdrop that never matched the one on
                   screen. With the pane dropped, the dock's own frosted copy of
                   the picture - var(--glass-img), which follows the layer - is
                   what shows through. */
                drop();
            }
            if (done) done();
        }, el);
    }

    /* The pane for a picture that is about to be shown (the next title of the
       app in focus): made now, so the change lands on a ready slice. */
    function prefetch(src) {
        if (src && !cache[src] && src !== bakedFrom) render(src, function () {});
    }

    /* No artwork: hide every lens and leave the CSS fills in charge. */
    function drop() {
        var list = document.querySelectorAll(TARGETS.join(",")), i, l;
        baked = "";
        bakedFrom = "";
        wanted = "";
        for (i = 0; i < list.length; i++) {
            l = list[i].__cgLayer;
            if (l) l.classList.remove("is-on");
            list[i].__cgKey = "";
        }
        notify();
    }

    function notify() {
        if (typeof api.onChange === "function") api.onChange(baked);
    }

    function forget() {
        var list = document.querySelectorAll(TARGETS.join(",")), i;
        for (i = 0; i < list.length; i++) list[i].__cgKey = "";
    }

    /* The layer is inserted, never written into the surface's own
       background: the tiles keep their tint, their ::after sheen and the
       white plate on focus, and the text simply sits above it. */
    function layerFor(el) {
        var l = el.__cgLayer;
        if (l && l.parentNode === el) return l;
        l = document.createElement("i");
        l.className = "cg__glass" + (DIRECT ? " cg__glass--direct" : "");
        l.setAttribute("aria-hidden", "true");
        if (DIRECT) {
            var pic = document.createElement("img"), shade = document.createElement("i");
            pic.className = "cg__pic"; pic.alt = ""; pic.decoding = "sync";
            shade.className = "cg__shade";
            l.appendChild(pic); l.appendChild(shade);
            l.__pic = pic;
        }
        el.insertBefore(l, el.firstChild);
        el.__cgLayer = l;
        el.__cgKey = "";
        return l;
    }
    /* The direct pane: the picture's place and the shade are two style writes, the picture one src. */
    function paintDirect(l, el, r) {
        var pic = l.__pic, pos = r.x + "," + r.y;
        if (!pic || pic.parentNode !== l) {            // the tile's content was rebuilt around the pane
            pic = l.__pic = l.querySelector(".cg__pic");
            if (!pic) return;
        }
        if (l.__pos !== pos) { l.__pos = pos; pic.style.left = (-r.x) + "px"; pic.style.top = (-r.y) + "px"; }
        tint(l, el, r);
        if (l.__src !== baked) {
            l.__src = baked;
            if (!quickUrl[baked]) quick(baked);           // a gradient's pane, made without remember()
            pic.src = quickUrl[baked] || baked;
        }
        l.classList.add("is-on");
    }

    /* Stage rectangle from layout offsets. A focused tile is scaled and a
       panel slides in, so a client rect would sample the transformed box
       and leave the slice a few pixels off; offsets ignore all of that. */
    function offset(el) {
        var x = 0, y = 0, n = el;
        while (n && n !== body && n !== document.documentElement) {
            x += n.offsetLeft;
            y += n.offsetTop;
            n = n.offsetParent;
        }
        return { x: x, y: y, w: el.offsetWidth, h: el.offsetHeight };
    }

    function lens(x, y) { return (-x) + "px " + (-y) + "px"; }

    /* The skin is decided by the preference, never by load order. Nothing added
       the body class when this file ran before the pref store had settled, so
       the Control Center kept its plain fills and the pill's clock sat under its
       own pane, which is a black hole where the time should be. */
    function ensure() {
        if (!body) body = document.body;
        if (!body) return false;
        if (body.classList.contains("glass")) return true;
        if (!skinOn()) return false;
        body.classList.add("glass");
        wire();
        return true;
    }

    /* An app with no artwork is backed by a gradient (Sheets of Light, a brand
       card). There is no URL to slice, so the pane is drawn from the very
       colours behind it: the glass is on every app, and nothing has to be
       dropped while a picture that will never come is waited for. */
    function gradOf(el) {
        if (!el) return "";
        var cs = global.getComputedStyle(el);
        var stops = String(cs.backgroundImage || "").match(/rgba?\([^)]+\)/g) || [];
        if (!stops.length) {
            var c = cs.backgroundColor;
            if (!c || c === "transparent" || /rgba?\(0, 0, 0, 0\)/.test(c)) return "";
            stops = [c];
        }
        return "grad:" + stops.join("|");
    }

    function gradScene() { return gradOf(sceneEl()); }

    function gradImage(stops) {
        /* LG: drawn at the sample's size, 48 x 27, the screen enlarges it as smoothly (1 ms instead of 20 to
           140 for the 480 x 270 JPEG) */
        var W = DIRECT ? TINY_W : BAKE_W, H = DIRECT ? TINY_H : BAKE_H;
        var out = document.createElement("canvas");
        out.width = W;
        out.height = H;
        var c = out.getContext("2d", READ);
        var g = c.createLinearGradient(0, 0, 0, H), i;
        for (i = 0; i < stops.length; i++) {
            g.addColorStop(stops.length === 1 ? 0 : i / (stops.length - 1), stops[i].trim());
        }
        c.fillStyle = g;
        c.fillRect(0, 0, W, H);
        /* The same brightness the baked pictures carry. */
        c.fillStyle = "rgba(255, 255, 255, " + (LIGHT - 1) + ")";
        c.fillRect(0, 0, W, H);
        var data = out.toDataURL("image/jpeg", 0.72);
        var tiny = document.createElement("canvas");
        tiny.width = TINY_W;
        tiny.height = TINY_H;
        tiny.getContext("2d", READ).drawImage(out, 0, 0, TINY_W, TINY_H);
        var g = grid(tiny);
        if (g) lums[data] = g;
        return data;
    }

    /* LG: only the surfaces on screen. The Control Center's tiles and the Sources cards stay laid out while
       their panel is closed, and measuring their eighteen panes on every move along the dock was most of
       paint()'s 22 ms a move on a G5 (three looks a move, each laying the page out). A panel that opens asks
       for its own (paint(true) from the Control Center, glassAfter, the observer below). */
    function onScreen(all) {
        if (all || !DIRECT) return document.querySelectorAll(TARGETS.join(","));
        var sel = ".dock,.status,.search-hint";
        if (document.querySelector(".cc.is-open")) sel += ",.cc__t";
        if (document.querySelector(".sources.is-open")) sel += ",.scard__art--glass";
        return document.querySelectorAll(sel);
    }

    function paint(all) {
        if (!ensure()) return;
        if (!baked) return;
        var list = onScreen(all === true), i, el, r, key, l;
        /* Panes set to 0 in the write pass below and to 1 after it: one layout
           read for all of them, not one per surface. */
        var fades = [];
        var theme = body.className.indexOf("theme-light") > -1 ? "l" : "d";
        if (body.classList.contains("perf")) theme += "p";
        /* Every measure first, then every write: a write between two reads had the page laid out again
           for each surface (offset() and paintDirect() were 40 ms a move in a profile on a G5). */
        var jobs = [];
        for (i = 0; i < list.length; i++) {
            el = list[i];
            if (!el.offsetWidth || el.offsetHeight < 4) continue;
            jobs.push(el, offset(el));
        }
        for (i = 0; i < jobs.length; i += 2) {
            el = jobs[i];
            r = jobs[i + 1];
            /* The artwork is part of the key, so a new picture re-slices even when
               the surface has not moved; the theme too, which decides the tint. */
            key = r.x + "," + r.y + "," + r.w + "," + r.h + ":" + baked.length + ":" + baked.slice(-24) + ":" + theme;
            l = el.__cgLayer;
            if (el.__cgKey === key && l && l.parentNode === el && l.classList.contains("is-on")) continue;
            el.__cgKey = key;
            l = layerFor(el);
            if (DIRECT) { paintDirect(l, el, r); continue; }
            if (l.__src !== baked) {
                /* The pane is already rendered (see the cache above): one style
                   write, laid over the old pane, which leaves on the next frame.
                   Nothing fades over anything and nothing is ever empty, so the
                   dock and the pill cannot shimmer. */
                var n = document.createElement("i");
                n.className = "cg__glass is-on";
                n.setAttribute("aria-hidden", "true");
                n.__src = baked;
                n.style.backgroundImage = 'url("' + baked + '")';
                n.style.setProperty("--gx", (-r.x) + "px");
                n.style.setProperty("--gy", (-r.y) + "px");
                tint(n, el, r);
                el.insertBefore(n, l.parentNode === el ? l.nextSibling : el.firstChild);
                el.__cgLayer = n;
                /* The picture crossfades to the next one over 300 ms, so the pane
                   over it does too: it used to cut, and a cut against a fade is
                   the dock changing before the backdrop has finished changing.
                   The old slice stays under the new one until the fade is over,
                   so neither surface is ever empty. */
                n.style.transition = "opacity " + PANE_FADE_MS + "ms var(--glass-ease, ease)";
                n.style.opacity = "0";
                fades.push(n);
                /* The pane is passed in: `n` is paint()'s variable and by the time
                   this runs it points at the last pane the loop made. */
                (function (old, pane) {
                    global.setTimeout(function () {
                        if (old && old.parentNode) old.parentNode.removeChild(old);
                        pane.style.transition = "";
          /* Hand the opacity back to the stylesheet once the fade is over, so a
             rule can still hide a pane (Control Center hides the focused tile's). */
          pane.style.opacity = "";
                    }, PANE_FADE_MS + 40);
                })(l, n);
                continue;
            }
            l.style.setProperty("--gx", (-r.x) + "px");
            l.style.setProperty("--gy", (-r.y) + "px");
            tint(l, el, r);
            l.classList.add("is-on");
        }
        if (fades.length) {
            /* One read for every pane made in this pass: a read between two writes
               laid the page out again per surface, and a Control Center build
               makes about fifteen of them. */
            void body.offsetWidth;
            for (i = 0; i < fades.length; i++) fades[i].style.opacity = "1";
        }
    }

    /* Bake the picture now and call back once the pane is ready, so the caller can
       swap the picture and the glass in the same frame (launcher.js setPoster). */
    function prepare(src, done, el) {
        if (!done) { if (src) bake(src, null, el); return; }
        var called = false;
        function call() { if (called) return; called = true; done(); }
        if (!src) { call(); return; }
        if (src === bakedFrom && baked) { call(); return; }
        bake(src, call, el);
        /* A bake can fail (artwork without CORS, no canvas, a dead server): the
           picture must still change, so the caller is never left waiting for it,
           and a failure answers at once. A bake that is merely slow is worth
           waiting for: a catalogue picture seen for the first time is a fetch of
           a 1080p file, and cutting it off at 450 ms swapped the picture while
           the dock still sliced the one before it - the pane that caught up a
           second later, on the first pass through the apps only. */
        global.setTimeout(call, 1200);
    }

    function refresh() {
        global.clearTimeout(timer);
        timer = global.setTimeout(function () {
            var src = forced || scene() || gradScene();
            /* Nothing behind (a generated brand card, a channel with no poster):
               the pane goes, so the dock and the Control Center never keep the
               last app's backdrop. Not on the spot, though: a poster that lands a
               frame later would blank the dock for a moment. One look after 240 ms
               decides, and a bake starting in between cancels it. */
            global.clearTimeout(empty);
            if (!src) {
                empty = global.setTimeout(function () { if (!scene() && !gradScene()) drop(); }, 240);
                /* Nothing behind yet - the catalogue has not answered or the
                   first layer is still being shown. Look again shortly instead
                   of waiting for a key, which is why the glass used to arrive
                   only after the first press. */
                if (++tries < 12) global.setTimeout(refresh, 200);
                return;
            }
            tries = 0;
            bake(src);
        }, 120);
        /* The backdrop of the app being focused fades in after the key, so the
           first look can still see the app before it: look again once the
           fade is done, or the lens would keep the old artwork. */
        global.clearTimeout(settle);
        settle = global.setTimeout(sync, 520);
    }

    /* Bake again only when the artwork really changed. */
    function sync() {
        var src = forced || scene() || gradScene();
        if (src && src !== bakedFrom) bake(src);
    }

    function setSource(url) { forced = url || ""; refresh(); }

    /* The sheet on a page with no Home Screen behind it: release() really does
       drop the lens, unlike moving focus. */
    function release() {
        forced = "";
        global.clearTimeout(timer);
        timer = global.setTimeout(function () { if (scene()) refresh(); else drop(); }, 120);
    }

    var api = {
        src: function () { return baked; },
        lens: lens,
        offset: offset,
        paint: paint,
        prepare: prepare,
        prefetch: prefetch,
        refresh: refresh,
        setSource: setSource,
        release: release
    };
    APL.glass = api;

    /* A page that opens over the Home Screen re-slices after its own layout
       has settled: one call, and its panes carry the material. */
    APL.glassAfter = function (el) {
        if (el && el.classList) el.classList.add("has-glass");
        /* A panel's tiles have no geometry until they have slid in, so one look
           at 0 ms only dresses whichever tile was already laid out. Look again
           as the panel arrives. */
        /* Two later looks as well: a panel opened during a cold scroll can
           arrive before the poster's pane has been baked, and it used to keep
           whatever the dock had until the next key. */
        [0, 120, 400, 900, 1600, 2600].forEach(function (ms) {
            global.setTimeout(function () { sync(); paint(); }, ms);
        });
    };

    /* Liquid Glass is always on: these panes are static slices baked once per
       picture, so they have nothing to switch off. Visual Effects keeps its own
       job - the live blur behind Settings, menus, toasts, Search and the grid's
       wallpaper - which is the costly one and stays off by default. */
    function skinOn() { return true; }

    function apply() {
        body = document.body;
        if (!body) return;
        /* Always on: the pane is a frozen slice, not a filter, so it is not
           tied to Visual Effects (the live blur) at all. */
        body.classList.add("glass");
        refresh();
        wire();
    }

    /* Wired once, and only while the skin is on. */
    var wired = false;
    function wire() {
        if (wired) return;
        wired = true;
        refresh();
        /* The first artwork lands late, and a page that opens over the Home
           Screen asks again once it has: three cheap looks, then silence. */
        /* The artwork lands when the catalogue answers, which is well after
           this runs: look early and often, so the pane is up with the picture
           instead of appearing a second or two later. */
        [0, 250, 600, 1000, 1600, 2400, 3600].forEach(function (ms) {
            global.setTimeout(function () { refresh(); sync(); }, ms);
        });
        /* One look after a key, once its move has started, instead of one on the
           key down, one on the key up and one at the end of every transition
           (the scale, the colour and the background of both tiles, in the
           Control Center and along the dock): each of those read the layout of
           every surface while the focus was still animating, about thirty style
           passes per move, which the TV's slower processor showed as a Control
           Center that did not follow the remote. */
        var later = 0;
        function soon() {
            if (later) return;
            later = global.setTimeout(function () { later = 0; paint(); sync(); }, 90);
        }
        document.addEventListener("keyup", soon, true);
        /* A transition matters only when it can move a surface or change the
           picture: a backdrop that has finished fading, or a panel, the Home
           Screen or a sheet that carries glass. A tile scaling on focus moves
           nothing the panes are cut from (they ignore transforms). */
        document.addEventListener("transitionend", function (e) {
            var t = e.target;
            if (!t || !t.classList) return;
            if (t.classList.contains("bg") || (t.querySelector && t.querySelector(TARGETS.join(",")))) soon();
        }, true);
        /* Surfaces rebuilt while the glass is on (Control Center redraws its
           tiles on every move) get their lens back within a frame: no flash of
           the plain fill, no glass that appears and is gone again. */
        /* LG: a mutation is a reason to look only when it adds a surface or rebuilds one (the Control Center
           redraws its tiles). The title over the dock, the clock and the hint change on every move, and each
           of those was a full paint() 40 ms later. */
        var GLASS_SEL = TARGETS.join(",");
        function isSurface(n) {
            var m = n && n.nodeType === 1 && (n.matches || n.webkitMatchesSelector);
            return !!(m && m.call(n, GLASS_SEL));
        }
        /* Inside a surface: the clock's minutes and the weather change the clock pill's width */
        function inSurface(n) {
            for (var k = 0; n && n !== body && k < 6; k++, n = n.parentNode) if (isSurface(n)) return true;
            return false;
        }
        function touchesGlass(records) {
            var i, j, list, n;
            for (i = 0; i < records.length; i++) {
                list = records[i].addedNodes;
                if (!list || !list.length) continue;
                if (inSurface(records[i].target) && String(list[0].className || "").indexOf("cg__") !== 0) return true;
                for (j = 0; j < list.length; j++) {
                    n = list[j];
                    if (n.nodeType !== 1 || String(n.className).indexOf("cg__") === 0) continue;
                    if (isSurface(n) || (n.querySelector && n.querySelector(GLASS_SEL))) return true;
                }
            }
            return false;
        }
        if (global.MutationObserver) {
            var observer = new global.MutationObserver(function (records) {
                if (DIRECT && !touchesGlass(records)) return;
                global.clearTimeout(observer._t);
                observer._t = global.setTimeout(paint, 40);
            });
            observer.observe(body, { childList: true, subtree: true });
            /* A backdrop becoming the one on screen is the moment the panes
               should follow it. Watching the stage beats guessing times: on a
               cold start no .bg is active for the first second or two, so every
               timer fired into an empty scene and the glass only appeared after
               the first key press. */
            /* Only a backdrop layer (or the body, which names the live app) is
               a reason to look: every class change in the page used to count,
               so each move of the focus asked for the picture again. */
            var boom = 0;
            var layers = new global.MutationObserver(function (records) {
                var i, t, hit = false;
                for (i = 0; i < records.length && !hit; i++) {
                    t = records[i].target;
                    hit = t === body || !!(t.classList && t.classList.contains("bg"));
                }
                if (!hit) return;
                global.clearTimeout(boom);
                boom = global.setTimeout(function () { refresh(); sync(); }, 60);
            });
            layers.observe(body, { attributes: true, attributeFilter: ["class", "style"], subtree: true });
        }
        global.addEventListener("resize", paint);
    }

    function start() {
        apply();
        /* The pref store and the screen settle at their own pace, and this used
           to bail out here for good if the class was not on the body yet: one
           boot-order race and the glass never came on at all, which is what
           "it renders and is stable later" looked like. Look again instead. */
        [120, 900, 1800].forEach(function (ms) { global.setTimeout(apply, ms); });
    }

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
    else start();
})(window);
