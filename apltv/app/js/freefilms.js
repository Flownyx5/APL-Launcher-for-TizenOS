/* ============================================================
   freefilms.js: Public Domain Movies, a source you add in one press
   (Settings > Add a Playlist), shown in Movies like a playlist's (no tab
   of its own). Films, shorts and cartoons free of rights,
   from the list tools/make-free-films.py makes out of Wikidata: each one is
   marked public domain there (in the United States for most of them) and
   has its video on the Internet Archive or Wikimedia Commons, played straight
   from there. One category per decade, then Cartoons, Short Films and
   Documentaries; the best known first. The list is read from GitHub (kept up
   to date without a new version), or from the app itself.
   Addresses are "free:<ia|c>:<file>" in the catalog.
   ============================================================ */
(function (global) {
    "use strict";

    var TV = global.TV, T = TV.t;
    var REMOTE = "https://raw.githubusercontent.com/Knikt/APL-TV/main/app/data/free-films.json", LOCAL = "data/free-films.json";
    var IA = "https://archive.org/download/", COMMONS = "https://upload.wikimedia.org/wikipedia/commons/";

    function get(url) {
        return TV.http(url, { timeout: 30000 }).then(function (r) {
            if (r.status !== 200 && !(r.status === 0 && r.text)) throw new Error("HTTP " + r.status);
            var j = JSON.parse(r.text);
            if (!j || !j.films || !j.fields) throw new Error("bad list");
            return j;
        });
    }
    /* GitHub's copy first (the newest list); the app's own when GitHub does not answer. While developing, the app's first. */
    function list() {
        var first = TV.DEV || TV.PREVIEW ? LOCAL : REMOTE, then = first === LOCAL ? REMOTE : LOCAL;
        return get(first).catch(function (e) { TV.log("free films " + first + ": " + e.message); return get(then); });
    }
    function decade(y) { return y < 1920 ? "0" : String(Math.floor(y / 10) * 10); }
    function catName(k) {
        if (k === "animation") return T("Cartoons");
        if (k === "short") return T("Short Films");
        if (k === "doc") return T("Documentaries");
        if (k === "x") return T("Other Movies");
        if (k === "0") return T("Before 1920");
        return T("The {decade}s", { decade: k });
    }
    function picture(file) { return file ? "https://commons.wikimedia.org/wiki/Special:FilePath/" + encodeURIComponent(file) + "?width=500" : ""; }

    function load(src, progress, out) {
        progress(T("Loading movies…"));
        return list().then(function (j) {
            var F = {};
            j.fields.forEach(function (f, i) { F[f] = i; });
            var lang = TV.lang, cats = {}, order = [];
            function cat(k) {
                if (!cats[k]) { cats[k] = { id: src.id + ":" + k, name: catName(k), raw: catName(k), tag: "", lang: "", adult: false, kind: "movie", count: 0 }; order.push(k); }
                return cats[k];
            }
            j.films.forEach(function (r) {
                var kind = r[F.kind], year = r[F.year] || 0;
                var k = kind === "film" ? (year ? decade(year) : "x") : kind;
                var name = (F[lang] !== undefined && lang !== "en" && r[F[lang]]) || r[F.en];
                if (!name || !r[F.file]) return;
                out.movies.items.push({ src: src.id, id: src.id + "|m" + r[F.wikidata], sid: String(r[F.tmdb] || ""), kind: "movie", name: name, year: year,
                    poster: picture(r[F.poster]), cat: cat(k).id, rating: 0, added: r[F.fame] || 0, dur: r[F.secs] || 0, tmdb: r[F.tmdb] ? String(r[F.tmdb]) : "",
                    url: "free:" + r[F.host] + ":" + r[F.file], plot: "" });
            });
            // the decades in their order, then the cartoons, the short films and the documentaries
            var rank = function (k) { return k === "x" ? 9000 : k === "animation" ? 9100 : k === "short" ? 9200 : k === "doc" ? 9300 : +k; };
            order.sort(function (a, b) { return rank(a) - rank(b); });
            out.movies.cats = order.map(function (k) { return cats[k]; });
            out.account = { server: T("Public Domain Movies"), kind: "free", at: j.at };
            if (!out.movies.items.length) throw new Error(T("The list of public domain movies did not arrive."));
            return out;
        });
    }
    function resolve(url) {
        var m = String(url).match(/^free:(ia|c):(.+)$/);
        if (!m) return Promise.reject(new Error("bad address"));
        if (m[1] === "c") return Promise.resolve(COMMONS + m[2]);
        return Promise.resolve(IA + m[2].split("/").map(encodeURIComponent).join("/"));
    }
    function info(item) {
        return Promise.resolve({ info: { plot: item.plot || "", tmdb_id: item.tmdb || item.sid || "", duration_secs: item.dur || 0, backdrop_path: [] } });
    }
    function seriesInfo() { return Promise.reject(new Error("no series")); }

    TV.freeFilms = { load: load, resolve: resolve, info: info, seriesInfo: seriesInfo };
})(window);
