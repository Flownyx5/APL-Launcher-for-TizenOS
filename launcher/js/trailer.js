/* ============================================================
   trailer.js — a trailer over the full-screen artwork.

   ▲ from the dock already shows the title's backdrop, full bleed. Two seconds
   later, if this is turned on and a TMDB key is set, the title's YouTube
   trailer takes its place: muted, no controls, the player's branding cropped
   out of frame. Same idea as the Aerial screen saver, but about the show on
   the wall.

   Nothing is fetched while the wall is browsed: the trailer is looked up only
   after the two seconds, once per title, and the answer is kept for a week,
   its length with it (YouTube's own duration), so the picture comes back and
   the next title slides in the moment the trailer ends.

   Leaving full screen, opening Control Center, Search or Settings, or changing
   app takes it away at once, fading into the picture underneath: the backdrop
   is never swapped, so there is nothing to load when the video goes.

   APL.trailer.arm(app, onEnd)   consider a trailer once the focus rests
   APL.trailer.stop()            take it away
   APL.trailer.playing()         a trailer is on screen
   ============================================================ */
(function (global) {
    "use strict";

    var APL = global.APL = global.APL || {};
    var KEYS = global.APL_KEYS || {};
    var TMDB = "https://api.themoviedb.org/3";
    var YT = "https://www.googleapis.com/youtube/v3/videos";
    var TTL = 7 * 86400000, WAIT = 2000, FADE = 650;
    var STORE = "apl.trailer.";

    var timer = 0, endTimer = 0, token = 0, box = null, last = null, onEnd = null, resolving = {};

    function pref(k) {
        return APL.sys && APL.sys.pref ? APL.sys.pref(k) : null;
    }
    function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }

    function read(key) {
        try {
            var c = JSON.parse(global.localStorage.getItem(STORE + key) || "null");
            if (c && c.at && (Date.now() - c.at) < TTL) return c;
        } catch (e) {}
        return null;
    }
    function write(key, value) {
        value.at = Date.now();
        try { global.localStorage.setItem(STORE + key, JSON.stringify(value)); } catch (e) {}
        return value;
    }

    function getJson(url) {
        return global.fetch(url).then(function (r) {
            if (!r.ok) throw new Error("HTTP " + r.status);
            return r.json();
        });
    }

    function norm(s) {
        s = String(s || "").toLowerCase();
        if (s.normalize) s = s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        return s.replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
    }

    /* PT1H2M3S, as YouTube's API writes a length, into seconds. */
    function seconds(iso) {
        var m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(String(iso || ""));
        if (!m) return 0;
        return ((+m[1] || 0) * 86400) + ((+m[2] || 0) * 3600) + ((+m[3] || 0) * 60) + (+m[4] || 0);
    }

    /* The title on the wall, as TMDB knows it: a search, then the best match by
       name and year. JustWatch hands out a title and a year, not a TMDB id. */
    function findId(pick) {
        var q = TMDB + "/search/multi?api_key=" + KEYS.tmdb + "&include_adult=false&language=en-US&query=" +
                encodeURIComponent(pick.title);
        if (pick.year) q += "&year=" + encodeURIComponent(pick.year);
        return getJson(q).then(function (j) {
            var want = norm(pick.title), best = null, top = 0;
            (j.results || []).forEach(function (r) {
                if (!r || (r.media_type !== "movie" && r.media_type !== "tv")) return;
                var got = norm(r.title || r.name), s = 0;
                if (got === want) s = 100;
                else if (got.indexOf(want) === 0 || want.indexOf(got) === 0) s = 80;
                if (pick.year && String((r.release_date || r.first_air_date || "")).slice(0, 4) === String(pick.year)) s += 15;
                if (s > top) { top = s; best = r; }
            });
            if (!best || top < 60) return null;
            return { id: best.id, kind: best.media_type };
        }, function () { return null; });
    }

    function findKey(found) {
        var q = TMDB + "/" + found.kind + "/" + found.id + "/videos?api_key=" + KEYS.tmdb + "&language=en-US";
        return getJson(q).then(function (j) {
            var list = (j.results || []).filter(function (v) {
                return v && v.site === "YouTube" && v.key;
            });
            function by(type) {
                for (var i = 0; i < list.length; i++) if (String(list[i].type).toLowerCase() === type) return list[i];
                return null;
            }
            var v = by("trailer") || by("teaser") || list[0];
            return v ? v.key : null;
        }, function () { return null; });
    }

    /* How long it runs, so the picture can come back by itself. The launcher has
       a YouTube key for the Top Shelf already; without it the trailer simply
       stays until the screen changes. */
    function length(id) {
        if (!KEYS.youtube || !id) return Promise.resolve(0);
        var q = YT + "?part=contentDetails&id=" + encodeURIComponent(id) + "&key=" + KEYS.youtube;
        return getJson(q).then(function (j) {
            var it = j.items && j.items[0];
            return it ? seconds(it.contentDetails && it.contentDetails.duration) : 0;
        }, function () { return 0; });
    }

    function resolve(pick, cb) {
        var key = norm(pick.title) + "|" + (pick.year || "");
        var c = read(key);
        if (c && has(c, "secs")) { cb(c); return; }
        /* An answer kept before the length was asked for: only the length is
           missing, so that is what is fetched. */
        if (c && c.key) {
            length(c.key).then(function (secs) {
                cb(write(key, { key: c.key, secs: secs || 0 }));
            }, function () { cb({ key: c.key, secs: 0 }); });
            return;
        }
        if (has(resolving, key)) { resolving[key].push(cb); return; }
        var waiters = resolving[key] = [cb];
        findId(pick).then(function (found) {
            return found ? findKey(found) : null;
        }).then(function (id) {
            return length(id).then(function (secs) {
                return { key: id || "", secs: secs || 0 };
            });
        }).then(function (value) {
            write(key, value);
            delete resolving[key];
            for (var i = 0; i < waiters.length; i++) waiters[i](value);
        }, function () {
            delete resolving[key];
            cb({ key: "", secs: 0 });
        });
    }

    function layer() {
        var el = document.getElementById("trailerLayer");
        if (el) return el;
        /* index.html carries it; a page from an older package does not, and a
           layer made here still works. */
        el = document.createElement("div");
        el.id = "trailerLayer";
        el.className = "trailerlayer";
        el.setAttribute("aria-hidden", "true");
        var bg = document.getElementById("bgB");
        if (bg && bg.parentNode) bg.parentNode.insertBefore(el, bg.nextSibling);
        else document.body.appendChild(el);
        return el;
    }

    /* The picture is shown only once the player says it is playing. Before that
       the player is on its thumbnail with its own play button drawn across the
       middle of it, and no crop can take that out. */
    function revealTrailer() {
        var host = document.getElementById("trailerLayer");
        if (box && host) host.classList.add("is-on");
    }
    if (global.addEventListener) {
        global.addEventListener("message", function (e) {
            if (!box || !e || e.source !== box.contentWindow) return;
            var d = e.data;
            try { d = typeof d === "string" ? JSON.parse(d) : d; } catch (err) { return; }
            if (!d) return;
            var state = d.info !== undefined ? d.info : (d.infoDelivery && d.infoDelivery.playerState);
            if (state === 1 && (d.event === "onStateChange" || d.event === "infoDelivery")) revealTrailer();
        });
    }

    function playing() {
        var host = document.getElementById("trailerLayer");
        return !!(box && host && host.className.indexOf("is-on") >= 0);
    }

    function show(id, secs) {
        var host = layer();
        if (!host || !id) return;
        hideNow();
        box = document.createElement("iframe");
        box.className = "trailer";
        box.setAttribute("allow", "autoplay; encrypted-media; picture-in-picture");
        box.setAttribute("allowfullscreen", "");
        box.setAttribute("frameborder", "0");
        box.setAttribute("tabindex", "-1");
        box.setAttribute("aria-hidden", "true");
        box.src = "https://www.youtube-nocookie.com/embed/" + encodeURIComponent(id) +
                  "?autoplay=1&mute=1&playsinline=1&controls=0&modestbranding=1&rel=0&iv_load_policy=3" +
                  "&disablekb=1&fs=0&cc_load_policy=0&loop=0&enablejsapi=1";
        host.appendChild(box);
        /* cc_load_policy only says "do not turn them on": a video whose captions
           are on by default still shows them. The player's own API is the only
           way to take the track away, and it needs the frame to have loaded. */
        /* autoplay=1 is a request, not a promise: a player that starts paused
           shows its play button and its whole chrome over the picture, so it is
           told to play as well. Muted and inline, so no engine refuses it. */
        [200, 900, 2000, 3500].forEach(function (ms) {
            global.setTimeout(function () {
                if (!box || !box.contentWindow) return;
                try {
                    box.contentWindow.postMessage(
                        JSON.stringify({ event: "command", func: "playVideo", args: [] }), "*");
                } catch (e) {}
            }, ms);
        });
        [900, 2000, 3500].forEach(function (ms) {
            global.setTimeout(function () {
                if (!box || !box.contentWindow) return;
                try {
                    box.contentWindow.postMessage(
                        JSON.stringify({ event: "command", func: "unloadModule", args: ["captions"] }), "*");
                    box.contentWindow.postMessage(
                        JSON.stringify({ event: "command", func: "setOption", args: ["captions", "track", {}] }), "*");
                } catch (e) {}
            }, ms);
        });
        /* The player is asked to report its state; it answers on playing. */
        [300, 1200].forEach(function (ms) {
            global.setTimeout(function () {
                if (!box || !box.contentWindow) return;
                try { box.contentWindow.postMessage(JSON.stringify({ event: "listening", id: "apl" }), "*"); } catch (e) {}
            }, ms);
        });
        /* A player that never reports (an old engine, a network that answers
           nothing) lights up anyway rather than leaving the wall bare. */
        global.setTimeout(function () { if (box) revealTrailer(); }, 3000);
        if (secs) {
            endTimer = global.setTimeout(function () {
                /* The trailer is over: out, and the next title may slide in. */
                fade();
                var done = onEnd;
                if (done) done();
            }, (secs + 1) * 1000);
        }
    }

    function hideNow() {
        var host = document.getElementById("trailerLayer");
        if (host) host.classList.remove("is-on");
        if (box && box.parentNode) box.parentNode.removeChild(box);
        box = null;
    }

    /* Out through the fade, not with a cut: the picture underneath has been
       there all along, so the video dissolves into it. The video is removed
       only once it is invisible. */
    function fade() {
        clearTimeout(endTimer);
        endTimer = 0;
        var host = document.getElementById("trailerLayer");
        if (host) host.classList.remove("is-on");
        var dying = box;
        box = null;
        if (dying) global.setTimeout(function () {
            if (dying.parentNode) dying.parentNode.removeChild(dying);
        }, FADE);
    }

    /* cut: out at once, with no dissolve. Stepping to another title must not
       leave the last video fading over the new art. */
    function stop(cut) {
        token++;
        clearTimeout(timer);
        timer = 0;
        if (cut) { clearTimeout(endTimer); endTimer = 0; hideNow(); }
        else fade();
    }

    /* pick: the title on the wall, when the wall has already slid past the app's
       first one. Without it, the app's own pick is used. */
    function arm(app, done, pick) {
        if (!app) { stop(); return; }
        last = app;
        onEnd = done || null;
        stop();
        if (!pref("trailers")) return;
        if (!KEYS.tmdb) return;
        /* No title on the wall means no trailer: the app's own first pick is not
           a title the viewer is looking at. */
        if (!pick || !pick.title) return;
        var mine = ++token;
        timer = global.setTimeout(function () {
            if (mine !== token) return;
            resolve(pick, function (found) {
                if (mine !== token || !found || !found.key) return;
                if (document.body.className.indexOf("mode-full") < 0) return;
                if (/(^| )has-(cc|sources|search|settings|profiles|wdg)( |$)/.test(document.body.className)) return;
                show(found.key, found.secs);
            });
        }, WAIT);
    }

    /* A panel over the picture takes the video away; closing it brings the
       trailer back if the screen is still in full screen. */
    if (global.MutationObserver && document.body) {
        var over = false;
        new global.MutationObserver(function () {
            var open = /(^| )has-(cc|sources|search|settings|profiles|wdg)( |$)/.test(document.body.className);
            if (open === over) return;
            over = open;
            if (open) stop();
            else if (document.body.className.indexOf("mode-full") >= 0) {
                /* Back from Control Center or Search: the show on the wall, not the
                   app's first pick. */
                var here = APL.trailer && APL.trailer.pickOnWall ? APL.trailer.pickOnWall(last) : null;
                arm(last, onEnd, here);
            }
        }).observe(document.body, { attributes: true, attributeFilter: ["class"] });
    }

    /* Waiting to play counts too: the wall must hold still from the moment the
       two seconds start, not only once the video is on screen. */
    function busy() { return !!timer || playing(); }

    APL.trailer = {
        arm: arm,
        stop: stop,
        playing: playing,
        busy: busy,
        status: function () {
            return { playing: playing(), armed: !!timer, ends: !!endTimer, waiting: Object.keys(resolving) };
        }
    };
})(window);
