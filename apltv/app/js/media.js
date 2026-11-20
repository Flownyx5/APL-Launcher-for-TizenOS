/* ============================================================
   media.js: your own media server as a source: Jellyfin, Emby, Plex.
   Its movies and series (seasons and episodes when a series opens), in
   the same catalog shape as an Xtream account (js/data.js): one category
   per library, the server's pictures and plots, TMDB's when it knows the
   title. Played straight from the server (the file itself).
   - Jellyfin and Emby: the server's address, your user name and password
     (port 8096 tried when none is given).
   - Plex: a code shown on the screen, typed on plex.tv/link (no password).
   Addresses are "media:<source>:<jf|plex>:<id>" in the catalog; the real
   link (with the server's key) is made just before playing.
   ============================================================ */
(function (global) {
    "use strict";

    var TV = global.TV, S = TV.smart, T = TV.t;
    var PAGE = 2000, MAX_ITEMS = 60000;

    function deviceId() { var d = TV.load("deviceId", ""); if (!d) { d = "apltv-" + TV.uid(); TV.save("deviceId", d); } return d; }
    function platform() { return TV.ANDROID ? "Android TV" : TV.WEBOS ? "LG webOS" : TV.TIZEN ? "Samsung Tizen" : "Web"; }
    function src0(id) { return TV.data.sources().filter(function (s) { return s.id === id; })[0]; }
    function save(src, patch) { Object.keys(patch).forEach(function (k) { src[k] = patch[k]; }); TV.data.updateSource(src.id, patch); }
    function catOf(srcId, id, name, kind) {
        var info = S.category(name || "");
        return { id: srcId + ":" + id, name: info.name || name, raw: info.raw, tag: info.tag, lang: info.lang, adult: false, kind: kind, count: 0 };
    }
    function qs(o) { return Object.keys(o).filter(function (k) { return o[k] !== undefined && o[k] !== null && o[k] !== ""; }).map(function (k) { return encodeURIComponent(k) + "=" + encodeURIComponent(o[k]); }).join("&"); }
    /* GET of a JSON answer, with the server's key in a header when it can be sent, through the helper when the
       screen refuses to read the answer directly */
    function getJSON(url, headers, timeout) {
        return TV.http(url, { headers: headers, timeout: timeout || 60000 }).then(function (r) {
            if (r.status === 0 && TV.helper && TV.helper.sget) {
                var h = {}; Object.keys(headers || {}).forEach(function (k) { if (/^(authorization|accept)$/i.test(k)) h[k.toLowerCase()] = headers[k]; });
                return TV.helper.sget(url, h, timeout || 60000).then(function (t) { return { status: 200, text: t }; });
            }
            return r;
        }).then(function (r) {
            if (r.status === 401 || r.status === 403) { var e = new Error("auth"); e.auth = true; throw e; }
            if (r.status < 200 || r.status >= 300) throw new Error("HTTP " + r.status);
            try { return JSON.parse(r.text); } catch (x) { throw new Error("bad JSON"); }
        });
    }

    /* ---------- Jellyfin and Emby ---------- */
    function normServer(s) {
        s = String(s || "").trim().replace(/\s+/g, "");
        if (!s) return "";
        if (!/^https?:\/\//i.test(s)) s = "http://" + s;
        return s.replace(/#.*$/, "").replace(/\/web(\/.*)?$/i, "").replace(/\/+$/, "");
    }
    function candidates(server) {
        var s = normServer(server), out = [s];
        if (!/^https?:\/\/[^\/]+:\d+/i.test(s) && /^http:/i.test(s)) out.push(s.replace(/^(http:\/\/[^\/]+)/i, "$1:8096"));
        return out.concat(out.map(function (u) { return u + "/emby"; }));
    }
    function jfAuth(src, token) {
        var v = 'MediaBrowser Client="APL TV", Device="' + platform() + '", DeviceId="' + deviceId() + '", Version="' + TV.VERSION + '"' + (token ? ', Token="' + token + '"' : "");
        var h = { "Authorization": v, "Accept": "application/json" };
        if (src.kind === "emby" || !token) h["X-Emby-Authorization"] = v;
        if (token && src.kind === "emby") h["X-Emby-Token"] = token;
        return h;
    }
    /* Which address answers, and is it Jellyfin or Emby */
    function findServer(src) {
        var list = candidates(src.server), i = 0;
        return new Promise(function (resolve, reject) {
            (function next() {
                if (i >= list.length) { reject(new Error(T("No Jellyfin or Emby server answers at this address."))); return; }
                var base = list[i++];
                TV.http(base + "/System/Info/Public", { timeout: 8000 }).then(function (r) {
                    var j = null;
                    if (r.status === 200) { try { j = JSON.parse(r.text); } catch (e) {} }
                    if (!j || !(j.Id || j.ServerName)) { next(); return; }
                    resolve({ base: base, kind: /jellyfin/i.test(j.ProductName || "") ? "jellyfin" : "emby", name: j.ServerName || "" });
                }, next);
            })();
        });
    }
    function jfLogin(src) {
        return findServer(src).then(function (sv) {
            src.kind = sv.kind;
            return TV.http(sv.base + "/Users/AuthenticateByName", { method: "POST", headers: (function () { var h = jfAuth(src, null); h["Content-Type"] = "application/json"; return h; })(),
                body: JSON.stringify({ Username: src.user || "", Pw: src.pass || "" }), timeout: 20000 }).then(function (r) {
                if (r.status === 401 || r.status === 400 || r.status === 403) throw refused(src);
                if (r.status === 0) throw new Error(T("The server does not answer. Check its address and that it is on."));
                if (r.status < 200 || r.status >= 300) throw new Error("HTTP " + r.status);
                var j = JSON.parse(r.text);
                if (!j.AccessToken || !j.User) throw refused(src);
                save(src, { base: sv.base, kind: sv.kind, token: j.AccessToken, userId: j.User.Id, serverName: sv.name, refused: false });
                // no name was given: the server's own ("My Jellyfin") rather than its address
                if (src.autoName && sv.name) { save(src, { name: sv.name, autoName: false }); }
                TV.log(sv.kind + ": signed in on " + sv.base.replace(/^(https?:\/\/[^\/]+).*$/, "$1"));
                return src;
            });
        });
    }
    /* The server said no to this username and password: kept on the source, so APL TV stops signing in by
       itself (the server locks the user out, on every device, after a few tries) until the password is
       changed in Settings or Refresh Now is chosen there (js/settings.js) */
    function refused(src) {
        var msg = T("The server refused this username or password.");
        // also shown under the source in Settings, even when found in the background (Home)
        save(src, { refused: true, error: msg });
        return new Error(msg);
    }
    /* One sign-in at a time per server: calls sent together (jfFresh) that all get a 401 wait for
       the same one, then take its key. None at all after a refusal. */
    var logins = {};
    function jfRelogin(src) {
        var cur = src0(src.id);
        if (src.refused || (cur && cur.refused)) return Promise.reject(new Error(T("The server refused this username or password.")));
        if (!logins[src.id]) logins[src.id] = jfLogin(src).then(function (s) { delete logins[src.id]; return s; }, function (e) { delete logins[src.id]; throw e; });
        return logins[src.id].then(function (s) {
            if (s !== src) ["base", "kind", "token", "userId", "serverName"].forEach(function (k) { src[k] = s[k]; });
            return src;
        });
    }
    function jfGet(src, path, timeout) {
        function once() { return getJSON(src.base + path + (path.indexOf("?") >= 0 ? "&" : "?") + "api_key=" + encodeURIComponent(src.token), jfAuth(src, src.token), timeout); }
        if (!src.token || !src.base) return jfRelogin(src).then(once);
        return once().catch(function (e) { if (e.auth || e.message === "HTTP 0") return jfRelogin(src).then(once); throw e; });
    }
    function jfImg(src, x, kind, w) {
        var tag = kind === "Backdrop" ? (x.BackdropImageTags || [])[0] : (x.ImageTags || {})[kind];
        if (!tag) return "";
        return src.base + "/Items/" + x.Id + "/Images/" + kind + "?" + qs({ maxWidth: w, quality: 90, tag: tag });
    }
    function tmdbOf(p) { p = p || {}; return String(p.Tmdb || p.tmdb || p.TMDB || ""); }
    /* "2024-05-01T20:15:42.1234567Z": 7 decimals, which older TV engines cannot read. In ms, or 0 (none, or "0001-01-01") */
    function jfDate(s) { var t = Date.parse(String(s || "").replace(/(\.\d{3})\d+/, "$1")); return t > 0 ? t : 0; }
    /* Where the server says you are in a movie or an episode (its UserData), for js/data.js syncResumes.
       Watched there: done, as the server decided with its own resume settings. Nothing at all ("none"):
       never played there, or marked unwatched there (the server then forgets the date too). asOf: when the
       question was sent (this screen's clock), so a video played here since then is not undone by this answer. */
    function jfSeen(x, key, itemId, epId, epLabel, asOf) {
        var u = x.UserData || {}, at = jfDate(u.LastPlayedDate), pos = Math.round((u.PlaybackPositionTicks || 0) / 1e7), dur = Math.round((x.RunTimeTicks || 0) / 1e7);
        var e = { key: key, at: at, item: itemId, ep: epId || null, asOf: asOf || 0 };
        if (u.Played) { e.pos = dur || 1; e.dur = dur || 1; e.done = true; }
        else if (pos > 0) { e.pos = pos; e.dur = dur; if (epLabel) e.epLabel = epLabel; }
        else if (at) e.gone = true;
        else e.none = true;
        return e;
    }
    /* A movie's page opens: its state on the server right now (marked unwatched there, watched on the phone…),
       before the page shows "Watched". 4 s at most, no new sign-in; no answer: as APL TV knew it. Watched
       there: kept on the movie itself (srvDone, js/data.js watched), so opening a page does not put it in
       Recently Watched. */
    function jfMovie(src, item) {
        if (!src.token || !src.base || !src.userId || !item.sid) return Promise.resolve(false);
        var asOf = Date.now();
        return getJSON(src.base + "/Users/" + src.userId + "/Items?" + qs({ Ids: item.sid, EnableUserData: "true", api_key: src.token }), jfAuth(src, src.token), 4000).then(function (j) {
            var x = j && j.Items && j.Items[0];
            if (!x || x.Id !== item.sid || !TV.data.syncResumes) return false;
            var s = jfSeen(x, item.id, item.id, null, null, asOf);
            item.srvDone = !!s.done;
            if (!(s.pos && !s.done)) s.onlyKnown = true;
            return TV.data.syncResumes([s]);
        }).catch(function () { return false; });
    }
    function jfItems(src, viewId, type, onItems, progress) {
        var start = 0, total = 0, got = 0;
        function page() {
            var q = qs({ ParentId: viewId, Recursive: "true", IncludeItemTypes: type, Fields: "Overview,ProviderIds,DateCreated", EnableImageTypes: "Primary,Backdrop",
                         ImageTypeLimit: 1, SortBy: "DateCreated", SortOrder: "Descending", StartIndex: start, Limit: PAGE, EnableUserData: "true" });
            var asOf = Date.now();
            return jfGet(src, "/Users/" + src.userId + "/Items?" + q, 120000).then(function (j) {
                var items = (j && j.Items) || [];
                total = j && j.TotalRecordCount || items.length;
                got += items.length; start += items.length;
                onItems(items, asOf);
                if (progress) progress();
                if (items.length && got < total && got < MAX_ITEMS) return page();
            });
        }
        return page();
    }
    function jfLoad(src, progress, out) {
        progress(T("Connecting to {name}…", { name: src.name }));
        var seen = [];
        return jfRelogin(src).then(function () {
            return jfGet(src, "/Users/" + src.userId + "/Views");
        }).then(function (v) {
            var views = ((v && v.Items) || []).filter(function (x) { return x.CollectionType === "movies" || x.CollectionType === "tvshows" || x.CollectionType === "homevideos" || !x.CollectionType; });
            return views.reduce(function (p, view) {
                return p.then(function () {
                    var series = view.CollectionType === "tvshows";
                    var part = series ? out.series : out.movies, cat = catOf(src.id, view.Id, view.Name, series ? "series" : "movie");
                    part.cats.push(cat);
                    progress(series ? T("Loading series…") : T("Loading movies…"));
                    return jfItems(src, view.Id, series ? "Series" : "Movie", function (items, asOf) {
                        items.forEach(function (x) {
                            if (!x || !x.Id) return;
                            var base = { src: src.id, name: x.Name || "", year: x.ProductionYear || 0, poster: jfImg(src, x, "Primary", 500), backdrop: jfImg(src, x, "Backdrop", 1280) || undefined,
                                         cat: cat.id, rating: x.CommunityRating || 0, added: Math.floor((Date.parse(x.DateCreated || "") || 0) / 1000), plot: x.Overview || "", tmdb: tmdbOf(x.ProviderIds) };
                            if (series) { base.id = src.id + "|s" + x.Id; base.seriesId = x.Id; base.kind = "series"; }
                            else {
                                base.id = src.id + "|m" + x.Id; base.sid = x.Id; base.kind = "movie"; base.url = "media:" + src.id + ":jf:" + x.Id; base.dur = Math.round((x.RunTimeTicks || 0) / 1e7);
                                // the whole catalog: only what is half watched comes in; the rest only updates the titles
                                // APL TV already has, so a long server history does not push out the other sources'.
                                // Watched there: the tick comes from the movie itself (js/data.js watched)
                                var s = jfSeen(x, base.id, base.id, null, null, asOf);
                                // only when watched: kept with the saved catalog (js/data.js FIELDS), no room taken otherwise
                                if (s.done) base.srvDone = true;
                                if (!(s.pos && !s.done)) s.onlyKnown = true;
                                seen.push(s);
                            }
                            part.items.push(base);
                        });
                    }, function () { progress((series ? T("Loading series…") : T("Loading movies…")) + " " + part.items.length); });
                });
            }, Promise.resolve());
        }).then(function () {
            // a library with nothing in it (music…) is not shown
            out.movies.cats = out.movies.cats.filter(function (c) { return out.movies.items.some(function (m) { return m.cat === c.id; }); });
            out.series.cats = out.series.cats.filter(function (c) { return out.series.items.some(function (m) { return m.cat === c.id; }); });
            out.account = { server: src.serverName || "", kind: src.kind };
            // the movies you started or watched elsewhere (phone, web): Continue Watching and the ticks
            if (seen.length && TV.data.syncResumes) TV.data.syncResumes(seen);
            return out;
        });
    }
    /* Marked by hand (js/data.js markWatched): a movie, or episodes (one, a season, the whole series). The server
       hears it too (its PlayedItems), so every client shows the same: watched, or not watched and back to the
       start. One episode after the other, stopping at the first the server does not take (a whole series with
       the server down would otherwise wait 10 s per episode). Only Jellyfin and Emby. */
    function played(item, eps, on) {
        var src = item && src0(item.src);
        if (!src || src.type !== "jellyfin" || !src.token || !src.base || !src.userId) return Promise.resolve(false);
        var ids = (eps && eps.length ? eps.map(function (e) { return e && e.id; }) : [item.sid]).filter(function (id) { return !!id; }), h = jfAuth(src, src.token);
        if (!ids.length) return Promise.resolve(false);
        return ids.reduce(function (p, id) {
            return p.then(function (ok) {
                if (!ok) return false;
                return TV.http(src.base + "/Users/" + src.userId + "/PlayedItems/" + encodeURIComponent(id), { method: on ? "POST" : "DELETE", headers: h, timeout: 10000 })
                    .then(function (r) { return r.status >= 200 && r.status < 300; }, function () { return false; });
            });
        }, Promise.resolve(true));
    }
    /* "S1 E2 · Its name": the same label as an episode played here (js/detail.js playEp) */
    function jfLabel(x) {
        var s = x.ParentIndexNumber !== undefined && x.ParentIndexNumber !== null ? x.ParentIndexNumber : 1;
        return T("S{s} E{e}", { s: s, e: x.IndexNumber || 0 }) + (x.Name ? " · " + x.Name : "");
    }
    /* Continue Watching from the server when Home or its tab opens, without waiting for the catalog (refreshed
       every 6 h): what is half watched (/Items/Resume), the episodes watched lately, and each series' next
       episode (/Shows/NextUp). At most once a minute per server; quietly nothing when it does not answer, and
       then not again for 10 minutes. */
    var FRESH_MS = 60000, FRESH_FAIL_MS = 600000, freshAt = {};
    function jfFresh(src) {
        if (!src.token || !src.base || !src.userId || Date.now() - (freshAt[src.id] || 0) < FRESH_MS) return Promise.resolve(false);
        var asOf = freshAt[src.id] = Date.now();
        function list(path, q) { q.EnableUserData = "true"; q.Limit = 50; return jfGet(src, path + "?" + qs(q), 20000).then(function (j) { return (j && j.Items) || []; }); }
        return Promise.all([
            list("/Users/" + src.userId + "/Items/Resume", { MediaTypes: "Video" }),
            list("/Users/" + src.userId + "/Items", { IncludeItemTypes: "Episode", Filters: "IsPlayed", SortBy: "DatePlayed", SortOrder: "Descending", Recursive: "true" }),
            list("/Shows/NextUp", { UserId: src.userId })
        ]).then(function (r) {
            var seen = [], last = {};
            r[0].concat(r[1]).forEach(function (x) {
                if (x.Type === "Movie") { var mid = src.id + "|m" + x.Id, m = jfSeen(x, mid, mid, null, null, asOf); if (m) seen.push(m); return; }
                if (x.Type !== "Episode" || !x.SeriesId) return;
                var sid = src.id + "|s" + x.SeriesId, label = jfLabel(x), e = jfSeen(x, sid + "|" + x.Id, sid, x.Id, label, asOf);
                if (!e) return;
                // watched there: only updates the episodes APL TV knows (their tick comes from the series page,
                // js/data.js watched), so a season marked watched there does not fill Recently Watched
                if (e.done) e.onlyKnown = true;
                seen.push(e);
                // when the series was last watched, for its next episode below; a mark by hand here is not a
                // viewing and brings no "Up Next"
                var mine = TV.data.resumeOf && TV.data.resumeOf(e.key);
                if (e.done) { if (!(mine && mine.manual) && e.at > (last[x.SeriesId] || 0)) last[x.SeriesId] = e.at; }
                else if (e.pos) seen.push({ key: sid, at: e.at, item: sid, ep: x.Id, pos: e.pos, dur: e.dur, epLabel: label, series: true });
            });
            // the next episode carries no date: the one of the episode finished before it (none known: left out,
            // so series watched long ago do not fill Continue Watching)
            r[2].forEach(function (x) {
                var u = x.UserData || {}, at = last[x.SeriesId];
                if (!at || x.Type !== "Episode" || u.Played || u.PlaybackPositionTicks > 0) return;
                var sid = src.id + "|s" + x.SeriesId;
                seen.push({ key: sid, at: at, item: sid, ep: x.Id, pos: 0, dur: 0, epLabel: jfLabel(x), series: true, upNext: true });
            });
            return seen.length && TV.data.syncResumes ? TV.data.syncResumes(seen) : false;
        }).catch(function () {
            // no answer (server off, refused): not asked again for 10 minutes, instead of at every Home
            freshAt[src.id] = Date.now() + FRESH_FAIL_MS - FRESH_MS;
            return false;
        });
    }
    /* Every Jellyfin and Emby source (Home), or only one (its tab) */
    function fresh(srcId) {
        return Promise.all(TV.data.sources().filter(function (s) { return s.type === "jellyfin" && (!srcId || s.id === srcId); }).map(jfFresh));
    }
    function jfSeries(src, item) {
        var asOf = Date.now();
        return jfGet(src, "/Shows/" + encodeURIComponent(item.seriesId) + "/Episodes?" + qs({ UserId: src.userId, Fields: "Overview,ProviderIds", EnableImageTypes: "Primary", EnableUserData: "true" }), 60000).then(function (j) {
            var seasons = {}, seen = [];
            ((j && j.Items) || []).forEach(function (x) {
                var s = x.ParentIndexNumber !== undefined && x.ParentIndexNumber !== null ? x.ParentIndexNumber : 1;
                // the same key and label as an episode played here (js/detail.js playEp)
                var w = jfSeen(x, item.id + "|" + x.Id, item.id, x.Id, jfLabel(x), asOf);
                // watched there: its tick comes from the episode itself (js/data.js watched), not from the resume points,
                // so a long series watched elsewhere does not push the other sources' out; half watched ones come in
                if (!(w.pos && !w.done)) w.onlyKnown = true;
                seen.push(w);
                (seasons[s] = seasons[s] || []).push({ id: x.Id, season: s, episode: x.IndexNumber || 0, title: x.Name || "", url: "media:" + src.id + ":jf:" + x.Id,
                    image: jfImg(src, x, "Primary", 600), plot: x.Overview || "", dur: Math.round((x.RunTimeTicks || 0) / 1e7), srvDone: !!w.done });
            });
            // the episodes you started elsewhere, and the ones APL TV knows, before the page draws its ticks
            if (seen.length && TV.data.syncResumes) TV.data.syncResumes(seen);
            Object.keys(seasons).forEach(function (s) { seasons[s].sort(function (a, b) { return a.episode - b.episode; }); });
            return { seasons: seasons, info: { plot: item.plot || "", tmdb: item.tmdb || "" } };
        });
    }
    function jfStream(src, id) {
        function link() { return src.base + "/Videos/" + encodeURIComponent(id) + "/stream?" + qs({ static: "true", MediaSourceId: id, api_key: src.token, ApiKey: src.kind === "jellyfin" ? src.token : "", DeviceId: deviceId() }); }
        return src.token ? Promise.resolve(link()) : jfRelogin(src).then(link);
    }
    /* Where you are, told to the server: started, every 10 s, stopped. Other clients then show the same
       resume point, and the server decides with its own resume settings when a video counts as watched.
       Only Jellyfin and Emby: any other address sends nothing. A server that does not answer changes
       nothing either (no message): playback goes on and the position stays in APL TV. */
    var REPORT = { start: "/Sessions/Playing", progress: "/Sessions/Playing/Progress", stop: "/Sessions/Playing/Stopped" };
    function report(url, event, pos) {
        var m = String(url || "").match(/^media:([^:]+):jf:(.+)$/), src = m && src0(m[1]);
        if (!src || !src.token || !src.base || !REPORT[event]) return Promise.resolve(false);
        var id = decodeURIComponent(m[2]), h = jfAuth(src, src.token);
        h["Content-Type"] = "application/json";
        // the file itself is played (static stream): DirectPlay, and its only version is the item
        var body = { ItemId: id, MediaSourceId: id, PlayMethod: "DirectPlay", CanSeek: true, PositionTicks: Math.max(0, Math.round((pos || 0) * 1e7)) };
        return TV.http(src.base + REPORT[event], { method: "POST", headers: h, body: JSON.stringify(body), timeout: 10000 })
            .then(function (r) { return r.status >= 200 && r.status < 300; }, function () { return false; });
    }

    /* ---------- Plex ---------- */
    function plexTv() { return (TV.PREVIEW || TV.DEV) && TV.load("plexTv", "") || "https://plex.tv"; }
    function plexQ(token, extra) {
        var o = { "X-Plex-Product": "APL TV", "X-Plex-Version": TV.VERSION, "X-Plex-Client-Identifier": deviceId(), "X-Plex-Platform": platform(), "X-Plex-Device-Name": "APL TV" };
        if (token) o["X-Plex-Token"] = token;
        Object.keys(extra || {}).forEach(function (k) { o[k] = extra[k]; });
        return qs(o);
    }
    var JSONH = { "Accept": "application/json" };
    /* A code to type on plex.tv/link: { id, code } */
    function plexPin() {
        return TV.http(plexTv() + "/api/v2/pins?" + plexQ(null, { strong: "false" }), { method: "POST", headers: JSONH, timeout: 15000 }).then(function (r) {
            if (r.status < 200 || r.status >= 300) throw new Error(T("Plex does not answer right now ({e}).", { e: "HTTP " + r.status }));
            var j = JSON.parse(r.text);
            return { id: j.id, code: j.code };
        });
    }
    /* The account's key once the code was typed, or "" */
    function plexCheck(pin) {
        return getJSON(plexTv() + "/api/v2/pins/" + pin.id + "?" + plexQ(null, { code: pin.code }), JSONH, 10000).then(function (j) { return (j && j.authToken) || ""; });
    }
    /* The Plex servers of the account, each with the addresses to try (on your network first) */
    function plexServers(token) {
        return getJSON(plexTv() + "/api/v2/resources?" + plexQ(token, { includeHttps: 1, includeRelay: 1 }), JSONH, 20000).then(function (list) {
            return (list || []).filter(function (r) { return /server/.test(r.provides || ""); }).map(function (r) {
                var uris = [], cs = r.connections || [];
                function add(u) { if (u && uris.indexOf(u) < 0) uris.push(u); }
                cs.filter(function (c) { return c.local && !c.relay; }).forEach(function (c) { if (c.address && c.port) add("http://" + c.address + ":" + c.port); add(c.uri); });
                cs.filter(function (c) { return !c.local && !c.relay; }).forEach(function (c) { add(c.uri); });
                cs.filter(function (c) { return c.relay; }).forEach(function (c) { add(c.uri); });
                return { name: r.name || "Plex", id: r.clientIdentifier || "", token: r.accessToken || token, uris: uris, owned: !!r.owned };
            });
        });
    }
    /* The first address of the server that answers (4 s each), kept for next time. None: the server's
       addresses are asked again from plex.tv (its address on your network may have changed). */
    function plexBase(src, again) {
        var list = (src.base ? [src.base] : []).concat((src.uris || []).filter(function (u) { return u !== src.base; })), i = 0;
        return new Promise(function (resolve, reject) {
            (function next() {
                if (i >= list.length) {
                    if (!again && src.plexToken) {
                        plexServers(src.plexToken).then(function (l) {
                            var me = l.filter(function (s) { return s.id === src.serverId; })[0];
                            if (!me) throw new Error("gone");
                            save(src, { uris: me.uris, token: me.token, base: "" });
                            return plexBase(src, true);
                        }).then(resolve, function () { reject(new Error(T("The Plex server does not answer. Is it on?"))); });
                        return;
                    }
                    reject(new Error(T("The Plex server does not answer. Is it on?"))); return;
                }
                var u = list[i++];
                TV.http(u + "/identity?" + plexQ(src.token), { headers: JSONH, timeout: 4000 }).then(function (r) {
                    if (r.status === 200) { if (src.base !== u) save(src, { base: u }); resolve(u); } else next();
                }, next);
            })();
        });
    }
    function plexGet(src, path, timeout) {
        return getJSON(src.base + path + (path.indexOf("?") >= 0 ? "&" : "?") + plexQ(src.token), JSONH, timeout).catch(function (e) {
            if (e.auth) throw new Error(T("Plex refused the access. Link the screen again."));
            return plexBase(src).then(function () { return getJSON(src.base + path + (path.indexOf("?") >= 0 ? "&" : "?") + plexQ(src.token), JSONH, timeout); });
        });
    }
    function plexImg(src, path, w, h) {
        if (!path) return "";
        return src.base + "/photo/:/transcode?" + qs({ width: w, height: h, minSize: 1, upscale: 1, url: path, "X-Plex-Token": src.token });
    }
    function plexTmdb(x) { var g = (x.Guid || []).map(function (o) { return o.id || ""; }).filter(function (id) { return /^tmdb:\/\//.test(id); })[0]; return g ? g.replace("tmdb://", "") : ""; }
    function plexPart(x) { var m = (x.Media || [])[0], p = m && (m.Part || [])[0]; return p && p.key ? p.key : ""; }
    function plexLoad(src, progress, out) {
        progress(T("Connecting to {name}…", { name: src.name }));
        return plexBase(src).then(function () { return plexGet(src, "/library/sections"); }).then(function (j) {
            var dirs = ((j && j.MediaContainer && j.MediaContainer.Directory) || []).filter(function (d) { return d.type === "movie" || d.type === "show"; });
            return dirs.reduce(function (p, d) {
                return p.then(function () {
                    var series = d.type === "show", part = series ? out.series : out.movies, cat = catOf(src.id, "p" + d.key, d.title, series ? "series" : "movie");
                    part.cats.push(cat);
                    progress(series ? T("Loading series…") : T("Loading movies…"));
                    var start = 0;
                    function page() {
                        return plexGet(src, "/library/sections/" + encodeURIComponent(d.key) + "/all?" + qs({ type: series ? 2 : 1, includeGuids: 1, sort: "addedAt:desc", "X-Plex-Container-Start": start, "X-Plex-Container-Size": PAGE }), 120000).then(function (r) {
                            var mc = (r && r.MediaContainer) || {}, items = mc.Metadata || [], total = mc.totalSize || mc.size || items.length;
                            items.forEach(function (x) {
                                if (!x || !x.ratingKey) return;
                                var it = { src: src.id, name: x.title || "", year: x.year || 0, poster: plexImg(src, x.thumb, 400, 600), backdrop: plexImg(src, x.art, 1280, 720) || undefined, cat: cat.id,
                                           rating: x.audienceRating || x.rating || 0, added: x.addedAt || 0, plot: x.summary || "", tmdb: plexTmdb(x) };
                                if (series) { it.id = src.id + "|s" + x.ratingKey; it.seriesId = x.ratingKey; it.kind = "series"; }
                                else { var pk = plexPart(x); if (!pk) return; it.id = src.id + "|m" + x.ratingKey; it.sid = x.ratingKey; it.kind = "movie"; it.url = "media:" + src.id + ":plex:" + encodeURIComponent(pk); it.dur = Math.round((x.duration || 0) / 1000); }
                                part.items.push(it);
                            });
                            start += items.length;
                            progress((series ? T("Loading series…") : T("Loading movies…")) + " " + part.items.length);
                            if (items.length && start < total && part.items.length < MAX_ITEMS) return page();
                        });
                    }
                    return page();
                });
            }, Promise.resolve());
        }).then(function () {
            out.account = { server: src.name, kind: "plex" };
            return out;
        });
    }
    function plexSeries(src, item) {
        return plexGet(src, "/library/metadata/" + encodeURIComponent(item.seriesId) + "/allLeaves", 60000).then(function (j) {
            var seasons = {};
            ((j && j.MediaContainer && j.MediaContainer.Metadata) || []).forEach(function (x) {
                var pk = plexPart(x);
                if (!pk) return;
                var s = x.parentIndex !== undefined ? x.parentIndex : 1;
                (seasons[s] = seasons[s] || []).push({ id: x.ratingKey, season: s, episode: x.index || 0, title: x.title || "", url: "media:" + src.id + ":plex:" + encodeURIComponent(pk),
                    image: plexImg(src, x.thumb, 640, 360), plot: x.summary || "", dur: Math.round((x.duration || 0) / 1000) });
            });
            Object.keys(seasons).forEach(function (s) { seasons[s].sort(function (a, b) { return a.episode - b.episode; }); });
            return { seasons: seasons, info: { plot: item.plot || "", tmdb: item.tmdb || "" } };
        });
    }

    /* ---------- for js/data.js and js/player.js ---------- */
    function load(src, progress, base) {
        base.type = src.type;
        return src.type === "plex" ? plexLoad(src, progress, base) : jfLoad(src, progress, base);
    }
    function seriesInfo(src, item) { return src.type === "plex" ? plexSeries(src, item) : jfSeries(src, item); }
    function resolve(url) {
        var m = String(url).match(/^media:([^:]+):(jf|plex):(.+)$/);
        if (!m) return Promise.reject(new Error("bad media address"));
        var src = src0(m[1]);
        if (!src) return Promise.reject(new Error(T("This playlist is no longer there.")));
        if (m[2] === "jf") return jfStream(src, decodeURIComponent(m[3]));
        var part = decodeURIComponent(m[3]);
        return (src.base ? Promise.resolve(src.base) : plexBase(src)).then(function (b) { return b + part + (part.indexOf("?") >= 0 ? "&" : "?") + plexQ(src.token); });
    }
    /* The movie's page: its plot, length and TMDB id from the server (already in the catalog), once its watched
       state is fresh (Jellyfin and Emby: one small request) */
    function info(item) {
        var src = src0(item.src), d = { info: { plot: item.plot || "", tmdb_id: item.tmdb || "", duration_secs: item.dur || 0, backdrop_path: item.backdrop ? [item.backdrop] : [] } };
        return (src && src.type === "jellyfin" ? jfMovie(src, item) : Promise.resolve(false)).then(function () { return d; });
    }

    TV.media = { load: load, seriesInfo: seriesInfo, resolve: resolve, info: info, normServer: normServer, report: report, fresh: fresh, played: played,
                 plex: { pin: plexPin, check: plexCheck, servers: plexServers } };
})(window);
