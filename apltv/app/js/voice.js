/* ============================================================
   voice.js: the screen's voice assistant (Alexa or Bixby, built into the
   screen) talks to APL TV through Samsung's Voice Interaction API
   (webapis.voiceinteraction, Tizen 6 and newer, privilege voicecontrol).
   - "Search Dragon Ball movies" / « Cherche les films Dragon Ball »:
     Search opens with "dragon ball" typed in, the movies row first and the
     focus on the first result, ready to choose.
   - "Open Shrek": the title's page (or the channel).
   - While a video plays: play, pause, skip forward / back N seconds, go to
     a position, start over, next / previous episode (or channel).
   Whatever APL TV does not handle returns false: the screen then does its
   own thing (usually the matching remote key, which APL TV handles too).
   Also reachable without voice: app control search=<words> (APL Launcher…).
   ============================================================ */
(function (global) {
    "use strict";

    var TV = global.TV, D = TV.data;

    function api() { try { return global.webapis && global.webapis.voiceinteraction; } catch (e) { return null; } }
    function log(s) { if (TV.DEV) TV.log("voice: " + s); }

    /* What the assistant is told APL TV is showing, before each request */
    function state() {
        try {
            if (TV.osd.isOpen() || (TV.multiview && TV.multiview.isOpen())) return "Player";
            if (TV.detail.isOpen() || (TV.person && TV.person.isOpen())) return "List";
            var c = TV.shell && TV.shell.current();
            return c === "home" ? "Home" : c === "search" ? "Search" : c === "settings" ? "Setting" : "List";
        } catch (e) { return "Unknown"; }
    }

    /* ---------- what was asked ---------- */
    var KINDS = [
        ["movies", /(^|[^a-z])(films?|movies?|longs? m[ée]trages?|cin[ée]ma)([^a-z]|$)/i],
        ["series", /(^|[^a-z])(s[ée]ries?|tv shows?|shows?|feuilletons?|saisons?|[ée]pisodes?|anim[ée]s?)([^a-z]|$)/i],
        ["live", /(^|[^a-z])(cha[iî]nes?|channels?|en direct|direct|live)([^a-z]|$)/i]
    ];
    // Words around the title: the request itself, the app's name, articles and the kind words
    var NOISE = new RegExp("(^|\\s)(" + [
        "alexa", "bixby", "hey", "ok", "okay", "demande[rz]?", "à", "ask", "s'il te pla[iî]t", "s'il vous pla[iî]t", "please", "merci",
        "(?:re)?cherche[rz]?", "trouve[rz]?", "montre[rz]?", "affiche[rz]?", "mets?", "mettre", "lance[rz]?", "joue[rz]?", "regarde[rz]?",
        "moi", "je veux", "j'aimerais", "voir", "search", "for", "look", "up", "find", "show", "me", "play", "watch", "open", "ouvre",
        "i want", "to", "sur", "dans", "on", "in", "from", "a\\.? ?p\\.? ?l\\.? ?t\\.? ?v\\.?", "apltv", "apl", "tv",
        "les", "le", "la", "l'", "des", "du", "de", "d'", "un", "une", "the", "an?", "some", "tous", "toutes", "all",
        "films?", "movies?", "longs?", "m[ée]trages?", "cin[ée]ma", "s[ée]ries?", "shows?", "feuilletons?", "saisons?", "[ée]pisodes?", "anim[ée]s?",
        "cha[iî]nes?", "channels?", "en", "direct", "live"
    ].join("|") + ")(?=\\s|$)", "gi");

    function kindOf(text) {
        for (var i = 0; i < KINDS.length; i++) if (KINDS[i][1].test(text)) return KINDS[i][0];
        return "";
    }
    /* Names said aloud, as Alexa writes them: "m. six" -> "m6", "t. f. un" -> "tf1", "france deux" -> "france 2",
       "canal plus" -> "canal+". A number starting the title stays a word ("Seven", « Six pieds sous terre »). */
    var NUM = { "zéro": 0, "zero": 0, "un": 1, "une": 1, "one": 1, "deux": 2, "two": 2, "trois": 3, "three": 3, "quatre": 4, "four": 4,
                "cinq": 5, "five": 5, "six": 6, "sept": 7, "seven": 7, "huit": 8, "eight": 8, "neuf": 9, "nine": 9, "dix": 10, "ten": 10,
                "onze": 11, "eleven": 11, "douze": 12, "twelve": 12, "treize": 13, "quatorze": 14, "quinze": 15, "seize": 16, "vingt": 20 };
    function spoken(s) {
        var w = s.trim().split(" "), out = [], i = 0, x, acc;
        while (i < w.length) {
            if (/^[a-z]$/.test(w[i]) && w[i + 1] && (/^[a-z]$/.test(w[i + 1]) || NUM.hasOwnProperty(w[i + 1]))) {
                acc = "";
                while (i < w.length && /^[a-z]$/.test(w[i])) acc += w[i++];
                if (i < w.length && NUM.hasOwnProperty(w[i])) acc += NUM[w[i++]];
                out.push(acc);
                continue;
            }
            x = w[i++];
            // "un" is an article, except last ("RMC Sport un" -> 1)
            if (NUM.hasOwnProperty(x) && out.length && (!/^(un|une|one)$/.test(x) || i === w.length)) x = String(NUM[x]);
            if (x === "plus" && i === w.length && out.length) { out[out.length - 1] += "+"; continue; }
            out.push(x);
        }
        return " " + out.join(" ") + " ";
    }
    function clean(text, asSaid) {
        var s = " " + String(text || "").toLowerCase().replace(/[’`]/g, "'").replace(/[.,!?;:«»"“”]/g, " ")
            .replace(/-(moi|nous|les|la|le|toi|en)(?=\s|$)/g, " $1").replace(/\s+/g, " ") + " ";
        if (!asSaid) s = spoken(s);
        for (var i = 0; i < 4; i++) s = s.replace(NOISE, " ");      // a few passes: "les films de" -> nothing left around the title
        return s.replace(/\s+/g, " ").trim();
    }
    /* The search term the assistant sends: its fields when the screen gives them, else the whole sentence */
    function field(term, name) {
        var vi = api();
        try { var v = vi && vi.getDataFromSearchTerm ? vi.getDataFromSearchTerm(term, name) : ""; return v ? String(v) : ""; } catch (e) { return ""; }
    }
    // The screen hands it over as { utterance, title, genre, cast, contentType, from, to } (all text)
    function readTerm(term) {
        if (typeof term === "string") return { utterance: term, title: "", genre: "", type: "" };
        term = term || {};
        return {
            utterance: String(term.utterance || field(term, "SEARCH_TERM_UTTERANCE") || ""),
            title: String(term.title || field(term, "SEARCH_TERM_TITLE") || ""),
            genre: String(term.genre || field(term, "SEARCH_TERM_GENRE") || ""),
            type: String(term.contentType || field(term, "SEARCH_TERM_CONTENT_TYPE") || "")
        };
    }
    function onSearch(name) {
        return function (term) {
            var t = readTerm(term);
            log(name + " " + safe(term) + " -> " + JSON.stringify(t));
            var kind = kindOf(t.type) || kindOf(t.utterance);
            var text = t.title || t.utterance || t.genre;
            return text ? search(text, kind) : false;
        };
    }
    function safe(x) { try { return typeof x === "string" ? x : JSON.stringify(x); } catch (e) { return String(x); } }

    /* ---------- doing it ---------- */
    // Back to the tabs: the player, a title's or an actor's page, a menu… are closed first
    function toTop() {
        var i;
        try { if (TV.osd.isOpen()) TV.osd.close(); } catch (e) {}
        try { if (TV.multiview && TV.multiview.isOpen()) TV.multiview.close(); } catch (e) {}
        for (i = 0; i < 12 && TV.person && TV.person.isOpen(); i++) TV.person.close();
        for (i = 0; i < 12 && TV.detail.isOpen(); i++) TV.detail.close();
        ["menu", "alert"].forEach(function (id) { var r = TV.$(id); if (r) r.classList.remove("is-open"); });
        for (i = 0; i < 12 && TV.topNav() && TV.topNav() !== TV.shell.screen; i++) TV.popNav(TV.topNav());
    }
    // The catalog may still be loading (the app was just opened by the request): wait for it, 30 s at most
    function whenReady(fn, tries) {
        if (D.catalog()) { fn(); return; }
        if ((tries || 0) > 60) return;
        setTimeout(function () { whenReady(fn, (tries || 0) + 1); }, 500);
    }

    /* A channel named exactly ("M6", "TF1", "France 2", "Canal+"): the one to start. Its variants share a key
       (smart.js: "TF1 FHD", "TF1 HD" -> "tf1"); among them: a favorite, then a recent one, then one in the
       screen's language, then the best quality, then the lowest number. */
    function exactChannel(q) {
        var want = String(q || "").toLowerCase().replace(/[^a-z0-9À-ɏ+]+/g, "").replace(/\+/g, "plus");
        if (!want) return null;
        var r = D.channelsNamed(want).slice();
        if (!r.length) return null;
        var fav = D.favIds(), rec = TV.load("recent", []) || [];
        function score(c) {
            var ri = rec.indexOf(c.id), mine = String(c.key).indexOf(TV.lang + ":") === 0 || D.catOf(c).lang === TV.lang;
            return (fav.indexOf(c.id) !== -1 ? 1000 : 0) + (ri !== -1 ? 500 - ri : 0) +
                   (mine ? 100 : 0) + TV.smart.qualityRank(c.q) * 10 - (c.num || 0) / 100000;
        }
        r.sort(function (a, b) { return score(b) - score(a); });
        return r[0];
    }

    function search(text, kind) {
        var asSaid = clean(text, true) || String(text || "").toLowerCase().trim();   // "Up": a title made only of small words
        var q = clean(text) || asSaid;
        kind = kind || kindOf(text);
        whenReady(function () {
            // "Mets M6", « la chaîne TF1 »: the channel itself, straight away (not when movies or series were asked for)
            if (kind !== "movies" && kind !== "series") {
                var ch = null;
                try { ch = exactChannel(q) || (q !== asSaid ? exactChannel(asSaid) : null); } catch (e) {}
                if (ch) { log("play channel " + ch.name + " (" + (ch.q || "-") + ")"); toTop(); TV.live.play(ch); return; }
            }
            // "m6" for "m. six", unless only the words as said find something ("Les Quatre Fantastiques")
            if (q !== asSaid) {
                try { var r = D.search(q, 3); if (!r.live.length && !r.movies.length && !r.series.length) q = asSaid; } catch (e) {}
            }
            log("search \"" + q + "\" (" + (kind || "all") + ") from \"" + text + "\"");
            toTop();
            TV.shell.go("search", true);
            TV.search.ask(q, kind);
        });
        return true;
    }

    function openTitle(text) {
        var q = clean(text), cat = D.catalog();
        if (!q || !cat) return false;
        var fold = TV.smart.fold, r = D.search(q, 12), want = fold(q);
        var all = r.movies.concat(r.series), hit = null;
        for (var i = 0; i < all.length && !hit; i++) if (fold(clean(all[i].title || all[i].name)) === want) hit = all[i];
        if (!hit && all.length === 1) hit = all[0];
        if (hit) { toTop(); TV.detail.open(hit); log("open title " + (hit.title || hit.name)); return true; }
        if (r.live.length === 1) { toTop(); TV.live.play(r.live[0]); return true; }
        if (all.length || r.live.length) return search(text);       // several possible: let the person choose
        return false;
    }

    /* ---------- the APL TV skill for Alexa ----------
       Samsung's Alexa keeps searches for its own panel (only Samsung's partner apps). With the APL TV skill
       (alexa-skill/ in the repository, made by each person in their own Amazon developer account),
       "Alexa, ask APL TV to search Dragon Ball" posts the words to a private ntfy.sh topic: the code shown in
       Settings › Alexa Skill. APL TV listens to it only while it is open on the screen. Nothing but the
       searched words goes through it; a message is only ever a search, never anything else. */
    var es = null, esCode = "";
    function relayCode() {
        var c = TV.load("alexaCode", null);
        if (c === null) {
            // From keys.local.js: kept in APL TV's own storage, so a reinstall without it keeps the skill working
            c = (global.TV_KEYS && global.TV_KEYS.alexa) || "";
            if (/^[A-Za-z0-9_-]{12,64}$/.test(c)) TV.save("alexaCode", c);
        }
        return /^[A-Za-z0-9_-]{12,64}$/.test(c) ? c : "";
    }
    function setRelayCode(c) { TV.save("alexaCode", c || ""); relay(); }
    function newRelayCode() {
        var A = "abcdefghijkmnpqrstuvwxyz23456789", s = "apltv-", b = [], i;
        try { b = global.crypto.getRandomValues(new Uint8Array(16)); } catch (e) { for (i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256); }
        for (i = 0; i < 16; i++) s += A[b[i] % A.length];
        setRelayCode(s);
        return s;
    }
    function relay() {
        var c = document.hidden ? "" : relayCode();
        if (es && esCode === c) return;
        if (es) { try { es.close(); } catch (e) {} es = null; esCode = ""; }
        if (!c || !global.EventSource) return;
        esCode = c;
        es = new global.EventSource("https://ntfy.sh/" + c + "/sse");
        es.onmessage = function (e) {
            var m, b = {};
            try { m = JSON.parse(e.data); } catch (x) { return; }
            if (!m || m.event !== "message" || Date.now() / 1000 - (m.time || 0) > 90) return;      // never an old request
            try { b = JSON.parse(m.message); } catch (x) { b = { q: m.message }; }
            var q = String((b && b.q) || "").replace(/[\u0000-\u001f<>]/g, " ").slice(0, 80);
            if (q) { log("skill: " + q); search(q); }
        };
        es.onerror = function () { log("skill relay: connection lost, the browser retries"); };
        log("skill relay on");
    }
    document.addEventListener("visibilitychange", relay);

    function start() {
        relay();
        var vi = api();
        if (!vi || !vi.setCallback) { log("no Voice Interaction API on this screen"); return; }
        var P = function () { return TV.osd.voice; };
        try {
            vi.setCallback({
                onupdatestate: function () { var s = state(); log("state " + s); return s; },
                onsearch: onSearch("onsearch"),
                ondefaultsearch: onSearch("ondefaultsearch"),
                onsearchcollection: onSearch("onsearchcollection"),
                // "Go to Search / Home / Settings"
                onchangeappstate: function (s) {
                    log("onchangeappstate " + s);
                    var tab = { Home: "home", Search: "search", Setting: "settings", List: "movies" }[s];
                    if (!tab || !TV.views[tab]) return false;
                    toTop(); TV.shell.go(tab, true); return true;
                },
                // Not handled by APL TV (the screen does its own thing), only noted in test builds
                oncustom: function (p) { log("oncustom " + safe(p)); return false; },
                oncontinuewatching: function () { log("oncontinuewatching"); return false; },
                onnavigation: function (n) { log("onnavigation " + safe(n)); return false; },
                onselection: function (n) { log("onselection " + safe(n)); return false; },
                onstop: function () { log("onstop"); return false; },
                onexit: function () { log("onexit"); return false; },
                onfastforward: function () { log("onfastforward"); return false; },
                onrewind: function () { log("onrewind"); return false; },
                ontitleselection: function (title) { log("ontitleselection " + title); return openTitle(title); },
                onplay: function () { log("onplay"); return P().play(true); },
                onpause: function () { log("onpause"); return P().play(false); },
                onskipforward: function (sec) { log("onskipforward " + sec); return P().seekBy(Number(sec) || 30); },
                onskipbackward: function (sec) { log("onskipbackward " + sec); return P().seekBy(-(Number(sec) || 30)); },
                onsetplayposition: function (pos) {
                    var p = Number(pos) || 0, d = TV.player.duration();
                    if (d && p > d && p / 1000 <= d) p = p / 1000;         // milliseconds on some screens
                    log("onsetplayposition " + pos);
                    return P().seekTo(p);
                },
                onrestart: function () { log("onrestart"); return P().seekTo(0); },
                onchangenexttrack: function () { log("onchangenexttrack"); return P().step(1); },
                onchangeprevioustrack: function () { log("onchangeprevioustrack"); return P().step(-1); }
            });
            vi.listen();
            var v = ""; try { v = vi.getVersion ? vi.getVersion() : ""; } catch (e) {}
            log("listening (API " + v + "; " + Object.keys(vi).join(", ") + ")");
        } catch (e) {
            log("could not listen: " + (e && (e.name + " " + e.message)));
        }
    }

    TV.voice = { search: search, openTitle: openTitle, clean: clean, kindOf: kindOf, start: start,
                 relayCode: relayCode, setRelayCode: setRelayCode, newRelayCode: newRelayCode };
})(window);
