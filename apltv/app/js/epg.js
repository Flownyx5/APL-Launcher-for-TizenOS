/* ============================================================
   epg.js: the TV guide.
   - Main way: the XMLTV guide of each source (Xtream's xmltv.php, or the
     M3U's url-tvg), read by the helper service and cut to your channels
     and to the next 24 hours. Channels without a guide id are matched by
     name. Kept in IndexedDB, refreshed every 3 hours.
   - Fallback for Xtream (no helper, or no XMLTV): the server's short
     guide, channel by channel, only for the channels on screen.
   Programme = [start ms, stop ms, title, description].
   ============================================================ */
(function (global) {
    "use strict";

    var TV = global.TV, S = TV.smart;
    var progs = {};               // "srcId|epgId" -> programmes, sorted
    var byName = {};              // "srcId|folded name" -> "srcId|epgId"
    var shortDone = {};           // channel id -> time of the last short-guide request
    var extra = {};               // channel id -> programmes from a public guide (channels the provider has none for)
    var listeners = [], loading = null, loadedAt = 0;
    var MAX_AGE = 3 * 3600 * 1000;

    function onUpdate(fn) { listeners.push(fn); }
    var fire = TV.debounce(function () { if (TV.mark) TV.mark("guide"); listeners.forEach(function (fn) { try { fn(); } catch (e) {} }); }, 1500);

    /* A channel's guide chosen by hand (hold OK on a channel > TV Guide): { src, id } a channel of the
       provider's guide, or { ch } the programmes of another channel of your lists. Kept in the settings. */
    var guideNames = {};          // srcId -> { epgId: name }: every channel of the provider's guide, to choose from
    function epgMap() { return TV.pref("epgMap") || {}; }
    function chosen(ch) { return (ch && epgMap()[ch.id]) || null; }
    function setChannelGuide(ch, v) {
        var o = epgMap(), m = {}, k;
        for (k in o) m[k] = o[k];
        if (v) m[ch.id] = v; else delete m[ch.id];
        TV.setPref("epgMap", m);
        fire();
    }
    function viaOther(ch) {
        var c = chosen(ch);
        if (c && c.ch && c.ch !== ch.id) { var other = TV.data.channel(c.ch); if (other) return other; }
        return ch;
    }
    function guideSearch(text) {
        var words = S.fold(text).split(/\s+/).filter(Boolean), out = [];
        Object.keys(guideNames).forEach(function (src) {
            var names = guideNames[src];
            Object.keys(names).forEach(function (id) {
                if (out.length >= 60) return;
                var f = S.fold(names[id] + " " + id);
                for (var i = 0; i < words.length; i++) if (f.indexOf(words[i]) < 0) return;
                out.push({ src: src, id: id, name: names[id] });
            });
        });
        return out.sort(function (a, b) { return a.name.length - b.name.length; });
    }
    function keyOf(ch) {
        var c = chosen(ch);
        if (c && c.id) return (c.src || ch.src) + "|" + c.id;
        if (ch.epg) { var k = ch.src + "|" + ch.epg; if (progs[k]) return k; }
        var n = byName[ch.src + "|" + S.fold(ch.cname || ch.name)];
        return n || (ch.epg ? ch.src + "|" + ch.epg : null);
    }
    /* Whether a channel has programmes, without unpacking them */
    function has(ch) {
        if (ch) ch = viaOther(ch);
        var k = ch && keyOf(ch), c = (k && progs[k]) || (ch && (progs["id|" + ch.id] || extra[ch.id])) || null;
        return !!c && (c.n !== undefined ? c.n > 0 : c.length > 0);
    }
    function list(ch) {
        if (ch) ch = viaOther(ch);
        var k = ch && keyOf(ch), c = (k && progs[k]) || (ch && (progs["id|" + ch.id] || extra[ch.id])) || null;
        if (!c) return null;
        return c.n !== undefined ? (c.n ? expand(c) : null) : c;
    }

    function at(ch, t) {
        var l = list(ch);
        if (!l) return null;
        for (var i = 0; i < l.length; i++) if (l[i][0] <= t && l[i][1] > t) return { cur: l[i], next: l[i + 1] || null, i: i };
        for (i = 0; i < l.length; i++) if (l[i][0] > t) return { cur: null, next: l[i], i: i };
        return null;
    }
    function now(ch) { return at(ch, Date.now()); }
    function range(ch, from, to) {
        var l = list(ch);
        if (!l) return [];
        return l.filter(function (p) { return p[1] > from && p[0] < to; });
    }
    function progress(p) { return p ? TV.clamp((Date.now() - p[0]) / (p[1] - p[0]), 0, 1) : 0; }

    /* ---------- XMLTV through the helper ---------- */
    function loadAll(force) {
        if (loading) return loading;
        var cat = TV.data.catalog();
        if (!cat || !cat.epg.length) return Promise.resolve();
        if (!force && Date.now() - loadedAt < MAX_AGE) return Promise.resolve();
        loading = TV.data.sources().reduce(function (p, src) {
            return p.then(function () { return loadSource(src, cat, force); });
        }, Promise.resolve()).then(function () {
            loadedAt = Date.now(); loading = null; fire();
            TV.heap("provider guide loaded");
            loadExtra().then(function () { TV.heap("public guides loaded"); });
        }, function (e) { loading = null; TV.log("guide: " + e.message); });
        return loading;
    }
    function loadSource(src, cat, force) {
        var e = cat.epg.filter(function (x) { return x.src === src.id; })[0];
        if (!e) return Promise.resolve();
        return TV.idb.get("epg:" + src.id).then(function (saved) {
            if (saved && saved.chans) {
                var n = 0; Object.keys(saved.chans).forEach(function (id) { n += saved.chans[id].length; });
                if (n > 20000) { TV.idb.del("epg:" + src.id); saved = null; }
            }
            if (saved && saved.url === e.url && Date.now() - saved.at < MAX_AGE && !force) { apply(src.id, saved); return; }
            if (saved && saved.url === e.url) apply(src.id, saved);          // the old one meanwhile
            var ids = {}, chans = cat.live.chans.filter(function (c) { return c.src === src.id; });
            chans.forEach(function (c) { if (c.epg) ids[c.epg] = 1; });
            var map = epgMap();
            Object.keys(map).forEach(function (k) { if (map[k].id && (map[k].src || src.id) === src.id) ids[map[k].id] = 1; });   // the guides chosen by hand
            TV.log("guide: asking the helper for " + Object.keys(ids).length + " channels");
            var from = Date.now() - 4 * 3600 * 1000, to = Date.now() + 26 * 3600 * 1000;
            return TV.helper.epg(e.url, Object.keys(ids), from, to, true).then(function (j) {
                // Channels with no guide id, or an id the guide does not know: matched by name
                var names = {}, keep = j.chans || {}, nameMap = {}, extra = {};
                Object.keys(j.names || {}).forEach(function (id) { names[S.fold(j.names[id])] = id; });
                chans.forEach(function (c) {
                    if (c.epg && keep[c.epg] && keep[c.epg].length) return;
                    var id = names[S.fold(c.cname || c.name)];
                    if (id) { nameMap[S.fold(c.cname || c.name)] = id; extra[id] = 1; }
                });
                var more = Object.keys(extra).filter(function (id) { return !keep[id]; });
                if (!more.length) return { keep: keep, nameMap: nameMap, total: j.total, all: j.names };
                return TV.helper.epg(e.url, more, from, to, false).then(function (j2) {
                    Object.keys(j2.chans || {}).forEach(function (id) { keep[id] = j2.chans[id]; });
                    return { keep: keep, nameMap: nameMap, total: j.total, all: j.names };
                });
            }).then(function (r) {
                var keep = r.keep, j = { total: r.total };
                var data = { url: e.url, at: Date.now(), chans: keep, names: r.nameMap, all: r.all || {} };
                apply(src.id, data);
                TV.log("guide: " + Object.keys(keep).length + " channels with programmes (" + (j.total || 0) + " in the file)");
                var size = 0; Object.keys(keep).forEach(function (id) { size += keep[id].length; });
                if (size > 20000) { TV.idb.del("epg:" + src.id); return; }          // too big for the screen's storage
                return TV.idb.set("epg:" + src.id, data);
            }).catch(function (err) { TV.log("guide via helper failed: " + err.message); });
        });
    }
    /* Memory: the guide of thousands of channels is large; plots are kept for the next 6 hours only */
    /* A channel's programmes kept compact: start and end times in two number arrays (no object per
       programme), titles and plots in two lists. 170,000 programmes were 700,000 small objects for the
       screen's memory cleaner to walk through; now about a third. The channels on screen get their usual
       list back (the last 300 used are kept ready). */
    var BASE = 1700000000;
    function slim(list) {
        var from = Date.now() - 2 * 3600000, plotUntil = Date.now() + 6 * 3600000, keep = [];
        for (var i = 0; i < list.length; i++) if (list[i][1] >= from) keep.push(list[i]);
        var n = keep.length, s = new Int32Array(n), e = new Int32Array(n), t = new Array(n), d = null;
        for (i = 0; i < n; i++) {
            var p = keep[i];
            s[i] = Math.round(p[0] / 1000) - BASE; e[i] = Math.round(p[1] / 1000) - BASE; t[i] = p[2];
            if (p[3] && p[0] < plotUntil) { d = d || new Array(n); d[i] = p[3].length > 240 ? p[3].slice(0, 240) + "…" : p[3]; }
        }
        return { s: s, e: e, t: t, d: d, n: n };
    }
    var ready = [];
    function expand(c) {
        if (c.arr) return c.arr;
        var out = new Array(c.n);
        for (var i = 0; i < c.n; i++) out[i] = [(c.s[i] + BASE) * 1000, (c.e[i] + BASE) * 1000, c.t[i], c.d && c.d[i] || ""];
        c.arr = out;
        ready.push(c);
        if (ready.length > 300) { var old = ready.shift(); old.arr = null; }
        return out;
    }
    function apply(srcId, data) {
        if (data.all) guideNames[srcId] = data.all;
        Object.keys(data.chans || {}).forEach(function (id) { progs[srcId + "|" + id] = slim(data.chans[id]); });
        Object.keys(data.names || {}).forEach(function (n) { byName[srcId + "|" + n] = srcId + "|" + data.names[n]; });
        fire();
    }

    /* ---------- public guides for the channels your provider gives no programmes for ----------
       Every country of your playlist counts, not only your language: the channels still without
       programmes are grouped by the country of their category (FR, ES, UK, IT, PT, AR…, or the country
       named in an Africa category), and each country's free guide is read: iptv-epg.org (about forty
       countries), then epg.pw (France, UK, USA, Germany, Spain, Canada…). Matched by name, kept in memory. */
    var TAG_COUNTRY = {
        FR: ["fr"], FRA: ["fr"], FRANCE: ["fr"], BE: ["be"], BEL: ["be"], CH: ["ch"], SUI: ["ch"], CA: ["ca"], QC: ["ca"], QUEBEC: ["ca"],
        UK: ["gb"], GB: ["gb"], EN: ["gb"], ENG: ["gb"], US: ["us"], USA: ["us"], IE: ["ie"], AU: ["au"], NZ: ["nz"],
        DE: ["de"], GER: ["de"], AT: ["at"], ES: ["es"], SP: ["es"], ESP: ["es"], LAT: ["mx"], MX: ["mx"], IT: ["it"], ITA: ["it"],
        PT: ["pt"], POR: ["pt"], BR: ["br"], NL: ["nl"], PL: ["pl"], TR: ["tr"], AR: ["sa", "ae", "eg"], ARAB: ["sa", "ae", "eg"], ARABIC: ["sa", "ae", "eg"],
        IN: ["in"], IND: ["in"], PK: ["pk"], RU: ["ru"], RO: ["ro"], GR: ["gr"], AL: ["al"], EXYU: ["rs", "hr", "ba"], YU: ["rs", "hr", "ba"],
        SE: ["se"], NO: ["no"], DK: ["dk"], FI: ["fi"], CN: ["cn"], JP: ["jp"], KR: ["kr"], IR: ["ir"]
    };
    var NAME_COUNTRY = { senegal: "sn", cameroon: "cm", cameroun: "cm", cotedivoire: "ci", ivorycoast: "ci", nigeria: "ng", southafrica: "za", ghana: "gh",
        kenya: "ke", uganda: "ug", somalia: "so", congo: "cd", mali: "ml", benin: "bj", togo: "tg", gabon: "ga", morocco: "ma", maroc: "ma", algeria: "dz", algerie: "dz",
        tunisia: "tn", tunisie: "tn", egypt: "eg", ethiopia: "et", tanzania: "tz", rwanda: "rw", angola: "ao", mozambique: "mz", zambia: "zm", zimbabwe: "zw" };
    var EPGPW = { fr: 1, gb: 1, us: 1, de: 1, es: 1, br: 1, ca: 1, ru: 1, au: 1, "in": 1, jp: 1, kr: 1, cn: 1 };
    var LANG_COUNTRY = { fr: "fr", en: "gb" };
    function compact(s) {
        s = String(s || "").toLowerCase();
        try { s = s.normalize("NFD").replace(/[\u0300-\u036f]/g, ""); } catch (e) {}
        s = s.replace(/^\s*[a-z]{2,3}\s*[-|:]\s+/, "");      // "IT - Rai 1": the country written before the name
        return s.replace(/\b(uhd|fhd|hd|sd|4k|hevc|h265|raw|backup|\d{3,4}p)\b/g, " ").replace(/\+/g, "plus").replace(/[^a-z0-9]+/g, "");
    }
    function countriesOf(ct) {
        var tg = ct.ctag || ct.tag;
        if (TAG_COUNTRY[tg]) return TAG_COUNTRY[tg];
        var n = compact(ct.name);
        for (var k in NAME_COUNTRY) if (n.indexOf(k) !== -1) return [NAME_COUNTRY[k]];
        if (!tg && LANG_COUNTRY[TV.lang]) return [LANG_COUNTRY[TV.lang]];      // no country: the screen's
        return [];
    }
    function loadExtra() {
        var cat = TV.data.catalog();
        if (!cat) return Promise.resolve();
        var by = {}, total = 0;
        cat.live.chans.forEach(function (c) {
            if (has(c)) return;
            var ct = TV.data.catOf(c);
            if (ct.adult) return;
            countriesOf(ct).forEach(function (code) { (by[code] = by[code] || []).push(c); });
            total++;
        });
        var codes = Object.keys(by).filter(function (k) { return by[k].length >= 3; }).sort(function (a, b) { return by[b].length - by[a].length; }).slice(0, 30);
        if (!codes.length) return Promise.resolve();
        TV.log("extra guides: " + total + " channels without programmes, countries " + codes.join(" "));
        var from = Date.now() - 4 * 3600 * 1000, to = Date.now() + 26 * 3600 * 1000, found = 0;
        return codes.reduce(function (p, code) {
            var urls = ["https://iptv-epg.org/files/epg-" + code + ".xml.gz"];
            if (EPGPW[code]) urls.push("https://epg.pw/xmltv/epg_" + code.toUpperCase() + ".xml.gz");
            return urls.reduce(function (p2, url) {
                return p2.then(function () {
                    var still = by[code].filter(function (c) { return !has(c); });
                    if (!still.length) return;
                    var names = {}, byName = {};
                    still.forEach(function (c) { var k = compact(c.cname || c.name); if (k) { names[k] = 1; (byName[k] = byName[k] || []).push(c); } });
                    return TV.helper.epgMatch(url, Object.keys(names), from, to).then(function (j) {
                        var n = 0;
                        Object.keys(j.chans || {}).forEach(function (k) { var l = slim(j.chans[k]); (byName[k] || []).forEach(function (c) { extra[c.id] = l; n++; }); });
                        found += n;
                        TV.log("extra guide " + code.toUpperCase() + " (" + url.split("/")[2] + "): " + n + " of " + still.length + " channels");
                        if (n) fire();
                    }, function (e) { TV.log("extra guide " + code + " " + url.split("/")[2] + ": " + e.message); });
                });
            }, p);
        }, Promise.resolve()).then(function () { TV.log("extra guides: " + found + " more channels with programmes"); });
    }

    /* ---------- Xtream short guide, for the channels on screen ---------- */
    function b64(s) {
        try { return decodeURIComponent(escape(global.atob(s || ""))); } catch (e) { try { return global.atob(s || ""); } catch (e2) { return s || ""; } }
    }
    var queue = [], running = 0;
    function ensure(chans) {
        chans.forEach(function (ch) {
            if (!ch || (ch.url && !/^stalker:/.test(ch.url)) || has(ch) || !ch.sid) return;   // M3U channels: XMLTV only
            if (shortDone[ch.id] && Date.now() - shortDone[ch.id] < 20 * 60 * 1000) return;
            shortDone[ch.id] = Date.now();
            queue.push(ch);
        });
        pump();
    }
    function pump() {
        while (running < 3 && queue.length) {
            var ch = queue.shift(), src = TV.data.sourceOf(ch);
            if (!src || (src.type !== "xtream" && src.type !== "stalker")) continue;
            running++;
            if (src.type === "stalker") {
                (function (ch) {
                    TV.stalker.shortEpg(src, ch.sid).then(function (l) { if (l.length) { progs["id|" + ch.id] = l; fire(); } }).catch(function () {}).then(function () { running--; pump(); });
                })(ch);
                continue;
            }
            (function (ch) {
                TV.data.xApi(src, "get_short_epg", "stream_id=" + ch.sid + "&limit=12").then(function (j) {
                    var l = (j && j.epg_listings || []).map(function (p) {
                        return [(parseInt(p.start_timestamp, 10) || 0) * 1000, (parseInt(p.stop_timestamp, 10) || 0) * 1000, b64(p.title), b64(p.description)];
                    }).filter(function (p) { return p[0] && p[1] > p[0]; }).sort(function (a, b) { return a[0] - b[0]; });
                    if (l.length) { progs["id|" + ch.id] = l; fire(); }
                }).catch(function () {}).then(function () { running--; pump(); });
            })(ch);
        }
    }

    /* Guides stored by an earlier version and too big for the screen's storage: removed before anything is saved */
    function prune() {
        return TV.data.sources().reduce(function (p, src) {
            return p.then(function () {
                return TV.idb.get("epg:" + src.id).then(function (saved) {
                    if (!saved || !saved.chans) return;
                    var n = 0; Object.keys(saved.chans).forEach(function (id) { n += saved.chans[id].length; });
                    if (n > 20000) { TV.log("guide cache too big (" + n + "), removed"); return TV.idb.del("epg:" + src.id); }
                });
            });
        }, Promise.resolve());
    }

    TV.epg = { prune: prune, now: now, at: at, range: range, list: list, has: has, progress: progress, loadAll: loadAll, ensure: ensure, onUpdate: onUpdate, b64: b64,
               chosen: chosen, setChannelGuide: setChannelGuide, guideSearch: guideSearch, hasGuideList: function () { return Object.keys(guideNames).length > 0; } };
})(window);
