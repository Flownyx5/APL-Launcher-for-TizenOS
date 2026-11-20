/* ============================================================
   data.js: your playlists, turned into one tidy catalog.
   Sources: M3U playlists, Xtream accounts, Stalker portals and media
   servers: Jellyfin, Emby, Plex (several allowed).
   An M3U address that is really an Xtream one (get.php?username=…)
   becomes an Xtream source: you get covers, plots and the TV guide.
   Catalog (kept in IndexedDB, refreshed every 6 hours in the background):
     live:   categories + channels (number, logo, guide id, quality,
             variants of one channel put together)
     movies: categories + movies (cover, year, rating, date added)
     series: categories + series (M3U episodes grouped into shows)
   Also here: favorites, "My List", recent channels, resume points.
   ============================================================ */
(function (global) {
    "use strict";

    var TV = global.TV, S = TV.smart, T = TV.t;
    var MAX_AGE = (TV.SMALL ? 24 : 6) * 3600 * 1000;    // a device with little memory: once a day (core.js TV.SMALL)
    var CATALOG_V = 2;          // raise it when smart.js reads names differently: catalogs are then refreshed

    /* ---------- sources ---------- */
    function sources() { return TV.load("sources", []) || []; }
    function saveSources(list) { TV.save("sources", list); }

    function normServer(s) {
        s = String(s || "").trim().replace(/\s+/g, "");
        if (!s) return "";
        if (!/^https?:\/\//i.test(s)) s = "http://" + s;
        s = s.replace(/\/(player_api\.php|get\.php|xmltv\.php|panel_api\.php|c\/?)(\?.*)?$/i, "").replace(/\/+$/, "");
        return s;
    }
    /* An M3U address from an Xtream panel: get.php?username=U&password=P */
    function xtreamFromUrl(url) {
        var m = String(url || "").match(/^(https?:\/\/[^\/?#]+(?:\/[^?#]*?)?)\/get\.php\?(.*)$/i);
        if (!m) return null;
        var q = {};
        m[2].split("&").forEach(function (kv) { var p = kv.split("="); q[decodeURIComponent(p[0] || "").toLowerCase()] = decodeURIComponent((p[1] || "").replace(/\+/g, " ")); });
        if (!q.username || !q.password) return null;
        return { server: m[1], user: q.username, pass: q.password };
    }

    function addSource(src) {
        var list = sources();
        if (src.type === "m3u") {
            var x = xtreamFromUrl(src.url);
            if (x) src = { type: "xtream", name: src.name, server: x.server, user: x.user, pass: x.pass, epg: src.epg || "" };
        }
        if (src.type === "xtream") src.server = normServer(src.server);
        if (src.type === "m3u") src.url = String(src.url || "").trim();
        if (src.type === "stalker" && TV.stalker) { src.portal = TV.stalker.normPortal(src.portal); src.mac = TV.stalker.normMac(src.mac) || String(src.mac || "").trim(); }
        if (src.type === "jellyfin" && TV.media) { src.server = TV.media.normServer(src.server); if (!String(src.name || "").trim()) src.autoName = true; }
        src.id = src.id || TV.uid();
        if (src.type === "stremio" && !String(src.name || "").trim()) src.name = "Stremio";
        if (src.type === "free" && !String(src.name || "").trim()) src.name = T("Public Domain Movies");
        src.name = String(src.name || "").trim() || hostName(src.type === "xtream" || src.type === "jellyfin" ? src.server : src.type === "stalker" ? src.portal : src.url) || T("My playlist");
        list.push(src);
        saveSources(list);
        return src;
    }
    function hostName(u) { var m = String(u || "").match(/^https?:\/\/([^\/:?#]+)/i); return m ? m[1].replace(/^www\./, "") : ""; }
    function removeSource(id) {
        saveSources(sources().filter(function (s) { return s.id !== id; }));
        TV.idb.del("cat:" + id); TV.idb.del("catm:" + id); TV.idb.del("cats:" + id); TV.idb.del("epg:" + id);
        delete cats[id];
        rebuild();
    }
    function updateSource(id, patch) {
        var list = sources();
        list.forEach(function (s) { if (s.id === id) Object.keys(patch).forEach(function (k) { s[k] = patch[k]; }); });
        saveSources(list);
    }

    /* ---------- Xtream ---------- */
    function xApi(src, action, extra) {
        var u = src.server + "/player_api.php?username=" + encodeURIComponent(src.user) + "&password=" + encodeURIComponent(src.pass);
        if (action) u += "&action=" + action;
        if (extra) u += "&" + extra;
        // the full lists of a big account (100,000 movies) can take minutes to arrive on a TV
        return TV.fetchJSON(u, { provider: true, timeout: !action ? 20000 : /_streams$|^get_series$/.test(action) ? 240000 : 90000 });
    }
    function xAuth(src) {
        return xApi(src, "").then(function (j) {
            var ui = j && j.user_info;
            if (!ui || String(ui.auth) !== "1") throw new Error(T("The server refused this username or password."));
            if (ui.status && !/^active$/i.test(ui.status)) {
                var exp = ui.exp_date ? new Date(ui.exp_date * 1000).toLocaleDateString(TV.locale) : "";
                throw new Error(exp ? T("This subscription is {status} (end: {date}).", { status: ui.status, date: exp }) : T("This subscription is {status}.", { status: ui.status }));
            }
            return j;
        });
    }
    function xUrl(src, kind, id, ext) {
        var p = src.server + "/" + kind + "/" + encodeURIComponent(src.user) + "/" + encodeURIComponent(src.pass) + "/" + id;
        return p + "." + (ext || "ts");
    }

    function catList(raw, srcId, kind) {
        return (raw || []).map(function (c) {
            var info = S.category(c.category_name || c.name || "");
            return { id: srcId + ":" + c.category_id, name: info.name, raw: info.raw, tag: info.tag, lang: info.lang, adult: info.adult, kind: kind, count: 0 };
        });
    }

    /* liveOnly (a device with little memory, the automatic refresh): its channels only, the movies and series from before
       stay. Reading 100,000 movies again while the old ones are still in memory is what Android stopped the page for. */
    function loadXtream(src, progress, liveOnly) {
        var prevC = cats[src.id], keepVod = !!(liveOnly && prevC && prevC.movies && prevC.series && (prevC.movies.items.length || prevC.series.items.length));
        var out = { id: src.id, v: CATALOG_V, at: Date.now(), type: "xtream", live: { cats: [], chans: [] }, movies: { cats: [], items: [] }, series: { cats: [], items: [] }, failed: {} };
        function lists(what) {
            return function (r) {
                if (!Array.isArray(r[1])) throw new Error(r[1] && r[1].error ? String(r[1].error) : T("no list"));
                if (!Array.isArray(r[0])) r[0] = [];
                return r;
            };
        }
        function lost(what) { return function (e) { TV.log(what + ": " + e.message); out.failed[what] = e.message; return [[], []]; }; }
        progress(T("Connecting to {name}…", { name: src.name }));
        return xAuth(src).then(function (auth) {
            out.account = { exp: auth.user_info.exp_date ? auth.user_info.exp_date * 1000 : 0, max: auth.user_info.max_connections, formats: auth.user_info.allowed_output_formats || [] };
            // the server's clock against UTC (its replay addresses are in its own time): "2026-11-13 18:00:00" and the moment
            var si = auth.server_info || {}, m = /^(\d{4})-(\d\d)-(\d\d)[ T](\d\d):(\d\d)/.exec(si.time_now || "");
            if (m && si.timestamp_now) out.account.tzOff = Math.round((Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) - si.timestamp_now * 1000) / 900000) * 900000;
            progress(T("Loading channels…"));
            return Promise.all([xApi(src, "get_live_categories"), xApi(src, "get_live_streams")]);
        }).then(function (r) {
            out.live.cats = catList(r[0], src.id, "live");
            var num = 0;
            (r[1] || []).forEach(function (c) {
                if (!c || S.isSeparator(c.name)) return;
                var info = S.channel(c.name);
                num++;
                out.live.chans.push({
                    id: src.id + "|" + c.stream_id, src: src.id, sid: c.stream_id, num: num, name: info.name, raw: c.name !== info.name ? c.name : undefined, q: info.quality, key: info.key,
                    logo: c.stream_icon || "", cat: src.id + ":" + c.category_id, epg: c.epg_channel_id || "", arch: parseInt(c.tv_archive, 10) ? (parseInt(c.tv_archive_duration, 10) || 1) : 0
                });
            });
            if (keepVod) { out.keptVod = true; TV.log("refresh of " + src.name + ": its channels only (little memory), its movies and series stay"); return null; }
            progress(T("Loading movies…"));
            return Promise.all([xApi(src, "get_vod_categories"), xApi(src, "get_vod_streams")]).then(lists("movies")).catch(lost("movies"));
        }).then(function (r) {
            if (!r) return null;
            out.movies.cats = catList(r[0], src.id, "movie");
            (r[1] || []).forEach(function (m) {
                if (!m || S.isSeparator(m.name)) return;
                var t = S.title(m.name);
                out.movies.items.push({
                    id: src.id + "|m" + m.stream_id, src: src.id, sid: m.stream_id, kind: "movie", name: m.name, title: t.title !== m.name ? t.title : undefined, year: t.year || yearOf(m.year || m.releaseDate || m.release_date),
                    poster: m.stream_icon || "", cat: src.id + ":" + m.category_id, rating: parseFloat(m.rating) || 0, added: parseInt(m.added, 10) || 0, ext: m.container_extension || "mp4"
                });
            });
            progress(T("Loading series…"));
            return Promise.all([xApi(src, "get_series_categories"), xApi(src, "get_series")]).then(lists("series")).catch(lost("series"));
        }).then(function (r) {
            if (!r) return out;
            out.series.cats = catList(r[0], src.id, "series");
            (r[1] || []).forEach(function (s) {
                if (!s || S.isSeparator(s.name)) return;
                var t = S.title(s.name), y = t.year || parseInt(String(s.releaseDate || s.release_date || "").slice(0, 4), 10) || 0;
                out.series.items.push({
                    id: src.id + "|s" + s.series_id, src: src.id, seriesId: s.series_id, kind: "series", name: s.name, title: t.title !== s.name ? t.title : undefined, year: y,
                    poster: s.cover || "", cat: src.id + ":" + s.category_id, rating: parseFloat(s.rating) || 0,
                    added: parseInt(s.last_modified, 10) || 0,
                    backdrop: (s.backdrop_path && s.backdrop_path[0]) || undefined
                });
            });
            return out;
        });
    }

    /* ---------- Stalker portal (MAG): js/stalker.js, in the same catalog shape ---------- */
    /* A big portal takes minutes (#19; #30: 5,400 pages after the first ones), and closed before the end, nothing was
       kept: each start began again with no movies at all. What has come in is now saved as it goes (once the first
       pages are in, then every 3 minutes when it grew by a third), marked unfinished: the next start shows it at
       once and loads the portal again. Never over a fuller copy from before (a refresh keeps the old one until the
       end). */
    function count(c) { return c ? (c.movies && c.movies.items ? c.movies.items.length : 0) + (c.series && c.series.items ? c.series.items.length : 0) : 0; }
    function loadStalker(src, progress, onFirst) {
        if (!TV.stalker) return Promise.reject(new Error("no Stalker support"));
        var out = { id: src.id, v: CATALOG_V, at: Date.now(), type: "stalker", live: { cats: [], chans: [] }, movies: { cats: [], items: [] }, series: { cats: [], items: [] }, failed: {} };
        var before = count(cats[src.id]), savedN = 0, timer = null;
        function snap() {
            var n = count(out);
            if (!stillThere(src.id) || n <= before || n < savedN * 1.3) return;
            savedN = n;
            saveCatalog({ id: out.id, v: out.v, at: out.at, type: out.type, account: out.account || null, live: out.live, unfinished: true,
                          movies: { cats: out.movies.cats.slice(), items: out.movies.items.slice() }, series: { cats: out.series.cats.slice(), items: out.series.items.slice() } })
                .then(function () { TV.log("unfinished catalog of " + src.name + " saved: " + n + " titles so far"); });
        }
        var p = TV.stalker.load(src, progress, out, function (c) {
            if (onFirst) onFirst(c);
            snap();
            timer = setInterval(snap, 3 * 60000);
        });
        p.then(function () { clearInterval(timer); }, function () { clearInterval(timer); });
        return p;
    }

    /* ---------- media servers (Jellyfin, Emby, Plex: js/media.js), Stremio (js/stremio.js) and the Public Domain
       Movies (js/freefilms.js): libraries of their own, in the same catalog shape ---------- */
    function isMedia(src) { return !!src && (src.type === "jellyfin" || src.type === "plex" || src.type === "stremio" || src.type === "free"); }
    function modOf(src) { return src.type === "stremio" ? TV.stremio : src.type === "free" ? TV.freeFilms : TV.media; }
    function loadMedia(src, progress) {
        if (!modOf(src)) return Promise.reject(new Error("no media server support"));
        return modOf(src).load(src, progress, { id: src.id, v: CATALOG_V, at: Date.now(), type: src.type, live: { cats: [], chans: [] }, movies: { cats: [], items: [] }, series: { cats: [], items: [] }, failed: {} });
    }

    /* ---------- M3U ---------- */
    function attr(line, name) {
        var re = new RegExp(name + '="([^"]*)"', "i"), m = line.match(re);
        return m ? m[1] : "";
    }
    /* The title of an #EXTINF line: after the first comma that is not inside an attribute's quotes */
    function afterComma(l) {
        var q = false;
        for (var i = 8; i < l.length; i++) {
            var c = l.charCodeAt(i);
            if (c === 34) q = !q;
            else if (c === 44 && !q) return l.slice(i + 1);
        }
        return "";
    }
    function hash(s) { var h = 5381; for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); }

    function parseM3U(text, src, progress) {
        return new Promise(function (resolve, reject) {
            if (!/#EXTM3U|#EXTINF/i.test(String(text).slice(0, 4096))) { reject(new Error(T("This address does not give an M3U playlist."))); return; }
            var lines = String(text).split(/\r?\n/), i = 0, n = lines.length;
            var out = { id: src.id, v: CATALOG_V, at: Date.now(), type: "m3u", live: { cats: [], chans: [] }, movies: { cats: [], items: [] }, series: { cats: [], items: [] }, epgUrl: "" };
            var head = lines[0] || "";
            out.epgUrl = attr(head, "url-tvg") || attr(head, "x-tvg-url") || "";
            if (out.epgUrl.indexOf(",") > 0) out.epgUrl = out.epgUrl.split(",")[0];
            var catIndex = { live: {}, movie: {}, series: {} }, shows = {}, num = 0, cur = null, grp = "";
            function cat(kind, name) {
                var idx = catIndex[kind], key = name || T("Other");
                if (!idx[key]) {
                    var info = S.category(key);
                    idx[key] = { id: src.id + ":" + kind[0] + hash(key), name: info.name, raw: key, tag: info.tag, lang: info.lang, adult: info.adult, kind: kind, count: 0 };
                    out[kind === "live" ? "live" : kind === "movie" ? "movies" : "series"].cats.push(idx[key]);
                }
                return idx[key].id;
            }
            var head = {};
            function step() {
                var stop = Math.min(n, i + 6000);
                for (; i < stop; i++) {
                    var l = lines[i];
                    if (!l) continue;
                    if (l.charCodeAt(0) === 35) {                         // '#'
                        if (/^#EXTINF/i.test(l)) {
                            var title = afterComma(l);
                            cur = { title: title.trim() || attr(l, "tvg-name"), id: attr(l, "tvg-id"), logo: attr(l, "tvg-logo"), group: attr(l, "group-title"),
                                    chno: attr(l, "tvg-chno"), type: attr(l, "tvg-type"), catchup: attr(l, "catchup-days") || attr(l, "tvg-rec") || attr(l, "timeshift") || head.days,
                                    cx: attr(l, "catchup") || attr(l, "catchup-type") || head.cx, cs: attr(l, "catchup-source") || head.cs };
                            grp = "";
                        } else if (/^#EXTGRP:/i.test(l)) grp = l.slice(8).trim();
                        // the playlist's own line: a replay for every channel ("catchup", "catchup-source", "catchup-days")
                        else if (/^#EXTM3U/i.test(l)) head = { cx: attr(l, "catchup") || attr(l, "catchup-type"), cs: attr(l, "catchup-source"), days: attr(l, "catchup-days") || attr(l, "tvg-rec") || attr(l, "timeshift") };
                        continue;
                    }
                    if (!cur) continue;
                    var url = l.trim(), group = cur.group || grp, gk = S.category(group).kind;
                    var file = /\.(mp4|mkv|avi|mov|wmv|m4v|webm)(\?|$)/i.test(url);
                    var kind = /\/movie\//i.test(url) || cur.type === "movie" ? "movie"
                             : /\/series\//i.test(url) || cur.type === "series" ? "series"
                             : file ? (gk === "series" ? "series" : "movie") : "live";
                    if (kind === "series" && !S.episode(cur.title)) kind = "movie";
                    if (S.isSeparator(cur.title)) { cur = null; continue; }
                    if (kind === "live") {
                        var info = S.channel(cur.title);
                        num++;
                        out.live.chans.push({ id: src.id + "|" + hash(url), src: src.id, url: url, num: parseInt(cur.chno, 10) || num, name: info.name, raw: cur.title, q: info.quality,
                                              key: info.key, logo: cur.logo, cat: cat("live", group), epg: cur.id || "", arch: parseInt(cur.catchup, 10) || (cur.cx && cur.cx !== "none" ? 7 : 0),
                                              cx: cur.cx || undefined, cs: cur.cs || undefined });
                    } else if (kind === "movie") {
                        var t = S.title(cur.title);
                        out.movies.items.push({ id: src.id + "|" + hash(url), src: src.id, kind: "movie", url: url, name: cur.title, title: t.title, year: t.year,
                                                poster: cur.logo, cat: cat("movie", group), rating: 0, added: out.movies.items.length });
                    } else {
                        var ep = S.episode(cur.title), cid = cat("series", group), sk = cid + "|" + S.fold(ep.show);
                        var show = shows[sk];
                        if (!show) {
                            var tt = S.title(ep.show);
                            show = shows[sk] = { id: src.id + "|" + hash(sk), src: src.id, kind: "series", name: ep.show, title: tt.title, year: tt.year, poster: cur.logo, cat: cid, rating: 0, added: out.series.items.length, eps: [] };
                            out.series.items.push(show);
                        }
                        show.eps.push({ id: src.id + "|" + hash(url), season: ep.season, episode: ep.episode, name: cur.title, url: url, image: cur.logo });
                    }
                    cur = null;
                }
                if (i < n) { progress(T("Reading the playlist… {p} %", { p: Math.round(i * 100 / n) })); setTimeout(step, 0); return; }
                lines = null;
                resolve(out);
            }
            step();
        });
    }

    function loadM3U(src, progress) {
        progress(T("Downloading {name}…", { name: src.name }));
        return TV.fetchText(src.url, { provider: true, timeout: 180000 }).then(function (text) { return parseM3U(text, src, progress); });
    }

    /* ---------- the merged catalog ---------- */
    var cats = {};               // source id -> catalog
    var merged = null;
    var listeners = [];
    function onChange(fn) { listeners.push(fn); }
    function fire(what) { if (TV.mark) TV.mark("data:" + (what || "catalog")); listeners.forEach(function (fn) { try { fn(what || "catalog"); } catch (e) { TV.log("listener: " + e.message); } }); }

    function rebuild() {
        var list = sources(), many = list.length > 1;
        // Settings > Sort the Categories / Tidy the Names (asked at the first start): off = your playlist as it is
        var tidyNames = TV.pref("tidyNames") !== false, tidyCats = TV.pref("tidyCats") !== false;
        var m = { live: { cats: [], chans: [], byId: {}, byCat: {} }, movies: { cats: [], items: [], byId: {}, byCat: {} }, series: { cats: [], items: [], byId: {}, byCat: {} }, epg: [] };
        var myNames = TV.pref("chanNames") || {};
        list.forEach(function (src) {
            var c = cats[src.id];
            if (!c) return;
            // the Public Domain Movies are shown like a playlist's: in Movies, with the other categories
            var media = isMedia(src) && src.type !== "free";
            ["live", "movies", "series"].forEach(function (k) {
                var part = c[k], counts = {};
                (k === "live" ? part.chans : part.items).forEach(function (x) { counts[x.cat] = (counts[x.cat] || 0) + 1; });
                part.cats.forEach(function (ct) {
                    /* A media server's libraries are yours: their own group, named after the server, and their names as
                       they are. Hiding a country or Other Categories of an IPTV playlist left a Jellyfin tab empty (#21). */
                    if (media) { ct.media = src.id; ct.name = ct.raw || ct.name; ct.tag = ""; ct.lang = ""; ct.adult = false; ct.group = "srv:" + src.id; }
                    else if (ct.raw) { var info = S.category(ct.raw); ct.name = info.name; ct.tag = info.tag; ct.lang = info.lang; ct.adult = info.adult; ct.group = info.group; }
                    ct.ctag = ct.tag;                                  // the country, for the guides, whatever is shown
                    if (!tidyNames && ct.raw) { ct.name = ct.raw; ct.tag = ""; }
                    ct.count = counts[ct.id] || 0;
                    ct.srcName = many ? src.name : "";
                    if (ct.count) m[k].cats.push(ct);
                });
                (k === "live" ? part.chans : part.items).forEach(function (x) {
                    if (k === "live") {
                        if (x.cname === undefined) x.cname = x.name;               // cname: the clean name, for the guide (never yours)
                        x.name = tidyNames ? x.cname : (x.raw || x.cname);
                        // your name for it (Edit on Your Phone, or its menu): shown everywhere, the provider's kept in orig
                        if (myNames[x.id]) { x.orig = x.name; x.name = myNames[x.id]; } else if (x.orig) delete x.orig;
                    }
                    (k === "live" ? m.live.chans : m[k].items).push(x);
                    m[k].byId[x.id] = x;
                    (m[k].byCat[x.cat] = m[k].byCat[x.cat] || []).push(x);
                });
            });
            var epg = src.epg || c.epgUrl || (src.type === "xtream" ? src.server + "/xmltv.php?username=" + encodeURIComponent(src.user) + "&password=" + encodeURIComponent(src.pass) : "");
            if (epg) m.epg.push({ src: src.id, url: epg, xtream: src.type === "xtream" });
        });
        if (tidyCats) ["live", "movies", "series"].forEach(function (k) { m[k].cats = S.sortCategories(m[k].cats); });
        // your own order (set on the phone): the categories you placed first, the others after as they were
        var ord = TV.pref("catOrder") || {};
        ["live", "movies", "series"].forEach(function (k) {
            var o = ord[k];
            if (!o || !o.length) return;
            var pos = {};
            o.forEach(function (key, i) { if (!(key in pos)) pos[key] = i; });
            m[k].cats = m[k].cats.map(function (c, i) { var p = pos[catKey(c)]; return [p === undefined ? 1e9 + i : p, i, c]; })
                .sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; }).map(function (r) { return r[2]; });
        });
        merged = m;
        applyOff();
        groupCache = {}; idxCache = {}; topLists = {}; genreLists = {}; trendLists = {}; oldMovies = null;
        fire("catalog");
    }

    var retryTimers = {};
    var behind = {};             // source id -> the end of a Stalker portal's titles still coming in the background
    function stillThere(id) { return sources().some(function (s) { return s.id === id; }); }
    /* early: for a screen that waits (adding a playlist, Refresh, the first start). A Stalker portal gives its
       titles 14 at a time and a big one took minutes (#19): the screen can be used once the channels and the
       newest titles of every category are in, and the rest arrives in the background. */
    function loadSource(src, progress, early, liveOnly) {
        if (behind[src.id]) return behind[src.id];
        if (!early || src.type !== "stalker") return loadFull(src, progress, liveOnly);
        return new Promise(function (resolve, reject) {
            var first = false, done = null;
            var full = loadStalker(src, function (m) { if (!first) progress(m); }, function (c) {
                try {
                    var prev = cats[src.id], part = {};
                    Object.keys(c).forEach(function (k) { if (k !== "failed") part[k] = c[k]; });
                    ["movies", "series"].forEach(function (k) {
                        var had = prev && prev[k] && prev[k].items && prev[k].items.length || 0;
                        // a refresh: the whole list from before stays until the new one is all here
                        part[k] = had > c[k].items.length ? prev[k] : { cats: c[k].cats.slice(), items: c[k].items.slice() };
                    });
                    // not saved: closed before the end, the next start loads it again
                    cats[src.id] = part;
                    updateSource(src.id, { error: "", at: part.at, counts: { live: part.live.chans.length, movies: part.movies.items.length, series: part.series.items.length }, account: part.account || null });
                } catch (e) { TV.log("first part of " + src.name + ": " + e.message); return; }
                first = true;
                behind[src.id] = done;
                resolve(part);
            });
            done = full.then(function (c) {
                if (!first) return took(src, c);
                if (!stillThere(src.id)) return null;
                return took(src, c).then(function (c2) {
                    rebuild();
                    TV.toast(T("“{name}”: all its movies and series are here ({movies} movies, {series} series)", { name: src.name, movies: c2.movies.items.length, series: c2.series.items.length }), true);
                    return c2;
                });
            }, function (e) {
                if (!first) { updateSource(src.id, { error: e.message }); throw e; }
                TV.log("background " + src.name + ": " + e.message);
                return cats[src.id] || null;
            });
            done.then(function (c) { delete behind[src.id]; if (!first) resolve(c); }, function (e) { delete behind[src.id]; reject(e); });
        });
    }
    function loadFull(src, progress, liveOnly) {
        return (src.type === "xtream" ? loadXtream(src, progress, liveOnly) : src.type === "stalker" ? loadStalker(src, progress) : isMedia(src) ? loadMedia(src, progress) : loadM3U(src, progress)).then(function (c) { return took(src, c); }, function (e) {
            updateSource(src.id, { error: e.message });
            throw e;
        });
    }
    /* A catalog that came: kept, counted and saved */
    function took(src, c) {
        /* The movies or the series did not come (the provider too slow, an error): the ones from before stay,
           instead of an empty Movies tab until the next refresh, and APL TV asks again in 10 minutes. */
        var prev = cats[src.id], failed = c.failed || {}, missed = [];
        delete c.failed;
        var vodKept = !!(c.keptVod && prev);
        if (vodKept) { c.movies = prev.movies; c.series = prev.series; }      // a refresh of the channels only (liveOnly)
        delete c.keptVod;
        ["movies", "series"].forEach(function (k) {
            var had = prev && prev[k] && prev[k].items && prev[k].items.length || 0;
            if (failed[k] || (had >= 50 && !c[k].items.length && src.type !== "stremio")) {
                missed.push(k);
                if (had) { c[k] = prev[k]; TV.log(k + " of " + src.name + " not received (" + (failed[k] || "empty") + "): the " + had + " from before stay"); }
                // nothing from before either: saved as unfinished, so the next start asks again instead of keeping an
                // empty Movies tab for 6 hours (#30: an empty list was saved and showed until a Refresh by hand)
                else c.unfinished = true;
            }
        });
        if (missed.length) {
            if (!retryTimers[src.id]) retryTimers[src.id] = setTimeout(function () { whenQuiet(function () { delete retryTimers[src.id]; refresh([src]); }); }, 10 * 60000);
            if (missed.indexOf("movies") >= 0 && !c.movies.items.length) TV.toast(T("{name}: the movies did not arrive ({error}). APL TV tries again in 10 minutes.", { name: src.name, error: failed.movies || T("no list") }), true);
            if (missed.indexOf("series") >= 0 && !c.series.items.length) TV.toast(T("{name}: the series did not arrive ({error}). APL TV tries again in 10 minutes.", { name: src.name, error: failed.series || T("no list") }), true);
        }
        cats[src.id] = c;
        updateSource(src.id, { error: "", at: c.at, counts: { live: c.live.chans.length, movies: c.movies.items.length, series: c.series.items.length }, account: c.account || null });
        return saveCatalog(c, vodKept).then(function () { return c; });
    }

    /* Saved in parts (channels, movies, series) and packed: rows of values instead of objects that repeat
       every field name, the source and the category written once. The screen gives the app 80 MB in all:
       a big Xtream account (27,000 channels, 100,000 movies) fits only this way. */
    var FIELDS = {
        live: ["id", "sid", "url", "num", "name", "raw", "q", "key", "logo", "cat", "epg", "arch", "cx", "cs"],
        // srvDone (watched on your Jellyfin or Emby server) last: the other sources' rows end before it, no bigger
        movies: ["id", "sid", "url", "name", "title", "year", "poster", "cat", "rating", "added", "ext", "srvDone"],
        series: ["id", "seriesId", "name", "title", "year", "poster", "cat", "rating", "added", "backdrop", "eps"]
    };
    var PICS = { logo: 1, poster: 1, backdrop: 1 };
    function pack(part, kind, srcId) {
        var list = kind === "live" ? part.chans : part.items, idx = {}, F = FIELDS[kind], cut = srcId.length + 1, dirs = [], dirIdx = {};
        part.cats.forEach(function (c, i) { idx[c.id] = i; });
        function pic(v) {
            if (!v) return null;
            var k = v.lastIndexOf("/") + 1, d = v.slice(0, k);
            if (dirIdx[d] === undefined) { dirIdx[d] = dirs.length; dirs.push(d); }
            return dirIdx[d] + "|" + v.slice(k);
        }
        var rows = list.map(function (x) {
            var r = [];
            for (var i = 0; i < F.length; i++) {
                var f = F[i], v = x[f];
                r.push(f === "id" ? String(v).slice(cut) : f === "cat" ? idx[v] : PICS[f] ? pic(v) : (v === undefined || v === "" ? null : v));
            }
            while (r.length && r[r.length - 1] === null) r.pop();
            return r;
        });
        return { packed: 2, cats: part.cats, dirs: dirs, rows: rows };
    }
    function unpack(p, kind, srcId) {
        if (!p || !p.packed) return p;
        var F = FIELDS[kind], cats = p.cats, dirs = p.dirs || [], k = kind === "movies" ? "movie" : kind === "series" ? "series" : null;
        var list = p.rows.map(function (r) {
            var o = { src: srcId };
            if (k) o.kind = k;
            for (var i = 0; i < r.length; i++) {
                var v = r[i];
                if (v === null || v === undefined) continue;
                var f = F[i];
                if (PICS[f] && p.packed === 2) { var bar = v.indexOf("|"); v = dirs[+v.slice(0, bar)] + v.slice(bar + 1); }
                o[f] = f === "id" ? srcId + "|" + v : f === "cat" ? (cats[v] && cats[v].id) : v;
            }
            return o;
        });
        return kind === "live" ? { cats: cats, chans: list } : { cats: cats, items: list };
    }
    /* One save at a time per source: an unfinished copy still being written can't land after the finished one */
    var saving = {};
    function saveCatalog(c, vodKept) {
        var id = c.id, p = (saving[id] || Promise.resolve()).then(function () { return saveNow(c, vodKept); }, function () { return saveNow(c, vodKept); });
        saving[id] = p;
        p.then(function () { if (saving[id] === p) delete saving[id]; }, function () { if (saving[id] === p) delete saving[id]; });
        return p;
    }
    function saveNow(c, vodKept) {
        var id = c.id, saved = { movies: false, series: false };
        // the movies and series did not change (a refresh of the channels only): their saved copies stay as they are
        if (vodKept) { saved = { movies: true, series: true }; return saveHead(); }
        // Room first: the previous copy goes before the new one is written
        return Promise.all([TV.idb.del("catm:" + id), TV.idb.del("cats:" + id)]).then(function () {
            return TV.idb.set("catm:" + id, pack(c.movies, "movies", id));
        }).then(function (r) {
            saved.movies = r !== false;
            if (!saved.movies) TV.idb.del("catm:" + id);
            return TV.idb.set("cats:" + id, pack(c.series, "series", id));
        }).then(function (r) {
            saved.series = r !== false;
            if (!saved.series) TV.idb.del("cats:" + id);
            return saveHead();
        });
        function saveHead() {
            var head = { id: id, v: c.v || 1, at: c.at, type: c.type, account: c.account || null, epgUrl: c.epgUrl || "", live: pack(c.live, "live", id), parts: 3, saved: saved };
            if (c.unfinished) head.unfinished = true;
            return TV.idb.set("cat:" + id, head).then(function (r) {
                TV.log("catalog saved: channels " + (r !== false) + ", movies " + saved.movies + ", series " + saved.series + (vodKept ? " (as they were)" : "") + (c.unfinished ? ", unfinished" : ""));
            });
        }
    }
    function readCatalog(id) {
        return TV.idb.get("cat:" + id).then(function (c) {
            if (!c || !c.live) return null;
            if (!c.parts) return c;
            return Promise.all([TV.idb.get("catm:" + id), TV.idb.get("cats:" + id)]).then(function (r) {
                c.live = unpack(c.live, "live", id);
                c.movies = r[0] ? unpack(r[0], "movies", id) : null;
                c.series = r[1] ? unpack(r[1], "series", id) : null;
                if (c.parts < 3 && (!c.movies || !c.series)) return null;
                return c;
            });
        });
    }

    /* At start-up: what is saved shows at once, sources older than 6 hours are refreshed after */
    function start(progress) {
        var list = sources();
        return (TV.epg && TV.epg.prune ? TV.epg.prune() : Promise.resolve()).then(function () { return Promise.all(list.map(function (s) {
            return readCatalog(s.id).then(function (c) {
                // a Stremio account gives no catalog (one saved by an earlier version of APL TV is left out)
                if (c && s.type === "stremio") { c.movies = { cats: [], items: [] }; c.series = { cats: [], items: [] }; }
                if (c) cats[s.id] = c;
            });
        })); }).then(function () {
            var missing = list.filter(function (s) { return !cats[s.id]; });
            var partial = list.filter(function (s) { return cats[s.id] && (!cats[s.id].movies || !cats[s.id].series); });
            list.forEach(function (s) { var c = cats[s.id]; if (c) { c.movies = c.movies || { cats: [], items: [] }; c.series = c.series || { cats: [], items: [] }; } });
            if (partial.length) setTimeout(function () {
                TV.log("movies and series: loading again in the background (" + partial.length + ")");
                sequence(partial, function (s) { return loadSource(s, function () {}).catch(function (e) { TV.log("background " + s.name + ": " + e.message); }); }).then(rebuild);
            }, 4000);
            rebuild();
            if (!missing.length) return;
            return sequence(missing, function (s) { return loadSource(s, progress, true).catch(function (e) { TV.log("load " + s.name + ": " + e.message); TV.toast(s.name + " : " + e.message, true); }); })
                .then(rebuild);
        }).then(function () {
            // and the ones saved unfinished (closed while a big portal was loading, or its movies did not come)
            var old = sources().filter(function (s) { return cats[s.id] && (cats[s.id].unfinished || Date.now() - (cats[s.id].at || 0) > MAX_AGE || (cats[s.id].v || 1) < CATALOG_V); });
            if (old.length) whenQuiet(function () { refresh(old, function () {}, TV.SMALL); });
        });
    }
    /* Refreshing a big account is seconds of heavy work for the TV (reading and saving 200,000 titles: up
       to 12 s on the LG G5, the first channel then took 12 s to show). It waits for a quiet moment: the
       remote unused for 45 s (counted from the start too) and no channel starting, so zapping and moving
       around stay quick. After 20 minutes it goes ahead anyway. */
    var bootAt = Date.now();
    function whenQuiet(fn) {
        var since = Date.now();
        (function check() {
            var still = Date.now() - Math.max(TV.keyAt || 0, bootAt) > 45000 && !(TV.player && TV.player.isBuffering());
            /* A device with little memory: never while a video plays, nor in the background (the refresh on top of a
               channel was what Android stopped the page for, on a Fire TV Stick), and not after 20 minutes either */
            if (TV.SMALL && (document.hidden || (TV.player && TV.player.current && TV.player.current()))) { setTimeout(check, 5000); return; }
            if (still || Date.now() - since > 20 * 60000) { TV.log("catalog refresh: starting (" + Math.round((Date.now() - bootAt) / 1000) + " s after start)"); fn(); }
            else setTimeout(check, 5000);
        })();
    }
    function refresh(list, progress, liveOnly) {
        list = list || sources();
        return sequence(list, function (s) { return loadSource(s, progress || function () {}, false, liveOnly).catch(function (e) { TV.log("refresh " + s.name + ": " + e.message); }); }).then(rebuild);
    }
    function sequence(items, fn) {
        return items.reduce(function (p, it) { return p.then(function () { return fn(it); }); }, Promise.resolve());
    }

    /* ---------- channels: variants of one channel together ---------- */
    var groupCache = {};
    function channelsIn(catId) {
        if (groupCache[catId]) return groupCache[catId];
        var src;
        if (catId === "fav") src = favChannels();
        else if (catId === "recent") src = recentChannels();
        else if (String(catId).indexOf("grp:") === 0) { var cg = chanGroupOf(catId); src = cg ? cg.ids.map(channel).filter(Boolean) : []; }
        else if (catId === "all") src = merged ? merged.live.chans.filter(function (c) { var ct = catOf(c); return (TV.pref("showAdult") || !ct.adult) && !ct.off; }) : [];
        else src = merged && !catOf({ cat: catId }).off && merged.live.byCat[catId] || [];
        // a channel you hid: out of every list but your favorites and your own groups (you put it there)
        if (catId !== "fav" && String(catId).indexOf("grp:") !== 0 && chanHiddenIds()) { var hc = chanHiddenIds(); src = src.filter(function (c) { return !hc[c.id]; }); }
        var out = src;
        if (TV.pref("mergeQuality") && catId !== "fav" && catId !== "recent" && String(catId).indexOf("grp:") !== 0) {
            var seen = {};
            out = [];
            src.forEach(function (c) {
                var g = seen[c.key];
                if (g && g.cat === c.cat) {
                    g.variants = g.variants || [g.self];
                    g.variants.push(c);
                    return;
                }
                var e = { id: c.id, self: c, cat: c.cat };
                seen[c.key] = e;
                out.push(e);
            });
            // 4K first only where it plays (TV.canUhd: a Fire TV Stick froze the picture of TF1 4K); else after HD
            var uhd = !TV.canUhd || TV.canUhd(), rank = function (q) { var n = S.qualityRank(q); return n === 4 && !uhd ? 1.5 : n; };
            out = out.map(function (e) {
                if (!e.variants) return e.self;
                var v = e.variants.slice().sort(function (a, b) { return rank(b.q) - rank(a.q); });
                var best = v[0], copy = {};
                Object.keys(best).forEach(function (k) { copy[k] = best[k]; });
                copy.variants = v; copy.num = Math.min.apply(null, v.map(function (x) { return x.num; }));
                if (!copy.logo) for (var i = 0; i < v.length; i++) if (v[i].logo) { copy.logo = v[i].logo; break; }
                return copy;
            });
        }
        // A to Z (Settings > Channel Order, issue #18): by the name you see, "Canal+ 2" before "Canal+ 10"; Recent stays by time
        if (TV.pref("chanOrder") === "az" && catId !== "recent") out = byName(out);
        if (catId !== "fav" && catId !== "recent") groupCache[catId] = out;
        return out;
    }
    function byName(list) {
        return list.map(function (c) { return { c: c, k: S.fold(c.name || "").replace(/\d+/g, function (n) { return ("0000000000" + n).slice(-10); }) }; })
            .sort(function (a, b) { return a.k < b.k ? -1 : a.k > b.k ? 1 : 0; }).map(function (x) { return x.c; });
    }
    function catOf(ch) {
        if (!merged) return {};
        if (!merged._catMap) { merged._catMap = {}; ["live", "movies", "series"].forEach(function (k) { merged[k].cats.forEach(function (c) { merged._catMap[c.id] = c; }); }); }
        return merged._catMap[ch.cat] || {};
    }
    function channel(id) { return merged && merged.live.byId[id] || null; }
    function streamUrl(ch) {
        if (ch.url) return ch.url;
        var src = sourceOf(ch);
        if (!src) return "";
        var f = TV.pref("liveFormat") === "m3u8" ? "m3u8" : "ts", fm = src.account && src.account.formats;
        // HLS by default (a Fire TV, core.js) for an account that doesn't offer it: MPEG-TS; your own choice stays as it is
        if (f === "m3u8" && !TV.pref("liveFormatMine") && fm && fm.length && fm.indexOf("m3u8") < 0) f = "ts";
        return xUrl(src, "live", ch.sid, f);
    }
    function sourceOf(x) { var id = x.src; var list = sources(); for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i]; return null; }

    /* ---------- favorites, recents, My List, resume points ---------- */
    function favIds() { return TV.load("favs", []) || []; }
    function isFav(id) { return favIds().indexOf(id) !== -1; }
    function toggleFav(id) {
        var f = favIds(), i = f.indexOf(id);
        if (i === -1) f.push(id); else f.splice(i, 1);
        TV.save("favs", f);
        delete groupCache.fav;
        fire("favs");
        return i === -1;
    }
    function favChannels() { return favIds().map(channel).filter(Boolean); }
    function moveFav(id, delta) {
        var f = favIds(), i = f.indexOf(id), j = i + delta;
        if (i < 0 || j < 0 || j >= f.length) return false;
        f.splice(j, 0, f.splice(i, 1)[0]);
        TV.save("favs", f);
        return true;
    }
    /* Your own groups of channels (hold OK on a channel > Add to a Group): [{ id, name, ids }], shown in
       Live TV and the Guide after Favorites, in the order you add their channels */
    function chanGroups() { return TV.load("chanGroups", []) || []; }
    function saveGroups(g) {
        TV.save("chanGroups", g);
        Object.keys(groupCache).forEach(function (k) { if (k.indexOf("grp:") === 0) delete groupCache[k]; });
        fire("groups");
    }
    function addChanGroup(name) { var g = chanGroups(), id = TV.uid(); g.push({ id: id, name: String(name).slice(0, 40), ids: [] }); saveGroups(g); return id; }
    function renameChanGroup(id, name) { var g = chanGroups(); g.forEach(function (x) { if (x.id === id) x.name = String(name).slice(0, 40); }); saveGroups(g); }
    function deleteChanGroup(id) { saveGroups(chanGroups().filter(function (x) { return x.id !== id; })); }
    function toggleChanGroup(id, chId) {
        var g = chanGroups(), on = false;
        g.forEach(function (x) { if (x.id !== id) return; var i = x.ids.indexOf(chId); if (i < 0) { x.ids.push(chId); on = true; } else x.ids.splice(i, 1); });
        saveGroups(g);
        return on;
    }
    function moveInChanGroup(id, chId, delta) {
        var g = chanGroups(), moved = false;
        g.forEach(function (x) {
            if (x.id !== id) return;
            var i = x.ids.indexOf(chId), j = i + delta;
            if (i < 0 || j < 0 || j >= x.ids.length) return;
            x.ids.splice(j, 0, x.ids.splice(i, 1)[0]); moved = true;
        });
        if (moved) saveGroups(g);
        return moved;
    }
    function chanGroupOf(catId) { var id = String(catId).replace(/^grp:/, ""); return chanGroups().filter(function (x) { return x.id === id; })[0] || null; }
    function pushRecent(id) {
        var r = (TV.load("recent", []) || []).filter(function (x) { return x !== id; });
        r.unshift(id);
        TV.save("recent", r.slice(0, 30));
    }
    function recentChannels() { return (TV.load("recent", []) || []).map(channel).filter(Boolean); }

    function myList() { return TV.load("mylist", []) || []; }
    function inMyList(id) { return myList().indexOf(id) !== -1; }
    function toggleMyList(id) {
        keepVirtual(id);
        var l = myList(), i = l.indexOf(id);
        if (i === -1) l.unshift(id); else l.splice(i, 1);
        TV.save("mylist", l);
        fire("mylist");
        return i === -1;
    }

    /* Channels hidden by you (OK held on a channel > Hide This Channel): every quality of it, out of the channel lists,
       the guide, Home, Recent and search. Your favorites and your own groups keep it. Settings > Hidden Channels. */
    var chanIdsMemo = null;
    function hiddenChans() { return TV.load("hiddenChans", {}) || {}; }
    function chanHiddenIds() {
        if (chanIdsMemo === null) {
            var h = hiddenChans(), ids = {}, n = 0;
            Object.keys(h).forEach(function (k) { (h[k].ids || [k]).forEach(function (id) { ids[id] = 1; n++; }); });
            chanIdsMemo = n ? ids : false;
        }
        return chanIdsMemo;
    }
    function isChanHidden(ch) {
        var ids = ch && chanHiddenIds();
        return !!ids && (!!ids[ch.id] || !!(ch.variants && ch.variants.some(function (v) { return ids[v.id]; })));
    }
    function setChanHidden(ch, on) {
        var h = hiddenChans(), ids = ch.variants ? ch.variants.map(function (v) { return v.id; }) : [ch.id];
        Object.keys(h).forEach(function (k) { if ((h[k].ids || [k]).some(function (id) { return ids.indexOf(id) >= 0; })) delete h[k]; });
        if (on) h[ch.id] = { t: ch.name, at: Date.now(), ids: ids };
        TV.save("hiddenChans", h);
        chanIdsMemo = null; groupCache = {};
        fire("hidden");
    }
    function hiddenChanList() { var h = hiddenChans(); return Object.keys(h).map(function (k) { return { key: k, t: h[k].t, at: h[k].at }; }).sort(function (a, b) { return b.at - a.at; }); }
    function unhideChan(key) { var h = hiddenChans(); delete h[key]; TV.save("hiddenChans", h); chanIdsMemo = null; groupCache = {}; fire("hidden"); }

    /* Titles hidden by you: every version of the title (same name and year) disappears everywhere */
    function hiddenMap() { return TV.load("hidden", {}) || {}; }
    function hideKey(x) { if (!x._hk) x._hk = (x.kind === "series" ? "s:" : "m:") + versionKey(x); return x._hk; }
    function anyTitleHidden() { if (themeCount || themesOn().length) return true; for (var k in hiddenMap()) return true; return false; }
    function anyHidden() { return offCount > 0 || anyTitleHidden() || !!chanHiddenIds(); }
    function isHidden(x) {
        if (!x) return false;
        if (offCount && catOf(x).off) return true;
        if (!x.kind && chanHiddenIds() && chanHiddenIds()[x.id]) return true;      // a channel you hid
        if (!anyTitleHidden()) return false;
        var k = hideKey(x); return !!(hiddenMap()[k] || themeKeys[k] || catHidden(x));
    }

    /* ---------- countries and categories you hide (Settings > Countries and Categories) ----------
       A hidden category takes its channels, movies and series away from everywhere: the category rows,
       All Channels, Home, the genres, search, More Like This and voice. Your favorites stay.
       hiddenGroups: the countries or regions hidden ("AF"), hiddenCats: one category hidden (1) or
       shown again inside a hidden country (0), by its name in the playlist, so it stays after a refresh. */
    var offCount = 0;
    function catKey(c) { return c.kind + ":" + (c.raw || c.name); }
    function applyOff() {
        offCount = 0;
        if (!merged) return;
        var one = TV.pref("hiddenCats") || {}, groups = TV.pref("hiddenGroups") || [], n = {}, all = [];
        ["live", "movies", "series"].forEach(function (k) { merged[k].cats.forEach(function (c) { all.push(c); n[c.group || ""] = (n[c.group || ""] || 0) + 1; }); });
        all.forEach(function (c) {
            // a code APL TV does not know, seen on a single category ("TNT| Sport"), is not a country: Other Categories
            c.grp = c.media ? c.group : c.group && (S.groupName(c.group) !== c.group || n[c.group] > 1) ? c.group : "";
            var key = catKey(c);
            c.off = key in one ? one[key] === 1 : groups.indexOf(c.grp) >= 0;
            if (c.off) offCount++;
        });
    }
    function offChanged() { applyOff(); groupCache = {}; fire("hidden"); }
    /* A group's name in Settings and in the category lists: a country, Other Categories, or a media server */
    function groupLabel(g) {
        if (!g) return T("Other Categories");
        if (g.indexOf("srv:") === 0) { var s = sourceOf({ src: g.slice(4) }); return s ? s.name || (s.type === "plex" ? "Plex" : s.type === "stremio" ? "Stremio" : s.type === "free" ? T("Public Domain Movies") : s.kind === "emby" ? "Emby" : "Jellyfin") : g.slice(4); }
        return S.groupName(g);
    }
    function setCatOff(c, on) {
        var one = TV.pref("hiddenCats") || {}, copy = {}, k;
        for (k in one) copy[k] = one[k];
        var inGroup = (TV.pref("hiddenGroups") || []).indexOf(c.grp) >= 0;
        if (on === inGroup) delete copy[catKey(c)]; else copy[catKey(c)] = on ? 1 : 0;
        TV.setPref("hiddenCats", copy);
        offChanged();
    }
    function setGroupOff(g, on) {
        var groups = (TV.pref("hiddenGroups") || []).filter(function (x) { return x !== g; }), one = TV.pref("hiddenCats") || {}, copy = {}, k;
        if (on) groups.push(g);
        var mine = {};
        offGroups().forEach(function (x) { if (x.id === g) x.cats.forEach(function (c) { mine[catKey(c)] = 1; }); });
        for (k in one) if (!mine[k]) copy[k] = one[k];          // the whole country now: its own exceptions go
        TV.setPref("hiddenGroups", groups);
        TV.setPref("hiddenCats", copy);
        offChanged();
    }
    /* The countries and regions of your playlists, each with its categories (adult ones only when shown) */
    function offGroups() {
        if (!merged) return [];
        var adult = TV.pref("showAdult"), by = {}, list = [];
        [["live", "live"], ["movies", "movie"], ["series", "series"]].forEach(function (k) {
            merged[k[0]].cats.forEach(function (c) {
                if (c.adult && !adult) return;
                var g = by[c.grp];
                if (!g) { g = by[c.grp] = { id: c.grp, name: groupLabel(c.grp), cats: [], off: 0, items: 0 }; list.push(g); }
                g.cats.push(c); g.items += c.count || 0; if (c.off) g.off++;
            });
        });
        return list.sort(function (a, b) { return (!a.id) - (!b.id) || b.items - a.items; });
    }
    function offCats() { return offCount; }

    /* ---------- edited on the phone (Settings > Edit on Your Phone, js/settings.js; the page: service.js) ----------
       What the phone gets: the categories of each kind in their order (hidden or not), your groups, your favorites
       and the channels' names to find them. What comes back: the same, changed. */
    function editData() {
        var out = { v: 1, kinds: {}, groups: chanGroups(), favs: favIds(), chans: [], names: TV.pref("chanNames") || {}, hidden: Object.keys(chanHiddenIds() || {}) };
        if (!merged) return out;
        var adult = TV.pref("showAdult");
        ["live", "movies", "series"].forEach(function (k) {
            out.kinds[k] = merged[k].cats.filter(function (c) { return adult || !c.adult; }).map(function (c) {
                return { key: catKey(c), name: c.name + (c.srcName ? " (" + c.srcName + ")" : ""), count: c.count || 0, off: !!c.off };
            });
        });
        var chans = merged.live.chans;
        for (var i = 0; i < chans.length && out.chans.length < 40000; i++) {
            var c = chans[i], ct = catOf(c);
            if (!adult && ct.adult) continue;
            out.chans.push([c.id, c.name + (c.q ? " " + c.q : ""), ct.name || "", c.orig || c.name]);
        }
        return out;
    }
    function applyPhoneEdit(d) {
        if (!d || typeof d !== "object") return false;
        var kinds = d.kinds || {}, one = TV.pref("hiddenCats") || {}, copy = {}, k, groups = TV.pref("hiddenGroups") || [], byKey = {};
        for (k in one) copy[k] = one[k];
        if (merged) ["live", "movies", "series"].forEach(function (x) { merged[x].cats.forEach(function (c) { byKey[catKey(c)] = c; }); });
        var order = {};
        ["live", "movies", "series"].forEach(function (x) {
            var list = Array.isArray(kinds[x]) ? kinds[x] : null;
            if (!list) return;
            order[x] = [];
            list.forEach(function (it) {
                if (!it || typeof it.key !== "string") return;
                order[x].push(it.key);
                var c = byKey[it.key];
                if (!c) return;
                var off = !!it.off, inGroup = groups.indexOf(c.grp) >= 0;
                if (off === inGroup) delete copy[it.key]; else copy[it.key] = off ? 1 : 0;
            });
        });
        TV.setPref("hiddenCats", copy);
        var ord = TV.pref("catOrder") || {}, newOrd = {};
        ["live", "movies", "series"].forEach(function (x) { newOrd[x] = order[x] || ord[x] || []; });
        TV.setPref("catOrder", newOrd);
        if (Array.isArray(d.groups)) {
            saveGroups(d.groups.filter(function (g) { return g && String(g.name || "").trim(); }).map(function (g) {
                return { id: g.id ? String(g.id) : TV.uid(), name: String(g.name).trim().slice(0, 40), ids: (Array.isArray(g.ids) ? g.ids : []).map(String).slice(0, 2000) };
            }));
        }
        if (Array.isArray(d.favs)) { TV.save("favs", d.favs.map(String).slice(0, 2000)); fire("favs"); }
        if (d.names && typeof d.names === "object") TV.setPref("chanNames", cleanNames(d.names));
        // the channels hidden on the phone (each quality is its own line there): the TV's list follows it
        if (Array.isArray(d.hidden)) {
            var want = {}, h = hiddenChans(), kept = {};
            d.hidden.slice(0, 20000).forEach(function (id) { want[String(id)] = 1; });
            Object.keys(h).forEach(function (key) {
                var ids = (h[key].ids || [key]).filter(function (id) { return want[id]; });
                if (ids.length) { kept[key] = { t: h[key].t, at: h[key].at, ids: ids }; ids.forEach(function (id) { delete want[id]; }); }
            });
            Object.keys(want).forEach(function (id) { var c = channel(id); kept[id] = { t: c ? c.name + (c.q ? " " + c.q : "") : id, at: Date.now(), ids: [id] }; });
            TV.save("hiddenChans", kept); chanIdsMemo = null;
        }
        rebuild();
        return true;
    }
    /* Your channel names: an id to a name, 60 characters at most; an empty one gives the provider's back */
    function cleanNames(o) {
        var out = {}, n = 0;
        Object.keys(o || {}).forEach(function (id) {
            var v = String(o[id] === null || o[id] === undefined ? "" : o[id]).replace(/\s+/g, " ").trim().slice(0, 60);
            if (v && n < 5000) { out[String(id)] = v; n++; }
        });
        return out;
    }
    /* ids: one channel, or its qualities together (HD, FHD...: one card in Live TV) */
    function renameChannel(ids, name) {
        var names = TV.pref("chanNames") || {}, copy = {};
        Object.keys(names).forEach(function (k) { copy[k] = names[k]; });
        [].concat(ids).forEach(function (id) { copy[id] = name; });
        TV.setPref("chanNames", cleanNames(copy));
        rebuild();
    }
    /* A provider category whose name carries a hidden theme ("FR| LGBT", "Horreur"): everything in it is hidden */
    var catThemeCache = {};
    function catNameHidden(name) {
        if (!name) return false;
        if (catThemeCache[name] !== undefined) return catThemeCache[name];
        var on = themesOn(), hit = false;
        for (var i = 0; i < on.length && !hit; i++) { var re = TV.meta && TV.meta.themeWords(on[i]); if (re && re.test(name)) hit = true; }
        catThemeCache[name] = hit;
        return hit;
    }
    function catHidden(x) { var c = catOf(x); return !!(c && catNameHidden(c.name)); }

    /* Hidden themes (Settings > Hidden Themes): titles TMDB tags with a theme you hide disappear like hidden
       titles. Found at start-up from TMDB's lists, and as each title's information arrives (remembered). */
    var themeKeys = {}, themeCount = 0, themeTimer = null;
    function themesOn() { return TV.pref("hiddenThemes") || []; }
    function setThemeKey(k, t) { if (!themeKeys[k]) themeCount++; themeKeys[k] = t; }
    function restoreThemes() {
        var on = themesOn(), hits = TV.load("themeHits", {}) || {};
        themeKeys = {}; themeCount = 0;
        Object.keys(hits).forEach(function (k) { if (on.indexOf(hits[k]) >= 0) setThemeKey(k, hits[k]); });
    }
    function buildThemes() {
        var on = themesOn(), before = themeCount;
        catThemeCache = {};
        restoreThemes();
        groupCache = {};
        // Nothing hidden before nor now (no hidden theme): no change to draw (it drew Home again at start-up)
        if (on.length || before || themeCount) fire("hidden");
        if (!on.length || !merged || !TV.meta || !TV.meta.enabled()) return Promise.resolve();
        var t0 = Date.now();
        return Promise.all(on.map(function (t) {
            return Promise.all([TV.meta.themeTitles(t, "movie"), TV.meta.themeTitles(t, "tv")]).then(function (l) {
                var both = l[0].concat(l[1]);
                return Promise.all([findTitles("movies", both, true), findTitles("series", both, true)]);
            }).then(function (r) { r[0].concat(r[1]).forEach(function (x) { setThemeKey(hideKey(x), t); }); });
        })).then(function () {
            groupCache = {};
            TV.log("hidden themes " + on.join(",") + ": " + themeCount + " titles hidden in " + (Date.now() - t0) + " ms");
            fire("hidden");
        });
    }
    function checkTheme(item, m) {
        var on = themesOn();
        if (!on.length || !m || !item || !item.kind) return;
        for (var i = 0; i < on.length; i++) if (TV.meta.themeMatch(on[i], m)) {
            var k = hideKey(item);
            if (themeKeys[k]) return;
            setThemeKey(k, on[i]);
            var hits = TV.load("themeHits", {}) || {}, keys = Object.keys(hits);
            if (keys.length > 6000) keys.slice(0, keys.length - 6000).forEach(function (x) { delete hits[x]; });
            hits[k] = on[i];
            TV.save("themeHits", hits);
            clearTimeout(themeTimer);
            themeTimer = setTimeout(function () { groupCache = {}; fire("hidden"); }, 1500);
            return;
        }
    }
    function setHidden(x, on) {
        var h = hiddenMap(), k = hideKey(x);
        if (on) h[k] = { t: x.title || x.name, kind: x.kind, at: Date.now() }; else delete h[k];
        TV.save("hidden", h);
        groupCache = {};
        fire("hidden");
    }
    function hiddenList() { var h = hiddenMap(); return Object.keys(h).map(function (k) { return { key: k, t: h[k].t, kind: h[k].kind, at: h[k].at }; }).sort(function (a, b) { return b.at - a.at; }); }
    function unhide(key) { var h = hiddenMap(); delete h[key]; TV.save("hidden", h); fire("hidden"); }

    /* Resume points: id -> { pos, dur, at, item id, series episode } (seconds) */
    function resumes() { return TV.load("resume", {}) || {}; }
    function setResume(id, info) {
        if (info && info.item) keepVirtual(info.item);
        var r = resumes();
        if (!info) delete r[id];
        else { info.at = Date.now(); r[id] = info; }
        trimResumes(r);
        TV.save("resume", r);
    }
    function trimResumes(r) {
        var keys = Object.keys(r);
        if (keys.length > 1500) keys.sort(function (a, b) { return r[a].at - r[b].at; }).slice(0, keys.length - 1500).forEach(function (k) { delete r[k]; });
    }
    function resumeOf(id) { return resumes()[id] || null; }
    function isDone(id) { var e = resumes()[id]; return !!(e && e.done); }
    /* A movie's or an episode's tick: APL TV's own resume point when it has one, else what the media server
       said (js/media.js srvDone: the catalog and the movie's page for a movie, the series page for an episode) */
    function watched(item, ep) { var e = resumes()[ep ? item.id + "|" + ep.id : item.id]; return e ? !!e.done : !!(ep || item).srvDone; }
    /* Marked by hand (OK held): watched or not, a movie, an episode, or many episodes at once */
    function markWatched(item, eps, on) {
        var r = resumes(), list = eps && eps.length ? eps : [null], keys = [];
        // a movie ticked from the server's answer (js/media.js srvDone, kept in the saved catalog): unticked
        // there too, so it does not come back when the app starts again
        var resave = !on && !(eps && eps.length) && item.srvDone && cats[item.src];
        list.forEach(function (ep) {
            var k = ep ? item.id + "|" + ep.id : item.id;
            keys.push(k);
            if (on) r[k] = { pos: 1, dur: 1, item: item.id, ep: ep ? ep.id : null, done: true, manual: true, at: Date.now() };
            else { delete r[k]; (ep || item).srvDone = false; }
        });
        trimResumes(r);
        TV.save("resume", r);
        fire("resume");
        if (resave) TV.idb.set("catm:" + item.src, pack(cats[item.src].movies, "movies", item.src));
        // the same on your Jellyfin or Emby server (js/media.js; other sources: nothing)
        if (TV.media && TV.media.played) TV.media.played(item, eps, on).then(function (ok) { if (ok && on) serverHas(keys); });
    }
    /* Your media server took these (it answered): if it drops one later (marked unwatched there), so does APL TV */
    function serverHas(keys) {
        var r = resumes(), any = false;
        keys.forEach(function (k) { if (r[k] && !r[k].srv) { r[k].srv = true; any = true; } });
        if (any) TV.save("resume", r);
    }
    /* Out of "Continue Watching" (OK held): where you were is forgotten, what you finished stays ticked */
    function forget(item) {
        var r = resumes();
        Object.keys(r).forEach(function (k) { if ((k === item.id || k.indexOf(item.id + "|") === 0) && !(r[k] && r[k].done && k !== item.id)) delete r[k]; });
        TV.save("resume", r);
        // only a media server's resume points can bring it back (syncResumes): nothing to keep for the others
        var src = sourceOf(item);
        if (src && src.type === "jellyfin") {
            var f = forgotten(), keys;
            f[item.id] = Date.now();
            keys = Object.keys(f);
            if (keys.length > 500) keys.sort(function (a, b) { return f[a] - f[b]; }).slice(0, keys.length - 500).forEach(function (k) { delete f[k]; });
            TV.save("resumeForgot", f);
        }
        fire("resume");
    }
    /* When each title was taken out of Continue Watching: a media server's older resume point does not bring it back */
    function forgotten() { return TV.load("resumeForgot", {}) || {}; }
    /* After a video: the rows and covers that show progress are drawn again */
    function resumeChanged() { fire("resume"); }
    /* What your Jellyfin or Emby server knows (js/media.js), title by title: the most recent of the server's
       and APL TV's wins. "gone": the server has no resume point any more (reset, or started again).
       "onlyKnown" (the whole catalog): changes a title APL TV already has, never adds one. */
    function syncResumes(list) {
        var r = resumes(), f = forgotten(), changed = false;
        (list || []).forEach(function (s) {
            if (!s || !s.key) return;
            var mine = r[s.key];
            if (s.onlyKnown && !mine) return;
            // nothing on the server: what it had (srv) was dropped there (marked unwatched) and goes here too,
            // unless it was played here after the question was sent; APL TV's own history, which the server
            // never had, stays
            if (s.none) { if (mine && mine.srv && !(s.asOf && mine.at >= s.asOf)) { delete r[s.key]; changed = true; } return; }
            // the server knows this one now: if it drops it later, so does APL TV
            if (mine && !mine.srv) { mine.srv = true; changed = true; }
            if (mine && mine.at >= s.at) return;
            // watched on both sides: nothing to change (a mark by hand stays one, out of Recently Watched)
            if (mine && mine.done && s.done) return;
            // taken out of Continue Watching after that: it stays out (a watched one still gets its tick)
            if (!s.done && f[s.item] >= s.at) return;
            if (s.gone) { if (mine) { delete r[s.key]; changed = true; } return; }
            var e = { pos: s.pos, dur: s.dur, item: s.item, ep: s.ep || null, at: s.at, srv: true };
            if (s.done) e.done = true;
            if (s.epLabel) e.epLabel = s.epLabel;
            // a series' own line (js/osd.js save): the episode to resume, or the next one ("Up Next")
            if (s.series) e.series = true;
            if (s.upNext) e.upNext = true;
            r[s.key] = e;
            changed = true;
        });
        if (!changed) return false;
        trimResumes(r);
        TV.save("resume", r);
        fire("resume");
        return true;
    }
    /* "Recently Watched": what you played lately, finished or not, the latest first (marks by hand left out) */
    function recentlyWatched(kind) {
        var r = resumes(), seen = {}, out = [];
        Object.keys(r).map(function (k) { return r[k]; }).filter(function (e) { return e && e.item && !e.manual; })
            .sort(function (a, b) { return b.at - a.at; }).forEach(function (e) {
                if (seen[e.item] || !merged) return;
                seen[e.item] = 1;
                var it = (kind !== "series" && merged.movies.byId[e.item]) || (kind !== "movies" && merged.series.byId[e.item]);
                if (!it) { var v = virtualById(e.item); if (v && (kind === "series" ? v.kind === "series" : kind === "movies" ? v.kind === "movie" : true)) it = v; }
                if (it && !isHidden(it)) out.push(it);
            });
        return out.slice(0, 80);
    }
    /* "Continue Watching": the last things started and not finished */
    function continueWatching() {
        var r = resumes(), out = [];
        Object.keys(r).forEach(function (k) {
            var e = r[k];
            if (!e || !e.item || e.manual) return;
            // a series whose episode is over: its next episode waits here ("up next")
            if (!e.upNext && (e.pos < 60 || e.done || (e.dur && e.pos > e.dur * 0.94))) return;
            var it = (merged && (merged.movies.byId[e.item] || merged.series.byId[e.item])) || virtualById(e.item);
            if (it && !isHidden(it)) out.push({ item: it, resume: e, key: k });
        });
        var seen = {};
        return out.sort(function (a, b) { return b.resume.at - a.resume.at; }).filter(function (x) {
            if (seen[x.item.id]) return false;
            seen[x.item.id] = true;
            return true;
        }).slice(0, 20);
    }

    /* ---------- movies and series ---------- */
    /* The same title in several categories or qualities: one card, its versions behind it */
    function versionKey(x) { return S.fold(x.title || x.name) + ":" + (x.year || ""); }
    /* The screen's language first in New and Top Rated: French titles on a French screen, the rest only if there are too few */
    function preferMine(list) {
        var mine = list.filter(function (x) { var c = catOf(x); return c.lang === TV.lang || c.lang === "multi"; });
        return mine.length >= 40 ? mine : list;
    }
    /* The version you chose on a title's page (4K, VOSTFR, another provider…) is the one shown and played next time */
    function versionPrefs() { return TV.load("prefVersion", {}) || {}; }
    function prefKey(x) { return (x.kind === "series" ? "s:" : "m:") + versionKey(x); }
    function preferVersion(x) {
        var p = versionPrefs(), keys = Object.keys(p);
        if (keys.length > 3000) keys.slice(0, keys.length - 3000).forEach(function (k) { delete p[k]; });
        delete p[prefKey(x)]; p[prefKey(x)] = x.id;
        TV.save("prefVersion", p);
        groupCache = {};
    }
    /* Without a choice of yours: the version in the screen's language (dubbed before subtitled), in the best quality
       the screen can show (4K only on a 4K screen). Before, the provider's first one: often HD when FHD or 4K was there. */
    var uhdScreen = null;
    function bestVersion(list) {
        if (uhdScreen === null) { try { uhdScreen = !global.webapis || !!global.webapis.productinfo.isUdPanelSupported(); } catch (e) { uhdScreen = true; } }
        var best = list[0], bestScore = -1;
        list.forEach(function (x) {
            var c = catOf(x), text = (x.name || "") + " " + (c.name || "") + " " + (c.raw || "");
            var lang = c.lang === TV.lang ? 3 : c.lang === "multi" ? 2 : !c.lang ? 1 : 0;
            if (lang === 3 && /\b(VOSTFR|VOST|VOSTA|SUBS?|VO)\b/i.test(text)) lang = 2.5;
            var q = /\b(4K|UHD|2160P?)\b/i.test(text) ? (uhdScreen ? 4 : 2.5) : /\b(FHD|1080P?)\b/i.test(text) ? 3 : /\b(SD|480P?|576P?)\b/i.test(text) ? 1 : 2;
            var score = lang * 10 + q;
            if (score > bestScore) { bestScore = score; best = x; }
        });
        return best;
    }
    function groupVersions(list) {
        var seen = {}, out = [], pref = null;
        list.forEach(function (x) {
            var k = versionKey(x), g = seen[k];
            if (g) { g.versions.push(x); return; }
            seen[k] = { item: x, versions: [x] };
            out.push(seen[k]);
        });
        return out.map(function (g) {
            if (g.versions.length > 1) {
                pref = pref || versionPrefs();
                var want = pref[prefKey(g.item)], chosen = null;
                if (want) for (var i = 0; i < g.versions.length; i++) if (g.versions[i].id === want) { chosen = g.versions[i]; break; }
                g.item = chosen || bestVersion(g.versions);
            }
            g.item.versions = g.versions.length > 1 ? g.versions : null;
            return g.item;
        });
    }
    function itemsIn(kind, catId) { return catId === "top" || catId === "trend" || String(catId).indexOf("g:") === 0 ? itemsInRaw(kind, catId) : groupVersions(itemsInRaw(kind, catId)); }

    /* A title reduced for comparing, in any alphabet (Arabic, Cyrillic… are kept): no case, accents, spaces or punctuation */
    function titleKey(s) {
        s = String(s || "").toLowerCase();
        try { s = s.normalize("NFD").replace(/[\u0300-\u036f]/g, ""); } catch (e) {}
        return s.replace(/[\s\u0000-\u002f\u003a-\u0040\u005b-\u0060\u007b-\u00bf\u2000-\u206f]+/g, "");
    }

    /* An index of your movies and series by title (no accents, no case), built a slice at a time */
    var idxCache = {}, idxWaiting = {};
    function titleIndex(kind) {
        if (idxCache[kind]) return Promise.resolve(idxCache[kind]);
        if (idxWaiting[kind]) return idxWaiting[kind];
        var t0 = Date.now();
        idxWaiting[kind] = new Promise(function (resolve) {
            var items = merged ? merged[kind].items : [], idx = {}, i = 0;
            (function step() {
                var stop = Math.min(items.length, i + 1500);
                for (; i < stop; i++) { var x = items[i], k = titleKey(x.title || x.name); if (k.length > 1) (idx[k] = idx[k] || []).push(x); }
                if (i < items.length) { setTimeout(step, 0); return; }
                idxCache[kind] = idx; delete idxWaiting[kind];
                TV.log("index " + kind + ": " + items.length + " titles in " + (Date.now() - t0) + " ms");
                resolve(idx);
            })();
        });
        return idxWaiting[kind];
    }
    /* A TMDB title your playlist doesn't have, when your Stremio addons have a stream for it that plays here
       (js/stremio.js asks them in the background): a card of its own, played from Stremio. The same object each time,
       and kept once played or put in My List, so Continue Watching and My List find it after a restart. */
    var virt = {}, virtKept = TV.load("virtItems", {}) || {};
    function virtualOf(kind, r, ask) {
        var S2 = TV.stremio, a = S2 && S2.account(), type = kind === "series" ? "series" : "movie";
        if (!a || !r || !r.id) return null;
        var known = S2.knownHas(type, r.id);
        if (known === null && ask) S2.wantHas(type, r.id);
        if (!known) return null;
        var id = a.id + (type === "series" ? "|st" : "|mt") + r.id;
        if (virt[id]) return virt[id];
        var x = { src: a.id, kind: type, name: r.t || r.o, title: r.t || r.o, year: r.y || 0, poster: "", cat: a.id + ":tmdb", rating: 0, added: 0,
                  tmdb: String(r.id), _ref: { id: r.id, t: r.t, o: r.o, y: r.y }, virtual: true, id: id };
        if (type === "series") x.seriesId = "tmdb:" + r.id;
        else { x.sid = "tmdb:" + r.id; x.url = "stremio:" + a.id + ":movie:" + encodeURIComponent("tmdb:" + r.id); }
        virt[id] = x;
        return x;
    }
    function keepVirtual(id) {
        var x = virt[id];
        if (!x || virtKept[id]) return;
        var k = Object.keys(virtKept);
        if (k.length > 300) delete virtKept[k[0]];
        virtKept[id] = { src: x.src, kind: x.kind, name: x.name, title: x.title, year: x.year, tmdb: x.tmdb, seriesId: x.seriesId, sid: x.sid, url: x.url, _ref: x._ref };
        TV.save("virtItems", virtKept);
    }
    function virtualById(id) {
        if (virt[id]) return virt[id];
        var k = virtKept[id];
        if (!k || !TV.stremio || !TV.stremio.account()) return null;
        var x = {}; Object.keys(k).forEach(function (f) { x[f] = k[f]; });
        x.id = id; x.virtual = true; x.poster = ""; x.cat = x.src + ":tmdb"; x.rating = 0; x.added = 0;
        virt[id] = x;
        return x;
    }
    /* TMDB titles (t: title, o: original title, y: year) found in your catalog, in the same order. With a Stremio account,
       the ones your playlist misses too when your addons play them (only: never, for hiding themes). */
    var ASK_PER_LIST = 25;
    function findTitles(kind, list, only) {
        return titleIndex(kind).then(function (idx) {
            var out = [], used = {}, asked = 0;
            list.forEach(function (r) {
                var kt = titleKey(r.t), ko = titleKey(r.o);
                var cands = (kt.length > 1 && idx[kt] || []).concat(ko !== kt && ko.length > 1 && idx[ko] || []), hits = [];
                cands.forEach(function (x) {
                    if (used[x.id]) return;
                    if (r.y && x.year && Math.abs(x.year - r.y) > 1) return;
                    used[x.id] = 1; hits.push(x);
                });
                if (!hits.length) {
                    if (only) return;
                    var v = virtualOf(kind, r, asked < ASK_PER_LIST);
                    if (TV.stremio && TV.stremio.knownHas(kind === "series" ? "series" : "movie", r.id) === null) asked++;
                    if (v && !used[v.id]) { used[v.id] = 1; out.push(v); }
                    return;
                }
                hits.sort(function (a, b) { return (catOf(b).lang === TV.lang ? 1 : 0) - (catOf(a).lang === TV.lang ? 1 : 0); });
                hits.forEach(function (x) { x._ref = r; out.push(x); });
            });
            return out;
        });
    }

    /* A genre: its popular titles found in your catalog, one card per title */
    var genreLists = {}, genreLoading = {}, listSrc = {};
    function oneCardPerTitle(found) {
        var byRef = {}, reps = [];
        found.forEach(function (x) {
            var r = byRef[x._ref.id];
            if (!r) { byRef[x._ref.id] = x; x.versions = null; reps.push(x); return; }
            r.versions = r.versions || [r]; r.versions.push(x);
        });
        return reps;
    }
    function genreItems(kind, gid, quiet) {
        var k = kind + ":" + gid;
        if (genreLists[k]) return Promise.resolve(genreLists[k]);
        if (genreLoading[k]) return genreLoading[k];
        genreLoading[k] = TV.meta.genreTitles(kind === "movies" ? "movie" : "tv", gid).then(function (list) {
            listSrc["genre|" + k] = { kind: kind, list: list };
            return findTitles(kind, list).then(function (found) {
                genreLists[k] = oneCardPerTitle(found);
                delete genreLoading[k];
                TV.log("genre " + k + ": " + genreLists[k].length + " titles in the catalog");
                if (!quiet) fire("genre");
                return genreLists[k];
            });
        }).catch(function (e) { delete genreLoading[k]; TV.log("genre " + k + ": " + e.message); return []; });
        return genreLoading[k];
    }

    /* Classic Movies: EVERY movie of your catalog from 1975 or before (the year in its name, or the one the provider
       gives). The best-known ones first (TMDB's classics found in your catalog, which also brings the ones whose
       name has no year), then all the others, newest first. */
    var CLASSIC_UNTIL = 1975, oldMovies = null;
    function yearOf(v) { var y = parseInt(String(v || "").slice(0, 4), 10); return y > 1880 && y <= new Date().getFullYear() + 1 ? y : 0; }
    function classicMovies(part, ok) {
        var famous = genreLists["movies:x:classic"], seen = {}, out = [];
        if (!famous) genreItems("movies", "x:classic");
        (famous || []).forEach(function (x) {
            if (!ok(x)) return;
            out.push(x);
            (x.versions || [x]).forEach(function (v) { seen[v.id] = 1; });
        });
        if (!oldMovies) oldMovies = part.items.filter(function (x) { return x.year > 0 && x.year <= CLASSIC_UNTIL; });
        var rest = groupVersions(oldMovies.filter(function (x) { return !seen[x.id] && ok(x); }));
        rest.sort(function (a, b) { return (b.year - a.year) || (b.added - a.added); });
        return out.concat(rest);
    }

    /* Your Stremio addons play new titles of these lists: the lists are made again (in place, no "finding…" on screen) */
    function remakeLists() {
        Object.keys(listSrc).forEach(function (key) {
            var s = listSrc[key], parts = key.split("|"), what = parts[0], k = parts.slice(1).join("|");
            findTitles(s.kind, s.list).then(function (found) {
                if (what === "genre") genreLists[k] = oneCardPerTitle(found);
                else if (what === "trend") trendLists[k] = oneCardPerTitle(found);
                else if (what === "top") topLists[k] = oneCardPerTitle(found);
            });
        });
        setTimeout(function () { fire("genre"); fire("trend"); fire("top"); fire("virtual"); }, 400);
    }
    if (TV.stremio && TV.stremio.onHas) TV.stremio.onHas(remakeLists);

    /* "Top Rated": weighted by the number of votes (meta.js), found in your catalog */
    var topLists = {}, topLoading = {};
    function topRatedItems(kind) {
        if (topLists[kind]) return topLists[kind];
        if (!topLoading[kind] && TV.meta && TV.meta.enabled()) {
            topLoading[kind] = true;
            TV.meta.topRated(kind === "movies" ? "movie" : "tv").then(function (list) {
                var m = kind === "movies" ? 3000 : 1000, C = 7.0;
                list.forEach(function (r) { r.wr = (r.v * r.n + C * m) / (r.n + m); });
                list.sort(function (a, b) { return b.wr - a.wr; });
                listSrc["top|" + kind] = { kind: kind, list: list };
                return findTitles(kind, list).then(function (found) {
                    // One card per title: its other versions (another language, 4K…) behind it
                    var byRef = {}, reps = [];
                    found.forEach(function (x) {
                        var r = byRef[x._ref.id];
                        if (!r) { byRef[x._ref.id] = x; x.versions = null; reps.push(x); return; }
                        r.versions = r.versions || [r]; r.versions.push(x);
                    });
                    topLists[kind] = reps;
                    topLoading[kind] = false;
                    TV.log("top rated " + kind + ": " + found.length + " in the catalog, from " + list.length + " TMDB titles");
                    fire("top");
                });
            }).catch(function (e) { topLoading[kind] = false; TV.log("top rated: " + e.message); });
        }
        return null;
    }
    /* "Trending": TMDB's titles of the week found in your catalog, in their order (most watched first) */
    var trendLists = {}, trendLoading = {};
    function trendingItems(kind) {
        if (trendLists[kind]) return trendLists[kind];
        if (!trendLoading[kind] && TV.meta && TV.meta.enabled()) {
            trendLoading[kind] = true;
            TV.meta.trending(kind === "movies" ? "movie" : "tv").then(function (list) {
                listSrc["trend|" + kind] = { kind: kind, list: list };
                return findTitles(kind, list).then(function (found) {
                    trendLists[kind] = oneCardPerTitle(found);
                    trendLoading[kind] = false;
                    TV.log("trending " + kind + ": " + trendLists[kind].length + " in the catalog, from " + list.length + " TMDB titles");
                    fire("trend");
                });
            }).catch(function (e) { trendLoading[kind] = false; TV.log("trending: " + e.message); });
        }
        return null;
    }
    function itemsInRaw(kind, catId) {
        var part = merged && merged[kind];
        if (!part) return [];
        var adult = TV.pref("showAdult"), hid = anyHidden();
        function ok(x) { return (adult || !catOf(x).adult) && (!hid || !isHidden(x)); }
        if (catId === "watched") return recentlyWatched(kind);
        if (catId === "recent") return preferMine(part.items.filter(ok)).slice().sort(function (a, b) { return b.added - a.added; }).slice(0, 300);
        // New releases: recently added AND out this year or last year (an old title added today is not new)
        if (catId === "new") {
            var since = new Date().getFullYear() - 1;
            return preferMine(part.items.filter(function (x) { return x.year >= since && ok(x); })).slice().sort(function (a, b) { return b.added - a.added; }).slice(0, 300);
        }
        if (catId === "trend") {
            var tr = trendingItems(kind);
            return tr ? tr.filter(ok) : [];
        }
        if (catId === "g:x:classic" && kind === "movies") return classicMovies(part, ok);
        if (String(catId).indexOf("g:") === 0) {
            var gl = genreLists[kind + ":" + catId.slice(2)];
            if (gl) return gl.filter(ok);
            genreItems(kind, catId.slice(2));
            return [];
        }
        if (catId === "top") {
            var top = topRatedItems(kind);
            if (top) return top.filter(ok);
            return [];                       // a second, while the list is being found
        }
        if (catId === "mylist") return myList().map(function (id) { var v; return part.byId[id] || ((v = virtualById(id)) && (v.kind === "series") === (kind === "series") ? v : null); }).filter(Boolean);
        if (catId === "all") return part.items.filter(ok);
        return hid ? (part.byCat[catId] || []).filter(ok) : (part.byCat[catId] || []);
    }
    function vodUrl(item, ep) {
        if (ep && ep.url) return ep.url;
        if (item.url) return item.url;
        var src = sourceOf(item);
        if (!src) return "";
        return ep ? xUrl(src, "series", ep.id, ep.ext || "mp4") : xUrl(src, "movie", item.sid, item.ext || "mp4");
    }
    function vodInfo(item) {
        var src = sourceOf(item);
        if (isMedia(src) && modOf(src) && item.kind === "movie") return Promise.resolve(modOf(src).info(item));
        if (!src || src.type !== "xtream" || item.kind !== "movie") return Promise.resolve(null);
        return xApi(src, "get_vod_info", "vod_id=" + item.sid).catch(function () { return null; });
    }
    /* A series' seasons and episodes: from the Xtream server, or the episodes found in the M3U */
    function seriesInfo(item) {
        if (item.eps) {
            var seasons = {};
            item.eps.forEach(function (e) { (seasons[e.season] = seasons[e.season] || []).push({ id: e.id, season: e.season, episode: e.episode, title: "", url: e.url, image: e.image }); });
            Object.keys(seasons).forEach(function (s) { seasons[s].sort(function (a, b) { return a.episode - b.episode; }); });
            return Promise.resolve({ seasons: seasons, info: {} });
        }
        var src = sourceOf(item);
        if (!src) return Promise.resolve({ seasons: {}, info: {} });
        if (src.type === "stalker" && TV.stalker) return TV.stalker.seriesInfo(src, item);
        if (isMedia(src) && modOf(src)) return modOf(src).seriesInfo(src, item);
        return xApi(src, "get_series_info", "series_id=" + item.seriesId).then(function (j) {
            var seasons = {};
            var eps = j && j.episodes || {};
            Object.keys(eps).forEach(function (s) {
                seasons[s] = (eps[s] || []).map(function (e) {
                    var inf = e.info || {};
                    return { id: e.id, season: parseInt(e.season || s, 10), episode: parseInt(e.episode_num, 10) || 0, title: epTitle(e.title, item), ext: e.container_extension || "mp4",
                             image: inf.movie_image || inf.cover_big || "", plot: inf.plot || inf.description || "", dur: parseInt(inf.duration_secs, 10) || 0, tmdb: inf.tmdb_id || "" };
                }).sort(function (a, b) { return a.episode - b.episode; });
            });
            return { seasons: seasons, info: j && j.info || {} };
        });
    }

    /* "Show - S01E02 - The Title" -> "The Title"; nothing left -> "" (the page says "Episode 2") */
    function epTitle(t, item) {
        t = String(t || "");
        var m = t.match(/S\d{1,2}\s*E\d{1,3}\s*[-:.]?\s*(.*)$/i);
        if (m) t = m[1];
        else if (item && (item.title || item.name) && t.toLowerCase().indexOf(String(item.title || item.name).toLowerCase()) === 0) t = t.slice(String(item.title || item.name).length);
        return t.replace(/^[\s\-:|.]+/, "").trim();
    }

    function search(q, limit) {
        q = S.fold(q);
        if (!q || !merged) return { live: [], movies: [], series: [] };
        var words = q.split(" "), adult = TV.pref("showAdult"), hid = anyHidden();
        function match(name, also) {
            var f = S.fold(name) + (also ? " " + S.fold(also) : "");             // a channel you renamed: found by both names
            for (var i = 0; i < words.length; i++) if (f.indexOf(words[i]) === -1) return false;
            return true;
        }
        function scan(arr) {
            var out = [];
            for (var i = 0; i < arr.length && out.length < (limit || 40); i++) {
                var x = arr[i];
                if ((adult || !catOf(x).adult) && match(x.title || x.name, x.orig) && (!hid || !isHidden(x))) out.push(x);
            }
            return out;
        }
        var live = [], seen = {};
        scan(merged.live.chans).forEach(function (c) { if (!seen[c.key]) { seen[c.key] = 1; live.push(c); } });
        // your language first (then multi-language), the rest after, in the same order
        function mineFirst(list) {
            var rank = function (x) { var l = catOf(x).lang; return l === TV.lang ? 0 : (l === "multi" ? 1 : 2); };
            return list.map(function (x, i) { return [rank(x), i, x]; }).sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; }).map(function (r) { return r[2]; });
        }
        return { live: live, movies: mineFirst(groupVersions(scan(merged.movies.items))), series: mineFirst(groupVersions(scan(merged.series.items))) };
    }

    /* Every channel whose variants' key is this name ("tf1"), all qualities and countries (voice: "mets TF1") */
    function channelsNamed(name) {
        if (!merged || !name) return [];
        var adult = TV.pref("showAdult"), hid = anyHidden();
        return merged.live.chans.filter(function (c) {
            return String(c.key || "").split(":").pop() === name && (adult || !catOf(c).adult) && (!hid || !isHidden(c));
        });
    }

    restoreThemes();            // the titles already known for your hidden themes, before anything is drawn
    TV.data = {
        sources: sources, addSource: addSource, removeSource: removeSource, updateSource: updateSource, normServer: normServer, xtreamFromUrl: xtreamFromUrl,
        loadSource: loadSource, start: start, refresh: refresh, onChange: onChange, rebuild: rebuild, xAuth: xAuth, regroup: function () { groupCache = {}; },
        stillComing: function (id) { return !!behind[id]; },
        catalog: function () { return merged; },
        channelsIn: channelsIn, channelsNamed: channelsNamed, channel: channel, streamUrl: streamUrl, catOf: catOf, sourceOf: sourceOf,
        favIds: favIds, isFav: isFav, toggleFav: toggleFav, favChannels: favChannels, moveFav: moveFav,
        chanGroups: chanGroups, chanGroupOf: chanGroupOf, addChanGroup: addChanGroup, renameChanGroup: renameChanGroup, deleteChanGroup: deleteChanGroup, toggleChanGroup: toggleChanGroup, moveInChanGroup: moveInChanGroup,
        pushRecent: pushRecent, recentChannels: recentChannels,
        myList: myList, inMyList: inMyList, toggleMyList: toggleMyList,
        setResume: setResume, resumeOf: resumeOf, continueWatching: continueWatching, isDone: isDone, watched: watched, markWatched: markWatched, recentlyWatched: recentlyWatched,
        forget: forget, resumeChanged: resumeChanged, syncResumes: syncResumes, serverHas: serverHas,
        isHidden: isHidden, setHidden: setHidden, preferVersion: preferVersion, setCatOff: setCatOff, setGroupOff: setGroupOff, groupLabel: groupLabel, editData: editData, renameChannel: renameChannel, applyPhoneEdit: applyPhoneEdit, offGroups: offGroups, offCats: offCats, hiddenList: hiddenList, unhide: unhide, isChanHidden: isChanHidden, setChanHidden: setChanHidden, hiddenChanList: hiddenChanList, unhideChan: unhideChan, versionKey: versionKey,
        buildThemes: buildThemes, checkTheme: checkTheme, themesOn: themesOn, catNameHidden: catNameHidden,
        itemsIn: itemsIn, vodUrl: vodUrl, vodInfo: vodInfo, seriesInfo: seriesInfo, search: search,
        xApi: xApi, parseM3U: parseM3U, pack: pack, unpack: unpack, findTitles: findTitles, titleIndex: titleIndex, genreItems: genreItems,
        genreReady: function (kind, gid) { return !!genreLists[kind + ":" + gid]; }, topReady: function (kind) { return !!topLists[kind]; }
    };
})(window);
