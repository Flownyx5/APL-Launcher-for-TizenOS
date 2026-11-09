/* ============================================================
   meta.js: real information on movies and series.
   - TMDB (your key, from APL Launcher): plot in your language, tagline,
     genres, runtime, cast, director, backdrop, the title's logo, episode
     names and pictures.
   - The real IMDb rating, from Stremio's public Cinemeta service (as in
     APL Launcher's Top Shelf).
   A provider title is cleaned first (smart.js: "FR - Avatar (2009) 4K" ->
   "Avatar", 2009). Results are kept in IndexedDB for 30 days.
   ============================================================ */
(function (global) {
    "use strict";

    var TV = global.TV, S = TV.smart;
    /* The TMDB key: the one APL Launcher Setup writes in js/keys.local.js, or the one typed in Settings */
    var KEY = (global.TV_KEYS && global.TV_KEYS.tmdb) || (TV.load && TV.load("tmdbKey", "")) || "";
    var API = "https://api.themoviedb.org/3", IMG = "https://image.tmdb.org/t/p/";
    var CINEMETA = "https://v3-cinemeta.strem.io/meta/";
    var MAX_AGE = 30 * 86400 * 1000;
    var memo = {}, inflight = {};

    function tmdb(path, params) {
        var u = API + path + (path.indexOf("?") < 0 ? "?" : "&") + "api_key=" + KEY + (params ? "&" + params : "");
        return TV.fetchJSON(u, { timeout: 15000, noProxy: true });
    }
    function img(p, size) { return p ? IMG + (size || "w780") + p : ""; }

    function cacheKey(item) {
        var t = S.title(item.name || item.title);
        return "v5:" + (item.kind === "series" ? "tv" : "movie") + ":" + S.fold(t.title) + ":" + (t.year || item.year || "");
    }

    function pickLogo(images) {
        var logos = images && images.logos || [];
        var pref = [TV.lang, "en", null];
        for (var i = 0; i < pref.length; i++) {
            for (var j = 0; j < logos.length; j++) if (logos[j].iso_639_1 === pref[i] && !/\.svg$/i.test(logos[j].file_path)) return img(logos[j].file_path, "w500");
        }
        return "";
    }

    function imdbRating(kind, imdbId) {
        if (!imdbId) return Promise.resolve(0);
        return TV.fetchJSON(CINEMETA + (kind === "tv" ? "series" : "movie") + "/" + imdbId + ".json", { timeout: 12000, noProxy: true }).then(function (j) {
            var n = parseFloat(j && j.meta && j.meta.imdbRating);
            return n > 0 ? n : 0;
        }).catch(function () { return 0; });
    }

    /* The best TMDB result for a provider's title. Each result is scored: the same title (or original title)
       wins; otherwise the share of words in common, both ways ("Steel Ball Run JoJo" is not "JoJo's Bizarre
       Adventure"); the year must agree when it is known. A doubtful match is refused: no information is
       better than the wrong poster, plot and logo. */
    function words(s) { return S.fold(s).split(" ").filter(function (w) { return w.length > 1 || /\d/.test(w); }); }
    function closeness(title, r) {
        var ft = S.fold(title), q = words(title), best = 0;
        [r.title || r.name || "", r.original_title || r.original_name || ""].forEach(function (c) {
            if (!c) return;
            if (S.fold(c) === ft) { best = 1; return; }
            var cw = words(c);
            if (!cw.length || !q.length) return;
            var a = 0, b = 0;
            q.forEach(function (w) { if (cw.indexOf(w) >= 0) a++; });
            cw.forEach(function (w) { if (q.indexOf(w) >= 0) b++; });
            best = Math.max(best, Math.min(a / q.length, b / cw.length) * 0.95);
        });
        return best;
    }
    function pick(results, title, year) {
        var best = null, bestScore = -1;
        results.slice(0, 8).forEach(function (r, i) {
            var c = closeness(title, r), y = parseInt(String(r.release_date || r.first_air_date || "").slice(0, 4), 10) || 0;
            var ok = c >= 0.6 || (year && y === year && ((i <= 1 && c >= 0.3) || (i === 0 && c > 0)));   // TMDB's first answer with the same year and a word in common
            if (!ok) return;
            var s = c * 100 + Math.max(0, 8 - i * 2) + Math.min(6, Math.log(1 + (r.vote_count || 0)));
            if (year && y) s += y === year ? 25 : (Math.abs(y - year) === 1 ? 8 : -40);
            if (s > bestScore) { bestScore = s; best = r; }
        });
        return best;
    }
    function search(kind, title, year) {
        var q = "query=" + encodeURIComponent(title) + "&language=" + TV.locale + "&include_adult=false";
        var y = year ? (kind === "tv" ? "&first_air_date_year=" : "&year=") + year : "";
        return tmdb("/search/" + kind, q + y).then(function (j) {
            var found = pick(j && j.results || [], title, year);
            if (found || !y) return found;
            return tmdb("/search/" + kind, q).then(function (j2) { return pick(j2 && j2.results || [], title, year); });
        });
    }

    function details(kind, id) {
        var lang = TV.locale;
        return tmdb("/" + kind + "/" + id, "language=" + lang + "&append_to_response=credits,external_ids,images,videos,keywords&include_image_language=" + TV.lang + ",en,null").then(function (d) {
            var needEn = !d.overview && TV.lang !== "en";
            return (needEn ? tmdb("/" + kind + "/" + id, "language=en-US").then(function (en) { d.overview = en.overview; d.tagline = d.tagline || en.tagline; return d; }, function () { return d; }) : Promise.resolve(d));
        }).then(function (d) {
            var imdbId = d.imdb_id || (d.external_ids && d.external_ids.imdb_id) || "";
            return imdbRating(kind, imdbId).then(function (rating) {
                var crew = d.credits && d.credits.crew || [];
                var directors = crew.filter(function (c) { return c.job === "Director"; }).slice(0, 2);
                if (!directors.length && d.created_by) directors = d.created_by.slice(0, 2);
                var director = directors.map(function (c) { return c.name; });
                var trailer = (d.videos && d.videos.results || []).filter(function (v) { return v.site === "YouTube" && v.type === "Trailer"; })[0];
                return {
                    tmdbId: d.id, kind: kind, title: d.title || d.name || "", original: d.original_title || d.original_name || "",
                    overview: d.overview || "", tagline: d.tagline || "",
                    year: parseInt(String(d.release_date || d.first_air_date || "").slice(0, 4), 10) || 0,
                    runtime: d.runtime || (d.episode_run_time && d.episode_run_time[0]) || 0,
                    genres: (d.genres || []).map(function (g) { return g.name; }).slice(0, 3),
                    backdrop: img(d.backdrop_path, "w1280"), poster: img(d.poster_path, "w500"), logo: pickLogo(d.images),
                    imdbId: imdbId, imdb: rating, tmdb: d.vote_count > 20 ? Math.round(d.vote_average * 10) / 10 : 0,
                    cast: (d.credits && d.credits.cast || []).slice(0, 20).map(function (c) { return { id: c.id, name: c.name, role: c.character || "", photo: img(c.profile_path, "w185") }; }),
                    director: director, seasons: d.number_of_seasons || 0, trailer: trailer ? trailer.key : "",
                    collection: d.belongs_to_collection ? { id: d.belongs_to_collection.id, name: d.belongs_to_collection.name || "" } : null,
                    genreIds: (d.genres || []).map(function (g) { return g.id; }), lang: d.original_language || "",
                    kw: (d.keywords && (d.keywords.keywords || d.keywords.results) || []).map(function (k) { return k.id; }),
                    companies: (d.production_companies || []).slice(0, 3).map(function (c) { return c.id; }),
                    directors: directors.map(function (c) { return { id: c.id, name: c.name }; }),
                    cert: "", at: Date.now()
                };
            });
        });
    }

    /* Everything about a movie or a series (item from data.js; tmdbId when the provider gives it) */
    function lookup(item, tmdbId) {
        if (!KEY || !item) return Promise.resolve(null);
        var key = cacheKey(item), fly = key + (tmdbId ? "#" + tmdbId : "");
        if (memo[key] && (!tmdbId || memo[key].tmdbId === tmdbId)) return Promise.resolve(memo[key]);
        if (inflight[fly]) return inflight[fly];
        var kind = item.kind === "series" ? "tv" : "movie";
        var p = TV.idb.get("meta:" + key).then(function (saved) {
            if (saved && Date.now() - saved.at < MAX_AGE && (!tmdbId || saved.tmdbId === tmdbId)) return saved;
            var t = S.title(item.name || item.title);
            var id = tmdbId ? Promise.resolve({ id: tmdbId }) : search(kind, t.title || item.title, t.year || item.year);
            return id.then(function (r) {
                if (!r) { var none = { none: true, at: Date.now() }; TV.idb.set("meta:" + key, none); return none; }
                return details(kind, r.id).then(function (m) { TV.idb.set("meta:" + key, m); return m; });
            });
        }).then(function (m) {
            delete inflight[fly];
            m = m && !m.none ? m : null;
            memo[key] = m;
            if (m && TV.data && TV.data.checkTheme) TV.data.checkTheme(item, m);
            return m;
        }, function (e) { delete inflight[fly]; TV.log("meta " + item.title + ": " + e.message); return null; });
        inflight[fly] = p;
        return p;
    }

    /* A rating Cinemeta does not have yet (often a new title): IMDb's own daily file, through the helper
       service. Asked in groups, once every 12 hours per title; the cover gets its badge when it comes. */
    var imdbWait = {}, imdbPending = {}, imdbTimer = null;
    function askImdb(id) {
        if (imdbPending[id]) return imdbPending[id];
        imdbPending[id] = new Promise(function (resolve) { imdbWait[id] = resolve; });
        if (!imdbTimer) imdbTimer = setTimeout(flushImdb, 1500);
        return imdbPending[id];
    }
    function flushImdb() {
        imdbTimer = null;
        var ids = Object.keys(imdbWait).slice(0, 500), waiting = {};
        ids.forEach(function (id) { waiting[id] = imdbWait[id]; delete imdbWait[id]; });
        if (Object.keys(imdbWait).length) imdbTimer = setTimeout(flushImdb, 1500);
        function settle(ratings) {
            ids.forEach(function (id) { delete imdbPending[id]; waiting[id](ratings ? (ratings[id] || 0) : -1); });
        }
        TV.helper.imdb(ids).then(settle, function (e) {
            // A helper installed before this feature (Samsung screens until APL Launcher Setup runs again)
            // answers 404: not asked again today. Otherwise again in 10 minutes.
            imdbOffUntil = Date.now() + (/HTTP 404/.test(e.message) ? 24 * 3600 * 1000 : 10 * 60 * 1000);
            TV.log("imdb ratings: " + e.message);
            settle(null);
        });
    }
    var imdbOffUntil = 0;
    function fillImdb(key, m) {
        if (!m || !m.imdbId || m.imdb || !TV.helper || !TV.helper.imdb || Date.now() < imdbOffUntil || (m.imdbTry && Date.now() - m.imdbTry < 12 * 3600 * 1000)) return null;
        return askImdb(m.imdbId).then(function (r) {
            if (r < 0) return null;                    // the helper could not answer: asked again next time
            m.imdbTry = Date.now();
            if (r) m.imdb = r;
            TV.idb.set("meta:" + key, m);
            return r ? m : null;
        });
    }

    /* Ratings for the covers on screen, a few at a time */
    var queue = [], running = 0;
    function want(item, cb) {
        var key = cacheKey(item);
        function done(m) {
            cb(m);
            var late = fillImdb(key, m);
            if (late) late.then(function (m2) { if (m2) { try { cb(m2); } catch (e) {} } });
        }
        if (key in memo) { done(memo[key]); return; }
        queue.push({ item: item, cb: done });
        pump();
    }
    function pump() {
        while (running < 4 && queue.length) {
            var job = queue.pop();                    // the most recent first: what was just put on screen
            running++;
            lookup(job.item, job.item._ref && job.item._ref.id).then(function (j) { return function (m) { running--; try { j.cb(m); } catch (e) {} pump(); }; }(job));
        }
    }
    function clearQueue() { queue = []; }

    /* A season's episodes from TMDB: names, plots and pictures in your language */
    function season(tvId, n) {
        if (!KEY || !tvId) return Promise.resolve(null);
        var key = "season:" + tvId + ":" + n + ":" + TV.lang;
        return TV.idb.get(key).then(function (saved) {
            if (saved && Date.now() - saved.at < MAX_AGE) return saved;
            return tmdb("/tv/" + tvId + "/season/" + n, "language=" + TV.locale).then(function (s) {
                var out = { at: Date.now(), eps: {} };
                (s.episodes || []).forEach(function (e) { out.eps[e.episode_number] = { name: e.name, overview: e.overview, still: img(e.still_path, "w500"), runtime: e.runtime || 0 }; });
                TV.idb.set(key, out);
                return out;
            });
        }).catch(function () { return null; });
    }

    /* ---------- the best rated, with many votes ----------
       TMDB's titles rated by at least 1,500 people (series: 400), 300 of each. data.js finds them in your
       catalog and orders them by weighted rating, the formula of IMDb's Top 250:
         WR = (v x R + m x C) / (v + m)   R its rating, v its votes, C = 7.0, m = 3,000 (series: 1,000)
       A title rated 10 by three people stays far behind Breaking Bad's 8.9 from 15,000 people. */
    function topRated(kind) {
        if (!KEY) return Promise.resolve([]);
        var key = "top:" + kind + ":" + TV.lang, minVotes = kind === "movie" ? 1500 : 400;
        return TV.idb.get(key).then(function (saved) {
            if (saved && Date.now() - saved.at < 7 * 86400 * 1000) return saved.list;
            var pages = []; for (var p = 1; p <= 15; p++) pages.push(p);
            return Promise.all(pages.map(function (p) {
                return tmdb("/discover/" + kind, "language=" + TV.locale + "&sort_by=vote_average.desc&vote_count.gte=" + minVotes + "&include_adult=false&page=" + p)
                    .then(function (j) { return j && j.results || []; }, function () { return []; });
            })).then(function (all) {
                var list = [], seen = {};
                all.forEach(function (rs) { rs.forEach(function (r) {
                    if (seen[r.id]) return; seen[r.id] = 1;
                    list.push({ id: r.id, t: r.title || r.name || "", o: r.original_title || r.original_name || "", y: parseInt(String(r.release_date || r.first_air_date || "").slice(0, 4), 10) || 0, v: r.vote_average || 0, n: r.vote_count || 0 });
                }); });
                if (list.length) TV.idb.set(key, { at: Date.now(), list: list });
                return list;
            });
        }).catch(function () { return []; });
    }

    /* What everyone is watching this week (TMDB's trending list, 100 titles), most popular first; data.js
       finds them in your catalog. Kept 12 hours. */
    function trending(kind) {
        if (!KEY) return Promise.resolve([]);
        var key = "trend:" + kind + ":" + TV.lang;
        return TV.idb.get(key).then(function (saved) {
            if (saved && Date.now() - saved.at < 12 * 3600 * 1000) return saved.list;
            return Promise.all([1, 2, 3, 4, 5].map(function (p) {
                return tmdb("/trending/" + kind + "/week", "language=" + TV.locale + "&page=" + p)
                    .then(function (j) { return j && j.results || []; }, function () { return []; });
            })).then(function (all) {
                var list = [], seen = {};
                all.forEach(function (rs) { rs.forEach(function (r) {
                    if (seen[r.id] || r.adult) return; seen[r.id] = 1;
                    list.push({ id: r.id, t: r.title || r.name || "", o: r.original_title || r.original_name || "", y: parseInt(String(r.release_date || r.first_air_date || "").slice(0, 4), 10) || 0, v: r.vote_average || 0, n: r.vote_count || 0 });
                }); });
                if (list.length) TV.idb.set(key, { at: Date.now(), list: list });
                return list;
            });
        }).catch(function () { return []; });
    }

    /* ---------- genres (TMDB, the same database as the ratings) ----------
       The genres' names in your language, and for each genre its most popular titles (with enough votes to
       be real), 160 of them; data.js finds them in your catalog. Kept 7 days. */
    /* Smart categories TMDB has no genre for: anime (Japanese animation), K-drama, horror series (a keyword),
       studios (Ghibli, Pixar…), the platforms a series comes from (Netflix, HBO…), languages (Bollywood…) */
    var SPECIAL = {
        anime: { name: "Anime", q: { movie: "with_genres=16&with_original_language=ja", tv: "with_genres=16&with_original_language=ja" } },
        kdrama: { name: "K-drama", q: { tv: "with_original_language=ko&with_genres=18" } },
        kmovie: { name: "Korean Cinema", q: { movie: "with_original_language=ko" } },
        horror: { name: "Horror", q: { tv: "with_keywords=315058" } },
        bolly: { name: "Bollywood", q: { movie: "with_original_language=hi" } },
        turkish: { name: "Turkish Series", q: { tv: "with_original_language=tr" } },
        xmas: { name: "Christmas", q: { movie: "with_keywords=207317", tv: "with_keywords=207317" } },
        truestory: { name: "True Stories", q: { movie: "with_keywords=9672" } },
        hero: { name: "Superheroes", q: { movie: "with_keywords=9715", tv: "with_keywords=9715" } },
        ghibli: { name: "Studio Ghibli", q: { movie: "with_companies=10342" } },
        pixar: { name: "Pixar", q: { movie: "with_companies=3" } },
        disney: { name: "Disney", q: { movie: "with_companies=2" } },
        marvel: { name: "Marvel", q: { movie: "with_companies=420" } },
        dreamworks: { name: "DreamWorks", q: { movie: "with_companies=521" } },
        netflix: { name: "Netflix", q: { tv: "with_networks=213" } },
        hbo: { name: "HBO", q: { tv: "with_networks=49" } },
        appletv: { name: "Apple TV+", q: { tv: "with_networks=2552" } },
        disneyplus: { name: "Disney+", q: { tv: "with_networks=2739" } },
        prime: { name: "Prime Video", q: { tv: "with_networks=1024" } },
        canal: { name: "Canal+", q: { tv: "with_networks=285" } }
    };
    var GENRES = {
        movie: [28, 35, 18, 27, "x:anime", 53, 878, 16, 12, 80, 10751, 14, 10749, 9648, "x:hero", "x:truestory", "x:kmovie", "x:bolly", 99, 10752, 36, 37, 10402,
                "x:xmas", "x:ghibli", "x:pixar", "x:disney", "x:marvel", "x:dreamworks"],
        tv: [18, 35, "x:anime", "x:kdrama", "x:horror", 80, 10759, 10765, 9648, "x:netflix", "x:hbo", "x:appletv", "x:disneyplus", "x:prime", "x:canal",
             16, 10751, 10762, 99, 10764, "x:turkish", "x:xmas", "x:hero", 10768, 37, 10766]
    };
    function genres(kind) {
        if (!KEY) return Promise.resolve([]);
        var key = "genres2:" + kind + ":" + TV.lang;
        return TV.idb.get(key).then(function (saved) {
            if (saved && Date.now() - saved.at < MAX_AGE) return saved.list;
            return tmdb("/genre/" + kind + "/list", "language=" + TV.locale).then(function (j) {
                var names = {};
                (j.genres || []).forEach(function (g) { names[g.id] = g.name; });
                GENRES[kind].forEach(function (id) { var sp = String(id).indexOf("x:") === 0 && SPECIAL[id.slice(2)]; if (sp) names[id] = TV.t(sp.name); });
                var list = GENRES[kind].filter(function (id) { return names[id]; }).map(function (id) { return { id: id, name: names[id] }; });
                if (list.length) TV.idb.set(key, { at: Date.now(), list: list });
                return list;
            });
        }).catch(function () { return []; });
    }
    function genreTitles(kind, id) {
        if (!KEY) return Promise.resolve([]);
        var key = "genre:" + kind + ":" + id + ":" + TV.lang;
        return TV.idb.get(key).then(function (saved) {
            if (saved && Date.now() - saved.at < 7 * 86400 * 1000) return saved.list;
            var pages = []; for (var p = 1; p <= 8; p++) pages.push(p);
            return Promise.all(pages.map(function (p) {
                var sp = String(id).indexOf("x:") === 0 && SPECIAL[id.slice(2)], filter = sp ? sp.q[kind] : "with_genres=" + id;
                if (!filter) return Promise.resolve([]);
                return tmdb("/discover/" + kind, "language=" + TV.locale + "&" + filter + "&sort_by=popularity.desc&vote_count.gte=" + (kind === "movie" ? (sp ? 80 : 150) : (sp ? 30 : 60)) + "&include_adult=false&page=" + p)
                    .then(function (j) { return j && j.results || []; }, function () { return []; });
            })).then(function (all) {
                var list = [], seen = {};
                all.forEach(function (rs) { rs.forEach(function (r) {
                    if (seen[r.id]) return; seen[r.id] = 1;
                    list.push({ id: r.id, t: r.title || r.name || "", o: r.original_title || r.original_name || "", y: parseInt(String(r.release_date || r.first_air_date || "").slice(0, 4), 10) || 0, v: r.vote_average || 0, n: r.vote_count || 0 });
                }); });
                if (list.length) TV.idb.set(key, { at: Date.now(), list: list });
                return list;
            });
        }).catch(function () { return []; });
    }

    /* ---------- "More Like This": TMDB's recommendations, then similar titles; and a movie's saga ---------- */
    function brief(r) {
        return { id: r.id, t: r.title || r.name || "", o: r.original_title || r.original_name || "", y: parseInt(String(r.release_date || r.first_air_date || "").slice(0, 4), 10) || 0,
                 v: r.vote_average || 0, n: r.vote_count || 0, g: r.genre_ids || [], l: r.original_language || "" };
    }
    /* TMDB's recommendations alone are weak (for Spirited Away, Totoro comes 13th). So the candidates are
       ranked again: the same studio first when it shares a genre (the other Ghibli films for Spirited Away),
       then genres in common, the same original language (anime with anime, K-drama with K-drama), how
       well known each one is, and TMDB's own order. */
    function similar(kind, m) {
        var id = m && m.tmdbId;
        if (!KEY || !id) return Promise.resolve([]);
        var key = "similar2:" + kind + ":" + id + ":" + TV.lang;
        return TV.idb.get(key).then(function (saved) {
            if (saved && Date.now() - saved.at < 7 * 86400 * 1000) return saved.list;
            var p = "language=" + TV.locale, studio = (m.companies || [])[0];
            var asks = [tmdb("/" + kind + "/" + id + "/recommendations", p + "&page=1"), tmdb("/" + kind + "/" + id + "/recommendations", p + "&page=2"), tmdb("/" + kind + "/" + id + "/similar", p + "&page=1"),
                        studio ? tmdb("/discover/" + kind, p + "&with_companies=" + studio + "&sort_by=vote_count.desc&page=1") : Promise.resolve(null)];
            return Promise.all(asks.map(function (q) { return q.then(function (j) { return j && j.results || []; }, function () { return []; }); })).then(function (all) {
                var genres = m.genreIds || [], score = {}, byId = {};
                function add(r, s) {
                    if (r.id === id) return;
                    var b = byId[r.id] || (byId[r.id] = brief(r)), common = 0;
                    b.g.forEach(function (g) { if (genres.indexOf(g) >= 0) common++; });
                    if (s.studio && !common) return;                  // the same studio but nothing alike: left out
                    var x = s.base + common * 6 + (m.lang && b.l === m.lang ? 5 : 0) + Math.min(8, Math.log(1 + b.n));
                    score[r.id] = Math.max(score[r.id] || 0, x) + (score[r.id] ? 6 : 0);   // found by two ways: a bonus
                }
                all[0].forEach(function (r, i) { add(r, { base: 30 - i * 0.6 }); });
                all[1].forEach(function (r, i) { add(r, { base: 18 - i * 0.6 }); });
                all[2].forEach(function (r, i) { add(r, { base: 14 - i * 0.4 }); });
                all[3].forEach(function (r, i) { add(r, { base: 40 - i * 0.8, studio: true }); });
                var list = Object.keys(score).sort(function (a, b) { return score[b] - score[a]; }).map(function (k) { return byId[k]; });
                TV.idb.set(key, { at: Date.now(), list: list });
                return list;
            });
        }).catch(function () { return []; });
    }
    /* A director's other movies (or a creator's other series), the best known first */
    function byPerson(pid, kind) {
        return person(pid).then(function (p) {
            if (!p) return [];
            var seen = {}, out = [];
            p.credits.filter(function (c) { return (c.role === "Director" || c.role === "Creator") && c.kind === kind; })
                .sort(function (a, b) { return b.pop - a.pop; }).forEach(function (c) { var k = c.t + c.y; if (!seen[k]) { seen[k] = 1; out.push(c); } });
            return out;
        });
    }
    function collection(id) {
        if (!KEY || !id) return Promise.resolve([]);
        var key = "saga:" + id + ":" + TV.lang;
        return TV.idb.get(key).then(function (saved) {
            if (saved && Date.now() - saved.at < 7 * 86400 * 1000) return saved.list;
            return tmdb("/collection/" + id, "language=" + TV.locale).then(function (c) {
                var list = (c.parts || []).slice().sort(function (a, b) { return String(a.release_date || "9").localeCompare(String(b.release_date || "9")); }).map(brief);
                TV.idb.set(key, { at: Date.now(), list: list });
                return list;
            });
        }).catch(function () { return []; });
    }

    /* ---------- themes you can hide (Settings > Hidden Themes) ----------
       Each theme is a set of TMDB keywords (horror for movies: its genre). Titles tagged with one of them are
       found two ways: TMDB's best known titles of the theme, matched in your catalog at start-up; and any
       other title whose information arrives with one of the keywords. */
    var THEMES = {
        lgbt: { name: "LGBTQ+", kw: [158718, 363345, 264386, 290527, 250606, 329968, 824, 258533, 337701, 367506, 376382, 239239, 355881, 275157, 10180, 15136, 265777, 9833, 1862, 382157, 240305, 163037, 346769, 253337, 387912, 362383] },
        sex: { name: "Sex and Nudity", kw: [281741, 256466, 267122, 302868, 298666, 10031, 155301] },
        adultanim: { name: "Adult Animation", kw: [161919] },
        gore: { name: "Gore", kw: [10292, 344603, 367142, 381001] },
        violence: { name: "Violence and Torture", kw: [312898, 262404, 13006, 157714] },
        abuse: { name: "Sexual Violence and Abuse", kw: [570, 171662, 15241, 739, 264551, 184988, 516, 11925] },
        suicide: { name: "Suicide and Self-Harm", kw: [236, 233130] },
        drugs: { name: "Drugs", kw: [14964, 1803, 156117] },
        alcohol: { name: "Alcohol", kw: [567, 7464, 15237, 33457] },
        smoking: { name: "Smoking", kw: [919] },
        horror: { name: "Horror", kw: [315058], genre: 27 },
        occult: { name: "Occult and Paranormal", kw: [156174, 3099, 5545, 40931, 15001, 9853, 11627] },
        zombies: { name: "Zombies", kw: [12377, 186565] },
        killers: { name: "Serial Killers", kw: [10714, 227428] },
        war: { name: "War", kw: [273967], genre: 10752, tvGenre: 10768 },
        religion: { name: "Religion", kw: [11001, 186, 187] },
        politics: { name: "Politics", kw: [6078] },
        animals: { name: "Animal Cruelty", kw: [205685, 344244] }
    };
    /* The provider's own categories with a hidden theme in their name go too ("FR| LGBT", "Horreur"…) */
    var THEME_WORDS = {
        lgbt: /(^|[^a-z])(lgbt\w*|queer|gays?|lesbi\w*|pride|transgen\w*|homosex\w*)([^a-z]|$)/i,
        sex: /(^|[^a-z])(erotic\w*|[ée]rotique\w*|sexy|nudit\w*|xxx)([^a-z]|$)/i,
        adultanim: /(^|[^a-z])(adult animation|animation adulte)([^a-z]|$)/i,
        horror: /(^|[^a-z])(horreur|horror|[ée]pouvante)([^a-z]|$)/i,
        war: /(^|[^a-z])(guerre|war|militaire|military)([^a-z]|$)/i,
        religion: /(^|[^a-z])(religi\w*|chr[ée]tien\w*|islam\w*|biblique|bible|spirituel\w*)([^a-z]|$)/i,
        occult: /(^|[^a-z])(paranormal|occult\w*|surnaturel\w*)([^a-z]|$)/i,
        zombies: /zombie/i, gore: /(^|[^a-z])gore([^a-z]|$)/i, drugs: /(^|[^a-z])(drogues?|drugs?)([^a-z]|$)/i
    };
    function themeWords(theme) { return THEME_WORDS[theme] || null; }
    function themes() { return Object.keys(THEMES).map(function (id) { return { id: id, name: TV.t(THEMES[id].name) }; }); }
    function themeMatch(theme, m) {
        var t = THEMES[theme];
        if (!t || !m) return false;
        if (t.genre && m.kind === "movie" && (m.genreIds || []).indexOf(t.genre) >= 0) return true;
        if (t.tvGenre && m.kind === "tv" && (m.genreIds || []).indexOf(t.tvGenre) >= 0) return true;
        for (var i = 0; i < (m.kw || []).length; i++) if (t.kw.indexOf(m.kw[i]) >= 0) return true;
        return false;
    }
    function themeTitles(theme, kind) {
        var t = THEMES[theme];
        if (!KEY || !t) return Promise.resolve([]);
        var key = "theme2:" + theme + ":" + kind + ":" + TV.lang;
        return TV.idb.get(key).then(function (saved) {
            if (saved && Date.now() - saved.at < 7 * 86400 * 1000) return saved.list;
            // the best known titles of the theme, and the recent ones (what "New" rows show)
            var filter = t.genre && kind === "movie" ? "with_genres=" + t.genre : (t.tvGenre && kind === "tv" ? "with_genres=" + t.tvGenre : "with_keywords=" + t.kw.join("|")), asks = [];
            var since = new Date(Date.now() - 2 * 365 * 86400000).toISOString().slice(0, 10), dateKey = kind === "movie" ? "primary_release_date.gte=" : "first_air_date.gte=";
            for (var p = 1; p <= 12; p++) asks.push("&page=" + p);
            for (var q = 1; q <= 6; q++) asks.push("&" + dateKey + since + "&page=" + q);
            return Promise.all(asks.map(function (a) {
                return tmdb("/discover/" + kind, "language=" + TV.locale + "&" + filter + "&sort_by=popularity.desc" + a).then(function (j) { return j && j.results || []; }, function () { return []; });
            })).then(function (all) {
                var list = [], seen = {};
                all.forEach(function (rs) { rs.forEach(function (r) { if (!seen[r.id]) { seen[r.id] = 1; list.push(brief(r)); } }); });
                if (list.length) TV.idb.set(key, { at: Date.now(), list: list });
                return list;
            });
        }).catch(function () { return []; });
    }

    /* ---------- a person: photo, biography, and everything they played in or directed ---------- */
    function person(id) {
        if (!KEY || !id) return Promise.resolve(null);
        var key = "person2:" + id + ":" + TV.lang;
        return TV.idb.get(key).then(function (saved) {
            if (saved && Date.now() - saved.at < MAX_AGE) return saved;
            return tmdb("/person/" + id, "language=" + TV.locale + "&append_to_response=combined_credits").then(function (p) {
                var bio = p.biography ? Promise.resolve(p.biography) : (TV.lang !== "en" ? tmdb("/person/" + id, "language=en-US").then(function (e) { return e.biography || ""; }, function () { return ""; }) : Promise.resolve(""));
                return bio.then(function (b) {
                    var cc = p.combined_credits || {}, credits = [];
                    (cc.cast || []).forEach(function (c) { credits.push(credit(c, c.character || "")); });
                    (cc.crew || []).forEach(function (c) { if (c.job === "Director" || c.job === "Creator") credits.push(credit(c, c.job)); });
                    var out = { at: Date.now(), id: p.id, name: p.name, photo: img(p.profile_path, "h632"), bio: b, dept: p.known_for_department || "", gender: p.gender || 0,
                                birthday: p.birthday || "", deathday: p.deathday || "", place: p.place_of_birth || "", credits: credits };
                    TV.idb.set(key, out);
                    return out;
                });
            });
        }).catch(function (e) { TV.log("person " + id + ": " + e.message); return null; });
    }
    function credit(c, role) {
        return { id: c.id, kind: c.media_type === "tv" ? "tv" : "movie", t: c.title || c.name || "", o: c.original_title || c.original_name || "",
                 y: parseInt(String(c.release_date || c.first_air_date || "").slice(0, 4), 10) || 0, pop: c.popularity || 0, role: role, eps: c.episode_count || 0 };
    }

    /* ---------- age ratings: each country its own rules ----------
       TMDB gives a movie's rating per country and per release (cinema, DVD, TV…): the cinema one first.
       A series has one rating per country. Kept 30 days. Shown for the country of the screen (or the one
       chosen in Settings); if that country has none, the US one with "US" in front. */
    var COUNTRIES = ["FR", "BE", "CH", "CA", "US", "GB", "DE", "ES", "IT", "NL", "PT", "BR"];
    var certMemo = {}, RELEASE_ORDER = [3, 2, 4, 5, 1, 6];
    function certs(kind, id) {
        if (!KEY || !id) return Promise.resolve(null);
        var key = "cert:" + kind + ":" + id;
        if (certMemo[key]) return Promise.resolve(certMemo[key]);
        return TV.idb.get(key).then(function (saved) {
            if (saved && Date.now() - saved.at < MAX_AGE) return saved.c;
            return tmdb("/" + kind + "/" + id + (kind === "tv" ? "/content_ratings" : "/release_dates")).then(function (j) {
                var out = {};
                (j && j.results || []).forEach(function (r) {
                    var cc = r.iso_3166_1;
                    if (kind === "tv") { if (r.rating) out[cc] = r.rating; return; }
                    var best = "", rank = 99;
                    (r.release_dates || []).forEach(function (d) {
                        if (!d.certification) return;
                        var k = RELEASE_ORDER.indexOf(d.type); if (k < 0) k = 9;
                        if (k < rank) { rank = k; best = d.certification; }
                    });
                    if (best) out[cc] = best;
                });
                out._k = kind;
                TV.idb.set(key, { at: Date.now(), c: out });
                return out;
            });
        }).then(function (c) { certMemo[key] = c || {}; return certMemo[key]; }).catch(function () { return null; });
    }
    /* Automatic: the region of the screen's language ("fr-BE" -> BE); French alone -> France, English alone ->
       United States. (Tizen's own "country" answers en_US on a French screen: not used.) */
    function ageCountry() {
        var p = TV.pref("ageRegion");
        if (p && p !== "auto") return p;
        var nl = String(global.navigator && (global.navigator.language || global.navigator.userLanguage) || ""), m = nl.match(/[-_]([A-Za-z]{2})$/);
        if (m && COUNTRIES.indexOf(m[1].toUpperCase()) >= 0 && nl.slice(0, 2).toLowerCase() === TV.lang) return m[1].toUpperCase();
        return { fr: "FR", de: "DE", es: "ES", it: "IT", nl: "NL", pt: "PT" }[TV.lang] || "US";
    }
    /* The rating as people know it in that country, and how strict it is (0 all, 1 some, 2 teens, 3 adults) */
    function ageLabel(cc, v) {
        var s = String(v).trim(), up = s.toUpperCase(), n = parseInt(s.replace(/\D/g, ""), 10) || 0, label = s, lvl = 0;
        if (/^(TP|U|AL|T|0|G|APTA|A|L|TV-Y|TV-G|E|ALL)$/.test(up)) { lvl = 0; label = cc === "FR" ? TV.t("All Ages") : (cc === "DE" ? "FSK 0" : s); }
        else if (cc === "FR") { label = "-" + n; }
        else if (cc === "DE") { label = "FSK " + n; }
        else if (cc === "IT" && up === "VM14") { label = "14+"; n = 14; }
        else if (cc === "IT" && up === "VM18") { label = "18+"; n = 18; }
        if (/^(R|NC-17|TV-MA|X|R18|18A|18\+)$/.test(up)) n = Math.max(n, 17);
        if (/^(PG-13|TV-14|14A|14\+|12A)$/.test(up)) n = Math.max(n, 13);
        if (/^(PG|TV-PG|KT|TV-Y7)$/.test(up)) n = Math.max(n, 7);
        if (lvl === 0 && n) lvl = n >= 17 ? 3 : n >= 15 ? 2 : n >= 12 ? 1 : 0;
        if (n >= 16 && n < 17) lvl = 2;
        if (n >= 18) lvl = 3;
        return { label: label, lvl: lvl };
    }
    /* No official rating in your country: the age another country gives (its neighbours first), written the
       way your country writes it (PG-13 in the US -> -12 in France, R -> -16, TV-MA -> -16). */
    var NEAR = { FR: ["BE", "CH", "CA", "DE", "NL", "ES", "IT", "GB"], BE: ["FR", "NL", "DE"], CH: ["DE", "FR", "IT"], CA: ["US", "FR"], US: ["CA", "GB"],
                 GB: ["IE", "US", "NL"], DE: ["CH", "NL", "FR"], ES: ["PT", "FR", "IT"], IT: ["FR", "ES", "DE"], NL: ["BE", "DE", "GB"], PT: ["ES", "BR", "FR"], BR: ["PT", "US"] };
    var ANY = ["DE", "GB", "NL", "FR", "ES", "IT", "CA", "BR", "US"];
    function minAge(cc, v) {
        var up = String(v).toUpperCase().trim(), n = parseInt(up.replace(/^M\//, "").replace(/\D/g, ""), 10);
        var named = { G: 0, U: 0, TP: 0, AL: 0, KT: 0, T: 0, L: 0, APTA: 0, A: 0, "TV-Y": 0, "TV-G": 0, C: 0, E: 0,
                      PG: 8, "TV-Y7": 7, C8: 8, "TV-PG": 10, "PG-13": 13, "TV-14": 14, "14A": 14, "12A": 12, R: 17, "TV-MA": 17, "NC-17": 18, "18A": 18, R18: 18, X: 18,
                      VM14: 14, VM18: 18 };
        if (named[up] !== undefined) return cc === "CA" && up === "R" ? 18 : named[up];
        return isNaN(n) ? -1 : n;
    }
    /* The big banner of Home and the screen saver show only titles without an adult rating (PG-13 at most in
       the US, under 18 in the UK and Germany): an "all audiences" film can still have a racy backdrop
       (Charlie Wilson's War: all audiences in France, R in the US). Rows and search keep everything. */
    var bannerMemo = {};
    function bannerSafe(item) {
        if (!item) return Promise.resolve(false);
        if (bannerMemo[item.id] !== undefined) return Promise.resolve(bannerMemo[item.id]);
        return lookup(item).then(function (m) {
            if (!m || !m.tmdbId) return true;                 // nothing known about it: kept
            return certs(item.kind === "series" ? "tv" : "movie", m.tmdbId).then(function (c) {
                var worst = 0;
                ["US", "GB", "DE", "FR", ageCountry()].forEach(function (cc) { if (c && c[cc]) worst = Math.max(worst, minAge(cc, c[cc])); });
                return worst < 17;
            });
        }).then(function (ok) { bannerMemo[item.id] = ok; return ok; }, function () { return true; });
    }
    function bannerKnown(item) { return item ? bannerMemo[item.id] : undefined; }
    function inScale(cc, n, kind) {
        if (cc === "FR") return n < 10 ? "TP" : n < 12 ? "10" : n < 16 ? "12" : n < 18 ? "16" : "18";
        if (cc === "US") return kind === "tv" ? (n <= 6 ? "TV-G" : n <= 10 ? "TV-PG" : n <= 14 ? "TV-14" : "TV-MA") : (n === 0 ? "G" : n < 13 ? "PG" : n < 17 ? "PG-13" : n < 18 ? "R" : "NC-17");
        if (cc === "GB") return n === 0 ? "U" : n < 12 ? "PG" : n < 15 ? "12A" : n < 18 ? "15" : "18";
        if (cc === "DE" || cc === "CH") return n < 6 ? "0" : n < 12 ? "6" : n < 16 ? "12" : n < 18 ? "16" : "18";
        if (cc === "CA") return n === 0 ? "G" : n < 14 ? "PG" : n < 18 ? "14A" : "18A";
        if (cc === "IT") return n < 6 ? "T" : n < 14 ? "6+" : n < 18 ? "14+" : "18+";
        if (cc === "ES") return n === 0 ? "APTA" : n < 12 ? "7" : n < 16 ? "12" : n < 18 ? "16" : "18";
        if (cc === "BE" || cc === "NL") return n === 0 ? "AL" : n < 9 ? "6" : n < 12 ? "9" : n < 14 ? "12" : n < 16 ? "14" : n < 18 ? "16" : "18";
        if (cc === "PT") return n < 6 ? "M/3" : n < 12 ? "M/6" : n < 14 ? "M/12" : n < 16 ? "M/14" : n < 18 ? "M/16" : "M/18";
        if (cc === "BR") return n === 0 ? "L" : n < 12 ? "10" : n < 14 ? "12" : n < 16 ? "14" : n < 18 ? "16" : "18";
        return n ? n + "+" : "0";
    }
    /* "NR" (not rated), "N/A", "Unrated", "-": no rating */
    function rated(v) { return !!v && !/^(NR|N\/A|NA|UNRATED|NOT RATED|-|EXEMPT|E)$/i.test(String(v).trim()); }
    function certBadge(c) {
        if (!c) return "";
        var cc = ageCountry(), v = rated(c[cc]) ? c[cc] : null;
        if (!v) {
            var order = (NEAR[cc] || []).concat(ANY), n = -1;
            for (var i = 0; i < order.length && n < 0; i++) if (rated(c[order[i]])) n = minAge(order[i], c[order[i]]);
            if (n < 0) return "";
            v = inScale(cc, n, c._k);
        }
        var a = ageLabel(cc, v);
        return "<span class='age age--" + a.lvl + "'>" + esc0(a.label) + "</span>";
    }
    function esc0(s) { return String(s).replace(/[&<>"]/g, function (ch) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]; }); }

    /* "7.8" with a decimal comma in French */
    function fmt(n) { return n ? n.toFixed(1).replace(".", TV.lang === "fr" ? "," : ".") : ""; }
    function known(item) { return memo[cacheKey(item)] || null; }      // what is already known, without asking TMDB
    function imdbBadge(n) { return n ? '<span class="imdb"><b>IMDb</b><span>' + fmt(n) + "</span></span>" : ""; }

    function setKey(k) {
        KEY = String(k || "").trim() || (global.TV_KEYS && global.TV_KEYS.tmdb) || "";
        memo = {}; inflight = {}; certMemo = {};
    }
    function testKey(k) {
        return TV.fetchJSON(API + "/configuration?api_key=" + encodeURIComponent(String(k || "").trim()), { timeout: 12000, noProxy: true }).then(function (j) { return !!(j && j.images); }, function () { return false; });
    }
    TV.meta = { setKey: setKey, testKey: testKey, keySource: function () { return global.TV_KEYS && global.TV_KEYS.tmdb ? "setup" : (TV.load("tmdbKey", "") ? "settings" : ""); }, certs: certs, certBadge: certBadge, ageCountries: COUNTRIES, ageCountry: ageCountry, themeWords: themeWords, themes: themes, themeMatch: themeMatch, themeTitles: themeTitles, bannerSafe: bannerSafe, bannerKnown: bannerKnown, similar: similar, byPerson: byPerson, collection: collection, genres: genres, genreTitles: genreTitles, topRated: topRated, trending: trending, person: person, lookup: lookup, want: want, clearQueue: clearQueue, season: season, img: img, fmt: fmt, imdbBadge: imdbBadge, known: known, enabled: function () { return !!KEY; } };
})(window);
