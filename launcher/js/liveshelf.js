/* ============================================================
   liveshelf.js — dynamic Top Shelf, like on Apple TV.

   When a streaming app is selected in the dock, its Top
   Shelf shows what is popular right now on that service:
   a large background of the movie / series, with its title and rating.

   Sources:
     Smart Hub        the app's own rows for Samsung's home (Plex's Continue Watching,
                      Spotify's mixes…), first when there are some — Vetro
     TMDB             current movies and series per service, in the screen's country
                      (Netflix, Prime Video, Disney+, CANAL+, TF1+, M6+…) — key
     YouTube Data API trending videos in the screen's country, for TizenTube — key
     Apple (RSS feed) Top albums in the screen's country for music apps — no key
     Fanart.tv        textless HD backgrounds — key (optional)
     Cinemeta         IMDb ratings (Stremio's public service) — no key
     Steam            top sellers (Steam Link, Moonlight, GeForce NOW…) — no key
     Xbox Game Pass   Game Pass games, with their large pictures — no key
     TheSportsDB      next Ligue 1 / Champions League matches — no key
     Dailymotion      trending videos in the screen's country — no key
   Websites (keys.local.js): trending titles of the week or popular anime, depending on the site.

   Responses are kept 6 h on the screen to limit calls.
   Without a key or a network: the app's fixed background stays.
   ============================================================ */
