/* ============================================================
   autoart.js — the launcher finds the artwork of every app BY ITSELF,
   including apps installed later. Nothing to download by hand.

   For an app without artwork in the catalogue:
     1. Apple's App Store (iTunes Search, free, no key): the real
        official icon at 1024 px, and the Apple TV screenshots (1920×1080)
        when the app exists on Apple TV → Top Shelf background.
     2. TMDB (with your key): recognises the streaming service (TF1+, M6+,
        france.tv, Molotov, ARTE…) to show its current movies and series
        in the Top Shelf, and its official logo as a fallback.
     3. Music apps are spotted (live Top albums in the screen's country).
   Results are kept 30 days on the screen (3 days if nothing is
   found): a single search per app, in the background, without slowing down.
   The App Store only counts if the name matches exactly: "Overscan" and
   "Workspace" are other apps there. The rest is made by genart.js.
   ============================================================ */
(function (global) {
    "use strict";

    var APL = global.APL, sys = APL.sys;
    var KEYS = global.APL_KEYS || {};
    var DAY = 86400000, OK_TTL = 30 * DAY, MISS_TTL = 3 * DAY;
    var TMDB = "https://api.themoviedb.org/3", TMDB_IMG = "https://image.tmdb.org/t/p/";

    function norm(s) {
        s = String(s || "").toLowerCase();
        if (s.normalize) s = s.normalize("NFD").replace(/[̀-ͯ]/g, "");
        return s.replace(/\+/g, " plus ").replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
    }

    function cacheGet(k) {
        try {
            var c = JSON.parse(global.localStorage.getItem("apl.art." + k) || "null");
            if (c && Date.now() - c.t < (c.miss ? MISS_TTL : OK_TTL)) return c;
        } catch (e) {}
        return null;
    }
    function cachePut(k, v) {
        v.t = Date.now();
        try { global.localStorage.setItem("apl.art." + k, JSON.stringify(v)); } catch (e) {}
        return v;
    }
    function clearCache() {
        try {
            var del = [];
            for (var i = 0; i < global.localStorage.length; i++) {
                var k = global.localStorage.key(i);
                if (k && k.indexOf("apl.art.") === 0) del.push(k);
            }
            del.forEach(function (k) { global.localStorage.removeItem(k); });
        } catch (e) {}
    }

    function getJson(url) {
        return global.fetch(url).then(function (r) {
            if (!r.ok) throw new Error("HTTP " + r.status);
            return r.json();
        });
    }
    /* The App Store API also accepts JSONP (if the screen refuses the direct request). */
    var jsonpN = 0;
    function jsonp(url) {
        return new Promise(function (resolve, reject) {
            var name = "__aplArt" + (++jsonpN), s = document.createElement("script");
            var timer = setTimeout(fail, 9000);
            function done() {
                clearTimeout(timer);
                try { delete global[name]; } catch (e) { global[name] = undefined; }
                if (s.parentNode) s.parentNode.removeChild(s);
            }
            function fail() { done(); reject(new Error("jsonp")); }
            global[name] = function (d) { done(); resolve(d); };
            s.onerror = fail;
            s.src = url + "&callback=" + name;
            document.head.appendChild(s);
        });
    }

    /* The wanted size of an App Store image (the server makes it on demand). */
    function sized(url, size) {
        return String(url || "").replace(/\/\d+x\d+[a-z]*\.(jpg|jpeg|png|webp)$/i, "/" + size + "bb.jpg");
    }

    /* ---------- 1. App Store: official icon + Apple TV screenshots ---------- */
    function score(want, got) {
        if (!got) return 0;
        if (got === want) return 100;
        if (got.indexOf(want + " ") === 0 || got.indexOf(want) === 0) return 80;
        if ((" " + got + " ").indexOf(" " + want + " ") > -1) return 65;
        var first = want.split(" ")[0];
        return first.length >= 4 && got.indexOf(first) === 0 ? 40 : 0;
    }
    function appStore(name) {
        var url = "https://itunes.apple.com/search?entity=software&country=fr&limit=10&term=" + encodeURIComponent(name);
        return getJson(url).catch(function () { return jsonp(url); }).then(function (j) {
            var want = norm(name), best = null, top = 0;
            (j && j.results || []).forEach(function (r) {
                var s = score(want, norm(r.trackName));
                if (s && r.appletvScreenshotUrls && r.appletvScreenshotUrls.length) s += 10;   // exists on Apple TV
                if (s > top) { top = s; best = r; }
            });
            if (!best || top < 60) return null;
            var tv = best.appletvScreenshotUrls || [];
            return {
                exact: norm(best.trackName) === want,
                icon: sized(best.artworkUrl512 || best.artworkUrl100, "1024x1024"),
                bg: tv.length ? sized(tv[0], "1920x1080") : null,
                genre: best.primaryGenreName || "",
                storeName: best.trackName
            };
        }).catch(function () { return null; });
    }

    /* ---------- 2. TMDB: streaming services in the screen's country ---------- */
    var providersP = null;
    function providers() {
        if (!KEYS.tmdb) return Promise.resolve([]);
        if (providersP) return providersP;
        var region = APL.live ? APL.live.region() : "FR";                // a list per country (what streams there)
        var c = cacheGet("__providers" + region);
        if (c && !c.miss && Date.now() - c.t < 7 * DAY) return (providersP = Promise.resolve(c.list));
        var q = "?api_key=" + KEYS.tmdb + "&watch_region=" + region + "&language=" + APL.locale;
        providersP = Promise.all([
            getJson(TMDB + "/watch/providers/tv" + q).catch(function () { return { results: [] }; }),
            getJson(TMDB + "/watch/providers/movie" + q).catch(function () { return { results: [] }; })
        ]).then(function (r) {
            var seen = {}, list = [];
            r[0].results.concat(r[1].results).forEach(function (p) {
                if (seen[p.provider_id]) return;
                seen[p.provider_id] = true;
                list.push({ id: p.provider_id, name: p.provider_name, logo: p.logo_path });
            });
            if (list.length) cachePut("__providers" + region, { list: list });
            return list;
        });
        return providersP;
    }
    function matchProvider(name, list) {
        var want = norm(name).replace(/ (tv|app|replay|direct)$/, ""), best = null, top = 0;
        if (want.length < 2) return null;
        list.forEach(function (p) {
            var got = norm(p.name);
            // "Netflix basic with Ads", "Amazon Channel"…: the shortest name is preferred
            var s = got === want ? 100 : got.indexOf(want) === 0 ? 70 - got.length / 10 :
                    (" " + got + " ").indexOf(" " + want + " ") > -1 ? 60 - got.length / 10 : 0;
            if (/channel|with ads|amazon channel/.test(got) && s < 100) s -= 30;
            if (s > top) { top = s; best = p; }
        });
        return top >= 55 ? best : null;
    }

    /* ---------- search for one app ---------- */
    var MUSIC = /music|musique/i;
    function lookup(app, needArt) {
        var c = cacheGet(app.id);
        if (c && c.v === 2) return Promise.resolve(c);
        return Promise.all([
            needArt ? appStore(app.name) : Promise.resolve(null),
            providers().then(function (l) { return matchProvider(app.name, l); }).catch(function () { return null; })
        ]).then(function (r) {
            var store = r[0], prov = r[1];
            var art = {
                v: 2,
                exact: !!(store && store.exact),
                icon: store && store.icon || null,
                bg: store && store.bg || null,
                music: !!(store && MUSIC.test(store.genre)),
                provider: prov ? prov.id : null,
                providerLogo: prov && prov.logo ? TMDB_IMG + "w300" + prov.logo : null
            };
            art.miss = !art.icon && !art.bg && !art.provider && !art.music;
            return cachePut(app.id, art);
        });
    }

    function apply(app, art) {
        if (!art || art.miss) return false;
        var changed = false;
        if (!app.tile && !app.tileHtml && !app.icon) {
            var icon = (art.exact && art.icon) || art.providerLogo;
            if (icon) { app.icon = icon; app.autoIcon = true; changed = true; }
        }
        if (!app.bg && art.bg && art.exact) { app.bg = art.bg; app.bgBlur = art.bg; changed = true; }
        if (art.provider && !app.tmdbProvider) { app.tmdbProvider = art.provider; changed = true; }
        if (art.music && !app.music) { app.music = true; changed = true; }
        return changed;
    }

    function wanted(a) { return !a.virtual || a.web; }

    /* All the apps, one after another, in the background. onChange: redraw. */
    var running = false;
    function run(apps, onChange) {
        if (running || !sys.pref("autoArt")) return;
        if (sys.PREVIEW) { previewArt(apps, onChange); return; }
        running = true;
        var queue = apps.filter(wanted), dirty = false, n = 0;
        (function next() {
            if (!queue.length) {
                running = false;
                if (dirty) onChange();
                return;
            }
            var app = queue.shift();
            var needArt = !app.tile && !app.tileHtml || !app.bg;
            lookup(app, needArt).then(function (art) {
                if (apply(app, art)) dirty = true;
                return APL.genArt ? APL.genArt.make(app, art) : false;
            }).then(function (made) {
                if (made) dirty = true;
            }, function () {}).then(function () {
                if (dirty && ++n % 6 === 0) { onChange(); dirty = false; }
                setTimeout(next, 250);           // gently: the screen stays smooth
            });
        })();
    }

    /* The PC preview and the online demo: no search online, only what genart.js paints from the catalog
       (the Sheets of Light behind the catalog's apps), so the demo looks like a screen. */
    function previewArt(apps, onChange) {
        if (!APL.genArt) return;
        running = true;
        var queue = apps.filter(wanted), dirty = false;
        (function next() {
            if (!queue.length) { running = false; if (dirty) onChange(); return; }
            APL.genArt.make(queue.shift(), null).then(function (made) { if (made) dirty = true; }, function () {})
                .then(function () { setTimeout(next, 30); });
        })();
    }

    /* At start-up: what is already in memory applies right away. */
    function applyCached(apps) {
        apps.filter(wanted).forEach(function (a) {
            apply(a, cacheGet(a.id));
            if (APL.genArt) APL.genArt.applyCached(a);
        });
    }

    APL.autoArt = {
        run: run,
        applyCached: applyCached,
        refresh: function (apps, onChange) {
            clearCache();
            if (APL.genArt) APL.genArt.clear();
            apps.forEach(function (a) {
                if (a.madeTile) { a.tile = null; a.madeTile = false; }
                if (a.madeBg) { if (APL.genArt) APL.genArt.undo(a); else { a.bg = null; a.madeBg = false; } }
            });
            providersP = null; running = false; run(apps, onChange);
        },
        /* Only the backgrounds made by genart.js, painted again in the chosen style: nothing searched again. */
        restyle: function (apps, onChange) {
            if (APL.genArt) APL.genArt.clear();
            apps.forEach(function (a) { if (a.madeBg) { if (APL.genArt) APL.genArt.undo(a); else { a.bg = null; a.madeBg = false; } } });
            running = false; run(apps, onChange);
        }
    };
})(window);
