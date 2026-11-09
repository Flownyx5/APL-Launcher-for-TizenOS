/* ============================================================
   player.js: the main picture, with Samsung's AVPlay (HLS, MPEG-TS,
   MP4, MKV…) or, on LG (webOS), the HTML <video> and LG's own media
   pipeline, in a window (preview) or full screen.
   - One request at a time: zapping fast never leaves two streams open.
   - A stream that does not start within 25 s is an error.
   - Audio tracks and subtitles of the stream can be chosen.
   On the PC preview, the same HTML <video> stands in for AVPlay.
   ============================================================ */
(function (global) {
    "use strict";

    var TV = global.TV;
    var av = global.webapis && global.webapis.avplay;
    var useAv = !!av && !TV.PREVIEW;
    var video = null;
    var cur = null;            // { url, opts, token }
    var token = 0, rect = null, watchdog = null, lastTime = 0, buffering = false;
    var FULL = [0, 0, 1920, 1080];

    function emit(name, a) { if (cur && cur.opts && cur.opts[name]) { try { cur.opts[name](a); } catch (e) { TV.log("player cb " + name + ": " + e.message); } } }
    function setVideoState() { document.body.classList.toggle("has-video", !!cur); }

    /* The HTML <video>: the player on LG (webOS, whose own media pipeline reads HLS, MPEG-TS, MP4, MKV…)
       and on the PC preview. Its events only count for the stream it is playing now. */
    function mine() { return !!cur && !!video && video._token === cur.token; }
    function ensureVideo() {
        if (video) return video;
        video = document.createElement("video");
        video.className = "pvideo";
        video.autoplay = true;
        document.body.insertBefore(video, document.body.firstChild.nextSibling);
        video.addEventListener("waiting", function () { if (!mine()) return; buffering = true; emit("onBuffering", true); });
        video.addEventListener("playing", function () {
            if (!mine()) return;
            buffering = false;
            if (!started) { started = true; goodSince = Date.now(); TV.log("picture " + video.videoWidth + "x" + video.videoHeight); }
            tickAt = Date.now();
            emit("onBuffering", false); emit("onPlaying");
        });
        video.addEventListener("loadedmetadata", function () { if (mine()) emit("onReady"); });
        video.addEventListener("timeupdate", function () {
            if (!mine()) return;
            var ms = video.currentTime * 1000;
            if (ms !== lastTime) {
                tickAt = Date.now();
                // LG does not always say "playing" again after a short wait: the picture moving is enough
                if (buffering && lastTime > 0 && !video.paused) { buffering = false; emit("onBuffering", false); }
                if (!started && ms > 0 && !video.paused) { started = true; goodSince = Date.now(); emit("onPlaying"); }
            }
            lastTime = ms; emit("onTime", ms);
        });
        video.addEventListener("ended", function () { if (!mine()) return; if (cur.opts.live) reconnect("stream ended"); else emit("onEnded"); });
        video.addEventListener("error", function () {
            if (!mine() || !video.error) return;
            var why = "video error " + video.error.code + (video.error.message ? " " + video.error.message : "");
            TV.log(why);
            // LG refuses some MPEG-TS streams (4K HEVC channels): the same channel in HLS goes through LG's
            // own player, which reads them. Tried at once, and remembered for that channel.
            if (TV.WEBOS && video.error.code === 4 && !started && !cur.opts._hls && /\.ts(\?|$)/i.test(cur.url)) {
                TV.log("LG refused this stream: trying it in HLS");
                rememberHls(cur.url);
                cur.opts._hls = true;
                open(toHls(cur.url), cur.opts, true);
                return;
            }
            if (started || cur.opts.live) reconnect(why); else emit("onError", why);
        });
        return video;
    }
    /* What the <video> plays. On LG, a stream with several qualities (HLS, DASH) is told it may go up to
       4K and should start at the best quality (by default LG stops at 1080p and starts low). */
    var MIME = { m3u8: "application/vnd.apple.mpegurl", mpd: "application/dash+xml" };
    function adaptiveKind(url) { return /\.mpd(\?|$)/i.test(url) ? "mpd" : (/\.m3u8(\?|$)|\/hls\/|format=m3u8/i.test(url) ? "m3u8" : ""); }
    function setSource(v, url, opts) {
        v.removeAttribute("src");
        while (v.firstChild) v.removeChild(v.firstChild);
        var kind = adaptiveKind(url);
        if (!TV.WEBOS || !kind) { v.src = url; return; }
        var o = { option: {} };
        if (kind) o.option.adaptiveStreaming = { maxWidth: 3840, maxHeight: 2160, adaptiveResolution: true, seamlessPlay: true, bps: { start: 40000000 } };
        if (opts.start && !opts.live) o.option.transmission = { playTime: { start: Math.floor(opts.start * 1000) } };
        var s = document.createElement("source");
        s.setAttribute("src", url);
        if (kind) s.setAttribute("type", MIME[kind] + ";mediaOption=" + encodeURI(JSON.stringify(o)));
        v.appendChild(s);
        v.load();
    }
    function place(r) {
        rect = r || FULL;
        if (useAv) {
            try { av.setDisplayRect(rect[0], rect[1], rect[2], rect[3]); } catch (e) { TV.log("setDisplayRect: " + e.message); }
        } else if (video) {
            video.style.left = rect[0] + "px"; video.style.top = rect[1] + "px";
            video.style.width = rect[2] + "px"; video.style.height = rect[3] + "px";
        }
    }

    /* Picture Size (Settings > Playback, or the player's third button) */
    var METHODS = { fit: "PLAYER_DISPLAY_MODE_LETTER_BOX", fill: "PLAYER_DISPLAY_MODE_FULL_SCREEN", auto: "PLAYER_DISPLAY_MODE_AUTO_ASPECT_RATIO" };
    function applyPicture() {
        var mode = METHODS[TV.pref("pictureMode")] ? TV.pref("pictureMode") : "fit";
        if (useAv) {
            try { av.setDisplayMethod(METHODS[mode]); } catch (e) {
                TV.log("picture " + mode + ": " + e.message);
                try { av.setDisplayMethod(METHODS.fit); } catch (e2) {}
            }
        } else if (video) video.style.objectFit = mode === "fill" ? "fill" : "contain";
    }
    function setPicture(mode) { TV.setPref("pictureMode", mode); if (cur) applyPicture(); }

    function closeAv() {
        if (!useAv) return;
        var t0 = Date.now(), t1 = t0;
        try { var st = av.getState(); if (st !== "NONE" && st !== "IDLE") av.stop(); } catch (e) {}
        t1 = Date.now();
        try { av.close(); } catch (e) {}
        if (TV.DEV && Date.now() - t0 > 50) TV.log("player: stop " + (t1 - t0) + " ms, close " + (Date.now() - t1) + " ms");
        if (TV.mark) TV.mark("player stop");
    }

    /* ---------- staying on air ----------
       A live stream that stops moving for 10 s (a movie for 20 s), or that breaks, is opened again by itself,
       up to 5 times in a row (0.8, 2, 4, 6, 8 s apart), a movie at the place it had reached. After a minute
       of good playback the count starts again. Nothing is reopened while the picture moves. */
    var tickAt = 0, started = false, attempts = 0, goodSince = 0, stallTimer = null, retryTimer = null;
    var DELAYS = [800, 2000, 4000, 6000, 8000];
    function reconnect(why) {
        if (!cur) return;
        var c = cur;
        if (attempts >= DELAYS.length) { TV.log("giving up after " + attempts + " reconnections (" + why + ")"); emit("onError", why); return; }
        var wait = DELAYS[attempts++];
        TV.log("reconnecting (" + why + "), attempt " + attempts + " in " + wait + " ms");
        emit("onReconnect", attempts);
        closeAv();
        clearTimeout(retryTimer);
        retryTimer = setTimeout(function () {
            if (cur !== c) return;
            var o = c.opts;
            if (!o.live && lastTime > 0) o.start = lastTime / 1000;
            open(c.url, o, true);
        }, wait);
    }
    function watchStall() {
        clearInterval(stallTimer);
        stallTimer = setInterval(function () {
            if (!cur || !started) return;
            if (useAv) { var st = "NONE"; try { st = av.getState(); } catch (e) {} if (st !== "PLAYING") return; }
            else if (!video || video.paused || video.ended || video.seeking) return;
            var limit = cur.opts.live ? 10000 : 20000;
            if (Date.now() - tickAt > limit) reconnect("no picture for " + Math.round((Date.now() - tickAt) / 1000) + " s");
            if (goodSince && Date.now() - goodSince > 60000) attempts = 0;
        }, 2000);
    }
    /* 4K: Samsung's player wants to be told before it prepares a UHD stream */
    var uhdPanel = null;
    function canUhd() {
        if (uhdPanel === null) { try { uhdPanel = !!global.webapis.productinfo.isUdPanelSupported(); } catch (e) { uhdPanel = true; } }
        return uhdPanel;
    }
    function streamInfo() {
        try {
            var info = av.getCurrentStreamInfo() || [];
            for (var i = 0; i < info.length; i++) if (info[i].type === "VIDEO") {
                var x = JSON.parse(info[i].extra_info || "{}");
                return { w: +x.Width || 0, h: +x.Height || 0, fps: x.FrameRate || "", codec: x.fourCC || "", bitrate: x.Bit_rate || "" };
            }
        } catch (e) {}
        return null;
    }

    /* Streams found to be 4K once are opened in 4K mode next time (a short fingerprint, never the address) */
    function fp(url) { var h = 0, s = String(url); for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return String(h); }
    function knownUhd(url) { return !!(TV.load("uhd", {}) || {})[fp(url)]; }
    function rememberUhd(url) { var m = TV.load("uhd", {}) || {}, k = Object.keys(m); if (k.length > 400) delete m[k[0]]; m[fp(url)] = 1; TV.save("uhd", m); }
    /* LG: channels whose MPEG-TS it refused are opened in HLS straight away next time */
    function toHls(url) { return String(url).replace(/\.ts(\?|$)/i, ".m3u8$1"); }
    function knownHls(url) { return !!(TV.load("hlsOnly", {}) || {})[fp(url)]; }
    function rememberHls(url) { var m = TV.load("hlsOnly", {}) || {}, k = Object.keys(m); if (k.length > 400) delete m[k[0]]; m[fp(url)] = 1; TV.save("hlsOnly", m); }
    function play(url, opts) {
        opts = opts || {};
        // A Stalker portal's channel or movie: its real link is asked first (it lasts a short time only)
        if (/^stalker:/.test(url) && TV.stalker) {
            var my = ++token;
            clearTimeout(watchdog); clearTimeout(retryTimer);
            cur = { url: url, opts: opts, token: my };
            buffering = true; emit("onBuffering", true);
            TV.stalker.resolve(url).then(function (real) { if (cur && cur.token === my) play(real, opts); },
                function (e) { if (cur && cur.token === my) { TV.log("stalker link: " + e.message); emit("onError", e.message); } });
            return;
        }
        attempts = 0;
        if (!opts.uhd && knownUhd(url)) opts.uhd = true;
        if (TV.WEBOS && /\.ts(\?|$)/i.test(url) && knownHls(url)) { opts._hls = true; url = toHls(url); }
        open(url, opts, false);
    }
    function open(url, opts, again) {
        if (TV.mark) TV.mark("player");
        var my = ++token;
        clearTimeout(watchdog); clearTimeout(retryTimer);
        closeAv();
        cur = { url: url, opts: opts, token: my };
        if (!again) lastTime = 0;
        buffering = true; started = false; tickAt = Date.now(); goodSince = 0;
        setVideoState();
        emit("onBuffering", true);
        TV.log((again ? "reopen " : "play ") + (opts.live ? "live " : "") + (opts.uhd ? "4K " : "") + url.replace(/^(https?:\/\/[^\/]+).*?([^\/]*)$/, "$1/…/$2"));
        watchStall();
        watchdog = setTimeout(function () {
            if (cur && cur.token === my && !started) {
                TV.log("start timeout");
                if (again || opts.live) reconnect("start timeout"); else emit("onError", "timeout");
            }
        }, opts.live ? 25000 : 40000);                     // a movie or an episode: some providers are slow to start them
        if (!useAv) {
            var v = ensureVideo();
            v._token = my;
            textOff();
            place(opts.rect);
            applyPicture();
            lgListen(my);
            setSource(v, url, opts);
            // Where a movie starts again (if LG's own start time was not already used)
            if (opts.start && !opts.live) v.addEventListener("loadedmetadata", function once() {
                v.removeEventListener("loadedmetadata", once);
                if (v._token === my && Math.abs(v.currentTime - opts.start) > 3) { try { v.currentTime = opts.start; } catch (e) {} }
            });
            var pr = v.play(); if (pr && pr.catch) pr.catch(function (e) { if (v._token === my && e && e.name !== "AbortError") TV.log("video play: " + e.message); });
            return;
        }
        try {
            av.open(url);
            av.setListener({
                onbufferingstart: function () { if (cur && cur.token === my) { buffering = true; emit("onBuffering", true); } },
                onbufferingprogress: function () {},
                onbufferingcomplete: function () { if (cur && cur.token === my) { buffering = false; emit("onBuffering", false); } },
                oncurrentplaytime: function (ms) {
                    if (!cur || cur.token !== my) return;
                    if (TV.DEV && Math.floor(ms / 5000) !== Math.floor(lastTime / 5000)) TV.log("playing " + (ms / 1000).toFixed(1) + " s, " + av.getState());
                    if (!started) {
                        started = true; goodSince = Date.now();
                        var si = streamInfo();
                        if (si) TV.log("picture " + si.w + "x" + si.h + " " + si.codec + " " + si.fps + "fps");
                        if (si && si.w >= 3000 && !opts.uhd && canUhd() && TV.TIZEN) {
                            // a 4K picture without Samsung's 4K mode: opened again in 4K mode, where it was
                            TV.log("4K stream without the 4K mode: opened again in 4K mode");
                            opts.uhd = true; rememberUhd(url);
                            if (!opts.live) opts.start = ms / 1000;
                            setTimeout(function () { if (cur && cur.token === my) open(url, opts, true); }, 0);
                            return;
                        }
                        if (si && si.w >= 3000) rememberUhd(url);
                    }
                    if (ms !== lastTime) tickAt = Date.now();
                    lastTime = ms; emit("onTime", ms);
                },
                onstreamcompleted: function () { if (cur && cur.token === my) { if (opts.live) reconnect("stream ended"); else emit("onEnded"); } },
                onerror: function (type) {
                    if (!cur || cur.token !== my) return;
                    TV.log("avplay error " + type);
                    if (started || opts.live) reconnect(String(type)); else { clearTimeout(watchdog); emit("onError", String(type)); }
                },
                onevent: function (type, data) { if (type !== "PLAYER_MSG_RESOLUTION_CHANGED") TV.log("avplay event " + type + " " + (data || "")); },
                onsubtitlechange: function (dur, text) { if (cur && cur.token === my) emit("onSubtitle", { text: text, dur: +dur || 0 }); },
                ondrmevent: function () {}
            });
            place(opts.rect);
            applyPicture();
            if (opts.uhd && canUhd()) { try { av.setStreamingProperty("SET_MODE_4K", "TRUE"); } catch (e) { TV.log("4K mode: " + e.message); } }
            // A stream with several qualities (HLS, DASH): the best one from the start, never the lowest
            // (by default the TV starts low and can stay there: the picture looked compressed)
            if (/\.(m3u8|mpd)(\?|$)|\/hls\/|format=m3u8/i.test(url)) {
                try { av.setStreamingProperty("ADAPTIVE_INFO", "STARTBITRATE=HIGHEST|SKIPBITRATE=LOWEST"); } catch (e) { TV.log("adaptive: " + e.message); }
            }
            // A cushion against small network hiccups: 3 s before starting, 8 s after a pause in the stream
            try {
                av.setBufferingParam("PLAYER_BUFFER_FOR_PLAY", "PLAYER_BUFFER_SIZE_IN_SECOND", opts.live ? 3 : 4);
                av.setBufferingParam("PLAYER_BUFFER_FOR_RESUME", "PLAYER_BUFFER_SIZE_IN_SECOND", opts.live ? 8 : 10);
            } catch (e) {}
            if (opts.live) { try { av.setTimeoutForBuffering(15); } catch (e) {} }
            av.prepareAsync(function () {
                if (!cur || cur.token !== my) return;
                if (opts.start && !opts.live) { try { av.seekTo(Math.floor(opts.start * 1000)); } catch (e) {} }
                emit("onReady");                                   // audio tracks and subtitles are known now
                try { av.play(); emit("onPlaying"); } catch (e) { emit("onError", "play: " + e.message); }
            }, function (err) {
                if (!cur || cur.token !== my) return;
                var why = String(err && (err.name || err.message) || err);
                TV.log("prepare failed " + why);
                // a movie that cannot open: its error stays, the start timer does not add a "timeout" later
                if (again || opts.live) reconnect("prepare " + why); else { clearTimeout(watchdog); emit("onError", why); }
            });
        } catch (e) {
            TV.log("open failed " + e.message);
            emit("onError", e.message);
        }
    }

    function stop() {
        token++;
        clearTimeout(watchdog); clearTimeout(retryTimer); clearInterval(stallTimer);
        closeAv();
        if (video) {
            video._token = 0; textOff(); lgShow(false);
            try { video.pause(); video.removeAttribute("src"); while (video.firstChild) video.removeChild(video.firstChild); video.load(); } catch (e) {}
        }
        cur = null;
        setVideoState();
    }

    function state() {
        if (!cur) return "NONE";
        if (useAv) { try { return av.getState(); } catch (e) { return "NONE"; } }
        return video && !video.paused ? "PLAYING" : "PAUSED";
    }
    function pause() { try { if (useAv) av.pause(); else video.pause(); } catch (e) {} }
    function resume() { try { if (useAv) av.play(); else video.play(); } catch (e) {} }
    function toggle() { if (state() === "PLAYING") { pause(); return false; } resume(); return true; }
    function position() { return lastTime / 1000; }
    function duration() {
        try { return useAv ? (av.getDuration() || 0) / 1000 : (video && isFinite(video.duration) ? video.duration : 0); } catch (e) { return 0; }
    }
    function seekTo(sec, ok, fail) {
        sec = Math.max(0, sec);
        var before = lastTime;
        try {
            if (useAv) av.seekTo(Math.floor(sec * 1000), function () { tickAt = Date.now(); if (ok) ok(); }, function (e) { TV.log("seek failed " + e); lastTime = before; if (fail) fail(e); });
            else { video.currentTime = sec; if (ok) setTimeout(ok, 300); }
            lastTime = sec * 1000;
            tickAt = Date.now();
        } catch (e) { TV.log("seek: " + e.message); lastTime = before; if (fail) fail(e); }
    }
    /* The <video>'s own audio tracks and subtitles (LG reads them from HLS, MP4, MKV…). Subtitles are
       not drawn by the TV: their text goes to the app, which draws it in its own style, as with AVPlay. */
    var textOn = null;
    function onCue() {
        if (!mine() || this !== textOn) return;
        var cues = this.activeCues, parts = [], end = 0;
        for (var i = 0; cues && i < cues.length; i++) { parts.push(cues[i].text); end = Math.max(end, cues[i].endTime); }
        emit("onSubtitle", { text: parts.join("\n"), dur: parts.length ? Math.max(0, (end - video.currentTime) * 1000) : 0 });
    }
    function textOff() {
        var t = video && video.textTracks;
        for (var i = 0; t && i < t.length; i++) { t[i].mode = "disabled"; t[i].oncuechange = null; }
        textOn = null;
    }
    /* LG: the subtitles inside a file (MKV, MP4…) are not given to the page, but LG's own player reads and
       draws them (luna://com.webos.media). Their list comes from its "sourceInfo"; the video's id changes
       while it opens, so each new id is listened to. Until the list comes (4 s at most) the app waits to
       choose the tracks, so your subtitle language is found there too. */
    var lgSubs = [], lgOn = -1, lgId = null, lgBridges = [], lgWatch = null, lgPending = false;
    function lgCall(method, p) {
        if (!lgId) return;
        p = p || {}; p.mediaId = lgId;
        TV.luna("luna://com.webos.media/" + method, p, function (r) { if (r && r.returnValue === false) TV.log("LG subtitles " + method + ": " + (r.errorText || "refused")); });
    }
    function lgListen(my) {
        clearInterval(lgWatch);
        lgBridges.forEach(function (b) { try { b.cancel(); } catch (e) {} });
        lgSubs = []; lgOn = -1; lgId = null; lgBridges = []; lgPending = false;
        if (!TV.WEBOS || !video || !global.PalmServiceBridge) return;
        var old = video.mediaId, last = null, n = 0;
        lgPending = true;
        lgWatch = setInterval(function () {
            if (!cur || cur.token !== my) { clearInterval(lgWatch); return; }
            if (++n > 80) { clearInterval(lgWatch); if (lgPending) { lgPending = false; emit("onReady"); } return; }
            var id = video.mediaId;
            if (!id || id === old || id === last || String(id).charAt(0) === "<") return;
            last = id;
            lgBridges.push(TV.luna("luna://com.webos.media/subscribe", { mediaId: id, subscribe: true }, function (m) {
                if (!m || !m.sourceInfo || !cur || cur.token !== my) return;
                clearInterval(lgWatch);
                lgId = id;
                var p = (m.sourceInfo.programInfo || [])[0] || {};
                lgSubs = (p.subtitleTrackInfo || []).map(function (s, i) { return { num: s.trackNum !== undefined ? s.trackNum : i, lang: s.language || "", label: s.languageName || "" }; });
                TV.log("LG subtitles in the file: " + (lgSubs.map(function (s) { return s.lang || "?"; }).join(",") || "none"));
                lgPending = false;
                emit("onReady");                               // the app chooses the tracks now
            }));
        }, 50);
    }
    function lgShow(on) { if (lgId) lgCall("setSubtitleEnable", { enable: !!on }); if (!on) lgOn = -1; }
    function htmlTracks() {
        if (lgPending) return [];
        var out = [], a = video && video.audioTracks, t = video && video.textTracks, i, n = 0;
        for (i = 0; a && i < a.length; i++) out.push({ index: i, type: "AUDIO", lang: a[i].language || a[i].label || "", codec: "", channels: "" });
        for (i = 0; t && i < t.length; i++) if (t[i].kind === "subtitles" || t[i].kind === "captions") { out.push({ index: i, type: "TEXT", lang: t[i].language || t[i].label || "", codec: "", channels: "" }); n++; }
        // LG's own: numbered after the page's (100, 101…), drawn by the TV
        if (!n) lgSubs.forEach(function (s, j) { out.push({ index: 100 + j, type: "TEXT", lang: s.lang || s.label, codec: "", channels: "", tv: true }); });
        return out;
    }
    function htmlCurrent(type) {
        var i, a = video && video.audioTracks, t = video && video.textTracks;
        if (type === "AUDIO") { for (i = 0; a && i < a.length; i++) if (a[i].enabled) return i; return -1; }
        if (lgOn >= 0) return 100 + lgOn;
        for (i = 0; t && i < t.length; i++) if (t[i] === textOn) return i;
        return -1;
    }
    function htmlSelect(type, index) {
        var i, a = video && video.audioTracks, t = video && video.textTracks;
        if (type === "AUDIO") {
            if (!a || !a[index]) return false;
            for (i = 0; i < a.length; i++) a[i].enabled = i === index;
            return true;
        }
        if (index >= 100 && lgSubs[index - 100]) {
            textOff();
            lgOn = index - 100;
            lgCall("setSubtitleEnable", { enable: true });
            lgCall("selectTrack", { type: "text", index: lgSubs[lgOn].num });
            lgStyle();
            return true;
        }
        if (!t || !t[index]) return false;
        textOff();
        textOn = t[index];
        textOn.mode = "hidden";                       // read, not drawn by the TV
        textOn.oncuechange = onCue;
        return true;
    }

    /* Audio tracks and subtitles: [{ index, type: "AUDIO"|"TEXT", lang }] */
    function tracks() {
        if (!cur) return [];
        if (!useAv) { try { return htmlTracks(); } catch (e) { return []; } }
        try {
            return (av.getTotalTrackInfo() || []).filter(function (t) { return t.type === "AUDIO" || t.type === "TEXT"; }).map(function (t) {
                var x = {}; try { x = JSON.parse(t.extra_info || "{}"); } catch (e) {}
                return { index: t.index, type: t.type, lang: x.language || x.track_lang || "", codec: x.fourCC || "", channels: x.channels || "" };
            });
        } catch (e) { return []; }
    }
    function currentTrack(type) {
        if (!useAv) { try { return htmlCurrent(type); } catch (e) { return -1; } }
        try { var c = av.getCurrentStreamInfo() || []; for (var i = 0; i < c.length; i++) if (c[i].type === type) return c[i].index; } catch (e) {}
        return -1;
    }
    function selectTrack(type, index) {
        try { return useAv ? (av.setSelectTrack(type, index), true) : htmlSelect(type, index); } catch (e) { TV.log("track: " + e.message); return false; }
    }
    function subtitlesOff(off) {
        if (!useAv) { if (off) { textOff(); lgShow(false); emit("onSubtitle", { text: "", dur: 0 }); } return; }
        try { av.setSilentSubtitle(!!off); } catch (e) {}
    }
    /* The video's own subtitles earlier or later (ms; positive = later) */
    var LG_SYNC_UNIT = 1;                                  // ms per unit of LG's setSubtitleSync (to confirm on the G5)
    function subtitleDelay(ms) {
        if (!cur) return;
        if (!useAv) { if (lgOn >= 0) { lgCall("setSubtitleSync", { sync: Math.round(ms / LG_SYNC_UNIT) }); TV.log("LG subtitles delay " + ms + " ms"); } return; }
        try { av.setSubtitlePosition(Math.round(ms)); } catch (e) { TV.log("subtitle delay: " + e.message); }
    }
    /* Subtitle Style for the subtitles LG draws itself (Settings > Subtitle Style). Seen on the G5: font
       sizes 0 to 4 (4 is huge, so Extra Large is 3), the colour by name, position 0 at the bottom and
       higher above. The background stays LG's own. */
    var LG_SIZE = { s: 0, m: 1, l: 2, xl: 3 }, LG_POS = { low: 0, high: 2 };
    function lgStyle() {
        if (lgOn < 0) return;
        var size = LG_SIZE[TV.pref("subSize")], pos = LG_POS[TV.pref("subPos")], color = TV.pref("subColor");
        lgCall("setSubtitleFontSize", { fontSize: size !== undefined ? size : 1 });
        lgCall("setSubtitleCharacterColor", { charColor: /^(white|yellow|cyan|green)$/.test(color) ? color : "white" });
        lgCall("setSubtitlePosition", { position: pos !== undefined ? pos : 0 });
    }
    TV.onPref(function (k) { if (/^sub(Size|Color|Pos|Bg)$/.test(k)) lgStyle(); });

    /* The video plane under the page: setting the window does not restart the stream */
    function setRect(r) { if (cur) cur.opts.rect = r; place(r); }

    document.addEventListener("visibilitychange", function () {
        if (document.hidden && cur) {
            if (cur.opts.onHide) emit("onHide");
            else if (useAv) { try { av.suspend(); } catch (e) {} }
            else if (video && TV.WEBOS) { try { video.pause(); } catch (e) {} }
        } else if (!document.hidden && cur && useAv) {
            try { av.restore(); } catch (e) {}
        } else if (!document.hidden && cur && video && TV.WEBOS) {
            // Back in front on LG: a channel starts again live, a movie goes on where it was
            if (cur.opts.live) open(cur.url, cur.opts, true);
            else { try { video.play(); } catch (e) {} }
        }
    });

    TV.player = {
        play: play, stop: stop, state: state, pause: pause, resume: resume, toggle: toggle, position: position, duration: duration, seekTo: seekTo,
        tracks: tracks, currentTrack: currentTrack, selectTrack: selectTrack, subtitlesOff: subtitlesOff, subtitleDelay: subtitleDelay, setRect: setRect, setPicture: setPicture,
        current: function () { return cur; }, isBuffering: function () { return buffering; }, FULL: FULL, native: useAv,
        streamInfo: function () { return useAv && cur ? streamInfo() : null; }
    };
})(window);
