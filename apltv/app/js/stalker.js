/* ============================================================
   stalker.js: Stalker portals (Ministra, the middleware of MAG boxes).
   Some providers give a portal address and a MAC address instead of an
   M3U link or an Xtream login. APL TV then talks to the portal the way a
   MAG box does:
   - handshake (a token), then the box's profile;
   - live channels and their genres, movies and their categories, series
     with their seasons and episodes;
   - at play time, a link asked for each channel or movie (create_link):
     the portal's links last a short time only.
   A portal wants a Cookie with the MAC and a MAG User-Agent, which a TV's
   browser refuses to send: every request goes through APL TV's helper
   (/sget). The helper installed before 1.0.7 does not know it: APL TV then
   says to install the new version once.
   Channels, movies and episodes carry a "stalker:" address that the player
   turns into the real link (js/player.js).
   ============================================================ */
(function (global) {
    "use strict";

    var TV = global.TV, T = TV.t, S = TV.smart;
    var UA = "Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG200 stbapp ver: 2 rev: 250 Safari/533.3";
    var sessions = {};            // source id -> { api, token, at }
    var logins = {};              // source id -> the connection being made (one at a time: a new token can end the others)
    // 80,000 movies and as many series (#30: a portal with more than 40,000 movies); 40,000 on a device with little memory
    var MAX_PAGES = 60, JOBS = 8, MAX_ITEMS = TV.SMALL ? 40000 : 80000;

    /* "00:1a:79:12:34:56", "001A79123456" -> "00:1A:79:12:34:56" */
    function normMac(m) {
        var h = String(m || "").replace(/[^0-9a-f]/gi, "").toUpperCase();
        if (h.length !== 12) return "";
        return h.match(/../g).join(":");
    }
    /* What people paste: http://host:port/c/, http://host/stalker_portal/c/, http://host:port/portal.php… */
    function normPortal(p) {
        p = String(p || "").trim();
        if (p && !/^https?:\/\//i.test(p)) p = "http://" + p;
        return p.replace(/[?#].*$/, "").replace(/\/+$/, "");
    }
    function apiCandidates(portal) {
        var base = normPortal(portal), out = [];
        if (/\.php$/i.test(base)) out.push(base);
        base = base.replace(/\/(c|portal\.php|server\/load\.php)$/i, "").replace(/\/c$/i, "");
        var root = base.replace(/\/stalker_portal(\/.*)?$/i, "");
        if (/stalker_portal/i.test(base)) out.push(root + "/stalker_portal/server/load.php");
        out.push(root + "/portal.php", root + "/server/load.php", root + "/stalker_portal/server/load.php");
        // a portal pasted with a folder of its own (http://host/mag/c/): the host's own paths after (issue #19)
        var host = (/^(https?:\/\/[^\/]+)/i.exec(base) || [])[1];
        if (host && host !== root) out.push(host + "/portal.php", host + "/server/load.php", host + "/stalker_portal/server/load.php");
        return out.filter(function (u, i) { return out.indexOf(u) === i; });
    }
    function headers(src, token) {
        var tz = "Europe/Paris";
        try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || tz; } catch (e) {}
        var root = normPortal(src.portal).replace(/\/(c|portal\.php|server\/load\.php|stalker_portal.*)$/i, "");
        var h = { "User-Agent": UA, "X-User-Agent": "Model: MAG250; Link: WiFi", "Referer": root + "/c/",
                  "Cookie": "mac=" + encodeURIComponent(normMac(src.mac)) + "; stb_lang=en; timezone=" + encodeURIComponent(tz) };
        if (token) h.Authorization = "Bearer " + token;
        return h;
    }
    /* A portal that says it gets too many requests (HTTP 429, or 503): its requests wait and go again (3, 6, then
       12 s later), two at a time from then on, the handshake included (#30: a portal answered 429 even to it). Every
       request to a portal goes through its gate: JOBS at a time, fewer once it said so. */
    var gates = {}, BUSY_WAIT = [3000, 6000, 12000];
    function gateOf(src) { return gates[src.id] || (gates[src.id] = { max: JOBS, on: 0, q: [], until: 0 }); }
    function pump(g) { while (g.on < g.max && g.q.length) g.q.shift()(); }
    function gate(src, fn) {
        var g = gateOf(src);
        return new Promise(function (resolve, reject) {
            g.q.push(function () {
                g.on++;
                var wait = g.until - Date.now();
                (wait > 0 ? new Promise(function (r) { setTimeout(r, wait); }) : Promise.resolve()).then(fn).then(
                    function (v) { g.on--; pump(g); resolve(v); }, function (e) { g.on--; pump(g); reject(e); });
            });
            pump(g);
        });
    }
    function busy(e) { return !!e && (e.status === 429 || e.status === 503); }
    function req(src, api, params, token, timeout, tries) {
        tries = tries || 0;
        var url = api + "?" + params + (params.indexOf("JsHttpRequest") < 0 ? "&JsHttpRequest=1-xml" : "");
        return gate(src, function () { return TV.helper.sget(url, headers(src, token), timeout); }).then(function (text) {
            var j = null;
            try { j = JSON.parse(text); } catch (e) { throw new Error(/authoriz|forbidden|access denied/i.test(text) ? T("The portal refused this MAC address.") : T("The portal did not answer as a Stalker portal.")); }
            return j && j.js !== undefined ? j.js : j;
        }, function (e) {
            if (e && e.old) throw new Error(T("Stalker portals need the new install of APL TV: run APL Launcher Setup again (Samsung) or install the latest .ipk (LG) or .apk (Android) once."));
            if (busy(e)) {
                var g = gateOf(src);
                if (tries < BUSY_WAIT.length) {
                    if (g.max > 2) TV.log("stalker: the portal says too many requests (HTTP " + e.status + "): two at a time, and asked again in a few seconds");
                    g.max = Math.min(g.max, 2);
                    g.until = Math.max(g.until, Date.now() + BUSY_WAIT[tries]);
                    return req(src, api, params, token, timeout, tries + 1);
                }
                var b = new Error(T("The portal says it is getting too many requests. Wait a few minutes, then try again.") + " (HTTP " + e.status + ")");
                b.status = e.status; b.busy = true;
                throw b;
            }
            throw e;
        });
    }

    /* ---------- the session ---------- */
    // Of the addresses tried, the error that tells the most: a MAC refused, then a portal that answered, then a 404
    function worth(e) { return !e ? 0 : /refused this MAC/.test(e.message || "") ? 3 : e.status === 404 || /\b404\b/.test(e.message || "") ? 1 : 2; }
    /* The session of this portal and MAC address: one changed in Settings needs a new handshake */
    function sameKey(s, src) { return !!s && s.key === normPortal(src.portal) + "|" + normMac(src.mac); }
    function login(src, fresh) {
        var s = sessions[src.id];
        if (s && !fresh && sameKey(s, src) && Date.now() - s.at < 20 * 60000) return Promise.resolve(s);
        /* Eight requests at a time: when the token runs out they all ask again. One handshake for all of them,
           or each new token could end the one just given to the others. */
        if (logins[src.id]) return logins[src.id];
        var p = connect(src, s).then(function (ses) { delete logins[src.id]; return ses; }, function (e) { delete logins[src.id]; throw e; });
        logins[src.id] = p;
        return p;
    }
    function connect(src, s) {
        if (!normMac(src.mac)) return Promise.reject(new Error(T("The MAC address must look like 00:1A:79:12:34:56.")));
        var apis = s && s.api ? [s.api] : apiCandidates(src.portal), lastErr = null;
        return apis.reduce(function (p, api) {
            return p.then(function (done) {
                if (done) return done;
                return req(src, api, "type=stb&action=handshake&token=&prehash=0", null, 20000).then(function (j) {
                    var token = j && j.token;
                    if (!token) throw new Error(T("The portal did not answer as a Stalker portal."));
                    var prof = "type=stb&action=get_profile&hd=1&ver=" + encodeURIComponent("ImageDescription: 0.2.18-r23-250; PORTAL version: 5.6.1; API Version: JS API version: 343;") +
                               "&num_banks=2&sn=" + encodeURIComponent(src.sn || "") + "&stb_type=MAG250&client_type=STB&image_version=218&video_out=hdmi&device_id=" + encodeURIComponent(src.id1 || "") +
                               "&device_id2=" + encodeURIComponent(src.id2 || "") + "&signature=&auth_second_step=1&hw_version=1.7-BD-00&not_valid_token=0&timestamp=" + Math.floor(Date.now() / 1000) + "&api_signature=262&prehash=0";
                    return req(src, api, prof, token, 20000).then(function (p) {
                        if (p && (p.status === 1 || p.blocked === "1") && !p.id) throw new Error(T("The portal refused this MAC address."));
                        var ses = { api: api, token: token, at: Date.now(), profile: p || {}, key: normPortal(src.portal) + "|" + normMac(src.mac) };
                        sessions[src.id] = ses;
                        TV.log("stalker: connected (" + api.replace(/^https?:\/\/[^\/]+/, "") + ")");
                        return ses;
                    });
                }).catch(function (e) { if (worth(e) > worth(lastErr)) lastErr = e; if (e && (e.busy || /new install/.test(e.message))) throw e; return null; });
            });
        }, Promise.resolve(null)).then(function (ses) {
            if (!ses) throw lastErr || new Error(T("The portal did not answer as a Stalker portal."));
            return ses;
        });
    }
    /* One request with the session, asked once more when it fails:
       - a token the portal no longer knows: connected again (one handshake for all the requests under way,
         or the token another request just got, see login());
       - the portal's own error or no answer: the same token again. A new handshake there ended the token of
         the other requests under way: 28 errors from a busy portal made 29 handshakes and 182 refused requests. */
    function tokenOk(j) { return !(j === null || j === undefined || j === false || (typeof j === "string" && /auth/i.test(j))); }
    function tokenTrouble(e) { return !e || e.message === "token" || /refused this MAC|did not answer as a Stalker/.test(e.message || "") || e.status === 401 || e.status === 403; }
    function call(src, params, timeout) {
        return login(src).then(function (s) {
            return req(src, s.api, params, s.token, timeout).then(function (j) {
                if (!tokenOk(j)) throw new Error("token");
                return j;
            }).catch(function (e) {
                if (e && (e.busy || /new install/.test(e.message))) throw e;       // a busy portal was already asked again (req)
                var cur = sessions[src.id];
                var next = !tokenTrouble(e) ? s : cur && cur.token !== s.token ? cur : null;
                return (next ? Promise.resolve(next) : login(src, true)).then(function (s2) {
                    return req(src, s2.api, params, s2.token, timeout).then(function (j) { if (!tokenOk(j)) throw new Error("token"); return j; });
                });
            });
        });
    }

    /* ---------- the catalog, in the same shape as an Xtream account's (js/data.js) ---------- */
    function cats(list, srcId, kind, pre) {
        return (Array.isArray(list) ? list : []).filter(function (c) { return c && c.id !== "*" && String(c.id) !== "*"; }).map(function (c) {
            var info = S.category(c.title || c.name || "");
            return { id: srcId + ":" + pre + c.id, name: info.name, raw: info.raw, tag: info.tag, lang: info.lang, adult: info.adult || c.censored == 1, kind: kind, count: 0 };
        });
    }
    function addr(src, kind, cmd, extra) { return "stalker:" + src.id + ":" + kind + ":" + encodeURIComponent(cmd || "") + (extra ? ":" + extra : ""); }
    function img(src, u) {
        if (!u) return "";
        if (/^https?:\/\//i.test(u)) return u;
        var root = normPortal(src.portal).replace(/\/(c|portal\.php|server\/load\.php)$/i, "").replace(/\/stalker_portal.*$/i, "");
        return root + (u.charAt(0) === "/" ? "" : "/") + u;
    }
    /* A portal gives its lists 14 titles or so per page: a big one is hundreds of requests, JOBS at a time
       over every category (no category waiting for another's last pages; the screen's browser lets 6 go to
       the helper at once). A page that fails is asked once more by call(): a page lost was 14 titles missing
       until the next refresh. */
    function page(src, params, p) { return call(src, params + "&p=" + p, 60000); }
    function eachLimit(list, n, fn) {
        var i = 0;
        function next() { if (i >= list.length) return Promise.resolve(); var it = list[i++]; return Promise.resolve(fn(it)).then(next, next); }
        var jobs = [];
        for (var k = 0; k < Math.min(n, list.length); k++) jobs.push(next());
        return Promise.all(jobs);
    }
    /* The first page of every category (its newest titles); the pages left come back as a list */
    function firstPages(src, list, paramsOf, add) {
        var rest = [];
        return eachLimit(list, JOBS, function (ct) {
            var params = paramsOf(ct);
            return page(src, params, 1).then(function (j) {
                var d = (j && j.data) || [], total = parseInt(j && j.total_items, 10) || d.length, per = parseInt(j && j.max_page_items, 10) || d.length || 14;
                add(d, ct);
                var count = Math.min(MAX_PAGES, Math.ceil(total / Math.max(1, per)));
                for (var n = 2; n <= count; n++) rest.push({ ct: ct, params: params, p: n });
            }, function (e) { TV.log("stalker: " + ct.name + ": " + e.message); });
        }).then(function () { return rest; });
    }
    function restPages(src, rest, add, full) {
        return eachLimit(rest, JOBS, function (r) {
            if (full(r)) return;
            return page(src, r.params, r.p).then(function (j) { add((j && j.data) || [], r.ct); }, function (e) { TV.log("stalker: " + r.ct.name + " page " + r.p + ": " + e.message); });
        });
    }
    /* The catalog. onFirst(out), when given, is called once the channels and the first page of every category
       are in: the screen can be used while the other pages come (#19: a big portal took minutes). */
    function load(src, progress, base, onFirst) {
        var out = base, vodCats = {};
        out.type = "stalker";
        /* A series filed among the movies (is_series): many portals keep their shows in the video club (#30). It goes to
           Series, in a category of the same name. Its episodes come with it when the portal lists them there, or are
           asked when its page opens (seriesInfo). */
        function addVodSeries(s, ct) {
            if (out.series.items.length >= MAX_ITEMS) return;
            var cid = src.id + ":v" + ct.id.split(":").pop();
            ct.hasSeries = true;                                                 // its pages are still wanted when the movies are full
            if (!vodCats[cid]) { vodCats[cid] = 1; out.series.cats.push({ id: cid, name: ct.name, raw: ct.raw, tag: ct.tag, lang: ct.lang, adult: ct.adult, kind: "series", count: 0 }); }
            var name = s.name || s.o_name || "", t = S.title(name), list = Array.isArray(s.series) ? s.series : [], sn = seasonOf(name);
            out.series.items.push({
                id: src.id + "|v" + s.id, src: src.id, seriesId: s.id, kind: "series", name: name, title: t.title !== name ? t.title : undefined,
                year: t.year || parseInt(s.year, 10) || 0, poster: img(src, s.screenshot_uri || s.cover_big), cat: cid, rating: parseFloat(s.rating_imdb || s.rating_kinopoisk) || 0,
                added: Date.parse(String(s.added || "").replace(" ", "T")) / 1000 || 0,
                eps: list.length ? list.map(function (n) { var e = parseInt(n, 10) || 0; return { id: s.id + "_" + sn + "_" + e, season: sn, episode: e, url: addr(src, "vod", s.cmd, e) }; }) : undefined
            });
        }
        function addMovies(d, ct) {
            d.forEach(function (m) {
                if (!m || !m.cmd) return;
                if (m.is_series == 1) { addVodSeries(m, ct); return; }
                if (out.movies.items.length >= MAX_ITEMS) return;
                var name = m.name || m.o_name || "", t = S.title(name);
                out.movies.items.push({
                    id: src.id + "|m" + m.id, src: src.id, sid: m.id, url: addr(src, "vod", m.cmd) + "::m" + encodeURIComponent(m.id), kind: "movie", name: name, title: t.title !== name ? t.title : undefined,
                    year: t.year || parseInt(m.year, 10) || 0, poster: img(src, m.screenshot_uri || m.cover_big), cat: ct.id, rating: parseFloat(m.rating_imdb || m.rating_kinopoisk) || 0,
                    added: Date.parse(String(m.added || "").replace(" ", "T")) / 1000 || 0, ext: "mp4"
                });
            });
            progress(T("Loading movies…") + " " + out.movies.items.length);
        }
        function addSeries(d, ct) {
            d.forEach(function (s) {
                if (!s || out.series.items.length >= MAX_ITEMS) return;
                var name = s.name || s.o_name || "", t = S.title(name);
                out.series.items.push({
                    id: src.id + "|s" + s.id, src: src.id, seriesId: s.id, kind: "series", name: name, title: t.title !== name ? t.title : undefined,
                    year: t.year || parseInt(s.year, 10) || 0, poster: img(src, s.screenshot_uri || s.cover_big), cat: ct.id, rating: parseFloat(s.rating_imdb) || 0,
                    added: Date.parse(String(s.added || "").replace(" ", "T")) / 1000 || 0
                });
            });
            progress(T("Loading series…") + " " + out.series.items.length);
        }
        function movieParams(ct) { return "type=vod&action=get_ordered_list&category=" + encodeURIComponent(ct.id.split(":").pop()) + "&genre=*&sortby=added&fav=0"; }
        function seriesParams(ct) { return "type=series&action=get_ordered_list&category=" + encodeURIComponent(ct.id.split(":").pop().replace(/^s/, "")) + "&genre=*&sortby=added&fav=0"; }
        var restM = [], restS = [];
        progress(T("Connecting to {name}…", { name: src.name }));
        /* The session of a few minutes ago when there is one (same portal, same MAC): a new handshake at each refresh
           ended the token a channel or a movie was using, whose requests then made one more, ending this one's (#30:
           three handshakes in 12 s, then "refused this MAC" on 48 pages and 0 movies) */
        return login(src).then(function (ses) {
            return call(src, "type=account_info&action=get_main_info").then(function (a) {
                var exp = a && (a.end_date || a.phone || "");
                var t = Date.parse(String(exp).replace(" ", "T"));
                out.account = { exp: isNaN(t) ? 0 : t, max: 1, formats: [] };
            }, function () {});
        }).then(function () {
            progress(T("Loading channels…"));
            return Promise.all([call(src, "type=itv&action=get_genres"), call(src, "type=itv&action=get_all_channels", 120000)]);
        }).then(function (r) {
            out.live.cats = cats(r[0], src.id, "live", "");
            var list = (r[1] && r[1].data) || (Array.isArray(r[1]) ? r[1] : []), num = 0;
            list.forEach(function (c) {
                if (!c || !c.cmd || S.isSeparator(c.name)) return;
                var info = S.channel(c.name);
                num++;
                out.live.chans.push({
                    id: src.id + "|" + c.id, src: src.id, sid: c.id, url: addr(src, "itv", c.cmd), num: parseInt(c.number, 10) || num, name: info.name, raw: c.name !== info.name ? c.name : undefined,
                    q: info.quality, key: info.key, logo: img(src, c.logo), cat: src.id + ":" + c.tv_genre_id, epg: c.xmltv_id || "", arch: 0
                });
            });
            progress(T("Loading movies…"));
            return call(src, "type=vod&action=get_categories").then(function (vc) {
                out.movies.cats = cats(vc, src.id, "movie", "");
                return firstPages(src, out.movies.cats, movieParams, addMovies).then(function (r) { restM = r; });
            }).catch(function (e) { TV.log("stalker movies: " + e.message); out.failed.movies = e.message; });
        }).then(function () {
            progress(T("Loading series…"));
            return call(src, "type=series&action=get_categories").then(function (sc) {
                /* Only the series module's own categories are asked to it. The ones found among the movies were asked
                   too, under an id it doesn't know: a portal that answers that with all its series made hundreds of
                   pages more, and then said 429 to everything (1.4.1, #30). */
                var own = cats(sc, src.id, "series", "s");
                out.series.cats = own.concat(out.series.cats);                       // before the ones found among the movies
                return firstPages(src, own, seriesParams, addSeries).then(function (r) { restS = r; });
            }).catch(function (e) {
                /* Nothing at all for the series section, even with a new token: a portal without one (its shows are among
                   its movies). Not a failure: as one, it was asked again with the whole portal every 10 minutes (#30) */
                if (e && e.message === "token") { TV.log("stalker: no series section on this portal (its series come from its movies)"); return; }
                TV.log("stalker series: " + e.message); out.failed.series = e.message;
            });
        }).then(function () {
            TV.log("stalker: " + out.live.chans.length + " channels, first pages: " + out.movies.items.length + " movies, " + out.series.items.length + " series; " + (restM.length + restS.length) + " pages left");
            if (onFirst && restM.length + restS.length) onFirst(out);
            /* A movie category stops once the movies are full; one that holds series goes on while the series aren't (#30:
               40,000 movies reached early, and every series category, filed among the movies, kept its first 14 shows) */
            return restPages(src, restM, addMovies, function (r) { return r.ct.hasSeries ? out.series.items.length >= MAX_ITEMS : out.movies.items.length >= MAX_ITEMS; });
        }).then(function () {
            return restPages(src, restS, addSeries, function () { return out.series.items.length >= MAX_ITEMS; });
        }).then(function () {
            TV.log("stalker: " + out.live.chans.length + " channels, " + out.movies.items.length + " movies, " + out.series.items.length + " series");
            return out;
        });
    }

    /* "Show S02", "Season 2": its season; 1 otherwise */
    function seasonOf(name) {
        var m = /\bS(\d{1,2})(?:\b|E\d)|\b(?:season|saison|temporada|staffel|stagione|sezon)\s*(\d{1,2})\b/i.exec(String(name || ""));
        return m ? parseInt(m[1] || m[2], 10) || 1 : 1;
    }
    /* A series' seasons and episodes (asked when its page opens): from the series module, or from the video club for a
       series filed among the movies (its id has "|v") */
    function seriesInfo(src, item) {
        var type = /\|v[^|]*$/.test(item.id) ? "vod" : "series";
        var mid = item.seriesId;
        function listOf(params) { return call(src, "type=" + type + "&action=get_ordered_list&movie_id=" + encodeURIComponent(mid) + params, 60000); }
        function num(x, keys, i) {
            for (var k = 0; k < keys.length; k++) { var v = parseInt(x[keys[k]], 10); if (v > 0) return v; }
            return parseInt(String(x.name || "").replace(/\D+/g, " ").trim().split(" ")[0], 10) || (i + 1);
        }
        /* The episodes of a season given without them (is_season, a newer portal: #30, "no episodes" on every series):
           asked one season at a time, every page; each plays through its own file (resolve, "vodep") */
        function episodesOf(se, sn) {
            var sid = se.id, out = [];
            function pageOf(p) {
                return listOf("&season_id=" + encodeURIComponent(sid) + "&episode_id=0&p=" + p).then(function (j) {
                    var d = (j && j.data) || [];
                    d.forEach(function (ep, i) {
                        if (!ep || ep.is_season) return;
                        var e = num(ep, ["series_number", "episode_number", "number"], out.length + i);
                        out.push({ id: mid + "_" + sn + "_" + e, season: sn, episode: e, title: String(ep.name && !/^\s*(episode|épisode|серия)?\s*\d+\s*$/i.test(ep.name) ? ep.name : ""),
                                   url: "stalker:" + src.id + ":vodep:" + [mid, sid, ep.id, ep.cmd || "", type].map(encodeURIComponent).join(":"), image: img(src, ep.screenshot_uri || ""), plot: "" });
                    });
                    var total = parseInt(j && j.total_items, 10) || 0, per = parseInt(j && j.max_page_items, 10) || d.length || 14;
                    if (d.length && p < 10 && p * per < total) return pageOf(p + 1);
                });
            }
            return pageOf(1).then(function () { return out; }, function (e) { TV.log("stalker: episodes of season " + sn + " of " + mid + ": " + e.message); return out; });
        }
        /* Every page of the seasons (#30: a series of 17 seasons showed 4 to 17, its first three on page 2) */
        function allSeasons(p, acc) {
            return listOf("&season_id=0&episode_id=0&p=" + p).then(function (j) {
                var d = (j && j.data) || [], total = parseInt(j && j.total_items, 10) || 0, per = parseInt(j && j.max_page_items, 10) || d.length || 14;
                acc = acc.concat(d);
                return d.length && p < 10 && p * per < total ? allSeasons(p + 1, acc) : { data: acc };
            });
        }
        return allSeasons(1, []).then(function (j) {
            var seasons = {}, bare = [];
            ((j && j.data) || []).forEach(function (se, si) {
                var sn = num(se, ["season_number"], si);
                var eps = Array.isArray(se.series) ? se.series : [];
                if (!eps.length) { if (se.is_season || se.season_number !== undefined) bare.push({ se: se, sn: sn }); return; }
                seasons[sn] = eps.map(function (n) {
                    var e = parseInt(n, 10) || 0;
                    return { id: mid + "_" + sn + "_" + e, season: sn, episode: e, title: "", url: addr(src, "vod", se.cmd, e), image: "", plot: "" };
                });
            });
            return Promise.all(bare.map(function (b) { return episodesOf(b.se, b.sn).then(function (eps) { if (eps.length) seasons[b.sn] = eps; }); })).then(function () {
                if (!Object.keys(seasons).length) {
                    var first = ((j && j.data) || [])[0];
                    TV.log("stalker: no episodes in the " + type + " answer for " + mid + " (" + ((j && j.data) || []).length + " items" + (first ? ", fields " + Object.keys(first).slice(0, 20).join(",") : "") + ")");
                } else if (bare.length) TV.log("stalker: " + mid + ": episodes asked season by season (" + Object.keys(seasons).length + " seasons)");
                return { seasons: seasons, info: {} };
            });
        });
    }

    /* The real link of a "stalker:" address, asked just before playing (a portal's links expire quickly) */
    /* A movie's or an episode's link played through the helper, asked with the portal's headers as a MAG box asks for it
       (#30: the portal's server refused the TV's own player with HTTP 403, even under other players' names, while its
       channels play directly). Samsung and LG; a helper too old for it (before 1.4.6) leaves the link as it is, and the
       log says the new install is needed. */
    var relayOld = false;
    /* The ways to ask a video's link, tried until its server lets one in (#30: 1.4.6 played through the helper with every
       MAG header and the server still answered 403). makers: [{ name, make() -> a link or "", once }]. Each link is
       tried through the helper with three sets of headers (all the portal's, a MAG box's name and the portal's cookie,
       the name alone): only the answer's status, the connection cut at once. The first that is let in is asked again for
       a fresh link (a portal's link may be good once, unless "once") and played with those headers. Every way refused:
       the first link through the helper, so the error and the report say what happened. */
    function status(u) {
        return new Promise(function (resolve) {
            var x = null, over = false;
            function end(st) { if (over) return; over = true; clearTimeout(t); try { if (x) x.abort(); } catch (e) {} resolve(st); }
            var t = setTimeout(function () { end(-1); }, 10000);
            try {
                x = new XMLHttpRequest();
                x.open("GET", u, true);
                x.onreadystatechange = function () { if (x.readyState >= 2) end(x.status); };
                x.onerror = function () { end(0); };
                x.send();
            } catch (e) { end(0); }
        });
    }
    function playable(src, makers, fail) {
        var i = 0, first = "", s = sessions[src.id], full = headers(src, s && s.token);
        var sets = [["all the portal's", full], ["a MAG box's name and the portal's cookie", { "User-Agent": full["User-Agent"], "Cookie": full.Cookie }], ["a MAG box's name", { "User-Agent": full["User-Agent"] }]];
        var relay = !TV.ANDROID && !relayOld && TV.helper && TV.helper.relay;
        function nextMaker() {
            if (i >= makers.length) {
                if (!first) throw fail;
                if (relay) TV.log("stalker: every way to this video was refused by its server");
                return relay ? viaRelay(src, first) : first;
            }
            var mk = makers[i++];
            return Promise.resolve().then(mk.make).then(function (link) {
                if (!link) return nextMaker();
                if (!first) first = link;
                if (!relay || relayOld) return link;                       // no relay (Android, an old helper): the first link, as before
                var k = 0;
                function nextSet() {
                    if (k >= sets.length) return nextMaker();
                    var set = sets[k++], id = src.id + "-" + k;
                    return TV.helper.relay(link, id, set[1]).then(function (u) {
                        return status(u).then(function (st) {
                            TV.log("stalker: " + mk.name + ", with " + set[0] + " headers: " + (st > 0 ? "HTTP " + st : st === 0 ? "no answer" : "too slow"));
                            if (st !== 200 && st !== 206) return nextSet();
                            if (mk.once) return u;
                            return Promise.resolve().then(mk.make).then(function (fresh) {
                                return fresh && fresh !== link ? TV.helper.relay(fresh, id, set[1]) : u;
                            }, function () { return u; });
                        });
                    }, function (e) {
                        if (e && e.old) { relayOld = true; TV.log("stalker: the installed helper can't relay a portal's videos: install the latest APL TV once (APL Launcher Setup, the .ipk)"); return link; }
                        TV.log("stalker: relay: " + (e && e.message));
                        return nextSet();
                    });
                }
                return nextSet();
            }, function (e) { TV.log("stalker: " + mk.name + ": " + (e && e.message)); return nextMaker(); });
        }
        return nextMaker();
    }
    /* A video's files (a movie's, an episode's): the ways they give, the file's id first ("/media/file_<id>.mpg", how a MAG
       box asks for a file), then its own cmd, then its own address as it is */
    function fileWays(file, ask, linkFrom2) {
        var out = [];
        if (!file) return out;
        if (file.id !== undefined && file.id !== "") out.push({ name: "the file's id", make: function () { var c = "/media/file_" + file.id + ".mpg"; return ask(c).then(function (j) { return linkFrom2(j, ""); }); } });
        if (file.cmd) out.push({ name: "the file's cmd", make: function () { return ask(file.cmd).then(function (j) { return linkFrom2(j, ""); }); } });
        if (/^https?:\/\//i.test(String(file.cmd || ""))) out.push({ name: "the file's own address", once: true, make: function () { return String(file.cmd).replace(/^(ffmpeg|ffrt\d*|auto)\s+/i, "").trim(); } });
        return out;
    }
    function fileLog(what, list, file) {
        TV.log("stalker: " + what + ": " + list.length + " files" + (file ? ", id " + file.id + ", fields " + Object.keys(file).slice(0, 16).join(",") + ", cmd " + TV.redact(String(file.cmd || "")).slice(0, 100) : ""));
    }
    function viaRelay(src, link) {
        if (TV.ANDROID || relayOld || !TV.helper || !TV.helper.relay || !/^https?:\/\//i.test(link)) return Promise.resolve(link);
        var s = sessions[src.id];
        return TV.helper.relay(link, src.id, headers(src, s && s.token)).then(function (u) {
            TV.log("stalker: the video plays through the helper, with the portal's headers");
            return u;
        }, function (e) {
            if (e && e.old) { relayOld = true; TV.log("stalker: the installed helper can't relay a portal's videos: install the latest APL TV once (APL Launcher Setup, the .ipk)"); }
            else TV.log("stalker: relay: " + (e && e.message));
            return link;
        });
    }
    /* An episode asked season by season (seriesInfo): its own list of files first, the first file's link; else its own cmd */
    function linkFrom(j, c) {
        var link = String((j && j.cmd) || "").replace(/^(ffmpeg|ffrt\d*|auto|rtsp)\s+/i, "").trim();
        if (/^(https?|rtsp|rtmp):\/\//i.test(link)) return link;
        link = String(c || "").replace(/^(ffmpeg|ffrt\d*|auto)\s+/i, "").trim();
        return /^https?:\/\//i.test(link) && !/localhost/i.test(link) ? link : "";
    }
    function episodeLink(v) {
        var src = TV.data.sources().filter(function (s) { return s.id === v[1]; })[0];
        if (!src) return Promise.reject(new Error(T("This playlist is no longer there.")));
        var mid = decodeURIComponent(v[2]), sid = decodeURIComponent(v[3]), eid = decodeURIComponent(v[4]), own = decodeURIComponent(v[5]), type = decodeURIComponent(v[6]) || "vod";
        function ask(c) { return call(src, "type=vod&action=create_link&cmd=" + encodeURIComponent(c) + "&series=&forced_storage=0&disable_ad=0&download=0&force_ch_link_check=0", 30000); }
        function noLink(j) { var s = j && (j.error || j.msg) ? " (" + String(j.error || j.msg).slice(0, 80) + ")" : ""; return new Error(T("The portal gave no link for this video.") + s); }
        return call(src, "type=" + type + "&action=get_ordered_list&movie_id=" + encodeURIComponent(mid) + "&season_id=" + encodeURIComponent(sid) + "&episode_id=" + encodeURIComponent(eid) + "&p=1", 30000)
            .then(function (j) { return (j && j.data) || []; }, function () { return []; }).then(function (files) {
                var file = files.filter(function (x) { return x && x.cmd; })[0];
                fileLog("episode " + eid, files, file);
                var ways = fileWays(file, ask, function (j) { return linkFrom(j, ""); });
                if (own) ways.push({ name: "the episode's cmd", make: function () { return ask(own).then(function (j) { return linkFrom(j, own); }); } });
                if (!ways.length) throw noLink(null);
                return playable(src, ways, noLink(null));
            });
    }
    function resolve(url) {
        var ve = String(url).match(/^stalker:([^:]+):vodep:([^:]*):([^:]*):([^:]*):([^:]*):([^:]*)$/);
        if (ve) return episodeLink(ve);
        var m = String(url).match(/^stalker:([^:]+):(itv|vod):([^:]*)(?::(\d*))?(?::m([^:]+))?$/);     // a movie: its id after "::m"
        if (!m) return Promise.reject(new Error("bad stalker address"));
        var src = TV.data.sources().filter(function (s) { return s.id === m[1]; })[0];
        if (!src) return Promise.reject(new Error(T("This playlist is no longer there.")));
        var cmd = decodeURIComponent(m[3]), movieId = m[5] ? decodeURIComponent(m[5]) : "";
        function ask(c, series) {
            return call(src, "type=" + m[2] + "&action=create_link&cmd=" + encodeURIComponent(c) + "&series=" + (series || "") + "&forced_storage=0&disable_ad=0&download=0&force_ch_link_check=0", 30000);
        }
        function linkOf(j, c) {
            var link = String((j && j.cmd) || "").replace(/^(ffmpeg|ffrt\d*|auto|rtsp)\s+/i, "").trim();
            if (/^(https?|rtsp|rtmp):\/\//i.test(link)) return link;
            // some portals give the link directly in the channel's own cmd
            link = String(c || "").replace(/^(ffmpeg|ffrt\d*|auto)\s+/i, "").trim();
            return /^https?:\/\//i.test(link) && !/localhost/i.test(link) ? link : "";
        }
        function said(j) { try { return j && (j.error || j.msg) ? String(j.error || j.msg).slice(0, 80) : ""; } catch (e) { return ""; } }
        function fail(j) {
            var s = said(j);
            return new Error((m[2] === "itv" ? T("The portal gave no link for this channel.") : T("The portal gave no link for this video.")) + (s ? " (" + s + ")" : ""));
        }
        function shown(x) { try { return JSON.stringify(x).slice(0, 400); } catch (e) { return String(x); } }
        if (m[2] === "vod") {
            var lastAnswer = null, filesP = null;
            var ways = [{ name: "the video's cmd", make: function () { return ask(cmd, m[4]).then(function (j) {
                var l = linkOf(j, cmd);
                if (!l) { lastAnswer = j; TV.log("stalker: no link in the portal's answer: " + shown(j) + " (cmd " + TV.redact(cmd).slice(0, 120) + ")"); }
                return l;
            }); } }];
            /* A movie the portal keeps as files (#30: "nothing_to_play", id 0, for every movie it listed): its own list is
               asked once, and its first file's ways come next */
            if (movieId && !m[4]) ways.push({ name: "the movie's files", make: function () {
                filesP = filesP || call(src, "type=vod&action=get_ordered_list&movie_id=" + encodeURIComponent(movieId) + "&season_id=0&episode_id=0&p=1", 30000).then(function (f) {
                    var list = (f && f.data) || [], file = list.filter(function (x) { return x && x.cmd && x.cmd !== cmd; })[0];
                    fileLog("the movie's own list", list, file);
                    fileWays(file, function (c) { return ask(c, ""); }, function (j) { return linkOf(j, ""); }).forEach(function (w) { ways.push(w); });
                }, function () {});
                return filesP.then(function () { return ""; });
            } });
            return playable(src, ways, fail(null)).catch(function (e) { throw lastAnswer && e && /no link/.test(e.message) ? fail(lastAnswer) : e; });
        }
        var found = ask(cmd, m[4]).then(function (j) {
            var link = linkOf(j, cmd);
            if (link) return link;
            // what the portal said and what was asked, for the log and the report (#30: movies a portal gave no link for)
            TV.log("stalker: no link in the portal's answer: " + shown(j) + " (cmd " + TV.redact(cmd).slice(0, 120) + ")");
            /* A movie the portal keeps as files (#30: "nothing_to_play", id 0, for every movie it listed): its own list
               is asked, and the link of its first file */
            if (m[2] !== "vod" || !movieId || m[4]) throw fail(j);
            return call(src, "type=vod&action=get_ordered_list&movie_id=" + encodeURIComponent(movieId) + "&season_id=0&episode_id=0&p=1", 30000).then(function (f) {
                var list = (f && f.data) || [], file = list.filter(function (x) { return x && x.cmd && x.cmd !== cmd; })[0];
                TV.log("stalker: the movie's own list: " + list.length + " items" + (file ? ", cmd " + TV.redact(file.cmd).slice(0, 120) : ""));
                if (!file) throw fail(j);
                return ask(file.cmd, "").then(function (j2) {
                    var l2 = linkOf(j2, file.cmd);
                    if (l2) { TV.log("stalker: link found through the movie's file"); return l2; }
                    TV.log("stalker: no link for the movie's file either: " + shown(j2));
                    throw fail(j2);
                });
            }, function () { throw fail(j); });
        });
        return found;
    }

    /* The short guide of a channel (the channels on screen, like Xtream's get_short_epg) */
    function shortEpg(src, chId) {
        return call(src, "type=itv&action=get_short_epg&ch_id=" + encodeURIComponent(chId) + "&size=10").then(function (j) {
            return (Array.isArray(j) ? j : (j && j.data) || []).map(function (p) {
                return [(parseInt(p.start_timestamp, 10) || 0) * 1000, (parseInt(p.stop_timestamp, 10) || 0) * 1000, String(p.name || ""), String(p.descr || "")];
            }).filter(function (p) { return p[0] && p[1] > p[0]; }).sort(function (a, b) { return a[0] - b[0]; });
        });
    }

    TV.stalker = { load: load, seriesInfo: seriesInfo, resolve: resolve, shortEpg: shortEpg, normMac: normMac, normPortal: normPortal, apiCandidates: apiCandidates };
})(window);
