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
    var MAX_PAGES = 60, PAGE_JOBS = 4, MAX_ITEMS = 40000;

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
    function req(src, api, params, token, timeout) {
        var url = api + "?" + params + (params.indexOf("JsHttpRequest") < 0 ? "&JsHttpRequest=1-xml" : "");
        return TV.helper.sget(url, headers(src, token), timeout).then(function (text) {
            var j = null;
            try { j = JSON.parse(text); } catch (e) { throw new Error(/authoriz|forbidden|access denied/i.test(text) ? T("The portal refused this MAC address.") : T("The portal did not answer as a Stalker portal.")); }
            return j && j.js !== undefined ? j.js : j;
        }, function (e) {
            if (e && e.old) throw new Error(T("Stalker portals need the new install of APL TV: run APL Launcher Setup again (Samsung) or install the latest .ipk (LG) or .apk (Android) once."));
            throw e;
        });
    }

    /* ---------- the session ---------- */
    function login(src, fresh) {
        var s = sessions[src.id];
        if (s && !fresh && Date.now() - s.at < 20 * 60000) return Promise.resolve(s);
        if (!normMac(src.mac)) return Promise.reject(new Error(T("The MAC address must look like 00:1A:79:12:34:56.")));
        var apis = s && s.api ? [s.api] : apiCandidates(src.portal), lastErr = null;
        return apis.reduce(function (p, api) {
            return p.then(function (done) {
                if (done) return done;
                return req(src, api, "type=stb&action=handshake&token=&prehash=0", null, 20000).then(function (j) {
                    var token = j && j.token;
                    if (!token) throw new Error(T("The portal did not answer as a Stalker portal."));
                    var prof = "type=stb&action=get_profile&hd=1&ver=" + encodeURIComponent("ImageDescription: 0.2.18-r23-250; PORTAL version: 5.6.1; API Version: JS API version: 343;") +
                               "&num_banks=2&sn=&stb_type=MAG250&client_type=STB&image_version=218&video_out=hdmi&device_id=&device_id2=&signature=&auth_second_step=1&hw_version=1.7-BD-00&not_valid_token=0&timestamp=" + Math.floor(Date.now() / 1000) + "&api_signature=262&prehash=0";
                    return req(src, api, prof, token, 20000).then(function (p) {
                        if (p && (p.status === 1 || p.blocked === "1") && !p.id) throw new Error(T("The portal refused this MAC address."));
                        var ses = { api: api, token: token, at: Date.now(), profile: p || {} };
                        sessions[src.id] = ses;
                        TV.log("stalker: connected (" + api.replace(/^https?:\/\/[^\/]+/, "") + ")");
                        return ses;
                    });
                }).catch(function (e) { lastErr = e; if (e && /new install/.test(e.message)) throw e; return null; });
            });
        }, Promise.resolve(null)).then(function (ses) {
            if (!ses) throw lastErr || new Error(T("The portal did not answer as a Stalker portal."));
            return ses;
        });
    }
    /* One request with the session; a token the portal no longer knows: connected again, once */
    function call(src, params, timeout) {
        return login(src).then(function (s) {
            return req(src, s.api, params, s.token, timeout).then(function (j) {
                if (j === null || j === undefined || j === false || (typeof j === "string" && /auth/i.test(j))) throw new Error("token");
                return j;
            }).catch(function (e) {
                if (e && /new install|refused this MAC/.test(e.message)) throw e;
                return login(src, true).then(function (s2) { return req(src, s2.api, params, s2.token, timeout); });
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
    /* Every page of a list (a portal gives 14 or so per page): a few pages at a time */
    function pages(src, params, onItems) {
        return call(src, params + "&p=1", 60000).then(function (first) {
            var data = (first && first.data) || [], total = parseInt(first && first.total_items, 10) || data.length, per = parseInt(first && first.max_page_items, 10) || data.length || 14;
            onItems(data);
            var count = Math.min(MAX_PAGES, Math.ceil(total / Math.max(1, per))), next = 2, got = data.length;
            function worker() {
                if (next > count || got >= MAX_ITEMS) return Promise.resolve();
                var p = next++;
                return call(src, params + "&p=" + p, 60000).then(function (j) { var d = (j && j.data) || []; got += d.length; onItems(d); }, function () {}).then(worker);
            }
            var jobs = [];
            for (var k = 0; k < PAGE_JOBS; k++) jobs.push(worker());
            return Promise.all(jobs);
        });
    }
    function load(src, progress, base) {
        var out = base;
        out.type = "stalker";
        progress(T("Connecting to {name}…", { name: src.name }));
        return login(src, true).then(function (ses) {
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
                return out.movies.cats.reduce(function (p, ct) {
                    return p.then(function () {
                        if (out.movies.items.length >= MAX_ITEMS) return;
                        var cid = ct.id.split(":").pop();
                        return pages(src, "type=vod&action=get_ordered_list&category=" + encodeURIComponent(cid) + "&genre=*&sortby=added&fav=0", function (d) {
                            d.forEach(function (m) {
                                if (!m || !m.cmd || m.is_series == 1) return;
                                var name = m.name || m.o_name || "", t = S.title(name);
                                out.movies.items.push({
                                    id: src.id + "|m" + m.id, src: src.id, sid: m.id, url: addr(src, "vod", m.cmd), kind: "movie", name: name, title: t.title !== name ? t.title : undefined,
                                    year: t.year || parseInt(m.year, 10) || 0, poster: img(src, m.screenshot_uri || m.cover_big), cat: ct.id, rating: parseFloat(m.rating_imdb || m.rating_kinopoisk) || 0,
                                    added: Date.parse(String(m.added || "").replace(" ", "T")) / 1000 || 0, ext: "mp4"
                                });
                            });
                            progress(T("Loading movies…") + " " + out.movies.items.length);
                        });
                    });
                }, Promise.resolve());
            }).catch(function (e) { TV.log("stalker movies: " + e.message); out.failed.movies = e.message; });
        }).then(function () {
            progress(T("Loading series…"));
            return call(src, "type=series&action=get_categories").then(function (sc) {
                out.series.cats = cats(sc, src.id, "series", "s");
                return out.series.cats.reduce(function (p, ct) {
                    return p.then(function () {
                        if (out.series.items.length >= MAX_ITEMS) return;
                        var cid = ct.id.split(":").pop().replace(/^s/, "");
                        return pages(src, "type=series&action=get_ordered_list&category=" + encodeURIComponent(cid) + "&genre=*&sortby=added&fav=0", function (d) {
                            d.forEach(function (s) {
                                if (!s) return;
                                var name = s.name || s.o_name || "", t = S.title(name);
                                out.series.items.push({
                                    id: src.id + "|s" + s.id, src: src.id, seriesId: s.id, kind: "series", name: name, title: t.title !== name ? t.title : undefined,
                                    year: t.year || parseInt(s.year, 10) || 0, poster: img(src, s.screenshot_uri || s.cover_big), cat: ct.id, rating: parseFloat(s.rating_imdb) || 0,
                                    added: Date.parse(String(s.added || "").replace(" ", "T")) / 1000 || 0
                                });
                            });
                            progress(T("Loading series…") + " " + out.series.items.length);
                        });
                    });
                }, Promise.resolve());
            }).catch(function (e) { TV.log("stalker series: " + e.message); out.failed.series = e.message; });
        }).then(function () {
            TV.log("stalker: " + out.live.chans.length + " channels, " + out.movies.items.length + " movies, " + out.series.items.length + " series");
            return out;
        });
    }

    /* A series' seasons and episodes (asked when its page opens) */
    function seriesInfo(src, item) {
        return call(src, "type=series&action=get_ordered_list&movie_id=" + encodeURIComponent(item.seriesId) + "&season_id=0&episode_id=0&p=1", 60000).then(function (j) {
            var seasons = {};
            ((j && j.data) || []).forEach(function (se, si) {
                var sn = parseInt(String(se.name || "").replace(/\D+/g, " ").trim().split(" ")[0], 10) || (si + 1);
                var eps = Array.isArray(se.series) ? se.series : [];
                seasons[sn] = eps.map(function (n) {
                    var e = parseInt(n, 10) || 0;
                    return { id: item.seriesId + "_" + sn + "_" + e, season: sn, episode: e, title: "", url: addr(src, "vod", se.cmd, e), image: "", plot: "" };
                });
            });
            return { seasons: seasons, info: {} };
        });
    }

    /* The real link of a "stalker:" address, asked just before playing (a portal's links expire quickly) */
    function resolve(url) {
        var m = String(url).match(/^stalker:([^:]+):(itv|vod):([^:]*)(?::(\d+))?$/);
        if (!m) return Promise.reject(new Error("bad stalker address"));
        var src = TV.data.sources().filter(function (s) { return s.id === m[1]; })[0];
        if (!src) return Promise.reject(new Error(T("This playlist is no longer there.")));
        var cmd = decodeURIComponent(m[3]);
        return call(src, "type=" + m[2] + "&action=create_link&cmd=" + encodeURIComponent(cmd) + "&series=" + (m[4] || "") + "&forced_storage=0&disable_ad=0&download=0&force_ch_link_check=0", 30000).then(function (j) {
            var link = String((j && j.cmd) || "").replace(/^(ffmpeg|ffrt\d*|auto|rtsp)\s+/i, "").trim();
            if (!/^(https?|rtsp|rtmp):\/\//i.test(link)) {
                // some portals give the link directly in the channel's own cmd
                link = cmd.replace(/^(ffmpeg|ffrt\d*|auto)\s+/i, "").trim();
                if (!/^https?:\/\//i.test(link) || /localhost/i.test(link)) throw new Error(T("The portal gave no link for this channel."));
            }
            return link;
        });
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
