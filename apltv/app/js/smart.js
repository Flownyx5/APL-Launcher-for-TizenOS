/* ============================================================
   smart.js: makes sense of provider names.
   IPTV lists are messy: "FR| TF1 FHD", "|FR| ★ SPORTS ★", "VOD - FR - Action",
   "##### FRANCE #####", "Avatar (2009) [MULTI] 4K"... This file:
   - reads a category: country/language tag, kind (live, movies, series),
     adult, clean display name;
   - reads a channel: clean name, quality (4K, FHD, HD, SD), a key to put
     the variants of one channel together;
   - reads a movie or series title: clean title + year, for TMDB;
   - orders categories: the screen's language first, then the others,
     adult ones last (hidden by default).
   ============================================================ */
(function (global) {
    "use strict";

    var TV = global.TV;

    // Country / language tags seen in providers' lists, with the language they mean
    var TAGS = {
        FR: "fr", FRA: "fr", FRANCE: "fr", BE: "fr", BEL: "fr", CH: "fr", SUI: "fr", CA: "", QC: "fr", QUEBEC: "fr", AF: "af", AFR: "af", AFRICA: "af", MAG: "ar", MAGHREB: "ar",
        UK: "en", GB: "en", EN: "en", ENG: "en", US: "en", USA: "en", IE: "en", AU: "en", NZ: "en",
        DE: "de", GER: "de", AT: "de", ES: "es", SP: "es", ESP: "es", LAT: "es", MX: "es", IT: "it", ITA: "it", PT: "pt", POR: "pt", BR: "pt",
        NL: "nl", PL: "pl", TR: "tr", AR: "ar", ARAB: "ar", ARABIC: "ar", IN: "hi", IND: "hi", PK: "ur", RU: "ru", RO: "ro", GR: "el", AL: "sq", EXYU: "sr", YU: "sr",
        SE: "sv", NO: "no", DK: "da", FI: "fi", CN: "zh", JP: "ja", KR: "ko", IR: "fa", AFG: "fa", KU: "ku", VOSTFR: "fr", MULTI: "multi"
    };
    var ADULT = /\b(xxx|adult[eos]*|porn\w*|\+ ?18|18 ?\+|hot ?club|for adults|erotic\w*|sex\w*)\b/i;
    var SEPARATOR = /^[\s#=*\-_~•●◆★☆▶►|.]{3,}.*[#=*\-_~•●◆★☆◀◄|.]{3,}\s*$|^[#=*\-_~]{4,}/;
    var DECOR = /[★☆●◆■□▶►◀◄♦♥♠♣✪✦✧⭐🔥⚽🎬📺🎥🇫🇷]|[☀-➿]|[\ud83c-\ud83e][\udc00-\udfff]/g;
    var QUALITY = /\b(UHD|4K|2160P?|FHD|1080P?|HD|720P?|SD|576P?|480P?|HEVC|H\.?265|H\.?264|HDR|50FPS|60FPS|LOW|HQ|RAW|BACKUP)\b/gi;

    var PRIMARY = { fr: ["FR", "FRA", "FRANCE"], en: ["UK", "GB", "US", "USA", "EN", "ENG"] };
    /* "SOUTH AFRICA" -> "South Africa"; short words (TV, HD, TNT, C+) stay as they are */
    function readable(s) {
        var letters = String(s).replace(/[^A-Za-z\u00c0-\u024f]/g, "");
        if (!letters || letters !== letters.toUpperCase()) return s;
        return String(s).toLowerCase().replace(/[a-z\u00e0-\u024f0-9+']+/g, function (w) {
            return w.length <= 3 && !/^(les|des|une|the|and|for|kid|top)$/.test(w) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1);
        });
    }
    function cleanSpaces(s) { return String(s || "").replace(/\s+/g, " ").replace(/^[\s\-|:.,_]+|[\s\-|:.,_]+$/g, ""); }

    /* Small capitals and superscripts some providers use ("TF1 ᴴᴰ", "ᴿᴬᵂ") read as plain letters */
    var SUP = { "ᴬ": "A", "ᴮ": "B", "ᶜ": "C", "ᴰ": "D", "ᴱ": "E", "ᶠ": "F", "ᴳ": "G", "ᴴ": "H", "ᴵ": "I", "ᴶ": "J", "ᴷ": "K", "ᴸ": "L", "ᴹ": "M", "ᴺ": "N",
                "ᴼ": "O", "ᴾ": "P", "ᴿ": "R", "ˢ": "S", "ᵀ": "T", "ᵁ": "U", "ⱽ": "V", "ᵛ": "V", "ᵂ": "W", "ˣ": "X", "⁰": "0", "¹": "1", "²": "2", "³": "3", "⁴": "4",
                "⁵": "5", "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9", "ᵃ": "a", "ᵇ": "b", "ᵈ": "d", "ᵉ": "e", "ᵍ": "g", "ʰ": "h", "ⁱ": "i", "ʲ": "j", "ᵏ": "k", "ˡ": "l",
                "ᵐ": "m", "ⁿ": "n", "ᵒ": "o", "ᵖ": "p", "ʳ": "r", "ᵗ": "t", "ᵘ": "u", "ʷ": "w", "ʸ": "y", "ᶻ": "z", "⁺": "+" };
    var SUP_RE = new RegExp("[" + Object.keys(SUP).join("") + "]+", "g");
    function plain(s) { return String(s || "").replace(SUP_RE, function (m) { var o = ""; for (var i = 0; i < m.length; i++) o += SUP[m.charAt(i)] || ""; return " " + o + " "; }); }
    // Regions written before the country ("EU| FR| Sport", "AF| CM| …"): skipped, the country after them counts
    var REGIONS = { SRS: 1, SER: 1, VOD: 1, MOV: 1, EU: 1, EUR: 1, EUROPE: 1, AS: 1, ASIA: 1, AM: 1, AMERICA: 1, LATAM: 1, LATINO: 1, MENA: 1, ME: 1, NA: 1, SA: 1, INT: 1, WORLD: 1, OTT: 1 };

    var KIND_WORDS = { SRS: 1, SER: 1, VOD: 1, MOV: 1, OTT: 1 };

    /* "FR| SPORTS", "|FR| Sports", "FR - Sports", "[FR] Sports", "Sports (FR)", "VOD FR Action", "EU| FR| Sports" */
    function readTag(name) {
        var s = plain(name).replace(DECOR, " ").replace(/\s+/g, " ").trim(), tag = "", region = "", code0 = "", m;
        for (var step = 0; step < 3; step++) {
            m = s.match(/^\|?\s*\[?([A-Z]{2,7})\]?\s*(\||:|-|–|»|\/|·)\s*/i) || s.match(/^\[([A-Z]{2,7})\]\s*/i);
            if (!m) break;
            var code = m[1].toUpperCase();
            if (!tag && TAGS[code]) { tag = code; s = s.slice(m[0].length); continue; }
            if (REGIONS[code]) { if (!region && !KIND_WORDS[code]) region = code; s = s.slice(m[0].length); continue; }
            if (!tag && !region && /^[A-Z]{2,3}$/.test(m[1])) code0 = code;      // "NG| Nigeria": a country APL TV does not know
            break;
        }
        var ml = s.match(/^multi[\s-]?lang(ue|uage)?s?\b\s*[-|:]?\s*/i);
        if (!tag && ml) { tag = "MULTI"; s = s.slice(ml[0].length); }
        if (tag === "MULTI") s = s.replace(/^lang(ue|uage)?s?\b\s*[-|:]?\s*/i, "");     // "Multi-Lang - Latest"
        if (!tag) {
            m = s.match(/\s*[(\[|]([A-Z]{2,7})[)\]|]\s*$/i);
            if (m && !TAGS[m[1].toUpperCase()]) m = null;
            if (m && TAGS[m[1].toUpperCase()]) { tag = m[1].toUpperCase(); s = s.slice(0, s.length - m[0].length); }
        }
        if (!tag) {
            m = s.match(/^(VOD|SERIES?|SÉRIES?|FILMS?|MOVIES?)\s*[-|:]?\s*([A-Z]{2,3})\s*[-|:]\s*/i);
            if (m && TAGS[m[2].toUpperCase()]) { tag = m[2].toUpperCase(); s = m[1] + " " + s.slice(m[0].length); }
        }
        return { tag: tag, lang: tag ? TAGS[tag] : "", rest: cleanSpaces(s), group: GROUP_OF[tag] || tag || GROUP_OF[region] || region || code0 };
    }

    /* The country or region a category belongs to (Settings > Countries and Categories): spellings of one country together */
    var GROUP_OF = { FRA: "FR", FRANCE: "FR", BEL: "BE", SUI: "CH", QUEBEC: "QC", AFR: "AF", AFRICA: "AF", MAGHREB: "MAG", GB: "UK", ENG: "EN", USA: "US",
        GER: "DE", SP: "ES", ESP: "ES", ITA: "IT", POR: "PT", ARAB: "AR", ARABIC: "AR", IND: "IN", YU: "EXYU",
        EUR: "EU", EUROPE: "EU", ASIA: "AS", AMERICA: "AM", LATAM: "LAT", LATINO: "LAT", WORLD: "INT" };
    var GROUP_NAMES = { FR: "France", BE: "Belgium", CH: "Switzerland", CA: "Canada", QC: "Quebec", AF: "Africa", MAG: "Maghreb", UK: "United Kingdom",
        EN: "English", US: "United States", IE: "Ireland", AU: "Australia", NZ: "New Zealand", DE: "Germany", AT: "Austria", ES: "Spain", LAT: "Latin America",
        MX: "Mexico", IT: "Italy", PT: "Portugal", BR: "Brazil", NL: "Netherlands", PL: "Poland", TR: "Turkey", AR: "Arabic", IN: "India", PK: "Pakistan",
        RU: "Russia", RO: "Romania", GR: "Greece", AL: "Albania", EXYU: "Ex-Yugoslavia", SE: "Sweden", NO: "Norway", DK: "Denmark", FI: "Finland",
        CN: "China", JP: "Japan", KR: "Korea", IR: "Iran", AFG: "Afghanistan", KU: "Kurdish", MULTI: "Multi-Language", EU: "Europe", AS: "Asia",
        AM: "America", MENA: "Middle East and North Africa", ME: "Middle East", NA: "North America", INT: "International" };

    var RE_SERIES = /\b(s[ée]ries?|tv ?shows?|saisons?|seasons?)\b/i;
    var RE_MOVIES = /\b(vod|films?|movies?|cin[ée]ma|cinema|box ?office|4k ?movies?)\b/i;

    TV.smart = {
        isAdult: function (s) { return ADULT.test(String(s || "")); },
        groupName: function (g) { return GROUP_NAMES[g] ? TV.t(GROUP_NAMES[g]) : g; },
        isSeparator: function (s) { return SEPARATOR.test(String(s || "").trim()); },

        category: function (name) {
            var t = readTag(name), clean = readable(t.rest.replace(/\s*[|:]\s*/g, " · "));
            return {
                raw: name, tag: t.tag, lang: t.lang, group: t.group,
                name: clean || name || TV.t("Other"),
                adult: ADULT.test(name || ""),
                kind: RE_SERIES.test(name || "") ? "series" : (RE_MOVIES.test(name || "") ? "movie" : "")
            };
        },

        /* A channel's display name and quality, and the key shared by its variants ("TF1 FHD", "TF1 HD" -> "tf1") */
        channel: function (name) {
            var t = readTag(name), s = t.rest, q = "";
            var qm = s.toUpperCase().match(/\b(UHD|4K|2160P?|FHD|1080P?|HD|720P?|SD|576P?|480P?)\b/);
            if (qm) {
                var v = qm[1];
                q = /UHD|4K|2160/.test(v) ? "4K" : /FHD|1080/.test(v) ? "FHD" : /HD|720/.test(v) ? "HD" : "SD";
            }
            var base = cleanSpaces(s.replace(QUALITY, " ").replace(/[\[\(]\s*[\]\)]/g, " "));
            var key = base.toLowerCase().replace(/[^a-z0-9À-ɏ+]+/g, "").replace(/\+/g, "plus");
            return { name: base || s || name, quality: q, key: (t.lang || "") + ":" + key, tag: t.tag, lang: t.lang };
        },
        qualityRank: function (q) { return { "4K": 4, FHD: 3, HD: 2, SD: 1 }[q] || 0; },

        /* "FR - Avatar (2009) [MULTI] 4K" -> { title: "Avatar", year: 2009 } */
        title: function (name) {
            var t = readTag(name), s = t.rest, year = 0, m;
            m = s.match(/[(\[]((19|20)\d{2})[)\]]/) || s.match(/\s-\s((19|20)\d{2})\b/) || s.match(/\s((19|20)\d{2})$/);
            if (m) { year = parseInt(m[1], 10); s = s.replace(m[0], " "); }
            s = s.replace(/[\[(][^\])]*[\])]/g, " ")
                 .replace(/\b(MULTI|VOSTFR|VOST|VF|VFF|VFQ|VO|TRUEFRENCH|FRENCH|SUBFRENCH|DUAL|4K|UHD|FHD|HD|HDR|HDR10|DV|HEVC|X265|X264|1080P|720P|2160P|WEB-?DL|WEBRIP|BLURAY|BDRIP|DVDRIP|AC3|DTS|ATMOS|10BIT)\b/gi, " ");
            return { title: cleanSpaces(s) || t.rest, year: year, tag: t.tag, lang: t.lang };
        },

        /* "Show S01 E02", "Show S1E2", "Show - 1x02" -> { show, season, episode } */
        episode: function (name) {
            var m = String(name || "").match(/^(.*?)[\s._-]*S(\d{1,2})[\s._-]*E(\d{1,3})/i) || String(name || "").match(/^(.*?)[\s._-]+(\d{1,2})x(\d{1,3})\b/i);
            if (!m) return null;
            return { show: cleanSpaces(readTag(m[1]).rest), season: parseInt(m[2], 10), episode: parseInt(m[3], 10) };
        },

        /* Categories in a useful order: the screen's language (and multi) first, adult last */
        sortCategories: function (cats) {
            var mine = TV.lang, primary = PRIMARY[mine] || [];
            function rank(c) {
                if (c.adult) return 9;
                if (primary.indexOf(c.tag) !== -1) return 0;     // FR before BE, CH, CA on a French screen
                if (c.lang === mine) return 1;
                if (c.lang === "multi") return 2;
                if (!c.lang) return 3;
                return 4;
            }
            return cats.map(function (c, i) { return { c: c, i: i, r: rank(c) }; })
                .sort(function (a, b) { return a.r - b.r || a.i - b.i; })
                .map(function (x) { return x.c; });
        },

        /* Text compared for search: lower case, no accents, no punctuation */
        fold: function (s) {
            s = String(s || "").toLowerCase();
            try { s = s.normalize("NFD").replace(/[̀-ͯ]/g, ""); } catch (e) {}
            return s.replace(/[^a-z0-9+]+/g, " ").trim();
        }
    };
})(window);
