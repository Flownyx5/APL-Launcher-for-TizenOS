/* ============================================================
   osd.js: full screen, Apple TV style.
   Live: a glass bar with the channel, its programme, the time left and
   the next one. ▲▼ (or CH+ CH-) zap, OK shows the channel list over the
   picture, Back goes back. ⏮ / PRE-CH: the previous channel. With the
   bar shown, ▶ goes to the Subtitles and Audio buttons.
   Movies and episodes: the title at the bottom left, the timeline, the
   Subtitles and Audio buttons above it on the right (▲), Previous and
   Next episode under it (▼). ◀ ▶ on the timeline: the picture pauses and
   a cursor moves (10 s a press, faster when held); it jumps there when
   you stop, or at once with OK; Back cancels. 0-9 jump to 0-90 %.
   Subtitles: the video's own, or OpenSubtitles (never chosen by itself),
   with a delay you set while watching. Near the end of an episode, the
   next one is offered (the series' picture, no spoiler); it only starts
   by itself if you turned that on.
   ============================================================ */
(function (global) {
    "use strict";

    var TV = global.TV, el = TV.el, esc = TV.esc, T = TV.t, D = TV.data, K = TV.KEY;
    var root, shade, bar, list, listClip, clock, numBox, stateBox, errBox, subsBox, popEl, nextEl;
    var mode = null, open = false, hideTimer = null, clockTimer = null;
    var ch = null, ctx = [], prevCh = null, onClose = null, onZap = null, vlist = null, zapTimer = null;
    var vod = null;            // { item, ep, prev, next, title, sub, resumeKey, art }
    var scrub = null, seekTimer = null, saveTimer = null, subTimer = null, tracksDone = false, holdFrom = 0;
    var zone = "track";        // track | icons | tabs | next   (live: live | icons)
    var iconIndex = 0, tabIndex = 0, pop = null, subsOn = false;
    var ext = null, extTimer = null, delayMs = 0, os = { state: "idle", list: [] };
    var seen = { ms: 0, at: 0 }, nextShown = false, nextTimer = null, nextLeft = 0;
    var streamQ = null, qFor = null, qAsked = false;   // the stream's own qualities (Quality button), read once it plays
    var tsh = null, tsTarget = null, tsJumpTimer = null, tsPoll = 0;   // timeshift (below)

    function build() {
        root = TV.$("osd");
        root.innerHTML = "";
        shade = el("div", "osd__shade");
        subsBox = el("div", "osd__subs");
        bar = el("div", "osd__bar");
        list = el("div", "osd__list");
        clock = el("div", "osd__clock");
        numBox = el("div", "osd__num glass");
        stateBox = el("div", "osd__state glass", "<div class='osd__spin'></div>");
        errBox = el("div", "osd__err glass");
        popEl = el("div", "osd__pop");
        nextEl = el("div", "osd__nextcard");
        [shade, subsBox, bar, list, clock, numBox, stateBox, errBox, popEl, nextEl].forEach(function (n) { root.appendChild(n); });
        list.appendChild(el("div", "osd__listhead"));
        listClip = el("div", "osd__listclip");
        list.appendChild(listClip);
        vlist = new TV.VList({ clip: listClip, rowH: 100, viewH: 880, render: renderRow, onFocus: function () {} });
        applySubStyle();
    }
    function renderRow(c) {
        var r = el("div", "crow"), n = TV.epg.now(c), cur = n && n.cur, logo = el("div", "crow__logo");
        TV.logoBox(logo, c);
        r.appendChild(el("div", "crow__num", String(c.num)));
        r.appendChild(logo);
        var txt = el("div", "crow__txt");
        txt.innerHTML = "<div class='crow__name'>" + esc(c.name) + "</div><div class='crow__prog'>" + (cur ? esc(cur[2]) : "&nbsp;") + "</div>" +
            (cur ? "<div class='bar crow__bar'><i style='width:" + Math.round(TV.epg.progress(cur) * 100) + "%'></i></div>" : "");
        r.appendChild(txt);
        if (ch && c.id === ch.id) r.appendChild(el("div", "crow__fav", TV.icon("speaker", 26)));
        return r;
    }

    /* The bar stays while you use it (buttons, a menu, the cursor, paused) */
    function busy() { return root.classList.contains("has-list") || !!scrub || !!pop || zone !== (mode === "live" ? "live" : "track") || (vod && TV.player.state() === "PAUSED") || !!(tsh && tsh.paused) || tsTarget !== null; }
    function show(ms) {
        root.classList.add("is-shown");
        clearTimeout(hideTimer);
        if (ms !== 0) hideTimer = setTimeout(function () { if (!busy()) root.classList.remove("is-shown"); }, ms || 5000);
    }
    function hideBar() { clearTimeout(hideTimer); root.classList.remove("is-shown"); }
    function tickClock() { clock.textContent = TV.hhmm(new Date()); }

    function openOsd(m) {
        if (!root) build();
        mode = m; open = true;
        zone = m === "live" ? "live" : "track"; iconIndex = 0; tabIndex = 0;
        streamQ = null; qFor = null; qAsked = false;
        closePop(true);
        root.className = "osd is-on" + (m === "vod" ? " osd--vod" : "");
        applySubStyle();
        document.body.classList.add("is-fullscreen");
        errBox.classList.remove("is-on");
        subsBox.innerHTML = "";
        nextEl.classList.remove("is-on");
        tickClock(); clearInterval(clockTimer);
        var ticks = 0;
        clockTimer = setInterval(function () {
            if (mode === "vod" && vod) checkNextCard();
            if (pop && pop.kind === "info") refreshPop();
            watchQualities();
            if (tsh) tsTick();
            var shown = root.classList.contains("is-shown");
            if (shown) tickClock();
            if (!shown) return;
            if (mode === "live") { if (++ticks % 15 === 0 || tsh) drawLive(); } else drawVod();
        }, 1000);
        TV.pushNav(screen);
    }
    function closeOsd() {
        open = false;
        clearInterval(clockTimer); clearTimeout(hideTimer); clearInterval(saveTimer); clearTimeout(seekTimer); clearTimeout(subTimer);
        stopExt(); clearInterval(nextTimer);
        scrub = null; pop = null;
        root.className = "osd";
        document.body.classList.remove("is-fullscreen");
        TV.popNav(screen);
    }

    /* ---------- languages ---------- */
    var LANG_ALIASES = {
        fr: "fr fre fra french francais français vf vff vfq vfi", en: "en eng english anglais", es: "es spa spanish espanol español castellano spn", de: "de ger deu german deutsch allemand",
        it: "it ita italian italiano italien", pt: "pt por portuguese portugues português", pb: "pob pb ptbr pt-br", ar: "ar ara arabic arabe", tr: "tr tur turkish turc türkçe turkce",
        nl: "nl dut nld dutch nederlands", ru: "ru rus russian russe", ja: "ja jpn japanese japonais", ko: "ko kor korean coreen coréen", zh: "zh chi zho chinese chinois zht zhe",
        hi: "hi hin hindi", pl: "pl pol polish polski", el: "el gre ell greek", ro: "ro rum ron romanian", sv: "sv swe swedish", he: "he heb hebrew", hu: "hu hun hungarian",
        cs: "cs cze ces czech", da: "da dan danish", fi: "fi fin finnish", no: "no nor nob norwegian", uk: "uk ukr ukrainian", bg: "bg bul bulgarian", hr: "hr hrv croatian",
        sr: "sr srp scc serbian", sl: "sl slv slovenian", sk: "sk slo slk slovak", vi: "vi vie vietnamese", th: "th tha thai", id: "id ind indonesian", ms: "ms may msa malay",
        fa: "fa per fas persian", lt: "lt lit", lv: "lv lav", sq: "sq alb sqi", ta: "ta tam", te: "te tel"
    };
    var LANG_NAMES = { fr: "Français", en: "English", es: "Español", de: "Deutsch", it: "Italiano", pt: "Português", pb: "Português (Brasil)", ar: "العربية", tr: "Türkçe", nl: "Nederlands",
                       ru: "Русский", ja: "日本語", ko: "한국어", zh: "中文", hi: "हिन्दी", pl: "Polski", el: "Ελληνικά", ro: "Română", sv: "Svenska", he: "עברית", hu: "Magyar",
                       cs: "Čeština", da: "Dansk", fi: "Suomi", no: "Norsk", uk: "Українська", bg: "Български", hr: "Hrvatski", sr: "Srpski", sl: "Slovenščina", sk: "Slovenčina",
                       vi: "Tiếng Việt", th: "ไทย", id: "Bahasa Indonesia", ms: "Bahasa Melayu", fa: "فارسی", lt: "Lietuvių", lv: "Latviešu", sq: "Shqip", ta: "தமிழ்", te: "తెలుగు" };
    var aliasOf = {};
    Object.keys(LANG_ALIASES).forEach(function (k) { LANG_ALIASES[k].split(" ").forEach(function (a) { aliasOf[a] = k; }); });
    function norm(code) { var c = String(code || "").toLowerCase().trim(); return aliasOf[c] || aliasOf[c.slice(0, 3)] || aliasOf[c.slice(0, 2)] || c; }
    /* A language's name in the app's language (Intl, "Anglais" in French), else in its own (the table); nothing for
       "und" (undetermined), "mul", "zxx" or a code that names nothing */
    var langNames = null;
    function langName(code) {
        var n = norm(code);
        if (!n || n === "und" || n === "mul" || n === "zxx" || n === "mis") return "";
        try {
            if (langNames === null) langNames = global.Intl && Intl.DisplayNames ? new Intl.DisplayNames([TV.locale || TV.lang], { type: "language" }) : false;
            if (langNames && /^[a-z]{2,3}$/.test(n === "pb" ? "pt" : n)) {
                var s = langNames.of(n === "pb" ? "pt-BR" : n);
                if (s && s.toLowerCase() !== n) return s.charAt(0).toUpperCase() + s.slice(1);
            }
        } catch (e) {}
        return LANG_NAMES[n] || (/^[a-z]{2,3}$/.test(n) ? String(code).toUpperCase() : String(code));
    }
    /* A track's line: its language, its own name beside when it says more ("English" + "SDH", "Forced"), its name
       alone when it has no language, "Track 2" only when it has neither */
    function trackLabel(t, i) {
        var l = langName(t.lang), n = String(t.name || "").trim();
        if (!l) return { label: n || T("Track {n}", { n: i + 1 }), sub: "" };
        var f = function (x) { return TV.smart && TV.smart.fold ? TV.smart.fold(x) : String(x || "").toLowerCase(); };
        var same = !n || f(n) === f(l) || f(n) === f(t.lang) || f(langName(n)) === f(l);
        return { label: l, sub: same ? "" : n };
    }
    function wantLang(p) { return p === "auto" ? TV.lang : p; }

    /* Audio and subtitles of a new video: your language first, then the second choice (never OpenSubtitles) */
    function applyTrackPrefs() {
        if (tracksDone) return;
        var tr = TV.player.tracks();
        if (!tr.length) return;
        tracksDone = true;
        var audio = tr.filter(function (t) { return t.type === "AUDIO"; }), subs = tr.filter(function (t) { return t.type === "TEXT"; });
        TV.log("tracks: audio " + audio.map(function (a) { return a.lang || "?"; }).join(",") + "; subtitles " + (subs.map(function (s) { return s.lang || "?"; }).join(",") || "none"));
        var chosenAudio = audio[0] || null, curA = TV.player.currentTrack("AUDIO");
        audio.forEach(function (a) { if (a.index === curA) chosenAudio = a; });
        if (audio.length > 1) {
            var wants = [TV.pref("audioLang"), TV.pref("audioLang2")];
            for (var i = 0; i < wants.length; i++) {
                var w = wants[i], hit = null;
                if (!w || w === "none") continue;
                if (w === "orig") hit = audio[0];
                else audio.forEach(function (a) { if (!hit && norm(a.lang) === wantLang(w)) hit = a; });
                if (hit) { chosenAudio = hit; if (hit.index !== curA) TV.player.selectTrack("AUDIO", hit.index); break; }
            }
        }
        if (audio.length) setTimeout(function () { offerVersion(audio); }, 1500);
        if (ext) return;                                   // OpenSubtitles chosen by you stays
        var sw = [TV.pref("subLang"), TV.pref("subLang2")], picked = null, heard = chosenAudio ? norm(chosenAudio.lang) : "";
        for (var j = 0; j < sw.length && !picked && subs.length; j++) {
            var s = sw[j];
            if (!s || s === "off") continue;
            if (s === "auto") { if (heard && heard !== TV.lang) subs.forEach(function (t) { if (!picked && norm(t.lang) === TV.lang) picked = t; }); continue; }
            subs.forEach(function (t) { if (!picked && norm(t.lang) === s) picked = t; });
        }
        if (picked) { TV.player.subtitlesOff(false); TV.player.selectTrack("TEXT", picked.index); }
        else TV.player.subtitlesOff(true);
        subsOn = !!picked;
    }

    /* ---------- subtitles, drawn by APL TV ---------- */
    var SUB = {
        size: [["s", "Small"], ["m", "Medium"], ["l", "Large"], ["xl", "Extra Large"]],
        color: [["white", "White"], ["yellow", "Yellow"], ["cyan", "Cyan"], ["green", "Green"]],
        bg: [["outline", "Outline"], ["shadow", "Drop Shadow"], ["box", "Translucent Box"], ["solid", "Black Box"]],
        pos: [["low", "Bottom"], ["high", "A Little Higher"]]
    };
    function applySubStyle() {
        if (!root) return;
        ["subSize", "subColor", "subBg", "subPos"].forEach(function (k) {
            var cls = root.className.split(" ").filter(function (c) { return c.indexOf(k + "-") !== 0; });
            cls.push(k + "-" + TV.pref(k));
            root.className = cls.join(" ");
        });
    }
    function cleanSub(t) {
        t = String(t || "").replace(/\{[^}]*\}/g, "").replace(/\\N/g, "\n");
        return esc(t).replace(/&lt;(\/?)(i|b|u)&gt;/gi, "<$1$2>").replace(/&lt;[^&]*?&gt;/g, "").replace(/\r?\n/g, "<br>").trim();
    }
    var lastSub = "";
    function putSub(h) { if (h === lastSub) return; lastSub = h; subsBox.innerHTML = h ? "<span>" + h + "</span>" : ""; }
    function showSub(o) {
        clearTimeout(subTimer);
        var h = cleanSub(o && o.text);
        putSub(h);
        if (h && o.dur > 0) subTimer = setTimeout(function () { putSub(""); }, o.dur + 150);
    }
    function sampleSub() {
        if (!root) build();
        applySubStyle();
        showSub({ text: T("This is how subtitles look."), dur: 4000 });
    }

    /* ---------- OpenSubtitles (through Stremio's public OpenSubtitles service: no account) ---------- */
    var OS = "https://opensubtitles-v3.strem.io/subtitles/";
    /* The subtitles made from this very file. OpenSubtitles knows a video by its fingerprint: its size, and the 64 KB
       at its start and at its end added up as 64-bit numbers. Asked with it, it says which subtitles were timed on
       this exact file (in time from the first line to the last). Only two small pieces of the file are read. */
    function rangeBytes(url, from, to) {
        return new Promise(function (ok, ko) {
            var x = new XMLHttpRequest(), done = false, timer = setTimeout(function () { fail("timeout"); }, 7000);
            function fail(m) { if (done) return; done = true; clearTimeout(timer); try { x.abort(); } catch (e) {} ko(new Error(m)); }
            try {
                x.open("GET", url, true);
                x.responseType = "arraybuffer";
                x.setRequestHeader("Range", "bytes=" + from + "-" + to);
                x.onreadystatechange = function () {
                    if (done) return;
                    // a server that sends the whole movie instead of the piece asked: stopped at once
                    if (x.readyState >= 2 && x.status !== 206) { fail("no range (" + x.status + ")"); return; }
                    if (x.readyState !== 4) return;
                    done = true; clearTimeout(timer);
                    ok({ buf: x.response, total: +(String(x.getResponseHeader("Content-Range") || "").split("/")[1] || 0) });
                };
                x.onprogress = function (e) { if (e.loaded > to - from + 4097) fail("too much"); };
                x.send();
            } catch (e) { fail(e.message); }
        });
    }
    function fileHash(url) {
        return rangeBytes(url, 0, 65535).then(function (a) {
            var size = a.total;
            if (!(size > 131072) || !a.buf || a.buf.byteLength < 65536) throw new Error("no size");
            return rangeBytes(url, size - 65536, size - 1).then(function (b) {
                if (!b.buf || b.buf.byteLength < 65536) throw new Error("no end");
                return { hash: TV.subtitles.hash(size, a.buf, b.buf), size: size };
            });
        });
    }
    /* OpenSubtitles' sum: the size plus every 8 bytes of both pieces as 64-bit numbers, in four 16-bit parts (older
       TVs have no BigInt) */
    function osSum(size, head, tail) {
        var p = [size % 65536, Math.floor(size / 65536) % 65536, Math.floor(size / 4294967296) % 65536, Math.floor(size / 281474976710656) % 65536];
        [head, tail].forEach(function (buf) {
            var v = new DataView(buf, 0, 65536);
            for (var i = 0; i < 65536; i += 8) {
                p[0] += v.getUint16(i, true); p[1] += v.getUint16(i + 2, true) + (p[0] >>> 16); p[0] &= 65535;
                p[2] += v.getUint16(i + 4, true) + (p[1] >>> 16); p[1] &= 65535;
                p[3] = (p[3] + v.getUint16(i + 6, true) + (p[2] >>> 16)) & 65535; p[2] &= 65535;
            }
        });
        var hex = function (n) { return ("000" + n.toString(16)).slice(-4); };
        return hex(p[3]) + hex(p[2]) + hex(p[1]) + hex(p[0]);
    }
    /* Reading the file a second time while it plays is a second connection: never with an account for one screen
       (the provider could stop the movie for it), nor with a server that asks for a player's name */
    function canReadFile() {
        var it = vod && vod.item, url = vod && vod.url;
        if (!it || !url || !/^https?:/i.test(url) || /\.m3u8|\/hls\//i.test(url) || TV.uaFor(url)) return false;
        var s = D.sources().filter(function (x) { return x.id === it.src; })[0];
        if (!s) return false;
        if (s.type === "jellyfin" || s.type === "plex") return true;
        return s.type === "xtream" && !!s.account && +s.account.max >= 2;
    }
    function osTarget() {
        return TV.meta.lookup(vod.item).then(function (m) {
            if (!m || !m.imdbId) return null;
            if (vod.ep) return OS + "series/" + m.imdbId + ":" + vod.ep.season + ":" + vod.ep.episode + ".json";
            return OS + "movie/" + m.imdbId + ".json";
        });
    }
    function findOS() {
        if (!vod || os.state === "loading") return;
        os = { state: "loading", list: [] };
        refreshPop();
        var my = vod;
        osTarget().then(function (url) {
            if (!url) throw new Error("no IMDb id");
            var ask = function (u) { return TV.fetchJSON(u, { timeout: 15000 }); };
            if (!canReadFile()) return ask(url);
            return fileHash(my.url).then(function (h) {
                TV.log("opensubtitles: this file's fingerprint " + h.hash + " (" + h.size + " bytes)");
                return ask(url.replace(/\.json$/, "/videoHash=" + h.hash + "&videoSize=" + h.size + ".json"));
            }, function (e) { TV.log("opensubtitles: no fingerprint (" + e.message + ")"); return ask(url); });
        }).then(function (j) {
            if (vod !== my) return;
            var order = [wantLang(TV.pref("subLang") === "off" ? "auto" : TV.pref("subLang")), TV.pref("subLang2"), TV.lang, "en"];
            var list = (j && j.subtitles || []).map(function (s, i) {
                var l = norm(s.lang), rank = order.indexOf(l);
                var rel = String(s.movieReleaseName || s.subtitleFileName || "").replace(/\.(srt|sub|ass)$/i, "").replace(/[._]+/g, " ").trim();
                return { id: s.id, url: s.url, lang: l, name: LANG_NAMES[l] || String(s.lang).toUpperCase(), release: rel.length > 52 ? rel.slice(0, 50) + "…" : rel, rank: rank < 0 ? 9 : rank, i: i,
                         exact: s.m === "h", fps: +s.fpsMilli > 0 ? +s.fpsMilli / 1000 : 0 };
            }).filter(function (s) { return s.url; }).sort(function (a, b) { return a.rank - b.rank || (b.exact ? 1 : 0) - (a.exact ? 1 : 0) || a.i - b.i; });
            if (list.some(function (s) { return s.exact; })) TV.log("opensubtitles: " + list.filter(function (s) { return s.exact; }).length + " made for this file");
            os = { state: list.length ? "ready" : "none", list: list };
            TV.log("opensubtitles: " + list.length + " found");
            refreshPop();
        }).catch(function (e) {
            if (vod !== my) return;
            TV.log("opensubtitles: " + e.message);
            os = { state: "error", list: [] };
            refreshPop();
        });
    }
    function parseSubs(txt) {
        var cues = [], blocks = String(txt || "").replace(/\r/g, "").replace(/^﻿/, "").split(/\n\s*\n/);
        function ms(t) { var m = t.match(/(\d+):(\d+):(\d+)[,.](\d+)/) || t.match(/(\d+):(\d+)[,.](\d+)/); if (!m) return -1; return m.length === 5 ? ((+m[1] * 60 + +m[2]) * 60 + +m[3]) * 1000 + +(m[4] + "00").slice(0, 3) : (+m[1] * 60 + +m[2]) * 1000 + +(m[3] + "00").slice(0, 3); }
        blocks.forEach(function (b) {
            var lines = b.split("\n"), k = 0;
            while (k < lines.length && lines[k].indexOf("-->") < 0) k++;
            if (k >= lines.length) return;
            var p = lines[k].split("-->"), s = ms(p[0]), e = ms(p[1] || "");
            if (s < 0 || e < 0) return;
            cues.push({ s: s, e: e, h: cleanSub(lines.slice(k + 1).join("\n")) });
        });
        return cues.sort(function (a, b) { return a.s - b.s; });
    }
    function useOS(o) {
        os.loadingId = o.id; refreshPop();
        var my = vod;
        TV.fetchText(o.url, { timeout: 20000 }).then(function (txt) {
            if (vod !== my) return;
            var cues = parseSubs(txt);
            os.loadingId = null;
            if (!cues.length) { TV.toast(T("These subtitles could not be read.")); refreshPop(); return; }
            TV.player.subtitlesOff(true); subsOn = false;
            var k = o.exact ? 1 : speedOf(o, cues);
            if (k !== 1) cues.forEach(function (c) { c.s = Math.round(c.s * k); c.e = Math.round(c.e * k); });
            ext = { id: o.id, cues: cues, name: o.name, at: 0 };
            startExt();
            TV.toast(T("Subtitles: {name}", { name: o.name + " · OpenSubtitles" }) + (o.exact ? " · " + T("made for this file") : k !== 1 ? " · " + T("set to this video's speed") : ""));
            closePop();
        }).catch(function (e) { os.loadingId = null; TV.log("opensubtitles download: " + e.message); TV.toast(T("These subtitles could not be downloaded.")); refreshPop(); });
    }
    /* Subtitles timed on a copy at another speed drift a little more each minute: a European copy runs at 25 images
       a second, 4 % faster than the film's 23.976 or 24. OpenSubtitles says the speed each one was timed for and the
       screen knows the video's: the times are stretched (or shrunk) to match. Without the speeds, the last line
       ending well after the video does tell it. Never when the result would end after the video. */
    function speedOf(o, cues) {
        var st = TV.player.stats() || {}, vf = +st.fps || 0, dur = (TV.player.duration() || 0) * 1000, last = cues[cues.length - 1].e;
        return TV.subtitles.speed(+o.fps || 0, vf, dur, last);
    }
    function speedFactor(sf, vf, dur, last) {
        var k = 1;
        if (vf > 1000) vf = vf / 1000;
        var pal = function (f) { return Math.abs(f - 25) < 0.06; }, film = function (f) { return Math.abs(f - 23.976) < 0.06 || Math.abs(f - 24) < 0.06; };
        if (sf && vf) { if (pal(sf) && film(vf)) k = 25 / vf; else if (film(sf) && pal(vf)) k = sf / 25; }
        else if (dur > 1200000 && last > dur * 1.025) k = 24 / 25;
        if (k !== 1 && dur > 600000 && last * k > dur + 60000) k = 1;
        if (k !== 1) TV.log("subtitles: timed for " + (sf || "?") + " fps, this video " + (vf || "?") + " fps: times x" + k.toFixed(4));
        return k;
    }
    /* The picture's time between the player's own reports (a few per second) */
    function nowMs() {
        var st = TV.player.state(), base = TV.player.position() * 1000;
        if (seen.ms !== base) { seen.ms = base; seen.at = Date.now(); }
        return st === "PLAYING" ? base + Math.min(1500, Date.now() - seen.at) : base;
    }
    function startExt() {
        stopExt(true);
        extTimer = setInterval(function () {
            if (!ext || scrub) return;
            var t = nowMs() - delayMs, c = ext.cues, i = ext.at;
            if (i >= c.length || (c[i] && c[i].s > t)) i = 0;
            while (i < c.length && c[i].e < t) i++;
            ext.at = i;
            putSub(i < c.length && c[i].s <= t ? c[i].h : "");
        }, 100);
    }
    function stopExt(keep) { clearInterval(extTimer); extTimer = null; if (!keep) ext = null; }
    function setDelay(d) {
        delayMs = Math.max(-60000, Math.min(60000, d));
        TV.log("subtitle delay " + delayMs + " ms" + (ext ? " (OpenSubtitles)" : subsOn ? " (the video's own)" : ""));   // to follow it on the LG
        TV.player.subtitleDelay(delayMs);                  // the video's own subtitles move too
        refreshPop();
    }
    function fmtDelay() { var s = delayMs / 1000; return (s > 0 ? "+" : s < 0 ? "−" : "") + Math.abs(s).toFixed(2).replace(".", TV.lang === "fr" || TV.lang === "es" || TV.lang === "pl" || TV.lang === "it" ? "," : ".") + " s"; }

    /* ---------- the menus above the buttons (Apple TV style) ---------- */
    function subsItems() {
        var tr = TV.player.tracks(), subs = tr.filter(function (t) { return t.type === "TEXT"; }), curS = TV.player.currentTrack("TEXT"), items = [];
        items.push({ label: T("Off"), check: !subsOn && !ext, run: function () { TV.player.subtitlesOff(true); subsOn = false; stopExt(); putSub(""); closePop(); } });
        subs.forEach(function (s, i) {
            var tl = trackLabel(s, i);
            items.push({ label: tl.label, sub: tl.sub, check: subsOn && !ext && s.index === curS, run: function () {
                stopExt(); putSub(""); TV.player.subtitlesOff(false); TV.player.selectTrack("TEXT", s.index); subsOn = true; closePop();
            } });
        });
        if (mode === "vod") {
            items.push({ head: "OpenSubtitles" });
            if (os.state === "idle") items.push({ label: T("Find Subtitles"), icon: "search", keep: true, run: findOS });
            else if (os.state === "loading") items.push({ label: T("Searching…"), keep: true, run: function () {} });
            else if (os.state === "none") items.push({ label: T("None found for this video"), keep: true, run: function () {} });
            else if (os.state === "error") items.push({ label: T("Not available right now. Try again"), keep: true, run: findOS });
            else {
                // your languages first (8 at most); the others behind "Other Languages"
                var mine = os.list.filter(function (o) { return o.rank < 9; }), others = os.list.length - Math.min(mine.length, 8);
                (os.expanded ? os.list.slice(0, 80) : mine.slice(0, 8)).forEach(function (o) {
                    items.push({ label: o.name, sub: os.loadingId === o.id ? T("Downloading…") : o.exact ? T("Made for this file") + (o.release ? " · " + o.release : "") : o.release, check: ext && ext.id === o.id, keep: true, run: function () { useOS(o); } });
                });
                if (!os.expanded && others > 0) items.push({ label: T("Other Languages ({n})", { n: others }), keep: true, run: function () { os.expanded = true; } });
            }
        }
        items.push({ head: T("Settings") });
        items.push({ label: T("Delay"), value: fmtDelay(), keep: true, run: function () { openPop("sync"); } });
        if (ext && ext.cues.length) items.push({ label: T("Sync to a Line"), sub: T("OK the moment you hear it"), keep: true, run: function () { openPop("line"); } });
        items.push({ label: T("Subtitle Style"), run: function () { closePop(); styleMenu(); } });
        return items;
    }
    function audioItems() {
        var tr = TV.player.tracks(), audio = tr.filter(function (t) { return t.type === "AUDIO"; }), curA = TV.player.currentTrack("AUDIO");
        var codecs = { "audio/x-ac3": "Dolby Digital", "audio/ac3": "Dolby Digital", "audio/x-eac3": "Dolby Digital Plus", "audio/eac3": "Dolby Digital Plus", "audio/mpeg": "MPEG",
                       "audio/x-dts": "DTS", "audio/dts": "DTS", "audio/mp4a-latm": "AAC", "audio/aac": "AAC", "audio/x-opus": "Opus", "audio/opus": "Opus", "audio/x-truehd": "Dolby TrueHD" };
        var items;
        if (!audio.length) {
            var st = TV.player.stats() || {};
            items = [{ label: T("Sound of the Video"), sub: [codecName(st.acodec), chName(st.channels)].filter(Boolean).join(" · "), check: true, run: function () { closePop(); } }];
        } else items = audio.map(function (a, i) {
            var cn = codecs[String(a.codec).toLowerCase()] || String(a.codec || "").replace(/^audio\/(x-)?/i, "").toUpperCase();
            var extra = [a.channels ? (a.channels >= 8 ? "7.1" : a.channels >= 6 ? "5.1" : a.channels == 2 ? T("Stereo") : "") : "", cn].filter(Boolean).join(" · ");
            var tl = trackLabel(a, i);
            return { label: tl.label, sub: [tl.sub, extra].filter(Boolean).join(" · "), check: a.index === curA, run: function () {
                TV.player.selectTrack("AUDIO", a.index); TV.log("audio track " + a.index + " (" + a.lang + ")"); closePop();
            } };
        });
        // the language you hear now, for the next movies and episodes
        var now = null;
        audio.forEach(function (a) { if (a.index === curA) now = a; });
        var l = now && norm(now.lang);
        if (audio.length > 1 && l && LANG_NAMES[l] && wantLang(TV.pref("audioLang")) !== l) {
            items.push({ head: T("Settings") });
            items.push({ label: T("Always Start in {lang}", { lang: LANG_NAMES[l] }), sub: T("Movies and series that have it"), run: function () {
                TV.setPref("audioLang", l); TV.toast(T("Audio language: {lang}", { lang: LANG_NAMES[l] })); closePop();
            } });
        }
        return items;
    }

    /* ---------- the sound in your language from another version ----------
       A movie or an episode whose sound is not in the language you want (Settings > Audio Language), when another
       version of the same title is (VF, MULTI…): APL TV offers to switch to it, at the same moment. Asked once per
       title; the version chosen is remembered (like Versions on the title's page). */
    var versionAsked = {};
    function versionLang(v, want) {
        var c = D.catOf(v), text = (v.name || "") + " " + (c.name || "") + " " + (c.raw || "");
        if (/\bMULTI\b/i.test(text)) return 2;
        if (want === "fr" && /\b(VFF|VFQ|VFI|VF|TRUEFRENCH|FRENCH)\b/i.test(text)) return 3;
        if (norm(c.lang) === want && !/\b(VOSTFR|VOSTA|VOST|SUBS?|SUBBED|VO)\b/i.test(text)) return 3;
        return 0;
    }
    function offerVersion(audio) {
        var o = vod, it = o && o.item, vs = it && it.versions, want = wantLang(TV.pref("audioLang"));
        if (!open || !vs || vs.length < 2 || !want || want === "orig" || want === "none" || !LANG_NAMES[want]) return;
        var langs = audio.map(function (a) { return norm(a.lang); }).filter(function (l) { return l && l !== "und"; });
        if (!langs.length || langs.indexOf(want) >= 0) return;            // not known, or already there
        var key = (it.title || it.name || "") + ":" + (it.year || "");
        if (versionAsked[key]) return;
        var best = null, bestScore = 0;
        vs.forEach(function (v) { if (v.id === it.id) return; var sc = versionLang(v, want); if (sc > bestScore) { bestScore = sc; best = v; } });
        if (!best) return;
        versionAsked[key] = 1;
        var c = D.catOf(best), q = (String(best.name || "").match(/\b(4K|UHD|FHD|HD|MULTI|VFF|VFQ|VF|TRUEFRENCH|FRENCH)\b/gi) || []).join(" ");
        var what = [c.tag, q].filter(Boolean).join(" · ") || c.name || best.name, L = LANG_NAMES[want];
        if (TV.lang === "fr" && want === "fr") L = "français";
        TV.log("no " + want + " sound in this version: " + what + " offered");
        TV.alert({ title: T("No {lang} sound in this version", { lang: L }),
            message: T("“{title}” also exists in {lang} ({version}). Switch to it, at the same moment?", { title: o.title, lang: L, version: what }),
            buttons: [{ label: T("Watch in {lang}", { lang: L }), run: function () { switchVersion(best); } }, { label: T("Keep This Version") }] });
    }
    function switchVersion(v) {
        var o = vod;
        if (!o || !TV.detail || !TV.detail.playVersion) return;
        var pos = TV.player.position(), old = o.item, ep = o.ep;
        v.versions = old.versions;
        D.preferVersion(v);
        TV.log("version switched for the sound");
        finish(true);
        if (!ep) D.forget(old);                            // its place is in the new version now
        setTimeout(function () { TV.detail.playVersion(v, ep, pos); }, 0);
    }

    /* ---------- Quality: the channel's versions (4K, FHD, HD…) and the stream's own qualities ---------- */
    function variantsOf(c) {
        if (!c) return [];
        if (c.variants && c.variants.length > 1) return c.variants;
        for (var i = 0; i < ctx.length; i++) if (ctx[i].variants && ctx[i].variants.some(function (v) { return v.id === c.id; })) return ctx[i].variants;
        return [];
    }
    function hasQuality() { return (mode === "live" && variantsOf(ch).length > 1) || !!(streamQ && streamQ.list.length > 1); }
    function watchQualities() {
        var pc = TV.player.current();
        if (pc !== qFor) { qFor = pc; streamQ = null; qAsked = false; }
        if (!pc || qAsked || TV.player.state() !== "PLAYING") return;
        qAsked = true;
        TV.player.qualities().then(function (q) {
            if (!open || TV.player.current() !== pc) return;
            var had = hasQuality();
            streamQ = q;
            if (q) TV.log("stream qualities: " + q.list.map(function (x) { return x.h ? x.h + "p" : mbps(x.bw); }).join(", ") + (q.native ? " (player)" : ""));
            if (hasQuality() !== had) { if (mode === "live") drawLive(); else { vb = null; drawVod(); } }
        });
    }
    function qName(q) { return q.h ? q.h + "p" + (q.h >= 2000 ? " · 4K" : q.h >= 1080 ? " · Full HD" : q.h >= 720 ? " · HD" : "") : mbps(q.bw); }
    function qualityItems() {
        var items = [], vs = mode === "live" ? variantsOf(ch) : [];
        if (vs.length > 1) {
            items.push({ head: T("Versions of This Channel") });
            vs.forEach(function (v) {
                items.push({ label: v.q || T("Standard"), sub: v.raw || v.name, check: !!ch && v.id === ch.id, run: function () {
                    closePop();
                    if (!ch || v.id === ch.id) return;
                    prevCh = ch; ch = v;
                    errBox.classList.remove("is-on");
                    drawLive(); show();
                    TV.live.playChannel(v, TV.player.FULL); if (onZap) onZap(v);
                } });
            });
        }
        if (streamQ && streamQ.list.length > 1) {
            items.push({ head: T("Stream Quality") });
            var pick = function (id) { return function () { closePop(); streamQ.current = id; stateBox.classList.add("is-on"); TV.player.setQuality(id); show(); }; };
            items.push({ label: T("Automatic"), sub: T("The best your connection allows"), check: streamQ.current === "auto", run: pick("auto") });
            streamQ.list.forEach(function (q) { items.push({ label: qName(q), sub: q.bw ? mbps(q.bw) : "", check: streamQ.current === q.id, run: pick(q.id) }); });
        }
        if (!items.length) items.push({ label: T("Only one quality"), run: function () { closePop(); } });
        return items;
    }

    /* ---------- Stream Info: what plays, as the player sees it (kept current while it is open) ---------- */
    function mbps(b) { b = +b || 0; return b >= 1e6 ? (b / 1e6).toFixed(b >= 1e7 ? 0 : 1) + " Mb/s" : Math.round(b / 1000) + " kb/s"; }
    var CODECS = [[/^(avc|h\.?264|x264)/, "H.264"], [/^(hvc|hev|h\.?265|x265)/, "HEVC"], [/^av0?1/, "AV1"], [/^vp0?9/, "VP9"], [/^vp0?8/, "VP8"],
                  [/^(mpeg2|mp2v|mpeg-2|mpeg2video)/, "MPEG-2"], [/^(mp4a\.(69|6b|40\.34)|mp3|mpga)/, "MP3"], [/^(mp4a|aac|mpeg4-generic)/, "AAC"],
                  [/^(ac-?3|dolby ?digital$)/, "Dolby Digital"], [/^(ec-?3|e-?ac-?3)/, "Dolby Digital Plus"], [/^ac-?4/, "Dolby AC-4"], [/^(true-?hd|mlp)/, "Dolby TrueHD"], [/^(dolby-vision|dv(h|a)[e1v])/, "Dolby Vision"],
                  [/^dts[-.]?(hd|h|l|ma)/, "DTS-HD"], [/^dts/, "DTS"], [/^opus/, "Opus"], [/^flac/, "FLAC"], [/^(mpeg|mp2|mp1)/, "MPEG"], [/^(pcm|lpcm|raw)/, "PCM"]];
    function codecName(c) {
        var x = String(c || "").toLowerCase().replace(/^(video|audio)\//, "").replace(/^(x-|vnd\.)/, "").trim();
        if (!x) return "";
        for (var i = 0; i < CODECS.length; i++) if (CODECS[i][0].test(x)) return CODECS[i][1];
        return x.toUpperCase();
    }
    function chName(n) { n = +n || 0; return n >= 8 ? "7.1" : n >= 6 ? "5.1" : n === 2 ? T("Stereo") : n === 1 ? "Mono" : n ? n + " ch" : ""; }
    function infoItems() {
        var s = TV.player.stats() || {}, items = [];
        function row(label, value) { if (value) items.push({ label: label, value: value, run: function () {} }); }
        var fps = +s.fps ? Math.round(+s.fps * 100) / 100 : 0;
        row(T("Picture"), s.w ? s.w + " × " + s.h + (fps ? " · " + T("{n} fps", { n: fps }) : "") : "");
        row(T("Video Format"), [codecName(s.vcodec), s.hdr || ""].filter(Boolean).join(" · "));
        row(T("Video Bitrate"), +s.vbitrate > 0 ? mbps(s.vbitrate) : "");
        row(T("Sound"), [codecName(s.acodec), chName(s.channels), +s.rate ? (s.rate >= 1000 ? Math.round(s.rate / 100) / 10 : s.rate) + " kHz" : "", +s.abitrate > 0 ? mbps(s.abitrate) : ""].filter(Boolean).join(" · "));
        row(T("Connection Speed"), +s.bandwidth > 0 ? mbps(s.bandwidth) : "");
        row(T("Buffer"), s.buffered !== undefined && s.buffered >= 0 ? T("{n} s ahead", { n: Math.round(s.buffered) }) : "");
        row(T("Dropped Frames"), s.dropped !== undefined ? String(s.dropped) + (s.frames ? " / " + s.frames : "") : "");
        if (streamQ && streamQ.list.length > 1) row(T("Stream Quality"), streamQ.current === "auto" ? T("Automatic") : qName(streamQ.list.filter(function (q) { return q.id === streamQ.current; })[0] || {}));
        row(T("Stream"), [s.format || "", s.engine || ""].filter(Boolean).join(" · "));
        if (items.length < 2) items.unshift({ label: T("Waiting for the picture…"), run: function () {} });
        return items;
    }
    /* Picture Size: the whole picture (black bars if needed), stretched to the whole screen, or the shape the video asks for */
    function pictureItems() {
        var cur = TV.pref("pictureMode") || "fit";
        return [["fit", T("Fit to Screen"), T("The whole picture, with black bars if it is not 16:9")],
                ["fill", T("Fill the Screen"), T("Stretched to the whole screen, no black bars")],
                ["auto", T("Original Shape"), T("The shape the video asks for: for old 4:3 channels that look squeezed")]].map(function (m) {
            return { label: m[1], sub: m[2], check: m[0] === cur, run: function () { TV.setPref("pictureMode", m[0]); TV.player.setPicture(m[0]); closePop(); } };
        });
    }
    function itemsFor(kind) { return kind === "subs" ? subsItems() : kind === "picture" ? pictureItems() : kind === "quality" ? qualityItems() : kind === "info" ? infoItems() : audioItems(); }
    var POP_TITLE = { subs: "Subtitles", picture: "Picture Size", quality: "Quality", info: "Stream Info", audio: "Audio" };
    var BTN_ICON = { subs: "cc", audio: "speaker", quality: "quality", picture: "aspect", info: "info" };
    /* Sync to a line: the next words of the subtitles are shown, OK the moment you hear them said, and the delay is
       set from that (a quarter of a second taken off for the time the thumb takes). ◀ ▶ another line. */
    function lineFrom(t) {
        var c = ext ? ext.cues : [], i = 0;
        while (i < c.length && (c[i].s + delayMs < t || !c[i].h)) i++;
        return Math.min(i, Math.max(0, c.length - 1));
    }
    function lineStep(d) {
        var c = ext ? ext.cues : [], i = pop.line + d;
        while (i >= 0 && i < c.length && !c[i].h) i += d;
        if (i < 0 || i >= c.length) { TV.sound.edge(); return; }
        pop.line = i; TV.sound.tick(); refreshPop();
    }
    function lineHeard() {
        var c = ext && ext.cues[pop.line];
        if (!c) return;
        setDelay(Math.round((nowMs() - c.s - 250) / 50) * 50);
        TV.toast(T("Subtitles synced ({d})", { d: fmtDelay() }));
        openPop("subs");
    }
    var lineTimer = null;
    function openPop(kind) {
        clearInterval(lineTimer);
        pop = { kind: kind, index: 0 };
        if (kind === "line") {
            if (!ext || !ext.cues.length) { pop.kind = "subs"; kind = "subs"; }
            else { pop.line = lineFrom(nowMs() + 4000); lineTimer = setInterval(function () { if (pop && pop.kind === "line") refreshPop(); else clearInterval(lineTimer); }, 500); }
        }
        if (kind !== "sync" && kind !== "line") {
            var items = itemsFor(kind);
            for (var i = 0; i < items.length; i++) if (items[i].check) { pop.index = i; break; }
            if (items[pop.index] && items[pop.index].head) pop.index++;
        }
        refreshPop();
        show(0);
    }
    function closePop(silent) {
        clearInterval(lineTimer);
        pop = null;
        if (popEl) { popEl.classList.remove("is-on"); popEl.innerHTML = ""; }
        if (!silent && open) { drawBar(); show(); }
    }
    function refreshPop() {
        if (!pop || !popEl) return;
        if (pop.kind === "sync") {
            popEl.innerHTML = "<div class='osd__pophead'>" + esc(T("Subtitle Delay")) + "</div><div class='osd__sync'><span>◀</span><b>" + esc(fmtDelay()) + "</b><span>▶</span></div>" +
                "<div class='osd__pophint'>" + esc(T("◀ ▶ 0.25 s (hold: faster) · a later subtitle: ▶ · OK: done")) + "</div>";
            popEl.className = "osd__pop is-on is-sync";
            return;
        }
        if (pop.kind === "line") {
            var cue = ext && ext.cues[pop.line], inS = cue ? Math.round((cue.s + delayMs - nowMs()) / 1000) : 0;
            popEl.innerHTML = "<div class='osd__pophead'>" + esc(T("Sync to a Line")) + "</div><div class='osd__line'><span>◀</span><b>" + (cue ? cue.h : "") + "</b><span>▶</span></div>" +
                "<div class='osd__pophint'>" + esc(T("OK the moment you hear these words")) + "<br>" +
                esc(inS > 0 ? T("Shown in {n} s with the delay of now", { n: inS }) : inS < 0 ? T("Shown {n} s ago with the delay of now", { n: -inS }) : T("Shown now")) + " · " + esc(T("◀ ▶ another line")) + "</div>";
            popEl.className = "osd__pop is-on is-sync is-line";
            return;
        }
        var items = pop.items = itemsFor(pop.kind);
        if (pop.index >= items.length) pop.index = items.length - 1;
        while (items[pop.index] && items[pop.index].head) pop.index++;
        var html = "<div class='osd__pophead'>" + esc(T(POP_TITLE[pop.kind] || "Audio")) + "</div><div class='osd__poplist'>";
        items.forEach(function (it, i) {
            if (it.head) { html += "<div class='osd__popsec'>" + esc(it.head) + "</div>"; return; }
            html += "<div class='osd__popitem" + (i === pop.index ? " is-focused" : "") + "' data-i='" + i + "'><span class='osd__popcheck'>" + (it.check ? TV.icon("check", 24) : "") + "</span>" +
                "<span class='osd__poptxt'><b>" + esc(it.label) + "</b>" + (it.sub ? "<small>" + esc(it.sub) + "</small>" : "") + "</span>" + (it.value ? "<em>" + esc(it.value) + "</em>" : "") + "</div>";
        });
        popEl.innerHTML = html + "</div>";
        popEl.className = "osd__pop is-on" + (pop.kind === "info" ? " is-info" : "");
        var f = popEl.querySelector(".is-focused"), listBox = popEl.querySelector(".osd__poplist");
        if (f && listBox) listBox.scrollTop = Math.max(0, f.offsetTop - listBox.clientHeight / 2 + f.offsetHeight / 2);
    }
    function popKey(code) {
        if (pop.kind === "line") {
            if (code === K.LEFT || code === K.RIGHT) { lineStep(code === K.RIGHT ? 1 : -1); return; }
            if (TV.isBack(code) || code === K.UP || code === K.DOWN) { openPop("subs"); return; }
            return;
        }
        if (pop.kind === "sync") {
            if (code === K.LEFT || code === K.RIGHT) { var step = TV.isHeld() ? 1000 : 250; setDelay(delayMs + (code === K.RIGHT ? step : -step)); TV.sound.tick(); return; }
            if (TV.isBack(code) || code === K.UP || code === K.DOWN) { openPop("subs"); return; }
            return;
        }
        var items = pop.items || [], i = pop.index;
        if (code === K.UP || code === K.DOWN) {
            var d = code === K.UP ? -1 : 1, j = i + d;
            while (items[j] && items[j].head) j += d;
            if (j < 0 || j >= items.length) { TV.sound.edge(); return; }
            pop.index = j; TV.sound.tick(); refreshPop(); return;
        }
        if (TV.isBack(code) || code === K.LEFT || code === K.RIGHT) { closePop(); return; }
    }
    function popOk() {
        if (pop.kind === "line") { lineHeard(); return; }
        if (pop.kind === "sync") { openPop("subs"); return; }
        var it = pop.items && pop.items[pop.index];
        if (it && it.run) it.run();
        if (it && it.keep && pop) refreshPop();
    }
    /* Subtitle style, from the player: size, colour, background, position (also in Settings) */
    function styleMenu() {
        function pickFrom(key, title) {
            TV.menu(title, SUB[key.replace("sub", "").toLowerCase()].map(function (o) {
                return { label: T(o[1]), check: TV.pref(key) === o[0], run: function () { TV.setPref(key, o[0]); applySubStyle(); sampleSub(); styleMenu(); } };
            }));
        }
        function nameOf(key) { var l = SUB[key.replace("sub", "").toLowerCase()]; for (var i = 0; i < l.length; i++) if (l[i][0] === TV.pref(key)) return T(l[i][1]); return ""; }
        sampleSub();
        TV.menu(T("Subtitle Style"), [
            { label: T("Size") + "  ·  " + nameOf("subSize"), run: function () { pickFrom("subSize", T("Size")); } },
            { label: T("Colour") + "  ·  " + nameOf("subColor"), run: function () { pickFrom("subColor", T("Colour")); } },
            { label: T("Background") + "  ·  " + nameOf("subBg"), run: function () { pickFrom("subBg", T("Background")); } },
            { label: T("Position") + "  ·  " + nameOf("subPos"), run: function () { pickFrom("subPos", T("Position")); } }
        ]);
    }

    /* ---------- live ---------- */
    function liveIcons() {
        var s = TV.player.tracks().filter(function (t) { return t.type === "TEXT"; }).length, out = [];
        if (tsh) out.push("golive");                          // behind live: a button to catch up (no Stop key on many remotes)
        if (tsOn()) out.push("ts");
        if (s) out.push("subs");
        out.push("audio");
        if (hasQuality()) out.push("quality");
        out.push("picture", "info");
        return out;
    }
    function vodIcons() { return ["subs", "audio"].concat(hasQuality() ? ["quality"] : [], ["picture", "info"]); }
    function drawLive() {
        if (!ch) return;
        var n = TV.epg.now(ch), cur = n && n.cur, next = n && n.next, logo = el("div", "osd__logo");
        TV.logoBox(logo, ch);
        bar.innerHTML = "";
        bar.appendChild(logo);
        var txt = el("div", "osd__txt");
        txt.innerHTML = "<div class='osd__ch'><span class='badge'>" + ch.num + "</span><b>" + esc(ch.name) + "</b>" + (ch.q ? "<span class='badge'>" + esc(ch.q) + "</span>" : "") +
            (D.isFav(ch.id) ? "<span style='color:#ffd60a;display:flex'>" + TV.icon("star", 24) + "</span>" : "") + "</div>" +
            "<div class='osd__title'>" + esc(cur ? cur[2] : T("No programme information")) + "</div>" +
            (cur ? "<div class='osd__time'><span>" + TV.hhmm(cur[0]) + "</span><div class='bar'><i style='width:" + Math.round(TV.epg.progress(cur) * 100) + "%'></i></div><span>" + TV.hhmm(cur[1]) + "</span><span>" +
                esc(T("{n} min left", { n: Math.max(1, Math.round((cur[1] - Date.now()) / 60000)) })) + "</span></div>" : "") +
            (next ? "<div class='osd__next'>" + esc(T("Next")) + " · <b>" + TV.hhmm(next[0]) + "</b>  " + esc(next[2]) + "</div>" : "") + tsLine();
        bar.appendChild(txt);
        var icons = liveIcons();
        if (icons.length) {
            var box = el("div", "pv__icons osd__liveicons");
            if (iconIndex >= icons.length) iconIndex = icons.length - 1;
            icons.forEach(function (k, i) {
                var on = zone === "icons" && i === iconIndex ? " is-focused" : "";
                if (k === "golive") { box.appendChild(el("div", "pv__btn pv__btn--text" + on, TV.icon("fwd10", 24) + "<span>" + esc(T("Back to Live")) + "</span>")); return; }
                box.appendChild(el("div", "pv__btn" + on, TV.icon(k === "ts" ? (tsh && tsh.paused ? "play" : "pause") : BTN_ICON[k], 30)));
            });
            bar.appendChild(box);
        }
    }
    function live(c, context, closeCb, zapCb) {
        ch = c; ctx = context && context.length ? context : [c]; onClose = closeCb; onZap = zapCb;
        vod = null;
        openOsd("live");
        // the spinner as the channel is now (it may have started while the preview was loading), not the last time
        stateBox.classList.toggle("is-on", !!(TV.player.isBuffering() && TV.player.state() !== "PLAYING"));
        drawLive();
        show();
        TV.epg.ensure([c]);
    }
    function zapTo(c) {
        if (!c || (ch && c.id === ch.id)) return;
        if (tsh) tsLive(true);
        prevCh = ch; ch = c;
        errBox.classList.remove("is-on");
        drawLive(); show();
        TV.epg.ensure([c]);
        clearTimeout(zapTimer);
        // A short wait: pressing ▲ three times quickly opens only the third channel
        zapTimer = setTimeout(function () { TV.live.playChannel(c, TV.player.FULL); if (onZap) onZap(c); }, 380);
        if (root.classList.contains("has-list")) { vlist.refresh(); }
    }
    function zap(d) {
        var i = indexIn(ctx, ch);
        if (i < 0) i = 0;
        var n = ctx.length;
        if (n < 2) { TV.sound.edge(); return; }
        TV.sound.tick();
        zapTo(ctx[(i + d + n) % n]);
    }
    function indexIn(arr, c) { for (var i = 0; i < arr.length; i++) if (arr[i].id === c.id || (arr[i].variants && arr[i].variants.some(function (v) { return v.id === c.id; }))) return i; return -1; }
    function openList() {
        var cat = D.catOf(ctx[0] || ch);
        list.firstChild.innerHTML = "<span>" + esc(ctx === D.favChannels() ? T("Favorites") : (cat.name || T("Channels"))) + "</span><small>" + ctx.length + "</small>";
        root.classList.add("has-list");
        vlist.set(ctx, Math.max(0, indexIn(ctx, ch)));
        vlist.setActive(true);
        show(0);
        TV.epg.ensure(ctx.slice(Math.max(0, vlist.index - 5), vlist.index + 10));
    }
    function closeList() { root.classList.remove("has-list"); show(); }

    function liveMenu() {
        var fav = D.isFav(ch.id);
        var items = [
            { label: fav ? T("Remove from Favorites") : T("Add to Favorites"), icon: fav ? "starLine" : "star", run: function () { var on = D.toggleFav(ch.id); TV.toast(on ? T("“{name}” added to Favorites", { name: ch.name }) : T("“{name}” removed from Favorites", { name: ch.name })); drawLive(); } },
            { label: T("Watch in Multiview"), icon: "grid", run: function () { var c = ch; finish(); TV.multiview.open([c]); } },
            TV.channelHideItem(ch)            // the one you are watching keeps playing; it leaves the lists
        ];
        if (liveIcons().indexOf("subs") >= 0) items.push({ label: T("Subtitles"), icon: "cc", run: function () { openPop("subs"); } });
        items.push({ label: T("Audio"), icon: "speaker", run: function () { openPop("audio"); } });
        if (hasQuality()) items.push({ label: T("Quality"), icon: "quality", run: function () { openPop("quality"); } });
        items.push({ label: T("Stream Info"), icon: "info", run: function () { openPop("info"); } });
        // the provider's replay: the programme on now, from its start (issue #10)
        var pnow = TV.epg.now(ch), pcur = pnow && pnow.cur;
        if (!tsh && pcur && TV.catchup && TV.catchup.can(ch, pcur[0])) items.unshift({ label: T("Start Over"), icon: "restart", run: function () {
            var c = ch, ctx0 = ctx; finish(); TV.catchup.play(c, pcur, function () { TV.live.play(c, ctx0); });
        } });
        if (tsh) items.unshift({ label: T("Back to Live"), icon: "fwd10", run: function () { tsLive(); } });
        else if (tsOn()) items.unshift({ label: T("Pause Live TV"), icon: "pause", run: function () { tsPause(); } });
        sleepItem(items);
        TV.menu(ch.num + "  " + ch.name, items);
    }

    /* ---------- timeshift: pause a channel, go back in it ----------
       ⏯ (or the bar's first button, or OK while paused) pauses: the helper service (js/helper.js) starts keeping the
       channel from that moment and the player then reads it from the service, so the provider sees one connection.
       While behind live: ◀ ▶ 10 s (held: 30 s), ⏯ pause again, ⏹ or Back to Live (menu) to catch up. Another channel,
       or leaving full screen, goes back to live and the service lets the channel go. */
    function tsOn() { return TV.pref("timeshift") !== false && !!TV.helper && !!TV.helper.tsStart && mode === "live"; }
    function tsSource(c) {
        var cur = TV.player.current(), u = (cur && cur.url) || D.streamUrl(c);   // the real address (a portal's already asked)
        if (/^https?:\/\/(127\.0\.0\.1|localhost)[:\/]/i.test(u)) return null;
        // an Xtream channel in HLS: its MPEG-TS address (the service keeps MPEG-TS)
        if (/\.m3u8(\?|$)/i.test(u)) { var src = D.sourceOf(c); if (src && src.type === "xtream") u = u.replace(/\.m3u8(\?|$)/i, ".ts$1"); else return null; }
        return /^https?:\/\//i.test(u) ? u : null;
    }
    /* The moment shown (ms since 1970): where the copy started plus how far the player went in it */
    function tsNow() {
        if (!tsh) return Date.now();
        if (tsh.paused || tsh.start === null || tsh.pos0 === null) return tsh.at;
        return Math.min(Date.now(), tsh.start + Math.max(0, TV.player.position() * 1000 - tsh.pos0));
    }
    function tsPlayFrom(t, thenPause) {
        var my = tsh;
        TV.helper.tsInfo(my.id).then(function (info) {
            if (tsh !== my) return;
            my.from = info.from || my.from; my.segs = info.segs || [];
            var start = my.segs.length ? my.segs[0] : t;
            my.segs.forEach(function (s) { if (s <= t) start = s; });
            my.start = start; my.pos0 = null; my.at = start; my.paused = false; my.wantPause = !!thenPause; my.busy = false;
            stateBox.classList.add("is-on");
            TV.live.playChannel(my.ch, TV.player.FULL, TV.helper.tsUrl(my.id, start), {
                onTime: function (ms) {
                    if (tsh !== my) return;
                    if (my.pos0 === null) my.pos0 = ms;
                    if (my.wantPause) { my.wantPause = false; my.at = tsNow(); my.paused = true; my.pausedAt = Date.now(); TV.player.pause(); stateBox.classList.remove("is-on"); drawLive(); show(0); }
                },
                onError: function () { if (tsh !== my) return false; tsLost(); return true; }
            });
            drawLive(); show(0);
        }, function () { if (tsh === my) tsLost(); });
    }
    function tsPause() {
        if (!tsOn() || !ch) return false;
        if (tsh) {
            if (tsh.busy) return true;
            if (tsh.paused) { tsResume(); return true; }
            tsh.at = tsNow(); tsh.paused = true; tsh.pausedAt = Date.now();
            TV.player.pause(); drawLive(); show(0);
            return true;
        }
        var url = tsSource(ch);
        if (!url) {
            /* the TV can't keep this channel (an M3U's HLS stream): the provider's replay, when it has one, is the way
               back in it; say so instead of a bare "not available" (issue #10) */
            var pn = TV.epg.now(ch), arch = pn && pn.cur && TV.catchup && TV.catchup.can(ch, pn.cur[0]);
            TV.log("timeshift: not for " + ch.name + " (" + (D.sourceOf(ch) || {}).type + ", " + (/\.m3u8/i.test(String((TV.player.current() || {}).url || D.streamUrl(ch))) ? "HLS" : "no address") + ")" + (arch ? ", replay offered" : ""));
            TV.toast(arch ? T("Pause isn't possible on this channel. Its replay is: Start Over in the menu, or a past programme in the TV guide.") : T("Pause is not available for this channel."), !!arch);
            return true;
        }
        var c = ch, t0 = Date.now(), my;
        TV.player.pause();
        my = tsh = { id: null, ch: c, at: t0, from: t0, segs: [], start: null, pos0: null, paused: true, pausedAt: t0, busy: true };
        drawLive(); show(0);
        TV.log("timeshift: pause " + c.name);
        function started(info) {
            if (tsh !== my) { TV.helper.tsStop(); return; }
            my.id = info.id; my.from = info.from || t0;
            tsPlayFrom(t0, true);                          // the first moment kept, paused
        }
        TV.helper.tsStart(url).then(started, function (e) {
            if (tsh !== my) return;
            if (e.old) {
                tsh = null; TV.player.resume(); drawLive();
                TV.toast(TV.ANDROID ? T("Pausing live TV needs the new version of the app (.apk) once.") : T("Pausing live TV needs the new install once (APL Launcher Setup or the new package)."), true);
                return;
            }
            // one connection at a time at some providers: the player lets go, the service tries again
            TV.log("timeshift: " + e.message + ", once more without the player");
            TV.player.stop();
            setTimeout(function () {
                if (tsh !== my) return;
                TV.helper.tsStart(url).then(started, function (e2) {
                    if (tsh !== my) return;
                    TV.log("timeshift: " + e2.message);
                    tsh = null; TV.toast(T("Pause is not available for this channel."));
                    TV.live.playChannel(c, TV.player.FULL); drawLive();
                });
            }, 700);
        });
        return true;
    }
    function tsResume() {
        if (!tsh || tsh.busy || !tsh.paused) return;
        // a short pause: the same stream goes on (the service waited for it); a long one: opened again where it was
        if (tsh.start !== null && tsh.pos0 !== null && Date.now() - tsh.pausedAt < 60000) {
            var pos = TV.player.position() * 1000;
            tsh.start = tsh.at; tsh.pos0 = pos; tsh.paused = false;
            TV.player.resume(); drawLive(); show();
            return;
        }
        tsPlayFrom(tsh.at, false);
    }
    function tsJump(dir) {
        if (!tsh || tsh.busy) return;
        if (tsTarget === null) tsTarget = tsNow();
        var step = TV.isHeld() ? 30000 : 10000;
        tsTarget = Math.max(tsh.from || 0, Math.min(Date.now(), tsTarget + dir * step));
        TV.sound.tick(); drawLive(); show(0);
        clearTimeout(tsJumpTimer);
        tsJumpTimer = setTimeout(function () {
            var t = tsTarget; tsTarget = null;
            if (!tsh || t === null) return;
            if (Date.now() - t < 6000) { tsLive(); return; }       // back at the live edge
            tsPlayFrom(t, false);
        }, 800);
    }
    function tsLive(quiet) {
        if (!tsh) return;
        var c = tsh.ch;
        tsh = null; tsTarget = null; clearTimeout(tsJumpTimer);
        TV.helper.tsStop();
        TV.log("timeshift: back to live");
        if (quiet) return;
        TV.live.playChannel(c, TV.player.FULL);
        if (open) { drawLive(); show(); }
    }
    function tsLost() {
        if (!tsh) return;
        TV.toast(T("The paused channel was lost: back to live."));
        tsLive();
    }
    function tsTick() {
        if (!tsh || !tsh.id || ++tsPoll % 3) return;
        var my = tsh;
        TV.helper.tsInfo(my.id).then(function (i) { if (tsh === my) { my.from = i.from || my.from; my.segs = i.segs || my.segs; if (i.err && !i.live) TV.log("timeshift: " + i.err); } },
                                     function () { if (tsh === my) tsLost(); });
    }
    function tsLine() {
        if (!tsh) return "";
        var now = Date.now(), from = Math.min(tsh.from || now, now - 1000), at = tsTarget !== null ? tsTarget : tsNow(), behind = Math.max(0, now - at);
        var pct = TV.clamp((at - from) / (now - from) * 100, 0, 100);
        var label = tsh.busy ? T("Pausing…") : behind < 4000 ? T("Live") : "−" + TV.duration(Math.round(behind / 1000));
        return "<div class='osd__ts" + (tsh.paused ? " is-paused" : "") + "'><span class='osd__tsicon'>" + TV.icon(tsh.paused ? "pause" : "play", 22) + "</span>" +
            "<div class='bar'><i style='width:" + pct.toFixed(1) + "%'></i></div><b>" + esc(label) + "</b></div>" +
            "<div class='osd__tshint'>" + esc(T("◀ ▶ 10 s  ·  Play/Pause  ·  ▲ Back to Live")) + "</div>";
    }

    /* ---------- movies and episodes ---------- */
    function vodPlay(o) {
        vod = o; ch = null; tracksDone = false; subsOn = false; scrub = null; vb = null; ext = null; delayMs = 0; os = { state: "idle", list: [] }; nextShown = false;
        openOsd("vod");
        var start = o.start || 0;
        stateBox.classList.add("is-on");
        TV.player.play(o.url, {
            live: false, start: start, rect: TV.player.FULL, uhd: /\b(4K|UHD|2160P?)\b/i.test((o.item && o.item.name) || "") || /\b(4K|UHD)\b/i.test((TV.data.catOf(o.item || {}).name) || ""),
            onReady: function () { setTimeout(applyTrackPrefs, 0); },
            onReconnect: function () { stateBox.classList.add("is-on"); tracksDone = false; },
            onBuffering: function (b) { stateBox.classList.toggle("is-on", !!b); },
            // the picture moves: no spinner and no error left over it (a slow start had shown "timeout" first)
            onPlaying: function () { stateBox.classList.remove("is-on"); errBox.classList.remove("is-on"); if (!tracksDone) setTimeout(applyTrackPrefs, 600); tell("start"); },
            onTime: function () { stateBox.classList.remove("is-on"); errBox.classList.remove("is-on"); },
            onSubtitle: function (s) { if (subsOn && !ext) showSub(s); },
            onEnded: function () { o.ended = true; save(true); if (o.next && o.onEpisode && TV.pref("autoNext")) { var n = o.next.ep, cb = o.onEpisode; finish(true); cb(n); } else finish(); },
            onError: function (e) {
                stateBox.classList.remove("is-on");
                // Back in the list of a Stremio title's streams: nothing plays, the player closes
                if (e === "cancelled") { finish(); return; }
                // a format the screen cannot decode (HEVC 10-bit on a small Android box, an old Samsung…)
                var dec = /DECOD|FORMAT_UNSUPPORTED|NOT_SUPPORTED/i.test(String(e));
                error(dec ? T("This screen cannot decode this video.") : T("This video cannot be played."), String(e),
                      dec ? T("Try another version of it, if there is one.") : T("Try again later, or try another version if there is one."));
            }
        });
        // the series' (or movie's) picture for the "next episode" card: never a picture of the episode
        o.art = o.item && TV.sized(o.item.backdrop || "", "w780");
        TV.meta.lookup(o.noResume ? null : o.item).then(function (m) {
            if (!m || vod !== o) return;
            if (m.backdrop) o.art = TV.sized(m.backdrop, "w780");
            TV.meta.certs(o.item.kind === "series" ? "tv" : "movie", m.tmdbId).then(function (c) {
                o.age = TV.meta.certBadge(c);
                if (vod === o && vb && vb.age) vb.age.innerHTML = o.age;
            });
        });
        drawVod(); show();
        clearInterval(saveTimer);
        saveTimer = setInterval(function () { save(false); tell("progress"); }, 10000);
    }
    /* Your Jellyfin or Emby server hears where you are: once the picture moves, every 10 s, and once when
       the video stops (other sources: js/media.js sends nothing). A video that never started tells nothing. */
    function tell(event) {
        if (!vod || !TV.media || !TV.media.report || vod.told === "stop") return;
        if (event === "start" ? vod.told : !vod.told) return;
        var dur = TV.player.duration(), key = vod.resumeKey, pos = TV.player.position();
        // not really under way yet (a resume still jumping to its point, Back pressed at once): as save() does,
        // the resume point stays, so the server is told where the video started, never 0
        if (event !== "start" && !vod.ended && pos < 5) { if (event === "progress") return; pos = vod.start || 0; }
        vod.told = event === "stop" ? "stop" : "start";
        // finished: its whole length, so the server counts it as watched with its own settings
        TV.media.report(vod.url, event, vod.ended && dur ? dur : pos).then(function (ok) {
            // the server has where you stopped: marked unwatched there later, it goes here too (js/data.js)
            if (ok && event === "stop" && D.serverHas) D.serverHas([key]);
        });
    }
    /* Where you are, every 10 s. Finished (past 94 %): marked watched; an episode's series then waits on the next one */
    function save(ended) {
        if (!vod || vod.noResume) return;
        var pos = TV.player.position(), dur = TV.player.duration();
        if (!dur || pos < 5) return;
        var done = ended || pos > dur * 0.94, base = { item: vod.item.id, ep: vod.ep ? vod.ep.id : null };
        if (done) D.setResume(vod.resumeKey, { pos: dur, dur: dur, item: base.item, ep: base.ep, done: true });
        else D.setResume(vod.resumeKey, { pos: pos, dur: dur, item: base.item, ep: base.ep, epLabel: vod.sub || "" });
        if (vod.ep) {
            if (done && vod.next) D.setResume(vod.item.id, { pos: 0, dur: 0, item: base.item, ep: vod.next.ep.id, epLabel: vod.next.label, series: true, upNext: true });
            else if (done) D.setResume(vod.item.id, { pos: dur, dur: dur, item: base.item, ep: base.ep, epLabel: vod.sub || "", series: true, done: true });
            else D.setResume(vod.item.id, { pos: pos, dur: dur, item: base.item, ep: base.ep, epLabel: vod.sub || "", series: true });
        }
    }

    /* The bar, built once per video; a press only changes what moved */
    var vb = null;
    function vodTabs() {
        var t = [];
        if (vod.ep) {
            if (vod.prev) t.push({ id: "prev", label: T("Previous Episode"), icon: "back10" });
            if (vod.next) t.push({ id: "next", label: T("Next Episode"), icon: "fwd10" });
        } else t.push({ id: "restart", label: T("Start Over"), icon: "restart" });
        return t;
    }
    function buildVodBar() {
        var tabs = vodTabs(), kinds = vodIcons();
        bar.innerHTML = "<div class='pv'><div class='pv__top'><div class='pv__titles'><div class='pv__subline'><span class='pv__age'></span><span class='pv__sub'></span></div><div class='pv__title'></div></div>" +
            "<div class='pv__icons'>" + kinds.map(function (k) { return "<div class='pv__btn'>" + TV.icon(BTN_ICON[k], 30) + "</div>"; }).join("") + "</div></div>" +
            "<div class='osd__seek'><div class='bar'><i></i><em></em><b class='osd__bubble'><span></span><small></small></b><u></u></div></div>" +
            "<div class='pv__times'><span class='osd__now'></span><span class='pv__pp'></span><span class='pv__end'></span><span class='osd__left'></span></div>" +
            "<div class='pv__tabs'>" + tabs.map(function (t) { return "<div class='pv__tab'>" + esc(t.label) + "</div>"; }).join("") + "</div></div>";
        var q = function (s) { return bar.querySelector(s); };
        vb = { root: bar.firstChild, age: q(".pv__age"), pp: q(".pv__pp"), title: q(".pv__title"), sub: q(".pv__sub"), now: q(".osd__now"), left: q(".osd__left"), end: q(".pv__end"),
               fill: q(".bar i"), range: q(".bar em"), bubble: q(".osd__bubble"), bt: q(".osd__bubble span"), bd: q(".osd__bubble small"), dot: q(".bar u"), seek: q(".osd__seek"),
               icons: [].slice.call(bar.querySelectorAll(".pv__btn")), tabs: [].slice.call(bar.querySelectorAll(".pv__tab")), tabDefs: tabs, kinds: kinds, last: {} };
        vb.title.textContent = vod.title;
        vb.sub.textContent = vod.sub || "";
        vb.age.innerHTML = vod.age || "";
    }
    function put(key, val, fn) { if (vb.last[key] !== val) { vb.last[key] = val; fn(val); } }
    function drawVod() {
        if (!vod) return;
        if (!vb || vb.root.parentNode !== bar) buildVodBar();
        var dur = TV.player.duration(), now = TV.player.position(), paused = TV.player.state() === "PAUSED";
        var pos = scrub ? scrub.target : now, pct = dur ? TV.clamp(pos / dur, 0, 1) * 100 : 0, nowPct = dur ? TV.clamp(now / dur, 0, 1) * 100 : 0;
        put("pp", paused, function (p) { vb.pp.innerHTML = p ? TV.icon("pause", 22) : ""; });
        put("now", TV.duration(pos), function (t) { vb.now.textContent = t; });
        put("left", "-" + TV.duration(Math.max(0, dur - pos)), function (t) { vb.left.textContent = t; });
        put("end", dur ? T("ends at {t}", { t: TV.hhmm(Date.now() + (dur - pos) * 1000) }) : "", function (t) { vb.end.textContent = t; });
        put("fill", nowPct.toFixed(2), function (w) { vb.fill.style.width = w + "%"; });
        if (!vb.w) vb.w = vb.dot.parentNode.offsetWidth || 1700;
        var x = Math.round(vb.w * pct / 100);
        put("dot", x, function (px) { vb.dot.style.transform = "translate3d(" + px + "px,0,0)"; });
        put("scrub", !!scrub, function (on) { bar.classList.toggle("is-scrubbing", on); vb.seek.classList.toggle("is-scrubbing", on); });
        if (scrub) {
            var d = Math.round(scrub.target - now);
            vb.range.style.left = Math.min(pct, nowPct) + "%"; vb.range.style.width = Math.abs(pct - nowPct) + "%";
            vb.bubble.style.transform = "translate3d(" + x + "px,0,0) translateX(-50%)";
            vb.bt.textContent = TV.duration(scrub.target);
            vb.bd.textContent = (d >= 0 ? "+" : "−") + TV.duration(Math.abs(d));
        }
        put("zone", zone + iconIndex + "/" + tabIndex, function () {
            vb.icons.forEach(function (b, i) { b.classList.toggle("is-focused", zone === "icons" && i === iconIndex); });
            vb.tabs.forEach(function (b, i) { b.classList.toggle("is-focused", zone === "tabs" && i === tabIndex); });
            bar.classList.toggle("is-track", zone === "track");
        });
    }
    function drawBar() { if (mode === "live") drawLive(); else drawVod(); }

    /* ---------- moving in the video: a cursor on the timeline, one jump when you stop ----------
       The picture keeps playing while you choose. Measured on the M8: pausing first made Samsung's player
       block for 2 to 7 s on each jump and start again from a broken picture (squares); a jump while playing
       takes about 0.1 s and starts clean. */
    function seek(dir, big) {
        var dur = TV.player.duration();
        if (!dur || (scrub && scrub.pending)) return;
        if (!scrub) { scrub = { target: TV.player.position() }; holdFrom = 0; }
        var step;
        if (TV.isHeld()) {                                 // held: faster the longer it is held
            if (!holdFrom) holdFrom = Date.now();
            var held = Date.now() - holdFrom;
            step = held < 1500 ? 5 : held < 4000 ? 15 : held < 7000 ? 40 : 90;
        } else { holdFrom = 0; step = big ? 30 : 10; }
        scrub.target = TV.clamp(scrub.target + dir * step, 0, Math.max(0, dur - 2));
        TV.sound.tick();
        drawVod(); show(0);
        clearTimeout(seekTimer);
        seekTimer = setTimeout(commitSeek, 900);
    }
    function jumpTo(fraction) {
        var dur = TV.player.duration();
        if (!dur || (scrub && scrub.pending)) return;
        if (!scrub) scrub = {};
        scrub.target = TV.clamp(dur * fraction, 0, Math.max(0, dur - 2));
        drawVod(); show(0);
        clearTimeout(seekTimer);
        seekTimer = setTimeout(commitSeek, 700);
    }
    /* Samsung's player blocks the app while it seeks (2 to 7 s on a provider's file): the spinner and the
       target time are drawn first, they stay until the picture is there, and presses meanwhile are ignored */
    function commitSeek() {
        clearTimeout(seekTimer);
        if (!scrub || scrub.pending) return;
        var s = scrub;
        putSub("");
        if (Math.abs(s.target - TV.player.position()) < 1) { scrub = null; drawVod(); show(); return; }
        s.pending = true;
        stateBox.classList.add("is-on");
        drawVod(); show(0);
        var t0 = Date.now();
        function done(ok) {
            if (scrub !== s) return;
            scrub = null;
            stateBox.classList.remove("is-on");
            if (!ok) TV.toast(T("This video does not let you move forward or back."));
            if (ext) ext.at = 0;
            if (TV.DEV) TV.log("seek to " + Math.round(s.target) + " s took " + (Date.now() - t0) + " ms");
            drawVod(); show();
        }
        setTimeout(function () { TV.player.seekTo(s.target, function () { done(true); }, function () { done(false); }); }, 40);
        setTimeout(function () { if (scrub === s) done(true); }, 15000);        // the player never answered: unblock
    }
    function cancelSeek() { clearTimeout(seekTimer); if (scrub && scrub.pending) return; scrub = null; drawVod(); show(); }

    /* ---------- episodes: previous, next, and the card near the end (no autoplay unless you want it) ---------- */
    function goEpisode(target) {
        if (!vod || !target || !vod.onEpisode) return;
        save(false);
        var cb = vod.onEpisode;
        finish(true);
        cb(target.ep);
    }
    function checkNextCard() {
        if (!vod.next || nextShown || scrub) return;
        var dur = TV.player.duration(), pos = TV.player.position();
        if (!dur || dur < 300 || dur - pos > 40) return;
        nextShown = true;
        nextEl.innerHTML = "<div class='osd__nextart'" + (vod.art ? " style=\"background-image:url('" + vod.art.replace(/'/g, "%27") + "')\"" : "") + "></div>" +
            "<div class='osd__nexttxt'><small>" + esc(T("Next Episode")) + "</small><b>" + esc(vod.next.label) + "</b>" +
            "<div class='osd__nextbtn'>" + TV.icon("play", 24) + "<span>" + esc(T("Play")) + "</span><i></i></div></div>";
        nextEl.classList.add("is-on");
        zone = "next";
        drawVod(); show();
        if (TV.pref("autoNext")) {
            nextLeft = Math.max(5, Math.min(15, Math.round(dur - pos)));
            var count = nextEl.querySelector(".osd__nextbtn i");
            count.textContent = T("in {n} s", { n: nextLeft });
            clearInterval(nextTimer);
            nextTimer = setInterval(function () {
                if (--nextLeft <= 0) { clearInterval(nextTimer); goEpisode(vod.next); return; }
                count.textContent = T("in {n} s", { n: nextLeft });
            }, 1000);
        }
    }
    function dismissNext() { clearInterval(nextTimer); nextEl.classList.remove("is-on"); if (zone === "next") zone = "track"; drawVod(); show(); }

    function vodMenu() {
        var items = [{ label: T("Start Over"), icon: "restart", run: function () { scrub = null; TV.player.seekTo(0); show(); } },
                     { label: T("Subtitles"), icon: "cc", run: function () { openPop("subs"); } },
                     { label: T("Audio"), icon: "speaker", run: function () { openPop("audio"); } }];
        if (hasQuality()) items.push({ label: T("Quality"), icon: "quality", run: function () { openPop("quality"); } });
        items.push({ label: T("Stream Info"), icon: "info", run: function () { openPop("info"); } });
        if (vod && vod.prev) items.push({ label: T("Previous Episode") + "  ·  " + vod.prev.label, icon: "back10", run: function () { goEpisode(vod.prev); } });
        if (vod && vod.next) items.push({ label: T("Next Episode") + "  ·  " + vod.next.label, icon: "fwd10", run: function () { goEpisode(vod.next); } });
        sleepItem(items);
        TV.menu(vod.title, items);
    }

    /* ---------- sleep timer: the picture stops after 30 min to 2 h, and APL TV goes back to its pages ---------- */
    var sleepAt = 0, sleepTimer = null;
    function sleepItem(items) {
        var left = sleepAt ? Math.max(1, Math.round((sleepAt - Date.now()) / 60000)) : 0;
        items.push({ label: T("Sleep Timer") + (left ? "  ·  " + T("{n} min left", { n: left }) : ""), icon: "moon", run: function () {
            TV.menu(T("Sleep Timer"), [0, 30, 60, 90, 120].map(function (m) {
                return { label: m ? T("In {n} min", { n: m }) : T("Off"), check: m ? false : !sleepAt, run: function () { setSleep(m); } };
            }));
        } });
    }
    function setSleep(min) {
        clearTimeout(sleepTimer); sleepAt = 0;
        if (!min) { TV.toast(T("Sleep timer off")); return; }
        sleepAt = Date.now() + min * 60000;
        sleepTimer = setTimeout(function () { sleepAt = 0; if (open) { finish(); TV.player.stop(); } TV.toast(T("Sleep timer: playback stopped")); }, min * 60000);
        TV.toast(T("Playback stops in {n} min", { n: min }));
    }

    /* ---------- shared ---------- */
    function error(title, detail, hint) {
        errBox.innerHTML = "<h3>" + esc(title) + "</h3><p>" + esc(hint || T("Try another channel, or try again later.")) + (detail ? "<br><small style='opacity:.6'>" + esc(detail) + "</small>" : "") + "</p>";
        errBox.classList.add("is-on");
        stateBox.classList.remove("is-on");
    }
    function buffering(b) { stateBox.classList.toggle("is-on", !!b); if (!b) errBox.classList.remove("is-on"); }
    function finish(keepPlayer) {
        var last = ch;
        if (tsh) tsLive();                                // the picture under Live TV is live again
        try {
            if (mode === "vod" && vod) {
                var r = D.resumeOf(vod.resumeKey);
                if (!vod.noResume) TV.save("lastWatch", r && !r.done && r.pos > 60 ? { kind: "vod", item: vod.item.id, key: vod.resumeKey, at: Date.now() } : null);
            } else if (mode === "live" && ch) TV.save("lastWatch", { kind: "live", id: ch.id, at: Date.now() });
        } catch (e) {}
        if (mode === "vod") { save(false); tell("stop"); if (!keepPlayer) TV.player.stop(); D.resumeChanged(); }
        stopExt(); clearTimeout(subTimer); putSub("");     // no subtitle line left on screen after the video
        closeOsd();
        if (TV.pushShelf) TV.pushShelf();
        var cb = onClose; onClose = null;
        if (mode === "vod" && vod && vod.onClose) vod.onClose();
        if (cb) cb(last);
    }

    /* Number keys: the channel number grows as you type, then it opens */
    var numBuf = "", numTimer = null;
    function number(d, done) {
        if (!root) build();
        numBuf = (numBuf + d).slice(-4);
        numBox.textContent = numBuf;
        numBox.classList.add("is-on");
        root.classList.add("is-on");
        clearTimeout(numTimer);
        numTimer = setTimeout(function () {
            var n = parseInt(numBuf, 10); numBuf = "";
            numBox.classList.remove("is-on");
            if (!open) root.classList.remove("is-on");
            done(n);
        }, 1400);
    }

    function liveKey(code) {
        var d = TV.digit(code), shown = root.classList.contains("is-shown");
        if (d >= 0) { number(d, function (n) { var c = TV.live.findNumber(n); if (c) zapTo(c); else TV.toast(T("No channel {n}", { n: n })); }); return; }
        if (root.classList.contains("has-list")) {
            if (code === K.UP) { vlist.move(-1); TV.epg.ensure(ctx.slice(Math.max(0, vlist.index - 5), vlist.index + 10)); return; }
            if (code === K.DOWN) { vlist.move(1); TV.epg.ensure(ctx.slice(Math.max(0, vlist.index - 5), vlist.index + 10)); return; }
            if (code === K.LEFT || TV.isBack(code)) { closeList(); return; }
            return;
        }
        if (zone === "icons") {
            var icons = liveIcons();
            if (code === K.LEFT) { if (iconIndex > 0) { iconIndex--; TV.sound.tick(); } else { zone = "live"; } drawLive(); show(); return; }
            if (code === K.RIGHT) { if (iconIndex < icons.length - 1) { iconIndex++; TV.sound.tick(); drawLive(); } else TV.sound.edge(); show(); return; }
            if (TV.isBack(code) || code === K.UP || code === K.DOWN) { zone = "live"; drawLive(); show(); return; }
            return;
        }
        // timeshift: ⏯ pauses and resumes, ◀ ▶ (or ⏪ ⏩) 10 s back or forward (held: 30 s), ⏹ back to live
        if ((code === K.PAUSE || code === K.PLAYPAUSE) && !(tsh && tsh.paused) && tsPause()) return;
        if ((code === K.PLAY || code === K.PLAYPAUSE) && tsh && tsh.paused) { tsResume(); return; }
        if (tsh && (code === K.LEFT || code === K.RW)) { tsJump(-1); return; }
        if (tsh && (code === K.RIGHT || code === K.FF)) { tsJump(1); return; }
        if (tsh && code === K.STOP) { tsLive(); return; }
        if (tsh && code === K.UP) { zone = "icons"; iconIndex = 0; TV.sound.tick(); drawLive(); show(0); return; }
        if (code === K.RW && tsOn()) { TV.toast(T("Pause the channel first: APL TV keeps it from that moment.")); return; }
        switch (code) {
            case K.UP: case K.CH_UP: zap(-1); return;
            case K.DOWN: case K.CH_DOWN: zap(1); return;
            case K.RIGHT:
                if (shown && liveIcons().length) { zone = "icons"; iconIndex = 0; TV.sound.tick(); drawLive(); show(0); return; }
                drawLive(); tickClock(); show(); return;
            case K.LEFT: case K.INFO: drawLive(); tickClock(); show(); return;
            case K.PREV_CH: case K.PREV: if (prevCh) zapTo(prevCh); return;
            case K.CH_LIST: openList(); return;
        }
        if (TV.isBack(code)) {
            if (shown) { hideBar(); return; }
            finish();
        }
    }
    function vodKey(code) {
        var d = TV.digit(code), shown = root.classList.contains("is-shown");
        if (zone === "next") {
            if (code === K.UP || code === K.LEFT || code === K.RIGHT) { /* the card keeps the focus */ return; }
            if (TV.isBack(code) || code === K.DOWN) { dismissNext(); return; }
        }
        if (d >= 0) { jumpTo(d / 10); return; }
        if (zone === "icons") {
            if (code === K.LEFT) { if (iconIndex > 0) { iconIndex--; TV.sound.tick(); } else TV.sound.edge(); drawVod(); show(0); return; }
            if (code === K.RIGHT) { if (iconIndex < vb.icons.length - 1) { iconIndex++; TV.sound.tick(); } else TV.sound.edge(); drawVod(); show(0); return; }
            if (code === K.DOWN || TV.isBack(code)) { zone = "track"; TV.sound.tick(); drawVod(); show(); return; }
            if (code === K.UP) { TV.sound.edge(); return; }
        }
        if (zone === "tabs") {
            if (code === K.LEFT) { if (tabIndex > 0) { tabIndex--; TV.sound.tick(); } else TV.sound.edge(); drawVod(); show(0); return; }
            if (code === K.RIGHT) { if (tabIndex < vb.tabs.length - 1) { tabIndex++; TV.sound.tick(); } else TV.sound.edge(); drawVod(); show(0); return; }
            if (code === K.UP || TV.isBack(code)) { zone = "track"; TV.sound.tick(); drawVod(); show(); return; }
            if (code === K.DOWN) { TV.sound.edge(); return; }
        }
        switch (code) {
            case K.LEFT: seek(-1); return;
            case K.RIGHT: seek(1); return;
            case K.RW: seek(-1, true); return;
            case K.FF: seek(1, true); return;
            case K.UP:
                if (shown && !scrub) { zone = "icons"; iconIndex = 0; TV.sound.tick(); drawVod(); show(0); return; }
                drawVod(); show(); return;
            case K.DOWN:
                if (shown && !scrub && vb && vb.tabs.length) { zone = "tabs"; tabIndex = vod.next && vod.prev ? 1 : 0; TV.sound.tick(); drawVod(); show(0); return; }
                drawVod(); show(); return;
            case K.INFO: drawVod(); show(); return;
            case K.PLAY: TV.player.resume(); drawVod(); show(); return;
            case K.PAUSE: TV.player.pause(); drawVod(); show(0); return;
            case K.PLAYPAUSE: TV.player.toggle(); drawVod(); show(); return;
            case K.STOP: finish(); return;
            case K.NEXT: if (vod && vod.next) goEpisode(vod.next); return;
            case K.PREV: if (vod && vod.prev) goEpisode(vod.prev); return;
        }
        if (TV.isBack(code)) {
            if (scrub) { cancelSeek(); return; }
            if (shown && TV.player.state() !== "PAUSED") { hideBar(); return; }
            finish();
        }
    }

    var screen = {
        key: function (code) {
            if (pop) { popKey(code); return; }
            if (mode === "live") liveKey(code); else vodKey(code);
        },
        ok: function () {
            if (pop) { popOk(); return; }
            if (mode === "live") {
                if (zone === "icons") { var k = liveIcons()[iconIndex]; if (k === "golive") { zone = "live"; iconIndex = 0; tsLive(); return; } if (k === "ts") { if (tsh && tsh.paused) tsResume(); else tsPause(); drawLive(); return; } if (k) openPop(k); return; }
                if (tsh && tsh.paused && !root.classList.contains("has-list")) { tsResume(); return; }
                if (root.classList.contains("has-list")) {
                    var c = vlist.current();
                    if (c && ch && c.id === ch.id) closeList(); else if (c) { zapTo(c); vlist.refresh(); }
                    return;
                }
                openList();
                return;
            }
            if (zone === "next") { goEpisode(vod.next); return; }
            if (zone === "icons") { openPop((vb && vb.kinds[iconIndex]) || "subs"); return; }
            if (zone === "tabs") {
                var t = vb.tabDefs[tabIndex];
                if (t && t.id === "prev") goEpisode(vod.prev);
                else if (t && t.id === "next") goEpisode(vod.next);
                else if (t && t.id === "restart") { TV.player.seekTo(0); zone = "track"; drawVod(); show(); }
                return;
            }
            if (scrub) { commitSeek(); return; }
            TV.player.toggle(); drawVod(); show(TV.player.state() === "PAUSED" ? 0 : 3000);
        },
        canHold: function () { return !root.classList.contains("has-list") && !scrub && !pop && (zone === "track" || zone === "live"); },
        longOk: function () { if (mode === "live") liveMenu(); else vodMenu(); }
    };

    /* For the voice assistant (voice.js): each returns false when it does not apply, so the screen does its own thing */
    function voiceSeek(to) {
        var d = TV.player.duration();
        if (!open || mode !== "vod" || !d || scrub) return false;
        TV.player.seekTo(TV.clamp(to, 0, Math.max(0, d - 2)));
        drawVod(); show();
        return true;
    }
    var voice = {
        mode: function () { return open ? mode : ""; },
        play: function (want) {
            if (!open) return false;
            var st = TV.player.state();
            if ((want && st === "PAUSED") || (!want && st === "PLAYING")) TV.player.toggle();
            if (mode === "vod") { drawVod(); show(TV.player.state() === "PAUSED" ? 0 : 3000); }
            return true;
        },
        seekBy: function (sec) { return voiceSeek(TV.player.position() + sec); },
        seekTo: function (sec) { return voiceSeek(sec); },
        step: function (d) {
            if (!open) return false;
            if (mode === "vod") { var ep = d > 0 ? vod && vod.next : vod && vod.prev; if (!ep) return false; goEpisode(ep); return true; }
            zap(d); return true;
        }
    };

    TV.osd = {
        live: live, vod: vodPlay, isOpen: function () { return open; }, buffering: buffering, error: error, number: number,
        close: function () { if (open) finish(); }, current: function () { return ch; }, voice: voice
    };
    TV.subtitles = { options: SUB, apply: applySubStyle, sample: sampleSub, hash: osSum, speed: speedFactor, parse: parseSubs };
    TV.langs = { name: function (c) { return LANG_NAMES[c] || c; }, list: ["fr", "en", "es", "de", "it", "pt", "ar", "tr", "nl", "ru", "ja", "ko", "zh", "hi", "pl"] };
})(window);
