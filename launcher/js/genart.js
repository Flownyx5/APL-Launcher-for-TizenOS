/* ============================================================
   genart.js — a logo and a background for apps with no artwork.

   For an app the catalog doesn't know (sideloaded, app installed later),
   the launcher makes by itself, only once, what the catalog gives the
   others:
     tile        500×300    the sharp logo, cut out from its background, on the app's color
     background  1920×1080  the logo on large shapes in the app's colors

   The logo comes, in this order: from the app's icon if it is big enough,
   from the App Store if the name matches exactly, from TMDB, from public icon
   catalogs, then from the app's icon even if small. With none of these,
   the app's name serves as the logo.

   Kept on the screen (a few tens of KB per app): tiles and backgrounds then
   cost no more than the catalog's.
   ============================================================ */
(function (global) {
    "use strict";

    var APL = global.APL, sys = APL.sys;
    var VERSION = 1, PREFIX = "apl.gen.";
    var TILE_W = 500, TILE_H = 300, BG_W = 1920, BG_H = 1080;
    var GOOD_ICON = 200;                 // below this, look for better before taking the app's icon
    var ICON_SETS = ["https://raw.githubusercontent.com/homarr-labs/dashboard-icons/main/png/",
                     "https://raw.githubusercontent.com/selfhst/icons/main/png/"];

    function canvas(w, h) {
        var c = document.createElement("canvas");
        c.width = w; c.height = h;
        return c;
    }
    function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
    function dist(a, r, g, b) { return Math.max(Math.abs(a.r - r), Math.abs(a.g - g), Math.abs(a.b - b)); }
    function lum(c) { return 0.299 * c.r + 0.587 * c.g + 0.114 * c.b; }
    function rgb(c) { return "rgb(" + Math.round(c.r) + "," + Math.round(c.g) + "," + Math.round(c.b) + ")"; }
    function hsl(h, s, l, a) { return "hsla(" + Math.round((h % 360 + 360) % 360) + "," + Math.round(s) + "%," + Math.round(l) + "%," + (a === undefined ? 1 : a) + ")"; }
    function toHsl(c) {
        var r = c.r / 255, g = c.g / 255, b = c.b / 255, mx = Math.max(r, g, b), mn = Math.min(r, g, b);
        var h = 0, s = 0, l = (mx + mn) / 2, d = mx - mn;
        if (d) {
            s = d / (1 - Math.abs(2 * l - 1));
            h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
            h *= 60;
        }
        return { h: h, s: s * 100, l: l * 100 };
    }
    function seeded(str) {
        var h = 2166136261, i;
        for (i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
        return function () { h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0; return h / 4294967296; };
    }

    /* ---------- the logo ---------- */
    function load(src) {
        return new Promise(function (resolve) {
            var i = new global.Image();
            if (/^https?:/.test(src)) i.crossOrigin = "anonymous";      // otherwise its pixels can't be read
            i.onload = function () { resolve(i.naturalWidth ? i : null); };
            i.onerror = function () { resolve(null); };
            i.src = src;
        });
    }
    function slug(name) { return String(name || "").toLowerCase().replace(/\+/g, "-plus").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""); }

    function firstGood(list, minSize) {
        return list.reduce(function (chain, src) {
            return chain.then(function (found) {
                if (found || !src) return found;
                return load(src).then(function (i) { return i && Math.min(i.naturalWidth, i.naturalHeight) >= minSize ? i : null; });
            });
        }, Promise.resolve(null));
    }
    function findLogo(app, art) {
        var own = app.icon && !/^https?:/.test(app.icon) ? app.icon : null;
        var name = slug(app.name);
        var sets = name.length >= 4 ? ICON_SETS.map(function (s) { return s + name + ".png"; }) : [];
        return firstGood([own], GOOD_ICON).then(function (i) {
            return i || firstGood([art && art.exact && art.icon, art && art.providerLogo].concat(sets), 96);
        }).then(function (i) {
            return i || firstGood([own, app.icon], 32);
        });
    }

    /* The image's border tells what it is: a cut-out logo, a logo on a solid color, or a
       real picture. This also finds where the logo is and its colors. */
    function study(img) {
        var w = 96, h = Math.round(96 * img.naturalHeight / img.naturalWidth);
        if (h > 96) { w = Math.round(96 * 96 / h); h = 96; }
        h = Math.max(h, 8); w = Math.max(w, 8);
        var c = canvas(w, h), x = c.getContext("2d");
        x.drawImage(img, 0, 0, w, h);
        var d = x.getImageData(0, 0, w, h).data, ring = [], px, py, i;
        for (py = 0; py < h; py++) {
            for (px = 0; px < w; px++) {
                if (px !== 2 && py !== 2 && px !== w - 3 && py !== h - 3) continue;
                if (px < 2 || py < 2 || px > w - 3 || py > h - 3) continue;
                i = (py * w + px) * 4;
                ring.push({ r: d[i], g: d[i + 1], b: d[i + 2], a: d[i + 3] });
            }
        }
        var solid = ring.filter(function (p) { return p.a > 200; });
        var transparent = solid.length < ring.length * 0.45;
        var edge = { r: 0, g: 0, b: 0 };
        solid.forEach(function (p) { edge.r += p.r; edge.g += p.g; edge.b += p.b; });
        var n = solid.length || 1;
        edge.r /= n; edge.g /= n; edge.b /= n;
        var far = solid.map(function (p) { return dist(edge, p.r, p.g, p.b); }).sort(function (a, b) { return a - b; });
        var uniform = !transparent && far[Math.floor(far.length * 0.85)] <= 26;

        // The logo: whatever is neither transparent nor the border's color
        var minX = w, minY = h, maxX = -1, maxY = -1, count = 0, sum = 0, buckets = {};
        for (py = 0; py < h; py++) {
            for (px = 0; px < w; px++) {
                i = (py * w + px) * 4;
                if (d[i + 3] < 70 || (!transparent && dist(edge, d[i], d[i + 1], d[i + 2]) < 36)) continue;
                if (px < minX) minX = px;
                if (px > maxX) maxX = px;
                if (py < minY) minY = py;
                if (py > maxY) maxY = py;
                count++;
                var p = { r: d[i], g: d[i + 1], b: d[i + 2] }, q = toHsl(p);
                sum += lum(p);
                if (q.s > 28 && q.l > 14 && q.l < 88) {
                    var k = Math.floor(q.h / 24), b = buckets[k] || (buckets[k] = { n: 0, h: 0, s: 0, l: 0 });
                    b.n++; b.h += q.h; b.s += q.s; b.l += q.l;
                }
            }
        }
        var best = null;
        Object.keys(buckets).forEach(function (k) { if (!best || buckets[k].n > best.n) best = buckets[k]; });
        if (!best && (uniform || !transparent)) {
            var e = toHsl(edge);
            if (e.s > 25 && e.l > 8 && e.l < 90) best = { n: 1, h: e.h, s: e.s, l: e.l };
        }
        var share = count / (w * h);
        return {
            transparent: transparent, uniform: uniform, edge: edge,
            logoMode: (transparent || uniform) && share > 0.01 && share < 0.92,
            box: maxX < 0 ? null : { x: minX / w, y: minY / h, w: (maxX - minX + 1) / w, h: (maxY - minY + 1) / h },
            lum: count ? sum / count : 128,
            accent: best ? { h: best.h / best.n, s: clamp(best.s / best.n, 50, 90), l: clamp(best.l / best.n, 40, 62) } : null
        };
    }

    /* The logo alone: its solid background becomes transparent, its margins are removed. */
    function cutOut(img, s) {
        var nw = img.naturalWidth, nh = img.naturalHeight;
        var mx = Math.max(1, Math.round(nw * 0.012)), my = Math.max(1, Math.round(nh * 0.012));
        var sx = Math.max(0, Math.floor(s.box.x * nw) - mx), sy = Math.max(0, Math.floor(s.box.y * nh) - my);
        var sw = Math.min(nw - sx, Math.ceil(s.box.w * nw) + 2 * mx), sh = Math.min(nh - sy, Math.ceil(s.box.h * nh) + 2 * my);
        var c = canvas(sw, sh), x = c.getContext("2d");
        x.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
        if (!s.transparent) {
            var im = x.getImageData(0, 0, sw, sh), p = im.data, i;
            for (i = 0; i < p.length; i += 4) p[i + 3] = Math.min(p[i + 3], clamp((dist(s.edge, p[i], p[i + 1], p[i + 2]) - 14) * 5, 0, 255));
            x.putImageData(im, 0, 0);
        }
        return c;
    }

    /* The logo on a dark background if it is light, on a light background if it is dark. */
    function baseColour(s, hue) {
        if (s.uniform) return s.edge;
        if (s.logoMode && s.lum < 100) return { r: 244, g: 245, b: 247 };
        return hslToRgb(hue, 42, 13);
    }
    function hslToRgb(h, s, l) {
        s /= 100; l /= 100;
        var c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = l - c / 2, v;
        h = (h % 360 + 360) % 360;
        v = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
        return { r: (v[0] + m) * 255, g: (v[1] + m) * 255, b: (v[2] + m) * 255 };
    }

    function roundedPath(x, px, py, w, h, r) {
        x.beginPath();
        x.moveTo(px + r, py);
        x.arcTo(px + w, py, px + w, py + h, r);
        x.arcTo(px + w, py + h, px, py + h, r);
        x.arcTo(px, py + h, px, py, r);
        x.arcTo(px, py, px + w, py, r);
        x.closePath();
    }

    /* Into a box, never enlarging a small image too much: better small than blurry. */
    function fit(w, h, boxW, boxH, maxScale) {
        var r = Math.min(boxW / w, boxH / h, maxScale);
        return { w: w * r, h: h * r };
    }
    function drawLogo(x, logo, cx, cy, boxW, boxH) {
        x.imageSmoothingEnabled = true;
        if ("imageSmoothingQuality" in x) x.imageSmoothingQuality = "high";
        if (logo.text) {
            var size = boxH, font = logo.font;
            x.font = "700 " + size + "px " + font;
            var tw = x.measureText(logo.text).width;
            if (tw > boxW) { size = Math.floor(size * boxW / tw); x.font = "700 " + size + "px " + font; }
            x.fillStyle = logo.colour;
            x.textAlign = "center";
            x.textBaseline = "middle";
            x.fillText(logo.text, cx, cy);
            return;
        }
        if (logo.icon) {
            // A real picture: a rounded square, like an app icon
            var side = Math.min(boxW, boxH), iw = logo.icon.naturalWidth, ih = logo.icon.naturalHeight;
            var sz = fit(iw, ih, side, side, 3);
            x.save();
            x.shadowColor = "rgba(0,0,0,0.45)";
            x.shadowBlur = side * 0.12;
            x.shadowOffsetY = side * 0.05;
            x.fillStyle = "#000";
            roundedPath(x, cx - sz.w / 2, cy - sz.h / 2, sz.w, sz.h, sz.w * 0.22);
            x.fill();
            x.restore();
            x.save();
            roundedPath(x, cx - sz.w / 2, cy - sz.h / 2, sz.w, sz.h, sz.w * 0.22);
            x.clip();
            x.drawImage(logo.icon, cx - sz.w / 2, cy - sz.h / 2, sz.w, sz.h);
            x.restore();
            return;
        }
        var f = fit(logo.width, logo.height, boxW, boxH, 3.2);
        x.drawImage(logo, cx - f.w / 2, cy - f.h / 2, f.w, f.h);
    }

    /* ---------- tile ---------- */
    function paintTile(base, logo) {
        var c = canvas(TILE_W, TILE_H), x = c.getContext("2d"), g = x.createLinearGradient(0, 0, TILE_W, TILE_H), up = lum(base) > 200 ? 0 : 10;
        g.addColorStop(0, rgb({ r: base.r + up, g: base.g + up, b: base.b + up }));
        g.addColorStop(1, rgb({ r: base.r - 6, g: base.g - 6, b: base.b - 6 }));
        x.fillStyle = g;
        x.fillRect(0, 0, TILE_W, TILE_H);
        drawLogo(x, logo, TILE_W / 2, TILE_H / 2, 372, logo.icon ? 216 : 178);
        return c.toDataURL("image/jpeg", 0.92);
    }

    /* ---------- background ---------- */
    /* Large shapes around the edge of the screen; the center stays calm for the logo. */
    function paintBg(base, logo, hue, sat, seedText) {
        var c = canvas(BG_W, BG_H), x = c.getContext("2d"), rnd = seeded(seedText), light = lum(base) > 170;
        x.fillStyle = rgb(base);
        x.fillRect(0, 0, BG_W, BG_H);
        var shifts = [0, 34, -30, 62, 180, -64, 16, 150], count = 8, turn = rnd() * Math.PI * 2, i;
        for (i = 0; i < count; i++) {
            var a = turn + i * Math.PI * 2 / count + (rnd() - 0.5) * 0.35;
            var cx = BG_W / 2 + Math.cos(a) * BG_W * (0.47 + rnd() * 0.1);
            var cy = BG_H / 2 + Math.sin(a) * BG_H * (0.48 + rnd() * 0.14);
            var size = 260 + rnd() * 300, h = hue + shifts[i % shifts.length], l = light ? 72 + rnd() * 12 : 44 + rnd() * 22;
            var g = x.createLinearGradient(cx - size, cy - size, cx + size, cy + size);
            g.addColorStop(0, hsl(h, sat, l));
            g.addColorStop(1, hsl(h + 18, sat, l - 12));
            x.fillStyle = g;
            x.beginPath();
            if (i % 3 === 0) {
                x.arc(cx, cy, size, 0, Math.PI * 2);
            } else {
                var sides = i % 3 === 1 ? 3 : 4, start = rnd() * Math.PI * 2, k;
                for (k = 0; k < sides; k++) {
                    var b = start + k * Math.PI * 2 / sides, rr = size * (1.1 + rnd() * 0.4);
                    x[k ? "lineTo" : "moveTo"](cx + Math.cos(b) * rr, cy + Math.sin(b) * rr);
                }
                x.closePath();
            }
            x.fill();
        }
        // A few thin, hand-drawn strokes
        x.lineWidth = 3;
        x.strokeStyle = light ? "rgba(0,0,0,0.22)" : "rgba(255,255,255,0.4)";
        for (i = 0; i < 3; i++) {
            var ax = rnd() < 0.5 ? rnd() * 420 : BG_W - rnd() * 420, ay = rnd() * BG_H, ar = 120 + rnd() * 240;
            x.beginPath();
            x.ellipse(ax, ay, ar, ar * (0.5 + rnd() * 0.5), rnd() * Math.PI, 0, Math.PI * (1.2 + rnd()));
            x.stroke();
        }
        // The center returns to the logo's color, and the bottom darkens under the dock
        var cy2 = BG_H * 0.4;
        x.save();
        x.translate(BG_W / 2, cy2);
        x.scale(1, 0.62);
        var glow = x.createRadialGradient(0, 0, BG_W * 0.2, 0, 0, BG_W * 0.42), o = "rgba(" + Math.round(base.r) + "," + Math.round(base.g) + "," + Math.round(base.b) + ",";
        glow.addColorStop(0, o + "1)");
        glow.addColorStop(0.45, o + "0.82)");
        glow.addColorStop(1, o + "0)");
        x.fillStyle = glow;
        x.fillRect(-BG_W, -BG_H * 2, BG_W * 2, BG_H * 4);
        x.restore();
        if (logo) drawLogo(x, logo, BG_W / 2, cy2, 820, logo.icon ? 400 : 320);
        return c.toDataURL("image/jpeg", 0.84);
    }

    /* Settings › Home Screen › Background for Other Apps: the logo enlarged on the app's colors
       (a small icon gets blurry), the colors alone, or one wallpaper for all of them. */
    var WALLPAPER = "wallpaper", wallpaperUrl = null;
    function bgMode() { var m = sys.pref("shelfArt"); return m === "colors" || m === WALLPAPER ? m : "logo"; }
    function wallpaper() {
        if (!wallpaperUrl) wallpaperUrl = paintBg(hslToRgb(226, 52, 24), null, 226, 58, "APL Launcher");
        return wallpaperUrl;
    }

    /* ---------- for one app ---------- */
    function fontName() {
        try { return global.getComputedStyle(document.body).fontFamily || "sans-serif"; } catch (e) { return "sans-serif"; }
    }
    function hashHue(text) { return Math.floor(seeded(text)() * 360); }

    function paint(app, img) {
        var hue = hashHue(app.name || app.id), sat = 66, base, logo;
        if (img) {
            var s = study(img);
            if (s.accent) { hue = s.accent.h; sat = s.accent.s; }
            base = baseColour(s, hue);
            logo = s.logoMode && s.box ? cutOut(img, s) : { icon: img };
        } else {
            // Nothing found: the app's name serves as the logo
            base = hslToRgb(hue, 58, 26);
            logo = { text: app.name || "", font: fontName(), colour: "#fff" };
        }
        var mode = bgMode();
        return { tile: paintTile(base, logo), accent: rgb(hslToRgb(hue, sat, 50)), mode: mode,
                 bg: mode === WALLPAPER ? WALLPAPER : paintBg(base, mode === "colors" ? null : logo, hue, sat, app.id) };
    }

    function stored(app) {
        try {
            var r = JSON.parse(global.localStorage.getItem(PREFIX + app.id) || "null");
            return r && r.v === VERSION && r.of === String(app.icon || "") && (r.mode || "logo") === bgMode() ? r : null;
        } catch (e) { return null; }
    }
    function put(app, r) {
        try { global.localStorage.setItem(PREFIX + app.id, JSON.stringify(r)); } catch (e) {}   // full: made again at the next start-up
    }
    function use(app, r) {
        var changed = false;
        if (!app.tile && !app.tileHtml) { app.tile = r.tile; app.madeTile = true; changed = true; }
        if (!app.bg && !app.shelfHtml) { app.bg = r.bg === WALLPAPER ? wallpaper() : r.bg; app.madeBg = true; app.bgHasLogo = r.bg !== WALLPAPER && bgMode() === "logo"; changed = true; }
        if (!app.accent) app.accent = r.accent;
        return changed;
    }
    function missing(app) { return !app.folder && ((!app.tile && !app.tileHtml) || (!app.bg && !app.shelfHtml)); }

    /* At start-up: what has already been made. */
    function applyCached(app) {
        if (!missing(app)) return false;
        var r = stored(app);
        return r ? use(app, r) : false;
    }

    /* One app: find its logo and paint, only once. */
    function make(app, art) {
        if (!missing(app) || sys.PREVIEW) return Promise.resolve(false);
        var r = stored(app);
        if (r) return Promise.resolve(use(app, r));
        return findLogo(app, art).then(function (img) {
            var out = paint(app, img);
            out.v = VERSION;
            out.of = String(app.icon || "");
            put(app, out);
            return use(app, out);
        }).catch(function () { return false; });
    }

    function clear() {
        try {
            var del = [], i;
            for (i = 0; i < global.localStorage.length; i++) {
                var k = global.localStorage.key(i);
                if (k && k.indexOf(PREFIX) === 0) del.push(k);
            }
            del.forEach(function (k) { global.localStorage.removeItem(k); });
        } catch (e) {}
    }

    APL.genArt = { make: make, applyCached: applyCached, missing: missing, clear: clear };
})(window);
