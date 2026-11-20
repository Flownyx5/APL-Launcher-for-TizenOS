/* ============================================================
   stremio.js: your Stremio account as a source, like a media server.
   - Linked with a code shown on the screen, typed on link.stremio.com
     (no password typed on the TV).
   - The addons installed on your account give no catalog (Stremio's is
     unlimited): a title shows where APL TV already has it, and the ones of
     TMDB's lists your playlist misses show when your addons play them
     (js/data.js findTitles).
   - The streams your addons find for a title are its versions (quality,
     languages, size): Play takes the best one in your language, Versions on
     its page lets you choose another (the same kind is taken again by itself
     for the next episode). Direct
     links (http, debrid services) play straight away; torrents only through a
     Stremio streaming server on your network (Stremio's app on a computer),
     set in the source's settings.
   Addresses are "stremio:<source>:<movie|series>:<id>" in the catalog; the
   streams are asked just before playing.
   ============================================================ */
(function (global) {
    "use strict";

    var TV = global.TV, S = TV.smart, T = TV.t;
    // a test server instead of Stremio's, only while developing (like plexTv in js/media.js)
    var TEST = (TV.PREVIEW || TV.DEV) && TV.load("stremioTest", "") || "";
    var API = TEST ? TEST + "/api/" : "https://api.strem.io/api/", LINK = TEST ? TEST + "/link/" : "https://link.stremio.com/api/v2/";
    var CINEMETA = "https://v3-cinemeta.strem.io";

    function src0(id) { return TV.data.sources().filter(function (s) { return s.id === id; })[0]; }
    function save(src, patch) { Object.keys(patch).forEach(function (k) { src[k] = patch[k]; }); TV.data.updateSource(src.id, patch); }
    function parse(r) {
        if (r.status === 401 || r.status === 403) { var e = new Error("auth"); e.auth = true; throw e; }
        if (r.status < 200 || r.status >= 300) throw new Error("HTTP " + r.status);
        try { return JSON.parse(r.text); } catch (x) { throw new Error("bad JSON"); }
    }
    /* An addon's answer, through the helper when the screen refuses to read it directly */
    function getJSON(url, timeout) {
        return TV.http(url, { headers: { "Accept": "application/json" }, timeout: timeout || 20000 }).then(function (r) {
            if (r.status === 0 && TV.helper && TV.helper.sget) return TV.helper.sget(url, { accept: "application/json" }, timeout || 20000).then(function (t) { return { status: 200, text: t }; });
            return r;
        }).then(parse);
    }
    /* Stremio's own API (your account): a JSON POST, its answer in "result" */
    function api(method, body) {
        return TV.http(API + method, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), timeout: 25000 }).then(parse).then(function (j) {
            if (j && j.error) { var e = new Error(j.error.message || "Stremio"); if (j.error.code === 1 || /session|auth/i.test(j.error.message || "")) e.auth = true; throw e; }
            return j ? j.result : null;
        });
    }

    /* ---------- linking the screen: a code typed on link.stremio.com ---------- */
    function linkCreate() {
        return TV.http(LINK + "create?type=Create", { timeout: 15000 }).then(parse).then(function (j) {
            var r = j && j.result;
            if (!r || !r.code) throw new Error(T("Stremio does not answer right now ({e}).", { e: (j && j.error && j.error.message) || "no code" }));
            return { code: r.code, link: r.link || ("https://link.stremio.com/" + r.code) };
        });
    }
    /* The account's key once the code was typed, or "" */
    function linkRead(code) {
        return TV.http(LINK + "read?type=Read&code=" + encodeURIComponent(code), { timeout: 10000 }).then(parse).then(function (j) {
            return (j && j.result && j.result.authKey) || "";
        });
    }
    function user(authKey) {
        return api("getUser", { type: "GetUser", authKey: authKey }).then(function (u) { return u || {}; }, function () { return {}; });
    }

    /* ---------- the addons of the account ---------- */
    function baseOf(transportUrl) { return String(transportUrl || "").replace(/\/manifest\.json(\?.*)?$/i, "").replace(/\/+$/, ""); }
    /* What APL TV keeps of a manifest: what it offers, for which types and ids, and its catalogs */
    function slim(m) {
        m = m || {};
        return { id: m.id || "", name: m.name || "", types: m.types || [], idPrefixes: m.idPrefixes || null,
                 resources: (m.resources || []).map(function (r) { return typeof r === "string" ? r : { name: r.name, types: r.types || null, idPrefixes: r.idPrefixes || null }; }),
                 catalogs: (m.catalogs || []).map(function (c) {
                     var req = (c.extra || []).some(function (e) { return e.isRequired && e.name !== "search"; }) || (c.extraRequired || []).filter(function (x) { return x !== "search"; }).length > 0;
                     var only = ((c.extra || []).some(function (e) { return e.isRequired && e.name === "search"; }) || (c.extraRequired || []).indexOf("search") >= 0);
                     var g = (c.extra || []).filter(function (e) { return e.name === "genre"; })[0], other = (c.extra || []).some(function (e) { return e.isRequired && e.name !== "genre" && e.name !== "search"; }) || (c.extraRequired || []).some(function (x) { return x !== "genre" && x !== "search"; });
                     return { type: c.type, id: c.id, name: c.name || "", req: req || only, search: (c.extra || []).some(function (e) { return e.name === "search"; }) || (c.extraSupported || []).indexOf("search") >= 0,
                              opts: g && g.options ? g.options.slice(0, 200).map(String) : (c.genres || []).slice(0, 200).map(String), optReq: !!(g && g.isRequired) || (c.extraRequired || []).indexOf("genre") >= 0,
                              browse: !other && !only };
                 }), description: String(m.description || "").slice(0, 300), logo: m.logo || "", version: m.version || "",
                 configurable: configurable(m) };
    }
    function addons(src) {
        return api("addonCollectionGet", { type: "AddonCollectionGet", authKey: src.authKey, update: true }).then(function (r) {
            var list = ((r && r.addons) || []).filter(function (a) { return a && a.transportUrl && /^https?:/i.test(a.transportUrl); }).map(function (a) {
                return { url: baseOf(a.transportUrl), m: slim(a.manifest), locked: !!(a.flags && a.flags.protected), official: !!(a.flags && a.flags.official) };
            });
            save(src, { addons: list });
            return list;
        });
    }
    /* Does this addon give that resource (stream, meta…) for this type and id */
    function gives(a, res, type, id) {
        var m = a.m || {};
        return (m.resources || []).some(function (r) {
            var name = typeof r === "string" ? r : r.name;
            if (name !== res) return false;
            var types = (typeof r === "object" && r.types) || m.types || [], pre = (typeof r === "object" && r.idPrefixes) || m.idPrefixes;
            if (types.length && types.indexOf(type) < 0) return false;
            return !pre || !pre.length || !id || pre.some(function (p) { return String(id).indexOf(p) === 0; });
        });
    }
    function pathId(id) { return encodeURIComponent(id).replace(/%3A/gi, ":"); }


    /* ---------- your addons, managed from APL TV (no need for Stremio's app) ----------
       Stremio keeps the addons of your account as one list (its order is the order of the streams): APL TV asks for
       the whole list again before each change and sends it back whole, so every Stremio app sees the same. */
    function collection(src) {
        return api("addonCollectionGet", { type: "AddonCollectionGet", authKey: src.authKey, update: true }).then(function (r) { return (r && r.addons) || []; });
    }
    function setCollection(src, list) {
        return api("addonCollectionSet", { type: "AddonCollectionSet", authKey: src.authKey, addons: list }).then(function () { return addons(src); });
    }
    /* The address of an addon however it was copied: its stremio:// install link, its configure page, its manifest */
    function addonUrl(u) {
        u = String(u || "").trim().replace(/^stremio:\/\//i, "https://");
        if (!/^https?:\/\//i.test(u)) return "";
        u = u.replace(/[?#].*$/, "").replace(/\/configure\/?$/i, "").replace(/\/+$/, "");
        return /\/manifest\.json$/i.test(u) ? u : u + "/manifest.json";
    }
    function isAddonUrl(u) { u = String(u || "").trim(); return /^stremio:\/\//i.test(u) || /\/manifest\.json(\?.*)?$/i.test(u); }
    /* Adds an addon to your account (or replaces it: the same addon configured again) */
    function install(src, url) {
        var u = addonUrl(url);
        if (!u) return Promise.reject(new Error(T("This is not the address of a Stremio addon.")));
        return getJSON(u, 20000).then(function (m) {
            if (!m || !m.id || !m.name || !m.resources) throw new Error(T("This is not the address of a Stremio addon."));
            return collection(src).then(function (list) {
                var d = { transportUrl: u, transportName: "http", manifest: m, flags: {} }, at = -1;
                list.forEach(function (a, i) { if (a.transportUrl === u || (a.manifest && a.manifest.id === m.id)) at = i; });
                if (at >= 0) { d.flags = list[at].flags || {}; list[at] = d; } else list.push(d);
                return setCollection(src, list).then(function () { return { name: m.name, replaced: at >= 0 }; });
            });
        }, function (e) { if (/bad JSON|HTTP/.test(e.message)) throw new Error(T("This is not the address of a Stremio addon.")); throw e; });
    }
    function remove(src, url) {
        return collection(src).then(function (list) {
            var a = list.filter(function (x) { return baseOf(x.transportUrl) === url; })[0];
            if (!a) return addons(src);
            if (a.flags && a.flags.protected) throw new Error(T("Stremio keeps this addon: it cannot be removed."));
            return setCollection(src, list.filter(function (x) { return x !== a; }));
        });
    }
    /* Up or down in the list: the streams of the addons higher up come first */
    function move(src, url, d) {
        return collection(src).then(function (list) {
            var i = -1;
            list.forEach(function (x, n) { if (baseOf(x.transportUrl) === url) i = n; });
            var j = i + d;
            if (i < 0 || j < 0 || j >= list.length) return addons(src);
            var t = list[i]; list[i] = list[j]; list[j] = t;
            return setCollection(src, list);
        });
    }
    /* Stremio's own catalog of addons, as its app shows it: the official ones, then the community's */
    var store = null;
    function catalog() {
        if (store && Date.now() - store.at < 3600000) return Promise.resolve(store.list);
        function one(file, official) {
            return getJSON((TEST ? TEST + "/store/" : "https://api.strem.io/") + file, 20000).then(function (l) {
                return (l || []).filter(function (a) { return a && a.transportUrl && a.manifest && /^https?:/i.test(a.transportUrl); })
                    .map(function (a) { return { url: baseOf(a.transportUrl), m: a.manifest, official: official }; });
            }, function () { return []; });
        }
        return Promise.all([one("addonsofficialcollection.json", true), one("addonscollection.json", false)]).then(function (r) {
            var seen = {}, list = r[0].concat(r[1]).filter(function (a) { if (seen[a.url]) return false; seen[a.url] = 1; return true; });
            if (!list.length) throw new Error(T("Stremio's catalog of addons does not answer right now."));
            store = { at: Date.now(), list: list };
            return list;
        });
    }
    /* What an addon gives: Catalogs, Streams, Subtitles */
    function kinds(m) {
        var names = (m.resources || []).map(function (r) { return typeof r === "string" ? r : r.name; }), out = [];
        if (names.indexOf("catalog") >= 0) out.push(T("Catalogs"));
        if (names.indexOf("stream") >= 0) out.push(T("Streams"));
        if (names.indexOf("subtitles") >= 0) out.push(T("Subtitles"));
        if (!out.length && names.indexOf("meta") >= 0) out.push(T("Details"));
        return out;
    }
    function configurable(m) { var h = (m && m.behaviorHints) || {}; return !!(h.configurable || h.configurationRequired); }
    function configureUrl(url) { return url.replace(/\/manifest\.json$/i, "") + "/configure"; }


    /* ---------- does a title play through your addons? ----------
       A title of a TMDB list (Trending, a genre, More Like This, an actor's films…) that your playlist doesn't have is shown
       only when one of your addons has a stream for it that plays here (a direct link, or a torrent with a streaming
       server). Asked in the background, two at a time, and kept: 3 days when it plays, 1 day when not. */
    var has = TV.load("stremioHas", {}) || {}, imdbs = TV.load("stremioImdb", {}) || {}, hasQueue = [], hasWaiting = {}, hasRunning = 0, hasListeners = [];
    var HAS_OK = 3 * 86400000, HAS_NO = 86400000;
    if ((TV.load("stremioHasV", 0) || 0) < 2) { has = {}; TV.save("stremioHas", has); TV.save("stremioHasV", 2); }
    var keepSoon = TV.debounce(function () {
        var k = Object.keys(has);
        if (k.length > 6000) k.sort(function (x, y) { return has[x][1] - has[y][1]; }).slice(0, k.length - 6000).forEach(function (x) { delete has[x]; });
        var i = Object.keys(imdbs);
        if (i.length > 8000) i.slice(0, i.length - 8000).forEach(function (x) { delete imdbs[x]; });
        TV.save("stremioHas", has); TV.save("stremioImdb", imdbs);
    }, 3000);
    function hk(type, tmdbId) { return (type === "series" ? "s" : "m") + tmdbId; }
    /* A TMDB title's IMDb id (TMDB's external ids, kept) */
    function imdbOf(type, tmdbId) {
        var k = hk(type, tmdbId);
        if (imdbs[k]) return Promise.resolve(imdbs[k]);
        if (!TV.meta || !TV.meta.enabled()) return Promise.resolve("");
        return TV.meta.imdbIdOf(type, tmdbId).then(function (id) {
            if (id) { imdbs[k] = id; keepSoon(); }
            return id;
        });
    }
    /* true / false when known lately, null when not asked yet */
    function knownHas(type, tmdbId) {
        var e = has[hk(type, tmdbId)];
        if (!e || Date.now() - e[1] > (e[0] ? HAS_OK : HAS_NO)) return null;
        return !!e[0];
    }
    /* Asks the addons, in their order, until one gives a stream that plays here (a series: its first episode) */
    function checkHas(type, tmdbId, imdbKnown) {
        var a = account();
        if (!a) return Promise.resolve(false);
        return engine(false).then(function () { return imdbKnown ? imdbKnown : imdbOf(type, tmdbId); }).then(function (imdb) {
            if (!imdb) return false;
            var id = type === "series" ? imdb + ":1:1" : imdb, list = (a.addons || []).filter(function (x) { return gives(x, "stream", type, id); }), i = 0;
            function next() {
                if (i >= list.length) return Promise.resolve(false);
                var ad = list[i++];
                return getJSON(ad.url + "/stream/" + type + "/" + pathId(id) + ".json", 15000).then(function (r) {
                    return ((r && r.streams) || []).some(function (st) { return !!linkOf(a, st); }) || next();
                }, next);
            }
            return next();
        }).then(function (v) { has[hk(type, tmdbId)] = [v ? 1 : 0, Date.now()]; keepSoon(); return v; }, function () { return false; });
    }
    function pumpHas() {
        while (hasRunning < 2 && hasQueue.length) {
            var j = hasQueue.shift();
            hasRunning++;
            (function (j) {
                checkHas(j.type, j.id, j.imdb).then(function (v) {
                    hasRunning--;
                    var cbs = hasWaiting[j.k] || []; delete hasWaiting[j.k];
                    cbs.forEach(function (cb) { try { cb(v); } catch (e) {} });
                    if (v) told();
                    pumpHas();
                });
            })(j);
        }
    }
    /* Ask in the background (once); cb(true|false) when known. first: before the others (what is on the screen) */
    function wantHas(type, tmdbId, cb, first, imdb) {
        var k = hk(type, tmdbId), v = knownHas(type, tmdbId);
        if (v !== null) { if (cb) cb(v); return; }
        if (!account()) { if (cb) cb(false); return; }
        if (hasWaiting[k]) { if (cb) hasWaiting[k].push(cb); return; }
        hasWaiting[k] = cb ? [cb] : [];
        var job = { k: k, type: type === "series" ? "series" : "movie", id: tmdbId, imdb: imdb || "" };
        if (first) hasQueue.unshift(job); else hasQueue.push(job);
        pumpHas();
    }
    /* New titles that play: the lists are made again (at most every 5 s) */
    var told = TV.debounce(function () { hasListeners.forEach(function (f) { try { f(); } catch (e) {} }); }, 5000);
    function onHas(f) { hasListeners.push(f); }
    /* A title of an addon's catalog (a search result), known by its IMDb id: does it play? */
    function wantHasImdb(type, imdb, cb) { wantHas(type, "i" + imdb, cb, true, imdb); }

    /* ---------- searching in your addons ----------
       Any title, not only the ones of the catalogs APL TV loaded: the addons' catalogs that search (Cinemeta's
       Popular does). Movies and series, 20 of each at most, the ones APL TV has already left out. */
    function search(q, known) {
        q = String(q || "").trim();
        var srcs = TV.data.sources().filter(function (s) { return s.type === "stremio" && s.authKey && s.addons; });
        if (q.length < 2 || !srcs.length) return Promise.resolve({ movies: [], series: [] });
        var src = srcs[0], jobs = [];
        (src.addons || []).forEach(function (a) {
            (a.m.catalogs || []).forEach(function (c) { if (c.search && (c.type === "movie" || c.type === "series")) jobs.push({ a: a, c: c }); });
        });
        // a catalog of each type is enough (the first, often Cinemeta's)
        var pick = [jobs.filter(function (j) { return j.c.type === "movie"; })[0], jobs.filter(function (j) { return j.c.type === "series"; })[0]].filter(Boolean);
        return Promise.all(pick.map(function (j) {
            return getJSON(j.a.url + "/catalog/" + j.c.type + "/" + pathId(j.c.id) + "/search=" + encodeURIComponent(q) + ".json", 12000).then(function (r) {
                return ((r && r.metas) || []).slice(0, 20).map(function (m) { return itemOf(src, m, j.c.type === "series" ? "series" : "movie", src.id + ":search", 0); })
                    .filter(function (it) { return !known || !known[it.id]; });
            }, function () { return []; });
        })).then(function (r) {
            var out = { movies: [], series: [] };
            r.forEach(function (l) { l.forEach(function (it) { (it.kind === "series" ? out.series : out.movies).push(it); }); });
            return out;
        });
    }

    /* ---------- the catalog ---------- */
    function yearOf(m) { var y = String(m.releaseInfo || m.year || m.released || "").match(/(18|19|20)\d\d/); return y ? +y[0] : 0; }
    /* A title of an addon's catalog (or of a search) in APL TV's catalog shape */
    function itemOf(src, m, k, catId, added) {
        var it = { src: src.id, name: m.name, year: yearOf(m), poster: m.poster || "", backdrop: m.background || undefined, cat: catId,
                   rating: parseFloat(m.imdbRating) || 0, added: added || 0, plot: TV.lang === "en" ? m.description || "" : "" };       // Cinemeta's plots are in English: TMDB's in your language otherwise
        if (k === "series") { it.id = src.id + "|s" + m.id; it.seriesId = m.id; it.kind = "series"; }
        else { it.id = src.id + "|m" + m.id; it.sid = m.id; it.kind = "movie"; it.url = "stremio:" + src.id + ":movie:" + encodeURIComponent(m.id); }
        return it;
    }
    /* The account itself: its addons (no catalog: Stremio's is unlimited; a title shows when your playlist has it, or
       when your addons have a stream for it, js/data.js findTitles) */
    function load(src, progress, out) {
        progress(T("Connecting to {name}…", { name: "Stremio" }));
        return addons(src).then(function () {
            out.account = { server: src.email || "Stremio", kind: "stremio" };
            return out;
        }).catch(function (e) {
            if (e.auth) { save(src, { refused: true }); throw new Error(T("Stremio refused the access. Link the screen again.")); }
            throw e;
        });
    }

    /* ---------- a series' episodes, and a movie's page ---------- */
    function metaOf(src, type, id) {
        var list = (src.addons || []).filter(function (a) { return gives(a, "meta", type, id); });
        if (!list.length) list = [{ url: CINEMETA }];
        var i = 0;
        function next() {
            if (i >= list.length) return Promise.resolve(null);
            var a = list[i++];
            return getJSON(a.url + "/meta/" + type + "/" + pathId(id) + ".json", 20000).then(function (r) { return (r && r.meta) || next(); }, next);
        }
        return next();
    }
    function seriesInfo(src, item) {
        var sid = String(item.seriesId || "");
        if (/^tmdb:/.test(sid)) return imdbOf("series", sid.slice(5)).then(function (imdb) {
            if (!imdb) throw new Error(T("No episodes for this series in your Stremio addons."));
            return seriesInfo(src, { seriesId: imdb, plot: item.plot, id: item.id });
        });
        return metaOf(src, "series", item.seriesId).then(function (m) {
            var seasons = {};
            ((m && m.videos) || []).forEach(function (v) {
                if (!v || !v.id) return;
                var s = v.season !== undefined && v.season !== null ? +v.season : 1, e = +(v.episode || v.number || 0);
                (seasons[s] = seasons[s] || []).push({ id: v.id, season: s, episode: e, title: v.title || v.name || "", url: "stremio:" + src.id + ":series:" + encodeURIComponent(v.id),
                    image: v.thumbnail || "", plot: v.overview || v.description || "" });
            });
            Object.keys(seasons).forEach(function (s) { seasons[s].sort(function (a, b) { return a.episode - b.episode; }); });
            if (!Object.keys(seasons).length) throw new Error(T("No episodes for this series in your Stremio addons."));
            return { seasons: seasons, info: { plot: (m && m.description) || item.plot || "", tmdb: "" } };
        });
    }
    function info(item) {
        var src = src0(item.src);
        function d(m) {
            var mins = m && String(m.runtime || "").match(/(\d+)/);
            return { info: { plot: (m && m.description) || item.plot || "", tmdb_id: "", duration_secs: mins ? +mins[1] * 60 : 0,
                             backdrop_path: (m && m.background) ? [m.background] : item.backdrop ? [item.backdrop] : [] } };
        }
        if (!src || item.plot || TV.lang !== "en") return Promise.resolve(d(null));
        return Promise.race([metaOf(src, "movie", item.sid), new Promise(function (r) { setTimeout(function () { r(null); }, 4000); })]).then(d, function () { return d(null); });
    }

    /* ---------- the streams, just before playing ---------- */
    /* ---------- the TV's own torrent engine: the Stremio app's ----------
       Stremio's app for Samsung TVs brings its streaming server as a service of its own (IkWsFHtOY9.StremioService,
       port 11470 of the TV): the torrent engine Stremio plays with. When it is installed, APL TV starts it in the
       background and plays the torrents of your addons through it, like Stremio does: no computer, no debrid service. */
    var ENGINE_ID = "IkWsFHtOY9.StremioService", engineUp = false, engineAt = 0, engineStarting = null;
    /* The engine by the TV's own network address: the TV keeps one app from another's 127.0.0.1 (EHOSTUNREACH) */
    function localBase() {
        var ip = "";
        try { ip = global.webapis && global.webapis.network && global.webapis.network.getIp(); } catch (e) {}
        return "http://" + (ip || "127.0.0.1") + ":11470";
    }
    function isLocalLink(u) { return /^http:\/\/[^\/]+:11470\//.test(String(u || "")); }
    /* The engine answers only Stremio's own pages: the screen keeps its answer from APL TV, so the helper service asks
       (the player plays its links itself, that is not concerned) */
    function pingEngine() {
        return TV.http(localBase() + "/settings", { timeout: 2500 }).then(function (r) { return r.status === 200; }, function () { return false; }).then(function (ok) {
            if (ok || !TV.helper || !TV.helper.sget) return ok;
            return TV.helper.sget(localBase() + "/settings", {}, 3000).then(function () { return true; }, function () { return false; });
        });
    }
    /* start: false asks only whether it runs (the background checks of the lists never open Stremio) */
    function engine(start) {
        if (!TV.TIZEN || !global.tizen || !stremioInstalled()) return Promise.resolve(false);
        if (start === false) return engineUp && Date.now() - engineAt < 60000 ? Promise.resolve(true) : pingEngine().then(function (ok) { if (ok) { engineUp = true; engineAt = Date.now(); } return ok; });
        if (engineUp && Date.now() - engineAt < 60000) return Promise.resolve(true);
        if (engineStarting) return engineStarting;
        engineStarting = pingEngine().then(function (ok) {
            if (ok) return true;
            return new Promise(function (res) {
                // the TV lets an app start only its own services: through Vetro (a screen's root agent), silent
                var Tz = global.tizen;
                // otherwise APL TV's own service opens Stremio's app for a moment (its engine starts) and comes back
                function service() {
                    if (!TV.helper || !TV.helper.stremioEngine) { res(false); return; }
                    TV.helper.stremioEngine().then(function (r) { res(!!(r && r.ok)); }, function () { res(false); });
                }
                function vetro() {
                    var ip = ""; try { ip = global.webapis.network.getIp(); } catch (e) {}
                    if (!ip) { service(); return; }
                    TV.http("http://" + ip + ":8099/exec", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cmd: "app_launcher -s " + ENGINE_ID }), timeout: 8000 })
                        .then(function (r) { if (r.status === 200) res(true); else service(); }, service);
                }
                try { Tz.application.launchAppControl(new Tz.ApplicationControl("http://tizen.org/appcontrol/operation/service"), ENGINE_ID, function () { res(true); }, vetro); }
                catch (e) { vetro(); }
            }).then(function (launched) {
                if (!launched) return false;
                var until = Date.now() + 12000;
                return (function wait() {
                    return pingEngine().then(function (up) { if (up || Date.now() > until) return up; return new Promise(function (r) { setTimeout(r, 500); }).then(wait); });
                })();
            });
        }).then(function (ok) {
            if (ok && !engineUp) {
                TV.log("stremio: the TV's Stremio engine is ready");
                // torrents play now: the titles found "not playable" before are asked again, the streams too
                Object.keys(has).forEach(function (k) { if (!has[k][0]) delete has[k]; });
                cache = {};
                keepSoon(); told();
            }
            engineUp = ok; engineAt = Date.now(); engineStarting = null;
            return ok;
        }, function () { engineStarting = null; return false; });
        return engineStarting;
    }
    function engineReady() { return engineUp; }
    /* Stremio's app is on this TV (its engine can be started by opening it once) */
    var installedAt = 0, installed = false;
    function stremioInstalled() {
        if (Date.now() - installedAt < 60000) return installed;
        installedAt = Date.now();
        try { installed = !!(TV.TIZEN && global.tizen && global.tizen.application.getAppInfo("IkWsFHtOY9.Stremio")); } catch (e) { installed = false; }
        return installed;
    }
    /* Opens Stremio: it starts its torrent engine, which stays ready until the TV is switched off */
    function openStremio() {
        try { global.tizen.application.launch("IkWsFHtOY9.Stremio", function () { engineAt = 0; }, function (e) { TV.toast(e.message); }); } catch (e) { TV.toast(e.message); }
    }
    function serverOf(src) {
        var s = String(src.server || "").trim().replace(/\/+$/, "");
        if (s && !/^https?:\/\//i.test(s)) s = "http://" + s;
        // Stremio's app on this TV: its torrents are versions like any other, its engine is started when one plays
        return s || (engineUp || stremioInstalled() ? localBase() : "");
    }
    /* The link the screen plays for a stream, or "" when it cannot play it */
    function linkOf(src, s) {
        var srv = serverOf(src), h = s.behaviorHints || {};
        if (s.url && /^https?:\/\//i.test(s.url)) {
            var px = h.proxyHeaders && h.proxyHeaders.request;
            if (!px || !Object.keys(px).length) return s.url;
            if (!srv) return "";
            // headers the screen cannot send itself: through the Stremio server, as Stremio does
            var m = s.url.match(/^(https?:\/\/[^\/]+)(\/[^?]*)?(\?.*)?$/), q = "d=" + encodeURIComponent(m[1]);
            Object.keys(px).forEach(function (k) { q += "&h=" + encodeURIComponent(k + ":" + px[k]); });
            return srv + "/proxy/" + q + "/" + String(m[2] || "/").replace(/^\//, "") + (m[3] || "");
        }
        if (s.infoHash && srv) {
            var tr = (s.sources || []).filter(function (x) { return /^(tracker|dht):/.test(x); }).map(function (x) { return "tr=" + encodeURIComponent(x); });
            return srv + "/" + String(s.infoHash).toLowerCase() + "/" + (s.fileIdx !== undefined && s.fileIdx !== null ? s.fileIdx : -1) + (tr.length ? "?" + tr.join("&") : "");
        }
        return "";
    }
    function streams(src, type, id, onPart) {
        var list = (src.addons || []).filter(function (a) { return gives(a, "stream", type, id); }), got = list.map(function () { return []; });
        function sortOut(all) {
            var out = [], others = [];
            all.forEach(function (l) { l.forEach(function (x) { x.link = linkOf(src, x.s); if (x.link) out.push(x); else if (x.s.infoHash) { x.why = "torrent"; others.push(x); } else if (x.s.url && /^https?:/i.test(x.s.url)) { x.why = "headers"; others.push(x); } }); });
            out.sort(function (a, b) { return a.order - b.order; });
            return { playable: out, others: others, any: all.some(function (l) { return l.length; }) };
        }
        return Promise.all(list.map(function (a, n) {
            return getJSON(a.url + "/stream/" + type + "/" + pathId(id) + ".json", 15000).then(function (r) {
                got[n] = ((r && r.streams) || []).map(function (s, i) { return { s: s, addon: a.m.name || "", order: n * 1000 + i }; });
                if (onPart) { try { onPart(sortOut(got)); } catch (e) {} }
                return got[n];
            }, function (e) { TV.log("stremio streams " + (a.m.name || a.url) + ": " + e.message); return []; });
        })).then(function (all) {
            // others: what an addon gives that the screen cannot play by itself (a torrent, a link needing headers)
            // without a streaming server; shown too, so you see what each addon has
            var out = [], others = [];
            all.forEach(function (l, n) {
                var ok = 0, tor = 0;
                l.forEach(function (x) {
                    x.link = linkOf(src, x.s);
                    if (x.link) { out.push(x); ok++; return; }
                    if (x.s.infoHash) { x.why = "torrent"; tor++; others.push(x); }
                    else if (x.s.url && /^https?:/i.test(x.s.url)) { x.why = "headers"; others.push(x); }
                });
                // what each addon gave (names and counts only: no address, no key)
                TV.log("stremio " + (list[n].m.name || "addon") + ": " + l.length + " streams, " + ok + " play here" + (tor ? ", " + tor + " torrents" : ""));
            });
            out.sort(function (a, b) { return a.order - b.order; });
            return { playable: out, others: others, any: all.some(function (l) { return l.length; }) };
        });
    }
    /* ---------- the streams as versions ----------
       Each stream your addons find for a title is one of its versions, like the copies of a movie in two playlists:
       its quality, its languages, its size and where it comes from. Play takes the best one for you (your language
       first, then 1080p, a link that plays at once before a torrent); Versions on the title's page lets you choose
       another, kept for that title. A series keeps the same kind for its next episodes (Stremio's bingeGroup). */
    var LANGS = {
        fr: { strong: /\b(true ?french|vff|vfq|vfi|vf2|vf|french|fran[cç]ais)\b|🇫🇷/i, weak: /\bvostfr\b|\bmulti\b/i },
        // MULTI is French and English on the French sites: a weak hint for French only
        es: { strong: /\b(castellano|espa[nñ]ol|spanish|esp)\b|🇪🇸/i, weak: /\blatino\b|🇲🇽/i },
        pl: { strong: /\b(polish|polski|lektor|dubbing ?pl|pl)\b|🇵🇱/i, weak: /napisy/i },
        en: { strong: /\b(english|eng)\b|🇬🇧|🇺🇸/i, weak: /\bmulti\b/i }
    };
    function textOf(x) { var s = x.s; return [s.name, s.title, s.description, (s.behaviorHints || {}).filename].filter(Boolean).join(" \n "); }
    function qualityOf(t) { var m = t.match(/\b(2160p|4k|uhd|1440p|1080p|720p|576p|480p|360p)\b/i); if (!m) return ""; var q = m[1].toLowerCase(); return q === "4k" || q === "uhd" ? "2160p" : q; }
    /* "🇫🇷" -> "FR", "🇬🇧" -> "EN": the TV's fonts often have no flags */
    function flags(t) {
        var out = [], re = /([\uD83C][\uDDE6-\uDDFF])([\uD83C][\uDDE6-\uDDFF])/g, m;
        while ((m = re.exec(t))) {
            var a = String.fromCharCode(65 + m[1].charCodeAt(1) - 0xDDE6), b = String.fromCharCode(65 + m[2].charCodeAt(1) - 0xDDE6), c = a + b;
            c = c === "GB" || c === "US" ? "EN" : c === "MX" ? "LAT" : c;
            if (out.indexOf(c) < 0) out.push(c);
        }
        return out;
    }
    /* The words of the release first (MULTI, VFF…), then the flags it shows */
    function languagesOf(t) {
        var out = [];
        [["MULTI", /\bmulti\b/i], ["VFF", /\b(true ?french|vff)\b/i], ["VF", /\b(vfq|vfi|vf2|vf|french)\b/i], ["VOSTFR", /\bvostfr\b/i], ["ES", /\b(castellano|spanish|espa[nñ]ol)\b/i],
         ["LAT", /\blatino\b/i], ["PL", /\b(polish|polski|lektor)\b/i]].forEach(function (l) { if (l[1].test(t)) out.push(l[0]); });
        if (out.indexOf("VFF") >= 0) out = out.filter(function (x) { return x !== "VF"; });
        var fr = out.indexOf("VFF") >= 0 || out.indexOf("VF") >= 0;
        flags(t).forEach(function (c) { if (out.indexOf(c) < 0 && !(fr && c === "FR")) out.push(c); });
        return out;
    }
    function sizeOf(t) { var m = t.match(/(\d+(?:[.,]\d+)?)\s*(GB|GiB|MB|MiB|Go|Mo)\b/i); return m ? m[1].replace(",", ".") + " " + m[2].replace(/i?B$/i, "B").replace(/^G.*/i, "GB").replace(/^M.*/i, "MB") : ""; }
    function gigs(t) { var z = sizeOf(t), n = parseFloat(z); return !z ? 0 : /MB/.test(z) ? n / 1024 : n; }
    function score(x) {
        var t = textOf(x), L = LANGS[TV.lang] || LANGS.en, q = qualityOf(t), n = 0;
        if (L.strong.test(t)) n += 30; else if (L.weak.test(t)) n += TV.lang === "en" ? 5 : 15;
        n += { "1080p": 15, "2160p": 11, "1440p": 12, "720p": 8, "576p": 3, "480p": 2, "360p": 0 }[q] || 4;
        if (x.s.url && !(x.s.behaviorHints || {}).proxyHeaders) n += 20;                    // plays at once (a debrid service's cached link…)
        if (/\b(download|uncached|not cached)\b|⏳/i.test(String(x.s.name || "") + " " + String(x.s.title || ""))) n -= 25;    // the service has to fetch it first
        if (/\bav1\b/i.test(t)) n -= 6;                                                     // many TVs cannot decode it
        if (/\b(cam|camrip|hdcam|ts|telesync|hdts)\b/i.test(t)) n -= 20;
        var g = gigs(t); if (g > 25) n -= 6; else if (g > 15) n -= 2;
        // a torrent: more seeders, a faster start (Torrentio's 👤 count)
        if (x.s.infoHash && !x.s.url) { var sd = t.match(/👤\s*(\d+)/); n += sd ? Math.min(10, Math.round(Math.log(+sd[1] + 1) / Math.LN2)) : 0; if (sd && +sd[1] < 3) n -= 8; }
        return n;
    }
    function describe(x) {
        var t = textOf(x), bits = [], q = qualityOf(t), l = languagesOf(t), z = sizeOf(t);
        if (q) bits.push(q === "2160p" ? "4K" : q);
        if (/\b(dolby ?vision|dovi|dv)\b/i.test(t)) bits.push("DV"); else if (/\bhdr(10\+?)?\b/i.test(t)) bits.push("HDR");
        if (l.length) bits.push(l.slice(0, 4).join(" "));
        if (z) bits.push(z);
        var from = String(x.s.name || x.addon || "").replace(/\s*\n\s*/g, " ").replace(/\b(2160p|4k|uhd|1080p|720p|480p)\b/ig, "").replace(/\s{2,}/g, " ").trim();
        if (x.s.infoHash && !x.s.url) from = (from ? from + " " : "") + "(torrent)";
        bits.push(from || x.addon || "Stremio");
        return bits.join(" · ");
    }
    var picks = TV.load("stremioPicks", {}) || {}, chosen = {}, cache = {};
    function remember(key, x) {
        var k = Object.keys(picks);
        if (k.length > 200) delete picks[k[0]];
        picks[key] = { g: (x.s.behaviorHints || {}).bingeGroup || "", a: x.addon, n: String(x.s.name || "") };
        TV.save("stremioPicks", picks);
    }
    function parseUrl(url) {
        var m = String(url).match(/^stremio:([^:]+):(movie|series):(.+)$/);
        if (!m) return null;
        return { src: src0(m[1]), type: m[2], id: decodeURIComponent(m[3]) };
    }
    /* A title's versions, the best first (asked again after 10 minutes: a debrid link does not last) */
    function finish(r, type, id, src) {
        r.playable.forEach(function (x) { x.score = score(x); x.label = describe(x); });
        r.playable.sort(function (a, b) { return b.score - a.score || a.order - b.order; });
        (r.others || []).forEach(function (x) { x.score = score(x); x.label = describe(x); });
        (r.others || []).sort(function (a, b) { return b.score - a.score || a.order - b.order; });
        r.showKey = type === "series" ? id.split(":")[0] : "";
        r.noServer = !serverOf(src);
        return r;
    }
    /* onPart(r): the versions so far, as each addon answers (the title's page fills its Versions as they come) */
    function versions(url, onPart) {
        var u = parseUrl(url);
        if (!u) return Promise.reject(new Error("bad Stremio address"));
        if (!u.src) return Promise.reject(new Error(T("This playlist is no longer there.")));
        // known by its TMDB id only: Stremio's addons want its IMDb id
        if (/^tmdb:/.test(u.id)) return imdbOf(u.type, u.id.slice(5)).then(function (imdb) {
            if (!imdb) return { playable: [], others: [], any: false, showKey: "", noServer: !serverOf(u.src) };
            return versions("stremio:" + u.src.id + ":" + u.type + ":" + encodeURIComponent(imdb), onPart);
        });
        var c = cache[url];
        if (c && Date.now() - c.at < 600000) return Promise.resolve(c.r);
        return engine(false).then(function () { return streams(u.src, u.type, u.id, onPart ? function (p) { onPart(finish(p, u.type, u.id, u.src)); } : null); }).then(function (r) {
            finish(r, u.type, u.id, u.src);
            cache[url] = { at: Date.now(), r: r };
            return r;
        });
    }
    /* The version chosen on the title's page: played now, and next time for this title */
    function choose(url, x) {
        chosen[url] = x.link;
        var r = cache[url] && cache[url].r;
        if (r && r.showKey) remember(r.showKey, x);
        else { picks["t:" + url] = { g: (x.s.behaviorHints || {}).bingeGroup || "", a: x.addon, n: String(x.s.name || "") }; TV.save("stremioPicks", picks); }
    }
    function chosenOf(url) { return chosen[url] || ""; }
    /* Stremio for every title: the linked account, a title's Stremio address from its IMDb id (a movie "tt…", an episode
       "tt…:season:episode"), and whether a Stremio version was chosen for it (Play then takes it before the playlist's) */
    function account() { return TV.data.sources().filter(function (x) { return x.type === "stremio" && x.authKey && (x.addons || []).length; })[0] || null; }
    function urlFor(type, id) { var a = account(); return a && id ? "stremio:" + a.id + ":" + type + ":" + encodeURIComponent(id) : ""; }
    function prefers(url) { return !!url && !!(chosen[url] || picks["t:" + url]); }
    function isPick(url, x) {
        if (chosen[url]) return chosen[url] === x.link;
        var p = picks["t:" + url];
        return !!p && ((p.g && (x.s.behaviorHints || {}).bingeGroup === p.g) || (x.addon === p.a && String(x.s.name || "") === p.n));
    }
    /* Back to the playlist's version for this title */
    function forget(url) { delete chosen[url]; if (picks["t:" + url]) { delete picks["t:" + url]; TV.save("stremioPicks", picks); } }
    /* A series' episodes as Stremio knows them (Cinemeta's), for the ones your playlist misses */
    function episodes(imdb) {
        var a = account();
        if (!a || !imdb) return Promise.resolve([]);
        return metaOf(a, "series", imdb).then(function (m) {
            return ((m && m.videos) || []).filter(function (v) { return v && v.id && v.season !== undefined && v.season !== null && +v.season > 0; }).map(function (v) {
                return { id: "st:" + v.id, season: +v.season, episode: +(v.episode || v.number || 0), title: v.title || v.name || "", url: "stremio:" + a.id + ":series:" + encodeURIComponent(v.id),
                         image: v.thumbnail || "", plot: v.overview || v.description || "", released: v.released || "" };
            });
        }, function () { return []; });
    }
    function resolve(url) {
        if (chosen[url]) return isLocalLink(chosen[url]) ? engine().then(function () { return chosen[url]; }) : Promise.resolve(chosen[url]);
        var u = parseUrl(url);
        if (u && u.src && /^tmdb:/.test(u.id)) return imdbOf(u.type, u.id.slice(5)).then(function (imdb) {
            if (!imdb) throw new Error(T("Your Stremio addons found nothing that plays on a TV for this title."));
            return resolve("stremio:" + u.src.id + ":" + u.type + ":" + encodeURIComponent(imdb));
        });
        return versions(url).then(function (r) {
            var list = r.playable;
            if (!list.length) {
                throw new Error(r.any && r.noServer ? T("Your Stremio addons only found torrents. Set a Stremio streaming server in this playlist's settings to play them.")
                                                    : T("Your Stremio addons found nothing that plays on a TV for this title."));
            }
            // the kind chosen before for this series (its next episodes) or this movie, when it is there again
            var p = (r.showKey && picks[r.showKey]) || picks["t:" + url];
            var same = p && ((p.g && list.filter(function (x) { return (x.s.behaviorHints || {}).bingeGroup === p.g; })[0]) ||
                             list.filter(function (x) { return x.addon === p.a && String(x.s.name || "") === p.n; })[0]);
            var x = same || list[0];
            if (r.showKey && !p) remember(r.showKey, x);
            if (isLocalLink(x.link)) return engine().then(function () { TV.log("stremio: " + list.length + " versions, playing " + x.label); return x.link; });
            TV.log("stremio: " + list.length + " versions, playing " + x.label);
            return x.link;
        });
    }

    TV.stremio = { load: load, seriesInfo: seriesInfo, info: info, resolve: resolve, versions: versions, choose: choose, chosen: chosenOf,
                   link: { create: linkCreate, read: linkRead }, user: user, serverOf: serverOf, engine: engine, engineReady: engineReady, stremioInstalled: stremioInstalled, openStremio: openStremio,
                   addons: addons, install: install, remove: remove, move: move, catalog: catalog, kinds: kinds, configurable: configurable,
                   configureUrl: configureUrl, isAddonUrl: isAddonUrl, search: search,
                   account: account, urlFor: urlFor, prefers: prefers, isPick: isPick, forget: forget, episodes: episodes,
                   imdbOf: imdbOf, knownHas: knownHas, wantHas: wantHas, wantHasImdb: wantHasImdb, onHas: onHas };
})(window);
