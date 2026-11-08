/* ============================================================
   genart.js — a logo and a background for apps with no artwork.

   The launcher makes by itself, only once per app:
     tile        500×300    for an app the catalog doesn't know (sideloaded, installed later):
                            the sharp logo, cut out from its background, on the app's color
     background  1920×1080  for every app without artwork of its own, catalog apps included
                            (no background is shipped): light sheets in the app's colors for
                            dark and light themes, or the logo on a halo of its color

   The logo comes, in this order: from the app's icon if it is big enough,
   from the App Store if the name matches exactly, from TMDB, from public icon
   catalogs, then from the app's icon even if small. With none of these,
   the app's name serves as the logo.

   A catalog app's logo is its catalog tile, cut out the same way: nothing to search.

   Kept on the screen (a few tens of KB per app).
   ============================================================ */
(function (global) {
    "use strict";

    var APL = global.APL, sys = APL.sys;
    var VERSION = 3, PREFIX = "apl.gen.";        // 3: sheets in the logo's own colors, made again
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
        var best = null, next = null;
        Object.keys(buckets).forEach(function (k) { if (!best || buckets[k].n > best.n) best = buckets[k]; });
        // A second color of the logo (Samsung TV Plus blue and orange, TikTok pink and cyan): a hue well
        // apart from the main one, and not a speck
        Object.keys(buckets).forEach(function (k) {
            var b = buckets[k];
            if (b !== best && b.n >= best.n * 0.2 && hueGap(b.h / b.n, best.h / best.n) >= 50 && (!next || b.n > next.n)) next = b;
        });
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
            accent: best ? { h: best.h / best.n, s: clamp(best.s / best.n, 50, 90), l: clamp(best.l / best.n, 40, 62) } : null,
            second: next ? { h: next.h / next.n, s: next.s / next.n, l: next.l / next.n } : null
        };
    }
    function hueGap(a, b) { var d = Math.abs(((a - b) % 360 + 360) % 360); return Math.min(d, 360 - d); }

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
    /* Large Logo: dark, with a soft halo in the app's color behind the logo, the style of the old
       catalog cards, now drawn here for every app. */
    function paintBg(logo, hue, sat) {
        var c = canvas(BG_W, BG_H), x = c.getContext("2d"), a = hslToRgb(hue, sat, 50), cy = BG_H * 0.44;
        var o = "rgba(" + Math.round(a.r) + "," + Math.round(a.g) + "," + Math.round(a.b) + ",";
        x.fillStyle = "#07080c";
        x.fillRect(0, 0, BG_W, BG_H);
        function halo(px, py, rx, ry, alpha, stop) {
            x.save();
            x.translate(px, py);
            x.scale(1, ry / rx);
            var g = x.createRadialGradient(0, 0, 0, 0, 0, rx);
            g.addColorStop(0, o + alpha + ")");
            g.addColorStop(stop, o + "0)");
            x.fillStyle = g;
            x.fillRect(-rx, -rx, rx * 2, rx * 2);
            x.restore();
        }
        halo(BG_W / 2, cy, BG_W * 0.6, BG_H * 0.7, 0.42, 0.7);
        halo(BG_W / 2, BG_H * 1.15, BG_W * 1.1, BG_H * 0.8, 0.22, 0.6);
        if (logo) drawLogo(x, logo, BG_W / 2, cy, 820, logo.icon ? 400 : 320);
        return c.toDataURL("image/jpeg", 0.84);
    }

    /* ---------- background: light sheets (Settings › Appearance › Top Shelf › Otherwise) ----------
       Four or five sheets, each the area on one side of a smooth line across the screen, like
       Apple's wallpapers. A sheet is mostly its edge light: crisp at the line, fading inward, so the
       sheets below show through. Lines, sides, light and hollows all follow from the app's id, the
       colors from its main color (neighbouring hues only). Blurred by 10% of the width, so it is drawn
       small and the screen enlarges it. One for the dark theme, one for the light one. */
    var SW = 480, SH = 270, EDGE = 0.12;

    // The previews' random sequence: the same app always gets the same sheets
    function sheetRandom(str) {
        var h = 2166136261, i;
        for (i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
        return function () {
            h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0; h = Math.imul(h ^ (h >>> 13), 3266489909) >>> 0;
            return (h ^= h >>> 16) / 4294967296 + 0.5;
        };
    }
    function edgePoint(t) {                              // t in [0, 4): top, right, bottom, left, clockwise
        t = ((t % 4) + 4) % 4;
        var k = Math.floor(t), f = t - k;
        return [[f, -0.02], [1.02, f], [1 - f, 1.02], [-0.02, 1 - f]][k];
    }
    var CORNERS = [[1 + EDGE, -EDGE], [1 + EDGE, 1 + EDGE], [-EDGE, 1 + EDGE], [-EDGE, -EDGE]];   // after top, right, bottom, left
    function sheetPath(x, s, append) {
        var p = s.pts.map(function (v) { return [v[0] * SW, v[1] * SH]; }), n = p.length, i;
        if (!append) x.beginPath();
        x.moveTo(p[0][0], p[0][1]);
        for (i = 0; i < n - 1; i++) {
            var p0 = p[Math.max(i - 1, 0)], p1 = p[i], p2 = p[i + 1], p3 = p[Math.min(i + 2, n - 1)];
            x.bezierCurveTo(p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6, p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6, p2[0], p2[1]);
        }
        s.close.forEach(function (v) { x.lineTo(v[0] * SW, v[1] * SH); });
        x.closePath();
    }
    /* One line from one side of the screen to another, closed along the border: that picks its side. */
    function sheetLine(r) {
        var t0 = r() * 4, t1 = t0 + 1.2 + r() * 1.6, a = edgePoint(t0), b = edgePoint(t1);
        var n = 2 + Math.floor(r() * 2), pts = [a], i;
        var dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy), nx = -dy / len, ny = dx / len;
        for (i = 1; i <= n; i++) {
            var f = i / (n + 1) + (r() - 0.5) * 0.12, amp = (r() - 0.5) * 0.3 * len;
            pts.push([a[0] + dx * f + nx * amp, a[1] + dy * f + ny * amp]);
        }
        pts.push(b);
        var close = [], k;
        if (r() < 0.5) { for (k = Math.floor(t1); k < Math.floor(t0) + 4; k++) close.push(CORNERS[((k % 4) + 4) % 4]); }
        else { for (k = Math.floor(t1 - 1e-9); k >= Math.floor(t0); k--) close.push(CORNERS[((k - 1) % 4 + 4) % 4]); }
        return { pts: pts, close: close };
    }
    function covered(list) {
        var c = canvas(SW / 8, SH / 8), x = c.getContext("2d"), on = 0, i;
        x.scale(1 / 8, 1 / 8);
        list.forEach(function (s) { sheetPath(x, s); x.fill(); });
        var d = x.getImageData(0, 0, c.width, c.height).data;
        for (i = 3; i < d.length; i += 4) if (d[i] > 127) on++;
        return on / (d.length / 4);
    }
    function pointIn(s, r) {
        var x = canvas(1, 1).getContext("2d"), i;
        sheetPath(x, s);
        for (i = 0; i < 30; i++) { var p = [0.1 + r() * 0.8, 0.1 + r() * 0.8]; if (x.isPointInPath(p[0] * SW, p[1] * SH)) return p; }
        return null;
    }
    /* 4 or 5 sheets, each a fair share of the screen; together 60 to 86 % of it (never empty, never full). */
    function sheetPlan(id, hue, two) {
        var r, list, v;
        for (v = 0; v < 12; v++) {
            r = sheetRandom(id + "#" + v);
            var n = 4 + Math.floor(r() * 2), tries = 0;
            list = [];
            while (list.length < n && tries++ < 40) {
                var s = sheetLine(r), a = covered([s]);
                if (a >= 0.12 && a <= 0.55) list.push(s);
            }
            var u = covered(list);
            if (list.length === n && u > 0.6 && u < 0.86) break;
        }
        var side = [r() < 0.5 ? -1 : 1, r() < 0.5 ? -1 : 1], odd = [Math.floor(r() * list.length), Math.floor(r() * list.length)];
        list.forEach(function (s, i) {
            var nb = odd.indexOf(i), j = r();
            // The logo's main color; one or two sheets in its second color if it has one, else a close
            // neighbour. Small steps only: a wider one turned Crunchyroll's orange red.
            if (nb >= 0 && two) { s.h = two.h + (j - 0.5) * 6; s.sat = two.s; s.lit = two.l; }
            else s.h = hue + (nb >= 0 ? side[nb] * (5 + j * 5) : (j - 0.5) * 4);
            s.h2 = s.h + (r() - 0.5) * 10;                                            // the rim, within ±5°
            s.rimEnd = s.h + (r() - 0.5) * 10;
            var m = s.pts[Math.floor(r() * s.pts.length)], far = s.pts[Math.floor(r() * s.pts.length)];
            s.l = [m[0], m[1], far[0] + (r() - 0.5) * 0.6, far[1] + (r() - 0.5) * 0.6];   // where the light falls along the edge
            s.rimDir = [s.pts[0][0], s.pts[0][1], s.pts[s.pts.length - 1][0], s.pts[s.pts.length - 1][1]];
            s.drift = [r(), r(), r(), r(), (r() < 0.5 ? -1 : 1) * (6 + r() * 8)];
            s.pockets = [];
            for (var k = 0, np = Math.floor(r() * 3); k < np; k++) { var p = pointIn(s, r); if (p) s.pockets.push([p[0], p[1], 0.1 + r() * 0.12, 0.35 + r() * 0.35]); }
        });
        return list;
    }
    /* Strength by distance to the sheet's edge: everything outside it, blurred, seen only inside it.
       Wide ones at a quarter size: canvas caps the blur radius (and it is cheaper). */
    function falloff(s, blur, times, k) {
        k = k || 1;
        var o = canvas(SW * k, SH * k), x = o.getContext("2d"), i;
        x.scale(k, k);
        x.save();
        x.translate(-SW * 4, 0);
        x.beginPath(); x.rect(-SW, -SH, SW * 3, SH * 3); sheetPath(x, s, true);
        x.translate(SW * 4, 0);
        x.shadowOffsetX = SW * 4 * k; x.shadowBlur = blur * k; x.shadowColor = "#fff"; x.fillStyle = "#000";
        for (i = 0; i < times; i++) x.fill("evenodd");
        x.restore();
        x.globalCompositeOperation = "destination-in"; sheetPath(x, s); x.fill();
        if (k === 1) return o;
        var big = canvas(SW, SH), g = big.getContext("2d");
        if ("imageSmoothingQuality" in g) g.imageSmoothingQuality = "high";
        g.drawImage(o, 0, 0, SW, SH);
        g.globalCompositeOperation = "destination-in"; sheetPath(g, s); g.fill();   // the edge stays crisp
        return big;
    }
    function lightMask(x, l, stops) {
        x.globalCompositeOperation = "destination-in";
        var m = x.createLinearGradient(l[0] * SW, l[1] * SH, l[2] * SW, l[3] * SH);
        stops.forEach(function (st) { m.addColorStop(st[0], "rgba(0,0,0," + st[1] + ")"); });
        x.fillStyle = m; x.fillRect(0, 0, SW, SH);
    }
    /* Dark yellows read as olive: they lean towards orange. A yellow kept bright (Pluto TV, DAZN) stays yellow. */
    function warm(h, light, lit) { h = ((h % 360) + 360) % 360; return (!light && lit < 46 && h > 38 && h < 75) ? h - 10 * (1 - Math.abs(h - 56) / 19) : h; }
    /* In the dark theme a sheet is as bright as the logo's color, within limits: a fixed dark one
       turned yellow olive, orange brown and cyan teal. */
    function sheetLight(l) { return l === undefined || l === null ? 38 : clamp(l, 34, 52); }
    function paintSheets(list, sat, light, lit) {
        var c = canvas(SW, SH), x = c.getContext("2d");
        x.fillStyle = light ? hsl(warm(list[0].h, true), Math.min(sat, 45) * 0.6, 84) : "#000";
        x.fillRect(0, 0, SW, SH);
        list.forEach(function (s) {
            if (light) {
                // Light theme: a soft shadow just outside the sheet, on what lies below
                var sh = canvas(SW, SH), y = sh.getContext("2d");
                y.save(); y.translate(-SW * 4, 0); sheetPath(y, s); y.translate(SW * 4, 0);
                y.shadowOffsetX = SW * 4 + SW * 0.004; y.shadowOffsetY = SW * 0.006; y.shadowBlur = SW * 0.035;
                y.shadowColor = hsl(s.h, (s.sat === undefined ? sat : clamp(s.sat, 55, 92)) * 0.6, 28, 0.38); y.fill(); y.restore();
                y.globalCompositeOperation = "destination-out"; sheetPath(y, s); y.fill();
                x.drawImage(sh, 0, 0);
            }
            var body = canvas(SW, SH), b = body.getContext("2d");
            var ss = s.sat === undefined ? sat : clamp(s.sat, 55, 92), sl = s.lit === undefined ? lit : sheetLight(s.lit);
            b.drawImage(falloff(s, SW * 0.012, 1), 0, 0);
            b.drawImage(falloff(s, SW * 0.32, 2, 0.25), 0, 0);
            lightMask(b, s.l, light ? [[0, 1], [1, 0.6]] : [[0, 1], [1, 0.35]]);
            b.globalCompositeOperation = "source-in";
            var d = s.drift, dg = b.createLinearGradient(d[0] * SW, d[1] * SH, d[2] * SW, d[3] * SH);
            dg.addColorStop(0, hsl(warm(s.h + d[4] * 0.5, light, sl), ss, light ? 56 : sl));
            dg.addColorStop(1, hsl(warm(s.h, light, sl), ss, light ? 50 : sl));
            b.fillStyle = dg; b.fillRect(0, 0, SW, SH);
            b.globalCompositeOperation = "source-atop";
            s.pockets.forEach(function (k) {                                         // hollows inside the sheet
                var pg = b.createRadialGradient(k[0] * SW, k[1] * SH, 0, k[0] * SW, k[1] * SH, k[2] * SW);
                pg.addColorStop(0, light ? "rgba(255,255,255," + (k[3] * 0.25) + ")" : "rgba(0,0,0," + k[3] + ")");
                pg.addColorStop(1, "rgba(0,0,0,0)");
                b.fillStyle = pg; b.fillRect(0, 0, SW, SH);
            });
            var rim = canvas(SW, SH), q = rim.getContext("2d");                      // the pale rim where the light falls
            q.drawImage(falloff(s, SW * 0.008, 1), 0, 0);
            q.drawImage(falloff(s, SW * 0.05, 2), 0, 0);
            lightMask(q, s.l, [[0, 1], [0.45, 0.25], [0.8, 0]]);
            q.globalCompositeOperation = "source-in";
            var rd = s.rimDir, rg = q.createLinearGradient(rd[0] * SW, rd[1] * SH, rd[2] * SW, rd[3] * SH), rs = ss * (light ? 0.4 : 0.65);
            rg.addColorStop(0, hsl(warm(s.h2, light, sl), rs, light ? 92 : 82));
            rg.addColorStop(1, hsl(warm(s.rimEnd, light, sl), rs, light ? 92 : 82));
            q.fillStyle = rg; q.fillRect(0, 0, SW, SH);
            x.drawImage(body, 0, 0);
            x.globalAlpha = light ? 0.8 : 0.95; x.drawImage(rim, 0, 0); x.globalAlpha = 1;
        });
        return blurred(c, 0.10).toDataURL("image/jpeg", 0.9);
    }
    /* Blur by a share of the width: canvas filter at half size, else smooth down- and up-scaling. */
    function blurred(src, share) {
        var w = SW / 2, h = SH / 2, half = canvas(w, h), x = half.getContext("2d"), out = canvas(SW, SH), o = out.getContext("2d");
        if ("imageSmoothingQuality" in o) o.imageSmoothingQuality = "high";
        if ("filter" in x) {
            var m = w * share * 2;
            x.filter = "blur(" + (w * share) + "px)";
            x.drawImage(src, -m, -m, w + 2 * m, h + 2 * m);                          // a little larger: no soft border
            o.drawImage(half, 0, 0, SW, SH);
            return out;
        }
        var cur = src, size = [SW, SH];
        while (size[0] > SW * share * 2) {
            size = [Math.max(2, Math.round(size[0] / 2)), Math.max(2, Math.round(size[1] / 2))];
            var next = canvas(size[0], size[1]), n = next.getContext("2d");
            if ("imageSmoothingQuality" in n) n.imageSmoothingQuality = "high";
            n.drawImage(cur, 0, 0, size[0], size[1]);
            cur = next;
        }
        o.drawImage(cur, 0, 0, SW, SH);
        return out;
    }
    function hexHsl(hex) {
        var m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ""));
        if (!m) return null;
        var v = parseInt(m[1], 16);
        return toHsl({ r: v >> 16, g: (v >> 8) & 255, b: v & 255 });
    }
    /* Both themes; a color without saturation (black, white) gives graphite / silver. */
    /* main: the app's color {h, s, l}; st: what study() found in its tile or logo, for a second color. */
    function sheets(id, main, st) {
        var grey = main.s < 15, two = grey ? null : secondColour(main, st);
        var list = sheetPlan(id, main.h, two), s = grey ? 6 : clamp(main.s, 55, 92), l = grey ? 38 : sheetLight(main.l);
        return { dark: paintSheets(list, s, false, l), light: paintSheets(list, s, true, l) };
    }
    /* The logo's other color, if it has a clear one far enough from the main color. */
    function secondColour(main, st) {
        if (!st) return null;
        var c = st.second && hueGap(st.second.h, main.h) >= 50 ? st.second
              : st.accent && hueGap(st.accent.h, main.h) >= 50 ? st.accent : null;
        return c && c.s >= 35 ? c : null;
    }

    /* Settings › Appearance › Top Shelf › Otherwise: light sheets in the app's colors (the default), or
       its logo on a halo of its color. Black (a plain dark Top Shelf, launcher.js) still needs the tiles:
       they are made as for the sheets. */
    var SHEETS = "sheets", LOGO = "logo";
    function bgMode() { return sys.pref("shelfArt") === LOGO ? LOGO : SHEETS; }
    function lightTheme() { return !!(document.body && document.body.classList.contains("theme-light")); }

    /* ---------- for one app ---------- */
    function fontName() {
        try { return global.getComputedStyle(document.body).fontFamily || "sans-serif"; } catch (e) { return "sans-serif"; }
    }
    function hashHue(text) { return Math.floor(seeded(text)() * 360); }

    /* tile: the catalog's tile, read for a second color (its main one is the catalog's). */
    function paint(app, img, tile) {
        var hue = hashHue(app.name || app.id), sat = 66, lit = null, base, logo, mode = bgMode(), known = hexHsl(app.accent), st = null;
        var out = { mode: mode };
        // An app with its tile and its color already (catalog): only the sheets, nothing to look at
        if (!img && known && (app.tile || app.tileHtml)) {
            var both = sheets(app.id, known, tile ? study(tile) : null);
            out.bgDark = both.dark; out.bgLight = both.light;
            return out;
        }
        if (img) {
            st = study(img);
            if (st.accent) { hue = st.accent.h; sat = st.accent.s; lit = st.accent.l; }
            base = baseColour(st, hue);
            logo = st.logoMode && st.box ? cutOut(img, st) : { icon: img };
        } else {
            // Nothing found: the app's name serves as the logo
            base = hslToRgb(hue, 58, 26);
            logo = { text: app.name || "", font: fontName(), colour: "#fff" };
        }
        if (known) { hue = known.h; sat = known.s; lit = known.l; }
        out.tile = paintTile(base, logo);
        out.accent = rgb(hslToRgb(hue, sat, 50));
        if (mode === SHEETS) { var two = sheets(app.id, { h: hue, s: sat, l: lit }, st); out.bgDark = two.dark; out.bgLight = two.light; }
        else out.bg = paintBg(logo, hue, sat);
        return out;
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
    function bgOf(r) { return r.bgDark ? (lightTheme() ? r.bgLight : r.bgDark) : r.bg; }
    function use(app, r) {
        var changed = false;
        if (!app.tile && !app.tileHtml && r.tile) { app.tile = r.tile; app.madeTile = true; changed = true; }
        if (!app.bg && !app.shelfHtml && (r.bg || r.bgDark)) {
            app.bg = bgOf(r); app.madeBg = true; changed = true;
            app.bgHasLogo = bgMode() === LOGO;                                  // screen saver: no second logo over it
            if (r.bgDark) { app.bgBlur = app.bg; app.sheets = r; }                     // already blurred: the grid uses it as is
        }
        if (!app.accent && r.accent) app.accent = r.accent;
        return changed;
    }
    function missing(app) {
        return !app.folder && ((!app.tile && !app.tileHtml) || (!app.bg && !app.shelfHtml));
    }
    /* Before painting again: what this file gave the app goes. */
    function undo(app) {
        if (!app.madeBg) return;
        app.bg = null;
        if (app.sheets) app.bgBlur = null;
        app.sheets = null;
        app.madeBg = false;
    }
    /* The theme changed: the sheets of the other theme, already made. */
    function retheme(apps) {
        var changed = false;
        apps.forEach(function (a) {
            if (!a.sheets) return;
            var bg = bgOf(a.sheets);
            if (bg !== a.bg) { a.bg = a.bgBlur = bg; changed = true; }
        });
        return changed;
    }

    /* At start-up: what has already been made. */
    function applyCached(app) {
        if (!missing(app)) return false;
        var r = stored(app);
        return r ? use(app, r) : false;
    }

    /* One app: find its logo and paint, only once. */
    function make(app, art) {
        if (!missing(app)) return Promise.resolve(false);
        // Tile and color known (catalog): the sheets need no logo, nothing to search
        // (its tile is still read, for the logo's second color)
        var tileOnly = (app.tile || app.tileHtml) && hexHsl(app.accent) && bgMode() === SHEETS;
        // A catalog app in the other styles: its tile is the logo, cut out like an icon (no search)
        var ownTile = !tileOnly && app.tile && !app.madeTile;
        if (sys.PREVIEW && !tileOnly && !ownTile) return Promise.resolve(false);      // the preview searches nothing online
        var r = stored(app);
        if (r) return Promise.resolve(use(app, r));
        var logoP = tileOnly ? Promise.resolve(null) : ownTile ? load(app.tile) : findLogo(app, art);
        var tileP = tileOnly && app.tile ? load(app.tile) : Promise.resolve(null);
        return Promise.all([logoP, tileP]).then(function (got) {
            var out = paint(app, got[0], got[1]);
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

    APL.genArt = { make: make, applyCached: applyCached, missing: missing, clear: clear, undo: undo, retheme: retheme };
})(window);
