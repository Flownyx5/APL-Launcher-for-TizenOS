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
    function busy() { return root.classList.contains("has-list") || !!scrub || !!pop || zone !== (mode === "live" ? "live" : "track") || (vod && TV.player.state() === "PAUSED"); }
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
            var shown = root.classList.contains("is-shown");
            if (shown) tickClock();
            if (!shown) return;
            if (mode === "live") { if (++ticks % 15 === 0) drawLive(); } else drawVod();
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
    function langName(code) { var n = norm(code); return n === "und" || !n ? "" : (LANG_NAMES[n] || String(code).toUpperCase()); }
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
            return TV.fetchJSON(url, { timeout: 15000 });
        }).then(function (j) {
            if (vod !== my) return;
            var order = [wantLang(TV.pref("subLang") === "off" ? "auto" : TV.pref("subLang")), TV.pref("subLang2"), TV.lang, "en"];
            var list = (j && j.subtitles || []).map(function (s, i) {
                var l = norm(s.lang), rank = order.indexOf(l);
                var rel = String(s.movieReleaseName || s.subtitleFileName || "").replace(/\.(srt|sub|ass)$/i, "").replace(/[._]+/g, " ").trim();
                return { id: s.id, url: s.url, lang: l, name: LANG_NAMES[l] || String(s.lang).toUpperCase(), release: rel.length > 52 ? rel.slice(0, 50) + "…" : rel, rank: rank < 0 ? 9 : rank, i: i };
            }).filter(function (s) { return s.url; }).sort(function (a, b) { return a.rank - b.rank || a.i - b.i; });
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
            ext = { id: o.id, cues: cues, name: o.name, at: 0 };
            startExt();
            TV.toast(T("Subtitles: {name}", { name: o.name + " · OpenSubtitles" }));
            closePop();
        }).catch(function (e) { os.loadingId = null; TV.log("opensubtitles download: " + e.message); TV.toast(T("These subtitles could not be downloaded.")); refreshPop(); });
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
    function fmtDelay() { var s = delayMs / 1000; return (s > 0 ? "+" : s < 0 ? "−" : "") + Math.abs(s).toFixed(2).replace(".", TV.lang === "fr" ? "," : ".") + " s"; }

    /* ---------- the menus above the buttons (Apple TV style) ---------- */
    function subsItems() {
        var tr = TV.player.tracks(), subs = tr.filter(function (t) { return t.type === "TEXT"; }), curS = TV.player.currentTrack("TEXT"), items = [];
        items.push({ label: T("Off"), check: !subsOn && !ext, run: function () { TV.player.subtitlesOff(true); subsOn = false; stopExt(); putSub(""); closePop(); } });
        subs.forEach(function (s, i) {
            items.push({ label: langName(s.lang) || T("Track {n}", { n: i + 1 }), check: subsOn && !ext && s.index === curS, run: function () {
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
                    items.push({ label: o.name, sub: os.loadingId === o.id ? T("Downloading…") : o.release, check: ext && ext.id === o.id, keep: true, run: function () { useOS(o); } });
                });
                if (!os.expanded && others > 0) items.push({ label: T("Other Languages ({n})", { n: others }), keep: true, run: function () { os.expanded = true; } });
            }
        }
        items.push({ head: T("Settings") });
        items.push({ label: T("Delay"), value: fmtDelay(), keep: true, run: function () { openPop("sync"); } });
        items.push({ label: T("Subtitle Style"), run: function () { closePop(); styleMenu(); } });
        return items;
    }
    function audioItems() {
        var tr = TV.player.tracks(), audio = tr.filter(function (t) { return t.type === "AUDIO"; }), curA = TV.player.currentTrack("AUDIO");
        var codecs = { "audio/x-ac3": "Dolby Digital", "audio/ac3": "Dolby Digital", "audio/x-eac3": "Dolby Digital Plus", "audio/eac3": "Dolby Digital Plus", "audio/mpeg": "MPEG",
                       "audio/x-dts": "DTS", "audio/dts": "DTS", "audio/mp4a-latm": "AAC", "audio/aac": "AAC", "audio/x-opus": "Opus", "audio/opus": "Opus", "audio/x-truehd": "Dolby TrueHD" };
        if (!audio.length) return [{ label: T("Only one audio track"), run: function () {} }];
        return audio.map(function (a, i) {
            var cn = codecs[String(a.codec).toLowerCase()] || String(a.codec || "").replace(/^audio\/(x-)?/i, "").toUpperCase();
            var extra = [a.channels ? (a.channels >= 8 ? "7.1" : a.channels >= 6 ? "5.1" : a.channels == 2 ? T("Stereo") : "") : "", cn].filter(Boolean).join(" · ");
            return { label: langName(a.lang) || T("Track {n}", { n: i + 1 }), sub: extra, check: a.index === curA, run: function () {
                TV.player.selectTrack("AUDIO", a.index); TV.log("audio track " + a.index + " (" + a.lang + ")"); closePop();
            } };
        });
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
    function itemsFor(kind) { return kind === "subs" ? subsItems() : kind === "picture" ? pictureItems() : audioItems(); }
    function openPop(kind) {
        pop = { kind: kind, index: 0 };
        if (kind !== "sync") {
            var items = itemsFor(kind);
            for (var i = 0; i < items.length; i++) if (items[i].check) { pop.index = i; break; }
            if (items[pop.index] && items[pop.index].head) pop.index++;
        }
        refreshPop();
        show(0);
    }
    function closePop(silent) {
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
        var items = pop.items = itemsFor(pop.kind);
        if (pop.index >= items.length) pop.index = items.length - 1;
        while (items[pop.index] && items[pop.index].head) pop.index++;
        var html = "<div class='osd__pophead'>" + esc(pop.kind === "subs" ? T("Subtitles") : pop.kind === "picture" ? T("Picture Size") : T("Audio")) + "</div><div class='osd__poplist'>";
        items.forEach(function (it, i) {
            if (it.head) { html += "<div class='osd__popsec'>" + esc(it.head) + "</div>"; return; }
            html += "<div class='osd__popitem" + (i === pop.index ? " is-focused" : "") + "' data-i='" + i + "'><span class='osd__popcheck'>" + (it.check ? TV.icon("check", 24) : "") + "</span>" +
                "<span class='osd__poptxt'><b>" + esc(it.label) + "</b>" + (it.sub ? "<small>" + esc(it.sub) + "</small>" : "") + "</span>" + (it.value ? "<em>" + esc(it.value) + "</em>" : "") + "</div>";
        });
        popEl.innerHTML = html + "</div>";
        popEl.className = "osd__pop is-on";
        var f = popEl.querySelector(".is-focused"), listBox = popEl.querySelector(".osd__poplist");
        if (f && listBox) listBox.scrollTop = Math.max(0, f.offsetTop - listBox.clientHeight / 2 + f.offsetHeight / 2);
    }
    function popKey(code) {
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
        var tr = TV.player.tracks(), a = tr.filter(function (t) { return t.type === "AUDIO"; }).length, s = tr.filter(function (t) { return t.type === "TEXT"; }).length;
        var out = [];
        if (s) out.push("subs");
        if (a > 1) out.push("audio");
        out.push("picture");
        return out;
    }
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
            (next ? "<div class='osd__next'>" + esc(T("Next")) + " · <b>" + TV.hhmm(next[0]) + "</b>  " + esc(next[2]) + "</div>" : "");
        bar.appendChild(txt);
        var icons = liveIcons();
        if (icons.length) {
            var box = el("div", "pv__icons osd__liveicons");
            icons.forEach(function (k, i) { box.appendChild(el("div", "pv__btn" + (zone === "icons" && i === iconIndex ? " is-focused" : ""), TV.icon(k === "subs" ? "cc" : k === "audio" ? "speaker" : "aspect", 30))); });
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
            { label: T("Watch in Multiview"), icon: "grid", run: function () { var c = ch; finish(); TV.multiview.open([c]); } }
        ];
        if (liveIcons().indexOf("subs") >= 0) items.push({ label: T("Subtitles"), icon: "cc", run: function () { openPop("subs"); } });
        if (liveIcons().indexOf("audio") >= 0) items.push({ label: T("Audio"), icon: "speaker", run: function () { openPop("audio"); } });
        sleepItem(items);
        TV.menu(ch.num + "  " + ch.name, items);
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
            onPlaying: function () { stateBox.classList.remove("is-on"); errBox.classList.remove("is-on"); if (!tracksDone) setTimeout(applyTrackPrefs, 600); },
            onTime: function () { stateBox.classList.remove("is-on"); errBox.classList.remove("is-on"); },
            onSubtitle: function (s) { if (subsOn && !ext) showSub(s); },
            onEnded: function () { save(true); if (o.next && o.onEpisode && TV.pref("autoNext")) { var n = o.next.ep, cb = o.onEpisode; finish(true); cb(n); } else finish(); },
            onError: function (e) {
                stateBox.classList.remove("is-on");
                // a format the screen cannot decode (HEVC 10-bit on a small Android box, an old Samsung…)
                var dec = /DECOD|FORMAT_UNSUPPORTED|NOT_SUPPORTED/i.test(String(e));
                error(dec ? T("This screen cannot decode this video.") : T("This video cannot be played."), String(e),
                      dec ? T("Try another version of it, if there is one.") : T("Try again later, or try another version if there is one."));
            }
        });
        // the series' (or movie's) picture for the "next episode" card: never a picture of the episode
        o.art = o.item && TV.sized(o.item.backdrop || "", "w780");
        TV.meta.lookup(o.item).then(function (m) {
            if (!m || vod !== o) return;
            if (m.backdrop) o.art = TV.sized(m.backdrop, "w780");
            TV.meta.certs(o.item.kind === "series" ? "tv" : "movie", m.tmdbId).then(function (c) {
                o.age = TV.meta.certBadge(c);
                if (vod === o && vb && vb.age) vb.age.innerHTML = o.age;
            });
        });
        drawVod(); show();
        clearInterval(saveTimer);
        saveTimer = setInterval(function () { save(false); }, 10000);
    }
    /* Where you are, every 10 s. Finished (past 94 %): marked watched; an episode's series then waits on the next one */
    function save(ended) {
        if (!vod) return;
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
        var tabs = vodTabs();
        bar.innerHTML = "<div class='pv'><div class='pv__top'><div class='pv__titles'><div class='pv__subline'><span class='pv__age'></span><span class='pv__sub'></span></div><div class='pv__title'></div></div>" +
            "<div class='pv__icons'><div class='pv__btn'>" + TV.icon("cc", 30) + "</div><div class='pv__btn'>" + TV.icon("speaker", 30) + "</div><div class='pv__btn'>" + TV.icon("aspect", 30) + "</div></div></div>" +
            "<div class='osd__seek'><div class='bar'><i></i><em></em><b class='osd__bubble'><span></span><small></small></b><u></u></div></div>" +
            "<div class='pv__times'><span class='osd__now'></span><span class='pv__pp'></span><span class='pv__end'></span><span class='osd__left'></span></div>" +
            "<div class='pv__tabs'>" + tabs.map(function (t) { return "<div class='pv__tab'>" + esc(t.label) + "</div>"; }).join("") + "</div></div>";
        var q = function (s) { return bar.querySelector(s); };
        vb = { root: bar.firstChild, age: q(".pv__age"), pp: q(".pv__pp"), title: q(".pv__title"), sub: q(".pv__sub"), now: q(".osd__now"), left: q(".osd__left"), end: q(".pv__end"),
               fill: q(".bar i"), range: q(".bar em"), bubble: q(".osd__bubble"), bt: q(".osd__bubble span"), bd: q(".osd__bubble small"), dot: q(".bar u"), seek: q(".osd__seek"),
               icons: [].slice.call(bar.querySelectorAll(".pv__btn")), tabs: [].slice.call(bar.querySelectorAll(".pv__tab")), tabDefs: tabs, last: {} };
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
        try {
            if (mode === "vod" && vod) {
                var r = D.resumeOf(vod.resumeKey);
                TV.save("lastWatch", r && !r.done && r.pos > 60 ? { kind: "vod", item: vod.item.id, key: vod.resumeKey, at: Date.now() } : null);
            } else if (mode === "live" && ch) TV.save("lastWatch", { kind: "live", id: ch.id, at: Date.now() });
        } catch (e) {}
        if (mode === "vod") { save(false); if (!keepPlayer) TV.player.stop(); D.resumeChanged(); }
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
                if (zone === "icons") { var k = liveIcons()[iconIndex]; if (k) openPop(k); return; }
                if (root.classList.contains("has-list")) {
                    var c = vlist.current();
                    if (c && ch && c.id === ch.id) closeList(); else if (c) { zapTo(c); vlist.refresh(); }
                    return;
                }
                openList();
                return;
            }
            if (zone === "next") { goEpisode(vod.next); return; }
            if (zone === "icons") { openPop(["subs", "audio", "picture"][iconIndex] || "subs"); return; }
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
    TV.subtitles = { options: SUB, apply: applySubStyle, sample: sampleSub };
    TV.langs = { name: function (c) { return LANG_NAMES[c] || c; }, list: ["fr", "en", "es", "de", "it", "pt", "ar", "tr", "nl", "ru", "ja", "ko", "zh", "hi", "pl"] };
})(window);
