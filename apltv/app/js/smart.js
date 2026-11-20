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
        DE: "de", GER: "de", GE: "de", AT: "de", ES: "es", SP: "es", ESP: "es", LAT: "es", MX: "es", IT: "it", ITA: "it", PT: "pt", POR: "pt", BR: "pt",
        NL: "nl", PL: "pl", POL: "pl", TR: "tr", AR: "ar", ARAB: "ar", ARABIC: "ar", IN: "hi", IND: "hi", PK: "ur", RU: "ru", RO: "ro", GR: "el", AL: "sq", ALB: "sq", EXYU: "sr", YU: "sr",
        SE: "sv", SW: "sv", NO: "no", DK: "da", FI: "fi", SC: "sv", CN: "zh", JP: "ja", KR: "ko", KO: "ko", IR: "fa", AFG: "fa", KU: "ku", VOSTFR: "fr", MULTI: "multi",
        HU: "hu", BG: "bg", CZ: "cs", SK: "sk", UA: "uk", MT: "mt", IL: "he", MY: "ms", ID: "id", PH: "tl", TH: "th"
    };
    var ADULT = /\b(xxx|adult[eos]*|porn\w*|\+ ?18|18 ?\+|hot ?club|for adults|erotic\w*|sex\w*)\b/i;
    // "##### FRANCE #####", "✦●✦| GENERAL FHD |✦●✦", "UK| ✦●✦ KIDS ✦●✦": a title between rows of signs, not a channel
    var SEPARATOR = /^[\s#=*\-_~•●◆★☆▶►|.✦✧✪✶❖◇◈♦■□▪━═─]{3,}.*[#=*\-_~•●◆★☆◀◄|.✦✧✪✶❖◇◈♦■□▪━═─]{3,}\s*$|^[#=*\-_~]{4,}/;
    var DECOR = /[★☆●◆■□▶►◀◄♦♥♠♣✪✦✧⭐🔥⚽🎬📺🎥🇫🇷]|[☀-➿]|[\ud83c-\ud83e][\udc00-\udfff]/g;
    var QUALITY = /\b(UHD|4K|2160P?|FHD|1080P?|HD|720P?|SD|576P?|480P?|HEVC|H\.?265|H\.?264|HDR|50FPS|60FPS|LOW|HQ|RAW|BACKUP)\b/gi;

    var PRIMARY = { fr: ["FR", "FRA", "FRANCE"], it: ["IT", "ITA", "ITALIA", "ITALY"], en: ["UK", "GB", "US", "USA", "EN", "ENG"] };
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
    // Letters NFD leaves whole, as people type them on a keyboard without them
    var FOLD = { "ł": "l", "œ": "oe", "æ": "ae", "ø": "o", "ß": "ss", "đ": "d", "ð": "d", "þ": "th", "ı": "i" }, FOLD_RE = /[łœæøßđðþı]/g;
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
        if (tag === "MULTI") s = s.replace(/^lang(ue|uage)?s?\b\]?\s*[-|:]?\s*/i, "");     // "Multi-Lang - Latest", "[MULTI-LANG] TOP"
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
        GER: "DE", GE: "DE", SP: "ES", ESP: "ES", ITA: "IT", POR: "PT", POL: "PL", ARAB: "AR", ARABIC: "AR", IND: "IN", YU: "EXYU", SW: "SE", ALB: "AL", KO: "KR",
        EUR: "EU", EUROPE: "EU", ASIA: "AS", AMERICA: "AM", LATAM: "LAT", LATINO: "LAT", WORLD: "INT" };
    var GROUP_NAMES = { FR: "France", BE: "Belgium", CH: "Switzerland", CA: "Canada", QC: "Quebec", AF: "Africa", MAG: "Maghreb", UK: "United Kingdom",
        EN: "English", US: "United States", IE: "Ireland", AU: "Australia", NZ: "New Zealand", DE: "Germany", AT: "Austria", ES: "Spain", LAT: "Latin America",
        MX: "Mexico", IT: "Italy", PT: "Portugal", BR: "Brazil", NL: "Netherlands", PL: "Poland", TR: "Turkey", AR: "Arabic", IN: "India", PK: "Pakistan",
        RU: "Russia", RO: "Romania", GR: "Greece", AL: "Albania", EXYU: "Ex-Yugoslavia", SE: "Sweden", NO: "Norway", DK: "Denmark", FI: "Finland",
        CN: "China", JP: "Japan", KR: "Korea", IR: "Iran", AFG: "Afghanistan", KU: "Kurdish", MULTI: "Multi-Language", EU: "Europe", AS: "Asia",
        AM: "America", MENA: "Middle East and North Africa", ME: "Middle East", NA: "North America", INT: "International", SC: "Scandinavia" };
    // More countries, named by the screen's own language when it knows them (Intl), else in English
    var MORE_NAMES = { HU: "Hungary", BG: "Bulgaria", CZ: "Czechia", SK: "Slovakia", UA: "Ukraine", MT: "Malta", IS: "Iceland", EE: "Estonia", LV: "Latvia",
        LT: "Lithuania", ARM: "Armenia", GEO: "Georgia", CY: "Cyprus", AZ: "Azerbaijan", IL: "Israel", KZ: "Kazakhstan", ID: "Indonesia", MY: "Malaysia",
        PH: "Philippines", VN: "Vietnam", SG: "Singapore", TH: "Thailand", TW: "Taiwan", KH: "Cambodia", BD: "Bangladesh", LK: "Sri Lanka" };
    var ISO = { ARM: "AM", GEO: "GE" }, LANGS = { LT: "lt", ARM: "hy", GEO: "ka", CY: "el", AZ: "az", KZ: "kk", VN: "vi", SG: "zh", TW: "zh", KH: "km", BD: "bn", LK: "si", IS: "is", EE: "et", LV: "lv" };
    var regionNames = null, regionLang = "";
    function groupName(g) {
        if (GROUP_NAMES[g]) return TV.t(GROUP_NAMES[g]);
        if (!MORE_NAMES[g]) return g;
        try {
            if (regionLang !== TV.lang && global.Intl && global.Intl.DisplayNames) { regionNames = new global.Intl.DisplayNames([TV.lang || "en"], { type: "region" }); regionLang = TV.lang; }
            var n = regionNames && regionNames.of(ISO[g] || g);
            if (n && n !== (ISO[g] || g)) return n;
        } catch (e) {}
        return MORE_NAMES[g];
    }

    /* A country or language written out at the start of a category's name ("EU | FRANCE GENERALE", "UK SPORT",
       "[SW] SWEDISH MOVIES", "24/7 | FRENCH", "AM | CANADA FRANÇAIS SPORT"): the code it stands for. It wins over a short
       code that means another language there ("[CH] CHINA" is China, not Switzerland). Folded words, longest first. */
    var NAMES = {
        "france": "FR", "french": "FR", "francais": "FR", "francaise": "FR", "belgium": "BE", "belgique": "BE", "switzerland": "CH", "suisse": "CH",
        "canada francais": "QC", "quebec": "QC", "quebecois": "QC", "quebecoise": "QC", "canada": "CA",
        "uk": "UK", "united kingdom": "UK", "british": "UK", "england": "UK", "ireland": "IE", "irish": "IE",
        "usa": "US", "united states": "US", "english": "EN", "australia": "AU", "new zealand": "NZ",
        "spain": "ES", "spanish": "ES", "espana": "ES", "latino": "LAT", "latin": "LAT", "mexico": "MX",
        "argentina": "LAT", "bolivia": "LAT", "chile": "LAT", "colombia": "LAT", "ecuador": "LAT", "el salvador": "LAT", "costa rica": "LAT", "honduras": "LAT",
        "paraguay": "LAT", "peru": "LAT", "uruguay": "LAT", "venezuela": "LAT", "panama": "LAT", "dominican rep": "LAT", "dominican republic": "LAT",
        "portugal": "PT", "portuguese": "PT", "brazil": "BR", "brasil": "BR", "germany": "DE", "german": "DE", "deutschland": "DE", "austria": "AT",
        "italy": "IT", "italia": "IT", "italian": "IT", "netherlands": "NL", "dutch": "NL", "holland": "NL",
        "poland": "PL", "polish": "PL", "polska": "PL", "polski": "PL", "polskie": "PL", "po polsku": "PL",
        "turkey": "TR", "turkish": "TR", "turk": "TR", "turkiye": "TR", "arabic": "AR", "arabe": "AR", "arab": "AR",
        "india": "IN", "indian": "IN", "pakistan": "PK", "russia": "RU", "russian": "RU", "romania": "RO", "romanian": "RO",
        "greece": "GR", "greek": "GR", "albania": "AL", "albanian": "AL", "exyu": "EXYU", "ex yu": "EXYU",
        "sweden": "SE", "swedish": "SE", "norway": "NO", "norwegian": "NO", "denmark": "DK", "danish": "DK", "finland": "FI", "finnish": "FI",
        "nordic": "SC", "scandinavia": "SC", "scandinave": "SC", "scandinavian": "SC",
        "china": "CN", "chinese": "CN", "japan": "JP", "japanese": "JP", "korea": "KR", "korean": "KR",
        "iran": "IR", "iranian": "IR", "persian": "IR", "afghanistan": "AFG", "kurdish": "KU", "kurdistan": "KU",
        "hungary": "HU", "hungarian": "HU", "bulgaria": "BG", "bulgarian": "BG", "czech": "CZ", "slovakia": "SK", "ukraine": "UA",
        "malta": "MT", "iceland": "IS", "estonia": "EE", "latvia": "LV", "lithuania": "LT", "armenia": "ARM", "cyprus": "CY", "azerbaijan": "AZ",
        "israel": "IL", "hebrew": "IL", "kazakhstan": "KZ", "indonesia": "ID", "malaysia": "MY", "malasia": "MY", "philippine": "PH", "philippines": "PH",
        "vietnam": "VN", "singapore": "SG", "thailand": "TH", "thailland": "TH", "taiwan": "TW", "cambodia": "KH", "bangladesh": "BD", "sri lanka": "LK"
    };
    var NAME_RE = null, NAME_END = null;
    function written(s) {
        if (!NAME_RE) {
            var keys = Object.keys(NAMES).sort(function (a, b) { return b.length - a.length; }).join("|");
            NAME_RE = new RegExp("^(" + keys + ")(?: |$)"); NAME_END = new RegExp("(?:^| )(" + keys + ")$");
        }
        var m = NAME_RE.exec(fold(s));
        if (!m) {
            // at the end then ("SPORTS FRANCE", "MOVIES (ENGLISH)", "NETFLIX FRANÇAIS"), taken off the same way
            var e = NAME_END.exec(fold(s));
            if (!e) return null;
            var tl = String(s).trim().split(/\s+/), j = tl.length, back = "";
            while (j > 0 && back.length < e[1].length) { j--; back = fold(tl[j] + (back ? " " + back : "")); }
            return { code: NAMES[e[1]], rest: tl.slice(0, j).join(" ").replace(/[\s\-|:·/(\[]+$/, ""), end: true };
        }
        // the same words taken off the name as written ("CANADA FRANÇAIS SPORT" -> "SPORT")
        var toks = String(s).trim().split(/\s+/), i = 0, got = "";
        while (i < toks.length && got.length < m[1].length) { got = fold((got ? got + " " : "") + toks[i]); i++; }
        return { code: NAMES[m[1]], rest: toks.slice(i).join(" ").replace(/^[\s\-|:·/]+/, "") };
    }

    var RE_SERIES = /\b(s[ée]ries?|tv ?shows?|saisons?|seasons?)\b/i;
    var RE_MOVIES = /\b(vod|films?|movies?|cin[ée]ma|cinema|box ?office|4k ?movies?)\b/i;

    TV.smart = {
        isAdult: function (s) { return ADULT.test(String(s || "")); },
        groupName: groupName,
        isSeparator: function (s) { s = String(s || "").trim(); return SEPARATOR.test(s) || SEPARATOR.test(s.replace(/^[A-Z]{2,4}\s*\|\s*/, "")); },

        category: function (name) {
            var t = readTag(name), rest = t.rest, tag = t.tag, lang = t.lang, group = t.group, m, w = null;
            // "24/7 | FRENCH": a language's round-the-clock channels
            var allDay = /^24\s*\/\s*7\s*[|:\-]?\s*/.exec(rest);
            if (allDay) rest = rest.slice(allDay[0].length);
            // a code APL TV does not know before a country written out ("[LT] LATINO MOVIES"): the country counts
            if (!tag && (m = /^\[([A-Z]{2,4})\]\s*|^([A-Z]{2,4})\s*\|\s*/.exec(rest)) && (w = written(rest.slice(m[0].length)))) rest = rest.slice(m[0].length);
            else w = written(rest);
            if (w && w.end && tag) w = null;                    // "[IN] SOUTH INDIA": its code says it, the name stays whole
            if (w) {
                var wl = TAGS[w.code] || LANGS[w.code] || "", takes = !tag || (wl && TAGS[tag] !== wl);
                if (takes) { tag = w.code; lang = wl; group = GROUP_OF[w.code] || w.code; }
                /* "FRANCE GENERALE" -> "GENERALE"; the name stays whole when the country ends it ("Tour de France"), is
                   all of it ("AUSTRIA"), comes before a number ("FRANCE 2") or the code already said it ("[SW] SWEDISH MOVIES") */
                if (takes && !w.end && /^[^\d\s]/.test(w.rest) && /[A-Za-zÀ-ɏͰ-ۿ]/.test(w.rest)) rest = w.rest;
                else w = { rest: "" , keep: true };
            }
            if (allDay) rest = !rest || (w && w.keep && written(rest) && !written(rest).rest) ? "24/7" : "24/7 · " + rest;   // "24/7 | FRENCH" -> "24/7"
            var clean = readable(rest.replace(/\s*[|:]\s*/g, " · "));
            return {
                raw: name, tag: tag, lang: lang, group: group,
                name: clean || name || TV.t("Other"),
                adult: ADULT.test(name || ""),
                kind: RE_SERIES.test(name || "") ? "series" : (RE_MOVIES.test(name || "") ? "movie" : "")
            };
        },

        /* A channel's display name and quality, and the key shared by its variants ("TF1 FHD", "TF1 HD" -> "tf1") */
        channel: function (name) {
            var t = readTag(name), s = t.rest, q = "";
            // what is left of a provider's codes before the name: "PPV| UFC 1", "UK-WAFCON| Channel 4", "VIP| Shahid", "24/7-EN - Batman"
            s = s.replace(/^(?:[A-Z0-9][A-Z0-9+\-\/.]{0,11}(?: [A-Z]{2,3})?\s*\|\s*)+/, function (p) { return p.length < s.length ? "" : p; })
                 .replace(/^24\/7[\s-]*(?:[A-Z]{2,3})?\s*[-|:]\s*/i, "");
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
            var t = readTag(name), s = t.rest.replace(/^[A-Z]{2,4}\s*\|\s*(?=\S)/, ""), year = 0, m;     // "LT| Desde adentro": a code APL TV does not know
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
            return { show: cleanSpaces(readTag(m[1]).rest.replace(/^[A-Z]{2,4}\s*\|\s*(?=\S)/, "")), season: parseInt(m[2], 10), episode: parseInt(m[3], 10) };
        },

        /* Categories in a useful order: the screen's language (and multi) first, adult last */
        sortCategories: function (cats) {
            var mine = TV.lang, primary = PRIMARY[mine] || [];
            function rank(c) {
                if (c.adult) return 9;
                // the provider's own notes ("Account Information", one channel): last
                if ((c.count || 0) <= 3 && /\b(acc?ou?n?t|info(rmation)?s?|expir\w*|abonnement|subscription)\b/i.test(c.raw || c.name || "")) return 8;
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
        fold: fold
    };
    function fold(s) {
            s = String(s || "").toLowerCase();
            s = s.replace(FOLD_RE, function (c) { return FOLD[c]; });    // "Wisła", "Cœur", "Bodø" were "wis a", "c ur", "bod"
            try { s = s.normalize("NFD").replace(/[̀-ͯ]/g, ""); } catch (e) {}
            /* Arabic (asked on Reddit): one form per letter, as people type them (the hamza and madda forms of alef,
               taa marbuta, alef maqsura), no vowel marks nor stretching; its punctuation a space. Arabic, Greek,
               Cyrillic and Hebrew letters are kept (only a-z and 0-9 were: an Arabic title folded to nothing). */
            s = s.replace(/[\u064B-\u065F\u0670\u0640]/g, "").replace(/[\u0622\u0623\u0625\u0671]/g, "\u0627").replace(/\u0629/g, "\u0647").replace(/\u0649/g, "\u064A")
                 .replace(/[\u060C\u061B\u061F\u066A-\u066D\u06D4]/g, " ");
            return s.replace(/[^a-z0-9+\u0370-\u03FF\u0400-\u04FF\u0590-\u05FF\u0600-\u06FF\u0750-\u077F]+/g, " ").trim();
    }
})(window);