(function (global) {
    "use strict";

    var APL = global.APL;
    /* Apps2Samsung writes the API keys into res/wgt/js/keys.local.js: this launcher's own keys file in the
       full (hybrid) package. The launcher-only package (Tizen 6) carries a second copy at that path
       (tools/make-package.sh), read here when js/keys.local.js has no key. Only the three keys, never run. */
    (function altKeys() {
        var K = global.APL_KEYS = global.APL_KEYS || {};
        if (K.tmdb || K.youtube || K.fanart || !global.tizen || !global.XMLHttpRequest) return;
        try {
            var x = new global.XMLHttpRequest(), m, re = /\b(tmdb|youtube|fanart)\s*:\s*"([A-Za-z0-9_-]+)"/g;
            x.open("GET", "res/wgt/js/keys.local.js", false);
            x.send(null);
            var text = String(x.responseText || "");
            while ((m = re.exec(text))) { if (!K[m[1]]) K[m[1]] = m[2]; }
        } catch (e) {}
    })();
    var KEYS = global.APL_KEYS;
    var TTL = 6 * 3600 * 1000;
    var CACHE_VERSION = 5;              // 3: movies and series carry their title and their rating; 4: Smart Hub items their deep link; 5: "tv" / "movie", translated when shown
    var MIN_VOTES = 20;                 // below that, a rating doesn't mean anything yet

    /* The screen's country, for trending videos, charts, prices and what each service streams there.
       France for every screen before 1.0.14 (issue #21, from India). Samsung's own country for its store
       (db/comss/countrycode, read through Vetro) once known, and kept; until then the screen's time zone,
       then the language's country (fr-FR), else the United States. Without the bridge (The Frame 2022 on
       Tizen 6.5, #21) the country is never read, and the language says en-US on screens all over the world:
       a screen in India got American results, where JioHotstar and Sony LIV have none. */
    function savedRegion() {
        try { var r = global.localStorage.getItem("apl.region") || ""; return /^[A-Z]{2}$/.test(r) ? r : ""; } catch (e) { return ""; }
    }
    /* The screen sets its time zone from its country: the common ones, by country. */
    var ZONES = {
        IN: "Asia/Kolkata Asia/Calcutta", PK: "Asia/Karachi", BD: "Asia/Dhaka", LK: "Asia/Colombo", NP: "Asia/Kathmandu",
        AE: "Asia/Dubai", SA: "Asia/Riyadh", QA: "Asia/Qatar", KW: "Asia/Kuwait", IL: "Asia/Jerusalem Asia/Tel_Aviv",
        SG: "Asia/Singapore", MY: "Asia/Kuala_Lumpur", ID: "Asia/Jakarta", PH: "Asia/Manila", TH: "Asia/Bangkok",
        VN: "Asia/Ho_Chi_Minh Asia/Saigon", HK: "Asia/Hong_Kong", TW: "Asia/Taipei", JP: "Asia/Tokyo", KR: "Asia/Seoul",
        AU: "Australia/Sydney Australia/Melbourne Australia/Brisbane Australia/Perth Australia/Adelaide Australia/Hobart Australia/Darwin",
        NZ: "Pacific/Auckland", ZA: "Africa/Johannesburg", EG: "Africa/Cairo", NG: "Africa/Lagos", KE: "Africa/Nairobi", MA: "Africa/Casablanca",
        GB: "Europe/London", IE: "Europe/Dublin", FR: "Europe/Paris", DE: "Europe/Berlin", ES: "Europe/Madrid Atlantic/Canary",
        IT: "Europe/Rome", NL: "Europe/Amsterdam", BE: "Europe/Brussels", LU: "Europe/Luxembourg", CH: "Europe/Zurich",
        AT: "Europe/Vienna", PT: "Europe/Lisbon", PL: "Europe/Warsaw", CZ: "Europe/Prague", SE: "Europe/Stockholm",
        NO: "Europe/Oslo", DK: "Europe/Copenhagen", FI: "Europe/Helsinki", GR: "Europe/Athens", RO: "Europe/Bucharest",
        HU: "Europe/Budapest", TR: "Europe/Istanbul", UA: "Europe/Kiev Europe/Kyiv", RU: "Europe/Moscow",
        US: "America/New_York America/Chicago America/Denver America/Los_Angeles America/Phoenix America/Anchorage America/Detroit Pacific/Honolulu",
        CA: "America/Toronto America/Vancouver America/Edmonton America/Winnipeg America/Halifax America/Regina America/St_Johns",
        MX: "America/Mexico_City America/Monterrey America/Tijuana", BR: "America/Sao_Paulo", AR: "America/Argentina/Buenos_Aires America/Buenos_Aires",
        CL: "America/Santiago", CO: "America/Bogota", PE: "America/Lima"
    };
    function zoneRegion() {
        var zone = "";
        try { zone = global.tizen && global.tizen.time ? global.tizen.time.getLocalTimezone() : ""; } catch (e) {}
        try { if (!zone && global.Intl) zone = global.Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch (e) {}
        if (!zone) return "";
        for (var cc in ZONES) {
            if (ZONES.hasOwnProperty(cc) && (" " + ZONES[cc] + " ").indexOf(" " + zone + " ") !== -1) return cc;
        }
        return "";
    }
    var REGION = savedRegion() || zoneRegion() || langRegion() || "US";      // after ZONES, which zoneRegion reads
    function langRegion() {
        var m = /[-_]([A-Za-z]{2})$/.exec(String(global.navigator.language || ""));
        return m ? m[1].toUpperCase() : "";
    }
    function readRegion(tries) {
        if (!APL.sys || APL.sys.PREVIEW) return;
        function later() { if (tries > 0) setTimeout(function () { readRegion(tries - 1); }, 30000); }
        APL.sys.exec("vconftool get db/comss/countrycode 2>/dev/null").then(function (r) {
            var m = /value = ([A-Za-z]{2})\b/.exec(String((r && r.output) || ""));
            if (!m) { if (!r || r.ok === false) later(); return; }       // Vetro not up yet; an empty value: kept as is
            var cc = m[1].toUpperCase();
            if (cc === REGION && savedRegion()) return;
            try { global.localStorage.setItem("apl.region", cc); } catch (e) {}
            REGION = cc;
            cacheFor(cc);
        }).catch(later);
    }
    /* What is kept (6 h) was fetched for one country: another one empties it. Before 1.0.14 that was France
       on every screen, whose trending videos then stayed on a screen in India for hours (#21). */
    function cacheFor(cc) {
        var was = "";
        try { was = global.localStorage.getItem("apl.liveRegion") || ""; } catch (e) {}
        if (was === cc) return;
        clearCache();
        try { global.localStorage.setItem("apl.liveRegion", cc); } catch (e) {}
    }
    function clearCache() {
        try {
            var del = [], i;
            for (i = 0; i < global.localStorage.length; i++) {
                var k = global.localStorage.key(i);
                if (k && k.indexOf("apl.live.") === 0) del.push(k);
            }
            del.forEach(function (k) { global.localStorage.removeItem(k); });
        } catch (e) {}
    }
    cacheFor(REGION);
    setTimeout(function () { readRegion(6); }, 20000);

    /* TMDB (JustWatch) "provider" ids of the services (the same in every country). */
    var TMDB_PROVIDERS = {
        netflix: 8, primevideo: "9|119", disneyplus: 337, appletv: 350,
        paramountplus: 531, crunchyroll: 283, rakutentv: 35, plutotv: 300, canalplus: 381,
        jiohotstar: 2336, sonyliv: 237
    };

    function cacheGet(k, anyAge, ttl) {
        try {
            var c = JSON.parse(global.localStorage.getItem("apl.live." + k) || "null");
            if (c && c.v === CACHE_VERSION && (anyAge || Date.now() - c.t < (ttl || TTL)) && c.items && c.items.length) return c.items;
        } catch (e) {}
        return null;
    }
    function cachePut(k, items) {
        try { global.localStorage.setItem("apl.live." + k, JSON.stringify({ v: CACHE_VERSION, t: Date.now(), items: items })); } catch (e) {}
    }

    function getJson(url) {
        return global.fetch(url).then(function (r) {
            if (!r.ok) throw new Error("HTTP " + r.status);
            return r.json();
        });
    }

    var TMDB = "https://api.themoviedb.org/3";
    var IMG = "https://image.tmdb.org/t/p/";

    /* Fanart.tv (free key): textless HD background and title logo, when available. */
    var FANART = "https://webservice.fanart.tv/v3/";
    function fanart(r) {
        if (!KEYS.fanart) return Promise.resolve(null);
        var idP = r._kind === "movie" ? Promise.resolve({ path: "movies/" + r.id })
            : getJson(TMDB + "/tv/" + r.id + "/external_ids?api_key=" + KEYS.tmdb)
                .then(function (x) { return x.tvdb_id ? { path: "tv/" + x.tvdb_id } : null; });
        return idP.then(function (id) {
            if (!id) return null;
            return getJson(FANART + id.path + "?api_key=" + KEYS.fanart).then(function (f) {
                var bgs = (f.moviebackground || f.showbackground || []).filter(function (b) { return !b.lang || b.lang === "" || b.lang === "00"; });
                var bg = (bgs.length ? bgs : (f.moviebackground || f.showbackground || []))[0];
                return { bg: bg ? bg.url : null };
            });
        }).catch(function () { return null; });
    }

    function ratingOf(r) {
        return (r.vote_count || 0) >= MIN_VOTES && r.vote_average ? Math.round(r.vote_average * 10) / 10 : null;
    }
    /* The real IMDb rating, from Stremio's public service. A title that is too recent doesn't have one yet. */
    var CINEMETA = "https://v3-cinemeta.strem.io/meta/";
    function imdbRating(kindOf, imdbId) {
        return getJson(CINEMETA + (kindOf === "tv" ? "series" : "movie") + "/" + imdbId + ".json").then(function (j) {
            var n = parseFloat(j.meta && j.meta.imdbRating);
            return n > 0 ? n : null;
        }).catch(function () { return null; });
    }
    /* The rating of a TMDB result: IMDb if there is one, else TMDB. */
    function noteFor(r, imdbId) {
        var other = { rating: ratingOf(r), ratingFrom: "TMDB" };
        var id = imdbId ? Promise.resolve(imdbId) : getJson(TMDB + "/" + r._kind + "/" + r.id + "/external_ids?api_key=" + KEYS.tmdb).then(function (x) { return x.imdb_id; });
        return id.then(function (i) { return i ? imdbRating(r._kind, i) : null; }).then(function (n) {
            return n ? { rating: n, ratingFrom: "IMDb" } : other;
        }, function () { return other; });
    }
    /* "★ 7.8 IMDb" (with a decimal comma in French) */
    function noteOf(item) { return item.rating ? "★ " + item.rating.toFixed(1).replace(".", APL.lang === "fr" ? "," : ".") + " " + (item.ratingFrom || "TMDB") : ""; }
    /* "★ 7.8 IMDb · 2025 · TV Show" */
    function metaOf(item) {
        var type = item.type === "tv" ? APL.t("TV Show") : item.type === "movie" ? APL.t("content|Movie") : item.type;
        return [noteOf(item), item.year, type].filter(Boolean).join(" · ");
    }

    /* Background of each result (Fanart.tv if it has one, else TMDB), its title and its rating. */
    function decorate(list) {
        return Promise.all(list.map(function (r) {
            return Promise.all([fanart(r), noteFor(r)]).then(function (both) {
                var fa = both[0] || {};
                return {
                    bg: fa.bg || IMG + "w1280" + r.backdrop_path,
                    bgSmall: fa.bg ? fa.bg.replace("/fanart/", "/preview/") : IMG + "w300" + r.backdrop_path,   // enlarged = blurred, for the grid
                    card: IMG + "w780" + r.backdrop_path,
                    title: r.title || r.name || "",
                    rating: both[1].rating,
                    ratingFrom: both[1].ratingFrom,
                    year: String(r.release_date || r.first_air_date || "").substr(0, 4),
                    type: r._kind === "tv" ? "tv" : "movie"                // translated when shown (metaOf): kept 6 h, the language may change
                };
            });
        }));
    }

    function top(results, n) {
        return results.filter(function (r) { return r.backdrop_path; })
            .sort(function (a, b) { return (b.popularity || 0) - (a.popularity || 0); })
            .slice(0, n || 8);
    }
    function kind(k) { return function (r) { r._kind = r._kind || k; return r; }; }

    /* Popular movies and series on a service (Netflix, Prime Video…) in the screen's country. */
    function tmdb(providerId) {
        var common = "api_key=" + KEYS.tmdb + "&language=" + APL.locale + "&watch_region=" + REGION +
                     "&with_watch_providers=" + encodeURIComponent(providerId) + "&sort_by=popularity.desc";
        return Promise.all([
            getJson(TMDB + "/discover/tv?" + common).catch(function () { return { results: [] }; }),
            getJson(TMDB + "/discover/movie?" + common).catch(function () { return { results: [] }; })
        ]).then(function (res) {
            return decorate(top((res[0].results || []).map(kind("tv")).concat((res[1].results || []).map(kind("movie")))));
        });
    }

    /* Trending titles of the week, all services (movie and series websites). */
    function trending() {
        return getJson(TMDB + "/trending/all/week?api_key=" + KEYS.tmdb + "&language=" + APL.locale).then(function (j) {
            return decorate(top((j.results || []).filter(function (r) { return r.media_type === "movie" || r.media_type === "tv"; })
                .map(function (r) { r._kind = r.media_type; return r; })));
        });
    }

    /* Popular Japanese anime (anime websites and apps). */
    function anime() {
        var q = "api_key=" + KEYS.tmdb + "&language=" + APL.locale + "&with_genres=16&with_original_language=ja&sort_by=popularity.desc";
        return Promise.all([
            getJson(TMDB + "/discover/tv?" + q).catch(function () { return { results: [] }; }),
            getJson(TMDB + "/discover/movie?" + q).catch(function () { return { results: [] }; })
        ]).then(function (res) {
            return decorate(top((res[0].results || []).map(kind("tv")).concat((res[1].results || []).map(kind("movie")))));
        });
    }

    /* Music: Top albums in the screen's country, live (Apple's official feed, no key). */
    var MUSIC_KEYS = { applemusic: 1, spotify: 1, deezer: 1, amazonmusic: 1, youtubemusic: 1, tidal: 1, qobuz: 1 };
    function appleCharts() {
        var path = "/api/v2/" + REGION.toLowerCase() + "/music/most-played/12/albums.json";
        return getJson("https://rss.marketingtools.apple.com" + path)
            .catch(function () { return getJson("https://rss.applemarketingtools.com" + path); })
            .then(function (j) {
                return ((j.feed && j.feed.results) || []).map(function (a) {
                    var art = String(a.artworkUrl100 || "");
                    if (!art) return null;
                    return {
                        bg: art.replace(/\/\d+x\d+[a-z]*\.(jpg|png)$/i, "/1600x1600bb.jpg"),
                        bgSmall: art.replace(/\/\d+x\d+[a-z]*\.(jpg|png)$/i, "/300x300bb.jpg"),
                        logo: null,
                        title: a.name || "",
                        sub: (a.artistName ? a.artistName + " · " : "") + APL.t("Top albums")
                    };
                }).filter(Boolean);
            });
    }

    /* YouTube: trending videos in the screen's country (cat = category, e.g. "10" for music). */
    function youtube(cat) {
        var url = "https://www.googleapis.com/youtube/v3/videos?part=snippet&chart=mostPopular&maxResults=10&regionCode=" +
                  REGION + (cat ? "&videoCategoryId=" + cat : "") + "&key=" + KEYS.youtube;
        return getJson(url).then(function (j) {
            return (j.items || []).map(function (v) {
                var t = v.snippet.thumbnails || {};
                var best = t.maxres || t.standard || t.high;
                return best ? { bg: best.url, bgSmall: (t.medium || t.default || best).url, logo: null, title: v.snippet.title, sub: v.snippet.channelTitle } : null;
            }).filter(Boolean);
        });
    }

    /* Games: Steam top sellers in the screen's country (no key). Background = a screenshot of the game at
       1920×1080, title = the game's official logo (else its name). */
    var STEAM_CDN = "https://cdn.akamai.steamstatic.com/steam/apps/";
    var STEAM_LANG = APL.lang === "fr" ? "french" : "english";       // language of the genres
    function games() {
        return getJson("https://store.steampowered.com/api/featuredcategories?cc=" + REGION + "&l=" + STEAM_LANG).then(function (j) {
            var seen = {}, list = [];
            ((j.top_sellers && j.top_sellers.items) || []).concat((j.new_releases && j.new_releases.items) || []).forEach(function (g) {
                if (!g || g.type !== 0 || seen[g.id] || /steam deck|valve index|steam controller/i.test(g.name || "")) return;
                seen[g.id] = 1; list.push(g);
            });
            return Promise.all(list.slice(0, 8).map(function (g) {
                return getJson("https://store.steampowered.com/api/appdetails?appids=" + g.id + "&cc=" + REGION + "&l=" + STEAM_LANG).then(function (d) {
                    var x = d && d[g.id] && d[g.id].success && d[g.id].data;
                    var shot = x && x.screenshots && x.screenshots[0];
                    if (!shot) return null;
                    var genres = (x.genres || []).slice(0, 2).map(function (z) { return z.description; }).join(" · ");
                    return { bg: shot.path_full, bgSmall: shot.path_thumbnail || shot.path_full, logo: STEAM_CDN + g.id + "/logo.png",
                             title: g.name, sub: (genres ? genres + " · " : "") + APL.t("Steam top sellers") };
                }).catch(function () { return null; });
            })).then(function (r) { return r.filter(Boolean); });
        });
    }

    /* Xbox Game Pass: popular Game Pass games (no key), with their large official
       textless picture. The "popular" list, else the whole console catalogue. */
    var GAMEPASS_LISTS = ["eab7757c-ff70-45af-bfa6-79d3cfb2bf81", "f6f1f99f-9b49-4ccd-b3bf-4d9767a77f5e"];
    function gamepass() {
        function ids(list) {
            return getJson("https://catalog.gamepass.com/sigls/v2?id=" + list + "&language=" + APL.locale.toLowerCase() + "&market=" + REGION).then(function (arr) {
                var r = (arr || []).filter(function (x) { return x && x.id; }).map(function (x) { return x.id; }).slice(0, 10);
                if (!r.length) throw new Error("empty list");
                return r;
            });
        }
        return ids(GAMEPASS_LISTS[0]).catch(function () { return ids(GAMEPASS_LISTS[1]); }).then(function (r) {
            return getJson("https://displaycatalog.mp.microsoft.com/v7.0/products?bigIds=" + r.join(",") +
                           "&market=" + REGION + "&languages=" + APL.locale.toLowerCase() + "&MS-CV=APLLauncher.1");
        }).then(function (j) {
            return (j.Products || []).map(function (p) {
                var lp = (p.LocalizedProperties || [])[0] || {}, imgs = lp.Images || [];
                function pick(purpose) { for (var i = 0; i < imgs.length; i++) if (imgs[i].ImagePurpose === purpose) return imgs[i]; return null; }
                var hero = pick("SuperHeroArt") || pick("TitledHeroArt") || pick("Screenshot");
                if (!hero || !hero.Uri) return null;
                var url = (hero.Uri.indexOf("//") === 0 ? "https:" : "") + hero.Uri;
                return { bg: url + "?w=1920&q=85", bgSmall: url + "?w=320&q=70", logo: null,
                         title: lp.ProductTitle || "", sub: "Xbox Game Pass" };
            }).filter(Boolean);
        });
    }

    /* Sport: next Ligue 1 and Champions League matches (TheSportsDB,
       free public key). Background = the match's picture, else a picture of the competition. */
    var SPORTSDB = "https://www.thesportsdb.com/api/v1/json/123/";
    var LEAGUES = [{ id: 4334, name: "Ligue 1" }, { id: 4480, name: APL.t("Champions League") }];
    var DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    function when(e) {
        var d = e.strTimestamp ? new Date(e.strTimestamp.replace(/\+00:00$/, "") + "Z") : null;
        if (!d || isNaN(d.getTime())) return e.dateEvent || "";
        var hh = ("0" + d.getHours()).slice(-2), mm = ("0" + d.getMinutes()).slice(-2);
        return APL.t("{weekday} {month} {day} · {time}", { weekday: APL.t(DAYS[d.getDay()]), month: APL.t(MONTHS[d.getMonth()]), day: d.getDate(), time: hh + ":" + mm });
    }
    function sports() {
        return Promise.all(LEAGUES.map(function (L) {
            return Promise.all([
                getJson(SPORTSDB + "eventsnextleague.php?id=" + L.id).catch(function () { return {}; }),
                getJson(SPORTSDB + "lookupleague.php?id=" + L.id).catch(function () { return {}; })
            ]).then(function (r) {
                var lg = ((r[1] && r[1].leagues) || [])[0] || {};
                var fan = [lg.strFanart1, lg.strFanart2, lg.strFanart3, lg.strFanart4].filter(Boolean);
                var events = ((r[0] && r[0].events) || []).slice(0, 5);
                var items = events.map(function (e, i) {
                    var bg = e.strThumb || e.strFanart || fan[i % (fan.length || 1)];
                    if (!bg) return null;
                    var title = e.strHomeTeam && e.strAwayTeam ? e.strHomeTeam + " – " + e.strAwayTeam : (e.strEvent || L.name);
                    return { bg: bg, bgSmall: bg, logo: lg.strLogo || null, title: title, sub: L.name + " · " + when(e) };
                }).filter(Boolean);
                if (!items.length && fan.length) items.push({ bg: fan[0], bgSmall: fan[0], logo: lg.strLogo || null, title: L.name, sub: APL.t("Upcoming matches") });
                return items;
            });
        })).then(function (r) {
            // The two competitions take turns
            var out = [], a = r[0] || [], b = r[1] || [];
            for (var i = 0; i < Math.max(a.length, b.length); i++) { if (a[i]) out.push(a[i]); if (b[i]) out.push(b[i]); }
            return out;
        });
    }

    /* Dailymotion: trending videos in the screen's country (no key). */
    function dailymotion() {
        return getJson("https://api.dailymotion.com/videos?fields=title,thumbnail_1080_url,thumbnail_240_url,owner.screenname" +
                       "&flags=no_live&sort=trending&country=" + REGION.toLowerCase() + "&localization=" + APL.locale.replace("-", "_") + "&limit=10").then(function (j) {
            return (j.list || []).map(function (v) {
                return v.thumbnail_1080_url ? { bg: v.thumbnail_1080_url, bgSmall: v.thumbnail_240_url || v.thumbnail_1080_url,
                                                logo: null, title: v.title || "", sub: v["owner.screenname"] || "Dailymotion" } : null;
            }).filter(Boolean);
        });
    }

    /* Smart Hub Preview: the rows an app publishes for Samsung's home (webapis.preview.setPreviewData),
       e.g. Plex's Continue Watching or Spotify's mixes. The user's own content, kept by Samsung's content
       service in its private folder: read as root through Vetro. The image URLs can carry the app's
       token (Plex): they stay on the screen and are never logged. */
    var HUB_DB = "/opt/usr/home/owner/apps_rw/com.samsung.tv.contentservicemanager/data/.preview.db";
    var HUB_TTL = 10 * 60 * 1000;
    var HUB_JOIN = " from tiles t join sections s on s._id = t.section_id join accelerators a on a._id = s.accelerator_id";
    var hubPackages = null, hubAt = 0;
    function hubPackage(app) { var m = /^([A-Za-z0-9]{10})[.]/.exec(app.id || ""); return m ? m[1] : null; }
    function hubSql(sql) {
        // Vetro doubles backslashes: none in these commands. Its answer is cut after a few KB.
        return APL.sys.exec("sqlite3 -readonly -json " + HUB_DB + " \"" + sql + "\" 2>/dev/null").then(function (r) {
            // Vetro not up yet (right after a full start): the bridge answers { ok: false } with no exit_code
            // rather than failing. That's not "no rows": it fails, so the list is read again in 15 s. A command
            // that ran and failed (no sqlite3, no preview database) has an exit_code: no rows, no retry loop.
            if (!r || (r.ok === false && r.exit_code === undefined)) throw new Error("Vetro not ready");
            var out = String(r.output || "").trim();
            return out ? JSON.parse(out) : [];
        });
    }
    /* Which apps have tiles: read once, then every 10 minutes. */
    var hubRetry = null;
    function refreshHub() {
        if (APL.sys.PREVIEW || Date.now() - hubAt < HUB_TTL) return;
        hubAt = Date.now();
        hubSql("select distinct a.app_pkg_name pkg" + HUB_JOIN + " where t.image_url like 'http%'").then(function (rows) {
            var before = JSON.stringify(hubPackages);
            hubPackages = {};
            rows.forEach(function (r) { hubPackages[r.pkg] = true; });
            // The app in focus may already show something else: it gets its own rows now
            if (JSON.stringify(hubPackages) !== before && APL.onLiveSources) APL.onLiveSources();
        }, function () {
            // After a full start-up Vetro answers late: again in 15 s, without waiting for a focus change
            hubAt = 0;
            if (!hubRetry) hubRetry = setTimeout(function () { hubRetry = null; refreshHub(); }, 15000);
        });
    }
    /* The tiles' pictures are small: a larger one when the service has it. */
    function hubArt(url, w, h) {
        // Spotify album covers: the size is in the image id (b273 = 640 px, 82c1 = 2000 px)
        if (/^https:[/][/]i[.]scdn[.]co[/]image[/]ab67616d0000(b273|1e02)/.test(url)) return w > 1000 ? url.replace(/ab67616d0000(b273|1e02)/, "ab67616d000082c1") : url;
        // Plex: 240×360 posters; the same transcode address gives the 16:9 artwork
        if (!/[/]photo[/]:[/]transcode[?]/.test(url) || !/%2Fthumb%2F/.test(url)) return url;
        return url.replace(/width=[0-9]+/, "width=" + w).replace(/height=[0-9]+/, "height=" + h)
                  .replace(/%2Fthumb%2F[0-9]+/, "%2Fart");
    }
    function smartHub(pkg) {
        return hubSql("select s.title section, t.title, t.subtitle sub, t.image_url url, coalesce(t.action_play_url, t.action_click_url) link" + HUB_JOIN +
                      " where a.app_pkg_name = '" + pkg + "' and t.image_url like 'http%'" +
                      " order by s.position, s._id, t.position, t._id limit 8").then(function (rows) {
            return rows.map(function (r) {
                return { bg: hubArt(r.url, 1920, 1080), bgSmall: hubArt(r.url, 480, 270), logo: null, link: r.link || null,
                         title: r.title || "", sub: r.section || "",
                         // Under the title (metaOf): an episode or artists, not a playlist's description
                         type: [r.sub && r.sub.length <= 48 ? r.sub : "", r.section].filter(Boolean).join(" · ") };
            });
        });
    }

    /* Which source for this app? (null = no dynamic Top Shelf) */
    /* Settings › Appearance › Top Shelf, in this order: the app's own rows (What You're Watching, hubShelf), what
       is popular (liveShelf), then the app's artwork or the style chosen in Otherwise (launcher.js, genart.js). */
    function sourceFor(app) {
        var pub = APL.sys.pref("liveShelf") ? publicSource(app) : null, pkg = hubPackage(app);
        if (!APL.sys.pref("hubShelf")) return pub;
        refreshHub();
        if (!pkg || !hubPackages || !hubPackages[pkg]) return pub;
        // The app's own rows first; the public source when it has none any more
        return { id: "hub-" + pkg, ttl: HUB_TTL, load: function () {
            return smartHub(pkg).catch(function () { return null; }).then(function (mine) {
                return mine && mine.length ? mine : pub ? pub.load() : null;
            });
        } };
    }
    /* The online demo (PC preview without keys, GitHub Pages): Blender Studio's open movies (CC BY), with
       their TMDB pictures and ratings, stand in for what a movie or video app would show on a screen. */
    var DEMO_FILMS = [
        ["Sintel", 2010, 7.3, "/msqeiEyIRpPAtrCeRGFNZQ9tkJL.jpg"],
        ["Agent 327: Operation Barbershop", 2017, 6.9, "/aupI9kV5CawUp02XWnI2l7Ym9SH.jpg"],
        ["Big Buck Bunny", 2008, 6.5, "/xtdybjRRZ15mCrPOvEld305myys.jpg"],
        ["Charge", 2022, 7.1, "/hwvuivrtKFA4tPkW81txs7oKJOx.jpg"],
        ["Cosmos Laundromat", 2015, 6.3, "/f2wABsgj2lIR2dkDEfBZX8p4Iyk.jpg"],
        ["Sprite Fright", 2021, 7.7, "/aCMT1okuiKFnyKHdCOez66rJKyT.jpg"],
        ["Tears of Steel", 2012, 5.7, "/fOy6SL5Zs2PFcNXwqEPIDPrLB1q.jpg"],
        ["Caminandes: Llamigos", 2016, 6.6, "/tIX2BIhkhoFq1iwtHYzTSbHbe82.jpg"]
    ];
    function demoSource(app) {
        var start = 0, id = String(app.id || ""), i;
        for (i = 0; i < id.length; i++) start = (start + id.charCodeAt(i)) % DEMO_FILMS.length;   // a different film first per app
        return { id: "demo-" + start, load: function () {
            return Promise.resolve(DEMO_FILMS.slice(start).concat(DEMO_FILMS.slice(0, start)).map(function (f) {
                return { bg: IMG + "w1280" + f[3], bgSmall: IMG + "w300" + f[3], card: IMG + "w780" + f[3], title: f[0],
                         rating: f[2], ratingFrom: "TMDB", year: String(f[1]), type: "movie" };
            }));
        } };
    }
    function publicSource(app) {
        /* The demo stands in for a streaming service's own Top Shelf - Netflix,
           Prime Video, Disney+ - because that is what those apps actually carry.
           It used to cover live: "youtube", "trending" and "anime" as well, which
           is why TizenTube showed a Blender Studio film in the preview: a film
           that app does not have. Those apps keep their artwork until their own
           source (a YouTube key, a website) answers. */
        if (APL.sys.PREVIEW && !KEYS.tmdb && (TMDB_PROVIDERS[app.key] || app.tmdbProvider)) return demoSource(app);
        if (app.live === "youtube") return KEYS.youtube ? { id: "youtube", load: function () { return youtube(); } } : null;
        if (app.live === "youtube-music") return KEYS.youtube ? { id: "youtube-10", load: function () { return youtube("10"); } }
                                                              : { id: "music-" + REGION, load: appleCharts };
        if (app.live === "games") return { id: "games-steam", load: games };
        if (app.live === "gamepass") return { id: "gamepass", load: gamepass };
        if (app.live === "sports") return { id: "sports", load: sports };
        if (app.live === "dailymotion") return { id: "dailymotion", load: dailymotion };
        if (app.live === "trending") return KEYS.tmdb ? { id: "trending", load: trending } : null;
        if (app.live === "anime") return KEYS.tmdb ? { id: "anime", load: anime } : null;
        // Streaming service: known in advance, or recognised automatically (autoart.js)
        var p = TMDB_PROVIDERS[app.key] || app.tmdbProvider;
        if (p && KEYS.tmdb) return { id: "tmdb-" + p, load: function () { return tmdb(p); } };
        if (MUSIC_KEYS[app.key] || app.music) return { id: "music-" + REGION, load: appleCharts };
        return null;
    }

    var inflight = {};
    function itemsFor(app) {
        var src = sourceFor(app);
        if (!src) return Promise.resolve(null);
        var cached = cacheGet(src.id, false, src.ttl);
        if (cached) return Promise.resolve(cached);
        if (!inflight[src.id]) {
            inflight[src.id] = src.load().then(function (items) {
                delete inflight[src.id];
                if (items && items.length) cachePut(src.id, items);
                return items && items.length ? items : null;
            }, function () { delete inflight[src.id]; return null; });
        }
        return inflight[src.id];
    }

    /* Right away: what we already have, even if older than 6 h. The update happens on the side, and
       serves the next time: fetching 8 movies from 3 services takes several seconds. */
    function itemsNow(app) {
        var src = sourceFor(app);
        if (!src) return Promise.resolve(null);
        var read = itemsFor(app), old = cacheGet(src.id, true);
        return old ? Promise.resolve(old) : read;
    }

    /* The large artwork of a movie or series, from its title (widgets.js): see keyArt. */
    function same(a, b) {
        function flat(s) { return String(s || "").toLowerCase().replace(/[^a-z0-9À-ſ]+/g, ""); }
        return flat(a) === flat(b);
    }
    function searchArt(title, year) {
        if (!KEYS.tmdb || !title) return Promise.resolve(null);
        return getJson(TMDB + "/search/multi?api_key=" + KEYS.tmdb + "&language=" + APL.locale + "&query=" + encodeURIComponent(title)).then(function (d) {
            var found = (d.results || []).filter(function (r) { return r.backdrop_path && (r.media_type === "tv" || r.media_type === "movie"); });
            // The same title (and the same year, if the provider gives it) before the first one found
            var exact = found.filter(function (r) { return same(r.name || r.title, title) || same(r.original_name || r.original_title, title); });
            var dated = exact.filter(function (r) { return year && String(r.first_air_date || r.release_date || "").substr(0, 4) === year; });
            var hit = dated[0] || exact[0] || found[0];
            if (!hit) return null;
            hit._kind = hit.media_type === "tv" ? "tv" : "movie";
            return artOf(hit);
        }).catch(function () { return null; });
    }
    /* Like on Apple TV, the picture with the title already drawn on it: TMDB tags it with a language, the
       interface's language first. Else the textless background, with the title logo laid over it (widgets.js). */
    function keyArt(hit) {
        var plain = { image: IMG + "w780" + hit.backdrop_path };
        return getJson(TMDB + "/" + hit._kind + "/" + hit.id + "/images?api_key=" + KEYS.tmdb + "&include_image_language=" + APL.lang + ",en,null").then(function (im) {
            function best(list, lang) {
                return (list || []).filter(function (b) { return b.iso_639_1 === lang && b.file_path; })
                    .sort(function (a, b) { return (b.vote_average || 0) - (a.vote_average || 0); })[0];
            }
            var titled = best(im.backdrops, APL.lang) || best(im.backdrops, "en");
            if (titled) return { image: IMG + "w780" + titled.file_path, titled: true };
            var logo = best(im.logos, APL.lang) || best(im.logos, "en");
            return { image: plain.image, logo: logo ? IMG + "w500" + logo.file_path : "" };
        }).catch(function () { return plain; });
    }
    function artOf(hit, imdbId) {
        return Promise.all([noteFor(hit, imdbId), keyArt(hit)]).then(function (both) {
            var n = both[0], k = both[1];
            return { title: hit.title || hit.name, image: k.image, titled: !!k.titled, logo: k.logo || "", rating: n.rating, ratingFrom: n.ratingFrom };
        });
    }
    /* The same from an IMDb id (Stremio uses them). */
    function findImdb(imdbId) {
        if (!KEYS.tmdb || !/^tt[0-9]+$/.test(imdbId)) return Promise.resolve(null);
        return getJson(TMDB + "/find/" + imdbId + "?api_key=" + KEYS.tmdb + "&language=" + APL.locale + "&external_source=imdb_id").then(function (d) {
            var film = (d.movie_results || []).filter(function (r) { return r.backdrop_path; })[0];
            var show = (d.tv_results || []).filter(function (r) { return r.backdrop_path; })[0];
            var hit = film || show;
            if (!hit) return null;
            hit._kind = film ? "movie" : "tv";
            return artOf(hit, imdbId);
        }).catch(function () { return null; });
    }

    // Once Vetro is up (system.js checks it at 4 s): the first app in focus already has its own rows
    if (!APL.sys.PREVIEW) setTimeout(refreshHub, 6000);

    APL.live = {
        searchArt: searchArt,
        findImdb: findImdb,
        itemsFor: itemsFor,
        itemsNow: itemsNow,
        noteOf: noteOf,
        metaOf: metaOf,
        hasSource: function (app) { return !!sourceFor(app); },
        keys: function () { return { tmdb: !!KEYS.tmdb, youtube: !!KEYS.youtube, fanart: !!KEYS.fanart }; },
        region: function () { return REGION; }                           // the screen's country (autoart.js too)
    };
})(window);
